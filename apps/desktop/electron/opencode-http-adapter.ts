export type Fetcher = typeof fetch

export type OpencodePermissionRule = {
  permission: 'edit' | 'bash' | 'write' | 'patch'
  pattern: string
  action: 'ask' | 'allow' | 'deny'
}

export type OpencodeSessionModel = {
  providerID: string
  id: string
}

export type OpencodeMessageModel = {
  providerID: string
  modelID: string
}

export type OpencodeSession = {
  id: string
  directory: string
  permission?: OpencodePermissionRule[]
}

export type OpencodePermission = {
  id: string
  sessionID: string
  permission: string
  metadata?: Record<string, unknown>
  patterns?: string[]
}

export type OpencodeDiffFile = {
  file: string
  patch: string
  additions?: number
  deletions?: number
  status?: string
}

export type OpencodeMessageResponseErrorCode =
  | 'provider_auth_error'
  | 'provider_api_error'
  | 'unknown_provider_error'
  | 'output_length'
  | 'message_aborted'
  | 'structured_output'
  | 'context_overflow'
  | 'content_filter'
  | 'invalid_message_response'

export type OpencodeHttpRequestErrorCode =
  | 'transport_error'
  | 'http_status_error'
  | 'invalid_json_response'

export class OpencodeHttpRequestError extends Error {
  readonly code: OpencodeHttpRequestErrorCode
  readonly statusCode: number | undefined

  constructor(input: {
    code: OpencodeHttpRequestErrorCode
    statusCode?: number
  }) {
    super('opencode request failed')
    this.name = 'OpencodeHttpRequestError'
    this.code = input.code
    this.statusCode = input.statusCode
  }
}

const OPENCODE_MESSAGE_ERROR_CODES: Readonly<Record<string, OpencodeMessageResponseErrorCode>> = {
  ProviderAuthError: 'provider_auth_error',
  APIError: 'provider_api_error',
  UnknownError: 'unknown_provider_error',
  MessageOutputLengthError: 'output_length',
  MessageAbortedError: 'message_aborted',
  StructuredOutputError: 'structured_output',
  ContextOverflowError: 'context_overflow',
  ContentFilterError: 'content_filter',
}

export class OpencodeMessageResponseError extends Error {
  readonly code: OpencodeMessageResponseErrorCode
  readonly statusCode: number | undefined
  readonly retryable: boolean | undefined

  constructor(input: {
    code: OpencodeMessageResponseErrorCode
    statusCode?: number
    retryable?: boolean
  }) {
    super(
      input.code === 'invalid_message_response'
        ? 'opencode returned an invalid message response'
        : 'opencode provider message failed',
    )
    this.name = 'OpencodeMessageResponseError'
    this.code = input.code
    this.statusCode = input.statusCode
    this.retryable = input.retryable
  }
}

export function createDefaultOpencodePermissionRules(): OpencodePermissionRule[] {
  return ['edit', 'bash', 'write', 'patch'].map((permission) => ({
    permission: permission as OpencodePermissionRule['permission'],
    pattern: '*',
    action: 'ask',
  }))
}

export function buildOpencodeServeArgs(input: {
  hostname: string
  port: number
  printLogs?: boolean
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
}): string[] {
  const args = [
    'serve',
    '--hostname',
    input.hostname,
    '--port',
    String(input.port),
  ]

  if (input.printLogs) {
    args.push('--print-logs')
  }
  if (input.logLevel) {
    args.push('--log-level', input.logLevel)
  }

  return args
}

export async function createOpencodeSession(input: {
  baseUrl: string
  directory: string
  title: string
  model: OpencodeSessionModel
  fetcher?: Fetcher
}): Promise<OpencodeSession> {
  return postJson<OpencodeSession>(input.fetcher, input.baseUrl, withDirectory('/session', input.directory), {
    title: input.title,
    model: input.model,
    permission: createDefaultOpencodePermissionRules(),
  })
}

export async function sendOpencodeMessage(input: {
  baseUrl: string
  sessionId: string
  directory: string
  model: OpencodeMessageModel
  text: string
  fetcher?: Fetcher
}): Promise<unknown> {
  const response = await postJson<unknown>(
    input.fetcher,
    input.baseUrl,
    withDirectory(`/session/${input.sessionId}/message`, input.directory),
    {
      model: input.model,
      parts: [{ type: 'text', text: input.text }],
    },
  )
  const terminalError = opencodeMessageTerminalError(response)
  if (terminalError) {
    throw terminalError
  }
  return response
}

export async function listOpencodePermissions(input: {
  baseUrl: string
  directory?: string
  fetcher?: Fetcher
}): Promise<OpencodePermission[]> {
  return getJson<OpencodePermission[]>(
    input.fetcher,
    input.baseUrl,
    input.directory ? withDirectory('/permission', input.directory) : '/permission',
  )
}

export async function replyOpencodePermission(input: {
  baseUrl: string
  requestId: string
  directory: string
  reply: 'once' | 'always' | 'reject'
  message: string
  fetcher?: Fetcher
}): Promise<boolean> {
  return postJson<boolean>(
    input.fetcher,
    input.baseUrl,
    withDirectory(`/permission/${input.requestId}/reply`, input.directory),
    {
      reply: input.reply,
      message: input.message,
    },
  )
}

export async function abortOpencodeSession(input: {
  baseUrl: string
  sessionId: string
  directory: string
  fetcher?: Fetcher
}): Promise<boolean> {
  return postJson<boolean>(
    input.fetcher,
    input.baseUrl,
    withDirectory(`/session/${input.sessionId}/abort`, input.directory),
    undefined,
  )
}

export async function listOpencodeDiff(input: {
  baseUrl: string
  sessionId: string
  directory: string
  fetcher?: Fetcher
}): Promise<OpencodeDiffFile[]> {
  return getJson<OpencodeDiffFile[]>(
    input.fetcher,
    input.baseUrl,
    withDirectory(`/session/${input.sessionId}/diff`, input.directory),
  )
}

function withDirectory(pathname: string, directory: string): string {
  return `${pathname}?directory=${encodeURIComponent(directory)}`
}

function opencodeMessageTerminalError(response: unknown): OpencodeMessageResponseError | undefined {
  if (!isRecord(response) || !isRecord(response.info) || !Array.isArray(response.parts)) {
    return new OpencodeMessageResponseError({ code: 'invalid_message_response' })
  }
  if (response.info.error === undefined) {
    return undefined
  }
  if (!isRecord(response.info.error)) {
    return new OpencodeMessageResponseError({ code: 'invalid_message_response' })
  }
  const error = response.info.error
  if (typeof error.name !== 'string') {
    return new OpencodeMessageResponseError({ code: 'invalid_message_response' })
  }
  const code = OPENCODE_MESSAGE_ERROR_CODES[error.name] ?? 'unknown_provider_error'
  const data = isRecord(error.data) ? error.data : undefined
  return new OpencodeMessageResponseError({
    code,
    ...(typeof data?.statusCode === 'number' && Number.isInteger(data.statusCode)
      ? { statusCode: data.statusCode }
      : {}),
    ...(typeof data?.isRetryable === 'boolean'
      ? { retryable: data.isRetryable }
      : {}),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getJson<T>(fetcher: Fetcher | undefined, baseUrl: string, pathname: string): Promise<T> {
  const response = await fetchOpencodeResponse(fetcher, baseUrl, pathname, {
    headers: { accept: 'application/json' },
  })
  return readJson<T>(response)
}

async function postJson<T>(
  fetcher: Fetcher | undefined,
  baseUrl: string,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await fetchOpencodeResponse(fetcher, baseUrl, pathname, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return readJson<T>(response)
}

async function fetchOpencodeResponse(
  fetcher: Fetcher | undefined,
  baseUrl: string,
  pathname: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await (fetcher ?? fetch)(url(baseUrl, pathname), init)
  } catch {
    throw new OpencodeHttpRequestError({ code: 'transport_error' })
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new OpencodeHttpRequestError({
      code: 'http_status_error',
      statusCode: response.status,
    })
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    throw new OpencodeHttpRequestError({
      code: 'transport_error',
      statusCode: response.status,
    })
  }
  try {
    return (text ? JSON.parse(text) : undefined) as T
  } catch {
    throw new OpencodeHttpRequestError({
      code: 'invalid_json_response',
      statusCode: response.status,
    })
  }
}

function url(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`
}
