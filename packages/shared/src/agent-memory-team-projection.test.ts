import { describe, expect, it } from 'vitest'
import {
  createRemoteAgentMemorySummary,
  parseRemoteAgentMemorySummary,
} from './agent-memory-team-projection'
import type { AgentMemoryRendererItem } from './agent-memory-projection'

const memory: AgentMemoryRendererItem = {
  memoryId: 'agent-memory-runtime-1',
  headVersion: 2,
  currentRevision: 2,
  lifecycleStatus: 'active',
  revisionStatus: 'active',
  scope: {
    kind: 'team',
    organizationId: 'org-demo',
    projectId: 'project-alpha',
    userId: 'user-owner',
    localProjectId: 'local-project-private',
  },
  visibility: 'user_project',
  statement: 'Local content must not cross the Team projection boundary.',
  contentDigest: 'a'.repeat(64),
  provenanceDigest: 'b'.repeat(64),
  sourceCandidateId: 'agent-memory-candidate-1',
  sensitivity: 'private',
  retentionClass: 'until_deleted',
  expiresAt: null,
  promotionPolicyId: 'human-reviewed-observation',
  promotionPolicyVersion: 1,
  createdAt: '2026-08-13T11:00:00.000Z',
  updatedAt: '2026-08-13T11:05:00.000Z',
  tombstone: null,
  redacted: true,
}

describe('Agent Memory Team projection', () => {
  it('creates one exact metadata-only summary with canonical bounded citation IDs', () => {
    const summary = createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: ['citation-b', 'citation-a'],
      retrievalCount: 3,
      acceptedContextCount: 2,
      qualityVersion: 3,
      qualityUpdatedAt: '2026-08-13T11:06:00.000Z',
    })

    expect(summary).toEqual({
      stateVersion: 1,
      projectionVersion: 1,
      memoryId: 'agent-memory-runtime-1',
      projectId: 'project-alpha',
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      ownerUserId: 'user-owner',
      candidateId: 'agent-memory-candidate-1',
      currentRevision: 2,
      headVersion: 2,
      qualityVersion: 3,
      lifecycleStatus: 'active',
      visibility: 'user_project',
      sensitivity: 'private',
      retentionClass: 'until_deleted',
      provenanceDigest: 'b'.repeat(64),
      citationIds: ['citation-a', 'citation-b'],
      retrievalCount: 3,
      acceptedContextCount: 2,
      expiresAt: null,
      deletedAt: null,
      purgeStatus: null,
      purgedAt: null,
      updatedAt: '2026-08-13T11:06:00.000Z',
      redacted: true,
    })
    expect(parseRemoteAgentMemorySummary(summary)).toEqual(summary)
    expect(JSON.stringify(summary)).not.toMatch(
      /Local content|statement|contentDigest|localProjectId|sessionId|promotionPolicy/iu,
    )
  })

  it.each([
    ['statement', 'forbidden local statement'],
    ['contentDigest', 'c'.repeat(64)],
    ['localProjectId', 'local-private'],
    ['sessionId', 'desktop-secret-session'],
    ['rawOutput', 'forbidden raw output'],
  ])('rejects a payload that adds forbidden %s', (key, value) => {
    const summary = createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 0,
      acceptedContextCount: 0,
      qualityVersion: 1,
      qualityUpdatedAt: memory.updatedAt,
    })

    expect(() => parseRemoteAgentMemorySummary({ ...summary, [key]: value })).toThrow(
      'agent_memory_team_projection_invalid',
    )
  })

  it('rejects noncanonical citations and a local-only Memory scope', () => {
    const summary = createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 0,
      acceptedContextCount: 0,
      qualityVersion: 1,
      qualityUpdatedAt: memory.updatedAt,
    })
    expect(() => parseRemoteAgentMemorySummary({
      ...summary,
      citationIds: ['citation-b', 'citation-a'],
    })).toThrow('agent_memory_team_projection_invalid')
    expect(() => createRemoteAgentMemorySummary({
      memory: {
        ...memory,
        scope: {
          ...memory.scope,
          kind: 'local',
          organizationId: null,
          projectId: null,
        },
      },
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 0,
      acceptedContextCount: 0,
      qualityVersion: 1,
      qualityUpdatedAt: memory.updatedAt,
    })).toThrow('agent_memory_team_projection_invalid')
  })

  it('rejects more accepted contexts than durable retrievals', () => {
    expect(() => createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 1,
      acceptedContextCount: 2,
      qualityVersion: 3,
      qualityUpdatedAt: memory.updatedAt,
    })).toThrow('agent_memory_team_projection_invalid')
  })

  it('rejects a quality version that does not equal the durable accepted Context count', () => {
    expect(() => createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 2,
      acceptedContextCount: 2,
      qualityVersion: 1,
      qualityUpdatedAt: '2026-08-13T11:06:00.000Z',
    })).toThrow('agent_memory_team_projection_invalid')
  })

  it('parses a migrated schema-17 summary at reserved legacy quality version zero', () => {
    const summary = createRemoteAgentMemorySummary({
      memory,
      runId: 'run-alpha',
      nodeId: 'node-build',
      runtimeId: 'agent-runtime-1',
      citationIds: [],
      retrievalCount: 2,
      acceptedContextCount: 2,
      qualityVersion: 3,
      qualityUpdatedAt: '2026-08-13T11:06:00.000Z',
    })

    expect(parseRemoteAgentMemorySummary({ ...summary, qualityVersion: 0 })).toEqual({
      ...summary,
      qualityVersion: 0,
    })
  })
})
