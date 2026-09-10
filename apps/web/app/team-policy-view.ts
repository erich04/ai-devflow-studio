import { validateEnforcementPolicy, type OrganizationEnforcementPolicy } from '@ai-devflow/shared'

export function policyContent(policy: OrganizationEnforcementPolicy): string {
  return JSON.stringify({ name: policy.name, rules: [...policy.rules].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey)).map((rule) => ({
    ruleKey: rule.ruleKey, target: rule.target, category: rule.category, statusOrSeverity: rule.statusOrSeverity,
    defaultAction: rule.defaultAction, floorAction: rule.floorAction, overridable: rule.overridable, remediation: rule.remediation ?? '',
  })) })
}

export function policyRevision(policy: OrganizationEnforcementPolicy): string {
  return JSON.stringify([policy.id, policy.version, policy.updatedAt, policyContent(policy)])
}

export function policyValidationError(policy: OrganizationEnforcementPolicy): string | null {
  if (!policy.name.trim()) return '请填写策略名称。'
  try { validateEnforcementPolicy(policy) } catch (error) {
    return error instanceof Error ? error.message : '策略不符合团队规则。'
  }
  return null
}

export function policyChanges(before: OrganizationEnforcementPolicy, after: OrganizationEnforcementPolicy): string[] {
  const changes: string[] = []
  if (before.name !== after.name) changes.push(`策略名称：${before.name} → ${after.name}`)
  for (const rule of after.rules) {
    const original = before.rules.find((item) => item.ruleKey === rule.ruleKey)
    if (!original) { changes.push(`新增规则：${rule.ruleKey}`); continue }
    const details: string[] = []
    if (original.defaultAction !== rule.defaultAction) details.push(`动作 ${original.defaultAction} → ${rule.defaultAction}`)
    if (original.floorAction !== rule.floorAction) details.push(`最低要求 ${original.floorAction} → ${rule.floorAction}`)
    if (original.overridable !== rule.overridable) details.push(`允许例外 ${original.overridable ? '是' : '否'} → ${rule.overridable ? '是' : '否'}`)
    if ((original.remediation ?? '') !== (rule.remediation ?? '')) details.push(`修复指引 ${original.remediation || '无'} → ${rule.remediation || '无'}`)
    if (details.length) changes.push(`${rule.ruleKey}：${details.join('；')}`)
  }
  for (const rule of before.rules) if (!after.rules.some((item) => item.ruleKey === rule.ruleKey)) changes.push(`移除规则：${rule.ruleKey}`)
  return changes
}
