import {
  AgentProviderRequestError, StageAgentExecutionError, describeStageAgentFailure, stageAgentFailureDetails,
  type AgentProviderUsage, type StageAgentCleanupFailure, type StageAgentFailureCode,
  type StageAgentFailureDetails, type StageAgentTerminalReason,
} from '@ai-devflow/shared'
import { OpencodeHttpRequestError, OpencodeMessageResponseError } from './opencode-http-adapter.js'

function failure(details: StageAgentFailureDetails, reason?: Exclude<StageAgentTerminalReason, 'success'>) {
  const terminalByCode: Partial<Record<StageAgentFailureCode, Exclude<StageAgentTerminalReason, 'success'>>> = {
    cancelled: 'cancelled', timeout: 'timeout', runtime_unavailable: 'cli_unavailable',
    context_limit: 'input_limit', output_format: 'schema_invalid', output_limit: 'output_limit',
    permission_denied: 'permission_denied', repository_changed: 'repository_changed',
    repository_unavailable: 'repository_unavailable', evidence_invalid: 'evidence_invalid',
    input_limit: 'input_limit', tool_limit: 'tool_limit',
  }
  return new StageAgentExecutionError(reason ?? terminalByCode[details.code] ?? 'failed', describeStageAgentFailure(details), undefined, undefined, details)
}

function providerHttpCode(status?: number | null): StageAgentFailureCode {
  return status === 401 || status === 403 ? 'provider_auth'
    : status === 429 ? 'provider_rate_limit'
      : status && status >= 500 ? 'provider_unavailable' : 'provider_request_failed'
}

/** Only structured error types and status codes are evidence; messages/bodies are never inspected. */
export function classifyOpencodeFailure(error: unknown, input: {
  reportedUsage?: AgentProviderUsage | null | undefined
  aborted?: 'cancelled' | 'timeout'
  relayFailure?: (requestId: string) => StageAgentFailureDetails | undefined
} = {}): StageAgentExecutionError {
  let result: StageAgentExecutionError
  if (error instanceof StageAgentExecutionError) result = error
  else if (error instanceof OpencodeMessageResponseError) {
    const metadata = {
      ...(error.statusCode !== undefined ? { httpStatus: error.statusCode } : {}),
      ...(error.code === 'provider_api_error' && error.relayRequestId ? { relayRequestId: error.relayRequestId } : {}),
    }
    const mapped: Record<typeof error.code, [StageAgentFailureCode, Exclude<StageAgentTerminalReason, 'success'>]> = {
      provider_auth_error: ['provider_auth', 'failed'],
      provider_api_error: [providerHttpCode(error.statusCode), 'failed'],
      unknown_provider_error: ['provider_request_failed', 'failed'],
      context_overflow: ['context_limit', 'input_limit'],
      structured_output: ['output_format', 'schema_invalid'],
      invalid_message_response: ['output_format', 'schema_invalid'],
      output_length: ['output_limit', 'output_limit'],
      message_aborted: ['cancelled', 'cancelled'],
      content_filter: ['content_filter', 'failed'],
    }
    const [code, reason] = mapped[error.code]
    result = failure(stageAgentFailureDetails(code, error.code === 'invalid_message_response' ? 'opencode_http' : 'provider', metadata), reason)
  } else if (error instanceof OpencodeHttpRequestError) {
    const code = error.code === 'transport_error' ? 'network_error'
      : error.code === 'http_status_error' ? 'runtime_http_error'
        : error.code === 'response_too_large' ? 'output_limit' : 'output_format'
    result = failure(stageAgentFailureDetails(code, 'opencode_http',
      error.statusCode !== undefined ? { httpStatus: error.statusCode } : {}),
    code === 'output_format' ? 'schema_invalid' : code === 'output_limit' ? 'output_limit' : 'failed')
  } else if (error instanceof AgentProviderRequestError) {
    result = failure(providerFailureDetails(error))
  } else result = failure(stageAgentFailureDetails('unknown_failure', 'executor'))

  const detail = result.failureDetails
  // Only generic API failures can be refined. Explicit validation/permission/cancellation wins.
  if (result.terminalReason === 'failed' && detail?.source === 'provider' && detail.relayRequestId) {
    const relayed = input.relayFailure?.(detail.relayRequestId)
    if (relayed) result = failure({ ...relayed, ...(detail.cleanupFailures ? { cleanupFailures: detail.cleanupFailures } : {}) })
  }
  // A timer expiring during cleanup must not replace an already known model/validation failure.
  const abortable = !result.failureDetails || ['unknown_failure', 'cancelled', 'timeout', 'runtime_unavailable'].includes(result.failureDetails.code)
    || (result.failureDetails.source === 'opencode_http' && result.failureDetails.code === 'network_error')
  if (input.aborted && abortable) {
    result = failure(stageAgentFailureDetails(input.aborted, 'executor',
      result.failureDetails?.cleanupFailures ? { cleanupFailures: result.failureDetails.cleanupFailures } : {}), input.aborted)
  }
  return new StageAgentExecutionError(result.terminalReason, result.message,
    error instanceof StageAgentExecutionError ? error.tokenUsage : undefined,
    input.reportedUsage !== undefined ? input.reportedUsage
      : error instanceof StageAgentExecutionError ? error.reportedUsage
        : error instanceof AgentProviderRequestError ? error.usage : undefined,
    result.failureDetails ?? stageAgentFailureDetails('unknown_failure', 'executor'))
}

export function providerFailureDetails(error: AgentProviderRequestError): StageAgentFailureDetails {
  if (error.failureDetails) return error.failureDetails
  const governance = {
    budget_not_ready: 'budget_denied', accounting_unavailable: 'accounting_unavailable', settlement_sync_failed: 'settlement_sync_failed',
  } as const
  const governanceCode = governance[error.sanitizedCause as keyof typeof governance]
  const code: StageAgentFailureCode = governanceCode ?? (
    error.code.startsWith('http_') ? providerHttpCode(error.httpStatus)
      : ['dns_failure', 'tls_failure', 'connection_failed', 'connection_reset', 'proxy_failure'].includes(error.code) ? 'network_error'
        : error.code === 'provider_timeout' ? 'timeout'
          : error.code === 'cancelled_by_user' ? 'cancelled'
            : ['invalid_response_json', 'invalid_model_output', 'invalid_usage'].includes(error.code) ? 'output_format'
              : error.code === 'response_too_large' ? 'output_limit' : 'unknown_failure')
  return stageAgentFailureDetails(code, governanceCode ? 'budget_relay' : 'provider',
    error.httpStatus !== null ? { httpStatus: error.httpStatus } : {})
}

export function withCleanupFailure(error: unknown, component: StageAgentCleanupFailure): StageAgentExecutionError {
  const primary = error === undefined ? failure(stageAgentFailureDetails('cleanup_failed', 'lifecycle')) : classifyOpencodeFailure(error)
  const details = primary.failureDetails ?? stageAgentFailureDetails('unknown_failure', 'executor')
  return new StageAgentExecutionError(primary.terminalReason, primary.message, primary.tokenUsage, primary.reportedUsage,
    { ...details, cleanupFailures: [...(details.cleanupFailures ?? []), component] })
}

/** A failed cleanup is observable even after success, and never replaces the primary failure. */
export async function withOpencodeCleanup<T>(
  action: () => Promise<T>, cleanup: () => Promise<void>, component: StageAgentCleanupFailure,
  usage?: (result: T) => AgentProviderUsage | null | undefined,
): Promise<T> {
  let result: T | undefined
  let failed = false
  let error: unknown
  try { result = await action() } catch (caught) { failed = true; error = caught }
  try { await cleanup() } catch {
    error = withCleanupFailure(failed ? error : undefined, component)
    if (!failed && result !== undefined) error = classifyOpencodeFailure(error, { reportedUsage: usage?.(result) })
    failed = true
  }
  if (failed) throw error
  return result!
}
