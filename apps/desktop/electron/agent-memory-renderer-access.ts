import {
  createAgentMemoryRendererSnapshot,
  type AgentMemoryRendererSnapshot,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { resolveAgentMemoryLifecycleAuthority, type AgentMemoryLifecycleSelection } from './agent-memory-authority.js'

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

export type ListAgentMemoryLifecycleInput = AgentMemoryLifecycleSelection

export type AgentMemoryRendererAccess = {
  list(input: ListAgentMemoryLifecycleInput): Promise<AgentMemoryRendererSnapshot>
}

export type CreateAgentMemoryRendererAccessOptions = {
  clock?: () => Date
}

function scopesMatch(left: KnowledgeRetrievalScope, right: KnowledgeRetrievalScope): boolean {
  return left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId &&
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.localProjectId === right.localProjectId
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
      const resolved = await resolveAgentMemoryLifecycleAuthority(store, input)
      if (!resolved.ok) {
        throw new Error(resolved.reason === 'stale_selection'
          ? 'Agent Memory renderer Runtime selection is stale'
          : 'Agent Memory renderer authority is invalid')
      }
      const { authority } = resolved
      const [candidateSources, headSources] = await Promise.all([
        store.listAgentMemoryCandidates(input.localProjectId),
        store.listAgentMemoryHeads(input.localProjectId),
      ])
      const candidates = candidateSources.filter((candidate) => authority.candidateVisible(candidate))
      const visibleHeads = headSources.filter((head) => authority.inScope(head.scope))
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
          !scopesMatch(matches[0].scope, head.scope) ||
          (tombstone !== null && !scopesMatch(tombstone.scope, head.scope))
        ) {
          throw new Error('Agent Memory renderer state is invalid')
        }
        return { head, revision: matches[0], tombstone }
      }))
      const [authorityCurrent, finalMemoryStates] = await Promise.all([
        authority.stillCurrent(),
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
      if (!authorityCurrent) {
        throw new Error('Agent Memory renderer authority changed')
      }
      try {
        return createAgentMemoryRendererSnapshot({
          scope: authority.scope,
          scopeMatch: authority.scopeMatch,
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
