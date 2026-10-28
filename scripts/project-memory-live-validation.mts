// Live, budget-capped check of project memory (ADR 0030) on synthetic data: DevFlow's capture
// builders and outbox send documents to the pinned Hindsight service, Hindsight extracts and
// consolidates through DevFlow's relay with a real DeepSeek call, and DevFlow recalls the result.
//
// Requires explicit authorization. All spend is admitted against a cumulative ledger in
// out/project-memory-validation/ledger.json; a run never exceeds its own cap or the ledger total.
// The API key comes from the environment only and is never written or logged.
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CODING_MEMORY_RECALL_BUDGET, CONVERSATION_MEMORY_RECALL_BUDGET, resolveDeepSeekPricingSnapshot, selectMemoryWithinBudget,
  type AgentProviderUsage, type Artifact, type CodingAgentRun, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement,
} from '../packages/shared/src/index.ts'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.js'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createMemoryModelRelay, type MemoryRelayCall } from '../apps/desktop/electron/memory-model-relay.js'
import { buildArtifactMemoryDocument, buildCodingRunMemoryDocument, buildConversationMemoryDocument } from '../apps/desktop/electron/project-memory-capture.js'
import { createProjectMemoryRecall } from '../apps/desktop/electron/project-memory-recall.js'
import { ProjectMemoryService } from '../apps/desktop/electron/project-memory-service.js'

const LEDGER_CAP_USD = 3
const env = process.env
if (env.DEVFLOW_MEMORY_LIVE_AUTHORIZED !== '1') throw new Error('Set DEVFLOW_MEMORY_LIVE_AUTHORIZED=1 only after the provider, model and budget are approved.')
const apiKey = env.DEEPSEEK_API_KEY?.trim()
const token = env.DEVFLOW_MEMORY_RELAY_TOKEN?.trim()
if (!apiKey || !token) throw new Error('DEEPSEEK_API_KEY and DEVFLOW_MEMORY_RELAY_TOKEN are required.')
const runCapUsd = Number(env.DEVFLOW_MEMORY_LIVE_MAX_USD ?? '0.8')
if (!Number.isFinite(runCapUsd) || runCapUsd <= 0 || runCapUsd > LEDGER_CAP_USD) throw new Error('Invalid DEVFLOW_MEMORY_LIVE_MAX_USD')
const relayPort = Number(env.DEVFLOW_MEMORY_RELAY_PORT ?? '8899')
const endpoint = env.HINDSIGHT_ENDPOINT ?? 'http://127.0.0.1:8890'
const model = env.DEVFLOW_MEMORY_LIVE_MODEL ?? 'deepseek-v4-flash'
const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'out/project-memory-validation')
const runId = `run-${new Date().toISOString().replace(/[:.]/gu, '-')}`
await mkdir(path.join(outDir, runId), { recursive: true })

// ---- Cumulative ledger: reservations are worst case; unknown outcomes keep their reservation.
type Ledger = { capUsd: number; runs: Array<{ id: string; at: string; spentUsd: number; calls: number; model: string }> }
const ledgerPath = path.join(outDir, 'ledger.json')
const ledger: Ledger = await readFile(ledgerPath, 'utf8').then((text) => JSON.parse(text) as Ledger, () => ({ capUsd: LEDGER_CAP_USD, runs: [] }))
if (ledger.capUsd !== LEDGER_CAP_USD) throw new Error('Ledger cap differs from the authorized total')
const priorSpentUsd = ledger.runs.reduce((sum, run) => sum + run.spentUsd, 0)
const capUsd = Math.min(runCapUsd, LEDGER_CAP_USD - priorSpentUsd)
if (capUsd <= 0.01) throw new Error(`Authorized budget exhausted: ${priorSpentUsd.toFixed(4)} of ${LEDGER_CAP_USD} USD spent`)
const thisRun = { id: runId, at: new Date().toISOString(), spentUsd: 0, calls: 0, model }
ledger.runs.push(thisRun)
async function saveLedger() {
  const temporary = `${ledgerPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, ledgerPath)
}
await saveLedger()
const outstanding = new Map<string, number>()
function price(at: string, worstCase: boolean) {
  const snapshot = resolveDeepSeekPricingSnapshot({ providerId: 'deepseek', model, timestamp: at, worstCase })
  if (!snapshot) throw new Error(`No verified DeepSeek price for ${model}`)
  return snapshot
}
function usageCost(usage: AgentProviderUsage | undefined, at: string): number | null {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) return null
  const tariff = price(at, false)
  const hit = usage.cacheStatus === 'complete' && Number.isSafeInteger(usage.cacheReadTokens) ? Number(usage.cacheReadTokens) : 0
  const miss = Number(usage.inputTokens) - hit
  return (hit * tariff.cacheHitInputUsdPerMillion + miss * tariff.cacheMissInputUsdPerMillion +
    Number(usage.outputTokens) * tariff.outputUsdPerMillion) / 1_000_000
}
const governance: ModelCallGovernance = {
  async reserve(quote: ModelCallQuote) {
    const tariff = price(quote.createdAt, true)
    const bound = (quote.inputTokens * tariff.cacheMissInputUsdPerMillion + (quote.maxOutputTokens ?? 8_192) * tariff.outputUsdPerMillion) / 1_000_000
    const committed = thisRun.spentUsd + [...outstanding.values()].reduce((sum, value) => sum + value, 0)
    if (committed + bound > capUsd) return { accepted: false, decision: { blocksRun: true, reason: `验证预算不足：已用 ${committed.toFixed(4)} USD，本次上限 ${capUsd.toFixed(4)} USD` } as never }
    outstanding.set(quote.id, bound)
    return { accepted: true, decision: { blocksRun: false, reason: 'within validation budget' } as never }
  },
  async persist() {},
  async pending() { return [] },
  async settle(settlement: ModelCallSettlement) {
    const bound = outstanding.get(settlement.id)
    if (bound === undefined) return
    outstanding.delete(settlement.id)
    const cost = settlement.state === 'not_sent' ? 0 : usageCost(settlement.usage, new Date().toISOString()) ?? bound
    thisRun.spentUsd += cost
    thisRun.calls += 1
    await saveLedger()
  },
}

// ---- Synthetic project in a disposable store; the bank is unpaired and owned by the local principal.
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-memory-live-'))
const store = await createLocalStore({ dbPath: path.join(temp, 'db.sqlite') })
const projectId = 'memory-live-project'
const now = new Date()
const iso = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString()
await store.upsertProject({ id: projectId, name: 'Todo 合成项目', path: temp, packageManager: 'pnpm', testCommand: 'pnpm test:regression', createdAt: iso(-600), updatedAt: iso(-600) })
const owner = await store.resolveLocalProjectMemoryPrincipal(projectId)
if (owner.status !== 'resolved') throw new Error('No local principal')
const config = await store.configureProjectMemory({ projectId, ownerUserId: owner.userId, enabled: true, endpoint, encryptedApiKey: null, providerId: 'deepseek-validation' })
const relayCalls: MemoryRelayCall[] = []
const relay = await createMemoryModelRelay({ port: relayPort, token, governance: async () => governance, onCall: (call) => relayCalls.push(call),
  resolveBank: async (bankId) => bankId === config.bankId ? { projectId, binding: {
    providerId: 'deepseek-validation', modelId: model, baseUrl: 'https://api.deepseek.com', apiKey, fingerprint: 'validation' } } : null })
const client = createHindsightClient({ endpoint, timeoutMs: 15_000 })
const report: Record<string, unknown> = { runId, model, capUsd, priorSpentUsd, bankId: config.bankId, startedAt: new Date().toISOString() }

try {
  // Documents, oldest first. The undo window changes from 5 to 10 seconds in a later conversation.
  const message = (id: string, role: 'user' | 'assistant', text: string, at: string) => ({ id, role, text, createdAt: at })
  const workflow = { title: '删除任务二次确认', request: '给删除任务加二次确认和撤销', nodes: [{ id: 'build', title: '实现', stage: 'build' }] } as never
  const codingRun = (id: string, status: CodingAgentRun['status'], summary: string, startedAt: string, completedAt: string): CodingAgentRun => ({
    id, runId: 'run-1', projectId, nodeId: 'build', requestedBy: owner.userId, providerId: 'deepseek', engine: 'native', status,
    branchName: 'devflow/delete-confirm', userInstruction: '给删除任务加二次确认和撤销', prompt: 'p', summary,
    changedPaths: ['src/tasks/delete.ts', 'src/tasks/delete.test.ts'], startedAt, completedAt, redacted: true })
  const documents = [
    buildConversationMemoryDocument({ id: 'chat-1', localProjectId: projectId, title: '删除确认', status: 'idle', updatedAt: iso(-500), messages: [
      message('u1', 'user', '这个项目删除任务前必须弹出二次确认框，按钮文案用“删除”而不是“确定”。撤销窗口保留 5 秒。以后都用中文回答我。', iso(-500)),
      message('a1', 'assistant', '好的：删除前弹确认框，按钮写“删除”，撤销窗口 5 秒，之后用中文回答。', iso(-499)),
      message('u2', 'user', '跑测试用 pnpm test:regression，不要用 pnpm test，后者会连带跑很慢的 e2e。', iso(-498)),
      message('a2', 'assistant', '明白，回归测试命令是 pnpm test:regression。', iso(-497)),
    ] }, iso(-500)),
    buildCodingRunMemoryDocument({ run: codingRun('coding-1', 'failed', '确认框测试失败：删除后列表没有刷新', iso(-400), iso(-390)), workflow,
      events: [{ id: 'e1', codingRunId: 'coding-1', runId: 'run-1', nodeId: 'build', sequence: 1, kind: 'tool_call', message: 'edit src/tasks/delete.ts', timestamp: iso(-399), redacted: true }],
      testEvidence: [{ id: 't1', runId: 'run-1', projectId, nodeId: 'build', command: 'pnpm test:regression', cwd: temp, status: 'failed', exitCode: 1, durationMs: 1, stdout: '', stderr: '',
        summary: 'delete.test.ts: expected list to refresh after confirm', redacted: true, createdAt: iso(-391) }] }),
    buildCodingRunMemoryDocument({ run: codingRun('coding-2', 'completed', '修复：确认后调用 refreshTasks()，测试通过', iso(-380), iso(-370)), workflow,
      events: [{ id: 'e2', codingRunId: 'coding-2', runId: 'run-1', nodeId: 'build', sequence: 1, kind: 'tool_call', message: 'edit src/tasks/delete.ts: call refreshTasks() after confirm', timestamp: iso(-379), redacted: true }],
      testEvidence: [{ id: 't2', runId: 'run-1', projectId, nodeId: 'build', command: 'pnpm test:regression', cwd: temp, status: 'passed', exitCode: 0, durationMs: 1, stdout: '', stderr: '',
        summary: '42 passed', redacted: true, createdAt: iso(-371) }] }),
    buildArtifactMemoryDocument({ id: 'design-1', runId: 'run-1', nodeId: 'design', kind: 'design', title: '删除确认设计', summary: '', redacted: true, updatedAt: iso(-450),
      content: '## 决定\n- 删除使用 ConfirmDialog 组件，不用浏览器 confirm()，因为后者无法定制文案。\n- 撤销通过 toast 的“撤销”按钮实现。\n- 批量删除暂不支持撤销（非目标）。' } as Artifact,
      { title: '删除任务二次确认', nodes: [{ id: 'design', stage: 'design' }] } as never, true),
    buildConversationMemoryDocument({ id: 'chat-2', localProjectId: projectId, title: '撤销时长调整', status: 'idle', updatedAt: iso(-60), messages: [
      message('u3', 'user', '用户反馈 5 秒太短，撤销窗口改成 10 秒。', iso(-60)),
      message('a3', 'assistant', '已记录：撤销窗口从 5 秒调整为 10 秒。', iso(-59)),
    ] }, iso(-60)),
  ]
  for (const document of documents) {
    if (!document) throw new Error('A synthetic document was not built')
    await store.recordProjectMemoryDocument(config, { ...document, notBefore: new Date().toISOString() })
  }
  const service = new ProjectMemoryService({ store, client: async () => client, canSubmit: () => true })
  const deadline = Date.now() + 15 * 60_000
  for (;;) {
    await service.process(8)
    const rows = await store.listProjectMemoryDocuments(projectId)
    if (rows.every((row) => ['retained', 'failed'].includes(row.status)) || Date.now() > deadline) break
    await delay(5_000)
  }
  report.documents = (await store.listProjectMemoryDocuments(projectId)).map((row) => ({ documentId: row.documentId, status: row.status, attempts: row.attempts, lastError: row.lastError }))
  // Consolidation runs after retain; wait until the bank has no pending work.
  const operations = async (status: string) => {
    const response = await fetch(`${endpoint}/v1/default/banks/${config.bankId}/operations?status=${status}&limit=50`)
    const body = await response.json() as { operations?: unknown[]; items?: unknown[]; total?: number }
    return body.total ?? (body.operations ?? body.items ?? []).length
  }
  let quiet = 0
  for (const startedAt = Date.now(); Date.now() - startedAt < 8 * 60_000 && quiet < 2;) {
    quiet = (await operations('pending')) + (await operations('processing')) === 0 ? quiet + 1 : 0
    await delay(10_000)
  }
  const listed = await (await fetch(`${endpoint}/v1/default/banks/${config.bankId}/memories/list?limit=100`)).json() as { items?: Array<Record<string, unknown>> }
  report.memories = (listed.items ?? []).map((item) => ({ type: item.fact_type ?? item.type, text: item.text, document: item.document_id }))
  const recall = createProjectMemoryRecall({ store, transportAvailable: true, client: async () => client })
  const queries = [
    { query: '删除任务时需要注意什么？', expect: ['确认', '10'] },
    { query: '怎么跑测试？', expect: ['test:regression'] },
    { query: '删除后列表不刷新怎么办？', expect: ['refreshTasks'] },
    { query: '用户希望用什么语言回答？', expect: ['中文'] },
  ]
  report.recall = []
  for (const item of queries) {
    // Judge what each entry point would actually send: the coding (8 items) and discussion (4 items) budgets.
    const result = await recall.recall({ projectId, userId: owner.userId, query: item.query, budget: CODING_MEMORY_RECALL_BUDGET })
    const ranked = result?.items ?? []
    const coding = selectMemoryWithinBudget(ranked, (entry) => entry.statement, CODING_MEMORY_RECALL_BUDGET).map((entry) => entry.statement)
    const discussion = selectMemoryWithinBudget(ranked, (entry) => entry.statement, CONVERSATION_MEMORY_RECALL_BUDGET).map((entry) => entry.statement)
    const found = (texts: string[]) => item.expect.map((term) => texts.some((text) => text.includes(term)))
    ;(report.recall as unknown[]).push({ ...item, degraded: result?.degraded ?? null, returned: ranked.length,
      found: found(coding), foundInDiscussion: found(discussion), coding, discussion })
  }
  report.hindsightLlmStats = await (await fetch(`${endpoint}/v1/default/banks/${config.bankId}/llm-requests/stats`)).json().catch(() => null)
} finally {
  report.relayCalls = relayCalls.map((call) => ({ status: call.status, reason: call.reason, input: call.usage?.inputTokens, output: call.usage?.outputTokens, cacheRead: call.usage?.cacheReadTokens }))
  report.spentUsd = thisRun.spentUsd
  report.unsettledReservationsUsd = [...outstanding.values()].reduce((sum, value) => sum + value, 0)
  report.finishedAt = new Date().toISOString()
  await relay.close()
  if (env.DEVFLOW_MEMORY_LIVE_KEEP_BANK !== '1') report.bankDeleted = (await fetch(`${endpoint}/v1/default/banks/${config.bankId}`, { method: 'DELETE' })).ok
  store.close()
  await rm(temp, { recursive: true, force: true })
  // Conservative: anything still reserved counts as spent.
  thisRun.spentUsd += report.unsettledReservationsUsd as number
  await saveLedger()
  await writeFile(path.join(outDir, runId, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ runId, spentUsd: thisRun.spentUsd, ledgerSpentUsd: priorSpentUsd + thisRun.spentUsd, documents: report.documents,
    memories: (report.memories as unknown[] | undefined)?.length, recall: (report.recall as Array<{ query: string; found: boolean[]; foundInDiscussion: boolean[] }> | undefined)?.map((item) => ({ query: item.query, coding: item.found, discussion: item.foundInDiscussion })) }, null, 2))
}
