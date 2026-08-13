import { describe, expect, it } from 'vitest'
import type {
  AgentMemoryCandidate,
  AgentMemoryTombstone,
  DurableAgentMemoryRevision,
} from './retrieval-memory'
import {
  AGENT_MEMORY_RENDERER_ITEMS_MAX,
  createAgentMemoryRendererSnapshot,
  parseAgentMemoryRendererSnapshot,
  type AgentMemoryLifecycleHeadSource,
} from './agent-memory-projection'

const digest = (character: string) => character.repeat(64)
const scope = {
  kind: 'team' as const,
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  userId: 'user-1',
  sessionId: 'pairing-token-secret',
  localProjectId: 'local-project-1',
}

const candidate: AgentMemoryCandidate = {
  stateVersion: 1,
  id: 'memory-candidate-1',
  status: 'candidate',
  scope,
  statement: 'Prefer exact optimistic concurrency for durable updates.',
  contentDigest: digest('a'),
  provenance: {
    kind: 'agent_observation',
    runtimeId: 'agent-runtime-1',
    actionId: 'action-1',
    checkpointVersion: 2,
    sequence: 7,
    resultDigest: digest('b'),
  },
  provenanceDigest: digest('c'),
  createdAt: '2026-08-13T10:00:00.000Z',
}

const revision: DurableAgentMemoryRevision = {
  stateVersion: 1,
  id: 'durable-memory-1',
  revision: 2,
  status: 'conflict',
  scope,
  visibility: 'project_shared',
  statement: 'Use exact version checks before durable updates.',
  contentDigest: digest('d'),
  provenanceDigest: digest('c'),
  sourceCandidateId: candidate.id,
  supersedesRevision: 1,
  sensitivity: 'internal',
  retentionClass: 'thirty_days',
  expiresAt: '2026-08-14T10:00:00.000Z',
  promotionDecisionId: 'memory-decision-2',
  promotionActorKind: 'human',
  promotionActorId: 'user-1',
  promotionPolicyId: 'memory-policy',
  promotionPolicyVersion: 3,
  promotionAuthorityDigest: digest('e'),
  createdAt: '2026-08-13T10:30:00.000Z',
}

const head: AgentMemoryLifecycleHeadSource = {
  memoryId: revision.id,
  currentRevision: revision.revision,
  scope,
  status: 'conflict',
  version: 4,
  updatedAt: '2026-08-13T10:31:00.000Z',
}

describe('Agent Memory renderer projection', () => {
  it('projects bounded lifecycle state without sessions, capabilities, or local paths', () => {
    const snapshot = createAgentMemoryRendererSnapshot({
      scope,
      candidates: [candidate],
      memories: [{ head, revision, tombstone: null }],
      observedAt: '2026-08-13T11:00:00.000Z',
    })

    expect(snapshot).toEqual({
      projectionVersion: 1,
      localProjectId: 'local-project-1',
      observedAt: '2026-08-13T11:00:00.000Z',
      candidateCount: 1,
      memoryCount: 1,
      truncated: false,
      candidates: [{
        id: candidate.id,
        lifecycleStatus: 'promoted',
        scope: {
          kind: 'team',
          organizationId: 'organization-1',
          projectId: 'team-project-1',
          userId: 'user-1',
          localProjectId: 'local-project-1',
        },
        statement: candidate.statement,
        contentDigest: candidate.contentDigest,
        provenance: candidate.provenance,
        provenanceDigest: candidate.provenanceDigest,
        createdAt: candidate.createdAt,
        redacted: true,
      }],
      memories: [{
        memoryId: revision.id,
        headVersion: 4,
        currentRevision: 2,
        lifecycleStatus: 'conflict',
        revisionStatus: 'conflict',
        scope: {
          kind: 'team',
          organizationId: 'organization-1',
          projectId: 'team-project-1',
          userId: 'user-1',
          localProjectId: 'local-project-1',
        },
        visibility: 'project_shared',
        statement: revision.statement,
        contentDigest: revision.contentDigest,
        provenanceDigest: revision.provenanceDigest,
        sourceCandidateId: candidate.id,
        sensitivity: 'internal',
        retentionClass: 'thirty_days',
        expiresAt: revision.expiresAt,
        promotionPolicyId: 'memory-policy',
        promotionPolicyVersion: 3,
        createdAt: revision.createdAt,
        updatedAt: head.updatedAt,
        tombstone: null,
        redacted: true,
      }],
      redacted: true,
    })
    expect(parseAgentMemoryRendererSnapshot(snapshot)).toEqual(snapshot)
    expect(JSON.stringify(snapshot)).not.toMatch(
      /pairing-token-secret|sessionId|capability|authorityDigest|sourcePath|\/Users\//,
    )
  })

  it('derives expiry and deletion from exact current lifecycle evidence', () => {
    const tombstone: AgentMemoryTombstone = {
      stateVersion: 1,
      memoryId: revision.id,
      deletionVersion: 5,
      lastRevision: 2,
      scope,
      decisionId: 'delete-memory-1',
      actorKind: 'human',
      actorId: 'user-1',
      policyId: 'memory-policy',
      policyVersion: 3,
      authorityDigest: digest('f'),
      purgeStatus: 'completed',
      deletedAt: '2026-08-14T11:00:00.000Z',
      purgedAt: '2026-08-14T11:01:00.000Z',
    }
    const deleted = createAgentMemoryRendererSnapshot({
      scope,
      candidates: [],
      memories: [{
        head: { ...head, status: 'deleted', version: 6, updatedAt: tombstone.purgedAt! },
        revision: { ...revision, status: 'active' },
        tombstone,
      }],
      observedAt: '2026-08-14T12:00:00.000Z',
    })
    expect(deleted.memories[0]).toMatchObject({
      lifecycleStatus: 'deleted',
      headVersion: 6,
      statement: null,
      tombstone: {
        deletionVersion: 5,
        lastRevision: 2,
        purgeStatus: 'completed',
      },
    })

    const expired = createAgentMemoryRendererSnapshot({
      scope,
      candidates: [],
      memories: [{
        head: { ...head, status: 'active' },
        revision: { ...revision, status: 'active' },
        tombstone: null,
      }],
      observedAt: revision.expiresAt!,
    })
    expect(expired.memories[0]?.lifecycleStatus).toBe('expired')
  })

  it('is bounded and rejects any broadened renderer shape', () => {
    const candidates = Array.from({ length: AGENT_MEMORY_RENDERER_ITEMS_MAX + 1 }, (_, index) => ({
      ...candidate,
      id: `memory-candidate-${index}`,
      createdAt: new Date(Date.parse(candidate.createdAt) + index).toISOString(),
    }))
    const snapshot = createAgentMemoryRendererSnapshot({
      scope,
      candidates,
      memories: [],
      observedAt: '2026-08-13T11:00:00.000Z',
    })
    expect(snapshot.candidateCount).toBe(AGENT_MEMORY_RENDERER_ITEMS_MAX + 1)
    expect(snapshot.candidates).toHaveLength(AGENT_MEMORY_RENDERER_ITEMS_MAX)
    expect(snapshot.truncated).toBe(true)

    for (const extra of [
      { capability: {} },
      { sessionId: scope.sessionId },
      { sourcePath: '/Users/erich/private/repository' },
      { rawOutput: 'private output' },
    ]) {
      expect(() => parseAgentMemoryRendererSnapshot({ ...snapshot, ...extra })).toThrow(
        'invalid_agent_memory_renderer_snapshot',
      )
    }
  })

  it('rejects source rows from a different user or session before projection', () => {
    expect(() => createAgentMemoryRendererSnapshot({
      scope,
      candidates: [{
        ...candidate,
        scope: { ...scope, sessionId: 'pairing-token-other-session' },
      }],
      memories: [],
      observedAt: '2026-08-13T11:00:00.000Z',
    })).toThrow('invalid_agent_memory_renderer_snapshot')

    expect(() => createAgentMemoryRendererSnapshot({
      scope,
      candidates: [],
      memories: [{
        head,
        revision: { ...revision, scope: { ...scope, userId: 'user-2' } },
        tombstone: null,
      }],
      observedAt: '2026-08-13T11:00:00.000Z',
    })).toThrow('invalid_agent_memory_renderer_snapshot')
  })
})
