import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('Web readiness probe', () => {
  beforeEach(() => {
    vi.stubEnv('DEVFLOW_INTERNAL_API_BASE_URL', 'http://api.internal:4310/')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reports ready only when the internal API readiness probe succeeds', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ status: 'ready', service: '@ai-devflow/api' }),
    )
    vi.stubGlobal('fetch', fetcher)

    const response = await GET()

    expect(fetcher).toHaveBeenCalledWith(
      'http://api.internal:4310/ready',
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      service: '@ai-devflow/web',
    })
  })

  it.each([
    ['an unavailable API', vi.fn(async () => new Response('secret detail', { status: 503 }))],
    ['an invalid API payload', vi.fn(async () => Response.json({ status: 'ok' }))],
    ['a different ready service', vi.fn(async () => Response.json({ status: 'ready', service: 'lookalike-api' }))],
    ['a failed API request', vi.fn(async () => Promise.reject(new Error('secret detail')))],
  ])('returns a fixed unavailable response for %s', async (_name, fetcher) => {
    vi.stubGlobal('fetch', fetcher)

    const response = await GET()

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      status: 'unavailable',
      service: '@ai-devflow/web',
    })
    expect(JSON.stringify(body)).not.toContain('secret detail')
  })
})
