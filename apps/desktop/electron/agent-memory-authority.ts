import {
  agentMemoryScopesMatch,
  type AgentMemoryCandidate,
  type DesktopPairingCredential,
  type DurableAgentMemoryRevision,
  type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

export type ActiveAgentMemoryStore = Pick<LocalStore, 'listAgentMemoryHeads' | 'listAgentMemoryRevisions' | 'getAgentMemoryTombstone'>

/**
 * Active, unexpired current revisions the scope's user can recall in this project
 * (`user_project` matching). Duplicate checks compare against exactly this set.
 */
export async function listActiveAgentMemoryRevisions(
  store: ActiveAgentMemoryStore,
  scope: KnowledgeRetrievalScope,
  now: string,
): Promise<DurableAgentMemoryRevision[]> {
  const heads = (await store.listAgentMemoryHeads(scope.localProjectId))
    .filter((head) => head.status === 'active' && agentMemoryScopesMatch(head.scope, scope, 'user_project'))
  const active: DurableAgentMemoryRevision[] = []
  for (const head of heads) {
    const [revisions, tombstone] = await Promise.all([
      store.listAgentMemoryRevisions(head.memoryId),
      store.getAgentMemoryTombstone(head.memoryId),
    ])
    const current = revisions.find((revision) => revision.revision === head.currentRevision)
    if (
      current?.status === 'active' && tombstone === null &&
      (current.expiresAt === null || Date.parse(current.expiresAt) > Date.parse(now))
    ) active.push(current)
  }
  return active
}

/**
 * Who may view and act on Agent Memory for a lifecycle request (ADR 0024).
 *
 * - Runtime mode (`runtimeId` given): the exact scope of that persisted Agent Runtime and
 *   only its own candidates, as before.
 * - Project mode (no `runtimeId`): the user who can recall Memory in this local project —
 *   the paired user when this project is paired, otherwise the Run creator — across every
 *   local session, so Memory learned by any Coding Run can be reviewed and deleted.
 */
export type AgentMemoryLifecycleSelection = {
  runtimeId?: string
  runId: string
  localProjectId: string
}

export type AgentMemoryLifecycleAuthority = {
  scope: KnowledgeRetrievalScope
  scopeMatch: 'exact' | 'user_project'
  inScope(scope: KnowledgeRetrievalScope): boolean
  candidateVisible(candidate: AgentMemoryCandidate): boolean
  /** Re-reads pairing (and the Runtime) and reports whether the authority still holds. */
  stillCurrent(): Promise<boolean>
}

export type AgentMemoryAuthorityStore = Pick<LocalStore, 'getAgentRuntime' | 'getRun' | 'getDesktopPairingCredential'>

export type ResolveAgentMemoryAuthorityResult =
  | { ok: true; authority: AgentMemoryLifecycleAuthority }
  | { ok: false; reason: 'stale_selection' | 'invalid_authority' }

/** Placeholder session for the local project view; local sessions are ignored by `user_project`. */
const LOCAL_PROJECT_VIEW_SESSION = 'agent-memory-project-view'

export function pairingMatchesScope(
  pairing: DesktopPairingCredential | null,
  scope: KnowledgeRetrievalScope,
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

function pairingsMatch(left: DesktopPairingCredential | null, right: DesktopPairingCredential | null): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.organizationId === right.organizationId &&
      left.projectId === right.projectId &&
      left.userId === right.userId &&
      left.tokenId === right.tokenId &&
      left.localProjectId === right.localProjectId
}

export async function resolveAgentMemoryLifecycleAuthority(
  store: AgentMemoryAuthorityStore,
  selection: AgentMemoryLifecycleSelection,
): Promise<ResolveAgentMemoryAuthorityResult> {
  const [run, pairing] = await Promise.all([
    store.getRun(selection.runId),
    store.getDesktopPairingCredential(),
  ])
  if (run === null || run.projectId !== selection.localProjectId) return { ok: false, reason: 'stale_selection' }

  if (selection.runtimeId !== undefined) {
    const runtimeId = selection.runtimeId
    const runtime = await store.getAgentRuntime(runtimeId)
    if (
      runtime === null ||
      runtime.authority.runId !== selection.runId ||
      runtime.scope.localProjectId !== selection.localProjectId ||
      (runtime.scope.kind === 'local' && runtime.scope.userId !== run.creatorId)
    ) return { ok: false, reason: 'stale_selection' }
    if (!pairingMatchesScope(pairing, runtime.scope)) return { ok: false, reason: 'invalid_authority' }
    const scope = runtime.scope
    const inScope = (candidate: KnowledgeRetrievalScope) => agentMemoryScopesMatch(candidate, scope, 'exact')
    return {
      ok: true,
      authority: {
        scope,
        scopeMatch: 'exact',
        inScope,
        candidateVisible: (candidate) =>
          candidate.provenance.kind === 'agent_observation' &&
          candidate.provenance.runtimeId === runtime.id &&
          inScope(candidate.scope),
        async stillCurrent() {
          const [currentRuntime, currentPairing] = await Promise.all([
            store.getAgentRuntime(runtimeId),
            store.getDesktopPairingCredential(),
          ])
          return currentRuntime !== null &&
            currentRuntime.id === runtime.id &&
            currentRuntime.authority.runId === runtime.authority.runId &&
            agentMemoryScopesMatch(currentRuntime.scope, scope, 'exact') &&
            pairingMatchesScope(currentPairing, scope) &&
            pairingsMatch(currentPairing, pairing)
        },
      },
    }
  }

  const scope: KnowledgeRetrievalScope = pairing?.localProjectId === selection.localProjectId
    ? {
        kind: 'team', organizationId: pairing.organizationId, projectId: pairing.projectId,
        userId: pairing.userId, sessionId: pairing.tokenId, localProjectId: selection.localProjectId,
      }
    : {
        kind: 'local', organizationId: null, projectId: null,
        userId: run.creatorId, sessionId: LOCAL_PROJECT_VIEW_SESSION, localProjectId: selection.localProjectId,
      }
  const inScope = (candidate: KnowledgeRetrievalScope) => agentMemoryScopesMatch(candidate, scope, 'user_project')
  return {
    ok: true,
    authority: {
      scope,
      scopeMatch: 'user_project',
      inScope,
      candidateVisible: (candidate) => inScope(candidate.scope),
      async stillCurrent() {
        const [currentRun, currentPairing] = await Promise.all([
          store.getRun(selection.runId),
          store.getDesktopPairingCredential(),
        ])
        return currentRun !== null &&
          currentRun.projectId === selection.localProjectId &&
          currentRun.creatorId === run.creatorId &&
          pairingsMatch(currentPairing, pairing)
      },
    },
  }
}
