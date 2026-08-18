import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  assertFullGitCommitSha,
  inspectHighConfidenceOutboundSecrets,
} from '@ai-devflow/shared'
import { terminateProcessTree } from './opencode-process.js'

const OUTBOUND_CONTENT_SCANNER_VERSION = 1
const MAX_COMMIT_COUNT = 256
const MAX_COMMAND_OUTPUT_BYTES = 24 * 1024 * 1024
const MAX_SCANNED_BLOB_BYTES = 16 * 1024 * 1024
const GIT_COMMAND_TIMEOUT_MS = 30_000

export type GitHubOutboundContentScanErrorCode =
  | 'content_scan_blocked'
  | 'content_scan_incomplete'
  | 'invalid_delivery_source'
  | 'operation_cancelled'

const safeErrorMessages: Readonly<Record<GitHubOutboundContentScanErrorCode, string>> = {
  content_scan_blocked: 'GitHub delivery content contains blocked credential material',
  content_scan_incomplete: 'GitHub delivery content could not be scanned completely',
  invalid_delivery_source: 'GitHub delivery content authority is invalid',
  operation_cancelled: 'GitHub delivery content scan was cancelled safely',
}

export class GitHubOutboundContentScanError extends Error {
  readonly code: GitHubOutboundContentScanErrorCode

  constructor(code: GitHubOutboundContentScanErrorCode) {
    super(safeErrorMessages[code])
    this.name = 'GitHubOutboundContentScanError'
    this.code = code
  }

  toJSON(): { name: string; code: GitHubOutboundContentScanErrorCode } {
    return { name: this.name, code: this.code }
  }
}

export type GitHubOutboundContentScanInput = {
  worktreePath: string
  baseCommitSha: string
  expectedCommitSha: string
}

export type GitHubOutboundContentScanReceipt = {
  stateVersion: 1
  scannerVersion: 1
  baseCommitSha: string
  expectedCommitSha: string
  commitCount: number
  scannedByteCount: number
  secretMatchCount: 0
  scanDigest: string
  status: 'safe'
  scannedAt: string
}

export type GitHubOutboundContentScanner = {
  scan(input: GitHubOutboundContentScanInput): Promise<GitHubOutboundContentScanReceipt>
}

export type CreateGitHubOutboundContentScannerDependencies = {
  now?: () => string
  signal?: AbortSignal
}

type GitCommandResult = {
  stdout: Buffer
  exitCode: number
}

export function createGitHubOutboundContentScanner(
  dependencies: CreateGitHubOutboundContentScannerDependencies = {},
): GitHubOutboundContentScanner {
  const signal = dependencies.signal
  return {
    async scan(rawInput) {
      const input = normalizeInput(rawInput)
      throwIfAborted(signal)

      const resolvedHead = await runRequiredGit(input.worktreePath, [
        'rev-parse',
        '--verify',
        'HEAD^{commit}',
      ], signal)
      if (resolvedHead.toString('ascii').trim().toLowerCase() !== input.expectedCommitSha) {
        throw scanError('invalid_delivery_source')
      }
      const resolvedBase = await runRequiredGit(input.worktreePath, [
        'rev-parse',
        '--verify',
        `${input.baseCommitSha}^{commit}`,
      ], signal)
      const resolvedExpected = await runRequiredGit(input.worktreePath, [
        'rev-parse',
        '--verify',
        `${input.expectedCommitSha}^{commit}`,
      ], signal)
      if (
        resolvedBase.toString('ascii').trim().toLowerCase() !== input.baseCommitSha ||
        resolvedExpected.toString('ascii').trim().toLowerCase() !== input.expectedCommitSha
      ) {
        throw scanError('invalid_delivery_source')
      }
      const ancestor = await runGit(input.worktreePath, [
        'merge-base',
        '--is-ancestor',
        input.baseCommitSha,
        input.expectedCommitSha,
      ], signal)
      if (ancestor.exitCode !== 0) {
        throw scanError(ancestor.exitCode === 1
          ? 'invalid_delivery_source'
          : 'content_scan_incomplete')
      }

      const history = await runRequiredGit(input.worktreePath, [
        'rev-list',
        '--parents',
        '--reverse',
        `${input.baseCommitSha}..${input.expectedCommitSha}`,
      ], signal)
      const commits = parseLinearHistory(
        history.toString('ascii'),
        input.baseCommitSha,
        input.expectedCommitSha,
      )

      const metadata = await runRequiredGit(input.worktreePath, [
        'log',
        '--reverse',
        '--no-patch',
        '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00',
        `${input.baseCommitSha}..${input.expectedCommitSha}`,
      ], signal)
      assertNoBlockedSecret(metadata.toString('utf8'))

      const patch = await runRequiredGit(input.worktreePath, [
        'log',
        '--reverse',
        '--format=',
        '--patch',
        '--unified=0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        `${input.baseCommitSha}..${input.expectedCommitSha}`,
        '--',
      ], signal)
      const introducedText = selectIntroducedPatchMaterial(patch.toString('utf8'))
      assertNoBlockedSecret(introducedText)

      const introducedBlobs = new Map<string, boolean>()
      for (const commit of commits) {
        const binaryPaths = parseBinaryNumstat(await runRequiredGit(input.worktreePath, [
          'diff-tree',
          '--no-commit-id',
          '-r',
          '--numstat',
          '-z',
          '--no-renames',
          `${commit}^!`,
          '--',
        ], signal))
        const rawDiff = await runRequiredGit(input.worktreePath, [
          'diff-tree',
          '--no-commit-id',
          '-r',
          '--raw',
          '-z',
          '--no-abbrev',
          '--no-renames',
          `${commit}^!`,
          '--',
        ], signal)
        for (const entry of parseRawDiff(rawDiff)) {
          assertNoBlockedSecret(entry.path)
          if (entry.newMode !== '160000' && !/^0+$/u.test(entry.newObjectId)) {
            introducedBlobs.set(
              entry.newObjectId,
              introducedBlobs.get(entry.newObjectId) === true || binaryPaths.has(entry.path),
            )
          }
        }
      }

      const introducedBlobIds = [...introducedBlobs.keys()]
      const blobs = introducedBlobIds.length === 0
        ? []
        : parseBatchObjects(
            await runRequiredGit(
              input.worktreePath,
              ['cat-file', '--batch'],
              signal,
              Buffer.from(`${introducedBlobIds.join('\n')}\n`, 'ascii'),
            ),
            introducedBlobIds,
          )
      let scannedBlobBytes = 0
      for (const blob of blobs) {
        scannedBlobBytes += blob.content.length
        if (scannedBlobBytes > MAX_SCANNED_BLOB_BYTES) {
          throw scanError('content_scan_incomplete')
        }
        if (introducedBlobs.get(blob.objectId) === true || blob.content.includes(0)) {
          assertNoBlockedSecret(blob.content.toString('latin1'))
        }
      }

      const scannedAt = dependencies.now?.() ?? new Date().toISOString()
      if (!isCanonicalIsoTimestamp(scannedAt)) {
        throw scanError('content_scan_incomplete')
      }
      const scanDigest = createHash('sha256')
        .update(JSON.stringify({
          scannerVersion: OUTBOUND_CONTENT_SCANNER_VERSION,
          baseCommitSha: input.baseCommitSha,
          expectedCommitSha: input.expectedCommitSha,
          commits,
          metadataDigest: sha256(metadata),
          introducedTextDigest: sha256(Buffer.from(introducedText, 'utf8')),
          blobs: blobs.map((blob) => ({
            objectId: blob.objectId,
            size: blob.content.length,
            digest: sha256(blob.content),
          })),
        }), 'utf8')
        .digest('hex')
      return {
        stateVersion: 1,
        scannerVersion: OUTBOUND_CONTENT_SCANNER_VERSION,
        baseCommitSha: input.baseCommitSha,
        expectedCommitSha: input.expectedCommitSha,
        commitCount: commits.length,
        scannedByteCount:
          metadata.length + Buffer.byteLength(introducedText, 'utf8') + scannedBlobBytes,
        secretMatchCount: 0,
        scanDigest,
        status: 'safe',
        scannedAt,
      }
    },
  }
}

function normalizeInput(input: GitHubOutboundContentScanInput): GitHubOutboundContentScanInput {
  if (
    !input ||
    typeof input.worktreePath !== 'string' ||
    !path.isAbsolute(input.worktreePath) ||
    input.worktreePath.length > 4_096
  ) {
    throw scanError('invalid_delivery_source')
  }
  try {
    const baseCommitSha = assertFullGitCommitSha(input.baseCommitSha, 'Delivery base commit')
    const expectedCommitSha = assertFullGitCommitSha(
      input.expectedCommitSha,
      'Delivery expected commit',
    )
    if (baseCommitSha === expectedCommitSha) {
      throw scanError('invalid_delivery_source')
    }
    return { worktreePath: input.worktreePath, baseCommitSha, expectedCommitSha }
  } catch (error) {
    if (error instanceof GitHubOutboundContentScanError) throw error
    throw scanError('invalid_delivery_source')
  }
}

function parseLinearHistory(
  output: string,
  baseCommitSha: string,
  expectedCommitSha: string,
): string[] {
  const rows = output.trim().split('\n').filter(Boolean)
  if (rows.length < 1 || rows.length > MAX_COMMIT_COUNT) {
    throw scanError('content_scan_incomplete')
  }
  const commits: string[] = []
  let expectedParent = baseCommitSha
  for (const row of rows) {
    const [commit, parent, ...extra] = row.trim().toLowerCase().split(/\s+/u)
    if (
      !commit ||
      !parent ||
      extra.length !== 0 ||
      !/^[a-f0-9]{40}$/u.test(commit) ||
      !/^[a-f0-9]{40}$/u.test(parent) ||
      parent !== expectedParent
    ) {
      throw scanError('invalid_delivery_source')
    }
    commits.push(commit)
    expectedParent = commit
  }
  if (commits.at(-1) !== expectedCommitSha) {
    throw scanError('invalid_delivery_source')
  }
  return commits
}

function selectIntroducedPatchMaterial(patch: string): string {
  return patch.split('\n')
    .filter((line) =>
      (line.startsWith('+') && !line.startsWith('+++')) ||
      line.startsWith('diff --git ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ '),
    )
    .join('\n')
}

type RawDiffEntry = {
  newMode: string
  newObjectId: string
  path: string
}

function parseRawDiff(output: Buffer): RawDiffEntry[] {
  const fields = output.toString('latin1').split('\0')
  const entries: RawDiffEntry[] = []
  for (let index = 0; index < fields.length - 1;) {
    const header = fields[index++]
    if (!header) continue
    const pathValue = fields[index++]
    const match = /^:\d{6} (\d{6}) [a-f0-9]{40} ([a-f0-9]{40}) [A-Z]\d*$/u.exec(header)
    if (!match || pathValue === undefined) {
      throw scanError('content_scan_incomplete')
    }
    entries.push({
      newMode: match[1]!,
      newObjectId: match[2]!,
      path: pathValue,
    })
  }
  return entries
}

function parseBinaryNumstat(output: Buffer): Set<string> {
  const binaryPaths = new Set<string>()
  for (const record of output.toString('latin1').split('\0')) {
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 1 || secondTab <= firstTab + 1 || secondTab === record.length - 1) {
      throw scanError('content_scan_incomplete')
    }
    const additions = record.slice(0, firstTab)
    const deletions = record.slice(firstTab + 1, secondTab)
    const pathValue = record.slice(secondTab + 1)
    assertNoBlockedSecret(pathValue)
    if (additions === '-' && deletions === '-') binaryPaths.add(pathValue)
  }
  return binaryPaths
}

type BatchObject = {
  objectId: string
  content: Buffer
}

function parseBatchObjects(output: Buffer, expectedObjectIds: string[]): BatchObject[] {
  const objects: BatchObject[] = []
  let offset = 0
  for (const expectedObjectId of expectedObjectIds) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw scanError('content_scan_incomplete')
    const [objectId, type, rawSize, ...extra] = output
      .subarray(offset, headerEnd)
      .toString('ascii')
      .split(' ')
    const size = Number(rawSize)
    if (
      objectId !== expectedObjectId ||
      type !== 'blob' ||
      extra.length !== 0 ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_SCANNED_BLOB_BYTES
    ) {
      throw scanError('content_scan_incomplete')
    }
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw scanError('content_scan_incomplete')
    }
    objects.push({ objectId, content: output.subarray(contentStart, contentEnd) })
    offset = contentEnd + 1
  }
  if (offset !== output.length) throw scanError('content_scan_incomplete')
  return objects
}

function assertNoBlockedSecret(value: string): void {
  if (inspectHighConfidenceOutboundSecrets(value).matchCount > 0) {
    throw scanError('content_scan_blocked')
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isCanonicalIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function scanError(code: GitHubOutboundContentScanErrorCode): GitHubOutboundContentScanError {
  return new GitHubOutboundContentScanError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw scanError('operation_cancelled')
}

function baseGitEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  }
  for (const name of ['HOME', 'PATH', 'SYSTEMROOT']) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  return environment
}

async function runRequiredGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  stdin?: Buffer,
): Promise<Buffer> {
  const result = await runGit(cwd, args, signal, stdin)
  if (result.exitCode !== 0) throw scanError('content_scan_incomplete')
  return result.stdout
}

function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  stdin?: Buffer,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const child = spawn('git', args, {
      cwd,
      detached: true,
      env: baseGitEnvironment(),
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let byteCount = 0
    let settled = false
    let terminating = false
    const finish = (result?: GitCommandResult, error?: GitHubOutboundContentScanError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(result!)
    }
    const terminate = (code: GitHubOutboundContentScanErrorCode) => {
      if (settled || terminating) return
      terminating = true
      void terminateProcessTree(child, { timeoutMs: 500, forceTimeoutMs: 1_000 })
        .finally(() => finish(undefined, scanError(code)))
    }
    const onAbort = () => terminate('operation_cancelled')
    const timer = setTimeout(() => terminate('content_scan_incomplete'), GIT_COMMAND_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      byteCount += chunk.length
      if (byteCount > MAX_COMMAND_OUTPUT_BYTES) {
        terminate('content_scan_incomplete')
        return
      }
      chunks.push(chunk)
    })
    child.once('error', () => finish(undefined, scanError('content_scan_incomplete')))
    child.once('close', (exitCode) => {
      if (terminating) return
      finish({ stdout: Buffer.concat(chunks), exitCode: exitCode ?? -1 })
    })
    if (stdin) child.stdin?.end(stdin)
    else child.stdin?.end()
    if (signal?.aborted) onAbort()
  })
}
