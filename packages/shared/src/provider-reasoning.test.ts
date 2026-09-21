// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createOpenAiCompatibleAgentProvider } from './agent-review'

const encoder = new TextEncoder()
const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`)
function streamedProvider(parts: Uint8Array[]) {
  return createOpenAiCompatibleAgentProvider({ model: 'deepseek-flash', apiKey: 'test-only', baseUrl: 'https://api.deepseek.com',
    fetcher: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } }),
  })
}
const request = { systemPrompt: 'Return JSON.', userPrompt: 'Investigate.', maxOutputTokens: 3500, reasoning: { onDelta: () => undefined } }

describe('DeepSeek conversation reasoning', () => {
  it('decodes split UTF-8 and SSE boundaries, ignores heartbeats, and accepts terminal usage-only frames', async () => {
    const wire = Buffer.concat([
      encoder.encode(': keep-alive\r\n\r\n'),
      event({ choices: [{ delta: { reasoning_content: '检查中文🧠' }, finish_reason: null }] }),
      event({ choices: [{ delta: { content: '{"text":"可以继续。"}' }, finish_reason: null }] }),
      event({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      event({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 } }),
      encoder.encode('data: [DONE]\n\n'),
    ])
    const parts = Array.from(wire, (byte) => Uint8Array.of(byte))
    const result = await streamedProvider(parts).completeStructuredJson!(request)
    expect(result).toMatchObject({ reasoningContent: '检查中文🧠', value: { text: '可以继续。' }, usage: { totalTokens: 12 } })
  })

  it.each([
    ['connection closed before DONE', [event({ choices: [{ delta: { content: '{"text":"partial"}' }, finish_reason: 'stop' }] })]],
    ['output length exhausted', [event({ choices: [{ delta: { content: '{"text":"partial"}' }, finish_reason: 'length' }] }), encoder.encode('data: [DONE]\n\n')]],
    ['malformed event', [encoder.encode('data: not-json\n\n')]],
    ['provider error event', [event({ error: { message: 'PRIVATE_SERVER_ERROR' } })]],
    ['oversized reasoning', [event({ choices: [{ delta: { reasoning_content: 'x'.repeat(65537) }, finish_reason: null }] })]],
  ])('rejects %s without returning a successful answer', async (_name, parts) => {
    const failure = await streamedProvider(parts as Uint8Array[]).completeStructuredJson!(request).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_SERVER_ERROR')
  })

  it('aborts a stalled stream after returning reasoning and releases the body reader', async () => {
    let cancelled = false
    const controller = new AbortController()
    const provider = createOpenAiCompatibleAgentProvider({ model: 'deepseek-flash', apiKey: 'test-only', baseUrl: 'https://api.deepseek.com',
      fetcher: async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(event({ choices: [{ delta: { reasoning_content: '已开始' }, finish_reason: null }] })) }, cancel() { cancelled = true } }), { headers: { 'content-type': 'text/event-stream' } }),
    })
    await expect(provider.completeStructuredJson!({ ...request, signal: controller.signal, reasoning: { onDelta: () => controller.abort() } })).rejects.toMatchObject({ code: 'cancelled_by_user' })
    expect(cancelled).toBe(true)
  })

  it('rejects a truncated gateway JSON fallback even if the partial answer parses', async () => {
    const provider = createOpenAiCompatibleAgentProvider({ model: 'deepseek-flash', apiKey: 'test-only', baseUrl: 'https://api.deepseek.com',
      fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"partial"}', reasoning_content: '还在推理' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } }),
    })
    await expect(provider.completeStructuredJson!({ systemPrompt: 'Return JSON.', userPrompt: 'Investigate.', maxOutputTokens: 3500, reasoning: { onDelta: () => undefined } })).rejects.toMatchObject({ code: 'invalid_model_output' })
  })

  it('delivers low-effort reasoning before the final JSON answer and keeps usage separate', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    let request: Record<string, unknown> | undefined
    let received!: () => void
    const reasoningReceived = new Promise<void>((resolve) => { received = resolve })
    const provider = createOpenAiCompatibleAgentProvider({
      id: 'deepseek', model: 'deepseek-flash', apiKey: 'test-only', baseUrl: 'https://api.deepseek.com',
      fetcher: async (_url, init) => {
        request = JSON.parse(String(init?.body))
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          stream = controller
          controller.enqueue(event({ choices: [{ index: 0, delta: { reasoning_content: '先检查需求与当前节点。' }, finish_reason: null }] }))
        } }), { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    const reasoning: string[] = []
    let settled = false
    const completion = provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: '现在到哪里了？', maxOutputTokens: 3500,
      reasoning: { onDelta: (delta) => { reasoning.push(delta); received() } },
    }).finally(() => { settled = true })
    try {
      await reasoningReceived
      expect(settled).toBe(false)
      expect(reasoning.join('')).toBe('先检查需求与当前节点。')
      expect(request).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low', stream: true, response_format: { type: 'json_object' }, max_tokens: 3500 })
      stream.enqueue(event({ id: 'response-test', choices: [{ index: 0, delta: { content: '{"text":"需求澄清中。"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }))
      stream.enqueue(encoder.encode('data: [DONE]\r\n\r\n'))
      stream.close()
      const result = await completion
      expect(result.value).toEqual({ text: '需求澄清中。' })
      expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 30, totalTokens: 50 })
      expect(result.reasoningContent).toBe('先检查需求与当前节点。')
    } finally { try { stream.close() } catch { /* already closed */ } await completion.catch(() => undefined) }
  })
})
