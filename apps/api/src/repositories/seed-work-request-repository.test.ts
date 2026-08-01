import { describe, expect, it } from 'vitest'
import type { RequestPrincipal } from '../auth/request-auth'
import { createSeedWorkRequestRepository } from './seed-work-request-repository'

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

function createHarness() {
  let currentTime = new Date('2026-08-01T10:00:00.000Z')
  let nextId = 1
  const canonicalRuns = new Set<string>()
  const repository = createSeedWorkRequestRepository({
    projectExists: (organizationId, projectId) =>
      organizationId === 'org-a' && projectId === 'project-a',
    canonicalProjectionExists: (runId, organizationId, projectId) =>
      canonicalRuns.has(`${organizationId}:${projectId}:${runId}`),
    now: () => currentTime,
    id: () => `wr-${nextId++}`,
  })

  return {
    repository,
    canonicalRuns,
    setTime(value: string) {
      currentTime = new Date(value)
    },
  }
}

async function createOpenRequest(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<{
    idempotencyKey: string
    expiresAt: string | null
    title: string
    request: string
  }> = {},
) {
  return harness.repository.createWorkRequest(
    {
      projectId: 'project-a',
      title: overrides.title ?? 'Prepare reversible rollout',
      request: overrides.request ?? 'Keep the deployment reversible.',
      idempotencyKey: overrides.idempotencyKey ?? 'create-1',
      expiresAt: overrides.expiresAt ?? null,
    },
    cookiePrincipal,
  )
}

describe('seed Work Request repository', () => {
  it('creates a project-scoped open request and lists only authorized tenant data', async () => {
    const harness = createHarness()

    const created = await createOpenRequest(harness)

    expect(created).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
      replayed: false,
      workRequest: {
        id: 'wr-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        version: 1,
        status: 'open',
        claim: null,
        createdByUserId: 'user-lead',
      },
    })
    await expect(
      harness.repository.listWorkRequests('project-a', cookiePrincipal),
    ).resolves.toHaveLength(1)

    const otherOrganization = {
      ...cookiePrincipal,
      session: {
        ...cookiePrincipal.session,
        organizationId: 'org-b',
      },
    } satisfies RequestPrincipal
    await expect(
      harness.repository.listWorkRequests('project-a', otherOrganization),
    ).resolves.toEqual([])

    const unboundOwnerToken = {
      ...desktopPrincipal,
      session: {
        ...desktopPrincipal.session,
        role: 'owner',
        projectMemberships: [],
      },
    } satisfies RequestPrincipal
    await expect(
      harness.repository.listWorkRequests('project-a', unboundOwnerToken),
    ).resolves.toEqual([])

    const inaccessibleProject = await harness.repository.createWorkRequest(
      {
        projectId: 'project-missing',
        title: 'Hidden',
        request: 'Must not cross tenant scope.',
        idempotencyKey: 'create-missing',
        expiresAt: null,
      },
      cookiePrincipal,
    )
    expect(inaccessibleProject).toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'project_forbidden',
    })
  })

  it('enforces authentication modes for browser and desktop mutations', async () => {
    const harness = createHarness()

    const desktopCreate = await harness.repository.createWorkRequest(
      {
        projectId: 'project-a',
        title: 'Disallowed create',
        request: 'Desktop tokens cannot author requests.',
        idempotencyKey: 'desktop-create',
        expiresAt: null,
      },
      desktopPrincipal,
    )
    expect(desktopCreate).toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
    })

    const created = await createOpenRequest(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const browserClaim = await harness.repository.claimWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        runId: 'run-1',
        idempotencyKey: 'browser-claim',
      },
      cookiePrincipal,
    )
    expect(browserClaim).toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'authentication_forbidden',
    })
  })

  it('moves open v1 to claim_pending v2 and materialized v3 for the same claimant and run', async () => {
    const harness = createHarness()
    const created = await createOpenRequest(harness)
    if (!created.ok) throw new Error('fixture create failed')

    harness.setTime('2026-08-01T10:01:00.000Z')
    const claimed = await harness.repository.claimWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        runId: 'run-1',
        idempotencyKey: 'claim-1',
      },
      desktopPrincipal,
    )
    expect(claimed).toMatchObject({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'claimed',
      workRequest: {
        version: 2,
        status: 'claim_pending',
        claim: {
          runId: 'run-1',
          claimedAt: '2026-08-01T10:01:00.000Z',
          materializedAt: null,
        },
      },
    })
    expect(harness.repository.inspectForTests().internalRecords[0]).toMatchObject({
      claimedByTokenId: 'desktop-token-record-1',
    })

    const otherDesktop = {
      ...desktopPrincipal,
      authentication: {
        kind: 'desktop_bearer',
        tokenRecordId: 'desktop-token-record-2',
      },
    } satisfies RequestPrincipal
    const wrongClaimant = await harness.repository.materializeWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 2,
        runId: 'run-1',
        idempotencyKey: 'materialize-wrong-client',
      },
      otherDesktop,
    )
    expect(wrongClaimant).toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'claimant_forbidden',
    })

    harness.setTime('2026-08-01T10:02:00.000Z')
    const materialized = await harness.repository.materializeWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 2,
        runId: 'run-1',
        idempotencyKey: 'materialize-1',
      },
      desktopPrincipal,
    )
    expect(materialized).toMatchObject({
      ok: true,
      outcomeCode: 'materialized',
      workRequest: {
        version: 3,
        status: 'materialized',
        claim: {
          runId: 'run-1',
          materializedAt: '2026-08-01T10:02:00.000Z',
        },
      },
    })
  })

  it('expires an unclaimed request but keeps a claim durable after its deadline', async () => {
    const harness = createHarness()
    const expiring = await createOpenRequest(harness, {
      idempotencyKey: 'create-expiring',
      expiresAt: '2026-08-01T10:05:00.000Z',
    })
    if (!expiring.ok) throw new Error('fixture create failed')

    harness.setTime('2026-08-01T10:05:00.000Z')
    const expiredClaim = await harness.repository.claimWorkRequest(
      {
        workRequestId: expiring.workRequest.id,
        expectedVersion: 1,
        runId: 'run-expired',
        idempotencyKey: 'claim-expired',
      },
      desktopPrincipal,
    )
    expect(expiredClaim).toMatchObject({
      ok: false,
      responseStatus: 410,
      outcomeCode: 'expired',
    })
    await expect(
      harness.repository.listWorkRequests('project-a', cookiePrincipal),
    ).resolves.toContainEqual(
      expect.objectContaining({
        id: expiring.workRequest.id,
        status: 'expired',
        version: 2,
      }),
    )

    harness.setTime('2026-08-01T10:06:00.000Z')
    const durable = await createOpenRequest(harness, {
      idempotencyKey: 'create-durable',
      expiresAt: '2026-08-01T10:10:00.000Z',
    })
    if (!durable.ok) throw new Error('fixture create failed')
    const claimed = await harness.repository.claimWorkRequest(
      {
        workRequestId: durable.workRequest.id,
        expectedVersion: 1,
        runId: 'run-durable',
        idempotencyKey: 'claim-durable',
      },
      desktopPrincipal,
    )
    if (!claimed.ok) throw new Error('fixture claim failed')

    harness.setTime('2026-08-01T11:00:00.000Z')
    const materialized = await harness.repository.materializeWorkRequest(
      {
        workRequestId: durable.workRequest.id,
        expectedVersion: 2,
        runId: 'run-durable',
        idempotencyKey: 'materialize-durable',
      },
      desktopPrincipal,
    )
    expect(materialized).toMatchObject({
      ok: true,
      outcomeCode: 'materialized',
      workRequest: { status: 'materialized', version: 3 },
    })
  })

  it('audits an expiry caused by listing once without creating idempotency state', async () => {
    const harness = createHarness()
    const created = await createOpenRequest(harness, {
      idempotencyKey: 'create-list-expiry',
      expiresAt: '2026-08-01T10:05:00.000Z',
      title: 'Rotate AKIAABCDEFGHIJKLMNOP',
      request: 'Never log ghp_abcdefghijklmnopqrstuvwxyz1234567890.',
    })
    if (!created.ok) throw new Error('fixture create failed')
    const beforeExpiry = harness.repository.inspectForTests()

    harness.setTime('2026-08-01T10:05:00.000Z')
    await harness.repository.listWorkRequests('project-a', cookiePrincipal)
    await harness.repository.listWorkRequests('project-a', cookiePrincipal)

    const inspected = harness.repository.inspectForTests()
    expect(inspected.idempotencyRecordCount).toBe(
      beforeExpiry.idempotencyRecordCount,
    )
    expect(
      inspected.auditEvents.filter(
        (event) => event.operation === 'work_request_expire',
      ),
    ).toEqual([
      expect.objectContaining({
        organizationId: 'org-a',
        projectId: 'project-a',
        actorUserId: 'user-lead',
        authenticationKind: 'session_cookie',
        authenticationTokenRecordId: null,
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        outcomeCode: 'expired',
        replayed: false,
      }),
    ])
    const auditJson = JSON.stringify(inspected.auditEvents)
    expect(auditJson).not.toContain('Rotate')
    expect(auditJson).not.toContain('Never log')
    expect(auditJson).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(auditJson).not.toContain('ghp_')
    expect(auditJson).not.toContain('create-list-expiry')
  })

  it('limits Desktop Bearer lists to open requests and claims owned by that token', async () => {
    const harness = createHarness()
    const ownPending = await createOpenRequest(harness, {
      idempotencyKey: 'create-own-pending',
    })
    const otherMaterialized = await createOpenRequest(harness, {
      idempotencyKey: 'create-other-materialized',
    })
    const open = await createOpenRequest(harness, {
      idempotencyKey: 'create-open',
    })
    const expired = await createOpenRequest(harness, {
      idempotencyKey: 'create-expired-list',
      expiresAt: '2026-08-01T10:05:00.000Z',
    })
    if (
      !ownPending.ok ||
      !otherMaterialized.ok ||
      !open.ok ||
      !expired.ok
    ) {
      throw new Error('fixture create failed')
    }

    const secondDesktop = {
      ...desktopPrincipal,
      authentication: {
        kind: 'desktop_bearer',
        tokenRecordId: 'desktop-token-record-2',
      },
    } satisfies RequestPrincipal
    await harness.repository.claimWorkRequest(
      {
        workRequestId: ownPending.workRequest.id,
        expectedVersion: 1,
        runId: 'run-own',
        idempotencyKey: 'claim-own',
      },
      desktopPrincipal,
    )
    const otherClaim = await harness.repository.claimWorkRequest(
      {
        workRequestId: otherMaterialized.workRequest.id,
        expectedVersion: 1,
        runId: 'run-other',
        idempotencyKey: 'claim-other',
      },
      secondDesktop,
    )
    if (!otherClaim.ok) throw new Error('fixture claim failed')
    await harness.repository.materializeWorkRequest(
      {
        workRequestId: otherMaterialized.workRequest.id,
        expectedVersion: 2,
        runId: 'run-other',
        idempotencyKey: 'materialize-other',
      },
      secondDesktop,
    )
    harness.setTime('2026-08-01T10:05:00.000Z')

    const ownVisible = await harness.repository.listWorkRequests(
      'project-a',
      desktopPrincipal,
    )
    expect(ownVisible.map((record) => record.id)).toEqual([
      ownPending.workRequest.id,
      open.workRequest.id,
    ])
    const otherVisible = await harness.repository.listWorkRequests(
      'project-a',
      secondDesktop,
    )
    expect(otherVisible.map((record) => record.id)).toEqual([
      otherMaterialized.workRequest.id,
      open.workRequest.id,
    ])

    const browserVisible = await harness.repository.listWorkRequests(
      'project-a',
      cookiePrincipal,
    )
    expect(browserVisible.map((record) => record.id)).toEqual([
      ownPending.workRequest.id,
      otherMaterialized.workRequest.id,
      open.workRequest.id,
      expired.workRequest.id,
    ])
  })

  it('releases only pending claims with lead authority and no canonical projection', async () => {
    const harness = createHarness()
    const created = await createOpenRequest(harness)
    if (!created.ok) throw new Error('fixture create failed')
    const claimed = await harness.repository.claimWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        runId: 'run-release',
        idempotencyKey: 'claim-release',
      },
      desktopPrincipal,
    )
    if (!claimed.ok) throw new Error('fixture claim failed')

    expect(
      harness.repository.permitsRunSummaryUpload({
        organizationId: 'org-a',
        projectId: 'project-a',
        runId: 'run-release',
        tokenRecordId: 'desktop-token-record-1',
      }),
    ).toBe(true)
    expect(
      harness.repository.permitsRunSummaryUpload({
        organizationId: 'org-a',
        projectId: 'project-a',
        runId: 'run-release',
        tokenRecordId: 'desktop-token-stale',
      }),
    ).toBe(false)

    const memberPrincipal = {
      ...cookiePrincipal,
      session: {
        ...cookiePrincipal.session,
        userId: 'user-member',
        role: 'member',
        projectMemberships: [
          { projectId: 'project-a', userId: 'user-member', role: 'member' },
        ],
      },
    } satisfies RequestPrincipal
    await expect(
      harness.repository.releaseWorkRequest(
        {
          workRequestId: created.workRequest.id,
          expectedVersion: 2,
          idempotencyKey: 'release-member',
        },
        memberPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'project_forbidden',
    })

    harness.canonicalRuns.add('org-a:project-a:run-release')
    await expect(
      harness.repository.releaseWorkRequest(
        {
          workRequestId: created.workRequest.id,
          expectedVersion: 2,
          idempotencyKey: 'release-canonical',
        },
        cookiePrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'canonical_projection_exists',
    })

    harness.canonicalRuns.clear()
    const released = await harness.repository.releaseWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 2,
        idempotencyKey: 'release-ok',
      },
      cookiePrincipal,
    )
    expect(released).toMatchObject({
      ok: true,
      outcomeCode: 'released',
      workRequest: { status: 'open', version: 3, claim: null },
    })
    expect(
      harness.repository.permitsRunSummaryUpload({
        organizationId: 'org-a',
        projectId: 'project-a',
        runId: 'run-release',
        tokenRecordId: 'desktop-token-record-1',
      }),
    ).toBe(false)

    const expiring = await createOpenRequest(harness, {
      idempotencyKey: 'create-release-expired',
      expiresAt: '2026-08-01T10:05:00.000Z',
    })
    if (!expiring.ok) throw new Error('fixture create failed')
    const expiringClaim = await harness.repository.claimWorkRequest(
      {
        workRequestId: expiring.workRequest.id,
        expectedVersion: 1,
        runId: 'run-release-expired',
        idempotencyKey: 'claim-release-expired',
      },
      desktopPrincipal,
    )
    if (!expiringClaim.ok) throw new Error('fixture claim failed')
    harness.setTime('2026-08-01T10:06:00.000Z')
    await expect(
      harness.repository.releaseWorkRequest(
        {
          workRequestId: expiring.workRequest.id,
          expectedVersion: 2,
          idempotencyKey: 'release-expired',
        },
        cookiePrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'released',
      workRequest: { status: 'expired', version: 3, claim: null },
    })
  })

  it('makes writes idempotent per tenant, project, actor, operation, and key', async () => {
    const harness = createHarness()
    const input = {
      projectId: 'project-a',
      title: 'Stable create',
      request: 'Return the same record on retry.',
      idempotencyKey: 'stable-key',
      expiresAt: null,
    }

    const first = await harness.repository.createWorkRequest(input, cookiePrincipal)
    const replay = await harness.repository.createWorkRequest(input, cookiePrincipal)
    expect(first).toMatchObject({ ok: true, replayed: false })
    expect(replay).toEqual({ ...first, replayed: true })
    await expect(
      harness.repository.createWorkRequest(
        { ...input, title: 'Changed payload' },
        cookiePrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'idempotency_conflict',
      replayed: false,
    })

    const differentActor = {
      ...cookiePrincipal,
      session: {
        ...cookiePrincipal.session,
        userId: 'another-lead',
        projectMemberships: [
          { projectId: 'project-a', userId: 'another-lead', role: 'lead' },
        ],
      },
    } satisfies RequestPrincipal
    const actorScoped = await harness.repository.createWorkRequest(
      input,
      differentActor,
    )
    expect(actorScoped).toMatchObject({
      ok: true,
      replayed: false,
      workRequest: { id: 'wr-2' },
    })
  })

  it('returns stale and claim conflicts without mutating the request', async () => {
    const harness = createHarness()
    const created = await createOpenRequest(harness)
    if (!created.ok) throw new Error('fixture create failed')

    const staleInput = {
      workRequestId: created.workRequest.id,
      expectedVersion: 2,
      runId: 'run-1',
      idempotencyKey: 'stale-claim',
    }
    const stale = await harness.repository.claimWorkRequest(
      staleInput,
      desktopPrincipal,
    )
    expect(stale).toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'stale_version',
      replayed: false,
    })
    await expect(
      harness.repository.claimWorkRequest(staleInput, desktopPrincipal),
    ).resolves.toEqual({ ...stale, replayed: true })
    await expect(
      harness.repository.claimWorkRequest(
        { ...staleInput, runId: 'run-changed' },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'idempotency_conflict',
      replayed: false,
    })

    await harness.repository.claimWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        runId: 'run-1',
        idempotencyKey: 'claim-ok',
      },
      desktopPrincipal,
    )
    await expect(
      harness.repository.claimWorkRequest(
        {
          workRequestId: created.workRequest.id,
          expectedVersion: 2,
          runId: 'run-2',
          idempotencyKey: 'claim-conflict',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'claim_conflict',
    })
  })

  it('never binds a claim to an existing or already claimed canonical Run ID', async () => {
    const harness = createHarness()
    const first = await createOpenRequest(harness, { idempotencyKey: 'create-first' })
    const second = await createOpenRequest(harness, { idempotencyKey: 'create-second' })
    const third = await createOpenRequest(harness, { idempotencyKey: 'create-third' })
    if (!first.ok || !second.ok || !third.ok) throw new Error('fixture create failed')

    harness.canonicalRuns.add('org-a:project-a:run-existing')
    await expect(harness.repository.claimWorkRequest({
      workRequestId: first.workRequest.id,
      expectedVersion: 1,
      runId: 'run-existing',
      idempotencyKey: 'claim-existing',
    }, desktopPrincipal)).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'claim_conflict',
    })

    await expect(harness.repository.claimWorkRequest({
      workRequestId: second.workRequest.id,
      expectedVersion: 1,
      runId: 'run-shared',
      idempotencyKey: 'claim-shared-first',
    }, desktopPrincipal)).resolves.toMatchObject({ ok: true })
    await expect(harness.repository.claimWorkRequest({
      workRequestId: third.workRequest.id,
      expectedVersion: 1,
      runId: 'run-shared',
      idempotencyKey: 'claim-shared-second',
    }, desktopPrincipal)).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'claim_conflict',
    })
  })

  it('resolves only the exact materialized claim for internal Gate delivery', async () => {
    const harness = createHarness()
    const created = await createOpenRequest(harness)
    if (!created.ok) throw new Error('fixture create failed')

    await harness.repository.claimWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 1,
        runId: 'run-gate-owner',
        idempotencyKey: 'claim-gate-owner',
      },
      desktopPrincipal,
    )
    await harness.repository.materializeWorkRequest(
      {
        workRequestId: created.workRequest.id,
        expectedVersion: 2,
        runId: 'run-gate-owner',
        idempotencyKey: 'materialize-gate-owner',
      },
      desktopPrincipal,
    )

    await expect(
      harness.repository.resolveMaterializedWorkRequestClaim({
        organizationId: 'org-a',
        projectId: 'project-a',
        runId: 'run-gate-owner',
      }),
    ).resolves.toEqual({
      organizationId: 'org-a',
      projectId: 'project-a',
      workRequestId: created.workRequest.id,
      runId: 'run-gate-owner',
      claimedByTokenId: 'desktop-token-record-1',
    })
    await expect(
      harness.repository.resolveMaterializedWorkRequestClaim({
        organizationId: 'org-b',
        projectId: 'project-a',
        runId: 'run-gate-owner',
      }),
    ).resolves.toBeNull()
  })

  it('keeps only safe identifiers and fingerprints in internal audit data', async () => {
    const harness = createHarness()
    await createOpenRequest(harness, {
      title: 'Credential AKIAABCDEFGHIJKLMNOP',
      request: 'Use token ghp_abcdefghijklmnopqrstuvwxyz1234567890.',
    })

    const inspected = harness.repository.inspectForTests()
    expect(inspected.auditEvents).toHaveLength(1)
    expect(inspected.auditEvents[0]).toMatchObject({
      organizationId: 'org-a',
      projectId: 'project-a',
      actorUserId: 'user-lead',
      authenticationKind: 'session_cookie',
      authenticationTokenRecordId: null,
      operation: 'work_request_create',
      outcomeCode: 'created',
    })
    const auditJson = JSON.stringify(inspected.auditEvents)
    expect(auditJson).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(auditJson).not.toContain('ghp_')
    expect(auditJson).not.toContain('create-1')
    expect(inspected.internalRecords[0]).toMatchObject({
      claimedByTokenId: null,
    })
  })
})
