import { describe, expect, it, vi } from 'vitest'
import type {
  GateCommand,
  GateCommandAcknowledgement,
  GateCommandReceipt,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  GateCommandAuthoritativeStateUnavailableError,
  type GateCommandRepository,
} from '../repositories/gate-command-contract'
import { resolveGateCommandRoute } from './gate-command-routes'

const cookiePrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-lead',
    organizationId: 'org-a',
    userId: 'user-lead',
    role: 'lead',
    projectMemberships: [
      { projectId: 'project-a', userId: 'user-lead', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

const desktopPrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop',
    organizationId: 'org-a',
    userId: 'user-desktop',
    role: 'member',
    projectMemberships: [
      { projectId: 'project-a', userId: 'user-desktop', role: 'member' },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-record-1',
  },
}

function command(overrides: Partial<GateCommand> = {}): GateCommand {
  return {
    id: 'gate-command-1',
    version: 1,
    organizationId: 'org-a',
    projectId: 'project-a',
    workRequestId: 'wr-1',
    runId: 'run-1',
    nodeId: 'gate-1',
    action: 'approve',
    workflowCommand: 'approve_gate',
    reason: 'Reviewed current projection.',
    requestedByUserId: 'user-lead',
    requestedRole: 'lead',
    idempotencyKey: 'gate:create:run-1:v3',
    requestFingerprint: 'a'.repeat(64),
    expectedRunVersion: 3,
    expectedPolicyVersion: 2,
    expectedBlockerIds: [],
    evaluationStatus: 'allowed',
    evaluationBlockerIds: [],
    evaluatedAt: '2026-08-01T10:00:00.000Z',
    status: 'pending',
    outcomeCode: null,
    expiresAt: '2026-08-01T10:15:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function receipt(overrides: Partial<GateCommandReceipt> = {}): GateCommandReceipt {
  return {
    id: 'gate-receipt-1',
    commandId: 'gate-command-1',
    attempt: 1,
    leasedAt: '2026-08-01T10:01:00.000Z',
    leaseExpiresAt: '2026-08-01T10:02:00.000Z',
    acknowledgedAt: null,
    ...overrides,
  }
}

function acknowledgement(
  overrides: Partial<GateCommandAcknowledgement> = {},
): GateCommandAcknowledgement {
  return {
    id: 'gate-ack-1',
    commandId: 'gate-command-1',
    receiptId: 'gate-receipt-1',
    outcomeCode: 'applied',
    beforeRunVersion: 3,
    afterRunVersion: 4,
    evaluatedAt: '2026-08-01T10:01:20.000Z',
    createdAt: '2026-08-01T10:01:21.000Z',
    ...overrides,
  }
}

function createRepository(
  overrides: Partial<GateCommandRepository> = {},
): GateCommandRepository {
  return {
    listGateCommands: vi.fn(async () => [command()]),
    createGateCommand: vi.fn<GateCommandRepository['createGateCommand']>(async () => ({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      command: command(),
    })),
    listGateCommandInbox: vi.fn(async () => [command()]),
    createGateCommandReceipt: vi.fn<
      GateCommandRepository['createGateCommandReceipt']
    >(async () => ({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'receipt_created',
      replayed: false,
      command: command({ version: 2, status: 'delivering' }),
      receipt: receipt(),
    })),
    acknowledgeGateCommand: vi.fn<
      GateCommandRepository['acknowledgeGateCommand']
    >(async () => ({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'acknowledged',
      replayed: false,
      command: command({
        version: 3,
        status: 'applied',
        outcomeCode: 'applied',
        updatedAt: '2026-08-01T10:01:21.000Z',
      }),
      receipt: receipt({ acknowledgedAt: '2026-08-01T10:01:21.000Z' }),
      acknowledgement: acknowledgement(),
    })),
    ...overrides,
  }
}

const createBody = {
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

describe('Gate Command routes', () => {
  it('creates and lists commands only through a signed browser Cookie', async () => {
    const repository = createRepository()

    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/team/projects/project-a/gate-commands',
        repository,
        { principal: cookiePrincipal, body: createBody },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        command: command(),
        outcomeCode: 'created',
        replayed: false,
      },
    })
    await expect(
      resolveGateCommandRoute(
        'GET',
        '/api/team/projects/project-a/gate-commands',
        repository,
        { principal: cookiePrincipal },
      ),
    ).resolves.toEqual({ status: 200, body: { commands: [command()] } })

    const unsigned = {
      ...cookiePrincipal,
      authentication: {
        kind: 'development_header',
        tokenRecordId: null,
      },
    } satisfies RequestPrincipal
    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/team/projects/project-a/gate-commands',
        repository,
        { principal: unsigned, body: createBody },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'authentication_forbidden' },
    })
  })

  it('rejects unknown create fields and a route/body project mismatch', async () => {
    const repository = createRepository()

    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/team/projects/project-a/gate-commands',
        repository,
        {
          principal: cookiePrincipal,
          body: { ...createBody, requestedRole: 'owner' },
        },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: 'bad_request' } })
    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/team/projects/project-a/gate-commands',
        repository,
        {
          principal: cookiePrincipal,
          body: { ...createBody, projectId: 'project-other' },
        },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: 'bad_request' } })
  })

  it('returns the inbox and grants receipts only to Desktop Bearer auth', async () => {
    const repository = createRepository()

    await expect(
      resolveGateCommandRoute(
        'GET',
        '/api/desktop/projects/project-a/gate-commands/inbox',
        repository,
        { principal: desktopPrincipal },
      ),
    ).resolves.toEqual({ status: 200, body: { commands: [command()] } })
    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/desktop/gate-commands/gate-command-1/receipts',
        repository,
        { principal: desktopPrincipal, body: {} },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        command: command({ version: 2, status: 'delivering' }),
        receipt: receipt(),
        outcomeCode: 'receipt_created',
        replayed: false,
      },
    })
    await expect(
      resolveGateCommandRoute(
        'GET',
        '/api/desktop/projects/project-a/gate-commands/inbox',
        repository,
        { principal: cookiePrincipal },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'authentication_forbidden' },
    })
  })

  it('accepts only strict acknowledgement input bound to the route receipt', async () => {
    const repository = createRepository()
    const body = {
      commandId: 'gate-command-1',
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T10:01:20.000Z',
    }

    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/desktop/gate-command-receipts/gate-receipt-1/acknowledgements',
        repository,
        { principal: desktopPrincipal, body },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        command: command({
          version: 3,
          status: 'applied',
          outcomeCode: 'applied',
          updatedAt: '2026-08-01T10:01:21.000Z',
        }),
        receipt: receipt({ acknowledgedAt: '2026-08-01T10:01:21.000Z' }),
        acknowledgement: acknowledgement(),
        outcomeCode: 'acknowledged',
        replayed: false,
      },
    })
    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/desktop/gate-command-receipts/gate-receipt-1/acknowledgements',
        repository,
        { principal: desktopPrincipal, body: { ...body, runStatus: 'completed' } },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: 'bad_request' } })
  })

  it('maps repository rejections to fixed API categories', async () => {
    const repository = createRepository({
      createGateCommand: vi.fn<GateCommandRepository['createGateCommand']>(async () => ({
        ok: false,
        responseStatus: 409,
        outcomeCode: 'stale_run',
        replayed: false,
      })),
    })

    await expect(
      resolveGateCommandRoute(
        'POST',
        '/api/team/projects/project-a/gate-commands',
        repository,
        { principal: cookiePrincipal, body: createBody },
      ),
    ).resolves.toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message:
          'The Team Run projection changed; refresh before submitting another command.',
        outcomeCode: 'stale_run',
        replayed: false,
      },
    })
  })

  it('throws if a repository attempts to return a cross-tenant record', async () => {
    const repository = createRepository({
      listGateCommands: vi.fn(async () => [
        command({ organizationId: 'org-other' }),
      ]),
    })

    await expect(
      resolveGateCommandRoute(
        'GET',
        '/api/team/projects/project-a/gate-commands',
        repository,
        { principal: cookiePrincipal },
      ),
    ).rejects.toThrow('out-of-scope Gate Command')
  })

  it.each([
    {
      name: 'browser command list',
      method: 'GET',
      pathname: '/api/team/projects/project-a/gate-commands',
      principal: cookiePrincipal,
      repository: createRepository({
        listGateCommands: vi.fn(async () => {
          throw new GateCommandAuthoritativeStateUnavailableError()
        }),
      }),
    },
    {
      name: 'Desktop command inbox',
      method: 'GET',
      pathname: '/api/desktop/projects/project-a/gate-commands/inbox',
      principal: desktopPrincipal,
      repository: createRepository({
        listGateCommandInbox: vi.fn(async () => {
          throw new GateCommandAuthoritativeStateUnavailableError()
        }),
      }),
    },
  ])('maps a typed authoritative outage for the $name to 503', async ({
    method,
    pathname,
    principal,
    repository,
  }) => {
    await expect(
      resolveGateCommandRoute(method, pathname, repository, { principal }),
    ).resolves.toEqual({
      status: 503,
      body: {
        error: 'service_unavailable',
        message:
          'Authoritative project or policy state is temporarily unavailable.',
        outcomeCode: 'authoritative_state_unavailable',
        replayed: false,
      },
    })
  })
})
