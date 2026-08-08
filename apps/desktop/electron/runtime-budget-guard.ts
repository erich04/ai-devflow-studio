import type { BudgetGuardDecision, KnowledgeReviewBudgetGuard } from '@ai-devflow/shared'
import type { CodingRuntimeBudgetGuard } from './coding-runtime.js'
import type { ProjectBoundRemoteSync } from './project-bound-remote-sync.js'

const BUDGET_UNAVAILABLE_REASON =
  'Runtime budget decision is unavailable. Pair the project and restore the authenticated Team API connection before retrying.'

export function createKnowledgeReviewRuntimeBudgetGuard(
  remoteSync: Pick<ProjectBoundRemoteSync, 'evaluateRuntimeBudget'>,
): KnowledgeReviewBudgetGuard {
  return async ({ projectId, providerId, projectedCostUsd, approvalId }) => {
    try {
      return await remoteSync.evaluateRuntimeBudget({
        projectId,
        providerId,
        projectedCostUsd,
        ...(approvalId ? { approvalId } : {}),
      })
    } catch {
      return {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd,
        reason: BUDGET_UNAVAILABLE_REASON,
      } satisfies BudgetGuardDecision
    }
  }
}

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
        reason: BUDGET_UNAVAILABLE_REASON,
      } satisfies BudgetGuardDecision
    }
  }
}
