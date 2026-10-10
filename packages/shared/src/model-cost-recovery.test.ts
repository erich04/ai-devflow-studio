import { describe, expect, it } from 'vitest'
import { modelCallActualUsage, modelCallBudgetRollup, type ModelCallAttempt } from './model-call-budget'
import { buildModelCostRecords, modelCostRecoveryOverview, parseModelCostReconciliation, type ModelCostEvent } from './model-cost-recovery'
import type { TokenUsage } from './domain'

const now = '2026-10-04T12:00:00.000Z'
const call = (id: string, extra: Partial<ModelCallAttempt> = {}): ModelCallAttempt => ({
  id, projectId: 'p', userId: 'caller', providerId: 'provider', model: 'unpriced-model',
  createdAt: now, inputTokens: 10, maxOutputTokens: 10, billingProvider: 'openai_compatible',
  state: 'failed', projectedCostUsd: 2, costUsd: null, ...extra,
})
const legacy: TokenUsage = { id: 'old-usage', projectId: 'p', runId: 'r', nodeId: 'n', userId: 'caller',
  provider: 'openai', model: 'old-model', timestamp: now, inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, costUsd: null }
const correction = (sourceKind: 'model_call' | 'legacy_usage', sourceId: string, extra: Partial<ModelCostEvent> = {}): ModelCostEvent => ({
  kind: 'reconciliation', id: 'correction', idempotencyKey: 'once', projectId: 'p', sourceKind, sourceId,
  originalUserId: 'caller', actorId: 'lead', createdAt: now, expectedVersion: 'v0',
  costUsd: 0.25, reason: '核对提供方账单', evidence: '账单项目 INV-123', evidenceKind: 'provider_bill', executionStatus: 'ended', ...extra,
} as ModelCostEvent)

describe('one effective model cost ledger', () => {
  it('separates actual spend, live reservations, stale reservations and upload failures without guessing zero', () => {
    const calls = [call('paid', { costUsd: 3 }), call('running', { state: 'reserved' }),
      call('stale', { state: 'reserved', createdAt: '2026-10-04T11:49:59Z' }),
      call('queued', { state: 'reserved', pendingSettlement: { id: 'queued', projectId: 'p', state: 'completed', usage: { inputTokens: 2, outputTokens: 1 } } })]
    const view = modelCostRecoveryOverview([], calls, [], 'p', now)
    expect(view).toMatchObject({ actualCostUsd: 3, reservedCostUsd: 0, reservedUnknownCount: 3, reviewCount: 2 })
    expect(view.records.map(r => r.status)).toEqual(['settled', 'running', 'stale_reservation', 'upload_pending'])
    expect(view.records.find(r => r.sourceId === 'running')?.canReconcile).toBe(false)
  })

  it('applies append-only corrections to actual reporting and monthly budget, preserving unknown token counts', () => {
    const calls = [call('failed'), call('stale', { state: 'reserved', createdAt: '2026-10-04T11:00:00Z' })]
    const events = [correction('model_call', 'failed'), correction('model_call', 'stale', { id: 'second', costUsd: 0.5 }), correction('legacy_usage', legacy.id, { id: 'third', costUsd: 1, expectedVersion: buildModelCostRecords([legacy], [], [], now)[0]!.version })]
    expect(modelCallBudgetRollup([legacy], calls, now, events)[0]).toMatchObject({ costUsd: 1.75 })
    expect(modelCallActualUsage([legacy], calls, events).reduce((sum, r) => sum + (r.costUsd ?? 0), 0)).toBe(1.75)
    const record = buildModelCostRecords([legacy], calls, events, now).find(r => r.sourceId === 'failed')!
    expect(record).toMatchObject({ costUsd: 0.25, usageKnown: false, originalCostUsd: null, originalUserId: 'caller' })
    expect(calls[0]?.costUsd).toBeNull()
  })

  it('uses exactly the admission deduplication and billing month, including legacy coding records', () => {
    const calls = [call('known', { costUsd: 2 }), call('last-month', { createdAt: '2026-09-30T23:59:59Z', remoteEnded: true })]
    const duplicate = { ...legacy, budgetAttemptIds: ['known'] }
    const view = modelCostRecoveryOverview([duplicate, { ...legacy, id: 'unmatched', budgetAttemptIds: ['missing'] }], calls, [], 'p', now)
    expect(view.records.map(r => r.sourceId)).toEqual(['unmatched', 'known', 'last-month'])
    expect(view).toMatchObject({ actualCostUsd: 2, actualUnknownCount: 1 })
    expect(view.records.find(r => r.sourceId === 'last-month')?.affectsCurrentBudget).toBe(false)
    expect(modelCallBudgetRollup([duplicate], calls, now)[0]).toMatchObject({ costUsd: 2 })
  })

  it('keeps late conflicting settlements uncertain until a new versioned correction resolves them', () => {
    const events: ModelCostEvent[] = [correction('model_call', 'one'), {
      kind: 'settlement_conflict', id: 'conflict', projectId: 'p', sourceKind: 'model_call', sourceId: 'one',
      originalUserId: 'caller', actorId: 'caller', createdAt: now,
      settlement: { id: 'one', projectId: 'p', state: 'completed', usage: { inputTokens: 50, outputTokens: 2 } },
    }]
    const before = buildModelCostRecords([], [call('one')], events, now)[0]!
    expect(before).toMatchObject({ status: 'conflict', costUsd: null, unresolvedConflictIds: ['conflict'] })
    expect(modelCallBudgetRollup([], [call('one')], now, events)[0]?.unknownCostCount).toBe(1)
    const after = buildModelCostRecords([], [call('one')], [...events, correction('model_call', 'one', { id: 'review', expectedVersion: before.version, costUsd: 0.3 })], now)[0]!
    expect(after).toMatchObject({ status: 'settled', costUsd: 0.3, unresolvedConflictIds: [] })
    expect(after.version).not.toBe(before.version)
  })

  it('rejects unverifiable, forged-identity, unsafe and empty reconciliation commands', () => {
    const input = { projectId: 'p', sourceKind: 'model_call', sourceId: 'one', expectedVersion: 'v0', idempotencyKey: 'request',
      costUsd: 0, reason: '已核对', evidence: '提供方账单确认未计费', evidenceKind: 'provider_bill', executionStatus: 'ended' }
    expect(parseModelCostReconciliation(input)).toMatchObject({ costUsd: 0 })
    for (const extra of [{ evidence: '' }, { reason: '' }, { executionStatus: 'unknown' }, { costUsd: -1 }, { userId: 'victim' },
      { actorId: 'owner' }, { evidenceKind: 'timeout' }, { evidence: 'Bearer secret-token-123456' }]) {
      expect(() => parseModelCostReconciliation({ ...input, ...extra })).toThrow()
    }
  })

  it('requires a new review if historical evidence changes after correction instead of applying stale amounts', () => {
    const before = buildModelCostRecords([legacy], [], [], now)[0]!
    const event = correction('legacy_usage', legacy.id, { expectedVersion: before.version })
    expect(buildModelCostRecords([legacy], [], [event], now)[0]).toMatchObject({ costUsd: 0.25 })
    expect(buildModelCostRecords([{ ...legacy, inputTokens: 25 }], [], [event], now)[0]).toMatchObject({ status: 'conflict', costUsd: null })
  })
})
