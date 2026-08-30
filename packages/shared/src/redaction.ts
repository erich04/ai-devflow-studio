import type { CodingAgentEvent } from './domain'

export type RedactionResult = {
  value: string
  redacted: boolean
  matches: string[]
  replacementCount: number
}

export type HighConfidenceOutboundSecretCategory =
  | 'github_token'
  | 'private_key'
  | 'anthropic_api_key'
  | 'openai_api_key'
  | 'authorization_secret'
  | 'jwt'
  | 'cloud_access_key'
  | 'secret_assignment'

export type HighConfidenceOutboundSecretInspection = {
  matchCount: number
  categories: HighConfidenceOutboundSecretCategory[]
}

const highConfidenceOutboundSecretPatterns: ReadonlyArray<{
  category: Exclude<HighConfidenceOutboundSecretCategory, 'secret_assignment'>
  pattern: RegExp
}> = [
  {
    category: 'github_token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  {
    category: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  {
    category: 'anthropic_api_key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    category: 'openai_api_key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    category: 'authorization_secret',
    pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}={0,2}/gi,
  },
  {
    category: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    category: 'cloud_access_key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
]

const highConfidenceSecretAssignmentPattern =
  /\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE)\s*=\s*([A-Za-z0-9._~+/=-]{20,})/g

const secretPatterns: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'authorization_secret',
    pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s,;]+/gi,
  },
  {
    label: 'json_secret',
    pattern:
      /\\?["'](?:api[_-]?key|token|secret|password|private[_-]?key|cookie|authorization)\\?["']\s*:\s*\\?["'][^"'\r\n]*\\?["']/gi,
  },
  {
    label: 'cli_secret',
    pattern:
      /--(?:api[-_]?key|token|secret|password|private[-_]?key)(?:\s+|=)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
  },
  {
    label: 'env_secret_assignment',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE)=([^\s]+)/gi,
  },
  {
    label: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  { label: 'anthropic_api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'openai_api_key', pattern: /\bsk-[A-Za-z0-9_-]{6,}\b/g },
  { label: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
]

const canonicalSecretRedactionMarkerPattern = new RegExp(
  `\\[REDACTED:(?:${secretPatterns.map(({ label }) => label).join('|')})\\]`,
  'g',
)

const localAbsolutePathPatterns: RegExp[] = [
  /\x1b\[[0-?]*[ -/]*[@-~]\/[^\s/<>"')\]},;!?]+(?:\/[^\s/<>"')\]},;!?]+)*/g,
  /\\\/[^\\\s<>"')\]},;!?]+(?:\\\/[^\\\s<>"')\]},;!?]+)*/g,
  /\bfile:\/{2,3}(?:[A-Za-z]:[\\/])?[^/\\\s<>"')\]}][^\s<>"')\]}]*/gi,
  /\\\\[^\\\s<>"')\]},;!?]+\\[^\\\s<>"')\]},;!?]+(?:\\[^\\\s<>"')\]},;!?]+)*/g,
  /\b[A-Za-z]:[\\/][^\s<>"')\]}]+/g,
]

const forwardSlashUncOrWebUrlPattern =
  /(?<!:)\/\/[^/\s<>"')\]},;!?]+\/[^/\s<>"')\]},;!?]+(?:\/[^/\s<>"')\]},;!?]+)*/g

const posixAbsolutePathPattern =
  /(^|[\s("'=\[:,])(\/[^\s/<>"')\]},;!?。；，！？：]+(?:\/[^\s/<>"')\]},;!?。；，！？：]+)*)/g

function isSafeApiRoute(value: string, context: string): boolean {
  const routeCandidate = value.replace(/[.,;:!?。；，！？：]+$/, '')
  if (!/^\/(?:api|health|metrics|v\d+)(?:\/|$)/.test(routeCandidate)) {
    return false
  }

  const hasFileLikeSuffix = /\/[^/]+\.[A-Za-z0-9]{1,12}$/.test(routeCandidate)
  const hasExplicitWebContext =
    /(?:\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)|\b(?:route|endpoint|url|request))\s*(?:[:=]\s*)?$/i.test(
      context,
    )
  return !hasFileLikeSuffix || hasExplicitWebContext
}

function isProtocolRelativeWebUrl(value: string): boolean {
  const host = value.slice(2).split('/', 1)[0] ?? ''
  return host.includes('.')
}

export function redactSecrets(input: string): RedactionResult {
  let value = input
  const matches: string[] = []
  let replacementCount = 0

  for (const { label, pattern } of secretPatterns) {
    value = value.replace(pattern, () => {
      matches.push(label)
      replacementCount += 1
      return `[REDACTED:${label}]`
    })
  }

  return {
    value,
    redacted: matches.length > 0,
    matches: Array.from(new Set(matches)),
    replacementCount,
  }
}

export function countCanonicalSecretRedactionMarkers(input: string): number {
  return Array.from(input.matchAll(canonicalSecretRedactionMarkerPattern)).length
}

export function inspectHighConfidenceOutboundSecrets(
  input: string,
): HighConfidenceOutboundSecretInspection {
  let matchCount = 0
  const categories: HighConfidenceOutboundSecretCategory[] = []
  for (const { category, pattern } of highConfidenceOutboundSecretPatterns) {
    const matches = Array.from(input.matchAll(pattern))
    if (matches.length === 0) continue
    matchCount += matches.length
    categories.push(category)
  }

  const assignmentMatches = Array.from(input.matchAll(highConfidenceSecretAssignmentPattern))
    .filter((match) => isHighEntropySecretAssignment(match[1] ?? ''))
  if (assignmentMatches.length > 0) {
    matchCount += assignmentMatches.length
    categories.push('secret_assignment')
  }
  return { matchCount, categories }
}

function isHighEntropySecretAssignment(value: string): boolean {
  const characterClasses = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  return characterClasses >= 3 && new Set(value).size >= 8
}

export function redactLocalAbsolutePaths(input: string): RedactionResult {
  let value = input
  const matches: string[] = []
  let replacementCount = 0

  for (const pattern of localAbsolutePathPatterns) {
    value = value.replace(pattern, () => {
      matches.push('local_absolute_path')
      replacementCount += 1
      return '[REDACTED:local_absolute_path]'
    })
  }

  value = value.replace(forwardSlashUncOrWebUrlPattern, (match) => {
    if (isProtocolRelativeWebUrl(match)) {
      return match
    }
    matches.push('local_absolute_path')
    replacementCount += 1
    return '[REDACTED:local_absolute_path]'
  })

  value = value.replace(posixAbsolutePathPattern, (
    match,
    prefix: string,
    pathValue: string,
    offset: number,
    source: string,
  ) => {
    const pathOffset = offset + prefix.length
    const context = source.slice(Math.max(0, pathOffset - 48), pathOffset)
    if (isSafeApiRoute(pathValue, context)) {
      return match
    }
    matches.push('local_absolute_path')
    replacementCount += 1
    return `${prefix}[REDACTED:local_absolute_path]`
  })

  return {
    value,
    redacted: matches.length > 0,
    matches: Array.from(new Set(matches)),
    replacementCount,
  }
}

export function redactSensitiveText(input: string): RedactionResult {
  const pathResult = redactLocalAbsolutePaths(input)
  const secretResult = redactSecrets(pathResult.value)
  return {
    value: secretResult.value,
    redacted: pathResult.redacted || secretResult.redacted,
    matches: Array.from(new Set([...pathResult.matches, ...secretResult.matches])),
    replacementCount: pathResult.replacementCount + secretResult.replacementCount,
  }
}

export type RecursiveRedactionResult = {
  value: unknown
  redacted: boolean
}

function structuredSecretLabel(key: string): string | null {
  const normalized = key.trim().toLowerCase().replace(/[-_]/g, '')
  if (normalized === 'authorization' || normalized === 'proxyauthorization') {
    return 'authorization_secret'
  }
  if (
    normalized === 'apikey' ||
    normalized === 'token' ||
    normalized === 'accesstoken' ||
    normalized === 'refreshtoken' ||
    normalized === 'idtoken' ||
    normalized === 'authtoken' ||
    normalized === 'bearertoken' ||
    normalized === 'secret' ||
    normalized === 'clientsecret' ||
    normalized === 'password' ||
    normalized === 'passphrase' ||
    normalized === 'privatekey' ||
    normalized === 'cookie' ||
    normalized === 'setcookie'
  ) {
    return 'json_secret'
  }
  return null
}

export function redactSensitiveValue(value: unknown): RecursiveRedactionResult {
  if (typeof value === 'string') {
    return redactSensitiveText(value)
  }
  if (Array.isArray(value)) {
    let redacted = false
    const items = value.map((item) => {
      const result = redactSensitiveValue(item)
      redacted ||= result.redacted
      return result.value
    })
    return { value: items, redacted }
  }
  if (typeof value !== 'object' || value === null) {
    return { value, redacted: false }
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return { value, redacted: false }
  }

  let redacted = false
  const record: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const safeKey = redactSensitiveText(key)
    const secretLabel = structuredSecretLabel(key)
    if (secretLabel) {
      redacted = true
      record[safeKey.value] = `[REDACTED:${secretLabel}]`
      continue
    }
    const safeItem = redactSensitiveValue(item)
    redacted ||= safeKey.redacted || safeItem.redacted
    record[safeKey.value] = safeItem.value
  }
  return { value: record, redacted }
}

export function redactCodingAgentEventForStorage(event: CodingAgentEvent): CodingAgentEvent {
  const message = redactSensitiveText(event.message)
  const metadata = event.metadata
    ? redactSensitiveValue(event.metadata)
    : { value: undefined, redacted: false }

  return {
    ...event,
    message: message.value,
    ...(metadata.value ? { metadata: metadata.value as Record<string, unknown> } : {}),
    redacted: event.redacted || message.redacted || metadata.redacted,
  }
}
