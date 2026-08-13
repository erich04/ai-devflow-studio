import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'
import {
  evaluateAgentScenario,
  validateTestCommandSafety,
  type LocalProject,
  type ManagedCodingWorkspace,
  type NativeToolDefinition,
} from '@ai-devflow/shared'
import {
  type LocalTestCommandInput,
  type LocalTestCommandResult,
  runLocalTestCommand,
} from './test-runner.js'
import type { NativeToolRegistration, NativeToolResourceScope } from './native-tool-registry.js'

const MAX_RELATIVE_PATH_LENGTH = 240
const MAX_READ_BYTES = 64 * 1_024
const MAX_WRITE_BYTES = 64 * 1_024
const MAX_LIST_ENTRIES = 256
const MAX_SCENARIO_JSON_LENGTH = 32 * 1_024
const TEST_TIMEOUT_MS = 120_000
const DISALLOWED_PATH_SEGMENTS = new Set(['.git', '.devflow', 'node_modules'])

const repoListDefinition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'repo.list_entries',
  version: 1,
  source: 'native',
  description: 'List bounded direct entries under one repository-relative directory.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      directory: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      maxEntries: { type: 'integer', minimum: 1, maximum: MAX_LIST_ENTRIES },
    },
    required: ['directory', 'maxEntries'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      directory: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      entries: {
        type: 'array',
        maxItems: MAX_LIST_ENTRIES,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
            kind: { type: 'string', enum: ['file', 'directory'] },
          },
          required: ['path', 'kind'],
        },
      },
      truncated: { type: 'boolean' },
    },
    required: ['directory', 'entries', 'truncated'],
  },
  permissionClass: 'read',
  sideEffectClass: 'none',
  defaultDeadlineMs: 5_000,
  maxResultBytes: 64 * 1_024,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

const repoReadDefinition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'repo.read_text',
  version: 1,
  source: 'native',
  description: 'Read one bounded repository-relative UTF-8 regular file.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      maxBytes: { type: 'integer', minimum: 1, maximum: MAX_READ_BYTES },
    },
    required: ['path', 'maxBytes'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      content: { type: 'string', maxLength: MAX_READ_BYTES },
      truncated: { type: 'boolean' },
    },
    required: ['path', 'content', 'truncated'],
  },
  permissionClass: 'read',
  sideEffectClass: 'none',
  defaultDeadlineMs: 5_000,
  maxResultBytes: 96 * 1_024,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

const workspaceWriteDefinition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'workspace.write_text',
  version: 1,
  source: 'native',
  description: 'Atomically write one bounded UTF-8 file inside an active managed workspace.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      content: { type: 'string', maxLength: MAX_WRITE_BYTES },
    },
    required: ['path', 'content'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_RELATIVE_PATH_LENGTH },
      bytes: { type: 'integer', minimum: 0, maximum: MAX_WRITE_BYTES },
      contentDigest: { type: 'string', minLength: 64, maxLength: 64 },
    },
    required: ['path', 'bytes', 'contentDigest'],
  },
  permissionClass: 'edit',
  sideEffectClass: 'workspace_write',
  defaultDeadlineMs: 5_000,
  maxResultBytes: 1_024,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

const savedTestDefinition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'project.run_saved_test',
  version: 1,
  source: 'native',
  description: 'Run only the Local Project saved recognized package-manager test command.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['passed', 'failed', 'timed_out'] },
      exitCode: { type: 'integer', minimum: -1, maximum: 255 },
      durationMs: { type: 'integer', minimum: 0, maximum: TEST_TIMEOUT_MS + 10_000 },
      summary: { type: 'string', minLength: 1, maxLength: 1_000 },
      redacted: { type: 'boolean' },
    },
    required: ['status', 'exitCode', 'durationMs', 'summary', 'redacted'],
  },
  permissionClass: 'execute',
  sideEffectClass: 'local_process',
  defaultDeadlineMs: TEST_TIMEOUT_MS,
  maxResultBytes: 4 * 1_024,
  idempotency: 'reconcilable',
  auditPolicy: 'redacted_metadata_only',
}

const workspaceSavedTestDefinition: NativeToolDefinition = {
  ...savedTestDefinition,
  id: 'workspace.run_saved_test',
  description: 'Run only the Local Project saved recognized test command inside one active managed workspace.',
}

const scenarioEvaluateDefinition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'scenario.evaluate',
  version: 1,
  source: 'native',
  description: 'Evaluate one strict scenario observation using the deterministic shared evaluator.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenarioJson: { type: 'string', minLength: 2, maxLength: MAX_SCENARIO_JSON_LENGTH },
      observationJson: { type: 'string', minLength: 2, maxLength: MAX_SCENARIO_JSON_LENGTH },
    },
    required: ['scenarioJson', 'observationJson'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      passed: { type: 'boolean' },
      failures: {
        type: 'array',
        maxItems: 64,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
    required: ['passed', 'failures'],
  },
  permissionClass: 'execute',
  sideEffectClass: 'none',
  defaultDeadlineMs: 1_000,
  maxResultBytes: 16 * 1_024,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

function isCanonicalRelativePath(value: string, allowRoot: boolean): boolean {
  if (
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '..' || DISALLOWED_PATH_SEGMENTS.has(segment))
  ) {
    return false
  }
  return allowRoot ? value === '.' || value.length > 0 : value !== '.' && value.length > 0
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function safeExistingPath(
  rootPath: string,
  relativePath: string,
  expected: 'file' | 'directory',
): Promise<{ root: string; absolutePath: string }> {
  if (!isCanonicalRelativePath(relativePath, expected === 'directory')) {
    throw new Error('native_tool_path_invalid')
  }
  const root = await realpath(rootPath)
  let candidate = root
  if (relativePath !== '.') {
    for (const segment of relativePath.split('/')) {
      candidate = path.join(candidate, segment)
      if ((await lstat(candidate)).isSymbolicLink()) throw new Error('native_tool_symlink_denied')
    }
  }
  const resolved = await realpath(candidate)
  if (!isInsideOrEqual(root, resolved)) throw new Error('native_tool_path_escape')
  const metadata = await lstat(resolved)
  if (
    (expected === 'file' && !metadata.isFile()) ||
    (expected === 'directory' && !metadata.isDirectory())
  ) {
    throw new Error('native_tool_path_type')
  }
  return { root, absolutePath: resolved }
}

async function readPrefix(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maxBytes + 4)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

function decodeUtf8Prefix(buffer: Buffer, maxBytes: number): { content: string; truncated: boolean } {
  const truncated = buffer.byteLength > maxBytes
  const limit = Math.min(buffer.byteLength, maxBytes)
  for (let end = limit; end >= Math.max(0, limit - 3); end -= 1) {
    try {
      return {
        content: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end)),
        truncated,
      }
    } catch {
      continue
    }
  }
  throw new Error('native_tool_utf8_invalid')
}

async function resolveProject(
  resolver: (localProjectId: string) => Promise<LocalProject | null>,
  scope: NativeToolResourceScope,
): Promise<LocalProject> {
  const project = await resolver(scope.localProjectId)
  if (!project || project.id !== scope.localProjectId) throw new Error('native_tool_project_missing')
  return project
}

export function createAcceptedNativeToolRegistrations(input: {
  resolveLocalProject(localProjectId: string): Promise<LocalProject | null>
  resolveManagedWorkspace(workspaceId: string): Promise<ManagedCodingWorkspace | null>
  runSavedTest?: (input: LocalTestCommandInput) => Promise<LocalTestCommandResult>
}): NativeToolRegistration[] {
  const runSavedTest = input.runSavedTest ?? runLocalTestCommand
  return [
    {
      definition: repoListDefinition,
      handler: async ({ resourceScope, input: value }) => {
        if (resourceScope.kind !== 'local_project') throw new Error('native_tool_scope_invalid')
        const project = await resolveProject(input.resolveLocalProject, resourceScope)
        const toolInput = value as { directory: string; maxEntries: number }
        const { absolutePath } = await safeExistingPath(project.path, toolInput.directory, 'directory')
        const allEntries = (await readdir(absolutePath, { withFileTypes: true }))
          .filter(
            (entry) =>
              !entry.isSymbolicLink() &&
              !DISALLOWED_PATH_SEGMENTS.has(entry.name) &&
              (entry.isFile() || entry.isDirectory()),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
        const entries = allEntries.slice(0, toolInput.maxEntries).map((entry) => ({
          path:
            toolInput.directory === '.'
              ? entry.name
              : path.posix.join(toolInput.directory, entry.name),
          kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        }))
        return {
          directory: toolInput.directory,
          entries,
          truncated: allEntries.length > entries.length,
        }
      },
    },
    {
      definition: repoReadDefinition,
      handler: async ({ resourceScope, input: value }) => {
        if (resourceScope.kind !== 'local_project') throw new Error('native_tool_scope_invalid')
        const project = await resolveProject(input.resolveLocalProject, resourceScope)
        const toolInput = value as { path: string; maxBytes: number }
        const { absolutePath } = await safeExistingPath(project.path, toolInput.path, 'file')
        const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
        try {
          const metadata = await handle.stat()
          if (!metadata.isFile()) throw new Error('native_tool_path_type')
          const content = decodeUtf8Prefix(await readPrefix(handle, toolInput.maxBytes), toolInput.maxBytes)
          return { path: toolInput.path, ...content }
        } finally {
          await handle.close()
        }
      },
    },
    {
      definition: workspaceWriteDefinition,
      handler: async ({ resourceScope, input: value }) => {
        if (resourceScope.kind !== 'managed_workspace') throw new Error('native_tool_scope_invalid')
        const project = await resolveProject(input.resolveLocalProject, resourceScope)
        const workspace = await input.resolveManagedWorkspace(resourceScope.workspaceId)
        if (
          !workspace ||
          workspace.id !== resourceScope.workspaceId ||
          workspace.projectId !== project.id ||
          workspace.cleanupStatus !== 'active'
        ) {
          throw new Error('native_tool_workspace_stale')
        }
        const toolInput = value as { path: string; content: string }
        if (!isCanonicalRelativePath(toolInput.path, false)) throw new Error('native_tool_path_invalid')
        const content = Buffer.from(toolInput.content, 'utf8')
        if (content.byteLength > MAX_WRITE_BYTES) throw new Error('native_tool_write_too_large')
        const parentRelative = path.posix.dirname(toolInput.path)
        const fileName = path.posix.basename(toolInput.path)
        const { root, absolutePath: parent } = await safeExistingPath(
          workspace.worktreePath,
          parentRelative,
          'directory',
        )
        if (!isInsideOrEqual(root, parent)) throw new Error('native_tool_path_escape')
        const target = path.join(parent, fileName)
        try {
          const targetMetadata = await lstat(target)
          if (targetMetadata.isSymbolicLink() || !targetMetadata.isFile()) {
            throw new Error('native_tool_target_invalid')
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const temporaryPath = path.join(parent, `.devflow-tool-${randomUUID()}.tmp`)
        const handle = await open(
          temporaryPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        )
        try {
          await handle.writeFile(content)
          await handle.sync()
        } finally {
          await handle.close()
        }
        try {
          if ((await realpath(parent)) !== parent) throw new Error('native_tool_parent_changed')
          await rename(temporaryPath, target)
        } finally {
          await rm(temporaryPath, { force: true })
        }
        return {
          path: toolInput.path,
          bytes: content.byteLength,
          contentDigest: createHash('sha256').update(content).digest('hex'),
        }
      },
    },
    {
      definition: savedTestDefinition,
      handler: async ({ resourceScope, signal }) => {
        if (resourceScope.kind !== 'local_project') throw new Error('native_tool_scope_invalid')
        const project = await resolveProject(input.resolveLocalProject, resourceScope)
        const safety = validateTestCommandSafety(project.testCommand)
        if (safety.level !== 'safe') throw new Error('native_tool_test_command_denied')
        const result = await runSavedTest({
          command: safety.normalizedCommand,
          cwd: project.path,
          timeoutMs: TEST_TIMEOUT_MS,
          signal,
        })
        return {
          status: result.status,
          exitCode: result.exitCode ?? -1,
          durationMs: result.durationMs,
          summary: result.summary,
          redacted: result.redacted,
        }
      },
    },
    {
      definition: workspaceSavedTestDefinition,
      resourceKinds: ['managed_workspace'],
      handler: async ({ resourceScope, signal }) => {
        if (resourceScope.kind !== 'managed_workspace') throw new Error('native_tool_scope_invalid')
        const project = await resolveProject(input.resolveLocalProject, resourceScope)
        const workspace = await input.resolveManagedWorkspace(resourceScope.workspaceId)
        if (
          !workspace ||
          workspace.id !== resourceScope.workspaceId ||
          workspace.projectId !== project.id ||
          workspace.sourcePath !== project.path ||
          workspace.cleanupStatus !== 'active'
        ) {
          throw new Error('native_tool_workspace_stale')
        }
        const safety = validateTestCommandSafety(project.testCommand)
        if (safety.level !== 'safe') throw new Error('native_tool_test_command_denied')
        const result = await runSavedTest({
          command: safety.normalizedCommand,
          cwd: workspace.worktreePath,
          timeoutMs: TEST_TIMEOUT_MS,
          signal,
        })
        return {
          status: result.status,
          exitCode: result.exitCode ?? -1,
          durationMs: result.durationMs,
          summary: result.summary,
          redacted: result.redacted,
        }
      },
    },
    {
      definition: scenarioEvaluateDefinition,
      handler: async ({ resourceScope, input: value }) => {
        await resolveProject(input.resolveLocalProject, resourceScope)
        const toolInput = value as { scenarioJson: string; observationJson: string }
        return evaluateAgentScenario({
          scenario: JSON.parse(toolInput.scenarioJson) as never,
          observed: JSON.parse(toolInput.observationJson) as never,
        })
      },
    },
  ]
}
