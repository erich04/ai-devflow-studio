import { createHash } from 'node:crypto'
import {
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, CODING_MEMORY_RECALL_BUDGET, rankMemoryByRelevance, redactSensitiveText,
  selectMemoryWithinBudget,
  type AgentRuntimeScope, type Artifact, type CodingAgentRun, type CodingContextReceipt,
  type DurableAgentMemoryRevision, type MemoryRecallBudget, type WorkflowNode, type WorkflowRun,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

export type CodingMemoryStore = Partial<Pick<LocalStore,
  'retrieveAgentMemoryRevisions' | 'getAgentMemoryHead' | 'getDesktopPairingCredential'>>

export function codingPromptDigest(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex')
}

async function executionScope(input: {
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
  /** Retrievable but not attached: irrelevant, oversized or over budget. */
  omittedMemoryCount: number
}

/**
 * Scoped, ranked Memory recall shared by the coding brief, the stage Agent and the
 * discussion bar (ADR 0024). Retrieval keeps every existing scope, expiry and tombstone
 * rule; ranking is BM25 with a minimum of one shared non-stop-word term, newest first on
 * ties; selection never truncates a statement.
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
  const newestFirst = [...available].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  const relevant = rankMemoryByRelevance(newestFirst, input.query, (revision) => revision.statement)
    .map((entry) => entry.item)
  const selected = selectMemoryWithinBudget(relevant, (revision) => redactSensitiveText(revision.statement).value, input.budget)
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
  return { scope, runtimeId: input.runtimeId, revisions, memories, omittedMemoryCount: available.length - revisions.length }
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
  if (receipt.memories.length === 0) return
  if (!input.store.retrieveAgentMemoryRevisions || !input.store.getAgentMemoryHead) {
    throw new Error('Coding Memory store is unavailable')
  }
  const current = await input.store.retrieveAgentMemoryRevisions({
    stateVersion: 1, id: `coding-memory-check-${codingPromptDigest(input.codingRun.id).slice(0, 32)}`,
    scope, runtimeId: receipt.runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
  })
  for (const identity of receipt.memories) {
    const revision = current.find((item) => item.id === identity.id)
    const head = await input.store.getAgentMemoryHead(identity.id)
    if (!revision || !head || head.status !== 'active' || head.version !== identity.headVersion ||
        revision.revision !== identity.revision || revision.contentDigest !== identity.contentDigest) {
      throw new Error('Coding Memory changed, expired or was deleted; start a new run with current Context')
    }
  }
}
