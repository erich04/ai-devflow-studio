import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createAgentRuntime,
  createWorkflowRunFromRequest,
  type AgentMemoryCandidate,
  type AgentMemoryPromotionAuthority,
  type DesktopPairingCredential,
  type DurableAgentMemoryRevision,
} from '@ai-devflow/shared'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions'

const digest = (character: string) => character.repeat(64)

const scope = {
  kind: 'team' as const,
  organizationId: 'organization-1',
  projectId: 'team-project-1',
  userId: 'user-1',
  sessionId: 'pairing-token-1',
  localProjectId: 'local-project-1',
}

const runtime = createAgentRuntime({
  stateVersion: 1,
  id: 'agent-runtime-1',
  scope,
  authority: {
    runId: 'run-1',
    nodeId: 'node-1',
    runVersion: 1,
    policyVersion: 1,
  },
  contextDigest: digest('1'),
  capabilitySetDigest: digest('2'),
  bounds: {
    maxSteps: 1,
    maxWallTimeMs: 60_000,
    maxToolCalls: 1,
    maxToolResultBytes: 8_192,
    maxTrajectoryMetadataBytes: 4_096,
    maxCheckpointBytes: 16_384,
    maxTokens: 1,
    maxCostUsd: 1,
  },
  requestedAt: '2026-08-13T12:00:00.000Z',
  deadline: '2026-08-13T12:01:00.000Z',
}).runtime

const run = createWorkflowRunFromRequest({
  runId: 'run-1',
  title: 'Promote an exact Memory Candidate',
  request: 'Review one inert observation and promote it explicitly.',
  projectId: scope.localProjectId,
  creatorId: 'requester-1',
  branchName: 'devflow/memory-promotion',
  now: '2026-08-13T12:00:00.000Z',
}).run

const candidate: AgentMemoryCandidate = {
  stateVersion: 1,
  id: 'memory-candidate-1',
  status: 'candidate',
  scope,
  statement: 'Use exact content and provenance digests for human promotion.',
  contentDigest: digest('a'),
  provenance: {
    kind: 'agent_observation',
    runtimeId: runtime.id,
    actionId: 'action-1',
    checkpointVersion: 1,
    sequence: 2,
    resultDigest: digest('b'),
  },
  provenanceDigest: digest('c'),
  createdAt: '2026-08-13T12:00:01.000Z',
}

function revisionFromAuthority(
  memoryId: string,
  authority: AgentMemoryPromotionAuthority,
): DurableAgentMemoryRevision {
  return {
    stateVersion: 1,
    id: memoryId,
    revision: 1,
    status: 'active',
    scope,
    visibility: authority.visibility,
    statement: candidate.statement,
    contentDigest: candidate.contentDigest,
    provenanceDigest: candidate.provenanceDigest,
    sourceCandidateId: candidate.id,
    supersedesRevision: null,
    sensitivity: authority.sensitivity,
    retentionClass: authority.retentionClass,
    expiresAt: authority.expiresAt,
    promotionDecisionId: authority.decisionId,
    promotionActorKind: authority.actorKind,
    promotionActorId: authority.actorId,
    promotionPolicyId: authority.policyId,
    promotionPolicyVersion: authority.policyVersion,
    promotionAuthorityDigest: authority.authorityDigest,
    createdAt: authority.decidedAt,
  }
}

function pairing(): DesktopPairingCredential {
  return {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    tokenId: scope.sessionId,
    localProjectId: scope.localProjectId,
    role: 'owner',
    authAccountId: 'auth-account-1',
    projectMemberships: [{
      projectId: scope.projectId,
      userId: scope.userId,
      role: 'owner',
    }],
    createdAt: '2026-08-13T11:59:00.000Z',
  }
}

describe('Agent Memory human actions', () => {
  it('constructs one main-owned human authority and consumes its opaque promotion capability', async () => {
    let revision: DurableAgentMemoryRevision | undefined
    const capability = Object.freeze(Object.create(null))
    const authorizeAgentMemoryPromotion = vi.fn(async (input: {
      candidateId: string
      memoryId: string
      authority: AgentMemoryPromotionAuthority
    }) => {
      revision = revisionFromAuthority(input.memoryId, input.authority)
      return { authorized: true as const, capability, revision }
    })
    const commitAgentMemoryPromotion = vi.fn(async () => ({
      committed: true as const,
      replayed: false,
      revision: revision!,
    }))
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => run),
      getDesktopPairingCredential: vi.fn(async () => pairing()),
      listAgentMemoryCandidates: vi.fn(async () => [candidate]),
      authorizeAgentMemoryPromotion,
      commitAgentMemoryPromotion,
    }
    const createId = vi.fn((prefix: string) => `${prefix}-generated`)
    const service = createAgentMemoryHumanActions({
      store,
      clock: () => '2026-08-13T12:00:02.000Z',
      createId,
    })

    const result = await service.promote({
      runtimeId: runtime.id,
      runId: run.id,
      localProjectId: scope.localProjectId,
      candidateId: candidate.id,
      expectedContentDigest: candidate.contentDigest,
      expectedProvenanceDigest: candidate.provenanceDigest,
    })

    expect(result).toEqual(revision)
    expect(createId.mock.calls).toEqual([
      ['agent-memory'],
      ['agent-memory-promotion'],
    ])
    const authorization = authorizeAgentMemoryPromotion.mock.calls[0]?.[0]
    expect(authorization).toMatchObject({
      candidateId: candidate.id,
      memoryId: 'agent-memory-generated',
      authority: {
        stateVersion: 1,
        decisionId: 'agent-memory-promotion-generated',
        candidateId: candidate.id,
        candidateContentDigest: candidate.contentDigest,
        scope,
        actorKind: 'human',
        actorId: scope.userId,
        policyId: 'desktop-human-memory-promotion',
        policyVersion: 1,
        visibility: 'user_project',
        sensitivity: 'private',
        retentionClass: 'until_deleted',
        expiresAt: null,
        decidedAt: '2026-08-13T12:00:02.000Z',
      },
    })
    const authority = authorization!.authority
    const { authorityDigest, ...unsignedAuthority } = authority
    expect(authorityDigest).toBe(
      createHash('sha256').update(JSON.stringify(unsignedAuthority)).digest('hex'),
    )
    expect(commitAgentMemoryPromotion).toHaveBeenCalledWith(
      { revision },
      capability,
    )
  })

  it('rejects a stale renderer digest before creating authority or consuming a capability', async () => {
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => run),
      getDesktopPairingCredential: vi.fn(async () => pairing()),
      listAgentMemoryCandidates: vi.fn(async () => [candidate]),
      authorizeAgentMemoryPromotion: vi.fn(),
      commitAgentMemoryPromotion: vi.fn(),
    }
    const createId = vi.fn()

    await expect(createAgentMemoryHumanActions({ store, createId }).promote({
      runtimeId: runtime.id,
      runId: run.id,
      localProjectId: scope.localProjectId,
      candidateId: candidate.id,
      expectedContentDigest: digest('d'),
      expectedProvenanceDigest: candidate.provenanceDigest,
    })).rejects.toThrow('Agent Memory promotion was rejected')
    expect(createId).not.toHaveBeenCalled()
    expect(store.authorizeAgentMemoryPromotion).not.toHaveBeenCalled()
    expect(store.commitAgentMemoryPromotion).not.toHaveBeenCalled()
  })

  it('rejects a same-scope Candidate from a different Runtime before authorization', async () => {
    const store = {
      getAgentRuntime: vi.fn(async () => runtime),
      getRun: vi.fn(async () => run),
      getDesktopPairingCredential: vi.fn(async () => pairing()),
      listAgentMemoryCandidates: vi.fn(async () => [{
        ...candidate,
        provenance: { ...candidate.provenance, runtimeId: 'agent-runtime-other' },
      }]),
      authorizeAgentMemoryPromotion: vi.fn(),
      commitAgentMemoryPromotion: vi.fn(),
    }

    await expect(createAgentMemoryHumanActions({ store }).promote({
      runtimeId: runtime.id,
      runId: run.id,
      localProjectId: scope.localProjectId,
      candidateId: candidate.id,
      expectedContentDigest: candidate.contentDigest,
      expectedProvenanceDigest: candidate.provenanceDigest,
    })).rejects.toThrow('Agent Memory promotion was rejected')
    expect(store.authorizeAgentMemoryPromotion).not.toHaveBeenCalled()
    expect(store.commitAgentMemoryPromotion).not.toHaveBeenCalled()
  })
})
