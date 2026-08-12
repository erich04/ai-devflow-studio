import { redactSensitiveText } from './redaction'

export const AGENT_RUNTIME_CONTRACT_VERSION = 1 as const
export const AGENT_RUNTIME_ID_MAX_LENGTH = 200
export const AGENT_RUNTIME_MAX_STEPS = 32
export const AGENT_RUNTIME_MAX_WALL_TIME_MS = 30 * 60_000
export const AGENT_RUNTIME_MAX_TOOL_CALLS = 64
export const AGENT_RUNTIME_MAX_TOOL_RESULT_BYTES = 256 * 1_024
export const AGENT_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES = 64 * 1_024
export const AGENT_RUNTIME_MAX_CHECKPOINT_BYTES = 512 * 1_024
export const AGENT_RUNTIME_MAX_TOKENS = 10_000_000
export const AGENT_RUNTIME_MAX_COST_USD = 1_000_000
export const AGENT_RUNTIME_EVALUATION_SUMMARY_MAX_LENGTH = 2_000

const MAX_VERSION = 2_147_483_647
const digestPattern = /^[a-f0-9]{64}$/u
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

export type AgentRuntimeScope =
  | {
      kind: 'team'
      organizationId: string
      projectId: string
      userId: string
      sessionId: string
      localProjectId: string
    }
  | {
      kind: 'local'
      organizationId: null
      projectId: null
      userId: string
      sessionId: string
      localProjectId: string
    }

export type AgentRuntimeAuthority = {
  runId: string
  nodeId: string
  runVersion: number
  policyVersion: number
}

export type AgentRuntimeBounds = {
  maxSteps: number
  maxWallTimeMs: number
  maxToolCalls: number
  maxToolResultBytes: number
  maxTrajectoryMetadataBytes: number
  maxCheckpointBytes: number
  maxTokens: number
  maxCostUsd: number
}

export type AgentRuntimeStartRequest = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  id: string
  scope: AgentRuntimeScope
  authority: AgentRuntimeAuthority
  contextDigest: string
  capabilitySetDigest: string
  bounds: AgentRuntimeBounds
  requestedAt: string
  deadline: string
}

export type AgentRuntimeStopReason =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timeout'
  | 'step_limit'
  | 'budget_exhausted'
  | 'policy_denied'

export type AgentRuntimeStatus =
  | 'running'
  | 'waiting_permission'
  | 'waiting_action'
  | 'checkpointed'
  | 'terminal'

export type AgentRuntimeAction = {
  id: string
  kind: 'tool' | 'coding_executor'
  capabilityId: string
  capabilityVersion: number
  requestDigest: string
  requiresPermission: boolean
}

export type AgentRuntimeCounters = {
  steps: number
  toolCalls: number
  tokens: number
  costUsd: number
}

export type AgentRuntimeState = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  id: string
  scope: AgentRuntimeScope
  authority: AgentRuntimeAuthority
  contextDigest: string
  capabilitySetDigest: string
  bounds: AgentRuntimeBounds
  status: AgentRuntimeStatus
  stopReason: AgentRuntimeStopReason | null
  version: number
  checkpointVersion: number
  nextSequence: number
  counters: AgentRuntimeCounters
  acceptedActionIds: string[]
  lastObservationDigest: string
  lastResultDigest: string | null
  activeAction: AgentRuntimeAction | null
  requestedAt: string
  startedAt: string
  updatedAt: string
  deadline: string
}

export type AgentRuntimeEventType =
  | 'runtime_started'
  | 'context_attached'
  | 'runtime_resumed'
  | 'decision_recorded'
  | 'action_requested'
  | 'permission_decided'
  | 'action_result'
  | 'observation_recorded'
  | 'evaluation_recorded'
  | 'checkpointed'
  | 'runtime_stopped'

export type AgentRuntimeEventMetadata = Record<string, string | number | boolean | null>

export type AgentRuntimeEvent = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  runtimeId: string
  sequence: number
  checkpointVersion: number
  type: AgentRuntimeEventType
  createdAt: string
  metadata: AgentRuntimeEventMetadata
}

export type AgentCheckpoint = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  runtimeId: string
  version: number
  runtimeVersion: number
  status: AgentRuntimeStatus
  stopReason: AgentRuntimeStopReason | null
  nextSequence: number
  scope: AgentRuntimeScope
  authority: AgentRuntimeAuthority
  contextDigest: string
  capabilitySetDigest: string
  bounds: AgentRuntimeBounds
  counters: AgentRuntimeCounters
  acceptedActionIds: string[]
  lastObservationDigest: string
  lastResultDigest: string | null
  activeAction: AgentRuntimeAction | null
  deadline: string
  createdAt: string
}

export type AgentRuntimeTransition = {
  runtime: AgentRuntimeState
  checkpoint: AgentCheckpoint
  events: AgentRuntimeEvent[]
}

export class AgentRuntimeContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AgentRuntimeContractError'
    this.code = code
  }
}

function fail(code: string): never {
  throw new AgentRuntimeContractError(code)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function parseScope(value: unknown): AgentRuntimeScope {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'kind',
      'organizationId',
      'projectId',
      'userId',
      'sessionId',
      'localProjectId',
    ]) ||
    !isIdentifier(value.userId) ||
    !isIdentifier(value.sessionId) ||
    !isIdentifier(value.localProjectId)
  ) {
    fail('invalid_agent_runtime_request')
  }

  if (
    value.kind === 'team' &&
    isIdentifier(value.organizationId) &&
    isIdentifier(value.projectId)
  ) {
    return {
      kind: 'team',
      organizationId: value.organizationId,
      projectId: value.projectId,
      userId: value.userId,
      sessionId: value.sessionId,
      localProjectId: value.localProjectId,
    }
  }

  if (value.kind === 'local' && value.organizationId === null && value.projectId === null) {
    return {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: value.userId,
      sessionId: value.sessionId,
      localProjectId: value.localProjectId,
    }
  }

  fail('invalid_agent_runtime_request')
}

function parseAuthority(value: unknown): AgentRuntimeAuthority {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['runId', 'nodeId', 'runVersion', 'policyVersion']) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isPositiveVersion(value.runVersion) ||
    !isPositiveVersion(value.policyVersion)
  ) {
    fail('invalid_agent_runtime_request')
  }
  return {
    runId: value.runId,
    nodeId: value.nodeId,
    runVersion: value.runVersion,
    policyVersion: value.policyVersion,
  }
}

function parseBounds(value: unknown): AgentRuntimeBounds {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'maxSteps',
      'maxWallTimeMs',
      'maxToolCalls',
      'maxToolResultBytes',
      'maxTrajectoryMetadataBytes',
      'maxCheckpointBytes',
      'maxTokens',
      'maxCostUsd',
    ]) ||
    !isPositiveVersion(value.maxSteps) ||
    value.maxSteps > AGENT_RUNTIME_MAX_STEPS ||
    !isPositiveVersion(value.maxWallTimeMs) ||
    value.maxWallTimeMs > AGENT_RUNTIME_MAX_WALL_TIME_MS ||
    !isPositiveVersion(value.maxToolCalls) ||
    value.maxToolCalls > AGENT_RUNTIME_MAX_TOOL_CALLS ||
    !isPositiveVersion(value.maxToolResultBytes) ||
    value.maxToolResultBytes > AGENT_RUNTIME_MAX_TOOL_RESULT_BYTES ||
    !isPositiveVersion(value.maxTrajectoryMetadataBytes) ||
    value.maxTrajectoryMetadataBytes > AGENT_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES ||
    !isPositiveVersion(value.maxCheckpointBytes) ||
    value.maxCheckpointBytes > AGENT_RUNTIME_MAX_CHECKPOINT_BYTES ||
    !isPositiveVersion(value.maxTokens) ||
    value.maxTokens > AGENT_RUNTIME_MAX_TOKENS ||
    typeof value.maxCostUsd !== 'number' ||
    !Number.isFinite(value.maxCostUsd) ||
    value.maxCostUsd <= 0 ||
    value.maxCostUsd > AGENT_RUNTIME_MAX_COST_USD
  ) {
    fail('invalid_agent_runtime_request')
  }

  return {
    maxSteps: value.maxSteps,
    maxWallTimeMs: value.maxWallTimeMs,
    maxToolCalls: value.maxToolCalls,
    maxToolResultBytes: value.maxToolResultBytes,
    maxTrajectoryMetadataBytes: value.maxTrajectoryMetadataBytes,
    maxCheckpointBytes: value.maxCheckpointBytes,
    maxTokens: value.maxTokens,
    maxCostUsd: value.maxCostUsd,
  }
}

export function parseAgentRuntimeStartRequest(value: unknown): AgentRuntimeStartRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'scope',
      'authority',
      'contextDigest',
      'capabilitySetDigest',
      'bounds',
      'requestedAt',
      'deadline',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.deadline)
  ) {
    fail('invalid_agent_runtime_request')
  }

  const scope = parseScope(value.scope)
  const authority = parseAuthority(value.authority)
  const bounds = parseBounds(value.bounds)
  const duration = Date.parse(value.deadline) - Date.parse(value.requestedAt)
  if (duration <= 0 || duration > bounds.maxWallTimeMs) {
    fail('invalid_agent_runtime_request')
  }

  return {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    id: value.id,
    scope,
    authority,
    contextDigest: value.contextDigest,
    capabilitySetDigest: value.capabilitySetDigest,
    bounds,
    requestedAt: value.requestedAt,
    deadline: value.deadline,
  }
}

function cloneScope(scope: AgentRuntimeScope): AgentRuntimeScope {
  return { ...scope }
}

function cloneAuthority(authority: AgentRuntimeAuthority): AgentRuntimeAuthority {
  return { ...authority }
}

function cloneBounds(bounds: AgentRuntimeBounds): AgentRuntimeBounds {
  return { ...bounds }
}

function cloneAction(action: AgentRuntimeAction | null): AgentRuntimeAction | null {
  return action ? { ...action } : null
}

function createEvent(
  runtime: AgentRuntimeState,
  sequence: number,
  checkpointVersion: number,
  type: AgentRuntimeEventType,
  createdAt: string,
  metadata: AgentRuntimeEventMetadata,
): AgentRuntimeEvent {
  if (utf8Bytes(metadata) > runtime.bounds.maxTrajectoryMetadataBytes) {
    fail('agent_trajectory_metadata_too_large')
  }
  return {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    runtimeId: runtime.id,
    sequence,
    checkpointVersion,
    type,
    createdAt,
    metadata,
  }
}

function createCheckpoint(runtime: AgentRuntimeState, createdAt: string): AgentCheckpoint {
  const checkpoint: AgentCheckpoint = {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    runtimeId: runtime.id,
    version: runtime.checkpointVersion,
    runtimeVersion: runtime.version,
    status: runtime.status,
    stopReason: runtime.stopReason,
    nextSequence: runtime.nextSequence,
    scope: cloneScope(runtime.scope),
    authority: cloneAuthority(runtime.authority),
    contextDigest: runtime.contextDigest,
    capabilitySetDigest: runtime.capabilitySetDigest,
    bounds: cloneBounds(runtime.bounds),
    counters: { ...runtime.counters },
    acceptedActionIds: [...runtime.acceptedActionIds],
    lastObservationDigest: runtime.lastObservationDigest,
    lastResultDigest: runtime.lastResultDigest,
    activeAction: cloneAction(runtime.activeAction),
    deadline: runtime.deadline,
    createdAt,
  }
  if (utf8Bytes(checkpoint) > runtime.bounds.maxCheckpointBytes) {
    fail('agent_checkpoint_too_large')
  }
  return checkpoint
}

type PendingEvent = {
  type: AgentRuntimeEventType
  metadata: AgentRuntimeEventMetadata
}

function commitTransition(
  previous: AgentRuntimeState,
  now: string,
  changes: Partial<
    Pick<
      AgentRuntimeState,
      | 'status'
      | 'stopReason'
      | 'counters'
      | 'acceptedActionIds'
      | 'lastObservationDigest'
      | 'lastResultDigest'
      | 'activeAction'
    >
  >,
  pendingEvents: PendingEvent[],
  options: { checkpointEvent?: boolean } = {},
): AgentRuntimeTransition {
  const checkpointVersion = previous.checkpointVersion + 1
  const eventSpecs = [...pendingEvents]
  if (options.checkpointEvent ?? true) {
    eventSpecs.push({ type: 'checkpointed', metadata: { checkpointVersion } })
  }
  const events = eventSpecs.map((event, index) =>
    createEvent(
      previous,
      previous.nextSequence + index,
      checkpointVersion,
      event.type,
      now,
      event.metadata,
    ),
  )
  const runtime: AgentRuntimeState = {
    ...previous,
    ...changes,
    version: previous.version + 1,
    checkpointVersion,
    nextSequence: previous.nextSequence + events.length,
    updatedAt: now,
    counters: changes.counters ? { ...changes.counters } : { ...previous.counters },
    acceptedActionIds: changes.acceptedActionIds
      ? [...changes.acceptedActionIds]
      : [...previous.acceptedActionIds],
    activeAction:
      changes.activeAction !== undefined
        ? cloneAction(changes.activeAction)
        : cloneAction(previous.activeAction),
  }
  return { runtime, checkpoint: createCheckpoint(runtime, now), events }
}

function ensureMutation(
  runtime: AgentRuntimeState,
  expectedCheckpointVersion: number,
  now: string,
): void {
  parseAgentRuntimeState(runtime)
  if (runtime.status === 'terminal') fail('terminal_agent_runtime')
  if (
    !isPositiveVersion(expectedCheckpointVersion) ||
    expectedCheckpointVersion !== runtime.checkpointVersion
  ) {
    fail('stale_agent_checkpoint')
  }
  if (!isCanonicalIso(now) || Date.parse(now) < Date.parse(runtime.updatedAt)) {
    fail('invalid_agent_runtime_time')
  }
}

function terminalTransition(
  runtime: AgentRuntimeState,
  now: string,
  reason: AgentRuntimeStopReason,
  pendingEvents: PendingEvent[] = [],
  metadata: AgentRuntimeEventMetadata = {},
  counters: AgentRuntimeCounters = runtime.counters,
  acceptedResultState: Pick<
    AgentRuntimeState,
    'acceptedActionIds' | 'lastObservationDigest' | 'lastResultDigest'
  > | null = null,
): AgentRuntimeTransition {
  return commitTransition(
    runtime,
    now,
    {
      status: 'terminal',
      stopReason: reason,
      activeAction: null,
      counters,
      ...(acceptedResultState ?? {}),
    },
    [...pendingEvents, { type: 'runtime_stopped', metadata: { stopReason: reason, ...metadata } }],
    { checkpointEvent: false },
  )
}

export function createAgentRuntime(value: AgentRuntimeStartRequest): AgentRuntimeTransition {
  const request = parseAgentRuntimeStartRequest(value)
  const runtime: AgentRuntimeState = {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    id: request.id,
    scope: cloneScope(request.scope),
    authority: cloneAuthority(request.authority),
    contextDigest: request.contextDigest,
    capabilitySetDigest: request.capabilitySetDigest,
    bounds: cloneBounds(request.bounds),
    status: 'checkpointed',
    stopReason: null,
    version: 1,
    checkpointVersion: 1,
    nextSequence: 4,
    counters: { steps: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
    acceptedActionIds: [],
    lastObservationDigest: request.contextDigest,
    lastResultDigest: null,
    activeAction: null,
    requestedAt: request.requestedAt,
    startedAt: request.requestedAt,
    updatedAt: request.requestedAt,
    deadline: request.deadline,
  }
  const events = [
    createEvent(runtime, 1, 1, 'runtime_started', request.requestedAt, {
      contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    }),
    createEvent(runtime, 2, 1, 'context_attached', request.requestedAt, {
      contextDigest: request.contextDigest,
      capabilitySetDigest: request.capabilitySetDigest,
    }),
    createEvent(runtime, 3, 1, 'checkpointed', request.requestedAt, { checkpointVersion: 1 }),
  ]
  return { runtime, checkpoint: createCheckpoint(runtime, request.requestedAt), events }
}

function sameAuthority(left: AgentRuntimeAuthority, right: AgentRuntimeAuthority): boolean {
  return (
    left.runId === right.runId &&
    left.nodeId === right.nodeId &&
    left.runVersion === right.runVersion &&
    left.policyVersion === right.policyVersion
  )
}

export function resumeAgentRuntime(input: {
  runtime: AgentRuntimeState
  expectedCheckpointVersion: number
  authority: AgentRuntimeAuthority
  contextDigest: string
  capabilitySetDigest: string
  now: string
}): AgentRuntimeTransition {
  ensureMutation(input.runtime, input.expectedCheckpointVersion, input.now)
  if (
    input.runtime.status !== 'checkpointed' ||
    !sameAuthority(input.runtime.authority, input.authority) ||
    input.runtime.contextDigest !== input.contextDigest ||
    input.runtime.capabilitySetDigest !== input.capabilitySetDigest
  ) {
    fail('stale_agent_checkpoint')
  }
  if (Date.parse(input.now) >= Date.parse(input.runtime.deadline)) {
    return terminalTransition(input.runtime, input.now, 'timeout')
  }
  if (
    input.runtime.counters.tokens >= input.runtime.bounds.maxTokens ||
    input.runtime.counters.costUsd >= input.runtime.bounds.maxCostUsd
  ) {
    return terminalTransition(input.runtime, input.now, 'budget_exhausted')
  }
  return commitTransition(
    input.runtime,
    input.now,
    { status: 'running' },
    [{ type: 'runtime_resumed', metadata: { fromCheckpointVersion: input.expectedCheckpointVersion } }],
  )
}

function parseAction(value: unknown): AgentRuntimeAction {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'kind',
      'capabilityId',
      'capabilityVersion',
      'requestDigest',
      'requiresPermission',
    ]) ||
    !isIdentifier(value.id) ||
    (value.kind !== 'tool' && value.kind !== 'coding_executor') ||
    !isIdentifier(value.capabilityId) ||
    !isPositiveVersion(value.capabilityVersion) ||
    !isDigest(value.requestDigest) ||
    typeof value.requiresPermission !== 'boolean'
  ) {
    fail('invalid_agent_action')
  }
  return {
    id: value.id,
    kind: value.kind,
    capabilityId: value.capabilityId,
    capabilityVersion: value.capabilityVersion,
    requestDigest: value.requestDigest,
    requiresPermission: value.requiresPermission,
  }
}

function parseCounters(value: unknown): AgentRuntimeCounters {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['steps', 'toolCalls', 'tokens', 'costUsd']) ||
    !isNonNegativeInteger(value.steps) ||
    !isNonNegativeInteger(value.toolCalls) ||
    !isNonNegativeInteger(value.tokens) ||
    typeof value.costUsd !== 'number' ||
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0
  ) {
    fail('invalid_agent_runtime_state')
  }
  return {
    steps: value.steps,
    toolCalls: value.toolCalls,
    tokens: value.tokens,
    costUsd: value.costUsd,
  }
}

function isRuntimeStatus(value: unknown): value is AgentRuntimeStatus {
  return (
    value === 'running' ||
    value === 'waiting_permission' ||
    value === 'waiting_action' ||
    value === 'checkpointed' ||
    value === 'terminal'
  )
}

function isStopReason(value: unknown): value is AgentRuntimeStopReason {
  return stopReasons.includes(value as AgentRuntimeStopReason)
}

export function parseAgentRuntimeState(value: unknown): AgentRuntimeState {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'scope',
      'authority',
      'contextDigest',
      'capabilitySetDigest',
      'bounds',
      'status',
      'stopReason',
      'version',
      'checkpointVersion',
      'nextSequence',
      'counters',
      'acceptedActionIds',
      'lastObservationDigest',
      'lastResultDigest',
      'activeAction',
      'requestedAt',
      'startedAt',
      'updatedAt',
      'deadline',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isRuntimeStatus(value.status) ||
    (value.stopReason !== null && !isStopReason(value.stopReason)) ||
    !isPositiveVersion(value.version) ||
    !isPositiveVersion(value.checkpointVersion) ||
    value.checkpointVersion !== value.version ||
    !isPositiveVersion(value.nextSequence) ||
    value.nextSequence < 4 ||
    !Array.isArray(value.acceptedActionIds) ||
    !hasUniqueStrings(value.acceptedActionIds) ||
    !value.acceptedActionIds.every(isIdentifier) ||
    !isDigest(value.lastObservationDigest) ||
    (value.lastResultDigest !== null && !isDigest(value.lastResultDigest)) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.startedAt) ||
    !isCanonicalIso(value.updatedAt) ||
    !isCanonicalIso(value.deadline)
  ) {
    fail('invalid_agent_runtime_state')
  }

  const scope = parseScope(value.scope)
  const authority = parseAuthority(value.authority)
  const bounds = parseBounds(value.bounds)
  const counters = parseCounters(value.counters)
  const activeAction = value.activeAction === null ? null : parseAction(value.activeAction)
  const requestedAt = Date.parse(value.requestedAt)
  const startedAt = Date.parse(value.startedAt)
  const updatedAt = Date.parse(value.updatedAt)
  const deadline = Date.parse(value.deadline)
  const hasActiveAction = activeAction !== null
  const waitsForAction = value.status === 'waiting_permission' || value.status === 'waiting_action'

  if (
    startedAt !== requestedAt ||
    updatedAt < startedAt ||
    deadline <= requestedAt ||
    deadline - requestedAt > bounds.maxWallTimeMs ||
    counters.steps > bounds.maxSteps ||
    counters.toolCalls > bounds.maxToolCalls ||
    value.acceptedActionIds.length > counters.steps ||
    value.acceptedActionIds.length > bounds.maxSteps ||
    (value.acceptedActionIds.length === 0) !== (value.lastResultDigest === null) ||
    (value.status !== 'terminal' &&
      (counters.tokens > bounds.maxTokens || counters.costUsd > bounds.maxCostUsd)) ||
    (value.status === 'terminal') !== (value.stopReason !== null) ||
    waitsForAction !== hasActiveAction ||
    (waitsForAction && counters.steps === 0) ||
    (activeAction?.kind === 'tool' && counters.toolCalls === 0)
  ) {
    fail('invalid_agent_runtime_state')
  }

  return {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    id: value.id,
    scope,
    authority,
    contextDigest: value.contextDigest,
    capabilitySetDigest: value.capabilitySetDigest,
    bounds,
    status: value.status,
    stopReason: value.stopReason,
    version: value.version,
    checkpointVersion: value.checkpointVersion,
    nextSequence: value.nextSequence,
    counters,
    acceptedActionIds: [...value.acceptedActionIds],
    lastObservationDigest: value.lastObservationDigest,
    lastResultDigest: value.lastResultDigest,
    activeAction,
    requestedAt: value.requestedAt,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    deadline: value.deadline,
  }
}

export function parseAgentCheckpoint(value: unknown): AgentCheckpoint {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'runtimeId',
      'version',
      'runtimeVersion',
      'status',
      'stopReason',
      'nextSequence',
      'scope',
      'authority',
      'contextDigest',
      'capabilitySetDigest',
      'bounds',
      'counters',
      'acceptedActionIds',
      'lastObservationDigest',
      'lastResultDigest',
      'activeAction',
      'deadline',
      'createdAt',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isPositiveVersion(value.version) ||
    !isPositiveVersion(value.runtimeVersion) ||
    !isRuntimeStatus(value.status) ||
    (value.stopReason !== null && !isStopReason(value.stopReason)) ||
    !isPositiveVersion(value.nextSequence) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !Array.isArray(value.acceptedActionIds) ||
    !hasUniqueStrings(value.acceptedActionIds) ||
    !value.acceptedActionIds.every(isIdentifier) ||
    !isDigest(value.lastObservationDigest) ||
    (value.lastResultDigest !== null && !isDigest(value.lastResultDigest)) ||
    !isCanonicalIso(value.deadline) ||
    !isCanonicalIso(value.createdAt)
  ) {
    fail('invalid_agent_checkpoint')
  }

  const scope = parseScope(value.scope)
  const authority = parseAuthority(value.authority)
  const bounds = parseBounds(value.bounds)
  const counters = parseCounters(value.counters)
  const activeAction = value.activeAction === null ? null : parseAction(value.activeAction)
  const waitsForAction = value.status === 'waiting_permission' || value.status === 'waiting_action'
  if (
    (value.status === 'terminal') !== (value.stopReason !== null) ||
    waitsForAction !== (activeAction !== null) ||
    value.acceptedActionIds.length > counters.steps ||
    value.acceptedActionIds.length > bounds.maxSteps ||
    (value.acceptedActionIds.length === 0) !== (value.lastResultDigest === null)
  ) {
    fail('invalid_agent_checkpoint')
  }
  return {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    runtimeId: value.runtimeId,
    version: value.version,
    runtimeVersion: value.runtimeVersion,
    status: value.status,
    stopReason: value.stopReason,
    nextSequence: value.nextSequence,
    scope,
    authority,
    contextDigest: value.contextDigest,
    capabilitySetDigest: value.capabilitySetDigest,
    bounds,
    counters,
    acceptedActionIds: [...value.acceptedActionIds],
    lastObservationDigest: value.lastObservationDigest,
    lastResultDigest: value.lastResultDigest,
    activeAction,
    deadline: value.deadline,
    createdAt: value.createdAt,
  }
}

function metadataHasExactKeys(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    hasExactKeys(metadata, keys) &&
    Object.values(metadata).every(
      (item) =>
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  )
}

function isValidEventMetadata(type: AgentRuntimeEventType, metadata: Record<string, unknown>): boolean {
  switch (type) {
    case 'runtime_started':
      return (
        metadataHasExactKeys(metadata, ['contractVersion']) &&
        metadata.contractVersion === AGENT_RUNTIME_CONTRACT_VERSION
      )
    case 'context_attached':
      return (
        metadataHasExactKeys(metadata, ['contextDigest', 'capabilitySetDigest']) &&
        isDigest(metadata.contextDigest) &&
        isDigest(metadata.capabilitySetDigest)
      )
    case 'runtime_resumed':
      return (
        metadataHasExactKeys(metadata, ['fromCheckpointVersion']) &&
        isPositiveVersion(metadata.fromCheckpointVersion)
      )
    case 'decision_recorded':
      return (
        metadataHasExactKeys(metadata, ['actionId', 'requestDigest']) &&
        isIdentifier(metadata.actionId) &&
        isDigest(metadata.requestDigest)
      )
    case 'action_requested':
      return (
        metadataHasExactKeys(metadata, [
          'actionId',
          'actionKind',
          'capabilityId',
          'capabilityVersion',
          'requestDigest',
          'requiresPermission',
        ]) &&
        isIdentifier(metadata.actionId) &&
        (metadata.actionKind === 'tool' || metadata.actionKind === 'coding_executor') &&
        isIdentifier(metadata.capabilityId) &&
        isPositiveVersion(metadata.capabilityVersion) &&
        isDigest(metadata.requestDigest) &&
        typeof metadata.requiresPermission === 'boolean'
      )
    case 'permission_decided':
      return (
        metadataHasExactKeys(metadata, ['actionId', 'requestDigest', 'decision']) &&
        isIdentifier(metadata.actionId) &&
        isDigest(metadata.requestDigest) &&
        (metadata.decision === 'approved_once' || metadata.decision === 'denied')
      )
    case 'action_result':
      return (
        metadataHasExactKeys(metadata, [
          'actionId',
          'requestDigest',
          'outcome',
          'resultDigest',
          'resultBytes',
          'tokens',
          'costUsd',
        ]) &&
        isIdentifier(metadata.actionId) &&
        isDigest(metadata.requestDigest) &&
        (metadata.outcome === 'success' ||
          metadata.outcome === 'failure' ||
          metadata.outcome === 'cancelled' ||
          metadata.outcome === 'timeout') &&
        isDigest(metadata.resultDigest) &&
        isNonNegativeInteger(metadata.resultBytes) &&
        isNonNegativeInteger(metadata.tokens) &&
        typeof metadata.costUsd === 'number' &&
        Number.isFinite(metadata.costUsd) &&
        metadata.costUsd >= 0
      )
    case 'observation_recorded':
      return (
        metadataHasExactKeys(metadata, ['actionId', 'resultDigest']) &&
        isIdentifier(metadata.actionId) &&
        isDigest(metadata.resultDigest)
      )
    case 'evaluation_recorded':
      return (
        metadataHasExactKeys(metadata, ['evaluation', 'summary']) &&
        (metadata.evaluation === 'continue' ||
          metadata.evaluation === 'success' ||
          metadata.evaluation === 'failure') &&
        typeof metadata.summary === 'string' &&
        metadata.summary.length > 0 &&
        metadata.summary.length <= AGENT_RUNTIME_EVALUATION_SUMMARY_MAX_LENGTH &&
        redactSensitiveText(metadata.summary).value === metadata.summary
      )
    case 'checkpointed':
      return (
        metadataHasExactKeys(metadata, ['checkpointVersion']) &&
        isPositiveVersion(metadata.checkpointVersion)
      )
    case 'runtime_stopped': {
      const validKeys =
        metadataHasExactKeys(metadata, ['stopReason']) ||
        metadataHasExactKeys(metadata, ['stopReason', 'failureCode'])
      return (
        validKeys &&
        isStopReason(metadata.stopReason) &&
        (metadata.failureCode === undefined || metadata.failureCode === 'result_too_large')
      )
    }
  }
}

export function parseAgentRuntimeEvent(value: unknown): AgentRuntimeEvent {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'runtimeId',
      'sequence',
      'checkpointVersion',
      'type',
      'createdAt',
      'metadata',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isPositiveVersion(value.sequence) ||
    !isPositiveVersion(value.checkpointVersion) ||
    !eventTypes.includes(value.type as AgentRuntimeEventType) ||
    !isCanonicalIso(value.createdAt) ||
    !isPlainRecord(value.metadata) ||
    !isValidEventMetadata(value.type as AgentRuntimeEventType, value.metadata)
  ) {
    fail('invalid_agent_runtime_event')
  }
  return value as AgentRuntimeEvent
}

export function parseAgentRuntimeTransition(value: unknown): AgentRuntimeTransition {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ['runtime', 'checkpoint', 'events'])) {
      fail('invalid_agent_runtime_transition')
    }
    const runtime = parseAgentRuntimeState(value.runtime)
    const checkpoint = parseAgentCheckpoint(value.checkpoint)
    if (!Array.isArray(value.events) || value.events.length === 0) {
      fail('invalid_agent_runtime_transition')
    }
    const events = value.events.map(parseAgentRuntimeEvent)
    const firstSequence = runtime.nextSequence - events.length
    if (
      firstSequence < 1 ||
      checkpoint.runtimeId !== runtime.id ||
      checkpoint.version !== runtime.checkpointVersion ||
      checkpoint.runtimeVersion !== runtime.version ||
      checkpoint.status !== runtime.status ||
      checkpoint.stopReason !== runtime.stopReason ||
      checkpoint.nextSequence !== runtime.nextSequence ||
      JSON.stringify(checkpoint.scope) !== JSON.stringify(runtime.scope) ||
      !sameAuthority(checkpoint.authority, runtime.authority) ||
      checkpoint.contextDigest !== runtime.contextDigest ||
      checkpoint.capabilitySetDigest !== runtime.capabilitySetDigest ||
      JSON.stringify(checkpoint.bounds) !== JSON.stringify(runtime.bounds) ||
      JSON.stringify(checkpoint.counters) !== JSON.stringify(runtime.counters) ||
      JSON.stringify(checkpoint.acceptedActionIds) !== JSON.stringify(runtime.acceptedActionIds) ||
      checkpoint.lastObservationDigest !== runtime.lastObservationDigest ||
      checkpoint.lastResultDigest !== runtime.lastResultDigest ||
      JSON.stringify(checkpoint.activeAction) !== JSON.stringify(runtime.activeAction) ||
      checkpoint.deadline !== runtime.deadline ||
      checkpoint.createdAt !== runtime.updatedAt ||
      utf8Bytes(checkpoint) > runtime.bounds.maxCheckpointBytes ||
      events.some(
        (event, index) =>
          event.runtimeId !== runtime.id ||
          event.sequence !== firstSequence + index ||
          event.checkpointVersion !== runtime.checkpointVersion ||
          event.createdAt !== runtime.updatedAt ||
          utf8Bytes(event.metadata) > runtime.bounds.maxTrajectoryMetadataBytes,
      ) ||
      (runtime.status === 'terminal'
        ? events.at(-1)?.type !== 'runtime_stopped'
        : events.at(-1)?.type !== 'checkpointed')
    ) {
      fail('invalid_agent_runtime_transition')
    }
    return { runtime, checkpoint, events }
  } catch {
    fail('invalid_agent_runtime_transition')
  }
}

export function requestAgentAction(input: {
  runtime: AgentRuntimeState
  expectedCheckpointVersion: number
  now: string
  action: AgentRuntimeAction
}): AgentRuntimeTransition {
  ensureMutation(input.runtime, input.expectedCheckpointVersion, input.now)
  if (input.runtime.status !== 'running') {
    if (input.runtime.activeAction) fail('agent_action_in_progress')
    fail('invalid_agent_runtime_status')
  }
  if (Date.parse(input.now) >= Date.parse(input.runtime.deadline)) {
    return terminalTransition(input.runtime, input.now, 'timeout')
  }
  const action = parseAction(input.action)
  if (input.runtime.acceptedActionIds.includes(action.id)) {
    fail('agent_action_replay')
  }
  if (
    input.runtime.counters.steps >= input.runtime.bounds.maxSteps ||
    (action.kind === 'tool' &&
      input.runtime.counters.toolCalls >= input.runtime.bounds.maxToolCalls)
  ) {
    return terminalTransition(input.runtime, input.now, 'step_limit')
  }
  if (
    input.runtime.counters.tokens >= input.runtime.bounds.maxTokens ||
    input.runtime.counters.costUsd >= input.runtime.bounds.maxCostUsd
  ) {
    return terminalTransition(input.runtime, input.now, 'budget_exhausted')
  }

  const counters = {
    ...input.runtime.counters,
    steps: input.runtime.counters.steps + 1,
    toolCalls:
      input.runtime.counters.toolCalls + (action.kind === 'tool' ? 1 : 0),
  }
  return commitTransition(
    input.runtime,
    input.now,
    {
      status: action.requiresPermission ? 'waiting_permission' : 'waiting_action',
      counters,
      activeAction: action,
    },
    [
      {
        type: 'decision_recorded',
        metadata: { actionId: action.id, requestDigest: action.requestDigest },
      },
      {
        type: 'action_requested',
        metadata: {
          actionId: action.id,
          actionKind: action.kind,
          capabilityId: action.capabilityId,
          capabilityVersion: action.capabilityVersion,
          requestDigest: action.requestDigest,
          requiresPermission: action.requiresPermission,
        },
      },
    ],
  )
}

function ensureActionMatch(
  runtime: AgentRuntimeState,
  actionId: string,
  requestDigest: string,
): AgentRuntimeAction {
  if (
    !runtime.activeAction ||
    runtime.activeAction.id !== actionId ||
    runtime.activeAction.requestDigest !== requestDigest
  ) {
    fail('agent_action_mismatch')
  }
  return runtime.activeAction
}

export function recordAgentPermissionDecision(input: {
  runtime: AgentRuntimeState
  expectedCheckpointVersion: number
  actionId: string
  requestDigest: string
  decision: 'approved_once' | 'denied'
  now: string
}): AgentRuntimeTransition {
  ensureMutation(input.runtime, input.expectedCheckpointVersion, input.now)
  if (input.runtime.status !== 'waiting_permission') fail('invalid_agent_runtime_status')
  ensureActionMatch(input.runtime, input.actionId, input.requestDigest)
  if (input.decision !== 'approved_once' && input.decision !== 'denied') {
    fail('invalid_agent_permission_decision')
  }
  if (Date.parse(input.now) >= Date.parse(input.runtime.deadline)) {
    return terminalTransition(input.runtime, input.now, 'timeout')
  }
  const event = {
    type: 'permission_decided' as const,
    metadata: {
      actionId: input.actionId,
      requestDigest: input.requestDigest,
      decision: input.decision,
    },
  }
  if (input.decision === 'denied') {
    return terminalTransition(input.runtime, input.now, 'policy_denied', [event])
  }
  return commitTransition(input.runtime, input.now, { status: 'waiting_action' }, [event])
}

export type AgentActionResultInput = {
  outcome: 'success' | 'failure' | 'cancelled' | 'timeout'
  resultDigest: string
  resultBytes: number
  tokens: number
  costUsd: number
  evaluation: 'continue' | 'success' | 'failure'
  evaluationSummary: string
}

function parseResult(value: unknown): AgentActionResultInput {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'outcome',
      'resultDigest',
      'resultBytes',
      'tokens',
      'costUsd',
      'evaluation',
      'evaluationSummary',
    ]) ||
    !['success', 'failure', 'cancelled', 'timeout'].includes(String(value.outcome)) ||
    !isDigest(value.resultDigest) ||
    !isNonNegativeInteger(value.resultBytes) ||
    !isNonNegativeInteger(value.tokens) ||
    typeof value.costUsd !== 'number' ||
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0 ||
    !['continue', 'success', 'failure'].includes(String(value.evaluation)) ||
    typeof value.evaluationSummary !== 'string' ||
    value.evaluationSummary.length === 0 ||
    value.evaluationSummary.length > AGENT_RUNTIME_EVALUATION_SUMMARY_MAX_LENGTH ||
    (value.outcome !== 'success' && value.evaluation === 'success')
  ) {
    fail('invalid_agent_action_result')
  }
  return value as AgentActionResultInput
}

export function acceptAgentActionResult(input: {
  runtime: AgentRuntimeState
  expectedCheckpointVersion: number
  actionId: string
  requestDigest: string
  result: AgentActionResultInput
  now: string
}): AgentRuntimeTransition {
  ensureMutation(input.runtime, input.expectedCheckpointVersion, input.now)
  if (input.runtime.status !== 'waiting_action') fail('invalid_agent_runtime_status')
  ensureActionMatch(input.runtime, input.actionId, input.requestDigest)
  const result = parseResult(input.result)
  const counters = {
    ...input.runtime.counters,
    tokens: input.runtime.counters.tokens + result.tokens,
    costUsd: input.runtime.counters.costUsd + result.costUsd,
  }

  if (result.resultBytes > input.runtime.bounds.maxToolResultBytes) {
    return terminalTransition(
      input.runtime,
      input.now,
      'failure',
      [],
      { failureCode: 'result_too_large' },
      counters,
    )
  }

  const safeSummary = redactSensitiveText(result.evaluationSummary).value
  const acceptedResultState = {
    acceptedActionIds: [...input.runtime.acceptedActionIds, input.actionId],
    lastObservationDigest: result.resultDigest,
    lastResultDigest: result.resultDigest,
  }
  const pendingEvents: PendingEvent[] = [
    {
      type: 'action_result',
      metadata: {
        actionId: input.actionId,
        requestDigest: input.requestDigest,
        outcome: result.outcome,
        resultDigest: result.resultDigest,
        resultBytes: result.resultBytes,
        tokens: result.tokens,
        costUsd: result.costUsd,
      },
    },
    {
      type: 'observation_recorded',
      metadata: { actionId: input.actionId, resultDigest: result.resultDigest },
    },
    {
      type: 'evaluation_recorded',
      metadata: { evaluation: result.evaluation, summary: safeSummary },
    },
  ]

  if (result.outcome === 'cancelled') {
    return terminalTransition(
      input.runtime,
      input.now,
      'cancelled',
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  if (result.outcome === 'timeout' || Date.parse(input.now) >= Date.parse(input.runtime.deadline)) {
    return terminalTransition(
      input.runtime,
      input.now,
      'timeout',
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  if (
    counters.tokens > input.runtime.bounds.maxTokens ||
    counters.costUsd > input.runtime.bounds.maxCostUsd
  ) {
    return terminalTransition(
      input.runtime,
      input.now,
      'budget_exhausted',
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  if (result.evaluation === 'success') {
    return terminalTransition(
      input.runtime,
      input.now,
      'success',
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  if (result.evaluation === 'failure') {
    return terminalTransition(
      input.runtime,
      input.now,
      'failure',
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  if (
    counters.tokens >= input.runtime.bounds.maxTokens ||
    counters.costUsd >= input.runtime.bounds.maxCostUsd ||
    counters.steps >= input.runtime.bounds.maxSteps ||
    counters.toolCalls >= input.runtime.bounds.maxToolCalls
  ) {
    const reason =
      counters.tokens >= input.runtime.bounds.maxTokens ||
      counters.costUsd >= input.runtime.bounds.maxCostUsd
        ? 'budget_exhausted'
        : 'step_limit'
    return terminalTransition(
      input.runtime,
      input.now,
      reason,
      pendingEvents,
      {},
      counters,
      acceptedResultState,
    )
  }
  return commitTransition(
    input.runtime,
    input.now,
    { status: 'checkpointed', activeAction: null, counters, ...acceptedResultState },
    pendingEvents,
  )
}

export function cancelAgentRuntime(input: {
  runtime: AgentRuntimeState
  expectedCheckpointVersion: number
  now: string
}): AgentRuntimeTransition {
  ensureMutation(input.runtime, input.expectedCheckpointVersion, input.now)
  return terminalTransition(input.runtime, input.now, 'cancelled')
}

export type AgentEvaluationScenario = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  id: string
  version: number
  name: string
  objective: string
  executorKind: 'none' | 'native' | 'opencode'
  expected: {
    stopReason: AgentRuntimeStopReason
    maxSteps: number
    requiredEventTypes: AgentRuntimeEventType[]
    evidenceKinds: string[]
    cleanupStatus: 'not_required' | 'completed'
  }
  metricDimensions: [
    'quality',
    'cost',
    'latency',
    'human_intervention',
    'recovery',
    'isolation',
  ]
}

const eventTypes: AgentRuntimeEventType[] = [
  'runtime_started',
  'context_attached',
  'runtime_resumed',
  'decision_recorded',
  'action_requested',
  'permission_decided',
  'action_result',
  'observation_recorded',
  'evaluation_recorded',
  'checkpointed',
  'runtime_stopped',
]

const stopReasons: AgentRuntimeStopReason[] = [
  'success',
  'failure',
  'cancelled',
  'timeout',
  'step_limit',
  'budget_exhausted',
  'policy_denied',
]

const metricDimensions: AgentEvaluationScenario['metricDimensions'] = [
  'quality',
  'cost',
  'latency',
  'human_intervention',
  'recovery',
  'isolation',
]

function hasUniqueStrings(values: unknown[]): values is string[] {
  return values.every((value) => typeof value === 'string') && new Set(values).size === values.length
}

function hasExactMetricDimensions(
  value: unknown,
): value is AgentEvaluationScenario['metricDimensions'] {
  return (
    Array.isArray(value) &&
    value.length === metricDimensions.length &&
    metricDimensions.every((dimension, index) => value[index] === dimension)
  )
}

export function parseAgentEvaluationScenario(value: unknown): AgentEvaluationScenario {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'name',
      'objective',
      'executorKind',
      'expected',
      'metricDimensions',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isPositiveVersion(value.version) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 200 ||
    typeof value.objective !== 'string' ||
    value.objective.length === 0 ||
    value.objective.length > 2_000 ||
    !['none', 'native', 'opencode'].includes(String(value.executorKind)) ||
    !isPlainRecord(value.expected) ||
    !hasExactKeys(value.expected, [
      'stopReason',
      'maxSteps',
      'requiredEventTypes',
      'evidenceKinds',
      'cleanupStatus',
    ]) ||
    !stopReasons.includes(value.expected.stopReason as AgentRuntimeStopReason) ||
    !isPositiveVersion(value.expected.maxSteps) ||
    value.expected.maxSteps > AGENT_RUNTIME_MAX_STEPS ||
    !Array.isArray(value.expected.requiredEventTypes) ||
    !hasUniqueStrings(value.expected.requiredEventTypes) ||
    !value.expected.requiredEventTypes.every((type) =>
      eventTypes.includes(type as AgentRuntimeEventType),
    ) ||
    !Array.isArray(value.expected.evidenceKinds) ||
    !hasUniqueStrings(value.expected.evidenceKinds) ||
    !value.expected.evidenceKinds.every(isIdentifier) ||
    !['not_required', 'completed'].includes(String(value.expected.cleanupStatus)) ||
    !hasExactMetricDimensions(value.metricDimensions)
  ) {
    fail('invalid_agent_evaluation_scenario')
  }

  return value as AgentEvaluationScenario
}

export type AgentScenarioObservation = {
  stopReason: AgentRuntimeStopReason
  steps: number
  eventTypes: AgentRuntimeEventType[]
  evidenceKinds: string[]
  cleanupStatus: 'not_required' | 'completed' | 'failed'
  metrics: {
    qualityPassed: boolean
    costUsd: number
    latencyMs: number
    humanInterventions: number
    recoverySucceeded: boolean
    isolationViolations: number
  }
}

export function parseAgentScenarioObservation(value: unknown): AgentScenarioObservation {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stopReason',
      'steps',
      'eventTypes',
      'evidenceKinds',
      'cleanupStatus',
      'metrics',
    ]) ||
    !isStopReason(value.stopReason) ||
    !isNonNegativeInteger(value.steps) ||
    !Array.isArray(value.eventTypes) ||
    !hasUniqueStrings(value.eventTypes) ||
    !value.eventTypes.every((type) => eventTypes.includes(type as AgentRuntimeEventType)) ||
    !Array.isArray(value.evidenceKinds) ||
    !hasUniqueStrings(value.evidenceKinds) ||
    !value.evidenceKinds.every(isIdentifier) ||
    !['not_required', 'completed', 'failed'].includes(String(value.cleanupStatus)) ||
    !isPlainRecord(value.metrics) ||
    !hasExactKeys(value.metrics, [
      'qualityPassed',
      'costUsd',
      'latencyMs',
      'humanInterventions',
      'recoverySucceeded',
      'isolationViolations',
    ]) ||
    typeof value.metrics.qualityPassed !== 'boolean' ||
    typeof value.metrics.costUsd !== 'number' ||
    !Number.isFinite(value.metrics.costUsd) ||
    value.metrics.costUsd < 0 ||
    !isNonNegativeInteger(value.metrics.latencyMs) ||
    !isNonNegativeInteger(value.metrics.humanInterventions) ||
    typeof value.metrics.recoverySucceeded !== 'boolean' ||
    !isNonNegativeInteger(value.metrics.isolationViolations)
  ) {
    fail('invalid_agent_scenario_observation')
  }
  return value as AgentScenarioObservation
}

export type AgentScenarioMetricAccumulator = {
  scenarioCount: number
  qualityPassCount: number
  totalCostUsd: number
  totalLatencyMs: number
  totalHumanInterventions: number
  recoveryPassCount: number
  isolationViolations: number
}

export function accumulateAgentScenarioMetrics(
  observations: readonly AgentScenarioObservation[],
): AgentScenarioMetricAccumulator {
  return observations.reduce<AgentScenarioMetricAccumulator>(
    (accumulator, observationValue) => {
      const observation = parseAgentScenarioObservation(observationValue)
      return {
        scenarioCount: accumulator.scenarioCount + 1,
        qualityPassCount:
          accumulator.qualityPassCount + (observation.metrics.qualityPassed ? 1 : 0),
        totalCostUsd: accumulator.totalCostUsd + observation.metrics.costUsd,
        totalLatencyMs: accumulator.totalLatencyMs + observation.metrics.latencyMs,
        totalHumanInterventions:
          accumulator.totalHumanInterventions + observation.metrics.humanInterventions,
        recoveryPassCount:
          accumulator.recoveryPassCount + (observation.metrics.recoverySucceeded ? 1 : 0),
        isolationViolations:
          accumulator.isolationViolations + observation.metrics.isolationViolations,
      }
    },
    {
      scenarioCount: 0,
      qualityPassCount: 0,
      totalCostUsd: 0,
      totalLatencyMs: 0,
      totalHumanInterventions: 0,
      recoveryPassCount: 0,
      isolationViolations: 0,
    },
  )
}

export function evaluateAgentScenario(input: {
  scenario: AgentEvaluationScenario
  observed: AgentScenarioObservation
}): { passed: boolean; failures: string[] } {
  const scenario = parseAgentEvaluationScenario(input.scenario)
  const observed = parseAgentScenarioObservation(input.observed)
  const failures: string[] = []
  if (observed.stopReason !== scenario.expected.stopReason) {
    failures.push('unexpected_stop_reason')
  }
  if (observed.steps > scenario.expected.maxSteps) {
    failures.push('step_bound_exceeded')
  }
  for (const eventType of scenario.expected.requiredEventTypes) {
    if (!observed.eventTypes.includes(eventType)) {
      failures.push(`missing_event:${eventType}`)
    }
  }
  for (const evidenceKind of scenario.expected.evidenceKinds) {
    if (!observed.evidenceKinds.includes(evidenceKind)) {
      failures.push(`missing_evidence:${evidenceKind}`)
    }
  }
  if (observed.cleanupStatus !== scenario.expected.cleanupStatus) {
    failures.push('unexpected_cleanup_status')
  }
  if (!observed.metrics.qualityPassed) failures.push('quality_failed')
  if (!observed.metrics.recoverySucceeded) failures.push('recovery_failed')
  if (observed.metrics.isolationViolations !== 0) failures.push('isolation_violation')
  return { passed: failures.length === 0, failures }
}
