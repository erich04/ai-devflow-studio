import { describe, expect, it } from 'vitest'
import type { AuthenticatedSession } from '@ai-devflow/shared'
import {
  clearSessionCookie,
  createSessionCookie,
  parseCookieHeader,
  resolveSessionCookie,
} from './session-cookie'

const session: AuthenticatedSession = {
  source: 'authenticated',
  organizationId: 'org-default',
  userId: 'u-github-123456',
  role: 'owner',
  authAccountId: 'acct-github-123456',
  projectMemberships: [],
}

describe('session cookie boundary', () => {
  it('round-trips authenticated sessions through a signed http-only cookie', () => {
    const cookie = createSessionCookie(session, 'test-secret')
    const cookies = parseCookieHeader(cookie)

    expect(cookie).toContain('devflow_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(resolveSessionCookie(cookies['devflow_session'], 'test-secret')).toEqual(session)
  })

  it('rejects tampered or incorrectly signed session cookies', () => {
    const cookie = createSessionCookie(session, 'test-secret')
    const cookies = parseCookieHeader(cookie)
    const value = cookies['devflow_session']!

    expect(resolveSessionCookie(`${value}tampered`, 'test-secret')).toBeNull()
    expect(resolveSessionCookie(value, 'other-secret')).toBeNull()
  })

  it('creates an expiring clear-cookie header for logout', () => {
    expect(clearSessionCookie()).toBe(
      'devflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    )
  })
})
