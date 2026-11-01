import { describe, expect, it, vi } from 'vitest'
import {
  compactExecutionContext, type CodingAgentRun, type DesktopPairingCredential, type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import { runs } from '@ai-devflow/shared/fixtures'
import {
  assertCodingContextCurrent, buildCodingMemoryQuery, buildWithCodingMemory, codingPromptDigest, recallCodingMemory,
  registerProjectMemoryRecall, type CodingMemoryStore, type RecalledMemory,
} from './coding-context'
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
    const store: CodingMemoryStore = { getDesktopPairingCredential: async () => pairing }
    const recall = vi.fn(async () => ({ items: [], degraded: false }))
    registerProjectMemoryRecall(store, { recall, assertCurrent: async () => {} })
    const recalled = await recallCodingMemory({
      store, run, codingRunId: 'coding-1', userId: run.creatorId, query: run.request, now,
    })
    expect(recalled.scope).toEqual({
      kind: 'team', organizationId: pairing.organizationId, projectId: pairing.projectId,
      localProjectId: run.projectId, userId: run.creatorId, sessionId: pairing.tokenId,
    })
    await expect(recallCodingMemory({
      store, run, codingRunId: 'coding-2', userId: 'another-user', query: run.request, now,
    })).rejects.toThrow('actor does not match')
    expect(recall).toHaveBeenCalledTimes(1)
  })

  it('does not inherit the Team scope of a different local repository', async () => {
    const store: CodingMemoryStore = {
      getDesktopPairingCredential: async () => ({ ...pairing, localProjectId: 'another-repository' }),
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
    currentPairing = { ...pairing, userId: 'another-member' }
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).rejects.toThrow('actor does not match')
  })
})

describe('Project memory recall (ADR 0030)', () => {
  it('builds the coding brief without the essentials page when the brief cannot keep it', () => {
    const essentials = { id: 'pm-devflow-essentials', revision: 1, statement: `Project conventions that apply to every task:\n${'- 规则\n'.repeat(200)}` }
    const fact = { id: 'pm-h1', revision: 1, statement: '[observation] 回归测试命令是 pnpm test:regression' }
    const recalled: RecalledMemory = {
      scope: { kind: 'local', organizationId: null, projectId: null, userId: run.creatorId, sessionId: 'coding-session-1', localProjectId: run.projectId },
      runtimeId: 'agent-runtime-coding-1', recalledAt: now, context: [essentials, fact],
      memories: [essentials, fact].map(({ id }) => ({ id, revision: 1, headVersion: 1, contentDigest: `sha256:${id}` })), omittedMemoryCount: 0,
    }
    // Recalled memory is kept whole, as in the coding brief.
    const build = (maxBytes: number) => (memoryContext: RecalledMemory['context']) => compactExecutionContext({ pinned: 'Current request', maxBytes,
      sources: memoryContext.map((memory) => ({ id: `memory:${memory.id}`, title: 'Recalled Memory', content: memory.statement, summary: '', priority: 100, required: true })) })
    const roomy = buildWithCodingMemory(recalled, build(24_000))
    expect(roomy.memory).toBe(recalled)
    expect(roomy.brief.prompt).toContain('- 规则')
    const tight = buildWithCodingMemory(recalled, build(400))
    expect(tight.brief.prompt).toContain('pnpm test:regression')
    expect(tight.brief.prompt).not.toContain('- 规则')
    // The receipt lists only what the brief sent.
    expect(tight.memory.context.map((item) => item.id)).toEqual(['pm-h1'])
    expect(tight.memory.memories.map((item) => item.id)).toEqual(['pm-h1'])
    expect(tight.memory.omittedMemoryCount).toBe(1)
    // Without the page there is nothing to give up: the brief's own error stands.
    expect(() => buildWithCodingMemory({ ...recalled, context: [fact], memories: recalled.memories.slice(1) }, build(10))).toThrow('narrow the task')
  })

  it('recalls only the project\'s Hindsight memory, never local Memory, and re-checks it on resume', async () => {
    const retrieve = vi.fn(async () => [])
    const store: CodingMemoryStore = { getDesktopPairingCredential: async () => pairing, retrieveAgentMemoryRevisions: retrieve,
      getAgentMemoryHead: async () => null }
    let enabled = true
    const recall = vi.fn(async () => enabled ? { degraded: false, items: [
      projectMemoryIdentity({ id: 'h1' }, '[observation] 回归测试命令是 pnpm test:regression'),
      projectMemoryIdentity({ id: 'h2' }, `[fact 2026-10-20] ${'很长的记录'.repeat(400)}`),
    ] } : null)
    const essentials = projectMemoryIdentity({ id: 'devflow-essentials' }, 'Project conventions that apply to every task (background only):\n- 代码注释统一用英文')
    const conventions = vi.fn(async () => enabled ? essentials : null)
    registerProjectMemoryRecall(store, { recall, conventions, assertCurrent: async () => { if (!enabled) throw new Error('off') } })
    const recalled = await recallCodingMemory({ store, run, codingRunId: 'pm-1', userId: run.creatorId, query: 'regression tests', now })
    expect(recall).toHaveBeenCalledWith(expect.objectContaining({ projectId: run.projectId, userId: run.creatorId, query: 'regression tests' }))
    // The essentials page comes first, outside the recall budget; recalled memory follows in Hindsight's order.
    expect(recalled.context).toEqual([
      { id: 'pm-devflow-essentials', revision: 1, statement: essentials.statement },
      { id: 'pm-h1', revision: 1, statement: '[observation] 回归测试命令是 pnpm test:regression' }])
    expect(recalled.memories).toEqual([
      { id: 'pm-devflow-essentials', revision: 1, headVersion: 1, contentDigest: essentials.contentDigest },
      { id: 'pm-h1', revision: 1, headVersion: 1, contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) }])
    expect(recalled).toMatchObject({ omittedMemoryCount: 1, projectMemory: { degraded: false } })
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
    // No project memory means no memory: local Memory is never consulted.
    const off = await recallCodingMemory({ store, run, codingRunId: 'pm-2', userId: run.creatorId, query: 'regression tests', now })
    expect(off).toMatchObject({ context: [], memories: [], omittedMemoryCount: 0 })
    expect(off.projectMemory).toBeUndefined()
    expect(retrieve).not.toHaveBeenCalled()
    // A receipt with project memory cannot be checked without the registered verifier.
    await expect(assertCodingContextCurrent({ store: { getDesktopPairingCredential: async () => pairing }, codingRun: coding, now }))
      .rejects.toThrow('start a new run')
  })
})

describe('Coding runs created before ADR 0030', () => {
  const localScope: KnowledgeRetrievalScope = {
    kind: 'local', organizationId: null, projectId: null, userId: run.creatorId,
    sessionId: 'coding-session-legacy', localProjectId: run.projectId,
  }
  it('still re-checks local Memory named in an older receipt on resume', async () => {
    const revision: DurableAgentMemoryRevision = {
      stateVersion: 1, id: 'legacy-memory', revision: 1, status: 'active', scope: localScope, visibility: 'user_project',
      statement: 'Run regression tests.', contentDigest: 'a'.repeat(64), provenanceDigest: 'b'.repeat(64),
      sourceCandidateId: 'candidate-legacy', supersedesRevision: null, sensitivity: 'private', retentionClass: 'until_deleted',
      expiresAt: null, promotionDecisionId: 'decision-legacy', promotionActorKind: 'human', promotionActorId: run.creatorId,
      promotionPolicyId: 'test-memory-policy', promotionPolicyVersion: 1, promotionAuthorityDigest: 'c'.repeat(64), createdAt: now,
    }
    let headVersion = 1
    const store: CodingMemoryStore = {
      getDesktopPairingCredential: async () => null,
      retrieveAgentMemoryRevisions: async () => [revision],
      getAgentMemoryHead: async (memoryId) => ({ memoryId, currentRevision: 1, scope: localScope, status: 'active', version: headVersion, updatedAt: now }),
    }
    const compacted = compactExecutionContext({ pinned: 'Current request', sources: [] })
    const runtimeId = 'agent-runtime-coding-legacy'
    const coding: CodingAgentRun = {
      id: 'legacy', runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId, requestedBy: run.creatorId,
      providerId: 'deepseek', engine: 'native', status: 'running', branchName: run.branchName, userInstruction: run.request,
      prompt: compacted.prompt, summary: 'Running', changedPaths: [], startedAt: now, redacted: true,
      contextReceipt: { stateVersion: 1, runId: run.id, nodeId: run.currentNodeId, runVersion: run.version, runtimeId,
        scope: { ...localScope, sessionId: `coding-session-${codingPromptDigest(runtimeId).slice(0, 32)}` },
        memories: [{ id: revision.id, revision: 1, headVersion: 1, contentDigest: revision.contentDigest }],
        omittedMemoryCount: 0, promptDigest: codingPromptDigest(compacted.prompt), compaction: compacted.receipt },
    }
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).resolves.toBeUndefined()
    headVersion = 2
    await expect(assertCodingContextCurrent({ store, codingRun: coding, now })).rejects.toThrow('start a new run')
  })
})

describe('Coding memory query', () => {
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
