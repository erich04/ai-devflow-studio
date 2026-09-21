import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), revalidate: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { organizationAction } from './organization-actions'

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockReturnValue({ value: 'old-signed-cookie' }) })

it('updates only the signed session cookie after a successful organization switch', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organizationId: 'org-b' }), { headers: { 'set-cookie': 'devflow_session=new-signed-cookie; HttpOnly; Secure; SameSite=Lax; Path=/' } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await organizationAction('/api/organizations/org-b/select', 'POST')).toEqual({ ok: true, data: { organizationId: 'org-b' } })
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/organizations/org-b/select'), expect.objectContaining({ headers: expect.objectContaining({ cookie: 'devflow_session=old-signed-cookie' }), redirect: 'error' }))
  expect(mocks.set).toHaveBeenCalledWith('devflow_session', 'new-signed-cookie', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28800 })
})

it('does not change the cookie or invalidate the workbench when switching is forbidden', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
  expect(await organizationAction('/api/organizations/org-b/select', 'POST')).toMatchObject({ ok: false, status: 403 })
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
})

it('cannot proxy arbitrary authenticated API paths or external URLs', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  for (const path of ['https://other.invalid', '/api/organizations/../agent/providers', '/api/agent/providers', '/api/organizations?scope=other']) {
    expect(await organizationAction(path, 'POST', {})).toMatchObject({ ok: false, status: 400 })
  }
  expect(fetcher).not.toHaveBeenCalled()
})
