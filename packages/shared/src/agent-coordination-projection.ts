import {
  parseAgentTaskGraph,
  parseCoordinationResourceLease,
  parseCoordinationSessionRequest,
  parseCoordinationSessionState,
  type AgentHandoff,
  type AgentTaskGraph,
  type AgentTaskResourceRequirement,
  type CoordinationBounds,
  type CoordinationCounters,
  type CoordinationFailureCategory,
  type CoordinationResourceLease,
  type CoordinationResourceLeaseStatus,
  type CoordinationSessionRequest,
  type CoordinationSessionState,
  type CoordinationSessionStopReason,
  type CoordinationTaskFailure,
  type CoordinationTaskStatus,
} from './agent-coordination'
import { redactSensitiveText } from './redaction'

export const COORDINATION_RENDERER_PROJECTION_VERSION = 1 as const

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const maxVersion = 2_147_483_647

export type CoordinationRendererSession = {
  projectionVersion: typeof COORDINATION_RENDERER_PROJECTION_VERSION
  coordinationId: string
  graphId: string
  graphVersion: number
  runId: string
  nodeId: string
  localProjectId: string
  runVersion: number
  policyVersion: number
  version: number
  status: CoordinationSessionState['status']
  stopReason: CoordinationSessionStopReason | null
  bounds: CoordinationBounds
  counters: CoordinationCounters
  taskCount: number
  edgeCount: number
  acceptedHandoffCount: number
  requestedAt: string
  startedAt: string
  updatedAt: string
  deadline: string
  redacted: true
}

export type CoordinationRendererFailure = {
  category: CoordinationFailureCategory
  code: string
  sourceTaskId: string | null
}

export type CoordinationRendererTask = {
  projectionVersion: typeof COORDINATION_RENDERER_PROJECTION_VERSION
  taskId: string
  version: number
  roleId: string
  dependencyTaskIds: string[]
  capabilityIds: string[]
  contextDigest: string
  resources: AgentTaskResourceRequirement[]
  status: CoordinationTaskStatus
  agentId: string | null
  runtimeId: string | null
  runtimeVersion: number | null
  resultDigest: string | null
  failure: CoordinationRendererFailure | null
  attemptFailures: CoordinationRendererFailure[]
  acceptedDependencyHandoffIds: string[]
  redacted: true
}

export type CoordinationRendererHandoff = {
  projectionVersion: typeof COORDINATION_RENDERER_PROJECTION_VERSION
  handoffId: string
  sequence: number
  sourceTaskId: string
  sourceTaskVersion: number
  sourceRuntimeId: string
  sourceRuntimeVersion: number
  targetTaskId: string
  targetTaskVersion: number
  resultDigest: string
  evidenceDigests: string[]
  contextDigest: string
  resourceLeaseOutcome: AgentHandoff['resourceLeaseOutcome']
  createdAt: string
  redacted: true
}

export type CoordinationRendererLease = {
  projectionVersion: typeof COORDINATION_RENDERER_PROJECTION_VERSION
  leaseId: string
  taskId: string
  taskVersion: number
  runtimeId: string
  runtimeVersion: number
  capabilityId: string
  capabilityVersion: number
  resourceId: string
  resourceDigest: string
  mode: CoordinationResourceLease['mode']
  status: CoordinationResourceLeaseStatus
  version: number
  acquiredAt: string
  expiresAt: string
  releasedAt: string | null
  redacted: true
}

export type CoordinationRendererSnapshot = {
  projectionVersion: typeof COORDINATION_RENDERER_PROJECTION_VERSION
  session: CoordinationRendererSession
  tasks: CoordinationRendererTask[]
  handoffs: CoordinationRendererHandoff[]
  leases: CoordinationRendererLease[]
  readyTaskIds: string[]
  redacted: true
}

export type CoordinationRendererSnapshotSource = {
  coordination: unknown
  graph: unknown
  state: unknown
  handoffs: unknown[]
  leases: unknown[]
}

function fail(): never {
  throw new Error('invalid_coordination_renderer_snapshot')
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

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= maxVersion
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number.isSafeInteger(value)
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isIdentifierList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
}

function isDigestList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isDigest) && new Set(value).size === value.length
}

function isBounds(value: unknown): value is CoordinationBounds {
  if (!isRecord(value) || !hasExactKeys(value, [
    'maxSpecialists',
    'maxTaskNodes',
    'maxDependencyEdges',
    'maxDelegationDepth',
    'maxParallelSpecialists',
    'maxAcceptedHandoffs',
    'maxSpecialistRetries',
    'maxHandoffSummaryBytes',
    'maxSteps',
    'maxWallTimeMs',
    'maxToolCalls',
    'maxTokens',
    'maxCostUsd',
  ])) return false
  const integerKeys = [
    'maxSpecialists',
    'maxTaskNodes',
    'maxDependencyEdges',
    'maxDelegationDepth',
    'maxParallelSpecialists',
    'maxAcceptedHandoffs',
    'maxHandoffSummaryBytes',
    'maxSteps',
    'maxWallTimeMs',
    'maxToolCalls',
    'maxTokens',
  ] as const
  return integerKeys.every((key) => isVersion(value[key])) &&
    isCount(value.maxSpecialistRetries) &&
    typeof value.maxCostUsd === 'number' &&
    Number.isFinite(value.maxCostUsd) &&
    value.maxCostUsd > 0
}

function isCounters(value: unknown): value is CoordinationCounters {
  return isRecord(value) && hasExactKeys(value, [
    'specialistStarts',
    'activeSpecialists',
    'acceptedHandoffs',
    'retries',
    'steps',
    'toolCalls',
    'tokens',
    'costUsd',
  ]) &&
    isCount(value.specialistStarts) &&
    isCount(value.activeSpecialists) &&
    isCount(value.acceptedHandoffs) &&
    isCount(value.retries) &&
    isCount(value.steps) &&
    isCount(value.toolCalls) &&
    isCount(value.tokens) &&
    typeof value.costUsd === 'number' &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0
}

const failureCategories = new Set<CoordinationFailureCategory>([
  'timeout',
  'budget_exhausted',
  'policy_denied',
  'tool_error',
  'coding_executor_error',
  'invalid_result',
  'dependency_failed',
])

function isFailure(value: unknown): value is CoordinationTaskFailure {
  return isRecord(value) &&
    hasExactKeys(value, ['category', 'code', 'sourceTaskId']) &&
    failureCategories.has(value.category as CoordinationFailureCategory) &&
    isIdentifier(value.code) &&
    redactSensitiveText(value.code).value === value.code &&
    (value.sourceTaskId === null || isIdentifier(value.sourceTaskId))
}

function isResource(value: unknown): value is AgentTaskResourceRequirement {
  return isRecord(value) &&
    hasExactKeys(value, ['resourceId', 'resourceDigest', 'mode']) &&
    isIdentifier(value.resourceId) &&
    isDigest(value.resourceDigest) &&
    (value.mode === 'read' || value.mode === 'write')
}

function parseSession(value: unknown): CoordinationRendererSession {
  if (!isRecord(value) || !hasExactKeys(value, [
    'projectionVersion',
    'coordinationId',
    'graphId',
    'graphVersion',
    'runId',
    'nodeId',
    'localProjectId',
    'runVersion',
    'policyVersion',
    'version',
    'status',
    'stopReason',
    'bounds',
    'counters',
    'taskCount',
    'edgeCount',
    'acceptedHandoffCount',
    'requestedAt',
    'startedAt',
    'updatedAt',
    'deadline',
    'redacted',
  ]) ||
    value.projectionVersion !== COORDINATION_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.coordinationId) ||
    !isIdentifier(value.graphId) ||
    !isVersion(value.graphVersion) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isIdentifier(value.localProjectId) ||
    !isVersion(value.runVersion) ||
    !isVersion(value.policyVersion) ||
    !isVersion(value.version) ||
    (value.status !== 'running' && value.status !== 'terminal') ||
    (value.stopReason !== null && ![
      'success',
      'failure',
      'cancelled',
      'timeout',
      'budget_exhausted',
      'policy_denied',
      'blocked_dependency',
    ].includes(String(value.stopReason))) ||
    (value.status === 'terminal') !== (value.stopReason !== null) ||
    !isBounds(value.bounds) ||
    !isCounters(value.counters) ||
    !isCount(value.taskCount) ||
    !isCount(value.edgeCount) ||
    !isCount(value.acceptedHandoffCount) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.startedAt) ||
    !isCanonicalIso(value.updatedAt) ||
    !isCanonicalIso(value.deadline) ||
    Date.parse(value.requestedAt) > Date.parse(value.startedAt) ||
    Date.parse(value.startedAt) > Date.parse(value.updatedAt) ||
    Date.parse(value.updatedAt) > Date.parse(value.deadline) ||
    value.redacted !== true
  ) fail()
  return clone(value as CoordinationRendererSession)
}

function parseTask(value: unknown): CoordinationRendererTask {
  if (!isRecord(value) || !hasExactKeys(value, [
    'projectionVersion',
    'taskId',
    'version',
    'roleId',
    'dependencyTaskIds',
    'capabilityIds',
    'contextDigest',
    'resources',
    'status',
    'agentId',
    'runtimeId',
    'runtimeVersion',
    'resultDigest',
    'failure',
    'attemptFailures',
    'acceptedDependencyHandoffIds',
    'redacted',
  ]) ||
    value.projectionVersion !== COORDINATION_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.taskId) ||
    !isVersion(value.version) ||
    !isIdentifier(value.roleId) ||
    !isIdentifierList(value.dependencyTaskIds) ||
    !isIdentifierList(value.capabilityIds) ||
    value.capabilityIds.length === 0 ||
    !isDigest(value.contextDigest) ||
    !Array.isArray(value.resources) ||
    !value.resources.every(isResource) ||
    !['pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'blocked']
      .includes(String(value.status)) ||
    (value.agentId !== null && !isIdentifier(value.agentId)) ||
    (value.runtimeId !== null && !isIdentifier(value.runtimeId)) ||
    (value.runtimeVersion !== null && !isVersion(value.runtimeVersion)) ||
    (value.resultDigest !== null && !isDigest(value.resultDigest)) ||
    (value.failure !== null && !isFailure(value.failure)) ||
    !Array.isArray(value.attemptFailures) ||
    !value.attemptFailures.every(isFailure) ||
    !isIdentifierList(value.acceptedDependencyHandoffIds) ||
    value.redacted !== true
  ) fail()
  const hasOwner = value.agentId !== null && value.runtimeId !== null && value.runtimeVersion !== null
  const hasNoOwner = value.agentId === null && value.runtimeId === null && value.runtimeVersion === null
  if (!hasOwner && !hasNoOwner) fail()
  const validLifecycle =
    ((value.status === 'pending' || value.status === 'ready') &&
      hasNoOwner && value.resultDigest === null && value.failure === null) ||
    (value.status === 'running' &&
      hasOwner && value.resultDigest === null && value.failure === null) ||
    (value.status === 'succeeded' &&
      hasOwner && isDigest(value.resultDigest) && value.failure === null) ||
    (value.status === 'failed' &&
      hasOwner && value.resultDigest === null && isFailure(value.failure) &&
      value.failure.category !== 'dependency_failed' && value.failure.sourceTaskId === value.taskId) ||
    (value.status === 'cancelled' &&
      (hasOwner || hasNoOwner) && value.resultDigest === null && value.failure === null) ||
    (value.status === 'blocked' &&
      (hasOwner || hasNoOwner) && value.resultDigest === null && isFailure(value.failure) &&
      value.failure.category === 'dependency_failed')
  if (
    !validLifecycle ||
    value.attemptFailures.some((failure) =>
      failure.category === 'dependency_failed' || failure.sourceTaskId !== value.taskId)
  ) fail()
  return clone(value as CoordinationRendererTask)
}

function parseHandoff(value: unknown): CoordinationRendererHandoff {
  if (!isRecord(value) || !hasExactKeys(value, [
    'projectionVersion',
    'handoffId',
    'sequence',
    'sourceTaskId',
    'sourceTaskVersion',
    'sourceRuntimeId',
    'sourceRuntimeVersion',
    'targetTaskId',
    'targetTaskVersion',
    'resultDigest',
    'evidenceDigests',
    'contextDigest',
    'resourceLeaseOutcome',
    'createdAt',
    'redacted',
  ]) ||
    value.projectionVersion !== COORDINATION_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.handoffId) ||
    !isVersion(value.sequence) ||
    !isIdentifier(value.sourceTaskId) ||
    !isVersion(value.sourceTaskVersion) ||
    !isIdentifier(value.sourceRuntimeId) ||
    !isVersion(value.sourceRuntimeVersion) ||
    !isIdentifier(value.targetTaskId) ||
    !isVersion(value.targetTaskVersion) ||
    !isDigest(value.resultDigest) ||
    !isDigestList(value.evidenceDigests) ||
    !isDigest(value.contextDigest) ||
    (value.resourceLeaseOutcome !== 'not_required' && value.resourceLeaseOutcome !== 'released') ||
    !isCanonicalIso(value.createdAt) ||
    value.redacted !== true
  ) fail()
  return clone(value as CoordinationRendererHandoff)
}

function parseLease(value: unknown): CoordinationRendererLease {
  if (!isRecord(value) || !hasExactKeys(value, [
    'projectionVersion',
    'leaseId',
    'taskId',
    'taskVersion',
    'runtimeId',
    'runtimeVersion',
    'capabilityId',
    'capabilityVersion',
    'resourceId',
    'resourceDigest',
    'mode',
    'status',
    'version',
    'acquiredAt',
    'expiresAt',
    'releasedAt',
    'redacted',
  ]) ||
    value.projectionVersion !== COORDINATION_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.leaseId) ||
    !isIdentifier(value.taskId) ||
    !isVersion(value.taskVersion) ||
    !isIdentifier(value.runtimeId) ||
    !isVersion(value.runtimeVersion) ||
    !isIdentifier(value.capabilityId) ||
    !isVersion(value.capabilityVersion) ||
    !isIdentifier(value.resourceId) ||
    !isDigest(value.resourceDigest) ||
    (value.mode !== 'read' && value.mode !== 'write') ||
    !['active', 'released', 'expired', 'cancelled'].includes(String(value.status)) ||
    !isVersion(value.version) ||
    !isCanonicalIso(value.acquiredAt) ||
    !isCanonicalIso(value.expiresAt) ||
    (value.releasedAt !== null && !isCanonicalIso(value.releasedAt)) ||
    (value.status === 'active') !== (value.releasedAt === null) ||
    value.redacted !== true
  ) fail()
  return clone(value as CoordinationRendererLease)
}

export function parseCoordinationRendererSnapshot(value: unknown): CoordinationRendererSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, [
    'projectionVersion',
    'session',
    'tasks',
    'handoffs',
    'leases',
    'readyTaskIds',
    'redacted',
  ]) ||
    value.projectionVersion !== COORDINATION_RENDERER_PROJECTION_VERSION ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.handoffs) ||
    !Array.isArray(value.leases) ||
    !isIdentifierList(value.readyTaskIds) ||
    value.redacted !== true
  ) fail()
  const session = parseSession(value.session)
  const tasks = value.tasks.map(parseTask)
  const handoffs = value.handoffs.map(parseHandoff)
  const leases = value.leases.map(parseLease)
  const taskIds = tasks.map((task) => task.taskId)
  const handoffIds = handoffs.map((handoff) => handoff.handoffId)
  const leaseIds = leases.map((lease) => lease.leaseId)
  const readyTaskIds = tasks
    .filter((task) => task.status === 'ready')
    .map((task) => task.taskId)
    .sort((left, right) => left.localeCompare(right))
  const acceptedDependencyHandoffIds = tasks.flatMap(
    (task) => task.acceptedDependencyHandoffIds,
  )
  const inDegree = new Map(taskIds.map((taskId) => [taskId, 0]))
  const dependents = new Map(taskIds.map((taskId) => [taskId, [] as string[]]))
  for (const task of tasks) {
    for (const dependencyTaskId of task.dependencyTaskIds) {
      inDegree.set(task.taskId, (inDegree.get(task.taskId) ?? 0) + 1)
      dependents.get(dependencyTaskId)?.push(task.taskId)
    }
  }
  const queue = taskIds.filter((taskId) => inDegree.get(taskId) === 0).sort()
  let visited = 0
  while (queue.length > 0) {
    const taskId = queue.shift()!
    visited += 1
    for (const dependentId of dependents.get(taskId) ?? []) {
      const nextDegree = (inDegree.get(dependentId) ?? 0) - 1
      inDegree.set(dependentId, nextDegree)
      if (nextDegree === 0) queue.push(dependentId)
    }
  }
  if (
    new Set(taskIds).size !== taskIds.length ||
    new Set(handoffIds).size !== handoffIds.length ||
    new Set(leaseIds).size !== leaseIds.length ||
    session.taskCount !== tasks.length ||
    session.edgeCount !== tasks.reduce((count, task) => count + task.dependencyTaskIds.length, 0) ||
    session.acceptedHandoffCount !== handoffs.length ||
    session.counters.acceptedHandoffs !== handoffs.length ||
    session.counters.activeSpecialists !==
      tasks.filter((task) => task.status === 'running').length ||
    session.counters.specialistStarts < session.counters.activeSpecialists ||
    session.counters.steps > session.bounds.maxSteps ||
    session.counters.toolCalls > session.bounds.maxToolCalls ||
    session.counters.tokens > session.bounds.maxTokens ||
    session.counters.costUsd > session.bounds.maxCostUsd ||
    visited !== tasks.length ||
    !sameJson(value.readyTaskIds, readyTaskIds) ||
    tasks.some((task) => task.dependencyTaskIds.some((dependencyId) =>
      dependencyId === task.taskId || !taskIds.includes(dependencyId))) ||
    handoffs.some((handoff, index) =>
      handoff.sequence !== index + 1 ||
      !taskIds.includes(handoff.sourceTaskId) ||
      !taskIds.includes(handoff.targetTaskId) ||
      tasks.find((task) => task.taskId === handoff.sourceTaskId)?.resultDigest !==
        handoff.resultDigest ||
      tasks.find((task) => task.taskId === handoff.sourceTaskId)?.contextDigest !==
        handoff.contextDigest ||
      !tasks.find((task) => task.taskId === handoff.targetTaskId)
        ?.acceptedDependencyHandoffIds.includes(handoff.handoffId)) ||
    !sameJson([...acceptedDependencyHandoffIds].sort(), [...handoffIds].sort()) ||
    leases.some((lease) => !taskIds.includes(lease.taskId))
  ) fail()
  return {
    projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
    session,
    tasks,
    handoffs,
    leases,
    readyTaskIds: [...value.readyTaskIds],
    redacted: true,
  }
}

export function createCoordinationRendererSnapshot(
  value: CoordinationRendererSnapshotSource,
): CoordinationRendererSnapshot {
  try {
    const state = parseCoordinationSessionState(value.state)
    const coordination = parseCoordinationSessionRequest(value.coordination, state.bounds)
    if (!isRecord(value.graph) || !Array.isArray(value.graph.nodes)) fail()
    const acceptedRoleIds = value.graph.nodes.flatMap((node) =>
      isRecord(node) && typeof node.roleId === 'string' ? [node.roleId] : [])
    const graph = parseAgentTaskGraph(value.graph, {
      coordinationId: coordination.id,
      acceptedRoleIds,
      maxTaskNodes: coordination.bounds.maxTaskNodes,
      maxDependencyEdges: coordination.bounds.maxDependencyEdges,
    }).graph
    if (
      state.id !== coordination.id ||
      state.graphId !== graph.id ||
      state.graphVersion !== graph.version ||
      !sameJson(state.scope, coordination.scope) ||
      !sameJson(state.authority, coordination.authority) ||
      state.contextDigest !== coordination.contextDigest ||
      state.capabilitySetDigest !== coordination.capabilitySetDigest ||
      !sameJson(state.bounds, coordination.bounds) ||
      state.requestedAt !== coordination.requestedAt ||
      state.deadline !== coordination.deadline ||
      state.tasks.length !== graph.nodes.length ||
      !Array.isArray(value.handoffs) ||
      !Array.isArray(value.leases)
    ) fail()
    const handoffs = value.handoffs as AgentHandoff[]
    if (
      handoffs.some((handoff) =>
        !isRecord(handoff) ||
        handoff.coordinationId !== coordination.id ||
        !sameJson(handoff.scope, coordination.scope)) ||
      !sameJson(state.acceptedHandoffIds, handoffs.map((handoff) => handoff.id))
    ) fail()
    const leases = value.leases.map((lease) => parseCoordinationResourceLease(lease, {
      coordination,
      graph,
    }))
    const snapshot: CoordinationRendererSnapshot = {
      projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
      session: {
        projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
        coordinationId: coordination.id,
        graphId: graph.id,
        graphVersion: graph.version,
        runId: coordination.authority.runId,
        nodeId: coordination.authority.nodeId,
        localProjectId: coordination.scope.localProjectId,
        runVersion: coordination.authority.runVersion,
        policyVersion: coordination.authority.policyVersion,
        version: state.version,
        status: state.status,
        stopReason: state.stopReason,
        bounds: clone(state.bounds),
        counters: clone(state.counters),
        taskCount: state.tasks.length,
        edgeCount: graph.edges.length,
        acceptedHandoffCount: handoffs.length,
        requestedAt: state.requestedAt,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        deadline: state.deadline,
        redacted: true,
      },
      tasks: state.tasks.map((task) => {
        const graphTask = graph.nodes.find((node) => node.id === task.id)
        if (graphTask === undefined) fail()
        return {
          projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
          taskId: task.id,
          version: task.version,
          roleId: graphTask.roleId,
          dependencyTaskIds: graph.edges
            .filter((edge) => edge.targetTaskId === task.id)
            .map((edge) => edge.sourceTaskId)
            .sort((left, right) => left.localeCompare(right)),
          capabilityIds: [...graphTask.capabilityIds],
          contextDigest: graphTask.contextDigest,
          resources: graphTask.resourceRequirements.map((resource) => ({ ...resource })),
          status: task.status,
          agentId: task.agentId,
          runtimeId: task.runtimeId,
          runtimeVersion: task.runtimeVersion,
          resultDigest: task.resultDigest,
          failure: task.failure === null ? null : { ...task.failure },
          attemptFailures: task.attemptFailures.map((failure) => ({ ...failure })),
          acceptedDependencyHandoffIds: [...task.acceptedDependencyHandoffIds],
          redacted: true,
        }
      }),
      handoffs: handoffs.map((handoff) => ({
        projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
        handoffId: handoff.id,
        sequence: handoff.sequence,
        sourceTaskId: handoff.sourceTaskId,
        sourceTaskVersion: handoff.sourceTaskVersion,
        sourceRuntimeId: handoff.sourceRuntimeId,
        sourceRuntimeVersion: handoff.sourceRuntimeVersion,
        targetTaskId: handoff.targetTaskId,
        targetTaskVersion: handoff.targetTaskVersion,
        resultDigest: handoff.resultDigest,
        evidenceDigests: [...handoff.evidenceDigests],
        contextDigest: handoff.contextDigest,
        resourceLeaseOutcome: handoff.resourceLeaseOutcome,
        createdAt: handoff.createdAt,
        redacted: true,
      })),
      leases: leases.map((lease) => ({
        projectionVersion: COORDINATION_RENDERER_PROJECTION_VERSION,
        leaseId: lease.id,
        taskId: lease.taskId,
        taskVersion: lease.taskVersion,
        runtimeId: lease.runtimeId,
        runtimeVersion: lease.runtimeVersion,
        capabilityId: lease.capabilityId,
        capabilityVersion: lease.capabilityVersion,
        resourceId: lease.resourceId,
        resourceDigest: lease.resourceDigest,
        mode: lease.mode,
        status: lease.status,
        version: lease.version,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
        releasedAt: lease.releasedAt,
        redacted: true,
      })),
      readyTaskIds: state.tasks
        .filter((task) => task.status === 'ready')
        .map((task) => task.id)
        .sort((left, right) => left.localeCompare(right)),
      redacted: true,
    }
    return parseCoordinationRendererSnapshot(snapshot)
  } catch {
    return fail()
  }
}
