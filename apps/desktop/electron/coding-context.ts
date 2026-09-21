import { createHash } from 'node:crypto'
import {
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, contextBytes, redactSensitiveText,
  type AgentRuntimeScope, type CodingAgentRun, type CodingContextReceipt,
  type DurableAgentMemoryRevision, type WorkflowRun,
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

function relevance(statement: string, query: string): number {
  const words = new Set(query.toLocaleLowerCase().match(/[a-z0-9_]{3,}|[\p{Script=Han}]{1,2}/gu) ?? [])
  const text = statement.toLocaleLowerCase()
  return [...words].filter((word) => text.includes(word)).length
}

export async function recallCodingMemory(input: {
  store: CodingMemoryStore; run: WorkflowRun; codingRunId: string; userId: string; query: string; now: string
}) {
  const runtimeId = `agent-runtime-coding-${input.codingRunId}`
  const scope = await executionScope({ store: input.store, projectId: input.run.projectId, userId: input.userId, runtimeId })
  // Lightweight test adapters may have no Memory store. A partially configured adapter is invalid.
  if (Boolean(input.store.retrieveAgentMemoryRevisions) !== Boolean(input.store.getAgentMemoryHead)) {
    throw new Error('Coding Memory store is incomplete')
  }
  const available = await input.store.retrieveAgentMemoryRevisions?.({
    stateVersion: 1, id: `coding-memory-${codingPromptDigest(input.codingRunId).slice(0, 32)}`,
    scope, runtimeId, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: input.now,
  }) ?? []
  const ranked = [...available].sort((a, b) =>
    relevance(b.statement, input.query) - relevance(a.statement, input.query) ||
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  )
  const revisions: DurableAgentMemoryRevision[] = []
  const memories: CodingContextReceipt['memories'] = []
  let usedBytes = 0
  for (const revision of ranked) {
    const size = contextBytes(redactSensitiveText(revision.statement).value) + 200
    if (revisions.length >= 8 || usedBytes + size > 4_000) continue
    const head = await input.store.getAgentMemoryHead!(revision.id)
    if (!head || head.status !== 'active' || head.currentRevision !== revision.revision) {
      throw new Error('Coding Memory source changed during Context preparation')
    }
    revisions.push(revision)
    memories.push({ id: revision.id, revision: revision.revision, headVersion: head.version, contentDigest: revision.contentDigest })
    usedBytes += size
  }
  return { scope, runtimeId, revisions, memories, omittedMemoryCount: available.length - revisions.length }
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
