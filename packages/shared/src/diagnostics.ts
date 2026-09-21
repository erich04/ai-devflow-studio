export const DIAGNOSTIC_HEADER = 'x-devflow-diagnostic-id'
export const diagnosticReasons = ['ok', 'pairing_code_expired', 'pairing_code_invalid', 'unauthorized', 'forbidden', 'network_unavailable', 'request_timeout', 'invalid_request', 'invalid_response', 'conflict', 'service_unavailable', 'internal_error', 'credential_unavailable', 'credential_cancelled', 'credential_timeout'] as const
export type DiagnosticReason = typeof diagnosticReasons[number]
export type DiagnosticRecord = {
  id: string
  timestamp: string
  source: 'desktop' | 'web' | 'api'
  operation: 'pairing_exchange' | 'pairing_create' | 'pairing_revoke' | 'remote_sync' | 'provider_credential' | 'team_credential' | 'api_request'
  phase: 'request' | 'response' | 'encrypt' | 'decrypt'
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'timed_out'
  reason: DiagnosticReason
  durationMs: number
  retryable: boolean
  projectId?: string
  runId?: string
  retryOf?: string
}
export function safeDiagnosticId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) ? value.toLowerCase() : undefined
}
export function diagnosticReasonForStatus(status: number, reason?: unknown): DiagnosticReason {
  if (status === 401 && (reason === 'pairing_code_expired' || reason === 'pairing_code_invalid')) return reason
  if (status >= 200 && status < 400) return 'ok'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 409) return 'conflict'
  if (status === 408) return 'request_timeout'
  if (status === 429 || status === 503 || status === 502 || status === 504) return 'service_unavailable'
  if (status >= 500) return 'internal_error'
  return 'invalid_request'
}
export function diagnosticUserMessage(reason: DiagnosticReason): string {
  return {
    ok: '操作成功。',
    pairing_code_expired: '配对码已过期。请在网页重新生成配对码，再回到这里绑定。',
    pairing_code_invalid: '配对码无效、已使用或已撤销。请在网页重新生成配对码。',
    unauthorized: '登录或团队凭据已失效。请重新登录网页，并重新配对 Desktop。',
    forbidden: '当前账号没有此操作的权限。请联系项目负责人确认成员权限。',
    network_unavailable: '暂时无法连接团队服务。请检查网络和服务地址后重试。',
    request_timeout: '请求超时。请检查服务状态后重试；当前项目和需求会保留。',
    invalid_request: '请求未被接受。请检查输入；如果仍然失败，请提供诊断编号。',
    invalid_response: '团队服务返回了无法识别的结果。请提供诊断编号以便排查。',
    conflict: '数据已经变更。请刷新最新状态后重试。',
    service_unavailable: '团队服务暂时不可用。请稍后重试；当前项目和需求会保留。',
    internal_error: '服务未能完成操作。请提供诊断编号以便排查。',
    credential_unavailable: '系统凭据访问失败。请检查钥匙串授权后重试。',
    credential_cancelled: '已取消本次凭据访问，已有配置会保留。',
    credential_timeout: '等待系统授权超时。请处理钥匙串弹窗后重试。',
  }[reason]
}

/** Electron prepends IPC details. Display only messages from our controlled catalogue. */
export function diagnosticDisplayError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const reason = diagnosticReasons.find((value) => value !== 'ok' && message.includes(diagnosticUserMessage(value)))
  const id = safeDiagnosticId(message.match(/诊断编号：([0-9a-f-]{36})/iu)?.[1])
  const busy = '已有配置操作正在进行，请先完成或取消系统授权，再重试。'
  return `${message.includes(busy) ? busy : diagnosticUserMessage(reason ?? 'internal_error')}${id ? ` 诊断编号：${id}` : ''}`
}
/** A strict projection: never persist arbitrary errors, headers, paths or bodies. */
export function sanitizeDiagnosticRecord(value: unknown): DiagnosticRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid diagnostic')
  const v = value as Record<string, unknown>
  const id = safeDiagnosticId(v.id)
  if (!id || typeof v.timestamp !== 'string' || !Number.isFinite(Date.parse(v.timestamp))) throw new Error('Invalid diagnostic identity')
  function choice<T extends string>(key: string, choices: readonly T[]): T {
    if (!choices.includes(v[key] as T)) throw new Error('Invalid diagnostic category')
    return v[key] as T
  }
  const safeReference = (input: unknown) => typeof input === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/u.test(input) ? input : undefined
  const projectId = safeReference(v.projectId); const runId = safeReference(v.runId); const retryOf = safeDiagnosticId(v.retryOf)
  return {
    id, timestamp: new Date(v.timestamp).toISOString(),
    source: choice('source', ['desktop', 'web', 'api']),
    operation: choice('operation', ['pairing_exchange', 'pairing_create', 'pairing_revoke', 'remote_sync', 'provider_credential', 'team_credential', 'api_request']),
    phase: choice('phase', ['request', 'response', 'encrypt', 'decrypt']),
    outcome: choice('outcome', ['succeeded', 'failed', 'cancelled', 'timed_out']),
    reason: choice('reason', diagnosticReasons),
    durationMs: typeof v.durationMs === 'number' && Number.isFinite(v.durationMs) ? Math.max(0, Math.round(v.durationMs)) : 0,
    retryable: v.retryable === true,
    ...(projectId ? { projectId } : {}), ...(runId ? { runId } : {}), ...(retryOf ? { retryOf } : {}),
  }
}

export class DesktopPairingExchangeError extends Error {
  constructor(readonly code: 'pairing_code_expired' | 'pairing_code_invalid') {
    super(code === 'pairing_code_expired' ? 'expired desktop pairing code' : 'invalid desktop pairing code')
  }
}
