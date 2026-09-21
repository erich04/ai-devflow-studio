import { DIAGNOSTIC_HEADER, diagnosticReasonForStatus, diagnosticUserMessage, safeDiagnosticId, type DiagnosticReason, type DiagnosticRecord } from '@ai-devflow/shared'

export class PairingRequestError extends Error {
  constructor(readonly reason: DiagnosticReason, readonly diagnosticId: string) {
    super(`${diagnosticUserMessage(reason)} 诊断编号：${diagnosticId}`)
  }
}

/** The code/response stays with the caller; only controlled metadata reaches the history. */
export async function pairingRequest<T>(input: {
  method: 'POST' | 'DELETE'; projectId: string; pairingCodeId?: string
  validate(response: Response): Promise<T>
  record(record: DiagnosticRecord): void
}): Promise<T> {
  const id = crypto.randomUUID(); const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let responseId: string = id
  let reason: DiagnosticReason = 'network_unavailable'
  let phase: DiagnosticRecord['phase'] = 'request'
  try {
    const response = await fetch('/api/pairing-code', {
      method: input.method,
      signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json', [DIAGNOSTIC_HEADER]: id },
      body: JSON.stringify({ projectId: input.projectId, ...(input.pairingCodeId ? { pairingCodeId: input.pairingCodeId } : {}) }),
    })
    responseId = safeDiagnosticId(response.headers.get(DIAGNOSTIC_HEADER)) ?? id
    phase = 'response'
    reason = diagnosticReasonForStatus(response.status)
    if (!response.ok) throw new PairingRequestError(reason, responseId)
    reason = 'invalid_response'
    const result = await input.validate(response)
    reason = 'ok'
    return result
  } catch { if (controller.signal.aborted) reason = 'request_timeout'; throw new PairingRequestError(reason, responseId) }
  finally {
    clearTimeout(timer)
    input.record({ id: responseId, timestamp: new Date(started).toISOString(), source: 'web',
      operation: input.method === 'POST' ? 'pairing_create' : 'pairing_revoke', phase,
      outcome: reason === 'ok' ? 'succeeded' : 'failed', reason, durationMs: Math.max(0, Date.now() - started), retryable: false,
      projectId: input.projectId,
    })
  }
}
