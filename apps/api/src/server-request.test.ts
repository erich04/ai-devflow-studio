import { describe, expect, it, vi } from 'vitest'
import type { TeamSession } from '@ai-devflow/shared'
import { createSessionCookie } from './auth/session-cookie'
import { createSeedTeamRepository } from './repositories/team-repository'
import { createCorsPreflightHeaders, resolveApiRouteRequest } from './server-request'

const projectMemberSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-api-member',
  role: 'member',
  authAccountId: 'acct-api-member',
  projectMemberships: [
    { projectId: 'p-payments', userId: 'u-api-member', role: 'member' },
  ],
}

function runSummary(runId: string) {
  return {
    kind: 'run' as const,
    runId,
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
    vi.spyOn(repository, 'resolveDesktopTokenSession').mockResolvedValue(projectMemberSession)
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

  it('accepts a direct run-summary POST authenticated with a signed session cookie', async () => {
    const repository = createSeedTeamRepository()
    const uploadRunSummary = vi.spyOn(repository, 'uploadRunSummary')
    const sessionSecret = 'server-request-test-secret'
    const cookie = createSessionCookie(projectMemberSession, sessionSecret).split(';')[0]

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
})
