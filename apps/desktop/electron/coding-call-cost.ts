import {
  aggregateCodingRuntimeCostSettlements, settleCodingRuntimeCost,
  type CodingAgentRun, type CodingRuntimeCostSummary,
} from '@ai-devflow/shared'
import type { CodingProviderCallTrace } from './coding-engine.js'

/** Expenses are response facts; output validation and execution authority are independent. */
export function appendCodingCallCost(run: CodingAgentRun, trace: CodingProviderCallTrace): CodingAgentRun {
  if (trace.codingRunId !== run.id || trace.providerId !== run.providerId) throw new Error('Provider cost scope mismatch')
  // A rejected admission/failed connection remains an audit event, not an unknown expense.
  if (run.engine === 'opencode-http' && trace.billingState === 'not_incurred') return run
  const usage = trace.usage ?? (run.engine === 'opencode-http' && trace.billingState !== 'not_incurred' ? {} : undefined)
  if (trace.status === 'started' || !usage || !trace.completedAt) return run
  const previous = run.runtimeCostSummary
  if (previous?.providerCallIds?.includes(trace.requestId)) return run
  let settlement: CodingRuntimeCostSummary
  const scope = {
    runId: run.runId, nodeId: run.nodeId, userId: run.requestedBy, projectId: run.projectId,
    providerId: trace.providerId, model: trace.model, timestamp: trace.startedAt,
  }
  try {
    settlement = settleCodingRuntimeCost({
      ...scope, usage,
    })
  } catch {
    if (run.engine !== 'opencode-http') return run
    // Zero here means no observed tokens, not a free call. The incomplete/unknown flags below
    // preserve the missing observation alongside the budget's outstanding reservation.
    const observed = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value! : 0
    settlement = settleCodingRuntimeCost({ ...scope, usage: {
      inputTokens: observed(usage.inputTokens), outputTokens: observed(usage.outputTokens),
      ...(usage.budgetAttemptIds ? { budgetAttemptIds: usage.budgetAttemptIds } : {}),
    } })
  }
  if (run.engine === 'opencode-http' && (usage.usageCompleteness === 'partial' ||
      usage.inputTokens === undefined || usage.outputTokens === undefined)) {
    settlement = { ...settlement, usageStatus: 'incomplete', costStatus: 'unknown', costUsd: null,
      cacheReadTokens: null, cacheMissTokens: null, cacheHitRate: null, pricingSnapshot: null, breakdown: null }
  }
  const { providerCallIds: _ids, providerCallSettlements: _calls, budgetAttemptIds: _attempts, ...priorScope } = previous ?? {}
  const prior = previous?.source === 'provider_reported'
    ? previous.providerCallSettlements?.map((item) => ({
        requestPhase: item.requestPhase,
        settlement: { ...priorScope, id: previous.id, runId: run.runId, nodeId: run.nodeId,
          userId: run.requestedBy, projectId: run.projectId, provider: previous.provider,
          ...item, phase: 'provider_settlement' as const } satisfies CodingRuntimeCostSummary,
      })) ?? [{ requestPhase: 'initial' as const, settlement: previous }]
    : []
  let calls = [...prior, {
    requestPhase: trace.phase,
    settlement,
  }]
  if (run.engine === 'opencode-http' && calls.length > 32) {
    // SDK transport retries can exceed the plugin's parameter-call count. Keep a bounded
    // projection, while all request IDs/events remain intact. Never fold different tariff
    // snapshots: a mixed-price subtotal has no single snapshot and cannot be repriced later.
    const groups = new Map<string, number>()
    for (let index = 0; index < calls.length; index++) {
      const item = calls[index]!
      const key = JSON.stringify([item.requestPhase, item.settlement.pricingSnapshot, item.settlement.costStatus])
      const priorIndex = groups.get(key)
      if (priorIndex !== undefined) {
        const folded = aggregateCodingRuntimeCostSettlements([calls[priorIndex]!, item])
        calls = calls.filter((_, position) => position !== index).map((call, position) =>
          position === priorIndex ? { requestPhase: item.requestPhase, settlement: folded } : call)
        break
      }
      groups.set(key, index)
    }
  }
  const summary = aggregateCodingRuntimeCostSettlements(calls)
  return { ...run, runtimeCostSummary: {
    ...summary,
    // Different attempts on one workflow node must have different ledger identities.
    id: `coding-runtime-cost-${run.id}`,
    providerCallIds: [...(previous?.providerCallIds ?? []), trace.requestId],
  } }
}

/** Retain recorded expenses when an executor returns an older execution snapshot. */
export function retainRecordedCodingCost(next: CodingAgentRun, current: CodingAgentRun): CodingAgentRun {
  return current.runtimeCostSummary?.providerCallIds
    ? { ...next, runtimeCostSummary: current.runtimeCostSummary }
    : next
}
