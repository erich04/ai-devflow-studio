import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodingAgentRun, LocalProject } from '@ai-devflow/shared'
import {
  createFakeCodingRunBundle,
  createManagedCodingWorkspace,
  captureWorktreeDiff,
  completeFakeCodingRun,
  deleteManagedCodingWorkspace,
  findActiveCodingRun,
  isGitRepository,
} from './coding-runner'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('coding worktree manager', () => {
  it('rejects non-git repositories before creating a managed worktree', async () => {
    const repo = await tempDir('devflow-non-git-')
    expect(await isGitRepository(repo)).toBe(false)

    await expect(
      createManagedCodingWorkspace({
        project: project(repo),
        codingRunId: 'coding-run-1',
        runId: 'run-1',
        nodeId: 'node-build',
        worktreeRoot: await tempDir('devflow-worktrees-'),
      }),
    ).rejects.toThrow(/not a git repository/)
  })

  it('creates an isolated git worktree and branch for a coding run', async () => {
    const repo = await gitRepo()
    const worktreeRoot = await tempDir('devflow-worktrees-')

    const workspace = await createManagedCodingWorkspace({
      project: project(repo),
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      worktreeRoot,
    })

    expect(workspace.sourcePath).toBe(repo)
    expect(workspace.worktreePath.startsWith(worktreeRoot)).toBe(true)
    expect(workspace.branchName).toContain('devflow/run-1-node-build')
    expect(await readFile(path.join(workspace.worktreePath, 'package.json'), 'utf8')).toContain('fixture')

    const { stdout } = await execFileAsync('git', ['-C', workspace.worktreePath, 'branch', '--show-current'])
    expect(stdout.trim()).toBe(workspace.branchName)
  })

  it('marks a managed worktree as deleted after removing it', async () => {
    const repo = await gitRepo()
    const worktreeRoot = await tempDir('devflow-worktrees-')
    const workspace = await createManagedCodingWorkspace({
      project: project(repo),
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      worktreeRoot,
    })

    const deleted = await deleteManagedCodingWorkspace(workspace)

    expect(deleted).toMatchObject({
      id: workspace.id,
      cleanupStatus: 'deleted',
    })
    await expect(readFile(path.join(workspace.worktreePath, 'package.json'), 'utf8')).rejects.toThrow()
  })
})

describe('fake coding harness helpers', () => {
  it('detects an active coding run for a project', () => {
    const active: CodingAgentRun = {
      id: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'waiting_permission',
      managedWorkspaceId: 'workspace-1',
      branchName: 'devflow/run-1-node-build',
      userInstruction: 'Do it.',
      prompt: 'local prompt',
      summary: 'Waiting for permission.',
      changedPaths: [],
      startedAt: '2026-06-17T00:00:00.000Z',
      redacted: true,
    }

    expect(findActiveCodingRun([active], 'project-1')).toEqual(active)
    expect(findActiveCodingRun([{ ...active, status: 'completed' }], 'project-1')).toBeUndefined()
  })

  it('creates a pending fake coding run bundle with a permission request and assembled prompt', async () => {
    const repo = await gitRepo()
    const workspace = await createManagedCodingWorkspace({
      project: project(repo),
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      worktreeRoot: await tempDir('devflow-worktrees-'),
    })

    const bundle = createFakeCodingRunBundle({
      id: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      project: project(repo),
      requestedBy: 'user-1',
      userInstruction: 'Add the fake marker file.',
      workspace,
      now: '2026-06-17T00:00:00.000Z',
    })

    expect(bundle.codingRun.status).toBe('waiting_permission')
    expect(bundle.codingRun.prompt).toContain('Add the fake marker file.')
    expect(bundle.permissionRequest.status).toBe('pending')
    expect(bundle.permissionRequest.permission).toBe('edit')
    expect(bundle.events.map((event) => event.kind)).toEqual(['brief', 'permission'])
  })

  it('completes an approved fake coding run with a worktree diff and bootstrap evidence', async () => {
    const repo = await gitRepo()
    const workspace = await createManagedCodingWorkspace({
      project: project(repo),
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      worktreeRoot: await tempDir('devflow-worktrees-'),
    })
    const bundle = createFakeCodingRunBundle({
      id: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      project: project(repo),
      requestedBy: 'user-1',
      userInstruction: 'Add the fake marker file.',
      workspace,
      now: '2026-06-17T00:00:00.000Z',
    })

    const completed = await completeFakeCodingRun({
      codingRun: bundle.codingRun,
      workspace,
      project: project(repo),
      now: '2026-06-17T00:01:00.000Z',
    })

    expect(completed.codingRun.status).toBe('completed')
    expect(completed.codingRun.changedPaths).toEqual(['devflow-fake-change.txt'])
    expect(completed.diff.changedPaths).toEqual(['devflow-fake-change.txt'])
    expect(completed.diff.patch).toContain('DevFlow fake coding adapter')
    expect(completed.bootstrapEvidence.status).toBe('skipped')
    expect(await readFile(path.join(workspace.worktreePath, 'devflow-fake-change.txt'), 'utf8')).toContain(
      'Add the fake marker file.',
    )
  })
})

describe('worktree diff capture', () => {
  it('captures untracked files from the managed worktree as reviewable diffs', async () => {
    const repo = await gitRepo()
    const workspace = await createManagedCodingWorkspace({
      project: project(repo),
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      worktreeRoot: await tempDir('devflow-worktrees-'),
    })
    await writeFile(path.join(workspace.worktreePath, 'probe-marker.txt'), 'ok\n')

    const diff = await captureWorktreeDiff({ worktreePath: workspace.worktreePath })

    expect(diff.changedPaths).toEqual(['probe-marker.txt'])
    expect(diff.patch).toContain('diff --git a/probe-marker.txt b/probe-marker.txt')
    expect(diff.patch).toContain('+ok')
  })
})

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function gitRepo() {
  const repo = await tempDir('devflow-git-')
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
