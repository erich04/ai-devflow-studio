import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalProject, WorkflowRun } from '@ai-devflow/shared'
import { createCodingRuntime } from './coding-runtime.js'
import { createLocalStore } from './local-store.js'
import { createNativeCodingExecutor } from './native-coding-executor.js'

const execFileAsync = promisify(execFile)
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirectories.length = 0
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  tempDirectories.push(directory)
  return directory
}

describe('Native Coding Runtime integration', () => {
  it.each([
    {
      name: 'completes one approved repair',
      repairContent: 'Native runtime repair.\n',
      expectedStatus: 'completed' as const,
    },
    {
      name: 'stops after one exhausted repair',
      repairContent: 'Still incomplete after repair.\n',
      expectedStatus: 'failed' as const,
    },
  ])('$name without an unbounded test loop', async ({ repairContent, expectedStatus }) => {
    const repositoryPath = await temporaryDirectory('devflow-native-runtime-repository')
    const worktreeRoot = await temporaryDirectory('devflow-native-runtime-worktrees')
    const storeDirectory = await temporaryDirectory('devflow-native-runtime-store')
    await writeFile(
      path.join(repositoryPath, 'package.json'),
      '{"name":"native-runtime","scripts":{"test":"node test.mjs"}}\n',
      'utf8',
    )
    await writeFile(
      path.join(repositoryPath, 'test.mjs'),
      "import { readFile } from 'node:fs/promises'\nif ((await readFile('devflow-native-change.txt', 'utf8')) !== 'Native runtime repair.\\n') process.exit(1)\n",
      'utf8',
    )
    await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.email', 'native@example.invalid'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Native Runtime Test'])
    await execFileAsync('git', ['-C', repositoryPath, 'add', '.'])
    await execFileAsync('git', ['-C', repositoryPath, 'commit', '-m', 'baseline'])

    const project: LocalProject = {
      id: 'native-runtime-project-1',
      name: 'native-runtime',
      path: repositoryPath,
      packageManager: 'npm',
      detectedTestCommand: 'npm test',
      testCommand: 'npm test',
      createdAt: '2026-08-12T22:00:00.000Z',
      updatedAt: '2026-08-12T22:00:00.000Z',
    }
    const run: WorkflowRun = {
      id: 'native-runtime-run-1',
      version: 1,
      title: 'Native Coding integration',
      request: 'Apply one bounded native repair.',
      projectId: project.id,
      creatorId: 'native-runtime-user-1',
      status: 'building',
      currentNodeId: 'native-runtime-build-1',
      branchName: 'devflow/native-runtime',
      createdAt: '2026-08-12T22:00:00.000Z',
      updatedAt: '2026-08-12T22:00:00.000Z',
      nodes: [{
        id: 'native-runtime-build-1',
        stage: 'build',
        title: 'Apply the repair',
        subtitle: 'Use the narrow Native Coding Executor.',
        kind: 'task',
        status: 'running',
        ownerId: 'native-runtime-user-1',
        retryCount: 0,
        artifactIds: [],
      }],
      edges: [],
    }
    const store = await createLocalStore({ dbPath: path.join(storeDirectory, 'devflow.sqlite') })
    await store.upsertProject(project)
    await store.saveRun(run)
    const clock = () => '2026-08-12T22:00:01.000Z'
    const decisionProvider = {
      id: 'native-runtime-decision-1',
      version: 1,
      modelId: 'deterministic',
      billing: 'no_cost' as const,
      async decide(input: { phase: 'plan' | 'edit' | 'repair' }) {
        if (input.phase === 'plan') {
          return {
            stateVersion: 1 as const,
            read: { path: 'package.json', maxBytes: 4_096 },
            summary: 'Read the bounded integration package manifest.',
          }
        }
        return {
          stateVersion: 1 as const,
          edit: {
            path: 'devflow-native-change.txt',
            content: input.phase === 'edit' ? 'Incomplete native edit.\n' : repairContent,
          },
          summary:
            input.phase === 'edit'
              ? 'Apply the initial observation-bound integration edit.'
              : 'Repair the failed saved test with one bounded edit.',
        }
      },
    }
    const executor = createNativeCodingExecutor({
      store,
      decisionProvider,
      clock,
    })
    const runtime = createCodingRuntime({
      store,
      executor,
      worktreeRoot,
      now: clock,
    })

    const started = await runtime.runCodingAgent({
      runId: run.id,
      nodeId: run.currentNodeId,
      projectId: project.id,
      requestedBy: run.creatorId,
      providerId: executor.providerId,
      userInstruction: 'Apply the bounded integration repair.',
    })
    expect(started.codingRun.status).toBe('waiting_permission')
    const [permission] = await store.listCodingPermissionRequests(started.codingRun.id)
    expect(permission).toMatchObject({ permission: 'edit', status: 'pending' })

    const approvedPermission = { ...permission!, status: 'approved' as const }
    const claimed = await store.commitCodingAgentMutation({
      expectedRun: started.codingRun,
      expectedPendingPermissionRequestIds: [permission!.id],
      expectedPermissionRequests: [permission!],
      permissionRequests: [approvedPermission],
      permissionDecisions: [{
        id: 'native-runtime-permission-decision-1',
        requestId: permission!.id,
        codingRunId: started.codingRun.id,
        decidedBy: run.creatorId,
        decision: 'approved',
        comment: 'Approved once before the injected Desktop restart.',
        decidedAt: clock(),
      }],
    })
    expect(claimed.committed).toBe(true)

    const restartedExecutor = createNativeCodingExecutor({ store, decisionProvider, clock })
    const restartedRuntime = createCodingRuntime({
      store,
      executor: restartedExecutor,
      worktreeRoot,
      now: clock,
    })
    await restartedRuntime.recoverCodingAgentRuns()

    const [repairPermission] = (await store.listCodingPermissionRequests(started.codingRun.id))
      .filter((candidate) => candidate.status === 'pending')
    expect(repairPermission).toMatchObject({ permission: 'edit', status: 'pending' })
    const [waitingForRepair] = await store.listCodingAgentRuns(run.id)
    if (!waitingForRepair) throw new Error('Expected a durable repair permission boundary')

    const pendingRepairRestart = createCodingRuntime({
      store,
      executor: createNativeCodingExecutor({ store, decisionProvider, clock }),
      worktreeRoot,
      now: clock,
    })
    await pendingRepairRestart.recoverCodingAgentRuns()
    expect((await store.listCodingAgentRuns(run.id))[0]).toMatchObject({
      status: 'waiting_permission',
      summary: 'The saved test failed; waiting for approval of one bounded repair edit.',
    })
    expect((await store.listCodingPermissionRequests(started.codingRun.id)).find(
      (candidate) => candidate.id === repairPermission!.id,
    )).toMatchObject({ status: 'pending' })

    const repairClaimed = await store.commitCodingAgentMutation({
      expectedRun: waitingForRepair,
      expectedPendingPermissionRequestIds: [repairPermission!.id],
      expectedPermissionRequests: [repairPermission!],
      permissionRequests: [{ ...repairPermission!, status: 'approved' }],
      permissionDecisions: [{
        id: 'native-runtime-permission-decision-2',
        requestId: repairPermission!.id,
        codingRunId: started.codingRun.id,
        decidedBy: run.creatorId,
        decision: 'approved',
        comment: 'Approve the one bounded repair edit before another Desktop restart.',
        decidedAt: clock(),
      }],
    })
    expect(repairClaimed.committed).toBe(true)

    const approvedRepairRestart = createCodingRuntime({
      store,
      executor: createNativeCodingExecutor({ store, decisionProvider, clock }),
      worktreeRoot,
      now: clock,
    })
    await approvedRepairRestart.recoverCodingAgentRuns()

    const [completed] = await store.listCodingAgentRuns(run.id)
    const [workspace] = await store.listManagedCodingWorkspaces(project.id)
    if (!completed) throw new Error('Expected a durable Coding Agent run')
    expect(completed.status).toBe(expectedStatus)
    if (expectedStatus === 'completed') {
      expect(completed).toMatchObject({
        changedPaths: ['devflow-native-change.txt'],
        testEvidenceId: `coding-test-${started.codingRun.id}`,
      })
      expect(await readFile(path.join(workspace!.worktreePath, 'devflow-native-change.txt'), 'utf8')).toBe(
        'Native runtime repair.\n',
      )
      expect(await store.listTestEvidence(run.id)).toEqual([
        expect.objectContaining({
          id: `coding-test-${started.codingRun.id}`,
          command: 'npm test',
          cwd: '<workspace>',
          status: 'passed',
        }),
      ])
    } else {
      expect(await store.listTestEvidence(run.id)).toEqual([])
      expect(await store.getAgentRuntime(`agent-runtime-coding-${started.codingRun.id}`)).toMatchObject({
        status: 'terminal',
        stopReason: 'failure',
        counters: { steps: 8, toolCalls: 5 },
      })
    }
    const toolIds = (await store.listAgentRuntimeToolAudits()).map((audit) => audit.toolId)
    expect(toolIds).toHaveLength(10)
    expect(toolIds).toEqual(expect.arrayContaining([
      'repo.read_text', 'repo.read_text',
      'workspace.write_text', 'workspace.write_text', 'workspace.write_text', 'workspace.write_text',
      'workspace.run_saved_test', 'workspace.run_saved_test',
      'workspace.run_saved_test', 'workspace.run_saved_test',
    ]))
    store.close()
  })
})
