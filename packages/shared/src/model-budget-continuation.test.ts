import { expect, it } from 'vitest'
import { buildModelCostRecords, modelCallActualUsage, modelCallBudgetRollup, verifiedModelCallBound, type ModelCallAttempt } from './index'
const quote = { id: 'a', projectId: 'p', userId: 'u', providerId: 'ds', model: 'deepseek-flash', createdAt: '2026-10-01T00:00:00.000Z', inputTokens: 1000, maxOutputTokens: 65536, billingProvider: 'deepseek' as const }
const bound = () => verifiedModelCallBound({ ...quote, boundBasis: 'deepseek-context-v1' })!
it('requires a supported enforced policy, not a UTF-8 estimate, to claim an upper bound', () => {
  expect(verifiedModelCallBound(quote)).toBeNull()
  expect(verifiedModelCallBound({ ...quote, boundBasis: 'deepseek-context-v1', maxOutputTokens: 500000 })).toBeNull()
  expect(bound().inputTokenBound).toBe(1048576)
  expect(bound().priceVersion).toBeTruthy()
})
it('retains verified holds after ten minutes, interruption and across months without reporting them as actual spend', () => {
  const call: ModelCallAttempt = { ...quote, state: 'reserved', costUsd: null, projectedCostUsd: 0.01, verifiedBound: bound() }
  const now = '2026-11-01T00:15:00.000Z'
  const [record] = buildModelCostRecords([], [call], [], now)
  expect(record).toMatchObject({ costUsd: null, budgetCostUsd: bound().costUsd, affectsCurrentBudget: true, status: 'stale_reservation' })
  expect(modelCallBudgetRollup([], [call], now)[0]?.costUsd).toBeCloseTo(bound().costUsd)
  expect(modelCallActualUsage([], [call])).toEqual([])
  const failed = { ...call, state: 'failed' as const, remoteEnded: false }
  expect(buildModelCostRecords([], [failed], [], now)[0]?.affectsCurrentBudget).toBe(true)
  const ended = { ...failed, remoteEnded: true }
  expect(buildModelCostRecords([], [ended], [], now)[0]?.affectsCurrentBudget).toBe(false)
  const sameMonth = buildModelCostRecords([], [ended], [], '2026-10-02T00:00:00.000Z')[0]
  expect(sameMonth?.budgetCostUsd).toBe(bound().costUsd)
})
