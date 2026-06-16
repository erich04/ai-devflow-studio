import type {
  RemoteRunSummary,
  RemoteRunSummaryKind,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowRun,
} from './domain'

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
