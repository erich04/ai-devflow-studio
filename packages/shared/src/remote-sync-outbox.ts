import { redactSensitiveText } from './redaction'

export type RemoteSyncOperationKind =
  | 'run-summary'
  | 'test-evidence-summary'
  | 'agent-review-summary'
  | 'coding-agent-summary'

export type RemoteSyncOperationMetadata = {
  kind: RemoteSyncOperationKind
  localProjectId: string
  organizationId: string | null
  teamProjectId: string | null
  runId: string
  entityId: string
}

export type RemoteSyncOperationStatus =
  | 'pending'
  | 'sending'
  | 'retry-scheduled'
  | 'completed'
  | 'terminal'

export type RemoteSyncRecovery =
  | 'none'
  | 'canonical-run-required'
  | 'canonical-run-uploaded'
  | 'child-retried'

export type RemoteSyncFailureCode =
  | 'network'
  | 'request_timeout'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'canonical_run_required'
  | 'immutable_conflict'
  | 'invalid_response'
  | 'pairing_required'
  | 'scope_mismatch'
  | 'entity_missing'
  | 'max_attempts'
  | 'rate_limited'
  | 'service_unavailable'
  | 'remote_error'
  | 'remote_unavailable'

export type RemoteSyncFailureMetadata = {
  status: number | null
  code: RemoteSyncFailureCode
}

export type RemoteSyncFailureClassification =
  | { disposition: 'retryable'; recovery: 'none' }
  | { disposition: 'terminal'; recovery: 'none' }
  | { disposition: 'recovery'; recovery: 'canonical-run-required' }

export const REMOTE_SYNC_BACKOFF_BASE_MS = 1_000
export const REMOTE_SYNC_BACKOFF_MAX_MS = 300_000
export const REMOTE_SYNC_MAX_ATTEMPTS = 5
export const REMOTE_SYNC_CLAIM_LEASE_MS = 60_000
export const REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH = 500

export type RemoteSyncOperation = RemoteSyncOperationMetadata & {
  id: string
  idempotencyKey: string
  status: RemoteSyncOperationStatus
  generation: number
  attemptCount: number
  nextAttemptAt: string | null
  leaseExpiresAt: string | null
  lastAttemptAt: string | null
  lastErrorCode: RemoteSyncFailureCode | null
  lastErrorMessage: string | null
  recovery: RemoteSyncRecovery
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreateRemoteSyncOperationInput = Omit<
  RemoteSyncOperationMetadata,
  'organizationId' | 'teamProjectId'
> & {
  id: string
  createdAt: string
  organizationId?: string | null
  teamProjectId?: string | null
}

export function createRemoteSyncIdempotencyKey(
  metadata: Pick<
    RemoteSyncOperationMetadata,
    'kind' | 'localProjectId' | 'runId' | 'entityId'
  > & Partial<Pick<RemoteSyncOperationMetadata, 'organizationId' | 'teamProjectId'>>,
): string {
  const parts = [
    metadata.localProjectId,
    metadata.kind,
    metadata.runId,
    metadata.entityId,
  ].map(encodeURIComponent)

  return `remote-sync:v1:${parts.join(':')}`
}

export function createRemoteSyncOperation(
  input: CreateRemoteSyncOperationInput,
): RemoteSyncOperation {
  const metadata: RemoteSyncOperationMetadata = {
    kind: input.kind,
    localProjectId: input.localProjectId,
    organizationId: input.organizationId ?? null,
    teamProjectId: input.teamProjectId ?? null,
    runId: input.runId,
    entityId: input.entityId,
  }

  return {
    id: input.id,
    ...metadata,
    idempotencyKey: createRemoteSyncIdempotencyKey(metadata),
    status: 'pending',
    generation: 1,
    attemptCount: 0,
    nextAttemptAt: input.createdAt,
    leaseExpiresAt: null,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    recovery: 'none',
    completedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
}

export function calculateRemoteSyncBackoffMs(attemptCount: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error('Remote sync attempt count must be a positive integer.')
  }

  return Math.min(
    REMOTE_SYNC_BACKOFF_MAX_MS,
    REMOTE_SYNC_BACKOFF_BASE_MS * (2 ** Math.max(0, attemptCount - 1)),
  )
}

export function sanitizeRemoteSyncErrorMessage(message: string): string {
  const safeMessage = redactSensitiveText(message).value.trim()
  if (safeMessage.length <= REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH) {
    return safeMessage
  }

  const suffix = '… [truncated]'
  return `${safeMessage.slice(
    0,
    REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH - suffix.length,
  ).trimEnd()}${suffix}`
}

export function classifyRemoteSyncFailure(
  failure: RemoteSyncFailureMetadata,
): RemoteSyncFailureClassification {
  if (failure.status === 409 && failure.code === 'canonical_run_required') {
    return {
      disposition: 'recovery',
      recovery: 'canonical-run-required',
    }
  }

  const networkFailure =
    failure.status === null &&
    (failure.code === 'network' || failure.code === 'remote_unavailable')
  const retryableStatus =
    failure.status === 408 ||
    failure.status === 429 ||
    (failure.status !== null && failure.status >= 500 && failure.status <= 599)
  const retryableResponse = failure.code === 'invalid_response'

  if (networkFailure || retryableStatus || retryableResponse) {
    return { disposition: 'retryable', recovery: 'none' }
  }

  return { disposition: 'terminal', recovery: 'none' }
}
