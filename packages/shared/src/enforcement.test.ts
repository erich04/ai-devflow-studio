import { describe, expect, it } from 'vitest'
import { runs } from './fixtures'
import {
  canApproveGateNow,
  createRecommendedEnforcementPreset,
  createWarnOnlyDefaultPolicy,
  evaluateGateEnforcement,
  isProtectedGate,
  resolveEffectivePolicy,
  validateEnforcementPolicy,
} from './enforcement'
import type {
  AgentPolicyFinding,
  KnowledgeGovernanceCheck,
} from './domain'
import type {
  GateOverrideDecision,
  OrganizationEnforcementPolicy,
  ProjectEnforcementPolicyOverride,
} from './enforcement'

const run = runs[0]!
const gate = run.nodes.find((node) => node.id === 'n-design-gate')!
const acceptance = run.nodes.find((node) => node.id === 'n-accept')!
const buildNode = run.nodes.find((node) => node.id === 'n-build')!

const testingGap: KnowledgeGovernanceCheck = {
  id: 'check-testing-gap',
  runId: run.id,
  nodeId: gate.id,
  documentId: 'knowledge-doc-testing-evidence',
  title: 'Testing evidence standard',
  category: 'testing_standard',
  status: 'needs_evidence',
  summary: 'Testing evidence is missing.',
  referenceIds: [],
}

const apiViolation: KnowledgeGovernanceCheck = {
  ...testingGap,
  id: 'check-api-violation',
  documentId: 'knowledge-doc-api-health',
  title: 'API contract',
  category: 'api_contract',
  status: 'violated',
  summary: 'API contract is violated.',
}

const highFinding: AgentPolicyFinding = {
  id: 'finding-high',
  reviewId: 'review-1',
  runId: run.id,
  nodeId: gate.id,
  category: 'test_risk',
  severity: 'high',
  summary: 'Tests are missing for a risky change.',
  evidenceIds: [],
  knowledgeReferenceIds: [],
  createdAt: '2026-06-17T12:00:00.000Z',
}

describe('isProtectedGate', () => {
  it('protects gate and acceptance nodes only', () => {
    expect(isProtectedGate(gate)).toBe(true)
    expect(isProtectedGate(acceptance)).toBe(true)
    expect(isProtectedGate(buildNode)).toBe(false)
  })
})

describe('resolveEffectivePolicy', () => {
  it('keeps warn-only default non-blocking', () => {
    const policy = resolveEffectivePolicy(createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' }), null)

    expect(policy.rules.every((rule) => rule.action !== 'block')).toBe(true)
  })

  it('clamps project overrides that are weaker than the organization floor', () => {
    const orgPolicy = createRecommendedEnforcementPreset({
      organizationId: 'org-demo',
      updatedAt: '2026-06-17T12:00:00.000Z',
    })
    const projectOverride: ProjectEnforcementPolicyOverride = {
      id: 'project-policy-1',
      organizationId: 'org-demo',
      projectId: run.projectId,
      version: 1,
      rules: [
        {
          ruleKey: 'governance_check:testing_standard:needs_evidence',
          desiredAction: 'warn',
          updatedAt: '2026-06-17T12:01:00.000Z',
        },
      ],
      updatedAt: '2026-06-17T12:01:00.000Z',
    }

    const policy = resolveEffectivePolicy(orgPolicy, projectOverride)
    const rule = policy.rules.find((item) => item.ruleKey === 'governance_check:testing_standard:needs_evidence')

    expect(rule).toMatchObject({
      action: 'block',
      source: 'project_clamped',
    })
  })

  it('allows project overrides to strengthen organization floor', () => {
    const orgPolicy = createWarnOnlyDefaultPolicy({
      organizationId: 'org-demo',
      updatedAt: '2026-06-17T12:00:00.000Z',
    })
    const projectOverride: ProjectEnforcementPolicyOverride = {
      id: 'project-policy-2',
      organizationId: 'org-demo',
      projectId: run.projectId,
      version: 1,
      rules: [
        {
          ruleKey: 'agent_finding:test_risk:high',
          desiredAction: 'block',
          updatedAt: '2026-06-17T12:01:00.000Z',
        },
      ],
      updatedAt: '2026-06-17T12:01:00.000Z',
    }

    const policy = resolveEffectivePolicy(orgPolicy, projectOverride)
    const rule = policy.rules.find((item) => item.ruleKey === 'agent_finding:test_risk:high')

    expect(rule).toMatchObject({
      action: 'block',
      source: 'project_override',
      overridable: true,
    })
  })
})

describe('validateEnforcementPolicy', () => {
  it('rejects agent findings configured as hard-block', () => {
    const policy: OrganizationEnforcementPolicy = {
      id: 'org-policy-invalid',
      organizationId: 'org-demo',
      name: 'Invalid policy',
      version: 1,
      rules: [
        {
          ruleKey: 'agent_finding:security_risk:high',
          target: 'agent_finding',
          category: 'security_risk',
          statusOrSeverity: 'high',
          defaultAction: 'block',
          floorAction: 'block',
          overridable: false,
          remediation: 'Ask the agent to reassess.',
          updatedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
      updatedAt: '2026-06-17T12:00:00.000Z',
    }

    expect(() => validateEnforcementPolicy(policy)).toThrow('Agent findings cannot be hard-block')
  })

  it('requires remediation for deterministic hard-block rules', () => {
    const policy: OrganizationEnforcementPolicy = {
      id: 'org-policy-invalid-hard-block',
      organizationId: 'org-demo',
      name: 'Invalid hard block policy',
      version: 1,
      rules: [
        {
          ruleKey: 'governance_check:testing_standard:violated',
          target: 'governance_check',
          category: 'testing_standard',
          statusOrSeverity: 'violated',
          defaultAction: 'block',
          floorAction: 'block',
          overridable: false,
          updatedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
      updatedAt: '2026-06-17T12:00:00.000Z',
    }

    expect(() => validateEnforcementPolicy(policy)).toThrow('Hard-block rules require remediation')
  })
})

describe('evaluateGateEnforcement', () => {
  it('preserves human approval under warn-only default', () => {
    const decision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' }), null),
      governanceChecks: [testingGap, apiViolation],
      agentPolicyFindings: [highFinding],
      latestAgentReview: null,
      overrides: [],
      policySource: 'built_in_default',
    })

    expect(decision.status).toBe('warn')
    expect(decision.blocksApproval).toBe(false)
  })

  it('blocks protected gates under recommended preset when the review is missing', () => {
    const decision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(createRecommendedEnforcementPreset({ organizationId: 'org-demo' }), null),
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })

    expect(decision.status).toBe('blocked')
    expect(decision.blocksApproval).toBe(true)
    expect(decision.blockingReasons[0]?.target).toBe('missing_agent_review')
  })

  it('never hard-blocks agent findings even when explicitly configured to block', () => {
    const orgPolicy = createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' })
    const projectOverride: ProjectEnforcementPolicyOverride = {
      id: 'project-policy-agent-block',
      organizationId: orgPolicy.organizationId,
      projectId: run.projectId,
      version: 1,
      rules: [
        {
          ruleKey: 'agent_finding:test_risk:high',
          desiredAction: 'block',
          updatedAt: '2026-06-17T12:00:00.000Z',
        },
      ],
      updatedAt: '2026-06-17T12:00:00.000Z',
    }
    const decision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(orgPolicy, projectOverride),
      governanceChecks: [],
      agentPolicyFindings: [highFinding],
      latestAgentReview: { id: 'review-1', createdAt: highFinding.createdAt },
      overrides: [],
      policySource: 'remote_cache',
    })

    expect(decision.status).toBe('blocked')
    expect(decision.blocksApproval).toBe(true)
    expect(decision.canOverride).toBe(true)
  })

  it('blocks team gates when no cached policy is available', () => {
    const decision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: null,
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'unavailable',
    })

    expect(decision.status).toBe('blocked_policy_unavailable')
    expect(decision.blocksApproval).toBe(true)
  })
})

describe('canApproveGateNow', () => {
  it('requires both role permission and non-blocked enforcement', () => {
    const enforcement = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(createRecommendedEnforcementPreset({ organizationId: 'org-demo' }), null),
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })

    expect(canApproveGateNow({ userRole: 'lead', userId: 'u-ling', run, node: gate, enforcement }).allowed).toBe(false)
    expect(canApproveGateNow({ userRole: 'member', userId: 'u-wang', run, node: gate, enforcement }).allowed).toBe(false)
  })

  it('allows an eligible non-conflicted lead override', () => {
    const enforcement = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(createRecommendedEnforcementPreset({ organizationId: 'org-demo' }), null),
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const override: GateOverrideDecision = {
      id: 'override-1',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed risk and approved temporary exception.',
      blockedReasonIds: enforcement.blockingReasons.map((reason) => reason.id),
      policyVersion: enforcement.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    expect(canApproveGateNow({
      userRole: 'lead',
      userId: 'u-review-lead',
      run,
      node: gate,
      enforcement,
      override,
    }).allowed).toBe(true)
  })

  it('rejects owner role and conflicted lead overrides', () => {
    const enforcement = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(createRecommendedEnforcementPreset({ organizationId: 'org-demo' }), null),
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const baseOverride: GateOverrideDecision = {
      id: 'override-conflict',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-ling',
      role: 'lead',
      reason: 'Reviewed risk.',
      blockedReasonIds: enforcement.blockingReasons.map((reason) => reason.id),
      policyVersion: enforcement.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    expect(canApproveGateNow({
      userRole: 'lead',
      userId: gate.ownerId,
      run,
      node: gate,
      enforcement,
      override: baseOverride,
    }).allowed).toBe(false)
    expect(canApproveGateNow({
      userRole: 'owner',
      userId: 'u-erich',
      run,
      node: gate,
      enforcement,
      override: { ...baseOverride, userId: 'u-erich', role: 'owner' },
    }).allowed).toBe(false)
  })
})
