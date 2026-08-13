import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentMemoryPromotionAuthority,
  AgentMemoryRevisionAuthority,
  AgentRuntimeScope,
  DesktopPairingCredential,
  DurableAgentMemoryRevision,
  KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import type {
  PromoteAgentMemoryCandidateInput,
  ReviseAgentMemoryInput,
} from './ipc-contract.js'
import type { LocalStore } from './local-store.js'

const HUMAN_PROMOTION_POLICY_ID = 'desktop-human-memory-promotion'
const HUMAN_PROMOTION_POLICY_VERSION = 1
const HUMAN_REVISION_POLICY_ID = 'desktop-human-memory-revision'
const HUMAN_REVISION_POLICY_VERSION = 1
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

type AgentMemoryHumanActionStore = Pick<
  LocalStore,
  | 'getAgentRuntime'
  | 'getRun'
  | 'getDesktopPairingCredential'
  | 'listAgentMemoryCandidates'
  | 'authorizeAgentMemoryPromotion'
  | 'commitAgentMemoryPromotion'
  | 'getAgentMemoryHead'
  | 'listAgentMemoryRevisions'
  | 'authorizeAgentMemoryRevision'
  | 'commitAgentMemoryRevision'
>

export type AgentMemoryHumanActions = {
  promote(input: PromoteAgentMemoryCandidateInput): Promise<DurableAgentMemoryRevision>
  revise(input: ReviseAgentMemoryInput): Promise<DurableAgentMemoryRevision>
}

export type CreateAgentMemoryHumanActionsInput = {
  store: AgentMemoryHumanActionStore
  clock?: () => string
  createId?: (prefix: string) => string
}

function reject(): never {
  throw new Error('Agent Memory promotion was rejected')
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) reject()
  return value
}

function exactScopesMatch(left: KnowledgeRetrievalScope, right: AgentRuntimeScope): boolean {
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

function createExactId(createId: (prefix: string) => string, prefix: string): string {
  const value = createId(prefix)
  if (!identifierPattern.test(value)) reject()
  return value
}

function digestAuthority(
  authority:
    | Omit<AgentMemoryPromotionAuthority, 'authorityDigest'>
    | Omit<AgentMemoryRevisionAuthority, 'authorityDigest'>,
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
        const [runtime, run, pairing, candidates] = await Promise.all([
          input.store.getAgentRuntime(command.runtimeId),
          input.store.getRun(command.runId),
          input.store.getDesktopPairingCredential(),
          input.store.listAgentMemoryCandidates(command.localProjectId),
        ])
        const candidate = candidates.find((entry) => entry.id === command.candidateId)
        if (
          runtime === null ||
          run === null ||
          candidate === undefined ||
          runtime.authority.runId !== command.runId ||
          runtime.scope.localProjectId !== command.localProjectId ||
          run.projectId !== command.localProjectId ||
          (runtime.scope.kind === 'local' && runtime.scope.userId !== run.creatorId) ||
          !pairingMatchesScope(pairing, runtime.scope) ||
          !exactScopesMatch(candidate.scope, runtime.scope) ||
          candidate.provenance.runtimeId !== runtime.id ||
          candidate.contentDigest !== command.expectedContentDigest ||
          candidate.provenanceDigest !== command.expectedProvenanceDigest
        ) reject()

        const decidedAt = canonicalNow(clock)
        if (Date.parse(decidedAt) < Date.parse(candidate.createdAt)) reject()
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
      } catch {
        reject()
      }
    },
    async revise(command) {
      try {
        const [runtime, run, pairing, head, revisions] = await Promise.all([
          input.store.getAgentRuntime(command.runtimeId),
          input.store.getRun(command.runId),
          input.store.getDesktopPairingCredential(),
          input.store.getAgentMemoryHead(command.memoryId),
          input.store.listAgentMemoryRevisions(command.memoryId),
        ])
        const matchingRevisions = revisions.filter((entry) =>
          entry.id === command.memoryId && entry.revision === command.expectedRevision)
        const currentRevision = matchingRevisions[0]
        if (
          runtime === null ||
          run === null ||
          head === null ||
          matchingRevisions.length !== 1 ||
          currentRevision === undefined ||
          runtime.authority.runId !== command.runId ||
          runtime.scope.localProjectId !== command.localProjectId ||
          run.projectId !== command.localProjectId ||
          (runtime.scope.kind === 'local' && runtime.scope.userId !== run.creatorId) ||
          !pairingMatchesScope(pairing, runtime.scope) ||
          !exactScopesMatch(currentRevision.scope, runtime.scope) ||
          head.memoryId !== command.memoryId ||
          head.currentRevision !== command.expectedRevision ||
          head.version !== command.expectedHeadVersion ||
          head.status !== 'active' ||
          !exactScopesMatch(head.scope, runtime.scope) ||
          currentRevision.status !== 'active' ||
          currentRevision.contentDigest !== command.expectedContentDigest ||
          currentRevision.provenanceDigest !== command.expectedProvenanceDigest ||
          currentRevision.statement === command.statement
        ) reject()

        const decidedAt = canonicalNow(clock)
        if (Date.parse(decidedAt) <= Date.parse(currentRevision.createdAt)) reject()
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
      } catch {
        reject()
      }
    },
  }
}
