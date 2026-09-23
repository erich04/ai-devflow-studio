import { describe, expect, it } from 'vitest'
import type { CodingRuntimeCostSummary, RuntimeProviderCallSettlement } from './domain'
import { modelBudgetUsageWithRuntime, modelCallBudgetRollup, type ModelCallAttempt } from './model-call-budget'

const now = '2026-09-23T18:00:00.000Z'
const summary: CodingRuntimeCostSummary = {
  id: 'coding-cost', projectId: 'p', runId: 'r', nodeId: 'n', userId: 'u',
  provider: 'openai', providerId: 'deepseek', model: 'deepseek-flash',
  inputTokens: 100, outputTokens: 20, cacheReadTokens: 0,
  costUsd: null, timestamp: now, source: 'provider_reported', redacted: true,
}
const call: RuntimeProviderCallSettlement = {
  providerId: 'deepseek', model: 'deepseek-flash', requestPhase: 'initial',
  inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheMissTokens: 100,
  totalTokens: 120, cacheHitRate: 0, usageStatus: 'complete', costStatus: 'settled',
  costUsd: 1, pricingSnapshot: null, breakdown: null, timestamp: now,
  source: 'provider_reported', redacted: true,
}
describe('coding usage alongside per-call budget accounting', () => {
  it('keeps unknown legacy amounts visible instead of treating them as free', () => {
    const rows = modelBudgetUsageWithRuntime([], [summary])
    expect(modelCallBudgetRollup(rows, [], now)[0]).toMatchObject({ unknownCostCount: 1, totalTokens: 120 })
    expect(modelBudgetUsageWithRuntime([], [{ ...summary, phase: 'preflight_estimate' }])).toEqual([])
    expect(modelBudgetUsageWithRuntime([], [{ ...summary, usageStatus: 'legacy_unknown' }])[0]?.inputTokens).toBe(0)
  })
  it('deduplicates a governed repair while retaining the historical initial call', () => {
    const mixed = { ...summary, phase: 'provider_settlement' as const, costUsd: 2,
      usageStatus: 'complete' as const, costStatus: 'settled' as const,
      providerCallSettlements: [call, { ...call, requestPhase: 'repair' as const, budgetAttemptIds: ['actual-repair'] }],
    }
    const attempt: ModelCallAttempt = {
      id: 'actual-repair', projectId: 'p', userId: 'u', providerId: 'deepseek',
      model: call.model, createdAt: now, inputTokens: 100, maxOutputTokens: 1000,
      billingProvider: 'deepseek', projectedCostUsd: 2, costUsd: 1, state: 'completed',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 },
    }
    const rows = modelBudgetUsageWithRuntime([{ ...summary, cacheReadTokens: 0, costUsd: 2 }], [mixed])
    expect(rows).toHaveLength(2)
    expect(modelCallBudgetRollup(rows, [attempt], now)[0]).toMatchObject({ costUsd: 2, totalTokens: 240 })
  })
})
