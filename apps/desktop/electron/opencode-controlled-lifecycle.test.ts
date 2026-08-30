import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, LocalProject, WorkflowRun } from '@ai-devflow/shared'
import { createCodingRuntime } from './coding-runtime.js'
import { resolveCodingRuntimeSelection } from './coding-runtime-configuration.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import { createLocalStore } from './local-store.js'
import {
  createDefaultOpencodePermissionRules,
  type Fetcher,
} from './opencode-http-adapter.js'
import { createOpencodeHttpCodingEngineAdapter } from './opencode-http-engine.js'
import { runLocalTestCommand } from './test-runner.js'
import { createWorkflowRuntime } from './workflow-runtime.js'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  )
  temporaryDirectories.length = 0
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  temporaryDirectories.push(directory)
  return directory
}

describe('controlled OpenCode lifecycle', () => {
  it('advances only after Execution Authorization, authoritative multi-file Git diff, canonical test, and Change Acceptance', async () => {
    const repositoryPath = await temporaryDirectory('devflow-controlled-opencode-repository')
    const worktreeRoot = await temporaryDirectory('devflow-controlled-opencode-worktrees')
    const storeDirectory = await temporaryDirectory('devflow-controlled-opencode-store')
    await mkdir(path.join(repositoryPath, 'src'))
    await writeFile(path.join(repositoryPath, '.gitignore'), 'node_modules\n', 'utf8')
    await writeFile(path.join(repositoryPath, 'src/message.ts'), 'export const message = "old"\n', 'utf8')
    await writeFile(path.join(repositoryPath, 'src/value.ts'), 'export const value = 1\n', 'utf8')
    await writeFile(
      path.join(repositoryPath, 'test.mjs'),
      [
        "import { readFile } from 'node:fs/promises'",
        "if ((await readFile('src/message.ts', 'utf8')) !== 'export const message = \\\"new\\\"\\n') process.exit(1)",
        "if ((await readFile('src/value.ts', 'utf8')) !== 'export const value = 2\\n') process.exit(1)",
        "console.log('controlled OpenCode canonical test passed')",
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(repositoryPath, 'package.json'),
      '{"name":"controlled-opencode-fixture","version":"1.0.0","scripts":{"test":"node test.mjs"}}\n',
      'utf8',
    )
    await writeFile(
      path.join(repositoryPath, 'package-lock.json'),
      '{"name":"controlled-opencode-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"controlled-opencode-fixture","version":"1.0.0"}}}\n',
      'utf8',
    )
    await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.email', 'opencode-e2e@example.invalid'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Controlled OpenCode E2E'])
    await execFileAsync('git', ['-C', repositoryPath, 'add', '.'])
    await execFileAsync('git', ['-C', repositoryPath, 'commit', '-m', 'baseline'])
    const sourceHead = (await execFileAsync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'])).stdout.trim()

    const project: LocalProject = {
      id: 'controlled-opencode-project',
      name: 'controlled-opencode-fixture',
      path: repositoryPath,
      packageManager: 'npm',
      detectedTestCommand: 'npm test',
      testCommand: 'npm test',
      createdAt: '2026-08-30T20:00:00.000Z',
      updatedAt: '2026-08-30T20:00:00.000Z',
    }
    const buildNodeId = 'controlled-opencode-build'
    const testNodeId = 'controlled-opencode-test'
    const run: WorkflowRun = {
      id: 'controlled-opencode-run',
      version: 1,
      title: 'Controlled OpenCode execution',
      request: 'Change both source modules and verify them with the saved test.',
      projectId: project.id,
      creatorId: 'u-local-owner',
      status: 'building',
      currentNodeId: buildNodeId,
      branchName: 'devflow/controlled-opencode',
      createdAt: '2026-08-30T20:00:00.000Z',
      updatedAt: '2026-08-30T20:00:00.000Z',
      nodes: [
        {
          id: buildNodeId,
          stage: 'build',
          title: 'Implement with OpenCode',
          subtitle: 'Modify both modules in the managed worktree.',
          kind: 'task',
          status: 'running',
          ownerId: 'u-local-owner',
          retryCount: 0,
          artifactIds: [],
        },
        {
          id: testNodeId,
          stage: 'test',
          title: 'Verify the accepted build',
          subtitle: 'Continue the canonical workflow after acceptance.',
          kind: 'test',
          status: 'pending',
          ownerId: 'u-local-owner',
          retryCount: 0,
          artifactIds: [],
        },
      ],
      edges: [{ id: 'controlled-opencode-build-to-test', source: buildNodeId, target: testNodeId, kind: 'normal' }],
    }

    const store = await createLocalStore({ dbPath: path.join(storeDirectory, 'devflow.sqlite') })
    try {
      await store.upsertProject(project)
      await store.saveRun(run)
      await store.saveCodingRuntimeConfiguration({
        projectId: project.id,
        executor: 'opencode-http',
        providerId: 'controlled-provider',
        modelId: 'controlled-model',
        binaryPath: '/controlled/bin/opencode',
        detectedVersion: '1.2.3',
        version: 1,
        updatedAt: '2026-08-30T20:00:00.000Z',
      })
      const selection = await resolveCodingRuntimeSelection({ store, projectId: project.id, env: {} })
      expect(selection).toMatchObject({
        source: 'project',
        executor: 'opencode-http',
        providerId: 'controlled-provider',
        configVersion: 1,
      })
      if (selection.source !== 'project' || selection.configuration.executor !== 'opencode-http') {
        throw new Error('Expected the saved project OpenCode selection')
      }

      const requests: string[] = []
      const processEnsure = vi.fn(async ({ projectId }: { projectId: string }) => ({
        baseUrl: 'http://127.0.0.1:4097',
        child: {} as never,
        projectId,
      }))
      const fetcher: Fetcher = vi.fn(async (input, init) => {
        const requestUrl = String(input)
        requests.push(requestUrl)
        const url = new URL(requestUrl)
        const directory = url.searchParams.get('directory')
        if (!directory) throw new Error('Controlled OpenCode request omitted the managed directory')

        if (url.pathname === '/session') {
          return new Response(JSON.stringify({
            id: 'controlled-session',
            directory,
            permission: createDefaultOpencodePermissionRules(),
          }), { status: 200 })
        }
        if (url.pathname === '/session/controlled-session/message' && init?.method === 'POST') {
          await writeFile(path.join(directory, 'src/message.ts'), 'export const message = "new"\n', 'utf8')
          await writeFile(path.join(directory, 'src/value.ts'), 'export const value = 2\n', 'utf8')
          return new Response(JSON.stringify({ info: {}, parts: [] }), { status: 200 })
        }
        if (url.pathname === '/session/controlled-session/message') {
          return new Response('[]', { status: 200 })
        }
        if (url.pathname === '/permission') {
          return new Response('[]', { status: 200 })
        }
        if (url.pathname === '/session/status') {
          return new Response(JSON.stringify({ 'controlled-session': { type: 'idle' } }), { status: 200 })
        }
        if (url.pathname === '/session/controlled-session/diff') {
          return new Response(JSON.stringify([{
            file: 'src/message.ts',
            patch: 'diff --git a/src/message.ts b/src/message.ts\n+untrusted OpenCode summary\n',
          }]), { status: 200 })
        }
        throw new Error(`Unexpected controlled OpenCode request: ${url.pathname}`)
      })
      const engine = createOpencodeHttpCodingEngineAdapter({
        binaryPath: selection.configuration.binaryPath,
        providerID: selection.configuration.providerId,
        modelID: selection.configuration.modelId,
        processManager: { ensure: processEnsure },
        fetcher,
        requireExecutionAuthorization: true,
        permissionPollMs: 1,
        permissionDiscoveryTimeoutMs: 500,
      })
      const workflowRuntime = createWorkflowRuntime(store)
      const completeWorkflowBuild = vi.fn(async (input: {
        runId: string
        nodeId: string
        codingRunId: string
        diffId: string
        now: string
      }) => {
        const existingEvents = await store.listEvents(input.runId)
        const event: AgentEvent = {
          id: `event-build-complete-${input.codingRunId}`,
          runId: input.runId,
          nodeId: input.nodeId,
          sequence: existingEvents.length + 1,
          kind: 'file_change',
          message: `Coding Agent run ${input.codingRunId} completed with diff ${input.diffId}.`,
          timestamp: input.now,
        }
        const result = await workflowRuntime.execute({
          runId: input.runId,
          command: {
            type: 'complete_build',
            nodeId: input.nodeId,
            codingRunId: input.codingRunId,
            diffId: input.diffId,
          },
          candidates: { events: [event] },
          now: input.now,
        })
        if (!result.applied) {
          throw new Error(result.blockers.map((blocker) => blocker.code).join(','))
        }
      })
      const clock = () => '2026-08-30T20:01:00.000Z'
      const runtime = createCodingRuntime({
        store,
        engine,
        completeWorkflowBuild,
        worktreeRoot,
        now: clock,
        runTestCommand: runLocalTestCommand,
        runDependencyBootstrap: ({
          codingRun,
          project: bootstrapProject,
          workspace,
          previousDependencyHash,
          approvedNonFrozenInstall,
          timestamp,
        }) => runDependencyBootstrap({
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          projectId: bootstrapProject.id,
          worktreePath: workspace.worktreePath,
          ...(previousDependencyHash ? { previousDependencyHash } : {}),
          ...(approvedNonFrozenInstall ? { approvedNonFrozenInstall } : {}),
          runCommand: runLocalTestCommand,
          timeoutMs: 20_000,
          now: timestamp,
        }),
        budgetGuard: async () => ({
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0,
          limitUsd: 0,
          reason: 'Controlled OpenCode billing is opaque; no paid Provider is contacted.',
        }),
      })

      const waitingForExecution = await runtime.runCodingAgent({
        runId: run.id,
        nodeId: buildNodeId,
        projectId: project.id,
        requestedBy: run.creatorId,
        providerId: selection.providerId,
        userInstruction: 'Change both modules exactly as requested.',
      })
      const executionAuthorization = (await store.listCodingPermissionRequests(waitingForExecution.codingRun.id))
        .find((request) => request.status === 'pending')
      expect(executionAuthorization).toMatchObject({
        origin: 'execution_authorization',
        permission: 'write',
        status: 'pending',
      })
      expect(processEnsure).not.toHaveBeenCalled()
      expect(requests).toEqual([])

      await runtime.replyCodingPermission({
        requestId: executionAuthorization!.id,
        codingRunId: waitingForExecution.codingRun.id,
        decidedBy: run.creatorId,
        decision: 'approved',
        comment: 'Authorize only the disposable managed worktree execution.',
      })

      const [workspace] = await store.listManagedCodingWorkspaces(project.id)
      await expect(readFile(path.join(workspace!.worktreePath, 'src/message.ts'), 'utf8'))
        .resolves.toBe('export const message = "new"\n')
      await expect(readFile(path.join(workspace!.worktreePath, 'src/value.ts'), 'utf8'))
        .resolves.toBe('export const value = 2\n')
      await expect(readFile(path.join(repositoryPath, 'src/message.ts'), 'utf8'))
        .resolves.toBe('export const message = "old"\n')
      await expect(readFile(path.join(repositoryPath, 'src/value.ts'), 'utf8'))
        .resolves.toBe('export const value = 1\n')
      expect((await execFileAsync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'])).stdout.trim())
        .toBe(sourceHead)
      expect((await execFileAsync('git', ['-C', repositoryPath, 'status', '--porcelain=v1'])).stdout)
        .toBe('')
      const [diff] = await store.listCodingDiffArtifacts(run.id)
      expect(diff).toMatchObject({
        changedPaths: ['src/message.ts', 'src/value.ts'],
        truncated: false,
      })
      expect(diff!.patch).toContain('diff --git a/src/message.ts b/src/message.ts')
      expect(diff!.patch).toContain('diff --git a/src/value.ts b/src/value.ts')
      expect(diff!.patch).not.toContain('untrusted OpenCode summary')
      const [evidence] = await store.listTestEvidence(run.id)
      expect(evidence).toMatchObject({ command: 'npm test', cwd: '<workspace>', status: 'passed' })
      const events = await store.listCodingAgentEvents(waitingForExecution.codingRun.id)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'diff',
          metadata: expect.objectContaining({
            diffSource: 'managed_worktree_git',
            opencodeDiffStatus: 'mismatch',
          }),
        }),
      ]))
      const changeAcceptance = (await store.listCodingPermissionRequests(waitingForExecution.codingRun.id))
        .find((request) => request.status === 'pending' && request.origin === 'change_acceptance')
      expect(changeAcceptance).toMatchObject({
        permission: 'patch',
        diffArtifactId: diff!.id,
        testEvidenceId: evidence!.id,
        managedWorkspaceId: workspace!.id,
      })
      expect(completeWorkflowBuild).not.toHaveBeenCalled()

      await writeFile(
        path.join(workspace!.worktreePath, 'src/value.ts'),
        'export const value = 99\n',
        'utf8',
      )
      await expect(runtime.replyCodingPermission({
        requestId: changeAcceptance!.id,
        codingRunId: waitingForExecution.codingRun.id,
        decidedBy: run.creatorId,
        decision: 'approved',
        comment: 'A stale approval must not advance the Workflow.',
      })).rejects.toThrow('authority is stale or incomplete')
      expect(completeWorkflowBuild).not.toHaveBeenCalled()
      expect((await store.listCodingPermissionRequests(waitingForExecution.codingRun.id))
        .find((request) => request.id === changeAcceptance!.id)?.status).toBe('pending')
      await writeFile(
        path.join(workspace!.worktreePath, 'src/value.ts'),
        'export const value = 2\n',
        'utf8',
      )

      await runtime.replyCodingPermission({
        requestId: changeAcceptance!.id,
        codingRunId: waitingForExecution.codingRun.id,
        decidedBy: run.creatorId,
        decision: 'approved',
        comment: 'Accept the exact authoritative Git diff and passed canonical test.',
      })

      expect((await store.listCodingAgentRuns(run.id))[0]).toMatchObject({
        status: 'completed',
        changedPaths: ['src/message.ts', 'src/value.ts'],
      })
      expect(completeWorkflowBuild).toHaveBeenCalledOnce()
      expect(await store.getRun(run.id)).toMatchObject({
        status: 'testing',
        currentNodeId: testNodeId,
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: buildNodeId, status: 'success' }),
          expect.objectContaining({ id: testNodeId, status: 'running' }),
        ]),
      })
      await expect(readFile(path.join(repositoryPath, 'src/message.ts'), 'utf8'))
        .resolves.toBe('export const message = "old"\n')
      await expect(readFile(path.join(repositoryPath, 'src/value.ts'), 'utf8'))
        .resolves.toBe('export const value = 1\n')
      expect((await execFileAsync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'])).stdout.trim())
        .toBe(sourceHead)
      expect((await execFileAsync('git', ['-C', repositoryPath, 'status', '--porcelain=v1'])).stdout)
        .toBe('')
    } finally {
      store.close()
    }
  }, 30_000)
})
