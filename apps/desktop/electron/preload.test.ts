import { describe, expect, it, vi } from 'vitest'
import { ipcChannels } from './ipc-contract'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}))

await import('./preload')

type ExposedDesktopApi = {
  prepareGitHubDelivery: (input: { runId: string; nodeId: string }) => Promise<unknown>
  reviseGitHubDelivery: (input: {
    intentId: string
    expectedUpdatedAt: string
  }) => Promise<unknown>
  retryGitHubDelivery: (input: {
    intentId: string
    expectedUpdatedAt: string
  }) => Promise<unknown>
  resumeGitHubDelivery: (input: {
    intentId: string
    expectedUpdatedAt: string
  }) => Promise<unknown>
  stopGitHubDelivery: (input: {
    intentId: string
    expectedUpdatedAt: string
  }) => Promise<unknown>
  retryRemoteSyncOperation: (input: { operationId: string }) => Promise<unknown>
  loadRepositoryKnowledge: (input: { projectId: string }) => Promise<unknown>
  refreshRepositoryKnowledge: (input: { projectId: string }) => Promise<unknown>
  listWorkRequests: (input: { localProjectId: string }) => Promise<unknown>
  materializeWorkRequest: (input: {
    localProjectId: string
    workRequestId: string
    expectedVersion: number
  }) => Promise<unknown>
  onLocalStateUpdated: (listener: (state: unknown) => void) => () => void
}

const exposedApi = electron.exposeInMainWorld.mock.calls[0]?.[1] as ExposedDesktopApi

describe('Electron preload remote sync operator surface', () => {
  it('forwards only Run and PR node identifiers for GitHub Delivery preparation', async () => {
    const result = { status: 'prepared', intent: { id: 'intent-1' } }
    const input = { runId: 'run-1', nodeId: 'run-1-pr' }
    electron.invoke.mockResolvedValueOnce(result)

    await expect(exposedApi.prepareGitHubDelivery(input)).resolves.toBe(result)
    expect(electron.invoke).toHaveBeenCalledWith(
      ipcChannels.prepareGitHubDelivery,
      input,
    )
    expect(Object.keys(input).sort()).toEqual(['nodeId', 'runId'])
  })

  it('forwards only the exact Intent version for an explicit GitHub Delivery resume', async () => {
    const result = {
      intentId: 'github-delivery-intent-1',
      remoteRequestId: 'github-delivery-request-1',
      disposition: 'advanced',
      outcomeCode: null,
    }
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }
    electron.invoke.mockResolvedValueOnce(result)

    await expect(exposedApi.resumeGitHubDelivery(input)).resolves.toBe(result)
    expect(electron.invoke).toHaveBeenCalledWith(
      ipcChannels.resumeGitHubDelivery,
      input,
    )
    expect(Object.keys(input).sort()).toEqual(['expectedUpdatedAt', 'intentId'])
    expect(JSON.stringify(input)).not.toMatch(/token|path|error|repository/i)
  })

  it.each([
    ['revision', 'reviseGitHubDelivery', ipcChannels.reviseGitHubDelivery],
    ['retry', 'retryGitHubDelivery', ipcChannels.retryGitHubDelivery],
  ] as const)('forwards only the exact Intent CAS for GitHub Delivery %s', async (
    _label,
    method,
    channel,
  ) => {
    const result = { status: 'prepared', intent: { id: 'intent-new' } }
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }
    electron.invoke.mockResolvedValueOnce(result)
    await expect(exposedApi[method](input)).resolves.toBe(result)
    expect(electron.invoke).toHaveBeenCalledWith(channel, input)
    expect(Object.keys(input).sort()).toEqual(['expectedUpdatedAt', 'intentId'])
  })

  it('forwards only the exact Intent CAS for an explicit GitHub Delivery Stop', async () => {
    const result = {
      intentId: 'github-delivery-intent-1',
      disposition: 'stopped',
      outcomeCode: 'operation_cancelled',
    }
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }
    electron.invoke.mockResolvedValueOnce(result)

    await expect(exposedApi.stopGitHubDelivery(input)).resolves.toBe(result)
    expect(electron.invoke).toHaveBeenCalledWith(
      ipcChannels.stopGitHubDelivery,
      input,
    )
    expect(Object.keys(input).sort()).toEqual(['expectedUpdatedAt', 'intentId'])
    expect(JSON.stringify(input)).not.toMatch(/token|path|error|repository/i)
  })

  it('forwards identifier-only retry commands without exposing enqueue or upload methods', async () => {
    const state = { remoteSyncOperations: [] }
    electron.invoke.mockResolvedValueOnce(state)

    await expect(
      exposedApi.retryRemoteSyncOperation({ operationId: 'operation-1' }),
    ).resolves.toBe(state)
    expect(electron.invoke).toHaveBeenCalledWith(ipcChannels.retryRemoteSyncOperation, {
      operationId: 'operation-1',
    })
    expect(
      Object.keys(exposedApi).filter((method) => /enqueue|upload/i.test(method)),
    ).toEqual([])
  })

  it('subscribes to local state updates and removes the exact wrapped listener', () => {
    const listener = vi.fn()
    const unsubscribe = exposedApi.onLocalStateUpdated(listener)
    const registration = electron.on.mock.calls.find(
      ([channel]) => channel === ipcChannels.localStateUpdated,
    )
    const wrappedListener = registration?.[1] as (
      event: unknown,
      payload: unknown,
    ) => void
    const state = { remoteSyncOperations: [{ id: 'operation-1' }] }

    wrappedListener({}, state)

    expect(listener).toHaveBeenCalledWith(state)
    unsubscribe()
    expect(electron.removeListener).toHaveBeenCalledWith(
      ipcChannels.localStateUpdated,
      wrappedListener,
    )
  })

  it('loads repository knowledge by project identifier without exposing raw repository writers', async () => {
    const snapshot = { projectId: 'project-1', documents: [] }
    electron.invoke.mockResolvedValueOnce(snapshot)

    await expect(
      exposedApi.loadRepositoryKnowledge({ projectId: 'project-1' }),
    ).resolves.toBe(snapshot)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipcChannels.loadRepositoryKnowledge, {
      projectId: 'project-1',
    })
    expect(
      Object.keys(exposedApi).filter((method) =>
        /index.*path|upload.*knowledge|write.*knowledge/i.test(method),
      ),
    ).toEqual([])
  })

  it('refreshes repository knowledge with only the project identifier', async () => {
    const snapshot = { projectId: 'project-1', documents: [] }
    electron.invoke.mockResolvedValueOnce(snapshot)

    await expect(
      exposedApi.refreshRepositoryKnowledge({ projectId: 'project-1' }),
    ).resolves.toBe(snapshot)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipcChannels.refreshRepositoryKnowledge, {
      projectId: 'project-1',
    })
  })

  it('forwards only the narrow Work Request list command', async () => {
    const workRequests = [{ id: 'work-request-1', status: 'open' }]
    electron.invoke.mockResolvedValueOnce(workRequests)

    await expect(
      exposedApi.listWorkRequests({ localProjectId: 'local-project-1' }),
    ).resolves.toBe(workRequests)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipcChannels.listWorkRequests, {
      localProjectId: 'local-project-1',
    })
  })

  it('forwards only local project, Work Request, and version for materialization', async () => {
    const result = { workRequest: {}, run: {}, state: {} }
    const input = {
      localProjectId: 'local-project-1',
      workRequestId: 'work-request-1',
      expectedVersion: 2,
    }
    electron.invoke.mockResolvedValueOnce(result)

    await expect(exposedApi.materializeWorkRequest(input)).resolves.toBe(result)
    expect(electron.invoke).toHaveBeenLastCalledWith(
      ipcChannels.materializeWorkRequest,
      input,
    )
    expect(exposedApi).not.toHaveProperty('claimWorkRequest')
    expect(exposedApi).not.toHaveProperty('createWorkRequest')
    expect(Object.keys(input).sort()).toEqual([
      'expectedVersion',
      'localProjectId',
      'workRequestId',
    ])
    expect(JSON.stringify(input)).not.toMatch(
      /runId|teamProjectId|organizationId|title|creatorId|branchName|idempotency|pairing|token/i,
    )
  })
})
