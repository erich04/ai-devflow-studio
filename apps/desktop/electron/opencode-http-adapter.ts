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
  return postJson<OpencodeSession>(input.fetcher, input.baseUrl, '/session', {
    directory: input.directory,
    title: input.title,
    model: input.model,
    permission: createDefaultOpencodePermissionRules(),
  })
}

export async function sendOpencodeMessage(input: {
  baseUrl: string
  sessionId: string
  model: OpencodeMessageModel
  text: string
  fetcher?: Fetcher
}): Promise<unknown> {
  return postJson(input.fetcher, input.baseUrl, `/session/${input.sessionId}/message`, {
    model: input.model,
    parts: [{ type: 'text', text: input.text }],
  })
}

export async function listOpencodePermissions(input: {
  baseUrl: string
  fetcher?: Fetcher
}): Promise<OpencodePermission[]> {
  return getJson<OpencodePermission[]>(input.fetcher, input.baseUrl, '/permission')
}

export async function replyOpencodePermission(input: {
  baseUrl: string
  requestId: string
  directory: string
  reply: 'once' | 'always' | 'reject'
  message: string
  fetcher?: Fetcher
}): Promise<boolean> {
  return postJson<boolean>(input.fetcher, input.baseUrl, `/permission/${input.requestId}/reply`, {
    directory: input.directory,
    reply: input.reply,
    message: input.message,
  })
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
    `/session/${input.sessionId}/abort?directory=${encodeURIComponent(input.directory)}`,
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
    `/session/${input.sessionId}/diff?directory=${encodeURIComponent(input.directory)}`,
  )
}

async function getJson<T>(fetcher: Fetcher | undefined, baseUrl: string, pathname: string): Promise<T> {
  const response = await (fetcher ?? fetch)(url(baseUrl, pathname), {
    headers: { accept: 'application/json' },
  })
  return readJson<T>(response, pathname)
}

async function postJson<T>(
  fetcher: Fetcher | undefined,
  baseUrl: string,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await (fetcher ?? fetch)(url(baseUrl, pathname), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return readJson<T>(response, pathname)
}

async function readJson<T>(response: Response, pathname: string): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`opencode ${pathname} failed with ${response.status}: ${text.slice(0, 500)}`)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

function url(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`
}
