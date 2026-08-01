import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevFlowApiError, createDesktopPairingCode } from '../../lib/devflow-api'
import { POST } from './route'

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
  }
})

const mockedCreateDesktopPairingCode = vi.mocked(createDesktopPairingCode)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pairing-code Web proxy', () => {
  it('forwards only the selected project identifier under the signed session', async () => {
    mockedCreateDesktopPairingCode.mockResolvedValueOnce({
      id: 'pair-p-remote',
      organizationId: 'org-demo',
      projectId: 'p-remote',
      createdByUserId: 'u-lead',
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
})
