import { estimateAgentTokenUsage } from './agent-review'
import { resolveDeepSeekPricingSnapshot, rollupTokenUsage, runtimeCostSummaryToTokenUsage, type TokenUsageRollup } from './cost'
import type { AgentProviderUsage, BudgetGuardDecision, TokenUsage, CodingRuntimeCostSummary } from './domain'
import { buildModelCostRecords, canonicalFinancialValue, type ModelCostEvent, type ModelCostRecord } from './model-cost-recovery'

/** Financial metadata only: never prompts, responses, API keys or conversation text. */
export type ModelTaskBudget = { rootId: string; taskId: string; parentTaskId?: string; maxTokens: number; maxCostUsd: number; rootMaxTokens: number; rootMaxCostUsd: number }
export type ModelCallQuote = {
  id: string; projectId: string; providerId: string; model: string; createdAt: string
  inputTokens: number; maxOutputTokens: number | null
  boundBasis?: 'deepseek-context-v1'
  operation?: { id: string; version: string; purpose: string }
  continuationId?: string
  task?: ModelTaskBudget
  billingProvider: 'deepseek' | 'openai_compatible'; approvalId?: string
}
export type ModelCallSettlement = {
  id: string; projectId: string; state: 'completed' | 'failed' | 'cancelled' | 'not_sent'
  usage?: AgentProviderUsage
}
export type ModelCallAttempt = ModelCallQuote & {
  userId: string; state: 'reserved' | ModelCallSettlement['state']; projectedCostUsd: number | null
  costUsd: number | null; usage?: AgentProviderUsage
  verifiedBound?: VerifiedModelCallBound
  remoteEnded?: boolean
  usageObservation?: AgentProviderUsage
  pendingSettlement?: ModelCallSettlement
  pendingSettlementFinal?: boolean
}
export type VerifiedModelCallBound = { costUsd: number; inputTokenBound: number; maxOutputTokens: number; priceVersion: string; basis: 'deepseek-context-v1' }
/** Full supported context capacity is an upper bound; UTF-8(prompt)+overhead is only an estimate. */
export function verifiedModelCallBound(quote: ModelCallQuote): VerifiedModelCallBound | null {
  if (quote.boundBasis !== 'deepseek-context-v1' || quote.billingProvider !== 'deepseek' ||
    !['deepseek-flash', 'deepseek-pro'].includes(quote.model) || !quote.maxOutputTokens || quote.maxOutputTokens > 393216 || quote.inputTokens > 1048576) return null
  const price = resolveDeepSeekPricingSnapshot({ providerId: 'deepseek', model: quote.model, timestamp: quote.createdAt, worstCase: true })
  if (!price) return null
  return { basis: quote.boundBasis, inputTokenBound: 1048576, maxOutputTokens: quote.maxOutputTokens, priceVersion: price.sourceVersion,
    costUsd: (1048576 * price.cacheMissInputUsdPerMillion + quote.maxOutputTokens * price.outputUsdPerMillion) / 1_000_000 }
}

export type ModelCallAdmission = { accepted: boolean; decision: BudgetGuardDecision }

/** Older failed/no-usage entries can be pre-dispatch markers, not final failures. */
export function isFinalModelCallSettlement(settlement: ModelCallSettlement | undefined, final?: boolean): settlement is ModelCallSettlement {
  return Boolean(settlement && (final ?? (settlement.state !== 'failed' || Boolean(settlement.usage))))
}

export function parseBudgetAttemptIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 512 || value.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(id)) || new Set(value).size !== value.length) throw new Error('Invalid model call accounting references')
  return value
}
export function parseModelCallQuote(value: unknown): ModelCallQuote {
  if (!value || typeof value !== 'object') throw new Error('Invalid model call quote')
  const v = value as ModelCallQuote
  if (['id','projectId','providerId','model','createdAt'].some((key) => typeof v[key as keyof ModelCallQuote] !== 'string' || !String(v[key as keyof ModelCallQuote]).trim() || String(v[key as keyof ModelCallQuote]).length > 512) ||
      !/^[a-zA-Z0-9_-]{1,160}$/u.test(v.id) || !Number.isFinite(Date.parse(v.createdAt)) || !Number.isSafeInteger(v.inputTokens) || v.inputTokens < 0 || v.inputTokens > 2_000_000 ||
      (v.maxOutputTokens !== null && (!Number.isSafeInteger(v.maxOutputTokens) || v.maxOutputTokens < 1 || v.maxOutputTokens > 1_000_000)) || !['deepseek','openai_compatible'].includes(v.billingProvider) ||
      (v.approvalId !== undefined && (typeof v.approvalId !== 'string' || v.approvalId.length > 512))) throw new Error('Invalid model call quote')
  if (v.boundBasis !== undefined && v.boundBasis !== 'deepseek-context-v1') throw new Error('Invalid bound basis')
  if (v.continuationId !== undefined) parseBudgetAttemptIds([v.continuationId])
  if (v.operation) {
    parseBudgetAttemptIds([v.operation.id])
    if (!/^[a-f0-9]{64}$/u.test(v.operation.version) || !['conversation','proposal','review','workflow','native-tool','coding','coding-compaction'].includes(v.operation.purpose)) throw new Error('Invalid operation scope')
  }
  if (v.task) {
    parseBudgetAttemptIds([...new Set([v.task.rootId, v.task.taskId, ...(v.task.parentTaskId ? [v.task.parentTaskId] : [])])])
    for (const key of ['maxTokens','rootMaxTokens'] as const) if (!Number.isSafeInteger(v.task[key]) || v.task[key] < 1 || v.task[key] > 1_000_000_000) throw new Error('Invalid task token budget')
    for (const key of ['maxCostUsd','rootMaxCostUsd'] as const) if (!Number.isFinite(v.task[key]) || v.task[key] < 0 || v.task[key] > 1000000) throw new Error('Invalid task cost budget')
    if (v.task.maxCostUsd > v.task.rootMaxCostUsd || v.task.maxTokens > v.task.rootMaxTokens || (v.task.taskId === v.task.rootId) === Boolean(v.task.parentTaskId) || (v.task.parentTaskId && v.task.parentTaskId !== v.task.rootId)) throw new Error('Invalid task budget hierarchy')
  }
  return { id:v.id, projectId:v.projectId, providerId:v.providerId, model:v.model, createdAt:v.createdAt, inputTokens:v.inputTokens, maxOutputTokens:v.maxOutputTokens, billingProvider:v.billingProvider, ...(v.task ? { task: { ...v.task } } : {}), ...(v.boundBasis ? { boundBasis: v.boundBasis } : {}), ...(v.operation ? { operation: { ...v.operation } } : {}), ...(v.continuationId ? { continuationId: v.continuationId } : {}), ...(v.approvalId ? {approvalId:v.approvalId} : {}) }
}

/** Called within the same project-budget transaction as admission; never grants another allowance. */
export function modelTaskBudgetBlock(quote: ModelCallQuote, attempts: ModelCallAttempt[], userId: string, nextCost: number | null, effectiveCosts = new Map<string, number | null>()): string | null {
  const task = quote.task
  if (!task) return null
  parseModelCallQuote(quote)
  const group = attempts.filter(row => row.task?.rootId === task.rootId)
  if (group.some(row => row.projectId !== quote.projectId || row.userId !== userId || row.providerId !== quote.providerId || row.model !== quote.model || row.task!.rootMaxTokens !== task.rootMaxTokens || row.task!.rootMaxCostUsd !== task.rootMaxCostUsd)) throw new Error('Task budget scope is immutable')
  if (task.parentTaskId && !group.some(row => row.task?.taskId === task.rootId)) throw new Error('Root task must be admitted before delegation')
  const own = group.filter(row => row.task?.taskId === task.taskId)
  if (own.some(row => canonicalFinancialValue(row.task) !== canonicalFinancialValue(task))) throw new Error('Task budget is immutable')
  const costOf = (row: ModelCallAttempt): number => {
    if (row.state === 'not_sent') return 0
    const actual = effectiveCosts.has(row.id) ? effectiveCosts.get(row.id) : row.costUsd
    return actual ?? row.verifiedBound?.costUsd ?? (row.state === 'reserved' ? row.projectedCostUsd ?? Infinity : Infinity)
  }
  const tokensOf = (row: ModelCallAttempt) => row.state === 'not_sent' ? 0 : row.usage?.usageCompleteness !== 'partial' && row.usage?.inputTokens !== undefined && row.usage?.outputTokens !== undefined
    ? row.usage.inputTokens + row.usage.outputTokens : (row.verifiedBound?.inputTokenBound ?? row.inputTokens) + (row.maxOutputTokens ?? Infinity)
  const nextTokens = (verifiedModelCallBound(quote)?.inputTokenBound ?? quote.inputTokens) + (quote.maxOutputTokens ?? Infinity)
  if (group.reduce((sum, row) => sum + costOf(row), 0) + (nextCost ?? Infinity) > task.rootMaxCostUsd + 1e-9 || group.reduce((sum, row) => sum + tokensOf(row), 0) + nextTokens > task.rootMaxTokens) return '总任务预算不足；子任务、压缩及未知费用仍计入总额度。'
  if (own.reduce((sum, row) => sum + costOf(row), 0) + (nextCost ?? Infinity) > task.maxCostUsd + 1e-9 || own.reduce((sum, row) => sum + tokensOf(row), 0) + nextTokens > task.maxTokens) return '当前子任务预算不足；不能重新命名请求来重置额度。'
  return null
}
export function parseModelCallSettlement(value: unknown): ModelCallSettlement {
  if (!value || typeof value !== 'object') throw new Error('Invalid model call settlement')
  const v = value as ModelCallSettlement
  parseBudgetAttemptIds([v.id])
  if (typeof v.projectId !== 'string' || !v.projectId || v.projectId.length > 512 || !['completed','failed','cancelled','not_sent'].includes(v.state)) throw new Error('Invalid model call settlement')
  let usage: AgentProviderUsage | undefined
  if (v.usage !== undefined) {
    if (!v.usage || typeof v.usage !== 'object' || Array.isArray(v.usage)) throw new Error('Invalid model call usage')
    usage = {}
    if (v.usage.usageCompleteness !== undefined) {
      if (!['partial', 'final'].includes(v.usage.usageCompleteness)) throw new Error('Invalid usage completeness')
      usage.usageCompleteness = v.usage.usageCompleteness
    }
    for (const key of ['inputTokens','outputTokens','cacheReadTokens','cacheMissTokens','totalTokens','missingUsageCount'] as const) {
      const n = v.usage[key]
      if (n !== undefined) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid model call usage'); usage[key]=n }
    }
    if (v.usage.cacheStatus !== undefined) {
      if (!['complete','unknown'].includes(v.usage.cacheStatus)) throw new Error('Invalid cache status')
      usage.cacheStatus=v.usage.cacheStatus
    }
    if (usage.inputTokens !== undefined && usage.outputTokens !== undefined && usage.totalTokens !== undefined && usage.inputTokens + usage.outputTokens !== usage.totalTokens) throw new Error('Invalid total usage')
    if (usage.cacheReadTokens !== undefined && usage.inputTokens !== undefined && usage.cacheReadTokens > usage.inputTokens) throw new Error('Invalid cache usage')
  }
  return { id:v.id, projectId:v.projectId, state:v.state, ...(usage ? {usage} : {}) }
}
export function projectedModelCallCost(quote: ModelCallQuote): number | null {
  if (quote.maxOutputTokens === null) return null
  if (quote.billingProvider === 'deepseek') {
    const price=resolveDeepSeekPricingSnapshot({providerId:'deepseek',model:quote.model,timestamp:quote.createdAt,worstCase:true})
    return price ? (quote.inputTokens*price.cacheMissInputUsdPerMillion+quote.maxOutputTokens*price.outputUsdPerMillion)/1_000_000 : null
  }
  return estimateAgentTokenUsage({id:quote.id,runId:'',nodeId:'',projectId:quote.projectId,userId:'',provider:'openai',model:quote.model,prompt:'',completion:'',timestamp:quote.createdAt,providerUsage:{inputTokens:quote.inputTokens,outputTokens:quote.maxOutputTokens}}).costUsd
}
export function settledModelCallCost(attempt: ModelCallQuote, settlement: ModelCallSettlement): number | null {
  if (settlement.state === 'not_sent') return 0
  const u=settlement.usage
  if (u?.usageCompleteness === 'partial' || u?.inputTokens === undefined || u.outputTokens === undefined || u.missingUsageCount) return null
  return estimateAgentTokenUsage({id:attempt.id,runId:'',nodeId:'',projectId:attempt.projectId,userId:'',provider:'openai',model:attempt.model,prompt:'',completion:'',timestamp:attempt.createdAt,providerUsage:{...u,billingProvider:attempt.billingProvider}}).costUsd
}
/** Actual call IDs deduplicate the same consumption projected as stage/review/coding evidence. */
export function modelCallBudgetRollup(legacy: TokenUsage[], calls: ModelCallAttempt[], now: string, events: ModelCostEvent[] = []): TokenUsageRollup[] {
  return rollupTokenUsage(buildModelCostRecords(legacy, calls, events, now).filter(row => row.affectsCurrentBudget)
    .map(record => ({ ...costRecordUsage(record, legacy), costUsd: record.budgetCostUsd, timestamp: now })), 'projectId')
}

/** Preserve old unknown costs and split mixed old/new coding calls before deduplication. */
export function modelBudgetUsageWithRuntime(
  legacy: TokenUsage[], summaries: CodingRuntimeCostSummary[],
): TokenUsage[] {
  const rows = new Map(legacy.map((row) => [row.id, row]))
  for (const summary of summaries) {
    const id = summary.id ?? `coding-runtime-cost-${summary.runId}-${summary.nodeId}`
    rows.delete(id)
    if (summary.phase === 'preflight_estimate') continue
    const calls = summary.providerCallSettlements
    const parts: CodingRuntimeCostSummary[] = calls?.length
      ? calls.map((call, index) => ({
          ...summary, ...call, id: `${id}-call-${index}`, phase: 'provider_settlement',
          // An aggregate's call IDs must never hide an ungoverned historical call.
          budgetAttemptIds: call.budgetAttemptIds ?? [],
        }))
      : [summary]
    for (const part of parts) {
      const confirmed = runtimeCostSummaryToTokenUsage(part)
      const hasTokens = part.usageStatus !== 'legacy_unknown' &&
        [part.inputTokens, part.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)
      const row: TokenUsage = confirmed ?? {
        id: part.id ?? id, runId: part.runId, nodeId: part.nodeId,
        userId: part.userId, projectId: part.projectId, provider: part.provider,
        model: part.model, timestamp: part.timestamp, costUsd: null,
        inputTokens: hasTokens ? part.inputTokens : 0,
        outputTokens: hasTokens ? part.outputTokens : 0,
        cacheReadTokens: hasTokens ? part.cacheReadTokens ?? 0 : 0,
        usageStatus: hasTokens ? 'complete' : 'unknown',
        ...(part.budgetAttemptIds?.length ? { budgetAttemptIds: part.budgetAttemptIds } : {}),
      }
      rows.set(row.id, row)
    }
  }
  return [...rows.values()]
}
export type HistoricalModelCall = {quote:ModelCallQuote;settlement:ModelCallSettlement}

/** Actual spend for team reporting; in-flight reservations belong only to budget admission. */
export function modelCallActualUsage(legacy: TokenUsage[], calls: ModelCallAttempt[], events: ModelCostEvent[] = []): TokenUsage[] {
  return buildModelCostRecords(legacy, calls, events, new Date().toISOString()).filter(row => !row.isReservation)
    .map(record => costRecordUsage(record, legacy))
}

function costRecordUsage(record: ModelCostRecord, legacy: TokenUsage[]): TokenUsage {
  const original = record.sourceKind === 'legacy_usage' ? legacy.find(row => row.id === record.sourceId && row.projectId === record.projectId) : undefined
  return { ...original, id: record.sourceId, projectId: record.projectId, userId: record.originalUserId,
    runId: original?.runId ?? '', nodeId: original?.nodeId ?? '', provider: original?.provider ?? 'openai', model: record.model,
    timestamp: record.createdAt, inputTokens: record.usage?.inputTokens ?? 0, outputTokens: record.usage?.outputTokens ?? 0,
    cacheReadTokens: record.usage?.cacheReadTokens ?? 0, costUsd: record.costUsd,
    usageStatus: record.usageKnown ? 'complete' : 'unknown',
    ...(record.sourceKind === 'model_call' ? { budgetAttemptIds: [record.sourceId] } : {}) }
}
