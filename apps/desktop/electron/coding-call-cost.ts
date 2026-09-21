import {
  aggregateCodingRuntimeCostSettlements, settleCodingRuntimeCost,
  type CodingAgentRun, type CodingRuntimeCostSummary,
} from '@ai-devflow/shared'
import type { CodingProviderCallTrace } from './coding-engine.js'

/** Expenses are response facts; output validation and execution authority are independent. */
export function appendCodingCallCost(run: CodingAgentRun, trace: CodingProviderCallTrace): CodingAgentRun {
  if (trace.codingRunId !== run.id || trace.providerId !== run.providerId) throw new Error('Provider cost scope mismatch')
  if (trace.status === 'started' || !trace.usage || !trace.completedAt) return run
  const previous = run.runtimeCostSummary
  if (previous?.providerCallIds?.includes(trace.requestId)) return run
  let settlement: CodingRuntimeCostSummary
  try {
    settlement = settleCodingRuntimeCost({
      runId: run.runId, nodeId: run.nodeId, userId: run.requestedBy, projectId: run.projectId,
      providerId: trace.providerId, model: trace.model, usage: trace.usage, timestamp: trace.startedAt,
    })
  } catch {
    // Preserve the trace even when its usage cannot be settled. Never invent missing counts.
    return run
  }
  const { providerCallIds: _ids, providerCallSettlements: _calls, ...priorScope } = previous ?? {}
  const prior = previous?.source === 'provider_reported'
    ? previous.providerCallSettlements?.map((item) => ({
        requestPhase: item.requestPhase,
        settlement: { ...priorScope, id: previous.id, runId: run.runId, nodeId: run.nodeId,
          userId: run.requestedBy, projectId: run.projectId, provider: previous.provider,
          ...item, phase: 'provider_settlement' as const } satisfies CodingRuntimeCostSummary,
      })) ?? [{ requestPhase: 'initial' as const, settlement: previous }]
    : []
  const summary = aggregateCodingRuntimeCostSettlements([...prior, {
    requestPhase: trace.phase,
    settlement,
  }])
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
