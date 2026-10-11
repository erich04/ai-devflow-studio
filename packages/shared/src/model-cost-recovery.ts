import type { AgentProviderUsage, TokenUsage } from './domain'
import { settledModelCallCost, isFinalModelCallSettlement, parseModelCallSettlement, type ModelCallAttempt, type ModelCallSettlement } from './model-call-budget'
import { redactSensitiveText } from './redaction'

export type ModelCostSourceKind = 'model_call' | 'legacy_usage'
export type ModelCostReconciliationInput = {
  projectId: string; sourceKind: ModelCostSourceKind; sourceId: string
  expectedVersion: string; idempotencyKey: string
  costUsd?: number; usage?: AgentProviderUsage
  reason: string; evidence: string; evidenceKind: 'provider_bill' | 'provider_usage' | 'not_sent'
  executionStatus: 'ended' | 'not_sent'
}
type CostEventIdentity = {
  id: string; projectId: string; sourceKind: ModelCostSourceKind; sourceId: string
  originalUserId: string; actorId: string; createdAt: string
}
export type ModelCostEvent = (CostEventIdentity & ModelCostReconciliationInput & {
  kind: 'reconciliation'; costUsd: number; requestFingerprint?: string
}) | (CostEventIdentity & {
  kind: 'settlement_conflict' | 'settlement_confirmation'; settlement: ModelCallSettlement
})
export type ModelCallSettlementReceipt = {
  status: 'settled' | 'duplicate' | 'confirmed' | 'conflict_recorded'
  id: string; projectId: string; conflictId?: string; confirmationId?: string
}
export type ModelCallAccountingScope = { organizationId: string; userId: string; teamProjectId: string; localProjectId: string }
export type StoredModelCallSettlement = {
  settlement: ModelCallSettlement; final: boolean; scope?: ModelCallAccountingScope
  receipt?: ModelCallSettlementReceipt
}
export type DesktopModelCostRecovery = {
  overview: ModelCostRecoveryOverview
  local: { id: string; state: 'running' | 'upload_failed' | 'conflict' | 'scope_mismatch' | 'identity_unverified'; canRetry: boolean }[]
}

export function parseModelCallSettlementReceipt(value: unknown, input: Pick<ModelCallSettlement, 'id' | 'projectId'>): ModelCallSettlementReceipt {
  const v = value as ModelCallSettlementReceipt | null
  const validId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/u.test(id)
  if (!v || v.id !== input.id || v.projectId !== input.projectId || !['settled', 'duplicate', 'confirmed', 'conflict_recorded'].includes(v.status) ||
    (v.status === 'conflict_recorded' && !validId(v.conflictId)) || (v.status === 'confirmed' && !validId(v.confirmationId))) throw new Error('用量同步回执无效，已保留本地记录。')
  return { id: v.id, projectId: v.projectId, status: v.status,
    ...(v.status === 'conflict_recorded' ? { conflictId: v.conflictId } : {}), ...(v.status === 'confirmed' ? { confirmationId: v.confirmationId } : {}) }
}
export type ModelCostRecord = {
  projectId: string; sourceKind: ModelCostSourceKind; sourceId: string; originalUserId: string
  model: string; providerId: string; createdAt: string; version: string
  originalState: string; originalCostUsd: number | null; costUsd: number | null
  budgetCostUsd: number | null; verifiedHoldUsd?: number
  usage?: AgentProviderUsage; usageKnown: boolean; isReservation: boolean
  status: 'settled' | 'running' | 'stale_reservation' | 'upload_pending' | 'missing_usage' | 'missing_pricing' | 'conflict'
  affectsCurrentBudget: boolean; canReconcile: boolean
  events: ModelCostEvent[]; unresolvedConflictIds: string[]
}
export type ModelCostRecoveryOverview = {
  projectId: string; month: string; asOf: string
  actualCostUsd: number; actualUnknownCount: number
  pendingBoundedCostUsd?: number
  reservedCostUsd: number; reservedUnknownCount: number; reviewCount: number
  records: ModelCostRecord[]
}
export const modelCostStatusLabels: Record<ModelCostRecord['status'], string> = {
  settled: '费用已确认', running: '执行中预留', stale_reservation: '长时间未结算（执行状态待核实）',
  upload_pending: '最终结果待同步', missing_usage: '缺少完整用量', missing_pricing: '缺少定价依据', conflict: '迟到结算冲突',
}

export function canonicalFinancialValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFinancialValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalFinancialValue(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Reject identity overrides and sensitive evidence instead of storing a partially redacted audit. */
export function parseModelCostReconciliation(value: unknown): ModelCostReconciliationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cost reconciliation')
  const v = value as Record<string, unknown>
  const allowed = new Set(['projectId', 'sourceKind', 'sourceId', 'expectedVersion', 'idempotencyKey', 'costUsd', 'usage', 'reason', 'evidence', 'evidenceKind', 'executionStatus'])
  if (Object.keys(v).some(key => !allowed.has(key))) throw new Error('Invalid cost reconciliation field')
  const string = (key: string, max: number) => {
    const text = v[key]
    if (typeof text !== 'string' || !text.trim() || text.length > max || /[\u0000-\u001f]/u.test(text)) throw new Error('Invalid cost reconciliation text')
    return text.trim()
  }
  const projectId = string('projectId', 512), sourceId = string('sourceId', 512), expectedVersion = string('expectedVersion', 8192)
  const idempotencyKey = string('idempotencyKey', 160), reason = string('reason', 500), evidence = string('evidence', 1000)
  if (!/^[a-zA-Z0-9_-]+$/u.test(idempotencyKey) || !['model_call', 'legacy_usage'].includes(String(v.sourceKind)) ||
    !['provider_bill', 'provider_usage', 'not_sent'].includes(String(v.evidenceKind)) || !['ended', 'not_sent'].includes(String(v.executionStatus))) throw new Error('Invalid cost reconciliation evidence')
  if ([reason, evidence].some(text => redactSensitiveText(text).redacted || /(?:Bearer\s|sk-[a-zA-Z0-9]|\/Users\/|\/home\/|[A-Z]:\\)/iu.test(text))) throw new Error('核对依据只能包含非敏感的账单或用量引用。')
  if (v.costUsd !== undefined && (typeof v.costUsd !== 'number' || !Number.isFinite(v.costUsd) || v.costUsd < 0 || v.costUsd > 1_000_000_000)) throw new Error('Invalid reconciled cost')
  const usage = v.usage === undefined ? undefined : parseModelCallSettlement({ id: 'validation', projectId, state: 'completed', usage: v.usage }).usage
  if (usage && (usage.inputTokens === undefined || usage.outputTokens === undefined || usage.missingUsageCount)) throw new Error('核定用量必须完整；仅金额确定时请不要填写 Token。')
  if (v.costUsd === undefined && !usage) throw new Error('需要核定费用或完整用量。')
  if ((v.evidenceKind === 'not_sent') !== (v.executionStatus === 'not_sent') || (v.executionStatus === 'not_sent' && (v.costUsd !== 0 || usage))) throw new Error('未发送证明只能核定零费用，不能附带已消费用量。')
  if (v.costUsd === 0 && v.evidenceKind === 'provider_usage') throw new Error('核定零费用需要提供方账单或未发送证明。')
  return { projectId, sourceKind: v.sourceKind as ModelCostSourceKind, sourceId, expectedVersion, idempotencyKey,
    ...(v.costUsd === undefined ? {} : { costUsd: v.costUsd as number }), ...(usage ? { usage } : {}),
    reason, evidence, evidenceKind: v.evidenceKind as ModelCostReconciliationInput['evidenceKind'], executionStatus: v.executionStatus as ModelCostReconciliationInput['executionStatus'] }
}

function hasUsage(usage: AgentProviderUsage | undefined): boolean {
  return usage?.usageCompleteness !== 'partial' && usage?.inputTokens !== undefined && usage.outputTokens !== undefined && !usage.missingUsageCount
}

/** Call IDs and project scope use the same deduplication for the budget, reports and recovery list. */
export function uncoveredLegacyModelUsage(legacy: TokenUsage[], calls: ModelCallAttempt[]): TokenUsage[] {
  const known = new Map(calls.map(call => [call.id, call]))
  return legacy.filter(row => !(row.budgetAttemptIds?.length && row.budgetAttemptIds.every(id => known.get(id)?.projectId === row.projectId)))
}

export function buildModelCostRecords(legacy: TokenUsage[], calls: ModelCallAttempt[], events: ModelCostEvent[], now: string): ModelCostRecord[] {
  const bases = [
    ...uncoveredLegacyModelUsage(legacy, calls).map(row => ({
      sourceKind: 'legacy_usage' as const, sourceId: row.id, projectId: row.projectId, originalUserId: row.userId,
      model: row.model, providerId: row.provider, createdAt: row.timestamp, originalState: 'historical', originalCostUsd: row.costUsd,
      usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens,
        ...((row.usageStatus && row.usageStatus !== 'complete') || ('source' in row && row.source === 'unknown') ||
          (!row.usageStatus && row.costUsd === null && row.inputTokens === 0 && row.outputTokens === 0) ? { missingUsageCount: 1 } : {}) } as AgentProviderUsage | undefined,
      reservation: false, pending: false, projectedCostUsd: null as number | null, verifiedBound: undefined as ModelCallAttempt['verifiedBound'], remoteEnded: true,
    })),
    ...calls.map(call => ({
      sourceKind: 'model_call' as const, sourceId: call.id, projectId: call.projectId, originalUserId: call.userId,
      model: call.model, providerId: call.providerId, createdAt: call.createdAt, originalState: call.state,
      originalCostUsd: call.costUsd, usage: call.usage ?? call.pendingSettlement?.usage ?? call.usageObservation, reservation: call.state === 'reserved',
      verifiedBound: call.verifiedBound, remoteEnded: call.remoteEnded ?? (call.state === 'completed' || call.state === 'not_sent'),
      pending: isFinalModelCallSettlement(call.pendingSettlement, call.pendingSettlementFinal), projectedCostUsd: call.projectedCostUsd,
    })),
  ]
  return bases.map(base => {
    const history = events.filter(event => event.projectId === base.projectId && event.sourceKind === base.sourceKind && event.sourceId === base.sourceId)
    const lastReconciliationIndex = history.reduce((last, event, index) => event.kind === 'reconciliation' ? index : last, -1)
    const reconciliation = history[lastReconciliationIndex]
    const correction = reconciliation?.kind === 'reconciliation' ? reconciliation : undefined
    const unresolvedConflictIds = history.slice(lastReconciliationIndex + 1).filter(event => event.kind === 'settlement_conflict').map(event => event.id)
    const versionBase = { ...base, model: redactSensitiveText(base.model).value, providerId: redactSensitiveText(base.providerId).value }
    if (correction && base.sourceKind === 'legacy_usage') {
      try {
        const comparable = (value: Record<string, unknown>) => { const { remoteEnded: _, ...rest } = value; return canonicalFinancialValue(rest) }
        if (comparable(JSON.parse(correction.expectedVersion)[0]) !== comparable(versionBase)) unresolvedConflictIds.push('source_changed')
      } catch { unresolvedConflictIds.push('source_changed') }
    }
    const stale = base.reservation && Date.parse(now) - Date.parse(base.createdAt) > 10 * 60_000
    const isReservation = base.reservation && !correction
    const confirmation = history.slice(lastReconciliationIndex + 1).reverse().find(event => event.kind === 'settlement_confirmation')
    const confirmedCost = confirmation?.kind === 'settlement_confirmation' && base.sourceKind === 'model_call'
      ? calls.find(call => call.id === base.sourceId && call.projectId === base.projectId) : undefined
    const lateCost = confirmedCost && confirmation?.kind === 'settlement_confirmation'
      ? settledModelCallCost(confirmedCost, confirmation.settlement) : null
    const costUsd = unresolvedConflictIds.length ? null : correction?.costUsd ?? lateCost ?? base.originalCostUsd
    const boundBreached = !correction && base.verifiedBound && ((costUsd !== null && costUsd > base.verifiedBound.costUsd + 1e-9) ||
      (base.usage?.inputTokens ?? 0) > base.verifiedBound.inputTokenBound || (base.usage?.outputTokens ?? 0) > base.verifiedBound.maxOutputTokens)
    if (boundBreached) unresolvedConflictIds.push('verified_bound_exceeded')
    const verifiedHold = !unresolvedConflictIds.length && !boundBreached ? base.verifiedBound?.costUsd : undefined
    const budgetCostUsd = unresolvedConflictIds.length || boundBreached ? null : costUsd ?? verifiedHold ?? null
    const confirmed = history.slice(lastReconciliationIndex + 1).reverse().find(event => event.kind === 'settlement_confirmation' && hasUsage(event.settlement.usage))
    const usage = correction?.usage ?? (confirmed?.kind === 'settlement_confirmation' ? confirmed.settlement.usage : undefined) ?? base.usage
    const status: ModelCostRecord['status'] = unresolvedConflictIds.length ? 'conflict' : correction ? 'settled' :
      base.pending ? 'upload_pending' : isReservation ? (stale ? 'stale_reservation' : 'running') :
        costUsd !== null ? 'settled' : hasUsage(usage) ? 'missing_pricing' : 'missing_usage'
    return {
      projectId: base.projectId, sourceKind: base.sourceKind, sourceId: base.sourceId, originalUserId: base.originalUserId,
      model: redactSensitiveText(base.model).value, providerId: redactSensitiveText(base.providerId).value, createdAt: base.createdAt,
      // Exact financial snapshot + last append ID; no lossy hashes or clocks as concurrency control.
      version: canonicalFinancialValue([versionBase, history.at(-1)?.id ?? null]),
      originalState: base.originalState, originalCostUsd: base.originalCostUsd, costUsd, budgetCostUsd,
      ...(verifiedHold !== undefined && costUsd === null ? { verifiedHoldUsd: verifiedHold } : {}),
      ...(usage ? { usage } : {}), usageKnown: hasUsage(usage), isReservation, status,
      affectsCurrentBudget: base.createdAt.slice(0, 7) === now.slice(0, 7) || (!base.remoteEnded && !correction && !confirmation && costUsd === null),
      canReconcile: !base.reservation || stale,
      events: history, unresolvedConflictIds,
    }
  })
}

export function modelCostRecoveryOverview(legacy: TokenUsage[], calls: ModelCallAttempt[], events: ModelCostEvent[], projectId: string, now: string): ModelCostRecoveryOverview {
  const records = buildModelCostRecords(legacy, calls, events, now).filter(record => record.projectId === projectId)
  const view: ModelCostRecoveryOverview = { projectId, month: now.slice(0, 7), asOf: now, actualCostUsd: 0, actualUnknownCount: 0, pendingBoundedCostUsd: 0, reservedCostUsd: 0, reservedUnknownCount: 0, reviewCount: 0, records }
  for (const record of records) {
    if (!['settled', 'running'].includes(record.status)) view.reviewCount++
    if (!record.affectsCurrentBudget) continue
    if (record.isReservation) {
      if (record.budgetCostUsd === null) view.reservedUnknownCount++; else view.reservedCostUsd += record.budgetCostUsd
    } else if (record.costUsd === null) { view.actualUnknownCount++; view.pendingBoundedCostUsd! += record.verifiedHoldUsd ?? 0 } else view.actualCostUsd += record.costUsd
  }
  return view
}
