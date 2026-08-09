import { once } from 'node:events'
import {
  createServer,
  request as httpRequest,
} from 'node:http'
import type { RequestOptions } from 'node:https'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createOpencodeProviderEgressGate,
  resolveOpencodeProviderProxyEnv,
} from './opencode-provider-egress-gate'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('opencode provider egress gate', () => {
  it('keeps only provider proxy settings and normalizes an ALL_PROXY fallback for HTTPS', () => {
    expect(resolveOpencodeProviderProxyEnv({
      ALL_PROXY: 'http://all-proxy.invalid',
      NO_PROXY: 'internal.invalid',
      UNRELATED_SECRET: 'must-not-pass',
    })).toEqual({
      HTTPS_PROXY: 'http://all-proxy.invalid',
      NO_PROXY: 'internal.invalid',
    })
    expect(resolveOpencodeProviderProxyEnv({
      HTTPS_PROXY: 'http://https-proxy.invalid',
      ALL_PROXY: 'http://all-proxy.invalid',
    }).HTTPS_PROXY).toBe('http://https-proxy.invalid')
  })

  it('streams one credentialed request per explicitly armed relay segment', async () => {
    const receivedBodies: string[] = []
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        receivedBodies.push(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"type":"response.created"}\n\n')
        setTimeout(() => response.end('data: {"type":"response.completed"}\n\n'), 1)
      })
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const observedOptions: RequestOptions[] = []
    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (options, onResponse) => {
        observedOptions.push(options)
        return httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            method: options.method,
            path: '/fixture-responses',
            headers: options.headers,
          },
          onResponse,
        )
      },
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {
      HTTP_PROXY: 'http://proxy.invalid',
      HTTPS_PROXY: 'http://proxy.invalid',
      ALL_PROXY: 'http://proxy.invalid',
      http_proxy: 'http://proxy.invalid',
      https_proxy: 'http://proxy.invalid',
      all_proxy: 'http://proxy.invalid',
    }
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    expect(runtimeEnv).toMatchObject({
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    })
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      expect(runtimeEnv[name]).toBeUndefined()
    }

    gate.allowInitialProviderStep()
    const first = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"step":1}')
    expect(first.status).toBe(200)
    expect(await first.text()).toBe(
      'data: {"type":"response.created"}\n\ndata: {"type":"response.completed"}\n\n',
    )

    await gate.allowNextProviderStep('permission-1')
    const second = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"step":2}')
    expect(second.status).toBe(200)
    await second.text()

    expect(receivedBodies).toEqual(['{"step":1}', '{"step":2}'])
    expect(observedOptions).toHaveLength(2)
    expect(observedOptions[0]).toMatchObject({
      hostname: 'ark.cn-beijing.volces.com',
      method: 'POST',
      path: '/api/coding/v3/responses',
      rejectUnauthorized: true,
      servername: 'ark.cn-beijing.volces.com',
    })
    expect(observedOptions[0]?.headers).toMatchObject({
      authorization: 'Bearer RAW_REAL_PROVIDER_KEY',
    })
    expect(gate.snapshot()).toEqual({
      armedSegmentCount: 2,
      forwardedRequestCount: 2,
      completedResponseCount: 2,
      failedSegmentCount: 0,
      blockedUncreditedRequestCount: 0,
      blockedInvalidCount: 0,
      activeRequestCount: 0,
      closed: false,
    })
    expect(() => gate.assertPassingState()).not.toThrow()

    await gate.close()
    expect(gate.snapshot().closed).toBe(true)
    expect(JSON.stringify(gate.snapshot())).not.toContain('RAW_REAL_PROVIDER_KEY')
    expect(JSON.stringify(gate.snapshot())).not.toContain('step')
  })

  it('blocks concurrent or unarmed requests before they reach the provider', async () => {
    let upstreamRequestCount = 0
    const upstream = createServer((_request, response) => {
      upstreamRequestCount += 1
      setTimeout(
        () => response.end('data: {"type":"response.completed"}\n\n'),
        20,
      )
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const [first, duplicate] = await Promise.all([
      sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}'),
      sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":2}'),
    ])
    expect([first.status, duplicate.status].sort()).toEqual([200, 409])
    await Promise.all([first.text(), duplicate.text()])
    expect(upstreamRequestCount).toBe(1)
    expect(gate.snapshot().forwardedRequestCount).toBe(1)
    expect(gate.snapshot().blockedUncreditedRequestCount).toBe(1)
    expect(() => gate.assertPassingState()).toThrow(
      'opencode provider egress gate detected an uncredited request',
    )
  })

  it('waits for a successful source stream before activating a continuation credit', async () => {
    let requestCount = 0
    let completeFirst: (() => void) | undefined
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (requestCount === 1) {
        response.write('data: {"type":"response.created"}\n\n')
        completeFirst = () => response.end('data: {"type":"response.completed"}\n\n')
        return
      }
      response.end('data: {"type":"response.completed"}\n\n')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const first = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}')
    let activated = false
    const activation = gate.allowNextProviderStep('permission-1').then(() => {
      activated = true
    })
    await Promise.resolve()
    expect(activated).toBe(false)
    completeFirst?.()
    await first.text()
    await activation
    expect(activated).toBe(true)

    const second = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":2}')
    await second.text()
    expect(() => gate.assertPassingState()).not.toThrow()
  })

  it('rejects the wrong route or client credential without forwarding', async () => {
    let upstreamRequestCount = 0
    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, _onResponse) => {
        upstreamRequestCount += 1
        return httpRequest({ hostname: '127.0.0.1', port: 9 })
      },
    })
    cleanups.push(() => gate.close())
    gate.allowInitialProviderStep()

    const wrongCredential = await fetch(`${gate.baseUrl}/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: '{}',
    })
    const wrongRoute = await fetch(`${gate.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: '{}',
    })

    expect(wrongCredential.status).toBe(401)
    expect(wrongRoute.status).toBe(404)
    expect(upstreamRequestCount).toBe(0)
    expect(gate.snapshot().blockedInvalidCount).toBe(2)
  })

  it('does not convert a failed provider stream into a continuation credit', async () => {
    let upstreamRequestCount = 0
    let finishStream: (() => void) | undefined
    const upstream = createServer((_request, response) => {
      upstreamRequestCount += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"type":"response.output_item.done"}\n\n')
      finishStream = () => response.end('data: {"type":"response.failed"}\n\n')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const first = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}')
    const continuationActivation = gate.allowNextProviderStep('permission-from-partial-stream')
    finishStream?.()
    await first.text()
    await expect(continuationActivation).rejects.toThrow(
      'opencode provider egress gate source segment failed',
    )
    const retry = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":2}')

    expect(retry.status).toBe(409)
    expect(upstreamRequestCount).toBe(1)
    expect(gate.snapshot()).toMatchObject({
      failedSegmentCount: 1,
      blockedUncreditedRequestCount: 1,
      forwardedRequestCount: 1,
      completedResponseCount: 0,
    })
  })

  it('permanently refuses continuation credit after a source segment already failed', async () => {
    let upstreamRequestCount = 0
    const upstream = createServer((_request, response) => {
      upstreamRequestCount += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"type":"response.failed"}\n\n')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const failed = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}')
    await failed.text()

    await expect(
      Promise.resolve().then(() => gate.allowNextProviderStep('permission-after-failure')),
    ).rejects.toThrow('opencode provider egress gate source segment failed')
    const blocked = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":2}')

    expect(blocked.status).toBe(409)
    expect(upstreamRequestCount).toBe(1)
    expect(gate.snapshot()).toMatchObject({
      armedSegmentCount: 1,
      forwardedRequestCount: 1,
      completedResponseCount: 0,
      failedSegmentCount: 1,
      blockedUncreditedRequestCount: 1,
    })
  })

  it.each([
    {
      name: 'DONE before response.completed',
      contentType: 'text/event-stream',
      body: 'data: [DONE]\n\ndata: {"type":"response.completed"}\n\n',
    },
    {
      name: 'a lookalike event-stream media type',
      contentType: 'text/event-stream-evil',
      body: 'data: {"type":"response.completed"}\n\n',
    },
  ])('fails closed on $name', async ({ contentType, body }) => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const response = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}')
    await response.text()

    expect(gate.snapshot()).toMatchObject({
      completedResponseCount: 0,
      failedSegmentCount: 1,
      activeRequestCount: 0,
    })
    expect(() => gate.assertPassingState()).toThrow()
  })

  it('contains a synchronous upstream requester failure and settles the active request', async () => {
    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: () => {
        throw new Error('RAW_SYNCHRONOUS_UPSTREAM_FAILURE')
      },
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()

    const response = await sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}')

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('RAW_SYNCHRONOUS_UPSTREAM_FAILURE')
    expect(gate.snapshot()).toMatchObject({
      activeRequestCount: 0,
      failedSegmentCount: 1,
      forwardedRequestCount: 1,
      completedResponseCount: 0,
    })
  })

  it('does not resolve close until an active upstream request has settled', async () => {
    let upstreamStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      upstreamStarted = resolve
    })
    const upstream = createServer((_request, _response) => {
      upstreamStarted?.()
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    cleanups.push(() => closeServer(upstream))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('fixture server did not listen')

    const gate = await createOpencodeProviderEgressGate({
      providerApiKey: 'RAW_REAL_PROVIDER_KEY',
      requestUpstream: (_options, onResponse) =>
        httpRequest({ hostname: '127.0.0.1', port: address.port, method: 'POST' }, onResponse),
      closeTimeoutMs: 500,
      headerTimeoutMs: 5_000,
      absoluteTimeoutMs: 5_000,
    })
    cleanups.push(() => gate.close())
    const runtimeEnv: NodeJS.ProcessEnv = {}
    gate.installClientCredential(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN')
    gate.allowInitialProviderStep()
    const request = sendThroughGate(gate.baseUrl, runtimeEnv, '{"request":1}').catch(() => undefined)
    await started

    await gate.close()
    await request

    expect(gate.snapshot()).toMatchObject({
      activeRequestCount: 0,
      closed: true,
      failedSegmentCount: 1,
    })
  })
})

async function sendThroughGate(
  baseUrl: string,
  runtimeEnv: NodeJS.ProcessEnv,
  body: string,
): Promise<Response> {
  return fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${runtimeEnv['ANTHROPIC_AUTH_TOKEN'] ?? ''}`,
      'content-type': 'application/json',
    },
    body,
  })
}

async function closeServer(server: {
  close(callback: (error?: Error) => void): void
  closeAllConnections?: () => void
}): Promise<void> {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
