import { describe, expect, it } from 'vitest'
import type {
  AgentPolicyFinding,
  AgentReviewResult,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  RemoteCodingAgentSummary,
  RemoteTestEvidenceSummary,
  TestEvidence,
} from './domain'
import {
  createRecommendedEnforcementPreset,
  evaluateGateEnforcement,
  resolveEffectivePolicy,
  type GateOverrideDecision,
  type GateEnforcementDecision,
  type OrganizationEnforcementPolicy,
} from './enforcement'
import { runs } from './fixtures'
import { buildPolicyAwareDeliverySummaries, buildRemediationPlan } from './remediation'

const run = runs[0]!
const gate = run.nodes.find((node) => node.id === 'n-design-gate')!
const buildNode = run.nodes.find((node) => node.id === 'n-build')!

const testingNeedsEvidence: KnowledgeGovernanceCheck = {
  id: 'check-testing-needs-evidence',
  runId: run.id,
  nodeId: gate.id,
  documentId: 'knowledge-doc-testing-evidence',
  title: 'Testing evidence standard',
  category: 'testing_standard',
  status: 'needs_evidence',
  summary: 'A passing test report is required before this Gate.',
  referenceIds: ['knowledge-ref-testing'],
}

const testingViolation: KnowledgeGovernanceCheck = {
  ...testingNeedsEvidence,
  id: 'check-testing-violated',
  status: 'violated',
  summary: 'The latest test evidence failed.',
}

const apiViolation: KnowledgeGovernanceCheck = {
  ...testingNeedsEvidence,
  id: 'check-api-violated',
  documentId: 'knowledge-doc-api-health',
  title: 'API contract',
  category: 'api_contract',
  status: 'violated',
  summary: 'The response shape no longer matches the API contract.',
  referenceIds: ['knowledge-ref-api'],
}

const highFinding: AgentPolicyFinding = {
  id: 'finding-test-risk',
  reviewId: 'agent-review-1',
  runId: run.id,
  nodeId: gate.id,
  category: 'test_risk',
  severity: 'high',
  summary: 'The change touched a risky path without a focused regression test.',
  evidenceIds: [],
  knowledgeReferenceIds: ['knowledge-ref-testing'],
  createdAt: '2026-06-18T10:00:00.000Z',
}

const failedEvidence: TestEvidence = {
  id: 'evidence-failed',
  runId: run.id,
  nodeId: buildNode.id,
  projectId: run.projectId,
  command: 'corepack pnpm test',
  cwd: '/tmp/devflow-worktree',
  status: 'failed',
  exitCode: 1,
  durationMs: 1200,
  stdout: 'redacted stdout',
  stderr: 'redacted stderr',
  summary: 'Unit tests failed in checkout flow.',
  redacted: true,
  createdAt: '2026-06-18T10:01:00.000Z',
}

const retrievalOnlyReference: KnowledgeReference = {
  id: 'knowledge-ref-testing',
  runId: run.id,
  targetType: 'node',
  nodeId: gate.id,
  documentId: 'knowledge-doc-testing-evidence',
  relation: 'cites',
  reason: 'Testing standards are relevant.',
  chunkId: 'chunk-testing',
  score: 0.94,
  strategy: 'lexical',
  contentHash: 'hash-testing',
  headingPath: ['Testing Evidence Standard'],
}

const apiReference: KnowledgeReference = {
  ...retrievalOnlyReference,
  id: 'knowledge-ref-api',
  documentId: 'knowledge-doc-api-health',
  reason: 'API contract standards are relevant.',
  chunkId: 'chunk-api',
  contentHash: 'hash-api',
  headingPath: ['API Contract Standard'],
}

describe('buildRemediationPlan', () => {
  it('turns missing protected Gate review into a Knowledge Review candidate', () => {
    const decision = decisionFor({
      governanceChecks: [],
      agentPolicyFindings: [],
      latestAgentReview: null,
    })

    const plan = buildRemediationPlan({
      run,
      node: gate,
      decision,
      governanceChecks: [],
      agentPolicyFindings: [],
      testEvidence: [],
      knowledgeReferences: [],
      createdAt: '2026-06-18T10:02:00.000Z',
    })

    expect(plan.id).toBe(`remediation-${run.id}-${gate.id}-1`)
    expect(plan.status).toBe('blocked')
    expect(plan.candidates[0]).toMatchObject({
      kind: 'run_agent_review',
      priority: 'high',
      requiresHumanApproval: true,
    })
    expect(plan.candidates[0]?.sourceReasonIds).toEqual(decision.blockingReasons.map((reason) => reason.id))
  })

  it('creates distinct candidates for missing tests, failed tests, and API contract violations', () => {
    const decision = decisionFor({
      governanceChecks: [testingNeedsEvidence, testingViolation, apiViolation],
      agentPolicyFindings: [],
      latestAgentReview: { id: 'agent-review-1', createdAt: '2026-06-18T10:00:00.000Z' },
    })

    const plan = buildRemediationPlan({
      run,
      node: gate,
      decision,
      governanceChecks: [testingNeedsEvidence, testingViolation, apiViolation],
      agentPolicyFindings: [],
      testEvidence: [failedEvidence],
      knowledgeReferences: [retrievalOnlyReference, apiReference],
      createdAt: '2026-06-18T10:02:00.000Z',
    })

    expect(plan.candidates.map((candidate) => candidate.kind)).toEqual([
      'add_test_evidence',
      'fix_test_failure',
      'fix_api_contract',
    ])
    expect(plan.remainingEvidenceGaps).toContain('Testing evidence standard')
    expect(plan.candidates.find((candidate) => candidate.kind === 'fix_test_failure')?.evidenceIds).toEqual([
      failedEvidence.id,
    ])
    expect(plan.candidates.find((candidate) => candidate.kind === 'fix_api_contract')?.knowledgeReferenceIds).toEqual([
      apiReference.id,
    ])
  })

  it('uses hard-block remediation text as the primary candidate and disallows retry', () => {
    const policy = createHardBlockPolicy()
    const decision = evaluateGateEnforcement({
      run,
      node: gate,
      effectivePolicy: resolveEffectivePolicy(policy, null),
      governanceChecks: [testingViolation],
      agentPolicyFindings: [],
      latestAgentReview: { id: 'agent-review-1', createdAt: '2026-06-18T10:00:00.000Z' },
      overrides: [],
      policySource: 'remote_cache',
    })

    const plan = buildRemediationPlan({
      run,
      node: gate,
      decision,
      governanceChecks: [testingViolation],
      agentPolicyFindings: [],
      testEvidence: [failedEvidence],
      knowledgeReferences: [],
      createdAt: '2026-06-18T10:02:00.000Z',
    })

    expect(plan.status).toBe('hard_blocked')
    expect(plan.candidates[0]).toMatchObject({
      kind: 'resolve_hard_block',
      title: 'Resolve hard-blocked policy requirement',
      summary: 'Fix failing tests and attach passing evidence before approval.',
      eligibleForCodingRetry: false,
    })
  })

  it('keeps retrieval-only references advisory and does not mark evidence gaps as resolved', () => {
    const decision = decisionFor({
      governanceChecks: [testingNeedsEvidence],
      agentPolicyFindings: [highFinding],
      latestAgentReview: { id: 'agent-review-1', createdAt: '2026-06-18T10:00:00.000Z' },
    })

    const plan = buildRemediationPlan({
      run,
      node: gate,
      decision,
      governanceChecks: [testingNeedsEvidence],
      agentPolicyFindings: [highFinding],
      testEvidence: [],
      knowledgeReferences: [retrievalOnlyReference],
      createdAt: '2026-06-18T10:02:00.000Z',
    })

    expect(plan.remainingEvidenceGaps).toEqual(['Testing evidence standard'])
    expect(plan.candidates.some((candidate) => candidate.kind === 'address_agent_finding')).toBe(true)
    expect(plan.candidates.some((candidate) => candidate.knowledgeReferenceIds.includes(retrievalOnlyReference.id))).toBe(true)
  })
})

describe('buildPolicyAwareDeliverySummaries', () => {
  it('summarizes policy-aware delivery signals by project without local-only details', () => {
    const testEvidenceSummaries: RemoteTestEvidenceSummary[] = [
      {
        id: 'remote-evidence-1',
        runId: run.id,
        nodeId: buildNode.id,
        projectId: run.projectId,
        command: 'pnpm test',
        status: 'failed',
        exitCode: 1,
        durationMs: 900,
        summary: 'Tests failed.',
        redacted: true,
        createdAt: '2026-06-18T10:03:00.000Z',
      },
    ]
    const agentReviews: AgentReviewResult[] = [
      {
        id: 'agent-review-1',
        requestId: 'agent-review-request-1',
        runId: run.id,
        nodeId: gate.id,
        projectId: run.projectId,
        runtime: 'api',
        providerId: 'fake-knowledge-review',
        model: 'fake',
        conclusion: 'needs_changes',
        summary: 'Review found missing evidence.',
        risks: ['Missing regression proof'],
        missingEvidence: ['Focused test evidence'],
        suggestedTests: ['pnpm test -- checkout'],
        knowledgeReferences: [],
        policyFindings: [highFinding],
        confidence: 0.8,
        gateAdvisory: {
          id: 'gate-advisory-1',
          runId: run.id,
          nodeId: gate.id,
          level: 'warn',
          summary: 'Warning only.',
          blocksApproval: false,
          missingEvidence: [],
          riskCount: 1,
          createdAt: '2026-06-18T10:04:00.000Z',
        },
        createdAt: '2026-06-18T10:04:00.000Z',
      },
    ]
    const codingSummaries: RemoteCodingAgentSummary[] = [
      {
        id: 'coding-summary-1',
        runId: run.id,
        nodeId: buildNode.id,
        projectId: run.projectId,
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'devflow/run',
        summary: 'Retry applied remediation.',
        changedPaths: ['src/api.ts'],
        startedAt: '2026-06-18T10:05:00.000Z',
        completedAt: '2026-06-18T10:06:00.000Z',
        redacted: true,
      },
    ]
    const gateOverrides: GateOverrideDecision[] = [
      {
        id: 'gate-override-1',
        runId: run.id,
        nodeId: gate.id,
        projectId: run.projectId,
        userId: 'u-ling',
        role: 'lead',
        reason: 'Approved with mitigation.',
        blockedReasonIds: ['missing-review'],
        policyVersion: 1,
        provisional: false,
        status: 'accepted',
        createdAt: '2026-06-18T10:07:00.000Z',
      },
    ]

    const [summary] = buildPolicyAwareDeliverySummaries({
      projectIds: [run.projectId],
      testEvidenceSummaries,
      agentReviews,
      codingAgentSummaries: codingSummaries,
      gateOverrides,
      updatedAt: '2026-06-18T10:08:00.000Z',
    })

    expect(summary).toMatchObject({
      projectId: run.projectId,
      warningCount: 2,
      blockedCount: 2,
      overrideCount: 1,
      remediationPlanCount: 1,
      retryAttemptCount: 1,
      remainingEvidenceGapCount: 1,
      redacted: true,
      updatedAt: '2026-06-18T10:08:00.000Z',
    })
    expect(JSON.stringify(summary)).not.toContain('/tmp')
    expect(JSON.stringify(summary)).not.toContain('stdout')
    expect(JSON.stringify(summary)).not.toContain('prompt')
  })
})

function decisionFor(input: {
  governanceChecks: KnowledgeGovernanceCheck[]
  agentPolicyFindings: AgentPolicyFinding[]
  latestAgentReview: { id: string; createdAt: string } | null
}): GateEnforcementDecision {
  return evaluateGateEnforcement({
    run,
    node: gate,
    effectivePolicy: resolveEffectivePolicy(createRecommendedEnforcementPreset(), null),
    governanceChecks: input.governanceChecks,
    agentPolicyFindings: input.agentPolicyFindings,
    latestAgentReview: input.latestAgentReview,
    overrides: [],
    policySource: 'remote_cache',
  })
}

function createHardBlockPolicy(): OrganizationEnforcementPolicy {
  const policy = createRecommendedEnforcementPreset()
  return {
    ...policy,
    rules: policy.rules.map((rule) =>
      rule.ruleKey === 'governance_check:testing_standard:violated'
        ? {
            ...rule,
            overridable: false,
            remediation: 'Fix failing tests and attach passing evidence before approval.',
          }
        : rule,
    ),
  }
}
