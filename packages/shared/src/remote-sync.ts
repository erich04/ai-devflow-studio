import type {
  Role,
  RemoteAgentReviewSummary,
  DesktopPairingCredential,
  RemoteRunSummary,
  RemoteRunSummaryKind,
  RemoteTestEvidenceSummary,
  AgentReviewResult,
  TestEvidence,
  WorkflowRun,
} from './domain'
import { redactTestEvidenceForStorage } from './local-execution'
import { redactLocalAbsolutePaths, redactSecrets, redactSensitiveText } from './redaction'

export function resolveTeamProjectId(input: {
  localProjectId: string
  credential: DesktopPairingCredential | null | undefined
}): string {
  if (!input.credential) {
    throw new Error('Pair Team Project before resolving remote project state.')
  }

  if (!input.credential.localProjectId) {
    throw new Error('Paired Team Project is not bound to a local project.')
  }

  if (input.credential.localProjectId !== input.localProjectId) {
    throw new Error('Paired Team Project is bound to a different local project.')
  }

  return input.credential.projectId
}

export type DevFlowSessionHeaders = {
  'x-devflow-session-source'?: 'demo' | 'authenticated'
  'x-devflow-organization-id': string
  'x-devflow-user-id': string
  'x-devflow-user-role': Role
  'x-devflow-auth-account-id'?: string
  'x-devflow-project-roles': string
}

export type CreateAuthenticatedTeamSessionHeadersInput = {
  organizationId: string
  userId: string
  role: Role
  authAccountId: string
  projectRoles: Array<{
    projectId: string
    role: Role
  }>
}

export function createDemoTeamSessionHeaders(): DevFlowSessionHeaders {
  return {
    'x-devflow-session-source': 'demo',
    'x-devflow-organization-id': 'org-demo',
    'x-devflow-user-id': 'u-erich',
    'x-devflow-user-role': 'owner',
    'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
  }
}

export function createAuthenticatedTeamSessionHeaders(
  input: CreateAuthenticatedTeamSessionHeadersInput,
): DevFlowSessionHeaders {
  return {
    'x-devflow-session-source': 'authenticated',
    'x-devflow-organization-id': input.organizationId,
    'x-devflow-user-id': input.userId,
    'x-devflow-user-role': input.role,
    'x-devflow-auth-account-id': input.authAccountId,
    'x-devflow-project-roles': input.projectRoles
      .map((membership) => `${membership.projectId}:${membership.role}`)
      .join(','),
  }
}

export function createRemoteRunSummary(
  run: WorkflowRun,
  kind: RemoteRunSummaryKind = 'run',
): RemoteRunSummary {
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  if (!currentNode) {
    throw new Error(`Canonical Run current node not found: ${run.currentNodeId}`)
  }

  return redactRemoteRunSummaryForSync({
    kind,
    runId: run.id,
    projectId: run.projectId,
    title: run.title,
    status: run.status,
    currentNodeId: run.currentNodeId,
    currentNode: {
      id: currentNode.id,
      stage: currentNode.stage,
      kind: currentNode.kind,
      status: currentNode.status,
      ...(currentNode.requiredRole ? { requiredRole: currentNode.requiredRole } : {}),
    },
    branchName: run.branchName,
    updatedAt: run.updatedAt,
  })
}

export function redactRemoteRunSummaryForSync(
  summary: RemoteRunSummary,
): RemoteRunSummary {
  return {
    kind: summary.kind,
    runId: summary.runId,
    projectId: summary.projectId,
    title: redactSensitiveText(summary.title).value,
    status: summary.status,
    currentNodeId: summary.currentNodeId,
    currentNode: {
      id: summary.currentNode.id,
      stage: summary.currentNode.stage,
      kind: summary.currentNode.kind,
      status: summary.currentNode.status,
      ...(summary.currentNode.requiredRole
        ? { requiredRole: summary.currentNode.requiredRole }
        : {}),
    },
    branchName: redactSensitiveText(summary.branchName).value,
    updatedAt: summary.updatedAt,
  }
}

export function createRemoteTestEvidenceSummary(
  evidence: TestEvidence,
): RemoteTestEvidenceSummary {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  return redactRemoteTestEvidenceSummaryForSync({
    id: safeEvidence.id,
    runId: safeEvidence.runId,
    nodeId: safeEvidence.nodeId,
    projectId: safeEvidence.projectId,
    command: safeEvidence.command,
    status: safeEvidence.status,
    exitCode: safeEvidence.exitCode,
    durationMs: safeEvidence.durationMs,
    summary: safeEvidence.summary,
    redacted: true,
    createdAt: safeEvidence.createdAt,
  })
}

export function redactRemoteTestEvidenceSummaryForSync(
  summary: RemoteTestEvidenceSummary,
): RemoteTestEvidenceSummary {
  const command = redactSecrets(redactLocalAbsolutePaths(summary.command).value)
  const evidenceSummary = redactSecrets(redactLocalAbsolutePaths(summary.summary).value)

  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    projectId: summary.projectId,
    command: command.value,
    status: summary.status,
    exitCode: summary.exitCode,
    durationMs: summary.durationMs,
    summary: evidenceSummary.value,
    redacted: true,
    createdAt: summary.createdAt,
  }
}

export function redactRemoteAgentReviewSummaryForSync(
  summary: RemoteAgentReviewSummary,
): RemoteAgentReviewSummary {
  const policyFindings = summary.policyFindings?.map((finding) => ({
    id: finding.id,
    reviewId: finding.reviewId,
    runId: finding.runId,
    nodeId: finding.nodeId,
    category: finding.category,
    severity: finding.severity,
    summary: redactSensitiveText(finding.summary).value,
    createdAt: finding.createdAt,
  }))

  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    projectId: summary.projectId,
    runtime: summary.runtime,
    providerId: summary.providerId,
    model: summary.model,
    conclusion: redactSensitiveText(summary.conclusion).value,
    summary: redactSensitiveText(summary.summary).value,
    riskCount: summary.riskCount,
    missingEvidenceCount: summary.missingEvidenceCount,
    ...(summary.policyFindingCount !== undefined
      ? { policyFindingCount: policyFindings?.length ?? summary.policyFindingCount }
      : {}),
    ...(summary.policyFindingCategories !== undefined
      ? {
          policyFindingCategories: policyFindings
            ? Array.from(new Set(policyFindings.map((finding) => finding.category)))
            : summary.policyFindingCategories,
        }
      : {}),
    ...(policyFindings ? { policyFindings } : {}),
    advisoryLevel: summary.advisoryLevel,
    blocksApproval: summary.blocksApproval,
    confidence: summary.confidence,
    redacted: true,
    createdAt: summary.createdAt,
  }
}

export function createRemoteAgentReviewSummary(
  review: AgentReviewResult,
): RemoteAgentReviewSummary {
  return redactRemoteAgentReviewSummaryForSync({
    id: review.id,
    runId: review.runId,
    nodeId: review.nodeId,
    projectId: review.projectId,
    runtime: review.runtime,
    providerId: review.providerId,
    model: review.model,
    conclusion: review.conclusion,
    summary: review.summary,
    riskCount: review.risks.length,
    missingEvidenceCount: review.missingEvidence.length,
    policyFindingCount: review.policyFindings.length,
    policyFindingCategories: Array.from(
      new Set(review.policyFindings.map((finding) => finding.category)),
    ),
    policyFindings: review.policyFindings.map((finding) => ({
      id: finding.id,
      reviewId: finding.reviewId,
      runId: finding.runId,
      nodeId: finding.nodeId,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      createdAt: finding.createdAt,
    })),
    advisoryLevel: review.gateAdvisory.level,
    blocksApproval: review.gateAdvisory.blocksApproval,
    confidence: review.confidence,
    redacted: true,
    createdAt: review.createdAt,
  })
}
