// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { DIAGNOSTIC_HEADER, diagnosticDisplayError, type DiagnosticRecord } from '@ai-devflow/shared'
import { diagnosticFetch, readSafeDiagnosticReason } from './remote-diagnostics'
import { createRemoteSyncClient } from './remote-sync'

it.each([
  [401, undefined, 'unauthorized', '凭据已失效'],
  [401, 'arbitrary secret', 'unauthorized', '凭据已失效'],
  [401, 'pairing_code_invalid', 'pairing_code_invalid', '配对码无效'],
  [403, undefined, 'forbidden', '权限'],
  [503, undefined, 'service_unavailable', '暂时不可用'],
])('records and explains HTTP %s with reason %s without leaking the response', async (status, reason, expected, message) => {
  const records: DiagnosticRecord[] = []
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ reasonCode: reason, message: 'PRIVATE TOKEN', token: 'PRIVATE' }), { status }))
  const client = createRemoteSyncClient({ apiBaseUrl: 'http://example.invalid', fetcher: diagnosticFetch(fetcher, async (record) => { records.push(record) }) })
  const error = await client.exchangeDesktopPairingCode({ code: 'pair.PRIVATE' }).catch((error: unknown) => error)
  expect(diagnosticDisplayError(error)).toContain(message)
  expect(records).toMatchObject([{ reason: expected, retryable: false }])
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE|arbitrary secret|pair\./)
  expect(fetcher).toHaveBeenCalledOnce()
})

it('retains the local diagnostic ID when the network fails and does not retry a pairing mutation', async () => {
  const records: DiagnosticRecord[] = []
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('PRIVATE network state') })
  const client = createRemoteSyncClient({ apiBaseUrl: 'http://example.invalid', fetcher: diagnosticFetch(fetcher, async (record) => { records.push(record) }) })
  const error = await client.exchangeDesktopPairingCode({ code: 'pair.PRIVATE' }).catch((error: unknown) => error)
  expect(diagnosticDisplayError(error)).toContain(records[0]!.id)
  expect(records[0]).toMatchObject({ reason: 'network_unavailable', phase: 'request', retryable: false })
  const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
  expect(headers.get(DIAGNOSTIC_HEADER)).toBe(records[0]!.id)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(JSON.stringify(records)).not.toContain('PRIVATE')
})

it('bounds diagnostic body reads including stalled streams', async () => {
  expect(await readSafeDiagnosticReason(new Response('a'.repeat(5000)))).toBeUndefined()
  const stalled = new Response(new ReadableStream())
  const start = Date.now()
  expect(await readSafeDiagnosticReason(stalled)).toBeUndefined()
  expect(Date.now() - start).toBeLessThan(2000)
}, 4000)

it('keeps the same diagnostic ID for a successful HTTP response with invalid JSON', async () => {
  const records: DiagnosticRecord[] = []
  const client = createRemoteSyncClient({ apiBaseUrl: 'http://example.invalid', fetcher: diagnosticFetch(async () => new Response('PRIVATE'), async (record) => { records.push(record) }) })
  const error = await client.exchangeDesktopPairingCode({ code: 'pair.PRIVATE' }).catch((error: unknown) => error)
  expect(records.map((record) => record.reason)).toEqual(['ok', 'invalid_response'])
  expect(records[0]!.id).toBe(records[1]!.id)
  expect(diagnosticDisplayError(error)).toContain(records[0]!.id)
  expect(diagnosticDisplayError(error)).toContain('无法识别')
  expect(JSON.stringify(records)).not.toContain('PRIVATE')
})
