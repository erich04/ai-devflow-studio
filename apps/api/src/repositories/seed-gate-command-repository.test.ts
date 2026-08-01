import { describe, expect, it } from 'vitest'
import type {
  CreateGateCommandInput,
  GateCommand,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import { createSeedGateCommandRepository } from './seed-gate-command-repository'

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
    tokenRecordId: 'desktop-token-1',
  },
}

const baseInput: CreateGateCommandInput = {
  projectId: 'project-a',
  runId: 'run-1',
  nodeId: 'gate-1',
  action: 'approve',
  reason: 'Reviewed the current Gate.',
  expectedRunVersion: 3,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [],
  idempotencyKey: 'gate:create:run-1:v3',
}

function createHarness() {
  let currentTime = new Date('2026-08-01T10:00:00.000Z')
  let nextId = 1
  let requesterAuthorized = true
  let preflightUnavailable = false
  const materializedClaims = new Map([
    [
      'org-a:project-a:run-1',
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        workRequestId: 'wr-1',
        runId: 'run-1',
        claimedByTokenId: 'desktop-token-1',
      },
    ],
    [
      'org-a:project-a:run-2',
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        workRequestId: 'wr-2',
        runId: 'run-2',
        claimedByTokenId: 'desktop-token-1',
      },
    ],
  ])
  const repository = createSeedGateCommandRepository({
    now: () => currentTime,
    id: (kind) => `${kind}-${nextId++}`,
    resolveMaterializedWorkRequestClaim: (input) =>
      materializedClaims.get(
        `${input.organizationId}:${input.projectId}:${input.runId}`,
      ) ?? null,
    evaluatePreflight: (input, principal) =>
      preflightUnavailable
        ? {
            ok: false as const,
            outcomeCode: 'authoritative_state_unavailable' as const,
          }
        : {
            ok: true as const,
            requestedRole: principal.session.role,
            workflowCommand:
              input.action === 'reject'
                ? null
                : input.nodeId.startsWith('acceptance')
                  ? 'approve_acceptance' as const
                  : 'approve_gate' as const,
            evaluationBlockerIds: [...input.expectedBlockerIds],
          },
    requesterStillAuthorized: () => requesterAuthorized,
  })

  return {
    repository,
    materializedClaims,
    setRequesterAuthorized(value: boolean) {
      requesterAuthorized = value
    },
    setPreflightUnavailable(value: boolean) {
      preflightUnavailable = value
    },
    setTime(value: string) {
      currentTime = new Date(value)
    },
  }
}

async function createCommand(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<CreateGateCommandInput> = {},
) {
  return harness.repository.createGateCommand(
    { ...baseInput, ...overrides },
    cookiePrincipal,
  )
}

describe('seed Gate Command repository', () => {
  it('creates and lists a bounded pending command only from a signed Cookie', async () => {
    const harness = createHarness()

    const created = await createCommand(harness)

    expect(created).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      command: {
        id: 'gate-command-1',
        version: 1,
        organizationId: 'org-a',
        projectId: 'project-a',
        workRequestId: 'wr-1',
        runId: 'run-1',
        nodeId: 'gate-1',
        action: 'approve',
        workflowCommand: 'approve_gate',
        requestedByUserId: 'user-lead',
        requestedRole: 'lead',
        evaluationStatus: 'allowed',
        evaluationBlockerIds: [],
        status: 'pending',
        outcomeCode: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        expiresAt: '2026-08-01T10:15:00.000Z',
      },
    })
    await expect(
      harness.repository.listGateCommands('project-a', cookiePrincipal),
    ).resolves.toHaveLength(1)
    expect(JSON.stringify(created)).not.toContain('desktop-token-1')

    const developmentHeader = {
      ...cookiePrincipal,
      authentication: {
        kind: 'development_header',
        tokenRecordId: null,
      },
    } satisfies RequestPrincipal
    await expect(
      harness.repository.createGateCommand(
        { ...baseInput, idempotencyKey: 'unsigned-create' },
        developmentHeader,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
    })
  })

  it('replays an exact create and rejects key reuse or a competing active tuple', async () => {
    const harness = createHarness()
    const first = await createCommand(harness)

    await expect(createCommand(harness)).resolves.toEqual({
      ...first,
      replayed: true,
    })
    await expect(
      createCommand(harness, { reason: 'Different fingerprint.' }),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'idempotency_conflict',
    })
    await expect(
      createCommand(harness, {
        action: 'reject',
        reason: 'Do not proceed.',
        idempotencyKey: 'gate:create:competing-reject',
      }),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'active_command_conflict',
    })
  })

  it('lazy-expires an old active tuple before accepting a fresh command', async () => {
    const harness = createHarness()
    const first = await createCommand(harness)
    if (!first.ok) throw new Error('fixture create failed')

    harness.setTime(first.command.expiresAt)
    await expect(
      createCommand(harness, {
        action: 'reject',
        reason: 'The earlier command expired; reassess this Gate.',
        idempotencyKey: 'gate:create:after-expiry',
      }),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'created',
      replayed: false,
      command: { status: 'pending', action: 'reject' },
    })
    expect(harness.repository.inspectForTests().commands).toMatchObject([
      { id: first.command.id, status: 'expired', outcomeCode: 'expired' },
      { status: 'pending', action: 'reject' },
    ])
  })

  it('does not make an authoritative-state outage permanent under the idempotency key', async () => {
    const harness = createHarness()
    harness.setPreflightUnavailable(true)

    await expect(createCommand(harness)).resolves.toMatchObject({
      ok: false,
      responseStatus: 503,
      outcomeCode: 'authoritative_state_unavailable',
      replayed: false,
    })
    expect(harness.repository.inspectForTests().idempotencyRecordCount).toBe(0)

    harness.setPreflightUnavailable(false)
    await expect(createCommand(harness)).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'created',
      replayed: false,
    })
  })

  it('delivers only to the exact materializing token and renews an expired lease once', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')

    const otherToken = {
      ...desktopPrincipal,
      authentication: {
        kind: 'desktop_bearer',
        tokenRecordId: 'desktop-token-2',
      },
    } satisfies RequestPrincipal
    await expect(
      harness.repository.listGateCommandInbox('project-a', otherToken),
    ).resolves.toEqual([])
    await expect(
      harness.repository.createGateCommandReceipt(created.command.id, otherToken),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'claimant_forbidden',
    })

    await expect(
      harness.repository.listGateCommandInbox('project-a', desktopPrincipal),
    ).resolves.toEqual([created.command])
    const firstReceipt = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    expect(firstReceipt).toMatchObject({
      ok: true,
      replayed: false,
      command: { version: 2, status: 'delivering' },
      receipt: {
        id: 'gate-receipt-2',
        attempt: 1,
        leasedAt: '2026-08-01T10:00:00.000Z',
        leaseExpiresAt: '2026-08-01T10:01:00.000Z',
      },
    })
    await expect(
      harness.repository.createGateCommandReceipt(
        created.command.id,
        desktopPrincipal,
      ),
    ).resolves.toEqual({ ...firstReceipt, replayed: true })

    harness.setTime('2026-08-01T10:01:01.000Z')
    await expect(
      harness.repository.createGateCommandReceipt(
        created.command.id,
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      command: { version: 2, status: 'delivering' },
      receipt: { attempt: 2 },
    })
  })

  it('terminally removes a command from delivery when its requester is revoked or it expires', async () => {
    const revokedHarness = createHarness()
    const revoked = await createCommand(revokedHarness)
    if (!revoked.ok) throw new Error('fixture create failed')
    revokedHarness.setRequesterAuthorized(false)

    await expect(
      revokedHarness.repository.listGateCommandInbox(
        'project-a',
        desktopPrincipal,
      ),
    ).resolves.toEqual([])
    await expect(
      revokedHarness.repository.listGateCommands('project-a', cookiePrincipal),
    ).resolves.toMatchObject([
      {
        version: 2,
        status: 'rejected',
        outcomeCode: 'requester_revoked',
      },
    ])

    const expiredHarness = createHarness()
    await createCommand(expiredHarness)
    expiredHarness.setTime('2026-08-01T10:15:00.000Z')
    await expect(
      expiredHarness.repository.listGateCommandInbox(
        'project-a',
        desktopPrincipal,
      ),
    ).resolves.toEqual([])
    await expect(
      expiredHarness.repository.listGateCommands('project-a', cookiePrincipal),
    ).resolves.toMatchObject([
      { version: 2, status: 'expired', outcomeCode: 'expired' },
    ])
  })

  it('records one exact acknowledgement without advancing a Team Run projection', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:00:30.000Z')
    const acknowledgementInput = {
      commandId: created.command.id,
      outcomeCode: 'applied' as const,
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: '2026-08-01T10:00:20.000Z',
    }
    const acknowledged = await harness.repository.acknowledgeGateCommand(
      delivered.receipt.id,
      acknowledgementInput,
      desktopPrincipal,
    )
    expect(acknowledged).toMatchObject({
      ok: true,
      replayed: false,
      command: {
        version: 3,
        status: 'applied',
        outcomeCode: 'applied',
        expectedRunVersion: 3,
      },
      receipt: { acknowledgedAt: '2026-08-01T10:00:30.000Z' },
      acknowledgement: {
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      },
    })
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        acknowledgementInput,
        desktopPrincipal,
      ),
    ).resolves.toEqual({ ...acknowledged, replayed: true })
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          ...acknowledgementInput,
          outcomeCode: 'stale_run',
          afterRunVersion: 3,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
  })

  it('accepts a bounded fast-client evaluation inside the server-issued receipt lease', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:00:10.000Z')
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          commandId: created.command.id,
          outcomeCode: 'applied',
          beforeRunVersion: 3,
          afterRunVersion: 4,
          evaluatedAt: '2026-08-01T10:00:40.000Z',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'acknowledged',
      acknowledgement: {
        evaluatedAt: '2026-08-01T10:00:40.000Z',
      },
    })
  })

  it('does not let bounded client clock skew declare a command expired early', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    harness.setTime('2026-08-01T10:14:30.000Z')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:14:40.000Z')
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          commandId: created.command.id,
          outcomeCode: 'expired',
          beforeRunVersion: 3,
          afterRunVersion: 3,
          evaluatedAt: created.command.expiresAt,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
  })

  it('rejects an acknowledgement prepared from a different Run version', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:00:30.000Z')
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          commandId: created.command.id,
          outcomeCode: 'applied',
          beforeRunVersion: 8,
          afterRunVersion: 9,
          evaluatedAt: '2026-08-01T10:00:20.000Z',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
    expect(harness.repository.inspectForTests()).toMatchObject({
      commands: [{ status: 'delivering', outcomeCode: null }],
      acknowledgements: [],
    })
  })

  it('accepts stale_run with the actual unchanged local Run version', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:00:30.000Z')
    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          commandId: created.command.id,
          outcomeCode: 'stale_run',
          beforeRunVersion: 4,
          afterRunVersion: 4,
          evaluatedAt: '2026-08-01T10:00:20.000Z',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      command: { status: 'rejected', outcomeCode: 'stale_run' },
      acknowledgement: { beforeRunVersion: 4, afterRunVersion: 4 },
    })
  })

  it('rejects a non-expired result evaluated exactly at the lease deadline', async () => {
    const harness = createHarness()
    const created = await createCommand(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')
    harness.setTime(delivered.receipt.leaseExpiresAt)

    await expect(
      harness.repository.acknowledgeGateCommand(
        delivered.receipt.id,
        {
          commandId: created.command.id,
          outcomeCode: 'applied',
          beforeRunVersion: 3,
          afterRunVersion: 4,
          evaluatedAt: delivered.receipt.leaseExpiresAt,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'acknowledgement_conflict',
    })
  })

  it('treats a human reject as an applied intent while keeping Run versions equal', async () => {
    const harness = createHarness()
    const created = await createCommand(harness, {
      runId: 'run-2',
      nodeId: 'acceptance-2',
      action: 'reject',
      expectedRunVersion: 8,
      reason: 'Acceptance criteria are not met.',
      idempotencyKey: 'gate:create:run-2:reject:v8',
    })
    if (!created.ok) throw new Error('fixture create failed')
    const delivered = await harness.repository.createGateCommandReceipt(
      created.command.id,
      desktopPrincipal,
    )
    if (!delivered.ok) throw new Error('fixture delivery failed')

    harness.setTime('2026-08-01T10:00:30.000Z')
    const result = await harness.repository.acknowledgeGateCommand(
      delivered.receipt.id,
      {
        commandId: created.command.id,
        outcomeCode: 'human_rejected',
        beforeRunVersion: 8,
        afterRunVersion: 8,
        evaluatedAt: '2026-08-01T10:00:20.000Z',
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      command: { status: 'applied', outcomeCode: 'human_rejected' },
      acknowledgement: { beforeRunVersion: 8, afterRunVersion: 8 },
    })
  })
})
