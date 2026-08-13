import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  acceptAgentActionResult,
  createAgentRuntime,
  requestAgentAction,
  resumeAgentRuntime,
} from './agent-runtime'
import {
  createAgentMemoryCandidate,
  evaluateHybridRetrievalCandidate,
  evaluateLexicalRetrievalBaseline,
  KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION,
  KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH,
  KNOWLEDGE_RETRIEVAL_TOP_K_MAX,
  KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX,
  mergeKnowledgeRetrievalCandidates,
  parseCurrentKnowledgeCitation,
  parseAgentMemoryCandidate,
  parseKnowledgeCitation,
  parseKnowledgeRetrievalCandidateSet,
  parseKnowledgeRetrievalRequest,
  parseRetrievalMemoryEvaluationCorpus,
  rerankKnowledgeRetrievalCandidates,
  promoteAgentMemoryCandidate,
  type KnowledgeCitation,
  type KnowledgeHybridRetrievalResult,
  type KnowledgeRerankedRetrievalResult,
  type KnowledgeRetrievalCandidateSet,
  type KnowledgeRetrievalRequest,
} from './retrieval-memory'

describe('V2.1 Agent Memory candidate contract', () => {
  it('creates one inert candidate from an exact accepted observable result', async () => {
    const created = createAgentRuntime({
      stateVersion: 1,
      id: 'runtime-memory-1',
      scope: {
        kind: 'team',
        organizationId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        sessionId: 'session-1',
        localProjectId: 'local-project-1',
      },
      authority: {
        runId: 'run-1',
        nodeId: 'node-1',
        runVersion: 7,
        policyVersion: 2,
      },
      contextDigest: '1'.repeat(64),
      capabilitySetDigest: '2'.repeat(64),
      bounds: {
        maxSteps: 4,
        maxWallTimeMs: 60_000,
        maxToolCalls: 4,
        maxToolResultBytes: 4_096,
        maxTrajectoryMetadataBytes: 4_096,
        maxCheckpointBytes: 16_384,
        maxTokens: 1_000,
        maxCostUsd: 10,
      },
      requestedAt: '2026-08-13T08:00:00.000Z',
      deadline: '2026-08-13T08:01:00.000Z',
    })
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.runtime.checkpointVersion,
      authority: created.runtime.authority,
      contextDigest: created.runtime.contextDigest,
      capabilitySetDigest: created.runtime.capabilitySetDigest,
      now: '2026-08-13T08:00:01.000Z',
    })
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.runtime.checkpointVersion,
      now: '2026-08-13T08:00:02.000Z',
      action: {
        id: 'action-memory-1',
        kind: 'tool',
        capabilityId: 'test.observe',
        capabilityVersion: 1,
        requestDigest: '4'.repeat(64),
        requiresPermission: false,
      },
    })
    const acceptedTransition = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.runtime.checkpointVersion,
      actionId: 'action-memory-1',
      requestDigest: '4'.repeat(64),
      result: {
        outcome: 'success',
        resultDigest: '3'.repeat(64),
        resultBytes: 128,
        tokens: 0,
        costUsd: 0,
        evaluation: 'continue',
        evaluationSummary: 'The accepted observation can propose a bounded Memory candidate.',
      },
      now: '2026-08-13T08:00:03.000Z',
    })

    await expect(createAgentMemoryCandidate({
      id: 'memory-candidate-1',
      statement: 'The saved health test is the regression check for dependency degradation.',
      previousRuntime: requested.runtime,
      acceptedTransition,
      createdAt: '2026-08-13T08:00:04.000Z',
    })).resolves.toEqual({
      stateVersion: 1,
      id: 'memory-candidate-1',
      status: 'candidate',
      scope: requested.runtime.scope,
      statement: 'The saved health test is the regression check for dependency degradation.',
      contentDigest: '59abd35566d90929a62e012cdddffbb120bc22d141c53528670ba08fc0e0e660',
      provenance: {
        kind: 'agent_observation',
        runtimeId: 'runtime-memory-1',
        actionId: 'action-memory-1',
        checkpointVersion: 4,
        sequence: 10,
        resultDigest: '3'.repeat(64),
      },
      provenanceDigest: 'aad5fd68277b6b347c2ee50b6493cf3b7e4da0b99c3db571a427023e6ecc0a05',
      createdAt: '2026-08-13T08:00:04.000Z',
    })
  })

  it('promotes an inert candidate to immutable revision one through exact authority', async () => {
    const candidate = await parseAgentMemoryCandidate({
      stateVersion: 1,
      id: 'memory-candidate-1',
      status: 'candidate',
      scope: {
        kind: 'team',
        organizationId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        sessionId: 'session-1',
        localProjectId: 'local-project-1',
      },
      statement: 'The saved health test is the regression check for dependency degradation.',
      contentDigest: '59abd35566d90929a62e012cdddffbb120bc22d141c53528670ba08fc0e0e660',
      provenance: {
        kind: 'agent_observation',
        runtimeId: 'runtime-memory-1',
        actionId: 'action-memory-1',
        checkpointVersion: 4,
        sequence: 10,
        resultDigest: '3'.repeat(64),
      },
      provenanceDigest: 'aad5fd68277b6b347c2ee50b6493cf3b7e4da0b99c3db571a427023e6ecc0a05',
      createdAt: '2026-08-13T08:00:04.000Z',
    })
    const unchangedCandidate = structuredClone(candidate)
    const authority = {
      stateVersion: 1,
      decisionId: 'memory-promotion-decision-1',
      candidateId: candidate.id,
      candidateContentDigest: candidate.contentDigest,
      scope: candidate.scope,
      actorKind: 'human',
      actorId: 'user-1',
      policyId: 'memory-policy-1',
      policyVersion: 1,
      visibility: 'user_project',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      authorityDigest: '5'.repeat(64),
      decidedAt: '2026-08-13T08:00:05.000Z',
    }

    await expect(promoteAgentMemoryCandidate({
      candidate,
      memoryId: 'memory-health-regression',
      authority,
    })).resolves.toEqual({
      stateVersion: 1,
      id: 'memory-health-regression',
      revision: 1,
      status: 'active',
      scope: candidate.scope,
      visibility: 'user_project',
      statement: candidate.statement,
      contentDigest: candidate.contentDigest,
      provenanceDigest: candidate.provenanceDigest,
      sourceCandidateId: candidate.id,
      supersedesRevision: null,
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      expiresAt: null,
      promotionDecisionId: 'memory-promotion-decision-1',
      promotionActorKind: 'human',
      promotionActorId: 'user-1',
      promotionPolicyId: 'memory-policy-1',
      promotionPolicyVersion: 1,
      promotionAuthorityDigest: '5'.repeat(64),
      createdAt: '2026-08-13T08:00:05.000Z',
    })
    expect(candidate).toEqual(unchangedCandidate)

    for (const actorKind of ['model', 'renderer', 'mcp']) {
      await expect(promoteAgentMemoryCandidate({
        candidate,
        memoryId: 'memory-health-regression',
        authority: { ...authority, actorKind },
      })).rejects.toThrowError('invalid_agent_memory_candidate')
    }
    await expect(promoteAgentMemoryCandidate({
      candidate,
      memoryId: 'memory-health-regression',
      authority: { ...authority, actorId: 'user-foreign' },
    })).rejects.toThrowError('invalid_agent_memory_candidate')
    await expect(promoteAgentMemoryCandidate({
      candidate,
      memoryId: 'memory-health-regression',
      authority: { ...authority, rawPrompt: 'must-not-cross-the-boundary' },
    })).rejects.toThrowError('invalid_agent_memory_candidate')
  })
})

const validRequest: KnowledgeRetrievalRequest = {
  stateVersion: 1,
  id: 'retrieval-request-1',
  scope: {
    kind: 'team',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    sessionId: 'session-1',
    localProjectId: 'local-project-1',
  },
  target: {
    runId: 'run-1',
    nodeId: 'node-1',
    runVersion: 7,
  },
  knowledgeSnapshotHash: `sha256:${'a'.repeat(64)}`,
  query: {
    text: 'health degraded dependency evidence',
    categories: ['testing_standard'],
    tags: ['health', 'api'],
    topK: 3,
  },
  requestedAt: '2026-08-13T07:00:00.000Z',
}

const validLexicalCandidateSet: KnowledgeRetrievalCandidateSet = {
  stateVersion: 1,
  requestId: validRequest.id,
  scope: validRequest.scope,
  knowledgeSnapshotHash: validRequest.knowledgeSnapshotHash,
  strategy: 'lexical',
  embedding: null,
  candidates: [
    {
      documentId: 'knowledge-doc-api-health',
      chunkId: 'chunk-api-health-test',
      organizationId: 'org-1',
      projectId: 'project-1',
      localProjectId: 'local-project-1',
      sourcePath: 'docs/knowledge/standards/api-health.md',
      headingPath: ['Health Test Evidence'],
      contentHash: 'kh-22222222',
      score: 0.75,
      vectorDimensions: null,
    },
  ],
  evaluatedAt: '2026-08-13T07:00:01.000Z',
}

const validCitation: KnowledgeCitation = {
  stateVersion: 1,
  requestId: validRequest.id,
  scope: validRequest.scope,
  knowledgeSnapshotHash: validRequest.knowledgeSnapshotHash,
  documentId: 'knowledge-doc-api-health',
  chunkId: 'chunk-api-health-test',
  sourcePath: 'docs/knowledge/standards/api-health.md',
  headingPath: ['Health Test Evidence'],
  contentHash: 'kh-22222222',
  strategyChain: ['lexical'],
  rank: 1,
  score: 0.75,
  citedAt: '2026-08-13T07:00:02.000Z',
}

const validVectorCandidateSet = {
  ...validLexicalCandidateSet,
  strategy: 'vector',
  embedding: {
    modelId: 'fixture-embedding',
    modelVersion: '1',
    dimensions: 3,
  },
  candidates: [
    {
      documentId: 'knowledge-doc-delivery-safety',
      chunkId: 'chunk-delivery-non-force',
      organizationId: 'org-1',
      projectId: 'project-1',
      localProjectId: 'local-project-1',
      sourcePath: 'docs/knowledge/checklists/delivery-safety.md',
      headingPath: ['Branch Publication'],
      contentHash: 'kh-33333333',
      score: 0.8,
      vectorDimensions: 3,
    },
    {
      ...validLexicalCandidateSet.candidates[0]!,
      score: 0.7,
      vectorDimensions: 3,
    },
  ],
  evaluatedAt: '2026-08-13T07:00:01.500Z',
} satisfies KnowledgeRetrievalCandidateSet

describe('V2.1 Knowledge Retrieval request contract', () => {
  it('parses one exact canonical Team-scoped request', () => {
    expect(parseKnowledgeRetrievalRequest(validRequest)).toEqual(validRequest)
    expect(KNOWLEDGE_RETRIEVAL_CONTRACT_VERSION).toBe(1)
  })

  it.each([
    ['unknown field', { ...validRequest, surprise: true }],
    ['missing organization scope', {
      ...validRequest,
      scope: { ...validRequest.scope, organizationId: '' },
    }],
    ['mixed local and Team scope', {
      ...validRequest,
      scope: { ...validRequest.scope, kind: 'local', organizationId: null },
    }],
    ['noncanonical snapshot hash', {
      ...validRequest,
      knowledgeSnapshotHash: 'a'.repeat(64),
    }],
    ['stale zero Run version', {
      ...validRequest,
      target: { ...validRequest.target, runVersion: 0 },
    }],
    ['noncanonical timestamp', {
      ...validRequest,
      requestedAt: '2026-08-13T07:00:00Z',
    }],
    ['unknown query key', {
      ...validRequest,
      query: { ...validRequest.query, provider: 'fixture' },
    }],
    ['oversized query', {
      ...validRequest,
      query: { ...validRequest.query, text: 'x'.repeat(KNOWLEDGE_RETRIEVAL_QUERY_MAX_LENGTH + 1) },
    }],
    ['duplicate tag', {
      ...validRequest,
      query: { ...validRequest.query, tags: ['api', 'api'] },
    }],
    ['TopK above hard maximum', {
      ...validRequest,
      query: { ...validRequest.query, topK: KNOWLEDGE_RETRIEVAL_TOP_K_MAX + 1 },
    }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseKnowledgeRetrievalRequest(value)).toThrowError(
      'invalid_knowledge_retrieval_request',
    )
  })
})

describe('V2.1 Knowledge Retrieval candidate-set contract', () => {
  it('parses one finite lexical candidate set bound to the exact request', () => {
    expect(parseKnowledgeRetrievalCandidateSet(validLexicalCandidateSet, validRequest))
      .toEqual(validLexicalCandidateSet)
  })

  it('rejects duplicate chunk identities in a candidate set', () => {
    expect(() => parseKnowledgeRetrievalCandidateSet({
      ...validLexicalCandidateSet,
      candidates: [
        validLexicalCandidateSet.candidates[0],
        validLexicalCandidateSet.candidates[0],
      ],
    }, validRequest)).toThrowError('invalid_knowledge_retrieval_request')
  })

  it.each([
    ['cross-project candidate', {
      ...validLexicalCandidateSet,
      candidates: [{ ...validLexicalCandidateSet.candidates[0], projectId: 'project-foreign' }],
    }],
    ['stale snapshot', {
      ...validLexicalCandidateSet,
      knowledgeSnapshotHash: `sha256:${'b'.repeat(64)}`,
    }],
    ['non-finite score', {
      ...validLexicalCandidateSet,
      candidates: [{ ...validLexicalCandidateSet.candidates[0], score: Number.NaN }],
    }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseKnowledgeRetrievalCandidateSet(value, validRequest))
      .toThrowError('invalid_knowledge_retrieval_request')
  })

  it('parses one finite vector candidate set with exact embedding dimensions', () => {
    const vectorCandidateSet: KnowledgeRetrievalCandidateSet = {
      ...validLexicalCandidateSet,
      strategy: 'vector',
      embedding: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
      },
      candidates: [{
        ...validLexicalCandidateSet.candidates[0]!,
        vectorDimensions: 3,
      }],
    }

    expect(parseKnowledgeRetrievalCandidateSet(vectorCandidateSet, validRequest))
      .toEqual(vectorCandidateSet)
  })

  it('rejects a vector candidate whose dimensions mismatch the embedding contract', () => {
    expect(() => parseKnowledgeRetrievalCandidateSet({
      ...validLexicalCandidateSet,
      strategy: 'vector',
      embedding: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
      },
      candidates: [{
        ...validLexicalCandidateSet.candidates[0]!,
        vectorDimensions: 2,
      }],
    }, validRequest)).toThrowError('invalid_knowledge_retrieval_request')
  })

  it('rejects embedding dimensions above the frozen hard maximum', () => {
    expect(KNOWLEDGE_RETRIEVAL_VECTOR_DIMENSIONS_MAX).toBe(4_096)
    expect(() => parseKnowledgeRetrievalCandidateSet({
      ...validLexicalCandidateSet,
      strategy: 'vector',
      embedding: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 4_097,
      },
      candidates: [],
    }, validRequest)).toThrowError('invalid_knowledge_retrieval_request')
  })
})

describe('V2.1 Knowledge Citation contract', () => {
  it('parses one exact citation backed by the bound candidate set', () => {
    expect(parseKnowledgeCitation(validCitation, validRequest, validLexicalCandidateSet))
      .toEqual(validCitation)
  })

  it('preserves the exact request, candidate, and citation through JSON serialization', () => {
    const request = parseKnowledgeRetrievalRequest(JSON.parse(JSON.stringify(validRequest)))
    const candidates = parseKnowledgeRetrievalCandidateSet(
      JSON.parse(JSON.stringify(validLexicalCandidateSet)),
      request,
    )

    expect(parseKnowledgeCitation(
      JSON.parse(JSON.stringify(validCitation)),
      request,
      candidates,
    )).toEqual(validCitation)
  })

  it.each([
    ['fabricated chunk', { ...validCitation, chunkId: 'chunk-invented' }],
    ['stale content hash', { ...validCitation, contentHash: 'kh-stale' }],
    ['stale snapshot', {
      ...validCitation,
      knowledgeSnapshotHash: `sha256:${'c'.repeat(64)}`,
    }],
    ['fabricated rank and score', { ...validCitation, rank: 2, score: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseKnowledgeCitation(value, validRequest, validLexicalCandidateSet))
      .toThrowError('invalid_knowledge_retrieval_request')
  })

  it('parses an exact citation from the reranked result strategy chain', () => {
    const hybrid = mergeKnowledgeRetrievalCandidates(
      validRequest,
      validLexicalCandidateSet,
      validVectorCandidateSet,
    )
    const reranked = rerankKnowledgeRetrievalCandidates(validRequest, hybrid, [
      { chunkId: 'chunk-api-health-test', score: 0.1 },
      { chunkId: 'chunk-delivery-non-force', score: 0.95 },
    ])
    const candidate = reranked.candidates[0]!
    const citation: KnowledgeCitation = {
      stateVersion: 1,
      requestId: validRequest.id,
      scope: validRequest.scope,
      knowledgeSnapshotHash: validRequest.knowledgeSnapshotHash,
      documentId: candidate.documentId,
      chunkId: candidate.chunkId,
      sourcePath: candidate.sourcePath,
      headingPath: candidate.headingPath,
      contentHash: candidate.contentHash,
      strategyChain: candidate.strategyChain,
      rank: 1,
      score: candidate.score,
      citedAt: '2026-08-13T07:00:02.000Z',
    }

    expect(parseKnowledgeCitation(citation, validRequest, reranked)).toEqual(citation)
  })

  it('rejects a citation after the current snapshot refresh changes its content hash', () => {
    const currentSnapshot = {
      stateVersion: 1 as const,
      scope: validRequest.scope,
      knowledgeSnapshotHash: validRequest.knowledgeSnapshotHash,
      chunks: [{
        documentId: validCitation.documentId,
        chunkId: validCitation.chunkId,
        sourcePath: validCitation.sourcePath,
        headingPath: validCitation.headingPath,
        contentHash: validCitation.contentHash,
      }],
      refreshedAt: '2026-08-13T07:00:03.000Z',
    }

    expect(parseCurrentKnowledgeCitation(
      validCitation,
      validRequest,
      validLexicalCandidateSet,
      currentSnapshot,
    )).toEqual(validCitation)
    expect(() => parseCurrentKnowledgeCitation(
      validCitation,
      validRequest,
      validLexicalCandidateSet,
      {
        ...currentSnapshot,
        knowledgeSnapshotHash: `sha256:${'b'.repeat(64)}`,
        chunks: [{
          ...currentSnapshot.chunks[0]!,
          contentHash: 'kh-refreshed',
        }],
      },
    )).toThrowError('invalid_knowledge_retrieval_request')
  })
})

describe('V2.1 deterministic hybrid retrieval', () => {
  it('merges lexical and vector candidates with versioned RRF and stable identity tie-breaks', () => {
    const expected: KnowledgeHybridRetrievalResult = {
      stateVersion: 1,
      requestId: validRequest.id,
      scope: validRequest.scope,
      knowledgeSnapshotHash: validRequest.knowledgeSnapshotHash,
      ranking: {
        contractId: 'reciprocal-rank-fusion',
        contractVersion: 1,
        rankConstant: 60,
      },
      embedding: validVectorCandidateSet.embedding,
      candidates: [
        {
          ...validLexicalCandidateSet.candidates[0]!,
          score: (1 / 61) + (1 / 62),
          vectorDimensions: 3,
          lexicalRank: 1,
          vectorRank: 2,
          strategyChain: ['lexical', 'vector', 'hybrid'],
        },
        {
          ...validVectorCandidateSet.candidates[0]!,
          score: 1 / 61,
          lexicalRank: null,
          vectorRank: 1,
          strategyChain: ['vector', 'hybrid'],
        },
      ],
      evaluatedAt: '2026-08-13T07:00:01.500Z',
    }

    expect(mergeKnowledgeRetrievalCandidates(
      validRequest,
      validLexicalCandidateSet,
      validVectorCandidateSet,
    )).toEqual(expected)
  })

  it('reranks only the admitted hybrid set with exact deterministic fixture scores', () => {
    const hybrid = mergeKnowledgeRetrievalCandidates(
      validRequest,
      validLexicalCandidateSet,
      validVectorCandidateSet,
    )
    const expected: KnowledgeRerankedRetrievalResult = {
      ...hybrid,
      reranking: {
        contractId: 'deterministic-fixture-reranker',
        contractVersion: 1,
      },
      candidates: [
        {
          ...hybrid.candidates[1]!,
          hybridScore: hybrid.candidates[1]!.score,
          score: 0.95,
          strategyChain: ['vector', 'hybrid', 'reranked'],
        },
        {
          ...hybrid.candidates[0]!,
          hybridScore: hybrid.candidates[0]!.score,
          score: 0.1,
          strategyChain: ['lexical', 'vector', 'hybrid', 'reranked'],
        },
      ],
    }

    expect(rerankKnowledgeRetrievalCandidates(validRequest, hybrid, [
      { chunkId: 'chunk-api-health-test', score: 0.1 },
      { chunkId: 'chunk-delivery-non-force', score: 0.95 },
    ])).toEqual(expected)
  })

  it('rejects a foreign hybrid candidate before reading any reranker score', () => {
    const hybrid = mergeKnowledgeRetrievalCandidates(
      validRequest,
      validLexicalCandidateSet,
      validVectorCandidateSet,
    )
    hybrid.candidates[0] = { ...hybrid.candidates[0]!, projectId: 'project-foreign' }
    let scoreReads = 0
    const unreadScores = new Proxy([] as Array<{ chunkId: string; score: number }>, {
      get(target, property, receiver) {
        scoreReads += 1
        return Reflect.get(target, property, receiver)
      },
    })

    expect(() => rerankKnowledgeRetrievalCandidates(validRequest, hybrid, unreadScores))
      .toThrowError('invalid_knowledge_retrieval_request')
    expect(scoreReads).toBe(0)
  })
})

describe('V2.1 Retrieval and Memory evaluation corpus contract', () => {
  const corpusFixture = JSON.parse(readFileSync(
    'scripts/fixtures/v2.1-retrieval-memory-evaluation.json',
    'utf8',
  )) as Record<string, unknown>

  it('parses the exact versioned no-cost corpus', () => {
    const corpus = parseRetrievalMemoryEvaluationCorpus(corpusFixture)

    expect(corpus).toMatchObject({
      schemaVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      retrievalContractVersion: 1,
      memoryContractVersion: 1,
      defaultNoCost: true,
    })
    expect(corpus.documents).toHaveLength(3)
    expect(corpus.memoryFixtures).toHaveLength(6)
    expect(corpus.cases).toHaveLength(10)
  })

  it('computes deterministic no-cost lexical baseline metrics', () => {
    expect(evaluateLexicalRetrievalBaseline(corpusFixture)).toEqual({
      contractVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      strategy: 'lexical',
      evaluatedCaseCount: 2,
      recallAtK: 0.5,
      ndcgAtK: 0.5,
      meanReciprocalRank: 0.5,
      isolationViolations: 0,
      paidProviderCalls: 0,
      observations: [
        {
          caseId: 'lexical-health-baseline',
          rankedChunkIds: ['chunk-api-health-contract', 'chunk-api-health-test'],
          forbiddenHitIds: [],
        },
        {
          caseId: 'semantic-outage-recall',
          rankedChunkIds: ['chunk-api-health-contract'],
          forbiddenHitIds: [],
        },
        {
          caseId: 'cross-tenant-retrieval-isolation',
          rankedChunkIds: ['chunk-api-health-contract'],
          forbiddenHitIds: [],
        },
      ],
    })
  })

  it('proves the deterministic hybrid candidate improves the frozen corpus without leaks', () => {
    expect(evaluateHybridRetrievalCandidate(corpusFixture)).toEqual({
      contractVersion: 1,
      corpusId: 'v2.1-evaluated-retrieval-memory',
      corpusVersion: 1,
      strategy: 'hybrid-reranked',
      embedding: {
        modelId: 'fixture-embedding',
        modelVersion: '1',
        dimensions: 3,
      },
      rankingContractVersion: 1,
      rerankingContractVersion: 1,
      evaluatedCaseCount: 2,
      citationCaseCount: 2,
      recallAtK: 1,
      ndcgAtK: 1,
      meanReciprocalRank: 1,
      aggregateImprovementOverLexical: 0.5,
      citationPrecision: 1,
      citationFaithfulness: 1,
      isolationViolations: 0,
      paidProviderCalls: 0,
      observations: [
        {
          caseId: 'lexical-health-baseline',
          rankedChunkIds: ['chunk-api-health-contract', 'chunk-api-health-test'],
          forbiddenHitIds: [],
          citationOutcome: null,
        },
        {
          caseId: 'semantic-outage-recall',
          rankedChunkIds: ['chunk-api-health-test', 'chunk-api-health-contract'],
          forbiddenHitIds: [],
          citationOutcome: null,
        },
        {
          caseId: 'citation-current-hash',
          rankedChunkIds: ['chunk-delivery-non-force'],
          forbiddenHitIds: [],
          citationOutcome: 'accepted',
        },
        {
          caseId: 'citation-stale-hash-rejected',
          rankedChunkIds: ['chunk-delivery-non-force', 'chunk-api-health-test'],
          forbiddenHitIds: ['chunk-delivery-non-force'],
          citationOutcome: 'stale_rejected',
        },
        {
          caseId: 'cross-tenant-retrieval-isolation',
          rankedChunkIds: ['chunk-api-health-contract'],
          forbiddenHitIds: [],
          citationOutcome: null,
        },
      ],
    })
  })

  it('rejects an unknown top-level corpus field', () => {
    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      surprise: true,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects a corpus missing any required evaluation category', () => {
    const cases = (corpusFixture.cases as Array<Record<string, unknown>>)
      .filter((entry) => entry.category !== 'memory_isolation')

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      cases,
    })).toThrowError('incomplete_retrieval_memory_evaluation_corpus')
  })

  it('rejects duplicate evaluation case identities', () => {
    const cases = corpusFixture.cases as Array<Record<string, unknown>>

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      cases: [...cases, cases[0]],
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects an absolute document source path', () => {
    const documents = structuredClone(
      corpusFixture.documents,
    ) as Array<Record<string, unknown>>
    documents[0] = { ...documents[0], sourcePath: '/private/repository/api-health.md' }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      documents,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects an unknown nested document field', () => {
    const documents = structuredClone(
      corpusFixture.documents,
    ) as Array<Record<string, unknown>>
    documents[0] = { ...documents[0], repositoryAbsolutePath: '/private/source' }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      documents,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects duplicate chunk identities across documents', () => {
    const documents = structuredClone(
      corpusFixture.documents,
    ) as Array<Record<string, unknown>>
    const firstChunks = documents[0]?.chunks as Array<Record<string, unknown>>
    const secondChunks = documents[1]?.chunks as Array<Record<string, unknown>>
    secondChunks[0] = { ...secondChunks[0], chunkId: firstChunks[0]?.chunkId }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      documents,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects an unknown Memory fixture field', () => {
    const memoryFixtures = structuredClone(
      corpusFixture.memoryFixtures,
    ) as Array<Record<string, unknown>>
    memoryFixtures[0] = { ...memoryFixtures[0], hiddenReasoning: 'not allowed' }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      memoryFixtures,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects an unknown evaluation case field', () => {
    const cases = structuredClone(corpusFixture.cases) as Array<Record<string, unknown>>
    cases[0] = { ...cases[0], rawProviderOutput: 'not allowed' }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      cases,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects an evaluation case referencing an unknown chunk', () => {
    const cases = structuredClone(corpusFixture.cases) as Array<Record<string, unknown>>
    cases[0] = { ...cases[0], relevantChunkIds: ['chunk-does-not-exist'] }

    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      cases,
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })

  it('rejects any paid-provider allowance in the default corpus', () => {
    expect(() => parseRetrievalMemoryEvaluationCorpus({
      ...corpusFixture,
      metricThresholds: {
        ...(corpusFixture.metricThresholds as Record<string, unknown>),
        paidProviderCalls: 1,
      },
    })).toThrowError('invalid_retrieval_memory_evaluation_corpus')
  })
})
