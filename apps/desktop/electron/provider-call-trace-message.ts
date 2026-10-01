import type { AgentProviderErrorCode } from '@ai-devflow/shared'
import type { CodingProviderCallTrace } from './coding-engine.js'

const phaseLabels: Record<CodingProviderCallTrace['phase'], string> = {
  analysis: '分析',
  initial: '生成改动',
  repair: '修正改动',
}

// The cause is more specific than the code (for example `output_length` under
// `invalid_model_output`), so it is looked up first.
const causeDescriptions: Record<string, string> = {
  output_length: '模型输出达到上限，回答未完成',
  content_filter: '模型服务拒绝返回该内容',
  incomplete_response: '模型未正常结束回答',
  insufficient_system_resource: '模型服务资源不足，提前结束了回答',
  empty_content: '模型未返回正文',
  missing_content: '模型未返回正文',
  invalid_json: '模型返回的内容格式不完整',
  settlement_sync_failed: '模型用量同步未完成',
  accounting_unavailable: '本地费用记录暂不可用',
  runtime_restarted_before_terminal_observation: '应用在调用结束前重启，结果未知',
}

const codeDescriptions: Record<AgentProviderErrorCode, string> = {
  provider_timeout: '模型响应超时',
  dns_failure: '无法解析模型服务地址',
  tls_failure: '与模型服务的安全连接失败',
  connection_reset: '与模型服务的连接中断',
  proxy_failure: '代理连接失败',
  http_429: '模型服务限流',
  http_4xx: '模型服务拒绝了请求',
  http_5xx: '模型服务出错',
  invalid_response_json: '模型服务的响应无法解析',
  invalid_model_output: '模型返回的内容无法使用',
  invalid_usage: '模型服务返回的用量无效',
  response_too_large: '响应超过安全接收容量',
  cancelled_by_user: '已停止本次模型调用',
  unknown_provider_failure: '模型调用失败，原因未知',
}

function providerLabel(trace: Pick<CodingProviderCallTrace, 'providerId' | 'model'>): string {
  if (trace.providerId.toLowerCase() === 'deepseek') return 'DeepSeek'
  // A configured Provider ID is internal; the model name is what the user chose.
  return trace.model.trim() || '模型'
}

function failureDescription(trace: Pick<CodingProviderCallTrace, 'errorCode' | 'sanitizedCause' | 'httpStatus'>): string {
  const description = (trace.sanitizedCause ? causeDescriptions[trace.sanitizedCause] : undefined) ??
    codeDescriptions[trace.errorCode ?? 'unknown_provider_failure'] ??
    codeDescriptions.unknown_provider_failure
  return trace.httpStatus === undefined ? description : `${description}，HTTP ${trace.httpStatus}`
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return '耗时未知'
  return durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(durationMs % 1_000 === 0 ? 0 : 1)} 秒`
    : `${durationMs} 毫秒`
}

/**
 * The execution-record line for one model call. A failed call's line also becomes the coding
 * run summary, so it names the model and the reason in Chinese; the raw Provider ID, error code
 * and cause stay in the event's `providerCall` metadata (hardening H4).
 */
export function providerCallTraceMessage(trace: CodingProviderCallTrace): string {
  const prefix = `${providerLabel(trace)} · ${phaseLabels[trace.phase] ?? trace.phase}`
  if (trace.status === 'started') {
    return `${prefix} · 模型调用已开始。`
  }
  const duration = durationLabel(trace.durationMs)
  const billing = trace.billingState === 'confirmed'
    ? '费用已确认'
    : trace.billingState === 'not_incurred'
      ? '未产生模型费用'
      : '费用状态未知'
  if (trace.status === 'succeeded') {
    return `${prefix} · 模型调用成功（${duration}） · ${billing}。`
  }
  const retry = trace.retryable ? '可以手动重试' : '不建议直接重试'
  return `${prefix} · ${failureDescription(trace)}（${duration}） · ${billing} · ${retry}。`
}
