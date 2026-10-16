import { describe, expect, it } from 'vitest'
import type { BudgetGuardDecision } from '@ai-devflow/shared'
import { budgetDecisionNeedsAttention, budgetDecisionText, readableText } from './model-settings-view-model'

const decision = (status: BudgetGuardDecision['status'], reason: string): BudgetGuardDecision => ({
  status, reason, blocksRun: status === 'requires_lead_approval' || status === 'unavailable', currentSpendUsd: 0, projectedCostUsd: 0.01,
  ...(status === 'requires_lead_approval' ? { approvalRequiredRole: 'lead' as const } : {}),
})

describe('model settings presentation', () => {
  it('replaces internal English budget reasons with a Chinese status and keeps Chinese reasons', () => {
    expect(budgetDecisionText(decision('requires_lead_approval', 'Project runtime budget would be exceeded; lead approval is required before calling the real provider.')))
      .toBe('预计超出月上限，需要 Owner/Lead 一次性批准')
    expect(budgetDecisionText(decision('warning', 'Projected runtime cost is above the warning threshold but within the project budget.')))
      .toBe('已超过预警线，仍在月上限内')
    expect(budgetDecisionText(decision('unavailable', '当前项目尚未配置云端预算策略。'))).toBe('当前项目尚未配置云端预算策略。')
  })

  it('does not report a normal allowed check', () => {
    expect(budgetDecisionNeedsAttention(decision('allowed', 'Projected runtime cost is within the project budget threshold.'))).toBe(false)
    expect(budgetDecisionNeedsAttention(decision('warning', 'x'))).toBe(true)
  })

  it('treats text without Chinese characters as diagnostics', () => {
    expect(readableText('Coding Engine is available.')).toBeUndefined()
    expect(readableText('所选 Coding Engine 可用。')).toBe('所选 Coding Engine 可用。')
    expect(readableText(undefined)).toBeUndefined()
  })
})
