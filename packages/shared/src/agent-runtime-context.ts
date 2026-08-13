import type { AgentRuntimeAuthority, AgentRuntimeScope } from './agent-runtime'
import {
  parseCurrentKnowledgeCitation,
  parseDurableAgentMemoryRevision,
  parseKnowledgeRetrievalRequest,
  type DurableAgentMemoryRevision,
  type KnowledgeCitation,
  type KnowledgeHybridRetrievalResult,
  type KnowledgeRerankedRetrievalResult,
  type KnowledgeRetrievalCandidateSet,
  type KnowledgeRetrievalRequest,
  type KnowledgeRetrievalScope,
  type KnowledgeSnapshotIdentitySet,
} from './retrieval-memory'

export const AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION = 1 as const
export const AGENT_RUNTIME_CONTEXT_CITATIONS_MAX = 20
export const AGENT_RUNTIME_CONTEXT_MEMORY_REVISIONS_MAX = 32
export const AGENT_RUNTIME_CONTEXT_BYTES_MAX = 512 * 1_024

const MAX_VERSION = 2_147_483_647
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const snapshotHashPattern = /^sha256:[a-f0-9]{64}$/u
const strategySet = new Set(['lexical', 'vector', 'hybrid', 'reranked'])

type KnowledgeRetrievalResult =
  | KnowledgeRetrievalCandidateSet
  | KnowledgeHybridRetrievalResult
  | KnowledgeRerankedRetrievalResult

export type AgentRuntimeKnowledgeCitationSource = {
  citation: KnowledgeCitation
  request: KnowledgeRetrievalRequest
  retrievalResult: KnowledgeRetrievalResult
  currentSnapshot: KnowledgeSnapshotIdentitySet
}

export type AgentMemoryCurrentRevisionIdentity = {
  stateVersion: typeof AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION
  memoryId: string
  revision: number
  headVersion: number
  status: 'active'
  scope: KnowledgeRetrievalScope
  sourceRuntimeId: string
  contentDigest: string
  updatedAt: string
}

export type AgentRuntimeMemoryRevisionSource = {
  revision: DurableAgentMemoryRevision
  current: AgentMemoryCurrentRevisionIdentity
}

export type AgentRuntimeContextAttachment = {
  stateVersion: typeof AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION
  id: string
  runtimeId: string
  checkpointVersion: number
  scope: AgentRuntimeScope
  authority: AgentRuntimeAuthority
  knowledgeCitations: KnowledgeCitation[]
  memoryRevisions: DurableAgentMemoryRevision[]
  memoryRevisionIdentities: AgentMemoryCurrentRevisionIdentity[]
  knowledgeIdentityDigest: string
  memoryIdentityDigest: string
  contextDigest: string
  attachedAt: string
}

export type AgentRuntimeContextTrajectoryMetadata = {
  attachmentId: string
  contextDigest: string
  knowledgeCitationCount: number
  memoryRevisionCount: number
  knowledgeIdentityDigest: string
  memoryIdentityDigest: string
}

export class AgentRuntimeContextContractError extends Error {
  readonly code = 'invalid_agent_runtime_context'

  constructor() {
    super('invalid_agent_runtime_context')
    this.name = 'AgentRuntimeContextContractError'
  }
}

function fail(): never {
  throw new AgentRuntimeContextContractError()
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

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value)
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSafeSourceRelativePath(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('//') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
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
  ) fail()
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
  fail()
}

function parseAuthority(value: unknown): AgentRuntimeAuthority {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['runId', 'nodeId', 'runVersion', 'policyVersion']) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isPositiveVersion(value.runVersion) ||
    !isPositiveVersion(value.policyVersion)
  ) fail()
  return {
    runId: value.runId,
    nodeId: value.nodeId,
    runVersion: value.runVersion,
    policyVersion: value.policyVersion,
  }
}

function scopesMatch(left: AgentRuntimeScope, right: AgentRuntimeScope): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
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

async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength
}

function parseAttachedCitation(value: unknown): KnowledgeCitation {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'scope',
      'knowledgeSnapshotHash',
      'documentId',
      'chunkId',
      'sourcePath',
      'headingPath',
      'contentHash',
      'strategyChain',
      'rank',
      'score',
      'citedAt',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION ||
    !isIdentifier(value.requestId) ||
    typeof value.knowledgeSnapshotHash !== 'string' ||
    !snapshotHashPattern.test(value.knowledgeSnapshotHash) ||
    !isIdentifier(value.documentId) ||
    !isIdentifier(value.chunkId) ||
    !isSafeSourceRelativePath(value.sourcePath) ||
    !Array.isArray(value.headingPath) ||
    value.headingPath.length === 0 ||
    !value.headingPath.every((heading) =>
      typeof heading === 'string' && heading.length > 0 && heading.trim() === heading
    ) ||
    !isIdentifier(value.contentHash) ||
    !Array.isArray(value.strategyChain) ||
    value.strategyChain.length === 0 ||
    !value.strategyChain.every((strategy) => strategySet.has(String(strategy))) ||
    !isPositiveVersion(value.rank) ||
    value.rank > AGENT_RUNTIME_CONTEXT_CITATIONS_MAX ||
    typeof value.score !== 'number' ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 1 ||
    !isCanonicalIso(value.citedAt)
  ) fail()
  const scope = parseScope(value.scope)
  return {
    stateVersion: AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION,
    requestId: value.requestId,
    scope,
    knowledgeSnapshotHash: value.knowledgeSnapshotHash,
    documentId: value.documentId,
    chunkId: value.chunkId,
    sourcePath: value.sourcePath,
    headingPath: [...value.headingPath] as string[],
    contentHash: value.contentHash,
    strategyChain: [...value.strategyChain] as KnowledgeCitation['strategyChain'],
    rank: value.rank,
    score: value.score,
    citedAt: value.citedAt,
  }
}

function parseCurrentMemoryIdentity(value: unknown): AgentMemoryCurrentRevisionIdentity {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'memoryId',
      'revision',
      'headVersion',
      'status',
      'scope',
      'sourceRuntimeId',
      'contentDigest',
      'updatedAt',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION ||
    !isIdentifier(value.memoryId) ||
    !isPositiveVersion(value.revision) ||
    !isPositiveVersion(value.headVersion) ||
    value.headVersion < value.revision ||
    value.status !== 'active' ||
    !isIdentifier(value.sourceRuntimeId) ||
    !isDigest(value.contentDigest) ||
    !isCanonicalIso(value.updatedAt)
  ) fail()
  return {
    stateVersion: AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION,
    memoryId: value.memoryId,
    revision: value.revision,
    headVersion: value.headVersion,
    status: 'active',
    scope: parseScope(value.scope),
    sourceRuntimeId: value.sourceRuntimeId,
    contentDigest: value.contentDigest,
    updatedAt: value.updatedAt,
  }
}

function parseCitationSource(value: unknown): AgentRuntimeKnowledgeCitationSource {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['citation', 'request', 'retrievalResult', 'currentSnapshot'])
  ) fail()
  const request = parseKnowledgeRetrievalRequest(value.request)
  const citation = parseCurrentKnowledgeCitation(
    value.citation,
    request,
    value.retrievalResult as KnowledgeRetrievalResult,
    value.currentSnapshot,
  )
  return {
    citation,
    request,
    retrievalResult: value.retrievalResult as KnowledgeRetrievalResult,
    currentSnapshot: value.currentSnapshot as KnowledgeSnapshotIdentitySet,
  }
}

function citationIdentity(citation: KnowledgeCitation) {
  return {
    requestId: citation.requestId,
    knowledgeSnapshotHash: citation.knowledgeSnapshotHash,
    documentId: citation.documentId,
    chunkId: citation.chunkId,
    contentHash: citation.contentHash,
    rank: citation.rank,
  }
}

function memoryIdentity(revision: DurableAgentMemoryRevision, headVersion: number) {
  return {
    memoryId: revision.id,
    revision: revision.revision,
    headVersion,
    contentDigest: revision.contentDigest,
    sourceCandidateId: revision.sourceCandidateId,
  }
}

async function assembleAgentRuntimeContextUnchecked(
  value: unknown,
): Promise<AgentRuntimeContextAttachment> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'runtimeId',
      'checkpointVersion',
      'scope',
      'authority',
      'citationSources',
      'memorySources',
      'attachedAt',
    ]) ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.runtimeId) ||
    !isPositiveVersion(value.checkpointVersion) ||
    !Array.isArray(value.citationSources) ||
    value.citationSources.length > AGENT_RUNTIME_CONTEXT_CITATIONS_MAX ||
    !Array.isArray(value.memorySources) ||
    value.memorySources.length > AGENT_RUNTIME_CONTEXT_MEMORY_REVISIONS_MAX ||
    !isCanonicalIso(value.attachedAt)
  ) fail()
  const runtimeId = value.runtimeId as string
  const attachedAt = value.attachedAt as string
  const scope = parseScope(value.scope)
  const authority = parseAuthority(value.authority)
  const citationSources = value.citationSources.map(parseCitationSource)
  const knowledgeCitations = citationSources.map((source) => source.citation)
  const memorySources = await Promise.all(value.memorySources.map(async (sourceValue) => {
    if (
      !isPlainRecord(sourceValue) ||
      !hasExactKeys(sourceValue, ['revision', 'current'])
    ) fail()
    return {
      revision: await parseDurableAgentMemoryRevision(sourceValue.revision),
      current: parseCurrentMemoryIdentity(sourceValue.current),
    }
  }))
  const memoryRevisions = memorySources.map((source) => source.revision)

  for (const source of citationSources) {
    const refreshedAt = source.currentSnapshot.refreshedAt
    if (
      !scopesMatch(source.citation.scope, scope) ||
      !scopesMatch(source.request.scope, scope) ||
      source.request.target.runId !== authority.runId ||
      source.request.target.nodeId !== authority.nodeId ||
      source.request.target.runVersion !== authority.runVersion ||
      Date.parse(source.citation.citedAt) > Date.parse(value.attachedAt) ||
      Date.parse(refreshedAt) > Date.parse(value.attachedAt)
    ) fail()
  }
  for (const source of memorySources) {
    if (
      source.revision.status !== 'active' ||
      source.current.memoryId !== source.revision.id ||
      source.current.revision !== source.revision.revision ||
      source.current.contentDigest !== source.revision.contentDigest ||
      !scopesMatch(source.revision.scope, scope) ||
      !scopesMatch(source.current.scope, scope) ||
      Date.parse(source.revision.createdAt) > Date.parse(value.attachedAt) ||
      Date.parse(source.current.updatedAt) > Date.parse(value.attachedAt) ||
      (source.revision.expiresAt !== null &&
        Date.parse(source.revision.expiresAt) <= Date.parse(value.attachedAt)) ||
      (source.revision.visibility === 'runtime' && source.current.sourceRuntimeId !== value.runtimeId) ||
      (source.revision.visibility === 'project_shared' && scope.kind !== 'team')
    ) fail()
  }

  const citationIdentities = knowledgeCitations.map(citationIdentity)
  const memoryIdentities = memorySources.map((source) =>
    memoryIdentity(source.revision, source.current.headVersion)
  )
  if (
    new Set(citationIdentities.map((identity) => canonicalJson(identity))).size !==
      citationIdentities.length ||
    new Set(memoryIdentities.map((identity) => identity.memoryId)).size !== memoryIdentities.length
  ) fail()

  const knowledgeIdentityDigest = await sha256Canonical(citationIdentities)
  const memoryIdentityDigest = await sha256Canonical(memoryIdentities)
  const contextPayload = {
    stateVersion: AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION,
    id: value.id,
    runtimeId: value.runtimeId,
    checkpointVersion: value.checkpointVersion,
    scope,
    authority,
    knowledgeCitations,
    memoryRevisions,
    memoryRevisionIdentities: memorySources.map((source) => source.current),
    knowledgeIdentityDigest,
    memoryIdentityDigest,
  }
  const attachment: AgentRuntimeContextAttachment = {
    ...contextPayload,
    contextDigest: await sha256Canonical(contextPayload),
    attachedAt: value.attachedAt,
  }
  if (utf8Bytes(attachment) > AGENT_RUNTIME_CONTEXT_BYTES_MAX) fail()
  return structuredClone(attachment)
}

export async function assembleAgentRuntimeContext(
  value: unknown,
): Promise<AgentRuntimeContextAttachment> {
  try {
    return await assembleAgentRuntimeContextUnchecked(value)
  } catch {
    fail()
  }
}

async function parseAgentRuntimeContextAttachmentUnchecked(
  value: unknown,
): Promise<AgentRuntimeContextAttachment> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'runtimeId',
      'checkpointVersion',
      'scope',
      'authority',
      'knowledgeCitations',
      'memoryRevisions',
      'memoryRevisionIdentities',
      'knowledgeIdentityDigest',
      'memoryIdentityDigest',
      'contextDigest',
      'attachedAt',
    ]) ||
    value.stateVersion !== AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.runtimeId) ||
    !isPositiveVersion(value.checkpointVersion) ||
    !Array.isArray(value.knowledgeCitations) ||
    value.knowledgeCitations.length > AGENT_RUNTIME_CONTEXT_CITATIONS_MAX ||
    !Array.isArray(value.memoryRevisions) ||
    value.memoryRevisions.length > AGENT_RUNTIME_CONTEXT_MEMORY_REVISIONS_MAX ||
    !Array.isArray(value.memoryRevisionIdentities) ||
    value.memoryRevisionIdentities.length !== value.memoryRevisions.length ||
    !isDigest(value.knowledgeIdentityDigest) ||
    !isDigest(value.memoryIdentityDigest) ||
    !isDigest(value.contextDigest) ||
    !isCanonicalIso(value.attachedAt)
  ) fail()
  const runtimeId = value.runtimeId as string
  const attachedAt = value.attachedAt as string
  const scope = parseScope(value.scope)
  const authority = parseAuthority(value.authority)
  const knowledgeCitations = value.knowledgeCitations.map(parseAttachedCitation)
  const memoryRevisions = await Promise.all(
    value.memoryRevisions.map(parseDurableAgentMemoryRevision),
  )
  const memoryRevisionIdentities = value.memoryRevisionIdentities.map(parseCurrentMemoryIdentity)
  if (
    knowledgeCitations.some((citation) =>
      !scopesMatch(citation.scope, scope) ||
      Date.parse(citation.citedAt) > Date.parse(attachedAt)
    ) ||
    memoryRevisions.some((revision, index) => {
      const identity = memoryRevisionIdentities[index]
      return identity === undefined ||
        revision.status !== 'active' ||
        revision.id !== identity.memoryId ||
        revision.revision !== identity.revision ||
        revision.contentDigest !== identity.contentDigest ||
        !scopesMatch(revision.scope, scope) ||
        !scopesMatch(identity.scope, scope) ||
        Date.parse(revision.createdAt) > Date.parse(attachedAt) ||
        Date.parse(identity.updatedAt) > Date.parse(attachedAt) ||
        (revision.expiresAt !== null && Date.parse(revision.expiresAt) <= Date.parse(attachedAt)) ||
        (revision.visibility === 'runtime' && identity.sourceRuntimeId !== runtimeId) ||
        (revision.visibility === 'project_shared' && scope.kind !== 'team')
    })
  ) fail()
  const citationIdentities = knowledgeCitations.map(citationIdentity)
  const memoryIdentities = memoryRevisions.map((revision, index) =>
    memoryIdentity(revision, memoryRevisionIdentities[index]!.headVersion)
  )
  if (
    new Set(citationIdentities.map((identity) => canonicalJson(identity))).size !==
      citationIdentities.length ||
    new Set(memoryIdentities.map((identity) => identity.memoryId)).size !== memoryIdentities.length
  ) fail()
  const attachment = {
    stateVersion: AGENT_RUNTIME_CONTEXT_CONTRACT_VERSION,
    id: value.id,
    runtimeId,
    checkpointVersion: value.checkpointVersion,
    scope,
    authority,
    knowledgeCitations,
    memoryRevisions,
    memoryRevisionIdentities,
    knowledgeIdentityDigest: value.knowledgeIdentityDigest,
    memoryIdentityDigest: value.memoryIdentityDigest,
    contextDigest: value.contextDigest,
    attachedAt,
  }
  const contextPayload = {
    stateVersion: attachment.stateVersion,
    id: attachment.id,
    runtimeId: attachment.runtimeId,
    checkpointVersion: attachment.checkpointVersion,
    scope: attachment.scope,
    authority: attachment.authority,
    knowledgeCitations: attachment.knowledgeCitations,
    memoryRevisions: attachment.memoryRevisions,
    memoryRevisionIdentities: attachment.memoryRevisionIdentities,
    knowledgeIdentityDigest: attachment.knowledgeIdentityDigest,
    memoryIdentityDigest: attachment.memoryIdentityDigest,
  }
  if (
    await sha256Canonical(citationIdentities) !== attachment.knowledgeIdentityDigest ||
    await sha256Canonical(memoryIdentities) !== attachment.memoryIdentityDigest ||
    await sha256Canonical(contextPayload) !== attachment.contextDigest ||
    utf8Bytes(attachment) > AGENT_RUNTIME_CONTEXT_BYTES_MAX
  ) fail()
  return structuredClone(attachment)
}

export async function parseAgentRuntimeContextAttachment(
  value: unknown,
): Promise<AgentRuntimeContextAttachment> {
  try {
    return await parseAgentRuntimeContextAttachmentUnchecked(value)
  } catch {
    fail()
  }
}

export function projectAgentRuntimeContextTrajectoryMetadata(
  attachment: AgentRuntimeContextAttachment,
): AgentRuntimeContextTrajectoryMetadata {
  if (
    !isIdentifier(attachment.id) ||
    !isDigest(attachment.contextDigest) ||
    !isDigest(attachment.knowledgeIdentityDigest) ||
    !isDigest(attachment.memoryIdentityDigest)
  ) fail()
  return {
    attachmentId: attachment.id,
    contextDigest: attachment.contextDigest,
    knowledgeCitationCount: attachment.knowledgeCitations.length,
    memoryRevisionCount: attachment.memoryRevisions.length,
    knowledgeIdentityDigest: attachment.knowledgeIdentityDigest,
    memoryIdentityDigest: attachment.memoryIdentityDigest,
  }
}
