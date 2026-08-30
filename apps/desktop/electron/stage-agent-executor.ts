import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  StageAgentExecutionError,
  type ClarificationRepositoryFindings,
  type StageAgentExecutor,
  type WorkflowArtifactProviderOutput,
} from '@ai-devflow/shared'
import {
  abortOpencodeSession,
  createOpencodeSession,
  createReadOnlyStageAgentPermissionRules,
  listOpencodeDiff,
  listOpencodePermissions,
  sendOpencodeMessage,
} from './opencode-http-adapter.js'
import type { ManagedOpencodeServer } from './opencode-process.js'

const execFileAsync = promisify(execFile)
const citationFileBytesMax = 2 * 1024 * 1024
const stageAgentEnvironmentAllowlist = new Set([
  'HOME', 'PATH', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_DISABLE_AUTOUPDATE',
])

export function buildReadOnlyStageAgentRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) =>
      stageAgentEnvironmentAllowlist.has(key) && typeof value === 'string' && value.length <= 4_096),
  )
}

type ManagedOpencodeProcessManager = {
  ensure(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
  }): Promise<ManagedOpencodeServer>
}

export type ReadOnlyStageAgentRunnerResult = {
  value: WorkflowArtifactProviderOutput
  toolCalls: number
  pendingPermissionCount: number
  diffCount: number
}

export type ReadOnlyStageAgentRunner = (input: {
  prompt: string
  directory: string
  signal: AbortSignal
}) => Promise<ReadOnlyStageAgentRunnerResult>

export function createReadOnlyLocalStageAgentExecutor(input: {
  projectId: string
  projectPath: string
  binaryPath: string
  providerId: string
  modelId: string
  detectedVersion: string
  processManager: ManagedOpencodeProcessManager
  runtimeEnv: NodeJS.ProcessEnv
  runner?: ReadOnlyStageAgentRunner
}): StageAgentExecutor {
  return {
    kind: 'local-agent',
    id: 'managed-opencode-read-only-stage-agent',
    version: `1/${input.detectedVersion}`,
    providerId: input.providerId,
    model: input.modelId,
    async execute(execution) {
      assertReadOnlyCapability(execution.capability)
      const root = await realpath(input.projectPath)
      const before = await repositoryWorkingTreeDigest(root)
      const timeoutController = new AbortController()
      const timeout = setTimeout(() => timeoutController.abort(), execution.bounds.timeoutMs)
      const abort = () => timeoutController.abort()
      execution.signal?.addEventListener('abort', abort, { once: true })
      const started = Date.now()
      try {
        const runner = input.runner ?? createManagedOpencodeRunner({
          projectId: input.projectId,
          binaryPath: input.binaryPath,
          providerId: input.providerId,
          modelId: input.modelId,
          processManager: input.processManager,
          runtimeEnv: buildReadOnlyStageAgentRuntimeEnv(input.runtimeEnv),
        })
        const result = await runner({
          prompt: execution.prompt,
          directory: root,
          signal: timeoutController.signal,
        })
        if (result.pendingPermissionCount > 0) {
          throw new StageAgentExecutionError('permission_denied', 'Read-only stage Agent requested additional permission')
        }
        if (result.diffCount > 0) {
          throw new StageAgentExecutionError('repository_changed', 'Read-only stage Agent produced a repository diff')
        }
        const after = await repositoryWorkingTreeDigest(root)
        if (before !== after) {
          throw new StageAgentExecutionError('repository_changed', 'Repository changed while the read-only stage Agent was running')
        }
        const value = await validateAndDigestRepositoryCitations(result.value, root, before)
        return {
          value,
          terminalReason: 'success',
          toolCalls: result.toolCalls,
          durationMs: Math.max(0, Date.now() - started),
        }
      } catch (error) {
        if (error instanceof StageAgentExecutionError) throw error
        if (timeoutController.signal.aborted) {
          throw new StageAgentExecutionError(
            execution.signal?.aborted ? 'cancelled' : 'timeout',
            execution.signal?.aborted ? 'Read-only stage Agent was cancelled' : 'Read-only stage Agent timed out',
          )
        }
        throw new StageAgentExecutionError('cli_unavailable', 'Managed read-only stage Agent could not complete')
      } finally {
        clearTimeout(timeout)
        execution.signal?.removeEventListener('abort', abort)
      }
    },
  }
}

function assertReadOnlyCapability(capability: Parameters<StageAgentExecutor['execute']>[0]['capability']): void {
  if (
    !capability.repositoryRead || capability.repositoryWrite || capability.shell ||
    capability.network || capability.workflowMutation ||
    capability.allowedTools.some((tool) => !['read', 'glob', 'grep', 'list'].includes(tool))
  ) {
    throw new StageAgentExecutionError('permission_denied', 'Stage Agent capability is not repository-read-only')
  }
}

function createManagedOpencodeRunner(input: {
  projectId: string
  binaryPath: string
  providerId: string
  modelId: string
  processManager: ManagedOpencodeProcessManager
  runtimeEnv: NodeJS.ProcessEnv
}): ReadOnlyStageAgentRunner {
  return async ({ prompt, directory, signal }) => {
    let sessionId: string | undefined
    try {
      const server = await input.processManager.ensure({
        projectId: input.projectId,
        binaryPath: input.binaryPath,
        env: input.runtimeEnv,
      })
      const session = await createOpencodeSession({
        baseUrl: server.baseUrl,
        directory,
        title: 'DevFlow read-only requirement clarification',
        model: { providerID: input.providerId, id: input.modelId },
        permissionRules: createReadOnlyStageAgentPermissionRules(),
        signal,
      })
      sessionId = session.id
      const response = await sendOpencodeMessage({
        baseUrl: server.baseUrl,
        sessionId,
        directory,
        model: { providerID: input.providerId, modelID: input.modelId },
        text: prompt,
        signal,
      })
      const [permissions, diffs] = await Promise.all([
        listOpencodePermissions({ baseUrl: server.baseUrl, directory, signal }),
        listOpencodeDiff({ baseUrl: server.baseUrl, sessionId, directory, signal }),
      ])
      return {
        value: parseStructuredOpencodeOutput(response),
        toolCalls: countToolParts(response),
        pendingPermissionCount: permissions.filter((permission) => permission.sessionID === sessionId).length,
        diffCount: diffs.length,
      }
    } catch (error) {
      if (signal.aborted && sessionId) {
        try {
          const server = await input.processManager.ensure({
            projectId: input.projectId,
            binaryPath: input.binaryPath,
            env: input.runtimeEnv,
          })
          await abortOpencodeSession({ baseUrl: server.baseUrl, sessionId, directory })
        } catch {
          // The original terminal reason remains authoritative.
        }
      }
      throw error
    }
  }
}

function parseStructuredOpencodeOutput(response: unknown): WorkflowArtifactProviderOutput {
  if (!isRecord(response) || !Array.isArray(response.parts)) {
    throw new StageAgentExecutionError('schema_invalid', 'Managed stage Agent returned no structured response')
  }
  const text = response.parts
    .filter((part): part is { type: string; text: string } =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) throw new Error('not an object')
    return parsed as WorkflowArtifactProviderOutput
  } catch {
    throw new StageAgentExecutionError('schema_invalid', 'Managed stage Agent returned invalid JSON')
  }
}

function countToolParts(response: unknown): number {
  if (!isRecord(response) || !Array.isArray(response.parts)) return 0
  return response.parts.filter((part) => isRecord(part) && part.type === 'tool').length
}

async function validateAndDigestRepositoryCitations(
  value: WorkflowArtifactProviderOutput,
  root: string,
  repositoryDigest: string,
): Promise<WorkflowArtifactProviderOutput> {
  const findings = value.repositoryFindings
  if (!findings || !Array.isArray(findings.citations) || findings.citations.length === 0) {
    throw new StageAgentExecutionError('evidence_invalid', 'Managed stage Agent returned no repository citations')
  }
  const citations: ClarificationRepositoryFindings['citations'] = []
  for (const citation of findings.citations) {
    if (typeof citation.path !== 'string' || path.isAbsolute(citation.path) || citation.path.includes('\\')) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation path is not repo-relative')
    }
    const resolved = path.resolve(root, citation.path)
    if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation escaped the selected repository')
    }
    const canonical = await realpath(resolved).catch(() => undefined)
    if (!canonical || !canonical.startsWith(`${root}${path.sep}`)) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation is missing or crosses a symlink boundary')
    }
    const bytes = await readFile(canonical)
    if (bytes.byteLength > citationFileBytesMax) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation exceeds the per-file evidence limit')
    }
    const contentDigest = createHash('sha256').update(bytes).digest('hex')
    if (citation.contentDigest && citation.contentDigest !== contentDigest) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation digest does not match the cited file')
    }
    citations.push({ ...citation, path: path.relative(root, canonical).split(path.sep).join('/'), contentDigest })
  }
  return {
    ...value,
    repositoryFindings: {
      ...findings,
      repositoryDigest,
      citations,
    },
  }
}

async function repositoryWorkingTreeDigest(root: string): Promise<string> {
  try {
    const [{ stdout: head }, { stdout: status }, { stdout: diff }, { stdout: untracked }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }),
      execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }),
      execFileAsync('git', ['diff', '--binary', 'HEAD'], { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }),
      execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }),
    ])
    const digest = createHash('sha256').update(head).update(status).update(diff)
    const untrackedPaths = Buffer.from(untracked).toString('utf8').split('\0').filter(Boolean).sort()
    let totalUntrackedBytes = 0
    for (const relativePath of untrackedPaths) {
      const absolutePath = path.resolve(root, relativePath)
      const canonical = await realpath(absolutePath)
      if (!canonical.startsWith(`${root}${path.sep}`)) {
        throw new Error('untracked path escaped repository')
      }
      const bytes = await readFile(canonical)
      totalUntrackedBytes += bytes.byteLength
      if (totalUntrackedBytes > 32 * 1024 * 1024) {
        throw new Error('untracked content exceeds repository fingerprint limit')
      }
      digest.update(relativePath).update(bytes)
    }
    return digest.digest('hex')
  } catch {
    throw new StageAgentExecutionError('repository_unavailable', 'Selected project is not an inspectable Git repository')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
