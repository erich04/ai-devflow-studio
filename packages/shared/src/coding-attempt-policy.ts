import type { CodingAgentRun } from './domain'

export const DEFAULT_OPENCODE_ATTEMPT_LIMIT = 3

export function countOpenCodeAttempts(runs: readonly CodingAgentRun[], scope: Pick<CodingAgentRun, 'runId' | 'nodeId' | 'projectId'>): number {
  return runs.filter((run) => run.engine === 'opencode-http' && run.runId === scope.runId &&
    run.nodeId === scope.nodeId && run.projectId === scope.projectId).length
}

/** Recheck within the durable reservation: an authorization buys exactly the next attempt. */
export function assertOpenCodeAttemptReservation(
  runs: readonly CodingAgentRun[],
  run: CodingAgentRun,
  limit = DEFAULT_OPENCODE_ATTEMPT_LIMIT,
): void {
  if (run.engine !== 'opencode-http') return
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid OpenCode attempt limit.')
  const count = countOpenCodeAttempts(runs, run)
  const authorization = run.additionalAttemptAuthorization
  if (authorization && (
    !Number.isSafeInteger(authorization.afterAttemptCount) || authorization.afterAttemptCount !== count ||
    count < limit || authorization.authorizedBy !== run.requestedBy ||
    authorization.authorizedAt !== run.startedAt
  )) throw new Error('OpenCode additional-attempt authorization is stale or invalid; refresh the attempt history.')
  if (count >= limit && !authorization) {
    throw new Error('OpenCode attempt limit reached; explicit authorization for one additional attempt is required.')
  }
}
