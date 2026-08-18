import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
  readBoundedJsonBody,
} from './http-json-body'

function requestFrom(chunks: Array<string | Buffer>, contentLength?: number): IncomingMessage {
  const request = Readable.from(chunks) as IncomingMessage
  request.headers = contentLength === undefined
    ? {}
    : { 'content-length': String(contentLength) }
  return request
}

describe('bounded JSON request bodies', () => {
  it('accepts a valid body at the exact byte limit', async () => {
    const prefix = '{"value":"'
    const suffix = '"}'
    const body = `${prefix}${'a'.repeat(MAX_JSON_BODY_BYTES - prefix.length - suffix.length)}${suffix}`

    await expect(
      readBoundedJsonBody(requestFrom([body], Buffer.byteLength(body))),
    ).resolves.toEqual({ value: 'a'.repeat(MAX_JSON_BODY_BYTES - prefix.length - suffix.length) })
  })

  it('rejects a declared body larger than the limit before consuming it', async () => {
    const request = requestFrom(['{}'], MAX_JSON_BODY_BYTES + 1)

    await expect(readBoundedJsonBody(request)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    expect(request.readableEnded).toBe(false)
  })

  it('rejects chunked input as soon as accumulated bytes exceed the limit', async () => {
    const request = requestFrom([
      Buffer.alloc(MAX_JSON_BODY_BYTES, 0x20),
      Buffer.from('x'),
    ])

    await expect(readBoundedJsonBody(request)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('preserves malformed JSON as a syntax error', async () => {
    await expect(readBoundedJsonBody(requestFrom(['{"value":']))).rejects.toBeInstanceOf(
      SyntaxError,
    )
  })
})
