import type { ModelBudgetContinuation } from '@ai-devflow/shared'
export const budgetContinuationFixture = (): ModelBudgetContinuation & { localProjectId: string } => ({
  id: 'continue-1', version: 'v1', localProjectId: 'local', projectId: 'p', actorId: 'u', organizationId: 'o',
  providerId: 'deepseek', model: 'deepseek-flash', operation: { id: 'operation-1', version: 'a'.repeat(64), purpose: 'conversation' },
  policyVersion: 'policy-1', month: '2026-10', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
  maxCalls: 36, maxCostUsd: 1, nextCallBoundUsd: 0.03, currentSpendUsd: 1, limitUsd: 10, possibleExcessUsd: 0,
  records: [{ sourceKind: 'model_call', sourceId: 'unknown-call', version: 'version-1', model: 'deepseek-flash', createdAt: '2026-10-01T00:00:00Z', status: 'missing_usage', estimatedCostUsd: null }],
})
