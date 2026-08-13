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
  installation?: { id: string; version: number }
  resourceKinds?: readonly NativeToolResourceScope['kind'][]
  handler: NativeToolHandler
}

export type NativeToolCapabilityGrant = object

export type NativeToolCapabilityGrantRecord = {
  stateVersion: 1
  id: string
  runtimeId: string
  capabilityId: string
  capabilityVersion: number
  requestDigest: string
  permissionClass: NativeToolPermissionClass
  resourceKind: NativeToolResourceScope['kind']
  resourceId: string
  status: 'active' | 'consumed' | 'denied' | 'expired' | 'cancelled'
  grantedAt: string
  expiresAt: string
  settledAt: string | null
}

export type NativeToolRegistryPersistence = {
  reserveGrant(
    grant: NativeToolCapabilityGrantRecord,
  ): Promise<{ reserved: boolean }>
  beginExecution(input: {
    expectedGrant: NativeToolCapabilityGrantRecord
    audit: NativeToolAuditRecord
  }): Promise<{ consumed: boolean }>
  appendAudit(audit: NativeToolAuditRecord): Promise<void>
}

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
  source: NativeToolDefinition['source']
  installationId: string | null
  installationVersion: number | null
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
  | 'audit_failed'

const auditIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const auditToolIdentifierPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u
const digestPattern = /^[a-f0-9]{64}$/u
const failureCodes: NativeToolExecutionErrorCode[] = [
  'invalid_output',
  'result_too_large',
  'redaction_failed',
  'handler_failed',
]

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
  source: NativeToolDefinition['source']
  installationId: string | null
  installationVersion: number | null
  permission: NativeToolPermission
  sideEffectClass: NativeToolDefinition['sideEffectClass']
  resourceScope: NativeToolResourceScope
  remainingCalls: number
  durableGrant: NativeToolCapabilityGrantRecord
}

type ActiveExecution = {
  controller: AbortController
  abortCode: NativeToolExecutionErrorCode
}

export type NativeToolRegistry = {
  listDefinitions(): NativeToolDefinition[]
  capabilitySetDigest(): string
  issueGrant(input: {
    runtime: AgentRuntimeState
    toolId: string
    toolVersion: number
    permission: NativeToolPermission
    resourceScope: NativeToolResourceScope
    callLimit: number
  }): Promise<NativeToolCapabilityGrant>
  restoreGrant(input: {
    runtime: AgentRuntimeState
    durableGrant: NativeToolCapabilityGrantRecord
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactAuditKeys(value: Record<string, unknown>): boolean {
  const expected = [
    'stateVersion',
    'id',
    'runtimeId',
    'actionId',
    'grantId',
    'organizationId',
    'projectId',
    'userId',
    'sessionId',
    'localProjectId',
    'toolId',
    'toolVersion',
    'source',
    'installationId',
    'installationVersion',
    'permissionClass',
    'sideEffectClass',
    'resourceKind',
    'resourceId',
    'status',
    'code',
    'inputDigest',
    'resultDigest',
    'resultBytes',
    'redactionState',
    'createdAt',
  ].sort()
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

export function parseNativeToolAuditRecord(value: unknown): NativeToolAuditRecord {
  try {
    if (
      !isPlainRecord(value) ||
      !hasExactAuditKeys(value) ||
      value.stateVersion !== 1 ||
      ![value.id, value.runtimeId, value.actionId, value.grantId, value.userId, value.sessionId,
        value.localProjectId, value.resourceId].every(
        (item) => typeof item === 'string' && auditIdentifierPattern.test(item),
      ) ||
      !(
        (value.organizationId === null && value.projectId === null) ||
        (typeof value.organizationId === 'string' &&
          auditIdentifierPattern.test(value.organizationId) &&
          typeof value.projectId === 'string' &&
          auditIdentifierPattern.test(value.projectId))
      ) ||
      typeof value.toolId !== 'string' ||
      value.toolId.length > 200 ||
      !auditToolIdentifierPattern.test(value.toolId) ||
      !Number.isInteger(value.toolVersion) ||
      Number(value.toolVersion) < 1 ||
      Number(value.toolVersion) > 2_147_483_647 ||
      !['native', 'mcp'].includes(String(value.source)) ||
      !(
        (value.source === 'native' &&
          value.installationId === null &&
          value.installationVersion === null) ||
        (value.source === 'mcp' &&
          typeof value.installationId === 'string' &&
          auditIdentifierPattern.test(value.installationId) &&
          Number.isInteger(value.installationVersion) &&
          Number(value.installationVersion) >= 1 &&
          Number(value.installationVersion) <= 2_147_483_647)
      ) ||
      !['read', 'edit', 'execute'].includes(String(value.permissionClass)) ||
      !['none', 'workspace_write', 'local_process'].includes(String(value.sideEffectClass)) ||
      !['local_project', 'managed_workspace'].includes(String(value.resourceKind)) ||
      (value.resourceKind === 'local_project' && value.resourceId !== value.localProjectId) ||
      !['started', 'succeeded', 'failed', 'cancelled', 'timeout'].includes(String(value.status)) ||
      typeof value.inputDigest !== 'string' ||
      !digestPattern.test(value.inputDigest) ||
      typeof value.createdAt !== 'string'
    ) {
      throw new Error('invalid')
    }
    canonicalTimestamp(value.createdAt)
    const status = value.status as NativeToolAuditStatus
    const code = value.code as NativeToolExecutionErrorCode | null
    const resultDigest = value.resultDigest
    const resultBytes = value.resultBytes
    const redactionState = value.redactionState
    const validResult =
      typeof resultDigest === 'string' &&
      digestPattern.test(resultDigest) &&
      Number.isInteger(resultBytes) &&
      Number(resultBytes) >= 0 &&
      Number(resultBytes) <= 256 * 1_024
    const validTerminalShape =
      (status === 'started' &&
        code === null &&
        resultDigest === null &&
        resultBytes === null &&
        redactionState === 'not_recorded') ||
      (status === 'succeeded' &&
        code === null &&
        validResult &&
        (redactionState === 'passed' || redactionState === 'applied')) ||
      (status === 'failed' &&
        failureCodes.includes(code as NativeToolExecutionErrorCode) &&
        resultDigest === null &&
        resultBytes === null &&
        (code === 'redaction_failed'
          ? redactionState === 'failed'
          : redactionState === 'not_recorded')) ||
      (status === 'cancelled' &&
        code === 'cancelled' &&
        resultDigest === null &&
        resultBytes === null &&
        redactionState === 'not_recorded') ||
      (status === 'timeout' &&
        code === 'deadline_exceeded' &&
        resultDigest === null &&
        resultBytes === null &&
        redactionState === 'not_recorded')
    if (!validTerminalShape) throw new Error('invalid')
    return clone(value as NativeToolAuditRecord)
  } catch {
    throw new Error('invalid_native_tool_audit')
  }
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

function defaultResourceKinds(
  definition: NativeToolDefinition,
): readonly NativeToolResourceScope['kind'][] {
  return definition.sideEffectClass === 'workspace_write'
    ? ['managed_workspace']
    : ['local_project']
}

function compatibleResourceScope(
  registration: NativeToolRegistration,
  resourceScope: NativeToolResourceScope,
): boolean {
  return (registration.resourceKinds ?? defaultResourceKinds(registration.definition)).includes(
    resourceScope.kind,
  )
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
  capabilitySetDigest?: string
  clock?: () => string
  createId?: () => string
  redactResult?: (value: unknown) => { value: unknown; redacted: boolean }
  persistence?: NativeToolRegistryPersistence
}): NativeToolRegistry {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? (() => `native-tool-${randomUUID()}`)
  const redactResult = input.redactResult ?? redactSensitiveValue
  const tools = new Map<string, NativeToolRegistration>()
  const grants = new WeakMap<NativeToolCapabilityGrant, GrantRecord>()
  const activeByRuntime = new Map<string, Set<ActiveExecution>>()
  const auditRecords: NativeToolAuditRecord[] = []

  if (input.capabilitySetDigest !== undefined && !digestPattern.test(input.capabilitySetDigest)) {
    throw new Error('invalid_native_tool_capability_set')
  }

  for (const registration of input.tools) {
    const definition = parseNativeToolDefinition(registration.definition)
    const installation = registration.installation
    const resourceKinds = registration.resourceKinds ?? defaultResourceKinds(definition)
    if (
      (definition.source === 'native' && installation !== undefined) ||
      (definition.source === 'mcp' &&
        (!installation ||
          !auditIdentifierPattern.test(installation.id) ||
          !Number.isInteger(installation.version) ||
          installation.version < 1 ||
          installation.version > 2_147_483_647))
    ) {
      throw new Error('invalid_native_tool_installation_authority')
    }
    if (
      resourceKinds.length !== 1 ||
      !['local_project', 'managed_workspace'].includes(String(resourceKinds[0])) ||
      (definition.sideEffectClass === 'workspace_write' &&
        resourceKinds[0] !== 'managed_workspace')
    ) {
      throw new Error('invalid_native_tool_resource_authority')
    }
    const key = `${definition.id}@${definition.version}`
    if (tools.has(key)) throw new Error('duplicate_native_tool_definition')
    tools.set(key, {
      definition: deepFreeze(definition),
      ...(installation ? { installation: deepFreeze(clone(installation)) } : {}),
      resourceKinds: deepFreeze([...resourceKinds]),
      handler: registration.handler,
    })
  }

  function now(): { value: string; timestamp: number } {
    const value = clock()
    return { value, timestamp: canonicalTimestamp(value) }
  }

  async function appendAudit(
    grant: GrantRecord,
    runtimeId: string,
    actionId: string,
    inputDigest: string,
    status: NativeToolAuditStatus,
    code: NativeToolExecutionErrorCode | null,
    result?: { digest: string; bytes: number },
    redactionState: NativeToolAuditRecord['redactionState'] = 'not_recorded',
    persistenceMode: 'begin' | 'append' = 'append',
  ): Promise<void> {
    const audit: NativeToolAuditRecord = {
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
      source: grant.source,
      installationId: grant.installationId,
      installationVersion: grant.installationVersion,
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
    }
    try {
      if (input.persistence && persistenceMode === 'begin') {
        const begun = await input.persistence.beginExecution({
          expectedGrant: grant.durableGrant,
          audit,
        })
        if (!begun.consumed) throw new NativeToolExecutionError('invalid_grant')
      } else if (input.persistence) {
        await input.persistence.appendAudit(audit)
      }
    } catch (error) {
      if (error instanceof NativeToolExecutionError) throw error
      throw new NativeToolExecutionError('audit_failed')
    }
    auditRecords.push(audit)
  }

  function fail(code: NativeToolExecutionErrorCode): never {
    throw new NativeToolExecutionError(code)
  }

  function installCapability(input: {
    runtime: AgentRuntimeState
    tool: NativeToolRegistration
    resourceScope: NativeToolResourceScope
    durableGrant: NativeToolCapabilityGrantRecord
    permission: NativeToolPermission
  }): NativeToolCapabilityGrant {
    const capability = Object.freeze(Object.create(null)) as NativeToolCapabilityGrant
    grants.set(capability, {
      id: input.durableGrant.id,
      runtimeId: input.runtime.id,
      runtimeScope: clone(input.runtime.scope),
      runtimeAuthority: clone(input.runtime.authority),
      contextDigest: input.runtime.contextDigest,
      capabilitySetDigest: input.runtime.capabilitySetDigest,
      toolId: input.durableGrant.capabilityId,
      toolVersion: input.durableGrant.capabilityVersion,
      source: input.tool.definition.source,
      installationId: input.tool.installation?.id ?? null,
      installationVersion: input.tool.installation?.version ?? null,
      permission: clone(input.permission),
      sideEffectClass: input.tool.definition.sideEffectClass,
      resourceScope: clone(input.resourceScope),
      remainingCalls: 1,
      durableGrant: clone(input.durableGrant),
    })
    return capability
  }

  return {
    listDefinitions() {
      return [...tools.values()].map(({ definition }) => clone(definition))
    },

    capabilitySetDigest() {
      return input.capabilitySetDigest ?? digestNativeToolValue(
        [...tools.values()].map(({ definition, resourceKinds }) => ({
          definition,
          resourceKinds,
        })),
      )
    },

    async issueGrant({ runtime, toolId, toolVersion, permission, resourceScope, callLimit }) {
      const tool = tools.get(`${toolId}@${toolVersion}`)
      const granted = now()
      const current = granted.timestamp
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
        (input.capabilitySetDigest !== undefined &&
          runtime.capabilitySetDigest !== input.capabilitySetDigest) ||
        permission.decision !== 'approved' ||
        permission.permissionClass !== tool.definition.permissionClass ||
        decidedAt > current ||
        expiresAt <= current ||
        expiresAt > runtimeDeadline ||
        callLimit !== 1 ||
        runtime.counters.toolCalls < 1 ||
        runtime.counters.toolCalls > runtime.bounds.maxToolCalls ||
        resourceScope.localProjectId !== runtime.scope.localProjectId ||
        !compatibleResourceScope(tool, resourceScope)
      ) {
        throw new Error('invalid_native_tool_grant')
      }
      const grantId = createId()
      const durableGrant: NativeToolCapabilityGrantRecord = {
        stateVersion: 1,
        id: grantId,
        runtimeId: runtime.id,
        capabilityId: toolId,
        capabilityVersion: toolVersion,
        requestDigest: runtime.activeAction.requestDigest,
        permissionClass: permission.permissionClass,
        resourceKind: resourceScope.kind,
        resourceId:
          resourceScope.kind === 'managed_workspace'
            ? resourceScope.workspaceId
            : resourceScope.localProjectId,
        status: 'active',
        grantedAt: granted.value,
        expiresAt: permission.expiresAt,
        settledAt: null,
      }
      if (input.persistence) {
        try {
          const reserved = await input.persistence.reserveGrant(durableGrant)
          if (!reserved.reserved) throw new Error('not_reserved')
        } catch {
          throw new Error('invalid_native_tool_grant')
        }
      }
      return installCapability({
        runtime,
        tool,
        resourceScope,
        durableGrant,
        permission,
      })
    },

    restoreGrant({ runtime, durableGrant }) {
      const tool = tools.get(`${durableGrant.capabilityId}@${durableGrant.capabilityVersion}`)
      const resourceScope: NativeToolResourceScope =
        durableGrant.resourceKind === 'managed_workspace'
          ? {
              kind: 'managed_workspace',
              localProjectId: runtime.scope.localProjectId,
              workspaceId: durableGrant.resourceId,
            }
          : {
              kind: 'local_project',
              localProjectId: durableGrant.resourceId,
            }
      if (
        !tool ||
        durableGrant.stateVersion !== 1 ||
        !auditIdentifierPattern.test(durableGrant.id) ||
        durableGrant.runtimeId !== runtime.id ||
        !digestPattern.test(durableGrant.requestDigest) ||
        durableGrant.status !== 'active' ||
        durableGrant.settledAt !== null ||
        runtime.status !== 'waiting_action' ||
        runtime.stopReason !== null ||
        runtime.activeAction?.kind !== 'tool' ||
        runtime.activeAction.capabilityId !== durableGrant.capabilityId ||
        runtime.activeAction.capabilityVersion !== durableGrant.capabilityVersion ||
        runtime.activeAction.requestDigest !== durableGrant.requestDigest ||
        (input.capabilitySetDigest !== undefined &&
          runtime.capabilitySetDigest !== input.capabilitySetDigest) ||
        durableGrant.permissionClass !== tool.definition.permissionClass ||
        !['local_project', 'managed_workspace'].includes(durableGrant.resourceKind) ||
        !auditIdentifierPattern.test(durableGrant.resourceId) ||
        canonicalTimestamp(durableGrant.grantedAt) > now().timestamp ||
        durableGrant.grantedAt < runtime.updatedAt ||
        canonicalTimestamp(durableGrant.expiresAt) <= canonicalTimestamp(durableGrant.grantedAt) ||
        canonicalTimestamp(durableGrant.expiresAt) > canonicalTimestamp(runtime.deadline) ||
        resourceScope.localProjectId !== runtime.scope.localProjectId ||
        !compatibleResourceScope(tool, resourceScope)
      ) {
        throw new Error('invalid_native_tool_grant')
      }
      return installCapability({
        runtime,
        tool,
        resourceScope,
        durableGrant,
        permission: {
          decision: 'approved',
          permissionClass: tool.definition.permissionClass,
          decidedAt: durableGrant.grantedAt,
          expiresAt: durableGrant.expiresAt,
        },
      })
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
      try {
        await appendAudit(
          record,
          runtime.id,
          actionId,
          inputDigest,
          'started',
          null,
          undefined,
          'not_recorded',
          'begin',
        )
        record.remainingCalls -= 1
        const handled = Promise.resolve().then(() =>
          tool.handler({
            runtime: clone(runtime),
            resourceScope: clone(record.resourceScope),
            signal: active.controller.signal,
            input: clone(toolInput),
          }),
        )
        const rawValue = await Promise.race([handled, aborted])
        if (!validateNativeToolValue(tool.definition.outputSchema, rawValue)) {
          await appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'invalid_output')
          fail('invalid_output')
        }
        let redaction: { value: unknown; redacted: boolean }
        try {
          redaction = redactResult(rawValue)
        } catch {
          await appendAudit(
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
          await appendAudit(
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
          await appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'invalid_output')
          fail('invalid_output')
        }
        const resultBytes = Buffer.byteLength(serialized, 'utf8')
        if (
          resultBytes > tool.definition.maxResultBytes ||
          resultBytes > runtime.bounds.maxToolResultBytes
        ) {
          await appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'result_too_large')
          fail('result_too_large')
        }
        const resultDigest = createHash('sha256').update(serialized, 'utf8').digest('hex')
        await appendAudit(
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
            await appendAudit(record, runtime.id, actionId, inputDigest, 'cancelled', error.code)
          } else if (error.code === 'deadline_exceeded') {
            await appendAudit(record, runtime.id, actionId, inputDigest, 'timeout', error.code)
          }
          throw error
        }
        await appendAudit(record, runtime.id, actionId, inputDigest, 'failed', 'handler_failed')
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
