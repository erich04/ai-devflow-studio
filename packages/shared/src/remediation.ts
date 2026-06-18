import type {
  AgentPolicyFinding,
  AgentReviewResult,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  RemoteCodingAgentSummary,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import type { GateEnforcementDecision, GateEnforcementReason, GateOverrideDecision } from './enforcement'

export type RemediationCandidateKind =
  | 'run_agent_review'
  | 'add_test_evidence'
  | 'fix_test_failure'
  | 'fix_api_contract'
  | 'address_agent_finding'
  | 'resolve_hard_block'
  | 'sync_policy'
  | 'collect_evidence'

export type RemediationPriority = 'high' | 'medium' | 'low'

export type RemediationCandidate = {
  id: string
  kind: RemediationCandidateKind
  title: string
  summary: string
  priority: RemediationPriority
  sourceReasonIds: string[]
  governanceCheckIds: string[]
  agentFindingIds: string[]
  evidenceIds: string[]
  knowledgeReferenceIds: string[]
  requiresHumanApproval: boolean
  eligibleForCodingRetry: boolean
}

export type RemediationPlan = {
  id: string
  runId: string
  nodeId: string
  status: GateEnforcementDecision['status']
  policyVersion: number
  blockingReasonIds: string[]
  warningReasonIds: string[]
  remainingEvidenceGaps: string[]
  candidates: RemediationCandidate[]
  createdAt: string
}

export type RetryAttemptStatus = 'approved' | 'started' | 'completed' | 'failed' | 'cancelled'

export type RetryAttempt = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  remediationPlanId: string
  candidateIds: string[]
  requestedBy: string
  userInstruction: string
  status: RetryAttemptStatus
  codingRunId?: string
  createdAt: string
  completedAt?: string
}

export type PolicyAwareDeliverySummary = {
  projectId: string
  runId?: string
  warningCount: number
  blockedCount: number
  overrideCount: number
  remediationPlanCount: number
  retryAttemptCount: number
  remainingEvidenceGapCount: number
  redacted: boolean
  updatedAt: string
}

export type BuildRemediationPlanInput = {
  run: WorkflowRun
  node: WorkflowNode
  decision: GateEnforcementDecision
  governanceChecks: KnowledgeGovernanceCheck[]
  agentPolicyFindings: AgentPolicyFinding[]
  testEvidence: TestEvidence[]
  knowledgeReferences: KnowledgeReference[]
  createdAt: string
}

export type BuildPolicyAwareDeliverySummariesInput = {
  projectIds: string[]
  testEvidenceSummaries: RemoteTestEvidenceSummary[]
  agentReviews: AgentReviewResult[]
  codingAgentSummaries: RemoteCodingAgentSummary[]
  gateOverrides: GateOverrideDecision[]
  retryAttempts?: RetryAttempt[]
  updatedAt: string
}

export function buildRemediationPlan(input: BuildRemediationPlanInput): RemediationPlan {
  const reasons = [...input.decision.blockingReasons, ...input.decision.warningReasons]
  const candidates = reasons
    .map((reason, index) => candidateForReason(input, reason, index + 1))
    .filter((candidate): candidate is RemediationCandidate => candidate !== null)

  return {
    id: `remediation-${input.run.id}-${input.node.id}-${input.decision.policyVersion}`,
    runId: input.run.id,
    nodeId: input.node.id,
    status: input.decision.status,
    policyVersion: input.decision.policyVersion,
    blockingReasonIds: input.decision.blockingReasons.map((reason) => reason.id),
    warningReasonIds: input.decision.warningReasons.map((reason) => reason.id),
    remainingEvidenceGaps: remainingEvidenceGaps(input),
    candidates,
    createdAt: input.createdAt,
  }
}

export function buildPolicyAwareDeliverySummaries(
  input: BuildPolicyAwareDeliverySummariesInput,
): PolicyAwareDeliverySummary[] {
  return input.projectIds.map((projectId) => {
    const projectEvidence = input.testEvidenceSummaries.filter((evidence) => evidence.projectId === projectId)
    const projectReviews = input.agentReviews.filter((review) => review.projectId === projectId)
    const projectCodingSummaries = input.codingAgentSummaries.filter((summary) => summary.projectId === projectId)
    const projectOverrides = input.gateOverrides.filter((override) => override.projectId === projectId)
    const projectRetryAttempts = (input.retryAttempts ?? []).filter((attempt) => attempt.projectId === projectId)
    const failedEvidenceCount = projectEvidence.filter(
      (evidence) => evidence.status === 'failed' || evidence.status === 'timed_out',
    ).length
    const findingCount = projectReviews.reduce((sum, review) => sum + review.policyFindings.length, 0)
    const highFindingCount = projectReviews.reduce(
      (sum, review) => sum + review.policyFindings.filter((finding) => finding.severity === 'high').length,
      0,
    )
    const missingEvidenceCount = projectReviews.reduce(
      (sum, review) => sum + review.missingEvidence.length,
      0,
    )

    return {
      projectId,
      warningCount: findingCount + projectReviews.filter((review) => review.gateAdvisory.level === 'warn').length,
      blockedCount: failedEvidenceCount + projectOverrides.length,
      overrideCount: projectOverrides.length,
      remediationPlanCount: failedEvidenceCount + highFindingCount + missingEvidenceCount > 0 ? 1 : 0,
      retryAttemptCount: projectRetryAttempts.length + projectCodingSummaries.length,
      remainingEvidenceGapCount: missingEvidenceCount,
      redacted: true,
      updatedAt: input.updatedAt,
    }
  })
}

function candidateForReason(
  input: BuildRemediationPlanInput,
  reason: GateEnforcementReason,
  sequence: number,
): RemediationCandidate | null {
  if (input.decision.status === 'blocked_policy_unavailable') {
    return candidate({
      input,
      reason,
      sequence,
      kind: 'sync_policy',
      title: 'Sync team enforcement policy',
      summary: reason.remediation ?? reason.summary,
      priority: 'high',
      eligibleForCodingRetry: false,
    })
  }

  if (input.decision.status === 'hard_blocked' && reason.action === 'block' && reason.remediation) {
    return candidate({
      input,
      reason,
      sequence,
      kind: 'resolve_hard_block',
      title: 'Resolve hard-blocked policy requirement',
      summary: reason.remediation,
      priority: 'high',
      eligibleForCodingRetry: false,
    })
  }

  if (reason.target === 'missing_agent_review') {
    return candidate({
      input,
      reason,
      sequence,
      kind: 'run_agent_review',
      title: 'Run Knowledge Review Agent',
      summary: reason.remediation ?? 'Run Knowledge Review Agent before approving this protected Gate.',
      priority: reason.action === 'block' ? 'high' : 'medium',
      eligibleForCodingRetry: false,
    })
  }

  if (reason.target === 'governance_check') {
    const check = input.governanceChecks.find((item) => item.id === reason.sourceId)
    if (check?.category === 'testing_standard' && check.status === 'needs_evidence') {
      return candidate({
        input,
        reason,
        sequence,
        kind: 'add_test_evidence',
        title: 'Attach passing test evidence',
        summary: reason.remediation ?? check.summary,
        priority: reason.action === 'block' ? 'high' : 'medium',
        governanceCheckIds: [check.id],
        knowledgeReferenceIds: referenceIdsForCheck(input, check),
        eligibleForCodingRetry: false,
      })
    }

    if (check?.category === 'testing_standard' && check.status === 'violated') {
      return candidate({
        input,
        reason,
        sequence,
        kind: 'fix_test_failure',
        title: 'Fix failing tests',
        summary: reason.remediation ?? check.summary,
        priority: 'high',
        governanceCheckIds: [check.id],
        evidenceIds: failedEvidenceIds(input),
        knowledgeReferenceIds: referenceIdsForCheck(input, check),
        eligibleForCodingRetry: true,
      })
    }

    if (check?.category === 'api_contract' && check.status === 'violated') {
      return candidate({
        input,
        reason,
        sequence,
        kind: 'fix_api_contract',
        title: 'Fix API contract violation',
        summary: reason.remediation ?? check.summary,
        priority: 'high',
        governanceCheckIds: [check.id],
        knowledgeReferenceIds: referenceIdsForCheck(input, check),
        eligibleForCodingRetry: true,
      })
    }

    if (check) {
      return candidate({
        input,
        reason,
        sequence,
        kind: 'collect_evidence',
        title: 'Collect governance evidence',
        summary: reason.remediation ?? check.summary,
        priority: reason.action === 'block' ? 'high' : 'medium',
        governanceCheckIds: [check.id],
        knowledgeReferenceIds: referenceIdsForCheck(input, check),
        eligibleForCodingRetry: false,
      })
    }
  }

  if (reason.target === 'agent_finding') {
    const finding = input.agentPolicyFindings.find((item) => item.id === reason.sourceId)
    return candidate({
      input,
      reason,
      sequence,
      kind: 'address_agent_finding',
      title: 'Address Agent Review finding',
      summary: reason.remediation ?? finding?.summary ?? reason.summary,
      priority: finding?.severity === 'high' ? 'high' : finding?.severity === 'medium' ? 'medium' : 'low',
      agentFindingIds: finding ? [finding.id] : [],
      evidenceIds: finding?.evidenceIds ?? [],
      knowledgeReferenceIds: finding?.knowledgeReferenceIds ?? [],
      eligibleForCodingRetry: reason.action === 'block',
    })
  }

  return null
}

function candidate(input: {
  input: BuildRemediationPlanInput
  reason: GateEnforcementReason
  sequence: number
  kind: RemediationCandidateKind
  title: string
  summary: string
  priority: RemediationPriority
  governanceCheckIds?: string[]
  agentFindingIds?: string[]
  evidenceIds?: string[]
  knowledgeReferenceIds?: string[]
  eligibleForCodingRetry: boolean
}): RemediationCandidate {
  return {
    id: `remediation-candidate-${input.input.run.id}-${input.input.node.id}-${input.sequence}`,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    priority: input.priority,
    sourceReasonIds: [input.reason.id],
    governanceCheckIds: input.governanceCheckIds ?? [],
    agentFindingIds: input.agentFindingIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    knowledgeReferenceIds: input.knowledgeReferenceIds ?? [],
    requiresHumanApproval: true,
    eligibleForCodingRetry: input.eligibleForCodingRetry,
  }
}

function remainingEvidenceGaps(input: BuildRemediationPlanInput): string[] {
  const hasPassingEvidence = input.testEvidence.some((item) => item.status === 'passed')
  if (hasPassingEvidence) {
    return []
  }

  return Array.from(
    new Set(
      input.governanceChecks
        .filter((check) => check.status === 'needs_evidence')
        .map((check) => check.title),
    ),
  )
}

function failedEvidenceIds(input: BuildRemediationPlanInput): string[] {
  return input.testEvidence
    .filter((item) => item.status === 'failed' || item.status === 'timed_out')
    .map((item) => item.id)
}

function referenceIdsForCheck(input: BuildRemediationPlanInput, check: KnowledgeGovernanceCheck): string[] {
  const availableReferenceIds = new Set(input.knowledgeReferences.map((reference) => reference.id))
  return check.referenceIds.filter((referenceId) => availableReferenceIds.has(referenceId))
}
