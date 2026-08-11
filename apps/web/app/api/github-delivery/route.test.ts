import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GitHubDeliveryApiError,
  configureGitHubRepositoryBinding,
  decideGitHubDeliveryRequest,
  revokeGitHubRepositoryBinding,
  type GitHubDeliveryRequestView,
} from '../../lib/devflow-api'
import { POST, PUT } from './route'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('../../lib/devflow-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/devflow-api')>(
    '../../lib/devflow-api',
  )
  return {
    ...actual,
    configureGitHubRepositoryBinding: vi.fn(),
    decideGitHubDeliveryRequest: vi.fn(),
    revokeGitHubRepositoryBinding: vi.fn(),
  }
})

const mockedCookies = vi.mocked(cookies)
const mockedConfigure = vi.mocked(configureGitHubRepositoryBinding)
const mockedDecide = vi.mocked(decideGitHubDeliveryRequest)
const mockedRevoke = vi.mocked(revokeGitHubRepositoryBinding)

const binding = {
  stateVersion: 1 as const,
  id: 'binding-1',
  version: 3,
  organizationId: 'org-demo',
  teamProjectId: 'p-payments',
  installationId: '12345',
  repositoryId: '98765',
  repository: 'example/payments',
  defaultBranch: 'main',
  status: 'active' as const,
  validatedAt: '2026-08-11T14:00:00.000Z',
  updatedAt: '2026-08-11T14:00:00.000Z',
  redacted: true as const,
}

const delivery: GitHubDeliveryRequestView = {
  id: 'delivery-1',
  stateVersion: 3,
  intentRevision: 1,
  projectId: 'p-payments',
  runId: 'run-1',
  runVersion: 7,
  nodeId: 'pr-1',
  repositoryBindingVersion: 3,
  repository: 'example/payments',
  status: 'approved',
  outcomeCode: null,
  expectedRunVersion: 7,
  baseBranch: 'main',
  headBranch: 'devflow/run-1-pr-1',
  baseCommitSha: 'a'.repeat(40),
  expectedCommitSha: 'b'.repeat(40),
  intentDigest: 'c'.repeat(64),
  diffDigest: 'd'.repeat(64),
  testEvidenceId: 'test-1',
  testEvidenceDigest: 'e'.repeat(64),
  packageDigest: 'f'.repeat(64),
  prTitle: 'Deliver the exact approved change',
  expiresAt: '2026-08-12T14:00:00.000Z',
  updatedAt: '2026-08-11T14:01:00.000Z',
}

function request(method: 'POST' | 'PUT', body: unknown) {
  return new NextRequest('http://web.local/api/github-delivery', {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://web.local',
    },
    body: JSON.stringify(body),
  })
}

describe('GitHub Delivery Web proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCookies.mockResolvedValue({
      get: vi.fn(() => ({ name: 'devflow_session', value: 'session-1' })),
    } as never)
    mockedConfigure.mockResolvedValue({
      binding,
      outcomeCode: 'binding_updated',
      replayed: false,
    })
    mockedDecide.mockResolvedValue({
      request: delivery,
      outcomeCode: 'delivery_approved',
      replayed: false,
    })
    mockedRevoke.mockResolvedValue({
      binding: { ...binding, version: 4, status: 'revoked' },
      outcomeCode: 'binding_revoked',
      replayed: false,
    })
  })

  it('requires application/json before accepting a mutation', async () => {
    const response = await PUT(new NextRequest('http://web.local/api/github-delivery', {
      method: 'PUT',
      body: JSON.stringify({
        action: 'configure',
        projectId: 'p-payments',
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion: 2,
      }),
    }))

    expect(response.status).toBe(415)
    expect(mockedConfigure).not.toHaveBeenCalled()
  })

  it('checks the signed Cookie before parsing a mutation body', async () => {
    mockedCookies.mockResolvedValue({ get: vi.fn(() => undefined) } as never)
    const response = await PUT(new NextRequest('http://web.local/api/github-delivery', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-json',
    }))

    expect(response.status).toBe(401)
    expect(mockedConfigure).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin mutation before parsing its body', async () => {
    const response = await PUT(new NextRequest('http://web.local/api/github-delivery', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: '{malformed-json',
    }))

    expect(response.status).toBe(403)
    expect(mockedConfigure).not.toHaveBeenCalled()
  })

  it('allows absent Origin only for a documented same-server programmatic call', async () => {
    const body = JSON.stringify({
      action: 'configure',
      projectId: 'p-payments',
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 2,
    })
    const programmatic = await PUT(new NextRequest(
      'http://web.local/api/github-delivery',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      },
    ))
    expect(programmatic.status).toBe(200)

    const browserWithoutOrigin = await PUT(new NextRequest(
      'http://web.local/api/github-delivery',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body,
      },
    ))
    expect(browserWithoutOrigin.status).toBe(403)
  })

  it('configures a project binding with only strict browser input and the signed Cookie', async () => {
    const response = await PUT(request('PUT', {
      action: 'configure',
      projectId: 'p-payments',
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 2,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      binding,
      outcomeCode: 'binding_updated',
    })
    expect(mockedConfigure).toHaveBeenCalledWith({
      projectId: 'p-payments',
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 2,
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('returns the server-owned safe Delivery projection after an exact approval', async () => {
    const response = await POST(request('POST', {
      action: 'approve',
      projectId: 'p-payments',
      requestId: 'delivery-1',
      expectedStateVersion: 2,
    }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      request: delivery,
      outcomeCode: 'delivery_approved',
    })
    expect(mockedDecide).toHaveBeenCalledWith({
      projectId: 'p-payments',
      requestId: 'delivery-1',
      decision: 'approve',
      expectedStateVersion: 2,
      cookieHeader: 'devflow_session=session-1',
    })
    expect(JSON.stringify(payload)).not.toContain('/Users/')
  })

  it('rejects a decision result containing fields outside the nested safe projection', async () => {
    mockedDecide.mockResolvedValueOnce({
      request: {
        ...delivery,
        prBody: 'API_TOKEN=must-not-reach-the-browser',
      } as unknown as GitHubDeliveryRequestView,
      outcomeCode: 'delivery_approved',
      replayed: false,
    })

    const response = await POST(request('POST', {
      action: 'approve',
      projectId: 'p-payments',
      requestId: 'delivery-1',
      expectedStateVersion: 2,
    }))

    expect(response.status).toBe(502)
    const payload = await response.json()
    expect(payload).toEqual({
      code: 'service_unavailable',
      message: 'GitHub Delivery service is unavailable.',
    })
    expect(JSON.stringify(payload)).not.toContain('API_TOKEN')
  })

  it('revokes a binding through the distinct version-bound owner action', async () => {
    const response = await POST(request('POST', {
      action: 'revoke',
      projectId: 'p-payments',
      expectedStateVersion: 3,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      binding: { version: 4, status: 'revoked' },
      outcomeCode: 'binding_revoked',
    })
    expect(mockedRevoke).toHaveBeenCalledWith({
      projectId: 'p-payments',
      expectedStateVersion: 3,
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('rejects missing signed authority and unknown secret or path fields', async () => {
    mockedCookies.mockResolvedValue({ get: vi.fn(() => undefined) } as never)
    expect((await POST(request('POST', {
      action: 'approve',
      projectId: 'p-payments',
      requestId: 'delivery-1',
      expectedStateVersion: 2,
    }))).status).toBe(401)

    mockedCookies.mockResolvedValue({
      get: vi.fn(() => ({ name: 'devflow_session', value: 'session-1' })),
    } as never)
    const unsafe = await PUT(request('PUT', {
      action: 'configure',
      projectId: 'p-payments',
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 2,
      privateKey: 'secret',
      workspacePath: '/Users/alice/private',
    }))
    expect(unsafe.status).toBe(400)
    expect(mockedConfigure).not.toHaveBeenCalled()
    const payload = await unsafe.json()
    expect(JSON.stringify(payload)).not.toContain('secret')
    expect(JSON.stringify(payload)).not.toContain('/Users/')
  })

  it('returns typed provider-unavailable feedback without reflecting upstream details', async () => {
    mockedConfigure.mockRejectedValueOnce(new GitHubDeliveryApiError(
      '/api/team/projects/:projectId/github-repository-binding',
      503,
      'provider_unavailable',
      false,
    ))

    const response = await PUT(request('PUT', {
      action: 'configure',
      projectId: 'p-payments',
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 2,
    }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'provider_unavailable',
      message: 'GitHub provider is unavailable. No operation was applied.',
    })
  })
})
