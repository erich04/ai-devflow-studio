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
export type HindsightDocument = {
  id: string; bankId: string; originalText: string; contentHash: string; memoryUnitCount: number
  updatedAt: string; metadata: Record<string, string>
}
export type HindsightExtractedFact = {
  id: string; text: string; documentId: string; factType: 'world' | 'experience'
  metadata: Record<string, string>; updatedAt: string
}

export class HindsightError extends Error {
  constructor(readonly code: 'timeout' | 'transport' | 'protocol' | 'http', readonly status?: number) {
    super(status ? `Hindsight HTTP ${status}` : `Hindsight ${code}`)
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HindsightError('protocol')
  return value as Record<string, unknown>
}
function stringMetadata(value: unknown): Record<string, string> {
  const parsed = object(value)
  if (Object.keys(parsed).length > 64 || Object.entries(parsed).some(([key, item]) =>
    key.length > 200 || typeof item !== 'string' || item.length > 2_000)) throw new HindsightError('protocol')
  return parsed as Record<string, string>
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
      const updates = { enable_observations: true, enable_auto_consolidation: true, entities_allow_free_form: true,
        retain_extraction_mode: 'concise', retain_mission: missions.retain, observations_mission: missions.observations,
        reflect_mission: missions.reflect }
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
    async getDocument(bank: string, documentId: string): Promise<HindsightDocument> {
      const item = await request('GET', `${bankPath(bank)}/documents/${encodeURIComponent(documentId)}`)
      if (item.id !== documentId || item.bank_id !== bank || typeof item.original_text !== 'string' ||
          typeof item.content_hash !== 'string' || !item.content_hash || typeof item.updated_at !== 'string' ||
          !Number.isSafeInteger(item.memory_unit_count) || Number(item.memory_unit_count) < 0 || Number(item.memory_unit_count) > 128) {
        throw new HindsightError('protocol')
      }
      return { id: documentId, bankId: bank, originalText: item.original_text, contentHash: item.content_hash,
        memoryUnitCount: Number(item.memory_unit_count), updatedAt: item.updated_at, metadata: stringMetadata(item.document_metadata) }
    },
    /** Exact source export, never semantic recall. A complete, immutable document is required. */
    async listDocumentFacts(bank: string, documentId: string, expectedCount: number): Promise<HindsightExtractedFact[]> {
      if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 128) throw new HindsightError('protocol')
      const facts: HindsightExtractedFact[] = []; const ids = new Set<string>(); const limit = 32
      let offset = 0
      do {
        const query = new URLSearchParams({ document_id: documentId, state: 'valid', limit: String(limit), offset: String(offset) })
        const page = await request('GET', `${bankPath(bank)}/memories/list?${query}`)
        if (page.total !== expectedCount || page.limit !== limit || page.offset !== offset || !Array.isArray(page.items) ||
            page.items.length !== Math.min(limit, expectedCount - offset)) throw new HindsightError('protocol')
        for (const raw of page.items) {
          const fact = object(raw)
          if (typeof fact.id !== 'string' || !fact.id || fact.id.length > 200 || ids.has(fact.id) ||
              typeof fact.text !== 'string' || !fact.text.trim() || Buffer.byteLength(fact.text) > 8_192 ||
              fact.document_id !== documentId || !['world', 'experience'].includes(String(fact.fact_type)) ||
              fact.state !== 'valid' || typeof fact.updated_at !== 'string' ||
              (fact.source_memory_ids != null && (!Array.isArray(fact.source_memory_ids) || fact.source_memory_ids.length > 0))) {
            throw new HindsightError('protocol')
          }
          ids.add(fact.id)
          facts.push({ id: fact.id, text: fact.text, documentId, factType: fact.fact_type as 'world' | 'experience',
            updatedAt: fact.updated_at, metadata: stringMetadata(fact.metadata) })
        }
        offset += page.items.length
      } while (offset < expectedCount)
      return facts
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
