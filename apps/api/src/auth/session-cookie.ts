import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE_NAME = 'devflow_session'
export const SESSION_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60
const SESSION_COOKIE_VALUE_MAX_LENGTH = 2_048
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/

export type BrowserSessionCookieClaims = {
  v: 1
  authAccountId: string
  expiresAt: number
}

type SessionCookieClockOptions = {
  nowMs?: number
  secure?: boolean
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseBrowserSessionCookieClaims(value: unknown): BrowserSessionCookieClaims | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const keys = Object.keys(value).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== 'authAccountId' ||
    keys[1] !== 'expiresAt' ||
    keys[2] !== 'v'
  ) {
    return null
  }

  const candidate = value as BrowserSessionCookieClaims
  if (
    candidate.v !== 1 ||
    typeof candidate.authAccountId !== 'string' ||
    candidate.authAccountId.length === 0 ||
    candidate.authAccountId.length > 200 ||
    !Number.isInteger(candidate.expiresAt) ||
    candidate.expiresAt <= 0
  ) {
    return null
  }

  return candidate
}

export function createSessionCookie(
  input: Pick<BrowserSessionCookieClaims, 'authAccountId'>,
  secret: string,
  options: SessionCookieClockOptions = {},
): string {
  const nowMs = options.nowMs ?? Date.now()
  const claims: BrowserSessionCookieClaims = {
    v: 1,
    authAccountId: input.authAccountId,
    expiresAt: Math.floor(nowMs / 1_000) + SESSION_COOKIE_MAX_AGE_SECONDS,
  }
  const payload = encodeBase64Url(JSON.stringify(claims))
  const signature = signPayload(payload, secret)
  const secure = options.secure ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${payload}.${signature}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`
}

export function clearSessionCookie(options: Pick<SessionCookieClockOptions, 'secure'> = {}): string {
  const secure = options.secure ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {}
  }

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=')
        if (separator < 0) {
          return [part, '']
        }

        return [part.slice(0, separator), part.slice(separator + 1)]
      }),
  )
}

export function resolveSessionCookie(
  value: string | undefined,
  secret: string,
  options: SessionCookieClockOptions = {},
): BrowserSessionCookieClaims | null {
  if (!value) {
    return null
  }

  if (value.length > SESSION_COOKIE_VALUE_MAX_LENGTH) {
    return null
  }

  const segments = value.split('.')
  if (segments.length !== 2) {
    return null
  }
  const [payload, signature] = segments
  if (
    !payload ||
    !signature ||
    !BASE64URL_SEGMENT.test(payload) ||
    !BASE64URL_SEGMENT.test(signature)
  ) {
    return null
  }

  const expected = signPayload(payload, secret)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    const claims = parseBrowserSessionCookieClaims(
      JSON.parse(decodeBase64Url(payload)) as unknown,
    )
    const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1_000)
    return claims && nowSeconds < claims.expiresAt ? claims : null
  } catch {
    return null
  }
}
