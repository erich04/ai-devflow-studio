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

it('configures a project memory bank with its missions and verifies the saved configuration', async () => {
  const requests: { method: string; url: string; body: unknown }[] = []
  let saved: Record<string, unknown> = {}
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: init?.method ?? 'GET', url: String(url), body })
    if (String(url).endsWith('/version')) return Response.json({ api_version: '1.0.0' })
    if (init?.method === 'PATCH') { saved = body.updates; return Response.json({ bank_id: 'df-memory-1', config: saved }) }
    return Response.json({ bank_id: 'df-memory-1' })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8890', fetcher })
  const missions = { retain: 'Keep project decisions.', observations: 'Consolidate conventions.', reflect: 'Answer as a senior engineer.' }
  await client.configureMemoryBank('df-memory-1', missions)
  expect(requests.map((item) => `${item.method} ${new URL(item.url).pathname}`)).toEqual([
    'GET /version', 'PUT /v1/default/banks/df-memory-1', 'PATCH /v1/default/banks/df-memory-1/config'])
  expect(requests[2]!.body).toEqual({ updates: { enable_observations: true, enable_auto_consolidation: true, entities_allow_free_form: true,
    retain_extraction_mode: 'concise', retain_mission: missions.retain, observations_mission: missions.observations, reflect_mission: missions.reflect,
    enable_reranking: false, enable_graph_retrieval: false } })
  fetcher.mockImplementation(async (url, init) => String(url).endsWith('/version') ? Response.json({ api_version: '1.0.0' })
    : init?.method === 'PATCH' ? Response.json({ bank_id: 'df-memory-1', config: { ...saved, enable_observations: false } }) : Response.json({}))
  await expect(client.configureMemoryBank('df-memory-1', missions)).rejects.toThrow('protocol')
})
it('retains a project memory document that replaces its earlier revision in one shared belief set', async () => {
  const bodies: unknown[] = []
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ success: true, bank_id: 'df-memory-1', items_count: 1, async: true, operation_id: 'op-1', operation_ids: ['op-1'] })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8890', fetcher })
  const item = { documentId: 'conversation:chat', operationId: 'op-1', content: '[{"role":"user"}]', context: 'A discussion.',
    timestamp: '2026-10-28T00:00:00.000Z', tags: ['source:conversation'], metadata: { df_document: 'd1' } }
  await client.retainDocument('df-memory-1', item)
  expect(bodies).toEqual([{ async: true, operation_id: 'op-1', items: [{ document_id: 'conversation:chat', content: item.content,
    context: 'A discussion.', timestamp: item.timestamp, tags: ['source:conversation'], metadata: { df_document: 'd1' },
    update_mode: 'replace', observation_scopes: 'shared' }] }])
  fetcher.mockResolvedValueOnce(Response.json({ success: true, bank_id: 'df-memory-1', items_count: 1, async: true, operation_id: 'op-2' }))
  await expect(client.retainDocument('df-memory-1', item)).rejects.toThrow('protocol')
})
it('recalls project memory text, preferring observations, and drops malformed results', async () => {
  const bodies: unknown[] = []
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ results: [
      { id: 'o1', type: 'observation', text: '删除前要确认。', source_fact_ids: ['f0'] },
      { id: 'f1', type: 'world', text: '撤销窗口 5 秒。', document_id: 'conversation:c1', occurred_start: '2026-10-20T08:00:00Z' },
      { id: 'f1', type: 'world', text: 'duplicate id' },
      { id: 'bad id', type: 'world', text: 'invalid id' },
      { id: 'e1', type: 'experience', text: '   ' },
      { id: 'x1', type: 'unknown', text: 'unknown type' },
    ] })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8890', fetcher })
  expect(await client.recallMemories('df-memory-1', { query: '删除', maxTokens: 1_000 })).toEqual([
    { id: 'o1', type: 'observation', text: '删除前要确认。' },
    { id: 'f1', type: 'world', text: '撤销窗口 5 秒。', documentId: 'conversation:c1', occurredAt: '2026-10-20T08:00:00Z' },
  ])
  expect(bodies).toEqual([{ query: '删除', types: ['observation', 'world', 'experience'], prefer_observations: true,
    budget: 'low', max_tokens: 1_000, include: { entities: null } }])
  await expect(client.recallMemories('df-memory-1', { query: '删除', maxTokens: 10 })).rejects.toThrow('protocol')
  fetcher.mockResolvedValueOnce(Response.json({ results: 'not a list' }))
  await expect(client.recallMemories('df-memory-1', { query: '删除', maxTokens: 1_000 })).rejects.toThrow('protocol')
  // A full allowance of short memories is several hundred results.
  const many = (count: number) => Response.json({ results: Array.from({ length: count }, (_, index) => ({ id: `f${index}`, type: 'world', text: `事实 ${index}` })) })
  fetcher.mockResolvedValueOnce(many(600))
  expect(await client.recallMemories('df-memory-1', { query: '删除', maxTokens: 8_192 })).toHaveLength(600)
  fetcher.mockResolvedValueOnce(many(1_025))
  await expect(client.recallMemories('df-memory-1', { query: '删除', maxTokens: 8_192 })).rejects.toThrow('protocol')
})
it('lists, edits, retires and deletes project memory with bounded requests', async () => {
  const requests: Array<{ method: string; url: string; body: unknown }> = []
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    requests.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (String(url).includes('/memories/list')) return Response.json({ total: 3, limit: 50, offset: 0, items: [
      { id: 'o1', fact_type: 'observation', text: '删除前确认。', date: '2026-10-28T00:00:00Z', document_id: null, edited_at: '2026-10-28T01:00:00Z' },
      { id: 'w1', fact_type: 'world', text: '其他类型' },
      { id: 'o2', fact_type: 'observation', text: '  ' },
    ] })
    if (init?.method === 'DELETE') return Response.json({ success: true })
    return Response.json({ id: 'o1' })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8890', fetcher })
  expect(await client.listMemories('df-memory-1', { type: 'observation', query: ' 删除 ', offset: 0, limit: 50 })).toEqual({ total: 3,
    items: [{ id: 'o1', type: 'observation', text: '删除前确认。', occurredAt: '2026-10-28T00:00:00Z', editedAt: '2026-10-28T01:00:00Z' }] })
  const listUrl = new URL(requests[0]!.url)
  expect(Object.fromEntries(listUrl.searchParams)).toEqual({ type: 'observation', state: 'valid', limit: '50', offset: '0', q: '删除' })
  await client.updateMemory('df-memory-1', 'o1', '删除前必须确认。')
  await client.invalidateMemory('df-memory-1', 'o1', 'deleted by the user')
  await client.deleteBank('df-memory-1')
  expect(requests.slice(1).map((item) => [item.method, new URL(item.url).pathname, item.body])).toEqual([
    ['PATCH', '/v1/default/banks/df-memory-1/memories/o1', { text: '删除前必须确认。' }],
    ['PATCH', '/v1/default/banks/df-memory-1/memories/o1', { state: 'invalidated', reason: 'deleted by the user' }],
    ['DELETE', '/v1/default/banks/df-memory-1', undefined],
  ])
  fetcher.mockResolvedValueOnce(new Response('missing', { status: 404 }))
  await expect(client.deleteBank('df-memory-gone')).resolves.toBeUndefined()
  await expect(client.listMemories('df-memory-1', { type: 'observation', offset: 0, limit: 101 })).rejects.toThrow('protocol')
})

it('creates, updates, lists, empties and refreshes knowledge pages (mental models)', async () => {
  const requests: { method: string; path: string; body: unknown }[] = []
  let stored: Record<string, unknown> | undefined
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url)); const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method, path: `${parsed.pathname}${parsed.search}`, body })
    if (parsed.pathname.endsWith('/mental-models') && method === 'POST') { stored = body; return Response.json({ mental_model_id: body.id, operation_id: 'op-create' }) }
    if (parsed.pathname.endsWith('/mental-models') && method === 'GET') return Response.json({ items: [
      { id: 'devflow-decisions', content: '## 决策\n- 删除前二次确认', is_stale: true, last_refreshed_at: '2026-10-29T01:00:00Z', last_refresh_failed_at: null },
      { id: 'devflow-pitfalls', content: null, last_refreshed_at: 'not a time' },
      { id: 'Bad Id', content: 'dropped' },
    ], total: 3, limit: 100, offset: 0 })
    if (parsed.pathname.endsWith('/refresh')) return Response.json({ operation_id: 'op-refresh', status: 'queued' })
    if (parsed.pathname.endsWith('/clear')) return parsed.pathname.includes('missing') ? new Response('{}', { status: 404 }) : Response.json({ id: 'devflow-decisions' })
    if (method === 'PATCH') { stored = { ...stored, ...body }; return Response.json({ id: 'devflow-decisions' }) }
    return stored ? Response.json({ ...stored, trigger: { ...(stored.trigger as object), refresh_cron: null, keep_trace: false } }) : new Response('{}', { status: 404 })
  })
  const client = createHindsightClient({ endpoint: 'http://127.0.0.1:8890', fetcher })
  const page = { id: 'devflow-decisions', name: '决策与原因', sourceQuery: '列出决策', maxTokens: 1_500,
    trigger: { mode: 'delta', refresh_after_consolidation: true, min_refresh_interval_seconds: 3_600, exclude_mental_models: true, budget: 'low' } }
  await client.ensureMentalModel('df-memory-1', page)
  expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual([
    'GET /v1/default/banks/df-memory-1/mental-models/devflow-decisions', 'POST /v1/default/banks/df-memory-1/mental-models'])
  expect(requests[1]!.body).toEqual({ id: page.id, name: page.name, source_query: page.sourceQuery, max_tokens: 1_500, trigger: page.trigger, tags: [] })
  // Unchanged: nothing is written. A changed definition is patched in place.
  requests.length = 0
  await client.ensureMentalModel('df-memory-1', page)
  expect(requests.map((item) => item.method)).toEqual(['GET'])
  await client.ensureMentalModel('df-memory-1', { ...page, sourceQuery: '列出决策和原因' })
  expect(requests.at(-1)).toMatchObject({ method: 'PATCH', body: { source_query: '列出决策和原因' } })

  expect(await client.listMentalModels('df-memory-1')).toEqual([
    { id: 'devflow-decisions', content: '## 决策\n- 删除前二次确认', stale: true, refreshedAt: '2026-10-29T01:00:00Z' },
    { id: 'devflow-pitfalls', content: '', stale: false },
  ])
  expect(requests.at(-1)!.path).toBe('/v1/default/banks/df-memory-1/mental-models?detail=content&limit=100')
  await client.clearMentalModel('df-memory-1', 'devflow-decisions')
  await expect(client.clearMentalModel('df-memory-1', 'missing')).resolves.toBeUndefined()
  expect(await client.refreshMentalModel('df-memory-1', 'devflow-decisions')).toBe('op-refresh')
  expect(requests.at(-1)).toMatchObject({ method: 'POST', path: '/v1/default/banks/df-memory-1/mental-models/devflow-decisions/refresh' })
})
