import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CodingBrief,
  LocalProject,
  ManagedCodingWorkspace,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createLocalStore } from './local-store.js'
import {
  createAgentProviderNativeCodingDecisionProvider,
  createNativeCodingExecutor,
} from './native-coding-executor.js'

const tempDirectories: string[] = []
const execFileAsync = promisify(execFile)

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirectories.length = 0
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  tempDirectories.push(directory)
  return directory
}

function buildRun(): WorkflowRun {
  return {
    id: 'run-native-coding-1',
    version: 1,
    title: 'Repair one bounded fixture',
    request: 'Apply the approved native repair.',
    projectId: 'local-project-native-coding-1',
    creatorId: 'user-native-coding-1',
    status: 'building',
    currentNodeId: 'node-native-coding-build-1',
    branchName: 'devflow/native-coding-1',
    createdAt: '2026-08-12T21:00:00.000Z',
    updatedAt: '2026-08-12T21:00:00.000Z',
    nodes: [
      {
        id: 'node-native-coding-build-1',
        stage: 'build',
        title: 'Build the bounded repair',
        subtitle: 'Use only accepted Native Tools.',
        kind: 'task',
        status: 'running',
        ownerId: 'user-native-coding-1',
        retryCount: 0,
        artifactIds: [],
      },
    ],
    edges: [],
  }
}

describe('Native Coding Executor', () => {
  it('adapts an explicitly configured bounded model provider with metered usage', async () => {
    const completeStructuredJson = vi.fn(async (_input: {
      systemPrompt: string
      userPrompt: string
      maxOutputTokens: number
    }) => ({
      value: {
        stateVersion: 1,
        edit: { path: 'bounded.txt', content: 'Bounded model edit.\n' },
        summary: 'Apply one bounded model edit.',
      },
      usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 2 },
    }))
    const provider = createAgentProviderNativeCodingDecisionProvider({
      id: 'team-openai',
      name: 'Team OpenAI',
      model: 'gpt-native-coding',
      reviewKnowledge: vi.fn(),
      completeStructuredJson,
    })

    await expect(provider.decide({
      requestId: 'coding-model-request-1',
      objectiveDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      brief: 'Apply one bounded edit.',
      phase: 'edit',
      attempt: 2,
      testStatus: null,
      observation: {
        kind: 'repository_read',
        path: 'package.json',
        content: '{"name":"bounded"}\n',
        truncated: false,
      },
      maxOutputTokens: 1_024,
    })).resolves.toMatchObject({
      decision: { stateVersion: 1 },
      usage: { tokens: 32, costUsd: expect.any(Number) },
    })
    expect(provider).toMatchObject({ billing: 'metered', modelId: 'gpt-native-coding' })
    expect(completeStructuredJson).toHaveBeenCalledOnce()
    expect(JSON.parse(completeStructuredJson.mock.calls[0]![0].userPrompt)).toMatchObject({
      phase: 'edit',
      observation: {
        kind: 'repository_read',
        path: 'package.json',
        content: '{"name":"bounded"}\n',
      },
    })
  })

  it('rejects inexact provider cache usage before it can enter runtime budget accounting', async () => {
    const provider = createAgentProviderNativeCodingDecisionProvider({
      id: 'team-openai-invalid-usage',
      name: 'Team OpenAI invalid usage fixture',
      model: 'gpt-native-coding',
      reviewKnowledge: vi.fn(),
      completeStructuredJson: vi.fn(async () => ({
        value: {
          stateVersion: 1,
          edit: { path: 'bounded.txt', content: 'Bounded model edit.\n' },
          summary: 'Apply one bounded model edit.',
        },
        usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: -1 },
      })),
    })

    await expect(provider.decide({
      requestId: 'coding-model-request-invalid-usage',
      objectiveDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      brief: 'Apply one bounded edit.',
      phase: 'edit',
      attempt: 2,
      testStatus: null,
      observation: {
        kind: 'repository_read',
        path: 'package.json',
        content: '{"name":"bounded"}\n',
        truncated: false,
      },
      maxOutputTokens: 1_024,
    })).rejects.toThrow('Configured Native Coding Agent Provider did not return exact token usage')
  })

  it('persists one bounded read before returning a single edit permission with zero workspace writes', async () => {
    const sourcePath = await temporaryDirectory('devflow-native-coding-source')
    const worktreePath = await temporaryDirectory('devflow-native-coding-worktree')
    const storeDirectory = await temporaryDirectory('devflow-native-coding-store')
    await writeFile(
      path.join(sourcePath, 'package.json'),
      '{"name":"native-fixture","token":"ghp_1234567890abcdefghijklmnop","cwd":"/Users/example/private/repo"}\n',
      'utf8',
    )
    await writeFile(
      path.join(worktreePath, 'package.json'),
      '{"name":"native-fixture","scripts":{"test":"node -e \\\"process.exit(0)\\\""}}\n',
      'utf8',
    )
    await execFileAsync('git', ['-C', worktreePath, 'init', '-b', 'main'])
    await execFileAsync('git', ['-C', worktreePath, 'config', 'user.email', 'native@example.invalid'])
    await execFileAsync('git', ['-C', worktreePath, 'config', 'user.name', 'Native Coding Test'])
    await execFileAsync('git', ['-C', worktreePath, 'add', 'package.json'])
    await execFileAsync('git', ['-C', worktreePath, 'commit', '-m', 'baseline'])
    const store = await createLocalStore({ dbPath: path.join(storeDirectory, 'devflow.sqlite') })
    const project: LocalProject = {
      id: 'local-project-native-coding-1',
      name: 'native-coding-fixture',
      path: sourcePath,
      packageManager: 'npm',
      detectedTestCommand: 'npm test',
      testCommand: 'npm test',
      createdAt: '2026-08-12T21:00:00.000Z',
      updatedAt: '2026-08-12T21:00:00.000Z',
    }
    const run = buildRun()
    const workspace: ManagedCodingWorkspace = {
      id: 'workspace-native-coding-1',
      projectId: project.id,
      codingRunId: 'coding-run-native-1',
      sourcePath,
      worktreePath,
      branchName: 'devflow/native-coding-1',
      baseBranch: 'main',
      createdAt: '2026-08-12T21:00:00.000Z',
      cleanupStatus: 'active',
    }
    await store.upsertProject(project)
    await store.saveRun(run)
    await store.saveManagedCodingWorkspace(workspace)
    const decide = vi.fn(async (input: { phase: 'plan' | 'edit' | 'repair' }) =>
      input.phase === 'plan'
        ? {
            stateVersion: 1 as const,
            read: { path: 'package.json', maxBytes: 4_096 },
            summary: 'Read the bounded package manifest.',
          }
        : {
            stateVersion: 1 as const,
            edit: {
              path: 'devflow-native-change.txt',
              content: 'Approved Native Coding repair.\n',
            },
            summary: 'Add the bounded native repair marker from the observation.',
          },
    )
    const decisionProvider = {
      id: 'native-decision-fixture',
      version: 1,
      modelId: 'deterministic',
      billing: 'no_cost' as const,
      decide,
    }
    const clock = vi
      .fn()
      .mockReturnValueOnce('2026-08-12T21:00:01.000Z')
      .mockReturnValueOnce('2026-08-12T21:00:02.000Z')
      .mockReturnValueOnce('2026-08-12T21:00:03.000Z')
      .mockReturnValue('2026-08-12T21:00:04.000Z')
    const executor = createNativeCodingExecutor({
      store,
      decisionProvider,
      clock,
      createId: (prefix) => `${prefix}-native-1`,
    })
    const brief = {
      runId: run.id,
      nodeId: run.currentNodeId,
      projectId: project.id,
      testCommand: project.testCommand,
      branchName: workspace.branchName,
      worktreePath,
      userInstruction: 'Apply the approved repair.',
      prompt: 'Bounded native coding brief.',
    } satisfies CodingBrief

    const result = await executor.start({
      request: {
        stateVersion: 1,
        id: 'coding-run-native-1',
        executor: { id: executor.descriptor.id, version: executor.descriptor.version },
        scope: {
          organizationId: null,
          projectId: null,
          userId: 'user-native-coding-1',
          sessionId: 'coding-session-native-1',
          localProjectId: project.id,
          managedWorkspaceId: workspace.id,
        },
        authority: {
          runId: run.id,
          nodeId: run.currentNodeId,
          runVersion: run.version,
          policyVersion: 1,
        },
        objectiveDigest: sha256('Apply the approved repair.'),
        contextDigest: sha256('Bounded native coding brief.'),
        requiredCapabilities: [
          'cancellation',
          'checkpoint_continuation',
          'structured_diff',
          'workspace_edit',
          'workspace_read',
        ],
        budget: { maxTokens: 1_000, maxCostUsd: 1 },
        expectedCheckpointVersion: 0,
        requestedAt: '2026-08-12T21:00:01.000Z',
        deadline: '2026-08-12T21:10:01.000Z',
      },
      runtimeContext: {
        id: 'coding-run-native-1',
        run,
        node: run.nodes[0]!,
        project,
        workspace,
        requestedBy: 'user-native-coding-1',
        providerId: 'native-decision-fixture',
        userInstruction: 'Apply the approved repair.',
        now: '2026-08-12T21:00:01.000Z',
        upstreamArtifacts: [],
        knowledgeReferences: [],
        governanceChecks: [],
        gateDecisions: [],
        testEvidence: [],
        brief,
      },
    })

    expect(result).toMatchObject({
      kind: 'waiting_permission',
      codingRun: {
        id: 'coding-run-native-1',
        status: 'waiting_permission',
        managedWorkspaceId: workspace.id,
      },
      permissionRequest: {
        permission: 'edit',
        filePath: 'devflow-native-change.txt',
        status: 'pending',
      },
      turn: {
        requestId: 'coding-run-native-1',
        status: 'waiting_permission',
        permissionRequest: { capability: 'workspace_edit' },
      },
    })
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls[1]?.[0]).toMatchObject({
      phase: 'edit',
      observation: {
        path: 'package.json',
        content: expect.stringMatching(/\[REDACTED:/u),
        truncated: false,
      },
    })
    expect(JSON.stringify(decide.mock.calls[1]?.[0])).not.toContain(
      'ghp_1234567890abcdefghijklmnop',
    )
    expect(JSON.stringify(decide.mock.calls[1]?.[0])).not.toContain('/Users/example/private/repo')
    await expect(readFile(path.join(worktreePath, 'devflow-native-change.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const runtime = await store.getAgentRuntime('agent-runtime-coding-coding-run-native-1')
    expect(runtime).toMatchObject({
      status: 'waiting_permission',
      authority: {
        runId: run.id,
        nodeId: run.currentNodeId,
        runVersion: run.version,
        policyVersion: 1,
      },
      activeAction: {
        capabilityId: 'workspace.write_text',
        requiresPermission: true,
      },
      counters: { steps: 4, toolCalls: 2 },
    })
    expect(await store.listAgentRuntimeToolAudits(runtime!.id)).toEqual([
      expect.objectContaining({
        toolId: 'repo.read_text',
        resourceKind: 'local_project',
        status: 'started',
      }),
      expect.objectContaining({
        toolId: 'repo.read_text',
        resourceKind: 'local_project',
        status: 'succeeded',
      }),
    ])

    if (result.kind !== 'waiting_permission') throw new Error('Expected a permission boundary')
    clock.mockReturnValue('2026-08-12T21:00:05.000Z')
    await expect(executor.continuePermission({
      requestId: result.codingRun.id,
      previousCheckpointVersion: result.turn.checkpointVersion,
      previousSequence: result.turn.events.at(-1)!.sequence,
      settledPermissionRequestIds: [result.permissionRequest.id],
      runtimeContext: {
        request: { ...result.permissionRequest, status: 'approved' },
        codingRun: result.codingRun,
        workspace: { ...workspace, worktreePath: sourcePath },
        project,
        now: '2026-08-12T21:00:05.000Z',
      },
    })).rejects.toThrow('Native Coding permission continuation is stale')
    await expect(readFile(path.join(worktreePath, 'devflow-native-change.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const runSavedTest = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 4,
      stdout: '',
      stderr: '',
      summary: 'Saved test passed.',
      redacted: true,
    }))
    const continuation = {
      requestId: result.codingRun.id,
      previousCheckpointVersion: result.turn.checkpointVersion,
      previousSequence: result.turn.events.at(-1)!.sequence,
      settledPermissionRequestIds: [result.permissionRequest.id],
      runtimeContext: {
        request: { ...result.permissionRequest, status: 'approved' as const },
        codingRun: result.codingRun,
        workspace,
        project,
        now: '2026-08-12T21:00:05.000Z',
      },
    }
    const durableCommit = store.commitAgentRuntimeTransition.bind(store)
    let injectedCheckpointCrash = false
    const crashAfterEditStore = new Proxy(store, {
      get(target, property) {
        if (property === 'commitAgentRuntimeTransition') {
          return async (input: Parameters<typeof durableCommit>[0]) => {
            const committed = await durableCommit(input)
            if (
              !injectedCheckpointCrash &&
              committed.committed &&
              committed.runtime.status === 'checkpointed' &&
              committed.runtime.acceptedActionIds.includes(
                'agent-runtime-coding-coding-run-native-1-edit-1',
              )
            ) {
              injectedCheckpointCrash = true
              throw new Error('injected crash after durable edit checkpoint')
            }
            return committed
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const restartedExecutor = createNativeCodingExecutor({
      store: crashAfterEditStore,
      decisionProvider,
      clock,
      createId: (prefix) => `${prefix}-native-restarted-1`,
      runSavedTest,
    })
    await expect(restartedExecutor.continuePermission(continuation)).rejects.toThrow(
      'injected crash after durable edit checkpoint',
    )
    expect(runSavedTest).not.toHaveBeenCalled()

    let injectedTerminalCrash = false
    const crashAfterTerminalStore = new Proxy(store, {
      get(target, property) {
        if (property === 'commitAgentRuntimeTransition') {
          return async (input: Parameters<typeof durableCommit>[0]) => {
            const committed = await durableCommit(input)
            if (
              !injectedTerminalCrash &&
              committed.committed &&
              committed.runtime.status === 'terminal' &&
              committed.runtime.stopReason === 'success'
            ) {
              injectedTerminalCrash = true
              throw new Error('injected crash after durable test checkpoint')
            }
            return committed
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const editCheckpointRestart = createNativeCodingExecutor({
      store: crashAfterTerminalStore,
      decisionProvider,
      clock,
      createId: (prefix) => `${prefix}-native-edit-checkpoint-restart-1`,
      runSavedTest,
    })
    await expect(editCheckpointRestart.continuePermission(continuation)).rejects.toThrow(
      'injected crash after durable test checkpoint',
    )
    expect(runSavedTest).toHaveBeenCalledOnce()
    const terminalCheckpointRestart = createNativeCodingExecutor({
      store,
      decisionProvider,
      clock,
      createId: (prefix) => `${prefix}-native-terminal-checkpoint-restart-1`,
      runSavedTest,
    })
    const completed = await terminalCheckpointRestart.continuePermission(continuation)

    expect(completed).toMatchObject({
      kind: 'engine_completed',
      codingRun: {
        id: 'coding-run-native-1',
        status: 'completed',
        changedPaths: ['devflow-native-change.txt'],
      },
      diff: {
        id: 'coding-diff-coding-run-native-1',
        changedPaths: ['devflow-native-change.txt'],
        redacted: true,
        truncated: false,
      },
    })
    if (completed.kind !== 'engine_completed') throw new Error('Expected terminal completion')
    expect(completed.turn).toMatchObject({
      requestId: 'coding-run-native-1',
      status: 'terminal',
      terminalResult: {
        stopReason: 'success',
        changedPaths: ['devflow-native-change.txt'],
      },
    })
    expect(await readFile(path.join(worktreePath, 'devflow-native-change.txt'), 'utf8')).toBe(
      'Approved Native Coding repair.\n',
    )
    const durableAudits = (await store.listAgentRuntimeToolAudits(runtime!.id)).map((audit) => [
      audit.toolId,
      audit.resourceKind,
      audit.status,
    ])
    expect(durableAudits).toHaveLength(6)
    expect(durableAudits).toEqual(expect.arrayContaining([
      ['repo.read_text', 'local_project', 'started'],
      ['repo.read_text', 'local_project', 'succeeded'],
      ['workspace.write_text', 'managed_workspace', 'started'],
      ['workspace.write_text', 'managed_workspace', 'succeeded'],
      ['workspace.run_saved_test', 'managed_workspace', 'started'],
      ['workspace.run_saved_test', 'managed_workspace', 'succeeded'],
    ]))
    expect((await store.getAgentRuntime(runtime!.id))).toMatchObject({
      status: 'terminal',
      stopReason: 'success',
      counters: { steps: 5, toolCalls: 3 },
    })
    expect(runSavedTest).toHaveBeenCalledOnce()
    expect(decide).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain(sourcePath)
    expect(JSON.stringify(result)).not.toContain(worktreePath)
    expect(JSON.stringify(completed)).not.toContain(sourcePath)
    expect(JSON.stringify(completed)).not.toContain(worktreePath)
    store.close()
  })
})
