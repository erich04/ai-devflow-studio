import { createHash } from 'node:crypto'
import { rankMemoryByRelevance, redactSensitiveText, type MemoryRecallBudget, type ProjectMemoryConfiguration } from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightMemory } from './hindsight-client'
import type { LocalStore } from './local-store'
import { activeProjectMemoryConfiguration } from './project-memory-capture'

/**
 * Recalled project memory is identified in receipts as `pm-<Hindsight id>`, revision 1, with a
 * digest of the exact text sent (ADR 0030). Hindsight owns the memory; local Memory heads do not.
 */
export const PROJECT_MEMORY_IDENTITY_PREFIX = 'pm-'
export const isProjectMemoryIdentity = (id: string) => id.startsWith(PROJECT_MEMORY_IDENTITY_PREFIX)
const QUERY_MAX_BYTES = 1_500
export const PROJECT_MEMORY_SEARCH_MAX_ITEMS = 8

export type ProjectMemoryRecallItem = { id: string; statement: string; contentDigest: string }
export type ProjectMemoryRecall = { items: ProjectMemoryRecallItem[]; degraded: boolean }
/** Registered by Main for the coding brief, stage Agents, Gate review and the discussion bar. */
export type ProjectMemoryRecallPort = {
  /** Null when this project's memory is not on for this user; callers keep their previous behaviour. */
  recall(input: { projectId: string; userId: string; query: string; budget: MemoryRecallBudget; signal?: AbortSignal }): Promise<ProjectMemoryRecall | null>
  /**
   * Throws when memory recalled at `recalledAt` should no longer be used: the project's memory
   * was turned off, changed owner or was cleared, or one of these memories was edited or deleted.
   */
  assertCurrent(input: { projectId: string; userId: string; ids: readonly string[]; recalledAt: string }): Promise<void>
}

function clipQuery(query: string): string {
  const encoder = new TextEncoder()
  let text = query.trim()
  while (encoder.encode(text).byteLength > QUERY_MAX_BYTES) text = text.slice(0, Math.floor(text.length * 0.9))
  return text
}
/**
 * Hindsight's bundled embedder and reranker are English models, so its order says little about
 * a Chinese query. Fuse it (reciprocal rank) with DevFlow's own BM25, which tokenizes Chinese,
 * so the caller's budget keeps the memories that actually match. Unmatched items stay, ranked lower.
 */
export function rankProjectMemories(memories: readonly HindsightMemory[], query: string): HindsightMemory[] {
  const lexical = new Map(rankMemoryByRelevance(memories, query, (memory) => memory.text).map((entry, rank) => [entry.item.id, rank]))
  return memories.map((memory, rank) => ({ memory, rank,
    score: 1 / (60 + rank + 1) + (lexical.has(memory.id) ? 1 / (60 + lexical.get(memory.id)! + 1) : 0) }))
    .sort((left, right) => right.score - left.score || left.rank - right.rank).map((entry) => entry.memory)
}
/** One line with its kind and date, so a model can weigh consolidated beliefs against single facts. */
export function projectMemoryStatement(memory: HindsightMemory): string {
  const date = memory.occurredAt ? memory.occurredAt.slice(0, 10) : ''
  const kind = memory.type === 'observation' ? 'observation' : `fact${date ? ` ${date}` : ''}`
  return `[${kind}] ${redactSensitiveText(memory.text).value.replace(/\s+/gu, ' ').trim()}`
}
export function projectMemoryIdentity(memory: Pick<HindsightMemory, 'id'>, statement: string): ProjectMemoryRecallItem {
  return { id: `${PROJECT_MEMORY_IDENTITY_PREFIX}${memory.id}`, statement,
    contentDigest: `sha256:${createHash('sha256').update(statement, 'utf8').digest('hex')}` }
}

type RecallStore = Pick<LocalStore, 'getDesktopPairingCredential' | 'resolveLocalProjectMemoryPrincipal' | 'getProjectMemoryConfiguration'>
export function createProjectMemoryRecall(deps: {
  store: RecallStore
  transportAvailable: boolean
  client(configuration: ProjectMemoryConfiguration): Promise<HindsightClient>
  onDegraded?(reason: string): void
}) {
  async function active(projectId: string, userId?: string) {
    if (!deps.transportAvailable) return null
    const configuration = await activeProjectMemoryConfiguration(deps.store, projectId)
    return configuration && (userId === undefined || configuration.ownerUserId === userId) ? configuration : null
  }
  async function query(configuration: ProjectMemoryConfiguration, text: string, maxTokens: number, signal?: AbortSignal) {
    try {
      const client = await deps.client(configuration)
      const memories = await client.recallMemories(configuration.bankId, { query: clipQuery(text), maxTokens, ...(signal ? { signal } : {}) })
      return { memories, degraded: false }
    } catch (error) {
      signal?.throwIfAborted()
      // Memory is background: an unavailable Hindsight never blocks the work that asked for it.
      deps.onDegraded?.(error instanceof HindsightError ? error.message : 'recall_failed')
      return { memories: [] as HindsightMemory[], degraded: true }
    }
  }
  return {
    async recall(input: Parameters<ProjectMemoryRecallPort['recall']>[0]): Promise<ProjectMemoryRecall | null> {
      const configuration = await active(input.projectId, input.userId)
      if (!configuration || !input.query.trim()) return configuration ? { items: [], degraded: false } : null
      // Ask for more than the budget so re-ranking has candidates; the caller's byte budget applies after.
      const maxTokens = Math.min(8_192, Math.max(1_024, input.budget.maxBytes))
      const { memories, degraded } = await query(configuration, input.query, maxTokens, input.signal)
      return { degraded, items: rankProjectMemories(memories, input.query).map((memory) => projectMemoryIdentity(memory, projectMemoryStatement(memory))) }
    },
    async assertCurrent(input: Parameters<ProjectMemoryRecallPort['assertCurrent']>[0]): Promise<void> {
      const configuration = await active(input.projectId, input.userId)
      if (!configuration) throw new Error('Project memory was turned off or changed owner')
      const recalledAt = Date.parse(input.recalledAt)
      if (!Number.isFinite(recalledAt)) throw new Error('Project memory recall time is unknown')
      const changedSince = (time: string | undefined) => time !== undefined && Date.parse(time) >= recalledAt
      if (changedSince(configuration.clearedAt)) throw new Error('Project memory was cleared')
      if (input.ids.some((id) => changedSince(configuration.changedMemories?.[id.slice(PROJECT_MEMORY_IDENTITY_PREFIX.length)]))) {
        throw new Error('A recalled memory was edited or deleted')
      }
    },
    /** The discussion bar's `memory_search` tool. */
    async search(input: { projectId: string; query: string; limit: number; signal?: AbortSignal }) {
      const configuration = await active(input.projectId)
      if (!configuration) return null
      const { memories, degraded } = await query(configuration, input.query, 4_096, input.signal)
      return {
        items: rankProjectMemories(memories, input.query).slice(0, Math.min(PROJECT_MEMORY_SEARCH_MAX_ITEMS, input.limit)).map((memory) => ({
          id: `${PROJECT_MEMORY_IDENTITY_PREFIX}${memory.id}`, kind: memory.type === 'observation' ? 'observation' : 'fact',
          text: redactSensitiveText(memory.text).value, ...(memory.occurredAt ? { date: memory.occurredAt.slice(0, 10) } : {}),
        })),
        ...(degraded ? { degraded: true } : {}),
      }
    },
  }
}
export type ProjectMemoryRecallService = ReturnType<typeof createProjectMemoryRecall>
