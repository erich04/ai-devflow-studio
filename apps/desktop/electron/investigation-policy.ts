import { createHash, randomUUID } from 'node:crypto'
import { readOnlyToolFields, redactSensitiveText } from '@ai-devflow/shared'

/** User settings control one automatic batch. Cumulative safety limits are host-owned. */
export type InvestigationConfiguration = { maxSteps?: number; maxDurationMs?: number }
export type InvestigationPolicy = {
  maxSteps: number; maxDurationMs: number; source: 'default' | 'conversation'
  maxToolCalls: number; maxRequests: number; maxRecoveries: number; maxTotalToolCalls: number
  noProgressLimit: number; summaryRequests: number; summaryDurationMs: number
}
export type InvestigationStopReason = 'step_limit' | 'time_limit' | 'tool_limit' | 'no_progress' | 'request_limit' | 'recovery_limit' | 'summary_limit'
export type InvestigationBoundary = { reason: InvestigationStopReason; resumable: boolean }
type Counters = { requests: number; recoveries: number; toolCalls: number; summaryRequests: number }
type QueryFingerprint = { key: string; resultDigest: string; sourceId: string }
export type InvestigationState = {
  version: 1
  policy: InvestigationPolicy
  totals: Counters
  batch: Counters & { id: string; startedAt: number; steps: number; noProgress: number; repeatedQueries: number; reusedQueries: number }
  /** Only fingerprints and evidence IDs; never persist another copy of private source content. */
  queries: QueryFingerprint[]
  stopReason?: InvestigationStopReason
}
export type InvestigationRequest = { recovery?: boolean; summary?: boolean }
export type InvestigationQuery = {
  name: string; args: Record<string, unknown>; result: unknown; sourceId: string
  /** Host verifies whether the previous complete result is still in the actual request context. */
  evidenceAvailable: boolean
  outcome?: 'completed' | 'failed' | 'interrupted'
  /** False when the host already persisted the request attempt atomically before executing the read. */
  countRequest?: boolean
  /** Existing evidence was reused after a real freshness read; that read still consumes tool allowance. */
  reused?: boolean
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const counters = (): Counters => ({ requests: 0, recoveries: 0, toolCalls: 0, summaryRequests: 0 })
const validCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
const stop = (reason: InvestigationStopReason, resumable = true): InvestigationBoundary => ({ reason, resumable })

export function normalizeInvestigationPolicy(value?: unknown): InvestigationPolicy {
  if (value !== undefined && (!object(value) || Object.keys(value).some(key => key !== 'maxSteps' && key !== 'maxDurationMs'))) throw new Error('无效的调查执行范围。')
  const settings = value as InvestigationConfiguration | undefined
  if (settings && Object.values(settings).some(item => typeof item !== 'number')) throw new Error('调查执行范围须为整数。')
  const maxSteps = settings?.maxSteps ?? 12, maxDurationMs = settings?.maxDurationMs ?? 180000
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 60 || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 30000 || maxDurationMs > 600000) throw new Error('调查范围须为 1–60 步、30–600 秒。')
  return { maxSteps, maxDurationMs, source: settings && Object.keys(settings).length ? 'conversation' : 'default',
    maxToolCalls: maxSteps * 16, maxRequests: 240, maxRecoveries: 24, maxTotalToolCalls: 240 * 16,
    noProgressLimit: 4, summaryRequests: 2, summaryDurationMs: 30000 }
}

/** Missing state is a legacy checkpoint, but malformed existing state must not mint fresh allowance. */
export function validateInvestigationState(state: InvestigationState): void {
  if (!object(state) || state.version !== 1 || !object(state.policy) || !object(state.totals) || !object(state.batch) ||
      !Object.values(state.totals).every(validCount) || Object.keys(counters()).some(key => !validCount(state.totals[key as keyof Counters])) ||
      Object.keys(counters()).some(key => !validCount(state.batch[key as keyof Counters])) ||
      !['steps', 'noProgress', 'repeatedQueries', 'reusedQueries'].every(key => validCount(state.batch[key as 'steps'])) ||
      typeof state.batch.id !== 'string' || !state.batch.id || !validCount(state.batch.startedAt) ||
      !Array.isArray(state.queries) || state.queries.length > 256 || state.queries.some(q => !object(q) || !/^[a-f0-9]{64}$/u.test(String(q.key)) || !/^[a-f0-9]{64}$/u.test(String(q.resultDigest)) || typeof q.sourceId !== 'string' || q.sourceId.length > 240)) throw new Error('调查检查点损坏，不能安全继续。请新建问题，原记录仍保留。')
  normalizeInvestigationPolicy({ maxSteps: state.policy.maxSteps, maxDurationMs: state.policy.maxDurationMs })
}

export function beginInvestigationBatch(previous?: InvestigationState, config?: InvestigationConfiguration, nowMs = Date.now()): InvestigationState {
  if (!validCount(nowMs)) throw new Error('无效的调查时间。')
  if (previous !== undefined) validateInvestigationState(previous)
  const policy = config === undefined && previous ? { ...normalizeInvestigationPolicy({ maxSteps: previous.policy.maxSteps, maxDurationMs: previous.policy.maxDurationMs }), source: previous.policy.source } : normalizeInvestigationPolicy(config)
  return { version: 1, policy, totals: previous ? { ...previous.totals } : counters(),
    batch: { ...counters(), id: randomUUID(), startedAt: nowMs, steps: 0, noProgress: 0, repeatedQueries: 0, reusedQueries: 0 },
    queries: previous ? previous.queries.map(query => ({ ...query })) : [] }
}

/** Normal work leaves at least two attempt slots for a bounded summary. Money admission is separate. */
export function investigationBoundary(state: InvestigationState, nowMs = Date.now()): InvestigationBoundary | undefined {
  if (state.totals.requests >= state.policy.maxRequests - state.policy.summaryRequests) return stop('request_limit', false)
  if (state.totals.toolCalls >= state.policy.maxTotalToolCalls) return stop('tool_limit', false)
  if (state.batch.noProgress >= state.policy.noProgressLimit) return stop('no_progress')
  if (state.batch.steps >= state.policy.maxSteps) return stop('step_limit')
  if (state.batch.toolCalls >= state.policy.maxToolCalls) return stop('tool_limit')
  if (nowMs - state.batch.startedAt >= state.policy.maxDurationMs) return stop('time_limit')
  return undefined
}

export function canStartInvestigationRequest(state: InvestigationState, request: InvestigationRequest = {}, nowMs = Date.now()): InvestigationBoundary | undefined {
  if (state.totals.requests >= state.policy.maxRequests) return stop('request_limit', false)
  if (request.recovery && state.totals.recoveries >= state.policy.maxRecoveries) return stop('recovery_limit', false)
  if (request.summary) {
    if (state.batch.summaryRequests >= state.policy.summaryRequests || nowMs - state.batch.startedAt >= state.policy.maxDurationMs + state.policy.summaryDurationMs) return stop('summary_limit')
    return undefined
  }
  const boundary = investigationBoundary(state, nowMs)
  // A pending step may finish its already bounded recovery at the soft time boundary.
  return request.recovery && boundary?.reason === 'time_limit' ? undefined : boundary
}

/** Persist this counter before dispatch. It counts attempts, including not-sent refusals, not paid invoices. */
export function recordInvestigationRequest(state: InvestigationState, request: InvestigationRequest = {}): void {
  if (state.totals.requests >= state.policy.maxRequests - (request.summary ? 0 : state.policy.summaryRequests) || (request.recovery && state.totals.recoveries >= state.policy.maxRecoveries) || (request.summary && state.batch.summaryRequests >= state.policy.summaryRequests)) throw new Error('已达到调查累计请求或恢复上限。')
  state.totals.requests++; state.batch.requests++
  if (request.recovery) { state.totals.recoveries++; state.batch.recoveries++ }
  if (request.summary) { state.totals.summaryRequests++; state.batch.summaryRequests++ }
}

export function advanceInvestigationStep(state: InvestigationState): void { state.batch.steps++ }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]))
  return value
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(stable(value)) ?? 'undefined').digest('hex') }

/** Timestamp omission is opt-in for a host observation envelope, never recursive business data. */
export function investigationResultsEqual(left: unknown, right: unknown, hostObservationEnvelope = false): boolean {
  const withoutHostTimestamp = (value: unknown) => hostObservationEnvelope && object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'observedAt')) : value
  return digest(withoutHostTimestamp(left)) === digest(withoutHostTimestamp(right))
}

/** Only these local reads are safe to repeat for freshness. Remote search has its own source receipts. */
export function investigationCanRevalidate(name: string): boolean {
  return ['repo_list', 'repo_read', 'repo_search', 'artifact', 'requirement', 'node', 'workflow', 'knowledge_read', 'knowledge_list', 'knowledge', 'conversation_read'].includes(name)
}

export function boundInvestigationResult(value: unknown): unknown {
  if (object(value) && value.truncated === true && typeof value.excerpt === 'string' && Object.keys(value).every(key => key === 'truncated' || key === 'excerpt')) {
    return { truncated: true, excerpt: redactSensitiveText(value.excerpt).value.slice(0, 22000) }
  }
  const serialized = redactSensitiveText(JSON.stringify(value) ?? 'null').value
  return serialized.length > 22000 ? { truncated: true, excerpt: serialized.slice(0, 22000) } : JSON.parse(serialized)
}

function stableToolResult(name: string, value: unknown): unknown {
  // These two tools construct observedAt in the host. All other timestamps remain evidence.
  return ['workflow', 'node'].includes(name) && object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'observedAt')) : value
}

export function investigationObservationCurrent(observation: unknown, currentResult: unknown): boolean {
  if (!object(observation) || typeof observation.name !== 'string' || !investigationCanRevalidate(observation.name) || observation.degraded === true || !Object.hasOwn(observation, 'result') ||
      (object(observation.result) && observation.result.error) || (object(currentResult) && currentResult.error)) return false
  return investigationResultsEqual(stableToolResult(observation.name, observation.result), stableToolResult(observation.name, boundInvestigationResult(currentResult)))
}

/** This is identity normalization, not authorization. The host still validates every request and source. */
export function investigationQueryKey(name: string, args: Record<string, unknown>): string | undefined {
  const fields = readOnlyToolFields[name]
  if (!fields || Object.keys(args).some(key => ![...fields.required, ...fields.optional].includes(key)) || fields.required.some(key => typeof args[key] !== 'string' || !String(args[key]).trim())) return undefined
  const normalized = { ...args }
  if (fields.optional.includes('offset')) normalized.offset ??= 0
  if (['artifact', 'requirement', 'knowledge_read', 'conversation_read'].includes(name)) normalized.limit ??= 6000
  if (['repo_list', 'repo_search'].includes(name)) normalized.path ??= '.'
  if (typeof normalized.path === 'string') {
    if (normalized.path.includes('\\') || normalized.path.startsWith('/') || normalized.path.split('/').includes('..')) return undefined
    normalized.path = normalized.path.split('/').filter(part => part && part !== '.').join('/') || '.'
  }
  return digest({ name, args: normalized })
}

export function recordInvestigationQuery(state: InvestigationState, query: InvestigationQuery): { repeated: boolean; reused: boolean; progress: boolean; key?: string } {
  if (query.reused) state.batch.reusedQueries++
  if (query.countRequest !== false) { state.batch.toolCalls++; state.totals.toolCalls++ }
  const key = investigationQueryKey(query.name, query.args)
  const successful = (!query.outcome || query.outcome === 'completed') && !(object(query.result) && query.result.error)
  const resultDigest = digest(stableToolResult(query.name, boundInvestigationResult(query.result)))
  const previous = key ? state.queries.find(item => item.key === key && item.resultDigest === resultDigest) : undefined
  const repeated = Boolean(successful && previous && query.evidenceAvailable)
  if (repeated) { state.batch.noProgress++; state.batch.repeatedQueries++ }
  else if (successful) state.batch.noProgress = 0
  if (successful && key) {
    state.queries = [...state.queries.filter(item => item.key !== key), { key, resultDigest, sourceId: query.sourceId.slice(0, 240) }].slice(-256)
  }
  return { repeated, reused: Boolean(query.reused), progress: successful && !repeated, ...(key ? { key } : {}) }
}

export function investigationProgress(state: InvestigationState) {
  return { version: 1 as const, policy: { ...state.policy }, totals: { ...state.totals }, batch: { ...state.batch }, ...(state.stopReason ? { stopReason: state.stopReason } : {}) }
}

export function investigationStopDescription(reason: InvestigationStopReason): string {
  return { step_limit: '已达到本批调查步数', time_limit: '已达到本批调查时间', tool_limit: '已达到查询次数边界', no_progress: '多次查询没有获得新的可见证据', request_limit: '已达到此问题的累计请求上限', recovery_limit: '已达到此问题的累计自动恢复上限', summary_limit: '阶段总结的请求或时间额度已用完' }[reason]
}

export function localInvestigationSummary(state: InvestigationState, citations: ReadonlyArray<{ id: string; label: string; excerpt?: string }>, reason: InvestigationStopReason): string {
  const sources = citations.slice(-8).map(citation => `- ${redactSensitiveText(citation.label).value.slice(0, 180)}（${citation.id.slice(0, 240)}）`).join('\n')
  const hard = reason === 'request_limit' || reason === 'recovery_limit' || (reason === 'tool_limit' && state.totals.toolCalls >= state.policy.maxTotalToolCalls)
  return `调查已暂停：${investigationStopDescription(reason)}。\n\n尚未生成模型总结；下列内容仅为宿主保存的执行进展，不能视为问题已解决或提案已核验。\n\n本批完成 ${state.batch.steps} 个步骤，执行 ${state.batch.toolCalls} 次查询；本问题累计 ${state.totals.requests} 次请求尝试。${sources ? `\n\n已保存的来源：\n${sources}` : '\n\n目前没有可引用的查询来源。'}\n\n尚未完成：根据这些来源给出完整答复，并核实仍缺失或已过期的依据。${hard ? '此问题已到累计安全边界，请缩小范围并发送一个新问题。' : '可以继续调查；将先核实来源是否仍有效，再从保存的位置继续。'}`
}
