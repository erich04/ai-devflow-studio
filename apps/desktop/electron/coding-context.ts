import { createHash } from 'node:crypto'
import {
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, CODING_MEMORY_RECALL_BUDGET, selectMemoryWithinBudget,
  type AgentRuntimeScope, type Artifact, type CodingAgentRun, type CodingContextReceipt,
  type MemoryRecallBudget, type WorkflowNode, type WorkflowRun,
  type RetrievedKnowledgeManifest,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { isProjectMemoryIdentity, type ProjectMemoryRecallPort } from './project-memory-recall'

/** Local Memory is only read to re-check receipts of runs created before ADR 0030. */
export type CodingMemoryStore = Partial<Pick<LocalStore,
  'retrieveAgentMemoryRevisions' | 'hydrateAgentMemoryRevisions' | 'getAgentMemoryHead' | 'getDesktopPairingCredential' |
  'resolveLocalProjectMemoryPrincipal'>>
const projectMemoryRecall = new WeakMap<CodingMemoryStore, ProjectMemoryRecallPort>()
/** Registered by Main (ADR 0030): recall comes only from the project's Hindsight bank. */
export function registerProjectMemoryRecall(store: CodingMemoryStore, recall: ProjectMemoryRecallPort) {
  projectMemoryRecall.set(store, recall)
}
/**
 * Re-checks recalled project memory (`pm-` identities) before it is relied on again, and
 * returns the local Memory identities that still need their own check.
 */
export async function assertProjectMemoryCurrent<T extends { id: string }>(store: CodingMemoryStore, input: {
  projectId: string; userId: string; identities: readonly T[]; recalledAt: string
}): Promise<T[]> {
  const local = input.identities.filter((identity) => !isProjectMemoryIdentity(identity.id))
  if (local.length === input.identities.length) return local
  const port = projectMemoryRecall.get(store)
  if (!port) throw new Error('Project memory verification is unavailable')
  await port.assertCurrent({ projectId: input.projectId, userId: input.userId, recalledAt: input.recalledAt,
    ids: input.identities.filter((identity) => isProjectMemoryIdentity(identity.id)).map((identity) => identity.id) })
  return local
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
  return {
    kind: 'local', organizationId: null, projectId: null, userId: input.userId,
    sessionId: `coding-session-${codingPromptDigest(input.runtimeId).slice(0, 32)}`,
    localProjectId: input.projectId,
  }
}

export type RecalledMemory = {
  scope: AgentRuntimeScope
  runtimeId: string
  /** When the memory was recalled; later edits, deletions or a clear make it stale. */
  recalledAt: string
  /** What prompts render, in order. */
  context: Array<{ id: string; revision: number; statement: string }>
  memories: CodingContextReceipt['memories']
  /** Recalled but not attached: over the item or byte budget. */
  omittedMemoryCount: number
  /** Present when the project's memory is on (ADR 0030). */
  projectMemory?: { degraded: boolean }
}

/**
 * Project memory recall shared by the coding brief, stage Agents, Gate review and the discussion
 * bar (ADR 0030). Memory lives only in the project's Hindsight bank: when the project's memory is
 * off there is no memory, and local Memory is never consulted. Selection never splits a memory.
 */
export async function recallScopedMemory(input: {
  store: CodingMemoryStore; projectId: string; userId: string; runtimeId: string; requestId: string
  query: string; now: string; budget: MemoryRecallBudget
}): Promise<RecalledMemory> {
  const scope = await executionScope({ store: input.store, projectId: input.projectId, userId: input.userId, runtimeId: input.runtimeId })
  const projectMemory = await projectMemoryRecall.get(input.store)?.recall({
    projectId: input.projectId, userId: input.userId, query: input.query, budget: input.budget,
  })
  if (!projectMemory) return { scope, runtimeId: input.runtimeId, recalledAt: input.now, context: [], memories: [], omittedMemoryCount: 0 }
  // Hindsight and DevFlow's re-ranking already ordered the memory for this query.
  const selected = selectMemoryWithinBudget(projectMemory.items, (item) => item.statement, input.budget)
  const currentScope = await executionScope({ store: input.store, projectId: input.projectId, userId: input.userId, runtimeId: input.runtimeId })
  if (JSON.stringify(currentScope) !== JSON.stringify(scope)) throw new Error('Coding Context pairing changed during recall')
  return { scope, runtimeId: input.runtimeId, recalledAt: input.now,
    context: selected.map(({ id, statement }) => ({ id, revision: 1, statement })),
    memories: selected.map(({ id, contentDigest }) => ({ id, revision: 1, headVersion: 1, contentDigest })),
    omittedMemoryCount: projectMemory.items.length - selected.length,
    projectMemory: { degraded: projectMemory.degraded } }
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
  let localMemories: CodingContextReceipt['memories']
  try {
    // The brief and its recall are made when the run is created.
    localMemories = await assertProjectMemoryCurrent(input.store, { projectId: input.codingRun.projectId,
      userId: input.codingRun.requestedBy, identities: receipt.memories, recalledAt: input.codingRun.startedAt })
  } catch {
    throw new Error('Coding Memory changed, expired or was deleted; start a new run with current Context')
  }
  if (localMemories.length === 0) return
  if (!input.store.retrieveAgentMemoryRevisions || !input.store.getAgentMemoryHead) {
    throw new Error('Coding Memory store is unavailable')
  }
  const request = {
    stateVersion: 1, id: `coding-memory-check-${codingPromptDigest(input.codingRun.id).slice(0, 32)}`,
    scope, runtimeId: receipt.runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
  } as const
  const current = input.store.hydrateAgentMemoryRevisions
    ? await input.store.hydrateAgentMemoryRevisions(request, localMemories.map((m) => m.id))
    : await input.store.retrieveAgentMemoryRevisions(request)
  for (const identity of localMemories) {
    const revision = current.find((item) => item.id === identity.id)
    const head = await input.store.getAgentMemoryHead(identity.id)
    if (!revision || !head || head.status !== 'active' || head.version !== identity.headVersion ||
        revision.revision !== identity.revision || revision.contentDigest !== identity.contentDigest) {
      throw new Error('Coding Memory changed, expired or was deleted; start a new run with current Context')
    }
  }
}
