import { randomUUID } from 'node:crypto'
import { DIAGNOSTIC_HEADER, diagnosticReasonForStatus, safeDiagnosticId, type DiagnosticRecord } from '@ai-devflow/shared'
import type { ApiRouteResult } from './routes/team-routes'

export async function withApiDiagnostics(input: {
  id?: unknown; pathname: string; method: string
  run(): Promise<ApiRouteResult | null>
  record(record: DiagnosticRecord): Promise<void>
}): Promise<ApiRouteResult> {
  const id = safeDiagnosticId(input.id) ?? randomUUID()
  const started = Date.now()
  let route: ApiRouteResult
  try { route = await input.run() ?? { status: 404, body: { error: 'not_found' } } }
  catch { route = { status: 500, body: { error: 'internal_error', message: 'Unexpected API error' } } }
  const body = route.body && typeof route.body === 'object' && !Array.isArray(route.body) ? route.body as Record<string, unknown> : {}
  const operation = input.pathname === '/api/desktop/pairing/exchange' ? 'pairing_exchange'
    : /^\/api\/team\/projects\/[^/]+\/pairing-codes$/u.test(input.pathname) ? 'pairing_create'
      : input.pathname.includes('/pairing-codes/') ? 'pairing_revoke' : 'api_request'
  const reason = diagnosticReasonForStatus(route.status, operation === 'pairing_exchange' ? body.reasonCode : undefined)
  // Unauthenticated pairing has no fabricated organization, member or project owner.
  try { await input.record({ id, timestamp: new Date(started).toISOString(), source: 'api', operation,
    phase: 'response', outcome: route.status < 400 ? 'succeeded' : 'failed', reason,
    durationMs: Date.now() - started, retryable: input.method === 'GET' && route.status >= 500,
  }) } catch { console.error(JSON.stringify({ event: 'diagnostic_write_failed', diagnosticId: id })) }
  return { ...route, headers: { ...route.headers, [DIAGNOSTIC_HEADER]: id, 'access-control-expose-headers': DIAGNOSTIC_HEADER },
    ...(route.status >= 400 ? { body: { ...body, diagnosticId: id } } : {}),
  }
}
