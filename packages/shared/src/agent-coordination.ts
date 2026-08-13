import {
  AGENT_RUNTIME_MAX_COST_USD,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOKENS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  AGENT_RUNTIME_MAX_WALL_TIME_MS,
} from './agent-runtime'
import { redactSensitiveText } from './redaction'

export const COORDINATION_CONTRACT_VERSION = 1 as const
export const COORDINATION_MAX_SPECIALISTS = 4
export const COORDINATION_MAX_TASK_NODES = 12
export const COORDINATION_MAX_DEPENDENCY_EDGES = 24
export const COORDINATION_MAX_DELEGATION_DEPTH = 1
export const COORDINATION_MAX_PARALLEL_SPECIALISTS = 3
export const COORDINATION_MAX_ACCEPTED_HANDOFFS = 16
export const COORDINATION_MAX_SPECIALIST_RETRIES = 1
export const COORDINATION_MAX_HANDOFF_SUMMARY_BYTES = 16_384
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u

export type CoordinationScope = {
  organizationId: string
  projectId: string
  userId: string
  sessionId: string
  localProjectId: string
}

export type CoordinationAuthority = {
  runId: string
  nodeId: string
  runVersion: number
  policyVersion: number
  supervisorRuntimeId: string
  supervisorRuntimeVersion: number
}

export type CoordinationParentBounds = {
  maxSteps: number
  maxWallTimeMs: number
  maxToolCalls: number
  maxTokens: number
  maxCostUsd: number
}

export type CoordinationBounds = CoordinationParentBounds & {
  maxSpecialists: number
  maxTaskNodes: number
  maxDependencyEdges: number
  maxDelegationDepth: number
  maxParallelSpecialists: number
  maxAcceptedHandoffs: number
  maxSpecialistRetries: number
  maxHandoffSummaryBytes: number
}

export type CoordinationSessionRequest = {
  stateVersion: typeof COORDINATION_CONTRACT_VERSION
  id: string
  scope: CoordinationScope
  authority: CoordinationAuthority
  contextDigest: string
  capabilitySetDigest: string
  bounds: CoordinationBounds
  requestedAt: string
  deadline: string
}

export type AgentTaskResourceRequirement = {
  resourceId: string
  resourceDigest: string
  mode: 'read' | 'write'
}

export type AgentTaskNode = {
  id: string
  roleId: string
  contextDigest: string
  capabilityIds: string[]
  resourceRequirements: AgentTaskResourceRequirement[]
}

export type AgentTaskEdge = {
  id: string
  sourceTaskId: string
  targetTaskId: string
}

export type AgentTaskGraph = {
  stateVersion: typeof COORDINATION_CONTRACT_VERSION
  id: string
  coordinationId: string
  version: number
  entryTaskIds: string[]
  nodes: AgentTaskNode[]
  edges: AgentTaskEdge[]
}

export type AgentTaskGraphParseOptions = {
  coordinationId: string
  acceptedRoleIds: readonly string[]
  maxTaskNodes: number
  maxDependencyEdges: number
}

export type ParsedAgentTaskGraph = {
  graph: AgentTaskGraph
  readyTaskIds: string[]
}

export type SpecialistBudget = CoordinationParentBounds

export type SpecialistAllocationRequest = {
  stateVersion: typeof COORDINATION_CONTRACT_VERSION
  id: string
  coordinationId: string
  taskGraphId: string
  taskGraphVersion: number
  taskId: string
  roleId: string
  agentId: string
  delegationDepth: number
  scope: CoordinationScope
  authority: CoordinationAuthority
  contextDigest: string
  capabilityIds: string[]
  resourceRequirements: AgentTaskResourceRequirement[]
  budget: SpecialistBudget
  requestedAt: string
  deadline: string
}

export type SpecialistAllocationParseOptions = {
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  readyTaskIds: readonly string[]
  supervisorCapabilityIds: readonly string[]
  supervisorResourceRequirements: readonly AgentTaskResourceRequirement[]
  remainingBudget: SpecialistBudget
}

export type AgentHandoff = {
  stateVersion: typeof COORDINATION_CONTRACT_VERSION
  id: string
  coordinationId: string
  sequence: number
  scope: CoordinationScope
  sourceTaskId: string
  sourceTaskVersion: number
  sourceRuntimeId: string
  sourceRuntimeVersion: number
  targetTaskId: string
  targetTaskVersion: number
  resultDigest: string
  evidenceDigests: string[]
  contextDigest: string
  resourceLeaseOutcome: 'not_required' | 'released'
  summary: string
  createdAt: string
}

export type AcceptedSpecialistResult = {
  taskId: string
  taskVersion: number
  runtimeId: string
  runtimeVersion: number
  status: 'succeeded'
  resultDigest: string
  evidenceDigests: string[]
  contextDigest: string
  resourceLeaseOutcome: AgentHandoff['resourceLeaseOutcome']
}

export type AgentHandoffAcceptOptions = {
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  sourceResult: AcceptedSpecialistResult
  targetTaskVersion: number
  expectedSequence: number
  maxSummaryBytes: number
  existingHandoff: AgentHandoff | null
}

export type AcceptedAgentHandoff = {
  handoff: AgentHandoff
  replayed: boolean
}

export type CoordinationTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'

export type CoordinationFailureCategory =
  | 'timeout'
  | 'budget_exhausted'
  | 'policy_denied'
  | 'tool_error'
  | 'coding_executor_error'
  | 'invalid_result'
  | 'dependency_failed'

export type CoordinationTaskFailure = {
  category: CoordinationFailureCategory
  code: string
  sourceTaskId: string | null
}

export type CoordinationTaskState = {
  id: string
  version: number
  status: CoordinationTaskStatus
  agentId: string | null
  runtimeId: string | null
  runtimeVersion: number | null
  resultDigest: string | null
  failure: CoordinationTaskFailure | null
  attemptFailures: CoordinationTaskFailure[]
  acceptedDependencyHandoffIds: string[]
}

export type CoordinationCounters = {
  specialistStarts: number
  activeSpecialists: number
  acceptedHandoffs: number
  retries: number
  steps: number
  toolCalls: number
  tokens: number
  costUsd: number
}

export type CoordinationSessionStopReason =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timeout'
  | 'budget_exhausted'
  | 'policy_denied'
  | 'blocked_dependency'

export type CoordinationSessionState = {
  stateVersion: typeof COORDINATION_CONTRACT_VERSION
  id: string
  version: number
  graphId: string
  graphVersion: number
  scope: CoordinationScope
  authority: CoordinationAuthority
  contextDigest: string
  capabilitySetDigest: string
  bounds: CoordinationBounds
  status: 'running' | 'terminal'
  stopReason: CoordinationSessionStopReason | null
  tasks: CoordinationTaskState[]
  counters: CoordinationCounters
  acceptedHandoffIds: string[]
  requestedAt: string
  startedAt: string
  updatedAt: string
  deadline: string
}

export type CoordinationSessionStartInput = {
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  startedAt: string
}

export type CoordinationTaskStartInput = {
  state: CoordinationSessionState
  allocation: SpecialistAllocationRequest
  expectedSessionVersion: number
  expectedTaskVersion: number
  runtimeId: string
  runtimeVersion: number
  now: string
}

export type CoordinationTaskResult = {
  status: 'succeeded' | 'failed'
  resultDigest: string | null
  failure: CoordinationTaskFailure | null
}

export type CoordinationUsageDelta = {
  steps: number
  toolCalls: number
  tokens: number
  costUsd: number
}

export type CoordinationTaskResultInput = {
  state: CoordinationSessionState
  expectedSessionVersion: number
  taskId: string
  expectedTaskVersion: number
  runtimeId: string
  expectedRuntimeVersion: number
  runtimeVersion: number
  result: CoordinationTaskResult
  usage: CoordinationUsageDelta
  now: string
}

export type CoordinationSessionCancelInput = {
  state: CoordinationSessionState
  expectedSessionVersion: number
  now: string
}

export type CoordinationHandoffTransitionInput = {
  state: CoordinationSessionState
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  handoff: AgentHandoff
  sourceResult: AcceptedSpecialistResult
  expectedSessionVersion: number
  expectedTargetTaskVersion: number
  priorAcceptedHandoffs: AgentHandoff[]
}

export type CoordinationTaskRetryInput = {
  state: CoordinationSessionState
  expectedSessionVersion: number
  taskId: string
  expectedTaskVersion: number
  runtimeId: string
  expectedRuntimeVersion: number
  runtimeVersion: number
  failure: CoordinationTaskFailure
  replacementRuntimeId: string
  replacementRuntimeVersion: number
  usage: CoordinationUsageDelta
  now: string
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize)
    if (isPlainRecord(entry)) {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      )
    }
    return entry
  }
  return JSON.stringify(normalize(value))
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647
}

function isPositiveIntegerAtMost(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= maximum
}

function isNonNegativeIntegerAtMost(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isCanonicalDigestList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every(isDigest) &&
    new Set(value).size === value.length &&
    value.every((digest, index) => {
      const previous = value[index - 1]
      return previous === undefined || previous.localeCompare(digest) < 0
    })
}

function hasSameDigestList(value: unknown, expected: readonly string[]): value is string[] {
  return isCanonicalDigestList(value) &&
    value.length === expected.length &&
    value.every((digest, index) => digest === expected[index])
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isExactCoordinationScope(value: unknown): value is CoordinationScope {
  return isPlainRecord(value) &&
    hasExactKeys(value, [
      'organizationId',
      'projectId',
      'userId',
      'sessionId',
      'localProjectId',
    ]) &&
    isIdentifier(value.organizationId) &&
    isIdentifier(value.projectId) &&
    isIdentifier(value.userId) &&
    isIdentifier(value.sessionId) &&
    isIdentifier(value.localProjectId)
}

function hasSameCoordinationScope(left: CoordinationScope, right: CoordinationScope): boolean {
  return left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
}

function isExactCoordinationAuthority(value: unknown): value is CoordinationAuthority {
  return isPlainRecord(value) &&
    hasExactKeys(value, [
      'runId',
      'nodeId',
      'runVersion',
      'policyVersion',
      'supervisorRuntimeId',
      'supervisorRuntimeVersion',
    ]) &&
    isIdentifier(value.runId) &&
    isIdentifier(value.nodeId) &&
    isPositiveVersion(value.runVersion) &&
    isPositiveVersion(value.policyVersion) &&
    isIdentifier(value.supervisorRuntimeId) &&
    isPositiveVersion(value.supervisorRuntimeVersion)
}

function hasSameCoordinationAuthority(
  left: CoordinationAuthority,
  right: CoordinationAuthority,
): boolean {
  return left.runId === right.runId &&
    left.nodeId === right.nodeId &&
    left.runVersion === right.runVersion &&
    left.policyVersion === right.policyVersion &&
    left.supervisorRuntimeId === right.supervisorRuntimeId &&
    left.supervisorRuntimeVersion === right.supervisorRuntimeVersion
}

function isExactResourceRequirement(value: unknown): value is AgentTaskResourceRequirement {
  return isPlainRecord(value) &&
    hasExactKeys(value, ['resourceId', 'resourceDigest', 'mode']) &&
    isIdentifier(value.resourceId) &&
    isDigest(value.resourceDigest) &&
    (value.mode === 'read' || value.mode === 'write')
}

function hasSameResourceRequirement(
  left: AgentTaskResourceRequirement,
  right: AgentTaskResourceRequirement,
): boolean {
  return left.resourceId === right.resourceId &&
    left.resourceDigest === right.resourceDigest &&
    left.mode === right.mode
}

function coversResourceRequirement(
  parent: AgentTaskResourceRequirement,
  child: AgentTaskResourceRequirement,
): boolean {
  return parent.resourceId === child.resourceId &&
    parent.resourceDigest === child.resourceDigest &&
    (parent.mode === child.mode || (parent.mode === 'write' && child.mode === 'read'))
}

export function parseCoordinationSessionRequest(
  value: unknown,
  parentBounds: CoordinationParentBounds,
): CoordinationSessionRequest {
  if (!isPlainRecord(value) ||
    value.stateVersion !== COORDINATION_CONTRACT_VERSION ||
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
    !isIdentifier(value.id) ||
    !isExactCoordinationScope(value.scope) ||
    !isExactCoordinationAuthority(value.authority) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.deadline) ||
    !isPlainRecord(value.bounds) ||
    !hasExactKeys(value.bounds, [
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
    ]) ||
    !isPositiveIntegerAtMost(value.bounds.maxSpecialists, COORDINATION_MAX_SPECIALISTS) ||
    !isPositiveIntegerAtMost(value.bounds.maxTaskNodes, COORDINATION_MAX_TASK_NODES) ||
    !isPositiveIntegerAtMost(
      value.bounds.maxDependencyEdges,
      COORDINATION_MAX_DEPENDENCY_EDGES,
    ) ||
    !isPositiveIntegerAtMost(
      value.bounds.maxDelegationDepth,
      COORDINATION_MAX_DELEGATION_DEPTH,
    ) ||
    !isPositiveIntegerAtMost(
      value.bounds.maxParallelSpecialists,
      COORDINATION_MAX_PARALLEL_SPECIALISTS,
    ) ||
    Number(value.bounds.maxParallelSpecialists) > Number(value.bounds.maxSpecialists) ||
    !isPositiveIntegerAtMost(
      value.bounds.maxAcceptedHandoffs,
      COORDINATION_MAX_ACCEPTED_HANDOFFS,
    ) ||
    !isNonNegativeIntegerAtMost(
      value.bounds.maxSpecialistRetries,
      COORDINATION_MAX_SPECIALIST_RETRIES,
    ) ||
    !isPositiveIntegerAtMost(
      value.bounds.maxHandoffSummaryBytes,
      COORDINATION_MAX_HANDOFF_SUMMARY_BYTES,
    ) ||
    !Number.isInteger(value.bounds.maxSteps) ||
    Number(value.bounds.maxSteps) <= 0 ||
    Number(value.bounds.maxSteps) > Math.min(parentBounds.maxSteps, AGENT_RUNTIME_MAX_STEPS) ||
    !Number.isInteger(value.bounds.maxWallTimeMs) ||
    Number(value.bounds.maxWallTimeMs) <= 0 ||
    Number(value.bounds.maxWallTimeMs) > Math.min(
      parentBounds.maxWallTimeMs,
      AGENT_RUNTIME_MAX_WALL_TIME_MS,
    ) ||
    !Number.isInteger(value.bounds.maxToolCalls) ||
    Number(value.bounds.maxToolCalls) <= 0 ||
    Number(value.bounds.maxToolCalls) > Math.min(
      parentBounds.maxToolCalls,
      AGENT_RUNTIME_MAX_TOOL_CALLS,
    ) ||
    typeof value.bounds.maxCostUsd !== 'number' ||
    !Number.isFinite(value.bounds.maxCostUsd) ||
    value.bounds.maxCostUsd <= 0 ||
    value.bounds.maxCostUsd > Math.min(parentBounds.maxCostUsd, AGENT_RUNTIME_MAX_COST_USD) ||
    !Number.isInteger(value.bounds.maxTokens) ||
    Number(value.bounds.maxTokens) <= 0 ||
    Number(value.bounds.maxTokens) > Math.min(parentBounds.maxTokens, AGENT_RUNTIME_MAX_TOKENS) ||
    Date.parse(value.deadline) <= Date.parse(value.requestedAt) ||
    Date.parse(value.deadline) - Date.parse(value.requestedAt) > Number(value.bounds.maxWallTimeMs)
  ) {
    throw new Error('invalid_coordination_session_request')
  }

  return value as CoordinationSessionRequest
}

export function parseAgentTaskGraph(
  value: unknown,
  options: AgentTaskGraphParseOptions,
): ParsedAgentTaskGraph {
  if (
    !isPlainRecord(value) ||
    value.stateVersion !== COORDINATION_CONTRACT_VERSION ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'coordinationId',
      'version',
      'entryTaskIds',
      'nodes',
      'edges',
    ]) ||
    !isIdentifier(value.id) ||
    value.coordinationId !== options.coordinationId ||
    !isPositiveVersion(value.version) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > options.maxTaskNodes ||
    !value.nodes.every(isPlainRecord) ||
    !Array.isArray(value.edges) ||
    value.edges.length > options.maxDependencyEdges ||
    !value.edges.every(isPlainRecord) ||
    !Array.isArray(value.entryTaskIds)
  ) {
    throw new Error('invalid_agent_task_graph')
  }

  const graph = value as AgentTaskGraph
  const acceptedRoleIds = new Set(options.acceptedRoleIds)
  if (
    graph.nodes.some((node) =>
      !hasExactKeys(node as unknown as Record<string, unknown>, [
        'id',
        'roleId',
        'contextDigest',
        'capabilityIds',
        'resourceRequirements',
      ]) ||
      !isIdentifier(node.roleId) ||
      !acceptedRoleIds.has(node.roleId) ||
      !isDigest(node.contextDigest) ||
      !Array.isArray(node.capabilityIds) ||
      node.capabilityIds.length === 0 ||
      node.capabilityIds.some((capabilityId) => !isIdentifier(capabilityId)) ||
      new Set(node.capabilityIds).size !== node.capabilityIds.length ||
      node.capabilityIds.some((capabilityId, index) => {
        const previous = node.capabilityIds[index - 1]
        return previous !== undefined && previous.localeCompare(capabilityId) >= 0
      }) ||
      !Array.isArray(node.resourceRequirements) ||
      !node.resourceRequirements.every(isExactResourceRequirement) ||
      new Set(node.resourceRequirements.map((resource) => resource.resourceId)).size !==
        node.resourceRequirements.length
    )
  ) {
    throw new Error('invalid_agent_task_graph')
  }
  const taskIds = graph.nodes.map((node) => node.id)
  if (
    taskIds.some((taskId) => !isIdentifier(taskId)) ||
    new Set(taskIds).size !== taskIds.length
  ) {
    throw new Error('invalid_agent_task_graph')
  }

  const taskIdSet = new Set(taskIds)
  const edgeIds = graph.edges.map((edge) => edge.id)
  const edgeRelations = graph.edges.map((edge) =>
    `${edge.sourceTaskId}\u0000${edge.targetTaskId}`)
  if (
    graph.edges.some((edge) => !hasExactKeys(edge as unknown as Record<string, unknown>, [
      'id',
      'sourceTaskId',
      'targetTaskId',
    ])) ||
    edgeIds.some((edgeId) => !isIdentifier(edgeId)) ||
    new Set(edgeIds).size !== edgeIds.length ||
    new Set(edgeRelations).size !== edgeRelations.length ||
    graph.edges.some((edge) =>
      !taskIdSet.has(edge.sourceTaskId) ||
      !taskIdSet.has(edge.targetTaskId) ||
      edge.sourceTaskId === edge.targetTaskId
    )
  ) {
    throw new Error('invalid_agent_task_graph')
  }

  const inDegree = new Map(taskIds.map((taskId) => [taskId, 0]))
  const dependents = new Map(taskIds.map((taskId) => [taskId, [] as string[]]))
  for (const edge of graph.edges) {
    inDegree.set(edge.targetTaskId, (inDegree.get(edge.targetTaskId) ?? 0) + 1)
    dependents.get(edge.sourceTaskId)?.push(edge.targetTaskId)
  }
  const roots = taskIds.filter((taskId) => inDegree.get(taskId) === 0).sort()
  const entries = [...graph.entryTaskIds].sort()
  if (
    entries.length === 0 ||
    entries.some((taskId) => !isIdentifier(taskId) || !taskIdSet.has(taskId)) ||
    new Set(entries).size !== entries.length ||
    entries.length !== roots.length ||
    entries.some((taskId, index) => taskId !== roots[index])
  ) {
    throw new Error('invalid_agent_task_graph')
  }
  const queue = [...roots]
  let visited = 0
  while (queue.length > 0) {
    const taskId = queue.shift()
    if (taskId === undefined) break
    visited += 1
    for (const dependentId of dependents.get(taskId) ?? []) {
      const nextDegree = (inDegree.get(dependentId) ?? 0) - 1
      inDegree.set(dependentId, nextDegree)
      if (nextDegree === 0) queue.push(dependentId)
    }
  }
  if (visited !== taskIds.length) {
    throw new Error('invalid_agent_task_graph')
  }

  return {
    graph,
    readyTaskIds: [...graph.entryTaskIds].sort((left, right) => left.localeCompare(right)),
  }
}

export function parseSpecialistAllocationRequest(
  value: unknown,
  options: SpecialistAllocationParseOptions,
): SpecialistAllocationRequest {
  if (
    !isPlainRecord(value) ||
    value.stateVersion !== COORDINATION_CONTRACT_VERSION ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'coordinationId',
      'taskGraphId',
      'taskGraphVersion',
      'taskId',
      'roleId',
      'agentId',
      'delegationDepth',
      'scope',
      'authority',
      'contextDigest',
      'capabilityIds',
      'resourceRequirements',
      'budget',
      'requestedAt',
      'deadline',
    ]) ||
    !isIdentifier(value.id) ||
    value.coordinationId !== options.coordination.id ||
    value.taskGraphId !== options.graph.id ||
    value.taskGraphVersion !== options.graph.version ||
    !isIdentifier(value.agentId) ||
    !isIdentifier(value.taskId) ||
    !options.readyTaskIds.includes(value.taskId) ||
    !options.graph.nodes.some((node) => node.id === value.taskId)
  ) {
    throw new Error('invalid_specialist_allocation_request')
  }
  const task = options.graph.nodes.find((node) => node.id === value.taskId)
  const supervisorCapabilities = new Set(options.supervisorCapabilityIds)
  if (
    task === undefined ||
    value.roleId !== task.roleId ||
    value.contextDigest !== task.contextDigest ||
    value.delegationDepth !== COORDINATION_MAX_DELEGATION_DEPTH ||
    !isExactCoordinationScope(value.scope) ||
    !hasSameCoordinationScope(value.scope, options.coordination.scope) ||
    !isExactCoordinationAuthority(value.authority) ||
    !hasSameCoordinationAuthority(value.authority, options.coordination.authority) ||
    !isPlainRecord(value.budget) ||
    !hasExactKeys(value.budget, [
      'maxSteps',
      'maxWallTimeMs',
      'maxToolCalls',
      'maxTokens',
      'maxCostUsd',
    ]) ||
    !isPositiveIntegerAtMost(
      value.budget.maxSteps,
      Math.min(options.remainingBudget.maxSteps, options.coordination.bounds.maxSteps),
    ) ||
    !isPositiveIntegerAtMost(
      value.budget.maxWallTimeMs,
      Math.min(
        options.remainingBudget.maxWallTimeMs,
        options.coordination.bounds.maxWallTimeMs,
      ),
    ) ||
    !isPositiveIntegerAtMost(
      value.budget.maxToolCalls,
      Math.min(options.remainingBudget.maxToolCalls, options.coordination.bounds.maxToolCalls),
    ) ||
    !isPositiveIntegerAtMost(
      value.budget.maxTokens,
      Math.min(options.remainingBudget.maxTokens, options.coordination.bounds.maxTokens),
    ) ||
    typeof value.budget.maxCostUsd !== 'number' ||
    !Number.isFinite(value.budget.maxCostUsd) ||
    value.budget.maxCostUsd <= 0 ||
    value.budget.maxCostUsd > Math.min(
      options.remainingBudget.maxCostUsd,
      options.coordination.bounds.maxCostUsd,
    ) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.deadline) ||
    Date.parse(value.requestedAt) < Date.parse(options.coordination.requestedAt) ||
    Date.parse(value.deadline) <= Date.parse(value.requestedAt) ||
    Date.parse(value.deadline) > Date.parse(options.coordination.deadline) ||
    Date.parse(value.deadline) - Date.parse(value.requestedAt) >
      Number(value.budget.maxWallTimeMs) ||
    !Array.isArray(value.capabilityIds) ||
    value.capabilityIds.length !== task.capabilityIds.length ||
    value.capabilityIds.some((capabilityId, index) =>
      capabilityId !== task.capabilityIds[index] ||
      !supervisorCapabilities.has(capabilityId)
    ) ||
    !Array.isArray(value.resourceRequirements) ||
    !value.resourceRequirements.every(isExactResourceRequirement) ||
    value.resourceRequirements.length !== task.resourceRequirements.length ||
    value.resourceRequirements.some((resource, index) => {
      const taskResource = task.resourceRequirements[index]
      return taskResource === undefined ||
        !hasSameResourceRequirement(resource, taskResource) ||
        !options.supervisorResourceRequirements.some((supervisorResource) =>
          coversResourceRequirement(supervisorResource, resource)
        )
    })
  ) {
    throw new Error('invalid_specialist_allocation_request')
  }
  return value as SpecialistAllocationRequest
}

export function acceptAgentHandoff(
  value: unknown,
  options: AgentHandoffAcceptOptions,
): AcceptedAgentHandoff {
  const isNewHandoff = options.existingHandoff === null
  if (
    !isPlainRecord(value) ||
    value.stateVersion !== COORDINATION_CONTRACT_VERSION ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'coordinationId',
      'sequence',
      'scope',
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
      'summary',
      'createdAt',
    ]) ||
    !isIdentifier(value.id) ||
    value.coordinationId !== options.coordination.id ||
    options.graph.coordinationId !== options.coordination.id ||
    !isExactCoordinationScope(value.scope) ||
    !hasSameCoordinationScope(value.scope, options.coordination.scope) ||
    !isPositiveIntegerAtMost(
      value.sequence,
      Math.min(
        options.coordination.bounds.maxAcceptedHandoffs,
        COORDINATION_MAX_ACCEPTED_HANDOFFS,
      ),
    ) ||
    (isNewHandoff && value.sequence !== options.expectedSequence) ||
    !isPositiveIntegerAtMost(
      options.maxSummaryBytes,
      Math.min(
        options.coordination.bounds.maxHandoffSummaryBytes,
        COORDINATION_MAX_HANDOFF_SUMMARY_BYTES,
      ),
    ) ||
    typeof value.summary !== 'string' ||
    value.summary.length === 0 ||
    value.summary.trim() !== value.summary ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value.summary) ||
    new TextEncoder().encode(value.summary).byteLength > Math.min(
      options.maxSummaryBytes,
      options.coordination.bounds.maxHandoffSummaryBytes,
      COORDINATION_MAX_HANDOFF_SUMMARY_BYTES,
    ) ||
    redactSensitiveText(value.summary).value !== value.summary ||
    !isCanonicalIso(value.createdAt) ||
    Date.parse(value.createdAt) < Date.parse(options.coordination.requestedAt) ||
    Date.parse(value.createdAt) > Date.parse(options.coordination.deadline) ||
    !isIdentifier(value.sourceTaskId) ||
    !isIdentifier(value.targetTaskId) ||
    !isPositiveVersion(value.sourceTaskVersion) ||
    !isIdentifier(value.sourceRuntimeId) ||
    !isPositiveVersion(value.sourceRuntimeVersion) ||
    !isDigest(value.resultDigest) ||
    !isCanonicalDigestList(value.evidenceDigests) ||
    !isDigest(value.contextDigest) ||
    !options.graph.nodes.some((node) =>
      node.id === value.sourceTaskId && node.contextDigest === value.contextDigest
    ) ||
    (value.resourceLeaseOutcome !== 'not_required' &&
      value.resourceLeaseOutcome !== 'released') ||
    !isPositiveVersion(value.targetTaskVersion) ||
    !options.graph.nodes.some((node) => node.id === value.sourceTaskId) ||
    !options.graph.nodes.some((node) => node.id === value.targetTaskId) ||
    !options.graph.edges.some((edge) =>
      edge.sourceTaskId === value.sourceTaskId && edge.targetTaskId === value.targetTaskId
    ) ||
    (isNewHandoff && (
      value.sourceTaskId !== options.sourceResult.taskId ||
      value.sourceTaskVersion !== options.sourceResult.taskVersion ||
      value.sourceRuntimeId !== options.sourceResult.runtimeId ||
      value.sourceRuntimeVersion !== options.sourceResult.runtimeVersion ||
      options.sourceResult.status !== 'succeeded' ||
      value.resultDigest !== options.sourceResult.resultDigest ||
      !hasSameDigestList(value.evidenceDigests, options.sourceResult.evidenceDigests) ||
      value.contextDigest !== options.sourceResult.contextDigest ||
      value.resourceLeaseOutcome !== options.sourceResult.resourceLeaseOutcome ||
      value.targetTaskVersion !== options.targetTaskVersion
    ))
  ) {
    throw new Error('invalid_agent_handoff')
  }
  if (options.existingHandoff !== null) {
    if (canonicalJson(value) !== canonicalJson(options.existingHandoff)) {
      throw new Error('conflicting_agent_handoff_replay')
    }
    return { handoff: options.existingHandoff, replayed: true }
  }
  return { handoff: value as AgentHandoff, replayed: false }
}

function isCoordinationTaskFailure(
  value: unknown,
  taskId: string,
  allowDependency: boolean,
): value is CoordinationTaskFailure {
  return isPlainRecord(value) &&
    hasExactKeys(value, ['category', 'code', 'sourceTaskId']) &&
    (
      value.category === 'timeout' ||
      value.category === 'budget_exhausted' ||
      value.category === 'policy_denied' ||
      value.category === 'tool_error' ||
      value.category === 'coding_executor_error' ||
      value.category === 'invalid_result' ||
      (allowDependency && value.category === 'dependency_failed')
    ) &&
    isIdentifier(value.code) &&
    redactSensitiveText(value.code).value === value.code &&
    (value.sourceTaskId === taskId ||
      (allowDependency && isIdentifier(value.sourceTaskId)))
}

export function parseCoordinationSessionState(value: unknown): CoordinationSessionState {
  if (
    !isPlainRecord(value) ||
    value.stateVersion !== COORDINATION_CONTRACT_VERSION ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'graphId',
      'graphVersion',
      'scope',
      'authority',
      'contextDigest',
      'capabilitySetDigest',
      'bounds',
      'status',
      'stopReason',
      'tasks',
      'counters',
      'acceptedHandoffIds',
      'requestedAt',
      'startedAt',
      'updatedAt',
      'deadline',
    ]) ||
    !isIdentifier(value.id) ||
    !isPositiveVersion(value.version) ||
    !isIdentifier(value.graphId) ||
    !isPositiveVersion(value.graphVersion) ||
    !isExactCoordinationScope(value.scope) ||
    !isExactCoordinationAuthority(value.authority) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isPlainRecord(value.bounds) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    !isPlainRecord(value.counters) ||
    !Array.isArray(value.acceptedHandoffIds) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.startedAt) ||
    !isCanonicalIso(value.updatedAt) ||
    !isCanonicalIso(value.deadline)
  ) {
    throw new Error('invalid_coordination_session_state')
  }
  try {
    parseCoordinationSessionRequest({
      stateVersion: value.stateVersion,
      id: value.id,
      scope: value.scope,
      authority: value.authority,
      contextDigest: value.contextDigest,
      capabilitySetDigest: value.capabilitySetDigest,
      bounds: value.bounds,
      requestedAt: value.requestedAt,
      deadline: value.deadline,
    }, value.bounds as CoordinationParentBounds)
  } catch {
    throw new Error('invalid_coordination_session_state')
  }
  const state = value as CoordinationSessionState
  const stopReasons: CoordinationSessionStopReason[] = [
    'success',
    'failure',
    'cancelled',
    'timeout',
    'budget_exhausted',
    'policy_denied',
    'blocked_dependency',
  ]
  const counterKeys = [
    'specialistStarts',
    'activeSpecialists',
    'acceptedHandoffs',
    'retries',
    'steps',
    'toolCalls',
    'tokens',
    'costUsd',
  ] as const
  const taskIds = state.tasks.map((task) => isPlainRecord(task) ? task.id : null)
  const taskShapesValid = state.tasks.every((task) => {
    if (!isPlainRecord(task) || !hasExactKeys(task, [
      'id',
      'version',
      'status',
      'agentId',
      'runtimeId',
      'runtimeVersion',
      'resultDigest',
      'failure',
      'attemptFailures',
      'acceptedDependencyHandoffIds',
    ]) || !isIdentifier(task.id) || !isPositiveVersion(task.version) ||
      !Array.isArray(task.attemptFailures) ||
      !task.attemptFailures.every((failure) =>
        isCoordinationTaskFailure(failure, task.id, false)) ||
      !Array.isArray(task.acceptedDependencyHandoffIds) ||
      task.acceptedDependencyHandoffIds.some((id) => !isIdentifier(id)) ||
      new Set(task.acceptedDependencyHandoffIds).size !==
        task.acceptedDependencyHandoffIds.length) {
      return false
    }
    const hasRuntime = isIdentifier(task.agentId) &&
      isIdentifier(task.runtimeId) &&
      isPositiveVersion(task.runtimeVersion)
    const hasNoRuntime = task.agentId === null && task.runtimeId === null &&
      task.runtimeVersion === null
    if (task.status === 'pending' || task.status === 'ready') {
      return hasNoRuntime && task.resultDigest === null && task.failure === null
    }
    if (task.status === 'running') {
      return hasRuntime && task.resultDigest === null && task.failure === null
    }
    if (task.status === 'succeeded') {
      return hasRuntime && isDigest(task.resultDigest) && task.failure === null
    }
    if (task.status === 'failed') {
      return hasRuntime && task.resultDigest === null &&
        isCoordinationTaskFailure(task.failure, task.id, false)
    }
    if (task.status === 'cancelled') {
      return (hasRuntime || hasNoRuntime) && task.resultDigest === null && task.failure === null
    }
    if (task.status === 'blocked') {
      return (hasRuntime || hasNoRuntime) && task.resultDigest === null &&
        isCoordinationTaskFailure(task.failure, task.id, true) &&
        task.failure.category === 'dependency_failed'
    }
    return false
  })
  const runningTasks = state.tasks.filter((task) => task.status === 'running').length
  const counters = state.counters
  const hasFailedCategory = (category: CoordinationFailureCategory): boolean =>
    state.tasks.some((task) => task.failure?.category === category)
  const terminalReasonValid = state.status === 'running' ||
    (state.stopReason === 'success' &&
      state.tasks.every((task) => task.status === 'succeeded')) ||
    (state.stopReason === 'failure' && state.tasks.some((task) => task.status === 'failed')) ||
    (state.stopReason === 'cancelled' &&
      state.tasks.some((task) => task.status === 'cancelled') &&
      state.tasks.every((task) => task.status === 'succeeded' || task.status === 'cancelled')) ||
    (state.stopReason === 'timeout' &&
      (hasFailedCategory('timeout') || Date.parse(state.updatedAt) >= Date.parse(state.deadline))) ||
    (state.stopReason === 'budget_exhausted' &&
      (hasFailedCategory('budget_exhausted') ||
        counters.steps >= state.bounds.maxSteps ||
        counters.toolCalls >= state.bounds.maxToolCalls ||
        counters.tokens >= state.bounds.maxTokens ||
        counters.costUsd >= state.bounds.maxCostUsd)) ||
    (state.stopReason === 'policy_denied' && hasFailedCategory('policy_denied')) ||
    (state.stopReason === 'blocked_dependency' &&
      state.tasks.some((task) => task.status === 'blocked'))
  if (
    state.tasks.length > state.bounds.maxTaskNodes ||
    !taskShapesValid ||
    taskIds.some((id) => !isIdentifier(id)) ||
    new Set(taskIds).size !== taskIds.length ||
    taskIds.some((id, index) => index > 0 &&
      String(taskIds[index - 1]).localeCompare(String(id)) >= 0) ||
    !hasExactKeys(counters as unknown as Record<string, unknown>, counterKeys) ||
    !isNonNegativeIntegerAtMost(counters.specialistStarts, state.tasks.length + state.bounds.maxSpecialistRetries) ||
    !isNonNegativeIntegerAtMost(counters.activeSpecialists, state.bounds.maxParallelSpecialists) ||
    !isNonNegativeIntegerAtMost(counters.acceptedHandoffs, state.bounds.maxAcceptedHandoffs) ||
    !isNonNegativeIntegerAtMost(counters.retries, state.bounds.maxSpecialistRetries) ||
    !isNonNegativeIntegerAtMost(counters.steps, state.bounds.maxSteps) ||
    !isNonNegativeIntegerAtMost(counters.toolCalls, state.bounds.maxToolCalls) ||
    !isNonNegativeIntegerAtMost(counters.tokens, state.bounds.maxTokens) ||
    typeof counters.costUsd !== 'number' ||
    !Number.isFinite(counters.costUsd) ||
    counters.costUsd < 0 ||
    counters.costUsd > state.bounds.maxCostUsd ||
    counters.activeSpecialists !== runningTasks ||
    counters.specialistStarts < counters.activeSpecialists ||
    counters.acceptedHandoffs !== state.acceptedHandoffIds.length ||
    state.acceptedHandoffIds.some((id) => !isIdentifier(id)) ||
    new Set(state.acceptedHandoffIds).size !== state.acceptedHandoffIds.length ||
    state.tasks.some((task) => task.acceptedDependencyHandoffIds.some((id) =>
      !state.acceptedHandoffIds.includes(id))) ||
    Date.parse(state.startedAt) < Date.parse(state.requestedAt) ||
    Date.parse(state.startedAt) > Date.parse(state.deadline) ||
    Date.parse(state.updatedAt) < Date.parse(state.startedAt) ||
    (state.status !== 'running' && state.status !== 'terminal') ||
    (state.status === 'running' && state.stopReason !== null) ||
    (state.status === 'running' && Date.parse(state.updatedAt) >= Date.parse(state.deadline)) ||
    (state.status === 'terminal' && !stopReasons.includes(
      state.stopReason as CoordinationSessionStopReason,
    )) ||
    !terminalReasonValid ||
    (state.status === 'terminal' && state.tasks.some((task) =>
      task.status === 'pending' || task.status === 'ready' || task.status === 'running'))
  ) {
    throw new Error('invalid_coordination_session_state')
  }
  return state
}

export function createCoordinationSessionState(
  input: CoordinationSessionStartInput,
): CoordinationSessionState {
  if (
    input.graph.coordinationId !== input.coordination.id ||
    !isCanonicalIso(input.startedAt) ||
    Date.parse(input.startedAt) < Date.parse(input.coordination.requestedAt) ||
    Date.parse(input.startedAt) >= Date.parse(input.coordination.deadline)
  ) {
    throw new Error('invalid_coordination_session_state')
  }
  const dependentTaskIds = new Set(input.graph.edges.map((edge) => edge.targetTaskId))
  const tasks = input.graph.nodes
    .map<CoordinationTaskState>((node) => ({
      id: node.id,
      version: 1,
      status: dependentTaskIds.has(node.id) ? 'pending' : 'ready',
      agentId: null,
      runtimeId: null,
      runtimeVersion: null,
      resultDigest: null,
      failure: null,
      attemptFailures: [],
      acceptedDependencyHandoffIds: [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    stateVersion: COORDINATION_CONTRACT_VERSION,
    id: input.coordination.id,
    version: 1,
    graphId: input.graph.id,
    graphVersion: input.graph.version,
    scope: { ...input.coordination.scope },
    authority: { ...input.coordination.authority },
    contextDigest: input.coordination.contextDigest,
    capabilitySetDigest: input.coordination.capabilitySetDigest,
    bounds: { ...input.coordination.bounds },
    status: 'running',
    stopReason: null,
    tasks,
    counters: {
      specialistStarts: 0,
      activeSpecialists: 0,
      acceptedHandoffs: 0,
      retries: 0,
      steps: 0,
      toolCalls: 0,
      tokens: 0,
      costUsd: 0,
    },
    acceptedHandoffIds: [],
    requestedAt: input.coordination.requestedAt,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    deadline: input.coordination.deadline,
  }
}

export function startCoordinationTask(
  input: CoordinationTaskStartInput,
): CoordinationSessionState {
  const task = input.state.tasks.find((item) => item.id === input.allocation.taskId)
  const assignedAgentIds = new Set(
    input.state.tasks
      .map((item) => item.agentId)
      .filter((agentId): agentId is string => agentId !== null),
  )
  if (
    input.state.status !== 'running' ||
    input.state.stopReason !== null ||
    input.state.version !== input.expectedSessionVersion ||
    task === undefined ||
    task.version !== input.expectedTaskVersion ||
    task.status !== 'ready' ||
    input.allocation.coordinationId !== input.state.id ||
    input.allocation.taskGraphId !== input.state.graphId ||
    input.allocation.taskGraphVersion !== input.state.graphVersion ||
    input.allocation.taskId !== task.id ||
    !isIdentifier(input.allocation.id) ||
    !isIdentifier(input.allocation.agentId) ||
    !isExactCoordinationScope(input.allocation.scope) ||
    !hasSameCoordinationScope(input.allocation.scope, input.state.scope) ||
    !isExactCoordinationAuthority(input.allocation.authority) ||
    !hasSameCoordinationAuthority(input.allocation.authority, input.state.authority) ||
    !isPlainRecord(input.allocation.budget) ||
    !hasExactKeys(input.allocation.budget, [
      'maxSteps',
      'maxWallTimeMs',
      'maxToolCalls',
      'maxTokens',
      'maxCostUsd',
    ]) ||
    !isPositiveIntegerAtMost(
      input.allocation.budget.maxSteps,
      input.state.bounds.maxSteps - input.state.counters.steps,
    ) ||
    !isPositiveIntegerAtMost(
      input.allocation.budget.maxWallTimeMs,
      input.state.bounds.maxWallTimeMs,
    ) ||
    !isPositiveIntegerAtMost(
      input.allocation.budget.maxToolCalls,
      input.state.bounds.maxToolCalls - input.state.counters.toolCalls,
    ) ||
    !isPositiveIntegerAtMost(
      input.allocation.budget.maxTokens,
      input.state.bounds.maxTokens - input.state.counters.tokens,
    ) ||
    typeof input.allocation.budget.maxCostUsd !== 'number' ||
    !Number.isFinite(input.allocation.budget.maxCostUsd) ||
    input.allocation.budget.maxCostUsd <= 0 ||
    input.allocation.budget.maxCostUsd >
      input.state.bounds.maxCostUsd - input.state.counters.costUsd ||
    !isCanonicalIso(input.allocation.requestedAt) ||
    !isCanonicalIso(input.allocation.deadline) ||
    !isIdentifier(input.runtimeId) ||
    !isPositiveVersion(input.runtimeVersion) ||
    !isCanonicalIso(input.now) ||
    Date.parse(input.now) < Date.parse(input.state.updatedAt) ||
    Date.parse(input.now) < Date.parse(input.allocation.requestedAt) ||
    Date.parse(input.now) >= Date.parse(input.allocation.deadline) ||
    Date.parse(input.now) >= Date.parse(input.state.deadline) ||
    input.state.counters.activeSpecialists >= input.state.bounds.maxParallelSpecialists ||
    (!assignedAgentIds.has(input.allocation.agentId) &&
      assignedAgentIds.size >= input.state.bounds.maxSpecialists)
  ) {
    throw new Error('invalid_coordination_transition')
  }

  return {
    ...input.state,
    version: input.state.version + 1,
    tasks: input.state.tasks.map((item) => item.id === task.id
      ? {
          ...item,
          version: item.version + 1,
          status: 'running',
          agentId: input.allocation.agentId,
          runtimeId: input.runtimeId,
          runtimeVersion: input.runtimeVersion,
        }
      : item),
    counters: {
      ...input.state.counters,
      specialistStarts: input.state.counters.specialistStarts + 1,
      activeSpecialists: input.state.counters.activeSpecialists + 1,
    },
    updatedAt: input.now,
  }
}

export function recordCoordinationTaskResult(
  input: CoordinationTaskResultInput,
): CoordinationSessionState {
  const task = input.state.tasks.find((item) => item.id === input.taskId)
  const failure = input.result.failure
  const succeededResult = input.result.status === 'succeeded' &&
    isDigest(input.result.resultDigest) &&
    failure === null
  const failedResult = input.result.status === 'failed' &&
    input.result.resultDigest === null &&
    isPlainRecord(failure) &&
    hasExactKeys(failure, ['category', 'code', 'sourceTaskId']) &&
    (
      failure.category === 'timeout' ||
      failure.category === 'budget_exhausted' ||
      failure.category === 'policy_denied' ||
      failure.category === 'tool_error' ||
      failure.category === 'coding_executor_error' ||
      failure.category === 'invalid_result'
    ) &&
    isIdentifier(failure.code) &&
    redactSensitiveText(failure.code).value === failure.code &&
    failure.sourceTaskId === input.taskId
  const nextSteps = input.state.counters.steps + input.usage.steps
  const nextToolCalls = input.state.counters.toolCalls + input.usage.toolCalls
  const nextTokens = input.state.counters.tokens + input.usage.tokens
  const nextCostUsd = input.state.counters.costUsd + input.usage.costUsd
  if (
    input.state.status !== 'running' ||
    input.state.stopReason !== null ||
    input.state.version !== input.expectedSessionVersion ||
    task === undefined ||
    task.version !== input.expectedTaskVersion ||
    task.status !== 'running' ||
    task.runtimeId !== input.runtimeId ||
    task.runtimeVersion !== input.expectedRuntimeVersion ||
    !isPositiveVersion(input.runtimeVersion) ||
    input.runtimeVersion < input.expectedRuntimeVersion ||
    !isPlainRecord(input.result) ||
    !hasExactKeys(input.result, ['status', 'resultDigest', 'failure']) ||
    (!succeededResult && !failedResult) ||
    !isPlainRecord(input.usage) ||
    !hasExactKeys(input.usage, ['steps', 'toolCalls', 'tokens', 'costUsd']) ||
    !isNonNegativeIntegerAtMost(input.usage.steps, input.state.bounds.maxSteps) ||
    !isNonNegativeIntegerAtMost(input.usage.toolCalls, input.state.bounds.maxToolCalls) ||
    !isNonNegativeIntegerAtMost(input.usage.tokens, input.state.bounds.maxTokens) ||
    typeof input.usage.costUsd !== 'number' ||
    !Number.isFinite(input.usage.costUsd) ||
    input.usage.costUsd < 0 ||
    nextSteps > input.state.bounds.maxSteps ||
    nextToolCalls > input.state.bounds.maxToolCalls ||
    nextTokens > input.state.bounds.maxTokens ||
    nextCostUsd > input.state.bounds.maxCostUsd ||
    input.state.counters.activeSpecialists <= 0 ||
    !isCanonicalIso(input.now) ||
    Date.parse(input.now) < Date.parse(input.state.updatedAt) ||
    Date.parse(input.now) > Date.parse(input.state.deadline)
  ) {
    throw new Error('invalid_coordination_transition')
  }

  const resultTasks = input.state.tasks.map((item): CoordinationTaskState => {
    if (item.id === task.id) {
      return {
        ...item,
        version: item.version + 1,
        status: succeededResult ? 'succeeded' : 'failed',
        runtimeVersion: input.runtimeVersion,
        resultDigest: succeededResult ? input.result.resultDigest : null,
        failure: failedResult ? failure : null,
      }
    }
    if (!failedResult || item.status === 'succeeded' || item.status === 'failed' ||
      item.status === 'cancelled' || item.status === 'blocked') {
      return item
    }
    if (item.status === 'pending') {
      return {
        ...item,
        version: item.version + 1,
        status: 'blocked',
        failure: {
          category: 'dependency_failed',
          code: 'dependency_task_failed',
          sourceTaskId: task.id,
        },
      }
    }
    return {
      ...item,
      version: item.version + 1,
      status: 'cancelled',
    }
  })
  const completed = resultTasks.every((item) => item.status === 'succeeded')
  const deadlineReached = Date.parse(input.now) >= Date.parse(input.state.deadline)
  const budgetExhausted = nextSteps >= input.state.bounds.maxSteps ||
    nextToolCalls >= input.state.bounds.maxToolCalls ||
    nextTokens >= input.state.bounds.maxTokens ||
    nextCostUsd >= input.state.bounds.maxCostUsd
  const stopReason: CoordinationSessionStopReason | null = failedResult
    ? failure?.category === 'timeout'
      ? 'timeout'
      : failure?.category === 'budget_exhausted'
        ? 'budget_exhausted'
        : failure?.category === 'policy_denied'
          ? 'policy_denied'
          : 'failure'
    : completed
      ? 'success'
      : budgetExhausted
        ? 'budget_exhausted'
        : deadlineReached ? 'timeout' : null
  const tasks = stopReason === 'budget_exhausted' || stopReason === 'timeout'
    ? resultTasks.map((item): CoordinationTaskState =>
        item.status === 'pending' || item.status === 'ready' || item.status === 'running'
          ? { ...item, version: item.version + 1, status: 'cancelled' }
          : item)
    : resultTasks
  return {
    ...input.state,
    version: input.state.version + 1,
    status: stopReason === null ? 'running' : 'terminal',
    stopReason,
    tasks,
    counters: {
      ...input.state.counters,
      activeSpecialists: stopReason === null
        ? input.state.counters.activeSpecialists - 1
        : 0,
      steps: nextSteps,
      toolCalls: nextToolCalls,
      tokens: nextTokens,
      costUsd: nextCostUsd,
    },
    updatedAt: input.now,
  }
}

export function cancelCoordinationSession(
  input: CoordinationSessionCancelInput,
): CoordinationSessionState {
  if (
    input.state.status !== 'running' ||
    input.state.stopReason !== null ||
    input.state.version !== input.expectedSessionVersion ||
    !isCanonicalIso(input.now) ||
    Date.parse(input.now) < Date.parse(input.state.updatedAt)
  ) {
    throw new Error('invalid_coordination_transition')
  }
  return {
    ...input.state,
    version: input.state.version + 1,
    status: 'terminal',
    stopReason: 'cancelled',
    tasks: input.state.tasks.map((task): CoordinationTaskState =>
      task.status === 'succeeded' || task.status === 'failed' ||
      task.status === 'cancelled' || task.status === 'blocked'
        ? task
        : {
            ...task,
            version: task.version + 1,
            status: 'cancelled',
          }),
    counters: {
      ...input.state.counters,
      activeSpecialists: 0,
    },
    updatedAt: input.now,
  }
}

export function retryCoordinationTask(
  input: CoordinationTaskRetryInput,
): CoordinationSessionState {
  const task = input.state.tasks.find((item) => item.id === input.taskId)
  const nextSteps = input.state.counters.steps + input.usage.steps
  const nextToolCalls = input.state.counters.toolCalls + input.usage.toolCalls
  const nextTokens = input.state.counters.tokens + input.usage.tokens
  const nextCostUsd = input.state.counters.costUsd + input.usage.costUsd
  const directFailure = isPlainRecord(input.failure) &&
    hasExactKeys(input.failure, ['category', 'code', 'sourceTaskId']) &&
    (
      input.failure.category === 'timeout' ||
      input.failure.category === 'tool_error' ||
      input.failure.category === 'coding_executor_error' ||
      input.failure.category === 'invalid_result'
    ) &&
    isIdentifier(input.failure.code) &&
    redactSensitiveText(input.failure.code).value === input.failure.code &&
    input.failure.sourceTaskId === input.taskId
  if (
    input.state.status !== 'running' ||
    input.state.stopReason !== null ||
    input.state.version !== input.expectedSessionVersion ||
    task === undefined ||
    task.version !== input.expectedTaskVersion ||
    task.status !== 'running' ||
    task.runtimeId !== input.runtimeId ||
    task.runtimeVersion !== input.expectedRuntimeVersion ||
    !isPositiveVersion(input.runtimeVersion) ||
    input.runtimeVersion < input.expectedRuntimeVersion ||
    !directFailure ||
    input.state.counters.retries >= input.state.bounds.maxSpecialistRetries ||
    !isPlainRecord(input.usage) ||
    !hasExactKeys(input.usage, ['steps', 'toolCalls', 'tokens', 'costUsd']) ||
    !isNonNegativeIntegerAtMost(input.usage.steps, input.state.bounds.maxSteps) ||
    !isNonNegativeIntegerAtMost(input.usage.toolCalls, input.state.bounds.maxToolCalls) ||
    !isNonNegativeIntegerAtMost(input.usage.tokens, input.state.bounds.maxTokens) ||
    typeof input.usage.costUsd !== 'number' ||
    !Number.isFinite(input.usage.costUsd) ||
    input.usage.costUsd < 0 ||
    nextSteps >= input.state.bounds.maxSteps ||
    nextToolCalls >= input.state.bounds.maxToolCalls ||
    nextTokens >= input.state.bounds.maxTokens ||
    nextCostUsd >= input.state.bounds.maxCostUsd ||
    !isIdentifier(input.replacementRuntimeId) ||
    input.replacementRuntimeId === input.runtimeId ||
    !isPositiveVersion(input.replacementRuntimeVersion) ||
    !isCanonicalIso(input.now) ||
    Date.parse(input.now) < Date.parse(input.state.updatedAt) ||
    Date.parse(input.now) >= Date.parse(input.state.deadline)
  ) {
    throw new Error('invalid_coordination_transition')
  }
  return {
    ...input.state,
    version: input.state.version + 1,
    tasks: input.state.tasks.map((item): CoordinationTaskState => item.id === task.id
      ? {
          ...item,
          version: item.version + 1,
          runtimeId: input.replacementRuntimeId,
          runtimeVersion: input.replacementRuntimeVersion,
          resultDigest: null,
          failure: null,
          attemptFailures: [...item.attemptFailures, input.failure],
        }
      : item),
    counters: {
      ...input.state.counters,
      specialistStarts: input.state.counters.specialistStarts + 1,
      retries: input.state.counters.retries + 1,
      steps: nextSteps,
      toolCalls: nextToolCalls,
      tokens: nextTokens,
      costUsd: nextCostUsd,
    },
    updatedAt: input.now,
  }
}

export function applyCoordinationHandoff(
  input: CoordinationHandoffTransitionInput,
): CoordinationSessionState {
  const sourceTask = input.state.tasks.find((task) => task.id === input.handoff.sourceTaskId)
  const targetTask = input.state.tasks.find((task) => task.id === input.handoff.targetTaskId)
  const existingHandoff = input.priorAcceptedHandoffs.find(
    (handoff) => handoff.id === input.handoff.id,
  ) ?? null
  const priorIds = input.priorAcceptedHandoffs.map((handoff) => handoff.id)
  const incomingSourceIds = input.graph.edges
    .filter((edge) => edge.targetTaskId === input.handoff.targetTaskId)
    .map((edge) => edge.sourceTaskId)
  const previouslyAcceptedSources = new Set(
    input.priorAcceptedHandoffs
      .filter((handoff) => handoff.targetTaskId === input.handoff.targetTaskId)
      .map((handoff) => handoff.sourceTaskId),
  )
  if (
    input.state.status !== 'running' ||
    input.state.stopReason !== null ||
    input.state.version !== input.expectedSessionVersion ||
    input.coordination.id !== input.state.id ||
    input.graph.id !== input.state.graphId ||
    input.graph.version !== input.state.graphVersion ||
    input.graph.coordinationId !== input.state.id ||
    !hasSameCoordinationScope(input.coordination.scope, input.state.scope) ||
    !hasSameCoordinationAuthority(input.coordination.authority, input.state.authority) ||
    input.coordination.contextDigest !== input.state.contextDigest ||
    input.coordination.capabilitySetDigest !== input.state.capabilitySetDigest ||
    canonicalJson(input.coordination.bounds) !== canonicalJson(input.state.bounds) ||
    input.coordination.requestedAt !== input.state.requestedAt ||
    input.coordination.deadline !== input.state.deadline ||
    priorIds.length !== input.state.acceptedHandoffIds.length ||
    new Set(priorIds).size !== priorIds.length ||
    priorIds.some((id, index) => id !== input.state.acceptedHandoffIds[index]) ||
    sourceTask === undefined ||
    sourceTask.status !== 'succeeded' ||
    sourceTask.version !== input.sourceResult.taskVersion ||
    sourceTask.runtimeId !== input.sourceResult.runtimeId ||
    sourceTask.runtimeVersion !== input.sourceResult.runtimeVersion ||
    sourceTask.resultDigest !== input.sourceResult.resultDigest ||
    input.sourceResult.taskId !== sourceTask.id ||
    targetTask === undefined ||
    (existingHandoff === null &&
      Date.parse(input.handoff.createdAt) < Date.parse(input.state.updatedAt)) ||
    (existingHandoff === null &&
      Date.parse(input.handoff.createdAt) >= Date.parse(input.state.deadline))
  ) {
    throw new Error('invalid_coordination_transition')
  }

  acceptAgentHandoff(input.handoff, {
    coordination: input.coordination,
    graph: input.graph,
    sourceResult: input.sourceResult,
    targetTaskVersion: input.expectedTargetTaskVersion,
    expectedSequence: input.state.counters.acceptedHandoffs + 1,
    maxSummaryBytes: input.state.bounds.maxHandoffSummaryBytes,
    existingHandoff,
  })

  if (existingHandoff !== null) return input.state
  if (
    targetTask.status !== 'pending' ||
    targetTask.version !== input.expectedTargetTaskVersion ||
    input.state.counters.acceptedHandoffs >= input.state.bounds.maxAcceptedHandoffs ||
    previouslyAcceptedSources.has(input.handoff.sourceTaskId)
  ) {
    throw new Error('invalid_coordination_transition')
  }

  previouslyAcceptedSources.add(input.handoff.sourceTaskId)
  const targetReady = incomingSourceIds.length > 0 &&
    incomingSourceIds.every((sourceTaskId) => previouslyAcceptedSources.has(sourceTaskId))
  return {
    ...input.state,
    version: input.state.version + 1,
    tasks: input.state.tasks.map((task): CoordinationTaskState => task.id === targetTask.id
      ? {
          ...task,
          version: task.version + 1,
          status: targetReady ? 'ready' : 'pending',
          acceptedDependencyHandoffIds: [
            ...task.acceptedDependencyHandoffIds,
            input.handoff.id,
          ],
        }
      : task),
    counters: {
      ...input.state.counters,
      acceptedHandoffs: input.state.counters.acceptedHandoffs + 1,
    },
    acceptedHandoffIds: [...input.state.acceptedHandoffIds, input.handoff.id],
    updatedAt: input.handoff.createdAt,
  }
}
