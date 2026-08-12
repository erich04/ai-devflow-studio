import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  NativeToolIdempotency,
  NativeToolPermissionClass,
  NativeToolSideEffectClass,
} from '@ai-devflow/shared'

export const LOCAL_MCP_INSTALLATION_STATE_VERSION = 1 as const
export const LOCAL_MCP_MAX_STARTUP_DEADLINE_MS = 30_000
export const LOCAL_MCP_MAX_CALL_DEADLINE_MS = 120_000

const MAX_VERSION = 2_147_483_647
const MAX_EXECUTABLE_PATH_LENGTH = 4_096
const MAX_ARGUMENT_COUNT = 32
const MAX_ARGUMENT_LENGTH = 1_000
const MAX_ENVIRONMENT_NAME_COUNT = 32
const MAX_EXPECTED_TOOL_COUNT = 64
const MAX_EXECUTABLE_BYTES = 512 * 1_024 * 1_024
const identifierPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u
const environmentNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const serverVersionPattern = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u

export type LocalMcpInstallation = {
  stateVersion: typeof LOCAL_MCP_INSTALLATION_STATE_VERSION
  id: string
  version: number
  name: string
  transport: 'stdio'
  executablePath: string
  executableSha256: string
  args: string[]
  allowedEnvironmentNames: string[]
  workingDirectoryPolicy: { kind: 'local_project' }
  expectedServer: { name: string; version: string }
  expectedTools: LocalMcpExpectedTool[]
  startupDeadlineMs: number
  callDeadlineMs: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type LocalMcpExpectedTool = {
  name: string
  permissionClass: NativeToolPermissionClass
  sideEffectClass: NativeToolSideEffectClass
  idempotency: NativeToolIdempotency
  maxResultBytes: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const exact = [...expected].sort()
  return keys.length === exact.length && keys.every((key, index) => key === exact[index])
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isBoundedCleanString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function isCanonicalUniqueList(
  value: unknown,
  maximumEntries: number,
  validator: (entry: string) => boolean,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumEntries &&
    value.every((entry): entry is string => typeof entry === 'string' && validator(entry)) &&
    new Set(value).size === value.length &&
    value.every((entry, index) => index === 0 || value[index - 1]! < entry)
  )
}

function isCompatibleAuthority(
  permissionClass: NativeToolPermissionClass,
  sideEffectClass: NativeToolSideEffectClass,
): boolean {
  if (permissionClass === 'read') return sideEffectClass === 'none'
  if (permissionClass === 'edit') return sideEffectClass === 'workspace_write'
  return sideEffectClass === 'none' || sideEffectClass === 'local_process'
}

function parseExpectedTools(value: unknown): LocalMcpExpectedTool[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXPECTED_TOOL_COUNT) {
    return null
  }
  const parsed: LocalMcpExpectedTool[] = []
  for (const entry of value) {
    if (
      !isPlainObject(entry) ||
      !hasExactKeys(entry, [
        'name',
        'permissionClass',
        'sideEffectClass',
        'idempotency',
        'maxResultBytes',
      ]) ||
      typeof entry.name !== 'string' ||
      entry.name.length > 200 ||
      !identifierPattern.test(entry.name) ||
      !['read', 'edit', 'execute'].includes(String(entry.permissionClass)) ||
      !['none', 'workspace_write', 'local_process'].includes(String(entry.sideEffectClass)) ||
      !['idempotent', 'reconcilable'].includes(String(entry.idempotency)) ||
      !isBoundedInteger(entry.maxResultBytes, 1, 256 * 1_024) ||
      !isCompatibleAuthority(
        entry.permissionClass as NativeToolPermissionClass,
        entry.sideEffectClass as NativeToolSideEffectClass,
      )
    ) {
      return null
    }
    parsed.push({
      name: entry.name,
      permissionClass: entry.permissionClass as NativeToolPermissionClass,
      sideEffectClass: entry.sideEffectClass as NativeToolSideEffectClass,
      idempotency: entry.idempotency as NativeToolIdempotency,
      maxResultBytes: entry.maxResultBytes,
    })
  }
  if (
    new Set(parsed.map((entry) => entry.name)).size !== parsed.length ||
    parsed.some((entry, index) => index > 0 && parsed[index - 1]!.name >= entry.name)
  ) {
    return null
  }
  return parsed
}

function invalidInstallation(): never {
  throw new Error('invalid_local_mcp_installation')
}

export function parseLocalMcpInstallation(value: unknown): LocalMcpInstallation {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'name',
      'transport',
      'executablePath',
      'executableSha256',
      'args',
      'allowedEnvironmentNames',
      'workingDirectoryPolicy',
      'expectedServer',
      'expectedTools',
      'startupDeadlineMs',
      'callDeadlineMs',
      'enabled',
      'createdAt',
      'updatedAt',
    ]) ||
    value.stateVersion !== LOCAL_MCP_INSTALLATION_STATE_VERSION ||
    typeof value.id !== 'string' ||
    value.id.length > 200 ||
    !identifierPattern.test(value.id) ||
    !isBoundedInteger(value.version, 1, MAX_VERSION) ||
    !isBoundedCleanString(value.name, 200) ||
    value.transport !== 'stdio' ||
    !isBoundedCleanString(value.executablePath, MAX_EXECUTABLE_PATH_LENGTH) ||
    !path.isAbsolute(value.executablePath) ||
    typeof value.executableSha256 !== 'string' ||
    !digestPattern.test(value.executableSha256) ||
    !Array.isArray(value.args) ||
    value.args.length > MAX_ARGUMENT_COUNT ||
    !value.args.every((argument) => isBoundedCleanString(argument, MAX_ARGUMENT_LENGTH)) ||
    !isCanonicalUniqueList(
      value.allowedEnvironmentNames,
      MAX_ENVIRONMENT_NAME_COUNT,
      (entry) => environmentNamePattern.test(entry),
    ) ||
    !isPlainObject(value.workingDirectoryPolicy) ||
    !hasExactKeys(value.workingDirectoryPolicy, ['kind']) ||
    value.workingDirectoryPolicy.kind !== 'local_project' ||
    !isPlainObject(value.expectedServer) ||
    !hasExactKeys(value.expectedServer, ['name', 'version']) ||
    !isBoundedCleanString(value.expectedServer.name, 200) ||
    !identifierPattern.test(value.expectedServer.name) ||
    typeof value.expectedServer.version !== 'string' ||
    !serverVersionPattern.test(value.expectedServer.version) ||
    parseExpectedTools(value.expectedTools) === null ||
    !isBoundedInteger(value.startupDeadlineMs, 1, LOCAL_MCP_MAX_STARTUP_DEADLINE_MS) ||
    !isBoundedInteger(value.callDeadlineMs, 1, LOCAL_MCP_MAX_CALL_DEADLINE_MS) ||
    typeof value.enabled !== 'boolean' ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt
  ) {
    return invalidInstallation()
  }

  const expectedTools = parseExpectedTools(value.expectedTools)!
  return {
    stateVersion: LOCAL_MCP_INSTALLATION_STATE_VERSION,
    id: value.id,
    version: value.version,
    name: value.name,
    transport: 'stdio',
    executablePath: value.executablePath,
    executableSha256: value.executableSha256,
    args: [...value.args],
    allowedEnvironmentNames: [...value.allowedEnvironmentNames],
    workingDirectoryPolicy: { kind: 'local_project' },
    expectedServer: {
      name: value.expectedServer.name,
      version: value.expectedServer.version,
    },
    expectedTools,
    startupDeadlineMs: value.startupDeadlineMs,
    callDeadlineMs: value.callDeadlineMs,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

async function digestFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

export async function inspectLocalMcpExecutable(
  executablePath: string,
): Promise<{ executablePath: string; executableSha256: string }> {
  try {
    const [canonicalPath, metadata] = await Promise.all([
      realpath(executablePath),
      stat(executablePath),
    ])
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_EXECUTABLE_BYTES ||
      (process.platform !== 'win32' && (metadata.mode & 0o111) === 0)
    ) {
      throw new Error('invalid_executable')
    }
    const executableSha256 = await digestFile(canonicalPath)
    return { executablePath: canonicalPath, executableSha256 }
  } catch {
    throw new Error('local_mcp_executable_mismatch')
  }
}

export async function verifyLocalMcpExecutable(
  value: unknown,
): Promise<{ executablePath: string; executableSha256: string }> {
  const installation = parseLocalMcpInstallation(value)
  const inspected = await inspectLocalMcpExecutable(installation.executablePath)
  if (
    inspected.executablePath !== installation.executablePath ||
    inspected.executableSha256 !== installation.executableSha256
  ) {
    throw new Error('local_mcp_executable_mismatch')
  }
  return inspected
}
