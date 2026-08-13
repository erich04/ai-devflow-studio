import {
  AGENT_RUNTIME_CONTRACT_VERSION,
  parseAgentRuntimeEvent,
  parseAgentRuntimeState,
  type AgentRuntimeBounds,
  type AgentRuntimeCounters,
  type AgentRuntimeEvent,
  type AgentRuntimeEventType,
  type AgentRuntimeState,
  type AgentRuntimeStatus,
  type AgentRuntimeStopReason,
} from './agent-runtime'
import { redactSensitiveText } from './redaction'

export const AGENT_RUNTIME_RENDERER_PROJECTION_VERSION = 1 as const

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const maxVersion = 2_147_483_647

export type AgentRuntimeRendererAction = {
  id: string
  kind: 'tool' | 'coding_executor'
  capabilityId: string
  capabilityVersion: number
  requestDigest: string
  requiresPermission: boolean
}

export type AgentRuntimeRendererSummary = {
  projectionVersion: typeof AGENT_RUNTIME_RENDERER_PROJECTION_VERSION
  runtimeId: string
  runId: string
  nodeId: string
  localProjectId: string
  runVersion: number
  policyVersion: number
  contextDigest: string
  capabilitySetDigest: string
  bounds: AgentRuntimeBounds
  status: AgentRuntimeStatus
  stopReason: AgentRuntimeStopReason | null
  version: number
  checkpointVersion: number
  nextSequence: number
  counters: AgentRuntimeCounters
  acceptedActionCount: number
  lastObservationDigest: string
  lastResultDigest: string | null
  activeAction: AgentRuntimeRendererAction | null
  requestedAt: string
  startedAt: string
  updatedAt: string
  deadline: string
  redacted: true
}

export type AgentRuntimeRendererEvent = {
  projectionVersion: typeof AGENT_RUNTIME_RENDERER_PROJECTION_VERSION
  runtimeId: string
  sequence: number
  checkpointVersion: number
  type: AgentRuntimeEventType
  createdAt: string
  redacted: true
}

export type AgentRuntimeRendererTerminalSummary = {
  stateVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION
  runtimeId: string
  checkpointVersion: number
  stopReason: AgentRuntimeStopReason
  counters: AgentRuntimeCounters
  acceptedActionCount: number
  lastObservationDigest: string
  lastResultDigest: string | null
  completedAt: string
  redacted: true
}

export type AgentRuntimeRendererEvaluation = {
  sequence: number
  checkpointVersion: number
  evaluation: 'continue' | 'success' | 'failure'
  summary: string
  createdAt: string
  redacted: true
}

export type AgentRuntimeRendererSnapshot = {
  projectionVersion: typeof AGENT_RUNTIME_RENDERER_PROJECTION_VERSION
  runtime: AgentRuntimeRendererSummary
  events: AgentRuntimeRendererEvent[]
  latestEvaluation: AgentRuntimeRendererEvaluation | null
  terminalSummary: AgentRuntimeRendererTerminalSummary | null
  redacted: true
}

export type AgentRuntimeRendererListItem = {
  projectionVersion: typeof AGENT_RUNTIME_RENDERER_PROJECTION_VERSION
  runtime: AgentRuntimeRendererSummary
  terminalSummary: AgentRuntimeRendererTerminalSummary | null
  redacted: true
}

export type AgentRuntimeTerminalSummarySource = AgentRuntimeRendererTerminalSummary

function fail(): never {
  throw new Error('invalid_agent_runtime_renderer_snapshot')
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
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
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
    value.costUsd < 0
  ) fail()
  return {
    steps: value.steps,
    toolCalls: value.toolCalls,
    tokens: value.tokens,
    costUsd: value.costUsd,
  }
}

function parseBounds(value: unknown): AgentRuntimeBounds {
  const keys = [
    'maxSteps',
    'maxWallTimeMs',
    'maxToolCalls',
    'maxToolResultBytes',
    'maxTrajectoryMetadataBytes',
    'maxCheckpointBytes',
    'maxTokens',
    'maxCostUsd',
  ] as const
  if (!isRecord(value) || !hasExactKeys(value, keys)) fail()
  for (const key of keys.slice(0, -1)) {
    if (!isCount(value[key]) || Number(value[key]) === 0) fail()
  }
  if (
    typeof value.maxCostUsd !== 'number' ||
    !Number.isFinite(value.maxCostUsd) ||
    value.maxCostUsd <= 0
  ) fail()
  return {
    maxSteps: Number(value.maxSteps),
    maxWallTimeMs: Number(value.maxWallTimeMs),
    maxToolCalls: Number(value.maxToolCalls),
    maxToolResultBytes: Number(value.maxToolResultBytes),
    maxTrajectoryMetadataBytes: Number(value.maxTrajectoryMetadataBytes),
    maxCheckpointBytes: Number(value.maxCheckpointBytes),
    maxTokens: Number(value.maxTokens),
    maxCostUsd: value.maxCostUsd,
  }
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

function parseAction(value: unknown): AgentRuntimeRendererAction {
  if (
    !isRecord(value) ||
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
    !isVersion(value.capabilityVersion) ||
    !isDigest(value.requestDigest) ||
    typeof value.requiresPermission !== 'boolean'
  ) fail()
  return {
    id: value.id,
    kind: value.kind,
    capabilityId: value.capabilityId,
    capabilityVersion: value.capabilityVersion,
    requestDigest: value.requestDigest,
    requiresPermission: value.requiresPermission,
  }
}

function parseRendererSummary(value: unknown): AgentRuntimeRendererSummary {
  const keys = [
    'projectionVersion',
    'runtimeId',
    'runId',
    'nodeId',
    'localProjectId',
    'runVersion',
    'policyVersion',
    'contextDigest',
    'capabilitySetDigest',
    'bounds',
    'status',
    'stopReason',
    'version',
    'checkpointVersion',
    'nextSequence',
    'counters',
    'acceptedActionCount',
    'lastObservationDigest',
    'lastResultDigest',
    'activeAction',
    'requestedAt',
    'startedAt',
    'updatedAt',
    'deadline',
    'redacted',
  ] as const
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.projectionVersion !== AGENT_RUNTIME_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isIdentifier(value.localProjectId) ||
    !isVersion(value.runVersion) ||
    !isVersion(value.policyVersion) ||
    !isDigest(value.contextDigest) ||
    !isDigest(value.capabilitySetDigest) ||
    !isVersion(value.version) ||
    !isVersion(value.checkpointVersion) ||
    value.version !== value.checkpointVersion ||
    !isVersion(value.nextSequence) ||
    !isCount(value.acceptedActionCount) ||
    !isDigest(value.lastObservationDigest) ||
    (value.lastResultDigest !== null && !isDigest(value.lastResultDigest)) ||
    !isCanonicalIso(value.requestedAt) ||
    !isCanonicalIso(value.startedAt) ||
    !isCanonicalIso(value.updatedAt) ||
    !isCanonicalIso(value.deadline) ||
    value.redacted !== true
  ) fail()
  const status = parseStatus(value.status)
  const stopReason = value.stopReason === null ? null : parseStopReason(value.stopReason)
  if ((status === 'terminal') !== (stopReason !== null)) fail()
  const bounds = parseBounds(value.bounds)
  const counters = parseCounters(value.counters)
  if (
    counters.steps > bounds.maxSteps ||
    counters.toolCalls > bounds.maxToolCalls ||
    counters.tokens > bounds.maxTokens ||
    counters.costUsd > bounds.maxCostUsd ||
    Number(value.acceptedActionCount) > counters.steps
  ) fail()
  return {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtimeId: value.runtimeId,
    runId: value.runId,
    nodeId: value.nodeId,
    localProjectId: value.localProjectId,
    runVersion: value.runVersion,
    policyVersion: value.policyVersion,
    contextDigest: value.contextDigest,
    capabilitySetDigest: value.capabilitySetDigest,
    bounds,
    status,
    stopReason,
    version: value.version,
    checkpointVersion: value.checkpointVersion,
    nextSequence: value.nextSequence,
    counters,
    acceptedActionCount: value.acceptedActionCount,
    lastObservationDigest: value.lastObservationDigest,
    lastResultDigest: value.lastResultDigest,
    activeAction: value.activeAction === null ? null : parseAction(value.activeAction),
    requestedAt: value.requestedAt,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    deadline: value.deadline,
    redacted: true,
  }
}

function parseRendererEvent(value: unknown): AgentRuntimeRendererEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'projectionVersion',
      'runtimeId',
      'sequence',
      'checkpointVersion',
      'type',
      'createdAt',
      'redacted',
    ]) ||
    value.projectionVersion !== AGENT_RUNTIME_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isVersion(value.sequence) ||
    !isVersion(value.checkpointVersion) ||
    !isCanonicalIso(value.createdAt) ||
    value.redacted !== true
  ) fail()
  const parsed = parseAgentRuntimeEvent({
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    runtimeId: value.runtimeId,
    sequence: value.sequence,
    checkpointVersion: value.checkpointVersion,
    type: value.type,
    createdAt: value.createdAt,
    metadata: rendererEventMetadata(value.type),
  })
  return {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtimeId: parsed.runtimeId,
    sequence: parsed.sequence,
    checkpointVersion: parsed.checkpointVersion,
    type: parsed.type,
    createdAt: parsed.createdAt,
    redacted: true,
  }
}

function rendererEventMetadata(type: unknown): AgentRuntimeEvent['metadata'] {
  const digest = '0'.repeat(64)
  switch (type) {
    case 'runtime_started': return { contractVersion: 1 }
    case 'context_attached': return { contextDigest: digest, capabilitySetDigest: digest }
    case 'runtime_resumed': return { fromCheckpointVersion: 1 }
    case 'decision_recorded': return { actionId: 'redacted-action', requestDigest: digest }
    case 'action_requested': return {
      actionId: 'redacted-action',
      actionKind: 'tool',
      capabilityId: 'redacted.capability',
      capabilityVersion: 1,
      requestDigest: digest,
      requiresPermission: false,
    }
    case 'permission_decided': return {
      actionId: 'redacted-action',
      requestDigest: digest,
      decision: 'denied',
    }
    case 'action_result': return {
      actionId: 'redacted-action',
      requestDigest: digest,
      outcome: 'failure',
      resultDigest: digest,
      resultBytes: 0,
      tokens: 0,
      costUsd: 0,
    }
    case 'observation_recorded': return { actionId: 'redacted-action', resultDigest: digest }
    case 'evaluation_recorded': return { evaluation: 'failure', summary: 'redacted' }
    case 'checkpointed': return { checkpointVersion: 1 }
    case 'runtime_stopped': return { stopReason: 'failure' }
    default: fail()
  }
}

function parseTerminalSummary(value: unknown): AgentRuntimeRendererTerminalSummary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'runtimeId',
      'checkpointVersion',
      'stopReason',
      'counters',
      'acceptedActionCount',
      'lastObservationDigest',
      'lastResultDigest',
      'completedAt',
      'redacted',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTRACT_VERSION ||
    !isIdentifier(value.runtimeId) ||
    !isVersion(value.checkpointVersion) ||
    !isCount(value.acceptedActionCount) ||
    !isDigest(value.lastObservationDigest) ||
    (value.lastResultDigest !== null && !isDigest(value.lastResultDigest)) ||
    !isCanonicalIso(value.completedAt) ||
    value.redacted !== true
  ) fail()
  return {
    stateVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    runtimeId: value.runtimeId,
    checkpointVersion: value.checkpointVersion,
    stopReason: parseStopReason(value.stopReason),
    counters: parseCounters(value.counters),
    acceptedActionCount: value.acceptedActionCount,
    lastObservationDigest: value.lastObservationDigest,
    lastResultDigest: value.lastResultDigest,
    completedAt: value.completedAt,
    redacted: true,
  }
}

function parseRendererEvaluation(value: unknown): AgentRuntimeRendererEvaluation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'sequence',
      'checkpointVersion',
      'evaluation',
      'summary',
      'createdAt',
      'redacted',
    ]) ||
    !isVersion(value.sequence) ||
    !isVersion(value.checkpointVersion) ||
    (value.evaluation !== 'continue' &&
      value.evaluation !== 'success' &&
      value.evaluation !== 'failure') ||
    typeof value.summary !== 'string' ||
    value.summary.length === 0 ||
    value.summary.length > 2_000 ||
    redactSensitiveText(value.summary).value !== value.summary ||
    !isCanonicalIso(value.createdAt) ||
    value.redacted !== true
  ) fail()
  return {
    sequence: value.sequence,
    checkpointVersion: value.checkpointVersion,
    evaluation: value.evaluation,
    summary: value.summary,
    createdAt: value.createdAt,
    redacted: true,
  }
}

function projectRuntime(runtime: AgentRuntimeState): AgentRuntimeRendererSummary {
  return {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtimeId: runtime.id,
    runId: runtime.authority.runId,
    nodeId: runtime.authority.nodeId,
    localProjectId: runtime.scope.localProjectId,
    runVersion: runtime.authority.runVersion,
    policyVersion: runtime.authority.policyVersion,
    contextDigest: runtime.contextDigest,
    capabilitySetDigest: runtime.capabilitySetDigest,
    bounds: { ...runtime.bounds },
    status: runtime.status,
    stopReason: runtime.stopReason,
    version: runtime.version,
    checkpointVersion: runtime.checkpointVersion,
    nextSequence: runtime.nextSequence,
    counters: { ...runtime.counters },
    acceptedActionCount: runtime.acceptedActionIds.length,
    lastObservationDigest: runtime.lastObservationDigest,
    lastResultDigest: runtime.lastResultDigest,
    activeAction: runtime.activeAction ? { ...runtime.activeAction } : null,
    requestedAt: runtime.requestedAt,
    startedAt: runtime.startedAt,
    updatedAt: runtime.updatedAt,
    deadline: runtime.deadline,
    redacted: true,
  }
}

export function createAgentRuntimeRendererSnapshot(value: {
  runtime: unknown
  events: unknown[]
  terminalSummary: unknown | null
}): AgentRuntimeRendererSnapshot {
  const runtime = parseAgentRuntimeState(value.runtime)
  const events = value.events.map(parseAgentRuntimeEvent)
  const latestEvaluationEvent = events
    .filter((event) => event.type === 'evaluation_recorded')
    .at(-1)
  const snapshot = {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtime: projectRuntime(runtime),
    events: events.map((event) => ({
      projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
      runtimeId: event.runtimeId,
      sequence: event.sequence,
      checkpointVersion: event.checkpointVersion,
      type: event.type,
      createdAt: event.createdAt,
      redacted: true as const,
    })),
    latestEvaluation: latestEvaluationEvent
      ? {
          sequence: latestEvaluationEvent.sequence,
          checkpointVersion: latestEvaluationEvent.checkpointVersion,
          evaluation: latestEvaluationEvent.metadata.evaluation as 'continue' | 'success' | 'failure',
          summary: String(latestEvaluationEvent.metadata.summary),
          createdAt: latestEvaluationEvent.createdAt,
          redacted: true as const,
        }
      : null,
    terminalSummary: value.terminalSummary === null
      ? null
      : parseTerminalSummary(value.terminalSummary),
    redacted: true as const,
  }
  return parseAgentRuntimeRendererSnapshot(snapshot)
}

export function createAgentRuntimeRendererListItem(value: {
  runtime: unknown
  terminalSummary: unknown | null
}): AgentRuntimeRendererListItem {
  const runtime = parseAgentRuntimeState(value.runtime)
  const listItem = {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtime: projectRuntime(runtime),
    terminalSummary: value.terminalSummary === null
      ? null
      : parseTerminalSummary(value.terminalSummary),
    redacted: true as const,
  }
  return parseAgentRuntimeRendererListItem(listItem)
}

export function parseAgentRuntimeRendererListItem(
  value: unknown,
): AgentRuntimeRendererListItem {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['projectionVersion', 'runtime', 'terminalSummary', 'redacted']) ||
    value.projectionVersion !== AGENT_RUNTIME_RENDERER_PROJECTION_VERSION ||
    value.redacted !== true
  ) fail()
  const parsed = parseAgentRuntimeRendererEnvelope(
    { ...value, events: [], latestEvaluation: null },
    false,
  )
  return {
    projectionVersion: parsed.projectionVersion,
    runtime: parsed.runtime,
    terminalSummary: parsed.terminalSummary,
    redacted: true,
  }
}

function parseAgentRuntimeRendererEnvelope(
  value: unknown,
  requireFullTrajectory: boolean,
): AgentRuntimeRendererSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'projectionVersion',
      'runtime',
      'events',
      'latestEvaluation',
      'terminalSummary',
      'redacted',
    ]) ||
    value.projectionVersion !== AGENT_RUNTIME_RENDERER_PROJECTION_VERSION ||
    !Array.isArray(value.events) ||
    value.redacted !== true
  ) fail()
  const runtime = parseRendererSummary(value.runtime)
  const events = value.events.map(parseRendererEvent)
  if (
    events.some((event) => event.runtimeId !== runtime.runtimeId) ||
    events.some((event, index) => index > 0 && event.sequence <= events[index - 1]!.sequence) ||
    (requireFullTrajectory && (
      events.length !== runtime.nextSequence - 1 ||
      events.some((event, index) => event.sequence !== index + 1) ||
      events.some((event) => event.checkpointVersion > runtime.checkpointVersion) ||
      events.some((event) => Date.parse(event.createdAt) > Date.parse(runtime.updatedAt))
    ))
  ) fail()
  const terminalSummary = value.terminalSummary === null
    ? null
    : parseTerminalSummary(value.terminalSummary)
  const latestEvaluation = value.latestEvaluation === null
    ? null
    : parseRendererEvaluation(value.latestEvaluation)
  const latestEvaluationEvent = events.filter((event) => event.type === 'evaluation_recorded').at(-1)
  if (
    (latestEvaluation === null) !== (latestEvaluationEvent === undefined) ||
    (latestEvaluation !== null && latestEvaluationEvent !== undefined && (
      latestEvaluation.sequence !== latestEvaluationEvent.sequence ||
      latestEvaluation.checkpointVersion !== latestEvaluationEvent.checkpointVersion ||
      latestEvaluation.createdAt !== latestEvaluationEvent.createdAt
    )) ||
    (runtime.status === 'terminal') !== (terminalSummary !== null) ||
    (terminalSummary !== null && (
      terminalSummary.runtimeId !== runtime.runtimeId ||
      terminalSummary.checkpointVersion !== runtime.checkpointVersion ||
      terminalSummary.stopReason !== runtime.stopReason ||
      JSON.stringify(terminalSummary.counters) !== JSON.stringify(runtime.counters) ||
      terminalSummary.acceptedActionCount !== runtime.acceptedActionCount ||
      terminalSummary.lastObservationDigest !== runtime.lastObservationDigest ||
      terminalSummary.lastResultDigest !== runtime.lastResultDigest ||
      terminalSummary.completedAt !== runtime.updatedAt
    ))
  ) fail()
  return {
    projectionVersion: AGENT_RUNTIME_RENDERER_PROJECTION_VERSION,
    runtime,
    events,
    latestEvaluation,
    terminalSummary,
    redacted: true,
  }
}

export function parseAgentRuntimeRendererSnapshot(value: unknown): AgentRuntimeRendererSnapshot {
  return parseAgentRuntimeRendererEnvelope(value, true)
}
