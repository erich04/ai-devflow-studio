// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCallGovernance, ModelCallQuote, ModelCallSettlement } from '@ai-devflow/shared'
import { createMemoryModelRelay, MEMORY_RELAY_MAX_OUTPUT_TOKENS, type MemoryModelRelay, type MemoryRelayCall } from './memory-model-relay'

const token = 'relay-token-0123456789abcdefghijklmnopqrstuv'
const relays: MemoryModelRelay[] = []
afterEach(async () => { await Promise.all(relays.splice(0).map((relay) => relay.close())) })

function governance(accepted = true) {
  const reserved: ModelCallQuote[] = []; const settled: ModelCallSettlement[] = []
  const value: ModelCallGovernance = {
    reserve: async (quote) => { reserved.push(quote); return { accepted, decision: { blocksRun: !accepted, reason: accepted ? 'ok' : '团队预算不足' } as never } },
    settle: async (settlement) => { settled.push(settlement) },
    persist: async () => undefined,
    pending: async () => [],
  }
  return { value, reserved, settled }
}
const completion = { id: 'chatcmpl-1', object: 'chat.completion', model: 'upstream', choices: [{ index: 0, message: { role: 'assistant', content: '{"facts":[]}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } }
async function relay(options: { baseUrl?: string; model?: string; accepted?: boolean; governanceFails?: boolean; upstream?: () => Response } = {}) {
  const budget = governance(options.accepted ?? true)
  const upstream = vi.fn<typeof fetch>(async () => options.upstream?.() ?? Response.json(completion))
  const calls: MemoryRelayCall[] = []
  const resolveBank = vi.fn(async (bank: string) => bank === 'df-memory-known' ? { projectId: 'project-1', binding: {
    providerId: 'provider-1', modelId: options.model ?? 'gpt-4.1-mini', baseUrl: options.baseUrl ?? 'https://llm.example.test/v1',
    apiKey: 'provider-secret', fingerprint: 'fingerprint' } } : null)
  const instance = await createMemoryModelRelay({ port: 0, token, resolveBank, fetcher: upstream, onCall: (call) => calls.push(call),
    governance: async () => { if (options.governanceFails) throw new Error('not paired'); return budget.value } })
  relays.push(instance)
  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }, url = '/v1/chat/completions') =>
    fetch(`http://127.0.0.1:${instance.port}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { post, upstream, budget, calls, resolveBank }
}
const request = { model: 'deepseek-flash', user: 'df-memory-known', max_tokens: 64_000,
  messages: [{ role: 'user', content: 'Extract facts as json' }], response_format: { type: 'json_object' }, temperature: 0.1 }

describe('memory model relay', () => {
  it('refuses unknown callers and banks before any model call', async () => {
    const { post, upstream, calls } = await relay()
    expect((await post(request, { authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await post(request, {})).status).toBe(401)
    expect((await post(request, undefined, '/v1/embeddings')).status).toBe(404)
    expect((await post('{not json')).status).toBe(400)
    const unknown = await post({ ...request, user: 'df-memory-other' })
    expect(unknown.status).toBe(403)
    expect((await post({ ...request, user: undefined })).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
    expect(calls.map((call) => call.reason)).toEqual(['memory_not_enabled', 'memory_not_enabled'])
  })

  it('charges the project budget and forwards with the saved Provider key, without the bank id', async () => {
    const { post, upstream, budget, calls } = await relay()
    const response = await post(request)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: '{"facts":[]}' } }] })
    const [url, init] = upstream.mock.calls[0]!
    expect(url).toBe('https://llm.example.test/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provider-secret')
    expect(init?.redirect).toBe('error')
    const sent = JSON.parse(String(init?.body))
    expect(sent).toMatchObject({ model: 'gpt-4.1-mini', max_tokens: MEMORY_RELAY_MAX_OUTPUT_TOKENS, temperature: 0.1,
      response_format: { type: 'json_object' }, messages: request.messages, stream: false })
    expect(sent).not.toHaveProperty('user')
    expect(budget.reserved).toEqual([expect.objectContaining({ projectId: 'project-1', providerId: 'provider-1', model: 'gpt-4.1-mini',
      maxOutputTokens: MEMORY_RELAY_MAX_OUTPUT_TOKENS, billingProvider: 'openai_compatible' })])
    expect(budget.reserved[0]).not.toHaveProperty('operation')
    expect(budget.settled).toEqual([expect.objectContaining({ state: 'completed' })])
    expect(calls).toEqual([expect.objectContaining({ bankId: 'df-memory-known', projectId: 'project-1', status: 'succeeded' })])
  })

  it('turns DeepSeek thinking off, bounds the reservation by context, and answers a non-streaming caller', async () => {
    const sse = [
      { id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '{"facts":' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '[]}' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 120 } },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
    const { post, upstream, budget } = await relay({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
      upstream: () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }) })
    const response = await post(request)
    expect(response.status).toBe(200)
    expect((await response.json()).choices[0].message.content).toBe('{"facts":[]}')
    const sent = JSON.parse(String(upstream.mock.calls[0]![1]?.body))
    expect(sent).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, stream: true, stream_options: { include_usage: true } })
    expect(budget.reserved[0]).toMatchObject({ boundBasis: 'deepseek-context-v1', billingProvider: 'deepseek' })
  })

  it('streams back to a streaming caller', async () => {
    const { post } = await relay()
    const response = await post({ ...request, stream: true })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('"delta":{"role":"assistant","content":"{\\"facts\\":[]}"}')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('refuses when the budget is not admitted or cannot be opened, and reports upstream failures', async () => {
    const refused = await relay({ accepted: false })
    const response = await refused.post(request)
    expect(response.status).toBe(429)
    expect((await response.json()).error.message).toContain('团队预算不足')
    expect(refused.upstream).not.toHaveBeenCalled()
    expect(refused.calls).toEqual([expect.objectContaining({ status: 'refused', reason: 'budget_not_ready' })])

    const unpaired = await relay({ governanceFails: true })
    expect((await unpaired.post(request)).status).toBe(403)
    expect(unpaired.upstream).not.toHaveBeenCalled()
    expect(unpaired.calls).toEqual([expect.objectContaining({ status: 'refused', reason: 'budget_unavailable' })])

    const failing = await relay({ upstream: () => new Response('provider detail', { status: 500 }) })
    const failed = await failing.post(request)
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('provider detail')
    expect(failing.budget.settled).toEqual([expect.objectContaining({ state: 'failed' })])
  })

  it('rejects an invalid token at startup', async () => {
    await expect(createMemoryModelRelay({ port: 0, token: 'short', resolveBank: async () => null,
      governance: async () => governance().value })).rejects.toThrow('Memory relay token is invalid')
  })
})
