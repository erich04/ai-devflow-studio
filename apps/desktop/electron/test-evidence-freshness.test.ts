import { describe, expect, it, vi } from 'vitest'
import type { ManagedCodingWorkspace, TestEvidence } from '@ai-devflow/shared'
import { evaluateTestEvidenceFreshness } from './test-evidence-freshness.js'

const evidence = (id: string, sourceTree?: TestEvidence['sourceTree'], projectId = 'project'): TestEvidence => ({
  id, runId: 'run', nodeId: 'test', projectId, command: 'npm test', cwd: '<workspace>', status: 'passed',
  exitCode: 0, durationMs: 10, stdout: '', stderr: '', summary: 'Tests passed', redacted: true,
  ...(sourceTree ? { sourceTree } : {}), createdAt: '2026-09-30T00:00:00.000Z',
})
const workspace = (overrides: Partial<ManagedCodingWorkspace> = {}): ManagedCodingWorkspace => ({
  id: 'workspace', projectId: 'project', codingRunId: 'coding', sourcePath: '/repo', worktreePath: '/worktree',
  branchName: 'devflow/branch', baseBranch: 'main', createdAt: '2026-09-30T00:00:00.000Z', cleanupStatus: 'active',
  ...overrides,
})

describe('test evidence freshness (hardening H3)', () => {
  it('compares each recorded tree with its own directory and computes each directory once', async () => {
    const digest = vi.fn(async (cwd: string) => ({ tracked: 't', full: cwd === '/worktree' ? 'tree-now' : 'repo-now' }))
    const result = await evaluateTestEvidenceFreshness({
      projectId: 'project', projectPath: '/repo', workspaces: [workspace()], digest,
      evidence: [
        evidence('current-in-worktree', { digest: 'tree-now', workspaceId: 'workspace' }),
        evidence('stale-in-worktree', { digest: 'tree-before', workspaceId: 'workspace' }),
        evidence('current-in-checkout', { digest: 'repo-now' }),
        evidence('no-fingerprint'),
      ],
    })
    expect(result).toEqual([
      { evidenceId: 'current-in-worktree', state: 'current' },
      { evidenceId: 'stale-in-worktree', state: 'stale' },
      { evidenceId: 'current-in-checkout', state: 'current' },
      { evidenceId: 'no-fingerprint', state: 'unrecorded' },
    ])
    expect(digest.mock.calls.map(([cwd]) => cwd).sort()).toEqual(['/repo', '/worktree'])
  })

  it('never calls a result current when its workspace is gone or the tree cannot be read', async () => {
    const digest = vi.fn(async () => null)
    const result = await evaluateTestEvidenceFreshness({
      projectId: 'project', projectPath: '/repo', digest,
      workspaces: [workspace({ id: 'cleaned', cleanupStatus: 'deleted', deletedAt: '2026-09-30T01:00:00.000Z' })],
      evidence: [
        evidence('missing-workspace', { digest: 'x', workspaceId: 'unknown' }),
        evidence('cleaned-workspace', { digest: 'x', workspaceId: 'cleaned' }),
        evidence('unreadable', { digest: 'x' }),
        evidence('other-project', { digest: 'x' }, 'other'),
      ],
    })
    expect(result.map((item) => item.state)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unrecorded'])
    expect(digest).toHaveBeenCalledTimes(1)
  })
})
