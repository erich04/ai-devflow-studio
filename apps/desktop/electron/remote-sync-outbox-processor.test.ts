import { describe, expect, it, vi } from 'vitest'
import {
  REMOTE_SYNC_CLAIM_LEASE_MS,
  createRemoteSyncOperation,
  type DesktopPairingCredential,
  type RemoteSyncFailureCode,
  type RemoteSyncOperation,
  type RemoteSyncOperationStatus,
  type RemoteSyncRecovery,
} from '@ai-devflow/shared'
import {
  createRemoteSyncOutboxProcessor as createProcessorWithClock,
  type BindRemoteSyncOperationScopeInput,
  type BindRemoteSyncOperationScopeResult,
  type RemoteSyncOutboxStore,
  type SettleRemoteSyncOperationInput,
  type SettleRemoteSyncOperationResult,
} from './remote-sync-outbox-processor'
import { RemoteSyncHttpError } from './remote-sync'
import { CanonicalRemoteSyncEntityError } from './project-bound-remote-sync'

const now = '2026-08-01T12:00:00.000Z'

function createRemoteSyncOutboxProcessor(
  deps: Parameters<typeof createProcessorWithClock>[0],
) {
  return createProcessorWithClock({ clock: { now: () => now }, ...deps })
}

const pairing: DesktopPairingCredential = {
  tokenId: 'token-1',
  organizationId: 'org-1',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'user-1',
  role: 'owner',
  authAccountId: 'account-1',
  projectMemberships: [],
  createdAt: now,
}

function withoutLocalProjectId(
  credential: DesktopPairingCredential,
): DesktopPairingCredential {
  const copy = { ...credential }
  delete copy.localProjectId
  return copy
}

function operation(
  overrides: Partial<RemoteSyncOperation> = {},
): RemoteSyncOperation {
  return {
    ...createRemoteSyncOperation({
      id: 'operation-1',
      kind: 'run-summary',
      localProjectId: 'local-project-1',
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      runId: 'run-1',
      entityId: 'run-1',
      createdAt: now,
    }),
    ...overrides,
  }
}

class FakeOutboxStore implements RemoteSyncOutboxStore {
  readonly operations: RemoteSyncOperation[]
  pairing: DesktopPairingCredential | null = pairing
  recoverCalls: string[] = []

  constructor(operations: RemoteSyncOperation[] = []) {
    this.operations = operations
  }

  async getDesktopPairingCredential() {
    return this.pairing
  }

  async recoverInterruptedRemoteSyncOperations(recoveredAt: string) {
    this.recoverCalls.push(recoveredAt)
    return 0
  }

  async claimNextRemoteSyncOperation(claimedAt: string) {
    const candidate = this.operations.find((item) =>
      (item.status === 'pending' || item.status === 'retry-scheduled') &&
      item.nextAttemptAt !== null &&
      item.nextAttemptAt <= claimedAt)
    if (!candidate) return null

    Object.assign(candidate, {
      status: 'sending' as const,
      attemptCount: candidate.attemptCount + 1,
      lastAttemptAt: claimedAt,
      leaseExpiresAt: new Date(
        Date.parse(claimedAt) + REMOTE_SYNC_CLAIM_LEASE_MS,
      ).toISOString(),
      nextAttemptAt: null,
      updatedAt: claimedAt,
    })
    return { ...candidate }
  }

  async bindRemoteSyncOperationScope(
    input: BindRemoteSyncOperationScopeInput,
  ): Promise<BindRemoteSyncOperationScopeResult> {
    const candidate = this.operations.find((item) => item.id === input.id)
    if (!candidate) return { bound: false, reason: 'not_found' }
    if (candidate.generation !== input.generation) {
      return { bound: false, reason: 'stale_generation' }
    }
    if (
      candidate.organizationId !== null ||
      candidate.teamProjectId !== null
    ) {
      return candidate.organizationId === input.organizationId &&
        candidate.teamProjectId === input.teamProjectId
        ? { bound: true, operation: { ...candidate } }
        : { bound: false, reason: 'scope_mismatch' }
    }

    Object.assign(candidate, {
      organizationId: input.organizationId,
      teamProjectId: input.teamProjectId,
      updatedAt: input.updatedAt,
    })
    return { bound: true, operation: { ...candidate } }
  }

  async settleRemoteSyncOperation(
    input: SettleRemoteSyncOperationInput,
  ): Promise<SettleRemoteSyncOperationResult> {
    const candidate = this.operations.find((item) => item.id === input.id)
    if (!candidate) return { settled: false, reason: 'not_found' }
    if (candidate.generation !== input.generation) {
      return { settled: false, reason: 'stale_generation' }
    }
    if (candidate.status !== 'sending') {
      return { settled: false, reason: 'not_sending' }
    }

    Object.assign(candidate, {
      status: input.status,
      nextAttemptAt: input.nextAttemptAt,
      lastErrorCode: input.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage,
      recovery: input.recovery,
      completedAt: input.completedAt,
      leaseExpiresAt: null,
      updatedAt: input.updatedAt,
    })
    return { settled: true, operation: { ...candidate } }
  }
}

type SettleExpectation = {
  status: RemoteSyncOperationStatus
  errorCode: RemoteSyncFailureCode | null
  recovery: RemoteSyncRecovery
}

function expectSettled(
  actual: RemoteSyncOperation,
  expected: SettleExpectation,
) {
  expect({
    status: actual.status,
    errorCode: actual.lastErrorCode,
    recovery: actual.recovery,
  }).toEqual(expected)
}

describe('createRemoteSyncOutboxProcessor', () => {
  it('times out a hung upload, aborts it, and releases concurrent drains for retry', async () => {
    let currentTime = now
    let timeoutCallback: (() => void) | undefined
    const clearTimeout = vi.fn()
    const timers = {
      setTimeout(callback: () => void, delayMs: number) {
        expect(delayMs).toBe(30_000)
        timeoutCallback = callback
        return 17
      },
      clearTimeout,
    }
    let attemptSignal: AbortSignal | undefined
    const store = new FakeOutboxStore([operation()])
    const uploadCanonicalRunSummary = vi.fn(
      () => new Promise<never>(() => undefined),
    )
    const processor = createRemoteSyncOutboxProcessor({
      store,
      clock: { now: () => currentTime },
      timers,
      getRemoteSync: async ({ signal }) => {
        attemptSignal = signal
        return {
          uploadCanonicalRunSummary,
          uploadCanonicalTestEvidenceSummary: vi.fn(),
          uploadCanonicalAgentReviewSummary: vi.fn(),
          uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
        }
      },
    })

    const firstDrain = processor.drain()
    const concurrentDrain = processor.drain()
    await vi.waitFor(() => expect(uploadCanonicalRunSummary).toHaveBeenCalledOnce())

    expect(timeoutCallback).toBeTypeOf('function')
    currentTime = '2026-08-01T12:00:30.000Z'
    timeoutCallback!()
    await Promise.all([firstDrain, concurrentDrain])

    expect(attemptSignal?.aborted).toBe(true)
    expect(clearTimeout).toHaveBeenCalledWith(17)
    expect(store.operations[0]).toMatchObject({
      status: 'retry-scheduled',
      lastErrorCode: 'request_timeout',
      nextAttemptAt: '2026-08-01T12:00:31.000Z',
    })
  })

  it('calculates retry backoff from the actual failure time after a long request', async () => {
    let currentTime = now
    let rejectUpload!: (error: Error) => void
    const upload = new Promise<never>((_resolve, reject) => {
      rejectUpload = reject
    })
    const store = new FakeOutboxStore([operation()])
    const processor = createRemoteSyncOutboxProcessor({
      store,
      clock: { now: () => currentTime },
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn(() => upload),
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    const draining = processor.drain()
    await vi.waitFor(() => expect(store.operations[0]?.status).toBe('sending'))
    currentTime = '2026-08-01T12:00:10.000Z'
    rejectUpload(new RemoteSyncHttpError({
      status: null,
      code: 'remote_unavailable',
      path: '/api/sync/run-summary',
      retryable: true,
    }))
    await draining

    expect(store.operations[0]).toMatchObject({
      status: 'retry-scheduled',
      updatedAt: '2026-08-01T12:00:10.000Z',
      nextAttemptAt: '2026-08-01T12:00:11.000Z',
    })
  })

  it('constructs the remote client with the bound immutable scope and an abort signal', async () => {
    const store = new FakeOutboxStore([operation()])
    const getRemoteSync = vi.fn(async () => ({
      uploadCanonicalRunSummary: vi.fn().mockResolvedValue({
        accepted: true,
        syncedAt: now,
        message: 'accepted',
      }),
      uploadCanonicalTestEvidenceSummary: vi.fn(),
      uploadCanonicalAgentReviewSummary: vi.fn(),
      uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
    }))
    const processor = createRemoteSyncOutboxProcessor({ store, getRemoteSync })

    await processor.drain()

    expect(getRemoteSync).toHaveBeenCalledWith({
      scope: {
        localProjectId: 'local-project-1',
        organizationId: 'org-1',
        teamProjectId: 'team-project-1',
      },
      signal: expect.any(AbortSignal),
    })
  })

  it('keeps the bound scope when pairing changes before the remote client is constructed', async () => {
    class RepairedAfterBindStore extends FakeOutboxStore {
      override async bindRemoteSyncOperationScope(input: BindRemoteSyncOperationScopeInput) {
        const result = await super.bindRemoteSyncOperationScope(input)
        this.pairing = {
          ...pairing,
          tokenId: 'token-2',
          organizationId: 'org-2',
          projectId: 'team-project-2',
        }
        return result
      }
    }
    const store = new RepairedAfterBindStore([operation()])
    const getRemoteSync = vi.fn(async () => ({
      uploadCanonicalRunSummary: vi.fn().mockResolvedValue({
        accepted: true,
        syncedAt: now,
        message: 'accepted',
      }),
      uploadCanonicalTestEvidenceSummary: vi.fn(),
      uploadCanonicalAgentReviewSummary: vi.fn(),
      uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
    }))
    const processor = createRemoteSyncOutboxProcessor({ store, getRemoteSync })

    await processor.drain()

    expect(getRemoteSync).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        localProjectId: 'local-project-1',
        organizationId: 'org-1',
        teamProjectId: 'team-project-1',
      },
    }))
  })

  it('leaves claimed work for lease recovery when pairing or binding storage reads fail', async () => {
    const failures = [
      new class extends FakeOutboxStore {
        override async getDesktopPairingCredential(): Promise<DesktopPairingCredential | null> {
          throw new Error('pairing store unavailable')
        }
      }([operation({ id: 'pairing-read-failure' })]),
      new class extends FakeOutboxStore {
        override async bindRemoteSyncOperationScope(
          _input: BindRemoteSyncOperationScopeInput,
        ): Promise<BindRemoteSyncOperationScopeResult> {
          throw new Error('binding store unavailable')
        }
      }([operation({ id: 'binding-failure' })]),
    ]

    for (const store of failures) {
      const getRemoteSync = vi.fn()
      const processor = createRemoteSyncOutboxProcessor({ store, getRemoteSync })

      await expect(processor.drain()).rejects.toThrow(/store unavailable/)

      expect(store.operations[0]).toMatchObject({
        status: 'sending',
        leaseExpiresAt: '2026-08-01T12:01:00.000Z',
      })
      expect(getRemoteSync).not.toHaveBeenCalled()
    }
  })

  it('recovers interrupted work and drains a due canonical Run operation', async () => {
    const store = new FakeOutboxStore([operation()])
    const uploadCanonicalRunSummary = vi.fn().mockResolvedValue({
      accepted: true,
      syncedAt: now,
      message: 'accepted',
    })
    const onStateChanged = vi.fn()
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary,
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
      onStateChanged,
    })

    await processor.recoverAndDrain()

    expect(store.recoverCalls).toEqual([now])
    expect(uploadCanonicalRunSummary).toHaveBeenCalledOnce()
    expect(uploadCanonicalRunSummary).toHaveBeenCalledWith('run-1')
    expect(onStateChanged).toHaveBeenCalledOnce()
    expect(onStateChanged).toHaveBeenCalledWith()
    expectSettled(store.operations[0]!, {
      status: 'completed',
      errorCode: null,
      recovery: 'none',
    })
  })

  it('schedules a sanitized exponential retry for a network failure', async () => {
    const store = new FakeOutboxStore([operation()])
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn().mockRejectedValue(
          new RemoteSyncHttpError({
            status: null,
            code: 'remote_unavailable',
            path: '/api/runs?token=top-secret',
            retryable: true,
          }),
        ),
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    await processor.drain()

    expect(store.operations[0]).toMatchObject({
      status: 'retry-scheduled',
      attemptCount: 1,
      nextAttemptAt: '2026-08-01T12:00:01.000Z',
      lastErrorCode: 'remote_unavailable',
      recovery: 'none',
    })
    expect(store.operations[0]?.lastErrorMessage).not.toContain('top-secret')
  })

  it('coalesces concurrent recovery drains so recovery cannot reclaim active work', async () => {
    let releaseUpload!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    let uploadEntered!: () => void
    const uploadWasEntered = new Promise<void>((resolve) => {
      uploadEntered = resolve
    })
    class RecoveringStore extends FakeOutboxStore {
      override async recoverInterruptedRemoteSyncOperations(recoveredAt: string) {
        this.recoverCalls.push(recoveredAt)
        let recovered = 0
        for (const item of this.operations) {
          if (item.status === 'sending') {
            Object.assign(item, {
              status: 'retry-scheduled' as const,
              nextAttemptAt: recoveredAt,
              updatedAt: recoveredAt,
            })
            recovered += 1
          }
        }
        return recovered
      }
    }
    const store = new RecoveringStore([operation()])
    const uploadCanonicalRunSummary = vi.fn()
      .mockImplementationOnce(async () => {
        uploadEntered()
        await uploadStarted
        return { accepted: true, syncedAt: now, message: 'accepted' }
      })
      .mockResolvedValue({ accepted: true, syncedAt: now, message: 'accepted' })
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary,
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    const first = processor.recoverAndDrain()
    await uploadWasEntered
    const second = processor.recoverAndDrain()
    releaseUpload()
    await Promise.all([first, second])

    expect(store.recoverCalls).toEqual([now])
    expect(uploadCanonicalRunSummary).toHaveBeenCalledOnce()
  })

  it('terminally records one exhausted canonical-Run recovery without another fallback', async () => {
    const store = new FakeOutboxStore([
      operation({
        kind: 'test-evidence-summary',
        entityId: 'evidence-1',
      }),
    ])
    const canonicalRunRequired = new RemoteSyncHttpError({
      status: 409,
      code: 'canonical_run_required',
      path: '/api/test-evidence',
      retryable: false,
    })
    const uploadCanonicalTestEvidenceSummary = vi.fn()
      .mockRejectedValue(canonicalRunRequired)
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn(),
        uploadCanonicalTestEvidenceSummary,
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    await processor.drain()

    expect(uploadCanonicalTestEvidenceSummary).toHaveBeenCalledOnce()
    expectSettled(store.operations[0]!, {
      status: 'terminal',
      errorCode: 'canonical_run_required',
      recovery: 'child-retried',
    })
  })

  it('stops retrying at the fixed maximum attempt count', async () => {
    const store = new FakeOutboxStore([operation({ attemptCount: 4 })])
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn().mockRejectedValue(
          new RemoteSyncHttpError({
            status: 503,
            code: 'service_unavailable',
            path: '/api/runs',
            retryable: true,
          }),
        ),
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    await processor.drain()

    expect(store.operations[0]).toMatchObject({
      status: 'terminal',
      attemptCount: 5,
      nextAttemptAt: null,
      lastErrorCode: 'max_attempts',
      lastErrorMessage: 'Remote sync reached the retry limit.',
    })
  })

  it('fails closed with fixed pairing and scope errors before constructing a client', async () => {
    const cases: Array<{
      pairing: DesktopPairingCredential | null
      expectedCode: 'pairing_required' | 'scope_mismatch'
    }> = [
      { pairing: null, expectedCode: 'pairing_required' },
      {
        pairing: withoutLocalProjectId(pairing),
        expectedCode: 'pairing_required',
      },
      {
        pairing: { ...pairing, localProjectId: 'another-local-project' },
        expectedCode: 'scope_mismatch',
      },
    ]

    for (const current of cases) {
      const store = new FakeOutboxStore([operation()])
      store.pairing = current.pairing
      const getRemoteSync = vi.fn()
      const processor = createRemoteSyncOutboxProcessor({ store, getRemoteSync })

      await processor.drain()

      expect(getRemoteSync).not.toHaveBeenCalled()
      expect(store.operations[0]).toMatchObject({
        status: 'terminal',
        lastErrorCode: current.expectedCode,
      })
      expect(store.operations[0]?.lastErrorMessage).not.toContain('token-1')
    }
  })

  it('binds null scope once, accepts the same scope across token rotation, and rejects re-pairing', async () => {
    const store = new FakeOutboxStore([
      operation({
        id: 'unbound',
        organizationId: null,
        teamProjectId: null,
        entityId: 'run-unbound',
      }),
      operation({ id: 'same-scope', entityId: 'run-same' }),
      operation({
        id: 'other-scope',
        organizationId: 'org-other',
        teamProjectId: 'team-other',
        entityId: 'run-other',
      }),
    ])
    let credentialRead = 0
    store.getDesktopPairingCredential = async () => ({
      ...pairing,
      tokenId: `rotated-token-${++credentialRead}`,
    })
    const uploadCanonicalRunSummary = vi.fn().mockResolvedValue({
      accepted: true,
      syncedAt: now,
      message: 'accepted',
    })
    const getRemoteSync = vi.fn().mockResolvedValue({
      uploadCanonicalRunSummary,
      uploadCanonicalTestEvidenceSummary: vi.fn(),
      uploadCanonicalAgentReviewSummary: vi.fn(),
      uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
    })
    const processor = createRemoteSyncOutboxProcessor({ store, getRemoteSync })

    await processor.drain()

    expect(uploadCanonicalRunSummary.mock.calls).toEqual([
      ['run-unbound'],
      ['run-same'],
    ])
    expect(getRemoteSync).toHaveBeenCalledTimes(2)
    expect(store.operations[0]).toMatchObject({
      status: 'completed',
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
    })
    expect(store.operations[1]).toMatchObject({ status: 'completed' })
    expect(store.operations[2]).toMatchObject({
      status: 'terminal',
      lastErrorCode: 'scope_mismatch',
    })
  })

  it('dispatches every operation kind using only its canonical entity identifier', async () => {
    const store = new FakeOutboxStore([
      operation({ id: 'run-op', entityId: 'run-entity' }),
      operation({
        id: 'test-op',
        kind: 'test-evidence-summary',
        entityId: 'test-entity',
      }),
      operation({
        id: 'review-op',
        kind: 'agent-review-summary',
        entityId: 'review-entity',
      }),
      operation({
        id: 'coding-op',
        kind: 'coding-agent-summary',
        entityId: 'coding-entity',
      }),
      operation({
        id: 'runtime-op',
        kind: 'agent-runtime-summary',
        entityId: 'runtime-entity',
      }),
    ])
    const accepted = { accepted: true, syncedAt: now, message: 'accepted' }
    const methods = {
      uploadCanonicalRunSummary: vi.fn().mockResolvedValue(accepted),
      uploadCanonicalTestEvidenceSummary: vi.fn().mockResolvedValue(accepted),
      uploadCanonicalAgentReviewSummary: vi.fn().mockResolvedValue(accepted),
      uploadCanonicalCodingAgentSummary: vi.fn().mockResolvedValue(accepted),
      uploadCanonicalAgentRuntimeSummary: vi.fn().mockResolvedValue(accepted),
    }
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => methods,
    })

    await processor.drain()

    expect(methods.uploadCanonicalRunSummary).toHaveBeenCalledWith('run-entity')
    expect(methods.uploadCanonicalTestEvidenceSummary).toHaveBeenCalledWith('test-entity')
    expect(methods.uploadCanonicalAgentReviewSummary).toHaveBeenCalledWith('review-entity')
    expect(methods.uploadCanonicalCodingAgentSummary).toHaveBeenCalledWith('coding-entity')
    expect(methods.uploadCanonicalAgentRuntimeSummary).toHaveBeenCalledWith('runtime-entity')
    expect(store.operations.map((item) => item.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ])
  })

  it('does not retry client, authentication, authorization, missing, or ordinary conflict failures', async () => {
    const failures = [
      { status: 400, code: 'bad_request' as const },
      { status: 401, code: 'unauthorized' as const },
      { status: 403, code: 'forbidden' as const },
      { status: 404, code: 'not_found' as const },
      { status: 409, code: 'conflict' as const },
    ]

    for (const failure of failures) {
      const store = new FakeOutboxStore([operation()])
      const processor = createRemoteSyncOutboxProcessor({
        store,
        getRemoteSync: async () => ({
          uploadCanonicalRunSummary: vi.fn().mockRejectedValue(
            new RemoteSyncHttpError({
              ...failure,
              path: '/api/runs?authorization=top-secret',
              retryable: false,
            }),
          ),
          uploadCanonicalTestEvidenceSummary: vi.fn(),
          uploadCanonicalAgentReviewSummary: vi.fn(),
          uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
        }),
      })

      await processor.drain()

      expect(store.operations[0]).toMatchObject({
        status: 'terminal',
        nextAttemptAt: null,
        lastErrorCode: failure.code,
      })
      expect(store.operations[0]?.lastErrorMessage).not.toContain('top-secret')
    }
  })

  it('retries timeout, rate-limit, server, and invalid-response failures', async () => {
    const failures = [
      { status: 408, code: 'request_timeout' as const },
      { status: 429, code: 'rate_limited' as const },
      { status: 500, code: 'service_unavailable' as const },
      { status: 200, code: 'invalid_response' as const },
    ]

    for (const failure of failures) {
      const store = new FakeOutboxStore([operation({ attemptCount: 1 })])
      const processor = createRemoteSyncOutboxProcessor({
        store,
        getRemoteSync: async () => ({
          uploadCanonicalRunSummary: vi.fn().mockRejectedValue(
            new RemoteSyncHttpError({
              ...failure,
              path: '/api/runs',
              retryable: true,
            }),
          ),
          uploadCanonicalTestEvidenceSummary: vi.fn(),
          uploadCanonicalAgentReviewSummary: vi.fn(),
          uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
        }),
      })

      await processor.drain()

      expect(store.operations[0]).toMatchObject({
        status: 'retry-scheduled',
        attemptCount: 2,
        nextAttemptAt: '2026-08-01T12:00:02.000Z',
        lastErrorCode: failure.code,
      })
    }
  })

  it('safely discards a remote result when a newer generation wins the settle CAS', async () => {
    class StaleSettleStore extends FakeOutboxStore {
      override async settleRemoteSyncOperation(
        _input: SettleRemoteSyncOperationInput,
      ): Promise<SettleRemoteSyncOperationResult> {
        this.operations[0]!.generation += 1
        return { settled: false, reason: 'stale_generation' }
      }
    }
    const store = new StaleSettleStore([operation()])
    const onStateChanged = vi.fn()
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn().mockResolvedValue({
          accepted: true,
          syncedAt: now,
          message: 'accepted',
        }),
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
      onStateChanged,
    })

    await expect(processor.drain()).resolves.toBeUndefined()

    expect(store.operations[0]).toMatchObject({
      status: 'sending',
      generation: 2,
    })
    expect(onStateChanged).not.toHaveBeenCalled()
  })

  it('terminally rejects unaccepted results and unknown exceptions without persisting their text', async () => {
    const store = new FakeOutboxStore([
      operation({ id: 'unaccepted', entityId: 'run-unaccepted' }),
      operation({ id: 'unknown-error', entityId: 'run-error' }),
    ])
    const uploadCanonicalRunSummary = vi.fn()
      .mockResolvedValueOnce({
        accepted: false,
        syncedAt: now,
        message: 'Bearer result-secret was rejected',
      })
      .mockRejectedValueOnce(
        new Error('Authorization: Bearer exception-secret at /Users/Alice/private'),
      )
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary,
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    await processor.drain()

    expect(store.operations).toMatchObject([
      {
        status: 'terminal',
        lastErrorCode: 'remote_error',
        lastErrorMessage: 'The remote endpoint did not accept the sync operation.',
      },
      {
        status: 'terminal',
        lastErrorCode: 'remote_error',
        lastErrorMessage: 'The remote sync operation failed.',
      },
    ])
    expect(JSON.stringify(store.operations)).not.toMatch(/result-secret|exception-secret|Alice/)
  })

  it('maps structured canonical entity failures without parsing exception text', async () => {
    const failures = [
      new CanonicalRemoteSyncEntityError('entity_missing', 'agent_review'),
      new CanonicalRemoteSyncEntityError('scope_mismatch', 'coding_diff'),
    ]

    for (const failure of failures) {
      const store = new FakeOutboxStore([operation()])
      const processor = createRemoteSyncOutboxProcessor({
        store,
        getRemoteSync: async () => ({
          uploadCanonicalRunSummary: vi.fn().mockRejectedValue(failure),
          uploadCanonicalTestEvidenceSummary: vi.fn(),
          uploadCanonicalAgentReviewSummary: vi.fn(),
          uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
        }),
      })

      await processor.drain()

      expect(store.operations[0]).toMatchObject({
        status: 'terminal',
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
      })
    }
  })

  it('preserves the structured invalid canonical entity terminal classification', async () => {
    const store = new FakeOutboxStore([operation()])
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: async () => ({
        uploadCanonicalRunSummary: vi.fn().mockRejectedValue(
          new CanonicalRemoteSyncEntityError('invalid_response', 'workflow_run'),
        ),
        uploadCanonicalTestEvidenceSummary: vi.fn(),
        uploadCanonicalAgentReviewSummary: vi.fn(),
        uploadCanonicalCodingAgentSummary: vi.fn(),
        uploadCanonicalAgentRuntimeSummary: vi.fn(),
      }),
    })

    await processor.drain()

    expect(store.operations[0]).toMatchObject({
      status: 'terminal',
      lastErrorCode: 'invalid_response',
      lastErrorMessage: 'Canonical remote sync entity is invalid.',
    })
  })
})
