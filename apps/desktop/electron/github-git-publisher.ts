import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
} from '@ai-devflow/shared'
import { terminateProcessTree } from './opencode-process.js'

const maximumGitOutputCharacters = 64 * 1_024
const localGitTimeoutMs = 15_000
const networkGitTimeoutMs = 120_000
export const GITHUB_GIT_PUBLISHER_WALL_CLOCK_BUDGET_MS =
  3 * localGitTimeoutMs + 2 * networkGitTimeoutMs + 15_000
export const GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS =
  GITHUB_GIT_PUBLISHER_WALL_CLOCK_BUDGET_MS + 30_000
const credentialPattern = /^[A-Za-z0-9._-]{16,8192}$/u

export type GitHubGitPublisherErrorCode =
  | 'invalid_delivery_source'
  | 'operation_cancelled'
  | 'publisher_cleanup_failed'
  | 'remote_branch_diverged'
  | 'remote_unavailable'
  | 'repository_mismatch'
  | 'push_result_unknown'
  | 'workspace_dirty'
  | 'workspace_mismatch'

const safeMessages: Record<GitHubGitPublisherErrorCode, string> = {
  invalid_delivery_source: 'GitHub delivery source is invalid',
  operation_cancelled: 'GitHub delivery publication was cancelled safely',
  publisher_cleanup_failed: 'GitHub delivery credential cleanup failed safely',
  remote_branch_diverged: 'The remote delivery branch points to a different commit',
  remote_unavailable: 'The remote GitHub branch could not be inspected',
  repository_mismatch: 'The local Git remote does not match the approved repository',
  push_result_unknown: 'The exact Git push result is unknown and requires reconciliation',
  workspace_dirty: 'The managed workspace changed after delivery approval',
  workspace_mismatch: 'The managed workspace HEAD does not match the approved commit',
}

export class GitHubGitPublisherError extends Error {
  readonly code: GitHubGitPublisherErrorCode

  constructor(code: GitHubGitPublisherErrorCode) {
    super(safeMessages[code])
    this.name = 'GitHubGitPublisherError'
    this.code = code
  }

  toJSON(): { name: string; code: GitHubGitPublisherErrorCode } {
    return { name: this.name, code: this.code }
  }
}

export type GitCommandInput = {
  cwd: string
  args: string[]
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}

export type GitCommandResult = { stdout: string }

export type RunGitCommand = (input: GitCommandInput) => Promise<GitCommandResult>

export type GitHubGitPublisherInput = {
  worktreePath: string
  repository: string
  headBranch: string
  expectedCommitSha: string
  token: string
}

export type GitHubGitPublisherResult = {
  outcome: 'pushed' | 'already_present'
  expectedCommitSha: string
  repository: string
  headBranch: string
}

export type GitHubGitPublisher = {
  publish(input: GitHubGitPublisherInput): Promise<GitHubGitPublisherResult>
}

export type CreateGitHubGitPublisherDependencies = {
  runGit?: RunGitCommand
  platform?: NodeJS.Platform
  nodeExecutable?: string
  signal?: AbortSignal
}

function publisherError(code: GitHubGitPublisherErrorCode): GitHubGitPublisherError {
  return new GitHubGitPublisherError(code)
}

function appendBounded(previous: string, chunk: string): string {
  const combined = previous + chunk
  if (combined.length > maximumGitOutputCharacters) {
    throw publisherError('push_result_unknown')
  }
  return combined
}

const runGitCommand: RunGitCommand = (input) =>
  new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(publisherError('operation_cancelled'))
      return
    }
    let stdout = ''
    let settled = false
    let forcedErrorCode: GitHubGitPublisherErrorCode | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const child = spawn('git', input.args, {
      cwd: input.cwd,
      detached: true,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const onAbort = () => terminateAndSettle('operation_cancelled')
    const settle = (
      result?: GitCommandResult,
      errorCode: GitHubGitPublisherErrorCode = 'push_result_unknown',
    ) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      if (result) resolve(result)
      else reject(publisherError(errorCode))
    }

    function terminateAndSettle(errorCode: GitHubGitPublisherErrorCode) {
      if (settled || forcedErrorCode) return
      forcedErrorCode = errorCode
      void terminateProcessTree(child, {
        timeoutMs: 500,
        forceTimeoutMs: 1_000,
      }).then(
        () => settle(undefined, errorCode),
        () => settle(undefined, errorCode),
      )
    }

    timer = setTimeout(() => terminateAndSettle('push_result_unknown'), input.timeoutMs)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) onAbort()

    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        stdout = appendBounded(stdout, chunk.toString('utf8'))
      } catch {
        terminateAndSettle('push_result_unknown')
      }
    })
    child.stderr?.on('data', () => undefined)
    child.once('error', () => {
      if (forcedErrorCode) return
      settle()
    })
    child.once('close', (code) => {
      if (forcedErrorCode) return
      if (code !== 0) settle()
      else settle({ stdout })
    })
  })

function baseGitEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    LANG: 'C',
    LC_ALL: 'C',
  }
  for (const name of [
    'HOME',
    'PATH',
    'SYSTEMROOT',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
  ]) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  environment['GIT_CONFIG_GLOBAL'] = process.platform === 'win32' ? 'NUL' : '/dev/null'
  return environment
}

function normalizeOriginRepository(value: string): string {
  const raw = value.trim()
  let repository: string | undefined
  const scpMatch = /^git@github\.com:([^?#]+?)(?:\.git)?$/u.exec(raw)
  if (scpMatch?.[1]) {
    repository = scpMatch[1]
  } else {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw publisherError('repository_mismatch')
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'ssh:') ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.port ||
      url.search ||
      url.hash ||
      (url.protocol === 'https:' && (url.username || url.password)) ||
      (url.protocol === 'ssh:' && url.username !== 'git')
    ) {
      throw publisherError('repository_mismatch')
    }
    repository = url.pathname.replace(/^\//u, '').replace(/\.git$/u, '')
  }
  try {
    return normalizeGitHubRepository(repository)
  } catch {
    throw publisherError('repository_mismatch')
  }
}

async function createAskPassRuntime(input: {
  platform: NodeJS.Platform
  nodeExecutable: string
}): Promise<{ root: string; askPassPath: string; scriptPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'devflow-github-askpass-'))
  const scriptPath = path.join(root, 'askpass.cjs')
  const askPassPath = path.join(root, input.platform === 'win32' ? 'askpass.cmd' : 'askpass')
  const script = [
    "'use strict'",
    "const prompt = String(process.argv[2] || '').toLowerCase()",
    "if (prompt.includes('username')) process.stdout.write('x-access-token')",
    "else if (prompt.includes('password')) process.stdout.write(process.env.DEVFLOW_GITHUB_ACCESS_TOKEN || '')",
    'else process.exitCode = 1',
    '',
  ].join('\n')
  const wrapper =
    input.platform === 'win32'
      ? '@echo off\r\n"%DEVFLOW_NODE_EXECUTABLE%" "%DEVFLOW_GITHUB_ASKPASS_SCRIPT%" %*\r\n'
      : '#!/bin/sh\nexec "$DEVFLOW_NODE_EXECUTABLE" "$DEVFLOW_GITHUB_ASKPASS_SCRIPT" "$@"\n'
  try {
    await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await writeFile(askPassPath, wrapper, { encoding: 'utf8', mode: 0o700, flag: 'wx' })
    if (input.platform !== 'win32') await chmod(askPassPath, 0o700)
    return { root, askPassPath, scriptPath }
  } catch {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
      () => undefined,
    )
    throw publisherError('publisher_cleanup_failed')
  }
}

function normalizeInput(input: GitHubGitPublisherInput): Omit<GitHubGitPublisherInput, 'token'> & {
  token: string
  canonicalHttpsUrl: string
} {
  if (
    !input ||
    typeof input.worktreePath !== 'string' ||
    !path.isAbsolute(input.worktreePath) ||
    input.worktreePath.length > 4_096 ||
    typeof input.token !== 'string' ||
    !credentialPattern.test(input.token)
  ) {
    throw publisherError('invalid_delivery_source')
  }
  try {
    const repository = normalizeGitHubRepository(input.repository)
    const headBranch = assertSafeGitHubBranch(input.headBranch, {
      requireDeliveryNamespace: true,
    })
    const expectedCommitSha = assertFullGitCommitSha(
      input.expectedCommitSha,
      'Expected GitHub commit',
    )
    return {
      worktreePath: input.worktreePath,
      repository,
      headBranch,
      expectedCommitSha,
      token: input.token,
      canonicalHttpsUrl: `https://github.com/${repository}.git`,
    }
  } catch (error) {
    if (error instanceof GitHubGitPublisherError) throw error
    throw publisherError('invalid_delivery_source')
  }
}

function parseRemoteHead(output: string, branch: string): string | undefined {
  if (!output) return undefined
  const lines = output.trimEnd().split('\n')
  if (lines.length !== 1) throw publisherError('remote_unavailable')
  const [sha, ref, ...extra] = lines[0]!.split('\t')
  if (extra.length > 0 || ref !== `refs/heads/${branch}` || !sha) {
    throw publisherError('remote_unavailable')
  }
  try {
    return assertFullGitCommitSha(sha, 'Remote GitHub commit')
  } catch {
    throw publisherError('remote_unavailable')
  }
}

export function createGitHubGitPublisher(
  dependencies: CreateGitHubGitPublisherDependencies = {},
): GitHubGitPublisher {
  const runGit = dependencies.runGit ?? runGitCommand
  const platform = dependencies.platform ?? process.platform
  const nodeExecutable = dependencies.nodeExecutable ?? process.execPath
  const signal = dependencies.signal

  const throwIfAborted = () => {
    if (signal?.aborted) throw publisherError('operation_cancelled')
  }

  const runSafe = async (
    command: GitCommandInput,
    errorCode: GitHubGitPublisherErrorCode,
  ): Promise<GitCommandResult> => {
    throwIfAborted()
    try {
      const result = await runGit(command)
      throwIfAborted()
      return result
    } catch (error) {
      if (signal?.aborted) throw publisherError('operation_cancelled')
      if (error instanceof GitHubGitPublisherError) throw error
      throw publisherError(errorCode)
    }
  }

  return {
    async publish(rawInput) {
      throwIfAborted()
      const input = normalizeInput(rawInput)
      const localEnvironment = baseGitEnvironment()
      const localCommand = (args: string[]) =>
        runSafe(
          {
            cwd: input.worktreePath,
            args,
            env: localEnvironment,
            timeoutMs: localGitTimeoutMs,
            ...(signal ? { signal } : {}),
          },
          'workspace_mismatch',
        )

      const head = (await localCommand(['rev-parse', '--verify', 'HEAD'])).stdout.trim().toLowerCase()
      if (head !== input.expectedCommitSha) throw publisherError('workspace_mismatch')
      const status = await localCommand(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      if (status.stdout.length > 0) throw publisherError('workspace_dirty')
      const origin = await localCommand(['remote', 'get-url', 'origin'])
      if (normalizeOriginRepository(origin.stdout) !== input.repository) {
        throw publisherError('repository_mismatch')
      }

      const askPass = await createAskPassRuntime({ platform, nodeExecutable })
      const networkEnvironment: Record<string, string> = {
        ...baseGitEnvironment(),
        DEVFLOW_GITHUB_ACCESS_TOKEN: input.token,
        DEVFLOW_GITHUB_ASKPASS_SCRIPT: askPass.scriptPath,
        DEVFLOW_NODE_EXECUTABLE: nodeExecutable,
        GIT_ASKPASS: askPass.askPassPath,
        GIT_ASKPASS_REQUIRE: 'force',
      }
      const networkCommand = (args: string[], code: GitHubGitPublisherErrorCode) =>
        runSafe(
          {
            cwd: input.worktreePath,
            args,
            env: networkEnvironment,
            timeoutMs: networkGitTimeoutMs,
            ...(signal ? { signal } : {}),
          },
          code,
        )

      try {
        throwIfAborted()
        const remote = await networkCommand(
          [
            'ls-remote',
            '--heads',
            input.canonicalHttpsUrl,
            `refs/heads/${input.headBranch}`,
          ],
          'remote_unavailable',
        )
        const remoteHead = parseRemoteHead(remote.stdout, input.headBranch)
        if (remoteHead && remoteHead !== input.expectedCommitSha) {
          throw publisherError('remote_branch_diverged')
        }
        if (!remoteHead) {
          throwIfAborted()
          await networkCommand(
            [
              'push',
              '--porcelain',
              '--no-verify',
              input.canonicalHttpsUrl,
              `${input.expectedCommitSha}:refs/heads/${input.headBranch}`,
            ],
            'push_result_unknown',
          )
        }
        throwIfAborted()
        return {
          outcome: remoteHead ? 'already_present' : 'pushed',
          expectedCommitSha: input.expectedCommitSha,
          repository: input.repository,
          headBranch: input.headBranch,
        }
      } finally {
        try {
          await rm(askPass.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        } catch {
          throw publisherError('publisher_cleanup_failed')
        }
      }
    },
  }
}
