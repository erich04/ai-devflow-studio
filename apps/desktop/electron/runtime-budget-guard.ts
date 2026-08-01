import type { BudgetGuardDecision } from '@ai-devflow/shared'
import type { CodingRuntimeBudgetGuard } from './coding-runtime.js'
import type { ProjectBoundRemoteSync } from './project-bound-remote-sync.js'

export function createRuntimeBudgetGuard(
  remoteSync: Pick<ProjectBoundRemoteSync, 'evaluateRuntimeBudget'>,
): CodingRuntimeBudgetGuard {
  return async ({ engine, estimatedCost, project, providerId, approvalId }) => {
    if (engine === 'fake') {
      return {
        status: 'disabled',
        blocksRun: false,
        currentSpendUsd: 0,
        projectedCostUsd: estimatedCost.costUsd,
        reason: 'Runtime budget guard is skipped for cost-free local or fake provider runs.',
      } satisfies BudgetGuardDecision
    }

    try {
      return await remoteSync.evaluateRuntimeBudget({
        projectId: project.id,
        providerId,
        projectedCostUsd: estimatedCost.costUsd,
        ...(approvalId ? { approvalId } : {}),
      })
    } catch {
      return {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: estimatedCost.costUsd,
        reason: 'Runtime budget decision is unavailable. Pair the project and restore the authenticated Team API connection before retrying.',
      } satisfies BudgetGuardDecision
    }
  }
}
