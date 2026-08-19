import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runDependencyBootstrap } from './dependency-bootstrap-runner'

describe('dependency bootstrap runner', () => {
  it('runs frozen install when node_modules is missing and a lockfile exists', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'devflow-bootstrap-'))
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x' }))
    await writeFile(path.join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
    const runCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 10,
      stdout: 'installed',
      stderr: '',
      redacted: false,
      summary: 'Install passed.',
    }))

    const evidence = await runDependencyBootstrap({
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'n-build',
      projectId: 'project-1',
      worktreePath: repo,
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:00:00.000Z',
    })

    expect(runCommand).toHaveBeenCalledWith({ command: 'npm ci', cwd: repo, timeoutMs: 120_000 })
    expect(evidence.status).toBe('passed')
    expect(evidence.command).toBe('npm ci')
  })

  it('does not run non-frozen install without explicit approval', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'devflow-bootstrap-'))
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x' }))
    const runCommand = vi.fn()

    const evidence = await runDependencyBootstrap({
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'n-build',
      projectId: 'project-1',
      worktreePath: repo,
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:00:00.000Z',
    })

    expect(runCommand).not.toHaveBeenCalled()
    expect(evidence.status).toBe('needs_approval')
  })

  it('runs the exact approved non-frozen install once', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'devflow-bootstrap-'))
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x' }))
    const runCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 15,
      stdout: 'installed',
      stderr: '',
      redacted: true,
      summary: 'Install passed.',
    }))

    const pending = await runDependencyBootstrap({
      codingRunId: 'coding-run-approved',
      runId: 'run-1',
      nodeId: 'n-build',
      projectId: 'project-1',
      worktreePath: repo,
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:00:00.000Z',
    })
    const evidence = await runDependencyBootstrap({
      codingRunId: 'coding-run-approved',
      runId: 'run-1',
      nodeId: 'n-build',
      projectId: 'project-1',
      worktreePath: repo,
      approvedNonFrozenInstall: {
        command: pending.command,
        dependencyHash: pending.dependencyHash,
      },
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:01:00.000Z',
    })

    expect(runCommand).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledWith({ command: 'npm install', cwd: repo, timeoutMs: 120_000 })
    expect(evidence.status).toBe('passed')
  })

  it('fails closed when dependency inputs no longer match the approval', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'devflow-bootstrap-'))
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'x' }))
    const runCommand = vi.fn()

    const evidence = await runDependencyBootstrap({
      codingRunId: 'coding-run-stale-approval',
      runId: 'run-1',
      nodeId: 'n-build',
      projectId: 'project-1',
      worktreePath: repo,
      approvedNonFrozenInstall: {
        command: 'npm install',
        dependencyHash: 'stale-dependency-hash',
      },
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:01:00.000Z',
    })

    expect(runCommand).not.toHaveBeenCalled()
    expect(evidence).toMatchObject({
      status: 'failed',
      summary: 'Dependency inputs changed after approval; a new bootstrap approval is required.',
    })
  })
})
