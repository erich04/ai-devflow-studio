import { describe, expect, it } from 'vitest'
import type { AgentProviderUsage, CodingRuntimeCostSummary, RuntimeProviderCallSettlement } from './domain'
import {
  modelBudgetUsageWithRuntime, modelCallBudgetRollup, modelTaskBudgetBlock, parseModelCallQuote, requestInputTokenBound, verifiedModelCallBound,
  type ModelCallAttempt, type ModelCallQuote, type ModelTaskBudget,
} from './model-call-budget'
import { buildModelCostRecords, type ModelCostEvent } from './model-cost-recovery'

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
    const rows = modelBudgetUsageWithRuntime([{ ...summary, cacheReadTokens: 0, costUsd: 2, usageStatus: 'complete' }], [mixed])
    expect(rows).toHaveLength(2)
    expect(modelCallBudgetRollup(rows, [attempt], now)[0]).toMatchObject({ costUsd: 2, totalTokens: 240 })
  })
  it('keeps missing historical runtime Tokens unknown after amount-only reconciliation', () => {
    const rows = modelBudgetUsageWithRuntime([], [{ ...summary, usageStatus: 'legacy_unknown' }])
    const before = buildModelCostRecords(rows, [], [], now)[0]!
    expect(before).toMatchObject({ status: 'missing_usage', usageKnown: false })
    const event: ModelCostEvent = { kind: 'reconciliation', id: 'correction', idempotencyKey: 'once', projectId: 'p', sourceKind: 'legacy_usage', sourceId: before.sourceId,
      originalUserId: 'u', actorId: 'lead', createdAt: now, expectedVersion: before.version, costUsd: 0.5, reason: '已核对账单', evidence: '账单 INV-123', evidenceKind: 'provider_bill', executionStatus: 'ended' }
    expect(buildModelCostRecords(rows, [], [event], now)[0]).toMatchObject({ costUsd: 0.5, usageKnown: false })
  })
})
describe('Native v3 reservations sized from the measured request', () => {
  const at = '2026-10-28T05:30:00.000Z'
  const task: ModelTaskBudget = { rootId: 'root', taskId: 'root', maxTokens: 10_000_000, rootMaxTokens: 10_000_000, maxCostUsd: 1, rootMaxCostUsd: 1 }
  const measured = (id: string, requestBytes: number, budget = task): ModelCallQuote => ({
    id, projectId: 'p', providerId: 'deepseek', model: 'deepseek-flash', createdAt: at, billingProvider: 'deepseek',
    boundBasis: 'deepseek-request-bytes-v1', inputTokens: requestInputTokenBound('x'.repeat(requestBytes)), maxOutputTokens: 65536, task: budget,
  })
  const fullContext = (id: string, budget = task): ModelCallQuote => ({ ...measured(id, 0, budget), boundBasis: 'deepseek-context-v1', inputTokens: 1048576 })
  const cost = (quote: ModelCallQuote) => verifiedModelCallBound(quote)!.costUsd
  const attempt = (quote: ModelCallQuote, fields: Partial<ModelCallAttempt>): ModelCallAttempt => ({
    ...quote, userId: 'u', state: 'completed', projectedCostUsd: cost(quote), costUsd: null, verifiedBound: verifiedModelCallBound(quote)!, ...fields,
  })
  it('admits independent acceptance generation through the same bounded coding task budget', () => {
    const quote = { ...measured('acceptance-call', 30000), operation: { id: 'acceptance-operation', version: 'a'.repeat(64), purpose: 'coding-acceptance-plan' } }
    expect(parseModelCallQuote(quote)).toEqual(quote)
    expect(modelTaskBudgetBlock(quote, [], 'u', cost(quote))).toBeNull()
    expect(() => parseModelCallQuote({ ...quote, operation: { ...quote.operation, purpose: 'invented-bypass' } })).toThrow('Invalid operation scope')
  })
  it('bounds input by the UTF-8 bytes of the exact request plus the template margin, up to the context window', () => {
    expect(requestInputTokenBound('中'.repeat(1000))).toBe(3000 + 8192)
    expect(verifiedModelCallBound(measured('first', 19399))).toMatchObject({ basis: 'deepseek-request-bytes-v1', inputTokenBound: 27591, maxOutputTokens: 65536 })
    expect(cost(measured('first', 19399))).toBeCloseTo((27591 * 0.3 + 65536 * 1.2) / 1e6, 12)
    // A request at least as large as the context window still reserves the full-context bound.
    expect(verifiedModelCallBound(measured('large', 1_100_000))!.inputTokenBound).toBe(1048576)
    expect(cost(measured('large', 1_100_000))).toBe(cost(fullContext('full')))
    expect(cost(fullContext('full'))).toBeCloseTo(0.393216, 12)
    for (const inputTokens of [8191, 1048577]) expect(() => parseModelCallQuote({ ...measured('forged', 0), inputTokens })).toThrow('Invalid bound basis')
  })
  it('admits the first calls of r8 tasks 10 and 11 with the remaining budget that refused them', () => {
    // Exact wire sizes of the two refused first requests and the remainders recorded in their trial inputs.
    for (const [requestBytes, remaining] of [[19399, 0.38168931], [19689, 0.352173198]] as const) {
      const budget = { ...task, maxCostUsd: remaining, rootMaxCostUsd: remaining }
      const before = fullContext('full', budget), after = measured('measured', requestBytes, budget)
      expect(modelTaskBudgetBlock(before, [], 'u', cost(before))).toContain('总任务预算不足')
      expect(cost(after)).toBeLessThan(0.088)
      expect(modelTaskBudgetBlock(after, [], 'u', cost(after))).toBeNull()
    }
  })
  it('counts only cache-miss input and output against token caps; unsplit usage and unknown deliveries count in full', () => {
    const capped = { ...task, maxTokens: 200_000, rootMaxTokens: 200_000 }
    const next = measured('next', 19399, capped) // 27,591 input bound + 65,536 output
    const settled = (usage: AgentProviderUsage) => attempt(measured('settled', 600_000, capped), { costUsd: 0.002, usage })
    // r8's largest request: 178,955 input tokens, nearly all of them cache hits.
    expect(modelTaskBudgetBlock(next, [settled({ inputTokens: 178_955, cacheReadTokens: 178_000, cacheMissTokens: 955, outputTokens: 300, cacheStatus: 'complete' })], 'u', cost(next))).toBeNull()
    expect(modelTaskBudgetBlock(next, [settled({ inputTokens: 178_955, outputTokens: 300, cacheStatus: 'unknown' })], 'u', cost(next))).toContain('总任务预算不足')
    const unknown = (id: string, budget = capped) => attempt(measured(id, 19399, budget), { state: 'failed' })
    expect(modelTaskBudgetBlock(next, [unknown('lost-1')], 'u', cost(next))).toBeNull()
    expect(modelTaskBudgetBlock(next, [unknown('lost-1'), unknown('lost-2')], 'u', cost(next))).toContain('总任务预算不足')
    const tight = { ...capped, maxCostUsd: cost(next) * 1.5, rootMaxCostUsd: cost(next) * 1.5 }
    expect(modelTaskBudgetBlock(measured('next', 19399, tight), [unknown('lost-1', tight)], 'u', cost(next))).toContain('总任务预算不足')
  })
})
