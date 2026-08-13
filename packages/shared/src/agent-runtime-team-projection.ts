import {
  AGENT_RUNTIME_MAX_COST_USD,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOKENS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  parseAgentRuntimeState,
  type AgentRuntimeCounters,
  type AgentRuntimeState,
  type AgentRuntimeStatus,
  type AgentRuntimeStopReason,
} from './agent-runtime'

export const AGENT_RUNTIME_TEAM_PROJECTION_VERSION = 1 as const

export type RemoteAgentRuntimeSummary = {
  stateVersion: 1
  projectionVersion: typeof AGENT_RUNTIME_TEAM_PROJECTION_VERSION
  runtimeId: string
  projectId: string
  runId: string
  nodeId: string
  runtimeVersion: number
  checkpointVersion: number
  status: AgentRuntimeStatus
  stopReason: AgentRuntimeStopReason | null
  counters: AgentRuntimeCounters
  acceptedActionCount: number
  contextDigest: string
  capabilitySetDigest: string
  lastObservationDigest: string
  lastResultDigest: string | null
  startedAt: string
  updatedAt: string
  redacted: true
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const maximumVersion = 2_147_483_647

function fail(): never {
  throw new Error('agent_runtime_team_projection_invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= maximumVersion
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function parseStatus(value: unknown): AgentRuntimeStatus {
  if (
    value !== 'running' &&
    value !== 'waiting_permission' &&
    value !== 'waiting_action' &&
    value !== 'checkpointed' &&
    value !== 'terminal'
  ) fail()
  return value
}

function parseStopReason(value: unknown): AgentRuntimeStopReason {
  if (
    value !== 'success' &&
    value !== 'failure' &&
    value !== 'cancelled' &&
    value !== 'timeout' &&
    value !== 'step_limit' &&
    value !== 'budget_exhausted' &&
    value !== 'policy_denied'
  ) fail()
  return value
}

function parseCounters(value: unknown): AgentRuntimeCounters {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['steps', 'toolCalls', 'tokens', 'costUsd']) ||
    !isCount(value.steps) ||
    !isCount(value.toolCalls) ||
    !isCount(value.tokens) ||
    typeof value.costUsd !== 'number' ||
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0 ||
    Object.is(value.costUsd, -0) ||
    value.steps > AGENT_RUNTIME_MAX_STEPS ||
    value.toolCalls > AGENT_RUNTIME_MAX_TOOL_CALLS ||
    value.tokens > AGENT_RUNTIME_MAX_TOKENS ||
    value.costUsd > AGENT_RUNTIME_MAX_COST_USD ||
    Number(value.costUsd.toFixed(6)) !== value.costUsd
  ) fail()
  return {
    steps: value.steps,
    toolCalls: value.toolCalls,
    tokens: value.tokens,
    costUsd: value.costUsd,
  }
}

export function parseRemoteAgentRuntimeSummary(value: unknown): RemoteAgentRuntimeSummary {
  const keys = [
    'stateVersion',
    'projectionVersion',
    'runtimeId',
    'projectId',
    'runId',
    'nodeId',
    'runtimeVersion',
    'checkpointVersion',
    'status',
    'stopReason',
    'counters',
    'acceptedActionCount',
    'contextDigest',
    'capabilitySetDigest',
    'lastObservationDigest',
    'lastResultDigest',
    'startedAt',
    'updatedAt',
    'redacted',
  ] as const
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.stateVersion !== 1 ||
    value.projectionVersion !== AGENT_RUNTIME_TEAM_PROJECTION_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isIdentifier(value.projectId) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isVersion(value.runtimeVersion) ||
    !isVersion(value.checkpointVersion) ||
    value.runtimeVersion !== value.checkpointVersion ||
    !isCount(value.acceptedActionCount) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isDigest(value.lastObservationDigest) ||
    (value.lastResultDigest !== null && !isDigest(value.lastResultDigest)) ||
    !isCanonicalIso(value.startedAt) ||
    !isCanonicalIso(value.updatedAt) ||
    Date.parse(value.startedAt) > Date.parse(value.updatedAt) ||
    value.redacted !== true
  ) fail()
  const status = parseStatus(value.status)
  const stopReason = value.stopReason === null ? null : parseStopReason(value.stopReason)
  const counters = parseCounters(value.counters)
  if (
    (status === 'terminal') !== (stopReason !== null) ||
    Number(value.acceptedActionCount) > counters.steps
  ) fail()
  return {
    stateVersion: 1,
    projectionVersion: AGENT_RUNTIME_TEAM_PROJECTION_VERSION,
    runtimeId: value.runtimeId,
    projectId: value.projectId,
    runId: value.runId,
    nodeId: value.nodeId,
    runtimeVersion: value.runtimeVersion,
    checkpointVersion: value.checkpointVersion,
    status,
    stopReason,
    counters,
    acceptedActionCount: value.acceptedActionCount,
    contextDigest: value.contextDigest,
    capabilitySetDigest: value.capabilitySetDigest,
    lastObservationDigest: value.lastObservationDigest,
    lastResultDigest: value.lastResultDigest,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    redacted: true,
  }
}

export function createRemoteAgentRuntimeSummary(value: unknown): RemoteAgentRuntimeSummary {
  let runtime: AgentRuntimeState
  try {
    runtime = parseAgentRuntimeState(value)
  } catch {
    fail()
  }
  if (runtime.scope.kind !== 'team' || runtime.scope.projectId === null) fail()
  return parseRemoteAgentRuntimeSummary({
    stateVersion: 1,
    projectionVersion: AGENT_RUNTIME_TEAM_PROJECTION_VERSION,
    runtimeId: runtime.id,
    projectId: runtime.scope.projectId,
    runId: runtime.authority.runId,
    nodeId: runtime.authority.nodeId,
    runtimeVersion: runtime.version,
    checkpointVersion: runtime.checkpointVersion,
    status: runtime.status,
    stopReason: runtime.stopReason,
    counters: { ...runtime.counters },
    acceptedActionCount: runtime.acceptedActionIds.length,
    contextDigest: runtime.contextDigest,
    capabilitySetDigest: runtime.capabilitySetDigest,
    lastObservationDigest: runtime.lastObservationDigest,
    lastResultDigest: runtime.lastResultDigest,
    startedAt: runtime.startedAt,
    updatedAt: runtime.updatedAt,
    redacted: true,
  })
}
