import type { KnowledgeDocumentCategory } from './domain'

export const KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION = 1 as const
export const KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH = 8 * 1_024
export const KNOWLEDGE_RETRIEVAL_TOP_K_MAX = 20
export const KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX = 16_384

const MAX_VERSION = 2_147_483_647
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
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

function stringArraysMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

export function parseKnowledgeCitation(
  value: unknown,
  request: KnowledgeRetrievalRequest,
  candidateSet: KnowledgeRetrievalCandidateSet,
): KnowledgeCitation {
  parseKnowledgeRetrievalCandidateSet(candidateSet, request)
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
    Number(value.rank) > candidateSet.candidates.length ||
    !isCanonicalIso(value.citedAt) ||
    Date.parse(value.citedAt) < Date.parse(candidateSet.evaluatedAt)
  ) fail()

  const scope = parseScope(value.scope)
  if (!scopesMatch(scope, request.scope)) fail()
  const candidate = candidateSet.candidates[Number(value.rank) - 1]
  if (
    candidate === undefined ||
    value.documentId !== candidate.documentId ||
    value.chunkId !== candidate.chunkId ||
    value.sourcePath !== candidate.sourcePath ||
    !Array.isArray(value.headingPath) ||
    !stringArraysMatch(value.headingPath, candidate.headingPath) ||
    value.contentHash !== candidate.contentHash ||
    !Array.isArray(value.strategyChain) ||
    !stringArraysMatch(value.strategyChain, [candidateSet.strategy]) ||
    value.score !== candidate.score
  ) fail()

  return value as KnowledgeCitation
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
  chunkId: string
  content: string
}

type LexicalEvaluationDocument = {
  organizationId: string
  projectId: string
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
