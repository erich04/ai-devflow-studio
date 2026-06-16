import type {
  Role,
  RemoteAgentReviewSummary,
  RemoteRunSummary,
  RemoteRunSummaryKind,
  RemoteTestEvidenceSummary,
  AgentReviewResult,
  TestEvidence,
  WorkflowRun,
} from './domain'

export type DevFlowSessionHeaders = {
  'x-devflow-organization-id': string
  'x-devflow-user-id': string
  'x-devflow-user-role': Role
  'x-devflow-project-roles': string
}

export function createDemoTeamSessionHeaders(): DevFlowSessionHeaders {
  return {
    'x-devflow-organization-id': 'org-demo',
    'x-devflow-user-id': 'u-erich',
    'x-devflow-user-role': 'owner',
    'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
  }
}

export function createRemoteRunSummary(
  run: WorkflowRun,
  kind: RemoteRunSummaryKind = 'run',
): RemoteRunSummary {
  return {
    kind,
    runId: run.id,
    projectId: run.projectId,
    title: run.title,
    status: run.status,
    currentNodeId: run.currentNodeId,
    branchName: run.branchName,
    updatedAt: run.updatedAt,
  }
}

export function createRemoteTestEvidenceSummary(
  evidence: TestEvidence,
): RemoteTestEvidenceSummary {
  return {
    id: evidence.id,
    runId: evidence.runId,
    nodeId: evidence.nodeId,
    projectId: evidence.projectId,
    command: evidence.command,
    status: evidence.status,
    exitCode: evidence.exitCode,
    durationMs: evidence.durationMs,
    summary: evidence.summary,
    redacted: true,
    createdAt: evidence.createdAt,
  }
}

export function createRemoteAgentReviewSummary(
  review: AgentReviewResult,
): RemoteAgentReviewSummary {
  return {
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
    advisoryLevel: review.gateAdvisory.level,
    blocksApproval: review.gateAdvisory.blocksApproval,
    confidence: review.confidence,
    redacted: true,
    createdAt: review.createdAt,
  }
}
