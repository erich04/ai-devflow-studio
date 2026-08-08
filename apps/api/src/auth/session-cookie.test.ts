import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  clearSessionCookie,
  createSessionCookie,
  parseCookieHeader,
  resolveSessionCookie,
} from './session-cookie'

const authAccountId = 'acct-github-123456'
const nowMs = Date.parse('2026-08-01T12:00:00.000Z')

function signClaims(value: unknown, secret = 'test-secret'): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

describe('session cookie boundary', () => {
  it('stores only stable account identity and an eight-hour expiry in the signed cookie', () => {
    const cookie = createSessionCookie({ authAccountId }, 'test-secret', { nowMs })
    const cookies = parseCookieHeader(cookie)
    const payload = cookie.split('=')[1]!.split('.')[0]!
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))

    expect(cookie).toContain('devflow_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`)
    expect(decodedPayload).toEqual({
      v: 1,
      authAccountId,
      expiresAt: Math.floor(nowMs / 1_000) + SESSION_COOKIE_MAX_AGE_SECONDS,
    })
    expect(resolveSessionCookie(cookies['devflow_session'], 'test-secret', { nowMs })).toEqual(
      decodedPayload,
    )
  })

  it('rejects tampered or incorrectly signed session cookies', () => {
    const cookie = createSessionCookie({ authAccountId }, 'test-secret', { nowMs })
    const cookies = parseCookieHeader(cookie)
    const value = cookies['devflow_session']!

    expect(resolveSessionCookie(`${value}tampered`, 'test-secret')).toBeNull()
    expect(resolveSessionCookie(value, 'other-secret')).toBeNull()
    expect(resolveSessionCookie(`${value}.unexpected`, 'test-secret', { nowMs })).toBeNull()
  })

  it('rejects signed legacy authorization snapshots and unknown claims', () => {
    const expiresAt = Math.floor(nowMs / 1_000) + SESSION_COOKIE_MAX_AGE_SECONDS
    const legacySession = signClaims({
      source: 'authenticated',
      organizationId: 'org-default',
      userId: 'u-github-123456',
      role: 'owner',
      authAccountId,
      projectMemberships: [{ projectId: 'p-payments', userId: 'u-github-123456', role: 'owner' }],
    })
    const claimsWithEmbeddedRole = signClaims({ v: 1, authAccountId, expiresAt, role: 'owner' })

    expect(resolveSessionCookie(legacySession, 'test-secret', { nowMs })).toBeNull()
    expect(resolveSessionCookie(claimsWithEmbeddedRole, 'test-secret', { nowMs })).toBeNull()
  })

  it('rejects expired, malformed, and oversized signed-cookie inputs', () => {
    const expired = signClaims({
      v: 1,
      authAccountId,
      expiresAt: Math.floor(nowMs / 1_000),
    })

    expect(resolveSessionCookie(expired, 'test-secret', { nowMs })).toBeNull()
    expect(resolveSessionCookie('not%base64url.signature', 'test-secret', { nowMs })).toBeNull()
    expect(resolveSessionCookie(`${'a'.repeat(2_049)}.signature`, 'test-secret', { nowMs })).toBeNull()
  })

  it('creates an expiring clear-cookie header for logout', () => {
    expect(clearSessionCookie()).toBe(
      'devflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    )
  })

  it('marks session and clear cookies Secure for an HTTPS pilot', () => {
    expect(
      createSessionCookie({ authAccountId }, 'test-secret', {
        nowMs,
        secure: true,
      }),
    ).toContain('HttpOnly; Secure; SameSite=Lax')
    expect(clearSessionCookie({ secure: true })).toBe(
      'devflow_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    )
  })
})
