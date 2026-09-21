import { describe, expect, it } from 'vitest'
import { diagnosticReasonForStatus, diagnosticUserMessage, sanitizeDiagnosticRecord } from './diagnostics'
describe('safe operation diagnostics', () => {
  it('does not turn arbitrary 401s or server text into an expired pairing code', () => {
    expect(diagnosticReasonForStatus(401)).toBe('unauthorized')
    expect(diagnosticReasonForStatus(401, 'pairing_code_expired')).toBe('pairing_code_expired')
    expect(diagnosticReasonForStatus(401, 'secret token was revoked')).toBe('unauthorized')
    expect(diagnosticUserMessage('pairing_code_expired')).toContain('重新生成')
    expect(diagnosticUserMessage('forbidden')).toContain('权限')
  })
  it('exports only controlled fields and rejects invalid identifiers', () => {
    const record = sanitizeDiagnosticRecord({ id: '00000000-0000-4000-8000-000000000001', timestamp: '2026-09-19T00:00:00Z', source: 'desktop', operation: 'pairing_exchange', phase: 'request', reason: 'pairing_code_expired', durationMs: 25, outcome: 'failed', retryable: false, token: 'PRIVATE', body: { apiKey: 'PRIVATE' }, projectId: '/private/secret' })
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE|secret|apiKey|token|private/)
    expect(() => sanitizeDiagnosticRecord({ ...record, id: 'bad-secret' })).toThrow()
  })
})
