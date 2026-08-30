import type { CodingAgentRun, CodingPermissionRequest } from '../packages/shared/src/domain.ts'
import { redactSensitiveText } from '../packages/shared/src/redaction.ts'
import type { CodingEnginePermissionDiscoveryError } from '../apps/desktop/electron/coding-engine-lifecycle.ts'
import type {
  OpencodeHttpRequestErrorCode,
  OpencodeMessageResponseErrorCode,
} from '../apps/desktop/electron/opencode-http-adapter.ts'
import { join } from 'node:path'

export const OPENCODE_SMOKE_MARKER = 'devflow-opencode-smoke.txt'

export type CandidateGitIdentity = {
  head: string
  branch: string
}

export type OpencodeSmokeStage =
  | 'setup'
  | 'workspace_create'
  | 'engine_start'
  | 'permission_relay'
  | 'diff_validation'
  | 'dependency_bootstrap'
  | 'test_execution'
  | 'runtime_cleanup'
  | 'workspace_cleanup'

export type OpencodeSmokeFailureCode =
  | OpencodeMessageResponseErrorCode
  | OpencodeHttpRequestErrorCode
  | CodingEnginePermissionDiscoveryError['code']
  | 'invalid_status_response'
  | 'unclassified'

const OPENCODE_MESSAGE_RESPONSE_ERROR_CODES = new Set<OpencodeMessageResponseErrorCode>([
  'provider_auth_error',
  'provider_api_error',
  'unknown_provider_error',
  'output_length',
  'message_aborted',
  'structured_output',
  'context_overflow',
  'content_filter',
  'invalid_message_response',
])

const OPENCODE_HTTP_REQUEST_ERROR_CODES = new Set<OpencodeHttpRequestErrorCode>([
  'transport_error',
  'http_status_error',
  'invalid_json_response',
])

const OPENCODE_SESSION_STATUS_ERROR_CODES = new Set(['invalid_status_response'] as const)

export class OpencodeSmokeStageError extends Error {
  readonly stage: OpencodeSmokeStage
  readonly code: OpencodeSmokeFailureCode
  readonly statusCode: number | undefined
  readonly retryable: boolean | undefined
  readonly cleanup: 'failed' | undefined

  constructor(input: {
    stage: OpencodeSmokeStage
    code: OpencodeSmokeFailureCode
    statusCode?: number
    retryable?: boolean
    cleanup?: 'failed'
    cause: unknown
  }) {
    const details = [
      `opencode smoke failed; stage=${input.stage}`,
      `code=${input.code}`,
      ...(input.statusCode === undefined ? [] : [`status=${input.statusCode}`]),
      ...(input.retryable === undefined ? [] : [`retryable=${String(input.retryable)}`]),
      ...(input.cleanup === undefined ? [] : [`cleanup=${input.cleanup}`]),
    ]
    super(details.join('; '), { cause: input.cause })
    this.name = 'OpencodeSmokeStageError'
    this.stage = input.stage
    this.code = input.code
    this.statusCode = input.statusCode
    this.retryable = input.retryable
    this.cleanup = input.cleanup
  }
}

export function createOpencodeSmokeStageError(
  stage: OpencodeSmokeStage,
  error: unknown,
): OpencodeSmokeStageError {
  const cleanupErrors = codingEngineCleanupErrors(error)
  const cleanupFailed = cleanupErrors !== undefined
  const primaryError = cleanupErrors?.[0] ?? error
  const classification = classifyOpencodeSmokeError(primaryError)
  return new OpencodeSmokeStageError({
    stage,
    ...classification,
    ...(cleanupFailed ? { cleanup: 'failed' as const } : {}),
    cause: error,
  })
}

function codingEngineCleanupErrors(error: unknown): readonly unknown[] | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    (error.name !== 'CodingEngineStartupCleanupError' &&
      error.name !== 'CodingEngineContinuationCleanupError') ||
    !('errors' in error) ||
    !Array.isArray(error.errors) ||
    error.errors.length === 0
  ) {
    return undefined
  }
  return error.errors
}

function classifyOpencodeSmokeError(error: unknown): {
  code: OpencodeSmokeFailureCode
  statusCode?: number
  retryable?: boolean
} {
  const messageResponseError = opencodeMessageResponseErrorDetails(error)
  if (messageResponseError) {
    return {
      code: messageResponseError.code,
      ...(messageResponseError.statusCode === undefined
        ? {}
        : { statusCode: messageResponseError.statusCode }),
      ...(messageResponseError.retryable === undefined
        ? {}
        : { retryable: messageResponseError.retryable }),
    }
  }
  const permissionDiscoveryCode = permissionDiscoveryErrorCode(error)
  if (permissionDiscoveryCode) {
    return { code: permissionDiscoveryCode }
  }
  const httpRequestError = opencodeHttpRequestErrorDetails(error)
  if (httpRequestError) {
    return {
      code: httpRequestError.code,
      ...(httpRequestError.statusCode === undefined
        ? {}
        : { statusCode: httpRequestError.statusCode }),
    }
  }
  const sessionStatusCode = opencodeSessionStatusErrorCode(error)
  if (sessionStatusCode) {
    return { code: sessionStatusCode }
  }
  return { code: 'unclassified' }
}

function opencodeSessionStatusErrorCode(
  error: unknown,
): 'invalid_status_response' | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    error.name !== 'OpencodeSessionStatusResponseError' ||
    !('code' in error) ||
    typeof error.code !== 'string' ||
    !OPENCODE_SESSION_STATUS_ERROR_CODES.has(
      error.code as 'invalid_status_response',
    )
  ) {
    return undefined
  }
  return error.code as 'invalid_status_response'
}

function opencodeHttpRequestErrorDetails(error: unknown): {
  code: OpencodeHttpRequestErrorCode
  statusCode?: number
} | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    error.name !== 'OpencodeHttpRequestError' ||
    !('code' in error) ||
    typeof error.code !== 'string' ||
    !OPENCODE_HTTP_REQUEST_ERROR_CODES.has(error.code as OpencodeHttpRequestErrorCode)
  ) {
    return undefined
  }
  const statusCode =
    'statusCode' in error && isSafeHttpStatus(error.statusCode)
      ? error.statusCode
      : undefined
  return {
    code: error.code as OpencodeHttpRequestErrorCode,
    ...(statusCode === undefined ? {} : { statusCode }),
  }
}

function opencodeMessageResponseErrorDetails(error: unknown): {
  code: OpencodeMessageResponseErrorCode
  statusCode?: number
  retryable?: boolean
} | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    error.name !== 'OpencodeMessageResponseError' ||
    !('code' in error) ||
    typeof error.code !== 'string' ||
    !OPENCODE_MESSAGE_RESPONSE_ERROR_CODES.has(
      error.code as OpencodeMessageResponseErrorCode,
    )
  ) {
    return undefined
  }
  const statusCode =
    'statusCode' in error &&
    isSafeHttpStatus(error.statusCode)
      ? error.statusCode
      : undefined
  const retryable =
    'retryable' in error && typeof error.retryable === 'boolean'
      ? error.retryable
      : undefined
  return {
    code: error.code as OpencodeMessageResponseErrorCode,
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(retryable === undefined ? {} : { retryable }),
  }
}

function isSafeHttpStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  )
}

function permissionDiscoveryErrorCode(
  error: unknown,
): CodingEnginePermissionDiscoveryError['code'] | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    error.name !== 'CodingEnginePermissionDiscoveryError' ||
    !('code' in error)
  ) {
    return undefined
  }
  return error.code === 'message_completed_without_permission' ||
    error.code === 'permission_discovery_timed_out' ||
    error.code === 'provider_retry_observed'
    ? error.code
    : undefined
}

const OPENCODE_RUNTIME_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
  'OPENCODE_DISABLE_PROJECT_CONFIG',
  'OPENCODE_DISABLE_AUTOUPDATE',
  'OPENCODE_DISABLE_MODELS_FETCH',
  'OPENCODE_PURE',
  'NO_COLOR',
  'FORCE_COLOR',
] as const

export function buildOpencodeSmokeRuntimeEnv(
  source: NodeJS.ProcessEnv,
  apiKeyEnvName: string,
  options: { includeApiKey?: boolean } = {},
): NodeJS.ProcessEnv {
  const runtimeEnv: NodeJS.ProcessEnv = {}
  const names = options.includeApiKey === false
    ? OPENCODE_RUNTIME_ENV_ALLOWLIST
    : [...OPENCODE_RUNTIME_ENV_ALLOWLIST, apiKeyEnvName]
  for (const name of names) {
    const value = source[name]
    if (value !== undefined) {
      runtimeEnv[name] = value
    }
  }
  return runtimeEnv
}

export function buildIsolatedOpencodeSmokeRuntimeEnv(
  source: NodeJS.ProcessEnv,
  apiKeyEnvName: string,
  runtimeRoot: string,
  options: { includeApiKey?: boolean } = {},
): NodeJS.ProcessEnv {
  const runtimeEnv = buildOpencodeSmokeRuntimeEnv(source, apiKeyEnvName, options)
  delete runtimeEnv.OPENCODE_CONFIG
  return {
    ...runtimeEnv,
    HOME: join(runtimeRoot, 'home'),
    TMPDIR: join(runtimeRoot, 'tmp'),
    XDG_CONFIG_HOME: join(runtimeRoot, 'config'),
    XDG_DATA_HOME: join(runtimeRoot, 'data'),
    XDG_CACHE_HOME: join(runtimeRoot, 'cache'),
    XDG_STATE_HOME: join(runtimeRoot, 'state'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_PURE: '1',
  }
}

export function assertOpencodeSmokePermission(request: CodingPermissionRequest): void {
  const allowedShellProbe =
    request.permission === 'bash' &&
    request.title === 'opencode requested bash permission' &&
    (request.command?.trim() === 'pwd' || request.command?.trim() === '/bin/pwd')
  const allowedMarkerMutation =
    request.permission === 'edit' &&
    request.title === 'opencode requested edit permission' &&
    request.filePath === OPENCODE_SMOKE_MARKER

  if (!allowedShellProbe && !allowedMarkerMutation) {
    throw new Error('opencode smoke blocked an unexpected permission request')
  }
}

export function assertOpencodeSmokeChangedPaths(changedPaths: string[]): void {
  if (changedPaths.length !== 1 || changedPaths[0] !== OPENCODE_SMOKE_MARKER) {
    throw new Error('opencode smoke produced an unexpected changed path')
  }
}

export function assertOpencodeSmokeOpaqueBilling(
  codingRun: Pick<CodingAgentRun, 'tokenUsageId' | 'runtimeCostSummary'>,
): { usage: 'unknown'; cost: 'opaque' } {
  if (codingRun.tokenUsageId !== undefined || codingRun.runtimeCostSummary !== undefined) {
    throw new Error('opencode smoke must not fabricate token usage or dollar cost evidence')
  }
  return { usage: 'unknown', cost: 'opaque' }
}

export function assertCleanCandidateStatus(status: string): void {
  if (status.trim()) {
    throw new Error('opencode smoke detected candidate worktree pollution')
  }
}

export function assertCandidateIdentity(
  initial: CandidateGitIdentity,
  current: CandidateGitIdentity,
): void {
  if (initial.head !== current.head || initial.branch !== current.branch) {
    throw new Error('opencode smoke detected candidate Git identity changes')
  }
}

export function assertCleanFixtureStatus(status: string): void {
  if (status.trim()) {
    throw new Error('opencode smoke detected fixture source repository pollution')
  }
}

export function combineOpencodeSmokeFailures(
  primaryError: unknown | undefined,
  safetyErrors: unknown[],
): unknown | undefined {
  const failures = [...(primaryError === undefined ? [] : [primaryError]), ...safetyErrors]
  if (failures.length === 0) {
    return undefined
  }
  if (failures.length === 1) {
    return failures[0]
  }
  return new AggregateError(
    failures,
    'opencode smoke failed with additional cleanup or integrity errors',
  )
}

export function opencodeSmokeErrorMessages(
  error: unknown,
  providerKey: string | undefined,
): string[] {
  const errors = error instanceof AggregateError ? error.errors : [error]
  return errors.flatMap((item) => {
    if (item instanceof AggregateError) {
      return opencodeSmokeErrorMessages(item, providerKey)
    }
    const message = item instanceof Error ? item.message : 'opencode smoke failed with an unknown error'
    const keyRedacted = providerKey
      ? message.split(providerKey).join('[REDACTED:provider_key]')
      : message
    return [redactSensitiveText(keyRedacted).value]
  })
}
