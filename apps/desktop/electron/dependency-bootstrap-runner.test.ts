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
      previousDependencyHash: undefined,
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
      previousDependencyHash: undefined,
      runCommand,
      timeoutMs: 120_000,
      now: '2026-06-17T00:00:00.000Z',
    })

    expect(runCommand).not.toHaveBeenCalled()
    expect(evidence.status).toBe('needs_approval')
  })
})
