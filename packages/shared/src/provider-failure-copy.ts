import type { AgentProviderErrorCode } from './agent-review'
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
  connection_failed: '未能连接到模型服务，请求没有发出',
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

export function describeProviderFailure(trace: { errorCode?: AgentProviderErrorCode; sanitizedCause?: string; httpStatus?: number }): string {
  const description = (trace.sanitizedCause ? causeDescriptions[trace.sanitizedCause] : undefined) ??
    codeDescriptions[trace.errorCode ?? 'unknown_provider_failure'] ??
    codeDescriptions.unknown_provider_failure
  return trace.httpStatus === undefined ? description : `${description}，HTTP ${trace.httpStatus}`
}
