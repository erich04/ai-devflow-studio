import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import {
  DevFlowApiError,
  createGateCommand,
  fetchGateCommands,
} from '../../lib/devflow-api'
import { GET, POST } from './route'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('../../lib/devflow-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/devflow-api')>(
    '../../lib/devflow-api',
  )
  return {
    ...actual,
    createGateCommand: vi.fn(),
    fetchGateCommands: vi.fn(),
  }
})

const mockedCookies = vi.mocked(cookies)
const mockedCreate = vi.mocked(createGateCommand)
const mockedFetch = vi.mocked(fetchGateCommands)

const input = {
  projectId: 'project-a',
  runId: 'run-1',
  nodeId: 'gate-1',
  action: 'approve',
  reason: 'Reviewed current projection.',
  expectedRunVersion: 3,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [],
  idempotencyKey: 'gate:create:run-1:v3',
}

function command() {
  return {
    id: 'gate-command-1',
    version: 1,
    organizationId: 'org-a',
    projectId: 'project-a',
    workRequestId: 'wr-1',
    runId: 'run-1',
    nodeId: 'gate-1',
    action: 'approve' as const,
    workflowCommand: 'approve_gate' as const,
    reason: input.reason,
    requestedByUserId: 'user-lead',
    requestedRole: 'lead' as const,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: 'a'.repeat(64),
    expectedRunVersion: 3,
    expectedPolicyVersion: 2,
    expectedBlockerIds: [],
    evaluationStatus: 'allowed' as const,
    evaluationBlockerIds: [],
    evaluatedAt: '2026-08-01T10:00:00.000Z',
    status: 'pending' as const,
    outcomeCode: null,
    expiresAt: '2026-08-01T10:15:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  }
}

function request(body: unknown) {
  return new NextRequest('http://web.local/api/gate-commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Gate Command Web proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCookies.mockResolvedValue({
      get: vi.fn(() => ({ name: 'devflow_session', value: 'session-1' })),
    } as never)
    mockedCreate.mockResolvedValue({
      command: command(),
      replayed: false,
      outcomeCode: 'created',
    })
    mockedFetch.mockResolvedValue([command()])
  })

  it('loads a strict project lifecycle through the signed Cookie', async () => {
    const response = await GET(
      new NextRequest(
        'http://web.local/api/gate-commands?projectId=project-a',
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ commands: [command()] })
    expect(mockedFetch).toHaveBeenCalledWith({
      projectId: 'project-a',
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('rejects an invalid GET scope or missing signed Cookie', async () => {
    expect(
      (
        await GET(
          new NextRequest(
            'http://web.local/api/gate-commands?projectId=%20project-a%20',
          ),
        )
      ).status,
    ).toBe(400)
    expect(mockedFetch).not.toHaveBeenCalled()

    mockedCookies.mockResolvedValue({ get: vi.fn(() => undefined) } as never)
    expect(
      (
        await GET(
          new NextRequest(
            'http://web.local/api/gate-commands?projectId=project-a',
          ),
        )
      ).status,
    ).toBe(401)
  })

  it('forwards only strict browser-owned input with the signed Cookie', async () => {
    const response = await POST(request(input))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      command: command(),
      replayed: false,
      outcomeCode: 'created',
    })
    expect(mockedCreate).toHaveBeenCalledWith({
      ...input,
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('rejects missing Cookie and unknown authority fields', async () => {
    mockedCookies.mockResolvedValue({ get: vi.fn(() => undefined) } as never)
    expect((await POST(request(input))).status).toBe(401)

    mockedCookies.mockResolvedValue({
      get: vi.fn(() => ({ name: 'devflow_session', value: 'session-1' })),
    } as never)
    expect(
      (await POST(request({ ...input, requestedRole: 'owner' }))).status,
    ).toBe(400)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('preserves safe conflicts and hides unexpected upstream failures', async () => {
    mockedCreate.mockRejectedValueOnce(
      new DevFlowApiError('/api/team/projects/:projectId/gate-commands', 409),
    )
    expect((await POST(request(input))).status).toBe(409)

    mockedCreate.mockRejectedValueOnce(new Error('database host secret'))
    const unavailable = await POST(request(input))
    expect(unavailable.status).toBe(502)
    await expect(unavailable.json()).resolves.toEqual({
      message: 'Gate Command service is unavailable.',
    })
  })

  it('rejects an upstream command outside the requested scope', async () => {
    mockedCreate.mockResolvedValueOnce({
      command: { ...command(), projectId: 'project-other' },
      replayed: false,
      outcomeCode: 'created',
    })

    const response = await POST(request(input))
    expect(response.status).toBe(502)
  })
})
