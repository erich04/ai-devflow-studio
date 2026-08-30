import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DevFlowApiError,
  createDesktopPairingCode,
  revokeDesktopPairingCode,
} from '../../lib/devflow-api'
import { DELETE, POST } from './route'

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === 'devflow_session' ? { name, value: 'signed-session-1' } : undefined,
    ),
  })),
}))

vi.mock('../../lib/devflow-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/devflow-api')>()
  return {
    ...actual,
    createDesktopPairingCode: vi.fn(),
    revokeDesktopPairingCode: vi.fn(),
  }
})

const mockedCreateDesktopPairingCode = vi.mocked(createDesktopPairingCode)
const mockedRevokeDesktopPairingCode = vi.mocked(revokeDesktopPairingCode)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pairing-code Web proxy', () => {
  it('revokes only the exact generated code under the signed session', async () => {
    mockedRevokeDesktopPairingCode.mockResolvedValueOnce(undefined)
    const response = await DELETE(
      new NextRequest('http://web.local/api/pairing-code', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p-remote',
          pairingCodeId: 'pair-p-remote',
          createdByUserId: 'u-other',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mockedRevokeDesktopPairingCode).toHaveBeenCalledWith({
      projectId: 'p-remote',
      pairingCodeId: 'pair-p-remote',
      cookieHeader: 'devflow_session=signed-session-1',
    })
  })

  it('forwards only the selected project identifier under the signed session', async () => {
    mockedCreateDesktopPairingCode.mockResolvedValueOnce({
      id: 'pair-p-remote',
      organizationId: 'org-demo',
      projectId: 'p-remote',
      createdByUserId: 'u-lead',
      issuedRole: 'lead',
      code: 'new.copy-once-code',
      expiresAt: '2026-08-01T12:10:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      attemptsRemaining: 5,
    })

    const response = await POST(
      new NextRequest('http://web.local/api/pairing-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p-remote',
          code: 'existing-code-must-not-be-read',
          token: 'existing-token-must-not-be-read',
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockedCreateDesktopPairingCode).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=signed-session-1',
    })
  })

  it.each([401, 403, 409])('preserves safe upstream status %s without exposing upstream details', async (status) => {
    mockedCreateDesktopPairingCode.mockRejectedValueOnce(
      new DevFlowApiError('/api/team/projects/:projectId/pairing-codes', status),
    )

    const response = await POST(
      new NextRequest('http://web.local/api/pairing-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'p-remote' }),
      }),
    )

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({
      message: 'Pairing code request was rejected.',
    })
    expect(mockedCreateDesktopPairingCode).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=signed-session-1',
    })
  })

  it('rejects a mismatched or over-broad upstream payload without forwarding secret fields', async () => {
    mockedCreateDesktopPairingCode.mockResolvedValueOnce({
      id: 'pair-p-other',
      organizationId: 'org-demo',
      projectId: 'p-other',
      createdByUserId: 'u-lead',
      issuedRole: 'lead',
      code: 'p-other.copy-once-secret',
      expiresAt: '2026-08-01T12:10:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      attemptsRemaining: 5,
      token: 'must-not-reach-browser',
    } as never)

    const response = await POST(
      new NextRequest('http://web.local/api/pairing-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'p-remote' }),
      }),
    )

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toMatch(/p-other|must-not-reach-browser/)
  })
})
