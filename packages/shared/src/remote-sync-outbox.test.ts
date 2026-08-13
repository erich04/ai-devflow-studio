import { describe, expect, it } from 'vitest'
import {
  REMOTE_SYNC_BACKOFF_BASE_MS,
  REMOTE_SYNC_BACKOFF_MAX_MS,
  REMOTE_SYNC_CLAIM_LEASE_MS,
  REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH,
  REMOTE_SYNC_MAX_ATTEMPTS,
  calculateRemoteSyncBackoffMs,
  classifyRemoteSyncFailure,
  createRemoteSyncIdempotencyKey,
  createRemoteSyncOperation,
  sanitizeRemoteSyncErrorMessage,
} from './index'

describe('remote sync outbox contract', () => {
  it('keeps one local logical operation stable across Team binding changes', () => {
    const operation = {
      kind: 'test-evidence-summary' as const,
      localProjectId: 'local/project:payments',
      organizationId: 'org/one',
      teamProjectId: 'team/project:payments',
      runId: 'run:1',
      entityId: 'evidence/1',
    }

    expect(createRemoteSyncIdempotencyKey(operation)).toBe(
      'remote-sync:v1:local%2Fproject%3Apayments:test-evidence-summary:run%3A1:evidence%2F1',
    )
    expect(createRemoteSyncIdempotencyKey(operation)).toBe(
      createRemoteSyncIdempotencyKey({
        ...operation,
        organizationId: 'org/two',
        teamProjectId: 'team/project:other',
      }),
    )
  })

  it('creates a pending operation from identifiers without retaining upload content', () => {
    const unsafeInput = {
      id: 'sync-1',
      kind: 'coding-agent-summary' as const,
      localProjectId: 'local-1',
      organizationId: 'org-1',
      teamProjectId: 'team-1',
      runId: 'run-1',
      entityId: 'coding-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      payload: { secret: 'never persist' },
      prompt: 'never persist',
      stdout: 'never persist',
      stderr: 'never persist',
      patch: 'never persist',
    }

    expect(createRemoteSyncOperation(unsafeInput)).toEqual({
      id: 'sync-1',
      kind: 'coding-agent-summary',
      localProjectId: 'local-1',
      organizationId: 'org-1',
      teamProjectId: 'team-1',
      runId: 'run-1',
      entityId: 'coding-1',
      idempotencyKey:
        'remote-sync:v1:local-1:coding-agent-summary:run-1:coding-1',
      status: 'pending',
      generation: 1,
      attemptCount: 0,
      nextAttemptAt: '2026-08-01T00:00:00.000Z',
      leaseExpiresAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      recovery: 'none',
      completedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
  })

  it('gives Agent Runtime summaries one metadata-only logical operation identity', () => {
    const operation = createRemoteSyncOperation({
      id: 'sync-runtime-1',
      kind: 'agent-runtime-summary',
      localProjectId: 'local-1',
      organizationId: 'org-1',
      teamProjectId: 'team-1',
      runId: 'run-1',
      entityId: 'agent-runtime-1',
      createdAt: '2026-08-12T20:00:00.000Z',
    })

    expect(operation).toMatchObject({
      kind: 'agent-runtime-summary',
      entityId: 'agent-runtime-1',
      idempotencyKey:
        'remote-sync:v1:local-1:agent-runtime-summary:run-1:agent-runtime-1',
    })
    expect(JSON.stringify(operation)).not.toMatch(/payload|source|output|checkpoint/i)
  })

  it('represents an operation awaiting its first Team binding with null scope', () => {
    const operation = createRemoteSyncOperation({
      id: 'sync-unbound',
      kind: 'run-summary',
      localProjectId: 'local-1',
      runId: 'run-1',
      entityId: 'run-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    })

    expect({
      organizationId: operation.organizationId,
      teamProjectId: operation.teamProjectId,
    }).toEqual({
      organizationId: null,
      teamProjectId: null,
    })
  })

  it('uses deterministic exponential retry delays with a fixed cap', () => {
    expect(REMOTE_SYNC_BACKOFF_BASE_MS).toBe(1_000)
    expect(REMOTE_SYNC_BACKOFF_MAX_MS).toBe(300_000)
    expect(REMOTE_SYNC_MAX_ATTEMPTS).toBe(5)
    expect(REMOTE_SYNC_CLAIM_LEASE_MS).toBe(60_000)
    expect([
      calculateRemoteSyncBackoffMs(1),
      calculateRemoteSyncBackoffMs(2),
      calculateRemoteSyncBackoffMs(3),
      calculateRemoteSyncBackoffMs(10),
      calculateRemoteSyncBackoffMs(100),
    ]).toEqual([1_000, 2_000, 4_000, 300_000, 300_000])
  })

  it('rejects invalid retry attempt counts instead of inventing a schedule', () => {
    expect(() => calculateRemoteSyncBackoffMs(0)).toThrow(/positive integer/)
    expect(() => calculateRemoteSyncBackoffMs(1.5)).toThrow(/positive integer/)
  })

  it('redacts and bounds the last error message before persistence', () => {
    const message = sanitizeRemoteSyncErrorMessage(
      `Authorization: Bearer top-secret failed in C:\\Users\\Alice\\private\\repo ${'x'.repeat(1_000)}`,
    )

    expect(REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH).toBe(500)
    expect(message.length).toBeLessThanOrEqual(REMOTE_SYNC_ERROR_MESSAGE_MAX_LENGTH)
    expect(message).toContain('[REDACTED:authorization_secret]')
    expect(message).toContain('[REDACTED:local_absolute_path]')
    expect(message).not.toContain('top-secret')
    expect(message).not.toContain('C:\\Users\\Alice')
    expect(message).toMatch(/\[truncated\]$/)
  })

  it('classifies network, timeout, rate-limit, and server failures as retryable', () => {
    expect([
      classifyRemoteSyncFailure({ status: null, code: 'network' }),
      classifyRemoteSyncFailure({ status: null, code: 'remote_unavailable' }),
      classifyRemoteSyncFailure({ status: 408, code: 'request_timeout' }),
      classifyRemoteSyncFailure({ status: 429, code: 'rate_limited' }),
      classifyRemoteSyncFailure({ status: 500, code: 'remote_error' }),
      classifyRemoteSyncFailure({ status: 503, code: 'service_unavailable' }),
      classifyRemoteSyncFailure({ status: 200, code: 'invalid_response' }),
    ]).toEqual(Array.from({ length: 7 }, () => ({
      disposition: 'retryable',
      recovery: 'none',
    })))
  })

  it('uses recovery only for the exact canonical-missing conflict', () => {
    expect(classifyRemoteSyncFailure({
      status: 409,
      code: 'canonical_run_required',
    })).toEqual({
      disposition: 'recovery',
      recovery: 'canonical-run-required',
    })
    expect(classifyRemoteSyncFailure({
      status: 400,
      code: 'canonical_run_required',
    })).toEqual({ disposition: 'terminal', recovery: 'none' })
    expect(classifyRemoteSyncFailure({
      status: 409,
      code: 'conflict',
    })).toEqual({ disposition: 'terminal', recovery: 'none' })
  })

  it('classifies client, auth, scope, missing, and immutable conflicts as terminal', () => {
    expect([
      classifyRemoteSyncFailure({ status: 400, code: 'bad_request' }),
      classifyRemoteSyncFailure({ status: 401, code: 'unauthorized' }),
      classifyRemoteSyncFailure({ status: 403, code: 'forbidden' }),
      classifyRemoteSyncFailure({ status: 404, code: 'not_found' }),
      classifyRemoteSyncFailure({ status: 409, code: 'immutable_conflict' }),
      classifyRemoteSyncFailure({ status: 401, code: 'network' }),
    ]).toEqual(Array.from({ length: 6 }, () => ({
      disposition: 'terminal',
      recovery: 'none',
    })))
  })
})
