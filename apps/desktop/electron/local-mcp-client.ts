import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stat, realpath } from 'node:fs/promises'
import {
  parseNativeToolDefinition,
  validateNativeToolValue,
  type NativeToolDefinition,
} from '@ai-devflow/shared'
import {
  createNativeToolRegistry,
  digestNativeToolValue,
  type NativeToolRegistration,
  type NativeToolRegistry,
  type NativeToolRegistryPersistence,
} from './native-tool-registry.js'
import {
  parseLocalMcpInstallation,
  verifyLocalMcpExecutable,
  type LocalMcpInstallation,
} from './local-mcp-installation.js'

export const LOCAL_MCP_PROTOCOL_VERSION = '2025-11-25'
const MAX_STDIO_MESSAGE_BYTES = 256 * 1_024
const MAX_STDERR_BYTES = 16 * 1_024
const SHUTDOWN_GRACE_MS = 1_000
const MAX_ENVIRONMENT_VALUE_BYTES = 8 * 1_024
const ISOLATED_ENVIRONMENT_NAME = 'DEVFLOW_MCP_ENVIRONMENT_ISOLATED'

type JsonRecord = Record<string, unknown>

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type LocalMcpClient = {
  installation: LocalMcpInstallation
  serverInfo: { name: string; version: string }
  tools: NativeToolDefinition[]
  capabilitySetDigest: string
  readonly closed: boolean
  callTool(input: {
    toolName: string
    input: unknown
    signal?: AbortSignal
  }): Promise<unknown>
  shutdown(): Promise<void>
}

function isPlainObject(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const exact = [...expected].sort()
  return keys.length === exact.length && keys.every((key, index) => key === exact[index])
}

function safeError(code: string): Error {
  return new Error(code)
}

function buildEnvironment(
  installation: LocalMcpInstallation,
  environment: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const suppliedNames = Object.keys(environment).sort()
  if (suppliedNames.some((name) => !installation.allowedEnvironmentNames.includes(name))) {
    throw safeError('local_mcp_environment_denied')
  }
  const childEnvironment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv
  childEnvironment[ISOLATED_ENVIRONMENT_NAME] = '1'
  for (const name of installation.allowedEnvironmentNames) {
    const value = environment[name]
    if (value === undefined) continue
    if (
      value.includes('\u0000') ||
      Buffer.byteLength(value, 'utf8') > MAX_ENVIRONMENT_VALUE_BYTES
    ) {
      throw safeError('local_mcp_environment_denied')
    }
    childEnvironment[name] = value
  }
  return childEnvironment
}

function createProtocolChannel(
  child: ChildProcessWithoutNullStreams,
  onFatal: (error: Error) => void,
) {
  const pending = new Map<number, PendingRequest>()
  let nextRequestId = 1
  let stdoutBuffer = Buffer.alloc(0)
  let stderrBytes = 0

  function rejectAll(error: Error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.clear()
  }

  function handleMessage(line: Buffer) {
    if (line.length === 0 || line.length > MAX_STDIO_MESSAGE_BYTES || line.includes(0x0d)) {
      onFatal(safeError('local_mcp_protocol_error'))
      return
    }
    let message: unknown
    try {
      message = JSON.parse(line.toString('utf8'))
    } catch {
      onFatal(safeError('local_mcp_protocol_error'))
      return
    }
    if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
      onFatal(safeError('local_mcp_protocol_error'))
      return
    }
    if (!Number.isInteger(message.id)) {
      if (
        typeof message.method === 'string' &&
        message.method.startsWith('notifications/') &&
        !Object.hasOwn(message, 'id')
      ) {
        return
      }
      onFatal(safeError('local_mcp_protocol_error'))
      return
    }
    const id = Number(message.id)
    const request = pending.get(id)
    if (!request || !hasExactKeys(message, ['jsonrpc', 'id', Object.hasOwn(message, 'result') ? 'result' : 'error'])) {
      onFatal(safeError('local_mcp_protocol_error'))
      return
    }
    pending.delete(id)
    clearTimeout(request.timeout)
    if (Object.hasOwn(message, 'error')) {
      request.reject(safeError('local_mcp_remote_error'))
    } else {
      request.resolve(message.result)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
    while (true) {
      const newline = stdoutBuffer.indexOf(0x0a)
      if (newline === -1) break
      const line = stdoutBuffer.subarray(0, newline)
      stdoutBuffer = stdoutBuffer.subarray(newline + 1)
      handleMessage(line)
    }
    if (stdoutBuffer.length > MAX_STDIO_MESSAGE_BYTES) {
      onFatal(safeError('local_mcp_protocol_error'))
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length
    if (stderrBytes > MAX_STDERR_BYTES) onFatal(safeError('local_mcp_stderr_overflow'))
  })

  function send(message: JsonRecord) {
    if (!child.stdin.writable) throw safeError('local_mcp_closed')
    const serialized = JSON.stringify(message)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STDIO_MESSAGE_BYTES) {
      throw safeError('local_mcp_message_too_large')
    }
    child.stdin.write(`${serialized}\n`, 'utf8')
  }

  return {
    request(method: string, params: JsonRecord, deadlineMs: number): Promise<unknown> {
      const id = nextRequestId++
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          try {
            send({
              jsonrpc: '2.0',
              method: 'notifications/cancelled',
              params: { requestId: id, reason: 'deadline exceeded' },
            })
          } catch {
            // The owning lifecycle will terminate a closed or unresponsive child.
          }
          reject(safeError('local_mcp_deadline_exceeded'))
        }, deadlineMs)
        pending.set(id, { resolve, reject, timeout })
        try {
          send({ jsonrpc: '2.0', id, method, params })
        } catch (error) {
          clearTimeout(timeout)
          pending.delete(id)
          reject(error instanceof Error ? error : safeError('local_mcp_protocol_error'))
        }
      })
    },
    notify(method: string, params: JsonRecord = {}) {
      send({ jsonrpc: '2.0', method, ...(Object.keys(params).length > 0 ? { params } : {}) })
    },
    rejectAll,
  }
}

function parseInitializeResult(
  value: unknown,
  installation: LocalMcpInstallation,
): { name: string; version: string } {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['protocolVersion', 'capabilities', 'serverInfo']) ||
    value.protocolVersion !== LOCAL_MCP_PROTOCOL_VERSION ||
    !isPlainObject(value.capabilities) ||
    !hasExactKeys(value.capabilities, ['tools']) ||
    !isPlainObject(value.capabilities.tools) ||
    !hasExactKeys(value.capabilities.tools, ['listChanged']) ||
    value.capabilities.tools.listChanged !== false ||
    !isPlainObject(value.serverInfo) ||
    !hasExactKeys(value.serverInfo, ['name', 'version']) ||
    value.serverInfo.name !== installation.expectedServer.name ||
    value.serverInfo.version !== installation.expectedServer.version
  ) {
    throw safeError('local_mcp_identity_mismatch')
  }
  return { name: installation.expectedServer.name, version: installation.expectedServer.version }
}

function parseDiscoveredTools(
  value: unknown,
  installation: LocalMcpInstallation,
): NativeToolDefinition[] {
  if (!isPlainObject(value) || !hasExactKeys(value, ['tools']) || !Array.isArray(value.tools)) {
    throw safeError('local_mcp_discovery_invalid')
  }
  const discovered = new Map<string, JsonRecord>()
  for (const tool of value.tools) {
    if (
      !isPlainObject(tool) ||
      !hasExactKeys(tool, ['name', 'description', 'inputSchema', 'outputSchema']) ||
      typeof tool.name !== 'string' ||
      discovered.has(tool.name)
    ) {
      throw safeError('local_mcp_discovery_invalid')
    }
    discovered.set(tool.name, tool)
  }
  if (
    discovered.size !== installation.expectedTools.length ||
    installation.expectedTools.some((policy) => !discovered.has(policy.name))
  ) {
    throw safeError('local_mcp_discovery_invalid')
  }

  return installation.expectedTools.map((policy) => {
    const tool = discovered.get(policy.name)!
    try {
      return parseNativeToolDefinition({
        stateVersion: 1,
        id: policy.name,
        version: installation.version,
        source: 'mcp',
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        permissionClass: policy.permissionClass,
        sideEffectClass: policy.sideEffectClass,
        defaultDeadlineMs: installation.callDeadlineMs,
        maxResultBytes: policy.maxResultBytes,
        idempotency: policy.idempotency,
        auditPolicy: 'redacted_metadata_only',
      })
    } catch {
      throw safeError('local_mcp_discovery_invalid')
    }
  })
}

function parseToolResult(value: unknown, definition: NativeToolDefinition): unknown {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['content', 'structuredContent', 'isError']) ||
    value.isError !== false ||
    !Array.isArray(value.content) ||
    value.content.length !== 1 ||
    !isPlainObject(value.content[0]) ||
    !hasExactKeys(value.content[0], ['type', 'text']) ||
    value.content[0].type !== 'text' ||
    typeof value.content[0].text !== 'string' ||
    !validateNativeToolValue(definition.outputSchema, value.structuredContent)
  ) {
    throw safeError('local_mcp_tool_result_invalid')
  }
  return value.structuredContent
}

export async function createLocalMcpClient(input: {
  installation: LocalMcpInstallation
  localProjectPath: string
  environment: Readonly<Record<string, string | undefined>>
  authorizeCall: (installation: LocalMcpInstallation) => Promise<void>
}): Promise<LocalMcpClient> {
  const installation = parseLocalMcpInstallation(input.installation)
  if (!installation.enabled) throw safeError('local_mcp_disabled')
  const [{ executablePath }, canonicalProjectPath, projectMetadata] = await Promise.all([
    verifyLocalMcpExecutable(installation),
    realpath(input.localProjectPath),
    stat(input.localProjectPath),
  ])
  if (!projectMetadata.isDirectory()) throw safeError('local_mcp_project_invalid')
  const environment = buildEnvironment(installation, input.environment)
  try {
    await input.authorizeCall(installation)
  } catch {
    throw safeError('local_mcp_installation_stale')
  }
  const child = spawn(executablePath, installation.args, {
    cwd: canonicalProjectPath,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let closed = false
  let closing = false
  let fatalError: Error | null = null
  let resolveExit!: () => void
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const channel = createProtocolChannel(child, (error) => {
    if (fatalError) return
    fatalError = error
    channel.rejectAll(error)
    child.kill('SIGKILL')
  })
  child.once('error', (error) => {
    if (!fatalError) {
      fatalError = safeError('local_mcp_spawn_failed')
      channel.rejectAll(fatalError)
    }
  })
  child.once('exit', () => {
    if (!closing && !fatalError) {
      fatalError = safeError('local_mcp_process_exited')
      channel.rejectAll(fatalError)
    }
  })
  child.once('close', () => {
    closed = true
    resolveExit()
  })

  async function waitForExit(timeoutMs: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs)
    })
    const result = await Promise.race([exited.then(() => true), timedOut])
    if (timeout) clearTimeout(timeout)
    return result
  }

  async function shutdown() {
    if (closing || closed) return
    closing = true
    channel.rejectAll(safeError('local_mcp_closed'))
    child.stdin.end()
    if (await waitForExit(SHUTDOWN_GRACE_MS)) return
    child.kill('SIGTERM')
    if (await waitForExit(SHUTDOWN_GRACE_MS)) return
    child.kill('SIGKILL')
    await waitForExit(SHUTDOWN_GRACE_MS)
  }

  try {
    const initializeResult = await channel.request(
      'initialize',
      {
        protocolVersion: LOCAL_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ai-devflow-studio', version: '2.0.0' },
      },
      installation.startupDeadlineMs,
    )
    const serverInfo = parseInitializeResult(initializeResult, installation)
    channel.notify('notifications/initialized')
    const toolsResult = await channel.request('tools/list', {}, installation.startupDeadlineMs)
    const tools = parseDiscoveredTools(toolsResult, installation)
    const capabilitySetDigest = digestNativeToolValue({
      installationId: installation.id,
      installationVersion: installation.version,
      executableSha256: installation.executableSha256,
      serverInfo,
      tools,
    })
    return {
      installation,
      serverInfo,
      tools,
      capabilitySetDigest,
      get closed() {
        return closed
      },
      async callTool({ toolName, input: toolInput, signal }) {
        const definition = tools.find((tool) => tool.id === toolName)
        if (
          closed ||
          closing ||
          !definition ||
          !validateNativeToolValue(definition.inputSchema, toolInput)
        ) {
          throw safeError('local_mcp_tool_call_invalid')
        }
        if (signal?.aborted) {
          await shutdown()
          throw safeError('local_mcp_cancelled')
        }
        let handleAbort: (() => void) | undefined
        try {
          try {
            await input.authorizeCall(installation)
          } catch {
            throw safeError('local_mcp_installation_stale')
          }
          if (signal?.aborted) {
            await shutdown()
            throw safeError('local_mcp_cancelled')
          }
          let rejectAbort!: (error: Error) => void
          const aborted = new Promise<never>((_resolve, reject) => {
            rejectAbort = reject
          })
          handleAbort = () => {
            rejectAbort(safeError('local_mcp_cancelled'))
            void shutdown()
          }
          signal?.addEventListener('abort', handleAbort, { once: true })
          const result = await Promise.race([
            channel.request(
              'tools/call',
              { name: toolName, arguments: toolInput as JsonRecord },
              installation.callDeadlineMs,
            ),
            aborted,
          ])
          return parseToolResult(result, definition)
        } catch (error) {
          if (error instanceof Error && error.message === 'local_mcp_cancelled') throw error
          await shutdown()
          throw error
        } finally {
          if (handleAbort) signal?.removeEventListener('abort', handleAbort)
        }
      },
      shutdown,
    }
  } catch (error) {
    await shutdown()
    throw fatalError ?? (error instanceof Error ? error : safeError('local_mcp_start_failed'))
  }
}

export function createLocalMcpToolRegistrations(
  client: LocalMcpClient,
): NativeToolRegistration[] {
  return client.tools.map((definition) => ({
    definition,
    installation: {
      id: client.installation.id,
      version: client.installation.version,
    },
    handler: ({ input, signal }) =>
      client.callTool({ toolName: definition.id, input, signal }),
  }))
}

export function createLocalMcpToolRegistry(
  client: LocalMcpClient,
  input: {
    clock?: () => string
    createId?: () => string
    redactResult?: (value: unknown) => { value: unknown; redacted: boolean }
    persistence?: NativeToolRegistryPersistence
  } = {},
): NativeToolRegistry {
  return createNativeToolRegistry({
    tools: createLocalMcpToolRegistrations(client),
    capabilitySetDigest: client.capabilitySetDigest,
    ...input,
  })
}
