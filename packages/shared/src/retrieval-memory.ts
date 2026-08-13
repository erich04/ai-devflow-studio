import type { KnowledgeDocumentCategory } from './domain'
import {
  isExactAgentRuntimeTransition,
  parseAgentRuntimeState,
  parseAgentRuntimeTransition,
  type AgentRuntimeState,
} from './agent-runtime'
import { redactSensitiveText } from './redaction'

export const KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION = 1 as const
export const AGENT_MEMORY_CONTRACT_VERSION = 1 as const
export const AGENT_MEMORY_RETRIEVAL_LIMIT_MAX = 256
export const AGENT_MEMORY_ACTIVE_REVISIONS_MAX = 2_048
export const AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES = 8 * 1_024
export const KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH = 8 * 1_024
export const KNOWLEDGE_RETRIEVAL_TOP_K_MAX = 20
export const KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX = 4_096

const MAX_VERSION = 2_147_483_647
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const snapshotHashPattern = /^sha256:[a-f0-9]{64}$/u
const tagPattern = /^[a-z0-9][a-z0-9._:-]{0,63}$/u
const knowledgeCategories = new Set<KnowledgeDocumentCategory>([
  'development_standard',
  'testing_standard',
  'review_checklist',
  'adr',
  'api_contract',
  'onboarding',
  'skill_rule',
  'mcp_rule',
])
const requiredEvaluationCategories = new Set([
  'retrieval_baseline',
  'hybrid_improvement',
  'citation',
  'citation_staleness',
  'tenant_isolation',
  'memory_quality',
  'memory_conflict',
  'memory_expiry',
  'memory_deletion',
  'memory_isolation',
])
const metricThresholdKeys = [
  'topK',
  'hybridRecallAtKMin',
  'hybridNdcgAtKMin',
  'hybridMeanReciprocalRankMin',
  'minimumAggregateImprovementOverLexical',
  'citationPrecisionMin',
  'citationFaithfulnessMin',
  'maxIsolationViolations',
  'paidProviderCalls',
] as const

export type KnowledgeRetrievalScope =
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

export type KnowledgeRetrievalTarget = {
  runId: string
  nodeId: string
  runVersion: number
}

export type AgentMemoryCandidateProvenance = {
  kind: 'agent_observation'
  runtimeId: string
  actionId: string
  checkpointVersion: number
  sequence: number
  resultDigest: string
}

export type AgentMemoryCandidate = {
  stateVersion: typeof AGENT_MEMORY_CONTRACT_VERSION
  id: string
  status: 'candidate'
  scope: KnowledgeRetrievalScope
  statement: string
  contentDigest: string
  provenance: AgentMemoryCandidateProvenance
  provenanceDigest: string
  createdAt: string
}

export type AgentMemoryRetrievalRequest = {
  stateVersion: typeof AGENT_MEMORY_CONTRACT_VERSION
  id: string
  scope: KnowledgeRetrievalScope
  runtimeId: string
  limit: number
  requestedAt: string
}

export type AgentMemoryVisibility = 'runtime' | 'user_project' | 'project_shared'
export type AgentMemorySensitivity = 'private' | 'internal'
export type AgentMemoryRetentionClass = 'session' | 'thirty_days' | 'until_deleted'

export type AgentMemoryPromotionAuthority = {
  stateVersion: typeof AGENT_MEMORY_CONTRACT_VERSION
  decisionId: string
  candidateId: string
  candidateContentDigest: string
  scope: KnowledgeRetrievalScope
  actorKind: 'human' | 'policy'
  actorId: string
  policyId: string
  policyVersion: number
  visibility: AgentMemoryVisibility
  sensitivity: AgentMemorySensitivity
  retentionClass: AgentMemoryRetentionClass
  expiresAt: string | null
  authorityDigest: string
  decidedAt: string
}

export type AgentMemoryRevisionAuthority = {
  stateVersion: typeof AGENT_MEMORY_CONTRACT_VERSION
  decisionId: string
  memoryId: string
  expectedRevision: number
  expectedContentDigest: string
  scope: KnowledgeRetrievalScope
  actorKind: 'human' | 'policy'
  actorId: string
  policyId: string
  policyVersion: number
  visibility: AgentMemoryVisibility
  sensitivity: AgentMemorySensitivity
  retentionClass: AgentMemoryRetentionClass
  expiresAt: string | null
  authorityDigest: string
  decidedAt: string
}

export type DurableAgentMemoryRevision = {
  stateVersion: typeof AGENT_MEMORY_CONTRACT_VERSION
  id: string
  revision: number
  status: 'active' | 'conflict'
  scope: KnowledgeRetrievalScope
  visibility: AgentMemoryVisibility
  statement: string
  contentDigest: string
  provenanceDigest: string
  sourceCandidateId: string
  supersedesRevision: number | null
  sensitivity: AgentMemorySensitivity
  retentionClass: AgentMemoryRetentionClass
  expiresAt: string | null
  promotionDecisionId: string
  promotionActorKind: 'human' | 'policy'
  promotionActorId: string
  promotionPolicyId: string
  promotionPolicyVersion: number
  promotionAuthorityDigest: string
  createdAt: string
}

export function parseAgentMemoryRetrievalRequest(value: unknown): AgentMemoryRetrievalRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['stateVersion', 'id', 'scope', 'runtimeId', 'limit', 'requestedAt']) ||
    value.stateVersion !== AGENT_MEMORY_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.runtimeId) ||
    !Number.isInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > AGENT_MEMORY_RETRIEVAL_LIMIT_MAX ||
    !isCanonicalIso(value.requestedAt)
  ) {
    failMemoryCandidate()
  }
  let scope: KnowledgeRetrievalScope
  try {
    scope = parseScope(value.scope)
  } catch {
    failMemoryCandidate()
  }
  return {
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: value.id,
    scope,
    runtimeId: value.runtimeId,
    limit: value.limit as number,
    requestedAt: value.requestedAt,
  }
}

export type KnowledgeRetrievalRequest = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  id: string
  scope: KnowledgeRetrievalScope
  target: KnowledgeRetrievalTarget
  knowledgeSnapshotHash: string
  query: {
    text: string
    categories: KnowledgeDocumentCategory[]
    tags: string[]
    topK: number
  }
  requestedAt: string
}

export class KnowledgeRetrievalContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'KnowledgeRetrievalContractError'
    this.code = code
  }
}

export class AgentMemoryContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AgentMemoryContractError'
    this.code = code
  }
}

function fail(): never {
  throw new KnowledgeRetrievalContractError('invalid_knowledge_retrieval_request')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= MAX_VERSION
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function failMemoryCandidate(): never {
  throw new AgentMemoryContractError('invalid_agent_memory_candidate')
}

export async function createAgentMemoryCandidate(input: unknown): Promise<AgentMemoryCandidate> {
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, [
      'id',
      'statement',
      'previousRuntime',
      'acceptedTransition',
      'createdAt',
    ]) ||
    !isIdentifier(input.id) ||
    typeof input.statement !== 'string' ||
    input.statement.length === 0 ||
    input.statement.trim() !== input.statement ||
    new TextEncoder().encode(input.statement).byteLength > AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES ||
    redactSensitiveText(input.statement).value !== input.statement ||
    !isCanonicalIso(input.createdAt)
  ) {
    failMemoryCandidate()
  }

  let previousRuntime: AgentRuntimeState
  try {
    previousRuntime = parseAgentRuntimeState(input.previousRuntime)
  } catch {
    failMemoryCandidate()
  }
  if (!isExactAgentRuntimeTransition(previousRuntime, input.acceptedTransition)) {
    failMemoryCandidate()
  }

  const transition = parseAgentRuntimeTransition(input.acceptedTransition)
  if (Date.parse(input.createdAt) < Date.parse(transition.runtime.updatedAt)) {
    failMemoryCandidate()
  }
  const resultEvents = transition.events.filter((event) => event.type === 'action_result')
  const observationEvents = transition.events.filter((event) => event.type === 'observation_recorded')
  const resultEvent = resultEvents[0]
  const observationEvent = observationEvents[0]
  if (
    resultEvents.length !== 1 ||
    observationEvents.length !== 1 ||
    resultEvent === undefined ||
    observationEvent === undefined ||
    resultEvent.metadata.actionId !== observationEvent.metadata.actionId ||
    resultEvent.metadata.resultDigest !== observationEvent.metadata.resultDigest
  ) {
    failMemoryCandidate()
  }

  const provenance: AgentMemoryCandidateProvenance = {
    kind: 'agent_observation',
    runtimeId: transition.runtime.id,
    actionId: String(observationEvent.metadata.actionId),
    checkpointVersion: observationEvent.checkpointVersion,
    sequence: observationEvent.sequence,
    resultDigest: String(observationEvent.metadata.resultDigest),
  }
  return parseAgentMemoryCandidate({
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: input.id,
    status: 'candidate',
    scope: { ...transition.runtime.scope },
    statement: input.statement,
    contentDigest: await sha256Hex(input.statement),
    provenance,
    provenanceDigest: await sha256Hex(JSON.stringify(provenance)),
    createdAt: input.createdAt,
  })
}

export async function parseAgentMemoryCandidate(value: unknown): Promise<AgentMemoryCandidate> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'status',
      'scope',
      'statement',
      'contentDigest',
      'provenance',
      'provenanceDigest',
      'createdAt',
    ]) ||
    value.stateVersion !== AGENT_MEMORY_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    value.status !== 'candidate' ||
    typeof value.statement !== 'string' ||
    value.statement.length === 0 ||
    value.statement.trim() !== value.statement ||
    new TextEncoder().encode(value.statement).byteLength > AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES ||
    redactSensitiveText(value.statement).value !== value.statement ||
    typeof value.contentDigest !== 'string' ||
    !digestPattern.test(value.contentDigest) ||
    typeof value.provenanceDigest !== 'string' ||
    !digestPattern.test(value.provenanceDigest) ||
    !isCanonicalIso(value.createdAt) ||
    !isPlainRecord(value.provenance) ||
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
    !isPositiveVersion(value.provenance.checkpointVersion) ||
    !isPositiveVersion(value.provenance.sequence) ||
    typeof value.provenance.resultDigest !== 'string' ||
    !digestPattern.test(value.provenance.resultDigest)
  ) {
    failMemoryCandidate()
  }

  let scope: KnowledgeRetrievalScope
  try {
    scope = parseScope(value.scope)
  } catch {
    failMemoryCandidate()
  }
  const provenance: AgentMemoryCandidateProvenance = {
    kind: 'agent_observation',
    runtimeId: value.provenance.runtimeId,
    actionId: value.provenance.actionId,
    checkpointVersion: value.provenance.checkpointVersion,
    sequence: value.provenance.sequence,
    resultDigest: value.provenance.resultDigest,
  }
  if (
    await sha256Hex(value.statement) !== value.contentDigest ||
    await sha256Hex(JSON.stringify(provenance)) !== value.provenanceDigest
  ) {
    failMemoryCandidate()
  }
  return {
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: value.id,
    status: 'candidate',
    scope,
    statement: value.statement,
    contentDigest: value.contentDigest,
    provenance,
    provenanceDigest: value.provenanceDigest,
    createdAt: value.createdAt,
  }
}

function parseMemoryPromotionAuthority(value: unknown): AgentMemoryPromotionAuthority {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'decisionId',
      'candidateId',
      'candidateContentDigest',
      'scope',
      'actorKind',
      'actorId',
      'policyId',
      'policyVersion',
      'visibility',
      'sensitivity',
      'retentionClass',
      'expiresAt',
      'authorityDigest',
      'decidedAt',
    ]) ||
    value.stateVersion !== AGENT_MEMORY_CONTRACT_VERSION ||
    !isIdentifier(value.decisionId) ||
    !isIdentifier(value.candidateId) ||
    typeof value.candidateContentDigest !== 'string' ||
    !digestPattern.test(value.candidateContentDigest) ||
    (value.actorKind !== 'human' && value.actorKind !== 'policy') ||
    !isIdentifier(value.actorId) ||
    !isIdentifier(value.policyId) ||
    !isPositiveVersion(value.policyVersion) ||
    !['runtime', 'user_project', 'project_shared'].includes(String(value.visibility)) ||
    !['private', 'internal'].includes(String(value.sensitivity)) ||
    !['session', 'thirty_days', 'until_deleted'].includes(String(value.retentionClass)) ||
    typeof value.authorityDigest !== 'string' ||
    !digestPattern.test(value.authorityDigest) ||
    !isCanonicalIso(value.decidedAt)
  ) {
    failMemoryCandidate()
  }
  let scope: KnowledgeRetrievalScope
  try {
    scope = parseScope(value.scope)
  } catch {
    failMemoryCandidate()
  }
  if (
    (value.retentionClass === 'until_deleted' && value.expiresAt !== null) ||
    (value.retentionClass !== 'until_deleted' &&
      (!isCanonicalIso(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.decidedAt))) ||
    (value.visibility === 'project_shared' && scope.kind !== 'team')
  ) {
    failMemoryCandidate()
  }
  return {
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    decisionId: value.decisionId,
    candidateId: value.candidateId,
    candidateContentDigest: value.candidateContentDigest,
    scope,
    actorKind: value.actorKind,
    actorId: value.actorId,
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    visibility: value.visibility as AgentMemoryVisibility,
    sensitivity: value.sensitivity as AgentMemorySensitivity,
    retentionClass: value.retentionClass as AgentMemoryRetentionClass,
    expiresAt: value.expiresAt as string | null,
    authorityDigest: value.authorityDigest,
    decidedAt: value.decidedAt,
  }
}

function parseMemoryRevisionAuthority(value: unknown): AgentMemoryRevisionAuthority {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'decisionId',
      'memoryId',
      'expectedRevision',
      'expectedContentDigest',
      'scope',
      'actorKind',
      'actorId',
      'policyId',
      'policyVersion',
      'visibility',
      'sensitivity',
      'retentionClass',
      'expiresAt',
      'authorityDigest',
      'decidedAt',
    ]) ||
    value.stateVersion !== AGENT_MEMORY_CONTRACT_VERSION ||
    !isIdentifier(value.decisionId) ||
    !isIdentifier(value.memoryId) ||
    !isPositiveVersion(value.expectedRevision) ||
    typeof value.expectedContentDigest !== 'string' ||
    !digestPattern.test(value.expectedContentDigest) ||
    (value.actorKind !== 'human' && value.actorKind !== 'policy') ||
    !isIdentifier(value.actorId) ||
    !isIdentifier(value.policyId) ||
    !isPositiveVersion(value.policyVersion) ||
    !['runtime', 'user_project', 'project_shared'].includes(String(value.visibility)) ||
    !['private', 'internal'].includes(String(value.sensitivity)) ||
    !['session', 'thirty_days', 'until_deleted'].includes(String(value.retentionClass)) ||
    typeof value.authorityDigest !== 'string' ||
    !digestPattern.test(value.authorityDigest) ||
    !isCanonicalIso(value.decidedAt)
  ) {
    failMemoryCandidate()
  }
  let scope: KnowledgeRetrievalScope
  try {
    scope = parseScope(value.scope)
  } catch {
    failMemoryCandidate()
  }
  if (
    (value.retentionClass === 'until_deleted' && value.expiresAt !== null) ||
    (value.retentionClass !== 'until_deleted' &&
      (!isCanonicalIso(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.decidedAt))) ||
    (value.visibility === 'project_shared' && scope.kind !== 'team')
  ) {
    failMemoryCandidate()
  }
  return {
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    decisionId: value.decisionId,
    memoryId: value.memoryId,
    expectedRevision: value.expectedRevision,
    expectedContentDigest: value.expectedContentDigest,
    scope,
    actorKind: value.actorKind,
    actorId: value.actorId,
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    visibility: value.visibility as AgentMemoryVisibility,
    sensitivity: value.sensitivity as AgentMemorySensitivity,
    retentionClass: value.retentionClass as AgentMemoryRetentionClass,
    expiresAt: value.expiresAt as string | null,
    authorityDigest: value.authorityDigest,
    decidedAt: value.decidedAt,
  }
}

export async function promoteAgentMemoryCandidate(input: unknown): Promise<DurableAgentMemoryRevision> {
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, ['candidate', 'memoryId', 'authority']) ||
    !isIdentifier(input.memoryId)
  ) {
    failMemoryCandidate()
  }
  const candidate = await parseAgentMemoryCandidate(input.candidate)
  const authority = parseMemoryPromotionAuthority(input.authority)
  if (
    authority.candidateId !== candidate.id ||
    authority.candidateContentDigest !== candidate.contentDigest ||
    JSON.stringify(authority.scope) !== JSON.stringify(candidate.scope) ||
    Date.parse(authority.decidedAt) < Date.parse(candidate.createdAt) ||
    (authority.actorKind === 'human' && authority.actorId !== candidate.scope.userId)
  ) {
    failMemoryCandidate()
  }
  return parseDurableAgentMemoryRevision({
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: input.memoryId,
    revision: 1,
    status: 'active',
    scope: { ...candidate.scope },
    visibility: authority.visibility,
    statement: candidate.statement,
    contentDigest: candidate.contentDigest,
    provenanceDigest: candidate.provenanceDigest,
    sourceCandidateId: candidate.id,
    supersedesRevision: null,
    sensitivity: authority.sensitivity,
    retentionClass: authority.retentionClass,
    expiresAt: authority.expiresAt,
    promotionDecisionId: authority.decisionId,
    promotionActorKind: authority.actorKind,
    promotionActorId: authority.actorId,
    promotionPolicyId: authority.policyId,
    promotionPolicyVersion: authority.policyVersion,
    promotionAuthorityDigest: authority.authorityDigest,
    createdAt: authority.decidedAt,
  })
}

export async function parseDurableAgentMemoryRevision(
  value: unknown,
): Promise<DurableAgentMemoryRevision> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'revision',
      'status',
      'scope',
      'visibility',
      'statement',
      'contentDigest',
      'provenanceDigest',
      'sourceCandidateId',
      'supersedesRevision',
      'sensitivity',
      'retentionClass',
      'expiresAt',
      'promotionDecisionId',
      'promotionActorKind',
      'promotionActorId',
      'promotionPolicyId',
      'promotionPolicyVersion',
      'promotionAuthorityDigest',
      'createdAt',
    ]) ||
    value.stateVersion !== AGENT_MEMORY_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    !isPositiveVersion(value.revision) ||
    (value.status !== 'active' && value.status !== 'conflict') ||
    typeof value.statement !== 'string' ||
    value.statement.length === 0 ||
    value.statement.trim() !== value.statement ||
    new TextEncoder().encode(value.statement).byteLength > AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES ||
    redactSensitiveText(value.statement).value !== value.statement ||
    typeof value.contentDigest !== 'string' ||
    !digestPattern.test(value.contentDigest) ||
    typeof value.provenanceDigest !== 'string' ||
    !digestPattern.test(value.provenanceDigest) ||
    !isIdentifier(value.sourceCandidateId) ||
    (value.revision === 1
      ? value.supersedesRevision !== null
      : value.supersedesRevision !== value.revision - 1) ||
    !isCanonicalIso(value.createdAt)
  ) {
    failMemoryCandidate()
  }
  let scope: KnowledgeRetrievalScope
  try {
    scope = parseScope(value.scope)
  } catch {
    failMemoryCandidate()
  }
  const authority = parseMemoryPromotionAuthority({
    stateVersion: value.stateVersion,
    decisionId: value.promotionDecisionId,
    candidateId: value.sourceCandidateId,
    candidateContentDigest: value.contentDigest,
    scope,
    actorKind: value.promotionActorKind,
    actorId: value.promotionActorId,
    policyId: value.promotionPolicyId,
    policyVersion: value.promotionPolicyVersion,
    visibility: value.visibility,
    sensitivity: value.sensitivity,
    retentionClass: value.retentionClass,
    expiresAt: value.expiresAt,
    authorityDigest: value.promotionAuthorityDigest,
    decidedAt: value.createdAt,
  })
  if (await sha256Hex(value.statement) !== value.contentDigest) {
    failMemoryCandidate()
  }
  return {
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: value.id,
    revision: value.revision,
    status: value.status,
    scope,
    visibility: authority.visibility,
    statement: value.statement,
    contentDigest: value.contentDigest,
    provenanceDigest: value.provenanceDigest,
    sourceCandidateId: value.sourceCandidateId,
    supersedesRevision: value.supersedesRevision as number | null,
    sensitivity: authority.sensitivity,
    retentionClass: authority.retentionClass,
    expiresAt: authority.expiresAt,
    promotionDecisionId: authority.decisionId,
    promotionActorKind: authority.actorKind,
    promotionActorId: authority.actorId,
    promotionPolicyId: authority.policyId,
    promotionPolicyVersion: authority.policyVersion,
    promotionAuthorityDigest: authority.authorityDigest,
    createdAt: value.createdAt,
  }
}

export async function reviseAgentMemoryRevision(input: unknown): Promise<DurableAgentMemoryRevision> {
  if (
    !isPlainRecord(input) ||
    !hasExactKeys(input, ['currentRevision', 'statement', 'authority']) ||
    typeof input.statement !== 'string'
  ) {
    failMemoryCandidate()
  }
  const current = await parseDurableAgentMemoryRevision(input.currentRevision)
  const authority = parseMemoryRevisionAuthority(input.authority)
  if (
    current.status !== 'active' ||
    current.revision >= 2_147_483_647 ||
    authority.memoryId !== current.id ||
    authority.expectedRevision !== current.revision ||
    authority.expectedContentDigest !== current.contentDigest ||
    JSON.stringify(authority.scope) !== JSON.stringify(current.scope) ||
    Date.parse(authority.decidedAt) <= Date.parse(current.createdAt) ||
    (authority.actorKind === 'human' && authority.actorId !== current.scope.userId)
  ) {
    failMemoryCandidate()
  }
  return parseDurableAgentMemoryRevision({
    stateVersion: AGENT_MEMORY_CONTRACT_VERSION,
    id: current.id,
    revision: current.revision + 1,
    status: 'active',
    scope: { ...current.scope },
    visibility: authority.visibility,
    statement: input.statement,
    contentDigest: await sha256Hex(input.statement),
    provenanceDigest: current.provenanceDigest,
    sourceCandidateId: current.sourceCandidateId,
    supersedesRevision: current.revision,
    sensitivity: authority.sensitivity,
    retentionClass: authority.retentionClass,
    expiresAt: authority.expiresAt,
    promotionDecisionId: authority.decisionId,
    promotionActorKind: authority.actorKind,
    promotionActorId: authority.actorId,
    promotionPolicyId: authority.policyId,
    promotionPolicyVersion: authority.policyVersion,
    promotionAuthorityDigest: authority.authorityDigest,
    createdAt: authority.decidedAt,
  })
}

function isSafeSourceRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('//')) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function isEmbeddingDescriptor(
  value: unknown,
): value is Exclude<KnowledgeRetrievalCandidateSet['embedding'], null> {
  return isPlainRecord(value) &&
    hasExactKeys(value, ['modelId', 'modelVersion', 'dimensions']) &&
    isIdentifier(value.modelId) &&
    isIdentifier(value.modelVersion) &&
    Number.isInteger(value.dimensions) &&
    Number(value.dimensions) > 0 &&
    Number(value.dimensions) <= KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX
}

function isMemoryEvaluationFixture(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const hasContent = value.status === 'active' || value.status === 'conflict'
  const expectedKeys = [
    'id',
    'organizationId',
    'projectId',
    'userId',
    'visibility',
    'revision',
    'status',
    ...(hasContent ? ['content'] : []),
    'contentHash',
    'provenanceDigest',
    'expiresAt',
  ]
  if (
    !hasExactKeys(value, expectedKeys) ||
    !isIdentifier(value.id) ||
    !isIdentifier(value.organizationId) ||
    !isIdentifier(value.projectId) ||
    !isIdentifier(value.userId) ||
    value.visibility !== 'user_project' ||
    !isPositiveVersion(value.revision) ||
    !['active', 'conflict', 'expired', 'deleted'].includes(String(value.status)) ||
    !isIdentifier(value.contentHash) ||
    typeof value.provenanceDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.provenanceDigest)
  ) return false

  if (hasContent) {
    return typeof value.content === 'string' &&
      value.content.length > 0 &&
      value.content.trim() === value.content &&
      value.expiresAt === null
  }
  if (value.status === 'expired') return isCanonicalIso(value.expiresAt)
  return value.status === 'deleted' && value.expiresAt === null
}

function isUniqueIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
}

function isEvaluationCorpusCase(value: unknown): value is Record<string, unknown> {
  if (
    !isPlainRecord(value) ||
    typeof value.category !== 'string' ||
    !requiredEvaluationCategories.has(value.category)
  ) return false

  const categoryFields: Record<string, string[]> = {
    citation: ['requiredCitationContentHashes'],
    citation_staleness: ['staleContentHashes'],
    memory_quality: ['memoryFixtureIds'],
    memory_conflict: ['memoryFixtureIds'],
    memory_expiry: ['memoryFixtureIds', 'expectedMemoryIds'],
    memory_deletion: ['memoryFixtureIds', 'expectedMemoryIds'],
    memory_isolation: ['memoryFixtureIds', 'expectedMemoryIds'],
  }
  const additionalFields = categoryFields[value.category] ?? []
  if (!hasExactKeys(value, [
    'id',
    'category',
    'scope',
    'query',
    'relevantChunkIds',
    'forbiddenChunkIds',
    'topK',
    ...additionalFields,
  ])) return false

  if (
    !isIdentifier(value.id) ||
    !isPlainRecord(value.scope) ||
    !hasExactKeys(value.scope, ['organizationId', 'projectId', 'userId', 'sessionId']) ||
    !isIdentifier(value.scope.organizationId) ||
    !isIdentifier(value.scope.projectId) ||
    !isIdentifier(value.scope.userId) ||
    !isIdentifier(value.scope.sessionId) ||
    typeof value.query !== 'string' ||
    value.query.length === 0 ||
    value.query.trim() !== value.query ||
    new TextEncoder().encode(value.query).byteLength > KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH ||
    !isUniqueIdentifierArray(value.relevantChunkIds) ||
    !isUniqueIdentifierArray(value.forbiddenChunkIds) ||
    (value.relevantChunkIds as string[]).some(
      (id) => (value.forbiddenChunkIds as string[]).includes(id),
    ) ||
    !Number.isInteger(value.topK) ||
    Number(value.topK) < 1 ||
    Number(value.topK) > KNOWLEDGE_RETRIEVAL_TOP_K_MAX
  ) return false

  return additionalFields.every((field) => isUniqueIdentifierArray(value[field]))
}

function parseScope(value: unknown): KnowledgeRetrievalScope {
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
  ) return value as KnowledgeRetrievalScope

  if (value.kind === 'local' && value.organizationId === null && value.projectId === null) {
    return value as KnowledgeRetrievalScope
  }

  fail()
}

function parseTarget(value: unknown): KnowledgeRetrievalTarget {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['runId', 'nodeId', 'runVersion']) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isPositiveVersion(value.runVersion)
  ) fail()
  return value as KnowledgeRetrievalTarget
}

function parseQuery(value: unknown): KnowledgeRetrievalRequest['query'] {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['text', 'categories', 'tags', 'topK']) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.trim() !== value.text ||
    new TextEncoder().encode(value.text).byteLength > KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH ||
    !Array.isArray(value.categories) ||
    value.categories.length > knowledgeCategories.size ||
    !value.categories.every((entry) => typeof entry === 'string' && knowledgeCategories.has(entry as KnowledgeDocumentCategory)) ||
    new Set(value.categories).size !== value.categories.length ||
    !Array.isArray(value.tags) ||
    value.tags.length > 32 ||
    !value.tags.every((entry) => typeof entry === 'string' && tagPattern.test(entry)) ||
    new Set(value.tags).size !== value.tags.length ||
    !Number.isInteger(value.topK) ||
    Number(value.topK) < 1 ||
    Number(value.topK) > KNOWLEDGE_RETRIEVAL_TOP_K_MAX
  ) fail()
  return value as KnowledgeRetrievalRequest['query']
}

export function parseKnowledgeRetrievalRequest(value: unknown): KnowledgeRetrievalRequest {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'scope',
      'target',
      'knowledgeSnapshotHash',
      'query',
      'requestedAt',
    ]) ||
    value.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    !isIdentifier(value.id) ||
    typeof value.knowledgeSnapshotHash !== 'string' ||
    !snapshotHashPattern.test(value.knowledgeSnapshotHash) ||
    !isCanonicalIso(value.requestedAt)
  ) fail()

  parseScope(value.scope)
  parseTarget(value.target)
  parseQuery(value.query)
  return value as KnowledgeRetrievalRequest
}

export type KnowledgeRetrievalCandidate = {
  documentId: string
  chunkId: string
  organizationId: string | null
  projectId: string | null
  localProjectId: string
  sourcePath: string
  headingPath: string[]
  contentHash: string
  score: number
  vectorDimensions: number | null
}

export type KnowledgeRetrievalCandidateSet = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  requestId: string
  scope: KnowledgeRetrievalScope
  knowledgeSnapshotHash: string
  strategy: 'lexical' | 'vector'
  embedding: null | {
    modelId: string
    modelVersion: string
    dimensions: number
  }
  candidates: KnowledgeRetrievalCandidate[]
  evaluatedAt: string
}

function scopesMatch(left: KnowledgeRetrievalScope, right: KnowledgeRetrievalScope): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
}

export function parseKnowledgeRetrievalCandidateSet(
  value: unknown,
  request: KnowledgeRetrievalRequest,
): KnowledgeRetrievalCandidateSet {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'scope',
      'knowledgeSnapshotHash',
      'strategy',
      'embedding',
      'candidates',
      'evaluatedAt',
    ]) ||
    value.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    value.requestId !== request.id ||
    value.knowledgeSnapshotHash !== request.knowledgeSnapshotHash ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > request.query.topK ||
    !isCanonicalIso(value.evaluatedAt)
  ) fail()

  let expectedVectorDimensions: number | null
  if (value.strategy === 'lexical' && value.embedding === null) {
    expectedVectorDimensions = null
  } else if (value.strategy === 'vector' && isEmbeddingDescriptor(value.embedding)) {
    expectedVectorDimensions = value.embedding.dimensions
  } else {
    fail()
  }

  const scope = parseScope(value.scope)
  if (!scopesMatch(scope, request.scope)) fail()

  if (!value.candidates.every((candidate) =>
    isPlainRecord(candidate) &&
    hasExactKeys(candidate, [
      'documentId',
      'chunkId',
      'organizationId',
      'projectId',
      'localProjectId',
      'sourcePath',
      'headingPath',
      'contentHash',
      'score',
      'vectorDimensions',
    ]) &&
    isIdentifier(candidate.documentId) &&
    isIdentifier(candidate.chunkId) &&
    candidate.organizationId === request.scope.organizationId &&
    candidate.projectId === request.scope.projectId &&
    candidate.localProjectId === request.scope.localProjectId &&
    isSafeSourceRelativePath(candidate.sourcePath) &&
    Array.isArray(candidate.headingPath) &&
    candidate.headingPath.length > 0 &&
    candidate.headingPath.every((heading) => typeof heading === 'string' && heading.length > 0) &&
    isIdentifier(candidate.contentHash) &&
    typeof candidate.score === 'number' &&
    Number.isFinite(candidate.score) &&
    candidate.score >= 0 &&
    candidate.score <= 1 &&
    candidate.vectorDimensions === expectedVectorDimensions
  )) fail()

  const candidateChunkIds = value.candidates.map(
    (candidate) => (candidate as Record<string, unknown>).chunkId as string,
  )
  if (new Set(candidateChunkIds).size !== candidateChunkIds.length) fail()

  return value as KnowledgeRetrievalCandidateSet
}

export type KnowledgeHybridRetrievalCandidate = Omit<
  KnowledgeRetrievalCandidate,
  'score' | 'vectorDimensions'
> & {
  score: number
  vectorDimensions: number
  lexicalRank: number | null
  vectorRank: number | null
  strategyChain: Array<'lexical' | 'vector' | 'hybrid'>
}

export type KnowledgeHybridRetrievalResult = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  requestId: string
  scope: KnowledgeRetrievalScope
  knowledgeSnapshotHash: string
  ranking: {
    contractId: 'reciprocal-rank-fusion'
    contractVersion: 1
    rankConstant: 60
  }
  embedding: Exclude<KnowledgeRetrievalCandidateSet['embedding'], null>
  candidates: KnowledgeHybridRetrievalCandidate[]
  evaluatedAt: string
}

function candidatesHaveSameIdentity(
  left: KnowledgeRetrievalCandidate,
  right: KnowledgeRetrievalCandidate,
): boolean {
  return left.documentId === right.documentId &&
    left.chunkId === right.chunkId &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.localProjectId === right.localProjectId &&
    left.sourcePath === right.sourcePath &&
    stringArraysMatch(left.headingPath, right.headingPath) &&
    left.contentHash === right.contentHash
}

export function mergeKnowledgeRetrievalCandidates(
  request: KnowledgeRetrievalRequest,
  lexicalCandidateSet: KnowledgeRetrievalCandidateSet,
  vectorCandidateSet: KnowledgeRetrievalCandidateSet,
): KnowledgeHybridRetrievalResult {
  parseKnowledgeRetrievalRequest(request)
  parseKnowledgeRetrievalCandidateSet(lexicalCandidateSet, request)
  parseKnowledgeRetrievalCandidateSet(vectorCandidateSet, request)
  if (
    lexicalCandidateSet.strategy !== 'lexical' ||
    lexicalCandidateSet.embedding !== null ||
    vectorCandidateSet.strategy !== 'vector' ||
    vectorCandidateSet.embedding === null
  ) fail()

  const rankConstant = 60
  const candidates = new Map<string, KnowledgeHybridRetrievalCandidate>()
  lexicalCandidateSet.candidates.forEach((candidate, index) => {
    candidates.set(candidate.chunkId, {
      ...candidate,
      score: 1 / (rankConstant + index + 1),
      vectorDimensions: vectorCandidateSet.embedding!.dimensions,
      lexicalRank: index + 1,
      vectorRank: null,
      strategyChain: ['lexical', 'hybrid'],
    })
  })
  vectorCandidateSet.candidates.forEach((candidate, index) => {
    const existing = candidates.get(candidate.chunkId)
    if (existing !== undefined) {
      if (!candidatesHaveSameIdentity(existing, candidate)) fail()
      candidates.set(candidate.chunkId, {
        ...existing,
        score: existing.score + (1 / (rankConstant + index + 1)),
        vectorRank: index + 1,
        strategyChain: ['lexical', 'vector', 'hybrid'],
      })
      return
    }
    candidates.set(candidate.chunkId, {
      ...candidate,
      score: 1 / (rankConstant + index + 1),
      vectorDimensions: vectorCandidateSet.embedding!.dimensions,
      lexicalRank: null,
      vectorRank: index + 1,
      strategyChain: ['vector', 'hybrid'],
    })
  })

  return {
    stateVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
    requestId: request.id,
    scope: request.scope,
    knowledgeSnapshotHash: request.knowledgeSnapshotHash,
    ranking: {
      contractId: 'reciprocal-rank-fusion',
      contractVersion: 1,
      rankConstant,
    },
    embedding: vectorCandidateSet.embedding,
    candidates: [...candidates.values()]
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, request.query.topK),
    evaluatedAt: lexicalCandidateSet.evaluatedAt > vectorCandidateSet.evaluatedAt
      ? lexicalCandidateSet.evaluatedAt
      : vectorCandidateSet.evaluatedAt,
  }
}

function expectedHybridStrategyChain(
  lexicalRank: number | null,
  vectorRank: number | null,
): KnowledgeHybridRetrievalCandidate['strategyChain'] | null {
  if (lexicalRank !== null && vectorRank !== null) return ['lexical', 'vector', 'hybrid']
  if (lexicalRank !== null) return ['lexical', 'hybrid']
  if (vectorRank !== null) return ['vector', 'hybrid']
  return null
}

function isOptionalCandidateRank(value: unknown): value is number | null {
  return value === null || isPositiveVersion(value)
}

export function parseKnowledgeHybridRetrievalResult(
  value: unknown,
  request: KnowledgeRetrievalRequest,
): KnowledgeHybridRetrievalResult {
  parseKnowledgeRetrievalRequest(request)
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'scope',
      'knowledgeSnapshotHash',
      'ranking',
      'embedding',
      'candidates',
      'evaluatedAt',
    ]) ||
    value.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    value.requestId !== request.id ||
    value.knowledgeSnapshotHash !== request.knowledgeSnapshotHash ||
    !isPlainRecord(value.ranking) ||
    !hasExactKeys(value.ranking, ['contractId', 'contractVersion', 'rankConstant']) ||
    value.ranking.contractId !== 'reciprocal-rank-fusion' ||
    value.ranking.contractVersion !== 1 ||
    value.ranking.rankConstant !== 60 ||
    !isEmbeddingDescriptor(value.embedding) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > request.query.topK ||
    !isCanonicalIso(value.evaluatedAt)
  ) fail()

  const scope = parseScope(value.scope)
  if (!scopesMatch(scope, request.scope)) fail()
  const embedding = value.embedding as Exclude<KnowledgeRetrievalCandidateSet['embedding'], null>
  if (!value.candidates.every((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, [
        'documentId',
        'chunkId',
        'organizationId',
        'projectId',
        'localProjectId',
        'sourcePath',
        'headingPath',
        'contentHash',
        'score',
        'vectorDimensions',
        'lexicalRank',
        'vectorRank',
        'strategyChain',
      ]) ||
      !isIdentifier(candidate.documentId) ||
      !isIdentifier(candidate.chunkId) ||
      candidate.organizationId !== request.scope.organizationId ||
      candidate.projectId !== request.scope.projectId ||
      candidate.localProjectId !== request.scope.localProjectId ||
      !isSafeSourceRelativePath(candidate.sourcePath) ||
      !Array.isArray(candidate.headingPath) ||
      candidate.headingPath.length === 0 ||
      !candidate.headingPath.every((heading) =>
        typeof heading === 'string' && heading.length > 0 && heading.trim() === heading
      ) ||
      !isIdentifier(candidate.contentHash) ||
      typeof candidate.score !== 'number' ||
      !Number.isFinite(candidate.score) ||
      candidate.score <= 0 ||
      candidate.vectorDimensions !== embedding.dimensions ||
      !isOptionalCandidateRank(candidate.lexicalRank) ||
      !isOptionalCandidateRank(candidate.vectorRank) ||
      !Array.isArray(candidate.strategyChain)
    ) return false
    const expectedChain = expectedHybridStrategyChain(
      candidate.lexicalRank,
      candidate.vectorRank,
    )
    return expectedChain !== null && stringArraysMatch(candidate.strategyChain, expectedChain)
  })) fail()

  const chunkIds = value.candidates.map(
    (candidate) => (candidate as Record<string, unknown>).chunkId as string,
  )
  if (new Set(chunkIds).size !== chunkIds.length) fail()
  return value as KnowledgeHybridRetrievalResult
}

export type KnowledgeRerankedRetrievalCandidate = Omit<
  KnowledgeHybridRetrievalCandidate,
  'score' | 'strategyChain'
> & {
  hybridScore: number
  score: number
  strategyChain: Array<'lexical' | 'vector' | 'hybrid' | 'reranked'>
}

export type KnowledgeRerankedRetrievalResult = Omit<
  KnowledgeHybridRetrievalResult,
  'candidates'
> & {
  reranking: {
    contractId: 'deterministic-fixture-reranker'
    contractVersion: 1
  }
  candidates: KnowledgeRerankedRetrievalCandidate[]
}

export function rerankKnowledgeRetrievalCandidates(
  request: KnowledgeRetrievalRequest,
  hybridResult: KnowledgeHybridRetrievalResult,
  scores: Array<{ chunkId: string; score: number }>,
): KnowledgeRerankedRetrievalResult {
  const parsedHybrid = parseKnowledgeHybridRetrievalResult(hybridResult, request)
  if (
    !Array.isArray(scores) ||
    scores.length !== parsedHybrid.candidates.length ||
    !scores.every((entry) =>
      isPlainRecord(entry) &&
      hasExactKeys(entry, ['chunkId', 'score']) &&
      isIdentifier(entry.chunkId) &&
      typeof entry.score === 'number' &&
      Number.isFinite(entry.score) &&
      entry.score >= 0 &&
      entry.score <= 1
    ) ||
    new Set(scores.map((entry) => entry.chunkId)).size !== scores.length
  ) fail()

  const scoreByChunkId = new Map(scores.map((entry) => [entry.chunkId, entry.score]))
  if (parsedHybrid.candidates.some((candidate) => !scoreByChunkId.has(candidate.chunkId))) fail()
  return {
    ...parsedHybrid,
    reranking: {
      contractId: 'deterministic-fixture-reranker',
      contractVersion: 1,
    },
    candidates: parsedHybrid.candidates
      .map((candidate) => ({
        ...candidate,
        hybridScore: candidate.score,
        score: scoreByChunkId.get(candidate.chunkId)!,
        strategyChain: [...candidate.strategyChain, 'reranked'] as
          KnowledgeRerankedRetrievalCandidate['strategyChain'],
      }))
      .sort((left, right) =>
        right.score - left.score ||
        right.hybridScore - left.hybridScore ||
        left.chunkId.localeCompare(right.chunkId)
      ),
  }
}

export function parseKnowledgeRerankedRetrievalResult(
  value: unknown,
  request: KnowledgeRetrievalRequest,
): KnowledgeRerankedRetrievalResult {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'requestId',
      'scope',
      'knowledgeSnapshotHash',
      'ranking',
      'embedding',
      'reranking',
      'candidates',
      'evaluatedAt',
    ]) ||
    !isPlainRecord(value.reranking) ||
    !hasExactKeys(value.reranking, ['contractId', 'contractVersion']) ||
    value.reranking.contractId !== 'deterministic-fixture-reranker' ||
    value.reranking.contractVersion !== 1 ||
    !Array.isArray(value.candidates)
  ) fail()

  const projectedCandidates = value.candidates.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, [
        'documentId',
        'chunkId',
        'organizationId',
        'projectId',
        'localProjectId',
        'sourcePath',
        'headingPath',
        'contentHash',
        'score',
        'vectorDimensions',
        'lexicalRank',
        'vectorRank',
        'hybridScore',
        'strategyChain',
      ]) ||
      typeof candidate.hybridScore !== 'number' ||
      !Number.isFinite(candidate.hybridScore) ||
      candidate.hybridScore <= 0 ||
      typeof candidate.score !== 'number' ||
      !Number.isFinite(candidate.score) ||
      candidate.score < 0 ||
      candidate.score > 1 ||
      !Array.isArray(candidate.strategyChain) ||
      candidate.strategyChain.at(-1) !== 'reranked'
    ) fail()
    const {
      hybridScore,
      score: _rerankerScore,
      strategyChain,
      ...identity
    } = candidate
    return {
      ...identity,
      score: hybridScore,
      strategyChain: strategyChain.slice(0, -1),
    }
  })
  parseKnowledgeHybridRetrievalResult({
    stateVersion: value.stateVersion,
    requestId: value.requestId,
    scope: value.scope,
    knowledgeSnapshotHash: value.knowledgeSnapshotHash,
    ranking: value.ranking,
    embedding: value.embedding,
    candidates: projectedCandidates,
    evaluatedAt: value.evaluatedAt,
  }, request)
  const rerankedCandidates = value.candidates as unknown as KnowledgeRerankedRetrievalCandidate[]
  if (rerankedCandidates.some((candidate, index) => {
    const previous = rerankedCandidates[index - 1]
    return previous !== undefined && (
      previous.score < candidate.score ||
      (previous.score === candidate.score && previous.hybridScore < candidate.hybridScore) ||
      (previous.score === candidate.score &&
        previous.hybridScore === candidate.hybridScore &&
        previous.chunkId.localeCompare(candidate.chunkId) > 0)
    )
  })) fail()
  return value as KnowledgeRerankedRetrievalResult
}

export type KnowledgeCitation = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  requestId: string
  scope: KnowledgeRetrievalScope
  knowledgeSnapshotHash: string
  documentId: string
  chunkId: string
  sourcePath: string
  headingPath: string[]
  contentHash: string
  strategyChain: Array<'lexical' | 'vector' | 'hybrid' | 'reranked'>
  rank: number
  score: number
  citedAt: string
}

export type KnowledgeSnapshotIdentitySet = {
  stateVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  scope: KnowledgeRetrievalScope
  knowledgeSnapshotHash: string
  chunks: Array<{
    documentId: string
    chunkId: string
    sourcePath: string
    headingPath: string[]
    contentHash: string
  }>
  refreshedAt: string
}

function stringArraysMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

export function parseKnowledgeCitation(
  value: unknown,
  request: KnowledgeRetrievalRequest,
  retrievalResult:
    | KnowledgeRetrievalCandidateSet
    | KnowledgeHybridRetrievalResult
    | KnowledgeRerankedRetrievalResult,
): KnowledgeCitation {
  const source = (() => {
    if ('reranking' in retrievalResult) {
      const parsed = parseKnowledgeRerankedRetrievalResult(retrievalResult, request)
      return {
        candidates: parsed.candidates,
        evaluatedAt: parsed.evaluatedAt,
        strategyChains: parsed.candidates.map((candidate) => candidate.strategyChain),
      }
    }
    if ('ranking' in retrievalResult) {
      const parsed = parseKnowledgeHybridRetrievalResult(retrievalResult, request)
      return {
        candidates: parsed.candidates,
        evaluatedAt: parsed.evaluatedAt,
        strategyChains: parsed.candidates.map((candidate) => candidate.strategyChain),
      }
    }
    const parsed = parseKnowledgeRetrievalCandidateSet(retrievalResult, request)
    return {
      candidates: parsed.candidates,
      evaluatedAt: parsed.evaluatedAt,
      strategyChains: parsed.candidates.map(() => [parsed.strategy]),
    }
  })()
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
    value.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    value.requestId !== request.id ||
    value.knowledgeSnapshotHash !== request.knowledgeSnapshotHash ||
    !Number.isInteger(value.rank) ||
    Number(value.rank) < 1 ||
    Number(value.rank) > source.candidates.length ||
    !isCanonicalIso(value.citedAt) ||
    Date.parse(value.citedAt) < Date.parse(source.evaluatedAt)
  ) fail()

  const scope = parseScope(value.scope)
  if (!scopesMatch(scope, request.scope)) fail()
  const candidateIndex = Number(value.rank) - 1
  const candidate = source.candidates[candidateIndex]
  if (
    candidate === undefined ||
    value.documentId !== candidate.documentId ||
    value.chunkId !== candidate.chunkId ||
    value.sourcePath !== candidate.sourcePath ||
    !Array.isArray(value.headingPath) ||
    !stringArraysMatch(value.headingPath, candidate.headingPath) ||
    value.contentHash !== candidate.contentHash ||
    !Array.isArray(value.strategyChain) ||
    !stringArraysMatch(value.strategyChain, source.strategyChains[candidateIndex] ?? []) ||
    value.score !== candidate.score
  ) fail()

  return value as KnowledgeCitation
}

export function parseCurrentKnowledgeCitation(
  value: unknown,
  request: KnowledgeRetrievalRequest,
  retrievalResult:
    | KnowledgeRetrievalCandidateSet
    | KnowledgeHybridRetrievalResult
    | KnowledgeRerankedRetrievalResult,
  currentSnapshot: unknown,
): KnowledgeCitation {
  const citation = parseKnowledgeCitation(value, request, retrievalResult)
  if (
    !isPlainRecord(currentSnapshot) ||
    !hasExactKeys(currentSnapshot, [
      'stateVersion',
      'scope',
      'knowledgeSnapshotHash',
      'chunks',
      'refreshedAt',
    ]) ||
    currentSnapshot.stateVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    typeof currentSnapshot.knowledgeSnapshotHash !== 'string' ||
    !snapshotHashPattern.test(currentSnapshot.knowledgeSnapshotHash) ||
    currentSnapshot.knowledgeSnapshotHash !== citation.knowledgeSnapshotHash ||
    !isCanonicalIso(currentSnapshot.refreshedAt) ||
    !Array.isArray(currentSnapshot.chunks)
  ) fail()

  const scope = parseScope(currentSnapshot.scope)
  if (!scopesMatch(scope, request.scope)) fail()
  const chunks = currentSnapshot.chunks.map((chunk) => {
    if (
      !isPlainRecord(chunk) ||
      !hasExactKeys(chunk, [
        'documentId',
        'chunkId',
        'sourcePath',
        'headingPath',
        'contentHash',
      ]) ||
      !isIdentifier(chunk.documentId) ||
      !isIdentifier(chunk.chunkId) ||
      !isSafeSourceRelativePath(chunk.sourcePath) ||
      !Array.isArray(chunk.headingPath) ||
      chunk.headingPath.length === 0 ||
      !chunk.headingPath.every((heading) =>
        typeof heading === 'string' && heading.length > 0 && heading.trim() === heading
      ) ||
      !isIdentifier(chunk.contentHash)
    ) fail()
    return chunk
  })
  if (new Set(chunks.map((chunk) => chunk.chunkId)).size !== chunks.length) fail()

  const currentChunk = chunks.find((chunk) =>
    chunk.documentId === citation.documentId && chunk.chunkId === citation.chunkId
  )
  if (
    currentChunk === undefined ||
    currentChunk.sourcePath !== citation.sourcePath ||
    !stringArraysMatch(currentChunk.headingPath as string[], citation.headingPath) ||
    currentChunk.contentHash !== citation.contentHash
  ) fail()
  return citation
}

export type RetrievalMemoryEvaluationCorpus = {
  schemaVersion: 1
  corpusId: 'v2.1-evaluated-retrieval-memory'
  corpusVersion: 1
  retrievalContractVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  memoryContractVersion: 1
  defaultNoCost: true
  metricThresholds: {
    topK: 3
    hybridRecallAtKMin: 1
    hybridNdcgAtKMin: 0.8
    hybridMeanReciprocalRankMin: 0.8
    minimumAggregateImprovementOverLexical: 0.1
    citationPrecisionMin: 1
    citationFaithfulnessMin: 1
    maxIsolationViolations: 0
    paidProviderCalls: 0
  }
  documents: Array<Record<string, unknown>>
  memoryFixtures: Array<Record<string, unknown>>
  cases: Array<Record<string, unknown>>
}

export function parseRetrievalMemoryEvaluationCorpus(
  value: unknown,
): RetrievalMemoryEvaluationCorpus {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'corpusId',
      'corpusVersion',
      'retrievalContractVersion',
      'memoryContractVersion',
      'defaultNoCost',
      'metricThresholds',
      'documents',
      'memoryFixtures',
      'cases',
    ]) ||
    value.schemaVersion !== 1 ||
    value.corpusId !== 'v2.1-evaluated-retrieval-memory' ||
    value.corpusVersion !== 1 ||
    value.retrievalContractVersion !== KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION ||
    value.memoryContractVersion !== 1 ||
    value.defaultNoCost !== true ||
    !isPlainRecord(value.metricThresholds) ||
    !hasExactKeys(value.metricThresholds, metricThresholdKeys) ||
    value.metricThresholds.topK !== 3 ||
    value.metricThresholds.hybridRecallAtKMin !== 1 ||
    value.metricThresholds.hybridNdcgAtKMin !== 0.8 ||
    value.metricThresholds.hybridMeanReciprocalRankMin !== 0.8 ||
    value.metricThresholds.minimumAggregateImprovementOverLexical !== 0.1 ||
    value.metricThresholds.citationPrecisionMin !== 1 ||
    value.metricThresholds.citationFaithfulnessMin !== 1 ||
    value.metricThresholds.maxIsolationViolations !== 0 ||
    value.metricThresholds.paidProviderCalls !== 0 ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    !Array.isArray(value.memoryFixtures) ||
    value.memoryFixtures.length === 0 ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0
  ) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  if (!value.cases.every(isEvaluationCorpusCase)) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  const evaluationCategories = new Set(
    value.cases.map((entry) => entry.category as string),
  )
  if ([...requiredEvaluationCategories].some((category) => !evaluationCategories.has(category))) {
    throw new KnowledgeRetrievalContractError('incomplete_retrieval_memory_evaluation_corpus')
  }

  if (
    !value.cases.every((entry) => isPlainRecord(entry) && isIdentifier(entry.id)) ||
    new Set(value.cases.map((entry) => entry.id)).size !== value.cases.length
  ) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  if (
    !value.documents.every(
      (entry) => isPlainRecord(entry) &&
        hasExactKeys(entry, [
          'documentId',
          'organizationId',
          'projectId',
          'sourcePath',
          'chunks',
        ]) &&
        isIdentifier(entry.documentId) &&
        isIdentifier(entry.organizationId) &&
        isIdentifier(entry.projectId) &&
        isSafeSourceRelativePath(entry.sourcePath) &&
        Array.isArray(entry.chunks) &&
        entry.chunks.length > 0,
    )
  ) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  const chunks = value.documents.flatMap((entry) => entry.chunks as unknown[])
  if (!chunks.every((chunk) =>
    isPlainRecord(chunk) &&
    hasExactKeys(chunk, ['chunkId', 'headingPath', 'contentHash', 'content']) &&
    isIdentifier(chunk.chunkId) &&
    Array.isArray(chunk.headingPath) &&
    chunk.headingPath.length > 0 &&
    chunk.headingPath.every((heading) =>
      typeof heading === 'string' && heading.length > 0 && heading.trim() === heading
    ) &&
    isIdentifier(chunk.contentHash) &&
    typeof chunk.content === 'string' &&
    chunk.content.length > 0 &&
    chunk.content.trim() === chunk.content
  )) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }
  const chunkIds = chunks.map((chunk) => (chunk as Record<string, unknown>).chunkId as string)
  if (new Set(chunkIds).size !== chunkIds.length) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  if (!value.memoryFixtures.every(isMemoryEvaluationFixture)) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }
  const memoryFixtureIds = value.memoryFixtures.map((fixture) => fixture.id as string)
  if (new Set(memoryFixtureIds).size !== memoryFixtureIds.length) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  const knownChunkIds = new Set(chunkIds)
  const knownContentHashes = new Set(
    chunks.map((chunk) => (chunk as Record<string, unknown>).contentHash as string),
  )
  const knownMemoryFixtureIds = new Set(memoryFixtureIds)
  if (value.cases.some((evaluationCase) => {
    const referencedChunkIds = [
      ...(evaluationCase.relevantChunkIds as string[]),
      ...(evaluationCase.forbiddenChunkIds as string[]),
    ]
    return referencedChunkIds.some((id) => !knownChunkIds.has(id)) ||
      ('requiredCitationContentHashes' in evaluationCase &&
        (evaluationCase.requiredCitationContentHashes as string[])
          .some((hash) => !knownContentHashes.has(hash))) ||
      ('memoryFixtureIds' in evaluationCase &&
        (evaluationCase.memoryFixtureIds as string[])
          .some((id) => !knownMemoryFixtureIds.has(id))) ||
      ('expectedMemoryIds' in evaluationCase &&
        (evaluationCase.expectedMemoryIds as string[])
          .some((id) => !knownMemoryFixtureIds.has(id)))
  })) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }

  return value as RetrievalMemoryEvaluationCorpus
}

export type LexicalRetrievalBaseline = {
  contractVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  corpusId: RetrievalMemoryEvaluationCorpus['corpusId']
  corpusVersion: 1
  strategy: 'lexical'
  evaluatedCaseCount: number
  recallAtK: number
  ndcgAtK: number
  meanReciprocalRank: number
  isolationViolations: number
  paidProviderCalls: 0
  observations: Array<{
    caseId: string
    rankedChunkIds: string[]
    forbiddenHitIds: string[]
  }>
}

type LexicalEvaluationChunk = {
  documentId: string
  chunkId: string
  organizationId: string
  projectId: string
  sourcePath: string
  headingPath: string[]
  contentHash: string
  content: string
}

type LexicalEvaluationDocument = {
  documentId: string
  organizationId: string
  projectId: string
  sourcePath: string
  chunks: LexicalEvaluationChunk[]
}

type LexicalEvaluationCase = {
  id: string
  category: 'retrieval_baseline' | 'hybrid_improvement' | 'tenant_isolation'
  scope: {
    organizationId: string
    projectId: string
    userId: string
    sessionId: string
  }
  query: string
  relevantChunkIds: string[]
  forbiddenChunkIds: string[]
  topK: number
}

function tokenizeLexicalText(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [])
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function evaluateRanking(
  rankedChunkIds: readonly string[],
  relevantChunkIds: readonly string[],
): { recall: number; ndcg: number; reciprocalRank: number } {
  const relevant = new Set(relevantChunkIds)
  const matched = rankedChunkIds.filter((chunkId) => relevant.has(chunkId))
  const recall = relevant.size === 0 ? 0 : matched.length / relevant.size
  const dcg = rankedChunkIds.reduce(
    (score, chunkId, index) => score + (relevant.has(chunkId) ? 1 / Math.log2(index + 2) : 0),
    0,
  )
  const idealCount = Math.min(relevant.size, rankedChunkIds.length)
  const idealDcg = Array.from(
    { length: idealCount },
    (_entry, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, value) => sum + value, 0)
  const firstRelevantIndex = rankedChunkIds.findIndex((chunkId) => relevant.has(chunkId))
  return {
    recall,
    ndcg: idealDcg === 0 ? 0 : dcg / idealDcg,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
  }
}

function parseLexicalEvaluationDocuments(
  documents: Array<Record<string, unknown>>,
): LexicalEvaluationDocument[] {
  if (!documents.every((document) =>
    isIdentifier(document.organizationId) &&
    isIdentifier(document.projectId) &&
    Array.isArray(document.chunks) &&
    document.chunks.every((chunk) =>
      isPlainRecord(chunk) &&
      isIdentifier(chunk.chunkId) &&
      typeof chunk.content === 'string' &&
      chunk.content.length > 0
    )
  )) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }
  return documents as unknown as LexicalEvaluationDocument[]
}

function parseLexicalEvaluationCases(
  cases: Array<Record<string, unknown>>,
): LexicalEvaluationCase[] {
  const selected = cases.filter((entry) =>
    entry.category === 'retrieval_baseline' ||
    entry.category === 'hybrid_improvement' ||
    entry.category === 'tenant_isolation'
  )
  if (!selected.every((entry) =>
    isIdentifier(entry.id) &&
    isPlainRecord(entry.scope) &&
    hasExactKeys(entry.scope, ['organizationId', 'projectId', 'userId', 'sessionId']) &&
    isIdentifier(entry.scope.organizationId) &&
    isIdentifier(entry.scope.projectId) &&
    isIdentifier(entry.scope.userId) &&
    isIdentifier(entry.scope.sessionId) &&
    typeof entry.query === 'string' &&
    entry.query.length > 0 &&
    entry.query.trim() === entry.query &&
    Array.isArray(entry.relevantChunkIds) &&
    entry.relevantChunkIds.every(isIdentifier) &&
    Array.isArray(entry.forbiddenChunkIds) &&
    entry.forbiddenChunkIds.every(isIdentifier) &&
    Number.isInteger(entry.topK) &&
    Number(entry.topK) > 0 &&
    Number(entry.topK) <= KNOWLEDGE_RETRIEVAL_TOP_K_MAX
  )) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }
  return selected as unknown as LexicalEvaluationCase[]
}

export function evaluateLexicalRetrievalBaseline(value: unknown): LexicalRetrievalBaseline {
  const corpus = parseRetrievalMemoryEvaluationCorpus(value)
  const documents = parseLexicalEvaluationDocuments(corpus.documents)
  const cases = parseLexicalEvaluationCases(corpus.cases)
  const observations = cases.map((evaluationCase) => {
    const queryTokens = tokenizeLexicalText(evaluationCase.query)
    const rankedChunkIds = documents
      .filter((document) =>
        document.organizationId === evaluationCase.scope.organizationId &&
        document.projectId === evaluationCase.scope.projectId
      )
      .flatMap((document) => document.chunks)
      .map((chunk) => {
        const chunkTokens = tokenizeLexicalText(chunk.content)
        const matchingTokenCount = [...queryTokens]
          .filter((token) => chunkTokens.has(token)).length
        return {
          chunkId: chunk.chunkId,
          score: queryTokens.size === 0 ? 0 : matchingTokenCount / queryTokens.size,
        }
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, evaluationCase.topK)
      .map((candidate) => candidate.chunkId)
    const forbidden = new Set(evaluationCase.forbiddenChunkIds)
    return {
      caseId: evaluationCase.id,
      rankedChunkIds,
      forbiddenHitIds: rankedChunkIds.filter((chunkId) => forbidden.has(chunkId)),
    }
  })
  const qualityCases = cases.filter((evaluationCase) =>
    evaluationCase.category === 'retrieval_baseline' ||
    evaluationCase.category === 'hybrid_improvement'
  )
  const qualityMetrics = qualityCases.map((evaluationCase) => {
    const observation = observations.find((entry) => entry.caseId === evaluationCase.id)
    if (observation === undefined) {
      throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
    }
    return evaluateRanking(observation.rankedChunkIds, evaluationCase.relevantChunkIds)
  })
  return {
    contractVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    strategy: 'lexical',
    evaluatedCaseCount: qualityCases.length,
    recallAtK: average(qualityMetrics.map((entry) => entry.recall)),
    ndcgAtK: average(qualityMetrics.map((entry) => entry.ndcg)),
    meanReciprocalRank: average(qualityMetrics.map((entry) => entry.reciprocalRank)),
    isolationViolations: observations.reduce(
      (sum, observation) => sum + observation.forbiddenHitIds.length,
      0,
    ),
    paidProviderCalls: 0,
    observations,
  }
}

export type HybridRetrievalEvaluation = {
  contractVersion: typeof KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION
  corpusId: RetrievalMemoryEvaluationCorpus['corpusId']
  corpusVersion: 1
  strategy: 'hybrid-reranked'
  embedding: {
    modelId: 'fixture-embedding'
    modelVersion: '1'
    dimensions: 3
  }
  rankingContractVersion: 1
  rerankingContractVersion: 1
  evaluatedCaseCount: number
  citationCaseCount: number
  recallAtK: number
  ndcgAtK: number
  meanReciprocalRank: number
  aggregateImprovementOverLexical: number
  citationPrecision: number
  citationFaithfulness: number
  isolationViolations: number
  paidProviderCalls: 0
  observations: Array<{
    caseId: string
    rankedChunkIds: string[]
    forbiddenHitIds: string[]
    citationOutcome: 'accepted' | 'stale_rejected' | null
  }>
}

type FixtureVector = readonly [number, number, number]

const fixtureChunkVectors: Readonly<Record<string, FixtureVector>> = {
  'chunk-api-health-contract': [1, 0, 0],
  'chunk-api-health-test': [0, 1, 0],
  'chunk-delivery-non-force': [0, 0, 1],
}

const fixtureQueryVectors: Readonly<Record<string, FixtureVector>> = {
  'lexical-health-baseline': [1, 1, 0],
  'semantic-outage-recall': [0, 1, 0],
  'citation-current-hash': [0, 0, 1],
  'citation-stale-hash-rejected': [0, 0, 1],
  'cross-tenant-retrieval-isolation': [1, 0, 0],
}

const fixtureRerankerScores: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'lexical-health-baseline': {
    'chunk-api-health-contract': 1,
    'chunk-api-health-test': 0.95,
  },
  'semantic-outage-recall': {
    'chunk-api-health-contract': 0.2,
    'chunk-api-health-test': 1,
  },
  'citation-current-hash': {
    'chunk-delivery-non-force': 1,
  },
  'citation-stale-hash-rejected': {
    'chunk-api-health-test': 0.2,
    'chunk-delivery-non-force': 1,
  },
  'cross-tenant-retrieval-isolation': {
    'chunk-api-health-contract': 1,
  },
}

type HybridEvaluationCase = Omit<LexicalEvaluationCase, 'category'> & {
  category:
    | LexicalEvaluationCase['category']
    | 'citation'
    | 'citation_staleness'
  requiredCitationContentHashes?: string[]
  staleContentHashes?: string[]
}

function fixtureCosineSimilarity(left: FixtureVector, right: FixtureVector): number {
  const dot = left.reduce((sum, value, index) => sum + (value * right[index]!), 0)
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + (value * value), 0))
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + (value * value), 0))
  return dot / (leftMagnitude * rightMagnitude)
}

function evaluationCandidate(
  chunk: LexicalEvaluationChunk,
  localProjectId: string,
  score: number,
  vectorDimensions: number | null,
): KnowledgeRetrievalCandidate {
  return {
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    organizationId: chunk.organizationId,
    projectId: chunk.projectId,
    localProjectId,
    sourcePath: chunk.sourcePath,
    headingPath: chunk.headingPath,
    contentHash: chunk.contentHash,
    score,
    vectorDimensions,
  }
}

function parseHybridEvaluationCases(cases: Array<Record<string, unknown>>): HybridEvaluationCase[] {
  const selected = cases.filter((entry) => [
    'retrieval_baseline',
    'hybrid_improvement',
    'citation',
    'citation_staleness',
    'tenant_isolation',
  ].includes(String(entry.category)))
  if (selected.length !== 5) {
    throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
  }
  return selected as unknown as HybridEvaluationCase[]
}

export function evaluateHybridRetrievalCandidate(value: unknown): HybridRetrievalEvaluation {
  const corpus = parseRetrievalMemoryEvaluationCorpus(value)
  const documents = parseLexicalEvaluationDocuments(corpus.documents)
  const evaluationCases = parseHybridEvaluationCases(corpus.cases)
  const lexicalBaseline = evaluateLexicalRetrievalBaseline(corpus)
  const retrievals = evaluationCases.map((evaluationCase) => {
    const localProjectId = `fixture-${evaluationCase.scope.projectId}`
    const request: KnowledgeRetrievalRequest = {
      stateVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
      id: `evaluation-${evaluationCase.id}`,
      scope: {
        kind: 'team',
        ...evaluationCase.scope,
        localProjectId,
      },
      target: {
        runId: 'evaluation-run',
        nodeId: 'evaluation-node',
        runVersion: 1,
      },
      knowledgeSnapshotHash: `sha256:${'1'.repeat(64)}`,
      query: {
        text: evaluationCase.query,
        categories: [],
        tags: [],
        topK: evaluationCase.topK,
      },
      requestedAt: '2026-08-13T08:00:00.000Z',
    }
    parseKnowledgeRetrievalRequest(request)
    const scopedChunks = documents
      .filter((document) =>
        document.organizationId === evaluationCase.scope.organizationId &&
        document.projectId === evaluationCase.scope.projectId
      )
      .flatMap((document) => document.chunks.map((chunk) => ({
        ...chunk,
        documentId: document.documentId,
        organizationId: document.organizationId,
        projectId: document.projectId,
        sourcePath: document.sourcePath,
      })))
    const queryTokens = tokenizeLexicalText(evaluationCase.query)
    const lexicalCandidates = scopedChunks
      .map((chunk) => {
        const chunkTokens = tokenizeLexicalText(chunk.content)
        const matchingTokenCount = [...queryTokens]
          .filter((token) => chunkTokens.has(token)).length
        return {
          chunk,
          score: queryTokens.size === 0 ? 0 : matchingTokenCount / queryTokens.size,
        }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId)
      )
      .slice(0, evaluationCase.topK)
      .map((entry) => evaluationCandidate(entry.chunk, localProjectId, entry.score, null))
    const queryVector = fixtureQueryVectors[evaluationCase.id]
    const rerankerScores = fixtureRerankerScores[evaluationCase.id]
    if (queryVector === undefined || rerankerScores === undefined) {
      throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
    }
    const vectorCandidates = scopedChunks
      .map((chunk) => {
        const chunkVector = fixtureChunkVectors[chunk.chunkId]
        if (chunkVector === undefined) {
          throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
        }
        return { chunk, score: fixtureCosineSimilarity(queryVector, chunkVector) }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId)
      )
      .slice(0, evaluationCase.topK)
      .map((entry) => evaluationCandidate(entry.chunk, localProjectId, entry.score, 3))
    const lexicalSet: KnowledgeRetrievalCandidateSet = {
      stateVersion: 1,
      requestId: request.id,
      scope: request.scope,
      knowledgeSnapshotHash: request.knowledgeSnapshotHash,
      strategy: 'lexical',
      embedding: null,
      candidates: lexicalCandidates,
      evaluatedAt: '2026-08-13T08:00:01.000Z',
    }
    const vectorSet: KnowledgeRetrievalCandidateSet = {
      stateVersion: 1,
      requestId: request.id,
      scope: request.scope,
      knowledgeSnapshotHash: request.knowledgeSnapshotHash,
      strategy: 'vector',
      embedding: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
      },
      candidates: vectorCandidates,
      evaluatedAt: '2026-08-13T08:00:02.000Z',
    }
    const hybrid = mergeKnowledgeRetrievalCandidates(request, lexicalSet, vectorSet)
    const scores = hybrid.candidates.map((candidate) => {
      const score = rerankerScores[candidate.chunkId]
      if (score === undefined) {
        throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
      }
      return { chunkId: candidate.chunkId, score }
    })
    return {
      evaluationCase,
      request,
      result: rerankKnowledgeRetrievalCandidates(request, hybrid, scores),
    }
  })

  let acceptedCitationCount = 0
  let faithfulCitationCount = 0
  let rejectedStaleCitationCount = 0
  const observations = retrievals.map(({ evaluationCase, request, result }) => {
    const rankedChunkIds = result.candidates.map((candidate) => candidate.chunkId)
    const forbidden = new Set(evaluationCase.forbiddenChunkIds)
    let citationOutcome: HybridRetrievalEvaluation['observations'][number]['citationOutcome'] = null
    if (evaluationCase.category === 'citation') {
      const candidate = result.candidates[0]
      if (candidate === undefined) {
        throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
      }
      const citation: KnowledgeCitation = {
        stateVersion: 1,
        requestId: request.id,
        scope: request.scope,
        knowledgeSnapshotHash: request.knowledgeSnapshotHash,
        documentId: candidate.documentId,
        chunkId: candidate.chunkId,
        sourcePath: candidate.sourcePath,
        headingPath: candidate.headingPath,
        contentHash: candidate.contentHash,
        strategyChain: candidate.strategyChain,
        rank: 1,
        score: candidate.score,
        citedAt: '2026-08-13T08:00:03.000Z',
      }
      parseKnowledgeCitation(citation, request, result)
      acceptedCitationCount += 1
      if (evaluationCase.requiredCitationContentHashes?.includes(candidate.contentHash)) {
        faithfulCitationCount += 1
      }
      citationOutcome = 'accepted'
    } else if (evaluationCase.category === 'citation_staleness') {
      const candidate = result.candidates[0]
      const staleContentHash = evaluationCase.staleContentHashes?.[0]
      if (candidate === undefined || staleContentHash === undefined) {
        throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
      }
      try {
        parseKnowledgeCitation({
          stateVersion: 1,
          requestId: request.id,
          scope: request.scope,
          knowledgeSnapshotHash: request.knowledgeSnapshotHash,
          documentId: candidate.documentId,
          chunkId: candidate.chunkId,
          sourcePath: candidate.sourcePath,
          headingPath: candidate.headingPath,
          contentHash: staleContentHash,
          strategyChain: candidate.strategyChain,
          rank: 1,
          score: candidate.score,
          citedAt: '2026-08-13T08:00:03.000Z',
        }, request, result)
      } catch (error) {
        if (
          error instanceof KnowledgeRetrievalContractError &&
          error.code === 'invalid_knowledge_retrieval_request'
        ) {
          rejectedStaleCitationCount += 1
          citationOutcome = 'stale_rejected'
        } else {
          throw error
        }
      }
      if (citationOutcome !== 'stale_rejected') {
        throw new KnowledgeRetrievalContractError('invalid_retrieval_memory_evaluation_corpus')
      }
    }
    return {
      caseId: evaluationCase.id,
      rankedChunkIds,
      forbiddenHitIds: rankedChunkIds.filter((chunkId) => forbidden.has(chunkId)),
      citationOutcome,
    }
  })
  const qualityRetrievals = retrievals.filter(({ evaluationCase }) =>
    evaluationCase.category === 'retrieval_baseline' ||
    evaluationCase.category === 'hybrid_improvement'
  )
  const qualityMetrics = qualityRetrievals.map(({ evaluationCase, result }) =>
    evaluateRanking(
      result.candidates.map((candidate) => candidate.chunkId),
      evaluationCase.relevantChunkIds,
    )
  )
  const recallAtK = average(qualityMetrics.map((entry) => entry.recall))
  const ndcgAtK = average(qualityMetrics.map((entry) => entry.ndcg))
  const meanReciprocalRank = average(qualityMetrics.map((entry) => entry.reciprocalRank))
  const lexicalAggregate = average([
    lexicalBaseline.recallAtK,
    lexicalBaseline.ndcgAtK,
    lexicalBaseline.meanReciprocalRank,
  ])
  const hybridAggregate = average([recallAtK, ndcgAtK, meanReciprocalRank])
  const citationCaseCount = acceptedCitationCount + rejectedStaleCitationCount
  return {
    contractVersion: KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    strategy: 'hybrid-reranked',
    embedding: {
      modelId: 'fixture-embedding',
      modelVersion: '1',
      dimensions: 3,
    },
    rankingContractVersion: 1,
    rerankingContractVersion: 1,
    evaluatedCaseCount: qualityRetrievals.length,
    citationCaseCount,
    recallAtK,
    ndcgAtK,
    meanReciprocalRank,
    aggregateImprovementOverLexical: hybridAggregate - lexicalAggregate,
    citationPrecision: citationCaseCount === 0
      ? 0
      : (acceptedCitationCount + rejectedStaleCitationCount) / citationCaseCount,
    citationFaithfulness: acceptedCitationCount === 0
      ? 0
      : faithfulCitationCount / acceptedCitationCount,
    isolationViolations: observations
      .filter((observation) => {
        const evaluationCase = evaluationCases.find((entry) => entry.id === observation.caseId)
        return evaluationCase?.category === 'tenant_isolation'
      })
      .reduce((sum, observation) => sum + observation.forbiddenHitIds.length, 0),
    paidProviderCalls: 0,
    observations,
  }
}
