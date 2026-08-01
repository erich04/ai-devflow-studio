import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedSession, WorkRequest } from '@ai-devflow/shared'
import { createSessionCookie } from './auth/session-cookie'
import { createSeedTeamRepository } from './repositories/team-repository'
import type {
  WorkRequestMutationResult,
  WorkRequestRepository,
} from './repositories/work-request-contract'
import {
  createCorsPreflightHeaders,
  createInternalErrorResponse,
  resolveApiRouteRequest,
} from './server-request'

const projectMemberSession: AuthenticatedSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-api-member',
  role: 'member',
  authAccountId: 'acct-api-member',
  projectMemberships: [
    { projectId: 'p-payments', userId: 'u-api-member', role: 'member' },
  ],
}

const projectLeadSession: AuthenticatedSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-api-lead',
  role: 'lead',
  authAccountId: 'acct-api-lead',
  projectMemberships: [
    { projectId: 'p-payments', userId: 'u-api-lead', role: 'lead' },
  ],
}

const authenticatedWithoutProject: AuthenticatedSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-api-outsider',
  role: 'member',
  authAccountId: 'acct-api-outsider',
  projectMemberships: [],
}

function runSummary(runId: string) {
  return {
    kind: 'run' as const,
    runId,
    version: 1,
    projectId: 'p-payments',
    title: 'Authenticated sync',
    status: 'testing' as const,
    currentNodeId: 'node-test',
    currentNode: {
      id: 'node-test',
      stage: 'test' as const,
      kind: 'test' as const,
      status: 'running' as const,
    },
    branchName: 'ai/authenticated-sync',
    updatedAt: '2026-07-31T12:00:00.000Z',
  }
}

const openWorkRequest: WorkRequest = {
  id: 'wr-api-rollout',
  organizationId: 'org-demo',
  projectId: 'p-payments',
  title: 'Prepare rollout',
  request: 'Keep the deployment reversible.',
  version: 1,
  status: 'open',
  createdByUserId: projectMemberSession.userId,
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const claimedWorkRequest: WorkRequest = {
  ...openWorkRequest,
  version: 2,
  status: 'claim_pending',
  claim: {
    runId: 'run-api-rollout',
    claimedAt: '2026-08-01T12:01:00.000Z',
    materializedAt: null,
  },
  updatedAt: '2026-08-01T12:01:00.000Z',
}

function createWorkRequestAwareRepository() {
  const workRequests: WorkRequestRepository = {
    listWorkRequests: vi.fn(async () => [openWorkRequest]),
    createWorkRequest: vi.fn(async () =>
      ({
        ok: true,
        responseStatus: 201,
        outcomeCode: 'created',
        replayed: false,
        workRequest: openWorkRequest,
      }) satisfies WorkRequestMutationResult,
    ),
    claimWorkRequest: vi.fn(async () =>
      ({
        ok: true,
        responseStatus: 200,
        outcomeCode: 'claimed',
        replayed: false,
        workRequest: claimedWorkRequest,
      }) satisfies WorkRequestMutationResult,
    ),
    materializeWorkRequest: vi.fn(async () =>
      ({
        ok: true,
        responseStatus: 200,
        outcomeCode: 'materialized',
        replayed: false,
        workRequest: {
          ...claimedWorkRequest,
          version: 3,
          status: 'materialized',
          claim: {
            ...claimedWorkRequest.claim!,
            materializedAt: '2026-08-01T12:02:00.000Z',
          },
          updatedAt: '2026-08-01T12:02:00.000Z',
        },
      }) satisfies WorkRequestMutationResult,
    ),
    releaseWorkRequest: vi.fn(async () =>
      ({
        ok: true,
        responseStatus: 200,
        outcomeCode: 'released',
        replayed: false,
        workRequest: { ...openWorkRequest, version: 3 },
      }) satisfies WorkRequestMutationResult,
    ),
  }

  return Object.assign(createSeedTeamRepository(), workRequests)
}

describe('API HTTP authentication boundary', () => {
  it('does not authorize unsigned identity headers in CORS preflight responses', () => {
    const headers = createCorsPreflightHeaders()

    expect(headers['access-control-allow-headers']).toBe('authorization,content-type')
    expect(JSON.stringify(headers)).not.toContain('x-devflow-')
  })

  it('rejects a direct run-summary POST that forges unsigned identity headers from an Origin', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          origin: 'http://renderer.example',
          'x-devflow-session-source': 'demo',
          'x-devflow-organization-id': 'org-demo',
          'x-devflow-user-id': projectMemberSession.userId,
          'x-devflow-user-role': 'owner',
          'x-devflow-project-roles': 'p-payments:owner',
        },
        body: runSummary('run-forged-header'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
        devAuthEnabled: true,
      },
    )

    expect(result).toMatchObject({ status: 401 })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('rejects unsigned identity headers for every HTTP casing of Origin', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          Origin: 'http://renderer.example',
          'x-devflow-session-source': 'demo',
          'x-devflow-organization-id': 'org-demo',
          'x-devflow-user-id': projectMemberSession.userId,
          'x-devflow-user-role': 'owner',
          'x-devflow-project-roles': 'p-payments:owner',
        },
        body: runSummary('run-forged-header-origin-casing'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
        devAuthEnabled: true,
      },
    )

    expect(result).toMatchObject({ status: 401 })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('rejects unsigned identity headers by default even without an Origin', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          'x-devflow-session-source': 'demo',
          'x-devflow-organization-id': 'org-demo',
          'x-devflow-user-id': projectMemberSession.userId,
          'x-devflow-user-role': 'owner',
          'x-devflow-project-roles': 'p-payments:owner',
        },
        body: runSummary('run-forged-header-default'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
      },
    )

    expect(result).toMatchObject({ status: 401 })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('accepts unsigned identity headers only in explicit non-browser development mode', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          'x-devflow-session-source': 'demo',
          'x-devflow-organization-id': 'org-demo',
          'x-devflow-user-id': projectMemberSession.userId,
          'x-devflow-user-role': 'member',
          'x-devflow-project-roles': 'p-payments:member',
        },
        body: runSummary('run-explicit-dev-auth'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
        devAuthEnabled: true,
      },
    )

    expect(result).toMatchObject({ status: 202 })
    expect(uploadRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-explicit-dev-auth' }),
      expect.objectContaining({ source: 'demo', userId: projectMemberSession.userId }),
    )
  })

  it('accepts a direct run-summary POST authenticated with a paired bearer token', async () => {
    const repository = createSeedTeamRepository()
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockResolvedValue({
      tokenRecordId: 'desktop-token-valid',
      session: projectMemberSession,
    })
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          authorization: 'Bearer valid-desktop-token',
        },
        body: runSummary('run-bearer-authenticated'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
      },
    )

    expect(result).toMatchObject({ status: 202 })
    expect(repository.resolveDesktopTokenSession).toHaveBeenCalledWith('valid-desktop-token')
    expect(uploadRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-bearer-authenticated' }),
      projectMemberSession,
    )
  })

  it('returns 401 for an invalid bearer credential without exposing it', async () => {
    const repository = createSeedTeamRepository()
    const bearerSecret = 'desktop-token-id.invalid-private-secret'
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockResolvedValue(null)

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          authorization: `Bearer ${bearerSecret}`,
        },
        body: runSummary('run-invalid-bearer'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
      },
    )

    expect(result).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(JSON.stringify(result)).not.toContain(bearerSecret)
  })

  it('fails closed without exposing a bearer secret when session lookup fails', async () => {
    const repository = createSeedTeamRepository()
    const bearerSecret = 'desktop-token-id.copy-once-private-secret'
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockRejectedValue(
      new Error(`lookup failed for Authorization: Bearer ${bearerSecret}`),
    )
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          authorization: `Bearer ${bearerSecret}`,
        },
        body: runSummary('run-bearer-lookup-failed'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
      },
    )

    expect(result).toEqual({
      status: 503,
      body: {
        error: 'service_unavailable',
        message: 'Authentication service is temporarily unavailable',
      },
    })
    expect(JSON.stringify(result)).not.toContain(bearerSecret)
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('accepts a direct run-summary POST authenticated with a signed session cookie', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')
    const sessionSecret = 'server-request-test-secret'
    const cookie = createSessionCookie(
      { authAccountId: projectMemberSession.authAccountId },
      sessionSecret,
    ).split(';')[0]
    vi.spyOn(repository, 'resolveBrowserSession').mockResolvedValue(projectMemberSession)

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: { cookie },
        body: runSummary('run-cookie-authenticated'),
      },
      {
        repository,
        sessionSecret,
      },
    )

    expect(result).toMatchObject({ status: 202 })
    expect(uploadRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-cookie-authenticated' }),
      projectMemberSession,
    )
  })

  it('reloads live project authority for every request made with the same cookie', async () => {
    const repository = createSeedTeamRepository()
    const sessionSecret = 'server-request-test-secret'
    const cookie = createSessionCookie(
      { authAccountId: projectLeadSession.authAccountId },
      sessionSecret,
    ).split(';')[0]
    vi.spyOn(repository, 'resolveBrowserSession')
      .mockResolvedValueOnce(projectLeadSession)
      .mockResolvedValueOnce({ ...projectLeadSession, role: 'member', projectMemberships: [] })

    const request = {
      method: 'POST',
      pathname: '/api/team/projects/p-payments/pairing-codes',
      headers: { cookie },
    }
    const first = await resolveApiRouteRequest(request, { repository, sessionSecret })
    const afterRevocation = await resolveApiRouteRequest(request, { repository, sessionSecret })

    expect(first?.status).toBe(201)
    expect(afterRevocation).toEqual({
      status: 403,
      body: { error: 'forbidden', message: 'Project role lead required' },
    })
    expect(repository.resolveBrowserSession).toHaveBeenCalledTimes(2)
  })

  it('returns a fixed 503 when live browser identity cannot be loaded', async () => {
    const repository = createSeedTeamRepository()
    const internalSecret = 'postgres://private-user:private-password@internal-db/devflow'
    vi.spyOn(repository, 'resolveBrowserSession').mockRejectedValue(
      new Error(`identity lookup failed for ${internalSecret}`),
    )
    const cookie = createSessionCookie(
      { authAccountId: projectLeadSession.authAccountId },
      'server-request-test-secret',
    ).split(';')[0]

    const result = await resolveApiRouteRequest(
      { method: 'GET', pathname: '/api/team/overview', headers: { cookie } },
      { repository, sessionSecret: 'server-request-test-secret' },
    )

    expect(result).toEqual({
      status: 503,
      body: {
        error: 'service_unavailable',
        message: 'Authentication service is temporarily unavailable',
      },
    })
    expect(JSON.stringify(result)).not.toContain(internalSecret)
  })

  it('does not downgrade an invalid cookie to unsigned development headers', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          cookie: 'devflow_session=invalid.signed-cookie',
          'x-devflow-session-source': 'demo',
          'x-devflow-organization-id': 'org-demo',
          'x-devflow-user-id': projectMemberSession.userId,
          'x-devflow-user-role': 'member',
          'x-devflow-project-roles': 'p-payments:member',
        },
        body: runSummary('run-invalid-cookie-no-downgrade'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
        devAuthEnabled: true,
      },
    )

    expect(result).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('does not downgrade an invalid Authorization header to a valid session cookie', async () => {
    const repository = createSeedTeamRepository()
    const resolveBrowserSession = vi.spyOn(repository, 'resolveBrowserSession')
    const sessionSecret = 'server-request-test-secret'
    const cookie = createSessionCookie(
      { authAccountId: projectMemberSession.authAccountId },
      sessionSecret,
    ).split(';')[0]

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: { authorization: 'Basic invalid-credential', cookie },
        body: runSummary('run-invalid-authorization-no-downgrade'),
      },
      { repository, sessionSecret },
    )

    expect(result).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(resolveBrowserSession).not.toHaveBeenCalled()
  })

  it('rejects a tampered session cookie without exposing the cookie secret', async () => {
    const repository = createSeedTeamRepository()
    const cookieSecret = 'opaque-cookie-private-secret'
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/sync/run-summary',
        headers: {
          cookie: `devflow_session=${cookieSecret}.invalid-signature`,
        },
        body: runSummary('run-tampered-cookie'),
      },
      {
        repository,
        sessionSecret: 'server-request-test-secret',
      },
    )

    expect(result).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(JSON.stringify(result)).not.toContain(cookieSecret)
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('keeps authentication, project access, and project role failures distinct', async () => {
    const sessionSecret = 'server-request-test-secret'
    const unauthenticatedRepository = createSeedTeamRepository()
    const inaccessibleRepository = createSeedTeamRepository()
    const insufficientRoleRepository = createSeedTeamRepository()
    vi.spyOn(inaccessibleRepository, 'resolveBrowserSession').mockResolvedValue(
      authenticatedWithoutProject,
    )
    vi.spyOn(insufficientRoleRepository, 'resolveBrowserSession').mockResolvedValue(
      projectMemberSession,
    )

    const unauthenticated = await resolveApiRouteRequest(
      {
        method: 'DELETE',
        pathname: '/api/runs/run-health-001',
        headers: {},
      },
      { repository: unauthenticatedRepository, sessionSecret },
    )
    const inaccessible = await resolveApiRouteRequest(
      {
        method: 'DELETE',
        pathname: '/api/runs/run-health-001',
        headers: {
          cookie: createSessionCookie(
            { authAccountId: authenticatedWithoutProject.authAccountId },
            sessionSecret,
          ).split(';')[0],
        },
      },
      { repository: inaccessibleRepository, sessionSecret },
    )
    const insufficientRole = await resolveApiRouteRequest(
      {
        method: 'DELETE',
        pathname: '/api/runs/run-health-001',
        headers: {
          cookie: createSessionCookie(
            { authAccountId: projectMemberSession.authAccountId },
            sessionSecret,
          ).split(';')[0],
        },
      },
      { repository: insufficientRoleRepository, sessionSecret },
    )

    expect(unauthenticated).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(inaccessible).toEqual({
      status: 403,
      body: { error: 'forbidden', message: 'Project access required' },
    })
    expect(insufficientRole).toEqual({
      status: 403,
      body: { error: 'forbidden', message: 'Project role lead required' },
    })
  })

  it('passes a live session_cookie principal into Work Request creation', async () => {
    const repository = createWorkRequestAwareRepository()
    const sessionSecret = 'server-request-test-secret'
    const cookie = createSessionCookie(
      { authAccountId: projectMemberSession.authAccountId },
      sessionSecret,
    ).split(';')[0]
    vi.spyOn(repository, 'resolveBrowserSession').mockResolvedValue(
      projectMemberSession,
    )
    const body = {
      projectId: 'p-payments',
      title: 'Prepare rollout',
      request: 'Keep the deployment reversible.',
      idempotencyKey: 'create:api-rollout',
      expiresAt: null,
    }

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: '/api/team/projects/p-payments/work-requests',
        headers: { cookie },
        body,
      },
      { repository, sessionSecret },
    )

    expect(result).toMatchObject({
      status: 201,
      body: { outcomeCode: 'created', replayed: false },
    })
    expect(repository.createWorkRequest).toHaveBeenCalledWith(body, {
      session: projectMemberSession,
      authentication: { kind: 'session_cookie', tokenRecordId: null },
    })
  })

  it('passes bearer token identity and tenant scope into Work Request claim', async () => {
    const repository = createWorkRequestAwareRepository()
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockResolvedValue({
      tokenRecordId: 'desktop-token-record-api',
      session: projectMemberSession,
    })
    const body = {
      workRequestId: openWorkRequest.id,
      expectedVersion: 1,
      runId: 'run-api-rollout',
      idempotencyKey: 'claim:api-rollout',
    }

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: `/api/desktop/work-requests/${openWorkRequest.id}/claim`,
        headers: { authorization: 'Bearer paired-desktop-secret' },
        body,
      },
      { repository, sessionSecret: 'server-request-test-secret' },
    )

    expect(result).toMatchObject({
      status: 200,
      body: { outcomeCode: 'claimed', replayed: false },
    })
    expect(repository.claimWorkRequest).toHaveBeenCalledWith(body, {
      authentication: {
        kind: 'desktop_bearer',
        tokenRecordId: 'desktop-token-record-api',
      },
      session: expect.objectContaining({
        organizationId: 'org-demo',
        userId: projectMemberSession.userId,
        projectMemberships: [
          expect.objectContaining({
            projectId: 'p-payments',
            userId: projectMemberSession.userId,
          }),
        ],
      }),
    })
  })

  it('rejects invalid Work Request authentication without invoking lifecycle methods or reflecting secrets', async () => {
    const repository = createWorkRequestAwareRepository()
    const bearerSecret = 'desktop-token-id.invalid-work-request-secret'
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockResolvedValue(null)

    const result = await resolveApiRouteRequest(
      {
        method: 'POST',
        pathname: `/api/desktop/work-requests/${openWorkRequest.id}/claim`,
        headers: { authorization: `Bearer ${bearerSecret}` },
        body: {
          workRequestId: openWorkRequest.id,
          expectedVersion: 1,
          runId: 'run-api-rollout',
          idempotencyKey: 'claim:invalid-auth',
        },
      },
      { repository, sessionSecret: 'server-request-test-secret' },
    )

    expect(result).toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(repository.claimWorkRequest).not.toHaveBeenCalled()
    expect(repository.materializeWorkRequest).not.toHaveBeenCalled()
    expect(repository.releaseWorkRequest).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(bearerSecret)
  })
})

describe('API HTTP internal error boundary', () => {
  it('returns a fixed 500 response without exposing an internal error message', () => {
    const secret = 'postgres://private-user:private-password@internal-db/devflow'

    const result = createInternalErrorResponse(
      new Error(`database connection failed for ${secret}`),
    )

    expect(result).toEqual({
      status: 500,
      body: {
        error: 'internal_error',
        message: 'Unexpected API error',
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
