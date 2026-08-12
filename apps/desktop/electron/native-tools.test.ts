import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentRuntime,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
  type AgentRuntimeState,
  type LocalProject,
  type ManagedCodingWorkspace,
  type NativeToolDefinition,
} from '@ai-devflow/shared'
import {
  createNativeToolRegistry,
  digestNativeToolValue,
  type NativeToolRegistration,
} from './native-tool-registry.js'
import { createAcceptedNativeToolRegistrations } from './native-tools.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${label}-`))
  temporaryDirectories.push(directory)
  return directory
}

function runtimeWaitingFor(
  definition: NativeToolDefinition,
  toolInput: unknown,
  requiresPermission = true,
): AgentRuntimeState {
  const created = createAgentRuntime({
    stateVersion: 1,
    id: `runtime-${definition.id.replaceAll('.', '-')}`,
    scope: {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'local-user-1',
      sessionId: 'local-session-1',
      localProjectId: 'local-project-1',
    },
    authority: { runId: 'run-1', nodeId: 'node-1', runVersion: 1, policyVersion: 1 },
    contextDigest: 'a'.repeat(64),
    capabilitySetDigest: 'b'.repeat(64),
    bounds: {
      maxSteps: 8,
      maxWallTimeMs: 60_000,
      maxToolCalls: 8,
      maxToolResultBytes: 256 * 1_024,
      maxTrajectoryMetadataBytes: 16 * 1_024,
      maxCheckpointBytes: 128 * 1_024,
      maxTokens: 1_000,
      maxCostUsd: 1,
    },
    requestedAt: '2026-08-12T20:30:00.000Z',
    deadline: '2026-08-12T20:31:00.000Z',
  })
  const running = resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.checkpoint.version,
    authority: created.runtime.authority,
    contextDigest: created.runtime.contextDigest,
    capabilitySetDigest: created.runtime.capabilitySetDigest,
    now: '2026-08-12T20:30:01.000Z',
  })
  const requested = requestAgentAction({
    runtime: running.runtime,
    expectedCheckpointVersion: running.checkpoint.version,
    action: {
      id: 'action-1',
      kind: 'tool',
      capabilityId: definition.id,
      capabilityVersion: definition.version,
      requestDigest: digestNativeToolValue(toolInput),
      requiresPermission,
    },
    now: '2026-08-12T20:30:02.000Z',
  })
  if (!requiresPermission) return requested.runtime
  return recordAgentPermissionDecision({
    runtime: requested.runtime,
    expectedCheckpointVersion: requested.checkpoint.version,
    actionId: 'action-1',
    requestDigest: digestNativeToolValue(toolInput),
    decision: 'approved_once',
    now: '2026-08-12T20:30:02.000Z',
  }).runtime
}

async function invoke(
  registrations: NativeToolRegistration[],
  toolId: string,
  toolInput: unknown,
  resourceScope:
    | { kind: 'local_project'; localProjectId: string }
    | { kind: 'managed_workspace'; localProjectId: string; workspaceId: string },
) {
  const definition = registrations.find((item) => item.definition.id === toolId)?.definition
  if (!definition) throw new Error(`Missing test Tool ${toolId}`)
  const runtime = runtimeWaitingFor(definition, toolInput)
  const registry = createNativeToolRegistry({
    tools: registrations,
    clock: () => '2026-08-12T20:30:03.000Z',
  })
  const grant = registry.issueGrant({
    runtime,
    toolId,
    toolVersion: definition.version,
    permission: {
      decision: 'approved',
      permissionClass: definition.permissionClass,
      decidedAt: '2026-08-12T20:30:02.000Z',
      expiresAt: '2026-08-12T20:30:30.000Z',
    },
    resourceScope,
    callLimit: 1,
  })
  return registry.execute({ grant, runtime, actionId: 'action-1', input: toolInput })
}

describe('accepted native Tools', () => {
  it('lists and reads only bounded repo-relative regular files', async () => {
    const root = await temporaryDirectory('devflow-native-read')
    const outside = await temporaryDirectory('devflow-native-outside')
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')
    await writeFile(path.join(outside, 'secret.txt'), 'outside-secret', 'utf8')
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'src', 'escape.txt'))
    const project: LocalProject = {
      id: 'local-project-1',
      name: 'fixture',
      path: root,
      packageManager: 'npm',
      testCommand: 'npm test',
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }
    const registrations = createAcceptedNativeToolRegistrations({
      resolveLocalProject: async () => project,
      resolveManagedWorkspace: async () => null,
    })

    await expect(
      invoke(registrations, 'repo.list_entries', { directory: 'src', maxEntries: 10 }, {
        kind: 'local_project',
        localProjectId: project.id,
      }),
    ).resolves.toMatchObject({
      value: {
        directory: 'src',
        entries: [{ path: 'src/index.ts', kind: 'file' }],
        truncated: false,
      },
    })
    await expect(
      invoke(registrations, 'repo.read_text', { path: 'src/index.ts', maxBytes: 64 }, {
        kind: 'local_project',
        localProjectId: project.id,
      }),
    ).resolves.toMatchObject({
      value: { path: 'src/index.ts', content: 'export const value = 1\n', truncated: false },
    })
    await expect(
      invoke(registrations, 'repo.read_text', { path: 'src/escape.txt', maxBytes: 64 }, {
        kind: 'local_project',
        localProjectId: project.id,
      }),
    ).rejects.toMatchObject({ code: 'handler_failed' })
    await expect(
      invoke(registrations, 'repo.read_text', { path: '../secret.txt', maxBytes: 64 }, {
        kind: 'local_project',
        localProjectId: project.id,
      }),
    ).rejects.toMatchObject({ code: 'handler_failed' })
  })

  it('writes bounded content only into the exact active managed workspace', async () => {
    const sourceRoot = await temporaryDirectory('devflow-native-source')
    const workspaceRoot = await temporaryDirectory('devflow-native-workspace')
    await mkdir(path.join(workspaceRoot, 'src'))
    const project: LocalProject = {
      id: 'local-project-1',
      name: 'fixture',
      path: sourceRoot,
      packageManager: 'npm',
      testCommand: 'npm test',
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }
    const workspace: ManagedCodingWorkspace = {
      id: 'workspace-1',
      projectId: project.id,
      codingRunId: 'coding-run-1',
      sourcePath: sourceRoot,
      worktreePath: workspaceRoot,
      branchName: 'devflow/run-1',
      baseBranch: 'main',
      createdAt: '2026-08-12T20:00:00.000Z',
      cleanupStatus: 'active',
    }
    const registrations = createAcceptedNativeToolRegistrations({
      resolveLocalProject: async () => project,
      resolveManagedWorkspace: async (id) => (id === workspace.id ? workspace : null),
    })

    await expect(
      invoke(
        registrations,
        'workspace.write_text',
        { path: 'src/generated.ts', content: 'export const generated = true\n' },
        {
          kind: 'managed_workspace',
          localProjectId: project.id,
          workspaceId: workspace.id,
        },
      ),
    ).resolves.toMatchObject({
      value: {
        path: 'src/generated.ts',
        bytes: 30,
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    })
    await expect(readFile(path.join(workspaceRoot, 'src', 'generated.ts'), 'utf8')).resolves.toBe(
      'export const generated = true\n',
    )

    await expect(
      invoke(
        registrations,
        'workspace.write_text',
        { path: 'src/other.ts', content: 'unsafe' },
        {
          kind: 'managed_workspace',
          localProjectId: project.id,
          workspaceId: 'workspace-forged',
        },
      ),
    ).rejects.toMatchObject({ code: 'handler_failed' })
  })

  it('executes only the saved recognized test command and returns bounded evidence metadata', async () => {
    const root = await temporaryDirectory('devflow-native-test')
    const runner = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 12,
      stdout: 'secret output must not enter the Tool result',
      stderr: '',
      redacted: true,
      summary: 'Tests passed in 12ms',
    }))
    const project: LocalProject = {
      id: 'local-project-1',
      name: 'fixture',
      path: root,
      packageManager: 'npm',
      testCommand: '  npm   test  ',
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }
    const registrations = createAcceptedNativeToolRegistrations({
      resolveLocalProject: async () => project,
      resolveManagedWorkspace: async () => null,
      runSavedTest: runner,
    })

    const result = await invoke(registrations, 'project.run_saved_test', {}, {
      kind: 'local_project',
      localProjectId: project.id,
    })
    expect(result.value).toEqual({
      status: 'passed',
      exitCode: 0,
      durationMs: 12,
      summary: 'Tests passed in 12ms',
      redacted: true,
    })
    expect(runner).toHaveBeenCalledWith({
      command: 'npm test',
      cwd: root,
      timeoutMs: 120_000,
      signal: expect.any(AbortSignal),
    })
    expect(JSON.stringify(result)).not.toContain('secret output')

    project.testCommand = 'node dangerous.js'
    await expect(
      invoke(registrations, 'project.run_saved_test', {}, {
        kind: 'local_project',
        localProjectId: project.id,
      }),
    ).rejects.toMatchObject({ code: 'handler_failed' })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('evaluates a bounded scenario deterministically without filesystem or process authority', async () => {
    const project: LocalProject = {
      id: 'local-project-1',
      name: 'fixture',
      path: '/not-used-by-evaluator',
      packageManager: 'npm',
      testCommand: 'npm test',
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }
    const registrations = createAcceptedNativeToolRegistrations({
      resolveLocalProject: async () => project,
      resolveManagedWorkspace: async () => null,
    })
    const scenario = {
      stateVersion: 1,
      id: 'native-tool-scenario',
      version: 1,
      name: 'Native Tool scenario',
      objective: 'Evaluate one deterministic successful observation.',
      executorKind: 'none',
      expected: {
        stopReason: 'success',
        maxSteps: 2,
        requiredEventTypes: ['runtime_started', 'runtime_stopped'],
        evidenceKinds: ['native_tool_audit'],
        cleanupStatus: 'completed',
      },
      metricDimensions: [
        'quality',
        'cost',
        'latency',
        'human_intervention',
        'recovery',
        'isolation',
      ],
    }
    const observed = {
      stopReason: 'success',
      steps: 1,
      eventTypes: ['runtime_started', 'runtime_stopped'],
      evidenceKinds: ['native_tool_audit'],
      cleanupStatus: 'completed',
      metrics: {
        qualityPassed: true,
        costUsd: 0,
        latencyMs: 10,
        humanInterventions: 0,
        recoverySucceeded: true,
        isolationViolations: 0,
      },
    }

    await expect(
      invoke(
        registrations,
        'scenario.evaluate',
        { scenarioJson: JSON.stringify(scenario), observationJson: JSON.stringify(observed) },
        { kind: 'local_project', localProjectId: project.id },
      ),
    ).resolves.toMatchObject({ value: { passed: true, failures: [] } })
  })
})
