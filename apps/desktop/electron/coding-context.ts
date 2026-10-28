import { createHash } from 'node:crypto'
import {
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, CODING_MEMORY_RECALL_BUDGET, agentMemoryScopesMatch, rankMemoryByRelevance, redactSensitiveText,
  selectMemoryWithinBudget,
  type AgentRuntimeScope, type Artifact, type CodingAgentRun, type CodingContextReceipt,
  type DurableAgentMemoryRevision, type MemoryRecallBudget, type WorkflowNode, type WorkflowRun,
  type RetrievedKnowledgeManifest,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { HindsightError } from './hindsight-client'
import { memoryCommunicationPreference, type MemoryCommunicationPreference } from './automatic-memory-policy'

export type CodingMemoryStore = Partial<Pick<LocalStore,
  'retrieveAgentMemoryRevisions' | 'hydrateAgentMemoryRevisions' | 'getAgentMemoryHead' | 'getDesktopPairingCredential' |
  'resolveLocalProjectMemoryPrincipal' | 'getAutomaticMemoryConfiguration' | 'listAgentMemoryCandidates'>>

export type MemoryCandidateRecall = (input: {
  scope: AgentRuntimeScope; runtimeId: string; query: string
}) => Promise<{ mode: 'shadow' | 'active'; candidates: { id: string; revision: number; contentDigest: string }[] }>
const candidateRecall = new WeakMap<CodingMemoryStore, MemoryCandidateRecall>()
/** Registered by Main, never by an executor or renderer. The store still owns all hydration. */
export function registerMemoryCandidateRecall(store: CodingMemoryStore, recall: MemoryCandidateRecall) {
  candidateRecall.set(store, recall)
}

export function codingPromptDigest(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex')
}

export async function executionScope(input: {
  store: CodingMemoryStore; projectId: string; userId: string; runtimeId: string
}): Promise<AgentRuntimeScope> {
  const pairing = await input.store.getDesktopPairingCredential?.()
  if (pairing?.localProjectId === input.projectId) {
    if (pairing.userId !== input.userId) throw new Error('Coding Memory actor does not match current pairing')
    return {
      kind: 'team', organizationId: pairing.organizationId, projectId: pairing.projectId,
      userId: pairing.userId, sessionId: pairing.tokenId, localProjectId: input.projectId,
    }
  }
  // Only projects enrolled in automatic learning have adopted the stable principal.
  // Legacy scopes remain unchanged; never silently alias two local users.
  const learning = await input.store.getAutomaticMemoryConfiguration?.(input.projectId)
  if (learning && input.store.resolveLocalProjectMemoryPrincipal) {
    const principal = await input.store.resolveLocalProjectMemoryPrincipal(input.projectId)
    if (principal.status !== 'resolved' || principal.userId !== input.userId || principal.userId !== learning.ownerUserId) {
      throw new Error('Project memory identity changed or is ambiguous')
    }
  }
  return {
    kind: 'local', organizationId: null, projectId: null, userId: input.userId,
    sessionId: `coding-session-${codingPromptDigest(input.runtimeId).slice(0, 32)}`,
    localProjectId: input.projectId,
  }
}

export type RecalledMemory = {
  scope: AgentRuntimeScope
  runtimeId: string
  revisions: DurableAgentMemoryRevision[]
  memories: CodingContextReceipt['memories']
  /** Host-verified, unchanged source wording; these enums affect expression only. */
  communicationPreferences?: Array<{ memoryId: string; preference: MemoryCommunicationPreference }>
  /** Retrievable but not attached: irrelevant, oversized or over budget. */
  omittedMemoryCount: number
  semanticRecall?: { mode: 'shadow' | 'active'; validCandidates: number; degraded: boolean }
}

/**
 * Scoped, ranked Memory recall shared by the coding brief, the stage Agent and the
 * discussion bar (ADR 0024). Retrieval keeps every existing scope, expiry and tombstone
 * rule; ranking is BM25 with a minimum of one shared non-stop-word term, newest first on
 * ties. A bounded set of unchanged, evidenced communication preferences accompanies
 * unrelated tasks; selection never truncates a statement.
 */
export async function recallScopedMemory(input: {
  store: CodingMemoryStore; projectId: string; userId: string; runtimeId: string; requestId: string
  query: string; now: string; budget: MemoryRecallBudget
}): Promise<RecalledMemory> {
  const scope = await executionScope({ store: input.store, projectId: input.projectId, userId: input.userId, runtimeId: input.runtimeId })
  // Lightweight test adapters may have no Memory store. A partially configured adapter is invalid.
  if (Boolean(input.store.retrieveAgentMemoryRevisions) !== Boolean(input.store.getAgentMemoryHead)) {
    throw new Error('Coding Memory store is incomplete')
  }
  const available = await input.store.retrieveAgentMemoryRevisions?.({
    stateVersion: 1, id: input.requestId,
    scope, runtimeId: input.runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
  }) ?? []
  const newestFirst = available.filter((revision) => revision.status === 'active' && (!revision.expiresAt || Date.parse(revision.expiresAt) > Date.parse(input.now))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  let relevant = rankMemoryByRelevance(newestFirst, input.query, (revision) => revision.statement)
    .map((entry) => entry.item)
  let considered = new Set(available.map((r) => r.id))
  let semanticRecall: RecalledMemory['semanticRecall']
  const provider = candidateRecall.get(input.store)
  if (provider && input.store.hydrateAgentMemoryRevisions) {
    let recalled: Awaited<ReturnType<MemoryCandidateRecall>> | undefined
    try { recalled = await provider({ scope, runtimeId: input.runtimeId, query: input.query }) }
    catch (error) {
      if (!(error instanceof HindsightError)) throw error
      semanticRecall = { mode: 'shadow', validCandidates: 0, degraded: true }
    }
    if (recalled) {
      if (recalled.candidates.length > 256) throw new Error('Memory candidate count exceeds maximum')
      const hydrated = await input.store.hydrateAgentMemoryRevisions({
        stateVersion: 1, id: input.requestId, scope, runtimeId: input.runtimeId,
        limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
      }, recalled.candidates.map((c) => c.id))
      const byId = new Map(hydrated.map((r) => [r.id, r]))
      const remote = [...new Set(recalled.candidates.map((c) => c.id))].flatMap((id) => {
        const r = byId.get(id)
        return r && recalled.candidates.some((c) => c.id === r.id && c.revision === r.revision && c.contentDigest === r.contentDigest) ? [r] : []
      })
      semanticRecall = { mode: recalled.mode, validCandidates: remote.length, degraded: false }
      if (recalled.mode === 'active') {
        const scores = new Map<string, { revision: DurableAgentMemoryRevision; score: number }>()
        for (const list of [relevant, remote]) list.forEach((revision, index) => {
          const entry = scores.get(revision.id) ?? { revision, score: 0 }
          entry.score += 1 / (60 + index + 1); scores.set(revision.id, entry)
        })
        relevant = [...scores.values()].sort((a, b) => b.score - a.score).map((entry) => entry.revision)
        considered = new Set([...considered, ...remote.map((r) => r.id)])
      }
    }
    const currentScope = await executionScope({ store: input.store, projectId: input.projectId, userId: input.userId, runtimeId: input.runtimeId })
    if (JSON.stringify(currentScope) !== JSON.stringify(scope)) throw new Error('Coding Context pairing changed during recall')
  }
  // Communication preferences apply across topics. Do not infer this privilege from
  // text alone, nor inherit it when a person has rewritten the original candidate.
  const candidates = new Map((await input.store.listAgentMemoryCandidates?.(input.projectId) ?? [])
    .map((candidate) => [candidate.id, candidate]))
  const preferences = newestFirst.filter((revision) => {
    const candidate = candidates.get(revision.sourceCandidateId)
    return candidate?.provenance.kind === 'learning_event' &&
      candidate.provenance.statementKind === 'communication_preference' &&
      candidate.statement === revision.statement && candidate.contentDigest === revision.contentDigest &&
      agentMemoryScopesMatch(candidate.scope, scope, revision.visibility === 'user_project' ? 'user_project' : 'exact')
  })
  const preferenceSelection = selectMemoryWithinBudget(preferences, (revision) => redactSensitiveText(revision.statement).value, {
    maxItems: Math.min(2, input.budget.maxItems), maxBytes: Math.floor(input.budget.maxBytes / 3),
  })
  const preferenceIds = new Set(preferenceSelection.map((revision) => revision.id))
  const selected = selectMemoryWithinBudget([
    ...preferenceSelection, ...relevant.filter((revision) => !preferenceIds.has(revision.id)),
  ], (revision) => redactSensitiveText(revision.statement).value, input.budget)
  const revisions: DurableAgentMemoryRevision[] = []
  const memories: CodingContextReceipt['memories'] = []
  for (const revision of selected) {
    const head = await input.store.getAgentMemoryHead!(revision.id)
    if (!head || head.status !== 'active' || head.currentRevision !== revision.revision) {
      throw new Error('Coding Memory source changed during Context preparation')
    }
    revisions.push(revision)
    memories.push({ id: revision.id, revision: revision.revision, headVersion: head.version, contentDigest: revision.contentDigest })
  }
  const communicationPreferences = revisions.flatMap((revision) => {
    if (!preferenceIds.has(revision.id)) return []
    const preference = memoryCommunicationPreference(revision.statement)
    return preference ? [{ memoryId: revision.id, preference }] : []
  })
  return { scope, runtimeId: input.runtimeId, revisions, memories, communicationPreferences, omittedMemoryCount: considered.size - revisions.length,
    ...(semanticRecall ? { semanticRecall } : {}) }
}

export async function recallCodingMemory(input: {
  store: CodingMemoryStore; run: WorkflowRun; codingRunId: string; userId: string; query: string; now: string
}): Promise<RecalledMemory> {
  return recallScopedMemory({
    store: input.store, projectId: input.run.projectId, userId: input.userId,
    runtimeId: `agent-runtime-coding-${input.codingRunId}`,
    requestId: `coding-memory-${codingPromptDigest(input.codingRunId).slice(0, 32)}`,
    query: input.query, now: input.now, budget: CODING_MEMORY_RECALL_BUDGET,
  })
}

const MAX_QUERY_PATHS = 24

/**
 * Recall query for a coding brief: the request and instruction plus the node and the
 * Gate-approved clarification/design (title, summary and cited repository paths).
 */
export function buildCodingMemoryQuery(input: {
  run: WorkflowRun; node: WorkflowNode; userInstruction: string; artifacts: readonly Artifact[]
}): string {
  const approvedIds = new Set(input.run.nodes
    .filter((node) => node.kind === 'gate' && node.status === 'success' && (node.stage === 'clarify' || node.stage === 'design'))
    .flatMap((node) => node.artifactIds))
  const approved = input.artifacts.filter((artifact) => artifact.runId === input.run.id && approvedIds.has(artifact.id) &&
    (artifact.kind === 'clarification' || artifact.kind === 'design'))
  const citedPaths = [...new Set(approved.flatMap((artifact) => [
    ...(artifact.clarificationRevision?.repositoryFindings?.citations ?? []),
    ...(artifact.designEvidence?.repositoryFindings?.citations ?? []),
  ].map((citation) => citation.path)))].slice(0, MAX_QUERY_PATHS)
  return [
    input.run.request, input.userInstruction, input.node.title, input.node.subtitle,
    ...approved.map((artifact) => `${artifact.title}\n${artifact.summary}`),
    citedPaths.join(' '),
  ].filter((part) => part.trim().length > 0).join('\n')
}

export async function assertCodingContextCurrent(input: {
  store: CodingMemoryStore; codingRun: CodingAgentRun; now: string
  assertRetrievedKnowledgeCurrent?: (manifest: RetrievedKnowledgeManifest) => Promise<void>
}): Promise<void> {
  const receipt = input.codingRun.contextReceipt
  // Historical runs never claimed Memory attachment. Their original recovery contract remains valid.
  if (!receipt) return
  if (receipt.stateVersion !== 1 || receipt.runId !== input.codingRun.runId ||
      receipt.nodeId !== input.codingRun.nodeId || receipt.scope.localProjectId !== input.codingRun.projectId ||
      receipt.promptDigest !== codingPromptDigest(input.codingRun.prompt)) {
    throw new Error('Coding Context receipt does not match the persisted brief')
  }
  const scope = await executionScope({
    store: input.store, projectId: input.codingRun.projectId,
    userId: input.codingRun.requestedBy, runtimeId: receipt.runtimeId,
  })
  if (JSON.stringify(scope) !== JSON.stringify(receipt.scope)) throw new Error('Coding Context pairing changed; start a new run')
  const retrieved = receipt.knowledgeContext?.retrievedKnowledge
  if (retrieved?.references.length) {
    if (retrieved.scope.projectId !== input.codingRun.projectId || retrieved.scope.userId !== input.codingRun.requestedBy) {
      throw new Error('Coding retrieved knowledge scope does not match the persisted brief')
    }
    if (!input.assertRetrievedKnowledgeCurrent) throw new Error('Coding retrieved knowledge verification is unavailable')
    await input.assertRetrievedKnowledgeCurrent(retrieved)
  }
  if (receipt.memories.length === 0) return
  if (!input.store.retrieveAgentMemoryRevisions || !input.store.getAgentMemoryHead) {
    throw new Error('Coding Memory store is unavailable')
  }
  const request = {
    stateVersion: 1, id: `coding-memory-check-${codingPromptDigest(input.codingRun.id).slice(0, 32)}`,
    scope, runtimeId: receipt.runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
  } as const
  const current = input.store.hydrateAgentMemoryRevisions
    ? await input.store.hydrateAgentMemoryRevisions(request, receipt.memories.map((m) => m.id))
    : await input.store.retrieveAgentMemoryRevisions(request)
  for (const identity of receipt.memories) {
    const revision = current.find((item) => item.id === identity.id)
    const head = await input.store.getAgentMemoryHead(identity.id)
    if (!revision || !head || head.status !== 'active' || head.version !== identity.headVersion ||
        revision.revision !== identity.revision || revision.contentDigest !== identity.contentDigest) {
      throw new Error('Coding Memory changed, expired or was deleted; start a new run with current Context')
    }
  }
}
