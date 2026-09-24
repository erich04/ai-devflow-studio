import type { BudgetGuardDecision, KnowledgeReviewBudgetGuard } from '@ai-devflow/shared'
import type { CodingRuntimeBudgetGuard } from './coding-runtime.js'
import type { ProjectBoundRemoteSync } from './project-bound-remote-sync.js'

function budgetFailureReason(error: unknown): string {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
  if (status === 401) return '团队登录已失效，请重新绑定后同步 Policy。'
  if (status === 403) return '当前身份没有该 Team Project 的预算访问权限，请核对项目与成员角色。'
  const text = error instanceof Error ? error.message : ''
  if (/bound to a different|scope_mismatch/i.test(text)) return '配对的 Team Project 与当前本地项目不一致，请重新绑定。'
  if (/pair|credential.*not|not.*credential|binding/i.test(text)) return '尚未建立当前项目的认证配对，请先绑定并同步 Policy。'
  return '无法读取云端预算策略或用量，请检查 Team 连接并重试同步；未调用模型。'
}

export function createKnowledgeReviewRuntimeBudgetGuard(
  remoteSync: Pick<ProjectBoundRemoteSync, 'evaluateRuntimeBudget'>,
): KnowledgeReviewBudgetGuard {
  return async ({ projectId, providerId, projectedCostUsd, projectedCostKnown, approvalId }) => {
    try {
      return await remoteSync.evaluateRuntimeBudget({
        projectId,
        providerId,
        projectedCostUsd,
        ...(projectedCostKnown === undefined ? {} : { projectedCostKnown }),
        ...(approvalId ? { approvalId } : {}),
      })
    } catch (error) {
      return {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd,
        reason: budgetFailureReason(error),
      } satisfies BudgetGuardDecision
    }
  }
}

export function createRuntimeBudgetGuard(
  remoteSync: Pick<ProjectBoundRemoteSync, 'evaluateRuntimeBudget'>,
): CodingRuntimeBudgetGuard {
  return async ({ metered, estimatedCost, project, providerId, approvalId }) => {
    if (!metered) {
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
    } catch (error) {
      return {
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: estimatedCost.costUsd,
        reason: budgetFailureReason(error),
      } satisfies BudgetGuardDecision
    }
  }
}
