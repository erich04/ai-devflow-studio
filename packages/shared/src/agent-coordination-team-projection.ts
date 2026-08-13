import {
  COORDINATION_MAX_ACCEPTED_HANDOFFS,
  COORDINATION_MAX_DEPENDENCY_EDGES,
  COORDINATION_MAX_SPECIALIST_RETRIES,
  COORDINATION_MAX_SPECIALISTS,
  COORDINATION_MAX_TASK_NODES,
  type CoordinationFailureCategory,
  type CoordinationSessionState,
  type CoordinationSessionStopReason,
  type CoordinationTaskStatus,
} from './agent-coordination'
import {
  AGENT_RUNTIME_MAX_COST_USD,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOKENS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  AGENT_RUNTIME_MAX_WALL_TIME_MS,
} from './agent-runtime'
import {
  parseCoordinationRendererSnapshot,
  type CoordinationRendererSnapshot,
} from './agent-coordination-projection'

export const AGENT_COORDINATION_TEAM_PROJECTION_VERSION = 1 as const

export const AGENT_COORDINATION_TEAM_TASK_STATUSES = [
  'pending',
  'ready',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
] as const satisfies readonly CoordinationTaskStatus[]

export const AGENT_COORDINATION_TEAM_FAILURE_CATEGORIES = [
  'timeout',
  'budget_exhausted',
  'policy_denied',
  'tool_error',
  'coding_executor_error',
  'invalid_result',
  'dependency_failed',
] as const satisfies readonly CoordinationFailureCategory[]

export type AgentCoordinationTeamRoleCount = {
  roleId: string
  count: number
}

export type AgentCoordinationTeamTaskStatusCounts = Record<
  CoordinationTaskStatus,
  number
>

export type AgentCoordinationTeamFailureCategoryCounts = Record<
  CoordinationFailureCategory,
  number
>

export type RemoteAgentCoordinationSummary = {
  stateVersion: 1
  projectionVersion: typeof AGENT_COORDINATION_TEAM_PROJECTION_VERSION
  coordinationId: string
  projectId: string
  runId: string
  nodeId: string
  coordinationVersion: number
  graphVersion: number
  status: CoordinationSessionState['status']
  stopReason: CoordinationSessionStopReason | null
  roleCounts: AgentCoordinationTeamRoleCount[]
  taskStatusCounts: AgentCoordinationTeamTaskStatusCounts
  failureCategoryCounts: AgentCoordinationTeamFailureCategoryCounts
  taskCount: number
  edgeCount: number
  specialistStarts: number
  acceptedHandoffCount: number
  retryCount: number
  stepCount: number
  toolCallCount: number
  tokenCount: number
  costUsd: number
  singleAgentQuality: number | null
  coordinationQuality: number | null
  latencyMs: number
  humanInterventionCount: number
  authorityViolationCount: number
  isolationViolationCount: number
  terminationViolationCount: number
  replayViolationCount: number
  redactionViolationCount: number
  updatedAt: string
  isolated: true
  redacted: true
}

export type CreateRemoteAgentCoordinationSummaryInput = CoordinationRendererSnapshot

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const maximumVersion = 2_147_483_647
const maximumSpecialistStarts = COORDINATION_MAX_SPECIALISTS *
  (COORDINATION_MAX_SPECIALIST_RETRIES + 1)

function fail(): never {
  throw new Error('agent_coordination_team_projection_invalid')
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

function isCount(value: unknown, maximum = maximumVersion): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isBoundedDecimal(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum &&
    !Object.is(value, -0) && Number(value.toFixed(6)) === value
}

function parseRoleCounts(value: unknown): AgentCoordinationTeamRoleCount[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > COORDINATION_MAX_TASK_NODES) {
    fail()
  }
  const roles = value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['roleId', 'count']) ||
      !isIdentifier(candidate.roleId) ||
      !isCount(candidate.count, COORDINATION_MAX_TASK_NODES) ||
      candidate.count === 0
    ) fail()
    return { roleId: candidate.roleId, count: candidate.count }
  })
  if (roles.some((role, index) => index > 0 && roles[index - 1]!.roleId >= role.roleId)) fail()
  return roles
}

function parseExactCounts<T extends string>(
  value: unknown,
  keys: readonly T[],
  maximum: number,
): Record<T, number> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) fail()
  const result = {} as Record<T, number>
  for (const key of keys) {
    if (!isCount(value[key], maximum)) fail()
    result[key] = value[key]
  }
  return result
}

function parseStopReason(value: unknown): CoordinationSessionStopReason {
  if (
    value !== 'success' &&
    value !== 'failure' &&
    value !== 'cancelled' &&
    value !== 'timeout' &&
    value !== 'budget_exhausted' &&
    value !== 'policy_denied' &&
    value !== 'blocked_dependency'
  ) fail()
  return value
}

function sumCounts(value: Record<string, number>): number {
  return Object.values(value).reduce((total, count) => total + count, 0)
}

export function parseRemoteAgentCoordinationSummary(
  value: unknown,
): RemoteAgentCoordinationSummary {
  const keys = [
    'stateVersion',
    'projectionVersion',
    'coordinationId',
    'projectId',
    'runId',
    'nodeId',
    'coordinationVersion',
    'graphVersion',
    'status',
    'stopReason',
    'roleCounts',
    'taskStatusCounts',
    'failureCategoryCounts',
    'taskCount',
    'edgeCount',
    'specialistStarts',
    'acceptedHandoffCount',
    'retryCount',
    'stepCount',
    'toolCallCount',
    'tokenCount',
    'costUsd',
    'singleAgentQuality',
    'coordinationQuality',
    'latencyMs',
    'humanInterventionCount',
    'authorityViolationCount',
    'isolationViolationCount',
    'terminationViolationCount',
    'replayViolationCount',
    'redactionViolationCount',
    'updatedAt',
    'isolated',
    'redacted',
  ] as const
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.stateVersion !== 1 ||
    value.projectionVersion !== AGENT_COORDINATION_TEAM_PROJECTION_VERSION ||
    !isIdentifier(value.coordinationId) ||
    !isIdentifier(value.projectId) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isVersion(value.coordinationVersion) ||
    !isVersion(value.graphVersion) ||
    !isCount(value.taskCount, COORDINATION_MAX_TASK_NODES) ||
    value.taskCount === 0 ||
    !isCount(value.edgeCount, COORDINATION_MAX_DEPENDENCY_EDGES) ||
    !isCount(value.specialistStarts, maximumSpecialistStarts) ||
    !isCount(value.acceptedHandoffCount, COORDINATION_MAX_ACCEPTED_HANDOFFS) ||
    !isCount(value.retryCount, COORDINATION_MAX_SPECIALISTS * COORDINATION_MAX_SPECIALIST_RETRIES) ||
    !isCount(value.stepCount, AGENT_RUNTIME_MAX_STEPS) ||
    !isCount(value.toolCallCount, AGENT_RUNTIME_MAX_TOOL_CALLS) ||
    !isCount(value.tokenCount, AGENT_RUNTIME_MAX_TOKENS) ||
    !isBoundedDecimal(value.costUsd, AGENT_RUNTIME_MAX_COST_USD) ||
    !isCount(value.latencyMs, AGENT_RUNTIME_MAX_WALL_TIME_MS) ||
    !isCount(value.humanInterventionCount) ||
    !isCount(value.authorityViolationCount) ||
    !isCount(value.isolationViolationCount) ||
    !isCount(value.terminationViolationCount) ||
    !isCount(value.replayViolationCount) ||
    !isCount(value.redactionViolationCount) ||
    !isCanonicalIso(value.updatedAt) ||
    value.isolated !== true ||
    value.redacted !== true ||
    (value.status !== 'running' && value.status !== 'terminal')
  ) fail()

  const stopReason = value.stopReason === null ? null : parseStopReason(value.stopReason)
  if ((value.status === 'terminal') !== (stopReason !== null)) fail()

  const roleCounts = parseRoleCounts(value.roleCounts)
  const taskStatusCounts = parseExactCounts(
    value.taskStatusCounts,
    AGENT_COORDINATION_TEAM_TASK_STATUSES,
    COORDINATION_MAX_TASK_NODES,
  )
  const failureCategoryCounts = parseExactCounts(
    value.failureCategoryCounts,
    AGENT_COORDINATION_TEAM_FAILURE_CATEGORIES,
    COORDINATION_MAX_TASK_NODES + COORDINATION_MAX_SPECIALISTS *
      COORDINATION_MAX_SPECIALIST_RETRIES,
  )
  if (
    sumCounts(Object.fromEntries(roleCounts.map((role) => [role.roleId, role.count]))) !==
      value.taskCount ||
    sumCounts(taskStatusCounts) !== value.taskCount ||
    sumCounts(failureCategoryCounts) > value.taskCount + value.retryCount ||
    value.acceptedHandoffCount > value.edgeCount ||
    value.retryCount > value.specialistStarts
  ) fail()

  const singleAgentQuality = value.singleAgentQuality
  const coordinationQuality = value.coordinationQuality
  if (
    (singleAgentQuality === null) !== (coordinationQuality === null) ||
    (singleAgentQuality !== null && !isBoundedDecimal(singleAgentQuality, 1)) ||
    (coordinationQuality !== null && !isBoundedDecimal(coordinationQuality, 1))
  ) fail()

  return {
    stateVersion: 1,
    projectionVersion: AGENT_COORDINATION_TEAM_PROJECTION_VERSION,
    coordinationId: value.coordinationId,
    projectId: value.projectId,
    runId: value.runId,
    nodeId: value.nodeId,
    coordinationVersion: value.coordinationVersion,
    graphVersion: value.graphVersion,
    status: value.status,
    stopReason,
    roleCounts,
    taskStatusCounts,
    failureCategoryCounts,
    taskCount: value.taskCount,
    edgeCount: value.edgeCount,
    specialistStarts: value.specialistStarts,
    acceptedHandoffCount: value.acceptedHandoffCount,
    retryCount: value.retryCount,
    stepCount: value.stepCount,
    toolCallCount: value.toolCallCount,
    tokenCount: value.tokenCount,
    costUsd: value.costUsd,
    singleAgentQuality,
    coordinationQuality,
    latencyMs: value.latencyMs,
    humanInterventionCount: value.humanInterventionCount,
    authorityViolationCount: value.authorityViolationCount,
    isolationViolationCount: value.isolationViolationCount,
    terminationViolationCount: value.terminationViolationCount,
    replayViolationCount: value.replayViolationCount,
    redactionViolationCount: value.redactionViolationCount,
    updatedAt: value.updatedAt,
    isolated: true,
    redacted: true,
  }
}

export function createRemoteAgentCoordinationSummary(
  value: CreateRemoteAgentCoordinationSummaryInput,
): RemoteAgentCoordinationSummary {
  const snapshot = parseCoordinationRendererSnapshot(value)
  const roleCounts = [...new Set(snapshot.tasks.map((task) => task.roleId))]
    .sort((left, right) => left.localeCompare(right))
    .map((roleId) => ({
      roleId,
      count: snapshot.tasks.filter((task) => task.roleId === roleId).length,
    }))
  const taskStatusCounts = Object.fromEntries(
    AGENT_COORDINATION_TEAM_TASK_STATUSES.map((status) => [
      status,
      snapshot.tasks.filter((task) => task.status === status).length,
    ]),
  ) as AgentCoordinationTeamTaskStatusCounts
  const failures = snapshot.tasks.flatMap((task) => [
    ...task.attemptFailures,
    ...(task.failure === null ? [] : [task.failure]),
  ])
  const failureCategoryCounts = Object.fromEntries(
    AGENT_COORDINATION_TEAM_FAILURE_CATEGORIES.map((category) => [
      category,
      failures.filter((failure) => failure.category === category).length,
    ]),
  ) as AgentCoordinationTeamFailureCategoryCounts

  return parseRemoteAgentCoordinationSummary({
    stateVersion: 1,
    projectionVersion: AGENT_COORDINATION_TEAM_PROJECTION_VERSION,
    coordinationId: snapshot.session.coordinationId,
    projectId: snapshot.session.localProjectId,
    runId: snapshot.session.runId,
    nodeId: snapshot.session.nodeId,
    coordinationVersion: snapshot.session.version,
    graphVersion: snapshot.session.graphVersion,
    status: snapshot.session.status,
    stopReason: snapshot.session.stopReason,
    roleCounts,
    taskStatusCounts,
    failureCategoryCounts,
    taskCount: snapshot.session.taskCount,
    edgeCount: snapshot.session.edgeCount,
    specialistStarts: snapshot.session.counters.specialistStarts,
    acceptedHandoffCount: snapshot.session.acceptedHandoffCount,
    retryCount: snapshot.session.counters.retries,
    stepCount: snapshot.session.counters.steps,
    toolCallCount: snapshot.session.counters.toolCalls,
    tokenCount: snapshot.session.counters.tokens,
    costUsd: snapshot.session.counters.costUsd,
    singleAgentQuality: null,
    coordinationQuality: null,
    latencyMs: Date.parse(snapshot.session.updatedAt) - Date.parse(snapshot.session.startedAt),
    humanInterventionCount: 0,
    authorityViolationCount: 0,
    isolationViolationCount: 0,
    terminationViolationCount: 0,
    replayViolationCount: 0,
    redactionViolationCount: 0,
    updatedAt: snapshot.session.updatedAt,
    isolated: true,
    redacted: true,
  })
}
