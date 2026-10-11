// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAgentProvider } from './agent-review'
import { expandedOutputAllowance, resolveRequestPolicy } from './provider-request-policy'

afterEach(() => vi.unstubAllEnvs())

it('rolls back new long generations without truncating an already received document', async () => {
  vi.stubEnv('DEVFLOW_LONG_CONTENT_ENABLED', '0')
  const bodies: Record<string, unknown>[] = []
  const text = '保留原文'.repeat(20_000)
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: JSON.stringify({ text }) }, finish_reason: 'stop' }] })
  } })
  expect((await p.completeStructuredJson!({ ...request, maxOutputTokens: 131072 })).value).toEqual({ text })
  expect(bodies[0]?.max_tokens).toBe(8192)
  expect(expandedOutputAllowance(resolveRequestPolicy({ ...base }))).toBeUndefined()
})

const encoder = new TextEncoder()
const frame = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
const done = encoder.encode('data: [DONE]\n\n')
const base = { model: 'deepseek-flash', apiKey: 'fixture', baseUrl: 'https://api.deepseek.com' }
const request = { systemPrompt: 'Return JSON', userPrompt: 'read this', purpose: 'proposal' as const }
function response(parts: Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(p); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
}
it('receives complete Chinese documents and reasoning past the old independent byte caps', async () => {
  const text = '中文🧠'.repeat(12000)
  const reasoning = 'checking '.repeat(12000)
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    frame({ choices: [{ delta: { reasoning_content: reasoning } }] }),
    frame({ choices: [{ delta: { content: JSON.stringify({ text }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } }), done,
  ]) })
  await expect(p.completeStructuredJson!(request)).resolves.toMatchObject({ value: { text }, reasoningContent: reasoning, usage: { totalTokens: 46 } })
})
it('does not count discarded SSE envelopes against the document capacity', async () => {
  const heartbeat = encoder.encode(':' + ' '.repeat(1022) + '\n\n')
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    ...Array.from({ length: 4200 }, () => heartbeat),
    frame({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), done,
  ]) })
  await expect(p.completeStructuredJson!(request)).resolves.toMatchObject({ value: { ok: true } })
})
it('preserves observed usage when a later SSE frame is malformed', async () => {
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } }),
    encoder.encode('data: invalid-private-body\n\n'),
  ]) })
  await expect(p.completeStructuredJson!(request)).rejects.toMatchObject({ code: 'invalid_response_json', usage: { totalTokens: 46 }, responseMetadata: { parserCategory: 'sse_json' } })
})
it('sends the same explicit output allowance with or without a reasoning display subscription', async () => {
  const bodies: Record<string, unknown>[] = []
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
  } })
  await p.completeStructuredJson!(request)
  await p.completeStructuredJson!({ ...request, reasoning: { onDelta() {} } })
  expect(bodies[0]).toEqual(bodies[1])
  expect(bodies[0]).toMatchObject({ max_tokens: 65536, stream: true })
})

it('keeps partial usage and response ID when the transport breaks after a usage frame', async () => {
  let reads = 0
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => new Response(new ReadableStream({ pull(c) {
    if (reads++ === 0) c.enqueue(frame({ id: 'call-observed', choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }))
    else c.error(new TypeError('private socket details'))
  } }), { headers: { 'content-type': 'text/event-stream' } }) })
  const error = await p.completeStructuredJson!(request).catch(error => error)
  expect(error).toMatchObject({ code: 'connection_reset', deliveryState: 'response_received', billingState: 'unknown',
    usage: { inputTokens: 12, outputTokens: 3, usageCompleteness: 'partial' },
    responseMetadata: { responseId: 'call-observed', parserCategory: 'body_read', httpStatus: 200, wireBytes: expect.any(Number) } })
  expect(JSON.stringify(error.responseMetadata)).not.toContain('private socket')
})
it('retains a final usage snapshot when caller cancellation arrives during persistence', async () => {
  const controller = new AbortController()
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    frame({ id: 'cancel-final', choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), done,
  ]) })
  await expect(p.completeStructuredJson!({ ...request, signal: controller.signal, onUsage: () => controller.abort() })).rejects.toMatchObject({
    code: 'cancelled_by_user', billingState: 'confirmed', deliveryState: 'response_received', usage: { inputTokens: 12, outputTokens: 3, usageCompleteness: 'final' }, responseMetadata: { responseId: 'cancel-final' },
  })
})
it('decodes Unicode split across arbitrary network chunks and rejects a missing terminal frame', async () => {
  const bytes = frame({ choices: [{ delta: { content: '{"text":"中文🧠"}' }, finish_reason: 'stop' }] })
  const parts = Array.from(bytes, byte => Uint8Array.of(byte))
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([...parts, done]) })
  await expect(p.completeStructuredJson!(request)).resolves.toMatchObject({ value: { text: '中文🧠' } })
  const incomplete = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response(parts) })
  await expect(incomplete.completeStructuredJson!(request)).rejects.toMatchObject({ responseMetadata: { parserCategory: 'stream_incomplete' } })
})
it('accepts a document near 8 MiB and reports the exact violated channel above that limit', async () => {
  const text = '中'.repeat(Math.floor((8 * 1024 * 1024 - 100) / 3))
  const p = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    frame({ choices: [{ delta: { content: JSON.stringify({ text }) }, finish_reason: 'stop' }] }), done,
  ]) })
  const result = await p.completeStructuredJson!(request)
  expect(result.value.text).toBe(text)
  expect(result.responseMetadata?.contentBytes).toBeGreaterThan(8 * 1024 * 1024 - 200)
  const oversized = createOpenAiCompatibleAgentProvider({ ...base, fetcher: async () => response([
    frame({ choices: [{ delta: { reasoning_content: 'x'.repeat(8 * 1024 * 1024 + 1) } }] }), done,
  ]) })
  await expect(oversized.completeStructuredJson!(request)).rejects.toMatchObject({ code: 'response_too_large', retryable: false,
    responseMetadata: { limitKind: 'reasoning_bytes', limitUnit: 'bytes', limitThreshold: 8 * 1024 * 1024, observedBytes: 8 * 1024 * 1024 + 1 } })
})
