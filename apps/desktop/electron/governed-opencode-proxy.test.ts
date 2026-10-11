// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import type { ModelCallGovernance, ModelCallSettlement } from '@ai-devflow/shared'
import { createGovernedOpencodeProxy, summarizeRelayedUsage } from './governed-opencode-proxy'
import { OpencodeMessageResponseError, sendOpencodeMessage } from './opencode-http-adapter'
import { classifyOpencodeFailure } from './opencode-failure'

const binding = { providerId: 'fixture', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'fixture-only-key', fingerprint: 'fixture' }
const close: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of close.splice(0)) await stop() })
function governance(accepted = true) {
  const pending = new Map<string, ModelCallSettlement>()
  const result = {
    reserve: vi.fn(async () => ({ accepted, decision: { status: 'allowed' as const, blocksRun: !accepted, currentSpendUsd: 0, projectedCostUsd: 0.1, reason: '测试预算未就绪' } })),
    settle: vi.fn(async (s: ModelCallSettlement) => { pending.delete(s.id) }),
    persist: async (s: ModelCallSettlement) => { pending.set(s.id, s) }, pending: async () => [...pending.values()],
  } satisfies ModelCallGovernance
  return result
}
async function setup(accepted = true, responder?: typeof fetch) {
  const budget = governance(accepted)
  const upstream = vi.fn(responder ?? (async () => new Response(JSON.stringify({ id: 'completion-fixture', model: binding.modelId,
    choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 },
  }), { headers: { 'content-type': 'application/json' } })))
  const proxy = await createGovernedOpencodeProxy({ binding, projectId: 'project', governance: budget, fetcher: upstream })
  close.push(proxy.close)
  const send = (body: Record<string, unknown>, token = proxy.binding.apiKey) => fetch(proxy.binding.baseUrl + '/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return { proxy, budget, upstream, send }
}
describe('OpenCode governed relay', () => {
  it('applies an explicit output cap to both admission and the forwarded request', async () => {
    const budget = governance()
    const upstream = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1 } }))
    const proxy = await createGovernedOpencodeProxy({ binding, projectId: 'project', governance: budget, fetcher: upstream, maxOutputTokens: 4096 })
    close.push(proxy.close)
    const response = await fetch(proxy.binding.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${proxy.binding.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: binding.modelId }) })
    expect(response.status).toBe(200)
    expect(budget.reserve).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 4096 }), expect.any(AbortSignal))
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body)).max_tokens).toBe(4096)
  })

  it.each(['invalid-json', 'invalid-usage', 'oversized'] as const)('records a safe diagnostic for a malformed provider response (%s)', async (kind) => {
    const body = kind === 'invalid-json' ? 'PRIVATE_PROVIDER_BODY'
      : kind === 'invalid-usage' ? JSON.stringify({ usage: { prompt_tokens: -1 } }) : 'x'
    const f = await setup(true, async () => new Response(body, kind === 'oversized' ? { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } } : undefined))
    const response = await f.send({ model: binding.modelId })
    expect(f.proxy.failureForRequest(response.headers.get('x-devflow-relay-request')!, 0)).toMatchObject({
      code: kind === 'oversized' ? 'output_limit' : 'output_format', source: 'provider',
    })
    expect(await response.text()).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(f.proxy.usageSince('')?.missingUsageCount).toBe(1)
    expect(f.budget.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }))
  })

  it('matches only the current call and execution, even when retries share a timestamp', async () => {
    let status = 429
    const f = await setup(true, async () => new Response('{}', { status }))
    const checkpoint = f.proxy.checkpoint()
    const denied = await f.send({ model: binding.modelId })
    const requestId = denied.headers.get('x-devflow-relay-request')!
    const adapted = await sendOpencodeMessage({ baseUrl: 'http://fixture', sessionId: 's', directory: 'repo',
      model: { providerID: binding.providerId, modelID: binding.modelId }, text: 'x',
      fetcher: async () => new Response(JSON.stringify({ info: { error: { name: 'APIError', data: {
        statusCode: 400, responseHeaders: { 'x-devflow-relay-request': requestId, authorization: 'PRIVATE_KEY' }, responseBody: 'PRIVATE_BODY',
      } } }, parts: [] })),
    }).catch((error: unknown) => error)
    const classify = () => classifyOpencodeFailure(adapted, { relayFailure: (id) => f.proxy.failureForRequest(id, checkpoint) })
    expect(classify().failureDetails).toMatchObject({ code: 'provider_rate_limit', httpStatus: 429, relayRequestId: requestId })
    expect(JSON.stringify(adapted)).not.toMatch(/PRIVATE_KEY|PRIVATE_BODY/)
    expect(f.proxy.failureForRequest(requestId, f.proxy.checkpoint())).toBeUndefined()
    const other = await setup(false)
    expect(other.proxy.failureForRequest(requestId, 0)).toBeUndefined()
    status = 200
    await f.send({ model: binding.modelId })
    expect(classify().failureDetails?.code).toBe('provider_request_failed')
    expect(classifyOpencodeFailure(new OpencodeMessageResponseError({ code: 'structured_output', relayRequestId: requestId }), {
      relayFailure: (id) => f.proxy.failureForRequest(id, checkpoint),
    }).failureDetails?.code).toBe('output_format')
    // The legacy Coding/Chat view still includes both attempts; the new cursor excludes them.
    expect(f.proxy.usageSince('')?.budgetAttemptIds).toHaveLength(2)
    expect(f.proxy.usageAfter(f.proxy.checkpoint())).toBeUndefined()
  })

  it('does not let a late concurrent failure overwrite a newer successful call', async () => {
    let rejectFirst!: () => void
    let calls = 0
    const f = await setup(true, async () => {
      if (++calls === 1) await new Promise<void>((resolve) => { rejectFirst = resolve })
      else return new Response('{}')
      return new Response('PRIVATE_PROVIDER_BODY', { status: 503 })
    })
    const first = f.send({ model: binding.modelId })
    await vi.waitFor(() => expect(calls).toBe(1))
    await f.send({ model: binding.modelId })
    rejectFirst()
    const response = await first
    expect(f.proxy.failureForRequest(response.headers.get('x-devflow-relay-request')!, 0)).toBeUndefined()
    expect(f.proxy.usageSince('')?.budgetAttemptIds).toHaveLength(2)
  })

  it('keeps settled rounds and marks an active round unknown in the scoped cancellation snapshot', async () => {
    let calls = 0
    const f = await setup(true, async (_url, options) => {
      if (++calls === 1) return new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 } }))
      return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('cancelled'))))
    })
    await f.send({ model: binding.modelId })
    const running = f.send({ model: binding.modelId }).catch(() => undefined)
    await vi.waitFor(() => expect(calls).toBe(2))
    expect(f.proxy.usageAfter(0)).toMatchObject({ inputTokens: 10, outputTokens: 5, missingUsageCount: 1, cacheStatus: 'unknown', budgetAttemptIds: [expect.any(String)] })
    // Existing Coding/Chat usageSince behavior is unchanged while a call is still running.
    expect(f.proxy.usageSince('')).toMatchObject({ inputTokens: 10, missingUsageCount: 0 })
    await f.proxy.close()
    await running
    expect(f.proxy.usageAfter(0)?.budgetAttemptIds).toHaveLength(2)
    await expect(f.proxy.close()).resolves.toBeUndefined()
  })

  it('enforces the chosen model and ephemeral authorization before admission', async () => {
    const f = await setup()
    expect((await f.send({ model: binding.modelId }, 'wrong')).status).toBe(403)
    expect((await f.send({ model: 'another-model' })).status).toBe(400)
    expect(f.budget.reserve).not.toHaveBeenCalled()
    expect(f.upstream).not.toHaveBeenCalled()
  })
  it('blocks each internal model round before contacting the Provider', async () => {
    const f = await setup(false)
    expect(await (await f.send({ model: binding.modelId, messages: [] })).text()).toContain('预算未就绪')
    expect(f.upstream).not.toHaveBeenCalled()
    expect(f.budget.settle).not.toHaveBeenCalled()
  })
  it('keeps usage and indexed streamed tool calls compatible with OpenCode', async () => {
    const f = await setup()
    const response = await f.send({ model: binding.modelId, messages: [], stream: true })
    const chunks = (await response.text()).split('\n\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)))
    expect(chunks[0].choices[0].delta.tool_calls[0]).toMatchObject({ index: 0, id: 'read-1', function: { name: 'read' } })
    expect(chunks.at(-1).choices[0].finish_reason).toBe('tool_calls')
    expect(chunks.at(-1).usage.total_tokens).toBe(15)
    expect(f.budget.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'completed', usage: expect.objectContaining({ inputTokens: 10, outputTokens: 5 }) }))
    expect(f.proxy.usageSince('')).toMatchObject({ inputTokens: 10, outputTokens: 5, budgetAttemptIds: [expect.any(String)] })
    const options = f.upstream.mock.calls[0]![1]!
    expect(JSON.parse(String(options.body)).stream).toBe(true)
    expect(options.headers).toMatchObject({ authorization: 'Bearer fixture-only-key' })
    expect(f.proxy.binding.apiKey).not.toBe(binding.apiKey)
  })
  it('preserves Chinese and emoji when network chunks split UTF-8 bytes', async () => {
    const f = await setup()
    const body = Buffer.from(JSON.stringify({ model: binding.modelId, messages: [{ role: 'user', content: '中文🧭' }] }))
    const index = body.indexOf(Buffer.from('中文')) + 1
    await new Promise<void>((resolve, reject) => {
      const req = request(f.proxy.binding.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${f.proxy.binding.apiKey}` } }, (response) => { response.resume(); response.on('end', resolve) })
      req.on('error', reject); req.write(body.subarray(0, index)); req.end(body.subarray(index))
    })
    expect(JSON.parse(String(f.upstream.mock.calls[0]![1]!.body)).messages[0].content).toBe('中文🧭')
  })
  // #207: the relay's own address is loopback, so the billing identity must come from the saved binding.
  it('reports the summed usage with the saved binding as billing identity and a complete cache split', async () => {
    const f = await setup()
    await f.send({ model: binding.modelId, messages: [] })
    await f.send({ model: binding.modelId, messages: [] })
    expect(f.proxy.binding.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/u)
    expect(f.proxy.usageSince('')).toEqual({
      inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheMissTokens: 20,
      cacheStatus: 'complete', billingProvider: 'deepseek',
      budgetAttemptIds: [expect.any(String), expect.any(String)], missingUsageCount: 0,
    })
  })
  it('leaves the session unpriced when one round has no cache split', () => {
    expect(summarizeRelayedUsage([
      { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheMissTokens: 8, cacheStatus: 'complete' },
      { inputTokens: 10, outputTokens: 5, cacheStatus: 'unknown' },
    ], 'deepseek')).toMatchObject({ inputTokens: 20, cacheStatus: 'unknown', billingProvider: 'deepseek', missingUsageCount: 0 })
    expect(summarizeRelayedUsage([{ budgetAttemptIds: ['a'] }], 'deepseek')).toMatchObject({ cacheStatus: 'unknown', missingUsageCount: 1 })
    expect(summarizeRelayedUsage([], 'deepseek')).toBeUndefined()
  })
  // #208: a connection that closed during the TLS handshake never reached the Provider.
  it('settles a round as not sent when the upstream TLS handshake never completed', async () => {
    const preTls = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' })
    const f = await setup(true, async () => { throw new TypeError('fetch failed', { cause: preTls }) })
    const response = await f.send({ model: binding.modelId, messages: [] })
    expect(response.status).toBe(400)
    expect(f.budget.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'not_sent' }))
    // The failed round neither costs anything nor leaves the session's usage unknown.
    expect(f.proxy.usageSince('')).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheStatus: 'complete', missingUsageCount: 0, budgetAttemptIds: [expect.any(String)] })
  })
  it('keeps a reset after the connection opened as possibly billed', async () => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const f = await setup(true, async () => { throw new TypeError('fetch failed', { cause: reset }) })
    await f.send({ model: binding.modelId, messages: [] })
    expect(f.budget.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }))
    expect(f.proxy.usageSince('')).toMatchObject({ cacheStatus: 'unknown', missingUsageCount: 1 })
  })
  it('records a cancelled upstream call as unknown instead of free', async () => {
    const f = await setup(true, async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('cancelled')))))
    const abort = new AbortController()
    const pending = fetch(f.proxy.binding.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${f.proxy.binding.apiKey}` }, body: JSON.stringify({ model: binding.modelId }), signal: abort.signal }).catch(() => undefined)
    await vi.waitFor(() => expect(f.upstream).toHaveBeenCalled())
    abort.abort(); await pending
    await vi.waitFor(() => expect(f.budget.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' })))
  })
})
