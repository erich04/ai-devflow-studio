import {
  createAgentMemoryRendererSnapshot,
  type AgentRuntimeScope,
  type AgentMemoryRendererSnapshot,
  type DesktopPairingCredential,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

type AgentMemoryRendererStore = Pick<
  LocalStore,
  | 'listAgentMemoryCandidates'
  | 'listAgentMemoryHeads'
  | 'listAgentMemoryRevisions'
  | 'getAgentMemoryHead'
  | 'getAgentMemoryTombstone'
  | 'getDesktopPairingCredential'
  | 'getAgentRuntime'
  | 'getRun'
>

export type ListAgentMemoryLifecycleInput = {
  runtimeId: string
  runId: string
  localProjectId: string
}

export type AgentMemoryRendererAccess = {
  list(input: ListAgentMemoryLifecycleInput): Promise<AgentMemoryRendererSnapshot>
}

export type CreateAgentMemoryRendererAccessOptions = {
  clock?: () => Date
}

function scopesMatch(left: KnowledgeRetrievalScope, right: AgentRuntimeScope): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
}

function pairingMatchesScope(
  pairing: DesktopPairingCredential | null,
  scope: AgentRuntimeScope,
): boolean {
  return scope.kind === 'local'
    ? pairing === null || pairing.localProjectId !== scope.localProjectId
    : Boolean(
    pairing &&
    pairing.organizationId === scope.organizationId &&
    pairing.projectId === scope.projectId &&
    pairing.userId === scope.userId &&
    pairing.tokenId === scope.sessionId &&
    pairing.localProjectId === scope.localProjectId,
    )
}

function pairingsMatch(
  left: DesktopPairingCredential | null,
  right: DesktopPairingCredential | null,
): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.organizationId === right.organizationId &&
      left.projectId === right.projectId &&
      left.userId === right.userId &&
      left.tokenId === right.tokenId &&
      left.localProjectId === right.localProjectId
}

function runtimeIdentitiesMatch(
  left: NonNullable<Awaited<ReturnType<LocalStore['getAgentRuntime']>>>,
  right: NonNullable<Awaited<ReturnType<LocalStore['getAgentRuntime']>>>,
): boolean {
  return left.id === right.id &&
    left.authority.runId === right.authority.runId &&
    scopesMatch(left.scope, right.scope)
}

function headsMatch(
  left: NonNullable<Awaited<ReturnType<LocalStore['getAgentMemoryHead']>>>,
  right: NonNullable<Awaited<ReturnType<LocalStore['getAgentMemoryHead']>>>,
): boolean {
  return left.memoryId === right.memoryId &&
    left.currentRevision === right.currentRevision &&
    scopesMatch(left.scope, right.scope) &&
    left.status === right.status &&
    left.version === right.version &&
    left.updatedAt === right.updatedAt
}

function tombstonesMatch(
  left: Awaited<ReturnType<LocalStore['getAgentMemoryTombstone']>>,
  right: Awaited<ReturnType<LocalStore['getAgentMemoryTombstone']>>,
): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.memoryId === right.memoryId &&
      left.deletionVersion === right.deletionVersion &&
      left.lastRevision === right.lastRevision &&
      scopesMatch(left.scope, right.scope) &&
      left.decisionId === right.decisionId &&
      left.actorKind === right.actorKind &&
      left.actorId === right.actorId &&
      left.policyId === right.policyId &&
      left.policyVersion === right.policyVersion &&
      left.authorityDigest === right.authorityDigest &&
      left.purgeStatus === right.purgeStatus &&
      left.deletedAt === right.deletedAt &&
      left.purgedAt === right.purgedAt
}

export function createAgentMemoryRendererAccess(
  store: AgentMemoryRendererStore,
  options: CreateAgentMemoryRendererAccessOptions = {},
): AgentMemoryRendererAccess {
  const clock = options.clock ?? (() => new Date())
  return {
    async list(input) {
      const [runtime, run] = await Promise.all([
        store.getAgentRuntime(input.runtimeId),
        store.getRun(input.runId),
      ])
      if (
        runtime === null ||
        run === null ||
        runtime.authority.runId !== input.runId ||
        runtime.scope.localProjectId !== input.localProjectId ||
        run.projectId !== input.localProjectId ||
        (runtime.scope.kind === 'local' && runtime.scope.userId !== run.creatorId)
      ) {
        throw new Error('Agent Memory renderer Runtime selection is stale')
      }
      const initialPairing = await store.getDesktopPairingCredential()
      if (!pairingMatchesScope(initialPairing, runtime.scope)) {
        throw new Error('Agent Memory renderer authority is invalid')
      }
      const [candidateSources, headSources] = await Promise.all([
        store.listAgentMemoryCandidates(input.localProjectId),
        store.listAgentMemoryHeads(input.localProjectId),
      ])
      const candidates = candidateSources.filter((candidate) =>
        scopesMatch(candidate.scope, runtime.scope))
      const visibleHeads = headSources.filter((head) =>
        scopesMatch(head.scope, runtime.scope))
      const memories = await Promise.all(visibleHeads.map(async (head) => {
        const [revisions, tombstone] = await Promise.all([
          store.listAgentMemoryRevisions(head.memoryId),
          store.getAgentMemoryTombstone(head.memoryId),
        ])
        const matches = revisions.filter((revision) =>
          revision.id === head.memoryId && revision.revision === head.currentRevision)
        if (
          matches.length !== 1 ||
          matches[0] === undefined ||
          !scopesMatch(matches[0].scope, runtime.scope) ||
          (tombstone !== null && !scopesMatch(tombstone.scope, runtime.scope))
        ) {
          throw new Error('Agent Memory renderer state is invalid')
        }
        return { head, revision: matches[0], tombstone }
      }))
      const [finalPairing, finalRuntime, finalMemoryStates] = await Promise.all([
        store.getDesktopPairingCredential(),
        store.getAgentRuntime(input.runtimeId),
        Promise.all(memories.map(async ({ head }) => {
          const [currentHead, tombstone] = await Promise.all([
            store.getAgentMemoryHead(head.memoryId),
            store.getAgentMemoryTombstone(head.memoryId),
          ])
          return { head: currentHead, tombstone }
        })),
      ])
      if (finalMemoryStates.some((current, index) => {
        const initial = memories[index]
        return initial === undefined ||
          current.head === null ||
          !headsMatch(current.head, initial.head) ||
          !tombstonesMatch(current.tombstone, initial.tombstone)
      })) {
        throw new Error('Agent Memory renderer state changed')
      }
      if (
        finalRuntime === null ||
        !runtimeIdentitiesMatch(finalRuntime, runtime) ||
        !pairingMatchesScope(finalPairing, runtime.scope) ||
        !pairingsMatch(finalPairing, initialPairing)
      ) {
        throw new Error('Agent Memory renderer authority changed')
      }
      try {
        return createAgentMemoryRendererSnapshot({
          scope: runtime.scope,
          candidates,
          memories,
          observedAt: clock().toISOString(),
        })
      } catch {
        throw new Error('Agent Memory renderer state is invalid')
      }
    },
  }
}
