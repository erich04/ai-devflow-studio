import {
  AGENT_MEMORY_RENDERER_PROJECTION_VERSION,
  parseAgentMemoryRendererSnapshot,
  type AgentMemoryRendererItem,
} from './agent-memory-projection'
import type {
  AgentMemoryRetentionClass,
  AgentMemorySensitivity,
  AgentMemoryVisibility,
} from './retrieval-memory'

export const AGENT_MEMORY_TEAM_PROJECTION_VERSION = 1 as const
export const AGENT_MEMORY_TEAM_CITATION_IDS_MAX = 64

export type RemoteAgentMemoryLifecycleStatus =
  | 'active'
  | 'conflict'
  | 'expired'
  | 'purge_pending'
  | 'deleted'

export type RemoteAgentMemorySummary = {
  stateVersion: 1
  projectionVersion: typeof AGENT_MEMORY_TEAM_PROJECTION_VERSION
  memoryId: string
  projectId: string
  runId: string
  nodeId: string
  runtimeId: string
  ownerUserId: string
  candidateId: string
  currentRevision: number
  headVersion: number
  qualityVersion: number
  lifecycleStatus: RemoteAgentMemoryLifecycleStatus
  visibility: AgentMemoryVisibility
  sensitivity: AgentMemorySensitivity
  retentionClass: AgentMemoryRetentionClass
  provenanceDigest: string
  citationIds: string[]
  retrievalCount: number
  acceptedContextCount: number
  expiresAt: string | null
  deletedAt: string | null
  purgeStatus: 'pending' | 'completed' | null
  purgedAt: string | null
  updatedAt: string
  redacted: true
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const maximumVersion = 2_147_483_647

function fail(): never {
  throw new Error('agent_memory_team_projection_invalid')
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

function isQualityVersion(value: unknown): value is number {
  return isCount(value) && Number(value) <= maximumVersion
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function parseLifecycleStatus(value: unknown): RemoteAgentMemoryLifecycleStatus {
  if (
    value !== 'active' &&
    value !== 'conflict' &&
    value !== 'expired' &&
    value !== 'purge_pending' &&
    value !== 'deleted'
  ) fail()
  return value
}

function parseVisibility(value: unknown): AgentMemoryVisibility {
  if (value !== 'runtime' && value !== 'user_project' && value !== 'project_shared') fail()
  return value
}

function parseSensitivity(value: unknown): AgentMemorySensitivity {
  if (value !== 'private' && value !== 'internal') fail()
  return value
}

function parseRetentionClass(value: unknown): AgentMemoryRetentionClass {
  if (value !== 'session' && value !== 'thirty_days' && value !== 'until_deleted') fail()
  return value
}

function parseCitationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > AGENT_MEMORY_TEAM_CITATION_IDS_MAX) fail()
  const citationIds = value.map((candidate) => {
    if (!isIdentifier(candidate)) fail()
    return candidate
  })
  if (citationIds.some((candidate, index) => index > 0 && citationIds[index - 1]! >= candidate)) {
    fail()
  }
  return citationIds
}

export function parseRemoteAgentMemorySummary(value: unknown): RemoteAgentMemorySummary {
  const keys = [
    'stateVersion',
    'projectionVersion',
    'memoryId',
    'projectId',
    'runId',
    'nodeId',
    'runtimeId',
    'ownerUserId',
    'candidateId',
    'currentRevision',
    'headVersion',
    'qualityVersion',
    'lifecycleStatus',
    'visibility',
    'sensitivity',
    'retentionClass',
    'provenanceDigest',
    'citationIds',
    'retrievalCount',
    'acceptedContextCount',
    'expiresAt',
    'deletedAt',
    'purgeStatus',
    'purgedAt',
    'updatedAt',
    'redacted',
  ] as const
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.stateVersion !== 1 ||
    value.projectionVersion !== AGENT_MEMORY_TEAM_PROJECTION_VERSION ||
    !isIdentifier(value.memoryId) ||
    !isIdentifier(value.projectId) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isIdentifier(value.runtimeId) ||
    !isIdentifier(value.ownerUserId) ||
    !isIdentifier(value.candidateId) ||
    !isVersion(value.currentRevision) ||
    !isVersion(value.headVersion) ||
    Number(value.headVersion) < Number(value.currentRevision) ||
    !isQualityVersion(value.qualityVersion) ||
    !isDigest(value.provenanceDigest) ||
    !isCount(value.retrievalCount) ||
    !isCount(value.acceptedContextCount) ||
    Number(value.acceptedContextCount) > Number(value.retrievalCount) ||
    (Number(value.qualityVersion) !== 0 &&
      Number(value.qualityVersion) !== Number(value.acceptedContextCount) + 1) ||
    (value.expiresAt !== null && !isCanonicalIso(value.expiresAt)) ||
    (value.deletedAt !== null && !isCanonicalIso(value.deletedAt)) ||
    (value.purgedAt !== null && !isCanonicalIso(value.purgedAt)) ||
    !isCanonicalIso(value.updatedAt) ||
    value.redacted !== true
  ) fail()

  const lifecycleStatus = parseLifecycleStatus(value.lifecycleStatus)
  const visibility = parseVisibility(value.visibility)
  const sensitivity = parseSensitivity(value.sensitivity)
  const retentionClass = parseRetentionClass(value.retentionClass)
  const citationIds = parseCitationIds(value.citationIds)
  if (
    (lifecycleStatus === 'expired' && value.expiresAt === null) ||
    (lifecycleStatus === 'purge_pending' && (
      value.deletedAt === null || value.purgeStatus !== 'pending' || value.purgedAt !== null
    )) ||
    (lifecycleStatus === 'deleted' && (
      value.deletedAt === null || value.purgeStatus !== 'completed' || value.purgedAt === null
    )) ||
    ((lifecycleStatus === 'active' || lifecycleStatus === 'conflict' || lifecycleStatus === 'expired') && (
      value.deletedAt !== null || value.purgeStatus !== null || value.purgedAt !== null
    )) ||
    (value.purgedAt !== null && value.deletedAt !== null &&
      Date.parse(value.purgedAt) < Date.parse(value.deletedAt))
  ) fail()

  return {
    stateVersion: 1,
    projectionVersion: AGENT_MEMORY_TEAM_PROJECTION_VERSION,
    memoryId: value.memoryId,
    projectId: value.projectId,
    runId: value.runId,
    nodeId: value.nodeId,
    runtimeId: value.runtimeId,
    ownerUserId: value.ownerUserId,
    candidateId: value.candidateId,
    currentRevision: value.currentRevision,
    headVersion: value.headVersion,
    qualityVersion: value.qualityVersion,
    lifecycleStatus,
    visibility,
    sensitivity,
    retentionClass,
    provenanceDigest: value.provenanceDigest,
    citationIds,
    retrievalCount: value.retrievalCount,
    acceptedContextCount: value.acceptedContextCount,
    expiresAt: value.expiresAt,
    deletedAt: value.deletedAt,
    purgeStatus: value.purgeStatus as 'pending' | 'completed' | null,
    purgedAt: value.purgedAt,
    updatedAt: value.updatedAt,
    redacted: true,
  }
}

export type CreateRemoteAgentMemorySummaryInput = {
  memory: AgentMemoryRendererItem
  runId: string
  nodeId: string
  runtimeId: string
  citationIds: string[]
  retrievalCount: number
  acceptedContextCount: number
  qualityVersion: number
  qualityUpdatedAt: string
}

function parseMemory(value: unknown): AgentMemoryRendererItem {
  if (!isRecord(value) || !isRecord(value.scope)) fail()
  try {
    const snapshot = parseAgentMemoryRendererSnapshot({
      projectionVersion: AGENT_MEMORY_RENDERER_PROJECTION_VERSION,
      localProjectId: value.scope.localProjectId,
      observedAt: value.updatedAt,
      candidateCount: 0,
      memoryCount: 1,
      truncated: false,
      candidates: [],
      memories: [value],
      redacted: true,
    })
    const memory = snapshot.memories[0]
    if (memory === undefined) fail()
    return memory
  } catch {
    fail()
  }
}

function canonicalCitationIds(value: unknown): string[] {
  if (!Array.isArray(value)) fail()
  const sorted = [...value].sort((left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string') fail()
    return left < right ? -1 : left > right ? 1 : 0
  })
  return parseCitationIds(sorted)
}

export function createRemoteAgentMemorySummary(
  input: unknown,
): RemoteAgentMemorySummary {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'memory',
      'runId',
      'nodeId',
      'runtimeId',
      'citationIds',
      'retrievalCount',
      'acceptedContextCount',
      'qualityVersion',
      'qualityUpdatedAt',
    ]) ||
    !isIdentifier(input.runId) ||
    !isIdentifier(input.nodeId) ||
    !isIdentifier(input.runtimeId) ||
    !isCount(input.retrievalCount) ||
    !isCount(input.acceptedContextCount) ||
    !isQualityVersion(input.qualityVersion) ||
    input.qualityVersion !== input.acceptedContextCount + 1 ||
    !isCanonicalIso(input.qualityUpdatedAt)
  ) fail()
  const memory = parseMemory(input.memory)
  if (
    memory.scope.kind !== 'team' ||
    memory.scope.projectId === null ||
    (memory.tombstone?.lastRevision !== undefined &&
      memory.tombstone.lastRevision !== memory.currentRevision) ||
    Date.parse(input.qualityUpdatedAt) < Date.parse(memory.updatedAt)
  ) fail()

  return parseRemoteAgentMemorySummary({
    stateVersion: 1,
    projectionVersion: AGENT_MEMORY_TEAM_PROJECTION_VERSION,
    memoryId: memory.memoryId,
    projectId: memory.scope.projectId,
    runId: input.runId,
    nodeId: input.nodeId,
    runtimeId: input.runtimeId,
    ownerUserId: memory.scope.userId,
    candidateId: memory.sourceCandidateId,
    currentRevision: memory.currentRevision,
    headVersion: memory.headVersion,
    qualityVersion: input.qualityVersion,
    lifecycleStatus: memory.lifecycleStatus,
    visibility: memory.visibility,
    sensitivity: memory.sensitivity,
    retentionClass: memory.retentionClass,
    provenanceDigest: memory.provenanceDigest,
    citationIds: canonicalCitationIds(input.citationIds),
    retrievalCount: input.retrievalCount,
    acceptedContextCount: input.acceptedContextCount,
    expiresAt: memory.expiresAt,
    deletedAt: memory.tombstone?.deletedAt ?? null,
    purgeStatus: memory.tombstone?.purgeStatus ?? null,
    purgedAt: memory.tombstone?.purgedAt ?? null,
    updatedAt: input.qualityUpdatedAt,
    redacted: true,
  })
}
