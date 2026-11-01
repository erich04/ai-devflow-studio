import { isDeepStrictEqual } from 'node:util'

/** HTTP contract pinned to vectorize-io/hindsight v1.0.0, commit below.
 * No SDK dependency. Recall exposes source identities only; exported extraction
 * text remains untrusted until the host checks its immutable source and policy.
 */
export const HINDSIGHT_PROTOCOL = {
  version: '1.0.0', commit: '39c65ffe2f140d0c84cee58566cad8900c5b9908',
} as const

export type HindsightCandidate = { documentId: string; metadata: Record<string, string> }
export type HindsightOperation = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'not_found'
export type HindsightClient = ReturnType<typeof createHindsightClient>
export type HindsightMemory = {
  id: string; text: string; type: 'observation' | 'world' | 'experience'; documentId?: string; occurredAt?: string
}
export type HindsightMentalModelDefinition = {
  id: string; name: string; sourceQuery: string; maxTokens: number; trigger: Record<string, unknown>
}
export type HindsightMentalModel = { id: string; content: string; stale: boolean; refreshedAt?: string; failedAt?: string }

export class HindsightError extends Error {
  constructor(readonly code: 'timeout' | 'transport' | 'protocol' | 'http', readonly status?: number) {
    super(status ? `Hindsight HTTP ${status}` : `Hindsight ${code}`)
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HindsightError('protocol')
  return value as Record<string, unknown>
}
export function normalizeHindsightEndpoint(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Hindsight endpoint must be HTTPS or loopback HTTP, without credentials or a path')
  }
  return url.origin
}
export function createHindsightClient(input: {
  endpoint: string; apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number
}) {
  const endpoint = normalizeHindsightEndpoint(input.endpoint)
  const fetcher = input.fetcher ?? fetch
  const bankPath = (bank: string) => `/v1/default/banks/${encodeURIComponent(bank)}`
  async function request(method: string, path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 2_000): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new HindsightError('timeout')) }, input.timeoutMs ?? timeoutMs)
    })
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    let onAbort: (() => void) | undefined
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => reject(new HindsightError('transport'))
      if (signal?.aborted) reject(new HindsightError('transport'))
      else signal?.addEventListener('abort', onAbort, { once: true })
      // The combined signal is passed to fetch; the separate deadline also bounds broken adapters.
    })
    try {
      return await Promise.race([deadline, abort, (async () => {
        const response = await fetcher(`${endpoint}${path}`, {
          method, signal: combined, redirect: 'error',
          headers: { 'Content-Type': 'application/json', ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new HindsightError('http', response.status) }
        if (Number(response.headers.get('Content-Length')) > 512 * 1024) { void response.body?.cancel().catch(() => {}); throw new HindsightError('protocol') }
        const reader = response.body?.getReader()
        if (!reader) throw new HindsightError('protocol')
        const chunks: Uint8Array[] = []; let size = 0
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.byteLength
            if (size > 512 * 1024) throw new HindsightError('protocol')
            chunks.push(next.value)
          }
          return object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      })()])
    } catch (error) { throw error instanceof HindsightError ? error : new HindsightError('transport') }
    finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort) }
  }
  return {
    async configureBank(bank: string, labels: readonly unknown[], mode: 'concise' | 'verbatim' | 'chunks') {
      const version = await request('GET', '/version')
      if (version.api_version !== HINDSIGHT_PROTOCOL.version) throw new HindsightError('protocol')
      await request('PUT', bankPath(bank), { name: bank, enable_observations: false, retain_extraction_mode: mode })
      const updates = { enable_observations: false, enable_auto_consolidation: false,
        entities_allow_free_form: false, entity_labels: labels, retain_extraction_mode: mode }
      const response = await request('PATCH', `${bankPath(bank)}/config`, { updates })
      const config = object(response.config)
      if (response.bank_id !== bank || config.enable_observations !== false ||
          config.enable_auto_consolidation !== false || config.entities_allow_free_form !== false ||
          config.retain_extraction_mode !== mode || !isDeepStrictEqual(config.entity_labels, labels)) {
        throw new HindsightError('protocol')
      }
    },
    async retain(bank: string, item: { documentId: string; operationId: string; content: string; metadata: Record<string, string> }) {
      const response = await request('POST', `${bankPath(bank)}/memories`, {
        async: true, operation_id: item.operationId,
        items: [{ document_id: item.documentId, content: item.content, metadata: item.metadata }],
      })
      if (response.success !== true || response.bank_id !== bank || response.async !== true ||
          response.operation_id !== item.operationId || response.items_count !== 1 ||
          (response.operation_ids != null && JSON.stringify(response.operation_ids) !== JSON.stringify([item.operationId]))) {
        throw new HindsightError('protocol')
      }
    },
    /**
     * A project memory bank (ADR 0030): Hindsight extracts facts and consolidates observations
     * itself. Additive to the knowledge banks above, which keep consolidation off.
     */
    async configureMemoryBank(bank: string, missions: { retain: string; observations: string; reflect: string }) {
      const version = await request('GET', '/version')
      if (version.api_version !== HINDSIGHT_PROTOCOL.version) throw new HindsightError('protocol')
      await request('PUT', bankPath(bank), { name: bank })
      // Recall order is Hindsight's fusion of its vector, keyword and time-based searches
      // (docs/engineering/project-memory.md). No cross-encoder: the image's is an English model,
      // and a multilingual one takes 2 to 8 seconds per recall on two CPUs. No graph expansion:
      // nearly every memory of a project shares its entities, so the expansion adds the same
      // well-linked memories to every answer and they push the vector matches down.
      const updates = { enable_observations: true, enable_auto_consolidation: true, entities_allow_free_form: true,
        retain_extraction_mode: 'concise', retain_mission: missions.retain, observations_mission: missions.observations,
        reflect_mission: missions.reflect, enable_reranking: false, enable_graph_retrieval: false }
      const response = await request('PATCH', `${bankPath(bank)}/config`, { updates })
      const config = object(response.config)
      if (response.bank_id !== bank || Object.entries(updates).some(([key, value]) => config[key] !== value)) throw new HindsightError('protocol')
    },
    /** One source document per call. The same document id replaces its earlier revision. */
    async retainDocument(bank: string, item: {
      documentId: string; operationId: string; content: string; context: string; timestamp: string
      tags: readonly string[]; metadata: Record<string, string>
    }) {
      const response = await request('POST', `${bankPath(bank)}/memories`, {
        async: true, operation_id: item.operationId,
        items: [{ document_id: item.documentId, content: item.content, context: item.context, timestamp: item.timestamp,
          tags: [...item.tags], metadata: item.metadata, update_mode: 'replace',
          // One belief set per project: which source produced a fact does not split observations.
          observation_scopes: 'shared' }],
      })
      if (response.success !== true || response.bank_id !== bank || response.async !== true ||
          response.operation_id !== item.operationId || response.items_count !== 1 ||
          (response.operation_ids != null && JSON.stringify(response.operation_ids) !== JSON.stringify([item.operationId]))) {
        throw new HindsightError('protocol')
      }
    },
    async operation(bank: string, operationId: string): Promise<HindsightOperation> {
      let response: Record<string, unknown>
      try { response = await request('GET', `${bankPath(bank)}/operations/${encodeURIComponent(operationId)}`) }
      catch (error) { if (error instanceof HindsightError && error.status === 404) return 'not_found'; throw error }
      if (response.operation_id !== operationId || !['pending', 'processing', 'completed', 'failed', 'cancelled', 'not_found'].includes(String(response.status))) {
        throw new HindsightError('protocol')
      }
      // Completed operations retain the historical next_retry_at field upstream.
      // A non-completed retry or live child can still write, so cannot settle deletion.
      if ((response.status !== 'completed' && response.next_retry_at) || (Array.isArray(response.child_operations) &&
          response.child_operations.some((child) => !['completed', 'failed'].includes(String(object(child).status))))) return 'processing'
      return response.status as HindsightOperation
    },
    async deleteDocument(bank: string, documentId: string): Promise<void> {
      try {
        const result = await request('DELETE', `${bankPath(bank)}/documents/${encodeURIComponent(documentId)}`)
        if (result.success !== true || result.document_id !== documentId) throw new HindsightError('protocol')
      } catch (error) { if (!(error instanceof HindsightError && error.status === 404)) throw error }
    },
    /**
     * Project memory recall (ADR 0030): Hindsight is the memory's authority, so its text is used
     * as recalled. Observations replace the raw facts they consolidate. Retrieval only; no model call.
     */
    async recallMemories(bank: string, input: { query: string; maxTokens: number; signal?: AbortSignal }): Promise<HindsightMemory[]> {
      if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 64 || input.maxTokens > 8_192) throw new HindsightError('protocol')
      const result = await request('POST', `${bankPath(bank)}/memories/recall`, {
        query: input.query, types: ['observation', 'world', 'experience'], prefer_observations: true,
        budget: 'low', max_tokens: input.maxTokens, include: { entities: null },
      }, input.signal, 5_000)
      // max_tokens bounds the text; many short memories can still be several hundred results.
      if (!Array.isArray(result.results) || result.results.length > 1_024) throw new HindsightError('protocol')
      const seen = new Set<string>()
      return result.results.flatMap((value): HindsightMemory[] => {
        const item = object(value)
        if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(item.id) || seen.has(item.id) ||
            typeof item.text !== 'string' || !item.text.trim() || Buffer.byteLength(item.text) > 8_192 ||
            !['observation', 'world', 'experience'].includes(String(item.type))) return []
        seen.add(item.id)
        const occurredAt = [item.occurred_start, item.mentioned_at].find((time): time is string =>
          typeof time === 'string' && Number.isFinite(Date.parse(time)))
        return [{ id: item.id, text: item.text, type: item.type as HindsightMemory['type'],
          ...(typeof item.document_id === 'string' && item.document_id.length <= 300 ? { documentId: item.document_id } : {}),
          ...(occurredAt ? { occurredAt } : {}) }]
      })
    },
    /** One page of valid memories of one type, for the memory page. */
    async listMemories(bank: string, input: { type: HindsightMemory['type']; query?: string; offset: number; limit: number }) {
      if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new HindsightError('protocol')
      }
      const query = new URLSearchParams({ type: input.type, state: 'valid', limit: String(input.limit), offset: String(input.offset),
        ...(input.query?.trim() ? { q: input.query.trim() } : {}) })
      const page = await request('GET', `${bankPath(bank)}/memories/list?${query}`, undefined, undefined, 5_000)
      if (!Array.isArray(page.items) || page.items.length > input.limit || !Number.isSafeInteger(page.total) || Number(page.total) < 0) {
        throw new HindsightError('protocol')
      }
      const items = page.items.flatMap((value): Array<HindsightMemory & { editedAt?: string }> => {
        const item = object(value)
        if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(item.id) || typeof item.text !== 'string' ||
            !item.text.trim() || Buffer.byteLength(item.text) > 16_384 || item.fact_type !== input.type) return []
        const occurredAt = [item.occurred_start, item.mentioned_at, item.date].find((time): time is string =>
          typeof time === 'string' && Number.isFinite(Date.parse(time)))
        return [{ id: item.id, text: item.text, type: input.type,
          ...(typeof item.document_id === 'string' && item.document_id.length <= 300 ? { documentId: item.document_id } : {}),
          ...(occurredAt ? { occurredAt } : {}),
          ...(typeof item.edited_at === 'string' && Number.isFinite(Date.parse(item.edited_at)) ? { editedAt: item.edited_at } : {}) }]
      })
      return { items, total: Number(page.total) }
    },
    /** Hindsight re-embeds the memory, drops what was derived from it and consolidates again. */
    async updateMemory(bank: string, memoryId: string, text: string) {
      await request('PATCH', `${bankPath(bank)}/memories/${encodeURIComponent(memoryId)}`, { text }, undefined, 10_000)
    },
    /** Soft-retires a memory: excluded from recall and consolidation, its derived observations pruned. */
    async invalidateMemory(bank: string, memoryId: string, reason: string) {
      await request('PATCH', `${bankPath(bank)}/memories/${encodeURIComponent(memoryId)}`, { state: 'invalidated', reason }, undefined, 10_000)
    },
    /** Removes a whole bank: documents, memories and configuration. A missing bank is already gone. */
    async deleteBank(bank: string) {
      try {
        const result = await request('DELETE', bankPath(bank), undefined, undefined, 10_000)
        if (result.success !== true) throw new HindsightError('protocol')
      } catch (error) { if (!(error instanceof HindsightError && error.status === 404)) throw error }
    },
    /**
     * Creates a knowledge page (mental model) or brings an existing one up to this definition.
     * In a bank without memories the first refresh finds nothing and makes no model call.
     */
    async ensureMentalModel(bank: string, page: HindsightMentalModelDefinition) {
      const path = `${bankPath(bank)}/mental-models/${encodeURIComponent(page.id)}`
      const body = { name: page.name, source_query: page.sourceQuery, max_tokens: page.maxTokens, trigger: page.trigger }
      let existing: Record<string, unknown> | undefined
      try { existing = await request('GET', path) }
      catch (error) { if (!(error instanceof HindsightError && error.status === 404)) throw error }
      if (!existing) {
        const created = await request('POST', `${bankPath(bank)}/mental-models`, { id: page.id, ...body, tags: [] }, undefined, 10_000)
        if (created.mental_model_id !== page.id) throw new HindsightError('protocol')
        return
      }
      const trigger = existing.trigger && typeof existing.trigger === 'object' ? existing.trigger as Record<string, unknown> : {}
      if (existing.name !== page.name || existing.source_query !== page.sourceQuery || existing.max_tokens !== page.maxTokens ||
          Object.entries(page.trigger).some(([key, value]) => !isDeepStrictEqual(trigger[key], value))) {
        await request('PATCH', path, body, undefined, 10_000)
      }
    },
    /** The bank's knowledge pages with their markdown content; reading them makes no model call. */
    async listMentalModels(bank: string): Promise<HindsightMentalModel[]> {
      const page = await request('GET', `${bankPath(bank)}/mental-models?detail=content&limit=100`, undefined, undefined, 5_000)
      if (!Array.isArray(page.items) || page.items.length > 100) throw new HindsightError('protocol')
      const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
      return page.items.flatMap((value): HindsightMentalModel[] => {
        const item = object(value)
        if (typeof item.id !== 'string' || !/^[a-z0-9-]{1,100}$/u.test(item.id) || (item.content != null && typeof item.content !== 'string') ||
            Buffer.byteLength(String(item.content ?? '')) > 64 * 1024) return []
        const refreshedAt = time(item.last_refreshed_at); const failedAt = time(item.last_refresh_failed_at)
        return [{ id: item.id, content: String(item.content ?? ''), stale: item.is_stale === true,
          ...(refreshedAt ? { refreshedAt } : {}), ...(failedAt ? { failedAt } : {}) }]
      })
    },
    /** Empties a page without a model call; the next refresh writes it again from scratch. A missing page is already empty. */
    async clearMentalModel(bank: string, id: string) {
      try { await request('POST', `${bankPath(bank)}/mental-models/${encodeURIComponent(id)}/clear`, {}, undefined, 5_000) }
      catch (error) { if (!(error instanceof HindsightError && error.status === 404)) throw error }
    },
    /** Starts a refresh: a reflect run that rewrites the page, charged like any extraction call. */
    async refreshMentalModel(bank: string, id: string): Promise<string> {
      const result = await request('POST', `${bankPath(bank)}/mental-models/${encodeURIComponent(id)}/refresh`, {}, undefined, 10_000)
      if (typeof result.operation_id !== 'string' || !result.operation_id) throw new HindsightError('protocol')
      return result.operation_id
    },
    async recall(bank: string, query: string, signal?: AbortSignal): Promise<HindsightCandidate[]> {
      // Local CPU reranking of a stage summary can exceed the short control-request
      // deadline. Bound retrieval separately; cancellation still aborts immediately.
      const result = await request('POST', `${bankPath(bank)}/memories/recall`,
        { query, types: ['world', 'experience'], budget: 'low', max_tokens: 2048 }, signal, 5_000)
      if (!Array.isArray(result.results) || result.results.length > 256) throw new HindsightError('protocol')
      return result.results.flatMap((value): HindsightCandidate[] => {
        const item = object(value)
        if (!['world', 'experience'].includes(String(item.type)) || typeof item.document_id !== 'string' || item.document_id.length > 200 ||
            !item.metadata || typeof item.metadata !== 'object' || Array.isArray(item.metadata) ||
            Object.values(item.metadata).some((value) => typeof value !== 'string')) return []
        return [{ documentId: item.document_id, metadata: item.metadata as Record<string, string> }]
      })
    },
  }
}
