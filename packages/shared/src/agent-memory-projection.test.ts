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
        duplicateOf: null,
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

describe('Agent Memory renderer projection for Coding Run candidates (ADR 0024)', () => {
  const localScope = {
    kind: 'local' as const, organizationId: null, projectId: null, userId: 'user-1',
    sessionId: 'coding-session-a', localProjectId: 'local-project-1',
  }
  const codingCandidate = (id: string, statement: string, sessionId: string): AgentMemoryCandidate => ({
    ...candidate, id, statement, scope: { ...localScope, sessionId },
    provenance: {
      kind: 'coding_run', runId: 'run-1', nodeId: 'node-build', codingRunId: `coding-${id}`,
      testEvidenceId: 'evidence-1', diffArtifactId: 'diff-1', statementKind: 'change_map',
    },
  })
  const activeMemory = {
    head: { ...head, scope: { ...localScope, sessionId: 'runtime-session' }, status: 'active' as const },
    revision: {
      ...revision, scope: { ...localScope, sessionId: 'runtime-session' }, status: 'active' as const,
      visibility: 'user_project' as const, statement: 'Run pnpm verify before opening a pull request.',
      expiresAt: null, retentionClass: 'until_deleted' as const,
    },
    tombstone: null,
  }

  it('lists every local session of the user in user_project mode and marks duplicates of active Memory', () => {
    const snapshot = createAgentMemoryRendererSnapshot({
      scope: localScope,
      scopeMatch: 'user_project',
      candidates: [
        codingCandidate('exact', 'run PNPM verify before opening a pull request', 'coding-session-b'),
        codingCandidate('similar', 'Run pnpm verify before opening a draft pull request.', 'coding-session-c'),
        codingCandidate('distinct', 'Release notes are written in Chinese.', 'coding-session-d'),
      ],
      memories: [activeMemory],
      observedAt: '2026-08-13T11:00:00.000Z',
    })
    const byId = Object.fromEntries(snapshot.candidates.map((entry) => [entry.id, entry]))
    expect(byId.exact!.duplicateOf).toEqual({ memoryId: revision.id, kind: 'exact', similarity: 1 })
    expect(byId.similar!.duplicateOf).toMatchObject({ memoryId: revision.id, kind: 'similar' })
    expect(byId.distinct!.duplicateOf).toBeNull()
    expect(byId.exact!.provenance).toMatchObject({ kind: 'coding_run', statementKind: 'change_map' })
    expect(parseAgentMemoryRendererSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('keeps exact session matching by default and ignores expired or deleted Memory for duplicates', () => {
    expect(() => createAgentMemoryRendererSnapshot({
      scope: localScope, candidates: [codingCandidate('other', 'Other statement.', 'coding-session-b')],
      memories: [], observedAt: '2026-08-13T11:00:00.000Z',
    })).toThrow('invalid_agent_memory_renderer_snapshot')
    const expired = {
      ...activeMemory,
      revision: { ...activeMemory.revision, retentionClass: 'thirty_days' as const, expiresAt: '2026-08-13T10:45:00.000Z' },
    }
    const snapshot = createAgentMemoryRendererSnapshot({
      scope: localScope, scopeMatch: 'user_project',
      candidates: [codingCandidate('exact', 'Run pnpm verify before opening a pull request.', 'coding-session-b')],
      memories: [expired], observedAt: '2026-08-13T11:00:00.000Z',
    })
    expect(snapshot.candidates[0]!.duplicateOf).toBeNull()
  })

  it('rejects a renderer candidate with a malformed Coding Run provenance or duplicate hint', () => {
    const valid = createAgentMemoryRendererSnapshot({
      scope: localScope, scopeMatch: 'user_project',
      candidates: [codingCandidate('exact', 'Run pnpm verify before opening a pull request.', 'coding-session-b')],
      memories: [activeMemory], observedAt: '2026-08-13T11:00:00.000Z',
    })
    const withProvenance = (provenance: unknown) => ({ ...valid, candidates: [{ ...valid.candidates[0], provenance }] })
    expect(() => parseAgentMemoryRendererSnapshot(withProvenance({ ...valid.candidates[0]!.provenance, runtimeId: 'x' })))
      .toThrow('invalid_agent_memory_renderer_snapshot')
    expect(() => parseAgentMemoryRendererSnapshot(withProvenance({ ...valid.candidates[0]!.provenance, statementKind: 'guess' })))
      .toThrow('invalid_agent_memory_renderer_snapshot')
    expect(() => parseAgentMemoryRendererSnapshot({
      ...valid, candidates: [{ ...valid.candidates[0], duplicateOf: { memoryId: revision.id, kind: 'exact', similarity: 0.5 } }],
    })).toThrow('invalid_agent_memory_renderer_snapshot')
  })
})
