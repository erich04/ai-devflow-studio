import { randomUUID } from 'node:crypto'
import {
  buildModelCostRecords, canonicalFinancialValue, parseModelCallSettlement, parseModelCostReconciliation, settledModelCallCost,
  type ModelCallAttempt, type ModelCallSettlement, type ModelCallSettlementReceipt, type ModelCostEvent,
  type ModelCostRecord, type ModelCostReconciliationInput, type TeamSession,
} from '@ai-devflow/shared'
import { canSyncProject } from '../auth/session'
import type { TeamRepositorySyncContext } from './team-repository'
import { finishModelCall } from './model-call-budget'

export class ModelCostVersionConflict extends Error {
  constructor() { super('费用记录已更新，请刷新后重新核对。'); this.name = 'ModelCostVersionConflict' }
}

/** Caller supplies a transaction holding the same project lock as reserve and settle. */
export function reconcileModelCostRecord(input: {
  command: ModelCostReconciliationInput; session: TeamSession; record: ModelCostRecord | undefined
  attempt?: ModelCallAttempt; events: ModelCostEvent[]
}): ModelCostEvent {
  const command = parseModelCostReconciliation(input.command)
  if (!canSyncProject(input.session, command.projectId, 'lead')) throw new Error('Project role lead required')
  const record = input.record
  if (!record || record.projectId !== command.projectId || record.sourceId !== command.sourceId || record.sourceKind !== command.sourceKind) throw new Error('Model cost scope mismatch')
  const prior = input.events.find(event => event.kind === 'reconciliation' && event.projectId === command.projectId && event.idempotencyKey === command.idempotencyKey)
  if (prior) {
    if (prior.kind !== 'reconciliation' || prior.actorId !== input.session.userId || prior.requestFingerprint !== canonicalFinancialValue(command)) throw new Error('Model cost idempotency conflict')
    return prior
  }
  if (record.version !== command.expectedVersion) throw new ModelCostVersionConflict()
  if (!record.canReconcile) throw new Error('调用可能仍在运行，不能人工结清。')
  const costUsd = command.costUsd ?? (input.attempt && command.usage
    ? settledModelCallCost(input.attempt, { id: input.attempt.id, projectId: command.projectId, state: 'completed', usage: command.usage })
    : null)
  if (costUsd === null) throw new Error('缺少可靠定价，请填写账单确认的金额。')
  if (costUsd === 0 && command.evidenceKind === 'provider_usage') throw new Error('核定零费用需要提供方账单或未发送证明。')
  if (command.executionStatus === 'not_sent' && ((record.usage?.inputTokens ?? 0) + (record.usage?.outputTokens ?? 0) > 0)) throw new Error('已记录用量，不能核定为未发送。')
  return { ...command, kind: 'reconciliation', id: randomUUID(), costUsd,
    originalUserId: record.originalUserId, actorId: input.session.userId, createdAt: new Date().toISOString(),
    requestFingerprint: canonicalFinancialValue(command) }
}

/** Never overwrite a terminal settlement. A durable conflict receipt ends automatic retransmission. */
export async function settleModelCallWithRecovery(input: {
  settlement: ModelCallSettlement; context: TeamRepositorySyncContext; previous: ModelCallAttempt | null
  events: ModelCostEvent[]; write(value: ModelCallAttempt): Promise<void>; append(event: ModelCostEvent): Promise<void>
}): Promise<ModelCallSettlementReceipt> {
  const settlement = parseModelCallSettlement(input.settlement), previous = input.previous
  if (!previous || previous.projectId !== settlement.projectId || previous.userId !== input.context.userId) throw new Error('Model call accounting scope mismatch')
  const base = { id: previous.id, projectId: previous.projectId }
  const events = input.events.filter(event => event.projectId === previous.projectId && event.sourceKind === 'model_call' && event.sourceId === previous.id)
  const received = events.find(event => event.kind !== 'reconciliation' && canonicalFinancialValue(event.settlement) === canonicalFinancialValue(settlement))
  if (received) return received.kind === 'settlement_confirmation'
    ? { ...base, status: 'confirmed', confirmationId: received.id }
    : { ...base, status: 'conflict_recorded', conflictId: received.id }
  if (previous.state !== 'reserved') {
    const original = parseModelCallSettlement({ ...base, state: previous.state, ...(previous.usage ? { usage: previous.usage } : {}) })
    if (canonicalFinancialValue(original) === canonicalFinancialValue(settlement)) return { ...base, status: 'duplicate' }
  }
  const effective = buildModelCostRecords([], [previous], events, new Date().toISOString())[0]!
  const correction = [...events].reverse().find(event => event.kind === 'reconciliation')
  const cost = settledModelCallCost(previous, settlement)
  const matches = correction?.kind === 'reconciliation' && effective.unresolvedConflictIds.length === 0 &&
    (correction.executionStatus !== 'not_sent' || settlement.state === 'not_sent') &&
    (cost === null || Math.abs(correction.costUsd - cost) <= 1e-9) &&
    ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheMissTokens'].every(key => {
      const field = key as keyof NonNullable<ModelCallSettlement['usage']>
      return !effective.usageKnown || effective.usage?.[field] === undefined || settlement.usage?.[field] === undefined || effective.usage[field] === settlement.usage[field]
    })
  if (previous.state === 'reserved') {
    await finishModelCall(settlement, input.context, async () => previous, input.write)
    if (!correction) return { ...base, status: 'settled' }
  }
  const event: ModelCostEvent = { kind: matches ? 'settlement_confirmation' : 'settlement_conflict', id: randomUUID(), projectId: previous.projectId,
    sourceKind: 'model_call', sourceId: previous.id, originalUserId: previous.userId,
    actorId: input.context.userId, createdAt: new Date().toISOString(), settlement }
  await input.append(event)
  return matches ? { ...base, status: 'confirmed', confirmationId: event.id } : { ...base, status: 'conflict_recorded', conflictId: event.id }
}
