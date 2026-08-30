import { lstat, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import {
  MAX_DIFF_CHARS,
  MAX_REMOTE_CHANGED_PATHS,
  redactSecrets,
} from '@ai-devflow/shared'
import type { CapturedWorktreeDiff } from './coding-runner.js'

const BINARY_DIFF_PATTERN = /(?:^|\n)(?:GIT binary patch|Binary files .+ differ)(?:\n|$)/u
const execFileAsync = promisify(execFile)

export type OpenCodeGitBoundarySnapshot = {
  baseCommitSha: string
  branchName: string
  sourceHeadSha: string
  sourceStatus: string
}

export async function captureOpenCodeGitBoundary(input: {
  sourcePath: string
  worktreePath: string
  baseCommitSha: string
  branchName: string
}): Promise<OpenCodeGitBoundarySnapshot> {
  const [sourceHeadSha, sourceStatus, worktreeHeadSha, worktreeBranch] = await Promise.all([
    gitOutput(input.sourcePath, ['rev-parse', 'HEAD']),
    gitOutput(input.sourcePath, ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all']),
    gitOutput(input.worktreePath, ['rev-parse', 'HEAD']),
    gitOutput(input.worktreePath, ['branch', '--show-current']),
  ])
  if (worktreeHeadSha !== input.baseCommitSha) {
    throw new Error('OpenCode managed worktree does not start at its recorded base commit')
  }
  if (worktreeBranch !== input.branchName) {
    throw new Error('OpenCode managed worktree branch does not match its recorded branch')
  }
  return {
    baseCommitSha: input.baseCommitSha,
    branchName: input.branchName,
    sourceHeadSha,
    sourceStatus,
  }
}

export async function assertOpenCodeGitBoundary(input: {
  sourcePath: string
  worktreePath: string
  snapshot: OpenCodeGitBoundarySnapshot
}): Promise<void> {
  const [sourceHeadSha, sourceStatus, worktreeHeadSha, worktreeBranch] = await Promise.all([
    gitOutput(input.sourcePath, ['rev-parse', 'HEAD']),
    gitOutput(input.sourcePath, ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all']),
    gitOutput(input.worktreePath, ['rev-parse', 'HEAD']),
    gitOutput(input.worktreePath, ['branch', '--show-current']),
  ])
  if (sourceHeadSha !== input.snapshot.sourceHeadSha || sourceStatus !== input.snapshot.sourceStatus) {
    throw new Error('OpenCode changed the original project checkout')
  }
  if (worktreeHeadSha !== input.snapshot.baseCommitSha) {
    throw new Error('OpenCode changed the managed worktree HEAD; commits are not authorized')
  }
  if (worktreeBranch !== input.snapshot.branchName) {
    throw new Error('OpenCode changed the managed worktree branch')
  }
}

export async function validateAuthoritativeOpenCodeDiff(input: {
  worktreePath: string
  canonicalWorktreePath?: string
  diff: CapturedWorktreeDiff
}): Promise<CapturedWorktreeDiff> {
  const canonicalRoot = input.canonicalWorktreePath
    ? path.resolve(input.canonicalWorktreePath)
    : await realpath(input.worktreePath)
  if (input.diff.changedPaths.length > MAX_REMOTE_CHANGED_PATHS) {
    throw new Error('OpenCode changed too many files')
  }
  if (input.diff.patch.length > MAX_DIFF_CHARS) {
    throw new Error('OpenCode diff exceeds the configured size limit')
  }
  if (BINARY_DIFF_PATTERN.test(input.diff.patch)) {
    throw new Error('OpenCode produced an unsupported binary diff')
  }
  if (redactSecrets(input.diff.patch).redacted) {
    throw new Error('OpenCode diff contains sensitive content')
  }

  const changedPaths = [...new Set(input.diff.changedPaths)]
  if (changedPaths.length !== input.diff.changedPaths.length) {
    throw new Error('OpenCode diff contains duplicate changed paths')
  }
  for (const changedPath of changedPaths) {
    assertRepoRelativePath(changedPath)
    await assertPathDoesNotEscapeOrFollowSymlink(canonicalRoot, changedPath)
  }
  assertPatchHeadersMatchChangedPaths(input.diff.patch, new Set(changedPaths))

  return {
    changedPaths: changedPaths.sort((left, right) => left.localeCompare(right)),
    patch: input.diff.patch,
  }
}

function assertRepoRelativePath(value: string): void {
  if (
    !value ||
    value.length > 1_024 ||
    value.trim() !== value ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('OpenCode diff contains an unsafe repository path')
  }
}

async function assertPathDoesNotEscapeOrFollowSymlink(
  canonicalRoot: string,
  changedPath: string,
): Promise<void> {
  const segments = changedPath.split('/')
  let current = canonicalRoot
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) {
        throw new Error('OpenCode diff cannot include symlinks')
      }
      if (!stat.isDirectory() && !stat.isFile()) {
        throw new Error('OpenCode diff contains an unsupported filesystem entry')
      }
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }
  const canonical = await realpath(current)
  const relative = path.relative(canonicalRoot, canonical)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('OpenCode diff escapes the managed worktree')
  }
}

function assertPatchHeadersMatchChangedPaths(patch: string, allowed: Set<string>): void {
  for (const match of patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)) {
    const left = match[1]
    const right = match[2]
    if (!left || !right || !allowed.has(left) || !allowed.has(right)) {
      throw new Error('OpenCode diff header does not match the authoritative changed paths')
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT',
  )
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trimEnd()
}
