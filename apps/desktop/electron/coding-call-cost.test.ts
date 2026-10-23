import { describe, expect, it } from 'vitest'
import { modelBudgetUsageWithRuntime, uncoveredLegacyModelUsage, type CodingAgentRun, type ModelCallAttempt } from '@ai-devflow/shared'
import { appendCodingCallCost } from './coding-call-cost'
import type { CodingProviderCallTrace } from './coding-engine'
import { buildRunUsageSummary } from '../src/app/run-usage-summary'

const active: CodingAgentRun = {
  id: 'coding-cost', runId: 'workflow-cost', nodeId: 'build', projectId: 'project', requestedBy: 'user',
  providerId: 'deepseek', engine: 'opencode-http', status: 'running', configVersion: 1,
  managedWorkspaceId: 'workspace', branchName: 'devflow/todo', userInstruction: 'Add a Todo', prompt: '', summary: 'Coding',
  startedAt: '2026-10-23T10:00:00.000Z', changedPaths: [], redacted: true,
}
function paidCall(attempt: number): CodingProviderCallTrace {
  return {
    stateVersion: 1, requestId: `relay-${attempt}`, codingRunId: active.id, phase: 'initial', attempt,
    providerId: 'deepseek', model: 'deepseek-flash', status: 'succeeded', startedAt: active.startedAt,
    completedAt: '2026-10-23T10:00:01.000Z', timeoutMs: 1000, promptChars: 1, promptBytes: 1,
    promptDigest: 'digest', manifestPathCount: 0, excerptCount: 0, maxOutputTokens: 100,
    deliveryState: 'response_received', billingState: 'confirmed', retryable: false, redacted: true,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40, cacheMissTokens: 60,
      cacheStatus: 'complete', usageCompleteness: 'final', billingProvider: 'deepseek', budgetAttemptIds: [`attempt-${attempt}`] },
  }
}

describe('OpenCode response accounting boundaries', () => {
  it('retains the confirmed cost subtotal in the task header after a later response loses its usage', () => {
    const known = appendCodingCallCost(active, paidCall(1))
    const original = buildRunUsageSummary(active.runId, [], [known], [])
    const failed = appendCodingCallCost(known, { ...paidCall(2), status: 'failed', billingState: 'unknown',
      usage: { budgetAttemptIds: ['attempt-2'] }, sanitizedCause: 'opencode_body_read_failed' })
    const summary = buildRunUsageSummary(active.runId, [], [failed], [])
    expect(summary.tokenLabel).toBe('120 + 1 项用量不完整')
    expect(summary.costLabel).toBe(`${original.costLabel} + 1 项金额待确认`)
    expect(summary.unknownCostCount).toBe(1)
  })

  it('keeps admitted HTTP retries after the 32nd response visible and deduplicated against their budget records', () => {
    let run = active
    const attempts: ModelCallAttempt[] = []
    for (let index = 1; index <= 36; index++) {
      const trace = paidCall(index)
      run = appendCodingCallCost(run, trace)
      attempts.push({ id: `attempt-${index}`, projectId: active.projectId, providerId: active.providerId,
        model: trace.model, createdAt: trace.startedAt, inputTokens: 100, maxOutputTokens: 100,
        billingProvider: 'deepseek', userId: active.requestedBy, state: 'completed',
        projectedCostUsd: 0.00002112, costUsd: 0.00002112, usage: trace.usage! })
    }
    expect(run.runtimeCostSummary).toMatchObject({ inputTokens: 3600, outputTokens: 720, totalTokens: 4320, costStatus: 'settled' })
    expect(run.runtimeCostSummary!.costUsd).toBeCloseTo(0.00002112 * 36, 10)
    expect(run.runtimeCostSummary!.providerCallIds).toHaveLength(36)
    expect(buildRunUsageSummary(active.runId, [], [run], []).tokenLabel).toBe('4,320')
    const repeated = appendCodingCallCost(run, paidCall(1))
    expect(repeated.runtimeCostSummary).toEqual(run.runtimeCostSummary)
    const accountingRows = modelBudgetUsageWithRuntime([], [run.runtimeCostSummary!])
    expect(uncoveredLegacyModelUsage(accountingRows, attempts)).toEqual([])
  })

  it.each([false, true])('a known not-sent request does not add an unknown expense (after paid response: %s)', (hasPaidResponse) => {
    const before = hasPaidResponse ? appendCodingCallCost(active, paidCall(1)) : active
    const refused: CodingProviderCallTrace = { ...paidCall(2), status: 'failed',
      deliveryState: 'not_sent', billingState: 'not_incurred', sanitizedCause: 'budget_not_ready',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheMissTokens: 0, cacheStatus: 'complete' } }
    const after = appendCodingCallCost(before, refused)
    expect(after.runtimeCostSummary).toEqual(before.runtimeCostSummary)
    expect(buildRunUsageSummary(active.runId, [], [after], []).unknownCostCount).toBe(0)
  })

  it('keeps confirmed expenses known when a long operation crosses the DeepSeek peak/off-peak boundary', () => {
    let run = active
    for (let index = 1; index <= 36; index++) {
      const trace = paidCall(index)
      run = appendCodingCallCost(run, { ...trace,
        startedAt: index === 1 ? '2026-10-23T09:59:59.000Z' : '2026-10-23T10:00:00.000Z' })
    }
    expect(run.runtimeCostSummary).toMatchObject({ costStatus: 'settled', totalTokens: 4320 })
    expect(run.runtimeCostSummary!.costUsd).toBeCloseTo(0.00002112 * 37, 10)
    expect(buildRunUsageSummary(active.runId, [], [run], []).unknownCostCount).toBe(0)
  })
})
