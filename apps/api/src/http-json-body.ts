import type { IncomingMessage } from 'node:http'

export const MAX_JSON_BODY_BYTES = 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`JSON request body exceeds ${MAX_JSON_BODY_BYTES} bytes`)
    this.name = 'RequestBodyTooLargeError'
  }
}

function declaredContentLength(request: IncomingMessage): number | null {
  const raw = request.headers['content-length']
  if (raw === undefined) return null
  if (!/^\d+$/.test(raw)) {
    throw new SyntaxError('Invalid Content-Length header')
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestBodyTooLargeError()
  }
  return parsed
}

export async function readBoundedJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = declaredContentLength(request)
  if (contentLength !== null && contentLength > MAX_JSON_BODY_BYTES) {
    throw new RequestBodyTooLargeError()
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError()
    }
    chunks.push(buffer)
  }

  const rawBody = Buffer.concat(chunks, totalBytes).toString('utf8').trim()
  if (!rawBody) return undefined
  return JSON.parse(rawBody) as unknown
}
