import type { ModelCallQuote } from './model-call-budget'

/** Authorization for future calls, never a correction or invented bill for a past call. */
export type ModelBudgetContinuation = {
  id: string; projectId: string; actorId: string; organizationId: string
  providerId: string; model: string; operation: NonNullable<ModelCallQuote['operation']>
  version: string; policyVersion: string; month: string
  createdAt: string; expiresAt: string; confirmedAt?: string
  maxCalls: number; maxCostUsd: number; nextCallBoundUsd: number
  costs?: { actualUsd: number; executingUsd: number; pendingBoundedUsd: number; unknownCount: number }
  currentSpendUsd: number; limitUsd: number; possibleExcessUsd: number
  records: Array<{ sourceKind: 'model_call' | 'legacy_usage'; sourceId: string; version: string; model: string; createdAt: string; status: string; originalState?: string; estimatedCostUsd: number | null }>
}
export type ConfirmModelBudgetContinuation = { id: string; projectId: string; expectedVersion: string }
export const modelBudgetPurposeLabels: Record<string, string> = {
  conversation: '继续本次对话', proposal: '继续生成本次提案', review: '继续本次门禁审查',
  workflow: '继续生成本次阶段材料', 'native-tool': '继续本次模型操作',
}
