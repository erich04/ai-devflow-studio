// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createHindsightClient } from './hindsight-client'

it('submits one immutable async document with the caller operation ID and validates the receipt', async () => {
  const requests: { url: string; body: unknown; authorization: string | null }[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get('Authorization') })
    return Response.json({ success: true, bank_id: 'bank-1', items_count: 1, async: true, operation_id: 'op-1' })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8888', apiKey: 'test-key', fetcher })
  await client.retain('bank-1', { documentId: 'doc-1', operationId: 'op-1', content: 'Reference text', metadata: { df_digest: 'digest' } })
  expect(requests).toEqual([{
    url: 'http://127.0.0.1:8888/v1/default/banks/bank-1/memories', authorization: 'Bearer test-key',
    body: { async: true, operation_id: 'op-1', items: [{ document_id: 'doc-1', content: 'Reference text', metadata: { df_digest: 'digest' } }] },
  }])
  fetcher.mockResolvedValueOnce(Response.json({ success: true, bank_id: 'foreign', async: true, operation_id: 'op-1' }))
  await expect(client.retain('bank-1', { documentId: 'doc-1', operationId: 'op-1', content: 'Reference text', metadata: {} })).rejects.toThrow('protocol')
})

it('bounds remote waits and rejects redirects, credentials in URLs and oversized responses without exposing response text', async () => {
  expect(() => createHindsightClient({ endpoint: 'http://user:secret@example.com' })).toThrow()
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', timeoutMs: 10,
    fetcher: async () => new Promise(() => {}) })
  await expect(client.recall('bank', 'query')).rejects.toThrow('timeout')
  const failing = createHindsightClient({ endpoint: 'https://example.com', fetcher: async (_url, init) => {
    expect(init?.redirect).toBe('error')
    return new Response('private-service-error', { status: 500 })
  } })
  await expect(failing.recall('bank', 'query')).rejects.toThrow('Hindsight HTTP 500')
  const oversized = createHindsightClient({ endpoint: 'http://localhost:8888',
    fetcher: async () => new Response('x'.repeat(512 * 1024 + 1)) })
  await expect(oversized.recall('bank', 'query')).rejects.toThrow('protocol')
})

it('allows bounded local reranking to finish while keeping control requests short and cancellation immediate', async () => {
  vi.useFakeTimers()
  try {
    const client = createHindsightClient({ endpoint: 'http://localhost:8888',
      fetcher: async () => new Promise((resolve) => setTimeout(() =>
        resolve(Response.json({ results: [] })), 3_000)) })
    const recall = client.recall('bank', 'A stage review query with a requirements summary')
      .then((value) => ({ value }), (error: Error) => ({ error: error.message }))
    const control = client.operation('bank', 'operation')
      .then((value) => ({ value }), (error: Error) => ({ error: error.message }))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await recall).toEqual({ value: [] })
    expect(await control).toEqual({ error: 'Hindsight timeout' })

    const stalled = createHindsightClient({ endpoint: 'http://localhost:8888',
      fetcher: async () => new Promise(() => {}) })
    const bounded = stalled.recall('bank', 'query').catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await bounded).toBe('Hindsight timeout')
    const controller = new AbortController()
    const cancelled = stalled.recall('bank', 'query', controller.signal).catch((error: Error) => error.message)
    controller.abort()
    expect(await cancelled).toBe('Hindsight transport')
  } finally { vi.useRealTimers() }
})

it('rejects an unverified service version before configuring a bank', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ api_version: '0.9.0', features: {} }))
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', fetcher })
  await expect(client.configureBank('new-bank', [], 'concise')).rejects.toThrow('protocol')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://localhost:8888/version')
})

it('checks resolved bank configuration and returns only provenance from compatible recall results', async () => {
  const labels = [{ key: 'sem_kind', type: 'text' }]
  const updates = { enable_observations: false, enable_auto_consolidation: false,
    entities_allow_free_form: false, entity_labels: labels, retain_extraction_mode: 'concise' }
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ api_version: '1.0.0' }))
    .mockResolvedValueOnce(Response.json({ bank_id: 'bank' }))
    // JSONB may reorder object keys while preserving the exact configuration.
    .mockResolvedValueOnce(Response.json({ bank_id: 'bank',
      config: { ...updates, entity_labels: [{ type: 'text', key: 'sem_kind' }] }, overrides: updates }))
    .mockResolvedValueOnce(Response.json({ results: [
      { id: 'fact', type: 'world', text: 'Untrusted generated fact', document_id: 'document', metadata: { df_revision: '1' } },
      { id: 'derived', type: 'observation', text: 'Excluded synthesis', document_id: 'document', metadata: {} },
      { id: 'unattributed', type: 'world', text: 'No provenance', metadata: {} },
    ] }))
    .mockResolvedValueOnce(Response.json({ success: true, document_id: 'document', memory_units_deleted: 1 }))
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', fetcher })
  await client.configureBank('bank', labels, 'concise')
  expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ updates })
  await expect(client.recall('bank', 'query')).resolves.toEqual([{ documentId: 'document', metadata: { df_revision: '1' } }])
  await expect(client.deleteDocument('bank', 'document')).resolves.toBeUndefined()
})

it('recognizes completed retries while refusing to settle a task with a live child or scheduled failure retry', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ operation_id: 'op', status: 'completed', next_retry_at: '2026-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(Response.json({ operation_id: 'op', status: 'failed', next_retry_at: '2050-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(Response.json({ operation_id: 'op', status: 'completed', child_operations: [{ status: 'processing' }] }))
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', fetcher })
  await expect(client.operation('bank', 'op')).resolves.toBe('completed')
  await expect(client.operation('bank', 'op')).resolves.toBe('processing')
  await expect(client.operation('bank', 'op')).resolves.toBe('processing')
})

it('exports every exact-document fact across bounded pages, with no recall request', async () => {
  const metadata = { df_event: 'event', df_source: 'sha256:source' }
  const fact = (i: number) => ({ id: `fact-${i}`, text: `Evidence ${i}`, fact_type: 'world',
    document_id: 'doc', state: 'valid', updated_at: '2026-10-22T00:00:00Z', metadata, source_memory_ids: [] })
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const parsed = new URL(String(url))
    if (parsed.pathname.endsWith('/documents/doc')) return Response.json({ id: 'doc', bank_id: 'bank',
      original_text: 'source', content_hash: 'hash', updated_at: '2026-10-22T00:00:00Z', memory_unit_count: 35, document_metadata: metadata })
    expect(parsed.pathname.endsWith('/memories/list')).toBe(true)
    expect(parsed.searchParams.get('document_id')).toBe('doc')
    expect(parsed.searchParams.get('state')).toBe('valid')
    const offset = Number(parsed.searchParams.get('offset'))
    return Response.json({ total: 35, limit: 32, offset, items: Array.from({ length: Math.min(32, 35 - offset) }, (_, i) => fact(i + offset)) })
  })
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', fetcher })
  const document = await client.getDocument('bank', 'doc')
  expect(document).toMatchObject({ originalText: 'source', memoryUnitCount: 35, metadata })
  const facts = await client.listDocumentFacts('bank', 'doc', document.memoryUnitCount)
  expect(facts).toHaveLength(35)
  expect(facts.at(-1)?.id).toBe('fact-34')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it.each(['foreign_document', 'missing_source', 'observation', 'duplicate', 'unstable_total', 'missing_page'])('rejects incomplete or ungrounded fact exports: %s', async (scenario) => {
  const good = { id: 'fact', text: 'supported text', fact_type: 'world', document_id: 'doc', state: 'valid',
    updated_at: '2026-10-22T00:00:00Z', metadata: {}, source_memory_ids: [] }
  const item = { ...good, ...(scenario === 'foreign_document' ? { document_id: 'other' } : {}),
    ...(scenario === 'missing_source' ? { document_id: null } : {}), ...(scenario === 'observation' ? { fact_type: 'observation' } : {}) }
  const count = scenario === 'duplicate' ? 2 : 1
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ total: scenario === 'unstable_total' ? 2 : count,
    offset: 0, limit: 32, items: scenario === 'missing_page' ? [] : scenario === 'duplicate' ? [item, item] : [item] }))
  const client = createHindsightClient({ endpoint: 'http://localhost:8888', fetcher })
  await expect(client.listDocumentFacts('bank', 'doc', count)).rejects.toThrow('protocol')
})
