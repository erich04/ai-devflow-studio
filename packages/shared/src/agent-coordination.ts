import {
  AGENT_RUNTIME_MAX_COST_USD,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOKENS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  AGENT_RUNTIME_MAX_WALL_TIME_MS,
} from './agent-runtime'

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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
