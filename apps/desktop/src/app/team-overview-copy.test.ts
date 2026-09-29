import { describe, expect, it } from 'vitest'
import {
  createRecommendedEnforcementPreset,
  createWarnOnlyDefaultPolicy,
} from '@ai-devflow/shared'
import {
  dataOriginLabel,
  describeEnforcementRule,
  enforcementActionLabel,
  enforcementRuleSourceLabel,
  enforcementTargetLabel,
  gateSnapshotStatusLabel,
  policySourceLabel,
  projectHealthLabel,
  runtimeSourceLabel,
  teamRoleLabel,
} from './team-overview-copy'

describe('describeEnforcementRule', () => {
  it('describes every built-in rule in Chinese without the rule key', () => {
    const rules = [
      ...createWarnOnlyDefaultPolicy({ organizationId: 'org' }).rules,
      ...createRecommendedEnforcementPreset({ organizationId: 'org' }).rules,
    ]

    for (const rule of rules) {
      const description = describeEnforcementRule(rule)
      expect(description.recognized).toBe(true)
      expect(description.label).not.toContain(':')
      expect(description.label).not.toContain('_')
      expect(description.label).not.toContain(rule.category)
    }
    expect(describeEnforcementRule(rules[0]!).label).toBe('缺少本阶段要求的 AI 审查')
    expect(describeEnforcementRule(rules[1]!).label).toBe('测试规范：缺少证据')
    expect(describeEnforcementRule(rules[3]!).label).toBe('接口契约：不符合')
    expect(describeEnforcementRule(rules[8]!).label).toBe('AI 审查发现：安全风险（高）')
  })

  it('reads category and status from the key when only the key and target are known', () => {
    expect(describeEnforcementRule({ ruleKey: 'missing_agent_review:protected_gate:missing', target: 'missing_agent_review' }))
      .toEqual({ label: '缺少本阶段要求的 AI 审查', recognized: true })
    expect(describeEnforcementRule({ ruleKey: 'governance_check:testing_standard:needs_evidence' }))
      .toEqual({ label: '测试规范：缺少证据', recognized: true })
    // Gate reasons may carry a key without the target prefix.
    expect(describeEnforcementRule({ ruleKey: 'api_contract:violated', target: 'governance_check' }))
      .toEqual({ label: '接口契约：不符合', recognized: true })
    expect(describeEnforcementRule({ ruleKey: 'policy-unavailable', target: 'governance_check' }))
      .toEqual({ label: '团队策略尚未同步', recognized: true })
  })

  it('falls back to 待核实 for unrecognised rules', () => {
    expect(describeEnforcementRule({ ruleKey: 'governance_check:testing_standard:needs_evidence_9', target: 'governance_check' }))
      .toEqual({ label: '测试规范：待核实', recognized: false })
    expect(describeEnforcementRule({ ruleKey: 'governance_check:custom:violated' }))
      .toEqual({ label: '规范检查待核实', recognized: false })
    expect(describeEnforcementRule({ ruleKey: 'agent_finding:security_risk:critical' }))
      .toEqual({ label: 'AI 审查发现：安全风险（待核实）', recognized: false })
    expect(describeEnforcementRule({ ruleKey: 'missing_agent_review:other:missing' }).recognized).toBe(false)
    expect(describeEnforcementRule({ ruleKey: 'rule:custom-1', target: 'future_target' }))
      .toEqual({ label: '规则待核实', recognized: false })
  })
})

describe('team page labels', () => {
  it('maps statuses and sources, separating an unreadable policy from unmet conditions', () => {
    expect(gateSnapshotStatusLabel('warn', { warnings: 2 })).toBe('有 2 条建议')
    expect(gateSnapshotStatusLabel('warn', { warnings: 0 })).toBe('有建议')
    expect(gateSnapshotStatusLabel('blocked', { warnings: 0 })).toBe('审批受阻')
    expect(gateSnapshotStatusLabel('blocked_policy_unavailable', { warnings: 0 })).toBe('状态待核实 · 团队策略未读取')
    expect(gateSnapshotStatusLabel('not loaded', { warnings: 0 })).toBe('尚未加载')
    expect(gateSnapshotStatusLabel('mystery', { warnings: 0 })).toBe('状态待核实')
    expect(policySourceLabel('remote_cache')).toBe('团队远端缓存')
    expect(policySourceLabel('x')).toBe('来源待核实')
    expect(enforcementTargetLabel('governance_check')).toBe('规范检查')
    expect(enforcementActionLabel('block')).toBe('阻断审批')
    expect(enforcementRuleSourceLabel('project_override')).toBe('项目调整')
    expect(projectHealthLabel('at_risk')).toBe('有风险')
    expect(dataOriginLabel('remote')).toBe('团队数据')
    expect(runtimeSourceLabel('remote snapshot + local merge')).toBe('团队数据与本地数据')
    expect(runtimeSourceLabel('new label')).toBe('数据来源待核实')
    expect(teamRoleLabel('member')).toBe('成员')
  })
})
