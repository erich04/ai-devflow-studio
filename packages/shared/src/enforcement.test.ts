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

  it('accepts an override when its blocker ID set exactly matches in a different order', () => {
    const effectivePolicy = resolveEffectivePolicy(
      createRecommendedEnforcementPreset({ organizationId: 'org-demo' }),
      null,
    )
    const blockedDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [apiViolation],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const override: GateOverrideDecision = {
      id: 'override-exact-blocker-set',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed the complete blocker set.',
      blockedReasonIds: blockedDecision.blockingReasons.map((reason) => reason.id).reverse(),
      policyVersion: blockedDecision.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    const overriddenDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [apiViolation],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [override],
      policySource: 'remote_cache',
    })

    expect(overriddenDecision.status).toBe('overridden')
    expect(overriddenDecision.blocksApproval).toBe(false)
  })

  it('re-blocks when an accepted override no longer matches the current blocker', () => {
    const effectivePolicy = resolveEffectivePolicy(
      createRecommendedEnforcementPreset({ organizationId: 'org-demo' }),
      null,
    )
    const originalDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const override: GateOverrideDecision = {
      id: 'override-original-blocker',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed the original missing-review blocker.',
      blockedReasonIds: originalDecision.blockingReasons.map((reason) => reason.id),
      policyVersion: originalDecision.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    const replacedDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [apiViolation],
      agentPolicyFindings: [],
      latestAgentReview: { id: 'review-replacing-blocker', createdAt: '2026-06-17T12:01:00.000Z' },
      overrides: [override],
      policySource: 'remote_cache',
    })

    expect(replacedDecision.status).toBe('blocked')
    expect(replacedDecision.blocksApproval).toBe(true)
    expect(replacedDecision.blockingReasons.map((reason) => reason.id)).toEqual([
      'governance_check:api_contract:violated:check-api-violation',
    ])
  })

  it('re-blocks when a new blocker is added after an override was accepted', () => {
    const effectivePolicy = resolveEffectivePolicy(
      createRecommendedEnforcementPreset({ organizationId: 'org-demo' }),
      null,
    )
    const originalDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const override: GateOverrideDecision = {
      id: 'override-before-new-blocker',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed the blockers that existed at this time.',
      blockedReasonIds: originalDecision.blockingReasons.map((reason) => reason.id),
      policyVersion: originalDecision.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    const expandedDecision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [apiViolation],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [override],
      policySource: 'remote_cache',
    })

    expect(expandedDecision.status).toBe('blocked')
    expect(expandedDecision.blocksApproval).toBe(true)
    expect(expandedDecision.blockingReasons.map((reason) => reason.id)).toEqual([
      'missing_agent_review:protected_gate:missing',
      'governance_check:api_contract:violated:check-api-violation',
    ])
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

  it('authorizes an evaluated accepted override only for its eligible lead actor', () => {
    const effectivePolicy = resolveEffectivePolicy(
      createRecommendedEnforcementPreset({ organizationId: 'org-demo' }),
      null,
    )
    const blockedEnforcement = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy,
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
      overrides: [],
      policySource: 'remote_cache',
    })
    const override: GateOverrideDecision = {
      id: 'override-owned-by-another-lead',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed risk and approved temporary exception.',
      blockedReasonIds: blockedEnforcement.blockingReasons.map((reason) => reason.id),
      policyVersion: blockedEnforcement.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }
    function canApproveWith(
      candidate: GateOverrideDecision,
      userRole: GateOverrideDecision['role'],
      userId: string,
    ) {
      const overrides = [candidate]
      const overriddenEnforcement = evaluateGateEnforcement({
        run,
        node: gate,
        effectivePolicy,
        governanceChecks: [],
        agentPolicyFindings: [],
        latestAgentReview: null,
        overrides,
        policySource: 'remote_cache',
      })

      expect(overriddenEnforcement.status).toBe('overridden')
      expect(overriddenEnforcement.blocksApproval).toBe(false)
      return canApproveGateNow({
        userRole,
        userId,
        run,
        node: gate,
        enforcement: overriddenEnforcement,
        override: candidate,
      }).allowed
    }

    expect(canApproveWith(override, 'lead', 'u-other-review-lead')).toBe(false)
    expect(canApproveWith(override, 'lead', override.userId)).toBe(true)
    expect(canApproveWith(
      { ...override, userId: run.creatorId },
      'lead',
      run.creatorId,
    )).toBe(false)
    expect(canApproveWith(
      { ...override, userId: gate.ownerId },
      'lead',
      gate.ownerId,
    )).toBe(false)
    expect(canApproveWith(
      { ...override, role: 'owner' },
      'owner',
      override.userId,
    )).toBe(false)
  })

  it('rejects an override bound to a different run, node, status, policy, or blocker set', () => {
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
      id: 'override-stale-blockers',
      runId: run.id,
      nodeId: gate.id,
      projectId: run.projectId,
      userId: 'u-review-lead',
      role: 'lead',
      reason: 'Reviewed a previous set of risks.',
      blockedReasonIds: enforcement.blockingReasons.map((reason) => reason.id),
      policyVersion: enforcement.policyVersion,
      provisional: false,
      status: 'accepted',
      createdAt: '2026-06-17T12:00:00.000Z',
    }

    const mismatchedOverrides: GateOverrideDecision[] = [
      { ...override, runId: 'run-other' },
      { ...override, nodeId: 'node-other' },
      { ...override, status: 'provisional' },
      { ...override, policyVersion: enforcement.policyVersion + 1 },
      { ...override, blockedReasonIds: ['stale-blocker'] },
    ]

    for (const mismatchedOverride of mismatchedOverrides) {
      expect(canApproveGateNow({
        userRole: 'lead',
        userId: 'u-review-lead',
        run,
        node: gate,
        enforcement,
        override: mismatchedOverride,
      }).allowed).toBe(false)
    }
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
