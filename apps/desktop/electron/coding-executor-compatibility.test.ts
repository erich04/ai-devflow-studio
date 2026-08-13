import { describe, expect, it, vi } from 'vitest'
import type { CodingAgentRun, CodingPermissionRequest } from '@ai-devflow/shared'
import type { CodingEngineAdapter } from './coding-engine.js'
import { createCodingExecutorCompatibilityAdapter } from './coding-executor.js'

describe('Coding Executor compatibility adapter', () => {
  it('publishes an OpenCode descriptor and maps the observable start boundary to a permission wait', async () => {
    const codingRun = { id: 'coding-run-1' } as CodingAgentRun
    const permissionRequest = {
      id: 'permission-1',
      permission: 'edit',
      risk: 'warn',
      requestedAt: '2026-08-12T23:00:01.000Z',
      expiresAt: '2026-08-12T23:01:01.000Z',
    } as CodingPermissionRequest
    const engine: CodingEngineAdapter = {
      engine: 'opencode-http',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      ensure: vi.fn(async () => ({
        projectId: 'local-project-1',
        engine: 'opencode-http' as const,
        status: 'ready' as const,
      })),
      start: vi.fn(async () => ({ codingRun, events: [], permissionRequest })),
      approvePermission: vi.fn(async () => {
        throw new Error('not used')
      }),
      cancel: vi.fn(async () => undefined),
    }
    const executor = createCodingExecutorCompatibilityAdapter(engine)
    const runtimeContext = { id: 'coding-run-1' } as never
    const request = {
      requestedAt: '2026-08-12T23:00:00.000Z',
      id: 'coding-executor-request-1',
      scope: { managedWorkspaceId: 'managed-workspace-1' },
    } as never

    expect(executor.descriptor).toMatchObject({
      stateVersion: 1,
      id: 'coding-executor-opencode-http',
      version: 1,
      kind: 'opencode',
      availability: { status: 'available', reasonCode: null },
    })
    await expect(executor.start({ request, runtimeContext })).resolves.toMatchObject({
      kind: 'waiting_permission',
      codingRun,
      events: [],
      permissionRequest,
      turn: {
        requestId: 'coding-executor-request-1',
        status: 'waiting_permission',
        permissionRequest: {
          id: 'permission-1',
          capability: 'workspace_edit',
        },
      },
    })
    expect(engine.start).toHaveBeenCalledWith(runtimeContext)
    expect(request).not.toHaveProperty('worktreePath')
  })

  it('maps observable OpenCode continuations and completion without inventing private events', async () => {
    const codingRun = {
      id: 'coding-run-2',
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      requestedBy: 'user-1',
      managedWorkspaceId: 'workspace-1',
      userInstruction: 'Continue.',
      prompt: 'Safe prompt digest input.',
      startedAt: '2026-08-12T23:02:00.000Z',
    } as CodingAgentRun
    const nextPermissionRequest = {
      id: 'permission-2',
      permission: 'bash',
      risk: 'warn',
      requestedAt: '2026-08-12T23:02:01.000Z',
      expiresAt: '2026-08-12T23:03:01.000Z',
    } as CodingPermissionRequest
    const diff = { id: 'coding-diff-2' }
    const approvePermission = vi
      .fn()
      .mockResolvedValueOnce({ codingRun, events: [], permissionRequest: nextPermissionRequest })
      .mockResolvedValueOnce({ codingRun, events: [], diff })
    const engine: CodingEngineAdapter = {
      engine: 'opencode-http',
      providerId: 'openai',
      ensure: vi.fn(async () => ({
        projectId: 'local-project-1',
        engine: 'opencode-http' as const,
        status: 'ready' as const,
      })),
      start: vi.fn(async () => {
        throw new Error('not used')
      }),
      approvePermission,
      cancel: vi.fn(async () => undefined),
    }
    const executor = createCodingExecutorCompatibilityAdapter(engine)

    await expect(executor.continuePermission({
      requestId: 'coding-run-2',
      previousCheckpointVersion: 0,
      previousSequence: 0,
      settledPermissionRequestIds: [],
      runtimeContext: {} as never,
    })).resolves.toMatchObject({
      kind: 'waiting_permission',
      codingRun,
      events: [],
      permissionRequest: nextPermissionRequest,
      turn: {
        requestId: 'coding-run-2',
        permissionRequest: { id: 'permission-2', capability: 'approved_command' },
      },
    })
    await expect(executor.continuePermission({
      requestId: 'coding-run-2',
      previousCheckpointVersion: 1,
      previousSequence: 2,
      settledPermissionRequestIds: ['permission-2'],
      runtimeContext: {} as never,
    })).resolves.toEqual({
      kind: 'engine_completed',
      codingRun,
      events: [],
      diff,
    })
    expect(approvePermission).toHaveBeenCalledTimes(2)
  })
})
