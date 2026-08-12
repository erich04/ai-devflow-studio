import { createHash, randomUUID } from 'node:crypto'
import {
  parseNativeToolDefinition,
  redactSensitiveValue,
  validateNativeToolValue,
  type AgentRuntimeScope,
  type AgentRuntimeState,
  type NativeToolDefinition,
  type NativeToolPermissionClass,
} from '@ai-devflow/shared'

export type NativeToolResourceScope =
  | {
      kind: 'local_project'
      localProjectId: string
    }
  | {
      kind: 'managed_workspace'
      localProjectId: string
      workspaceId: string
    }

export type NativeToolPermission = {
  decision: 'approved'
  permissionClass: NativeToolPermissionClass
  decidedAt: string
  expiresAt: string
}

export type NativeToolHandlerContext = {
  runtime: AgentRuntimeState
  resourceScope: NativeToolResourceScope
  signal: AbortSignal
  input: unknown
}

export type NativeToolHandler = (context: NativeToolHandlerContext) => Promise<unknown>

export type NativeToolRegistration = {
  definition: NativeToolDefinition
  handler: NativeToolHandler
}

export type NativeToolCapabilityGrant = object

export type NativeToolAuditStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout'

export type NativeToolAuditRecord = {
  stateVersion: 1
  id: string
  runtimeId: string
  actionId: string
  grantId: string
  organizationId: string | null
  projectId: string | null
  userId: string
  sessionId: string
  localProjectId: string
  toolId: string
  toolVersion: number
  permissionClass: NativeToolPermissionClass
  sideEffectClass: NativeToolDefinition['sideEffectClass']
  resourceKind: NativeToolResourceScope['kind']
  resourceId: string
  status: NativeToolAuditStatus
  code: NativeToolExecutionErrorCode | null
  inputDigest: string
  resultDigest: string | null
  resultBytes: number | null
  redactionState: 'not_recorded' | 'passed' | 'applied' | 'failed'
  createdAt: string
}

export type NativeToolExecutionErrorCode =
  | 'invalid_grant'
  | 'grant_expired'
  | 'grant_exhausted'
  | 'runtime_mismatch'
  | 'action_mismatch'
  | 'invalid_input'
  | 'invalid_output'
  | 'result_too_large'
  | 'redaction_failed'
  | 'deadline_exceeded'
  | 'cancelled'
  | 'handler_failed'

export class NativeToolExecutionError extends Error {
  readonly code: NativeToolExecutionErrorCode

  constructor(code: NativeToolExecutionErrorCode) {
    super(`Native Tool execution failed: ${code}`)
    this.name = 'NativeToolExecutionError'
    this.code = code
  }
}

type GrantRecord = {
  id: string
  runtimeId: string
  runtimeScope: AgentRuntimeScope
  runtimeAuthority: AgentRuntimeState['authority']
  contextDigest: string
  capabilitySetDigest: string
  toolId: string
  toolVersion: number
  permission: NativeToolPermission
  sideEffectClass: NativeToolDefinition['sideEffectClass']
  resourceScope: NativeToolResourceScope
  remainingCalls: number
}

type ActiveExecution = {
  controller: AbortController
  abortCode: NativeToolExecutionErrorCode
}

export type NativeToolRegistry = {
  listDefinitions(): NativeToolDefinition[]
  issueGrant(input: {
    runtime: AgentRuntimeState
    toolId: string
    toolVersion: number
    permission: NativeToolPermission
    resourceScope: NativeToolResourceScope
    callLimit: number
  }): NativeToolCapabilityGrant
  execute(input: {
    grant: NativeToolCapabilityGrant
    runtime: AgentRuntimeState
    actionId: string
    input: unknown
    signal?: AbortSignal
  }): Promise<{ value: unknown; resultDigest: string; resultBytes: number }>
  cancelRuntime(runtimeId: string): number
  listAuditRecords(runtimeId: string): NativeToolAuditRecord[]
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non_json_value')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error('non_json_value')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  }
  throw new Error('non_json_value')
}

export function digestNativeToolValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function canonicalTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('invalid_native_tool_timestamp')
  }
  return timestamp
}

function exactScope(left: AgentRuntimeScope, right: AgentRuntimeScope): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function exactAuthority(
  left: AgentRuntimeState['authority'],
  right: AgentRuntimeState['authority'],
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}

export function createNativeToolRegistry(input: {
  tools: NativeToolRegistration[]
  clock?: () => string
  createId?: () => string
  redactResult?: (value: unknown) => { value: unknown; redacted: boolean }
}): NativeToolRegistry {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? (() => `native-tool-${randomUUID()}`)
  const redactResult = input.redactResult ?? redactSensitiveValue
  const tools = new Map<string, NativeToolRegistration>()
  const grants = new WeakMap<NativeToolCapabilityGrant, GrantRecord>()
  const activeByRuntime = new Map<string, Set<ActiveExecution>>()
  const auditRecords: NativeToolAuditRecord[] = []

  for (const registration of input.tools) {
    const definition = parseNativeToolDefinition(registration.definition)
    const key = `${definition.id}@${definition.version}`
    if (tools.has(key)) throw new Error('duplicate_native_tool_definition')
    tools.set(key, { definition: deepFreeze(definition), handler: registration.handler })
  }

  function now(): { value: string; timestamp: number } {
    const value = clock()
    return { value, timestamp: canonicalTimestamp(value) }
  }

  function appendAudit(
    grant: GrantRecord,
    runtimeId: string,
    actionId: string,
    inputDigest: string,
    status: NativeToolAuditStatus,
    code: NativeToolExecutionErrorCode | null,
    result?: { digest: string; bytes: number },
    redactionState: NativeToolAuditRecord['redactionState'] = 'not_recorded',
  ) {
    auditRecords.push({
      stateVersion: 1,
      id: createId(),
      runtimeId,
      actionId,
      grantId: grant.id,
      organizationId: grant.runtimeScope.organizationId,
      projectId: grant.runtimeScope.projectId,
      userId: grant.runtimeScope.userId,
      sessionId: grant.runtimeScope.sessionId,
      localProjectId: grant.runtimeScope.localProjectId,
      toolId: grant.toolId,
      toolVersion: grant.toolVersion,
      permissionClass: grant.permission.permissionClass,
      sideEffectClass: grant.sideEffectClass,
      resourceKind: grant.resourceScope.kind,
      resourceId:
        grant.resourceScope.kind === 'managed_workspace'
          ? grant.resourceScope.workspaceId
          : grant.resourceScope.localProjectId,
      status,
      code,
      inputDigest,
      resultDigest: result?.digest ?? null,
      resultBytes: result?.bytes ?? null,
      redactionState,
      createdAt: now().value,
    })
  }

  function fail(code: NativeToolExecutionErrorCode): never {
    throw new NativeToolExecutionError(code)
  }

  return {
    listDefinitions() {
      return [...tools.values()].map(({ definition }) => clone(definition))
    },

    issueGrant({ runtime, toolId, toolVersion, permission, resourceScope, callLimit }) {
      const tool = tools.get(`${toolId}@${toolVersion}`)
      const current = now().timestamp
      const decidedAt = canonicalTimestamp(permission.decidedAt)
      const expiresAt = canonicalTimestamp(permission.expiresAt)
      const runtimeDeadline = canonicalTimestamp(runtime.deadline)
      if (
        !tool ||
        runtime.status !== 'waiting_action' ||
        runtime.stopReason !== null ||
        runtime.activeAction?.kind !== 'tool' ||
        runtime.activeAction.id === '' ||
        runtime.activeAction.capabilityId !== toolId ||
        runtime.activeAction.capabilityVersion !== toolVersion ||
        permission.decision !== 'approved' ||
        permission.permissionClass !== tool.definition.permissionClass ||
        decidedAt > current ||
        expiresAt <= current ||
        expiresAt > runtimeDeadline ||
        !Number.isInteger(callLimit) ||
        callLimit < 1 ||
        callLimit > runtime.bounds.maxToolCalls - runtime.counters.toolCalls ||
        resourceScope.localProjectId !== runtime.scope.localProjectId
      ) {
        throw new Error('invalid_native_tool_grant')
      }
      const capability = Object.freeze(Object.create(null)) as NativeToolCapabilityGrant
      grants.set(capability, {
        id: createId(),
        runtimeId: runtime.id,
        runtimeScope: clone(runtime.scope),
        runtimeAuthority: clone(runtime.authority),
        contextDigest: runtime.contextDigest,
        capabilitySetDigest: runtime.capabilitySetDigest,
        toolId,
        toolVersion,
        permission: clone(permission),
        sideEffectClass: tool.definition.sideEffectClass,
        resourceScope: clone(resourceScope),
        remainingCalls: callLimit,
      })
      return capability
    },

    async execute({ grant, runtime, actionId, input: toolInput, signal }) {
      const record = grants.get(grant)
      if (!record) fail('invalid_grant')
      const tool = tools.get(`${record.toolId}@${record.toolVersion}`)
      if (!tool) fail('invalid_grant')
      const current = now().timestamp
      if (canonicalTimestamp(record.permission.expiresAt) <= current) fail('grant_expired')
      if (record.remainingCalls < 1) fail('grant_exhausted')
      if (
        runtime.id !== record.runtimeId ||
        !exactScope(runtime.scope, record.runtimeScope) ||
        !exactAuthority(runtime.authority, record.runtimeAuthority) ||
        runtime.contextDigest !== record.contextDigest ||
        runtime.capabilitySetDigest !== record.capabilitySetDigest
      ) {
        fail('runtime_mismatch')
      }
      if (
        runtime.status !== 'waiting_action' ||
        runtime.stopReason !== null ||
        runtime.activeAction?.kind !== 'tool' ||
        runtime.activeAction.id !== actionId ||
        runtime.activeAction.capabilityId !== record.toolId ||
        runtime.activeAction.capabilityVersion !== record.toolVersion
      ) {
        fail('action_mismatch')
      }
      if (!validateNativeToolValue(tool.definition.inputSchema, toolInput)) fail('invalid_input')
      const inputDigest = digestNativeToolValue(toolInput)
      if (inputDigest !== runtime.activeAction.requestDigest) fail('action_mismatch')

      record.remainingCalls -= 1
      appendAudit(record, runtime.id, actionId, inputDigest, 'started', null)

      const active: ActiveExecution = {
        controller: new AbortController(),
        abortCode: 'cancelled',
      }
      const activeSet = activeByRuntime.get(runtime.id) ?? new Set<ActiveExecution>()
      activeSet.add(active)
      activeByRuntime.set(runtime.id, activeSet)
      const forwardAbort = () => {
        active.abortCode = 'cancelled'
        active.controller.abort()
      }
      signal?.addEventListener('abort', forwardAbort, { once: true })
      if (signal?.aborted) forwardAbort()
      const timeout = setTimeout(() => {
        active.abortCode = 'deadline_exceeded'
        active.controller.abort()
      }, tool.definition.defaultDeadlineMs)

      const aborted = new Promise<never>((_resolve, reject) => {
        const rejectAbort = () => reject(new NativeToolExecutionError(active.abortCode))
        if (active.controller.signal.aborted) rejectAbort()
        else active.controller.signal.addEventListener('abort', rejectAbort, { once: true })
      })
      const handled = Promise.resolve().then(() =>
        tool.handler({
          runtime: clone(runtime),
          resourceScope: clone(record.resourceScope),
          signal: active.controller.signal,
          input: clone(toolInput),
        }),
      )

      try {
        const rawValue = await Promise.race([handled, aborted])
        if (!validateNativeToolValue(tool.definition.outputSchema, rawValue)) {
          appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'invalid_output')
          fail('invalid_output')
        }
        let redaction: { value: unknown; redacted: boolean }
        try {
          redaction = redactResult(rawValue)
        } catch {
          appendAudit(
            record,
            runtime.id,
            actionId,
            inputDigest,
            'failed',
            'redaction_failed',
            undefined,
            'failed',
          )
          fail('redaction_failed')
        }
        const value = redaction.value
        if (!validateNativeToolValue(tool.definition.outputSchema, value)) {
          appendAudit(
            record,
            runtime.id,
            actionId,
            inputDigest,
            'failed',
            'redaction_failed',
            undefined,
            'failed',
          )
          fail('redaction_failed')
        }
        let serialized: string
        try {
          serialized = canonicalJson(value)
        } catch {
          appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'invalid_output')
          fail('invalid_output')
        }
        const resultBytes = Buffer.byteLength(serialized, 'utf8')
        if (
          resultBytes > tool.definition.maxResultBytes ||
          resultBytes > runtime.bounds.maxToolResultBytes
        ) {
          appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'result_too_large')
          fail('result_too_large')
        }
        const resultDigest = createHash('sha256').update(serialized, 'utf8').digest('hex')
        appendAudit(
          record,
          runtime.id,
          actionId,
          inputDigest,
          'succeeded',
          null,
          { digest: resultDigest, bytes: resultBytes },
          redaction.redacted ? 'applied' : 'passed',
        )
        return { value: clone(value), resultDigest, resultBytes }
      } catch (error) {
        if (error instanceof NativeToolExecutionError) {
          if (error.code === 'cancelled') {
            appendAudit(record, runtime.id, actionId, inputDigest, 'cancelled', error.code)
          } else if (error.code === 'deadline_exceeded') {
            appendAudit(record, runtime.id, actionId, inputDigest, 'timeout', error.code)
          }
          throw error
        }
        appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'handler_failed')
        throw new NativeToolExecutionError('handler_failed')
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', forwardAbort)
        activeSet.delete(active)
        if (activeSet.size === 0) activeByRuntime.delete(runtime.id)
      }
    },

    cancelRuntime(runtimeId) {
      const active = activeByRuntime.get(runtimeId)
      if (!active) return 0
      for (const execution of active) {
        execution.abortCode = 'cancelled'
        execution.controller.abort()
      }
      return active.size
    },

    listAuditRecords(runtimeId) {
      return auditRecords
        .filter((record) => record.runtimeId === runtimeId)
        .map((record) => clone(record))
    },
  }
}
