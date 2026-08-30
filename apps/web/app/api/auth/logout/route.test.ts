import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === 'devflow_session' ? { name, value: 'signed-session-1' } : undefined,
    ),
  })),
}))

vi.mock('../../../lib/devflow-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/devflow-api')>()
  return {
    ...actual,
    resolveDevFlowApiBaseUrl: vi.fn(() => 'http://api.local'),
  }
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('browser logout proxy', () => {
  it('forwards the signed cookie and redirects without parsing the upstream 204', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        headers: {
          'set-cookie': 'devflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        },
      }),
    )

    const response = await POST(
      new NextRequest('http://web.local/api/auth/logout', { method: 'POST' }),
    )

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.local/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { cookie: 'devflow_session=signed-session-1' },
      }),
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://web.local/')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('returns a fixed error when the API is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('secret upstream detail'))

    const response = await POST(
      new NextRequest('http://web.local/api/auth/logout', { method: 'POST' }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      message: 'Logout service is unavailable.',
    })
  })
})
