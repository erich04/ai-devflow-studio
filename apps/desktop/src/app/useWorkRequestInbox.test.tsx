import { act, renderHook, waitFor } from '@testing-library/react'
import type { WorkRequest } from '@ai-devflow/shared'
import { describe, expect, it, vi } from 'vitest'
import type { DevFlowDesktopApi } from '../desktop-api'
import { useWorkRequestInbox } from './useWorkRequestInbox'

type MaterializeResult = Awaited<
  ReturnType<DevFlowDesktopApi['materializeWorkRequest']>
>

const workRequest: WorkRequest = {
  id: 'work-request-1',
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  title: 'Implement Work Request inbox',
  request: 'Load and materialize assigned work safely.',
  version: 2,
  status: 'open',
  createdByUserId: 'user-1',
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function createDesktopApi() {
  return {
    listWorkRequests: vi.fn<DevFlowDesktopApi['listWorkRequests']>(),
    materializeWorkRequest: vi.fn<DevFlowDesktopApi['materializeWorkRequest']>(),
  } satisfies Pick<
    DevFlowDesktopApi,
    'listWorkRequests' | 'materializeWorkRequest'
  >
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('useWorkRequestInbox', () => {
  it('does not call IPC without pairing and an exact local project, and clears on unpair', async () => {
    const desktopApi = createDesktopApi()
    desktopApi.listWorkRequests.mockResolvedValue([workRequest])
    const onMaterialized = vi.fn()

    const { result, rerender } = renderHook(
      ({ isPaired, localProjectId }) =>
        useWorkRequestInbox({
          desktopApi,
          localProjectId,
          isPaired,
          onMaterialized,
        }),
      {
        initialProps: {
          isPaired: false,
          localProjectId: 'local-project-1',
        },
      },
    )

    expect(desktopApi.listWorkRequests).not.toHaveBeenCalled()
    expect(result.current.workRequests).toEqual([])

    rerender({ isPaired: true, localProjectId: '   ' })
    expect(desktopApi.listWorkRequests).not.toHaveBeenCalled()

    rerender({ isPaired: true, localProjectId: 'local-project-1' })
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(1)

    rerender({ isPaired: false, localProjectId: 'local-project-1' })
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([])
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.materializingId).toBeNull()
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(1)
  })

  it('loads the paired local project with an exact identifier-only command', async () => {
    const desktopApi = createDesktopApi()
    desktopApi.listWorkRequests.mockResolvedValueOnce([workRequest])

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(1)
    expect(desktopApi.listWorkRequests).toHaveBeenCalledWith({
      localProjectId: 'local-project-1',
    })
  })

  it('reports loading only while the Work Request list is pending', async () => {
    const desktopApi = createDesktopApi()
    const pendingList = deferred<WorkRequest[]>()
    desktopApi.listWorkRequests.mockReturnValueOnce(pendingList.promise)

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized: vi.fn(),
      }),
    )

    expect(result.current.isLoading).toBe(true)
    pendingList.resolve([workRequest])
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('replaces list failures with a fixed safe message', async () => {
    const desktopApi = createDesktopApi()
    desktopApi.listWorkRequests.mockRejectedValueOnce(
      new Error('Authorization failed for token super-secret-value'),
    )

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current.error).toBe(
        'Work Requests 暂时不可用，请稍后重试。',
      )
    })
    expect(result.current.error).not.toMatch(/token|secret|authorization/i)
    expect(result.current.isLoading).toBe(false)
  })

  it('refreshes the current project through the same narrow list command', async () => {
    const desktopApi = createDesktopApi()
    const refreshedWorkRequest = {
      ...workRequest,
      id: 'work-request-2',
      version: 3,
    }
    desktopApi.listWorkRequests
      .mockResolvedValueOnce([workRequest])
      .mockResolvedValueOnce([refreshedWorkRequest])

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized: vi.fn(),
      }),
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.workRequests).toEqual([refreshedWorkRequest])
    expect(desktopApi.listWorkRequests).toHaveBeenNthCalledWith(2, {
      localProjectId: 'local-project-1',
    })
  })

  it('ignores a stale per-project refresh after switching away and back', async () => {
    const desktopApi = createDesktopApi()
    const staleRefresh = deferred<WorkRequest[]>()
    const projectAInitial = { ...workRequest, id: 'project-a-initial' }
    const projectANew = { ...workRequest, id: 'project-a-new', version: 3 }
    const projectB = {
      ...workRequest,
      id: 'project-b-request',
      projectId: 'team-project-2',
    }
    desktopApi.listWorkRequests
      .mockResolvedValueOnce([projectAInitial])
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce([projectB])
      .mockResolvedValueOnce([projectANew])
    const onMaterialized = vi.fn()

    const { result, rerender } = renderHook(
      ({ localProjectId }) =>
        useWorkRequestInbox({
          desktopApi,
          localProjectId,
          isPaired: true,
          onMaterialized,
        }),
      { initialProps: { localProjectId: 'local-project-a' } },
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([projectAInitial])
    })

    let staleRefreshPromise!: Promise<void>
    act(() => {
      staleRefreshPromise = result.current.refresh()
    })
    rerender({ localProjectId: 'local-project-b' })
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([projectB])
    })
    rerender({ localProjectId: 'local-project-a' })
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([projectANew])
    })

    await act(async () => {
      staleRefresh.resolve([{ ...workRequest, id: 'stale-project-a' }])
      await staleRefreshPromise
    })

    expect(result.current.workRequests).toEqual([projectANew])
  })

  it('materializes with identifiers and version, applies the result, then refreshes', async () => {
    const desktopApi = createDesktopApi()
    const materializedWorkRequest: WorkRequest = {
      ...workRequest,
      status: 'materialized',
      version: 3,
      claim: {
        runId: 'run-1',
        claimedAt: '2026-08-01T00:01:00.000Z',
        materializedAt: '2026-08-01T00:02:00.000Z',
      },
    }
    const materializeResult = {
      workRequest: materializedWorkRequest,
      run: { id: 'run-1' },
      state: { runs: [{ id: 'run-1' }] },
    } as MaterializeResult
    desktopApi.listWorkRequests
      .mockResolvedValueOnce([workRequest])
      .mockResolvedValueOnce([materializedWorkRequest])
    desktopApi.materializeWorkRequest.mockResolvedValueOnce(materializeResult)
    const onMaterialized = vi.fn()

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized,
      }),
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })

    await act(async () => {
      await result.current.materialize(workRequest)
    })

    expect(desktopApi.materializeWorkRequest).toHaveBeenCalledWith({
      localProjectId: 'local-project-1',
      workRequestId: 'work-request-1',
      expectedVersion: 2,
    })
    expect(desktopApi.materializeWorkRequest).toHaveBeenCalledTimes(1)
    expect(onMaterialized).toHaveBeenCalledWith(materializeResult)
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(2)
    expect(result.current.workRequests).toEqual([materializedWorkRequest])
  })

  it('keeps materialization single-flight across rapid repeated actions', async () => {
    const desktopApi = createDesktopApi()
    const pendingMaterialization = deferred<MaterializeResult>()
    const materializeResult = {
      workRequest: { ...workRequest, status: 'materialized', version: 3 },
      run: { id: 'run-1' },
      state: { runs: [{ id: 'run-1' }] },
    } as MaterializeResult
    desktopApi.listWorkRequests.mockResolvedValue([workRequest])
    desktopApi.materializeWorkRequest.mockReturnValue(
      pendingMaterialization.promise,
    )
    const onMaterialized = vi.fn()

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized,
      }),
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.materialize(workRequest)
      second = result.current.materialize(workRequest)
    })

    expect(desktopApi.materializeWorkRequest).toHaveBeenCalledTimes(1)
    expect(result.current.materializingId).toBe('work-request-1')

    await act(async () => {
      pendingMaterialization.resolve(materializeResult)
      await Promise.all([first, second])
    })

    expect(onMaterialized).toHaveBeenCalledTimes(1)
    expect(result.current.materializingId).toBeNull()
  })

  it('replaces materialization failures with a fixed safe message', async () => {
    const desktopApi = createDesktopApi()
    desktopApi.listWorkRequests.mockResolvedValueOnce([workRequest])
    desktopApi.materializeWorkRequest.mockRejectedValueOnce(
      new Error('Bearer token super-secret-materialization-key was rejected'),
    )
    const onMaterialized = vi.fn()

    const { result } = renderHook(() =>
      useWorkRequestInbox({
        desktopApi,
        localProjectId: 'local-project-1',
        isPaired: true,
        onMaterialized,
      }),
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([workRequest])
    })

    await act(async () => {
      await result.current.materialize(workRequest)
    })

    expect(result.current.error).toBe('无法创建本地 Run，请稍后重试。')
    expect(result.current.error).not.toMatch(/token|secret|bearer/i)
    expect(result.current.materializingId).toBeNull()
    expect(onMaterialized).not.toHaveBeenCalled()
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(1)
  })

  it('isolates an in-flight materialization from a project switch', async () => {
    const desktopApi = createDesktopApi()
    const pendingMaterialization = deferred<MaterializeResult>()
    const projectARequest = { ...workRequest, id: 'project-a-request' }
    const projectBRequest = {
      ...workRequest,
      id: 'project-b-request',
      projectId: 'team-project-2',
    }
    const materializeResult = {
      workRequest: { ...projectARequest, status: 'materialized', version: 3 },
      run: { id: 'run-project-a' },
      state: { runs: [{ id: 'run-project-a' }] },
    } as MaterializeResult
    desktopApi.listWorkRequests
      .mockResolvedValue([])
      .mockResolvedValueOnce([projectARequest])
      .mockResolvedValueOnce([projectBRequest])
    desktopApi.materializeWorkRequest.mockReturnValueOnce(
      pendingMaterialization.promise,
    )
    const onMaterialized = vi.fn()

    const { result, rerender } = renderHook(
      ({ localProjectId }) =>
        useWorkRequestInbox({
          desktopApi,
          localProjectId,
          isPaired: true,
          onMaterialized,
        }),
      { initialProps: { localProjectId: 'local-project-a' } },
    )
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([projectARequest])
    })

    let materializePromise!: Promise<void>
    act(() => {
      materializePromise = result.current.materialize(projectARequest)
    })
    expect(result.current.materializingId).toBe('project-a-request')

    rerender({ localProjectId: 'local-project-b' })
    await waitFor(() => {
      expect(result.current.workRequests).toEqual([projectBRequest])
    })
    expect(result.current.materializingId).toBeNull()

    await act(async () => {
      pendingMaterialization.resolve(materializeResult)
      await materializePromise
    })

    expect(onMaterialized).not.toHaveBeenCalled()
    expect(desktopApi.listWorkRequests).toHaveBeenCalledTimes(2)
    expect(result.current.workRequests).toEqual([projectBRequest])
    expect(result.current.error).toBeNull()
  })
})
