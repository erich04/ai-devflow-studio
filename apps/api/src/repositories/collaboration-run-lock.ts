export function collaborationRunLockKey(input: {
  organizationId: string
  projectId: string
  runId: string
}): string {
  return JSON.stringify([input.organizationId, input.projectId, input.runId])
}
