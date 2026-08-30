import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import type {
  CodingChangeSet,
  CodingChangeSetChange,
  CodingChangeSetReplacement,
} from '@ai-devflow/shared'

const MAX_CHANGED_FILES = 6
const MAX_REPLACEMENTS = 12
const MAX_FILE_BYTES = 512 * 1_024

type ChangeSetProposal = Array<{
  path: string
  replacements: CodingChangeSetReplacement[]
}>

type TransactionManifest = {
  stateVersion: 1
  codingRunId: string
  changeSetId: string
  changeSetDigest: string
  status: 'preparing' | 'applying' | 'committed' | 'rolled_back'
  entries: Array<{
    path: string
    targetPath: string
    backupPath: string
    stagedPath: string
    expectedFileDigest: string
    replacementFileDigest: string
    fileMode?: number
    applied: boolean
  }>
  updatedAt: string
}

export type ApplyCodingChangeSetResult = {
  changedPaths: string[]
  transactionDirectory: string
  recovered: boolean
}

export type CodingChangeSetExecutionPhase =
  | 'testing'
  | 'repair_planning'
  | 'repair_waiting'


function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isCanonicalRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    value === value.trim() &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    value.split('/').every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        segment !== '.git' &&
        segment !== '.devflow' &&
        segment !== 'node_modules',
    )
  )
}

function assertCanonicalIso(value: string): void {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Coding Change Set timestamp is invalid')
  }
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  while (offset <= content.length - needle.length) {
    const index = content.indexOf(needle, offset)
    if (index < 0) break
    count += 1
    offset = index + needle.length
  }
  return count
}

function applyExactReplacements(
  content: string,
  replacements: readonly CodingChangeSetReplacement[],
): string {
  let next = content
  for (const replacement of replacements) {
    if (!replacement.oldText || countOccurrences(next, replacement.oldText) !== 1) {
      throw new Error('Coding Change Set replacement anchor must occur exactly once')
    }
    next = next.replace(replacement.oldText, replacement.newText)
  }
  return next
}

function diffLines(value: string): { lines: string[]; finalNewline: boolean } {
  const finalNewline = value.endsWith('\n')
  const lines = value.split('\n')
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}

function wholeFileUnifiedDiff(filePath: string, before: string, after: string): string {
  const oldFile = diffLines(before)
  const newFile = diffLines(after)
  const lines = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldFile.lines.length} +1,${newFile.lines.length} @@`,
    ...oldFile.lines.map((line) => `-${line}`),
    ...(oldFile.finalNewline ? [] : ['\\ No newline at end of file']),
    ...newFile.lines.map((line) => `+${line}`),
    ...(newFile.finalNewline ? [] : ['\\ No newline at end of file']),
  ]
  return `${lines.join('\n')}\n`
}

function canonicalChangeSetDigest(input: {
  codingRunId: string
  projectId: string
  workspaceId: string
  phase: CodingChangeSet['phase']
  executorVersion: 2
  configVersion: number
  providerId: string
  changes: CodingChangeSetChange[]
}): string {
  return sha256(JSON.stringify(input))
}

async function inspectSafeExistingTarget(
  root: string,
  relativePath: string,
): Promise<{ targetPath: string; size: number; mode: number }> {
  if (!isCanonicalRelativePath(relativePath)) {
    throw new Error(`Coding Change Set path is unsafe: ${relativePath}`)
  }
  const rootPath = path.resolve(root)
  const rootInfo = await lstat(rootPath)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Coding Change Set managed worktree root is unsafe')
  }
  const segments = relativePath.split('/')
  let targetPath = rootPath
  for (const [index, segment] of segments.entries()) {
    targetPath = path.join(targetPath, segment)
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) {
      throw new Error(`Coding Change Set does not follow symlinks: ${relativePath}`)
    }
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new Error(`Coding Change Set path has a non-directory parent: ${relativePath}`)
    }
    if (index === segments.length - 1) {
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        throw new Error(
          `Coding Change Set only supports bounded existing regular files: ${relativePath}`,
        )
      }
      return { targetPath, size: info.size, mode: info.mode & 0o777 }
    }
  }
  throw new Error(`Coding Change Set path is unavailable: ${relativePath}`)
}

export async function readCodingWorkspaceTextFile(
  root: string,
  relativePath: string,
): Promise<string> {
  const { targetPath } = await inspectSafeExistingTarget(root, relativePath)
  const bytes = await readFile(targetPath)
  if (bytes.includes(0)) {
    throw new Error(`Coding Change Set does not support binary files: ${relativePath}`)
  }
  const content = bytes.toString('utf8')
  if (!Buffer.from(content, 'utf8').equals(bytes)) {
    throw new Error(`Coding Change Set requires valid UTF-8: ${relativePath}`)
  }
  return content
}

export async function prepareCodingChangeSet(input: {
  id: string
  codingRunId: string
  projectId: string
  workspaceId: string
  worktreePath: string
  phase: CodingChangeSet['phase']
  configVersion: number
  providerId: string
  createdAt: string
  expiresAt: string
  proposal: ChangeSetProposal
}): Promise<CodingChangeSet> {
  assertCanonicalIso(input.createdAt)
  assertCanonicalIso(input.expiresAt)
  if (
    Date.parse(input.expiresAt) <= Date.parse(input.createdAt) ||
    !Number.isSafeInteger(input.configVersion) ||
    input.configVersion < 0 ||
    input.proposal.length < 1 ||
    input.proposal.length > MAX_CHANGED_FILES
  ) {
    throw new Error('Coding Change Set bounds are invalid')
  }
  const sortedProposal = [...input.proposal].sort((left, right) => left.path.localeCompare(right.path))
  if (new Set(sortedProposal.map((change) => change.path)).size !== sortedProposal.length) {
    throw new Error('Coding Change Set paths must be unique')
  }
  const replacementCount = sortedProposal.reduce(
    (total, change) => total + change.replacements.length,
    0,
  )
  if (replacementCount < 1 || replacementCount > MAX_REPLACEMENTS) {
    throw new Error('Coding Change Set replacement count is invalid')
  }

  const changes: CodingChangeSetChange[] = []
  const diffs: string[] = []
  for (const proposed of sortedProposal) {
    if (
      proposed.replacements.length < 1 ||
      proposed.replacements.some(
        (replacement) =>
          typeof replacement.oldText !== 'string' ||
          typeof replacement.newText !== 'string' ||
          replacement.oldText.length < 1 ||
          replacement.oldText === replacement.newText,
      )
    ) {
      throw new Error(`Coding Change Set replacements are invalid: ${proposed.path}`)
    }
    const before = await readCodingWorkspaceTextFile(input.worktreePath, proposed.path)
    const after = applyExactReplacements(before, proposed.replacements)
    changes.push({
      path: proposed.path,
      expectedFileDigest: sha256(before),
      replacements: proposed.replacements.map((replacement) => ({ ...replacement })),
    })
    diffs.push(wholeFileUnifiedDiff(proposed.path, before, after))
  }

  const changeSetDigest = canonicalChangeSetDigest({
    codingRunId: input.codingRunId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    phase: input.phase,
    executorVersion: 2,
    configVersion: input.configVersion,
    providerId: input.providerId,
    changes,
  })
  return {
    id: input.id,
    stateVersion: 2,
    codingRunId: input.codingRunId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    phase: input.phase,
    executorVersion: 2,
    configVersion: input.configVersion,
    providerId: input.providerId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    changes,
    unifiedDiff: diffs.join(''),
    changeSetDigest,
  }
}

export function verifyCodingChangeSetDigest(changeSet: CodingChangeSet): void {
  const digest = canonicalChangeSetDigest({
    codingRunId: changeSet.codingRunId,
    projectId: changeSet.projectId,
    workspaceId: changeSet.workspaceId,
    phase: changeSet.phase,
    executorVersion: changeSet.executorVersion,
    configVersion: changeSet.configVersion,
    providerId: changeSet.providerId,
    changes: changeSet.changes,
  })
  if (digest !== changeSet.changeSetDigest) {
    throw new Error('Coding Change Set digest does not match its canonical modifications')
  }
}

function transactionRoot(worktreePath: string, codingRunId: string, changeSetId: string): string {
  const name = `${sha256(codingRunId).slice(0, 16)}-${sha256(changeSetId).slice(0, 16)}`
  return path.join(path.dirname(path.resolve(worktreePath)), '.devflow-coding-transactions', name)
}

export async function readCodingChangeSetExecutionPhase(input: {
  changeSet: CodingChangeSet
  worktreePath: string
}): Promise<CodingChangeSetExecutionPhase | null> {
  const directory = transactionRoot(
    input.worktreePath,
    input.changeSet.codingRunId,
    input.changeSet.id,
  )
  try {
    const value = JSON.parse(await readFile(path.join(directory, 'execution-state.json'), 'utf8')) as {
      changeSetDigest?: unknown
      phase?: unknown
    }
    if (
      value.changeSetDigest !== input.changeSet.changeSetDigest ||
      !['testing', 'repair_planning', 'repair_waiting'].includes(String(value.phase))
    ) {
      throw new Error('Coding Change Set execution state is invalid')
    }
    return value.phase as CodingChangeSetExecutionPhase
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeCodingChangeSetExecutionPhase(input: {
  changeSet: CodingChangeSet
  worktreePath: string
  phase: CodingChangeSetExecutionPhase
  updatedAt: string
}): Promise<void> {
  assertCanonicalIso(input.updatedAt)
  const directory = transactionRoot(
    input.worktreePath,
    input.changeSet.codingRunId,
    input.changeSet.id,
  )
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const statePath = path.join(directory, 'execution-state.json')
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify({
    stateVersion: 1,
    changeSetId: input.changeSet.id,
    changeSetDigest: input.changeSet.changeSetDigest,
    phase: input.phase,
    updatedAt: input.updatedAt,
  }, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fsyncPath(temporaryPath)
  await rename(temporaryPath, statePath)
  await fsyncPath(statePath)
}

async function fsyncPath(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function persistManifest(directory: string, manifest: TransactionManifest): Promise<void> {
  const manifestPath = path.join(directory, 'manifest.json')
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fsyncPath(temporaryPath)
  await rename(temporaryPath, manifestPath)
  await fsyncPath(manifestPath)
}

async function readManifest(directory: string): Promise<TransactionManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as TransactionManifest
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

async function restoreManifest(
  manifest: TransactionManifest,
  directory: string,
  worktreePath: string,
): Promise<void> {
  for (const entry of manifest.entries) {
    const target = await inspectSafeExistingTarget(worktreePath, entry.path)
    if (entry.targetPath !== target.targetPath) {
      throw new Error('Coding Change Set transaction target is invalid')
    }
    await access(entry.backupPath, constants.R_OK)
    const restorePath = path.join(directory, `${sha256(entry.path).slice(0, 24)}.restore`)
    await writeFile(restorePath, await readFile(entry.backupPath), {
      mode: entry.fileMode ?? 0o600,
    })
    await fsyncPath(restorePath)
    await rename(restorePath, entry.targetPath)
  }
  manifest.status = 'rolled_back'
  manifest.entries = manifest.entries.map((entry) => ({ ...entry, applied: false }))
  manifest.updatedAt = new Date().toISOString()
  await persistManifest(directory, manifest)
}

export async function applyCodingChangeSetAtomically(input: {
  changeSet: CodingChangeSet
  worktreePath: string
  now: string
}): Promise<ApplyCodingChangeSetResult> {
  verifyCodingChangeSetDigest(input.changeSet)
  assertCanonicalIso(input.now)
  if (Date.parse(input.now) > Date.parse(input.changeSet.expiresAt)) {
    throw new Error('Coding Change Set approval expired before application')
  }
  const directory = transactionRoot(
    input.worktreePath,
    input.changeSet.codingRunId,
    input.changeSet.id,
  )
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const existing = await readManifest(directory)
  if (existing) {
    if (
      existing.changeSetId !== input.changeSet.id ||
      existing.changeSetDigest !== input.changeSet.changeSetDigest
    ) {
      throw new Error('Coding transaction directory belongs to another Change Set')
    }
    if (existing.status === 'committed') {
      return {
        changedPaths: input.changeSet.changes.map((change) => change.path),
        transactionDirectory: directory,
        recovered: true,
      }
    }
    if (existing.status === 'preparing' || existing.status === 'applying') {
      await restoreManifest(existing, directory, input.worktreePath)
      throw new Error('Interrupted Coding Change Set transaction was rolled back safely')
    }
    throw new Error('Coding Change Set transaction was previously rolled back')
  }

  const entries: TransactionManifest['entries'] = []
  for (const change of input.changeSet.changes) {
    const content = await readCodingWorkspaceTextFile(input.worktreePath, change.path)
    if (sha256(content) !== change.expectedFileDigest) {
      throw new Error(`Coding Change Set file digest drifted before approval: ${change.path}`)
    }
    const replacement = applyExactReplacements(content, change.replacements)
    const key = sha256(change.path).slice(0, 24)
    const backupPath = path.join(directory, `${key}.backup`)
    const stagedPath = path.join(directory, `${key}.staged`)
    const target = await inspectSafeExistingTarget(input.worktreePath, change.path)
    const fileMode = target.mode
    await writeFile(backupPath, content, { encoding: 'utf8', mode: fileMode, flag: 'wx' })
    await writeFile(stagedPath, replacement, { encoding: 'utf8', mode: fileMode, flag: 'wx' })
    await Promise.all([fsyncPath(backupPath), fsyncPath(stagedPath)])
    entries.push({
      path: change.path,
      targetPath: target.targetPath,
      backupPath,
      stagedPath,
      expectedFileDigest: change.expectedFileDigest,
      replacementFileDigest: sha256(replacement),
      fileMode,
      applied: false,
    })
  }
  const manifest: TransactionManifest = {
    stateVersion: 1,
    codingRunId: input.changeSet.codingRunId,
    changeSetId: input.changeSet.id,
    changeSetDigest: input.changeSet.changeSetDigest,
    status: 'preparing',
    entries,
    updatedAt: input.now,
  }
  await persistManifest(directory, manifest)
  manifest.status = 'applying'
  await persistManifest(directory, manifest)
  try {
    for (const entry of manifest.entries) {
      const current = await inspectSafeExistingTarget(input.worktreePath, entry.path)
      if (
        current.targetPath !== entry.targetPath ||
        sha256(await readFile(current.targetPath)) !== entry.expectedFileDigest
      ) {
        throw new Error(`Coding Change Set target changed during application: ${entry.path}`)
      }
      const parentInfo = await stat(path.dirname(entry.targetPath))
      if (!parentInfo.isDirectory()) throw new Error('Coding Change Set target parent is unavailable')
      await rename(entry.stagedPath, entry.targetPath)
      entry.applied = true
      manifest.updatedAt = new Date().toISOString()
      await persistManifest(directory, manifest)
    }
    manifest.status = 'committed'
    manifest.updatedAt = new Date().toISOString()
    await persistManifest(directory, manifest)
  } catch (error) {
    await restoreManifest(manifest, directory, input.worktreePath)
    throw error
  }
  return {
    changedPaths: input.changeSet.changes.map((change) => change.path),
    transactionDirectory: directory,
    recovered: false,
  }
}
