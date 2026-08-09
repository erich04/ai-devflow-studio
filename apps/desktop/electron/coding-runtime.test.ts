import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  Artifact,
  BudgetGuardDecision,
  CodingBrief,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  KnowledgeChunk,
  KnowledgeDocument,
  LocalProject,
  ManagedCodingWorkspace,
  RemediationPlan,
  RetryAttempt,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { estimateCodingRuntimeCost } from '@ai-devflow/shared'
import { createFakeCodingEngineAdapter, type CodingEngineAdapter } from './coding-engine'
import {
  CodingEngineContinuationCleanupError,
  CodingEngineStartupCleanupError,
} from './coding-engine-lifecycle'
import { createCodingRuntime } from './coding-runtime'
import type {
  CodingAgentMutation,
  CodingAgentMutationResult,
  ReserveCodingAgentRunResult,
} from './local-store'
import { createOpencodeHttpCodingEngineAdapter } from './opencode-http-engine'
import {
  createDefaultOpencodePermissionRules,
  OpencodeMessageResponseError,
  type Fetcher,
} from './opencode-http-adapter'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('CodingRuntime', () => {
  it('continues one opencode session across separate request-scoped runtimes', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fetcher = opencodeSequenceFetcher([
      {
        id: 'ses-cross-runtime',
        directory: '/tmp/worktree',
        permission: createDefaultOpencodePermissionRules(),
      },
      deferredOpencodeMessage({ info: {}, parts: [] }),
      [{
        id: 'permission-cross-runtime',
        sessionID: 'ses-cross-runtime',
        permission: 'edit',
        metadata: { filepath: 'devflow-opencode-smoke.txt' },
      }],
      true,
      [],
      [{
        file: 'devflow-opencode-smoke.txt',
        patch: 'diff --git a/devflow-opencode-smoke.txt b/devflow-opencode-smoke.txt\n+ok\n',
      }],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: {
        ensure: vi.fn(async ({ projectId }) => ({
          baseUrl: 'http://127.0.0.1:4097',
          child: {} as never,
          projectId,
        })),
      },
      resolveManagedDirectory: (directory) => directory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    let idSequence = 0
    const runtimeDependencies = {
      store,
      engine,
      budgetGuard: createAllowingBudgetGuard(),
      createWorkspace: async (input: {
        codingRunId: string
        project: LocalProject
      }) => managedWorkspace({
        id: `workspace-${input.codingRunId}`,
        projectId: input.project.id,
        codingRunId: input.codingRunId,
        sourcePath: input.project.path,
        worktreePath: '/tmp/worktree',
      }),
      runTestCommand: async () => ({
        status: 'passed' as const,
        exitCode: 0,
        durationMs: 1,
        stdout: 'passed',
        stderr: '',
        redacted: true,
        summary: 'Coding worktree tests passed.',
      }),
      completeWorkflowBuild: vi.fn(async () => undefined),
      idGenerator: (prefix = 'id') => `${prefix}-cross-runtime-${idSequence += 1}`,
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    }
    const runRequestRuntime = createCodingRuntime(runtimeDependencies)
    const replyRequestRuntime = createCodingRuntime(runtimeDependencies)

    const started = await runRequestRuntime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Add the marker file.',
    })
    await replyRequestRuntime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from a later IPC request.',
    })

    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.diffArtifacts[0]?.changedPaths).toEqual(['devflow-opencode-smoke.txt'])
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/permission/permission-cross-runtime/reply?directory=%2Ftmp%2Fworktree',
    )
  })

  it.each([
    { decision: 'rejected' as const, expectedStatus: 'interrupted' as const },
    { decision: 'expired' as const, expectedStatus: 'timed_out' as const },
  ])('aborts and forgets a shared opencode session when a later request records $decision', async ({
    decision,
    expectedStatus,
  }) => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fetcher = opencodeSequenceFetcher([
      {
        id: 'ses-cross-runtime-rejected',
        directory: '/tmp/worktree',
        permission: createDefaultOpencodePermissionRules(),
      },
      deferredOpencodeMessage({ info: {}, parts: [] }),
      [{
        id: 'permission-cross-runtime-rejected',
        sessionID: 'ses-cross-runtime-rejected',
        permission: 'edit',
        metadata: { filepath: 'devflow-opencode-smoke.txt' },
      }],
      true,
      [{
        id: 'permission-cross-runtime-rejected',
        sessionID: 'ses-cross-runtime-rejected',
        permission: 'edit',
      }],
      true,
      [],
      [],
    ])
    const engine = createOpencodeHttpCodingEngineAdapter({
      binaryPath: 'opencode',
      providerID: 'double',
      modelID: 'ark-code-latest',
      processManager: {
        ensure: vi.fn(async ({ projectId }) => ({
          baseUrl: 'http://127.0.0.1:4097',
          child: {} as never,
          projectId,
        })),
      },
      resolveManagedDirectory: (directory) => directory,
      fetcher,
      permissionPollMs: 1,
      permissionDiscoveryTimeoutMs: 50,
    })
    let idSequence = 0
    const runtimeDependencies = {
      store,
      engine,
      budgetGuard: createAllowingBudgetGuard(),
      createWorkspace: async (input: {
        codingRunId: string
        project: LocalProject
      }) => managedWorkspace({
        id: `workspace-${input.codingRunId}`,
        projectId: input.project.id,
        codingRunId: input.codingRunId,
        sourcePath: input.project.path,
        worktreePath: '/tmp/worktree',
      }),
      deleteWorkspace: async (workspace: ManagedCodingWorkspace) => ({
        ...workspace,
        cleanupStatus: 'deleted' as const,
        deletedAt: '2026-06-17T00:01:00.000Z',
      }),
      idGenerator: (prefix = 'id') => `${prefix}-cross-runtime-rejected-${idSequence += 1}`,
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    }
    const runRequestRuntime = createCodingRuntime(runtimeDependencies)
    const replyRequestRuntime = createCodingRuntime(runtimeDependencies)

    const started = await runRequestRuntime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Add the marker file.',
    })
    await replyRequestRuntime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision,
      comment: `${decision} from a later IPC request.`,
    })

    const abortUrl =
      'http://127.0.0.1:4097/session/ses-cross-runtime-rejected/abort?directory=%2Ftmp%2Fworktree'
    expect(fetcher.urls).toContain(abortUrl)
    expect(fetcher.urls).toContain(
      'http://127.0.0.1:4097/permission/permission-cross-runtime-rejected/reply?directory=%2Ftmp%2Fworktree',
    )
    expect(store.codingRuns.at(-1)?.status).toBe(expectedStatus)
    const requestCountAfterReject = fetcher.urls.length
    await engine.cancel({ codingRun: started.codingRun })
    expect(fetcher.urls).toHaveLength(requestCountAfterReject)
  })

  it('starts a fake coding run by creating a worktree and persisting the run bundle', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    expect(result.codingRun.status).toBe('waiting_permission')
    expect(store.workspaces).toHaveLength(1)
    expect(store.codingRuns).toEqual([result.codingRun])
    expect(store.codingEvents.map((event) => event.kind)).toEqual(['brief', 'permission'])
    expect(store.permissionRequests).toHaveLength(1)
    expect(await readFile(path.join(store.workspaces[0]!.worktreePath, 'package.json'), 'utf8')).toContain('fixture')
  })

  it('atomically reserves one run before concurrent starts can reach the coding engine', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const originalListCodingAgentRuns = store.listCodingAgentRuns.bind(store)
    let initialReads = 0
    let releaseInitialReads: (() => void) | undefined
    const initialReadsReady = new Promise<void>((resolve) => {
      releaseInitialReads = resolve
    })
    vi.spyOn(store, 'listCodingAgentRuns').mockImplementation(async (runId?: string) => {
      if (!runId && initialReads < 2) {
        initialReads += 1
        if (initialReads === 2) {
          releaseInitialReads?.()
        }
        await initialReadsReady
        return []
      }
      return originalListCodingAgentRuns(runId)
    })
    const engine = createFakeCodingEngineAdapter()
    const start = vi.spyOn(engine, 'start')
    let idSequence = 0
    const runtimeDependencies = {
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: (prefix = 'id') => `${prefix}-concurrent-start-${idSequence += 1}`,
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    }
    const runtimeA = createCodingRuntime(runtimeDependencies)
    const runtimeB = createCodingRuntime(runtimeDependencies)
    const request = {
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    }

    const results = await Promise.allSettled([
      runtimeA.runCodingAgent(request),
      runtimeB.runCodingAgent(request),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(start).toHaveBeenCalledOnce()
    expect(store.codingRuns).toHaveLength(1)
    expect(store.workspaces).toHaveLength(1)
    expect(store.permissionRequests).toHaveLength(1)
  })

  it('rolls back the provider session and workspace when the atomic startup bundle cannot persist', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-startup-bundle-failure',
      codingRunId: 'coding-run-startup-bundle-failure',
      sourcePath: repo,
      worktreePath: '/tmp/startup-bundle-failure-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const originalCommitCodingAgentMutation = store.commitCodingAgentMutation.bind(store)
    vi.spyOn(store, 'commitCodingAgentMutation').mockImplementation(async (mutation) => {
      if (mutation.run?.status === 'waiting_permission') {
        throw new Error('startup bundle persistence failed')
      }
      return originalCommitCodingAgentMutation(mutation)
    })
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const deleteWorkspace = vi.fn(async (input: ManagedCodingWorkspace) => ({
      ...input,
      cleanupStatus: 'deleted' as const,
      deletedAt: '2026-06-17T00:00:01.000Z',
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-startup-bundle-failure'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Start atomically.',
    })).rejects.toThrow('startup bundle persistence failed')

    expect(cancel).toHaveBeenCalledOnce()
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.permissionRequests).toHaveLength(0)
    expect(store.codingEvents.some((event) => event.kind === 'brief' || event.kind === 'permission')).toBe(false)
    expect(store.codingRuns).toEqual([
      expect.objectContaining({
        id: 'coding-run-startup-bundle-failure',
        status: 'failed',
        managedWorkspaceId: workspace.id,
      }),
    ])
    expect(store.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, cleanupStatus: 'deleted' }),
    ])
  })

  it('cancels by the reserved run id when an engine returns a malformed startup identity', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-malformed-startup',
      codingRunId: 'coding-run-malformed-startup',
      sourcePath: repo,
      worktreePath: '/tmp/malformed-startup-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const delegate = createFakeCodingEngineAdapter()
    const engine: CodingEngineAdapter = {
      ...delegate,
      async start(input) {
        const bundle = await delegate.start(input)
        return {
          ...bundle,
          codingRun: { ...bundle.codingRun, id: 'unexpected-provider-run-id' },
        }
      },
    }
    const cancel = vi.spyOn(engine, 'cancel')
    const deleteWorkspace = vi.fn(async (input: ManagedCodingWorkspace) => ({
      ...input,
      cleanupStatus: 'deleted' as const,
      deletedAt: '2026-06-17T00:00:01.000Z',
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-malformed-startup', 'malformed-failure-event'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Reject malformed ownership.',
    })).rejects.toThrow('Coding Agent mutation cannot change the run identity')

    expect(cancel).toHaveBeenCalledWith({
      codingRun: expect.objectContaining({ id: 'coding-run-malformed-startup' }),
    })
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.codingRuns).toEqual([
      expect.objectContaining({ id: 'coding-run-malformed-startup', status: 'failed' }),
    ])
  })

  it('links a recoverable workspace when its first registration and physical cleanup both fail', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-registration-cleanup-failure',
      codingRunId: 'coding-run-registration-cleanup-failure',
      sourcePath: repo,
      worktreePath: '/tmp/registration-cleanup-failure-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const saveWorkspace = vi.spyOn(store, 'saveManagedCodingWorkspace')
    saveWorkspace.mockRejectedValueOnce(new Error('workspace registration unavailable'))
    const engine = createFakeCodingEngineAdapter()
    const start = vi.spyOn(engine, 'start')
    const deleteWorkspace = vi.fn(async () => {
      throw new Error('worktree is still busy')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-registration-cleanup-failure', 'cleanup-failure-event'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Register the worktree safely.',
    })).rejects.toThrow('coding workspace registration failed and cleanup did not complete')

    expect(start).not.toHaveBeenCalled()
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(saveWorkspace).toHaveBeenCalledTimes(2)
    expect(store.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        cleanupStatus: 'cleanup_failed',
        cleanupError: 'worktree is still busy',
      }),
    ])
    expect(store.codingRuns).toEqual([
      expect.objectContaining({
        id: 'coding-run-registration-cleanup-failure',
        status: 'preparing',
        managedWorkspaceId: workspace.id,
      }),
    ])
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        metadata: { sessionCleanupStatus: 'cleanup_failed' },
      }),
    ]))
  })

  it('cleans the workspace and terminalizes its reservation when workspace linking throws', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-link-failure',
      codingRunId: 'coding-run-link-failure',
      sourcePath: repo,
      worktreePath: '/tmp/workspace-link-failure-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const originalCommitCodingAgentMutation = store.commitCodingAgentMutation.bind(store)
    vi.spyOn(store, 'commitCodingAgentMutation').mockImplementation(async (mutation) => {
      if (mutation.run?.status === 'preparing' && mutation.run.managedWorkspaceId) {
        throw new Error('workspace link persistence failed')
      }
      return originalCommitCodingAgentMutation(mutation)
    })
    const engine = createFakeCodingEngineAdapter()
    const start = vi.spyOn(engine, 'start')
    const deleteWorkspace = vi.fn(async (input: ManagedCodingWorkspace) => ({
      ...input,
      cleanupStatus: 'deleted' as const,
      deletedAt: '2026-06-17T00:00:01.000Z',
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-link-failure', 'link-failure-event'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Link the worktree safely.',
    })).rejects.toThrow('workspace link persistence failed')

    expect(start).not.toHaveBeenCalled()
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, cleanupStatus: 'deleted' }),
    ])
    expect(store.codingRuns).toEqual([
      expect.objectContaining({ id: 'coding-run-link-failure', status: 'failed' }),
    ])
  })

  it('removes and records a managed worktree when the coding engine fails to start safely', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-start-failure',
      codingRunId: 'coding-run-start-failure',
      sourcePath: repo,
      worktreePath: '/tmp/start-failure-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    vi.spyOn(engine, 'start').mockRejectedValueOnce(new Error('coding engine start failed'))
    const createWorkspace = vi.fn(async () => workspace)
    const deleteWorkspace = vi.fn(async (input: ManagedCodingWorkspace) => ({
      ...input,
      cleanupStatus: 'deleted' as const,
      deletedAt: '2026-06-17T00:00:01.000Z',
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-start-failure'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Start safely.',
    })).rejects.toThrow('coding engine start failed')

    expect(createWorkspace).toHaveBeenCalledOnce()
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        cleanupStatus: 'deleted',
      }),
    ])
    expect(store.codingRuns).toEqual([
      expect.objectContaining({
        id: 'coding-run-start-failure',
        status: 'failed',
        managedWorkspaceId: workspace.id,
        summary: 'Coding engine failed to start.',
      }),
    ])
  })

  it('retains a recoverable workspace when coding engine startup cleanup is incomplete', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({
      id: 'workspace-start-cleanup-failure',
      codingRunId: 'coding-run-start-cleanup-failure',
      sourcePath: repo,
      worktreePath: '/tmp/start-cleanup-failure-worktree',
    })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    vi.spyOn(engine, 'start').mockRejectedValueOnce(new CodingEngineStartupCleanupError([
      new Error('coding engine start failed'),
      new Error('session abort failed'),
    ]))
    const deleteWorkspace = vi.fn(async () => workspace)
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      idGenerator: fixedIds('coding-run-start-cleanup-failure'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Start safely.',
    })).rejects.toThrow('coding engine startup failed and cleanup did not complete')

    expect(deleteWorkspace).not.toHaveBeenCalled()
    expect(store.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        cleanupStatus: 'cleanup_failed',
        cleanupError: 'Coding engine session cleanup did not complete; manual cleanup is required.',
      }),
    ])
    expect(store.codingRuns).toEqual([
      expect.objectContaining({
        id: 'coding-run-start-cleanup-failure',
        status: 'preparing',
        managedWorkspaceId: workspace.id,
      }),
    ])
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        metadata: { sessionCleanupStatus: 'cleanup_failed' },
      }),
    ]))
  })

  it('blocks a paid coding run when no authoritative budget guard is configured', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called before a paid budget decision')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
      idGenerator: fixedIds('coding-run-budget-unavailable'),
      now: fixedNow('2026-07-31T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Use the paid runtime.',
    })

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(result.codingRun).toMatchObject({
      status: 'failed',
      budgetDecision: {
        status: 'unavailable',
        blocksRun: true,
      },
    })
    expect(result.codingRun.summary).toContain('unavailable')
    expect(result.codingRun.summary).not.toContain('lead approval')
    expect(store.codingEvents).toEqual([
      expect.objectContaining({
        kind: 'error',
        redacted: true,
        metadata: expect.objectContaining({ budgetStatus: 'unavailable' }),
      }),
    ])
    expect(store.workspaces).toHaveLength(0)
    expect(result.state.managedCodingWorkspaces).toHaveLength(0)
  })

  it('rejects a second active coding run for the same local project', async () => {
    const repo = await gitRepo()
    const activeRun = codingRun({ projectId: 'project-1', status: 'waiting_permission' })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      codingRuns: [activeRun],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-2'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow(/already active/)
    expect(store.workspaces).toHaveLength(0)
  })

  it('rejects cross-project coding runs before engine, worktree, or persistence side effects', async () => {
    const repo = await gitRepo()
    const otherProject = {
      ...project(repo),
      id: 'project-2',
      name: 'Other fixture',
    }
    const store = new MemoryCodingStore({
      projects: [project(repo), otherProject],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-2',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do not cross the project boundary.',
      }),
    ).rejects.toThrow('Coding workflow project mismatch')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents).toHaveLength(0)
  })

  it('rejects historical build nodes before engine, worktree, or persistence side effects', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          currentNodeId: 'node-build-current',
          nodes: [
            buildNode({ id: 'node-build-history', status: 'success' }),
            buildNode({ id: 'node-build-current', status: 'running' }),
          ],
        }),
      ],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build-history',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do not rerun a historical node.',
      }),
    ).rejects.toThrow('Coding Agent can only run on the current workflow node')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
  })

  it.each([
    {
      label: 'a pending build node',
      run: buildRun({ nodes: [buildNode({ status: 'pending' })] }),
      expectedError: 'Coding Agent build node must be running or failed',
    },
    {
      label: 'a completed workflow run',
      run: buildRun({ status: 'completed' }),
      expectedError: 'Coding Agent cannot run on a terminal workflow run',
    },
    {
      label: 'a cancelled workflow run',
      run: buildRun({ status: 'cancelled' }),
      expectedError: 'Coding Agent cannot run on a terminal workflow run',
    },
    {
      label: 'a run status that disagrees with its running build node',
      run: buildRun({ status: 'testing' }),
      expectedError: 'Coding workflow invariant violation',
    },
    {
      label: 'a run status that disagrees with its failed build node',
      run: buildRun({
        status: 'building',
        nodes: [buildNode({ status: 'failed' })],
      }),
      expectedError: 'Coding workflow invariant violation',
    },
  ])('rejects $label before engine, worktree, or persistence side effects', async ({ run, expectedError }) => {
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [run],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Respect workflow state.',
      }),
    ).rejects.toThrow(expectedError)

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents).toHaveLength(0)
  })

  it('allows a failed current build node to start a controlled coding retry', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          status: 'failed',
          nodes: [buildNode({ status: 'failed' })],
        }),
      ],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-failed-build-retry'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Retry the failed build.',
    })

    expect(result.codingRun).toMatchObject({
      id: 'coding-run-failed-build-retry',
      runId: 'run-1',
      nodeId: 'node-build',
      status: 'waiting_permission',
    })
  })

  it('blocks real provider coding runs before engine start when project budget requires lead approval', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const budgetGuard = vi.fn(async () => ({
      status: 'requires_lead_approval',
      blocksRun: true,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      limitUsd: 1,
      approvalRequiredRole: 'lead',
      reason: 'Project runtime budget would be exceeded.',
    } satisfies BudgetGuardDecision))
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-budget'),
      now: fixedNow('2026-06-20T00:00:00.000Z'),
      budgetGuard,
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'opencode-http',
      userInstruction: 'Use the real runtime.',
    })

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(budgetGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'opencode-http',
        providerId: 'double',
        requestedBy: 'user-1',
        estimatedCost: expect.objectContaining({ costUsd: expect.any(Number), redacted: true }),
      }),
    )
    expect(result.codingRun.status).toBe('failed')
    expect(result.codingRun.providerId).toBe('double')
    expect(result.codingRun.summary).toContain('Runtime budget requires lead approval')
    expect(result.codingRun.summary).toContain('paid provider was not called')
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents.some((event) => event.kind === 'error' && event.message.includes('budget'))).toBe(true)
  })

  it('redacts an unavailable budget reason before persisting or publishing the blocked run', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const publishRunStatus = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine,
      publisher: {
        publishRunStatus,
        publishEvent: vi.fn(),
        publishPermission: vi.fn(),
      },
      createWorkspace: vi.fn(async () => {
        throw new Error('createWorkspace should not be called after a rejecting budget decision')
      }),
      budgetGuard: vi.fn(async () => ({
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.2,
        reason: 'API_KEY=sk-private-value failed at /Users/operator/private/config.json',
      } satisfies BudgetGuardDecision)),
      idGenerator: fixedIds('coding-run-budget-redaction'),
      now: fixedNow('2026-07-31T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Use the paid runtime.',
    })

    const persisted = JSON.stringify({
      run: store.codingRuns[0],
      events: store.codingEvents,
      published: publishRunStatus.mock.calls,
      result: result.codingRun,
    })
    expect(persisted).not.toContain('sk-private-value')
    expect(persisted).not.toContain('/Users/operator/private/config.json')
    expect(persisted).toContain('[REDACTED:')
    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(store.workspaces).toHaveLength(0)
  })

  it('passes runtime budget approval ids to the guard before starting the real engine', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    vi.mocked(engine.start).mockResolvedValueOnce({
      codingRun: codingRun({
        id: 'coding-run-approved-budget',
        projectId: 'project-1',
        providerId: 'double',
        engine: 'opencode-http',
        status: 'waiting_permission',
        budgetDecision: {
          status: 'approved_over_budget',
          blocksRun: false,
          currentSpendUsd: 0.95,
          projectedCostUsd: 0.2,
          limitUsd: 1,
          approvalId: 'runtime-budget-approval-project-1',
          reason: 'Lead approval allows this runtime run to continue beyond the project budget.',
        },
      }),
      events: [],
      permissionRequest: {
        id: 'permission-approved-budget',
        codingRunId: 'coding-run-approved-budget',
        runId: 'run-1',
        nodeId: 'node-build',
        permission: 'bash',
        title: 'opencode requested bash permission',
        command: 'npm test',
        risk: 'warn',
        reasons: ['opencode requested shell access.'],
        status: 'pending',
        requestedAt: '2026-06-21T00:00:00.000Z',
        expiresAt: '2026-06-21T00:01:00.000Z',
      },
    })
    const budgetGuard = vi.fn(async () => ({
      status: 'approved_over_budget',
      blocksRun: false,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      limitUsd: 1,
      approvalId: 'runtime-budget-approval-project-1',
      reason: 'Lead approval allows this runtime run to continue beyond the project budget.',
    } satisfies BudgetGuardDecision))
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-approved-budget'),
      now: fixedNow('2026-06-21T00:00:00.000Z'),
      budgetGuard,
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      runtimeBudgetApprovalId: 'runtime-budget-approval-project-1',
      userInstruction: 'Use the real runtime after lead approval.',
    })

    expect(budgetGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'runtime-budget-approval-project-1',
      }),
    )
    expect(engine.start).toHaveBeenCalledOnce()
    expect(result.codingRun.budgetDecision?.status).toBe('approved_over_budget')
    expect(result.codingRun.budgetDecision?.approvalId).toBe('runtime-budget-approval-project-1')
  })

  it('rejects coding runs from nodes that are not build task nodes', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          id: 'run-gate',
          status: 'paused_at_gate',
          currentNodeId: 'node-build-gate',
          nodes: [buildNode({ id: 'node-build-gate', stage: 'build', kind: 'gate' })],
        }),
        buildRun({
          id: 'run-design',
          status: 'designing',
          currentNodeId: 'node-design-task',
          nodes: [buildNode({ id: 'node-design-task', stage: 'design', kind: 'task' })],
        }),
      ],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-gate',
        nodeId: 'node-build-gate',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow('Coding Agent can only run from a build task node')
    await expect(
      runtime.runCodingAgent({
        runId: 'run-design',
        nodeId: 'node-design-task',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow('Coding Agent can only run from a build task node')
    expect(store.workspaces).toHaveLength(0)
  })

  it('assembles the coding prompt from persisted DevFlow context', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
      events: [approvalEvent()],
      testEvidence: [passingEvidence(repo)],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Use the approved health endpoint design.',
    })

    expect(result.codingRun.prompt).toContain('Health endpoint design')
    expect(result.codingRun.prompt).toContain('No knowledge references are attached.')
    expect(result.codingRun.prompt).not.toContain('knowledge-doc-api-health')
    expect(result.codingRun.prompt).toContain('Gate Decisions')
    expect(result.codingRun.prompt).toContain('approved by devflow: Lead Gate 已通过：方案评审 Gate')
    expect(result.codingRun.prompt).toContain('Existing Test Evidence')
    expect(result.codingRun.prompt).toContain('npm test [passed]: Existing local tests passed.')
  })

  it('carries referenced repository knowledge content and its relative source into the fake coding prompt', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
    })
    const knowledgeDocuments: KnowledgeDocument[] = [{
      id: 'knowledge-doc-api-health',
      title: 'API Health Standard',
      category: 'api_contract',
      sourcePath: 'docs/standards/api-health.md',
      summary: 'Health endpoints expose degraded dependency states.',
      tags: ['api', 'health'],
      updatedAt: '2026-06-17T00:00:00.000Z',
      markdown: '# API Health Standard\n\nUNIQUE_KNOWLEDGE_CONTENT requires contract tests.',
    }]
    const knowledgeChunks: KnowledgeChunk[] = [{
      id: 'knowledge-chunk-api-health',
      documentId: 'knowledge-doc-api-health',
      sourcePath: 'docs/standards/api-health.md',
      headingPath: ['API Health Standard'],
      content: 'UNIQUE_KNOWLEDGE_CONTENT requires contract tests. API_TOKEN=runtime-secret-value',
      contentHash: 'hash-api-health',
      tokenCount: 12,
      tags: ['api', 'health'],
      updatedAt: '2026-06-17T00:00:00.000Z',
    }]
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      knowledgeDocuments,
      knowledgeChunks,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-knowledge'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Use the approved health endpoint design.',
    })

    expect(result.codingRun.prompt).toContain('UNIQUE_KNOWLEDGE_CONTENT requires contract tests.')
    expect(result.codingRun.prompt).toContain('source=docs/standards/api-health.md')
    expect(result.codingRun.prompt).toContain('[REDACTED:env_secret_assignment]')
    expect(result.codingRun.prompt).not.toContain('runtime-secret-value')
  })

  it('uses one canonical coding brief for paid budget preflight and the engine prompt', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
    })
    const fakeDelegate = createFakeCodingEngineAdapter()
    const engine: CodingEngineAdapter = {
      ...fakeDelegate,
      engine: 'opencode-http',
      providerId: 'double',
      modelId: 'ark-code-latest',
      start: vi.fn(async (input) => {
        const bundle = await fakeDelegate.start(input)
        return {
          ...bundle,
          codingRun: {
            ...bundle.codingRun,
            engine: 'opencode-http' as const,
            providerId: 'double',
          },
        }
      }),
    }
    const budgetGuard = createAllowingBudgetGuard()
    const runtime = createCodingRuntime({
      store,
      engine,
      budgetGuard,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-canonical-brief'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Use the approved health endpoint design.',
    })

    const startInput = vi.mocked(engine.start).mock.calls[0]?.[0] as unknown as { brief?: CodingBrief }
    expect(startInput.brief?.prompt).toBe(result.codingRun.prompt)
    expect(startInput).not.toHaveProperty('knowledgeChunks')
    expect(result.codingRun.prompt).toContain('Managed worktree: <managed-worktree-created-after-budget-approval>')
    expect(result.codingRun.prompt).not.toContain(repo)
    const expectedCost = estimateCodingRuntimeCost({
      engine: 'opencode-http',
      providerId: 'double',
      model: 'ark-code-latest',
      prompt: startInput.brief?.prompt ?? '',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-06-17T00:00:00.000Z',
    })
    expect(result.codingRun.runtimeCostSummary?.inputTokens).toBe(expectedCost.inputTokens)
  })

  it('starts a human-approved retry attempt with remediation context in the coding brief', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
      testEvidence: [passingEvidence(repo)],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('retry-1', 'coding-run-1'),
      now: fixedNow('2026-06-18T12:00:00.000Z'),
    })

    const result = await runtime.startRetryAttempt({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      remediationPlan: remediationPlan(),
      candidateIds: ['candidate-api'],
      userInstruction: 'Retry only the API contract remediation.',
    })

    expect(store.retryAttempts[0]).toMatchObject({
      id: 'retry-1',
      remediationPlanId: 'remediation-run-1-node-build-7',
      candidateIds: ['candidate-api'],
      status: 'started',
      codingRunId: result.codingRun.id,
    })
    expect(store.artifacts.some((artifact) => artifact.title === 'Policy remediation retry attempt')).toBe(true)
    expect(store.events.some((event) => event.message.includes('Retry Attempt approved'))).toBe(true)
    expect(result.codingRun.prompt).toContain('Remediation Plan')
    expect(result.codingRun.prompt).toContain('Retry Attempt: retry-1 [approved]')
    expect(result.codingRun.prompt).toContain('Fix API contract violation')
    expect(result.codingRun.prompt).toContain('Policy reason: governance_check:api_contract:violated:check-api')
  })

  it('rejects an invalid retry workflow context before persisting retry evidence', async () => {
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [
        buildRun({
          currentNodeId: 'node-build-current',
          nodes: [
            buildNode({ id: 'node-build-history', status: 'failed' }),
            buildNode({ id: 'node-build-current', status: 'running' }),
          ],
        }),
      ],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.startRetryAttempt({
        runId: 'run-1',
        nodeId: 'node-build-history',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        remediationPlan: remediationPlan(),
        candidateIds: ['candidate-api'],
        userInstruction: 'Do not retry a historical node.',
      }),
    ).rejects.toThrow('Coding Agent can only run on the current workflow node')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.retryAttempts).toHaveLength(0)
    expect(store.artifacts).toHaveLength(0)
    expect(store.events).toHaveLength(0)
    expect(store.codingRuns).toHaveLength(0)
  })

  it('publishes coding run, event, and permission updates as they are persisted', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      publisher,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    expect(publisher.publishRunStatus).toHaveBeenCalledWith(result.codingRun)
    expect(publisher.publishEvent).toHaveBeenCalledTimes(2)
    expect(publisher.publishPermission).toHaveBeenCalledWith(store.permissionRequests[0])
  })

  it('keeps durable startup state when UI and timeout notifications throw', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const notificationFailure = () => {
      throw new Error('renderer notification unavailable')
    }
    const publisher = {
      publishRunStatus: vi.fn(notificationFailure),
      publishEvent: vi.fn(notificationFailure),
      publishPermission: vi.fn(notificationFailure),
    }
    const runtime = createCodingRuntime({
      store,
      engine,
      publisher,
      schedulePermissionTimeout: vi.fn(notificationFailure),
      scheduleRunTimeout: vi.fn(notificationFailure),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-notification-failure'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Persist before notifying.',
    })

    expect(result.codingRun.status).toBe('waiting_permission')
    expect(cancel).not.toHaveBeenCalled()
    expect(store.codingRuns).toEqual([result.codingRun])
    expect(store.codingEvents).toHaveLength(2)
    expect(store.permissionRequests).toHaveLength(1)
    expect(store.workspaces).toEqual([expect.objectContaining({ cleanupStatus: 'active' })])
  })

  it('recursively redacts Coding Agent event messages and metadata before storage and publish', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const baseEngine = createFakeCodingEngineAdapter()
    const engine: CodingEngineAdapter = {
      ...baseEngine,
      async start(input) {
        const bundle = await baseEngine.start(input)
        return {
          ...bundle,
          events: bundle.events.map((event, index) =>
            index === 0
              ? {
                  ...event,
                  message: `Opened error:${repo}/private/report.json with Authorization: Bearer opaque-runtime-secret`,
                  metadata: {
                    token: 'opaque-structured-runtime-token',
                    Authorization: 'Bearer opaque-structured-runtime-bearer',
                    nested: {
                      password: 'opaque-structured-runtime-password',
                      filePath: `${repo}/private/report.json`,
                      output: [
                        `--token opaque-runtime-secret`,
                        { route: '/v1/users' },
                      ],
                    },
                  },
                  redacted: false,
                }
              : event,
          ),
        }
      },
    }
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runtime = createCodingRuntime({
      store,
      engine,
      publisher,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-redaction'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const stored = store.codingEvents[0]
    const published = publisher.publishEvent.mock.calls[0]?.[0]
    expect(JSON.stringify(stored)).not.toContain(repo)
    expect(JSON.stringify(stored)).not.toContain('opaque-runtime-secret')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-token')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-bearer')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-password')
    expect(JSON.stringify(stored)).toContain('/v1/users')
    expect(stored?.redacted).toBe(true)
    expect(published).toEqual(stored)
  })

  it('expires unanswered permission requests through the scheduler callback', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    let expire: (() => Promise<void>) | undefined
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const runtime = createCodingRuntime({
      store,
      engine,
      schedulePermissionTimeout: (_request, callback) => {
        expire = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })

    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    await expire?.()

    expect(store.permissionRequests[0]).toMatchObject({ status: 'expired' })
    expect(store.permissionDecisions[0]).toMatchObject({
      codingRunId: started.codingRun.id,
      decision: 'expired',
      decidedBy: 'devflow-timeout',
    })
    expect(store.codingRuns.at(-1)?.status).toBe('timed_out')
    expect(cancel).toHaveBeenCalledWith({ codingRun: started.codingRun })
    expect(store.codingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            permissionRequestId: store.permissionRequests[0]!.id,
            decision: 'expired',
            status: 'expired',
            outputSummary: 'DevFlow relay expired edit permission; coding run timed out.',
          }),
        }),
      ]),
    )
  })

  it('times out an active coding run through the run timeout scheduler', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({ sourcePath: repo, worktreePath: '/tmp/worktree' })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      workspaces: [workspace],
    })
    let expireRun: (() => Promise<void>) | undefined
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const runtime = createCodingRuntime({
      store,
      engine,
      scheduleRunTimeout: (_codingRun, callback) => {
        expireRun = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      deleteWorkspace: async (input) => ({
        ...input,
        deletedAt: '2026-06-17T00:02:00.000Z',
        cleanupStatus: 'deleted',
      }),
      idGenerator: fixedIds('coding-run-1', 'event-1', 'decision-1', 'event-2'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:02:00.000Z'),
    })

    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    await expireRun?.()

    expect(cancel).toHaveBeenCalledWith({ codingRun: started.codingRun })
    expect(store.permissionRequests[0]).toMatchObject({ status: 'expired' })
    expect(store.codingRuns.at(-1)).toMatchObject({
      id: started.codingRun.id,
      status: 'timed_out',
    })
    expect(store.codingEvents.map((event) => event.kind)).toContain('cleanup')
  })

  it('retries timeout terminalization when an unchanged run gains a pending permission', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    let expireRun: (() => Promise<void>) | undefined
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      scheduleRunTimeout: (_codingRun, callback) => {
        expireRun = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-timeout-race'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:02:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    const originalCommit = store.commitCodingAgentMutation.bind(store)
    let injected = false
    const commit = vi.spyOn(store, 'commitCodingAgentMutation').mockImplementation(async (mutation) => {
      if (!injected && mutation.run?.status === 'timed_out') {
        injected = true
        const currentRequest = store.permissionRequests[0]!
        store.permissionRequests.push({
          ...currentRequest,
          id: 'permission-arrived-during-timeout',
          requestedAt: '2026-06-17T00:01:30.000Z',
          expiresAt: '2026-06-17T00:02:30.000Z',
        })
        return {
          committed: false,
          reason: 'stale_permission_set' as const,
          run: store.codingRuns.find((candidate) => candidate.id === started.codingRun.id)!,
        }
      }
      return originalCommit(mutation)
    })

    await expireRun?.()

    expect(commit.mock.calls.filter(([mutation]) => mutation.run?.status === 'timed_out')).toHaveLength(2)
    expect(store.codingRuns.at(-1)?.status).toBe('timed_out')
    expect(store.permissionRequests).toHaveLength(2)
    expect(store.permissionRequests.every((request) => request.status === 'expired')).toBe(true)
    expect(store.permissionDecisions).toHaveLength(2)
  })

  it('keeps a timed-out run recoverable when engine cancellation fails', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({ sourcePath: repo, worktreePath: '/tmp/worktree-timeout-retry' })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    let expireRun: (() => Promise<void>) | undefined
    const engine = createFakeCodingEngineAdapter()
    vi.spyOn(engine, 'cancel').mockRejectedValueOnce(new Error('engine cancellation failed'))
    const deleteWorkspace = vi.fn(async (input: ManagedCodingWorkspace) => ({
      ...input,
      deletedAt: '2026-06-17T00:02:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace: async () => workspace,
      deleteWorkspace,
      scheduleRunTimeout: (_codingRun, callback) => {
        expireRun = callback
      },
      idGenerator: fixedIds('coding-run-timeout-retry'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    expect(expireRun).toBeTypeOf('function')

    await expect(expireRun!()).rejects.toThrow('engine cancellation failed')

    expect(store.codingRuns.at(-1)).toMatchObject({
      id: started.codingRun.id,
      status: 'waiting_permission',
    })
    expect(store.permissionRequests[0]).toMatchObject({ status: 'pending' })
    expect(store.workspaces.at(-1)).toMatchObject({ cleanupStatus: 'active' })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it('archives terminal Coding evidence without directly uploading a summary after approval', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const runTestCommand = vi.fn(async ({ cwd }: { cwd: string }) => ({
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 77,
      stdout: `coding tests failed in ${cwd}`,
      stderr: 'API_TOKEN=super-secret-token',
      redacted: false,
      summary: `Coding worktree tests failed in ${cwd}.`,
    }))
    const completeWorkflowBuild = vi.fn(async (input) => {
      expect(store.codingRuns.find((candidate) => candidate.id === input.codingRunId)?.status).toBe(
        'completed',
      )
      expect(store.diffArtifacts.find((candidate) => candidate.id === input.diffId)).toBeDefined()
    })
    const runtimeDependencies = {
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      runTestCommand,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'evidence-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    }
    const runtime = createCodingRuntime(runtimeDependencies)
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.permissionDecisions).toHaveLength(1)
    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.bootstrapEvidence).toHaveLength(1)
    expect(store.diffArtifacts[0]?.changedPaths).toEqual(['devflow-fake-change.txt'])
    expect(runTestCommand).toHaveBeenCalledWith({
      command: expect.stringContaining('devflow-fake-change.txt'),
      cwd: store.workspaces[0]!.worktreePath,
      timeoutMs: 120_000,
    })
    expect(store.testEvidence[0]).toMatchObject({
      command: expect.stringContaining('devflow-fake-change.txt'),
      cwd: '<workspace>',
      status: 'failed',
      stdout: 'coding tests failed in <workspace>',
      stderr: '[REDACTED:env_secret_assignment]',
      summary: 'Coding worktree tests failed in <workspace>.',
      redacted: true,
    })
    expect(JSON.stringify(store.testEvidence[0])).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.testEvidence[0])).not.toContain('super-secret-token')
    expect(store.artifacts[0]).toMatchObject({ kind: 'test_report', title: 'Local test evidence' })
    expect(JSON.stringify(store.artifacts[0])).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.artifacts[0])).not.toContain('super-secret-token')
    expect(store.events[0]).toMatchObject({ kind: 'test_result', message: 'Coding worktree tests failed in <workspace>.' })
    expect(JSON.stringify(store.codingEvents)).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.codingEvents)).not.toContain('super-secret-token')
    expect(store.codingRuns.at(-1)?.testEvidenceId).toBe(store.testEvidence[0]?.id)
    expect(store.codingRuns.at(-1)?.summary).toContain(
      'Test evidence failed: Coding worktree tests failed in <workspace>.',
    )
    expect(store.codingEvents.map((event) => event.kind)).toContain('test')
    expect(completeWorkflowBuild).toHaveBeenCalledWith({
      runId: 'run-1',
      nodeId: 'node-build',
      codingRunId: started.codingRun.id,
      diffId: store.diffArtifacts[0]!.id,
      now: '2026-06-17T00:01:00.000Z',
    })
  })

  it('surfaces workflow build completion failures after preserving coding evidence', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const completeWorkflowBuild = vi.fn(async () => {
      throw new Error('not_current_node')
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      runTestCommand: async () => ({
        status: 'passed',
        exitCode: 0,
        durationMs: 10,
        stdout: 'passed',
        stderr: '',
        redacted: true,
        summary: 'Coding worktree tests passed.',
      }),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-workflow-failure', 'decision-workflow-failure'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await expect(
      runtime.replyCodingPermission({
        requestId: store.permissionRequests[0]!.id,
        codingRunId: started.codingRun.id,
        decidedBy: 'user-1',
        decision: 'approved',
        comment: 'Approved from test.',
      }),
    ).rejects.toThrow('Workflow build completion failed: not_current_node')

    expect(completeWorkflowBuild).toHaveBeenCalledOnce()
    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.diffArtifacts).toHaveLength(1)
  })

  it('persists the next live permission request without finalizing the run', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const nextPermission: CodingPermissionRequest = {
      id: 'permission-edit-2',
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      permission: 'edit',
      title: 'opencode requested edit permission',
      filePath: 'src/new-file.ts',
      risk: 'warn',
      reasons: ['opencode requested a second permission.'],
      status: 'pending',
      requestedAt: '2026-06-17T00:01:00.000Z',
      expiresAt: '2026-06-17T00:02:00.000Z',
    }
    const engineWithNextPermission: CodingEngineAdapter = {
      ...fakeEngine,
      engine: 'opencode-http',
      async approvePermission(input) {
        return {
          codingRun: {
            ...input.codingRun,
            engine: 'opencode-http',
            status: 'waiting_permission',
            summary: 'opencode is waiting for another DevFlow permission relay.',
          },
          events: [
            {
              id: 'coding-event-next-permission',
              codingRunId: input.codingRun.id,
              runId: input.codingRun.runId,
              nodeId: input.codingRun.nodeId,
              sequence: 3,
              kind: 'permission',
              message: 'opencode requested edit permission.',
              timestamp: '2026-06-17T00:01:00.000Z',
              metadata: { requestId: nextPermission.id },
              redacted: true,
            },
          ],
          permissionRequest: nextPermission,
        }
      },
    }
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runTestCommand = vi.fn()
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: engineWithNextPermission,
      completeWorkflowBuild,
      publisher,
      runTestCommand,
      budgetGuard: createAllowingBudgetGuard(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'openai',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved first permission.',
    })

    expect(store.permissionRequests).toHaveLength(2)
    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.permissionRequests[1]).toEqual(nextPermission)
    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'waiting_permission',
      summary: 'opencode is waiting for another DevFlow permission relay.',
    })
    expect(store.diffArtifacts).toHaveLength(0)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
    expect(publisher.publishPermission).toHaveBeenCalledWith(nextPermission)
  })

  it('fails closed when the provider reuses a settled permission id for the next request', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    engine.engine = 'opencode-http'
    const cancel = vi.spyOn(engine, 'cancel')
    vi.spyOn(engine, 'approvePermission').mockImplementationOnce(async (input) => ({
      codingRun: {
        ...input.codingRun,
        engine: 'opencode-http',
        status: 'waiting_permission',
        summary: 'opencode is waiting for another DevFlow permission relay.',
      },
      events: [],
      permissionRequest: {
        ...input.request,
        status: 'pending',
        requestedAt: '2026-06-17T00:01:00.000Z',
        expiresAt: '2026-06-17T00:02:00.000Z',
      },
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      budgetGuard: createAllowingBudgetGuard(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'failure-event-1', 'cleanup-event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'openai',
      userInstruction: 'Add the marker file.',
    })

    await expect(runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved first permission.',
    })).rejects.toThrow('Coding Agent continuation could not be persisted safely.')

    expect(cancel).toHaveBeenCalledOnce()
    expect(store.permissionRequests).toHaveLength(1)
    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.codingRuns.at(-1)?.status).toBe('failed')
    expect(store.workspaces.at(-1)?.cleanupStatus).toBe('deleted')
  })

  it('fails the run and cleans its worktree when the engine fails after an approved permission', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const providerFailure = new OpencodeMessageResponseError({
      code: 'provider_api_error',
      statusCode: 429,
      retryable: true,
    })
    vi.spyOn(engine, 'approvePermission').mockRejectedValueOnce(providerFailure)
    const cancel = vi.spyOn(engine, 'cancel')
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'cleanup-event-1', 'failure-event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await expect(runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })).rejects.toBe(providerFailure)

    expect(cancel).toHaveBeenCalledWith({ codingRun: started.codingRun })
    expect(store.permissionRequests[0]?.status).toBe('approved')
    expect(store.permissionDecisions).toHaveLength(1)
    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'failed',
      summary: 'Coding engine failed after permission approval.',
      completedAt: '2026-06-17T00:01:00.000Z',
    })
    expect(store.workspaces.at(-1)).toMatchObject({ cleanupStatus: 'deleted' })
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        message: 'Coding engine failed after permission approval.',
      }),
      expect.objectContaining({ kind: 'cleanup' }),
    ]))
  })

  it('retains the active run and worktree when continuation cleanup is not confirmed', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const providerFailure = new OpencodeMessageResponseError({ code: 'provider_api_error' })
    vi.spyOn(engine, 'approvePermission').mockRejectedValueOnce(providerFailure)
    vi.spyOn(engine, 'cancel').mockRejectedValueOnce(new Error('RAW_CLEANUP_DETAIL'))
    const deleteWorkspace = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine,
      deleteWorkspace,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'failure-event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const failure = runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    await expect(failure).rejects.toBeInstanceOf(CodingEngineContinuationCleanupError)
    expect(deleteWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns.at(-1)?.status).toBe('waiting_permission')
    expect(store.workspaces.at(-1)?.cleanupStatus).toBe('active')
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        message: 'Coding engine failed after permission approval and session cleanup did not complete.',
        metadata: { sessionCleanupStatus: 'cleanup_failed' },
      }),
    ]))
    expect(JSON.stringify(store.codingRuns)).not.toContain('RAW_CLEANUP_DETAIL')
    expect(JSON.stringify(store.codingEvents)).not.toContain('RAW_CLEANUP_DETAIL')
  })

  it('does not overwrite a concurrently cancelled run with a stale approval failure', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    let rejectApproval: ((error: unknown) => void) | undefined
    const approvePermission = vi.spyOn(engine, 'approvePermission').mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectApproval = reject
      }),
    )
    const cancel = vi.spyOn(engine, 'cancel')
    const deleteWorkspace = vi.fn(async (workspace: ManagedCodingWorkspace) => ({
      ...workspace,
      deletedAt: '2026-06-17T00:02:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const runtime = createCodingRuntime({
      store,
      engine,
      deleteWorkspace,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'cancel-cleanup-event-1', 'cancel-status-event-1'),
      now: sequenceNow(
        '2026-06-17T00:00:00.000Z',
        '2026-06-17T00:01:00.000Z',
        '2026-06-17T00:02:00.000Z',
      ),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    const approval = runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })
    await vi.waitFor(() => expect(approvePermission).toHaveBeenCalledOnce())

    await runtime.cancelCodingAgentRun({ codingRunId: started.codingRun.id })
    const providerFailure = new CodingEngineContinuationCleanupError([
      new OpencodeMessageResponseError({ code: 'provider_api_error' }),
      new Error('session cleanup did not complete'),
    ])
    rejectApproval?.(providerFailure)
    await expect(approval).rejects.toBe(providerFailure)

    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'cancelled',
      summary: 'Coding Agent run cancelled by user.',
    })
    expect(deleteWorkspace).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not overwrite a concurrently cancelled run with a stale approval success', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const originalApprovePermission = engine.approvePermission.bind(engine)
    let pendingApprovalInput: Parameters<CodingEngineAdapter['approvePermission']>[0] | undefined
    let resolveApproval: ((result: Awaited<ReturnType<CodingEngineAdapter['approvePermission']>>) => void) | undefined
    const approvePermission = vi.spyOn(engine, 'approvePermission').mockImplementationOnce(
      (input) => {
        pendingApprovalInput = input
        return new Promise((resolve) => {
          resolveApproval = resolve
        })
      },
    )
    const cancel = vi.spyOn(engine, 'cancel')
    const deleteWorkspace = vi.fn(async (workspace: ManagedCodingWorkspace) => ({
      ...workspace,
      deletedAt: '2026-06-17T00:02:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const runTestCommand = vi.fn()
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine,
      deleteWorkspace,
      runTestCommand,
      completeWorkflowBuild,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'cancel-cleanup-event-1', 'cancel-status-event-1'),
      now: sequenceNow(
        '2026-06-17T00:00:00.000Z',
        '2026-06-17T00:01:00.000Z',
        '2026-06-17T00:02:00.000Z',
      ),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    const approval = runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })
    await vi.waitFor(() => expect(approvePermission).toHaveBeenCalledOnce())

    await runtime.cancelCodingAgentRun({ codingRunId: started.codingRun.id })
    if (!pendingApprovalInput || !resolveApproval) {
      throw new Error('approval test did not capture the pending engine request')
    }
    resolveApproval(await originalApprovePermission(pendingApprovalInput))
    await expect(approval).resolves.toMatchObject({ status: 'approved' })

    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'cancelled',
      summary: 'Coding Agent run cancelled by user.',
    })
    expect(store.diffArtifacts).toHaveLength(0)
    expect(deleteWorkspace).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('does not overwrite a concurrently timed-out run with a stale approval success', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const originalApprovePermission = engine.approvePermission.bind(engine)
    let pendingApprovalInput: Parameters<CodingEngineAdapter['approvePermission']>[0] | undefined
    let resolveApproval: ((result: Awaited<ReturnType<CodingEngineAdapter['approvePermission']>>) => void) | undefined
    const approvePermission = vi.spyOn(engine, 'approvePermission').mockImplementationOnce(
      (input) => {
        pendingApprovalInput = input
        return new Promise((resolve) => {
          resolveApproval = resolve
        })
      },
    )
    const cancel = vi.spyOn(engine, 'cancel')
    const deleteWorkspace = vi.fn(async (workspace: ManagedCodingWorkspace) => ({
      ...workspace,
      deletedAt: '2026-06-17T00:02:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const runTestCommand = vi.fn()
    const completeWorkflowBuild = vi.fn()
    let expireRun: (() => Promise<void>) | undefined
    const runtime = createCodingRuntime({
      store,
      engine,
      deleteWorkspace,
      runTestCommand,
      completeWorkflowBuild,
      scheduleRunTimeout: (_codingRun, callback) => {
        expireRun = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds(
        'coding-run-1',
        'decision-1',
        'timeout-decision-1',
        'timeout-cleanup-event-1',
        'timeout-tool-event-1',
        'timeout-status-event-1',
      ),
      now: sequenceNow(
        '2026-06-17T00:00:00.000Z',
        '2026-06-17T00:01:00.000Z',
        '2026-06-17T00:02:00.000Z',
      ),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    const approval = runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })
    await vi.waitFor(() => expect(approvePermission).toHaveBeenCalledOnce())

    await expireRun?.()
    if (!pendingApprovalInput || !resolveApproval) {
      throw new Error('approval test did not capture the pending engine request')
    }
    resolveApproval(await originalApprovePermission(pendingApprovalInput))
    await expect(approval).resolves.toMatchObject({ status: 'approved' })

    expect(store.codingRuns.at(-1)).toMatchObject({ status: 'timed_out' })
    expect(store.diffArtifacts).toHaveLength(0)
    expect(deleteWorkspace).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('does not complete the workflow build when dependency bootstrap fails', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const engineWithFailedBootstrap: CodingEngineAdapter = {
      ...fakeEngine,
      async approvePermission(input) {
        const completed = await fakeEngine.approvePermission(input)
        if ('permissionRequest' in completed) {
          throw new Error(`Expected completed fake result, got permission ${completed.permissionRequest.id}`)
        }
        return {
          ...completed,
          bootstrapEvidence: {
            ...completed.bootstrapEvidence!,
            status: 'failed',
            exitCode: 1,
            stderr: 'dependency installation failed',
            summary: 'Dependency bootstrap failed.',
          },
        }
      },
    }
    const completeWorkflowBuild = vi.fn()
    const runTestCommand = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: engineWithFailedBootstrap,
      completeWorkflowBuild,
      runTestCommand,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-bootstrap-failure', 'decision-bootstrap-failure'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(store.codingRuns.at(-1)?.status).toBe('failed')
    expect(store.diffArtifacts).toHaveLength(1)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('runs runtime-owned dependency bootstrap before tests when the engine does not return bootstrap evidence', async () => {
    const repo = await gitRepo()
    const projectWithAbsoluteTestCommand = {
      ...project(repo),
      testCommand: `node ${repo}/test.js API_TOKEN=command-secret`,
    }
    const store = new MemoryCodingStore({
      projects: [projectWithAbsoluteTestCommand],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const engineWithoutBootstrap: CodingEngineAdapter = {
      ...fakeEngine,
      engine: 'opencode-http',
      async approvePermission(input) {
        const completed = await fakeEngine.approvePermission(input)
        if ('permissionRequest' in completed) {
          throw new Error(`Expected completed fake result, got permission ${completed.permissionRequest.id}`)
        }
        return {
          codingRun: {
            ...completed.codingRun,
            engine: 'opencode-http',
          },
          events: completed.events,
          diff: completed.diff,
        }
      },
    }
    const runDependencyBootstrap = vi.fn(async (): Promise<DependencyBootstrapEvidence> => ({
      id: 'bootstrap-runtime-1',
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      command: 'npm ci',
      status: 'passed',
      exitCode: 0,
      durationMs: 15,
      stdout: 'installed',
      stderr: '',
      summary: 'Runtime bootstrap passed.',
      dependencyHash: 'hash-runtime',
      redacted: false,
      createdAt: '2026-06-17T00:01:00.000Z',
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 77,
      stdout: 'coding tests passed',
      stderr: '',
      redacted: true,
      summary: 'Coding worktree tests passed.',
    }))
    const runtime = createCodingRuntime({
      store,
      engine: engineWithoutBootstrap,
      runDependencyBootstrap,
      runTestCommand,
      budgetGuard: createAllowingBudgetGuard(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'evidence-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'openai',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(runDependencyBootstrap).toHaveBeenCalledWith({
      codingRun: expect.objectContaining({ id: 'coding-run-1' }),
      project: expect.objectContaining({ id: 'project-1' }),
      workspace: expect.objectContaining({ id: store.workspaces[0]!.id }),
      previousDependencyHash: undefined,
      timestamp: '2026-06-17T00:01:00.000Z',
    })
    expect(store.bootstrapEvidence[0]).toMatchObject({
      id: 'bootstrap-runtime-1',
      status: 'passed',
      command: 'npm ci',
    })
    expect(runTestCommand).toHaveBeenCalled()
    expect(runTestCommand).toHaveBeenCalledWith({
      command: projectWithAbsoluteTestCommand.testCommand,
      cwd: store.workspaces[0]!.worktreePath,
      timeoutMs: 120_000,
    })
    expect(JSON.stringify(store.codingEvents)).not.toContain(repo)
    expect(JSON.stringify(store.codingEvents)).not.toContain('command-secret')
    expect(JSON.stringify(store.testEvidence)).not.toContain(repo)
    expect(JSON.stringify(store.testEvidence)).not.toContain('command-secret')
    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'completed',
      bootstrapEvidenceId: 'bootstrap-runtime-1',
      testEvidenceId: store.testEvidence[0]?.id,
    })
  })

  it('interrupts the coding run without uploading a summary when permission is rejected', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const completeWorkflowBuild = vi.fn()
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const runtime = createCodingRuntime({
      store,
      engine,
      completeWorkflowBuild,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const request = await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'rejected',
      comment: 'No.',
    })

    expect(request.status).toBe('rejected')
    expect(store.codingRuns.at(-1)?.status).toBe('interrupted')
    expect(cancel).toHaveBeenCalledWith({ codingRun: started.codingRun })
    expect(store.codingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            permissionRequestId: store.permissionRequests[0]!.id,
            decision: 'rejected',
            status: 'rejected',
            outputSummary: 'DevFlow relay rejected edit permission; coding run interrupted.',
          }),
        }),
      ]),
    )
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('cancels a running coding run, cleans up the worktree, and appends cleanup evidence', async () => {
    const workspace = managedWorkspace()
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [buildRun()],
      codingRuns: [codingRun({ id: 'coding-run-1', status: 'waiting_permission' })],
      workspaces: [workspace],
    })
    const deleteWorkspace = vi.fn(async () => ({
      ...workspace,
      deletedAt: '2026-06-17T00:03:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      idGenerator: fixedIds('event-1'),
      now: fixedNow('2026-06-17T00:03:00.000Z'),
      deleteWorkspace,
    })

    const cancelled = await runtime.cancelCodingAgentRun({ codingRunId: 'coding-run-1' })

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.completedAt).toBe('2026-06-17T00:03:00.000Z')
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.workspaces.at(-1)).toMatchObject({ cleanupStatus: 'deleted' })
    expect(store.codingEvents.map((event) => event.kind)).toContain('cleanup')
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'status',
        message: 'Coding Agent run cancelled by user.',
      }),
    ]))
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('atomically rejects pending permissions when cancelling an active coding run', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createFakeCodingEngineAdapter()
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-cancel-pending'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:02:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const cancelled = await runtime.cancelCodingAgentRun({ codingRunId: started.codingRun.id })

    expect(cancelled.status).toBe('cancelled')
    expect(store.permissionRequests).toEqual([
      expect.objectContaining({ status: 'rejected' }),
    ])
    expect(store.permissionDecisions).toEqual([
      expect.objectContaining({
        decision: 'rejected',
        decidedBy: 'devflow-cancel',
      }),
    ])
    expect(store.codingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_result',
        metadata: expect.objectContaining({
          permissionRequestId: store.permissionRequests[0]!.id,
          status: 'rejected',
        }),
      }),
    ]))
  })

  it.each(['completed', 'failed', 'timed_out', 'interrupted', 'cancelled'] as const)(
    'does not rewrite a terminal %s coding run as cancelled',
    async (status) => {
      const terminalRun = codingRun({
        id: 'coding-run-terminal',
        status,
        completedAt: '2026-06-17T00:02:00.000Z',
      })
      const workspace = managedWorkspace({
        id: 'workspace-terminal',
        codingRunId: terminalRun.id,
      })
      const store = new MemoryCodingStore({
        projects: [project('/tmp/repo')],
        runs: [buildRun()],
        codingRuns: [terminalRun],
        workspaces: [workspace],
      })
      const engine = createFakeCodingEngineAdapter()
      const cancel = vi.spyOn(engine, 'cancel')
      const deleteWorkspace = vi.fn()
      const runtime = createCodingRuntime({
        store,
        engine,
        deleteWorkspace,
        idGenerator: fixedIds('unexpected-event'),
        now: fixedNow('2026-06-17T00:03:00.000Z'),
      })

      await expect(runtime.cancelCodingAgentRun({ codingRunId: terminalRun.id })).resolves.toEqual(terminalRun)

      expect(store.codingRuns).toEqual([terminalRun])
      expect(cancel).not.toHaveBeenCalled()
      expect(deleteWorkspace).not.toHaveBeenCalled()
      expect(store.codingEvents).toEqual([])
    },
  )
})

type StoreSeed = {
  projects?: LocalProject[]
  runs?: WorkflowRun[]
  artifacts?: Artifact[]
  events?: AgentEvent[]
  testEvidence?: TestEvidence[]
  codingRuns?: CodingAgentRun[]
  retryAttempts?: RetryAttempt[]
  workspaces?: ManagedCodingWorkspace[]
}

class MemoryCodingStore {
  readonly projects: LocalProject[]
  readonly runs: WorkflowRun[]
  readonly artifacts: Artifact[]
  readonly events: AgentEvent[]
  readonly testEvidence: TestEvidence[]
  readonly workspaces: ManagedCodingWorkspace[]
  readonly codingRuns: CodingAgentRun[]
  readonly codingEvents: CodingAgentEvent[] = []
  readonly permissionRequests: CodingPermissionRequest[] = []
  readonly permissionDecisions: CodingPermissionDecision[] = []
  readonly bootstrapEvidence: DependencyBootstrapEvidence[] = []
  readonly diffArtifacts: CodingDiffArtifact[] = []
  readonly retryAttempts: RetryAttempt[]

  constructor(seed: StoreSeed = {}) {
    this.projects = seed.projects ?? []
    this.runs = seed.runs ?? []
    this.artifacts = seed.artifacts ?? []
    this.events = seed.events ?? []
    this.testEvidence = seed.testEvidence ?? []
    this.codingRuns = seed.codingRuns ?? []
    this.retryAttempts = seed.retryAttempts ?? []
    this.workspaces = seed.workspaces ?? []
  }

  async listProjects() {
    return this.projects
  }

  async listRuns() {
    return this.runs
  }

  async listArtifacts(runId?: string) {
    return runId ? this.artifacts.filter((artifact) => artifact.runId === runId) : this.artifacts
  }

  async listEvents(runId?: string) {
    return runId ? this.events.filter((event) => event.runId === runId) : this.events
  }

  async listTestEvidence(runId?: string) {
    return runId ? this.testEvidence.filter((evidence) => evidence.runId === runId) : this.testEvidence
  }

  async saveRun(run: WorkflowRun) {
    upsert(this.runs, run)
  }

  async saveArtifact(artifact: Artifact) {
    upsert(this.artifacts, artifact)
  }

  async saveEvent(event: AgentEvent) {
    upsert(this.events, event)
  }

  async saveTestEvidence(evidence: TestEvidence) {
    upsert(this.testEvidence, evidence)
  }

  async listCodingAgentRuns(runId?: string) {
    return runId ? this.codingRuns.filter((run) => run.runId === runId) : this.codingRuns
  }

  async saveCodingAgentRun(run: CodingAgentRun) {
    upsert(this.codingRuns, run)
  }

  async reserveCodingAgentRun(run: CodingAgentRun): Promise<ReserveCodingAgentRunResult> {
    const sameId = this.codingRuns.find((candidate) => candidate.id === run.id)
    if (sameId) {
      return { reserved: false, reason: 'run_id_exists', run: sameId }
    }
    const active = this.codingRuns.find(
      (candidate) =>
        candidate.projectId === run.projectId &&
        ['queued', 'preparing', 'waiting_permission', 'bootstrapping', 'running', 'testing'].includes(candidate.status),
    )
    if (active) {
      return { reserved: false, reason: 'active_run_exists', run: active }
    }
    upsert(this.codingRuns, run)
    return { reserved: true, run }
  }

  async commitCodingAgentMutation(
    mutation: CodingAgentMutation,
  ): Promise<CodingAgentMutationResult> {
    const currentRun = this.codingRuns.find((run) => run.id === mutation.expectedRun.id)
    if (!currentRun) {
      return { committed: false, reason: 'run_not_found', run: null }
    }
    if (JSON.stringify(currentRun) !== JSON.stringify(mutation.expectedRun)) {
      return { committed: false, reason: 'stale_run', run: currentRun }
    }
    if (mutation.run && mutation.run.id !== currentRun.id) {
      throw new Error('Coding Agent mutation cannot change the run identity')
    }
    if (
      mutation.run &&
      !['queued', 'preparing', 'waiting_permission', 'bootstrapping', 'running', 'testing'].includes(currentRun.status) &&
      JSON.stringify(mutation.run) !== JSON.stringify(currentRun)
    ) {
      return { committed: false, reason: 'terminal_run', run: currentRun }
    }
    if (
      mutation.run &&
      (
        mutation.run.runId !== currentRun.runId ||
        mutation.run.nodeId !== currentRun.nodeId ||
        mutation.run.projectId !== currentRun.projectId
      )
    ) {
      throw new Error('Coding Agent mutation cannot change the run authority scope')
    }
    const expectedPendingIds = [...mutation.expectedPendingPermissionRequestIds].sort()
    const currentPendingIds = this.permissionRequests
      .filter((request) => request.codingRunId === currentRun.id && request.status === 'pending')
      .map((request) => request.id)
      .sort()
    if (JSON.stringify(currentPendingIds) !== JSON.stringify(expectedPendingIds)) {
      return { committed: false, reason: 'stale_permission_set', run: currentRun }
    }
    const expectedRequestsById = new Map(
      (mutation.expectedPermissionRequests ?? []).map((request) => [request.id, request]),
    )
    for (const expectedRequest of expectedRequestsById.values()) {
      const currentRequest = this.permissionRequests.find((request) => request.id === expectedRequest.id)
      if (!currentRequest || JSON.stringify(currentRequest) !== JSON.stringify(expectedRequest)) {
        return { committed: false, reason: 'stale_permission_request', run: currentRun }
      }
    }
    const decisionsByRequestId = new Map<string, CodingPermissionDecision>()
    for (const decision of mutation.permissionDecisions ?? []) {
      if (decisionsByRequestId.has(decision.requestId)) {
        throw new Error('Coding Agent mutation cannot record duplicate permission decisions')
      }
      decisionsByRequestId.set(decision.requestId, decision)
    }
    for (const request of mutation.permissionRequests ?? []) {
      const currentRequest = this.permissionRequests.find((candidate) => candidate.id === request.id)
      const expectedRequest = expectedRequestsById.get(request.id)
      if (!expectedRequest ? Boolean(currentRequest) : currentRequest?.status !== 'pending' || request.status === 'pending') {
        return { committed: false, reason: 'stale_permission_request', run: currentRun }
      }
      if (!expectedRequest) {
        if (request.status !== 'pending' || decisionsByRequestId.has(request.id)) {
          throw new Error('New Coding Agent permission requests must be pending and undecided')
        }
      } else if (decisionsByRequestId.get(request.id)?.decision !== request.status) {
        throw new Error('Settled Coding Agent permission requests require one matching decision')
      }
    }
    if (mutation.run) upsert(this.codingRuns, mutation.run)
    for (const event of mutation.events ?? []) upsert(this.codingEvents, event)
    for (const request of mutation.permissionRequests ?? []) upsert(this.permissionRequests, request)
    for (const decision of mutation.permissionDecisions ?? []) upsert(this.permissionDecisions, decision)
    for (const artifact of mutation.diffArtifacts ?? []) upsert(this.diffArtifacts, artifact)
    return { committed: true, run: mutation.run ?? currentRun }
  }

  async saveCodingAgentEvent(event: CodingAgentEvent) {
    upsert(this.codingEvents, event)
  }

  async listCodingAgentEvents(codingRunId?: string) {
    return codingRunId
      ? this.codingEvents.filter((event) => event.codingRunId === codingRunId)
      : this.codingEvents
  }

  async saveCodingPermissionRequest(request: CodingPermissionRequest) {
    upsert(this.permissionRequests, request)
  }

  async listCodingPermissionRequests(codingRunId?: string) {
    return codingRunId
      ? this.permissionRequests.filter((request) => request.codingRunId === codingRunId)
      : this.permissionRequests
  }

  async saveCodingPermissionDecision(decision: CodingPermissionDecision) {
    upsert(this.permissionDecisions, decision)
  }

  async saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace) {
    upsert(this.workspaces, workspace)
  }

  async listManagedCodingWorkspaces(projectId?: string) {
    return projectId ? this.workspaces.filter((workspace) => workspace.projectId === projectId) : this.workspaces
  }

  async saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence) {
    upsert(this.bootstrapEvidence, evidence)
  }

  async listDependencyBootstrapEvidence(codingRunId?: string) {
    return codingRunId
      ? this.bootstrapEvidence.filter((evidence) => evidence.codingRunId === codingRunId)
      : this.bootstrapEvidence
  }

  async saveCodingDiffArtifact(artifact: CodingDiffArtifact) {
    upsert(this.diffArtifacts, artifact)
  }

  async saveRetryAttempt(attempt: RetryAttempt) {
    upsert(this.retryAttempts, attempt)
    return attempt
  }

  async listRetryAttempts(runId?: string) {
    return runId ? this.retryAttempts.filter((attempt) => attempt.runId === runId) : this.retryAttempts
  }

  async loadState() {
    return {
      remoteSyncOperations: [],
      projects: this.projects,
      runs: this.runs,
      artifacts: this.artifacts,
      events: this.events,
      testEvidence: this.testEvidence,
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      codingRuns: this.codingRuns,
      codingEvents: this.codingEvents,
      codingPermissionRequests: this.permissionRequests,
      codingPermissionDecisions: this.permissionDecisions,
      managedCodingWorkspaces: this.workspaces,
      dependencyBootstrapEvidence: this.bootstrapEvidence,
      codingDiffArtifacts: this.diffArtifacts,
      retryAttempts: this.retryAttempts,
      settings: { themePreference: 'system' as const },
      mcpServers: [],
    }
  }
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index >= 0) {
    items[index] = item
  } else {
    items.push(item)
  }
}

function opencodeSequenceFetcher(
  responses: unknown[],
): Fetcher & { urls: string[] } {
  const queue = [...responses]
  const urls: string[] = []
  let pendingMessage:
    | {
        body: object
        resolve: (response: Response) => void
      }
    | undefined
  const fetcher = vi.fn(async (input: Parameters<Fetcher>[0]) => {
    const requestUrl = String(input)
    urls.push(requestUrl)
    const body = queue.shift()
    if (requestUrl.includes('/message?') && isDeferredOpencodeMessage(body)) {
      return await new Promise<Response>((resolve) => {
        pendingMessage = { body, resolve }
      })
    }
    const acknowledgedReply = requestUrl.includes('/permission/') &&
      requestUrl.includes('/reply?') && body === true
    const continuationWillComplete = acknowledgedReply &&
      Array.isArray(queue[0]) && queue[0].length === 0
    const acknowledgedAbort = requestUrl.includes('/abort?') && body === true
    if (pendingMessage && (continuationWillComplete || acknowledgedAbort)) {
      const current = pendingMessage
      pendingMessage = undefined
      current.resolve(new Response(JSON.stringify(current.body), { status: 200 }))
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { urls: string[] }
  fetcher.urls = urls
  return fetcher
}

const deferredOpencodeMessages = new WeakSet<object>()

function deferredOpencodeMessage<T extends object>(response: T): T {
  deferredOpencodeMessages.add(response)
  return response
}

function isDeferredOpencodeMessage(value: unknown): value is object {
  return typeof value === 'object' && value !== null && deferredOpencodeMessages.has(value)
}

function createSpyCodingEngine(engine: CodingAgentRun['engine']): CodingEngineAdapter {
  return {
    engine,
    providerId: engine === 'fake' ? 'fake-coding-engine' : 'double',
    modelId: engine === 'fake' ? 'fake' : 'ark-code-latest',
    ensure: vi.fn(async (input) => ({
      projectId: input.project.id,
      engine,
      status: 'ready' as const,
    })),
    start: vi.fn(async () => {
      throw new Error('engine.start should not be called in this test')
    }),
    approvePermission: vi.fn(async () => {
      throw new Error('approvePermission should not be called in this test')
    }),
    cancel: vi.fn(async () => undefined),
  }
}

function createAllowingBudgetGuard() {
  return vi.fn(async () => ({
    status: 'allowed',
    blocksRun: false,
    currentSpendUsd: 0,
    projectedCostUsd: 0.01,
    limitUsd: 10,
    reason: 'Paid runtime is within the configured project budget.',
  } satisfies BudgetGuardDecision))
}

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function gitRepo() {
  const repo = await tempDir('devflow-runtime-git-')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }))
  await writeFile(path.join(repo, 'sum.js'), 'export function sum(a, b) { return a + b }\\n')
  await execFileAsync('git', ['init'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'devflow@example.com'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'DevFlow'], { cwd: repo })
  await execFileAsync('git', ['add', '.'], { cwd: repo })
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repo })
  return repo
}

function project(repo: string): LocalProject {
  return {
    id: 'project-1',
    name: 'Fixture',
    path: repo,
    packageManager: 'npm',
    detectedTestCommand: 'npm test',
    testCommand: 'npm test',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
  }
}

function designArtifact(): Artifact {
  return {
    id: 'artifact-design',
    runId: 'run-1',
    nodeId: 'node-design',
    kind: 'design',
    title: 'Health endpoint design',
    summary: 'Follow the API health endpoint standard and include degraded dependency states.',
    content: 'The implementation must expose ok, degraded, and down states with test evidence.',
    redacted: false,
    updatedAt: '2026-06-17T00:00:00.000Z',
  }
}

function approvalEvent(): AgentEvent {
  return {
    id: 'event-approval-1',
    runId: 'run-1',
    nodeId: 'node-design-gate',
    sequence: 1,
    kind: 'approval',
    message: 'Lead Gate 已通过：方案评审 Gate',
    timestamp: '2026-06-17T00:00:00.000Z',
  }
}

function passingEvidence(repo: string): TestEvidence {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    nodeId: 'node-build',
    projectId: 'project-1',
    command: 'npm test',
    cwd: repo,
    status: 'passed',
    exitCode: 0,
    durationMs: 42,
    stdout: 'ok',
    stderr: '',
    summary: 'Existing local tests passed.',
    redacted: true,
    createdAt: '2026-06-17T00:00:00.000Z',
  }
}

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    version: 1,
    title: 'Implement build node',
    request: 'Use DevFlow context to implement a small change.',
    projectId: 'project-1',
    creatorId: 'user-1',
    status: 'building',
    currentNodeId: 'node-build',
    branchName: 'ai/build-node',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    nodes: [buildNode()],
    edges: [],
    ...overrides,
  }
}

function buildNode(overrides: Partial<WorkflowRun['nodes'][number]> = {}): WorkflowRun['nodes'][number] {
  return {
    id: 'node-build',
    stage: 'build',
    title: 'Build implementation',
    subtitle: 'Make the requested code change.',
    kind: 'task',
    status: 'running',
    ownerId: 'user-1',
    retryCount: 0,
    artifactIds: [],
    ...overrides,
  }
}

function codingRun(overrides: Partial<CodingAgentRun> = {}): CodingAgentRun {
  return {
    id: 'coding-run-active',
    runId: 'run-1',
    nodeId: 'node-build',
    projectId: 'project-1',
    requestedBy: 'user-1',
    providerId: 'fake-coding-engine',
    engine: 'fake',
    status: 'waiting_permission',
    managedWorkspaceId: 'workspace-1',
    branchName: 'devflow/run-1-node-build-coding-run-active',
    userInstruction: 'Do it.',
    prompt: 'Prompt',
    summary: 'Waiting.',
    changedPaths: [],
    startedAt: '2026-06-17T00:00:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function managedWorkspace(overrides: Partial<ManagedCodingWorkspace> = {}): ManagedCodingWorkspace {
  return {
    id: 'workspace-1',
    projectId: 'project-1',
    codingRunId: 'coding-run-1',
    sourcePath: '/tmp/repo',
    worktreePath: '/tmp/worktree',
    branchName: 'devflow/run-1-node-build-coding-run-1',
    baseBranch: 'main',
    createdAt: '2026-06-17T00:00:00.000Z',
    cleanupStatus: 'active',
    ...overrides,
  }
}

function remediationPlan(): RemediationPlan {
  return {
    id: 'remediation-run-1-node-build-7',
    runId: 'run-1',
    nodeId: 'node-build',
    status: 'blocked',
    policyVersion: 7,
    blockingReasonIds: ['governance_check:api_contract:violated:check-api'],
    warningReasonIds: [],
    remainingEvidenceGaps: ['API contract'],
    candidates: [
      {
        id: 'candidate-api',
        kind: 'fix_api_contract',
        title: 'Fix API contract violation',
        summary: 'Update implementation to match the API contract.',
        priority: 'high',
        sourceReasonIds: ['governance_check:api_contract:violated:check-api'],
        governanceCheckIds: ['check-api'],
        agentFindingIds: [],
        evidenceIds: [],
        knowledgeReferenceIds: [],
        requiresHumanApproval: true,
        eligibleForCodingRetry: true,
      },
    ],
    createdAt: '2026-06-18T12:00:00.000Z',
  }
}

function fixedIds(...ids: string[]) {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}

function fixedNow(value: string) {
  return () => value
}

function sequenceNow(...values: string[]) {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? new Date(0).toISOString()
}
