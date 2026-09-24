import { estimateAgentTokenUsage } from './agent-review'
import { resolveDeepSeekPricingSnapshot, rollupTokenUsage, runtimeCostSummaryToTokenUsage, type TokenUsageRollup } from './cost'
import type { AgentProviderUsage, BudgetGuardDecision, TokenUsage, CodingRuntimeCostSummary } from './domain'

/** Financial metadata only: never prompts, responses, API keys or conversation text. */
export type ModelCallQuote = {
  id: string; projectId: string; providerId: string; model: string; createdAt: string
  inputTokens: number; maxOutputTokens: number | null
  billingProvider: 'deepseek' | 'openai_compatible'; approvalId?: string
}
export type ModelCallSettlement = {
  id: string; projectId: string; state: 'completed' | 'failed' | 'cancelled' | 'not_sent'
  usage?: AgentProviderUsage
}
export type ModelCallAttempt = ModelCallQuote & {
  userId: string; state: 'reserved' | ModelCallSettlement['state']; projectedCostUsd: number | null
  costUsd: number | null; usage?: AgentProviderUsage
  pendingSettlement?: ModelCallSettlement
}
export type ModelCallAdmission = { accepted: boolean; decision: BudgetGuardDecision }

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
  return { id:v.id, projectId:v.projectId, providerId:v.providerId, model:v.model, createdAt:v.createdAt, inputTokens:v.inputTokens, maxOutputTokens:v.maxOutputTokens, billingProvider:v.billingProvider, ...(v.approvalId ? {approvalId:v.approvalId} : {}) }
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
  if (u?.inputTokens === undefined || u.outputTokens === undefined || u.missingUsageCount) return null
  return estimateAgentTokenUsage({id:attempt.id,runId:'',nodeId:'',projectId:attempt.projectId,userId:'',provider:'openai',model:attempt.model,prompt:'',completion:'',timestamp:attempt.createdAt,providerUsage:{...u,billingProvider:attempt.billingProvider}}).costUsd
}
/** Actual call IDs deduplicate the same consumption projected as stage/review/coding evidence. */
export function modelCallBudgetRollup(legacy: TokenUsage[], calls: ModelCallAttempt[], now: string): TokenUsageRollup[] {
  const month=now.slice(0,7)
  const known=new Map(calls.map((call)=>[call.id,call]))
  const rows=legacy.filter((row)=>row.timestamp.slice(0,7)===month && !(row.budgetAttemptIds?.length && row.budgetAttemptIds.every((id)=>known.get(id)?.projectId===row.projectId)))
  const result=new Map(rollupTokenUsage(rows,'projectId').map((row)=>[row.key,row]))
  for (const call of calls.filter((row)=>row.createdAt.slice(0,7)===month)) {
    const row=result.get(call.projectId) ?? {key:call.projectId,inputTokens:0,outputTokens:0,cacheReadTokens:0,totalTokens:0,costUsd:0}
    const cost=call.state==='reserved' ? (Date.parse(now)-Date.parse(call.createdAt)>10*60_000 ? null : call.projectedCostUsd) : call.costUsd
    row.inputTokens+=call.usage?.inputTokens??0; row.outputTokens+=call.usage?.outputTokens??0; row.cacheReadTokens+=call.usage?.cacheReadTokens??0
    row.totalTokens+=(call.usage?.inputTokens??0)+(call.usage?.outputTokens??0)
    if (cost===null) row.unknownCostCount=(row.unknownCostCount??0)+1; else row.costUsd+=cost
    result.set(row.key,row)
  }
  return [...result.values()]
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
        ...(part.budgetAttemptIds?.length ? { budgetAttemptIds: part.budgetAttemptIds } : {}),
      }
      rows.set(row.id, row)
    }
  }
  return [...rows.values()]
}
export type HistoricalModelCall = {quote:ModelCallQuote;settlement:ModelCallSettlement}

/** Actual spend for team reporting; in-flight reservations belong only to budget admission. */
export function modelCallActualUsage(legacy: TokenUsage[], calls: ModelCallAttempt[]): TokenUsage[] {
  const known = new Map(calls.map((call) => [call.id, call]))
  const rows = legacy.filter((row) => !(row.budgetAttemptIds?.length && row.budgetAttemptIds.every((id) => known.get(id)?.projectId === row.projectId)))
  return [...rows, ...calls.filter((call) => call.state !== 'reserved').map((call): TokenUsage => ({
    id: call.id, projectId: call.projectId, userId: call.userId, runId: '', nodeId: '',
    provider: 'openai', model: call.model,
    timestamp: call.createdAt, inputTokens: call.usage?.inputTokens ?? 0,
    outputTokens: call.usage?.outputTokens ?? 0, cacheReadTokens: call.usage?.cacheReadTokens ?? 0,
    costUsd: call.costUsd, budgetAttemptIds: [call.id],
  }))]
}
