import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkflowRunFromRequest,
  type CodingAgentRun,
  type LocalProject,
  type ManagedCodingWorkspace,
} from '@ai-devflow/shared'
import { createManagedCodingWorkspace } from './coding-runner'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator'
import { runWorkflowTestCommand, type WorkflowTestCommandResult } from './workflow-test-command'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const now = '2026-09-07T07:00:00.000Z'

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function git(cwd: string, ...args: string[]) {
  return (await execFileAsync('git', args, { cwd })).stdout.trim()
}

async function fixture(managed = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-workflow-test-'))
  tempDirs.push(root)
  const project: LocalProject = {
    id: 'project-test', name: 'Test fixture', path: root, packageManager: 'npm',
    detectedTestCommand: 'node verify.cjs', testCommand: 'node verify.cjs',
    createdAt: now, updatedAt: now,
  }
  await writeFile(path.join(root, 'verify.cjs'), [
    "const fs = require('node:fs')",
    "fs.writeFileSync('executed.txt', 'executed')",
    "require('node:assert/strict').equal(fs.readFileSync('value.txt', 'utf8'), 'implemented')",
  ].join('\n'))
  await writeFile(path.join(root, 'value.txt'), managed ? 'original' : 'implemented')
  const { run } = createWorkflowRunFromRequest({
    runId: 'run-test', title: 'Test implementation', request: 'Change value',
    projectId: project.id, creatorId: 'member', branchName: 'ai/run-test', now,
  })
  run.status = 'testing'
  run.currentNodeId = 'run-test-test'
  const build = run.nodes.find((node) => node.stage === 'build')!
  build.status = 'success'
  run.nodes.find((node) => node.id === run.currentNodeId)!.status = 'running'
  const codingRuns: CodingAgentRun[] = []
  const workspaces: ManagedCodingWorkspace[] = []
  if (managed) {
    await git(root, 'init', '-b', 'main')
    await git(root, 'config', 'user.email', 'fixture@example.test')
    await git(root, 'config', 'user.name', 'Fixture')
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'baseline')
    const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-test-worktrees-'))
    tempDirs.push(worktreeRoot)
    const workspace = await createManagedCodingWorkspace({
      project, runId: run.id, nodeId: build.id, codingRunId: 'coding-current', worktreeRoot,
    })
    workspaces.push(workspace)
    await writeFile(path.join(workspace.worktreePath, 'value.txt'), 'implemented')
    codingRuns.push({
      id: workspace.codingRunId, runId: run.id, nodeId: build.id, projectId: project.id,
      requestedBy: 'member', providerId: 'provider', engine: 'native', status: 'completed',
      managedWorkspaceId: workspace.id, branchName: workspace.branchName,
      userInstruction: 'Change value', prompt: '', summary: 'Changed value',
      changedPaths: ['value.txt'], startedAt: now, completedAt: now, redacted: true,
    })
  }
  const input = {
    project, run, nodeId: run.currentNodeId, timeoutMs: 5_000,
    complete: async (execution: WorkflowTestCommandResult) => execution,
    workspaceCoordinator: createWorkspaceOperationCoordinator(),
    store: {
      getRun: async () => run,
      listCodingAgentRuns: async () => codingRuns,
      listManagedCodingWorkspaces: async () => workspaces,
    },
  }
  return { input, codingRuns, workspaces }
}

describe('runWorkflowTestCommand', () => {
  it('tests the completed Coding implementation, preserving the source checkout', async () => {
    const { input, workspaces } = await fixture()
    const result = await runWorkflowTestCommand(input)

    expect(result.result.status).toBe('passed')
    expect(result.cwd).toBe(workspaces[0]!.worktreePath)
    expect(await readFile(path.join(input.project.path, 'value.txt'), 'utf8')).toBe('original')
    await expect(readFile(path.join(input.project.path, 'executed.txt'))).rejects.toThrow()
  })

  it('keeps pure local, non-Git Test execution compatible', async () => {
    const { input } = await fixture(false)
    const result = await runWorkflowTestCommand(input)
    expect(result.result.status).toBe('passed')
    expect(result.cwd).toBe(input.project.path)
  })

  it.each(['failed', 'running'] as const)('rejects a newer %s Coding attempt instead of selecting old success', async (status) => {
    const { input, codingRuns } = await fixture()
    codingRuns.push({ ...codingRuns[0]!, id: 'coding-newer', startedAt: '2026-09-07T08:00:00.000Z', status })
    await expect(runWorkflowTestCommand(input)).rejects.toThrow(/Latest Build Coding run/)
    await expect(readFile(path.join(input.project.path, 'executed.txt'))).rejects.toThrow()
  })

  it.each([
    'foreign project', 'foreign run', 'missing workspace', 'deleted workspace',
    'wrong workspace owner', 'wrong source', 'wrong branch', 'wrong base', 'ambiguous attempt',
  ])('rejects %s before executing any test command', async (fault) => {
    const { input, codingRuns, workspaces } = await fixture()
    const workspace = workspaces[0]!
    const codingRun = codingRuns[0]!
    const worktreePath = workspace.worktreePath
    if (fault === 'foreign project') codingRun.projectId = 'other'
    if (fault === 'foreign run') codingRun.runId = 'other'
    if (fault === 'missing workspace') workspaces.length = 0
    if (fault === 'deleted workspace') workspace.cleanupStatus = 'deleted'
    if (fault === 'wrong workspace owner') workspace.codingRunId = 'other'
    if (fault === 'wrong source') workspace.sourcePath = path.join(input.project.path, 'other')
    if (fault === 'wrong branch') await git(worktreePath, 'checkout', '-b', 'unexpected')
    if (fault === 'wrong base') workspace.baseCommitSha = '0'.repeat(40)
    if (fault === 'ambiguous attempt') codingRuns.push({ ...codingRun, id: 'same-time' })

    await expect(runWorkflowTestCommand(input)).rejects.toThrow()
    await expect(readFile(path.join(worktreePath, 'executed.txt'))).rejects.toThrow()
    await expect(readFile(path.join(input.project.path, 'executed.txt'))).rejects.toThrow()
  })

  it('rejects a different repository even if branch and HEAD match', async () => {
    const { input, workspaces } = await fixture()
    const { input: other } = await fixture(false)
    await git(other.project.path, 'clone', '--no-local', input.project.path, 'unrelated')
    const foreignPath = path.join(other.project.path, 'unrelated')
    await git(foreignPath, 'checkout', '-b', workspaces[0]!.branchName)
    workspaces[0]!.worktreePath = foreignPath
    await expect(runWorkflowTestCommand(input)).rejects.toThrow(/repository, branch, or HEAD changed/)
    await expect(readFile(path.join(foreignPath, 'executed.txt'))).rejects.toThrow()
  })

  it('rejects a subdirectory of the managed workspace', async () => {
    const { input, workspaces } = await fixture()
    workspaces[0]!.worktreePath = path.join(workspaces[0]!.worktreePath, 'nested')
    await mkdir(workspaces[0]!.worktreePath)
    await expect(runWorkflowTestCommand(input)).rejects.toThrow(/repository, branch, or HEAD changed/)
  })

  it('allows retrying the failed Test while the original checkout moves forward', async () => {
    const { input } = await fixture()
    input.run.status = 'failed'
    input.run.nodes.find((node) => node.id === input.nodeId)!.status = 'failed'
    await git(input.project.path, 'checkout', '-b', 'unrelated-local-work')
    await git(input.project.path, 'commit', '--allow-empty', '-m', 'advance source')
    expect((await runWorkflowTestCommand(input)).result.status).toBe('passed')
  })

  it('rejects an unrecorded commit and accepts the recorded managed HEAD', async () => {
    const { input, workspaces } = await fixture()
    const workspace = workspaces[0]!
    await git(workspace.worktreePath, 'add', 'value.txt')
    await git(workspace.worktreePath, 'commit', '-m', 'implementation')
    await expect(runWorkflowTestCommand(input)).rejects.toThrow(/HEAD changed/)
    await expect(readFile(path.join(workspace.worktreePath, 'executed.txt'))).rejects.toThrow()
    workspace.headCommitSha = await git(workspace.worktreePath, 'rev-parse', 'HEAD')
    expect((await runWorkflowTestCommand(input)).result.status).toBe('passed')
  })

  it('does not execute or publish Test evidence for a stale workflow', async () => {
    const { input } = await fixture()
    input.store.getRun = async () => ({ ...input.run, version: input.run.version + 1 })
    const complete = vi.spyOn(input, 'complete')
    await expect(runWorkflowTestCommand(input)).rejects.toThrow(/Workflow changed/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('rechecks the workspace after waiting for cleanup and never falls back to the source', async () => {
    const { input, workspaces } = await fixture()
    let release!: () => void
    const cleanup = input.workspaceCoordinator.runExclusive(workspaces[0]!.id, async () => {
      await new Promise<void>((resolve) => { release = resolve })
      workspaces[0]!.cleanupStatus = 'deleted'
    })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const resolveWorkspace = vi.spyOn(input.store, 'listManagedCodingWorkspaces')
    const execution = runWorkflowTestCommand(input)
    const rejected = expect(execution).rejects.toThrow(/workspace is missing or inconsistent/)
    await vi.waitFor(() => expect(resolveWorkspace).toHaveBeenCalled())
    release()
    await Promise.all([cleanup, rejected])
    await expect(readFile(path.join(input.project.path, 'executed.txt'))).rejects.toThrow()
  })

  it('holds the workspace lease until formal Test evidence is committed', async () => {
    const { input, workspaces } = await fixture()
    let release!: () => void
    input.complete = async (execution) => {
      await new Promise<void>((resolve) => { release = resolve })
      return execution
    }
    const execution = runWorkflowTestCommand(input)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const cleanup = vi.fn(async () => undefined)
    const queued = input.workspaceCoordinator.runExclusive(workspaces[0]!.id, cleanup)
    expect(cleanup).not.toHaveBeenCalled()
    release()
    expect((await execution).result.status).toBe('passed')
    await queued
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
