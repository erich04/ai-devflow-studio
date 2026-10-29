// Live, budget-capped check of project memory (ADR 0030) on synthetic data, end to end:
// DevFlow's capture builders and outbox send documents to the pinned Hindsight service, Hindsight
// extracts and consolidates through DevFlow's relay with real DeepSeek calls, DevFlow recalls the
// result, Hindsight writes the knowledge pages, and a real discussion follows a remembered preference.
//
// Requires explicit authorization. All spend is admitted against a cumulative ledger in
// out/project-memory-validation/ledger.json; a run never exceeds its own cap or the ledger total.
// The API key comes from the environment only and is never written or logged.
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CODING_MEMORY_RECALL_BUDGET, CONVERSATION_MEMORY_RECALL_BUDGET, PROJECT_KNOWLEDGE_PAGES, createOpenAiCompatibleAgentProvider, governAgentProvider,
  resolveDeepSeekPricingSnapshot, selectMemoryWithinBudget,
  type AgentProviderUsage, type Artifact, type CodingAgentRun, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement,
} from '../packages/shared/src/index.ts'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.js'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createMemoryModelRelay, type MemoryRelayCall } from '../apps/desktop/electron/memory-model-relay.js'
import { registerProjectMemoryRecall } from '../apps/desktop/electron/coding-context.js'
import {
  buildArtifactMemoryDocument, buildCodingRunMemoryDocument, buildConversationMemoryDocument, buildLegacyMemoryDocument,
} from '../apps/desktop/electron/project-memory-capture.js'
import { buildCommitMemoryDocuments } from '../apps/desktop/electron/project-memory-commits.js'
import { createProjectMemoryRecall } from '../apps/desktop/electron/project-memory-recall.js'
import { knowledgePageModelId, ProjectMemoryService } from '../apps/desktop/electron/project-memory-service.js'
import { WorkbenchConversationService } from '../apps/desktop/electron/workbench-conversation-service.js'

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
// The discussion uses the alias that enables DeepSeek's native tools, as the desktop does.
const conversationModel = env.DEVFLOW_MEMORY_LIVE_CONVERSATION_MODEL ?? 'deepseek-flash'
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
const outstanding = new Map<string, { bound: number; model: string }>()
/** Spend per stage of the run, so the report says what each part cost. */
let stage = 'setup'
const stageSpend: Record<string, { usd: number; calls: number }> = {}
function price(callModel: string, at: string, worstCase: boolean) {
  const snapshot = resolveDeepSeekPricingSnapshot({ providerId: 'deepseek', model: callModel, timestamp: at, worstCase })
  if (!snapshot) throw new Error(`No verified DeepSeek price for ${callModel}`)
  return snapshot
}
function usageCost(callModel: string, usage: AgentProviderUsage | undefined, at: string): number | null {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) return null
  const tariff = price(callModel, at, false)
  const hit = usage.cacheStatus === 'complete' && Number.isSafeInteger(usage.cacheReadTokens) ? Number(usage.cacheReadTokens) : 0
  const miss = Number(usage.inputTokens) - hit
  return (hit * tariff.cacheHitInputUsdPerMillion + miss * tariff.cacheMissInputUsdPerMillion +
    Number(usage.outputTokens) * tariff.outputUsdPerMillion) / 1_000_000
}
const governance: ModelCallGovernance = {
  async reserve(quote: ModelCallQuote) {
    const tariff = price(quote.model, quote.createdAt, true)
    const bound = (quote.inputTokens * tariff.cacheMissInputUsdPerMillion + (quote.maxOutputTokens ?? 8_192) * tariff.outputUsdPerMillion) / 1_000_000
    const committed = thisRun.spentUsd + [...outstanding.values()].reduce((sum, value) => sum + value.bound, 0)
    if (committed + bound > capUsd) return { accepted: false, decision: { blocksRun: true, reason: `验证预算不足：已用 ${committed.toFixed(4)} USD，本次上限 ${capUsd.toFixed(4)} USD` } as never }
    outstanding.set(quote.id, { bound, model: quote.model })
    return { accepted: true, decision: { blocksRun: false, reason: 'within validation budget' } as never }
  },
  async persist() {},
  async pending() { return [] },
  async settle(settlement: ModelCallSettlement) {
    const reserved = outstanding.get(settlement.id)
    if (reserved === undefined) return
    outstanding.delete(settlement.id)
    const cost = settlement.state === 'not_sent' ? 0 : usageCost(reserved.model, settlement.usage, new Date().toISOString()) ?? reserved.bound
    thisRun.spentUsd += cost
    thisRun.calls += 1
    const entry = stageSpend[stage] ??= { usd: 0, calls: 0 }
    entry.usd += cost; entry.calls += 1
    await saveLedger()
  },
}

// ---- Synthetic project in a disposable store; the bank is unpaired and owned by the local principal.
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-memory-live-'))
const store = await createLocalStore({ dbPath: path.join(temp, 'db.sqlite') })
const projectId = 'memory-live-project'
const now = new Date()
const iso = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString()
await store.upsertProject({ id: projectId, name: 'Todo 合成项目', path: temp, packageManager: 'pnpm', testCommand: 'pnpm test:regression', createdAt: iso(-800), updatedAt: iso(-800) })
const owner = await store.resolveLocalProjectMemoryPrincipal(projectId)
if (owner.status !== 'resolved') throw new Error('No local principal')
const config = await store.configureProjectMemory({ projectId, ownerUserId: owner.userId, enabled: true, endpoint, encryptedApiKey: null, providerId: 'deepseek-validation' })
const relayCalls: MemoryRelayCall[] = []
const relay = await createMemoryModelRelay({ port: relayPort, token, governance: async () => governance, onCall: (call) => relayCalls.push(call),
  resolveBank: async (bankId) => bankId === config.bankId ? { projectId, binding: {
    providerId: 'deepseek-validation', modelId: model, baseUrl: 'https://api.deepseek.com', apiKey, fingerprint: 'validation' } } : null })
const client = createHindsightClient({ endpoint, timeoutMs: 15_000 })
const report: Record<string, unknown> = { runId, model, conversationModel, capUsd, priorSpentUsd, bankId: config.bankId, startedAt: new Date().toISOString() }
/** Every check of this run, in order; the run passes only if all of them do. */
const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = []
const check = (name: string, passed: boolean, detail?: unknown) => { checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) }) }
const has = (texts: readonly string[], term: string | RegExp) => texts.some((text) => typeof term === 'string' ? text.includes(term) : term.test(text))

try {
  // ---- 1. Documents, oldest first. Two decisions change later: the undo window (5 -> 10 seconds)
  // and the answer language (Chinese -> English).
  stage = 'extraction'
  const message = (id: string, role: 'user' | 'assistant', text: string, at: string) => ({ id, role, text, createdAt: at })
  const workflow = { title: '删除任务二次确认', request: '给删除任务加二次确认和撤销', nodes: [{ id: 'build', title: '实现', stage: 'build' }] } as never
  const codingRun = (id: string, status: CodingAgentRun['status'], summary: string, startedAt: string, completedAt: string): CodingAgentRun => ({
    id, runId: 'run-1', projectId, nodeId: 'build', requestedBy: owner.userId, providerId: 'deepseek', engine: 'native', status,
    branchName: 'devflow/delete-confirm', userInstruction: '给删除任务加二次确认和撤销', prompt: 'p', summary,
    changedPaths: ['src/tasks/delete.ts', 'src/tasks/delete.test.ts'], startedAt, completedAt, redacted: true })
  const documents = [
    buildLegacyMemoryDocument([
      { statement: '构建产物输出到 dist/ 目录，dist/ 不提交到仓库。', createdAt: iso(-780) },
      { statement: 'Verified test command for this project: pnpm test:regression.', createdAt: iso(-770) },
    ]),
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
    ...buildCommitMemoryDocuments([
      { sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', committedAt: iso(-300), subject: 'perf(list): 任务列表改用虚拟滚动',
        body: '超过 500 条任务时滚动明显卡顿，改为只渲染可见区域（react-window）。' },
      { sha: 'b1c2d3e4f5a6b7c8d9e0b1c2d3e4f5a6b7c8d9e0', committedAt: iso(-290), subject: 'fix(tasks): 删除确认后刷新列表',
        body: '确认删除后调用 refreshTasks()，否则列表保留已删除项。' },
    ], iso(0)),
    buildConversationMemoryDocument({ id: 'chat-2', localProjectId: projectId, title: '撤销时长调整', status: 'idle', updatedAt: iso(-60), messages: [
      message('u3', 'user', '用户反馈 5 秒太短，撤销窗口改成 10 秒。', iso(-60)),
      message('a3', 'assistant', '已记录：撤销窗口从 5 秒调整为 10 秒。', iso(-59)),
    ] }, iso(-60)),
    buildConversationMemoryDocument({ id: 'chat-3', localProjectId: projectId, title: '回答语言', status: 'idle', updatedAt: iso(-30), messages: [
      message('u4', 'user', '从现在起请用英文回答我，代码注释也写英文。之前说的用中文回答作废。', iso(-30)),
      message('a4', 'assistant', 'Understood. From now on I will answer in English and write code comments in English.', iso(-29)),
    ] }, iso(-30)),
  ]
  for (const document of documents) {
    if (!document) throw new Error('A synthetic document was not built')
    await store.recordProjectMemoryDocument(config, { ...document, notBefore: new Date().toISOString() })
  }
  // The worker also creates the knowledge pages; the bank is empty then, so that costs nothing.
  const service = new ProjectMemoryService({ store, client: async () => client, canSubmit: () => true })
  const deadline = Date.now() + 15 * 60_000
  for (;;) {
    await service.process(8)
    const rows = await store.listProjectMemoryDocuments(projectId)
    if (rows.every((row) => ['retained', 'failed'].includes(row.status)) || Date.now() > deadline) break
    await delay(5_000)
  }
  const rows = await store.listProjectMemoryDocuments(projectId)
  report.documents = rows.map((row) => ({ documentId: row.documentId, sourceKind: row.sourceKind, status: row.status, attempts: row.attempts, lastError: row.lastError }))
  check('every document retained', rows.every((row) => row.status === 'retained'), report.documents)
  // Consolidation runs after retain; wait until the bank has no pending work.
  const operations = async (status: string) => {
    const response = await fetch(`${endpoint}/v1/default/banks/${config.bankId}/operations?status=${status}&limit=50`)
    const body = await response.json() as { operations?: unknown[]; items?: unknown[]; total?: number }
    return body.total ?? (body.operations ?? body.items ?? []).length
  }
  const settle = async (maxMs: number) => {
    let quiet = 0
    for (const startedAt = Date.now(); Date.now() - startedAt < maxMs && quiet < 2;) {
      quiet = (await operations('pending')) + (await operations('processing')) === 0 ? quiet + 1 : 0
      await delay(10_000)
    }
  }
  await settle(8 * 60_000)
  const listed = await (await fetch(`${endpoint}/v1/default/banks/${config.bankId}/memories/list?limit=100`)).json() as { items?: Array<Record<string, unknown>> }
  report.memories = (listed.items ?? []).map((item) => ({ type: item.fact_type ?? item.type, text: item.text, document: item.document_id }))

  // ---- 2. Recall, judged on what each entry point would actually send.
  stage = 'recall'
  const recall = createProjectMemoryRecall({ store, transportAvailable: true, client: async () => client })
  const queries: Array<{ query: string; expect: Array<string | RegExp> }> = [
    { query: '删除任务时需要注意什么？', expect: ['确认', '10'] },
    { query: '怎么跑测试？', expect: ['test:regression'] },
    { query: '删除后列表不刷新怎么办？', expect: ['refreshTasks'] },
    { query: '用户希望用什么语言回答？', expect: [/英文|English/iu] },
    { query: '构建产物放在哪里，要不要提交？', expect: ['dist'] },
    { query: '任务列表为什么改用虚拟滚动？', expect: ['500'] },
  ]
  report.recall = []
  for (const item of queries) {
    const result = await recall.recall({ projectId, userId: owner.userId, query: item.query, budget: CODING_MEMORY_RECALL_BUDGET })
    const ranked = result?.items ?? []
    const coding = selectMemoryWithinBudget(ranked, (entry) => entry.statement, CODING_MEMORY_RECALL_BUDGET).map((entry) => entry.statement)
    const discussion = selectMemoryWithinBudget(ranked, (entry) => entry.statement, CONVERSATION_MEMORY_RECALL_BUDGET).map((entry) => entry.statement)
    const found = item.expect.map((term) => has(coding, term))
    const foundInDiscussion = item.expect.map((term) => has(discussion, term))
    ;(report.recall as unknown[]).push({ query: item.query, expect: item.expect.map(String), degraded: result?.degraded ?? null, returned: ranked.length,
      found, foundInDiscussion, coding, discussion })
    check(`recall: ${item.query}`, found.every(Boolean) && foundInDiscussion.every(Boolean), { found, foundInDiscussion })
  }

  // ---- 3. Knowledge pages, written by the product path: the worker asks Hindsight to write each
  // empty page once memory exists; nothing here refreshes a page directly.
  stage = 'pages'
  const read = async () => new Map((await client.listMentalModels(config.bankId)).map((page) => [page.id, page]))
  let pages = await read()
  const before = new Map([...pages].map(([id, page]) => [id, page.content.trim().length > 0]))
  await service.process(1)
  for (const startedAt = Date.now(); Date.now() - startedAt < 8 * 60_000;) {
    pages = await read()
    if (PROJECT_KNOWLEDGE_PAGES.every((page) => pages.get(knowledgePageModelId(page.id))?.content.trim() || pages.get(knowledgePageModelId(page.id))?.failedAt)) break
    await delay(15_000)
    await service.process(1)
  }
  const expected: Record<string, RegExp> = { conventions: /test:regression/u, decisions: /ConfirmDialog|10\s*秒|10 seconds/iu,
    pitfalls: /refreshTasks/u, preferences: /英文|English/iu }
  report.pages = PROJECT_KNOWLEDGE_PAGES.map((page) => {
    const value = pages.get(knowledgePageModelId(page.id))
    const content = value?.content ?? ''
    check(`page: ${page.title}`, expected[page.id]!.test(content), { chars: content.length, failedAt: value?.failedAt })
    return { id: page.id, title: page.title, writtenBeforeWorker: before.get(knowledgePageModelId(page.id)) ?? false, refreshedAt: value?.refreshedAt,
      failedAt: value?.failedAt, chars: content.length, content: content.slice(0, 1_500) }
  })

  // ---- 4. A real discussion. The question is in Chinese; the remembered, newer preference is English.
  stage = 'discussion'
  registerProjectMemoryRecall(store, recall)
  const provider = governAgentProvider(createOpenAiCompatibleAgentProvider({ id: 'deepseek-validation', name: 'DeepSeek validation',
    model: conversationModel, apiKey, baseUrl: 'https://api.deepseek.com', thinking: { mode: 'enabled', effort: 'low' }, structuredRequestTimeoutMs: 120_000 }),
  projectId, governance)
  const knowledge = async () => ({ projectId, indexedAt: new Date().toISOString(), contentHash: 'fixture', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [] })
  const english = (text: string) => {
    const latin = (text.match(/[A-Za-z]/gu) ?? []).length
    const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length
    return latin > 40 && cjk <= latin / 10
  }
  report.discussions = []
  for (const native of [true, false]) {
    const conversations = new WorkbenchConversationService({ store, memory: store, nativeConversationsEnabled: native,
      resolveProvider: async () => provider, changed() {}, loadKnowledge: knowledge })
    const id = (await conversations.command({ type: 'create', projectId })).conversationId!
    await conversations.command({ type: 'send', projectId, conversationId: id, providerId: provider.id, text: '用两句话解释什么是回归测试，不要调用工具。' })
    await conversations.settled(id)
    const session = (await store.listWorkbenchConversations(projectId)).find((item) => item.id === id)!
    const answer = session.messages.filter((item) => item.role === 'assistant').at(-1)?.text ?? ''
    const memories = session.contextReceipt?.memory?.memories ?? []
    ;(report.discussions as unknown[]).push({ protocol: native ? 'native-v2' : 'structured', status: session.status, error: session.error,
      memoriesSent: memories.length, answer: answer.slice(0, 600) })
    check(`discussion (${native ? 'native v2' : 'structured'}) answers in English from memory`, session.status === 'idle' && memories.length > 0 && english(answer),
      { status: session.status, memoriesSent: memories.length })
  }
  report.hindsightLlmStats = await (await fetch(`${endpoint}/v1/default/banks/${config.bankId}/llm-requests/stats`)).json().catch(() => null)
} finally {
  report.checks = checks
  report.passed = checks.length > 0 && checks.every((item) => item.passed)
  report.stageSpend = stageSpend
  report.relayCalls = relayCalls.map((call) => ({ status: call.status, reason: call.reason, input: call.usage?.inputTokens, output: call.usage?.outputTokens, cacheRead: call.usage?.cacheReadTokens }))
  report.spentUsd = thisRun.spentUsd
  report.unsettledReservationsUsd = [...outstanding.values()].reduce((sum, value) => sum + value.bound, 0)
  report.finishedAt = new Date().toISOString()
  await relay.close()
  if (env.DEVFLOW_MEMORY_LIVE_KEEP_BANK !== '1') report.bankDeleted = (await fetch(`${endpoint}/v1/default/banks/${config.bankId}`, { method: 'DELETE' })).ok
  store.close()
  await rm(temp, { recursive: true, force: true })
  // Conservative: anything still reserved counts as spent.
  thisRun.spentUsd += report.unsettledReservationsUsd as number
  await saveLedger()
  await writeFile(path.join(outDir, runId, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ runId, passed: report.passed, spentUsd: thisRun.spentUsd, ledgerSpentUsd: priorSpentUsd + thisRun.spentUsd,
    stageSpend, failed: checks.filter((item) => !item.passed) }, null, 2))
}
