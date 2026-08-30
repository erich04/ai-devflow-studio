import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_DIFF_CHARS, MAX_REMOTE_CHANGED_PATHS } from '@ai-devflow/shared'
import {
  assertOpenCodeGitBoundary,
  captureOpenCodeGitBoundary,
  validateAuthoritativeOpenCodeDiff,
} from './opencode-result-validation.js'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function worktree(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-opencode-result-'))
  roots.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'app.ts'), 'export const ok = true\n')
  return root
}

describe('OpenCode authoritative result validation', () => {
  it('proves the original checkout and managed worktree HEAD stay at their authorized state', async () => {
    const fixture = await gitWorktree()
    const snapshot = await captureOpenCodeGitBoundary(fixture)

    await writeFile(path.join(fixture.worktreePath, 'allowed.txt'), 'managed change\n')

    await expect(assertOpenCodeGitBoundary({
      sourcePath: fixture.sourcePath,
      worktreePath: fixture.worktreePath,
      snapshot,
    })).resolves.toBeUndefined()
  })

  it('rejects original-checkout writes and unauthorized managed-worktree commits', async () => {
    const sourceMutation = await gitWorktree()
    const sourceSnapshot = await captureOpenCodeGitBoundary(sourceMutation)
    await writeFile(path.join(sourceMutation.sourcePath, 'source.txt'), 'changed outside worktree\n')
    await expect(assertOpenCodeGitBoundary({
      sourcePath: sourceMutation.sourcePath,
      worktreePath: sourceMutation.worktreePath,
      snapshot: sourceSnapshot,
    })).rejects.toThrow('original project checkout')

    const committedMutation = await gitWorktree()
    const committedSnapshot = await captureOpenCodeGitBoundary(committedMutation)
    await writeFile(path.join(committedMutation.worktreePath, 'committed.txt'), 'not authorized\n')
    await git(committedMutation.worktreePath, ['add', 'committed.txt'])
    await git(committedMutation.worktreePath, ['commit', '-m', 'unauthorized'])
    await expect(assertOpenCodeGitBoundary({
      sourcePath: committedMutation.sourcePath,
      worktreePath: committedMutation.worktreePath,
      snapshot: committedSnapshot,
    })).rejects.toThrow('commits are not authorized')
  })

  it('accepts and canonicalizes a bounded text diff inside the managed worktree', async () => {
    const root = await worktree()
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: {
        changedPaths: ['src/z.ts', 'src/app.ts'],
        patch: 'diff --git a/src/app.ts b/src/app.ts\n+export const ok = true\n',
      },
    })).resolves.toEqual({
      changedPaths: ['src/app.ts', 'src/z.ts'],
      patch: 'diff --git a/src/app.ts b/src/app.ts\n+export const ok = true\n',
    })
  })

  it.each([
    '../outside.ts',
    '/tmp/outside.ts',
    'src/../outside.ts',
    'src\\outside.ts',
  ])('rejects repository escape path %s', async (changedPath) => {
    const root = await worktree()
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: { changedPaths: [changedPath], patch: '' },
    })).rejects.toThrow('unsafe repository path')
  })

  it('rejects symlinks, binary patches, secrets, oversized output and too many files', async () => {
    const root = await worktree()
    await symlink('/tmp', path.join(root, 'src', 'outside'))
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: { changedPaths: ['src/outside/file.ts'], patch: '' },
    })).rejects.toThrow('cannot include symlinks')
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: { changedPaths: ['src/app.ts'], patch: 'GIT binary patch\nliteral 0\n' },
    })).rejects.toThrow('unsupported binary diff')
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: { changedPaths: ['src/app.ts'], patch: '+OPENAI_API_KEY=sk-sensitive-value\n' },
    })).rejects.toThrow('contains sensitive content')
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: { changedPaths: ['src/app.ts'], patch: 'x'.repeat(MAX_DIFF_CHARS + 1) },
    })).rejects.toThrow('size limit')
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: {
        changedPaths: Array.from({ length: MAX_REMOTE_CHANGED_PATHS + 1 }, (_, index) => `src/${index}.ts`),
        patch: '',
      },
    })).rejects.toThrow('too many files')
  })

  it('rejects an OpenCode patch whose headers disagree with Git changed paths', async () => {
    const root = await worktree()
    await expect(validateAuthoritativeOpenCodeDiff({
      worktreePath: root,
      diff: {
        changedPaths: ['src/app.ts'],
        patch: 'diff --git a/src/other.ts b/src/other.ts\n+unsafe\n',
      },
    })).rejects.toThrow('header does not match')
  })
})

async function gitWorktree(): Promise<{
  sourcePath: string
  worktreePath: string
  baseCommitSha: string
  branchName: string
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-opencode-git-boundary-'))
  roots.push(root)
  const sourcePath = path.join(root, 'source')
  const worktreePath = path.join(root, 'managed')
  await mkdir(sourcePath)
  await git(sourcePath, ['init', '-b', 'main'])
  await git(sourcePath, ['config', 'user.email', 'devflow@example.invalid'])
  await git(sourcePath, ['config', 'user.name', 'DevFlow Test'])
  await writeFile(path.join(sourcePath, 'source.txt'), 'initial\n')
  await git(sourcePath, ['add', 'source.txt'])
  await git(sourcePath, ['commit', '-m', 'initial'])
  const baseCommitSha = await git(sourcePath, ['rev-parse', 'HEAD'])
  const branchName = 'devflow/git-boundary'
  await git(sourcePath, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'])
  return { sourcePath, worktreePath, baseCommitSha, branchName }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return stdout.trim()
}
