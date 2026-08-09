import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions,
} from 'node:https'
import type { Socket } from 'node:net'

const ARK_HOSTNAME = 'ark.cn-beijing.volces.com'
const ARK_RESPONSES_PATH = '/api/coding/v3/responses'

type UpstreamRequester = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest

export type OpencodeProviderEgressGateSnapshot = {
  armedSegmentCount: number
  forwardedRequestCount: number
  completedResponseCount: number
  failedSegmentCount: number
  blockedUncreditedRequestCount: number
  blockedInvalidCount: number
  activeRequestCount: number
  closed: boolean
}

export type OpencodeProviderEgressGate = {
  baseUrl: string
  installClientCredential(env: NodeJS.ProcessEnv, apiKeyEnvName: string): void
  allowInitialProviderStep(): void
  allowNextProviderStep(permissionId: string): Promise<void>
  snapshot(): OpencodeProviderEgressGateSnapshot
  assertPassingState(): void
  close(): Promise<void>
}

export async function createOpencodeProviderEgressGate(input: {
  providerApiKey: string
  requestUpstream?: UpstreamRequester
  headerTimeoutMs?: number
  chunkTimeoutMs?: number
  absoluteTimeoutMs?: number
  closeTimeoutMs?: number
  proxyEnv?: NodeJS.ProcessEnv
}): Promise<OpencodeProviderEgressGate> {
  if (!input.providerApiKey) {
    throw new Error('opencode provider egress gate requires a provider credential')
  }

  const requestUpstream = input.requestUpstream ?? httpsRequest
  const upstreamAgent = input.requestUpstream
    ? undefined
    : new HttpsAgent({ proxyEnv: resolveOpencodeProviderProxyEnv(input.proxyEnv ?? process.env) })
  const headerTimeoutMs = input.headerTimeoutMs ?? 185_000
  const chunkTimeoutMs = input.chunkTimeoutMs ?? 65_000
  const absoluteTimeoutMs = input.absoluteTimeoutMs ?? 215_000
  const closeTimeoutMs = input.closeTimeoutMs ?? 5_000
  const routeCapability = randomBytes(24).toString('hex')
  const clientCredential = randomBytes(32).toString('hex')
  const expectedPath = `/${routeCapability}/api/coding/v3/responses`
  const sockets = new Set<Socket>()
  const upstreamRequests = new Set<ClientRequest>()
  let armed = false
  let armedSegmentCount = 0
  let forwardedRequestCount = 0
  let completedResponseCount = 0
  let failedSegmentCount = 0
  let providerFailureObserved = false
  let blockedUncreditedRequestCount = 0
  let blockedInvalidCount = 0
  let activeRequestCount = 0
  let pendingArm:
    | {
        promise: Promise<void>
        reject: (error: Error) => void
        resolve: () => void
      }
    | undefined
  let initialArmCreated = false
  const approvedPermissionIds = new Set<string>()
  let closed = false
  let closePromise: Promise<void> | undefined
  let notifyCloseProgress: () => void = () => undefined

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== expectedPath) {
      blockedInvalidCount += 1
      respondStatic(response, 404, 'provider egress route rejected')
      return
    }
    if (!matchesBearerCredential(request.headers.authorization, clientCredential)) {
      blockedInvalidCount += 1
      respondStatic(response, 401, 'provider egress credential rejected')
      return
    }
    if (!armed || activeRequestCount !== 0 || closed) {
      blockedUncreditedRequestCount += 1
      respondStatic(response, 409, 'uncredited provider request blocked')
      return
    }

    armed = false
    forwardedRequestCount += 1
    activeRequestCount += 1
    forwardProviderRequest({
      request,
      response,
      providerApiKey: input.providerApiKey,
      requestUpstream,
      headerTimeoutMs,
      chunkTimeoutMs,
      absoluteTimeoutMs,
      upstreamRequests,
      upstreamAgent,
      onCompletedResponse: () => {
        completedResponseCount += 1
        if (pendingArm) {
          const pending = pendingArm
          pendingArm = undefined
          armed = true
          pending.resolve()
        }
      },
      onFailedResponse: () => {
        providerFailureObserved = true
        failedSegmentCount += 1
        const pending = pendingArm
        pendingArm = undefined
        pending?.reject(new Error('opencode provider egress gate source segment failed'))
      },
      onSettled: () => {
        activeRequestCount = Math.max(0, activeRequestCount - 1)
        notifyCloseProgress()
      },
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('opencode provider egress gate could not bind loopback')
  }

  const snapshot = (): OpencodeProviderEgressGateSnapshot => ({
    armedSegmentCount,
    forwardedRequestCount,
    completedResponseCount,
    failedSegmentCount,
    blockedUncreditedRequestCount,
    blockedInvalidCount,
    activeRequestCount,
    closed,
  })

  return {
    baseUrl: `http://127.0.0.1:${address.port}/${routeCapability}/api/coding/v3`,

    installClientCredential(env, apiKeyEnvName) {
      if (closed) {
        throw new Error('opencode provider egress gate is closed')
      }
      for (const name of [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy',
      ]) {
        delete env[name]
      }
      env.NO_PROXY = '127.0.0.1,localhost'
      env.no_proxy = '127.0.0.1,localhost'
      env[apiKeyEnvName] = clientCredential
    },

    allowInitialProviderStep() {
      if (closed) {
        throw new Error('opencode provider egress gate is closed')
      }
      if (initialArmCreated) {
        throw new Error('opencode provider egress gate initial step was already armed')
      }
      initialArmCreated = true
      armed = true
      armedSegmentCount += 1
    },

    allowNextProviderStep(permissionId) {
      if (closed) {
        throw new Error('opencode provider egress gate is closed')
      }
      if (!initialArmCreated) {
        throw new Error('opencode provider egress gate requires the initial step before continuation')
      }
      if (providerFailureObserved) {
        throw new Error('opencode provider egress gate source segment failed')
      }
      if (!permissionId || approvedPermissionIds.has(permissionId)) {
        throw new Error('opencode provider egress gate rejected a repeated permission approval')
      }
      approvedPermissionIds.add(permissionId)
      if (armed) {
        return Promise.resolve()
      }
      if (pendingArm) {
        return pendingArm.promise
      }
      if (armedSegmentCount >= 5) {
        throw new Error('opencode provider egress gate exceeded the provider step limit')
      }
      armedSegmentCount += 1
      if (activeRequestCount === 0) {
        armed = true
        return Promise.resolve()
      }
      let resolvePending: (() => void) | undefined
      let rejectPending: ((error: Error) => void) | undefined
      const promise = new Promise<void>((resolve, reject) => {
        resolvePending = resolve
        rejectPending = reject
      })
      void promise.catch(() => undefined)
      pendingArm = {
        promise,
        resolve: () => resolvePending?.(),
        reject: (error) => rejectPending?.(error),
      }
      return promise
    },

    snapshot,

    assertPassingState() {
      if (blockedUncreditedRequestCount !== 0) {
        throw new Error('opencode provider egress gate detected an uncredited request')
      }
      if (blockedInvalidCount !== 0) {
        throw new Error('opencode provider egress gate rejected an invalid request')
      }
      if (
        armed ||
        pendingArm !== undefined ||
        activeRequestCount !== 0 ||
        failedSegmentCount !== 0 ||
        armedSegmentCount === 0 ||
        forwardedRequestCount !== armedSegmentCount ||
        completedResponseCount !== forwardedRequestCount
      ) {
        throw new Error('opencode provider egress gate did not complete every explicit provider step')
      }
    },

    close() {
      if (closePromise) {
        return closePromise
      }
      closed = true
      armed = false
      pendingArm?.reject(new Error('opencode provider egress gate closed before continuation activation'))
      pendingArm = undefined
      closePromise = new Promise<void>((resolve, reject) => {
        let settled = false
        let serverClosed = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          notifyCloseProgress = () => undefined
          if (error) reject(new Error('opencode provider egress gate cleanup failed'))
          else resolve()
        }
        const maybeFinish = () => {
          if (serverClosed && activeRequestCount === 0 && upstreamRequests.size === 0) {
            finish()
          }
        }
        notifyCloseProgress = maybeFinish
        const timer = setTimeout(() => {
          for (const request of upstreamRequests) request.destroy()
          upstreamAgent?.destroy()
          for (const socket of sockets) socket.destroy()
          server.closeAllConnections?.()
          finish(new Error('provider egress close timed out'))
        }, closeTimeoutMs)

        for (const request of upstreamRequests) request.destroy()
        upstreamAgent?.destroy()
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections?.()
        server.close((error) => {
          if (error) {
            finish(error)
            return
          }
          serverClosed = true
          maybeFinish()
        })
      })
      return closePromise
    },
  }
}

function forwardProviderRequest(input: {
  request: IncomingMessage
  response: ServerResponse
  providerApiKey: string
  requestUpstream: UpstreamRequester
  headerTimeoutMs: number
  chunkTimeoutMs: number
  absoluteTimeoutMs: number
  upstreamRequests: Set<ClientRequest>
  upstreamAgent: HttpsAgent | undefined
  onCompletedResponse(): void
  onFailedResponse(): void
  onSettled(): void
}): void {
  let settled = false
  let responseCompleted = false
  let responseFailed = false
  let outcomeRecorded = false
  let upstreamRequest: ClientRequest | undefined
  let upstreamResponse: IncomingMessage | undefined
  let headerTimer: ReturnType<typeof setTimeout> | undefined
  let absoluteTimer: ReturnType<typeof setTimeout> | undefined
  const responseEvents = createResponsesEventObserver()
  const settle = () => {
    if (settled) return
    settled = true
    if (headerTimer) clearTimeout(headerTimer)
    if (absoluteTimer) clearTimeout(absoluteTimer)
    if (upstreamRequest) input.upstreamRequests.delete(upstreamRequest)
    input.onSettled()
  }
  const recordCompleted = () => {
    if (outcomeRecorded) return
    outcomeRecorded = true
    input.onCompletedResponse()
  }
  const recordFailed = () => {
    if (outcomeRecorded) return
    outcomeRecorded = true
    input.onFailedResponse()
  }
  const fail = () => {
    if (settled) return
    recordFailed()
    if (!input.response.headersSent) {
      respondStatic(input.response, 502, 'provider egress request failed')
    } else if (!input.response.writableEnded) {
      input.response.destroy()
    }
    upstreamResponse?.destroy()
    upstreamRequest?.destroy()
    settle()
  }

  const handleUpstreamResponse = (response: IncomingMessage) => {
    if (settled) {
      response.destroy()
      return
    }
    if (!upstreamRequest) {
      queueMicrotask(() => handleUpstreamResponse(response))
      return
    }
    upstreamResponse = response
    if (headerTimer) clearTimeout(headerTimer)
    input.response.writeHead(
      response.statusCode ?? 502,
      buildClientResponseHeaders(response.headers),
    )
    response.setTimeout(input.chunkTimeoutMs, fail)
    responseFailed = (response.statusCode ?? 502) < 200 ||
      (response.statusCode ?? 502) >= 300 ||
      !isResponsesEventStream(response.headers['content-type'])
    response.on('data', (chunk: Buffer) => {
      if (!responseEvents.observe(chunk)) {
        responseFailed = true
      }
    })
    response.once('error', fail)
    response.once('aborted', fail)
    response.once('end', () => {
      if (settled) return
      responseCompleted = true
      if (!responseFailed && responseEvents.completed()) {
        recordCompleted()
      } else {
        recordFailed()
      }
      settle()
    })
    response.once('close', () => {
      if (!responseCompleted) fail()
    })
    response.pipe(input.response)
  }

  try {
    upstreamRequest = input.requestUpstream(
      {
        hostname: ARK_HOSTNAME,
        port: 443,
        method: 'POST',
        path: ARK_RESPONSES_PATH,
        servername: ARK_HOSTNAME,
        rejectUnauthorized: true,
        headers: buildUpstreamRequestHeaders(input.request.headers, input.providerApiKey),
        ...(input.upstreamAgent ? { agent: input.upstreamAgent } : {}),
      },
      handleUpstreamResponse,
    )
  } catch {
    fail()
    return
  }
  input.upstreamRequests.add(upstreamRequest)
  headerTimer = setTimeout(fail, input.headerTimeoutMs)
  absoluteTimer = setTimeout(fail, input.absoluteTimeoutMs)
  upstreamRequest.once('error', fail)
  input.request.once('aborted', fail)
  input.request.once('error', fail)
  input.response.once('close', () => {
    if (!input.response.writableEnded && !responseCompleted) fail()
  })
  try {
    input.request.pipe(upstreamRequest)
  } catch {
    fail()
  }
}

function buildUpstreamRequestHeaders(
  headers: IncomingHttpHeaders,
  providerApiKey: string,
): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {
    authorization: `Bearer ${providerApiKey}`,
  }
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (
      value !== undefined &&
      (lowerName === 'accept' ||
        lowerName === 'content-type' ||
        lowerName === 'content-length' ||
        lowerName === 'user-agent' ||
        lowerName.startsWith('x-stainless-'))
    ) {
      forwarded[lowerName] = value
    }
  }
  return forwarded
}

function createResponsesEventObserver(): {
  observe(chunk: Buffer): boolean
  completed(): boolean
} {
  const maximumBufferedBytes = 256 * 1024
  let buffer = ''
  let sawCompleted = false
  let sawDone = false
  let sawFailure = false
  return {
    observe(chunk) {
      if (sawFailure) return false
      buffer += chunk.toString('utf8')
      if (Buffer.byteLength(buffer, 'utf8') > maximumBufferedBytes) {
        sawFailure = true
        buffer = ''
        return false
      }
      const normalized = buffer.replaceAll('\r\n', '\n')
      const events = normalized.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') {
          if (!sawCompleted || sawDone) {
            sawFailure = true
            return false
          }
          sawDone = true
          continue
        }
        if (sawCompleted || sawDone) {
          sawFailure = true
          return false
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          sawFailure = true
          return false
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sawFailure = true
          return false
        }
        const type = (parsed as Record<string, unknown>).type
        if (
          type === 'response.failed' ||
          type === 'response.incomplete' ||
          type === 'error'
        ) {
          sawFailure = true
          return false
        }
        if (type === 'response.completed') {
          if (sawCompleted) {
            sawFailure = true
            return false
          }
          sawCompleted = true
        }
      }
      return true
    },
    completed() {
      return sawCompleted && !sawFailure && buffer.trim().length === 0
    },
  }
}

function isResponsesEventStream(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false
  const [mediaType] = value.split(';', 1)
  return mediaType?.trim().toLowerCase() === 'text/event-stream'
}

function buildClientResponseHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (
      value !== undefined &&
      (lowerName === 'content-type' ||
        lowerName === 'content-encoding' ||
        lowerName === 'content-length' ||
        lowerName === 'cache-control' ||
        lowerName === 'retry-after' ||
        lowerName === 'retry-after-ms' ||
        lowerName.startsWith('x-ratelimit-'))
    ) {
      forwarded[lowerName] = value
    }
  }
  return forwarded
}

function matchesBearerCredential(value: string | undefined, expected: string): boolean {
  if (!value?.startsWith('Bearer ')) return false
  const actualBuffer = Buffer.from(value.slice('Bearer '.length))
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function respondStatic(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    connection: 'close',
  })
  response.end(JSON.stringify({ error: message }))
}

export function resolveOpencodeProviderProxyEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const name of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]) {
    const value = source[name]
    if (value !== undefined) result[name] = value
  }
  if (result.HTTPS_PROXY === undefined && result.https_proxy === undefined) {
    const fallback = source.HTTPS_PROXY ?? source.https_proxy ?? source.ALL_PROXY ?? source.all_proxy
    if (fallback !== undefined) result.HTTPS_PROXY = fallback
  }
  return result
}
