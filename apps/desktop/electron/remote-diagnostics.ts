import { randomUUID } from 'node:crypto'
import { DIAGNOSTIC_HEADER, diagnosticReasonForStatus, safeDiagnosticId, type DiagnosticRecord } from '@ai-devflow/shared'

export class RemoteDiagnosticTransportError extends Error {
  constructor(readonly diagnosticId: string) { super('Remote transport unavailable') }
}

export async function readSafeDiagnosticReason(response: Response): Promise<unknown> {
  const reader = response.clone().body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []; let size = 0
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}) }, 1000)
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 4096) return undefined
      chunks.push(item.value)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body && typeof body === 'object') return (body as Record<string, unknown>).reasonCode
  } catch { /* Arbitrary server content never becomes a diagnostic. */ }
  finally { clearTimeout(timeout); void reader.cancel().catch(() => {}); reader.releaseLock() }
  return undefined
}

export function diagnosticFetch(fetcher: typeof fetch, record: (entry: DiagnosticRecord) => Promise<void>, projectId?: string): typeof fetch {
  return async (url, init) => {
    const id = randomUUID(); const started = Date.now()
    const headers = new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined)); headers.set(DIAGNOSTIC_HEADER, id)
    const pathname = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url).pathname
    const operation = pathname === '/api/desktop/pairing/exchange' ? 'pairing_exchange' : 'remote_sync'
    let response: Response
    try { response = await fetcher(url, { ...init, headers }) }
    catch {
      await record({ id, timestamp: new Date(started).toISOString(), source: 'desktop', operation, phase: 'request', outcome: 'failed', reason: init?.signal?.aborted ? 'request_timeout' : 'network_unavailable', durationMs: Date.now() - started, retryable: (init?.method ?? 'GET') === 'GET', ...(projectId ? { projectId } : {}) }).catch(() => {})
      throw new RemoteDiagnosticTransportError(id)
    }
    const reason = diagnosticReasonForStatus(response.status, operation === 'pairing_exchange' && response.status === 401 ? await readSafeDiagnosticReason(response) : undefined)
    const entry: DiagnosticRecord = { id: safeDiagnosticId(response.headers.get(DIAGNOSTIC_HEADER)) ?? id, timestamp: new Date(started).toISOString(), source: 'desktop', operation, phase: 'response', outcome: response.status < 400 ? 'succeeded' : 'failed', reason, durationMs: Date.now() - started, retryable: (init?.method ?? 'GET') === 'GET' && response.status >= 500, ...(projectId ? { projectId } : {}) }
    await record(entry).catch(() => {})
    // Older services may omit the header. Keep a local ID, and distinguish a
    // successful HTTP response from a body that cannot be decoded by the client.
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set(DIAGNOSTIC_HEADER, entry.id)
    return new Proxy(response, {
      get(target, key) {
        if (key === 'headers') return responseHeaders
        if (key === 'json') return async () => {
          try { return await target.json() }
          catch (error) {
            await record({ ...entry, outcome: 'failed', reason: 'invalid_response', durationMs: Date.now() - started }).catch(() => {})
            throw error
          }
        }
        const value = Reflect.get(target, key, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}
