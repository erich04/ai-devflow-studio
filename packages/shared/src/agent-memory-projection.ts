import { redactSensitiveText } from './redaction'
import {
  AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES,
  type AgentMemoryCandidate,
  type AgentMemoryRetentionClass,
  type AgentMemorySensitivity,
  type AgentMemoryTombstone,
  type AgentMemoryVisibility,
  type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from './retrieval-memory'

export const AGENT_MEMORY_RENDERER_PROJECTION_VERSION = 1 as const
export const AGENT_MEMORY_RENDERER_ITEMS_MAX = 128

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const maxVersion = 2_147_483_647

export type AgentMemoryLifecycleHeadSource = {
  memoryId: string
  currentRevision: number
  scope: KnowledgeRetrievalScope
  status: 'active' | 'conflict' | 'expired' | 'purge_pending' | 'deleted'
  version: number
  updatedAt: string
}

export type AgentMemoryRendererScope = {
  kind: 'local' | 'team'
  organizationId: string | null
  projectId: string | null
  userId: string
  localProjectId: string
}

export type AgentMemoryRendererCandidate = {
  id: string
  lifecycleStatus: 'pending' | 'promoted'
  scope: AgentMemoryRendererScope
  statement: string
  contentDigest: string
  provenance: {
    kind: 'agent_observation'
    runtimeId: string
    actionId: string
    checkpointVersion: number
    sequence: number
    resultDigest: string
  }
  provenanceDigest: string
  createdAt: string
  redacted: true
}

export type AgentMemoryRendererTombstone = {
  deletionVersion: number
  lastRevision: number
  purgeStatus: 'pending' | 'completed'
  deletedAt: string
  purgedAt: string | null
}

export type AgentMemoryRendererItem = {
  memoryId: string
  headVersion: number
  currentRevision: number
  lifecycleStatus: 'active' | 'conflict' | 'expired' | 'purge_pending' | 'deleted'
  revisionStatus: 'active' | 'conflict'
  scope: AgentMemoryRendererScope
  visibility: AgentMemoryVisibility
  statement: string | null
  contentDigest: string
  provenanceDigest: string
  sourceCandidateId: string
  sensitivity: AgentMemorySensitivity
  retentionClass: AgentMemoryRetentionClass
  expiresAt: string | null
  promotionPolicyId: string
  promotionPolicyVersion: number
  createdAt: string
  updatedAt: string
  tombstone: AgentMemoryRendererTombstone | null
  redacted: true
}

export type AgentMemoryRendererSnapshot = {
  projectionVersion: typeof AGENT_MEMORY_RENDERER_PROJECTION_VERSION
  localProjectId: string
  observedAt: string
  candidateCount: number
  memoryCount: number
  truncated: boolean
  candidates: AgentMemoryRendererCandidate[]
  memories: AgentMemoryRendererItem[]
  redacted: true
}

export type CreateAgentMemoryRendererSnapshotInput = {
  scope: KnowledgeRetrievalScope
  candidates: AgentMemoryCandidate[]
  memories: Array<{
    head: AgentMemoryLifecycleHeadSource
    revision: DurableAgentMemoryRevision
    tombstone: AgentMemoryTombstone | null
  }>
  observedAt: string
}

function fail(): never {
  throw new Error('invalid_agent_memory_renderer_snapshot')
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
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isRendererStatement(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    new TextEncoder().encode(value).byteLength <= AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES &&
    redactSensitiveText(value).value === value
}

function projectScope(scope: KnowledgeRetrievalScope): AgentMemoryRendererScope {
  return {
    kind: scope.kind,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    localProjectId: scope.localProjectId,
  }
}

function parseScope(value: unknown): AgentMemoryRendererScope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['kind', 'organizationId', 'projectId', 'userId', 'localProjectId']) ||
    (value.kind !== 'local' && value.kind !== 'team') ||
    !isIdentifier(value.userId) ||
    !isIdentifier(value.localProjectId)
  ) fail()
  if (
    (value.kind === 'local' && (value.organizationId !== null || value.projectId !== null)) ||
    (value.kind === 'team' &&
      (!isIdentifier(value.organizationId) || !isIdentifier(value.projectId)))
  ) fail()
  return {
    kind: value.kind,
    organizationId: value.organizationId as string | null,
    projectId: value.projectId as string | null,
    userId: value.userId,
    localProjectId: value.localProjectId,
  }
}

function rendererScopesMatch(
  left: AgentMemoryRendererScope,
  right: AgentMemoryRendererScope,
): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.localProjectId === right.localProjectId
}

function knowledgeScopesMatch(
  left: KnowledgeRetrievalScope,
  right: KnowledgeRetrievalScope,
): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
}

function parseCandidate(value: unknown): AgentMemoryRendererCandidate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'lifecycleStatus',
      'scope',
      'statement',
      'contentDigest',
      'provenance',
      'provenanceDigest',
      'createdAt',
      'redacted',
    ]) ||
    !isIdentifier(value.id) ||
    (value.lifecycleStatus !== 'pending' && value.lifecycleStatus !== 'promoted') ||
    !isRendererStatement(value.statement) ||
    !isDigest(value.contentDigest) ||
    !isDigest(value.provenanceDigest) ||
    !isCanonicalIso(value.createdAt) ||
    value.redacted !== true ||
    !isRecord(value.provenance) ||
    !hasExactKeys(value.provenance, [
      'kind',
      'runtimeId',
      'actionId',
      'checkpointVersion',
      'sequence',
      'resultDigest',
    ]) ||
    value.provenance.kind !== 'agent_observation' ||
    !isIdentifier(value.provenance.runtimeId) ||
    !isIdentifier(value.provenance.actionId) ||
    !isVersion(value.provenance.checkpointVersion) ||
    !isVersion(value.provenance.sequence) ||
    !isDigest(value.provenance.resultDigest)
  ) fail()
  return {
    id: value.id,
    lifecycleStatus: value.lifecycleStatus,
    scope: parseScope(value.scope),
    statement: value.statement,
    contentDigest: value.contentDigest,
    provenance: {
      kind: 'agent_observation',
      runtimeId: value.provenance.runtimeId,
      actionId: value.provenance.actionId,
      checkpointVersion: value.provenance.checkpointVersion,
      sequence: value.provenance.sequence,
      resultDigest: value.provenance.resultDigest,
    },
    provenanceDigest: value.provenanceDigest,
    createdAt: value.createdAt,
    redacted: true,
  }
}

function parseTombstone(value: unknown): AgentMemoryRendererTombstone {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'deletionVersion',
      'lastRevision',
      'purgeStatus',
      'deletedAt',
      'purgedAt',
    ]) ||
    !isVersion(value.deletionVersion) ||
    !isVersion(value.lastRevision) ||
    (value.purgeStatus !== 'pending' && value.purgeStatus !== 'completed') ||
    !isCanonicalIso(value.deletedAt) ||
    (value.purgedAt !== null && !isCanonicalIso(value.purgedAt)) ||
    (value.purgeStatus === 'pending' && value.purgedAt !== null) ||
    (value.purgeStatus === 'completed' && value.purgedAt === null) ||
    (typeof value.purgedAt === 'string' && Date.parse(value.purgedAt) < Date.parse(value.deletedAt))
  ) fail()
  return {
    deletionVersion: value.deletionVersion,
    lastRevision: value.lastRevision,
    purgeStatus: value.purgeStatus,
    deletedAt: value.deletedAt,
    purgedAt: value.purgedAt as string | null,
  }
}

function parseMemory(value: unknown): AgentMemoryRendererItem {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'memoryId',
      'headVersion',
      'currentRevision',
      'lifecycleStatus',
      'revisionStatus',
      'scope',
      'visibility',
      'statement',
      'contentDigest',
      'provenanceDigest',
      'sourceCandidateId',
      'sensitivity',
      'retentionClass',
      'expiresAt',
      'promotionPolicyId',
      'promotionPolicyVersion',
      'createdAt',
      'updatedAt',
      'tombstone',
      'redacted',
    ]) ||
    !isIdentifier(value.memoryId) ||
    !isVersion(value.headVersion) ||
    !isVersion(value.currentRevision) ||
    !['active', 'conflict', 'expired', 'purge_pending', 'deleted'].includes(
      String(value.lifecycleStatus),
    ) ||
    (value.revisionStatus !== 'active' && value.revisionStatus !== 'conflict') ||
    !['runtime', 'user_project', 'project_shared'].includes(String(value.visibility)) ||
    (value.statement !== null && !isRendererStatement(value.statement)) ||
    !isDigest(value.contentDigest) ||
    !isDigest(value.provenanceDigest) ||
    !isIdentifier(value.sourceCandidateId) ||
    !['private', 'internal'].includes(String(value.sensitivity)) ||
    !['session', 'thirty_days', 'until_deleted'].includes(String(value.retentionClass)) ||
    (value.expiresAt !== null && !isCanonicalIso(value.expiresAt)) ||
    !isIdentifier(value.promotionPolicyId) ||
    !isVersion(value.promotionPolicyVersion) ||
    !isCanonicalIso(value.createdAt) ||
    !isCanonicalIso(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    value.redacted !== true
  ) fail()
  const tombstone = value.tombstone === null ? null : parseTombstone(value.tombstone)
  if (
    (value.lifecycleStatus === 'purge_pending' &&
      (tombstone?.purgeStatus !== 'pending' ||
        tombstone.deletionVersion !== value.headVersion ||
        tombstone.lastRevision !== value.currentRevision)) ||
    (value.lifecycleStatus === 'deleted' &&
      (tombstone?.purgeStatus !== 'completed' ||
        tombstone.deletionVersion + 1 !== value.headVersion ||
        tombstone.lastRevision !== value.currentRevision)) ||
    (!['purge_pending', 'deleted'].includes(String(value.lifecycleStatus)) && tombstone !== null) ||
    (value.lifecycleStatus === 'conflict' && value.revisionStatus !== 'conflict') ||
    (value.lifecycleStatus === 'expired' && value.expiresAt === null) ||
    (value.lifecycleStatus === 'deleted' && value.statement !== null) ||
    (value.lifecycleStatus !== 'deleted' && value.statement === null)
  ) fail()
  return {
    memoryId: value.memoryId,
    headVersion: value.headVersion,
    currentRevision: value.currentRevision,
    lifecycleStatus: value.lifecycleStatus as AgentMemoryRendererItem['lifecycleStatus'],
    revisionStatus: value.revisionStatus,
    scope: parseScope(value.scope),
    visibility: value.visibility as AgentMemoryVisibility,
    statement: value.statement as string | null,
    contentDigest: value.contentDigest,
    provenanceDigest: value.provenanceDigest,
    sourceCandidateId: value.sourceCandidateId,
    sensitivity: value.sensitivity as AgentMemorySensitivity,
    retentionClass: value.retentionClass as AgentMemoryRetentionClass,
    expiresAt: value.expiresAt as string | null,
    promotionPolicyId: value.promotionPolicyId,
    promotionPolicyVersion: value.promotionPolicyVersion,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    tombstone,
    redacted: true,
  }
}

export function parseAgentMemoryRendererSnapshot(value: unknown): AgentMemoryRendererSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'projectionVersion',
      'localProjectId',
      'observedAt',
      'candidateCount',
      'memoryCount',
      'truncated',
      'candidates',
      'memories',
      'redacted',
    ]) ||
    value.projectionVersion !== AGENT_MEMORY_RENDERER_PROJECTION_VERSION ||
    !isIdentifier(value.localProjectId) ||
    !isCanonicalIso(value.observedAt) ||
    !isCount(value.candidateCount) ||
    !isCount(value.memoryCount) ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.memories) ||
    value.candidates.length > AGENT_MEMORY_RENDERER_ITEMS_MAX ||
    value.memories.length > AGENT_MEMORY_RENDERER_ITEMS_MAX ||
    value.candidateCount < value.candidates.length ||
    value.memoryCount < value.memories.length ||
    value.truncated !== (
      value.candidateCount > value.candidates.length || value.memoryCount > value.memories.length
    ) ||
    value.redacted !== true
  ) fail()
  const candidates = value.candidates.map(parseCandidate)
  const memories = value.memories.map(parseMemory)
  if (
    candidates.some((candidate) => candidate.scope.localProjectId !== value.localProjectId) ||
    memories.some((memory) => memory.scope.localProjectId !== value.localProjectId) ||
    new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length ||
    new Set(memories.map((memory) => memory.memoryId)).size !== memories.length
  ) fail()
  return {
    projectionVersion: AGENT_MEMORY_RENDERER_PROJECTION_VERSION,
    localProjectId: value.localProjectId,
    observedAt: value.observedAt,
    candidateCount: value.candidateCount,
    memoryCount: value.memoryCount,
    truncated: value.truncated,
    candidates,
    memories,
    redacted: true,
  }
}

export function createAgentMemoryRendererSnapshot(
  input: CreateAgentMemoryRendererSnapshotInput,
): AgentMemoryRendererSnapshot {
  const projectedInputScope = projectScope(input.scope)
  if (
    !isCanonicalIso(input.observedAt) ||
    !isIdentifier(input.scope.userId) ||
    !isIdentifier(input.scope.sessionId) ||
    !isIdentifier(input.scope.localProjectId) ||
    (input.scope.kind === 'local' &&
      (input.scope.organizationId !== null || input.scope.projectId !== null)) ||
    (input.scope.kind === 'team' &&
      (!isIdentifier(input.scope.organizationId) || !isIdentifier(input.scope.projectId))) ||
    input.candidates.some((candidate) => !knowledgeScopesMatch(candidate.scope, input.scope))
  ) fail()
  const promotedCandidateIds = new Set(input.memories.map(({ revision }) => revision.sourceCandidateId))
  const candidates: AgentMemoryRendererCandidate[] = [...input.candidates]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
    .slice(0, AGENT_MEMORY_RENDERER_ITEMS_MAX)
    .map((candidate) => ({
      id: candidate.id,
      lifecycleStatus: promotedCandidateIds.has(candidate.id) ? 'promoted' : 'pending',
      scope: projectScope(candidate.scope),
      statement: candidate.statement,
      contentDigest: candidate.contentDigest,
      provenance: { ...candidate.provenance },
      provenanceDigest: candidate.provenanceDigest,
      createdAt: candidate.createdAt,
      redacted: true,
    }))
  const memories: AgentMemoryRendererItem[] = [...input.memories]
    .sort((left, right) =>
      right.head.updatedAt.localeCompare(left.head.updatedAt) ||
      left.head.memoryId.localeCompare(right.head.memoryId))
    .slice(0, AGENT_MEMORY_RENDERER_ITEMS_MAX)
    .map(({ head, revision, tombstone }) => {
      const scope = projectScope(revision.scope)
      if (
        head.memoryId !== revision.id ||
        head.currentRevision !== revision.revision ||
        !knowledgeScopesMatch(head.scope, input.scope) ||
        !knowledgeScopesMatch(revision.scope, input.scope) ||
        !rendererScopesMatch(projectScope(head.scope), scope) ||
        (tombstone !== null &&
          (tombstone.memoryId !== revision.id ||
            !knowledgeScopesMatch(tombstone.scope, input.scope))) ||
        Date.parse(head.updatedAt) < Date.parse(revision.createdAt)
      ) fail()
      let lifecycleStatus: AgentMemoryRendererItem['lifecycleStatus']
      if (head.status === 'purge_pending' || head.status === 'deleted') {
        lifecycleStatus = head.status
      } else if (
        head.status === 'expired' ||
        (revision.expiresAt !== null && Date.parse(input.observedAt) >= Date.parse(revision.expiresAt))
      ) {
        lifecycleStatus = 'expired'
      } else if (head.status === 'conflict' || revision.status === 'conflict') {
        lifecycleStatus = 'conflict'
      } else {
        lifecycleStatus = 'active'
      }
      return {
        memoryId: revision.id,
        headVersion: head.version,
        currentRevision: revision.revision,
        lifecycleStatus,
        revisionStatus: revision.status,
        scope,
        visibility: revision.visibility,
        statement: lifecycleStatus === 'deleted' ? null : revision.statement,
        contentDigest: revision.contentDigest,
        provenanceDigest: revision.provenanceDigest,
        sourceCandidateId: revision.sourceCandidateId,
        sensitivity: revision.sensitivity,
        retentionClass: revision.retentionClass,
        expiresAt: revision.expiresAt,
        promotionPolicyId: revision.promotionPolicyId,
        promotionPolicyVersion: revision.promotionPolicyVersion,
        createdAt: revision.createdAt,
        updatedAt: head.updatedAt,
        tombstone: tombstone === null
          ? null
          : {
              deletionVersion: tombstone.deletionVersion,
              lastRevision: tombstone.lastRevision,
              purgeStatus: tombstone.purgeStatus,
              deletedAt: tombstone.deletedAt,
              purgedAt: tombstone.purgedAt,
            },
        redacted: true,
      }
    })
  return parseAgentMemoryRendererSnapshot({
    projectionVersion: AGENT_MEMORY_RENDERER_PROJECTION_VERSION,
    localProjectId: projectedInputScope.localProjectId,
    observedAt: input.observedAt,
    candidateCount: input.candidates.length,
    memoryCount: input.memories.length,
    truncated: input.candidates.length > candidates.length || input.memories.length > memories.length,
    candidates,
    memories,
    redacted: true,
  })
}
