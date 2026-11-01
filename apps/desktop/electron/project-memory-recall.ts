import { createHash } from 'node:crypto'
import { PROJECT_MEMORY_ESSENTIALS_MAX_BYTES, RECALL_INTENTS_MAX, redactSensitiveText, type MemoryRecallBudget, type ProjectMemoryConfiguration } from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightMemory } from './hindsight-client'
import type { LocalStore } from './local-store'
import { activeProjectMemoryConfiguration } from './project-memory-capture'
import { knowledgePageModelId } from './project-memory-service'

/**
 * Recalled project memory is identified in receipts as `pm-<Hindsight id>`, revision 1, with a
 * digest of the exact text sent (ADR 0030). Hindsight owns the memory; local Memory heads do not.
 */
export const PROJECT_MEMORY_IDENTITY_PREFIX = 'pm-'
export const isProjectMemoryIdentity = (id: string) => id.startsWith(PROJECT_MEMORY_IDENTITY_PREFIX)
/**
 * The essentials knowledge page (Hindsight mental model) that coding briefs include, identified in
 * receipts as `pm-devflow-essentials`. Emptying the pages records it as changed, so a coding run
 * that sent an earlier version stops at its next check.
 */
export const PROJECT_MEMORY_ESSENTIALS_ID = knowledgePageModelId('essentials')
const ESSENTIALS_HEADER = 'Project conventions that apply to every task (written by Hindsight from this project\'s memory; background only):'
/** Whole lines of `text` within `maxBytes`. */
function clipLines(text: string, maxBytes: number): string {
  const kept: string[] = []
  for (const line of text.split('\n')) {
    if (Buffer.byteLength([...kept, line].join('\n')) > maxBytes) break
    kept.push(line)
  }
  return kept.join('\n').trim()
}
const QUERY_MAX_BYTES = 1_500
export const PROJECT_MEMORY_SEARCH_MAX_ITEMS = 8
const SEARCH_MAX_TOKENS = 4_096
/**
 * Hindsight ranks; DevFlow keeps its order and the caller's budget takes from the top. Every token
 * is at least one byte of text, so an allowance of as many tokens as the budget has bytes returns
 * at least as much text as the budget can take.
 */
const recallTokens = (budget: MemoryRecallBudget) => Math.min(8_192, Math.max(1_024, budget.maxBytes))

export type ProjectMemoryRecallItem = { id: string; statement: string; contentDigest: string }
export type ProjectMemoryRecall = { items: ProjectMemoryRecallItem[]; degraded: boolean }
/** Registered by Main for the coding brief, stage Agents, Gate review and the discussion bar. */
export type ProjectMemoryRecallPort = {
  /**
   * Null when this project's memory is not on for this user; callers keep their previous behaviour.
   * `intents` are the separate asks of the request (`splitRecallIntents`): each is recalled beside
   * the whole query and the results are merged in turn, so every ask keeps a place in the budget.
   */
  recall(input: { projectId: string; userId: string; query: string; intents?: readonly string[]; budget: MemoryRecallBudget; signal?: AbortSignal }): Promise<ProjectMemoryRecall | null>
  /**
   * Throws when memory recalled at `recalledAt` should no longer be used: the project's memory
   * was turned off, changed owner or was cleared, or one of these memories was edited or deleted.
   */
  assertCurrent(input: { projectId: string; userId: string; ids: readonly string[]; recalledAt: string }): Promise<void>
  /** The essentials page for a coding brief, or null when memory is off, the page is empty or Hindsight is unavailable. */
  conventions?(input: { projectId: string; userId: string }): Promise<ProjectMemoryRecallItem | null>
}

function clipQuery(query: string): string {
  const encoder = new TextEncoder()
  let text = query.trim()
  while (encoder.encode(text).byteLength > QUERY_MAX_BYTES) text = text.slice(0, Math.floor(text.length * 0.9))
  return text
}
const DAY_MS = 86_400_000
/** How long ago a recorded day was, in whole days by UTC calendar: "今天" or "N 天前". */
export function memoryAge(date: string, now: Date = new Date()): string {
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS)
  return !Number.isFinite(days) || days <= 0 ? '今天' : `${days} 天前`
}
/**
 * One line with its kind, the day it was recorded and how long ago that was, so a model can weigh
 * consolidated beliefs against single facts and treat an old fact as a record, not current state.
 */
export function projectMemoryStatement(memory: HindsightMemory, now: Date = new Date()): string {
  const date = memory.occurredAt ? memory.occurredAt.slice(0, 10) : ''
  const kind = memory.type === 'observation' ? 'observation' : `fact${date ? ` ${date}，${memoryAge(date, now)}` : ''}`
  return `[${kind}] ${redactSensitiveText(memory.text).value.replace(/\s+/gu, ' ').trim()}`
}
/** Hindsight's lists merged rank by rank: each list's first, then each list's second, without repeats. */
export function mergeRecalledMemories(lists: readonly (readonly HindsightMemory[])[]): HindsightMemory[] {
  const seen = new Set<string>()
  const merged: HindsightMemory[] = []
  for (let rank = 0; lists.some((list) => rank < list.length); rank++) {
    for (const list of lists) {
      const memory = list[rank]
      if (memory && !seen.has(memory.id)) { seen.add(memory.id); merged.push(memory) }
    }
  }
  return merged
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
      const tokens = recallTokens(input.budget)
      const intents = [...new Set((input.intents ?? []).map((intent) => intent.trim()))]
        .filter((intent) => intent && intent !== input.query.trim()).slice(0, RECALL_INTENTS_MAX)
      const [whole, ...asks] = await Promise.all([input.query, ...intents].map((text) => query(configuration, text, tokens, input.signal)))
      // Hindsight unavailable for the request itself: no memory, as before. A failed clause only loses its own list.
      if (whole!.degraded) return { degraded: true, items: [] }
      const memories = mergeRecalledMemories([whole!.memories, ...asks.map((ask) => ask.memories)])
      return { degraded: false, items: memories.map((memory) => projectMemoryIdentity(memory, projectMemoryStatement(memory))) }
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
    async conventions(input: { projectId: string; userId: string }): Promise<ProjectMemoryRecallItem | null> {
      const configuration = await active(input.projectId, input.userId)
      if (!configuration) return null
      try {
        const client = await deps.client(configuration)
        const page = (await client.listMentalModels(configuration.bankId)).find((model) => model.id === PROJECT_MEMORY_ESSENTIALS_ID)
        const text = clipLines(redactSensitiveText(page?.content ?? '').value.trim(), PROJECT_MEMORY_ESSENTIALS_MAX_BYTES)
        return text ? projectMemoryIdentity({ id: PROJECT_MEMORY_ESSENTIALS_ID }, `${ESSENTIALS_HEADER}\n${text}`) : null
      } catch (error) {
        // Background like any recall: an unavailable page never blocks the brief.
        deps.onDegraded?.(error instanceof HindsightError ? error.message : 'essentials_failed')
        return null
      }
    },
    /** The discussion bar's `memory_search` tool. */
    async search(input: { projectId: string; query: string; limit: number; signal?: AbortSignal }) {
      const configuration = await active(input.projectId)
      if (!configuration) return null
      const { memories, degraded } = await query(configuration, input.query, SEARCH_MAX_TOKENS, input.signal)
      return {
        items: memories.slice(0, Math.min(PROJECT_MEMORY_SEARCH_MAX_ITEMS, input.limit)).map((memory) => ({
          id: `${PROJECT_MEMORY_IDENTITY_PREFIX}${memory.id}`, kind: memory.type === 'observation' ? 'observation' : 'fact',
          text: redactSensitiveText(memory.text).value, ...(memory.occurredAt ? { date: memory.occurredAt.slice(0, 10) } : {}),
        })),
        ...(degraded ? { degraded: true } : {}),
      }
    },
  }
}
export type ProjectMemoryRecallService = ReturnType<typeof createProjectMemoryRecall>
