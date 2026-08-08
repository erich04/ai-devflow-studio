import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopPairingCredential,
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { WorkRequestMaterializationBinding } from './local-store'
import {
  DesktopWorkRequestMaterializationError,
  createDesktopWorkRequestMaterializer,
  type DesktopWorkRequestMaterializerClient,
  type DesktopWorkRequestMaterializerStore,
} from './work-request-materializer'

const pairingFixture: DesktopPairingCredential = {
  tokenId: 'desktop-token-record-1',
  organizationId: 'org-team',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'user-desktop',
  role: 'member',
  authAccountId: 'auth-desktop',
  projectMemberships: [
    {
      projectId: 'team-project-1',
      userId: 'user-desktop',
      role: 'member',
    },
  ],
  createdAt: '2026-08-01T09:00:00.000Z',
}

function openWorkRequest(changes: Partial<WorkRequest> = {}): WorkRequest {
  return {
    id: 'wr-rollout',
    organizationId: 'org-team',
    projectId: 'team-project-1',
    title: 'Prepare reversible rollout',
    request: 'Implement the approved rollout with a rollback path.',
    version: 1,
    status: 'open',
    createdByUserId: 'user-requester',
    claim: null,
    expiresAt: '2026-08-01T11:00:00.000Z',
    createdAt: '2026-08-01T09:30:00.000Z',
    updatedAt: '2026-08-01T09:30:00.000Z',
    ...changes,
  }
}

function claimedWorkRequest(
  runId: string,
  source: WorkRequest = openWorkRequest(),
): WorkRequest {
  return {
    ...source,
    version: source.version + 1,
    status: 'claim_pending',
    claim: {
      runId,
      claimedAt: '2026-08-01T10:00:00.000Z',
      materializedAt: null,
    },
    updatedAt: '2026-08-01T10:00:00.000Z',
  }
}

function materializedWorkRequest(claimed: WorkRequest): WorkRequest {
  return {
    ...claimed,
    version: claimed.version + 1,
    status: 'materialized',
    claim: {
      ...claimed.claim!,
      materializedAt: '2026-08-01T10:01:00.000Z',
    },
    updatedAt: '2026-08-01T10:01:00.000Z',
  }
}

function createHarness() {
  const order: string[] = []
  const pairing = structuredClone(pairingFixture)
  let remoteSnapshot = openWorkRequest()
  let storedRun: WorkflowRun | null = null
  let binding: WorkRequestMaterializationBinding | null = null

  const listWorkRequests = vi.fn<
    DesktopWorkRequestMaterializerClient['listWorkRequests']
  >(async () => {
    order.push('list')
    return [structuredClone(remoteSnapshot)]
  })
  const claimWorkRequest = vi.fn<
    DesktopWorkRequestMaterializerClient['claimWorkRequest']
  >(async (input) => {
    order.push('claim')
    remoteSnapshot = claimedWorkRequest(input.runId, remoteSnapshot)
    return {
      workRequest: structuredClone(remoteSnapshot),
      replayed: false,
      outcomeCode: 'claimed',
    }
  })
  const materializeWorkRequest = vi.fn<
    DesktopWorkRequestMaterializerClient['materializeWorkRequest']
  >(async () => {
    order.push('materialize-remote')
    remoteSnapshot = materializedWorkRequest(remoteSnapshot)
    return {
      workRequest: structuredClone(remoteSnapshot),
      replayed: false,
      outcomeCode: 'materialized',
    }
  })
  const client: DesktopWorkRequestMaterializerClient = {
    listWorkRequests,
    claimWorkRequest,
    materializeWorkRequest,
  }

  const materializeClaimedWorkRequest = vi.fn<
    DesktopWorkRequestMaterializerStore['materializeClaimedWorkRequest']
  >(async (atomicInput) => {
    order.push('materialize-local')
    if (binding) {
      const same =
        binding.workRequestId === atomicInput.workRequest.id &&
        binding.runId === atomicInput.creation.run.id &&
        binding.claimVersion === atomicInput.workRequest.version &&
        binding.sourceFingerprint === atomicInput.sourceFingerprint &&
        binding.materializeIdempotencyKey ===
          atomicInput.materializeIdempotencyKey &&
        JSON.stringify(storedRun) === JSON.stringify(atomicInput.creation.run)
      return { status: same ? 'replayed' : 'conflict' }
    }

    const claimedAt = atomicInput.workRequest.claim!.claimedAt
    storedRun = structuredClone(atomicInput.creation.run)
    binding = {
      workRequestId: atomicInput.workRequest.id,
      organizationId: atomicInput.workRequest.organizationId,
      teamProjectId: atomicInput.workRequest.projectId,
      localProjectId: atomicInput.expectedPairing.localProjectId,
      runId: atomicInput.creation.run.id,
      claimVersion: atomicInput.workRequest.version,
      sourceFingerprint: atomicInput.sourceFingerprint,
      materializeIdempotencyKey: atomicInput.materializeIdempotencyKey,
      status: 'pending_ack',
      acknowledgedVersion: null,
      createdAt: claimedAt,
      updatedAt: claimedAt,
      acknowledgedAt: null,
    }
    return { status: 'created' }
  })
  const getWorkRequestMaterializationByWorkRequestId = vi.fn<
    DesktopWorkRequestMaterializerStore['getWorkRequestMaterializationByWorkRequestId']
  >(async () => {
    order.push('read-binding-work-request')
    return binding ? structuredClone(binding) : null
  })
  const getWorkRequestMaterializationByRunId = vi.fn<
    DesktopWorkRequestMaterializerStore['getWorkRequestMaterializationByRunId']
  >(async () => {
    order.push('read-binding-run')
    return binding ? structuredClone(binding) : null
  })
  const getRun = vi.fn<DesktopWorkRequestMaterializerStore['getRun']>(
    async () => {
      order.push('read-run')
      return storedRun ? structuredClone(storedRun) : null
    },
  )
  const markWorkRequestMaterializationAcknowledged = vi.fn<
    DesktopWorkRequestMaterializerStore['markWorkRequestMaterializationAcknowledged']
  >(async (ackInput) => {
    order.push('mark-local-acknowledged')
    if (!binding) return { acknowledged: false, reason: 'not_found' }
    binding.status = 'acknowledged'
    binding.acknowledgedVersion = ackInput.materializedVersion
    binding.acknowledgedAt = ackInput.acknowledgedAt
    binding.updatedAt = ackInput.acknowledgedAt
    return { acknowledged: true }
  })
  const store: DesktopWorkRequestMaterializerStore = {
    materializeClaimedWorkRequest,
    markWorkRequestMaterializationAcknowledged,
    getWorkRequestMaterializationByWorkRequestId,
    getWorkRequestMaterializationByRunId,
    getRun,
  }
  const dependencies = { pairing, client, store }

  return {
    pairing,
    client,
    store,
    order,
    materializer: createDesktopWorkRequestMaterializer(dependencies),
    restart: () => createDesktopWorkRequestMaterializer(dependencies),
    listWorkRequests,
    claimWorkRequest,
    materializeWorkRequest,
    materializeClaimedWorkRequest,
    markWorkRequestMaterializationAcknowledged,
    getWorkRequestMaterializationByWorkRequestId,
    getWorkRequestMaterializationByRunId,
    getRun,
    getRemoteSnapshot: () => remoteSnapshot,
    setRemoteSnapshot: (value: WorkRequest) => {
      remoteSnapshot = value
    },
    getStoredRun: () => storedRun,
    setStoredRun: (value: WorkflowRun | null) => {
      storedRun = value
    },
    getBinding: () => binding,
    setBinding: (value: WorkRequestMaterializationBinding | null) => {
      binding = value
    },
  }
}

const input = {
  localProjectId: 'local-project-1',
  workRequestId: 'wr-rollout',
  expectedVersion: 1,
}

describe('Desktop Work Request materializer', () => {
  it('loads, claims, atomically creates the canonical workflow and outbox, then acknowledges', async () => {
    const harness = createHarness()

    const result = await harness.materializer.materialize(input)

    expect(harness.order).toEqual([
      'list',
      'claim',
      'materialize-local',
      'read-binding-work-request',
      'read-binding-run',
      'read-run',
      'materialize-remote',
      'mark-local-acknowledged',
    ])
    expect(result).toMatchObject({
      localWorkflow: 'created',
      claimReplayed: false,
      materializeReplayed: false,
      run: {
        version: 1,
        projectId: 'local-project-1',
        creatorId: 'user-desktop',
        title: 'Prepare reversible rollout',
        request: 'Implement the approved rollout with a rollback path.',
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      workRequest: { status: 'materialized', version: 3 },
    })
    expect(harness.listWorkRequests).toHaveBeenCalledWith(
      'team-project-1',
      pairingFixture,
    )

    const claimInput = harness.claimWorkRequest.mock.calls[0]?.[0]
    expect(claimInput).toEqual({
      workRequestId: 'wr-rollout',
      expectedVersion: 1,
      runId: expect.stringMatching(/^run-work-request-[a-f0-9]{32}$/),
      idempotencyKey: expect.stringMatching(
        /^desktop-work-request:v1:claim:[a-f0-9]{64}:v1$/,
      ),
    })
    expect(Object.keys(claimInput ?? {}).sort()).toEqual([
      'expectedVersion',
      'idempotencyKey',
      'runId',
      'workRequestId',
    ])

    const atomicInput =
      harness.materializeClaimedWorkRequest.mock.calls[0]?.[0]
    expect(atomicInput).toMatchObject({
      workRequest: {
        id: 'wr-rollout',
        status: 'claim_pending',
        version: 2,
      },
      expectedPairing: {
        tokenId: 'desktop-token-record-1',
        organizationId: 'org-team',
        projectId: 'team-project-1',
        localProjectId: 'local-project-1',
      },
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      materializeIdempotencyKey: expect.stringMatching(
        /^desktop-work-request:v1:materialize:[a-f0-9]{64}:v2$/,
      ),
      creation: {
        run: {
          id: claimInput?.runId,
          branchName: expect.stringMatching(/^ai\/work-request-[a-f0-9]{12}$/),
        },
      },
    })
    expect(atomicInput?.creation.artifacts).toHaveLength(1)
    expect(atomicInput?.creation.events).toHaveLength(1)

    expect(harness.materializeWorkRequest).toHaveBeenCalledWith(
      {
        workRequestId: 'wr-rollout',
        expectedVersion: 2,
        runId: claimInput?.runId,
        idempotencyKey: atomicInput?.materializeIdempotencyKey,
      },
      pairingFixture,
    )
    expect(
      harness.markWorkRequestMaterializationAcknowledged,
    ).toHaveBeenCalledWith({
      workRequestId: 'wr-rollout',
      runId: claimInput?.runId,
      materializedVersion: 3,
      acknowledgedAt: '2026-08-01T10:01:00.000Z',
      expectedPairing: atomicInput?.expectedPairing,
      sourceFingerprint: atomicInput?.sourceFingerprint,
      materializeIdempotencyKey: atomicInput?.materializeIdempotencyKey,
    })
    expect(harness.getBinding()).toMatchObject({
      status: 'acknowledged',
      acknowledgedVersion: 3,
    })
  })

  it('restarts from a listed claim_pending v2 without trying to claim v2 again', async () => {
    const harness = createHarness()
    const acknowledgementFailure = new Error('temporary remote failure')
    harness.materializeWorkRequest.mockRejectedValueOnce(acknowledgementFailure)

    await expect(harness.materializer.materialize(input)).rejects.toBe(
      acknowledgementFailure,
    )
    expect(harness.getRemoteSnapshot()).toMatchObject({
      status: 'claim_pending',
      version: 2,
    })
    expect(harness.getBinding()).toMatchObject({ status: 'pending_ack' })

    const recovered = await harness.restart().materialize({
      ...input,
      expectedVersion: 2,
    })

    expect(recovered).toMatchObject({
      localWorkflow: 'reused',
      workRequest: { status: 'materialized', version: 3 },
    })
    expect(harness.claimWorkRequest).toHaveBeenCalledTimes(1)
    expect(harness.materializeClaimedWorkRequest).toHaveBeenCalledTimes(2)
    expect(
      harness.materializeClaimedWorkRequest.mock.calls[1]?.[0]
        .sourceFingerprint,
    ).toBe(
      harness.materializeClaimedWorkRequest.mock.calls[0]?.[0]
        .sourceFingerprint,
    )
  })

  it('recovers a materialized v3 after the acknowledgement succeeded remotely but its response was lost', async () => {
    const harness = createHarness()
    const lostResponse = new Error('response lost')
    harness.materializeWorkRequest.mockImplementationOnce(async () => {
      harness.setRemoteSnapshot(
        materializedWorkRequest(harness.getRemoteSnapshot()),
      )
      throw lostResponse
    })

    await expect(harness.materializer.materialize(input)).rejects.toBe(
      lostResponse,
    )
    expect(harness.getRemoteSnapshot()).toMatchObject({
      status: 'materialized',
      version: 3,
    })
    expect(harness.getBinding()).toMatchObject({ status: 'pending_ack' })

    const recovered = await harness.restart().materialize({
      ...input,
      expectedVersion: 3,
    })

    expect(recovered).toMatchObject({
      localWorkflow: 'reused',
      materializeReplayed: true,
      workRequest: { status: 'materialized', version: 3 },
    })
    expect(harness.claimWorkRequest).toHaveBeenCalledTimes(1)
    expect(harness.materializeClaimedWorkRequest).toHaveBeenCalledTimes(1)
    expect(harness.materializeWorkRequest).toHaveBeenCalledTimes(1)
    expect(harness.getBinding()).toMatchObject({
      status: 'acknowledged',
      acknowledgedVersion: 3,
    })
  })

  it('opens the current bound Run after its workflow has advanced beyond the creation snapshot', async () => {
    const harness = createHarness()
    await harness.materializer.materialize(input)
    const initialRun = harness.getStoredRun()!
    const currentNode = initialRun.nodes[1]!
    const advancedRun: WorkflowRun = {
      ...initialRun,
      version: initialRun.version + 1,
      status: 'building',
      currentNodeId: currentNode.id,
      updatedAt: '2026-08-01T10:05:00.000Z',
      nodes: initialRun.nodes.map((node, index) =>
        index === 0
          ? { ...node, status: 'success' }
          : index === 1
            ? { ...node, status: 'running' }
            : node,
      ),
    }
    harness.setStoredRun(advancedRun)

    const reopened = await harness.restart().materialize({
      ...input,
      expectedVersion: 3,
    })

    expect(reopened.run).toEqual(advancedRun)
    expect(reopened.localWorkflow).toBe('reused')
    expect(harness.claimWorkRequest).toHaveBeenCalledTimes(1)
    expect(harness.materializeWorkRequest).toHaveBeenCalledTimes(1)
    expect(
      harness.markWorkRequestMaterializationAcknowledged,
    ).toHaveBeenCalledTimes(1)
  })

  it('never reconstructs a materialized remote Work Request without its durable local binding', async () => {
    const harness = createHarness()
    harness.materializeWorkRequest.mockImplementationOnce(async () => {
      harness.setRemoteSnapshot(
        materializedWorkRequest(harness.getRemoteSnapshot()),
      )
      throw new Error('response lost')
    })
    await expect(harness.materializer.materialize(input)).rejects.toThrow(
      'response lost',
    )
    harness.setBinding(null)
    harness.setStoredRun(null)
    harness.materializeClaimedWorkRequest.mockClear()

    await expect(
      harness.restart().materialize({ ...input, expectedVersion: 3 }),
    ).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'local_binding_missing',
    })
    expect(harness.materializeClaimedWorkRequest).not.toHaveBeenCalled()
  })

  it('fails closed when LocalStore reports a provenance conflict', async () => {
    const harness = createHarness()
    harness.materializeClaimedWorkRequest.mockResolvedValueOnce({
      status: 'conflict',
    })

    await expect(harness.materializer.materialize(input)).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'local_run_conflict',
      message: 'Deterministic Work Request Run conflicts with existing local state.',
    })
    expect(harness.materializeWorkRequest).not.toHaveBeenCalled()
  })

  it('fails closed when the atomic LocalStore pairing precondition changes', async () => {
    const harness = createHarness()
    harness.materializeClaimedWorkRequest.mockResolvedValueOnce({
      status: 'pairing_scope_mismatch',
    })

    await expect(harness.materializer.materialize(input)).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'pairing_scope_mismatch',
    })
    expect(harness.materializeWorkRequest).not.toHaveBeenCalled()
  })

  it('does not touch local state or acknowledge when the remote claim fails', async () => {
    const harness = createHarness()
    const claimFailure = new Error('claim rejected')
    harness.claimWorkRequest.mockRejectedValueOnce(claimFailure)

    await expect(harness.materializer.materialize(input)).rejects.toBe(
      claimFailure,
    )
    expect(harness.materializeClaimedWorkRequest).not.toHaveBeenCalled()
    expect(harness.materializeWorkRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['organizationId', 'org-other'],
    ['projectId', 'team-project-other'],
  ] as const)(
    'rejects a listed Work Request with cross-scope %s before claiming',
    async (field, value) => {
      const harness = createHarness()
      harness.setRemoteSnapshot(openWorkRequest({ [field]: value }))

      await expect(harness.materializer.materialize(input)).rejects.toMatchObject({
        name: 'DesktopWorkRequestMaterializationError',
        code: 'remote_scope_mismatch',
      })
      expect(harness.claimWorkRequest).not.toHaveBeenCalled()
      expect(harness.materializeClaimedWorkRequest).not.toHaveBeenCalled()
    },
  )

  it('rejects a local project outside the frozen pairing before listing remotely', async () => {
    const harness = createHarness()

    await expect(
      harness.materializer.materialize({
        ...input,
        localProjectId: 'local-project-other',
      }),
    ).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'pairing_scope_mismatch',
    })
    expect(harness.listWorkRequests).not.toHaveBeenCalled()
    expect(harness.claimWorkRequest).not.toHaveBeenCalled()
  })

  it('rejects a resumed claim whose Run is not the deterministic local Run', async () => {
    const harness = createHarness()
    harness.setRemoteSnapshot(claimedWorkRequest('run-untrusted'))

    await expect(
      harness.materializer.materialize({ ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'remote_claim_conflict',
    })
    expect(harness.claimWorkRequest).not.toHaveBeenCalled()
    expect(harness.materializeClaimedWorkRequest).not.toHaveBeenCalled()
  })

  it('captures pairing, client, and store dependencies against later replacement', async () => {
    const harness = createHarness()
    const replacementList = vi.fn(async () => {
      throw new Error('replacement client must not be used')
    })
    const replacementMaterialize = vi.fn(async () => ({ status: 'conflict' as const }))
    harness.client.listWorkRequests = replacementList
    harness.store.materializeClaimedWorkRequest = replacementMaterialize
    harness.pairing.projectId = 'team-project-mutated'
    harness.pairing.localProjectId = 'local-project-mutated'
    harness.pairing.projectMemberships.length = 0

    await expect(harness.materializer.materialize(input)).resolves.toMatchObject({
      localWorkflow: 'created',
      workRequest: { status: 'materialized' },
    })
    expect(replacementList).not.toHaveBeenCalled()
    expect(replacementMaterialize).not.toHaveBeenCalled()
  })

  it('rejects caller-controlled scope, content, Run, token, or idempotency fields', async () => {
    const harness = createHarness()
    const forbiddenInputs = [
      { ...input, projectId: 'team-project-1' },
      { ...input, organizationId: 'org-team' },
      { ...input, runId: 'caller-run' },
      { ...input, token: 'caller-token' },
      { ...input, title: 'Caller title' },
      { ...input, request: 'Caller request' },
      { ...input, idempotencyKey: 'caller-key' },
    ]

    for (const forbiddenInput of forbiddenInputs) {
      await expect(
        harness.materializer.materialize(forbiddenInput),
      ).rejects.toBeInstanceOf(DesktopWorkRequestMaterializationError)
    }
    expect(harness.listWorkRequests).not.toHaveBeenCalled()
    expect(harness.claimWorkRequest).not.toHaveBeenCalled()
    expect(harness.materializeClaimedWorkRequest).not.toHaveBeenCalled()
  })

  it('retains the pending local binding when a remote acknowledgement escapes scope', async () => {
    const harness = createHarness()
    harness.materializeWorkRequest.mockImplementationOnce(async () => {
      const materialized = materializedWorkRequest(
        harness.getRemoteSnapshot(),
      )
      return {
        workRequest: { ...materialized, organizationId: 'org-other' },
        replayed: false,
        outcomeCode: 'materialized',
      }
    })

    await expect(harness.materializer.materialize(input)).rejects.toMatchObject({
      name: 'DesktopWorkRequestMaterializationError',
      code: 'remote_scope_mismatch',
    })
    expect(harness.getBinding()).toMatchObject({ status: 'pending_ack' })
    expect(
      harness.markWorkRequestMaterializationAcknowledged,
    ).not.toHaveBeenCalled()
  })
})
