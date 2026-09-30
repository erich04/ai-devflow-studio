import { describe, expect, it, vi } from 'vitest'
import {
  compactExecutionContext, type CodingAgentRun, type DesktopPairingCredential, type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import { runs } from '@ai-devflow/shared/fixtures'
import {
  assertCodingContextCurrent, buildCodingMemoryQuery, codingPromptDigest, recallCodingMemory, type CodingMemoryStore,
} from './coding-context'

const run = runs[0]!
const now = '2026-09-15T20:00:00.000Z'
const pairing: DesktopPairingCredential = {
  tokenId: 'pairing-session', organizationId: 'org-1', projectId: 'team-project-1',
  localProjectId: run.projectId, userId: run.creatorId, role: 'member',
  authAccountId: 'account-1', projectMemberships: [], createdAt: now,
}

describe('Coding Context authority', () => {
  it('derives retrieval scope from the paired actor and rejects a different actor', async () => {
    const retrieve = vi.fn(async () => [])
    const store: CodingMemoryStore = {
      getDesktopPairingCredential: async () => pairing,
      retrieveAgentMemoryRevisions: retrieve,
      getAgentMemoryHead: async () => null,
    }
    const recalled = await recallCodingMemory({
      store, run, codingRunId: 'coding-1', userId: run.creatorId, query: run.request, now,
    })
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        kind: 'team', organizationId: pairing.organizationId, projectId: pairing.projectId,
        localProjectId: run.projectId, userId: run.creatorId, sessionId: pairing.tokenId,
      },
      runtimeId: recalled.runtimeId,
    }))
    await expect(recallCodingMemory({
      store, run, codingRunId: 'coding-2', userId: 'another-user', query: run.request, now,
    })).rejects.toThrow('actor does not match')
    expect(retrieve).toHaveBeenCalledTimes(1)
  })

  it('does not inherit the Team scope of a different local repository', async () => {
    const retrieve = vi.fn(async () => [])
    const store: CodingMemoryStore = {
      getDesktopPairingCredential: async () => ({ ...pairing, localProjectId: 'another-repository' }),
      retrieveAgentMemoryRevisions: retrieve,
      getAgentMemoryHead: async () => null,
    }
    const recalled = await recallCodingMemory({
      store, run, codingRunId: 'coding-1', userId: run.creatorId, query: run.request, now,
    })
    expect(recalled.scope).toMatchObject({
      kind: 'local', organizationId: null, projectId: null,
      localProjectId: run.projectId, userId: run.creatorId,
    })
  })

  it('invalidates even an empty Memory context when pairing or the immutable brief changes', async () => {
    let currentPairing: DesktopPairingCredential | null = pairing
    const store: CodingMemoryStore = { getDesktopPairingCredential: async () => currentPairing }
    const recalled = await recallCodingMemory({
      store, run, codingRunId: 'coding-1', userId: run.creatorId, query: run.request, now,
    })
    const compacted = compactExecutionContext({ pinned: 'Current request', sources: [] })
    const coding: CodingAgentRun = {
      id: 'coding-1', runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId,
      requestedBy: run.creatorId, providerId: 'deepseek', engine: 'native', status: 'running',
      branchName: run.branchName, userInstruction: run.request, prompt: compacted.prompt,
      summary: 'Running', changedPaths: [], startedAt: now, redacted: true,
      contextReceipt: {
        stateVersion: 1, runId: run.id, nodeId: run.currentNodeId, runVersion: run.version,
        runtimeId: recalled.runtimeId, scope: recalled.scope, memories: [],
        omittedMemoryCount: 0, promptDigest: codingPromptDigest(compacted.prompt),
        compaction: compacted.receipt,
      },
    }
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).resolves.toBeUndefined()
    await expect(assertCodingContextCurrent({
      store, codingRun: { ...coding, prompt: 'Replaced without a new receipt' }, now,
    })).rejects.toThrow('receipt does not match')
    currentPairing = null
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).rejects.toThrow('pairing changed')
    currentPairing = { ...pairing, tokenId: 'renewed-session' }
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).rejects.toThrow('pairing changed')
  })
})

describe('Coding Memory relevance (ADR 0024)', () => {
  const localScope: KnowledgeRetrievalScope = {
    kind: 'local', organizationId: null, projectId: null, userId: run.creatorId,
    sessionId: 'coding-session-test', localProjectId: run.projectId,
  }
  function memory(id: string, statement: string, createdAt: string): DurableAgentMemoryRevision {
    return {
      stateVersion: 1, id, revision: 1, status: 'active', scope: localScope, visibility: 'user_project', statement,
      contentDigest: 'a'.repeat(64), provenanceDigest: 'b'.repeat(64), sourceCandidateId: `candidate-${id}`,
      supersedesRevision: null, sensitivity: 'private', retentionClass: 'until_deleted', expiresAt: null,
      promotionDecisionId: `decision-${id}`, promotionActorKind: 'human', promotionActorId: run.creatorId,
      promotionPolicyId: 'test-memory-policy', promotionPolicyVersion: 1, promotionAuthorityDigest: 'c'.repeat(64), createdAt,
    }
  }

  it('attaches only relevant Memory, best match first, and counts the rest as omitted', async () => {
    const available = [
      memory('m-greeting', 'Greeting copy lives in src/greeting.js; keep the export name.', '2026-09-15T19:00:00.000Z'),
      memory('m-latest', 'Keep the latest release notes in docs.', '2026-09-15T19:00:01.000Z'),
      memory('m-copy', 'Copy changes need design review.', '2026-09-15T19:00:02.000Z'),
    ]
    const store: CodingMemoryStore = {
      getDesktopPairingCredential: async () => null,
      retrieveAgentMemoryRevisions: async () => available,
      getAgentMemoryHead: async (memoryId) => ({
        memoryId, currentRevision: 1, scope: localScope, status: 'active', version: 1, updatedAt: now,
      }),
    }
    const recalled = await recallCodingMemory({
      store, run, codingRunId: 'coding-relevance', userId: run.creatorId,
      query: 'Update the greeting copy in src/greeting.js', now,
    })
    expect(recalled.revisions.map((revision) => revision.id)).toEqual(['m-greeting', 'm-copy'])
    expect(recalled.memories.map((identity) => identity.id)).toEqual(['m-greeting', 'm-copy'])
    expect(recalled.omittedMemoryCount).toBe(1)
  })

  it('builds the recall query from the node and Gate-approved artifacts, not superseded drafts', () => {
    const node = run.nodes.find((candidate) => candidate.id === run.currentNodeId)!
    const approvedGate = { ...node, id: 'gate-clarify', kind: 'gate' as const, stage: 'clarify' as const, status: 'success' as const, artifactIds: ['approved-clarification'] }
    const approvedRun = { ...run, nodes: [...run.nodes, approvedGate] }
    const base = { runId: run.id, nodeId: 'clarify-agent', content: 'body', redacted: true, updatedAt: now }
    const query = buildCodingMemoryQuery({
      run: approvedRun, node, userInstruction: 'Keep the diff small.',
      artifacts: [
        { ...base, id: 'approved-clarification', kind: 'clarification', title: 'Approved scope', summary: 'Filter by status' },
        { ...base, id: 'old-clarification', kind: 'clarification', title: 'Superseded scope', summary: 'Obsolete idea' },
      ],
    })
    expect(query).toContain(run.request)
    expect(query).toContain('Keep the diff small.')
    expect(query).toContain(node.title)
    expect(query).toContain('Approved scope\nFilter by status')
    expect(query).not.toContain('Superseded scope')
  })
})
