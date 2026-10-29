// Larger, budget-capped live validation of project memory (ADR 0030) on a synthetic project:
// about fifty captured documents (a real Git history included), Hindsight extraction and
// consolidation through DevFlow's relay with real DeepSeek calls, recall at every entry point
// (coding brief and a real Native v2 coding run, stage Agent, Gate review, both discussion
// protocols and memory_search), conversation compaction forced by a smaller input limit,
// automatic capture of the new work, and edit / forget / forget source / clear.
//
// Phases: seed, consolidate, recall, pages, agents, capture, lifecycle, clear. A later phase can be re-run
// against the same work directory and bank (DEVFLOW_MEMORY_FULL_RESUME + _FROM), so a failure
// late in the run does not pay for extraction again. All spend is admitted against its own
// cumulative ledger; the API key comes from the environment only and is never written or logged.
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AgentProviderRequestError, CODING_MEMORY_RECALL_BUDGET, CONVERSATION_MEMORY_RECALL_BUDGET, PROJECT_KNOWLEDGE_PAGES,
  PROJECT_MEMORY_MAX_DOCUMENT_BYTES, PROJECT_MEMORY_MISSIONS, STAGE_AGENT_MEMORY_RECALL_BUDGET, advanceWorkflowAfterGateApproval, approveClarificationRevision,
  buildCodingBrief, completeWorkflowAgentNode, createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest, governAgentProvider,
  redactSensitiveText, resolveDeepSeekPricingSnapshot, runWorkflowStageAgent, selectMemoryWithinBudget,
  type AgentProvider, type AgentProviderUsage, type Artifact, type LocalProject, type MemoryRecallBudget, type ModelCallGovernance,
  type ModelCallQuote, type ModelCallSettlement, type NativeConversationRequest, type ProjectMemoryConfiguration, type ProjectMemoryDocumentInput,
  type WorkflowRun,
} from '../packages/shared/src/index.ts'
import { assertCodingContextCurrent, recallCodingMemory, recallScopedMemory, registerProjectMemoryRecall } from '../apps/desktop/electron/coding-context.js'
import { createCodingRuntime } from '../apps/desktop/electron/coding-runtime.js'
import { CODING_BRIEF_MAX_BYTES } from '../apps/desktop/electron/coding-runtime-configuration.js'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.js'
import { createKnowledgeReviewRuntime } from '../apps/desktop/electron/knowledge-review-runtime.js'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createMemoryModelRelay, type MemoryRelayCall } from '../apps/desktop/electron/memory-model-relay.js'
import { createAgentProviderNativeCodingV2DecisionProvider, createNativeCodingExecutorV2 } from '../apps/desktop/electron/native-coding-executor-v2.js'
import {
  LEGACY_MEMORY_DOCUMENT_ID, buildArtifactMemoryDocument, buildCodingRunMemoryDocument, buildConversationMemoryDocument, buildLegacyMemoryDocument,
  migrateLegacyProjectMemory,
} from '../apps/desktop/electron/project-memory-capture.js'
import { COMMIT_MEMORY_DAYS, COMMIT_MEMORY_SETTLE_MS, buildCommitMemoryDocuments, captureCommitProjectMemory, readRecentCommits } from '../apps/desktop/electron/project-memory-commits.js'
import { createProjectMemoryRecall, type ProjectMemoryRecallItem } from '../apps/desktop/electron/project-memory-recall.js'
import { clearKnowledgePages, knowledgePageModelId, ProjectMemoryService } from '../apps/desktop/electron/project-memory-service.js'
import { runLocalTestCommand } from '../apps/desktop/electron/test-runner.js'
import { WorkbenchConversationService } from '../apps/desktop/electron/workbench-conversation-service.js'
import type { WorkbenchConversation } from '../apps/desktop/electron/workbench-conversation-contract.js'
import {
  DAY_MS, LATE_DECISIONS, MARKERS, PAGE_EXPECTATIONS, RECALL_QUERIES, ciLog, timeline, todayCommits, type LatestValue,
} from './project-memory-full-fixtures.mts'

const exec = promisify(execFile)
const env = process.env
if (env.DEVFLOW_MEMORY_LIVE_AUTHORIZED !== '1') throw new Error('Set DEVFLOW_MEMORY_LIVE_AUTHORIZED=1 only after the provider, model and budget are approved.')
const apiKey = env.DEEPSEEK_API_KEY?.trim()
const token = env.DEVFLOW_MEMORY_RELAY_TOKEN?.trim()
if (!apiKey || !token) throw new Error('DEEPSEEK_API_KEY and DEVFLOW_MEMORY_RELAY_TOKEN are required.')
const LEDGER_CAP_USD = Number(env.DEVFLOW_MEMORY_FULL_LEDGER_CAP_USD ?? '2')
const runCapUsd = Number(env.DEVFLOW_MEMORY_LIVE_MAX_USD ?? '1.2')
if (!Number.isFinite(LEDGER_CAP_USD) || LEDGER_CAP_USD <= 0) throw new Error('Invalid DEVFLOW_MEMORY_FULL_LEDGER_CAP_USD')
if (!Number.isFinite(runCapUsd) || runCapUsd <= 0 || runCapUsd > LEDGER_CAP_USD) throw new Error('Invalid DEVFLOW_MEMORY_LIVE_MAX_USD')
const relayPort = Number(env.DEVFLOW_MEMORY_RELAY_PORT ?? '8899')
const endpoint = env.HINDSIGHT_ENDPOINT ?? 'http://127.0.0.1:8890'
const model = env.DEVFLOW_MEMORY_LIVE_MODEL ?? 'deepseek-v4-flash'
// Agents use the alias that enables DeepSeek's native tools and Native v2, as the desktop does.
const agentModel = env.DEVFLOW_MEMORY_LIVE_CONVERSATION_MODEL ?? 'deepseek-flash'
const PHASES = ['seed', 'consolidate', 'recall', 'pages', 'agents', 'review', 'capture', 'lifecycle', 'clear'] as const
type Phase = typeof PHASES[number]
const phaseOf = (value: string | undefined, fallback: Phase): Phase => {
  const phase = (value ?? fallback) as Phase
  if (!PHASES.includes(phase)) throw new Error(`Unknown phase ${value}`)
  return phase
}
const fromPhase = phaseOf(env.DEVFLOW_MEMORY_FULL_FROM, 'seed')
const toPhase = phaseOf(env.DEVFLOW_MEMORY_FULL_TO, 'clear')
if (PHASES.indexOf(fromPhase) > PHASES.indexOf(toPhase)) throw new Error('DEVFLOW_MEMORY_FULL_FROM comes after _TO')
if (fromPhase !== 'seed' && !env.DEVFLOW_MEMORY_FULL_RESUME) throw new Error('A later phase needs DEVFLOW_MEMORY_FULL_RESUME=<work directory>')
const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'out/project-memory-validation')
const runId = `full-${new Date().toISOString().replace(/[:.]/gu, '-')}`
const workdir = env.DEVFLOW_MEMORY_FULL_RESUME ? path.resolve(env.DEVFLOW_MEMORY_FULL_RESUME) : path.join(outDir, runId)
await mkdir(workdir, { recursive: true })
const log = (message: string, detail?: unknown) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${phase}: ${message}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)

// ---- Ledger: its own cap; reservations are worst case and unknown outcomes keep them.
type Ledger = { capUsd: number; runs: Array<{ id: string; at: string; spentUsd: number; calls: number; model: string; phases: string }> }
const ledgerPath = path.resolve(env.DEVFLOW_MEMORY_FULL_LEDGER ?? path.join(outDir, 'ledger-full.json'))
const ledger: Ledger = await readFile(ledgerPath, 'utf8').then((text) => JSON.parse(text) as Ledger, () => ({ capUsd: LEDGER_CAP_USD, runs: [] }))
if (ledger.capUsd !== LEDGER_CAP_USD) throw new Error('Ledger cap differs from the authorized total')
const priorSpentUsd = ledger.runs.reduce((sum, run) => sum + run.spentUsd, 0)
const capUsd = Math.min(runCapUsd, LEDGER_CAP_USD - priorSpentUsd)
if (capUsd <= 0.05) throw new Error(`Authorized budget exhausted: ${priorSpentUsd.toFixed(4)} of ${LEDGER_CAP_USD} USD spent`)
const thisRun = { id: runId, at: new Date().toISOString(), spentUsd: 0, calls: 0, model, phases: `${fromPhase}..${toPhase}` }
ledger.runs.push(thisRun)
async function saveJson(file: string, value: unknown) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}
await mkdir(path.dirname(ledgerPath), { recursive: true })
await saveJson(ledgerPath, ledger)
const outstanding = new Map<string, { bound: number; model: string }>()
let phase: Phase = fromPhase
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
    // Hindsight's calls come through the relay with the memory model; agent calls use the agent model.
    const entry = stageSpend[`${stage}:${reserved.model === agentModel && agentModel !== model ? 'agent' : 'hindsight'}`] ??= { usd: 0, calls: 0 }
    entry.usd += cost; entry.calls += 1
    await saveJson(ledgerPath, ledger)
  },
}

// ---- Work directory: state for later phases and a report merged across runs.
type State = {
  version: 1; createdBy: string; baseTime: string; projectId: string; ownerUserId: string; repo: string; dbPath: string; initialBankId: string
  codingRunId?: string; codingWorkflowId?: string; stageRunId?: string; gateNodeId?: string; clarificationId?: string; reviewArtifactId?: string
  discussions?: Record<string, string>; lastSeedRetainedAt?: string
}
type Check = { phase: Phase; step?: string; name: string; passed: boolean; detail?: unknown }
type Report = { runs: string[]; workdir: string; model: string; agentModel: string; phases: Partial<Record<Phase, Record<string, unknown>>>
  checks: Check[]; observations: Array<{ phase: Phase; name: string; value: unknown }>; timings: Array<{ phase: Phase; step: string; ms: number }> }
const statePath = path.join(workdir, 'state.json')
const reportPath = path.join(workdir, 'report.json')
let state = await readFile(statePath, 'utf8').then((text) => JSON.parse(text) as State, () => null)
const report: Report = await readFile(reportPath, 'utf8').then((text) => JSON.parse(text) as Report,
  () => ({ runs: [], workdir, model, agentModel, phases: {}, checks: [], observations: [], timings: [] }))
report.runs.push(runId)
// Re-running a phase replaces its earlier results.
const rerun = new Set(PHASES.slice(PHASES.indexOf(fromPhase)))
report.checks = report.checks.filter((item) => !rerun.has(item.phase))
report.observations = report.observations.filter((item) => !rerun.has(item.phase))
report.timings = report.timings.filter((item) => !rerun.has(item.phase))
const section = (name: Phase) => (report.phases[name] ??= {})
let currentStep: string | undefined
const check = (name: string, passed: boolean, detail?: unknown) => {
  report.checks.push({ phase, ...(currentStep ? { step: currentStep } : {}), name, passed, ...(detail === undefined ? {} : { detail }) })
  log(`${passed ? 'PASS' : 'FAIL'} ${name}`)
}
const observe = (name: string, value: unknown) => { report.observations.push({ phase, name, value }) }
const describe = (error: unknown) => error instanceof AgentProviderRequestError
  ? { code: error.code, cause: error.sanitizedCause, message: redactSensitiveText(error.message).value.slice(0, 300) }
  : { message: redactSensitiveText(error instanceof Error ? error.message : String(error)).value.slice(0, 500) }
async function step<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  const started = Date.now()
  stage = `${phase}:${name}`
  currentStep = name
  try { return await run() }
  catch (error) { check(`${name}: completed without error`, false, describe(error)); return undefined }
  finally { currentStep = undefined; report.timings.push({ phase, step: name, ms: Date.now() - started }); await saveJson(reportPath, report) }
}
const has = (texts: readonly string[], term: string | RegExp) => texts.some((text) => typeof term === 'string' ? text.includes(term) : term.test(text))
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
/** Among the statements about `topic`, the first that names any of `values` names the newest one. */
function latestFirst(statements: readonly string[], latest: LatestValue) {
  const names = (text: string, value: string) => new RegExp(`(?<![0-9.])${value}(?![0-9])`, 'u').test(text)
  const first = statements.find((text) => latest.topic.test(text) && latest.values.some((value) => names(text, value)))
  return { passed: first !== undefined && names(first, latest.value), first: first?.slice(0, 200) }
}

// ---- Hindsight's own API for measurements; reading never makes a model call.
type MemoryUnit = { id: string; text: string; fact_type?: string | null; document_id?: string | null; proof_count?: number
  source_memory_ids?: string[] | null; state?: string; consolidated_at?: string | null; edited_at?: string | null; date?: string; tags?: string[] }
type BankStats = { total_nodes?: number; total_documents?: number; total_links?: number; nodes_by_fact_type?: Record<string, number>
  pending_operations?: number; failed_operations?: number; operations_by_status?: Record<string, number>; last_consolidated_at?: string | null
  pending_consolidation?: number; failed_consolidation?: number; total_observations?: number }
async function hindsight<T>(method: 'GET' | 'DELETE', pathname: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${endpoint}${pathname}`, { method, signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  try { return { status: response.status, body: text ? JSON.parse(text) as T : null } } catch { return { status: response.status, body: null } }
}
const bankPath = (bankId: string) => `/v1/default/banks/${encodeURIComponent(bankId)}`
const bankStats = async (bankId: string) => hindsight<BankStats>('GET', `${bankPath(bankId)}/stats?refresh=true`)
async function listUnits(bankId: string, type: 'world' | 'experience' | 'observation', extra: Record<string, string> = {}): Promise<MemoryUnit[]> {
  const items: MemoryUnit[] = []
  for (let offset = 0; offset < 10_000; offset += 200) {
    const query = new URLSearchParams({ type, state: 'valid', limit: '200', offset: String(offset), ...extra })
    const page = (await hindsight<{ items?: MemoryUnit[]; total?: number }>('GET', `${bankPath(bankId)}/memories/list?${query}`)).body
    const batch = page?.items ?? []
    items.push(...batch)
    if (batch.length < 200) break
  }
  return items
}
const allUnits = async (bankId: string) => [
  ...await listUnits(bankId, 'world'), ...await listUnits(bankId, 'experience'), ...await listUnits(bankId, 'observation')]
type Operation = { id: string; operation_type?: string; status?: string; mental_model_id?: string | null; next_retry_at?: string | null; created_at?: string }
async function operations(bankId: string, status: 'pending' | 'processing'): Promise<Operation[]> {
  return (await hindsight<{ operations?: Operation[] }>('GET', `${bankPath(bankId)}/operations?status=${status}&limit=100`)).body?.operations ?? []
}
/**
 * Waits until Hindsight has no queued or running work for the bank, twice in a row. A page
 * refresh Hindsight scheduled for later (its six-hour minimum interval) is not work now.
 */
async function settleBank(bankId: string, maxMs: number) {
  let quiet = 0
  const started = Date.now()
  for (let last = 0; Date.now() - started < maxMs;) {
    const pending = await operations(bankId, 'pending')
    const running = await operations(bankId, 'processing')
    const scheduled = pending.filter((item) => item.next_retry_at && Date.parse(item.next_retry_at) > Date.now() + 60_000)
    const busy = running.length + pending.length - scheduled.length
    const value = (await bankStats(bankId)).body
    quiet = busy === 0 && (value?.pending_consolidation ?? 0) === 0 ? quiet + 1 : 0
    if (quiet >= 2) {
      return { settled: true, ms: Date.now() - started, scheduledLater: scheduled.map((item) => ({ type: item.operation_type, page: item.mental_model_id, at: item.next_retry_at })) }
    }
    if (Date.now() - last > 60_000) {
      last = Date.now()
      log('waiting for Hindsight', { busy, scheduled: scheduled.length, consolidation: value?.pending_consolidation, spentUsd: +thisRun.spentUsd.toFixed(4) })
    }
    await delay(15_000)
  }
  return { settled: false, ms: Date.now() - started, scheduledLater: [] }
}

// ---- One disposable project, store and bank. The project's memory belongs to its local principal.
const store = await createLocalStore({ dbPath: path.join(workdir, 'devflow.sqlite') })
// The desktop's own request timeouts, so a slow Hindsight degrades recall here as it would there.
const client = createHindsightClient({ endpoint })
const relayCalls: MemoryRelayCall[] = []
const relay = await createMemoryModelRelay({ port: relayPort, token, governance: async () => governance, onCall: (call) => relayCalls.push(call),
  resolveBank: async (bankId) => state && (await store.listProjectMemoryConfigurations()).some((item) => item.bankId === bankId)
    ? { projectId: state.projectId, binding: { providerId: 'deepseek-validation', modelId: model, baseUrl: 'https://api.deepseek.com', apiKey, fingerprint: 'validation' } }
    : null })
const service = new ProjectMemoryService({ store, client: async () => client, canSubmit: () => true })
const recall = createProjectMemoryRecall({ store, transportAvailable: true, client: async () => client })
registerProjectMemoryRecall(store, recall)
const baseProvider = createOpenAiCompatibleAgentProvider({ id: 'deepseek-validation', name: 'DeepSeek validation', model: agentModel, apiKey,
  baseUrl: 'https://api.deepseek.com', thinking: { mode: 'enabled', effort: 'low' }, structuredRequestTimeoutMs: 180_000 })
let provider: AgentProvider = baseProvider
const projectId = state?.projectId ?? 'memory-full-project'
let project: LocalProject | undefined
const config = async (): Promise<ProjectMemoryConfiguration> => {
  const value = await store.getProjectMemoryConfiguration(projectId)
  if (!value) throw new Error('Project memory is not configured')
  return value
}
const owner = () => { if (!state) throw new Error('Missing state'); return state.ownerUserId }
const bankDocuments = async () => { const bankId = (await config()).bankId; return (await store.listProjectMemoryDocuments(projectId)).filter((row) => row.bankId === bankId) }
const statusCounts = (rows: Array<{ status: string }>) => rows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {})
let lastCommitScan = 0
/** One background cycle as the desktop runs it every 15 seconds: the commit scan (every ten minutes), then the worker. */
async function cycle() {
  if (project && Date.now() - lastCommitScan >= 10 * 60_000) {
    lastCommitScan = Date.now()
    await captureCommitProjectMemory(store, project).catch(() => undefined)
  }
  await service.process(4)
}
async function runWorker(label: string, done: () => Promise<boolean>, maxMs: number) {
  const started = Date.now()
  for (let last = 0; ;) {
    await cycle()
    if (await done()) return { done: true, ms: Date.now() - started }
    if (Date.now() - started > maxMs) return { done: false, ms: Date.now() - started }
    if (Date.now() - last > 60_000) {
      last = Date.now()
      log(`${label}: waiting`, { documents: statusCounts(await bankDocuments()), spentUsd: +thisRun.spentUsd.toFixed(4) })
    }
    await delay(15_000)
  }
}
const pages = async (bankId?: string) => new Map((await client.listMentalModels(bankId ?? (await config()).bankId)).map((page) => [page.id, page]))
const pageText = (all: Map<string, { content: string }>) => PROJECT_KNOWLEDGE_PAGES.map((page) => all.get(knowledgePageModelId(page.id))?.content ?? '').join('\n')
async function recallSelection(query: string, budget: MemoryRecallBudget) {
  const started = performance.now()
  const result = await recall.recall({ projectId, userId: owner(), query, budget })
  const ms = Math.round(performance.now() - started)
  const items = result?.items ?? []
  return { ms, degraded: result?.degraded ?? null, items, selected: selectMemoryWithinBudget(items, (item) => item.statement, budget) }
}
const knowledge = async () => ({ projectId, indexedAt: new Date().toISOString(), contentHash: 'fixture', truncated: false, warnings: [],
  documents: [], entities: [], relations: [], chunks: [] })
const git = (repo: string, args: string[], date?: string) => exec('git', ['-C', repo, ...args], {
  env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })

// ======================= Phase 1: seed =======================
async function seedPhase() {
  const now = new Date()
  const repo = path.join(workdir, 'repo')
  await rm(repo, { recursive: true, force: true })
  await mkdir(path.join(repo, 'src'), { recursive: true })
  await mkdir(path.join(repo, 'test'), { recursive: true })
  // `node --test test/` loads the directory as a module on Node 24; let it find the tests itself.
  await writeFile(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'todo-synthetic', version: '1.0.0', private: true, type: 'module',
    scripts: { test: 'node --test' } }, null, 2)}\n`)
  await writeFile(path.join(repo, 'README.md'), '# Todo（合成项目）\n\n一个用来验证 DevFlow 项目记忆的小型待办应用。\n')
  await writeFile(path.join(repo, 'src/archive.js'), '// Undo support for archived tasks.\n// TODO: use the same undo window as deleting a task.\nexport const ARCHIVE_UNDO_WINDOW_MS = 0\n\n' +
    'export function canUndoArchive(archivedAt, now = Date.now()) {\n  return now - archivedAt < ARCHIVE_UNDO_WINDOW_MS\n}\n')
  await writeFile(path.join(repo, 'test/archive.test.js'), "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n" +
    "import { ARCHIVE_UNDO_WINDOW_MS } from '../src/archive.js'\n\ntest('the archive undo window is a whole number of seconds', () => {\n" +
    '  assert.ok(Number.isInteger(ARCHIVE_UNDO_WINDOW_MS) && ARCHIVE_UNDO_WINDOW_MS >= 1000 && ARCHIVE_UNDO_WINDOW_MS % 1000 === 0)\n})\n')
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'Synthetic Dev'])
  await git(repo, ['config', 'user.email', 'dev@example.invalid'])
  const fixture = timeline(now, projectId, 'pending-owner', repo)
  // Real history, oldest first: one feature branch merged with --no-ff, and two commits today.
  const specs: Array<{ subject: string; body?: string; branch?: string; at: Date }> = [
    ...fixture.commits.map((spec) => ({ ...spec, at: new Date(now.getTime() - spec.daysAgo * DAY_MS + spec.minutes * 60_000 - 12 * 3_600_000) })),
    ...todayCommits().map((spec) => ({ subject: spec.subject, at: new Date(now.getTime() - spec.minutesAgo * 60_000) }))]
    .sort((left, right) => left.at.getTime() - right.at.getTime())
  let counter = 0
  let onBranch: string | undefined
  for (const spec of specs) {
    const branch = spec.branch
    if (branch && onBranch !== branch) { await git(repo, ['checkout', '-q', '-b', branch]); onBranch = branch }
    if (!branch && onBranch) {
      await git(repo, ['checkout', '-q', 'main'])
      const mergeAt = new Date(spec.at.getTime() - 60_000).toISOString()
      await git(repo, ['merge', '-q', '--no-ff', onBranch, '-m', `Merge branch '${onBranch}' ${MARKERS.mergeCommit}`], mergeAt)
      onBranch = undefined
    }
    await writeFile(path.join(repo, 'HISTORY.txt'), `commit ${++counter}\n`, { flag: 'a' })
    await git(repo, ['add', '-A'])
    const body = spec.body ? ['-m', spec.body] : []
    await git(repo, ['commit', '-q', '-m', spec.subject, ...body], spec.at.toISOString())
  }
  project = { id: projectId, name: 'Todo 合成项目', path: repo, packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test',
    createdAt: now.toISOString(), updatedAt: now.toISOString() }
  await store.upsertProject(project)
  const principal = await store.resolveLocalProjectMemoryPrincipal(projectId)
  if (principal.status !== 'resolved') throw new Error('No local principal')
  const initial = await store.configureProjectMemory({ projectId, ownerUserId: principal.userId, enabled: true, endpoint, encryptedApiKey: null, providerId: 'deepseek-validation' })
  state = { version: 1, createdBy: runId, baseTime: now.toISOString(), projectId, ownerUserId: principal.userId, repo, dbPath: path.join(workdir, 'devflow.sqlite'), initialBankId: initial.bankId }
  await saveJson(statePath, state)
  const data = timeline(now, projectId, principal.userId, repo)

  // Every source through its capture builder, then recorded oldest first.
  const built: Array<{ input: ProjectMemoryDocumentInput; label: string }> = []
  const legacy = buildLegacyMemoryDocument(data.legacy)
  if (legacy) built.push({ input: legacy, label: 'legacy' })
  for (const conversation of [...data.conversations, { ...data.longConversation, daysAgo: 5 }]) {
    const document = buildConversationMemoryDocument({ id: conversation.id, localProjectId: projectId, title: conversation.title, status: 'idle',
      updatedAt: conversation.messages.at(-1)!.createdAt, messages: conversation.messages }, now.toISOString())
    if (document) built.push({ input: document, label: conversation.id })
  }
  for (const run of data.codingRuns) {
    const document = buildCodingRunMemoryDocument({ run: run.run, workflow: run.workflow as never, events: run.events, testEvidence: run.testEvidence })
    if (document) built.push({ input: document, label: run.run.id })
  }
  for (const item of data.artifacts) {
    const document = buildArtifactMemoryDocument(item.artifact, item.run as never, item.approved)
    if (document) built.push({ input: document, label: item.artifact.id })
  }
  const since = new Date(now.getTime() - COMMIT_MEMORY_DAYS * DAY_MS).toISOString()
  const commitDocuments = buildCommitMemoryDocuments(await readRecentCommits(repo, since), now.toISOString())
  for (const document of commitDocuments) built.push({ input: document, label: document.documentId })
  const sources = data.conversations.length + 1 + data.codingRuns.length + data.artifacts.length + 1
  check('every synthetic source produced a document', built.length === sources + commitDocuments.length, { built: built.length, sources, commitDays: commitDocuments.length })
  await saveJson(reportPath, report)

  // Deterministic capture checks: trimming and commit selection.
  const longDocument = built.find((item) => item.label === data.longConversation.id)!.input
  const kept = (JSON.parse(longDocument.payload) as unknown[]).length
  check('long discussion is trimmed to the document limit, oldest messages first', bytes(longDocument.payload) <= PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 2_048 &&
    !longDocument.payload.includes(MARKERS.oldestLongChat) && longDocument.payload.includes(MARKERS.newestLongChat) && kept < data.longConversation.messages.length,
  { payloadBytes: bytes(longDocument.payload), sourceBytes: bytes(JSON.stringify(data.longConversation.messages)), keptMessages: kept, totalMessages: data.longConversation.messages.length })
  const longRun = built.find((item) => item.label === 'cr-long-activity')!.input
  check('long coding run keeps its latest activity and marks the omission', longRun.payload.includes('[earlier activity omitted]') &&
    longRun.payload.includes(MARKERS.lateEvent) && !longRun.payload.includes(MARKERS.earlyEvent) && bytes(longRun.payload) <= PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024,
  { payloadBytes: bytes(longRun.payload) })
  const manyLegacy = buildLegacyMemoryDocument(Array.from({ length: 3_000 }, (_, index) => ({ statement: `历史条目 ${index}：${'细节'.repeat(20)}`, createdAt: new Date(now.getTime() - index * 60_000).toISOString() })))
  check('a large legacy Memory keeps the newest statements and counts the omitted ones', Boolean(manyLegacy && bytes(manyLegacy.payload) <= PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024 &&
    manyLegacy.payload.includes('历史条目 0：') && /older statements omitted/u.test(manyLegacy.payload)), { payloadBytes: manyLegacy ? bytes(manyLegacy.payload) : 0 })
  const commitText = commitDocuments.map((document) => document.payload).join('\n')
  const today = todayCommits()
  const todayDay = new Date(now.getTime() - today[1]!.minutesAgo * 60_000).toISOString().slice(0, 10)
  const todayDocument = commitDocuments.find((document) => document.documentId === `commits:${todayDay}`)
  const expectedNotBefore = now.getTime() - today[1]!.minutesAgo * 60_000 + COMMIT_MEMORY_SETTLE_MS
  check('commit history: 30-day window, no merges or e-mail addresses, one document per day', !commitText.includes(MARKERS.oldCommit) &&
    !commitText.includes(MARKERS.mergeCommit) && !commitText.includes('@example.invalid') && commitText.includes('feat(tags)') &&
    new Set(commitDocuments.map((document) => document.documentId)).size === commitDocuments.length, { days: commitDocuments.length })
  check('today\'s commits wait 30 minutes after the latest one', Boolean(todayDocument?.notBefore &&
    Math.abs(Date.parse(todayDocument.notBefore) - expectedNotBefore) < 2_000 && Date.parse(todayDocument.notBefore) > Date.now()),
  { notBefore: todayDocument?.notBefore })

  const ordered = built.sort((left, right) => (left.input.sourceKind === 'legacy' ? -1 : 0) - (right.input.sourceKind === 'legacy' ? -1 : 0) ||
    left.input.occurredAt.localeCompare(right.input.occurredAt))
  section('seed').sources = ordered.map((item) => ({ label: item.label, kind: item.input.sourceKind, occurredAt: item.input.occurredAt, bytes: bytes(item.input.payload) }))
  // Builds and checks the documents only: nothing is sent and no model is called.
  if (env.DEVFLOW_MEMORY_FULL_DRY === '1') return
  const base = Date.now()
  for (const [index, item] of ordered.entries()) {
    // Past discussions are long idle; only today's commits keep their settle time.
    const deferred = item.input.sourceKind === 'commit' && item.input.notBefore && Date.parse(item.input.notBefore) > base + 60_000
    const recorded = await store.recordProjectMemoryDocument(initial, { ...item.input, notBefore: deferred ? item.input.notBefore! : new Date(base + index).toISOString() })
    if (!recorded) throw new Error(`Document not recorded: ${item.label}`)
  }
  const before = JSON.stringify((await bankDocuments()).filter((row) => row.sourceKind === 'commit').map((row) => [row.documentId, row.contentDigest, row.updatedAt]))
  await captureCommitProjectMemory(store, project)
  lastCommitScan = Date.now()
  const after = JSON.stringify((await bankDocuments()).filter((row) => row.sourceKind === 'commit').map((row) => [row.documentId, row.contentDigest, row.updatedAt]))
  check('rescanning the same history changes nothing', before === after)
  const migrated = await migrateLegacyProjectMemory(store, projectId)
  check('the legacy copy exists once per bank', migrated?.documentId === LEGACY_MEMORY_DOCUMENT_ID &&
    (await bankDocuments()).filter((row) => row.documentId === LEGACY_MEMORY_DOCUMENT_ID).length === 1)
  await saveJson(reportPath, report)
  section('seed').recorded = { documents: ordered.length, bySource: statusCounts(ordered.map((item) => ({ status: item.input.sourceKind }))),
    payloadBytes: ordered.reduce((sum, item) => sum + bytes(item.input.payload), 0), deferred: todayDocument?.documentId }

  // Extraction and consolidation, driven by the desktop's own background cycle.
  stage = 'seed:extraction'
  const deferred = (row: { status: string; notBefore: string }) => row.status === 'queued' && Date.parse(row.notBefore) > Date.now() + 60_000
  const extraction = await runWorker('extraction', async () => (await bankDocuments())
    .every((row) => ['retained', 'failed'].includes(row.status) || deferred(row)), 90 * 60_000)
  const rows = await bankDocuments()
  const waiting = rows.filter((row) => !['retained', 'failed'].includes(row.status))
  check('every due document retained', extraction.done && rows.filter((row) => row.status === 'failed').length === 0 &&
    waiting.every((row) => row.documentId === todayDocument?.documentId), { statuses: statusCounts(rows), waiting: waiting.map((row) => row.documentId), ms: extraction.ms })
  const lastRetained = rows.map((row) => row.retainedAt ?? '').sort().at(-1)
  if (lastRetained) state.lastSeedRetainedAt = lastRetained
  await saveJson(statePath, state)
}

// ======================= Phase 2: consolidation =======================
async function consolidatePhase() {
  const bankId = (await config()).bankId
  // What the store recorded and sent, checked again from the stored rows.
  const rows = await bankDocuments()
  const payload = (documentId: string) => rows.find((row) => row.documentId === documentId)?.payload ?? ''
  const longChat = payload('conversation:chat-perf-long')
  const longRun = payload('coding-run:cr-long-activity')
  const commits = rows.filter((row) => row.sourceKind === 'commit')
  const commitText = commits.map((row) => row.payload).join('\n')
  const latestCommit = Date.parse((await git(state!.repo, ['log', '-1', '--format=%cI'])).stdout.trim())
  const today = commits.find((row) => row.documentId === `commits:${new Date(latestCommit).toISOString().slice(0, 10)}`)
  check('stored: the long discussion was sent without its oldest messages', bytes(longChat) <= PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 2_048 &&
    !longChat.includes(MARKERS.oldestLongChat) && longChat.includes(MARKERS.newestLongChat), { bytes: bytes(longChat) })
  check('stored: the long coding run was sent with its latest activity only', longRun.includes('[earlier activity omitted]') &&
    longRun.includes(MARKERS.lateEvent) && !longRun.includes(MARKERS.earlyEvent), { bytes: bytes(longRun) })
  check('stored: commit days within 30 days, without merges or e-mail addresses', commits.length > 0 && !commitText.includes(MARKERS.oldCommit) &&
    !commitText.includes(MARKERS.mergeCommit) && !commitText.includes('@example.invalid') && commitText.includes('feat(tags)'), { days: commits.length })
  check('stored: today\'s commits wait until 30 minutes after the latest one', Boolean(today && Math.abs(Date.parse(today.notBefore) - latestCommit - COMMIT_MEMORY_SETTLE_MS) < 2_000),
    { notBefore: today?.notBefore, status: today?.status })
  check('stored: one legacy copy in the bank', rows.filter((row) => row.documentId === LEGACY_MEMORY_DOCUMENT_ID).length === 1)
  check('stored: every due document retained', rows.every((row) => row.status === 'retained' || row.documentId === today?.documentId), { statuses: statusCounts(rows) })
  section('consolidate').documents = rows.map((row) => ({ documentId: row.documentId, kind: row.sourceKind, status: row.status, attempts: row.attempts,
    bytes: bytes(row.payload), retainedAt: row.retainedAt }))
  const settled = await settleBank(bankId, 40 * 60_000)
  check('Hindsight finished extraction and consolidation', settled.settled, settled)
  section('consolidate').settled = settled
  await step('measure consolidation', () => measureConsolidation(bankId, 'chat-small-talk', 'consolidate'))
}

/** Facts against observations, the observations behind each changed decision, and how they evolved. */
async function measureConsolidation(bankId: string, smallTalkId: string, target: Phase) {
  const statsValue = (await bankStats(bankId)).body
  const world = await listUnits(bankId, 'world')
  const experience = await listUnits(bankId, 'experience')
  const observations = await listUnits(bankId, 'observation')
  const facts = world.length + experience.length
  const sourced = observations.map((item) => item.source_memory_ids?.length ?? 0)
  const documentsList = (await hindsight<{ items?: Array<{ id: string; memory_unit_count?: number; text_length?: number }> }>('GET', `${bankPath(bankId)}/documents?limit=200`)).body?.items ?? []
  const consolidation = {
    stats: statsValue, facts: { world: world.length, experience: experience.length }, observations: observations.length,
    factsPerObservation: observations.length ? +(facts / observations.length).toFixed(2) : null,
    sourcesPerObservation: sourced.length ? { mean: +(sourced.reduce((sum, value) => sum + value, 0) / sourced.length).toFixed(2), max: Math.max(...sourced) } : null,
    multiSourceObservations: sourced.filter((value) => value > 1).length,
    documents: documentsList.map((item) => ({ id: item.id, units: item.memory_unit_count ?? null, chars: item.text_length ?? null })),
  }
  section(target).consolidation = consolidation
  check('consolidation produced observations from several facts', observations.length > 0 && facts > observations.length && consolidation.multiSourceObservations > 0,
    { facts, observations: observations.length, multiSource: consolidation.multiSourceObservations })
  const smallTalk = documentsList.find((item) => item.id === `conversation:${smallTalkId}`)
  observe('small talk produced memory units', smallTalk?.memory_unit_count ?? null)
  const topics: Array<{ name: string; topic: RegExp; latest: RegExp; outdated: RegExp }> = [
    { name: '撤销窗口', topic: /撤销窗口|undo window/iu, latest: /(?<![0-9.])15\s*(?:秒|s\b|seconds?)/iu, outdated: /(?<![0-9.])(?:5|10)\s*(?:秒|s\b|seconds?)/iu },
    { name: '同步重试', topic: /重试|retr/iu, latest: /(?<![0-9])5\s*(?:次|retries|times|attempts)|最多重试\s*5/iu, outdated: /(?<![0-9])3\s*(?:次|retries|times|attempts)/iu },
    { name: '分页大小', topic: /分页|每页|page size|per page/iu, latest: /(?<![0-9])50(?![0-9])/u, outdated: /(?<![0-9])(?:10|20)(?![0-9])/u },
    { name: '回答语言', topic: /回答|答复|回复|answer|respond|reply/iu, latest: /英文|英语|English/iu, outdated: /中文回答|in Chinese/iu },
    { name: '日期显示', topic: /日期|date/iu, latest: /相对|relative|天前/iu, outdated: /YYYY-MM-DD/u },
    { name: '批量删除撤销', topic: /批量删除|batch delet/iu, latest: /最近一次|most recent|latest batch/iu, outdated: /不支持撤销|not support|no undo/iu },
  ]
  const byTopic = []
  for (const topic of topics) {
    const matching = observations.filter((item) => topic.topic.test(item.text))
    const latest = matching.filter((item) => topic.latest.test(item.text))
    const outdatedOnly = matching.filter((item) => topic.outdated.test(item.text) && !topic.latest.test(item.text))
    const histories = []
    for (const item of latest.slice(0, 2)) {
      const history = (await hindsight<unknown>('GET', `${bankPath(bankId)}/memories/${encodeURIComponent(item.id)}/history`)).body
      const entries = Array.isArray(history) ? history : Array.isArray((history as { items?: unknown[] } | null)?.items) ? (history as { items: unknown[] }).items : []
      histories.push({ id: item.id, sources: item.source_memory_ids?.length ?? 0, revisions: entries.length,
        revisionsText: entries.slice(0, 6).map((entry) => JSON.stringify(entry).slice(0, 300)) })
    }
    byTopic.push({ topic: topic.name, observations: matching.length, latest: latest.length, outdatedOnly: outdatedOnly.length,
      latestText: latest.slice(0, 3).map((item) => item.text), outdatedOnlyText: outdatedOnly.slice(0, 3).map((item) => item.text), histories })
    check(`consolidated belief states the latest ${topic.name}`, latest.length > 0, { observations: matching.length, latest: latest.length })
    observe(`observations stating only an outdated ${topic.name}`, outdatedOnly.length)
  }
  section(target).decisions = byTopic
  section(target).observationSample = observations.slice(0, 40).map((item) => ({ text: item.text, sources: item.source_memory_ids?.length ?? 0, proof: item.proof_count }))
}

// ======================= Phase 3: recall =======================
type RecallRow = { query: string; ms: number; degraded: boolean | null; returned: number; firstMatchRank: number | null
  found: Record<'coding' | 'stage' | 'discussion', boolean>; latest?: { passed: boolean; first: string | undefined }; observations: number; discussion: string[] }
async function recallPhase() {
  const rows: RecallRow[] = []
  const latencies: number[] = []
  for (const item of RECALL_QUERIES) {
    // Each entry point asks Hindsight with its own budget, so each gets its own candidates.
    const coding = await recallSelection(item.query, CODING_MEMORY_RECALL_BUDGET)
    const stageRecall = await recallSelection(item.query, STAGE_AGENT_MEMORY_RECALL_BUDGET)
    const discussionRecall = await recallSelection(item.query, CONVERSATION_MEMORY_RECALL_BUDGET)
    latencies.push(coding.ms, stageRecall.ms, discussionRecall.ms)
    const statements = (list: ProjectMemoryRecallItem[]) => list.map((entry) => entry.statement)
    const discussion = discussionRecall.selected
    const stageSelection = stageRecall.selected
    const firstMatch = coding.items.findIndex((entry) => item.expect.every((term) => has([entry.statement], term)))
    const found = { coding: item.expect.every((term) => has(statements(coding.selected), term)), stage: item.expect.every((term) => has(statements(stageSelection), term)),
      discussion: item.expect.every((term) => has(statements(discussion), term)) }
    const latest = item.latest ? latestFirst(statements(discussion), item.latest) : undefined
    rows.push({ query: item.query, ms: coding.ms, degraded: coding.degraded, returned: coding.items.length, firstMatchRank: firstMatch < 0 ? null : firstMatch + 1,
      found, ...(latest ? { latest } : {}), observations: coding.items.filter((entry) => entry.statement.startsWith('[observation]')).length,
      discussion: statements(discussion) })
    check(`recall: ${item.query}`, found.coding && found.discussion && (latest?.passed ?? true), { found, ...(latest ? { latest } : {}) })
  }
  const sorted = [...latencies].sort((left, right) => left - right)
  const metrics = {
    queries: rows.length,
    hitRate: Object.fromEntries((['coding', 'stage', 'discussion'] as const).map((budget) => [budget, +(rows.filter((row) => row.found[budget]).length / rows.length).toFixed(3)])),
    meanReciprocalRank: +(rows.reduce((sum, row) => sum + (row.firstMatchRank ? 1 / row.firstMatchRank : 0), 0) / rows.length).toFixed(3),
    latencyMs: { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted.at(-1) },
    observationShare: +(rows.reduce((sum, row) => sum + row.observations, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.returned, 0))).toFixed(3),
  }
  section('recall').queries = rows
  section('recall').metrics = metrics
  check('recall stays fast enough for every step', (metrics.latencyMs.p95 ?? Infinity) < 3_000, metrics.latencyMs)
  // The discussion bar's memory_search tool, called directly.
  const search = await recall.search({ projectId, query: '为什么把任务数据从 localStorage 换成 IndexedDB', limit: 8 })
  check('memory_search returns at most eight dated items with their kind', Boolean(search && search.items.length > 0 && search.items.length <= 8 &&
    search.items.every((entry) => ['observation', 'fact'].includes(entry.kind)) && has(search.items.map((entry) => entry.text), /IndexedDB|localStorage/iu)),
  { items: search?.items.length })
  // Unrelated question: what the discussion would still attach.
  const unrelated = await recallSelection('火星上今天的天气怎么样？', CONVERSATION_MEMORY_RECALL_BUDGET)
  observe('memories attached to an unrelated question (discussion budget)', unrelated.selected.length)
  // Another user, and Hindsight unavailable.
  check('another user gets no project memory', (await recall.recall({ projectId, userId: 'someone-else', query: '撤销窗口', budget: CODING_MEMORY_RECALL_BUDGET })) === null)
  const offline = createProjectMemoryRecall({ store, transportAvailable: true, client: async () => createHindsightClient({ endpoint: 'http://127.0.0.1:9', timeoutMs: 2_000 }) })
  const started = Date.now()
  const degraded = await offline.recall({ projectId, userId: owner(), query: '撤销窗口', budget: CODING_MEMORY_RECALL_BUDGET })
  check('an unavailable Hindsight degrades recall instead of failing it', degraded?.degraded === true && degraded.items.length === 0 && Date.now() - started < 5_000,
    { ms: Date.now() - started })
}

// ======================= Phase 4: knowledge pages =======================
async function pagesPhase() {
  const bankId = (await config()).bankId
  let all = await pages(bankId)
  const written = () => PROJECT_KNOWLEDGE_PAGES.every((page) => all.get(knowledgePageModelId(page.id))?.content.trim() || all.get(knowledgePageModelId(page.id))?.failedAt)
  const started = Date.now()
  while (!written() && Date.now() - started < 15 * 60_000) { await cycle(); await delay(15_000); all = await pages(bankId) }
  await settleBank(bankId, 10 * 60_000)
  all = await pages(bankId)
  const lastRetained = state?.lastSeedRetainedAt
  section('pages').pages = PROJECT_KNOWLEDGE_PAGES.map((page) => {
    const value = all.get(knowledgePageModelId(page.id))
    const content = value?.content ?? ''
    const expectations = PAGE_EXPECTATIONS[page.id] ?? []
    check(`page ${page.title} has the expected content`, expectations.every((pattern) => pattern.test(content)), { chars: content.length, failedAt: value?.failedAt })
    return { id: page.id, title: page.title, refreshedAt: value?.refreshedAt, failedAt: value?.failedAt, chars: content.length,
      writtenBeforeLastRetain: Boolean(value?.refreshedAt && lastRetained && value.refreshedAt < lastRetained), content: content.slice(0, 2_500) }
  })
  const text = pageText(all)
  const late = LATE_DECISIONS.map((item) => ({ name: item.name, present: item.pattern.test(text) }))
  section('pages').lateDecisions = late
  check('knowledge pages reflect the late decisions', late.filter((item) => item.present).length >= LATE_DECISIONS.length - 1, late)
}

// ======================= Phase 5: entry points with real model calls =======================
type Turn = { status: string; answer: string; memoriesSent: number; omittedMemory: number; compactions: number; nativeContextStart?: number
  boundaryId?: string; budgetBytes?: number; memoryBytes?: number; toolCalls: string[]; error?: string }
async function discuss(name: string, native: boolean, turns: string[], useProvider: AgentProvider): Promise<{ id: string; turns: Turn[] }> {
  const conversations = new WorkbenchConversationService({ store, memory: store, nativeConversationsEnabled: native,
    resolveProvider: async () => useProvider, changed() {}, loadKnowledge: knowledge,
    memorySearch: async (id, args, signal) => (await recall.search({ projectId: id, query: args.query, limit: args.limit, signal })) ?? undefined })
  const id = (await conversations.command({ type: 'create', projectId })).conversationId!
  const results: Turn[] = []
  for (const text of turns) {
    stage = `agents:discussion:${name}`
    await conversations.command({ type: 'send', projectId, conversationId: id, providerId: useProvider.id, text })
    await conversations.settled(id)
    const session = (await store.listWorkbenchConversations(projectId)).find((item) => item.id === id) as WorkbenchConversation
    const receipt = session.contextReceipt
    const memorySections = (receipt?.budget?.sections ?? []).filter((item) => item.kind === 'memory')
    const toolCalls = native
      ? (session.nativeTranscript ?? []).flatMap((entry) => entry.message.role === 'assistant' ? (entry.message.tool_calls ?? []).map((call) => call.function.name) : [])
      : (session.toolEvents ?? []).flatMap((event) => event.kind === 'tool_request' ? [event.name] : [])
    results.push({ status: session.status, answer: (session.messages.filter((item) => item.role === 'assistant').at(-1)?.text ?? '').slice(0, 700),
      memoriesSent: receipt?.memory?.memories.length ?? 0, omittedMemory: receipt?.memory?.omittedMemoryCount ?? 0,
      compactions: session.compactions?.length ?? 0, ...(session.nativeContextStart !== undefined ? { nativeContextStart: session.nativeContextStart } : {}),
      ...(receipt?.boundaryId ? { boundaryId: receipt.boundaryId } : {}),
      ...(receipt?.budget ? { budgetBytes: receipt.budget.bytes } : {}),
      ...(memorySections.length ? { memoryBytes: memorySections.reduce((sum, item) => sum + item.bytes, 0) } : {}),
      toolCalls: [...new Set(toolCalls)], ...(session.error ? { error: session.error } : {}) })
    if (session.status !== 'idle') break
  }
  const agents = section('agents')
  const discussions = (agents.discussions ??= {}) as Record<string, unknown>
  discussions[name] = { protocol: native ? 'native-v2' : 'structured', id, turns: results }
  state!.discussions = { ...(state!.discussions ?? {}), [name]: id }
  await saveJson(statePath, state)
  return { id, turns: results }
}
const english = (text: string) => {
  const latin = (text.match(/[A-Za-z]/gu) ?? []).length
  const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length
  return latin > 20 && cjk <= latin / 10
}
/** The same provider with a smaller input limit, so DevFlow's own packing has to drop and compact. */
function withInputLimit(limit: { bytes?: number }, onNative?: (request: NativeConversationRequest) => void): AgentProvider {
  return { ...provider, resolveRequestPolicy: (input) => {
    const policy = provider.resolveRequestPolicy!(input)
    // Native v2 measures the complete request through the policy it resolves for it.
    if (onNative && 'messages' in input && Array.isArray((input as { messages?: unknown }).messages)) onNative(input as NativeConversationRequest)
    return limit.bytes ? { ...policy, maxInputBytes: limit.bytes } : policy
  } }
}

async function agentsPhase() {
  provider = governAgentProvider(baseProvider, projectId, governance)
  const now = () => new Date().toISOString()
  const suffix = Date.now().toString(36)
  project = (await store.listProjects()).find((item) => item.id === projectId)
  if (!project) throw new Error('Project missing')

  // -- Coding: the brief recalls memory and keeps it whole while compacting large background.
  const workflowId = `wf-archive-undo-${suffix}`
  const request = '归档任务也要支持撤销：把 src/archive.js 里的 ARCHIVE_UNDO_WINDOW_MS 设成和删除任务的撤销窗口相同的时长（以我们最后商定的为准），注释按项目约定的语言写。只改这个文件。'
  const workflow: WorkflowRun = { id: workflowId, version: 1, title: '归档任务支持撤销', request, projectId, creatorId: owner(), status: 'building',
    currentNodeId: `${workflowId}-build`, branchName: 'devflow/archive-undo', createdAt: now(), updatedAt: now(), edges: [],
    nodes: [
      { id: `${workflowId}-design`, stage: 'design', title: '归档撤销设计', subtitle: '与删除撤销一致', kind: 'task', status: 'success', ownerId: owner(), retryCount: 0, artifactIds: [`${workflowId}-design-artifact`] },
      { id: `${workflowId}-build`, stage: 'build', title: '实现归档撤销时长', subtitle: '只改 src/archive.js', kind: 'task', status: 'running', ownerId: owner(), retryCount: 0, artifactIds: [] },
    ] }
  const background = Array.from({ length: 6 }, (_, index) => ciLog(index + 10)).join('\n')
  const workflowArtifacts: Artifact[] = [
    { id: `${workflowId}-design-artifact`, runId: workflowId, nodeId: `${workflowId}-design`, kind: 'design', title: '归档撤销设计', summary: '归档后显示撤销提示，时长与删除撤销一致。',
      content: '## 设计\n- 归档后显示撤销提示，撤销时长与删除任务的撤销窗口一致。\n- 只修改 src/archive.js 中的 ARCHIVE_UNDO_WINDOW_MS。', redacted: true, updatedAt: now() } as Artifact,
    { id: `${workflowId}-ci-log`, runId: workflowId, nodeId: `${workflowId}-design`, kind: 'log', title: 'CI 原始日志', summary: '最近一次 CI 的完整输出，供参考。',
      content: background, redacted: true, updatedAt: now() } as Artifact,
  ]
  await store.saveRun(workflow)
  for (const artifact of workflowArtifacts) await store.saveArtifact(artifact)
  state!.codingWorkflowId = workflowId
  await step('coding brief keeps recalled memory whole under compaction', async () => {
    const recalled = await recallCodingMemory({ store, run: workflow, codingRunId: `brief-check-${suffix}`, userId: owner(), query: `${request}\n${workflow.nodes[1]!.title}`, now: now() })
    const brief = buildCodingBrief({ run: workflow, node: workflow.nodes[1]!, project: project!, upstreamArtifacts: workflowArtifacts, knowledgeReferences: [],
      governanceChecks: [], gateDecisions: [], testEvidence: [], userInstruction: request, worktreePath: '<worktree>', branchName: '<branch>',
      maxContextBytes: CODING_BRIEF_MAX_BYTES, memoryContext: recalled.context })
    const memorySources = brief.compaction!.sources.filter((source) => source.id.startsWith('memory:'))
    section('agents').codingBrief = { memories: recalled.context.length, omitted: recalled.omittedMemoryCount, compaction: brief.compaction }
    check('coding brief: memory recalled, background compacted, memory kept in full', recalled.context.length > 0 && brief.compaction!.compacted &&
      memorySources.length === recalled.context.length && memorySources.every((source) => source.representation === 'full') &&
      brief.compaction!.sources.some((source) => source.id === `artifact:${workflowId}-ci-log` && source.representation === 'summary') &&
      brief.compaction!.outputBytes <= CODING_BRIEF_MAX_BYTES, { memories: recalled.context.length, inputBytes: brief.compaction!.inputBytes, outputBytes: brief.compaction!.outputBytes })
    check('coding brief recalls the latest undo window', has(recalled.context.map((item) => item.statement), /(?<![0-9.])15\s*(?:秒|s\b|seconds?)/iu))
  })

  // -- A real Native v2 coding run in a managed worktree of the synthetic repository.
  await step('native coding run', async () => {
    const executor = createNativeCodingExecutorV2({ store, decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(provider), configVersion: 1 })
    const coding = createCodingRuntime({ store, executor, worktreeRoot: path.join(workdir, 'worktrees'), runTestCommand: runLocalTestCommand,
      budgetGuard: async () => ({ status: 'allowed', blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0.05, limitUsd: 0.5, reason: 'Bounded live validation budget.' }) })
    const waiting = await coding.runCodingAgent({ runId: workflowId, nodeId: workflow.currentNodeId, projectId, requestedBy: owner(), userInstruction: request })
    state!.codingRunId = waiting.codingRun.id
    await saveJson(statePath, state)
    const approvals: string[][] = []
    for (let round = 0; round < 3; round += 1) {
      const current = (await store.listCodingAgentRuns(workflowId)).find((item) => item.id === waiting.codingRun.id)!
      if (current.status !== 'waiting_permission') break
      const permission = (await store.listCodingPermissionRequests(current.id)).find((item) => item.status === 'pending' && item.origin === 'coding_executor')
      if (!permission) break
      const changeSet = (await store.listCodingChangeSets(current.id)).find((item) => item.id === current.changeSetId)
      approvals.push(changeSet?.changes.map((change) => change.path) ?? [])
      await coding.replyCodingPermission({ requestId: permission.id, codingRunId: permission.codingRunId, decidedBy: owner(), decision: 'approved',
        comment: 'Approve the change set in the disposable validation repository.' })
    }
    const finished = (await store.listCodingAgentRuns(workflowId)).find((item) => item.id === waiting.codingRun.id)!
    const workspace = (await store.listManagedCodingWorkspaces(projectId)).find((item) => item.id === finished.managedWorkspaceId)
    const file = workspace ? await readFile(path.join(workspace.worktreePath, 'src/archive.js'), 'utf8').catch(() => '') : ''
    const receipt = finished.contextReceipt
    const tests = (await store.listTestEvidence(workflowId)).map((item) => item.status)
    const comments = file.split('\n').filter((line) => line.trim().startsWith('//'))
    section('agents').codingRun = { id: finished.id, status: finished.status, approvals, tests, file: file.slice(0, 1_500),
      receipt: receipt ? { memories: receipt.memories.length, omitted: receipt.omittedMemoryCount, compacted: receipt.compaction.compacted,
        memorySources: receipt.compaction.sources.filter((source) => source.id.startsWith('memory:')).map((source) => source.representation) } : null,
      cost: finished.runtimeCostSummary }
    check('native coding run: brief carried project memory', Boolean(receipt && receipt.memories.length > 0 && receipt.memories.every((item) => item.id.startsWith('pm-'))),
      { memories: receipt?.memories.length })
    check('native coding run completed with passing host tests', finished.status === 'completed' && tests.includes('passed'), { status: finished.status, tests })
    check('native coding run used the remembered 15-second window', /(?<![0-9])15[_,]?000(?![0-9])|15\s*\*\s*1000/u.test(file), { file: file.slice(0, 400) })
    observe('coding run comments are in English (remembered convention)', comments.length > 0 && comments.every((line) => !/\p{Script=Han}/u.test(line)))
    const captured = (await bankDocuments()).find((row) => row.documentId === `coding-run:${finished.id}`)
    check('the finished coding run was captured automatically', captured?.status === 'queued', { status: captured?.status })
  })

  // -- Discussions. Baselines also measure the request, so the limits below are exact.
  const nativeSizes: Array<{ bytes: number; memoryBytes: number }> = []
  const measureNative = (request: NativeConversationRequest) => {
    const serialize = (messages: NativeConversationRequest['messages']) => bytes(provider.serializeNativeRequest!({ ...request, messages }))
    const last = request.messages.at(-1)
    const withMemory = typeof last?.content === 'string' && last.role === 'user' && last.content.includes('"backgroundMemory"')
    const total = serialize(request.messages)
    nativeSizes.push({ bytes: total, memoryBytes: withMemory ? total - serialize(request.messages.slice(0, -1)) : 0 })
  }
  // Asked in Chinese; the newer remembered preference is English.
  const question = '用两句话解释什么是回归测试，不要调用工具。'
  const nativeBaseline = await step('discussion native baseline', async () => {
    const result = await discuss('native-baseline', true, [question], withInputLimit({}, measureNative))
    const turn = result.turns[0]!
    check('native discussion sent project memory and answered in English', turn.status === 'idle' && turn.memoriesSent > 0 && english(turn.answer),
      { status: turn.status, memories: turn.memoriesSent })
    return nativeSizes.find((item) => item.memoryBytes > 0)
  })
  const structuredBaseline = await step('discussion structured baseline', async () => {
    const result = await discuss('structured-baseline', false, [question], provider)
    const turn = result.turns[0]!
    check('structured discussion sent project memory and answered in English', turn.status === 'idle' && turn.memoriesSent > 0 && english(turn.answer),
      { status: turn.status, memories: turn.memoriesSent })
    return turn
  })
  for (const native of [true, false]) {
    await step(`discussion memory_search ${native ? 'native' : 'structured'}`, async () => {
      const result = await discuss(`${native ? 'native' : 'structured'}-memory-search`, native,
        ['请先用 memory_search 查一下项目记忆，再用一句话回答：我们为什么把任务数据从 localStorage 换成 IndexedDB？'], provider)
      const turn = result.turns[0]!
      check(`${native ? 'native' : 'structured'} discussion called memory_search and answered from it`, turn.status === 'idle' &&
        turn.toolCalls.includes('memory_search') && /5\s*MB|5MB|block|阻塞|容量|size|limit/iu.test(turn.answer), { tools: turn.toolCalls, answer: turn.answer.slice(0, 200) })
    })
  }
  // Memory is optional background: over the limit, it is dropped before anything else.
  if (nativeBaseline) {
    await step('discussion native memory dropped first', async () => {
      const limit = nativeBaseline.bytes - Math.floor(nativeBaseline.memoryBytes / 2)
      const turn = (await discuss('native-memory-dropped', true, [question], withInputLimit({ bytes: limit }))).turns[0]!
      check('native: over the limit, memory is left out and history is not compacted', turn.status === 'idle' && turn.memoriesSent === 0 &&
        turn.omittedMemory > 0 && turn.compactions === 0 && turn.nativeContextStart === undefined, { limit, ...turn, answer: turn.answer.slice(0, 120) })
    })
  }
  if (structuredBaseline?.budgetBytes && structuredBaseline.memoryBytes) {
    await step('discussion structured memory dropped first', async () => {
      const limit = structuredBaseline.budgetBytes! - Math.floor(structuredBaseline.memoryBytes! / 2)
      const turn = (await discuss('structured-memory-dropped', false, [question], withInputLimit({ bytes: limit }))).turns[0]!
      check('structured: over the limit, memory is left out and history is not compacted', turn.status === 'idle' && turn.memoriesSent === 0 &&
        turn.omittedMemory > 0 && turn.compactions === 0, { limit, ...turn, answer: turn.answer.slice(0, 120) })
    })
  }
  // Long logs force compaction; the answer has to come from the rolling summary.
  const longTurns = [
    `背景：我们定在 11 月 3 日（周二）发布 v2.4。下面是第 1 段 CI 日志，先不用分析，只回复“收到”：\n${ciLog(1)}`,
    `第 2 段 CI 日志，同样只回复“收到”：\n${ciLog(2)}`,
    `第 3 段 CI 日志，同样只回复“收到”：\n${ciLog(3)}`,
    '不要调用工具：我们之前定的发布日期是哪天？只回答日期。',
  ]
  for (const native of [true, false]) {
    const baseline = native ? nativeBaseline?.bytes : structuredBaseline?.budgetBytes
    if (!baseline) continue
    await step(`discussion ${native ? 'native' : 'structured'} compaction`, async () => {
      const limit = baseline + (native ? 9_000 : 15_000)
      const result = await discuss(`${native ? 'native' : 'structured'}-compaction`, native, longTurns, withInputLimit({ bytes: limit }))
      const last = result.turns.at(-1)!
      const compacted = result.turns.filter((turn) => native ? turn.compactions > 0 : Boolean(turn.boundaryId))
      const firstCompaction = result.turns.findIndex((turn) => native ? turn.compactions > 0 : Boolean(turn.boundaryId))
      check(`${native ? 'native' : 'structured'}: long history is compacted into a rolling summary and the answer still uses it`,
        result.turns.length === longTurns.length && result.turns.every((turn) => turn.status === 'idle') && compacted.length > 0 &&
        /11\s*月\s*3|November 3|Nov\.? 3|3 November|11[/-]0?3/iu.test(last.answer),
      { limit, turns: result.turns.map(({ answer, ...rest }) => ({ ...rest, answer: answer.slice(0, 80) })) })
      if (firstCompaction >= 0) {
        const turn = result.turns[firstCompaction]!
        if (native) {
          // ADR 0028: a compacted native request reloads the current request, project facts and valid memory.
          // That memory goes first under pressure is shown by the memory-dropped scenario above.
          check('native: after compaction, memory that fits is sent again (ADR 0028)', turn.memoriesSent > 0, { memoriesSent: turn.memoriesSent, budgetBytes: turn.budgetBytes, limit })
        } else {
          // ADR 0024 §6: the discussion bar leaves this step's memory out before it compacts history.
          check('structured: memory is left out before history is compacted', turn.omittedMemory > 0 && turn.memoriesSent === 0,
            { memoriesSent: turn.memoriesSent, omitted: turn.omittedMemory })
        }
      }
    })
  }
  const auto = (await bankDocuments()).filter((row) => row.sourceKind === 'conversation' && row.status === 'queued')
  check('finished discussions were captured automatically and wait until idle', auto.length >= 4 && auto.every((row) => Date.parse(row.notBefore) > Date.parse(row.createdAt)),
    { queued: auto.length })
  await saveJson(statePath, state)
}

// ======================= Phase 5b: stage Agent, Gate review and approval =======================
/** A new request through the clarify stage with recalled memory, a paid Gate review of it, and its approval. */
async function reviewPhase() {
  provider = governAgentProvider(baseProvider, projectId, governance)
  const now = () => new Date().toISOString()
  const suffix = Date.now().toString(36)
  // Re-running this phase replaces the results of these steps, including ones an earlier run kept under agents.
  const steps = ['stage agent', 'gate review', 'gate approval']
  report.checks = report.checks.filter((item) => !steps.includes(item.step ?? ''))
  const stageRunId = `wf-archive-clarify-${suffix}`
  await step('stage agent', async () => {
    const created = createWorkflowRunFromRequest({ runId: stageRunId, title: '任务归档', request: '给任务增加归档功能：归档后的任务从列表隐藏，可以像删除一样撤销；批量归档也要考虑。',
      projectId, creatorId: owner(), branchName: 'devflow/archive', now: now() })
    await store.saveRun(created.run)
    for (const artifact of created.artifacts) await store.saveArtifact(artifact)
    for (const event of created.events) await store.saveEvent(event)
    const node = created.run.nodes.find((item) => item.id === created.run.currentNodeId)!
    const stageMemory = await recallScopedMemory({ store, projectId, userId: owner(), runtimeId: `agent-runtime-stage-${suffix}`, requestId: `stage-memory-${suffix}`,
      query: [created.run.request, node.title, node.subtitle].join('\n'), now: now(), budget: STAGE_AGENT_MEMORY_RECALL_BUDGET })
    const generate = () => runWorkflowStageAgent({ run: created.run, node, artifacts: created.artifacts, provider, requestedBy: owner(), runtime: 'electron',
      ...(stageMemory.context.length ? { memoryContext: stageMemory.context } : {}) })
    // A retryable model failure is offered to the user as a retry; take up to two, as a user would.
    // DeepSeek Flash sometimes closes the JSON object without its last array, with or without memory.
    const retryable = (error: unknown) => error instanceof Error && /retryable=true/u.test(error.message)
    const failures: unknown[] = []
    let generated: Awaited<ReturnType<typeof generate>> | undefined
    for (let attempt = 0; attempt < 3 && !generated; attempt += 1) {
      try { generated = await generate() }
      catch (error) { if (!retryable(error) || attempt === 2) throw error; failures.push(describe(error)) }
    }
    if (!generated) throw new Error('No clarification generated')
    observe('stage agent attempts', { attempts: failures.length + 1, failures })
    const content = generated.artifact.content
    section('review').stageAgent = { memories: stageMemory.context.map((item) => item.statement), artifactTitle: generated.artifact.title, content: content.slice(0, 3_000) }
    check('stage agent prompt carried the recalled memory', stageMemory.context.length > 0 && generated.prompt.includes('RECALLED_MEMORY_BACKGROUND') &&
      stageMemory.context.every((item) => generated.prompt.includes(item.id)), { memories: stageMemory.context.length })
    observe('stage agent clarification uses remembered decisions (15 s undo, batch undo, ConfirmDialog)', {
      undo15: /15\s*秒|15 seconds|15s/iu.test(content), batch: /最近一次|most recent/iu.test(content), confirm: /确认|ConfirmDialog/iu.test(content) })
    const stored = (await store.getRun(stageRunId))!
    const completed = completeWorkflowAgentNode({ run: stored, nodeId: node.id, artifacts: await store.listArtifacts(stageRunId), generatedArtifact: generated.artifact,
      existingEvents: await store.listEvents(stageRunId), actorName: 'DevFlow', now: now() })
    const committed = await store.commitWorkflowMutation({ expectedRun: stored, run: completed.run, artifacts: [completed.artifact], events: [completed.event] })
    if (!committed.committed) throw new Error(`Clarification not saved: ${committed.reason}`)
    state!.stageRunId = stageRunId
    state!.gateNodeId = completed.nextNode.id
    state!.clarificationId = completed.artifact.id
    await saveJson(statePath, state)
  })
  await step('gate review', async () => {
    if (!state!.gateNodeId) throw new Error('No Gate to review')
    // A paid review needs a budget decision; the desktop asks the Team budget, this run its own ledger.
    const runtime = createKnowledgeReviewRuntime({ store, knowledgeDocuments: [], knowledgeChunks: [],
      resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
      budgetGuard: async (input) => ({ status: 'allowed', blocksRun: false, currentSpendUsd: thisRun.spentUsd, projectedCostUsd: input.projectedCostUsd,
        limitUsd: capUsd, reason: 'Bounded live validation budget.' }) })
    const result = await runtime.run({ runId: stageRunId, nodeId: state!.gateNodeId, projectId, requestedBy: owner(), runtime: 'electron', providerId: provider.id })
    const memory = result.review.contextManifest?.backgroundMemory
    const reviewArtifact = (await store.listArtifacts(stageRunId)).filter((item) => item.kind === 'agent_review').at(-1)
    if (reviewArtifact) state!.reviewArtifactId = reviewArtifact.id
    await saveJson(statePath, state)
    section('review').gateReview = { memories: memory?.memories.length ?? 0, omitted: memory?.omittedCount ?? 0, artifact: reviewArtifact?.content.slice(0, 2_000) }
    check('gate review carried project memory and recorded it in its manifest', (memory?.memories.length ?? 0) > 0 && memory!.memories.every((item) => item.id.startsWith('pm-')),
      { memories: memory?.memories.length })
    const captured = (await bankDocuments()).find((row) => row.documentId === `artifact:${reviewArtifact?.id}`)
    check('the saved Gate review result was captured automatically', captured?.status === 'queued' && captured.tags.includes('kind:agent_review'), { status: captured?.status })
  })
  await step('gate approval', async () => {
    const stored = (await store.getRun(stageRunId))!
    const clarification = (await store.listArtifacts(stageRunId)).find((item) => item.id === state!.clarificationId)!
    const approved = approveClarificationRevision({ artifact: clarification, actorId: owner(), now: now(), sequence: (await store.listEvents(stageRunId)).length + 1, gateNodeId: state!.gateNodeId! })
    const advanced = advanceWorkflowAfterGateApproval({ run: stored, approvedNodeId: state!.gateNodeId!, now: now() })
    const committed = await store.commitWorkflowMutation({ expectedRun: stored, run: advanced.run, artifacts: [approved.artifact], events: [approved.event] })
    const captured = (await bankDocuments()).find((row) => row.documentId === `artifact:${clarification.id}`)
    check('the approved clarification was captured automatically', committed.committed && captured?.status === 'queued' && captured.tags.includes('kind:clarification'),
      { committed: committed.committed, status: captured?.status })
  })

}

// ======================= Phase 6: automatic capture of the new work =======================
async function capturePhase() {
  project = (await store.listProjects()).find((item) => item.id === projectId)
  const bankId = (await config()).bankId
  const result = await runWorker('capture', async () => (await bankDocuments()).every((row) => ['retained', 'failed', 'deleted'].includes(row.status)), 45 * 60_000)
  const rows = await bankDocuments()
  check('captured work retained: discussions, coding run, review, approval and today\'s commits', result.done && rows.every((row) => row.status === 'retained'),
    { statuses: statusCounts(rows), ms: result.ms })
  const settled = await settleBank(bankId, 20 * 60_000)
  check('Hindsight settled after the new work', settled.settled, settled)
  // The coding run's record holds what its agent reported, so finding the value there is reported, not required.
  const questions: Array<{ query: string; expect: RegExp; source: string; required: boolean }> = [
    { query: '我们定的 v2.4 发布日期是哪天？', expect: /11\s*月\s*3|November 3|Nov(?:ember)?\.? 3|11-03|11\/3/iu, source: 'discussion', required: true },
    { query: '归档撤销时长 ARCHIVE_UNDO_WINDOW_MS 设成了多少？', expect: /15[_,]?000|15\s*秒|15 seconds/iu, source: 'coding run', required: false },
  ]
  const answers = []
  for (const item of questions) {
    const selection = await recallSelection(item.query, CODING_MEMORY_RECALL_BUDGET)
    const statements = selection.selected.map((entry) => entry.statement)
    answers.push({ ...item, expect: String(item.expect), statements })
    if (item.required) check(`recall finds what the ${item.source} added`, has(statements, item.expect), { first: statements.slice(0, 3) })
    else observe(`recall finds what the ${item.source} added`, { found: has(statements, item.expect), first: statements.slice(0, 3) })
  }
  const review = rows.find((row) => row.documentId === `artifact:${state!.reviewArtifactId}`)
  const reviewUnits = review ? (await hindsight<{ memory_unit_count?: number }>('GET', `${bankPath(bankId)}/documents/${encodeURIComponent(review.documentId)}`)).body?.memory_unit_count : null
  observe('memory units learned from the Gate review result', reviewUnits ?? null)
  section('capture').recall = answers
  await step('measure consolidation', () => measureConsolidation(bankId, 'chat-small-talk', 'capture'))
}

// ======================= Phase 7: edit, forget, forget source =======================
async function lifecyclePhase() {
  project = (await store.listProjects()).find((item) => item.id === projectId)
  const bankId = (await config()).bankId
  const t0 = new Date().toISOString()
  await delay(1_100)
  const lifecycle = section('lifecycle')
  // Forget one memory the coding run's brief used: its receipt can no longer be resumed.
  await step('forget a memory', async () => {
    const codingRun = state!.codingRunId && state!.codingWorkflowId
      ? (await store.listCodingAgentRuns(state!.codingWorkflowId)).find((item) => item.id === state!.codingRunId) : undefined
    const used = codingRun?.contextReceipt?.memories.map((item) => item.id) ?? []
    const units = await allUnits(bankId)
    const target = units.find((unit) => used.includes(`pm-${unit.id}`) && unit.fact_type !== 'observation') ?? units.find((unit) => used.includes(`pm-${unit.id}`))
    if (!codingRun || !target) throw new Error('No coding receipt memory to forget')
    const before = await assertCodingContextCurrent({ store, codingRun, now: new Date().toISOString() }).then(() => true, () => false)
    await client.invalidateMemory(bankId, target.id, 'deleted by the user in DevFlow')
    await store.markProjectMemoryChanged(projectId, target.id)
    await clearKnowledgePages(client, bankId)
    const refused = await assertCodingContextCurrent({ store, codingRun, now: new Date().toISOString() }).then(() => false, (error: unknown) => describe(error).message)
    const stillListed = (await allUnits(bankId)).some((unit) => unit.id === target.id)
    const recalled = (await recallSelection(target.text.slice(0, 200), CODING_MEMORY_RECALL_BUDGET)).items.some((item) => item.id === `pm-${target.id}`)
    lifecycle.forgetMemory = { target: target.text, type: target.fact_type, before, refused, stillListed, recalled }
    check('forget memory: the coding run that used it can no longer continue', before && typeof refused === 'string', { refused })
    check('forget memory: it is no longer listed or recalled', !stillListed && !recalled)
  })
  // Edit: the receipts that sent it become stale and the pages are emptied.
  await step('edit a memory', async () => {
    const selection = await recallSelection('任务的日期怎么显示？', CODING_MEMORY_RECALL_BUDGET)
    const target = selection.selected.find((item) => !item.statement.startsWith('[observation]') && /日期|date/iu.test(item.statement)) ??
      selection.selected.find((item) => /日期|date/iu.test(item.statement))
    if (!target) throw new Error('No date memory to edit')
    const hindsightId = target.id.slice(3)
    const text = '日期显示规则（用户编辑）：7 天以内显示相对时间，超过 7 天显示 YYYY/MM/DD。'
    await client.updateMemory(bankId, hindsightId, text)
    await store.markProjectMemoryChanged(projectId, hindsightId)
    await clearKnowledgePages(client, bankId)
    const stale = await recall.assertCurrent({ projectId, userId: owner(), ids: [target.id], recalledAt: t0 }).then(() => false, () => true)
    await delay(20)
    const current = await recall.assertCurrent({ projectId, userId: owner(), ids: [target.id], recalledAt: new Date().toISOString() }).then(() => true, () => false)
    const emptied = [...(await pages(bankId)).values()].every((page) => !page.content.trim())
    let edited = false
    for (let attempt = 0; attempt < 12 && !edited; attempt += 1) {
      edited = has((await recallSelection('任务的日期怎么显示？', CODING_MEMORY_RECALL_BUDGET)).selected.map((item) => item.statement), '用户编辑')
      if (!edited) await delay(5_000)
    }
    lifecycle.edit = { target: target.statement, kind: target.statement.startsWith('[observation]') ? 'observation' : 'fact', stale, current, emptied, edited }
    check('edit: earlier receipts become stale, later ones stay valid', stale && current)
    check('edit: knowledge pages are emptied at once', emptied)
    check('edit: recall returns the edited text', edited)
  })
  // Forget a whole source: Hindsight deletes the document, and nothing derived from it stays.
  await step('forget a source', async () => {
    const row = (await bankDocuments()).find((item) => item.documentId === 'conversation:chat-bluefin')
    if (!row) throw new Error('No Bluefin document')
    const derived = (await allUnits(bankId)).filter((unit) => unit.text.includes(MARKERS.forgotten))
    await store.forgetProjectMemoryDocument(projectId, row.id)
    await clearKnowledgePages(client, bankId)
    const result = await runWorker('forget source', async () => (await bankDocuments()).find((item) => item.id === row.id)?.status === 'deleted', 10 * 60_000)
    const document = await hindsight<unknown>('GET', `${bankPath(bankId)}/documents/${encodeURIComponent(row.documentId)}`)
    await settleBank(bankId, 10 * 60_000)
    const remaining = (await allUnits(bankId)).filter((unit) => unit.text.includes(MARKERS.forgotten) || /连接池|pool limit/iu.test(unit.text))
    const recalled = [
      ...(await recallSelection('项目的内部代号是什么？', CODING_MEMORY_RECALL_BUDGET)).items,
      ...(await recallSelection('生产数据库连接池上限是多少？', CODING_MEMORY_RECALL_BUDGET)).items,
    ].filter((item) => item.statement.includes(MARKERS.forgotten) || /连接池上限|pool limit/iu.test(item.statement))
    const emptied = [...(await pages(bankId)).values()].every((page) => !page.content.trim())
    lifecycle.forgetSource = { derivedBefore: derived.map((unit) => ({ type: unit.fact_type, text: unit.text })), deleted: result.done, hindsightStatus: document.status,
      remaining: remaining.map((unit) => ({ type: unit.fact_type, text: unit.text, sources: unit.source_memory_ids?.length ?? 0 })), recalled: recalled.map((item) => item.statement) }
    check('forget source: Hindsight deleted the document', result.done && document.status === 404, { status: document.status })
    check('forget source: no fact or observation from it remains', derived.length > 0 && remaining.length === 0, { before: derived.length, remaining: remaining.length })
    check('forget source: recall no longer returns it', recalled.length === 0, { recalled: recalled.length })
    check('forget source: knowledge pages are emptied again', emptied)
  })
  // The worker writes the emptied pages again, from the remaining memory only.
  await step('pages rewritten', async () => {
    let all = await pages(bankId)
    const done = () => PROJECT_KNOWLEDGE_PAGES.every((page) => all.get(knowledgePageModelId(page.id))?.content.trim() || all.get(knowledgePageModelId(page.id))?.failedAt)
    const started = Date.now()
    while (!done() && Date.now() - started < 25 * 60_000) { await cycle(); await delay(15_000); all = await pages(bankId) }
    await settleBank(bankId, 10 * 60_000)
    all = await pages(bankId)
    const text = pageText(all)
    lifecycle.pages = PROJECT_KNOWLEDGE_PAGES.map((page) => ({ id: page.id, chars: all.get(knowledgePageModelId(page.id))?.content.length ?? 0,
      refreshedAt: all.get(knowledgePageModelId(page.id))?.refreshedAt, content: (all.get(knowledgePageModelId(page.id))?.content ?? '').slice(0, 2_000) }))
    check('pages are written again after edit and forget', done() && PROJECT_KNOWLEDGE_PAGES.every((page) => all.get(knowledgePageModelId(page.id))?.content.trim()), { ms: Date.now() - started })
    check('rewritten pages do not contain the forgotten source', !text.includes(MARKERS.forgotten) && !/连接池上限|pool limit/iu.test(text))
    observe('rewritten pages reflect the edited date rule', /YYYY\/MM\/DD|用户编辑/u.test(text))
  })
  // Off means off: no recall and no capture; on again uses the same bank.
  await step('turn memory off and on', async () => {
    const current = await config()
    const { bankId: _bank, createdAt: _created, updatedAt: _updated, ...kept } = current
    await store.configureProjectMemory({ ...kept, enabled: false })
    const off = await recall.recall({ projectId, userId: owner(), query: '撤销窗口', budget: CODING_MEMORY_RECALL_BUDGET })
    const offConfig = await config()
    const capturedOff = await store.recordProjectMemoryDocument(offConfig, { documentId: 'conversation:off-check', sourceKind: 'conversation', sourceId: 'off-check',
      title: 'off', payload: '[]', context: 'c', tags: ['source:conversation'], occurredAt: new Date().toISOString() })
    await store.configureProjectMemory({ ...kept, enabled: true })
    const on = await recall.recall({ projectId, userId: owner(), query: '撤销窗口', budget: CODING_MEMORY_RECALL_BUDGET })
    check('memory off: nothing is recalled or captured; on again: same bank', off === null && capturedOff === null && (on?.items.length ?? 0) > 0 && (await config()).bankId === bankId)
  })
}

// ======================= Phase 8: clear =======================
async function clearPhase() {
  project = (await store.listProjects()).find((item) => item.id === projectId)
  const before = await config()
  const sample = (await recallSelection('撤销窗口现在是多少秒？', CODING_MEMORY_RECALL_BUDGET)).items.slice(0, 2).map((item) => item.id)
  const recalledAt = new Date().toISOString()
  await delay(1_100)
  const after = await store.clearProjectMemory(projectId)
  const stale = await recall.assertCurrent({ projectId, userId: owner(), ids: sample, recalledAt }).then(() => false, () => true)
  check('clear: a new generation with a new bank, the old one queued for deletion', after.bankId !== before.bankId && (after.generation ?? 0) === (before.generation ?? 0) + 1 &&
    Boolean(after.pendingBankDeletions?.includes(before.bankId)))
  check('clear: everything recalled before is stale', stale)
  const deletion = await runWorker('clear', async () => !(await config()).pendingBankDeletions?.length, 5 * 60_000)
  const oldBank = await bankStats(before.bankId)
  check('clear: the old bank is deleted in Hindsight', deletion.done && oldBank.status === 404, { status: oldBank.status })
  const empty = await recall.recall({ projectId, userId: owner(), query: '撤销窗口现在是多少秒？', budget: CODING_MEMORY_RECALL_BUDGET })
  check('clear: the new bank starts empty', empty?.items.length === 0 && empty.degraded === false, { items: empty?.items.length, degraded: empty?.degraded })
  const legacy = await migrateLegacyProjectMemory(store, projectId)
  const conversation = timeline(new Date(state!.baseTime), projectId, owner(), state!.repo).conversations.find((item) => item.id === 'chat-delete-confirm')!
  const again = buildConversationMemoryDocument({ id: conversation.id, localProjectId: projectId, title: conversation.title, status: 'idle',
    updatedAt: new Date().toISOString(), messages: [...conversation.messages, { id: 'chat-delete-confirm-u9', role: 'user', text: '继续上次的讨论。', createdAt: new Date().toISOString() },
      { id: 'chat-delete-confirm-a9', role: 'assistant', text: 'OK.', createdAt: new Date().toISOString() }] }, new Date().toISOString())!
  const reRecorded = await store.recordProjectMemoryDocument(await config(), again)
  check('clear: the legacy copy and earlier sources stay forgotten', legacy?.status === 'deleted' && reRecorded?.status === 'deleted', { legacy: legacy?.status, conversation: reRecorded?.status })
  const fresh = buildConversationMemoryDocument({ id: 'chat-after-clear', localProjectId: projectId, title: '清空后的新约定', status: 'idle', updatedAt: new Date().toISOString(), messages: [
    { id: 'chat-after-clear-u', role: 'user', text: '新约定：PR 标题要加模块前缀，例如 [tasks] 或 [sync]。', createdAt: new Date().toISOString() },
    { id: 'chat-after-clear-a', role: 'assistant', text: 'Recorded: PR titles start with a module prefix such as [tasks] or [sync].', createdAt: new Date().toISOString() },
  ] }, new Date().toISOString())!
  await store.recordProjectMemoryDocument(await config(), { ...fresh, notBefore: new Date().toISOString() })
  const retained = await runWorker('after clear', async () => (await bankDocuments()).find((row) => row.documentId === 'conversation:chat-after-clear')?.status === 'retained', 10 * 60_000)
  await settleBank(after.bankId, 10 * 60_000)
  const recalled = (await recallSelection('PR 标题有什么约定？', CODING_MEMORY_RECALL_BUDGET)).selected.map((item) => item.statement)
  const old = (await recallSelection('撤销窗口现在是多少秒？', CODING_MEMORY_RECALL_BUDGET)).selected.map((item) => item.statement)
  check('clear: new memory goes to the new bank and old memory does not return', retained.done && has(recalled, /\[tasks\]|模块前缀|module prefix/iu) &&
    !has(old, /(?<![0-9.])(?:5|10|15)\s*(?:秒|seconds?)/iu), { recalled: recalled.slice(0, 2), old: old.slice(0, 2) })
  section('clear').banks = { before: before.bankId, after: after.bankId }
}

// ======================= Run =======================
const runners: Record<Phase, () => Promise<void>> = {
  seed: seedPhase, consolidate: consolidatePhase, recall: recallPhase, pages: pagesPhase, agents: agentsPhase, review: reviewPhase, capture: capturePhase,
  lifecycle: lifecyclePhase, clear: clearPhase,
}
try {
  if (fromPhase !== 'seed') {
    if (!state) throw new Error('No saved state in the work directory')
    project = (await store.listProjects()).find((item) => item.id === projectId)
    // What the desktop's worker does in its first cycle after a start: current bank settings.
    await client.configureMemoryBank((await config()).bankId, PROJECT_MEMORY_MISSIONS)
  }
  for (const name of PHASES.slice(PHASES.indexOf(fromPhase), PHASES.indexOf(toPhase) + 1)) {
    phase = name
    stage = name
    const started = Date.now()
    log('start', { capUsd: +capUsd.toFixed(4), spentUsd: +thisRun.spentUsd.toFixed(4) })
    try { await runners[name]() }
    catch (error) { check(`${name}: phase completed without error`, false, describe(error)); if (name === 'seed') throw error }
    report.timings.push({ phase: name, step: '(phase)', ms: Date.now() - started })
    await saveJson(reportPath, report)
  }
} finally {
  const summary = {
    passed: report.checks.length > 0 && report.checks.every((item) => item.passed),
    failed: report.checks.filter((item) => !item.passed).map((item) => `${item.phase}: ${item.name}`),
    checks: report.checks.length, stageSpend, spentUsd: +thisRun.spentUsd.toFixed(4),
    unsettledReservationsUsd: [...outstanding.values()].reduce((sum, value) => sum + value.bound, 0),
    relayCalls: relayCalls.length, relayFailures: relayCalls.filter((call) => call.status !== 'succeeded').map((call) => call.reason ?? call.status),
    ledgerSpentUsd: +(priorSpentUsd + thisRun.spentUsd).toFixed(4),
  }
  ;(report as Report & { lastRun?: unknown }).lastRun = { runId, phases: `${fromPhase}..${toPhase}`, finishedAt: new Date().toISOString(), ...summary }
  await relay.close()
  // Conservative: anything still reserved counts as spent.
  thisRun.spentUsd += summary.unsettledReservationsUsd
  await saveJson(ledgerPath, ledger)
  await saveJson(reportPath, report)
  if (toPhase === 'clear' && env.DEVFLOW_MEMORY_LIVE_KEEP_BANK !== '1' && state) {
    const current = await store.getProjectMemoryConfiguration(projectId)
    for (const bankId of new Set([current?.bankId, state.initialBankId].filter((value): value is string => Boolean(value)))) {
      await hindsight('DELETE', bankPath(bankId)).catch(() => undefined)
    }
  }
  store.close()
  console.log(JSON.stringify(summary, null, 2))
}
