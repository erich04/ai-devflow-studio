import { describe, expect, it, vi } from 'vitest'
import { compactExecutionContext, type CodingAgentRun, type DesktopPairingCredential } from '@ai-devflow/shared'
import { runs } from '@ai-devflow/shared/fixtures'
import { assertCodingContextCurrent, codingPromptDigest, recallCodingMemory, type CodingMemoryStore } from './coding-context'

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
