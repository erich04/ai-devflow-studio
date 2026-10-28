import { describe, expect, it, vi } from 'vitest'
import {
  compactExecutionContext, CODING_MEMORY_RECALL_BUDGET, CONVERSATION_MEMORY_RECALL_BUDGET, STAGE_AGENT_MEMORY_RECALL_BUDGET,
  type AgentMemoryCandidate, type CodingAgentRun, type DesktopPairingCredential, type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import { runs } from '@ai-devflow/shared/fixtures'
import {
  assertCodingContextCurrent, buildCodingMemoryQuery, codingPromptDigest, recallCodingMemory, recallScopedMemory, registerMemoryCandidateRecall,
  registerProjectMemoryRecall, type CodingMemoryStore,
} from './coding-context'
import { HindsightError } from './hindsight-client'
import { projectMemoryIdentity } from './project-memory-recall'

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

describe('Project memory recall (ADR 0030)', () => {
  it('uses the project\'s Hindsight memory instead of local Memory and re-checks it on resume', async () => {
    const retrieve = vi.fn(async () => [])
    const store: CodingMemoryStore = { getDesktopPairingCredential: async () => pairing, retrieveAgentMemoryRevisions: retrieve,
      getAgentMemoryHead: async () => null }
    let enabled = true
    const recall = vi.fn(async () => enabled ? { degraded: false, items: [
      projectMemoryIdentity({ id: 'h1' }, '[observation] 回归测试命令是 pnpm test:regression'),
      projectMemoryIdentity({ id: 'h2' }, `[fact 2026-10-20] ${'很长的记录'.repeat(400)}`),
    ] } : null)
    registerProjectMemoryRecall(store, { recall, assertCurrent: async () => { if (!enabled) throw new Error('off') } })
    const recalled = await recallCodingMemory({ store, run, codingRunId: 'pm-1', userId: run.creatorId, query: 'regression tests', now })
    expect(recall).toHaveBeenCalledWith(expect.objectContaining({ projectId: run.projectId, userId: run.creatorId, query: 'regression tests' }))
    expect(recalled.context).toEqual([{ id: 'pm-h1', revision: 1, statement: '[observation] 回归测试命令是 pnpm test:regression' }])
    expect(recalled.memories).toEqual([{ id: 'pm-h1', revision: 1, headVersion: 1, contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) }])
    expect(recalled).toMatchObject({ revisions: [], omittedMemoryCount: 1, projectMemory: { degraded: false } })
    expect(retrieve).not.toHaveBeenCalled()

    const compacted = compactExecutionContext({ pinned: 'Current request', sources: [] })
    const coding: CodingAgentRun = {
      id: 'pm-1', runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId, requestedBy: run.creatorId,
      providerId: 'deepseek', engine: 'native', status: 'running', branchName: run.branchName, userInstruction: run.request,
      prompt: compacted.prompt, summary: 'Running', changedPaths: [], startedAt: now, redacted: true,
      contextReceipt: { stateVersion: 1, runId: run.id, nodeId: run.currentNodeId, runVersion: run.version, runtimeId: recalled.runtimeId,
        scope: recalled.scope, memories: recalled.memories, omittedMemoryCount: 1, promptDigest: codingPromptDigest(compacted.prompt),
        compaction: compacted.receipt },
    }
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).resolves.toBeUndefined()
    expect(retrieve).not.toHaveBeenCalled()
    enabled = false
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).rejects.toThrow('start a new run')
    // Memory off again: the previous local behaviour applies.
    expect((await recallCodingMemory({ store, run, codingRunId: 'pm-2', userId: run.creatorId, query: 'regression tests', now })).projectMemory).toBeUndefined()
    expect(retrieve).toHaveBeenCalledTimes(1)
    // A receipt with project memory cannot be checked without the registered verifier.
    await expect(assertCodingContextCurrent({ store: { getDesktopPairingCredential: async () => pairing }, codingRun: coding, now }))
      .rejects.toThrow('start a new run')
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

  function preferenceCandidate(revision: DurableAgentMemoryRevision): AgentMemoryCandidate {
    return {
      stateVersion: 1, id: revision.sourceCandidateId, status: 'candidate', scope: revision.scope,
      statement: revision.statement, contentDigest: revision.contentDigest, provenanceDigest: revision.provenanceDigest,
      provenance: { kind: 'learning_event', eventId: `event-${revision.id}`, factId: `fact-${revision.id}`,
        sourceDigest: 'd'.repeat(64), statementKind: 'communication_preference' }, createdAt: revision.createdAt,
    }
  }

  it.each([
    ['chat-direct', CONVERSATION_MEMORY_RECALL_BUDGET], ['chat-opencode', CONVERSATION_MEMORY_RECALL_BUDGET],
    ['coding-native', CODING_MEMORY_RECALL_BUDGET], ['coding-opencode', CODING_MEMORY_RECALL_BUDGET],
    ['stage-agent', STAGE_AGENT_MEMORY_RECALL_BUDGET], ['stage-review', STAGE_AGENT_MEMORY_RECALL_BUDGET],
  ] as const)('carries an evidenced communication preference across topics for %s', async (surface, budget) => {
    const preference = memory('language', '请用中文回答', now)
    const relevant = memory('cleanup', '批量任务清理需要回归测试。', now)
    const unrelated = memory('environment', '项目使用 Node.js 24', now)
    const store: CodingMemoryStore = {
      retrieveAgentMemoryRevisions: async () => [preference, relevant, unrelated],
      listAgentMemoryCandidates: async () => [preferenceCandidate(preference)],
      getAgentMemoryHead: async (memoryId) => ({ memoryId, currentRevision: 1, scope: localScope, status: 'active', version: 3, updatedAt: now }),
    }
    const recalled = await recallScopedMemory({ store, projectId: run.projectId, userId: run.creatorId,
      runtimeId: surface, requestId: `memory-${surface}`, query: '实现批量任务清理', now, budget })
    expect(recalled.revisions.map((revision) => revision.id)).toEqual(['language', 'cleanup'])
    expect(recalled.memories).toEqual(['language', 'cleanup'].map((id) => ({ id, revision: 1, headVersion: 3, contentDigest: 'a'.repeat(64) })))
    expect(recalled.omittedMemoryCount).toBe(1)
    expect(recalled.communicationPreferences).toEqual([{ memoryId: 'language', preference: { kind: 'language', value: 'chinese' } }])
  })

  it('does not grant topic-independent recall to edited, expired, foreign or unproven preferences', async () => {
    const edited = memory('edited', '请用英文回答', now)
    const expired = { ...memory('expired', '请用中文回答', now), expiresAt: now }
    const foreign = memory('foreign', '回答请简洁', now)
    const unproven = memory('unproven', '先说行为，再说测试', now)
    const store: CodingMemoryStore = {
      retrieveAgentMemoryRevisions: async () => [edited, expired, foreign, unproven],
      listAgentMemoryCandidates: async () => [
        { ...preferenceCandidate(edited), statement: '请用中文回答' }, preferenceCandidate(expired),
        { ...preferenceCandidate(foreign), scope: { ...localScope, userId: 'another-user' } },
      ],
      getAgentMemoryHead: vi.fn(async () => null),
    }
    const recalled = await recallCodingMemory({ store, run, codingRunId: 'no-preferences', userId: run.creatorId,
      query: '实现批量任务清理', now })
    expect(recalled.revisions).toEqual([])
    expect(recalled.omittedMemoryCount).toBe(4)
    expect(recalled.communicationPreferences).toEqual([])
    expect(store.getAgentMemoryHead).not.toHaveBeenCalled()
  })

  it('reserves at most two preferences and one third of the byte budget, without bypassing head checks', async () => {
    const available = [memory('a', '请用中文回答', now), memory('b', '请简洁回答', now), memory('c', '先讲行为再讲测试', now),
      memory('d', '请详细回答'.repeat(80), now)]
    const store: CodingMemoryStore = {
      retrieveAgentMemoryRevisions: async () => available,
      listAgentMemoryCandidates: async () => available.map(preferenceCandidate),
      getAgentMemoryHead: async (memoryId) => ({ memoryId, currentRevision: 1, scope: localScope, status: 'active', version: 1, updatedAt: now }),
    }
    const input = { store, projectId: run.projectId, userId: run.creatorId, runtimeId: 'budget', requestId: 'budget',
      query: '实现批量任务清理', now, budget: { maxItems: 8, maxBytes: 1800 } }
    expect((await recallScopedMemory(input)).revisions.map((revision) => revision.id)).toEqual(['a', 'b'])
    expect((await recallScopedMemory({ ...input, budget: { maxItems: 8, maxBytes: 900 } })).revisions.map((revision) => revision.id)).toEqual(['a'])
    store.getAgentMemoryHead = async (memoryId) => ({ memoryId, currentRevision: 2, scope: localScope, status: 'active', version: 2, updatedAt: now })
    await expect(recallScopedMemory(input)).rejects.toThrow('source changed')
  })

  it('hydrates semantic hits outside the retrieval window, keeps shadow results out of the brief and isolates provider failures', async () => {
    const local = memory('local', 'Run regression tests', now)
    const semantic = memory('semantic', '运行回归验证', now)
    const store: CodingMemoryStore = {
      retrieveAgentMemoryRevisions: async () => [local],
      hydrateAgentMemoryRevisions: async (_request, ids) => ids.includes(semantic.id) ? [semantic] : [],
      getAgentMemoryHead: async (memoryId) => ({ memoryId, currentRevision: 1, scope: localScope, status: 'active', version: 1, updatedAt: now }),
    }
    const input = { store, run, codingRunId: 'semantic-recall', userId: run.creatorId, query: 'regression tests', now }
    registerMemoryCandidateRecall(store, async () => ({ mode: 'shadow', candidates: [{ id: semantic.id, revision: 1, contentDigest: semantic.contentDigest }] }))
    const shadow = await recallCodingMemory(input)
    expect(shadow.revisions.map((r) => r.id)).toEqual(['local'])
    expect(shadow.semanticRecall).toMatchObject({ mode: 'shadow', validCandidates: 1 })
    registerMemoryCandidateRecall(store, async () => ({ mode: 'active', candidates: [{ id: semantic.id, revision: 1, contentDigest: semantic.contentDigest }] }))
    expect((await recallCodingMemory(input)).revisions.map((r) => r.id)).toEqual(['local', 'semantic'])
    registerMemoryCandidateRecall(store, async () => { throw new HindsightError('timeout') })
    expect((await recallCodingMemory(input)).revisions.map((r) => r.id)).toEqual(['local'])
    registerMemoryCandidateRecall(store, async () => { throw new Error('local integrity failure') })
    await expect(recallCodingMemory(input)).rejects.toThrow('local integrity failure')
  })

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
