export const CODING_EXECUTOR_CONTRACT_VERSION = 1 as const

const MAX_VERSION = 2_147_483_647
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const MAX_EVENT_METADATA_BYTES = 64 * 1_024
const digestPattern = /^[a-f0-9]{64}$/u

export const codingExecutorCapabilities = [
  'approved_command',
  'cancellation',
  'checkpoint_continuation',
  'permission_relay',
  'structured_diff',
  'structured_test_evidence',
  'workspace_edit',
  'workspace_read',
] as const

export type CodingExecutorCapability = (typeof codingExecutorCapabilities)[number]
export type CodingExecutorKind = 'opencode' | 'native'
export type CodingExecutorAvailability =
  | { status: 'available'; reasonCode: null }
  | {
      status: 'unavailable'
      reasonCode: 'not_configured' | 'runtime_unavailable' | 'policy_denied'
    }

export type CodingExecutorDescriptor = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  id: string
  version: number
  kind: CodingExecutorKind
  availability: CodingExecutorAvailability
  capabilities: CodingExecutorCapability[]
}

export type CodingExecutorRequest = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  id: string
  executor: { id: string; version: number }
  scope: {
    organizationId: string | null
    projectId: string | null
    userId: string
    sessionId: string
    localProjectId: string
    managedWorkspaceId: string
  }
  authority: { runId: string; nodeId: string; runVersion: number; policyVersion: number }
  objectiveDigest: string
  contextDigest: string
  requiredCapabilities: CodingExecutorCapability[]
  budget: { maxTokens: number; maxCostUsd: number }
  expectedCheckpointVersion: number
  requestedAt: string
  deadline: string
}

export type CodingExecutorEventType =
  | 'started'
  | 'observation'
  | 'tool_request'
  | 'permission_request'
  | 'permission_decision'
  | 'tool_result'
  | 'checkpoint'
  | 'evidence'
  | 'terminal'

export type CodingExecutorEventMetadata = Record<string, string | number | boolean | null>

export type CodingExecutorEvent = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  requestId: string
  sequence: number
  checkpointVersion: number
  type: CodingExecutorEventType
  createdAt: string
  metadata: CodingExecutorEventMetadata
}

export type CodingExecutorStopReason =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timeout'
  | 'policy_denied'

export type CodingExecutorTerminalResult = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  requestId: string
  stopReason: CodingExecutorStopReason
  executor: { id: string; version: number; kind: CodingExecutorKind }
  finalCheckpointVersion: number
  changedPaths: string[]
  diffArtifactId: string | null
  testEvidenceIds: string[]
  usage: { tokens: number; costUsd: number }
  cleanup: {
    status: 'completed' | 'failed' | 'not_required'
    reasonCode: string | null
  }
  completedAt: string
}

export type CodingExecutorTerminalTurn = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  requestId: string
  status: 'terminal'
  checkpointVersion: number
  events: CodingExecutorEvent[]
  terminalResult: CodingExecutorTerminalResult
}

export type CodingExecutorPermissionRequest = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  requestId: string
  id: string
  capability: Extract<CodingExecutorCapability, 'approved_command' | 'workspace_edit'>
  requestDigest: string
  requestedAt: string
  expiresAt: string
}

export type CodingExecutorPermissionTurn = {
  stateVersion: typeof CODING_EXECUTOR_CONTRACT_VERSION
  requestId: string
  status: 'waiting_permission'
  checkpointVersion: number
  events: CodingExecutorEvent[]
  permissionRequest: CodingExecutorPermissionRequest
}

export type CodingExecutorTurn = CodingExecutorTerminalTurn | CodingExecutorPermissionTurn

export class CodingExecutorContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'CodingExecutorContractError'
    this.code = code
  }
}

function fail(code: string): never {
  throw new CodingExecutorContractError(code)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= MAX_VERSION
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= Number.MAX_SAFE_INTEGER
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isRepoRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1_024 &&
    value.trim() === value &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

function parseCanonicalList(
  value: unknown,
  validator: (entry: unknown) => entry is string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    !value.every(validator) ||
    new Set(value).size !== value.length ||
    value.some((entry, index) => index > 0 && value[index - 1]! >= entry)
  ) {
    return fail('invalid_coding_executor_terminal_result')
  }
  return [...value]
}

const codingExecutorEventMetadataKeys: Record<CodingExecutorEventType, readonly string[]> = {
  started: ['executorId', 'executorVersion'],
  observation: ['code', 'status'],
  tool_request: ['toolRequestId', 'toolId', 'capability'],
  permission_request: ['permissionRequestId', 'capability'],
  permission_decision: ['permissionRequestId', 'decision'],
  tool_result: ['toolRequestId', 'status', 'evidenceId'],
  checkpoint: ['checkpointId'],
  evidence: ['diffArtifactId', 'testEvidenceId', 'testEvidenceCount', 'bootstrapEvidenceId'],
  terminal: ['stopReason'],
}

function parseEventMetadata(
  value: unknown,
  type: CodingExecutorEventType,
): CodingExecutorEventMetadata {
  if (!isPlainRecord(value)) return fail('invalid_coding_executor_event')
  const allowedKeys = codingExecutorEventMetadataKeys[type]
  for (const [key, entry] of Object.entries(value)) {
    if (
      !allowedKeys.includes(key) ||
      !(
        entry === null ||
        (typeof entry === 'string' && isIdentifier(entry)) ||
        typeof entry === 'boolean' ||
        (typeof entry === 'number' && isNonNegativeInteger(entry))
      )
    ) {
      return fail('invalid_coding_executor_event')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EVENT_METADATA_BYTES) {
    return fail('invalid_coding_executor_event')
  }
  return { ...value } as CodingExecutorEventMetadata
}

function parseCodingExecutorEvent(value: unknown): CodingExecutorEvent {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'sequence',
      'checkpointVersion',
      'type',
      'createdAt',
      'metadata',
    ]) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    !isIdentifier(value.requestId) ||
    !isPositiveVersion(value.sequence) ||
    !isNonNegativeInteger(value.checkpointVersion) ||
    ![
      'started',
      'observation',
      'tool_request',
      'permission_request',
      'permission_decision',
      'tool_result',
      'checkpoint',
      'evidence',
      'terminal',
    ].includes(String(value.type)) ||
    !isCanonicalIso(value.createdAt)
  ) {
    return fail('invalid_coding_executor_event')
  }
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    requestId: value.requestId,
    sequence: value.sequence,
    checkpointVersion: value.checkpointVersion,
    type: value.type as CodingExecutorEventType,
    createdAt: value.createdAt,
    metadata: parseEventMetadata(value.metadata, value.type as CodingExecutorEventType),
  }
}

export function parseCodingExecutorTerminalResult(value: unknown): CodingExecutorTerminalResult {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'stopReason',
      'executor',
      'finalCheckpointVersion',
      'changedPaths',
      'diffArtifactId',
      'testEvidenceIds',
      'usage',
      'cleanup',
      'completedAt',
    ]) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    !isIdentifier(value.requestId) ||
    !['success', 'failure', 'cancelled', 'timeout', 'policy_denied'].includes(
      String(value.stopReason),
    ) ||
    !isPlainRecord(value.executor) ||
    !hasExactKeys(value.executor, ['id', 'version', 'kind']) ||
    !isIdentifier(value.executor.id) ||
    !isPositiveVersion(value.executor.version) ||
    (value.executor.kind !== 'opencode' && value.executor.kind !== 'native') ||
    !isPositiveVersion(value.finalCheckpointVersion) ||
    (value.diffArtifactId !== null && !isIdentifier(value.diffArtifactId)) ||
    !isPlainRecord(value.usage) ||
    !hasExactKeys(value.usage, ['tokens', 'costUsd']) ||
    !isNonNegativeInteger(value.usage.tokens) ||
    typeof value.usage.costUsd !== 'number' ||
    !Number.isFinite(value.usage.costUsd) ||
    value.usage.costUsd < 0 ||
    !isPlainRecord(value.cleanup) ||
    !hasExactKeys(value.cleanup, ['status', 'reasonCode']) ||
    !['completed', 'failed', 'not_required'].includes(String(value.cleanup.status)) ||
    !(value.cleanup.reasonCode === null || isIdentifier(value.cleanup.reasonCode)) ||
    !isCanonicalIso(value.completedAt)
  ) {
    return fail('invalid_coding_executor_terminal_result')
  }
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    requestId: value.requestId,
    stopReason: value.stopReason as CodingExecutorStopReason,
    executor: {
      id: value.executor.id,
      version: value.executor.version,
      kind: value.executor.kind,
    },
    finalCheckpointVersion: value.finalCheckpointVersion,
    changedPaths: parseCanonicalList(value.changedPaths, isRepoRelativePath),
    diffArtifactId: value.diffArtifactId,
    testEvidenceIds: parseCanonicalList(value.testEvidenceIds, isIdentifier),
    usage: { tokens: value.usage.tokens, costUsd: value.usage.costUsd },
    cleanup: {
      status: value.cleanup.status as CodingExecutorTerminalResult['cleanup']['status'],
      reasonCode: value.cleanup.reasonCode,
    },
    completedAt: value.completedAt,
  }
}

function parseCodingExecutorPermissionRequest(value: unknown): CodingExecutorPermissionRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'id',
      'capability',
      'requestDigest',
      'requestedAt',
      'expiresAt',
    ]) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    !isIdentifier(value.requestId) ||
    !isIdentifier(value.id) ||
    (value.capability !== 'approved_command' && value.capability !== 'workspace_edit') ||
    typeof value.requestDigest !== 'string' ||
    !digestPattern.test(value.requestDigest) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.expiresAt) ||
    value.expiresAt <= value.requestedAt
  ) {
    return fail('invalid_coding_executor_permission_request')
  }
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    requestId: value.requestId,
    id: value.id,
    capability: value.capability,
    requestDigest: value.requestDigest,
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
  }
}

function parseCapabilities(value: unknown): CodingExecutorCapability[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (capability) =>
        typeof capability !== 'string' ||
        !codingExecutorCapabilities.includes(capability as CodingExecutorCapability),
    ) ||
    new Set(value).size !== value.length ||
    value.some((capability, index) => index > 0 && value[index - 1] >= capability)
  ) {
    return fail('invalid_coding_executor_capabilities')
  }
  return [...value] as CodingExecutorCapability[]
}

function parseAvailability(value: unknown): CodingExecutorAvailability {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['status', 'reasonCode'])) {
    return fail('invalid_coding_executor_descriptor')
  }
  if (value.status === 'available' && value.reasonCode === null) {
    return { status: 'available', reasonCode: null }
  }
  if (
    value.status === 'unavailable' &&
    ['not_configured', 'runtime_unavailable', 'policy_denied'].includes(String(value.reasonCode))
  ) {
    return {
      status: 'unavailable',
      reasonCode: value.reasonCode as Exclude<CodingExecutorAvailability, { status: 'available' }>['reasonCode'],
    }
  }
  return fail('invalid_coding_executor_descriptor')
}

export function parseCodingExecutorRequest(value: unknown): CodingExecutorRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'executor',
      'scope',
      'authority',
      'objectiveDigest',
      'contextDigest',
      'requiredCapabilities',
      'budget',
      'expectedCheckpointVersion',
      'requestedAt',
      'deadline',
    ]) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isPlainRecord(value.executor) ||
    !hasExactKeys(value.executor, ['id', 'version']) ||
    !isIdentifier(value.executor.id) ||
    !isPositiveVersion(value.executor.version) ||
    !isPlainRecord(value.scope) ||
    !hasExactKeys(value.scope, [
      'organizationId',
      'projectId',
      'userId',
      'sessionId',
      'localProjectId',
      'managedWorkspaceId',
    ]) ||
    !(
      (value.scope.organizationId === null && value.scope.projectId === null) ||
      (isIdentifier(value.scope.organizationId) && isIdentifier(value.scope.projectId))
    ) ||
    !isIdentifier(value.scope.userId) ||
    !isIdentifier(value.scope.sessionId) ||
    !isIdentifier(value.scope.localProjectId) ||
    !isIdentifier(value.scope.managedWorkspaceId) ||
    !isPlainRecord(value.authority) ||
    !hasExactKeys(value.authority, ['runId', 'nodeId', 'runVersion', 'policyVersion']) ||
    !isIdentifier(value.authority.runId) ||
    !isIdentifier(value.authority.nodeId) ||
    !isPositiveVersion(value.authority.runVersion) ||
    !isPositiveVersion(value.authority.policyVersion) ||
    typeof value.objectiveDigest !== 'string' ||
    !digestPattern.test(value.objectiveDigest) ||
    typeof value.contextDigest !== 'string' ||
    !digestPattern.test(value.contextDigest) ||
    !isPlainRecord(value.budget) ||
    !hasExactKeys(value.budget, ['maxTokens', 'maxCostUsd']) ||
    !isNonNegativeInteger(value.budget.maxTokens) ||
    value.budget.maxTokens > 10_000_000 ||
    typeof value.budget.maxCostUsd !== 'number' ||
    !Number.isFinite(value.budget.maxCostUsd) ||
    value.budget.maxCostUsd < 0 ||
    value.budget.maxCostUsd > 1_000_000 ||
    !isNonNegativeInteger(value.expectedCheckpointVersion) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.deadline) ||
    value.deadline <= value.requestedAt
  ) {
    return fail('invalid_coding_executor_request')
  }
  const requiredCapabilities = parseCapabilities(value.requiredCapabilities)
  if (requiredCapabilities.length === 0) return fail('invalid_coding_executor_request')
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    id: value.id,
    executor: { id: value.executor.id, version: value.executor.version },
    scope: {
      organizationId: value.scope.organizationId,
      projectId: value.scope.projectId,
      userId: value.scope.userId,
      sessionId: value.scope.sessionId,
      localProjectId: value.scope.localProjectId,
      managedWorkspaceId: value.scope.managedWorkspaceId,
    },
    authority: {
      runId: value.authority.runId,
      nodeId: value.authority.nodeId,
      runVersion: value.authority.runVersion,
      policyVersion: value.authority.policyVersion,
    },
    objectiveDigest: value.objectiveDigest,
    contextDigest: value.contextDigest,
    requiredCapabilities,
    budget: { maxTokens: value.budget.maxTokens, maxCostUsd: value.budget.maxCostUsd },
    expectedCheckpointVersion: value.expectedCheckpointVersion,
    requestedAt: value.requestedAt,
    deadline: value.deadline,
  }
}

export function parseCodingExecutorDescriptor(value: unknown): CodingExecutorDescriptor {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'kind',
      'availability',
      'capabilities',
    ]) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isPositiveVersion(value.version) ||
    (value.kind !== 'opencode' && value.kind !== 'native')
  ) {
    return fail('invalid_coding_executor_descriptor')
  }
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    id: value.id,
    version: value.version,
    kind: value.kind,
    availability: parseAvailability(value.availability),
    capabilities: parseCapabilities(value.capabilities),
  }
}

export function selectCodingExecutor(input: {
  descriptors: unknown[]
  executorId: string
  executorVersion: number
  requiredCapabilities: CodingExecutorCapability[]
}): CodingExecutorDescriptor {
  if (!isIdentifier(input.executorId) || !isPositiveVersion(input.executorVersion)) {
    return fail('coding_executor_selection_invalid')
  }
  const requiredCapabilities = parseCapabilities(input.requiredCapabilities)
  const descriptors = input.descriptors.map(parseCodingExecutorDescriptor)
  const matches = descriptors.filter(
    (descriptor) =>
      descriptor.id === input.executorId && descriptor.version === input.executorVersion,
  )
  if (matches.length !== 1) return fail('coding_executor_selection_invalid')
  const descriptor = matches[0]!
  if (descriptor.availability.status !== 'available') {
    return fail('coding_executor_unavailable')
  }
  if (
    requiredCapabilities.some((capability) => !descriptor.capabilities.includes(capability))
  ) {
    return fail('coding_executor_capability_unavailable')
  }
  return descriptor
}

export function parseCodingExecutorTurn(
  value: unknown,
  context: {
    expectedRequestId: string
    previousCheckpointVersion: number
    previousSequence: number
    settledPermissionRequestIds?: readonly string[]
  },
): CodingExecutorTurn {
  const settledPermissionRequestIds = context.settledPermissionRequestIds ?? []
  if (
    !isIdentifier(context.expectedRequestId) ||
    !isNonNegativeInteger(context.previousCheckpointVersion) ||
    !isNonNegativeInteger(context.previousSequence) ||
    settledPermissionRequestIds.some((id) => !isIdentifier(id)) ||
    new Set(settledPermissionRequestIds).size !== settledPermissionRequestIds.length ||
    !isPlainRecord(value) ||
    !(
      (value.status === 'terminal' &&
        hasExactKeys(value, [
          'stateVersion',
          'requestId',
          'status',
          'checkpointVersion',
          'events',
          'terminalResult',
        ])) ||
      (value.status === 'waiting_permission' &&
        hasExactKeys(value, [
          'stateVersion',
          'requestId',
          'status',
          'checkpointVersion',
          'events',
          'permissionRequest',
        ]))
    ) ||
    value.stateVersion !== CODING_EXECUTOR_CONTRACT_VERSION ||
    value.requestId !== context.expectedRequestId ||
    !isPositiveVersion(value.checkpointVersion) ||
    value.checkpointVersion <= context.previousCheckpointVersion ||
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    value.events.length > 256
  ) {
    return fail('invalid_coding_executor_turn')
  }
  const events = value.events.map(parseCodingExecutorEvent)
  for (const [index, event] of events.entries()) {
    const previousEvent = events[index - 1]
    if (
      event.requestId !== value.requestId ||
      event.sequence !== context.previousSequence + index + 1 ||
      event.checkpointVersion > value.checkpointVersion ||
      event.checkpointVersion < (previousEvent?.checkpointVersion ?? context.previousCheckpointVersion) ||
      (previousEvent !== undefined && event.createdAt < previousEvent.createdAt)
    ) {
      return fail('invalid_coding_executor_event_order')
    }
  }
  if (context.previousSequence === 0 && events[0]?.type !== 'started') {
    return fail('invalid_coding_executor_event_order')
  }
  if (value.status === 'waiting_permission') {
    if (events.at(-1)?.type !== 'permission_request') {
      return fail('invalid_coding_executor_event_order')
    }
    const permissionRequest = parseCodingExecutorPermissionRequest(value.permissionRequest)
    if (
      permissionRequest.requestId !== value.requestId ||
      settledPermissionRequestIds.includes(permissionRequest.id) ||
      permissionRequest.requestedAt !== events.at(-1)!.createdAt ||
      events.at(-1)!.metadata.permissionRequestId !== permissionRequest.id
    ) {
      return fail('invalid_coding_executor_turn')
    }
    return {
      stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
      requestId: value.requestId,
      status: 'waiting_permission',
      checkpointVersion: value.checkpointVersion,
      events,
      permissionRequest,
    }
  }
  if (events.at(-1)?.type !== 'terminal') return fail('invalid_coding_executor_event_order')
  const terminalResult = parseCodingExecutorTerminalResult(value.terminalResult)
  if (
    terminalResult.requestId !== value.requestId ||
    terminalResult.finalCheckpointVersion !== value.checkpointVersion ||
    terminalResult.completedAt !== events.at(-1)!.createdAt ||
    events.at(-1)!.metadata.stopReason !== terminalResult.stopReason
  ) {
    return fail('invalid_coding_executor_turn')
  }
  return {
    stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
    requestId: value.requestId,
    status: 'terminal',
    checkpointVersion: value.checkpointVersion,
    events,
    terminalResult,
  }
}
