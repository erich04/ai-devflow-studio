import type { BudgetGuardDecision } from '@ai-devflow/shared'

const budgetDecisionLabels: Record<BudgetGuardDecision['status'], string> = {
  allowed: '在预算内',
  warning: '已超过预警线，仍在月上限内',
  requires_lead_approval: '预计超出月上限，需要 Owner/Lead 一次性批准',
  approved_over_budget: '已有一次性批准，可以超出月上限',
  disabled: '预算检查已关闭',
  unavailable: '预算暂不可用',
}

/** Some runtime and provider reasons are internal English text; those stay in the diagnostics. */
export function readableText(text: string | undefined): string | undefined {
  return text && /[\u3400-\u9fff]/u.test(text) ? text : undefined
}

export function budgetDecisionText(decision: BudgetGuardDecision): string {
  return readableText(decision.reason) ?? budgetDecisionLabels[decision.status]
}

/** Only checks that ask the user for something are worth a line; an allowed request is not. */
export function budgetDecisionNeedsAttention(decision: BudgetGuardDecision): boolean {
  return decision.status !== 'allowed'
}
