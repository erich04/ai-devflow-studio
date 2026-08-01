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
  retryRemoteSyncOperation: (input: { operationId: string }) => Promise<unknown>
  loadRepositoryKnowledge: (input: { projectId: string }) => Promise<unknown>
  refreshRepositoryKnowledge: (input: { projectId: string }) => Promise<unknown>
  onLocalStateUpdated: (listener: (state: unknown) => void) => () => void
}

const exposedApi = electron.exposeInMainWorld.mock.calls[0]?.[1] as ExposedDesktopApi

describe('Electron preload remote sync operator surface', () => {
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
})
