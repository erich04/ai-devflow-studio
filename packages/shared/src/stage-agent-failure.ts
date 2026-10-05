import type { StageAgentTerminalReason } from './domain'

/** Persisted diagnostics contain only these codes and locally authored hints, never upstream text. */
const hints = {
  budget_denied: '项目预算未就绪，本轮请求尚未发送。请检查项目预算及待核对费用；此前调用的用量仍保留。',
  accounting_unavailable: '费用记录暂不可用，本轮请求尚未发送。请恢复存储或团队连接后重试。',
  settlement_sync_failed: '模型用量同步未完成。请恢复团队连接并核对执行记录；本次调用不能视为免费。',
  provider_auth: '模型服务鉴权失败。请检查所选 Provider 的密钥和访问权限。',
  provider_rate_limit: '模型服务限流。请稍后手动重试。',
  provider_unavailable: '模型服务暂不可用。请稍后检查服务状态并手动重试。',
  provider_request_failed: '模型服务拒绝或未完成请求。请检查所选 Provider、模型和执行记录。',
  network_error: '连接或传输失败。请检查网络及对应服务的连接状态；费用以已记录的用量和结算为准。',
  context_limit: '模型上下文超过上限。请缩小输入范围后重试。',
  output_format: '模型响应格式无效，未生成正式产物。请检查执行记录后重试。',
  output_limit: '模型输出超过上限，未生成正式产物。请检查输出限制后重试。',
  content_filter: '模型服务拒绝返回该内容，未生成正式产物。',
  runtime_unavailable: 'OpenCode 运行时未能启动。请检查本机安装和运行时配置。',
  runtime_http_error: '本机 OpenCode 接口请求失败。请检查运行时状态和接口权限。',
  permission_denied: '只读执行请求了未获授权的权限，已停止。',
  repository_changed: '执行期间仓库发生变化，未生成正式产物。请在仓库稳定后重试。',
  repository_unavailable: '所选项目不是可读取的 Git 仓库根目录。请检查项目目录。',
  evidence_invalid: '仓库引用或执行证据校验失败，未生成正式产物。请检查引用范围。',
  input_limit: '阶段输入超过允许范围。请缩小输入后重试。',
  tool_limit: '只读执行的工具调用达到上限，未生成正式产物。',
  cancelled: '本次执行已停止。已发生的调用用量仍保留。',
  timeout: '本次执行超时。请检查执行记录后手动重试；已发生的调用用量仍保留。',
  cleanup_failed: '执行资源清理失败，未生成正式产物。请检查本机运行时状态后重试。',
  unknown_failure: '执行未完成。请检查执行记录和运行时状态后手动重试。',
} as const

export type StageAgentFailureCode = keyof typeof hints
export type StageAgentFailureSource = 'budget_relay' | 'provider' | 'opencode_http' | 'opencode_runtime' | 'stage_validation' | 'executor' | 'lifecycle'
export type StageAgentCleanupFailure = 'session_abort' | 'process_stop' | 'profile_dispose' | 'relay_close'
export type StageAgentFailureDetails = {
  version: 1
  code: StageAgentFailureCode
  source: StageAgentFailureSource
  hint: string
  httpStatus?: number
  /** Opaque relay instance + monotonically increasing call number; not a timestamp or secret. */
  relayRequestId?: string
  cleanupFailures?: StageAgentCleanupFailure[]
}

export function safeRelayRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{32}:[1-9][0-9]{0,9}$/u.test(value) ? value : undefined
}

/** Also used on loading older traces: absent/unknown contracts are simply ignored. */
export function sanitizeStageAgentFailureDetails(value: unknown): StageAgentFailureDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (v.version !== 1 || typeof v.code !== 'string' || !Object.hasOwn(hints, v.code) ||
    typeof v.source !== 'string' || !['budget_relay', 'provider', 'opencode_http', 'opencode_runtime', 'stage_validation', 'executor', 'lifecycle'].includes(v.source)) return undefined
  const code = v.code as StageAgentFailureCode
  const relayRequestId = safeRelayRequestId(v.relayRequestId)
  const cleanupFailures = (['session_abort', 'process_stop', 'profile_dispose', 'relay_close'] as const)
    .filter((kind) => Array.isArray(v.cleanupFailures) && v.cleanupFailures.includes(kind))
  return {
    version: 1, code, source: v.source as StageAgentFailureSource, hint: hints[code],
    ...(typeof v.httpStatus === 'number' && Number.isInteger(v.httpStatus) && v.httpStatus >= 100 && v.httpStatus <= 599 ? { httpStatus: v.httpStatus } : {}),
    ...(relayRequestId ? { relayRequestId } : {}),
    ...(cleanupFailures.length ? { cleanupFailures } : {}),
  }
}

export function stageAgentFailureDetails(
  code: StageAgentFailureCode,
  source: StageAgentFailureSource,
  metadata: Pick<StageAgentFailureDetails, 'httpStatus' | 'relayRequestId' | 'cleanupFailures'> = {},
): StageAgentFailureDetails {
  return sanitizeStageAgentFailureDetails({ ...metadata, version: 1, code, source })!
}

export function describeStageAgentFailure(value: StageAgentFailureDetails): string {
  const detail = sanitizeStageAgentFailureDetails(value)
  if (!detail) return hints.unknown_failure
  return `${detail.hint}${detail.httpStatus ? `（HTTP ${detail.httpStatus}）` : ''}${detail.cleanupFailures?.length ? ' 另外，执行资源清理未完成，请检查本机运行时状态。' : ''}`
}

export function failureDetailsForTerminalReason(reason: StageAgentTerminalReason): StageAgentFailureDetails | undefined {
  if (reason === 'success' || reason === 'failed') return undefined
  if (reason === 'cli_unavailable') return stageAgentFailureDetails('runtime_unavailable', 'opencode_runtime')
  return stageAgentFailureDetails(reason === 'schema_invalid' ? 'output_format' : reason, 'stage_validation')
}
