import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevFlowApiError, createWorkRequest } from '../../lib/devflow-api'
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
    createWorkRequest: vi.fn(),
  }
})

const mockedCreateWorkRequest = vi.mocked(createWorkRequest)

function workRequest() {
  return {
    id: 'wr-1',
    organizationId: 'org-demo',
    projectId: 'p-remote',
    title: 'Prepare rollout',
    request: 'Keep the rollout reversible.',
    version: 1,
    status: 'open' as const,
    createdByUserId: 'u-lead',
    claim: null,
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Work Request Web proxy', () => {
  it('forwards a strict redacted create input under the signed session', async () => {
    mockedCreateWorkRequest.mockResolvedValueOnce({
      workRequest: workRequest(),
      replayed: false,
      outcomeCode: 'created',
    })

    const response = await POST(
      new NextRequest('http://web.local/api/work-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p-remote',
          title: 'Prepare /Users/alice/private rollout',
          request: 'Use API_KEY=sk-private while keeping it reversible.',
          idempotencyKey: 'create:wr-1',
          expiresAt: null,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockedCreateWorkRequest).toHaveBeenCalledWith({
      projectId: 'p-remote',
      title: 'Prepare [REDACTED:local_absolute_path] rollout',
      request: 'Use [REDACTED:env_secret_assignment] while keeping it reversible.',
      idempotencyKey: 'create:wr-1',
      expiresAt: null,
      cookieHeader: 'devflow_session=signed-session-1',
    })
    await expect(response.json()).resolves.toEqual({
      workRequest: workRequest(),
      replayed: false,
      outcomeCode: 'created',
    })
  })

  it('rejects unknown renderer fields before calling the upstream API', async () => {
    const response = await POST(
      new NextRequest('http://web.local/api/work-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p-remote',
          title: 'Prepare rollout',
          request: 'Keep it reversible.',
          idempotencyKey: 'create:wr-1',
          expiresAt: null,
          token: 'must-not-be-forwarded',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mockedCreateWorkRequest).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('must-not-be-forwarded')
  })

  it.each([400, 401, 403, 404, 409, 410])(
    'preserves safe upstream status %s without exposing upstream details',
    async (status) => {
      mockedCreateWorkRequest.mockRejectedValueOnce(
        new DevFlowApiError('/api/team/projects/:projectId/work-requests', status),
      )

      const response = await POST(
        new NextRequest('http://web.local/api/work-requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: 'p-remote',
            title: 'Prepare rollout',
            request: 'Keep it reversible.',
            idempotencyKey: 'create:wr-1',
            expiresAt: null,
          }),
        }),
      )

      expect(response.status).toBe(status)
      await expect(response.json()).resolves.toEqual({
        message: 'Work Request was rejected.',
      })
    },
  )

  it('fails closed when an upstream result contains internal claim metadata', async () => {
    mockedCreateWorkRequest.mockResolvedValueOnce({
      workRequest: {
        ...workRequest(),
        claimedByTokenId: 'must-not-reach-browser',
      },
      replayed: false,
      outcomeCode: 'created',
    } as never)

    const response = await POST(
      new NextRequest('http://web.local/api/work-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p-remote',
          title: 'Prepare rollout',
          request: 'Keep it reversible.',
          idempotencyKey: 'create:wr-1',
          expiresAt: null,
        }),
      }),
    )

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('must-not-reach-browser')
  })
})
