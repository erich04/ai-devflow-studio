import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_CONTEXT_CITATIONS_MAX,
  AGENT_RUNTIME_CONTEXT_MEMORY_REVISIONS_MAX,
  assembleAgentRuntimeContext,
  parseAgentRuntimeContextAttachment,
  projectAgentRuntimeContextTrajectoryMetadata,
} from './agent-runtime-context'
import type {
  DurableAgentMemoryRevision,
  KnowledgeCitation,
  KnowledgeRetrievalCandidateSet,
  KnowledgeRetrievalRequest,
  KnowledgeSnapshotIdentitySet,
} from './retrieval-memory'

const scope = {
  kind: 'team' as const,
  organizationId: 'org-1',
  projectId: 'project-1',
  userId: 'user-1',
  sessionId: 'session-1',
  localProjectId: 'local-project-1',
}

const request: KnowledgeRetrievalRequest = {
  stateVersion: 1,
  id: 'context-retrieval-request-1',
  scope,
  target: { runId: 'run-1', nodeId: 'node-1', runVersion: 7 },
  knowledgeSnapshotHash: `sha256:${'a'.repeat(64)}`,
  query: {
    text: 'health evidence',
    categories: ['testing_standard'],
    tags: ['health'],
    topK: 1,
  },
  requestedAt: '2026-08-13T10:00:00.000Z',
}

const retrievalResult: KnowledgeRetrievalCandidateSet = {
  stateVersion: 1,
  requestId: request.id,
  scope,
  knowledgeSnapshotHash: request.knowledgeSnapshotHash,
  strategy: 'lexical',
  embedding: null,
  candidates: [{
    documentId: 'knowledge-doc-health',
    chunkId: 'knowledge-chunk-health',
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    localProjectId: scope.localProjectId,
    sourcePath: 'docs/knowledge/testing.md',
    headingPath: ['Health Evidence'],
    contentHash: 'knowledge-content-health-v1',
    score: 1,
    vectorDimensions: null,
  }],
  evaluatedAt: '2026-08-13T10:00:01.000Z',
}

const citation: KnowledgeCitation = {
  stateVersion: 1,
  requestId: request.id,
  scope,
  knowledgeSnapshotHash: request.knowledgeSnapshotHash,
  documentId: 'knowledge-doc-health',
  chunkId: 'knowledge-chunk-health',
  sourcePath: 'docs/knowledge/testing.md',
  headingPath: ['Health Evidence'],
  contentHash: 'knowledge-content-health-v1',
  strategyChain: ['lexical'],
  rank: 1,
  score: 1,
  citedAt: '2026-08-13T10:00:02.000Z',
}

const currentSnapshot: KnowledgeSnapshotIdentitySet = {
  stateVersion: 1,
  scope,
  knowledgeSnapshotHash: request.knowledgeSnapshotHash,
  chunks: [{
    documentId: citation.documentId,
    chunkId: citation.chunkId,
    sourcePath: citation.sourcePath,
    headingPath: citation.headingPath,
    contentHash: citation.contentHash,
  }],
  refreshedAt: '2026-08-13T10:00:03.000Z',
}

const memoryRevision: DurableAgentMemoryRevision = {
  stateVersion: 1,
  id: 'memory-context-health',
  revision: 2,
  status: 'active',
  scope,
  visibility: 'user_project',
  statement: 'Run the saved health check before accepting a dependency upgrade.',
  contentDigest: '19610453eae940ccca15f9f99fab8dc2e5ba437792a725184f35f7aa4184b1a8',
  provenanceDigest: '2'.repeat(64),
  sourceCandidateId: 'memory-candidate-context-health',
  supersedesRevision: 1,
  sensitivity: 'internal',
  retentionClass: 'until_deleted',
  expiresAt: null,
  promotionDecisionId: 'memory-revision-context-health',
  promotionActorKind: 'human',
  promotionActorId: scope.userId,
  promotionPolicyId: 'memory-policy-context',
  promotionPolicyVersion: 2,
  promotionAuthorityDigest: '3'.repeat(64),
  createdAt: '2026-08-13T10:00:04.000Z',
}

const input = {
  id: 'runtime-context-attachment-1',
  runtimeId: 'agent-runtime-context-1',
  checkpointVersion: 1,
  scope,
  authority: { runId: 'run-1', nodeId: 'node-1', runVersion: 7, policyVersion: 3 },
  citationSources: [{ citation, request, retrievalResult, currentSnapshot }],
  memorySources: [{
    revision: memoryRevision,
    current: {
      stateVersion: 1 as const,
      memoryId: memoryRevision.id,
      revision: memoryRevision.revision,
      headVersion: 2,
      status: 'active' as const,
      scope,
      sourceRuntimeId: 'agent-runtime-context-1',
      contentDigest: memoryRevision.contentDigest,
      updatedAt: memoryRevision.createdAt,
    },
  }],
  attachedAt: '2026-08-13T10:00:05.000Z',
}

describe('V2.1 Agent Runtime Context attachment', () => {
  it('binds an empty retrieval result to the exact Runtime and checkpoint', async () => {
    const attachment = await assembleAgentRuntimeContext({
      ...input,
      id: 'runtime-context-attachment-empty-1',
      citationSources: [],
      memorySources: [],
    })

    expect(await parseAgentRuntimeContextAttachment(attachment)).toEqual(attachment)
    expect(attachment).toMatchObject({
      runtimeId: input.runtimeId,
      checkpointVersion: input.checkpointVersion,
      knowledgeCitations: [],
      memoryRevisions: [],
      memoryRevisionIdentities: [],
    })
    expect(projectAgentRuntimeContextTrajectoryMetadata(attachment)).toMatchObject({
      knowledgeCitationCount: 0,
      memoryRevisionCount: 0,
    })
  })

  it('attaches exact current Citation and Memory content but projects metadata only', async () => {
    const attachment = await assembleAgentRuntimeContext(input)

    expect(await parseAgentRuntimeContextAttachment(attachment)).toEqual(attachment)
    expect(attachment).toMatchObject({
      stateVersion: 1,
      id: input.id,
      runtimeId: input.runtimeId,
      checkpointVersion: 1,
      scope,
      authority: input.authority,
      knowledgeCitations: [citation],
      memoryRevisions: [memoryRevision],
      attachedAt: input.attachedAt,
    })
    expect(attachment.contextDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(attachment.knowledgeIdentityDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(attachment.memoryIdentityDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(AGENT_RUNTIME_CONTEXT_CITATIONS_MAX).toBe(20)
    expect(AGENT_RUNTIME_CONTEXT_MEMORY_REVISIONS_MAX).toBe(32)

    const metadata = projectAgentRuntimeContextTrajectoryMetadata(attachment)
    expect(metadata).toEqual({
      attachmentId: attachment.id,
      contextDigest: attachment.contextDigest,
      knowledgeCitationCount: 1,
      memoryRevisionCount: 1,
      knowledgeIdentityDigest: attachment.knowledgeIdentityDigest,
      memoryIdentityDigest: attachment.memoryIdentityDigest,
    })
    const serializedMetadata = JSON.stringify(metadata)
    expect(serializedMetadata).not.toContain(citation.sourcePath)
    expect(serializedMetadata).not.toContain(citation.headingPath[0])
    expect(serializedMetadata).not.toContain(memoryRevision.statement)

    await expect(parseAgentRuntimeContextAttachment({
      ...attachment,
      memoryRevisions: [{
        ...attachment.memoryRevisions[0]!,
        statement: 'A changed statement cannot retain the old Context digest.',
      }],
    })).rejects.toThrowError('invalid_agent_runtime_context')
    await expect(parseAgentRuntimeContextAttachment({
      ...attachment,
      memoryRevisionIdentities: [{
        ...attachment.memoryRevisionIdentities[0]!,
        headVersion: 1,
      }],
    })).rejects.toThrowError('invalid_agent_runtime_context')
  })

  it.each([
    ['stale Citation', {
      ...input,
      citationSources: [{
        ...input.citationSources[0],
        currentSnapshot: {
          ...currentSnapshot,
          chunks: [{ ...currentSnapshot.chunks[0]!, contentHash: 'knowledge-content-health-v2' }],
        },
      }],
    }],
    ['cross-scope Memory', {
      ...input,
      memorySources: [{
        ...input.memorySources[0],
        current: {
          ...input.memorySources[0]!.current,
          scope: { ...scope, projectId: 'project-foreign' },
        },
      }],
    }],
    ['deleted Memory', {
      ...input,
      memorySources: [{
        ...input.memorySources[0],
        current: { ...input.memorySources[0]!.current, status: 'deleted' },
      }],
    }],
    ['duplicate Citation', {
      ...input,
      citationSources: [input.citationSources[0], input.citationSources[0]],
    }],
    ['duplicate Memory', {
      ...input,
      memorySources: [input.memorySources[0], input.memorySources[0]],
    }],
    ['unknown raw prompt', { ...input, rawPrompt: 'must-not-cross-context-boundary' }],
  ])('rejects %s before Context attachment', async (_label, value) => {
    await expect(assembleAgentRuntimeContext(value)).rejects.toThrowError(
      'invalid_agent_runtime_context',
    )
  })
})
