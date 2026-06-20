import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthenticatedSession, ProjectMembership, Role } from '@ai-devflow/shared'

export const SESSION_COOKIE_NAME = 'devflow_session'

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'lead' || value === 'member'
}

function isProjectMembership(value: unknown): value is ProjectMembership {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProjectMembership).projectId === 'string' &&
    typeof (value as ProjectMembership).userId === 'string' &&
    isRole((value as ProjectMembership).role)
  )
}

function parseAuthenticatedSession(value: unknown): AuthenticatedSession | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as AuthenticatedSession
  if (
    candidate.source !== 'authenticated' ||
    typeof candidate.organizationId !== 'string' ||
    typeof candidate.userId !== 'string' ||
    !isRole(candidate.role) ||
    typeof candidate.authAccountId !== 'string' ||
    !Array.isArray(candidate.projectMemberships) ||
    !candidate.projectMemberships.every(isProjectMembership)
  ) {
    return null
  }

  return candidate
}

export function createSessionCookie(session: AuthenticatedSession, secret: string): string {
  const payload = encodeBase64Url(JSON.stringify(session))
  const signature = signPayload(payload, secret)
  return `${SESSION_COOKIE_NAME}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
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
): AuthenticatedSession | null {
  if (!value) {
    return null
  }

  const [payload, signature] = value.split('.')
  if (!payload || !signature) {
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
    return parseAuthenticatedSession(JSON.parse(decodeBase64Url(payload)) as unknown)
  } catch {
    return null
  }
}
