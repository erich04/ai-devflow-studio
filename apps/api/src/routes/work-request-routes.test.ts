import { describe, expect, it, vi } from 'vitest'
import type { WorkRequest } from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type {
  WorkRequestMutationResult,
  WorkRequestRejectionCode,
  WorkRequestRepository,
} from '../repositories/work-request-contract'
import { resolveWorkRequestRoute } from './work-request-routes'

const openWorkRequest: WorkRequest = {
  id: 'wr-rollout',
  organizationId: 'org-demo',
  projectId: 'p-payments',
  title: 'Prepare rollout',
  request: 'Keep the rollout reversible.',
  version: 1,
  status: 'open',
  createdByUserId: 'u-yu',
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const claimedWorkRequest: WorkRequest = {
  ...openWorkRequest,
  version: 2,
  status: 'claim_pending',
  claim: {
    runId: 'run-rollout',
    claimedAt: '2026-08-01T00:01:00.000Z',
    materializedAt: null,
  },
  updatedAt: '2026-08-01T00:01:00.000Z',
}

const materializedWorkRequest: WorkRequest = {
  ...claimedWorkRequest,
  version: 3,
  status: 'materialized',
  claim: {
    ...claimedWorkRequest.claim!,
    materializedAt: '2026-08-01T00:02:00.000Z',
  },
  updatedAt: '2026-08-01T00:02:00.000Z',
}

const releasedWorkRequest: WorkRequest = {
  ...openWorkRequest,
  version: 3,
  updatedAt: '2026-08-01T00:02:00.000Z',
}

function principal(
  authentication: RequestPrincipal['authentication'],
  role: 'owner' | 'lead' | 'member' = 'member',
  projectRole: 'owner' | 'lead' | 'member' | null = 'member',
): RequestPrincipal {
  return {
    authentication,
    session: {
      source: 'authenticated',
      organizationId: 'org-demo',
      userId: role === 'owner' ? 'u-owner' : role === 'lead' ? 'u-lead' : 'u-yu',
      role,
      authAccountId: `acct-${role}`,
      projectMemberships:
        projectRole === null
          ? []
          : [
              {
                projectId: 'p-payments',
                userId: role === 'owner' ? 'u-owner' : role === 'lead' ? 'u-lead' : 'u-yu',
                role: projectRole,
              },
            ],
    },
  }
}

const cookieMember = principal({ kind: 'session_cookie', tokenRecordId: null })
const bearerMember = principal({ kind: 'desktop_bearer', tokenRecordId: 'token-1' })
const cookieLead = principal(
  { kind: 'session_cookie', tokenRecordId: null },
  'lead',
  'lead',
)
const developmentOwner = principal(
  { kind: 'development_header', tokenRecordId: null },
  'owner',
  null,
)

function success(
  outcomeCode: 'created' | 'claimed' | 'materialized' | 'released',
  workRequest: WorkRequest,
  replayed = false,
): WorkRequestMutationResult {
  return {
    ok: true,
    responseStatus: outcomeCode === 'created' ? 201 : 200,
    outcomeCode,
    replayed,
    workRequest,
  }
}

function rejection(
  outcomeCode: WorkRequestRejectionCode,
  replayed = false,
): WorkRequestMutationResult {
  const responseStatus =
    outcomeCode === 'authentication_forbidden' ||
    outcomeCode === 'project_forbidden' ||
    outcomeCode === 'claimant_forbidden'
      ? 403
      : outcomeCode === 'not_found'
        ? 404
        : outcomeCode === 'expired'
          ? 410
          : 409

  return {
    ok: false,
    responseStatus,
    outcomeCode,
    replayed,
  }
}

function createRepository(): WorkRequestRepository {
  return {
    listWorkRequests: vi.fn(async () => [openWorkRequest]),
    createWorkRequest: vi.fn(async () => success('created', openWorkRequest)),
    claimWorkRequest: vi.fn(async () => success('claimed', claimedWorkRequest)),
    materializeWorkRequest: vi.fn(async () =>
      success('materialized', materializedWorkRequest),
    ),
    releaseWorkRequest: vi.fn(async () => success('released', releasedWorkRequest)),
  }
}

describe('Work Request routes', () => {
  it('returns null for paths and methods outside the Work Request surface', async () => {
    const repository = createRepository()

    await expect(
      resolveWorkRequestRoute('GET', '/api/team/projects/p-payments', repository, {
        principal: cookieMember,
      }),
    ).resolves.toBeNull()
    await expect(
      resolveWorkRequestRoute(
        'DELETE',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { principal: cookieMember },
      ),
    ).resolves.toBeNull()
  })

  it('requires authentication before parsing a recognized route', async () => {
    const repository = createRepository()

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { body: { secret: 'must-not-be-reflected' }, principal: null },
      ),
    ).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
    expect(repository.createWorkRequest).not.toHaveBeenCalled()
  })

  it('lists only strict records for an accessible project', async () => {
    const repository = createRepository()

    await expect(
      resolveWorkRequestRoute(
        'GET',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { principal: bearerMember },
      ),
    ).resolves.toEqual({
      status: 200,
      body: { workRequests: [openWorkRequest] },
    })
    expect(repository.listWorkRequests).toHaveBeenCalledWith('p-payments', bearerMember)
  })

  it('denies inaccessible list and create project scopes before repository access', async () => {
    const repository = createRepository()
    const noProjectAccess = principal(
      { kind: 'session_cookie', tokenRecordId: null },
      'member',
      null,
    )

    for (const [method, body] of [
      ['GET', undefined],
      [
        'POST',
        {
          projectId: 'p-payments',
          title: 'Prepare rollout',
          request: 'Keep the rollout reversible.',
          idempotencyKey: 'create:rollout',
          expiresAt: null,
        },
      ],
    ] as const) {
      await expect(
        resolveWorkRequestRoute(
          method,
          '/api/team/projects/p-payments/work-requests',
          repository,
          { body, principal: noProjectAccess },
        ),
      ).resolves.toEqual({
        status: 403,
        body: { error: 'forbidden', message: 'Project access required.' },
      })
    }

    expect(repository.listWorkRequests).not.toHaveBeenCalled()
    expect(repository.createWorkRequest).not.toHaveBeenCalled()
  })

  it('allows create only for cookie or development authentication', async () => {
    const repository = createRepository()
    const body = {
      projectId: 'p-payments',
      title: 'Prepare rollout',
      request: 'Keep the rollout reversible.',
      idempotencyKey: 'create:rollout',
      expiresAt: null,
    }

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { body, principal: bearerMember },
      ),
    ).resolves.toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'This authentication method cannot perform that Work Request operation.',
      },
    })
    expect(repository.createWorkRequest).not.toHaveBeenCalled()

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { body, principal: developmentOwner },
      ),
    ).resolves.toEqual({
      status: 201,
      body: { workRequest: openWorkRequest, replayed: false, outcomeCode: 'created' },
    })
  })

  it('strictly parses create input and requires an exact path project match', async () => {
    const repository = createRepository()
    const validBody = {
      projectId: 'p-payments',
      title: 'Prepare rollout',
      request: 'Keep the rollout reversible.',
      idempotencyKey: 'create:rollout',
      expiresAt: null,
    }

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-admin/work-requests',
        repository,
        { body: validBody, principal: developmentOwner },
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Work Request projectId must match route projectId.',
      },
    })
    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { body: { ...validBody, unexpected: true }, principal: cookieMember },
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid Work Request create input.',
      },
    })
    expect(repository.createWorkRequest).not.toHaveBeenCalled()
  })

  it('allows claim and materialize only for paired desktop bearer authentication', async () => {
    const repository = createRepository()
    const claimBody = {
      workRequestId: 'wr-rollout',
      expectedVersion: 1,
      runId: 'run-rollout',
      idempotencyKey: 'claim:rollout',
    }

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/claim',
        repository,
        { body: claimBody, principal: cookieMember },
      ),
    ).resolves.toEqual({
      status: 403,
      body: {
        error: 'forbidden',
        message: 'This authentication method cannot perform that Work Request operation.',
      },
    })
    expect(repository.claimWorkRequest).not.toHaveBeenCalled()

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/claim',
        repository,
        { body: claimBody, principal: bearerMember },
      ),
    ).resolves.toEqual({
      status: 200,
      body: { workRequest: claimedWorkRequest, replayed: false, outcomeCode: 'claimed' },
    })

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/materialized',
        repository,
        {
          body: {
            ...claimBody,
            expectedVersion: 2,
            idempotencyKey: 'materialized:rollout',
          },
          principal: bearerMember,
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        workRequest: materializedWorkRequest,
        replayed: false,
        outcomeCode: 'materialized',
      },
    })
  })

  it('strictly parses run mutations and requires an exact path id match', async () => {
    const repository = createRepository()
    const body = {
      workRequestId: 'wr-other',
      expectedVersion: 1,
      runId: 'run-rollout',
      idempotencyKey: 'claim:rollout',
    }

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/claim',
        repository,
        { body, principal: bearerMember },
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Work Request workRequestId must match route id.',
      },
    })
    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/materialized',
        repository,
        { body: { ...body, extra: 'secret' }, principal: bearerMember },
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid Work Request materialize input.',
      },
    })
    expect(repository.claimWorkRequest).not.toHaveBeenCalled()
    expect(repository.materializeWorkRequest).not.toHaveBeenCalled()
  })

  it('allows release only for cookie/development principals with possible lead authority', async () => {
    const repository = createRepository()
    const body = {
      workRequestId: 'wr-rollout',
      expectedVersion: 2,
      idempotencyKey: 'release:rollout',
    }

    for (const deniedPrincipal of [bearerMember, cookieMember]) {
      await expect(
        resolveWorkRequestRoute(
          'POST',
          '/api/team/work-requests/wr-rollout/release',
          repository,
          { body, principal: deniedPrincipal },
        ),
      ).resolves.toEqual({
        status: 403,
        body: {
          error: 'forbidden',
          message:
            deniedPrincipal.authentication.kind === 'desktop_bearer'
              ? 'This authentication method cannot perform that Work Request operation.'
              : 'Project role lead required.',
        },
      })
    }
    expect(repository.releaseWorkRequest).not.toHaveBeenCalled()

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/work-requests/wr-rollout/release',
        repository,
        { body, principal: cookieLead },
      ),
    ).resolves.toEqual({
      status: 200,
      body: { workRequest: releasedWorkRequest, replayed: false, outcomeCode: 'released' },
    })
  })

  it.each([
    ['authentication_forbidden', 403, 'forbidden'],
    ['project_forbidden', 403, 'forbidden'],
    ['claimant_forbidden', 403, 'forbidden'],
    ['not_found', 404, 'not_found'],
    ['idempotency_conflict', 409, 'conflict'],
    ['stale_version', 409, 'conflict'],
    ['claim_conflict', 409, 'conflict'],
    ['not_claim_pending', 409, 'conflict'],
    ['canonical_projection_exists', 409, 'conflict'],
    ['expired', 410, 'gone'],
  ] as const)(
    'maps %s to a fixed safe rejection response',
    async (outcomeCode, status, errorCode) => {
      const repository = createRepository()
      repository.claimWorkRequest = vi.fn(async () => rejection(outcomeCode, true))

      const result = await resolveWorkRequestRoute(
        'POST',
        '/api/desktop/work-requests/wr-rollout/claim',
        repository,
        {
          body: {
            workRequestId: 'wr-rollout',
            expectedVersion: 1,
            runId: 'run-rollout',
            idempotencyKey: 'claim:rollout',
          },
          principal: bearerMember,
        },
      )

      expect(result).toMatchObject({
        status,
        body: { error: errorCode, outcomeCode, replayed: true },
      })
      expect(JSON.stringify(result)).not.toContain('token-1')
    },
  )

  it('fails closed when a repository record carries fields outside the shared contract', async () => {
    const repository = createRepository()
    repository.createWorkRequest = vi.fn(async () =>
      success('created', {
        ...openWorkRequest,
        tokenHash: 'must-not-cross-boundary',
      } as WorkRequest),
    )

    await expect(
      resolveWorkRequestRoute(
        'POST',
        '/api/team/projects/p-payments/work-requests',
        repository,
        {
          body: {
            projectId: 'p-payments',
            title: 'Prepare rollout',
            request: 'Keep the rollout reversible.',
            idempotencyKey: 'create:rollout',
            expiresAt: null,
          },
          principal: cookieMember,
        },
      ),
    ).rejects.toThrow('Invalid Work Request record.')
  })

  it('fails closed on cross-project or cross-organization repository output', async () => {
    const repository = createRepository()
    repository.listWorkRequests = vi.fn(async () => [
      { ...openWorkRequest, organizationId: 'org-other' },
    ])

    await expect(
      resolveWorkRequestRoute(
        'GET',
        '/api/team/projects/p-payments/work-requests',
        repository,
        { principal: cookieMember },
      ),
    ).rejects.toThrow('Work Request repository returned an out-of-scope record.')
  })
})
