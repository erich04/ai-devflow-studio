import { createHash, randomUUID } from 'node:crypto'
import {
  findDuplicateMemory,
  type AgentMemoryDeletionAuthority,
  type AgentMemoryPromotionAuthority,
  type AgentMemoryRevisionAuthority,
  type AgentMemoryTombstone,
  type DurableAgentMemoryRevision,
} from '@ai-devflow/shared'
import type {
  DeleteAgentMemoryInput,
  PromoteAgentMemoryCandidateInput,
  ReviseAgentMemoryInput,
} from './ipc-contract.js'
import type { LocalStore } from './local-store.js'
import {
  listActiveAgentMemoryRevisions as activeMemoriesInScope,
  resolveAgentMemoryLifecycleAuthority,
} from './agent-memory-authority.js'

const HUMAN_PROMOTION_POLICY_ID = 'desktop-human-memory-promotion'
const HUMAN_PROMOTION_POLICY_VERSION = 1
const HUMAN_REVISION_POLICY_ID = 'desktop-human-memory-revision'
const HUMAN_REVISION_POLICY_VERSION = 1
const HUMAN_DELETION_POLICY_ID = 'desktop-human-memory-deletion'
const HUMAN_DELETION_POLICY_VERSION = 1
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

type AgentMemoryHumanActionStore = Pick<
  LocalStore,
  | 'getAgentRuntime'
  | 'getRun'
  | 'getDesktopPairingCredential'
  | 'listAgentMemoryCandidates'
  | 'listAgentMemoryHeads'
  | 'authorizeAgentMemoryPromotion'
  | 'commitAgentMemoryPromotion'
  | 'getAgentMemoryHead'
  | 'listAgentMemoryRevisions'
  | 'authorizeAgentMemoryRevision'
  | 'commitAgentMemoryRevision'
  | 'getAgentMemoryTombstone'
  | 'authorizeAgentMemoryDeletion'
  | 'commitAgentMemoryDeletion'
  | 'purgeAgentMemoryDerivedState'
>

export type AgentMemoryHumanActions = {
  promote(input: PromoteAgentMemoryCandidateInput): Promise<DurableAgentMemoryRevision>
  revise(input: ReviseAgentMemoryInput): Promise<DurableAgentMemoryRevision>
  delete(input: DeleteAgentMemoryInput): Promise<AgentMemoryTombstone>
}

export type CreateAgentMemoryHumanActionsInput = {
  store: AgentMemoryHumanActionStore
  clock?: () => string
  createId?: (prefix: string) => string
}

function reject(): never {
  throw new Error('Agent Memory promotion was rejected')
}

/** The statement repeats an active Memory; revise that Memory instead (ADR 0024 §5). */
export class AgentMemoryDuplicateError extends Error {
  constructor(readonly memoryId: string) {
    super(`Agent Memory repeats active Memory ${memoryId}`)
    this.name = 'AgentMemoryDuplicateError'
  }
}

function rejectDuplicate(memoryId: string): never {
  throw new AgentMemoryDuplicateError(memoryId)
}

function rethrowDuplicateOrReject(error: unknown): never {
  if (error instanceof AgentMemoryDuplicateError) throw error
  reject()
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) reject()
  return value
}

function createExactId(createId: (prefix: string) => string, prefix: string): string {
  const value = createId(prefix)
  if (!identifierPattern.test(value)) reject()
  return value
}

function digestAuthority(
  authority:
    | Omit<AgentMemoryPromotionAuthority, 'authorityDigest'>
    | Omit<AgentMemoryRevisionAuthority, 'authorityDigest'>
    | Omit<AgentMemoryDeletionAuthority, 'authorityDigest'>,
): string {
  return createHash('sha256').update(JSON.stringify(authority), 'utf8').digest('hex')
}

export function createAgentMemoryHumanActions(
  input: CreateAgentMemoryHumanActionsInput,
): AgentMemoryHumanActions {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? ((prefix) => `${prefix}-${randomUUID()}`)

  return {
    async promote(command) {
      try {
        const [resolved, candidates] = await Promise.all([
          resolveAgentMemoryLifecycleAuthority(input.store, command),
          input.store.listAgentMemoryCandidates(command.localProjectId),
        ])
        if (!resolved.ok) reject()
        const access = resolved.authority
        const candidate = candidates.find((entry) => entry.id === command.candidateId)
        if (
          candidate === undefined ||
          !access.candidateVisible(candidate) ||
          candidate.contentDigest !== command.expectedContentDigest ||
          candidate.provenanceDigest !== command.expectedProvenanceDigest
        ) reject()

        const decidedAt = canonicalNow(clock)
        if (Date.parse(decidedAt) < Date.parse(candidate.createdAt)) reject()
        // ADR 0024 §5: the same statement as an active Memory is revised there, not duplicated.
        const duplicate = findDuplicateMemory(
          candidate.statement, await activeMemoriesInScope(input.store, candidate.scope, decidedAt),
          (revision) => revision.statement)
        if (duplicate?.kind === 'exact') rejectDuplicate(duplicate.item.id)
        const memoryId = createExactId(createId, 'agent-memory')
        const decisionId = createExactId(createId, 'agent-memory-promotion')
        const unsignedAuthority: Omit<AgentMemoryPromotionAuthority, 'authorityDigest'> = {
          stateVersion: 1,
          decisionId,
          candidateId: candidate.id,
          candidateContentDigest: candidate.contentDigest,
          scope: { ...candidate.scope },
          actorKind: 'human',
          actorId: candidate.scope.userId,
          policyId: HUMAN_PROMOTION_POLICY_ID,
          policyVersion: HUMAN_PROMOTION_POLICY_VERSION,
          visibility: 'user_project',
          sensitivity: 'private',
          retentionClass: 'until_deleted',
          expiresAt: null,
          decidedAt,
        }
        const authority: AgentMemoryPromotionAuthority = {
          ...unsignedAuthority,
          authorityDigest: digestAuthority(unsignedAuthority),
        }
        const authorization = await input.store.authorizeAgentMemoryPromotion({
          candidateId: candidate.id,
          memoryId,
          authority,
        })
        if (!authorization.authorized) reject()
        const committed = await input.store.commitAgentMemoryPromotion(
          { revision: authorization.revision },
          authorization.capability,
        )
        if (
          !committed.committed ||
          JSON.stringify(committed.revision) !== JSON.stringify(authorization.revision)
        ) reject()
        return committed.revision
      } catch (error) {
        rethrowDuplicateOrReject(error)
      }
    },
    async revise(command) {
      try {
        const [resolved, head, revisions] = await Promise.all([
          resolveAgentMemoryLifecycleAuthority(input.store, command),
          input.store.getAgentMemoryHead(command.memoryId),
          input.store.listAgentMemoryRevisions(command.memoryId),
        ])
        if (!resolved.ok) reject()
        const access = resolved.authority
        const matchingRevisions = revisions.filter((entry) =>
          entry.id === command.memoryId && entry.revision === command.expectedRevision)
        const currentRevision = matchingRevisions[0]
        if (
          head === null ||
          matchingRevisions.length !== 1 ||
          currentRevision === undefined ||
          !access.inScope(currentRevision.scope) ||
          head.memoryId !== command.memoryId ||
          head.currentRevision !== command.expectedRevision ||
          head.version !== command.expectedHeadVersion ||
          head.status !== 'active' ||
          !access.inScope(head.scope) ||
          currentRevision.status !== 'active' ||
          currentRevision.contentDigest !== command.expectedContentDigest ||
          currentRevision.provenanceDigest !== command.expectedProvenanceDigest ||
          currentRevision.statement === command.statement
        ) reject()

        const decidedAt = canonicalNow(clock)
        if (Date.parse(decidedAt) <= Date.parse(currentRevision.createdAt)) reject()
        // ADR 0024 §5: revising into another active Memory's statement would duplicate it.
        const others = (await activeMemoriesInScope(input.store, currentRevision.scope, decidedAt))
          .filter((revision) => revision.id !== currentRevision.id)
        const duplicate = findDuplicateMemory(command.statement, others, (revision) => revision.statement)
        if (duplicate?.kind === 'exact') rejectDuplicate(duplicate.item.id)
        const decisionId = createExactId(createId, 'agent-memory-revision')
        const unsignedAuthority: Omit<AgentMemoryRevisionAuthority, 'authorityDigest'> = {
          stateVersion: 1,
          decisionId,
          memoryId: currentRevision.id,
          expectedRevision: currentRevision.revision,
          expectedContentDigest: currentRevision.contentDigest,
          scope: { ...currentRevision.scope },
          actorKind: 'human',
          actorId: currentRevision.scope.userId,
          policyId: HUMAN_REVISION_POLICY_ID,
          policyVersion: HUMAN_REVISION_POLICY_VERSION,
          visibility: currentRevision.visibility,
          sensitivity: currentRevision.sensitivity,
          retentionClass: currentRevision.retentionClass,
          expiresAt: currentRevision.expiresAt,
          decidedAt,
        }
        const authority: AgentMemoryRevisionAuthority = {
          ...unsignedAuthority,
          authorityDigest: digestAuthority(unsignedAuthority),
        }
        const authorization = await input.store.authorizeAgentMemoryRevision({
          memoryId: currentRevision.id,
          expectedHeadVersion: command.expectedHeadVersion,
          statement: command.statement,
          authority,
        })
        if (!authorization.authorized) reject()
        const committed = await input.store.commitAgentMemoryRevision(
          { revision: authorization.revision, recordedAt: decidedAt },
          authorization.capability,
        )
        if (
          !committed.committed ||
          JSON.stringify(committed.revision) !== JSON.stringify(authorization.revision)
        ) reject()
        return committed.revision
      } catch (error) {
        rethrowDuplicateOrReject(error)
      }
    },
    async delete(command) {
      try {
        const [resolved, head, revisions, existingTombstone] = await Promise.all([
          resolveAgentMemoryLifecycleAuthority(input.store, command),
          input.store.getAgentMemoryHead(command.memoryId),
          input.store.listAgentMemoryRevisions(command.memoryId),
          input.store.getAgentMemoryTombstone(command.memoryId),
        ])
        if (!resolved.ok) reject()
        const access = resolved.authority
        const matchingRevisions = revisions.filter((entry) =>
          entry.id === command.memoryId && entry.revision === command.expectedRevision)
        const currentRevision = matchingRevisions[0]
        if (
          head === null ||
          matchingRevisions.length !== 1 ||
          currentRevision === undefined ||
          !access.inScope(currentRevision.scope) ||
          head.memoryId !== command.memoryId ||
          head.currentRevision !== command.expectedRevision ||
          head.version !== command.expectedHeadVersion ||
          !access.inScope(head.scope) ||
          currentRevision.status !== 'active' ||
          currentRevision.contentDigest !== command.expectedContentDigest ||
          currentRevision.provenanceDigest !== command.expectedProvenanceDigest
        ) reject()

        let tombstone: AgentMemoryTombstone
        if (existingTombstone === null) {
          if (head.status !== 'active') reject()
          const decidedAt = canonicalNow(clock)
          if (Date.parse(decidedAt) <= Date.parse(currentRevision.createdAt)) reject()
          const decisionId = createExactId(createId, 'agent-memory-deletion')
          const unsignedAuthority: Omit<AgentMemoryDeletionAuthority, 'authorityDigest'> = {
            stateVersion: 1,
            decisionId,
            memoryId: currentRevision.id,
            expectedRevision: currentRevision.revision,
            expectedHeadVersion: command.expectedHeadVersion,
            expectedContentDigest: currentRevision.contentDigest,
            scope: { ...currentRevision.scope },
            actorKind: 'human',
            actorId: currentRevision.scope.userId,
            policyId: HUMAN_DELETION_POLICY_ID,
            policyVersion: HUMAN_DELETION_POLICY_VERSION,
            decidedAt,
          }
          const authority: AgentMemoryDeletionAuthority = {
            ...unsignedAuthority,
            authorityDigest: digestAuthority(unsignedAuthority),
          }
          const authorization = await input.store.authorizeAgentMemoryDeletion({ authority })
          if (!authorization.authorized) reject()
          const committed = await input.store.commitAgentMemoryDeletion(
            { tombstone: authorization.tombstone },
            authorization.capability,
          )
          if (
            !committed.committed ||
            JSON.stringify(committed.tombstone) !== JSON.stringify(authorization.tombstone)
          ) reject()
          tombstone = committed.tombstone
        } else {
          if (
            head.status !== 'purge_pending' ||
            existingTombstone.memoryId !== currentRevision.id ||
            existingTombstone.lastRevision !== currentRevision.revision ||
            existingTombstone.deletionVersion !== head.version ||
            existingTombstone.purgeStatus !== 'pending' ||
            existingTombstone.purgedAt !== null ||
            !access.inScope(existingTombstone.scope)
          ) reject()
          tombstone = existingTombstone
        }
        const purgedAt = canonicalNow(clock)
        const purged = await input.store.purgeAgentMemoryDerivedState({
          memoryId: tombstone.memoryId,
          expectedDeletionVersion: tombstone.deletionVersion,
          purgedAt,
        })
        const expectedTombstone: AgentMemoryTombstone = {
          ...tombstone,
          purgeStatus: 'completed',
          purgedAt,
        }
        if (
          !purged.purged ||
          JSON.stringify(purged.tombstone) !== JSON.stringify(expectedTombstone)
        ) reject()
        return purged.tombstone
      } catch (error) {
        rethrowDuplicateOrReject(error)
      }
    },
  }
}
