import type {
  AgentReviewResult,
  AgentPolicyFinding,
  AgentPolicyFindingCategory,
  AgentPolicyFindingSeverity,
  KnowledgeDocumentCategory,
  KnowledgeGovernanceCheck,
  KnowledgeGovernanceStatus,
  Role,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import { canApproveGate } from './gates'

export type EnforcementAction = 'ignore' | 'warn' | 'block'

export type EnforcementTarget = 'governance_check' | 'agent_finding' | 'missing_agent_review'

export type { AgentPolicyFinding, AgentPolicyFindingCategory, AgentPolicyFindingSeverity }

export type OrganizationEnforcementRule = {
  ruleKey: string
  target: EnforcementTarget
  category: string
  statusOrSeverity: string
  defaultAction: EnforcementAction
  floorAction: EnforcementAction
  overridable: boolean
  remediation?: string
  updatedAt: string
}

export type OrganizationEnforcementPolicy = {
  id: string
  organizationId: string
  name: string
  version: number
  rules: OrganizationEnforcementRule[]
  updatedAt: string
}

export type ProjectEnforcementOverrideRule = {
  ruleKey: string
  desiredAction: EnforcementAction
  updatedAt: string
}

export type ProjectEnforcementPolicyOverride = {
  id: string
  organizationId: string
  projectId: string
  version: number
  rules: ProjectEnforcementOverrideRule[]
  updatedAt: string
}

export type EffectiveEnforcementRule = {
  ruleKey: string
  target: EnforcementTarget
  category: string
  statusOrSeverity: string
  action: EnforcementAction
  floorAction: EnforcementAction
  overridable: boolean
  remediation?: string
  source: 'organization' | 'project_override' | 'project_clamped'
}

export type EffectiveEnforcementPolicy = {
  id: string
  organizationId: string
  projectId?: string
  version: number
  rules: EffectiveEnforcementRule[]
  updatedAt: string
}

export type PolicySnapshotSource = 'remote_cache' | 'built_in_default' | 'unavailable'

export type PolicySnapshot = {
  projectId: string
  organizationPolicy: OrganizationEnforcementPolicy | null
  projectOverride: ProjectEnforcementPolicyOverride | null
  effectivePolicy: EffectiveEnforcementPolicy | null
  version: number
  updatedAt: string
  syncedAt: string
  source: PolicySnapshotSource
}

export type GateEnforcementReason = {
  id: string
  target: EnforcementTarget
  ruleKey: string
  action: Exclude<EnforcementAction, 'ignore'>
  summary: string
  remediation?: string
  sourceId?: string
}

export type GateEnforcementDecision = {
  status: 'pass' | 'warn' | 'blocked' | 'hard_blocked' | 'overridden' | 'blocked_policy_unavailable'
  blocksApproval: boolean
  blockingReasons: GateEnforcementReason[]
  warningReasons: GateEnforcementReason[]
  requiredActions: string[]
  canOverride: boolean
  overrideRoleRequired: 'lead'
  policySource: PolicySnapshotSource
  policyVersion: number
  provisional: boolean
}

export type GateOverrideDecision = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  userId: string
  role: Role
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
  provisional: boolean
  status: 'accepted' | 'provisional' | 'rejected'
  createdAt: string
}

export type CanApproveGateNowResult = {
  allowed: boolean
  reason: 'allowed' | 'role_denied' | 'blocked' | 'override_required' | 'hard_blocked' | 'policy_unavailable'
}

export type EvaluateGateEnforcementInput = {
  run: WorkflowRun
  node: WorkflowNode
  effectivePolicy: EffectiveEnforcementPolicy | null
  governanceChecks: KnowledgeGovernanceCheck[]
  agentPolicyFindings: AgentPolicyFinding[]
  latestAgentReview: Pick<AgentReviewResult, 'id' | 'createdAt'> | null
  overrides: GateOverrideDecision[]
  policySource: PolicySnapshotSource
}

const actionRank: Record<EnforcementAction, number> = {
  ignore: 0,
  warn: 1,
  block: 2,
}

const DEFAULT_ORGANIZATION_ID = 'org-demo'
const DEFAULT_UPDATED_AT = '2026-06-17T00:00:00.000Z'

function maxAction(first: EnforcementAction, second: EnforcementAction): EnforcementAction {
  return actionRank[first] >= actionRank[second] ? first : second
}

export function governanceRuleKey(
  category: KnowledgeDocumentCategory,
  status: KnowledgeGovernanceStatus,
): string {
  return `governance_check:${category}:${status}`
}

export function agentFindingRuleKey(
  category: AgentPolicyFindingCategory,
  severity: AgentPolicyFindingSeverity,
): string {
  return `agent_finding:${category}:${severity}`
}

export function missingAgentReviewRuleKey(): string {
  return 'missing_agent_review:protected_gate:missing'
}

function rule(
  target: EnforcementTarget,
  category: string,
  statusOrSeverity: string,
  action: EnforcementAction,
  updatedAt: string,
  options: {
    floorAction?: EnforcementAction
    overridable?: boolean
    remediation?: string
  } = {},
): OrganizationEnforcementRule {
  const ruleKey =
    target === 'governance_check'
      ? `governance_check:${category}:${statusOrSeverity}`
      : target === 'agent_finding'
        ? `agent_finding:${category}:${statusOrSeverity}`
        : `missing_agent_review:${category}:${statusOrSeverity}`

  return {
    ruleKey,
    target,
    category,
    statusOrSeverity,
    defaultAction: action,
    floorAction: options.floorAction ?? 'ignore',
    overridable: options.overridable ?? true,
    ...(options.remediation ? { remediation: options.remediation } : {}),
    updatedAt,
  }
}

export function createWarnOnlyDefaultPolicy(
  input: { organizationId?: string; updatedAt?: string } = {},
): OrganizationEnforcementPolicy {
  const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID
  const updatedAt = input.updatedAt ?? DEFAULT_UPDATED_AT

  return {
    id: `enforcement-policy-${organizationId}-warn-only`,
    organizationId,
    name: 'Warn-only default enforcement policy',
    version: 1,
    updatedAt,
    rules: [
      rule('missing_agent_review', 'protected_gate', 'missing', 'warn', updatedAt),
      rule('governance_check', 'testing_standard', 'needs_evidence', 'warn', updatedAt),
      rule('governance_check', 'testing_standard', 'violated', 'warn', updatedAt),
      rule('governance_check', 'api_contract', 'violated', 'warn', updatedAt),
      rule('governance_check', 'review_checklist', 'needs_evidence', 'warn', updatedAt),
      rule('agent_finding', 'missing_evidence', 'medium', 'warn', updatedAt),
      rule('agent_finding', 'test_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'api_contract_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'security_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'review_gap', 'low', 'warn', updatedAt),
    ],
  }
}

export function createRecommendedEnforcementPreset(
  input: { organizationId?: string; updatedAt?: string } = {},
): OrganizationEnforcementPolicy {
  const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID
  const updatedAt = input.updatedAt ?? DEFAULT_UPDATED_AT

  return {
    id: `enforcement-policy-${organizationId}-recommended`,
    organizationId,
    name: 'Recommended enforcement preset',
    version: 1,
    updatedAt,
    rules: [
      rule('missing_agent_review', 'protected_gate', 'missing', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Run Knowledge Review Agent for this protected Gate.',
      }),
      rule('governance_check', 'testing_standard', 'needs_evidence', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Attach passing test evidence for the affected Run.',
      }),
      rule('governance_check', 'testing_standard', 'violated', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Fix the failing test evidence and rerun the configured test command.',
      }),
      rule('governance_check', 'api_contract', 'violated', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Update the implementation or design artifact to satisfy the API contract.',
      }),
      rule('governance_check', 'review_checklist', 'needs_evidence', 'warn', updatedAt),
      rule('agent_finding', 'missing_evidence', 'medium', 'warn', updatedAt),
      rule('agent_finding', 'test_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'api_contract_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'security_risk', 'high', 'warn', updatedAt),
      rule('agent_finding', 'review_gap', 'low', 'warn', updatedAt),
    ],
  }
}

export function validateEnforcementPolicy(policy: OrganizationEnforcementPolicy): void {
  for (const item of policy.rules) {
    if (item.target === 'agent_finding' && !item.overridable) {
      throw new Error(`Agent findings cannot be hard-block: ${item.ruleKey}`)
    }

    if (!item.overridable && !item.remediation?.trim()) {
      throw new Error(`Hard-block rules require remediation: ${item.ruleKey}`)
    }
  }
}

export function resolveEffectivePolicy(
  orgPolicy: OrganizationEnforcementPolicy,
  projectOverride: ProjectEnforcementPolicyOverride | null,
): EffectiveEnforcementPolicy {
  validateEnforcementPolicy(orgPolicy)

  const overrideMap = new Map(projectOverride?.rules.map((item) => [item.ruleKey, item]) ?? [])

  return {
    id: `effective-${orgPolicy.id}${projectOverride ? `-${projectOverride.projectId}` : ''}`,
    organizationId: orgPolicy.organizationId,
    ...(projectOverride ? { projectId: projectOverride.projectId } : {}),
    version: Math.max(orgPolicy.version, projectOverride?.version ?? 0),
    updatedAt: projectOverride?.updatedAt ?? orgPolicy.updatedAt,
    rules: orgPolicy.rules.map((item) => {
      const override = overrideMap.get(item.ruleKey)
      const requestedAction = override?.desiredAction ?? item.defaultAction
      const action = maxAction(item.floorAction, requestedAction)
      const source: EffectiveEnforcementRule['source'] = override
        ? action === requestedAction
          ? 'project_override'
          : 'project_clamped'
        : 'organization'

      return {
        ruleKey: item.ruleKey,
        target: item.target,
        category: item.category,
        statusOrSeverity: item.statusOrSeverity,
        action,
        floorAction: item.floorAction,
        overridable: item.overridable,
        ...(item.remediation ? { remediation: item.remediation } : {}),
        source,
      }
    }),
  }
}

export function isProtectedGate(node: WorkflowNode): boolean {
  return node.kind === 'gate' || node.kind === 'acceptance'
}

function reasonId(rule: EffectiveEnforcementRule, sourceId?: string): string {
  return [rule.ruleKey, sourceId].filter(Boolean).join(':')
}

function toReason(
  rule: EffectiveEnforcementRule,
  summary: string,
  sourceId?: string,
): GateEnforcementReason | null {
  if (rule.action === 'ignore') {
    return null
  }

  return {
    id: reasonId(rule, sourceId),
    target: rule.target,
    ruleKey: rule.ruleKey,
    action: rule.action,
    summary,
    ...(rule.remediation ? { remediation: rule.remediation } : {}),
    ...(sourceId ? { sourceId } : {}),
  }
}

function findRule(policy: EffectiveEnforcementPolicy, ruleKey: string): EffectiveEnforcementRule | undefined {
  return policy.rules.find((item) => item.ruleKey === ruleKey)
}

function acceptedOverrideFor(
  run: WorkflowRun,
  node: WorkflowNode,
  policyVersion: number,
  overrides: GateOverrideDecision[],
): GateOverrideDecision | undefined {
  return overrides.find(
    (item) =>
      item.runId === run.id &&
      item.nodeId === node.id &&
      item.status === 'accepted' &&
      item.policyVersion === policyVersion,
  )
}

export function evaluateGateEnforcement({
  run,
  node,
  effectivePolicy,
  governanceChecks,
  agentPolicyFindings,
  latestAgentReview,
  overrides,
  policySource,
}: EvaluateGateEnforcementInput): GateEnforcementDecision {
  if (!effectivePolicy) {
    return {
      status: 'blocked_policy_unavailable',
      blocksApproval: true,
      blockingReasons: [
        {
          id: 'policy-unavailable',
          target: 'missing_agent_review',
          ruleKey: 'policy-unavailable',
          action: 'block',
          summary: 'Team enforcement policy is unavailable. Sync policy before approving this Gate.',
        },
      ],
      warningReasons: [],
      requiredActions: ['Sync team enforcement policy before approving this Gate.'],
      canOverride: false,
      overrideRoleRequired: 'lead',
      policySource,
      policyVersion: 0,
      provisional: false,
    }
  }

  const warningReasons: GateEnforcementReason[] = []
  const blockingReasons: GateEnforcementReason[] = []
  let hasHardBlock = false

  function collect(reason: GateEnforcementReason | null, rule?: EffectiveEnforcementRule) {
    if (!reason) {
      return
    }

    if (reason.action === 'block') {
      blockingReasons.push(reason)
      if (rule && !rule.overridable) {
        hasHardBlock = true
      }
      return
    }

    warningReasons.push(reason)
  }

  if (isProtectedGate(node) && !latestAgentReview) {
    const rule = findRule(effectivePolicy, missingAgentReviewRuleKey())
    if (rule) {
      collect(toReason(rule, 'Knowledge Review Agent has not reviewed this protected Gate.'), rule)
    }
  }

  for (const check of governanceChecks.filter((item) => item.nodeId === node.id)) {
    const rule = findRule(effectivePolicy, governanceRuleKey(check.category, check.status))
    if (rule) {
      collect(toReason(rule, `${check.title}: ${check.summary}`, check.id), rule)
    }
  }

  for (const finding of agentPolicyFindings.filter((item) => item.nodeId === node.id)) {
    const rule = findRule(effectivePolicy, agentFindingRuleKey(finding.category, finding.severity))
    if (rule) {
      collect(toReason(rule, finding.summary, finding.id), rule)
    }
  }

  const acceptedOverride = acceptedOverrideFor(run, node, effectivePolicy.version, overrides)
  const provisional = acceptedOverride?.provisional ?? false

  if (hasHardBlock) {
    return {
      status: 'hard_blocked',
      blocksApproval: true,
      blockingReasons,
      warningReasons,
      requiredActions: blockingReasons.map((item) => item.remediation ?? item.summary),
      canOverride: false,
      overrideRoleRequired: 'lead',
      policySource,
      policyVersion: effectivePolicy.version,
      provisional,
    }
  }

  if (blockingReasons.length > 0) {
    if (acceptedOverride) {
      return {
        status: 'overridden',
        blocksApproval: false,
        blockingReasons,
        warningReasons,
        requiredActions: [],
        canOverride: true,
        overrideRoleRequired: 'lead',
        policySource,
        policyVersion: effectivePolicy.version,
        provisional,
      }
    }

    return {
      status: 'blocked',
      blocksApproval: true,
      blockingReasons,
      warningReasons,
      requiredActions: blockingReasons.map((item) => item.remediation ?? item.summary),
      canOverride: true,
      overrideRoleRequired: 'lead',
      policySource,
      policyVersion: effectivePolicy.version,
      provisional,
    }
  }

  return {
    status: warningReasons.length > 0 ? 'warn' : 'pass',
    blocksApproval: false,
    blockingReasons,
    warningReasons,
    requiredActions: [],
    canOverride: false,
    overrideRoleRequired: 'lead',
    policySource,
    policyVersion: effectivePolicy.version,
    provisional,
  }
}

export function canOverrideBlockedGate(input: {
  userRole: Role
  userId: string
  run: WorkflowRun
  node: WorkflowNode
  enforcement: GateEnforcementDecision
  reason: string
}): boolean {
  return (
    input.enforcement.status === 'blocked' &&
    input.userRole === 'lead' &&
    input.userId !== input.run.creatorId &&
    input.userId !== input.node.ownerId &&
    input.reason.trim().length > 0
  )
}

export function canApproveGateNow(input: {
  userRole: Role
  userId: string
  run: WorkflowRun
  node: WorkflowNode
  enforcement: GateEnforcementDecision
  override?: GateOverrideDecision
}): CanApproveGateNowResult {
  if (!canApproveGate(input.userRole, input.node)) {
    return { allowed: false, reason: 'role_denied' }
  }

  if (input.enforcement.status === 'blocked_policy_unavailable') {
    return { allowed: false, reason: 'policy_unavailable' }
  }

  if (input.enforcement.status === 'hard_blocked') {
    return { allowed: false, reason: 'hard_blocked' }
  }

  if (!input.enforcement.blocksApproval) {
    return { allowed: true, reason: 'allowed' }
  }

  const override = input.override
  if (!override) {
    return { allowed: false, reason: 'override_required' }
  }

  const canUseOverride =
    override.status === 'accepted' &&
    override.role === 'lead' &&
    input.userRole === 'lead' &&
    override.userId === input.userId &&
    override.policyVersion === input.enforcement.policyVersion &&
    override.reason.trim().length > 0 &&
    input.userId !== input.run.creatorId &&
    input.userId !== input.node.ownerId

  return canUseOverride ? { allowed: true, reason: 'allowed' } : { allowed: false, reason: 'blocked' }
}
