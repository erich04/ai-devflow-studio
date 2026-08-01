import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopPairingCredential,
  LocalExecutionState,
  LocalProject,
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  DesktopWorkRequestServiceError,
  createDesktopWorkRequestService,
  type DesktopWorkRequestServiceStore,
} from './work-request-service'
import type {
  DesktopWorkRequestMaterializationInput,
  DesktopWorkRequestMaterializationResult,
} from './work-request-materializer'

const pairing: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'user-1',
  role: 'member',
  authAccountId: 'auth-account-1',
  projectMemberships: [
    { projectId: 'team-project-1', userId: 'user-1', role: 'member' },
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
}

const localProject = {
  id: 'local-project-1',
  name: 'DevFlow',
  path: '/work/devflow',
  packageManager: 'pnpm' as const,
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies LocalProject

const workRequest = {
  id: 'work-request-1',
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  title: 'Implement inbox',
  request: 'Materialize this request locally.',
  version: 1,
  status: 'open',
  createdByUserId: 'user-1',
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies WorkRequest

const run = { id: 'run-work-request-1' } as WorkflowRun
const state = { runs: [run] } as LocalExecutionState
const materializedWorkRequest: WorkRequest = {
  ...workRequest,
  status: 'materialized',
  version: 3,
  claim: {
    runId: run.id,
    claimedAt: '2026-08-01T00:01:00.000Z',
    materializedAt: '2026-08-01T00:02:00.000Z',
  },
  updatedAt: '2026-08-01T00:02:00.000Z',
}

function createHarness(options: {
  bundle?: { credential: DesktopPairingCredential; encryptedToken: string } | null
  projects?: LocalProject[]
  decryptToken?: (encryptedToken: string) => string
  hangList?: boolean
  requestTimeoutMs?: number
} = {}) {
  const getDesktopPairingCredentialBundle = vi.fn(async () =>
    options.bundle === undefined
      ? { credential: structuredClone(pairing), encryptedToken: 'encrypted-token' }
      : options.bundle,
  )
  const listProjects = vi.fn(async () => options.projects ?? [localProject])
  const loadState = vi.fn(async () => state)
  const store = {
    getDesktopPairingCredentialBundle,
    listProjects,
    loadState,
  } as unknown as DesktopWorkRequestServiceStore
  let activeSignal: AbortSignal | undefined
  const listWorkRequests = vi.fn(async () => {
    if (!options.hangList) {
      return [workRequest]
    }
    return new Promise<WorkRequest[]>((_, reject) => {
      activeSignal?.addEventListener(
        'abort',
        () => reject(new Error('aborted request with secret transport detail')),
        { once: true },
      )
    })
  })
  const client = {
    listWorkRequests,
    claimWorkRequest: vi.fn(),
    materializeWorkRequest: vi.fn(),
  }
  const materialize = vi.fn<
    (
      input: DesktopWorkRequestMaterializationInput,
    ) => Promise<DesktopWorkRequestMaterializationResult>
  >(async () => ({
    workRequest: materializedWorkRequest,
    run,
    localWorkflow: 'created',
    claimReplayed: false,
    materializeReplayed: false,
  }))
  const createClient = vi.fn(
    (input: { authToken: string; signal?: AbortSignal }) => {
      activeSignal = input.signal
      return client
    },
  )
  const createMaterializer = vi.fn(() => ({ materialize }))
  const decryptToken = vi.fn(options.decryptToken ?? (() => 'bearer-token'))
  const service = createDesktopWorkRequestService({
    getStore: async () => store,
    decryptToken,
    createClient,
    createMaterializer,
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
  })

  return {
    service,
    store,
    client,
    materialize,
    createClient,
    createMaterializer,
    decryptToken,
    getDesktopPairingCredentialBundle,
    listProjects,
    loadState,
    listWorkRequests,
  }
}

describe('Desktop Work Request service', () => {
  it('lists only the Team Project frozen into the selected local-project pairing', async () => {
    const harness = createHarness()

    await expect(
      harness.service.list({ localProjectId: 'local-project-1' }),
    ).resolves.toEqual([workRequest])

    expect(harness.getDesktopPairingCredentialBundle).toHaveBeenCalledTimes(1)
    expect(harness.listProjects).toHaveBeenCalledTimes(1)
    expect(harness.decryptToken).toHaveBeenCalledWith('encrypted-token')
    expect(harness.createClient).toHaveBeenCalledWith({
      authToken: 'bearer-token',
      signal: expect.any(AbortSignal),
    })
    expect(harness.listWorkRequests).toHaveBeenCalledWith(
      'team-project-1',
      pairing,
    )
  })

  it('aborts a hanging remote list at the bounded deadline and returns a safe error', async () => {
    const harness = createHarness({ hangList: true, requestTimeoutMs: 5 })

    const outcome = await Promise.race([
      harness.service
        .list({ localProjectId: 'local-project-1' })
        .catch((error: unknown) => error),
      new Promise((resolve) =>
        setTimeout(() => resolve(new Error('request did not abort')), 50),
      ),
    ])

    expect(outcome).toMatchObject({
      name: 'DesktopWorkRequestServiceError',
      code: 'remote_unavailable',
    })
    const clientOptions = harness.createClient.mock.calls[0]?.[0]
    expect(clientOptions?.signal).toBeInstanceOf(AbortSignal)
    expect(clientOptions?.signal?.aborted).toBe(true)
    expect(String(outcome)).not.toMatch(/secret|transport detail/i)
  })

  it('materializes through a client and pairing captured from one credential read', async () => {
    const harness = createHarness()
    const input = {
      localProjectId: 'local-project-1',
      workRequestId: 'work-request-1',
      expectedVersion: 1,
    }

    await expect(harness.service.materialize(input)).resolves.toEqual({
      workRequest: materializedWorkRequest,
      run,
      state,
    })

    expect(harness.getDesktopPairingCredentialBundle).toHaveBeenCalledTimes(1)
    expect(harness.createMaterializer).toHaveBeenCalledWith({
      pairing,
      client: harness.client,
      store: harness.store,
    })
    expect(harness.materialize).toHaveBeenCalledWith(input)
    expect(harness.loadState).toHaveBeenCalledTimes(1)
  })

  it('returns the latest Run from the same local state snapshot sent to the renderer', async () => {
    const harness = createHarness()
    const latestRun = {
      ...run,
      version: 4,
      currentNodeId: 'node-current-after-concurrent-mutation',
    } as WorkflowRun
    const latestState = { ...state, runs: [latestRun] }
    harness.loadState.mockResolvedValueOnce(latestState)

    await expect(
      harness.service.materialize({
        localProjectId: 'local-project-1',
        workRequestId: 'work-request-1',
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      run: latestRun,
      state: latestState,
    })
  })

  it('coalesces rapid duplicate materializations into one local and remote operation', async () => {
    const harness = createHarness()
    let resolveMaterialization!: (
      value: DesktopWorkRequestMaterializationResult,
    ) => void
    harness.materialize.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMaterialization = resolve
      }),
    )
    const input = {
      localProjectId: 'local-project-1',
      workRequestId: 'work-request-1',
      expectedVersion: 1,
    }

    const first = harness.service.materialize(input)
    const second = harness.service.materialize({ ...input })
    expect(first).toBe(second)
    await vi.waitFor(() => {
      expect(harness.getDesktopPairingCredentialBundle).toHaveBeenCalledTimes(1)
      expect(harness.materialize).toHaveBeenCalledTimes(1)
    })

    resolveMaterialization({
      workRequest: materializedWorkRequest,
      run,
      localWorkflow: 'created',
      claimReplayed: false,
      materializeReplayed: false,
    })
    await expect(first).resolves.toMatchObject({ run, state })
    expect(harness.loadState).toHaveBeenCalledTimes(1)
  })

  it('fails before decryption, network, or local writes when pairing is absent', async () => {
    const harness = createHarness({ bundle: null })

    await expect(
      harness.service.materialize({
        localProjectId: 'local-project-1',
        workRequestId: 'work-request-1',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      name: 'DesktopWorkRequestServiceError',
      code: 'pairing_required',
    })
    expect(harness.decryptToken).not.toHaveBeenCalled()
    expect(harness.createClient).not.toHaveBeenCalled()
    expect(harness.materialize).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'pairing belongs to another local project',
      bundle: {
        credential: { ...pairing, localProjectId: 'local-project-other' },
        encryptedToken: 'encrypted-token',
      },
      projects: [localProject],
      code: 'pairing_scope_mismatch',
    },
    {
      name: 'local project does not exist',
      bundle: { credential: pairing, encryptedToken: 'encrypted-token' },
      projects: [],
      code: 'local_project_not_found',
    },
  ])('fails closed when $name', async ({ bundle, projects, code }) => {
    const harness = createHarness({ bundle, projects })

    await expect(
      harness.service.list({ localProjectId: 'local-project-1' }),
    ).rejects.toMatchObject({
      name: 'DesktopWorkRequestServiceError',
      code,
    })
    expect(harness.decryptToken).not.toHaveBeenCalled()
    expect(harness.createClient).not.toHaveBeenCalled()
  })

  it('never forwards a credential decryption failure or secret value to the renderer boundary', async () => {
    const harness = createHarness({
      decryptToken: () => {
        throw new Error('failed to decrypt super-secret-token')
      },
    })

    const error = await harness.service
      .list({ localProjectId: 'local-project-1' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(DesktopWorkRequestServiceError)
    expect(error).toMatchObject({ code: 'credential_unavailable' })
    expect(String(error)).not.toMatch(/super-secret|encrypted-token/i)
    expect(harness.createClient).not.toHaveBeenCalled()
  })
})
