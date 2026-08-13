import { describe, expect, it, vi } from 'vitest'
import type {
  AgentMemoryCandidate,
  AgentRuntimeScope,
  DesktopPairingCredential,
  DurableAgentMemoryRevision,
} from '@ai-devflow/shared'
import { createAgentRuntime, createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { createAgentMemoryRendererAccess } from './agent-memory-renderer-access'

const digest = (character: string) => character.repeat(64)

function runFixture(creatorId = 'user-1') {
  return createWorkflowRunFromRequest({
    runId: 'run-selected',
    title: 'Selected Agent Memory lifecycle Run',
    request: 'Inspect exact scoped Agent Memory lifecycle state.',
    projectId: 'local-project-1',
    creatorId,
    branchName: 'devflow/agent-memory-selected',
    now: '2026-08-13T10:00:00.000Z',
  }).run
}

function runtimeFixture(scope: AgentRuntimeScope) {
  return createAgentRuntime({
    stateVersion: 1,
    id: 'agent-runtime-selected',
    scope,
    authority: {
      runId: 'run-selected',
      nodeId: 'node-selected',
      runVersion: 1,
      policyVersion: 1,
    },
    contextDigest: digest('e'),
    capabilitySetDigest: digest('f'),
    bounds: {
      maxSteps: 1,
      maxWallTimeMs: 120_000,
      maxToolCalls: 1,
      maxToolResultBytes: 8_192,
      maxTrajectoryMetadataBytes: 4_096,
      maxCheckpointBytes: 16_384,
      maxTokens: 1,
      maxCostUsd: 1,
    },
    requestedAt: '2026-08-13T10:00:00.000Z',
    deadline: '2026-08-13T10:02:00.000Z',
  }).runtime
}

function candidateFixture(input: {
  id: string
  projectId: string
  tokenId: string
}): AgentMemoryCandidate {
  return {
    stateVersion: 1,
    id: input.id,
    status: 'candidate',
    scope: {
      kind: 'team',
      organizationId: 'organization-1',
      projectId: input.projectId,
      userId: 'user-1',
      sessionId: input.tokenId,
      localProjectId: 'local-project-1',
    },
    statement: `Candidate ${input.id} is safe for review.`,
    contentDigest: digest('a'),
    provenance: {
      kind: 'agent_observation',
      runtimeId: `runtime-${input.id}`,
      actionId: `action-${input.id}`,
      checkpointVersion: 1,
      sequence: 1,
      resultDigest: digest('b'),
    },
    provenanceDigest: digest('c'),
    createdAt: '2026-08-13T11:00:00.000Z',
  }
}

function revisionFixture(candidate: AgentMemoryCandidate): DurableAgentMemoryRevision {
  return {
    stateVersion: 1,
    id: `durable-${candidate.id}`,
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
    promotionDecisionId: `decision-${candidate.id}`,
    promotionActorKind: 'human',
    promotionActorId: 'user-1',
    promotionPolicyId: 'memory-policy',
    promotionPolicyVersion: 1,
    promotionAuthorityDigest: digest('d'),
    createdAt: '2026-08-13T11:01:00.000Z',
  }
}

describe('Agent Memory renderer access', () => {
  it('projects only the selected Local Project and exact current pairing scope', async () => {
    const selectedCandidate = candidateFixture({
      id: 'candidate-selected',
      projectId: 'team-project-1',
      tokenId: 'pairing-token-1',
    })
    const staleCandidate = candidateFixture({
      id: 'candidate-stale',
      projectId: 'team-project-1',
      tokenId: 'old-pairing-token',
    })
    const foreignCandidate = candidateFixture({
      id: 'candidate-foreign',
      projectId: 'team-project-foreign',
      tokenId: 'pairing-token-1',
    })
    const selectedRevision = revisionFixture(selectedCandidate)
    const staleRevision = revisionFixture(staleCandidate)
    const selectedHead = {
      memoryId: selectedRevision.id,
      currentRevision: 1,
      scope: selectedRevision.scope,
      status: 'active' as const,
      version: 1,
      updatedAt: selectedRevision.createdAt,
    }
    const pairing = {
      organizationId: 'organization-1',
      projectId: 'team-project-1',
      userId: 'user-1',
      tokenId: 'pairing-token-1',
      localProjectId: 'local-project-1',
    } as DesktopPairingCredential
    const runtime = runtimeFixture(selectedCandidate.scope)
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture()),
      listAgentMemoryCandidates: vi.fn(async () => [
        selectedCandidate,
        staleCandidate,
        foreignCandidate,
      ]),
      listAgentMemoryHeads: vi.fn(async () => [
        selectedHead,
        {
          memoryId: staleRevision.id,
          currentRevision: 1,
          scope: staleRevision.scope,
          status: 'active' as const,
          version: 1,
          updatedAt: staleRevision.createdAt,
        },
      ]),
      listAgentMemoryRevisions: vi.fn(async (memoryId: string) =>
        memoryId === selectedRevision.id ? [selectedRevision] : [staleRevision]),
      getAgentMemoryHead: vi.fn(async (memoryId: string) =>
        memoryId === selectedRevision.id ? selectedHead : null),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn(async () => pairing),
    }

    const snapshot = await createAgentMemoryRendererAccess(store, {
      clock: () => new Date('2026-08-13T12:00:00.000Z'),
    }).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: 'local-project-1',
    })

    expect(snapshot.candidateCount).toBe(1)
    expect(snapshot.memoryCount).toBe(1)
    expect(snapshot.candidates[0]).toMatchObject({
      id: selectedCandidate.id,
      lifecycleStatus: 'promoted',
    })
    expect(snapshot.memories[0]).toMatchObject({
      memoryId: selectedRevision.id,
      headVersion: 1,
      currentRevision: 1,
      lifecycleStatus: 'active',
    })
    expect(store.listAgentMemoryCandidates).toHaveBeenCalledWith('local-project-1')
    expect(store.listAgentMemoryHeads).toHaveBeenCalledWith('local-project-1')
    expect(store.listAgentMemoryRevisions).toHaveBeenCalledTimes(1)
    expect(store.listAgentMemoryRevisions).not.toHaveBeenCalledWith(staleRevision.id)
    expect(store.getDesktopPairingCredential).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(snapshot)).not.toMatch(
      /pairing-token-1|old-pairing-token|sessionId|candidate-stale|candidate-foreign|capability/,
    )
  })

  it('fails closed when the current revision cannot be proven from the selected head', async () => {
    const candidate = candidateFixture({
      id: 'candidate-corrupt',
      projectId: 'team-project-1',
      tokenId: 'pairing-token-1',
    })
    const revision = revisionFixture(candidate)
    const runtime = runtimeFixture(candidate.scope)
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture()),
      listAgentMemoryCandidates: vi.fn(async () => [candidate]),
      listAgentMemoryHeads: vi.fn(async () => [{
        memoryId: revision.id,
        currentRevision: 2,
        scope: revision.scope,
        status: 'active' as const,
        version: 2,
        updatedAt: revision.createdAt,
      }]),
      listAgentMemoryRevisions: vi.fn(async () => [revision]),
      getAgentMemoryHead: vi.fn(async () => null),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn(async () => ({
        organizationId: 'organization-1',
        projectId: 'team-project-1',
        userId: 'user-1',
        tokenId: 'pairing-token-1',
        localProjectId: 'local-project-1',
      } as DesktopPairingCredential)),
    }

    await expect(createAgentMemoryRendererAccess(store).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: 'local-project-1',
    })).rejects.toThrow('Agent Memory renderer state is invalid')
  })

  it('uses the exact selected local Runtime user and session instead of project-wide visibility', async () => {
    const selectedScope: AgentRuntimeScope = {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'local-user-1',
      sessionId: 'local-session-1',
      localProjectId: 'local-project-1',
    }
    const selected = candidateFixture({
      id: 'candidate-local-selected',
      projectId: 'ignored-team-project',
      tokenId: 'ignored-team-session',
    })
    selected.scope = selectedScope
    const otherSession = candidateFixture({
      id: 'candidate-local-other-session',
      projectId: 'ignored-team-project',
      tokenId: 'ignored-team-session',
    })
    otherSession.scope = { ...selectedScope, sessionId: 'local-session-2' }
    const runtime = runtimeFixture(selectedScope)
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture('local-user-1')),
      listAgentMemoryCandidates: vi.fn(async () => [selected, otherSession]),
      listAgentMemoryHeads: vi.fn(async () => []),
      listAgentMemoryRevisions: vi.fn(async () => []),
      getAgentMemoryHead: vi.fn(async () => null),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn(async () => null),
    }

    const snapshot = await createAgentMemoryRendererAccess(store).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: selectedScope.localProjectId,
    })

    expect(snapshot.candidates.map((candidate) => candidate.id)).toEqual([selected.id])
    expect(JSON.stringify(snapshot)).not.toContain(otherSession.id)
  })

  it('fails closed when the current Team pairing rotates while lifecycle rows are read', async () => {
    const candidate = candidateFixture({
      id: 'candidate-pairing-race',
      projectId: 'team-project-1',
      tokenId: 'pairing-token-1',
    })
    const runtime = runtimeFixture(candidate.scope)
    const currentPairing = {
      organizationId: 'organization-1',
      projectId: 'team-project-1',
      userId: 'user-1',
      tokenId: 'pairing-token-1',
      localProjectId: 'local-project-1',
    } as DesktopPairingCredential
    const rotatedPairing = { ...currentPairing, tokenId: 'pairing-token-2' }
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture()),
      listAgentMemoryCandidates: vi.fn(async () => [candidate]),
      listAgentMemoryHeads: vi.fn(async () => []),
      listAgentMemoryRevisions: vi.fn(async () => []),
      getAgentMemoryHead: vi.fn(async () => null),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn()
        .mockResolvedValueOnce(currentPairing)
        .mockResolvedValueOnce(rotatedPairing),
    }

    await expect(createAgentMemoryRendererAccess(store).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: 'local-project-1',
    })).rejects.toThrow('Agent Memory renderer authority changed')
  })

  it('does not reinterpret local Runtime Memory through a later Team pairing', async () => {
    const localScope: AgentRuntimeScope = {
      kind: 'local',
      organizationId: null,
      projectId: null,
      userId: 'local-user-1',
      sessionId: 'local-session-1',
      localProjectId: 'local-project-1',
    }
    const runtime = runtimeFixture(localScope)
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture('local-user-1')),
      listAgentMemoryCandidates: vi.fn(async () => []),
      listAgentMemoryHeads: vi.fn(async () => []),
      listAgentMemoryRevisions: vi.fn(async () => []),
      getAgentMemoryHead: vi.fn(async () => null),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn(async () => ({
        organizationId: 'organization-1',
        projectId: 'team-project-1',
        userId: 'user-1',
        tokenId: 'pairing-token-1',
        localProjectId: 'local-project-1',
      } as DesktopPairingCredential)),
    }

    await expect(createAgentMemoryRendererAccess(store).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: localScope.localProjectId,
    })).rejects.toThrow('Agent Memory renderer authority is invalid')
    expect(store.listAgentMemoryCandidates).not.toHaveBeenCalled()
  })

  it('fails closed when a Memory head changes before the projection is returned', async () => {
    const candidate = candidateFixture({
      id: 'candidate-head-race',
      projectId: 'team-project-1',
      tokenId: 'pairing-token-1',
    })
    const revision = revisionFixture(candidate)
    const head = {
      memoryId: revision.id,
      currentRevision: revision.revision,
      scope: revision.scope,
      status: 'active' as const,
      version: 1,
      updatedAt: revision.createdAt,
    }
    const runtime = runtimeFixture(candidate.scope)
    const pairing = {
      organizationId: 'organization-1',
      projectId: 'team-project-1',
      userId: 'user-1',
      tokenId: 'pairing-token-1',
      localProjectId: 'local-project-1',
    } as DesktopPairingCredential
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => runFixture()),
      listAgentMemoryCandidates: vi.fn(async () => [candidate]),
      listAgentMemoryHeads: vi.fn(async () => [head]),
      listAgentMemoryRevisions: vi.fn(async () => [revision]),
      getAgentMemoryHead: vi.fn(async () => ({ ...head, version: 2 })),
      getAgentMemoryTombstone: vi.fn(async () => null),
      getDesktopPairingCredential: vi.fn(async () => pairing),
    }

    await expect(createAgentMemoryRendererAccess(store).list({
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
      localProjectId: 'local-project-1',
    })).rejects.toThrow('Agent Memory renderer state changed')
  })
})
