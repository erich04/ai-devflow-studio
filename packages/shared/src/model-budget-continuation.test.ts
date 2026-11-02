import { expect, it } from 'vitest'
import { buildModelCostRecords, modelCallActualUsage, modelCallBudgetRollup, requestInputTokenBound, verifiedModelCallBound, type ModelCallAttempt } from './index'
const quote = { id: 'a', projectId: 'p', userId: 'u', providerId: 'ds', model: 'deepseek-flash', createdAt: '2026-10-01T00:00:00.000Z', inputTokens: 1000, maxOutputTokens: 65536, billingProvider: 'deepseek' as const }
const bound = () => verifiedModelCallBound({ ...quote, boundBasis: 'deepseek-context-v1' })!
it('requires a supported enforced policy, not a UTF-8 estimate, to claim an upper bound', () => {
  expect(verifiedModelCallBound(quote)).toBeNull()
  expect(verifiedModelCallBound({ ...quote, boundBasis: 'deepseek-context-v1', maxOutputTokens: 500000 })).toBeNull()
  expect(bound().inputTokenBound).toBe(1048576)
  expect(bound().priceVersion).toBeTruthy()
})
it('gives deepseek-flash, the deepseek-v4-flash alias and deepseek-v4-pro a verified bound from the pricing catalog', () => {
  // An off-peak quote is still bounded at peak cache-miss rates over the full 1M context.
  const of = (model: string) => verifiedModelCallBound({ ...quote, model, createdAt: '2026-11-02T12:00:00.000Z', boundBasis: 'deepseek-context-v1' })
  expect(of('deepseek-flash')).toMatchObject({ inputTokenBound: 1048576, maxOutputTokens: 65536, priceVersion: 'deepseek-pricing-snapshot-2026-09-10' })
  expect(of('deepseek-flash')!.costUsd).toBeCloseTo((1048576 * 0.3 + 65536 * 1.2) / 1e6, 12)
  expect(of('deepseek-v4-flash')).toEqual(of('deepseek-flash'))
  expect(of('deepseek-v4-pro')).toMatchObject({ inputTokenBound: 1048576, maxOutputTokens: 65536, priceVersion: 'deepseek-pricing-snapshot-2026-11-01' })
  expect(of('deepseek-v4-pro')!.costUsd).toBeCloseTo((1048576 * 1.32 + 65536 * 3.96) / 1e6, 12)
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

it('preserves measured request bounds for Flash aliases and Pro when syncing the main pricing fix into v3', () => {
  const inputTokens = requestInputTokenBound('x'.repeat(19399))
  const measured = (model: string) => verifiedModelCallBound({ ...quote, model, inputTokens, createdAt: '2026-11-02T12:00:00.000Z', boundBasis: 'deepseek-request-bytes-v1' })
  const flash = measured('deepseek-flash'), pro = measured('deepseek-v4-pro')
  expect(flash).toMatchObject({ basis: 'deepseek-request-bytes-v1', inputTokenBound: 27591 })
  expect(measured('deepseek-v4-flash')).toEqual(flash)
  expect(pro).toMatchObject({ basis: 'deepseek-request-bytes-v1', inputTokenBound: 27591, priceVersion: 'deepseek-pricing-snapshot-2026-11-01' })
  expect(pro!.costUsd).toBeCloseTo((27591 * 1.32 + 65536 * 3.96) / 1e6, 12)
  expect(pro!.costUsd).toBeLessThan(verifiedModelCallBound({ ...quote, model: 'deepseek-v4-pro', createdAt: '2026-11-02T12:00:00.000Z', boundBasis: 'deepseek-context-v1' })!.costUsd)
})
