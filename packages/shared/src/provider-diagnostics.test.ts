// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createOpenAiCompatibleAgentProvider, normalizeKnowledgeReviewProviderOutput, sanitizeAgentProviderRequestMetadata, sanitizeAgentProviderResponseMetadata } from './agent-review'

import { readProviderResponse } from './provider-response'
import { resolveRequestPolicy } from './provider-request-policy'

const base = { model: 'deepseek-flash', apiKey: 'sk-PRIVATE_CREDENTIAL', baseUrl: 'https://api.deepseek.com' }
const request = { systemPrompt: 'PRIVATE_SYSTEM return JSON', userPrompt: 'PRIVATE_USER', maxOutputTokens: 512 }
const encoder = new TextEncoder()
function stream(parts: string[]) { return new Response(new ReadableStream({ start(controller) {
  for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close()
} }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-fixture-1' } }) }
function frame(value: unknown) { return `data: ${JSON.stringify(value)}\n\n` }
function provider(fetcher: typeof fetch) { return createOpenAiCompatibleAgentProvider({ ...base, fetcher }) }

describe('safe provider attempt diagnostics', () => {
  it('records actual wire configuration and terminal metadata for ordinary chat', async () => {
    const p = provider(async () => Response.json({ id: 'chat-fixture', choices: [{ message: { content: '{"ok":true}', reasoning_content: 'PRIVATE_REASONING' }, finish_reason: 'stop' }] }, { headers: { 'x-request-id': 'req-fixture-1' } }))
    const result = await p.completeStructuredJson!(request)
    expect(result).toMatchObject({ requestMetadata: { version: 1, model: 'deepseek-flash', mode: 'structured', jsonMode: 'json_object', stream: true, maxOutputTokens: 512, messageCount: 2, toolCount: 0 }, responseMetadata: { httpStatus: 200, requestId: 'req-fixture-1', finishReason: 'stop', contentLength: 11, durationMs: expect.any(Number), contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) } })
    expect(JSON.stringify({ request: (result as unknown as { requestMetadata: unknown }).requestMetadata, response: result.responseMetadata })).not.toMatch(/PRIVATE|sk-/u)
  })

  it('locates malformed model JSON without keeping body or SyntaxError text', async () => {
    const raw = '{\n"private": "PRIVATE_RESPONSE",\n"ok" true}'
    const p = provider(async () => Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
    const error = await p.completeStructuredJson!(request).catch(error => error)
    expect(error).toMatchObject({ sanitizedCause: 'invalid_json', billingState: 'confirmed', usage: { inputTokens: 20, outputTokens: 10 }, responseMetadata: { parserCategory: 'model_json', parserPosition: raw.indexOf('true'), parserLine: 3, parserColumn: 6, parserPositionUnit: 'utf16', contentLength: raw.length } })
    expect(JSON.stringify(error.responseMetadata)).not.toContain('PRIVATE_RESPONSE')
  })

  it('keeps terminal stream evidence and final usage when DONE never arrives', async () => {
    const p = provider(async () => stream([frame({ id: 'chat-fixture', choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } })]))
    await expect(p.completeStructuredJson!(request)).rejects.toMatchObject({ billingState: 'confirmed', responseMetadata: { parserCategory: 'stream_incomplete', streamed: true, sseFrameCount: 1, sseDataFrameCount: 1, streamDoneReceived: false, streamFinishReceived: true, streamCompleted: false, contentDigest: expect.stringMatching(/^sha256:/u) } })
  })

  it('retains safe configuration on a never-sent connection failure', async () => {
    const p = provider(async () => { throw new TypeError('PRIVATE_SOCKET', { cause: { code: 'ECONNREFUSED' } }) })
    const error = await p.completeStructuredJson!(request).catch(error => error)
    expect(error).toMatchObject({ code: 'connection_failed', httpStatus: null, billingState: 'not_incurred', requestMetadata: { model: 'deepseek-flash', jsonMode: 'json_object' } })
    expect(JSON.stringify(error.requestMetadata)).not.toMatch(/PRIVATE|sk-/u)
  })

  it('labels schema validation independently of model JSON parsing', () => {
    expect(() => normalizeKnowledgeReviewProviderOutput({}, { model: 'fixture', responseMetadata: { httpStatus: 200 } })).toThrow(expect.objectContaining({ responseMetadata: expect.objectContaining({ parserCategory: 'schema' }) }))
  })
})

it.each([
  ['empty model content', '', 'stop', 'model_content', 'empty_content'],
  ['non-object model JSON', '[]', 'stop', 'model_shape', 'not_json_object'],
  ['trailing text outside object', '{"ok":true} PRIVATE_SUFFIX', 'stop', 'model_json', 'invalid_json'],
  ['length stop with apparently valid object', '{"ok":true}', 'length', 'model_finish', 'output_length'],
])('distinguishes %s', async (_title, content, finish_reason, parserCategory, sanitizedCause) => {
  const p = provider(async () => Response.json({ choices: [{ message: { content }, finish_reason }] }))
  const error = await p.completeStructuredJson!(request).catch(error => error)
  expect(error).toMatchObject({ sanitizedCause, responseMetadata: { parserCategory } })
  expect(JSON.stringify(error.responseMetadata)).not.toMatch(/PRIVATE/u)
})

it('keeps unknown position unknown when the engine does not expose a numeric offset', async () => {
  const p = provider(async () => Response.json({ choices: [{ message: { content: 'PRIVATE_RESPONSE' }, finish_reason: 'stop' }] }))
  const error = await p.completeStructuredJson!(request).catch(error => error)
  expect(error.responseMetadata).toMatchObject({ parserCategory: 'model_json', parserErrorKind: 'syntax' })
  expect(error.responseMetadata.parserPosition).toBeUndefined()
})

it('reports positions relative to full model content after removing a supported JSON fence', async () => {
  const raw = ' \n```json\n{\n"ok" true}\n```  '
  const p = provider(async () => Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }))
  const error = await p.completeStructuredJson!(request).catch(error => error)
  expect(error.responseMetadata).toMatchObject({ parserCategory: 'model_json', parserPosition: raw.indexOf('true'), parserLine: 4, parserColumn: 6 })
})

it('counts heartbeat, data and DONE frames independently', async () => {
  const p = provider(async () => stream([': heartbeat\n\n', frame({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']))
  await expect(p.completeStructuredJson!(request)).resolves.toMatchObject({ responseMetadata: { streamed: true, sseFrameCount: 3, sseDataFrameCount: 2, streamDoneReceived: true, streamFinishReceived: true, streamCompleted: true } })
})

it('distinguishes DONE without a finish frame from a completed stream', async () => {
  const p = provider(async () => stream([frame({ choices: [{ delta: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }), 'data: [DONE]\n\n']))
  await expect(p.completeStructuredJson!(request)).rejects.toMatchObject({ billingState: 'unknown', usage: { usageCompleteness: 'partial' }, responseMetadata: { parserCategory: 'stream_incomplete', streamDoneReceived: true, streamFinishReceived: false, streamCompleted: false } })
})

it('retains aggregate stream counts, partial usage and content digest on bad SSE JSON', async () => {
  const p = provider(async () => stream([frame({ choices: [{ delta: { content: '{"partial":' } }], usage: { prompt_tokens: 20, completion_tokens: 2 } }), 'data: {"ok" true}\n\n']))
  await expect(p.completeStructuredJson!(request)).rejects.toMatchObject({ billingState: 'unknown', usage: { usageCompleteness: 'partial' }, responseMetadata: { parserCategory: 'sse_json', parserPosition: 6, contentBytes: 11, sseFrameCount: 2, sseDataFrameCount: 2, streamCompleted: false, contentDigest: expect.stringMatching(/^sha256:/u) } })
})

it('distinguishes invalid outer HTTP JSON and an HTTP rejection without retaining its private body', async () => {
  const malformed = provider(async () => new Response('{"ok" true}'))
  await expect(malformed.completeStructuredJson!(request)).rejects.toMatchObject({ responseMetadata: { parserCategory: 'response_json', parserPosition: 6, wireBytes: 11 } })
  const rejected = provider(async () => new Response('PRIVATE_ERROR_DETAIL', { status: 503, headers: { 'x-request-id': 'req-failed-1' } }))
  const error = await rejected.completeStructuredJson!(request).catch(error => error)
  expect(error).toMatchObject({ billingState: 'unknown', requestMetadata: { maxOutputTokens: 512 }, responseMetadata: { httpStatus: 503, parserCategory: 'http', requestId: 'req-failed-1', endedAt: expect.any(String) } })
  expect(JSON.stringify(error)).not.toContain('PRIVATE_ERROR_DETAIL')
})

it('whitelists request/response fields again on persistence and export', async () => {
  const p = provider(async () => Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }))
  const result = await p.completeStructuredJson!(request)
  const extra = { content: 'PRIVATE_RESPONSE', reasoningContent: 'PRIVATE_REASONING', apiKey: 'sk-PRIVATE_CREDENTIAL', headers: { authorization: 'PRIVATE_HEADER' }, error: 'PRIVATE_EXCEPTION' }
  const cleanRequest = sanitizeAgentProviderRequestMetadata({ ...result.requestMetadata, ...extra, thinking: { ...result.requestMetadata?.thinking, ...extra } })
  const cleanResponse = sanitizeAgentProviderResponseMetadata({ ...result.responseMetadata, ...extra, responseId: 'sk-PRIVATE_CREDENTIAL', parserCategory: 'PRIVATE_CATEGORY', parserPosition: Infinity, effectiveThinking: { ...result.responseMetadata?.effectiveThinking, ...extra } })
  expect(cleanRequest).toEqual(result.requestMetadata)
  expect(cleanResponse).toMatchObject({ httpStatus: 200 })
  expect(cleanResponse?.responseId).toBeUndefined()
  expect(cleanResponse?.parserPosition).toBeUndefined()
  expect(cleanResponse?.parserCategory).toBeUndefined()
  expect(JSON.stringify({ cleanRequest, cleanResponse })).not.toMatch(/PRIVATE|sk-/u)
  expect(sanitizeAgentProviderRequestMetadata({ ...result.requestMetadata, model: 'sk-PRIVATE_CREDENTIAL' })).toBeUndefined()
  expect(sanitizeAgentProviderResponseMetadata({ httpStatus: 0 })).toBeUndefined()
})

it('does not let diagnostics storage callback failures replace either parse errors or success', async () => {
  const options = { signal: new AbortController().signal, policy: resolveRequestPolicy(base), onUsage() {}, onDiagnostics() { throw new Error('PRIVATE_LOG_FAILURE') } }
  await expect(readProviderResponse({ ...options, response: Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) })).resolves.toMatchObject({ diagnostics: { contentDigest: expect.stringMatching(/^sha256:/u) } })
  await expect(readProviderResponse({ ...options, response: new Response('{"ok" true}') })).rejects.toMatchObject({ diagnostics: { parserCategory: 'response_json' } })
})

it('locates unexpected EOF at the end of parsed JSON, before a removed closing fence', async () => {
  const raw = '```json\n{"ok":\n```'
  const p = provider(async () => Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }))
  const error = await p.completeStructuredJson!(request).catch(error => error)
  expect(error.responseMetadata).toMatchObject({ parserCategory: 'model_json', parserErrorKind: 'unexpected_end', parserPosition: raw.indexOf('\n```'), parserLine: 2, parserColumn: 7 })
})
