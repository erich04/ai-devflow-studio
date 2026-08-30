// @vitest-environment node

import { createServer, type RequestListener, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentProviderRequestError,
  createOpenAiCompatibleAgentProvider,
} from './agent-review'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })))
  servers.length = 0
})

async function startCompatibleServer(
  handler: RequestListener,
): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local provider server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('Agent Provider structured request errors', () => {
  it('classifies the bounded request abort as a typed provider timeout', async () => {
    const serverUrl = await startCompatibleServer((_request, response) => {
      setTimeout(() => {
        if (!response.destroyed) response.end('{}')
      }, 200)
    })
    const provider = createOpenAiCompatibleAgentProvider({
      id: 'local-compatible',
      model: 'test-model',
      apiKey: 'must-never-appear',
      baseUrl: `${serverUrl}/v1`,
      structuredRequestTimeoutMs: 20,
    })

    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.',
      userPrompt: 'SECRET_PROMPT_CONTENT',
      maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentProviderRequestError)
    expect(failure).toMatchObject({
      code: 'provider_timeout',
      deliveryState: 'possibly_delivered',
      billingState: 'unknown',
      retryable: true,
      httpStatus: null,
    })
    expect(JSON.stringify(failure)).not.toContain('SECRET_PROMPT_CONTENT')
    expect(JSON.stringify(failure)).not.toContain('must-never-appear')
  })

  it.each([
    [429, 'http_429', true, 'not_incurred'],
    [400, 'http_4xx', false, 'not_incurred'],
    [503, 'http_5xx', true, 'unknown'],
  ] as const)('classifies HTTP %i without retaining the response body', async (
    status,
    code,
    retryable,
    billingState,
  ) => {
    const serverUrl = await startCompatibleServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end('{"secret":"FULL_RESPONSE_MUST_NOT_PERSIST"}')
    })
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model',
      apiKey: 'placeholder',
      baseUrl: `${serverUrl}/v1`,
    })

    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code,
      deliveryState: 'response_received',
      billingState,
      retryable,
      httpStatus: status,
    })
    expect(JSON.stringify(failure)).not.toContain('FULL_RESPONSE_MUST_NOT_PERSIST')
  })

  it('classifies an explicit proxy-authentication response', async () => {
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder',
      fetcher: async () => new Response('', { status: 407 }),
    })
    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'proxy_failure', deliveryState: 'response_received',
      billingState: 'not_incurred', retryable: true, httpStatus: 407,
    })
  })

  it.each([
    ['broken HTTP JSON', '{broken', 'invalid_response_json', true],
    [
      'invalid model JSON',
      JSON.stringify({
        choices: [{ message: { content: 'not-json' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cached_tokens: 0 },
      }),
      'invalid_model_output',
      true,
    ],
    [
      'invalid usage',
      JSON.stringify({
        choices: [{ message: { content: '{"stateVersion":2}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cached_tokens: 2 },
      }),
      'invalid_usage',
      false,
    ],
    ['oversized response', 'x'.repeat(70 * 1_024), 'response_too_large', false],
  ] as const)('classifies %s from the local compatible server', async (
    _label,
    body,
    code,
    retryable,
  ) => {
    const serverUrl = await startCompatibleServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
    })
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder', baseUrl: `${serverUrl}/v1`,
    })

    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code,
      deliveryState: 'response_received',
      billingState: 'unknown',
      retryable,
      httpStatus: 200,
    })
    expect(JSON.stringify(failure)).not.toContain(body.slice(0, 100))
  })

  it('stops reading a chunked provider response as soon as the byte limit is exceeded', async () => {
    let pulls = 0
    let cancelled = false
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(16 * 1_024).fill(120))
        if (pulls === 8) controller.close()
      },
      cancel() {
        cancelled = true
      },
    }), { status: 200 })
    const text = vi.spyOn(response, 'text')
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder', fetcher: async () => response,
    })

    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'response_too_large',
      deliveryState: 'response_received',
      billingState: 'unknown',
      retryable: false,
      httpStatus: 200,
    })
    expect(text).not.toHaveBeenCalled()
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(8)
  })

  it('does not trust a forged smaller Content-Length for the provider response bound', async () => {
    const response = new Response('x'.repeat(70 * 1_024), {
      status: 200,
      headers: { 'content-length': '1' },
    })
    const text = vi.spyOn(response, 'text')
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder', fetcher: async () => response,
    })

    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'response_too_large', httpStatus: 200 })
    expect(text).not.toHaveBeenCalled()
  })

  it.each([
    ['ENOTFOUND', 'dns_failure', 'not_sent', 'not_incurred', true],
    ['CERT_HAS_EXPIRED', 'tls_failure', 'not_sent', 'not_incurred', false],
    ['ECONNRESET', 'connection_reset', 'possibly_delivered', 'unknown', true],
    ['ERR_PROXY_CONNECTION_FAILED', 'proxy_failure', 'not_sent', 'not_incurred', true],
    ['UNMAPPED_PROVIDER_CODE', 'unknown_provider_failure', 'possibly_delivered', 'unknown', false],
  ] as const)('classifies structured transport cause %s without matching its message', async (
    causeCode,
    code,
    deliveryState,
    billingState,
    retryable,
  ) => {
    const cause = Object.assign(new Error('RAW_TRANSPORT_SECRET'), { code: causeCode })
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder',
      fetcher: async () => { throw new TypeError('fetch failed', { cause }) },
    })
    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code, deliveryState, billingState, retryable })
    expect(JSON.stringify(failure)).not.toContain('RAW_TRANSPORT_SECRET')
  })

  it('classifies a local compatible-server connection reset', async () => {
    const serverUrl = await startCompatibleServer((request) => request.socket.destroy())
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder', baseUrl: `${serverUrl}/v1`,
    })
    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'connection_reset', deliveryState: 'possibly_delivered',
      billingState: 'unknown', retryable: true,
    })
  })

  it('distinguishes caller cancellation from the provider timeout', async () => {
    const serverUrl = await startCompatibleServer((_request, response) => {
      setTimeout(() => {
        if (!response.destroyed) response.end('{}')
      }, 200)
    })
    const provider = createOpenAiCompatibleAgentProvider({
      model: 'test-model', apiKey: 'placeholder', baseUrl: `${serverUrl}/v1`,
      structuredRequestTimeoutMs: 1_000,
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)
    const failure = await provider.completeStructuredJson!({
      systemPrompt: 'Return JSON.', userPrompt: 'Task.', maxOutputTokens: 64,
      signal: controller.signal,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'cancelled_by_user', deliveryState: 'possibly_delivered',
      billingState: 'unknown', retryable: true,
    })
  })
})
