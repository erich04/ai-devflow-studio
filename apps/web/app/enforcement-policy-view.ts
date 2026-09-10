import { createRecommendedEnforcementPreset, type OrganizationEnforcementPolicy } from '@ai-devflow/shared'

export function isRecommendedPolicy(policy: OrganizationEnforcementPolicy): boolean {
  const recommended = createRecommendedEnforcementPreset({ organizationId: policy.organizationId })
  return policy.id === recommended.id && policy.rules.length === recommended.rules.length &&
    recommended.rules.every((expected) => {
      const actual = policy.rules.find((rule) => rule.ruleKey === expected.ruleKey)
      return actual && actual.target === expected.target && actual.category === expected.category &&
        actual.statusOrSeverity === expected.statusOrSeverity && actual.defaultAction === expected.defaultAction &&
        actual.floorAction === expected.floorAction && actual.overridable === expected.overridable &&
        actual.remediation === expected.remediation
    })
}
