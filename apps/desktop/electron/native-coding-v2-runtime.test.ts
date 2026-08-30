import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalProject, WorkflowRun } from '@ai-devflow/shared'
import { createCodingRuntime } from './coding-runtime.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import { createLocalStore } from './local-store.js'
import {
  createNativeCodingExecutorV2,
  type NativeCodingV2DecisionProvider,
} from './native-coding-executor-v2.js'
import { runLocalTestCommand } from './test-runner.js'

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

describe('Native Coding Executor v2 runtime', () => {
  it('proposes, approves, applies, tests, and archives an exact multi-file-safe Change Set', async () => {
    const repositoryPath = await temporaryDirectory('devflow-native-v2-repository')
    const worktreeRoot = await temporaryDirectory('devflow-native-v2-worktrees')
    const storeDirectory = await temporaryDirectory('devflow-native-v2-store')
    await mkdir(path.join(repositoryPath, 'src'))
    await writeFile(path.join(repositoryPath, '.gitignore'), 'node_modules\n', 'utf8')
    await writeFile(path.join(repositoryPath, 'src/message.ts'), 'export const message = "old"\n', 'utf8')
    await writeFile(
      path.join(repositoryPath, 'test.mjs'),
      "import { readFile } from 'node:fs/promises'\nif ((await readFile('src/message.ts', 'utf8')) !== 'export const message = \\\"new\\\"\\n') process.exit(1)\n",
      'utf8',
    )
    await writeFile(
      path.join(repositoryPath, 'package.json'),
      '{"name":"native-v2-fixture","version":"1.0.0","scripts":{"test":"node test.mjs"}}\n',
      'utf8',
    )
    await writeFile(
      path.join(repositoryPath, 'package-lock.json'),
      '{"name":"native-v2-fixture","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"native-v2-fixture","version":"1.0.0"}}}\n',
      'utf8',
    )
    await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.email', 'native-v2@example.invalid'])
    await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Native v2 Test'])
    await execFileAsync('git', ['-C', repositoryPath, 'add', '.'])
    await execFileAsync('git', ['-C', repositoryPath, 'commit', '-m', 'baseline'])

    const project: LocalProject = {
      id: 'native-v2-project',
      name: 'native-v2-fixture',
      path: repositoryPath,
      packageManager: 'npm',
      detectedTestCommand: 'npm test',
      testCommand: 'npm test',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
    }
    const run: WorkflowRun = {
      id: 'native-v2-run', version: 1, title: 'Native v2 execution',
      request: 'Change the message from old to new.', projectId: project.id,
      creatorId: 'u-local-owner', status: 'building', currentNodeId: 'native-v2-build',
      branchName: 'devflow/native-v2', createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
      nodes: [{
        id: 'native-v2-build', stage: 'build', title: 'Implement locally',
        subtitle: 'Apply the exact approved Change Set.', kind: 'task', status: 'running',
        ownerId: 'u-local-owner', retryCount: 0, artifactIds: [],
      }],
      edges: [],
    }
    const provider: NativeCodingV2DecisionProvider = {
      id: 'deepseek', version: 2, modelId: 'deepseek-v4-flash', billing: 'metered',
      async complete(input) {
        return input.phase === 'analysis'
          ? {
              value: {
                stateVersion: 2,
                files: ['src/message.ts'],
                searches: [],
                summary: 'Inspect the message module.',
              },
              usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, costUsd: 0.000009 },
            }
          : {
              value: {
                stateVersion: 2,
                changes: [{
                  path: 'src/message.ts',
                  replacements: [{ oldText: 'message = "old"', newText: 'message = "new"' }],
                }],
                summary: 'Replace only the requested message.',
              },
              usage: { inputTokens: 30, outputTokens: 15, cacheReadTokens: 0, costUsd: 0.000014 },
            }
      },
    }
    const store = await createLocalStore({ dbPath: path.join(storeDirectory, 'devflow.sqlite') })
    await store.upsertProject(project)
    await store.saveRun(run)
    const clock = () => '2026-08-29T09:01:00.000Z'
    const executor = createNativeCodingExecutorV2({
      store,
      decisionProvider: provider,
      configVersion: 1,
      clock,
      runSavedTest: runLocalTestCommand,
    })
    const runtime = createCodingRuntime({
      store,
      executor,
      worktreeRoot,
      now: clock,
      runTestCommand: runLocalTestCommand,
      budgetGuard: async () => ({
        status: 'allowed', blocksRun: false, currentSpendUsd: 0,
        projectedCostUsd: 0.01, limitUsd: 0.20, reason: 'Within the saved project budget.',
      }),
      runDependencyBootstrap: ({
        codingRun, project: bootstrapProject, workspace, previousDependencyHash,
        approvedNonFrozenInstall, timestamp,
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
    })

    const waiting = await runtime.runCodingAgent({
      runId: run.id,
      nodeId: run.currentNodeId,
      projectId: project.id,
      requestedBy: run.creatorId,
      userInstruction: 'Change the message from old to new.',
    })
    expect(waiting.codingRun).toMatchObject({
      status: 'waiting_permission', engine: 'native', providerId: 'deepseek',
      configVersion: 1, runtimeCostSummary: { source: 'provider_reported' },
    })
    const [changeSet] = await store.listCodingChangeSets(waiting.codingRun.id)
    expect(changeSet).toMatchObject({ phase: 'initial', providerId: 'deepseek', executorVersion: 2 })
    const permission = (await store.listCodingPermissionRequests(waiting.codingRun.id)).find(
      (candidate) => candidate.status === 'pending' && candidate.origin === 'coding_executor',
    )!
    expect(permission).toMatchObject({
      changeSetId: changeSet!.id,
      changeSetDigest: changeSet!.changeSetDigest,
    })
    expect(permission).not.toHaveProperty('diffPreview')
    expect(permission).not.toHaveProperty('filePath')
    expect(changeSet!.unifiedDiff).toContain('diff --git a/src/message.ts b/src/message.ts')

    await runtime.replyCodingPermission({
      requestId: permission.id,
      codingRunId: permission.codingRunId,
      decidedBy: run.creatorId,
      decision: 'approved',
      comment: 'Approve the exact persisted Change Set once.',
    })

    const [completed] = await store.listCodingAgentRuns(run.id)
    expect(completed).toMatchObject({
      status: 'completed', changedPaths: ['src/message.ts'],
      runtimeCostSummary: {
        source: 'provider_reported', inputTokens: 50, outputTokens: 25, costUsd: 0.000023,
      },
    })
    const [workspace] = await store.listManagedCodingWorkspaces(project.id)
    await expect(readFile(path.join(workspace!.worktreePath, 'src/message.ts'), 'utf8'))
      .resolves.toBe('export const message = "new"\n')
    await expect(readFile(path.join(repositoryPath, 'src/message.ts'), 'utf8'))
      .resolves.toBe('export const message = "old"\n')
    const [evidence] = await store.listTestEvidence(run.id)
    expect(evidence).toMatchObject({ status: 'passed', cwd: '<workspace>', redacted: true })
    const [diff] = await store.listCodingDiffArtifacts(run.id)
    expect(diff).toMatchObject({ changedPaths: ['src/message.ts'], truncated: false })
    store.close()
  }, 20_000)
})
