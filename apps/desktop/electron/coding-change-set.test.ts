import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyCodingChangeSetAtomically,
  prepareCodingChangeSet,
  verifyCodingChangeSetDigest,
} from './coding-change-set.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  )
  temporaryDirectories.length = 0
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-change-set-'))
  temporaryDirectories.push(root)
  const worktreePath = path.join(root, 'worktree')
  await mkdir(worktreePath)
  await writeFile(path.join(worktreePath, 'alpha.ts'), 'export const alpha = "old"\n', 'utf8')
  await writeFile(path.join(worktreePath, 'beta.ts'), 'export const beta = 1\n', 'utf8')
  return { root, worktreePath }
}

describe('Coding Change Set v2', () => {
  it('binds a normalized multi-file proposal to exact digests and applies it atomically', async () => {
    const { worktreePath } = await fixture()
    await chmod(path.join(worktreePath, 'alpha.ts'), 0o744)
    const changeSet = await prepareCodingChangeSet({
      id: 'change-set-1',
      codingRunId: 'coding-run-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      worktreePath,
      phase: 'initial',
      configVersion: 1,
      providerId: 'deepseek',
      createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [
        { path: 'beta.ts', replacements: [{ oldText: 'beta = 1', newText: 'beta = 2' }] },
        { path: 'alpha.ts', replacements: [{ oldText: 'alpha = "old"', newText: 'alpha = "new"' }] },
      ],
    })

    expect(changeSet.changes.map((change) => change.path)).toEqual(['alpha.ts', 'beta.ts'])
    expect(changeSet.changeSetDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(changeSet.unifiedDiff).toContain('diff --git a/alpha.ts b/alpha.ts')
    expect(changeSet.unifiedDiff).toContain('diff --git a/beta.ts b/beta.ts')
    expect(() => verifyCodingChangeSetDigest(changeSet)).not.toThrow()

    await applyCodingChangeSetAtomically({
      changeSet,
      worktreePath,
      now: '2026-08-29T08:01:00.000Z',
    })
    await expect(readFile(path.join(worktreePath, 'alpha.ts'), 'utf8')).resolves.toContain('"new"')
    await expect(readFile(path.join(worktreePath, 'beta.ts'), 'utf8')).resolves.toContain('= 2')
    expect((await stat(path.join(worktreePath, 'alpha.ts'))).mode & 0o777).toBe(0o744)
  })

  it('rolls back every file when a persisted applying transaction is recovered', async () => {
    const { root, worktreePath } = await fixture()
    const changeSet = await prepareCodingChangeSet({
      id: 'change-set-recovery',
      codingRunId: 'coding-run-recovery',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      worktreePath,
      phase: 'initial',
      configVersion: 1,
      providerId: 'deepseek',
      createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [
        { path: 'alpha.ts', replacements: [{ oldText: '"old"', newText: '"new"' }] },
        { path: 'beta.ts', replacements: [{ oldText: '= 1', newText: '= 2' }] },
      ],
    })
    await applyCodingChangeSetAtomically({
      changeSet,
      worktreePath,
      now: '2026-08-29T08:01:00.000Z',
    })

    const transactionRoot = path.join(root, '.devflow-coding-transactions')
    const [transactionName] = await readdir(transactionRoot)
    const manifestPath = path.join(transactionRoot, transactionName!, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, JSON.stringify({ ...manifest, status: 'applying' }), 'utf8')

    await expect(applyCodingChangeSetAtomically({
      changeSet,
      worktreePath,
      now: '2026-08-29T08:02:00.000Z',
    })).rejects.toThrow('rolled back safely')
    await expect(readFile(path.join(worktreePath, 'alpha.ts'), 'utf8')).resolves.toBe('export const alpha = "old"\n')
    await expect(readFile(path.join(worktreePath, 'beta.ts'), 'utf8')).resolves.toBe('export const beta = 1\n')
  })

  it('rejects symlinks, repeated anchors, digest drift, and tampered canonical state', async () => {
    const { worktreePath } = await fixture()
    await writeFile(path.join(worktreePath, 'duplicate.txt'), 'same same\n', 'utf8')
    await symlink(path.join(worktreePath, 'alpha.ts'), path.join(worktreePath, 'linked.ts'))
    const outside = path.join(path.dirname(worktreePath), 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'escaped.ts'), 'export const escaped = "old"\n', 'utf8')
    await symlink(outside, path.join(worktreePath, 'linked-directory'))

    await expect(prepareCodingChangeSet({
      id: 'change-set-duplicate', codingRunId: 'coding-run-1', projectId: 'project-1',
      workspaceId: 'workspace-1', worktreePath, phase: 'initial', configVersion: 1,
      providerId: 'deepseek', createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [{ path: 'duplicate.txt', replacements: [{ oldText: 'same', newText: 'other' }] }],
    })).rejects.toThrow('exactly once')
    await expect(prepareCodingChangeSet({
      id: 'change-set-link', codingRunId: 'coding-run-1', projectId: 'project-1',
      workspaceId: 'workspace-1', worktreePath, phase: 'initial', configVersion: 1,
      providerId: 'deepseek', createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [{ path: 'linked.ts', replacements: [{ oldText: 'old', newText: 'new' }] }],
    })).rejects.toThrow('does not follow symlinks')
    await expect(prepareCodingChangeSet({
      id: 'change-set-parent-link', codingRunId: 'coding-run-1', projectId: 'project-1',
      workspaceId: 'workspace-1', worktreePath, phase: 'initial', configVersion: 1,
      providerId: 'deepseek', createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [{
        path: 'linked-directory/escaped.ts',
        replacements: [{ oldText: 'old', newText: 'new' }],
      }],
    })).rejects.toThrow('does not follow symlinks')

    const changeSet = await prepareCodingChangeSet({
      id: 'change-set-drift', codingRunId: 'coding-run-1', projectId: 'project-1',
      workspaceId: 'workspace-1', worktreePath, phase: 'initial', configVersion: 1,
      providerId: 'deepseek', createdAt: '2026-08-29T08:00:00.000Z',
      expiresAt: '2026-08-29T08:15:00.000Z',
      proposal: [{ path: 'alpha.ts', replacements: [{ oldText: 'old', newText: 'new' }] }],
    })
    expect(() => verifyCodingChangeSetDigest({ ...changeSet, providerId: 'forged' })).toThrow('digest')
    await writeFile(path.join(worktreePath, 'alpha.ts'), 'export const alpha = "drift"\n', 'utf8')
    await expect(applyCodingChangeSetAtomically({
      changeSet, worktreePath, now: '2026-08-29T08:01:00.000Z',
    })).rejects.toThrow('digest drifted')
  })
})
