import { describe, expect, it } from 'vitest'
import type { GitHubDeliveryIntent } from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import { createSeedGitHubDeliveryRepository } from './seed-github-delivery-repository'

const ownerPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner',
    organizationId: 'org-a',
    userId: 'user-owner',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} satisfies RequestPrincipal

const leadPrincipal = {
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
} satisfies RequestPrincipal

const desktopPrincipal = {
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
} satisfies RequestPrincipal

const shaA = 'a'.repeat(40)
const shaB = 'b'.repeat(40)
const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)
const digestC = 'c'.repeat(64)
const digestD = 'd'.repeat(64)

function deliveryIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'local-intent-1',
    organizationId: 'org-a',
    teamProjectId: 'project-a',
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'github-binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-1',
    codingRunCompletedAt: '2026-08-11T09:55:00.000Z',
    workspaceId: 'workspace-1',
    repository: 'example/project',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: shaA,
    expectedCommitSha: shaB,
    diffArtifactId: 'diff-1',
    diffSourceDigest: digestA,
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T09:56:00.000Z',
    testEvidenceDigest: digestB,
    prPackageArtifactId: 'package-1',
    prPackageUpdatedAt: '2026-08-11T09:57:00.000Z',
    prPackageDigest: digestC,
    changedPaths: ['apps/api/src/example.ts'],
    intentDigest: digestD,
    idempotencyKey: `github-delivery:${'e'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T09:58:00.000Z',
    updatedAt: '2026-08-11T09:58:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function createHarness() {
  let currentTime = new Date('2026-08-11T10:00:00.000Z')
  let nextId = 1
  const roles = new Map([
    ['org-a:project-a:user-owner', 'owner' as const],
    ['org-a:project-b:user-owner', 'owner' as const],
    ['org-a:project-a:user-lead', 'lead' as const],
    ['org-a:project-a:user-desktop', 'member' as const],
  ])
  const authorizedDesktopTokens = new Set(['org-a:project-a:desktop-token-1'])
  let canonicalRunAuthority = {
    organizationId: 'org-a',
    projectId: 'project-a',
    runId: 'run-1',
    runVersion: 7,
    currentNodeId: 'pr-1',
    materializedByTokenRecordId: 'desktop-token-1',
  }
  const repository = createSeedGitHubDeliveryRepository({
    now: () => currentTime,
    id: (kind) => `${kind}-${nextId++}`,
    resolveProjectRole: ({ organizationId, projectId, userId }) =>
      roles.get(`${organizationId}:${projectId}:${userId}`) ?? null,
    desktopTokenStillAuthorized: ({ organizationId, projectId, tokenRecordId }) =>
      authorizedDesktopTokens.has(`${organizationId}:${projectId}:${tokenRecordId}`),
    resolveCanonicalRunAuthority: ({ organizationId, projectId, runId }) =>
      canonicalRunAuthority.organizationId === organizationId &&
      canonicalRunAuthority.projectId === projectId &&
      canonicalRunAuthority.runId === runId
        ? { ...canonicalRunAuthority }
        : null,
  })

  return {
    repository,
    roles,
    authorizedDesktopTokens,
    setCanonicalRunAuthority(
      value: Partial<typeof canonicalRunAuthority> | null,
    ) {
      canonicalRunAuthority = value
        ? { ...canonicalRunAuthority, ...value }
        : { ...canonicalRunAuthority, runId: 'unavailable' }
    },
    setTime(value: string) {
      currentTime = new Date(value)
    },
  }
}

async function createBinding(harness: ReturnType<typeof createHarness>) {
  const result = await harness.repository.upsertGitHubRepositoryBinding(
    {
      projectId: 'project-a',
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      defaultBranch: 'main',
      verifiedAt: '2026-08-11T09:59:00.000Z',
      expectedStateVersion: 0,
    },
    ownerPrincipal,
  )
  if (!result.ok) throw new Error('fixture binding create failed')
  return result.binding
}

async function createApprovedDelivery(harness: ReturnType<typeof createHarness>) {
  await createBinding(harness)
  const created = await harness.repository.createOrReviseGitHubDeliveryRequest(
    {
      projectId: 'project-a',
      intent: deliveryIntent(),
      prTitle: 'Deliver the reviewed change',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    },
    desktopPrincipal,
  )
  if (!created.ok) throw new Error('fixture delivery create failed')
  const approved = await harness.repository.decideGitHubDeliveryRequest(
    {
      projectId: 'project-a',
      requestId: created.request.id,
      decision: 'approve',
      expectedStateVersion: created.request.stateVersion,
    },
    leadPrincipal,
  )
  if (!approved.ok || !approved.approval) {
    throw new Error('fixture delivery approval failed')
  }
  return { ...approved, approval: approved.approval }
}

async function createIssuedGrant(harness: ReturnType<typeof createHarness>) {
  const approved = await createApprovedDelivery(harness)
  const reserved = await harness.repository.reserveGitHubCredentialGrant(
    {
      projectId: 'project-a',
      requestId: approved.request.id,
      expectedStateVersion: approved.request.stateVersion,
    },
    desktopPrincipal,
  )
  if (!reserved.ok) throw new Error('fixture grant reservation failed')
  const finalized = await harness.repository.finalizeGitHubCredentialGrant(
    {
      projectId: 'project-a',
      requestId: approved.request.id,
      grantId: reserved.grant.id,
      expectedStateVersion: reserved.request.stateVersion,
      expectedGrantVersion: reserved.grant.version,
      outcome: {
        status: 'issued',
        issuedAt: '2026-08-11T10:00:01.000Z',
        credentialExpiresAt: '2026-08-11T10:45:01.000Z',
        repositoryId: '98765',
        permission: 'contents:write',
        repositoryCount: 1,
      },
    },
    desktopPrincipal,
  )
  if (!finalized.ok) throw new Error('fixture grant finalize failed')
  return finalized
}

async function createVerifiedPublication(
  harness: ReturnType<typeof createHarness>,
) {
  const issued = await createIssuedGrant(harness)
  const reported = await harness.repository.recordGitHubBranchPublicationReport(
    {
      projectId: 'project-a',
      requestId: issued.request.id,
      grantId: issued.grant.id,
      expectedStateVersion: issued.request.stateVersion,
      expectedGrantVersion: issued.grant.version,
      reportedOutcomeCode: 'pushed',
    },
    desktopPrincipal,
  )
  if (!reported.ok) throw new Error('fixture publication report failed')
  const verified = await harness.repository.finalizeGitHubBranchPublication(
    {
      projectId: 'project-a',
      requestId: issued.request.id,
      publicationId: reported.publication.id,
      expectedStateVersion: reported.request.stateVersion,
      expectedPublicationVersion: reported.publication.version,
      verification: {
        status: 'verified',
        verifiedHeadSha: shaB,
        verifiedAt: '2026-08-11T10:01:01.000Z',
        outcomeCode: 'branch_verified',
      },
    },
    desktopPrincipal,
  )
  if (!verified.ok) throw new Error('fixture publication verification failed')
  return verified
}

describe('seed GitHub Delivery repository', () => {
  it('rejects a Delivery Request unless the paired Desktop owns the live materialized canonical Run', async () => {
    const harness = createHarness()
    await createBinding(harness)
    harness.setCanonicalRunAuthority({
      materializedByTokenRecordId: 'desktop-token-other',
    })

    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: deliveryIntent(),
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'project_forbidden',
    })
  })

  it('invalidates approval when the canonical Team Run version or current node changes', async () => {
    const harness = createHarness()
    await createBinding(harness)
    const created = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: deliveryIntent(),
        prTitle: 'Deliver the reviewed change',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )
    if (!created.ok) throw new Error('fixture delivery create failed')
    harness.setCanonicalRunAuthority({ runVersion: 8 })

    await expect(
      harness.repository.decideGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          requestId: created.request.id,
          decision: 'approve',
          expectedStateVersion: created.request.stateVersion,
        },
        leadPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'invalid_state',
    })
  })

  it('rechecks canonical Run authority before reserving a credential grant', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)
    harness.setCanonicalRunAuthority({ currentNodeId: 'acceptance-1' })

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: approved.request.id,
          expectedStateVersion: approved.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
  })

  it('rechecks canonical Run authority before accepting remote delivery facts', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    harness.setCanonicalRunAuthority({ runVersion: 8 })

    await expect(
      harness.repository.recordGitHubBranchPublicationReport(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          grantId: issued.grant.id,
          expectedStateVersion: issued.request.stateVersion,
          expectedGrantVersion: issued.grant.version,
          reportedOutcomeCode: 'pushed',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
  })

  it('creates a redacted repository binding only from a live owner Cookie session', async () => {
    const harness = createHarness()

    const result = await harness.repository.upsertGitHubRepositoryBinding(
      {
        projectId: 'project-a',
        installationId: '12345',
        repositoryId: '98765',
        repository: 'Example/Project',
        defaultBranch: 'main',
        verifiedAt: '2026-08-11T09:59:00.000Z',
        expectedStateVersion: 0,
      },
      ownerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'binding_created',
      replayed: false,
      binding: {
        stateVersion: 1,
        id: 'github-binding-1',
        version: 1,
        organizationId: 'org-a',
        teamProjectId: 'project-a',
        installationId: '12345',
        repositoryId: '98765',
        repository: 'example/project',
        defaultBranch: 'main',
        status: 'active',
        validatedAt: '2026-08-11T09:59:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
        redacted: true,
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/token|private.key|raw.response|local.path|log/i)

    harness.roles.set('org-a:project-a:user-owner', 'lead')
    await expect(
      harness.repository.upsertGitHubRepositoryBinding(
        {
          projectId: 'project-a',
          installationId: '12345',
          repositoryId: '98765',
          repository: 'example/project',
          defaultBranch: 'main',
          verifiedAt: '2026-08-11T09:59:00.000Z',
          expectedStateVersion: 1,
        },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 403,
      outcomeCode: 'role_forbidden',
    })
  })

  it('rejects a second active Project binding to the same organization repository', async () => {
    const harness = createHarness()
    await createBinding(harness)

    await expect(
      harness.repository.upsertGitHubRepositoryBinding(
        {
          projectId: 'project-b',
          installationId: '12345',
          repositoryId: '98765',
          repository: 'example/project',
          defaultBranch: 'main',
          verifiedAt: '2026-08-11T09:59:00.000Z',
          expectedStateVersion: 0,
        },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_conflict',
    })
  })

  it('replays an identical binding upsert after a lost response', async () => {
    const harness = createHarness()
    const input = {
      projectId: 'project-a',
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      defaultBranch: 'main',
      verifiedAt: '2026-08-11T09:59:00.000Z',
      expectedStateVersion: 0,
    }
    const created = await harness.repository.upsertGitHubRepositoryBinding(
      input,
      ownerPrincipal,
    )
    if (!created.ok) throw new Error('fixture binding create failed')

    await expect(
      harness.repository.upsertGitHubRepositoryBinding(input, ownerPrincipal),
    ).resolves.toEqual({ ...created, replayed: true })
  })

  it('uses binding CAS and preserves a revoked binding as redacted metadata', async () => {
    const harness = createHarness()
    const created = await harness.repository.upsertGitHubRepositoryBinding(
      {
        projectId: 'project-a',
        installationId: '12345',
        repositoryId: '98765',
        repository: 'example/project',
        defaultBranch: 'main',
        verifiedAt: '2026-08-11T09:59:00.000Z',
        expectedStateVersion: 0,
      },
      ownerPrincipal,
    )
    if (!created.ok) throw new Error('fixture binding create failed')

    await expect(
      harness.repository.revokeGitHubRepositoryBinding(
        { projectId: 'project-a', expectedStateVersion: 0 },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'stale_version',
    })

    harness.setTime('2026-08-11T10:01:00.000Z')
    const revoked = await harness.repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )
    expect(revoked).toMatchObject({
      ok: true,
      outcomeCode: 'binding_revoked',
      replayed: false,
      binding: {
        id: created.binding.id,
        version: 2,
        status: 'revoked',
        updatedAt: '2026-08-11T10:01:00.000Z',
      },
    })
    if (!revoked.ok) throw new Error('fixture binding revoke failed')
    await expect(
      harness.repository.revokeGitHubRepositoryBinding(
        { projectId: 'project-a', expectedStateVersion: 1 },
        ownerPrincipal,
      ),
    ).resolves.toEqual({ ...revoked, replayed: true })
    await expect(
      harness.repository.getGitHubRepositoryBinding('project-a', ownerPrincipal),
    ).resolves.toMatchObject({ status: 'revoked', version: 2 })
  })

  it('revokes active delivery authority and blocks publication after binding revocation', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)

    const revoked = await harness.repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )
    expect(revoked).toMatchObject({ ok: true, outcomeCode: 'binding_revoked' })
    expect(harness.repository.inspectForTests()).toMatchObject({
      requests: [
        {
          id: issued.request.id,
          status: 'revoked',
          outcomeCode: 'binding_revoked',
        },
      ],
      grants: [
        {
          id: issued.grant.id,
          status: 'revoked',
          outcomeCode: 'binding_revoked',
        },
      ],
    })
    await expect(
      harness.repository.recordGitHubBranchPublicationReport(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          grantId: issued.grant.id,
          expectedStateVersion: issued.request.stateVersion + 1,
          expectedGrantVersion: issued.grant.version + 1,
          reportedOutcomeCode: 'pushed',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'binding_inactive' })
  })

  it('creates, replays, and revises one logical delivery intent with CAS', async () => {
    const harness = createHarness()
    await createBinding(harness)
    const input = {
      projectId: 'project-a',
      intent: deliveryIntent(),
      prTitle: 'Deliver the reviewed change',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    }

    const created = await harness.repository.createOrReviseGitHubDeliveryRequest(
      input,
      desktopPrincipal,
    )
    expect(created).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'delivery_created',
      replayed: false,
      request: {
        id: 'github-delivery-2',
        stateVersion: 1,
        intentRevision: 1,
        organizationId: 'org-a',
        projectId: 'project-a',
        runId: 'run-1',
        runVersion: 7,
        nodeId: 'pr-1',
        status: 'approval_required',
        outcomeCode: null,
        repository: 'example/project',
        expectedCommitSha: shaB,
        intentDigest: digestD,
        redacted: true,
      },
    })
    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        input,
        desktopPrincipal,
      ),
    ).resolves.toEqual({ ...created, replayed: true })

    const revised = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        ...input,
        intent: deliveryIntent({
          testEvidenceId: 'test-2',
          testEvidenceDigest: 'f'.repeat(64),
          intentDigest: '1'.repeat(64),
        }),
        expectedStateVersion: 1,
      },
      desktopPrincipal,
    )
    expect(revised).toMatchObject({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'delivery_revised',
      request: {
        id: 'github-delivery-2',
        stateVersion: 2,
        intentRevision: 2,
        status: 'approval_required',
        testEvidenceId: 'test-2',
        testEvidenceDigest: 'f'.repeat(64),
        intentDigest: '1'.repeat(64),
      },
    })
    expect(JSON.stringify(revised)).not.toMatch(
      /authorization|access.token|private.key|raw.response|workspace.path|stdout|stderr/i,
    )
  })

  it('keeps approval immutable and invalidates it when the intent is revised', async () => {
    const harness = createHarness()
    await createBinding(harness)
    const input = {
      projectId: 'project-a',
      intent: deliveryIntent(),
      prTitle: 'Deliver the reviewed change',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    }
    const created = await harness.repository.createOrReviseGitHubDeliveryRequest(
      input,
      desktopPrincipal,
    )
    if (!created.ok) throw new Error('fixture delivery create failed')

    const approved = await harness.repository.decideGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        requestId: created.request.id,
        decision: 'approve',
        expectedStateVersion: 1,
      },
      leadPrincipal,
    )
    expect(approved).toMatchObject({
      ok: true,
      outcomeCode: 'delivery_approved',
      replayed: false,
      request: { stateVersion: 2, intentRevision: 1, status: 'approved' },
      approval: {
        id: 'github-approval-3',
        requestId: created.request.id,
        intentRevision: 1,
        requestStateVersion: 1,
        intentDigest: digestD,
        approvedByUserId: 'user-lead',
        approvedRole: 'lead',
        authenticationKind: 'session_cookie',
        approvedAt: '2026-08-11T10:00:00.000Z',
        redacted: true,
      },
    })

    const revised = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        ...input,
        intent: deliveryIntent({
          prPackageArtifactId: 'package-2',
          prPackageDigest: '2'.repeat(64),
          intentDigest: '3'.repeat(64),
        }),
        expectedStateVersion: 2,
      },
      desktopPrincipal,
    )
    expect(revised).toMatchObject({
      ok: true,
      request: {
        stateVersion: 3,
        intentRevision: 2,
        status: 'approval_required',
      },
    })
    const inspection = harness.repository.inspectForTests()
    expect(inspection.approvals).toHaveLength(1)
    expect(inspection.approvals[0]).toMatchObject({
      intentRevision: 1,
      intentDigest: digestD,
      approvedByUserId: 'user-lead',
    })
  })

  it('keeps one append-only safe audit decision when rejection is replayed', async () => {
    const harness = createHarness()
    await createBinding(harness)
    const created = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: deliveryIntent(),
        prTitle: 'Secret-looking title must not enter audit',
        prBody: 'ghp_not_a_real_token must not enter audit',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )
    if (!created.ok) throw new Error('fixture delivery create failed')
    const input = {
      projectId: 'project-a',
      requestId: created.request.id,
      decision: 'reject' as const,
      expectedStateVersion: created.request.stateVersion,
    }
    const rejected = await harness.repository.decideGitHubDeliveryRequest(
      input,
      leadPrincipal,
    )
    if (!rejected.ok) throw new Error('fixture rejection failed')
    await expect(
      harness.repository.decideGitHubDeliveryRequest(input, leadPrincipal),
    ).resolves.toEqual({ ...rejected, replayed: true })

    const rejectionAudits = harness.repository
      .inspectForTests()
      .auditEvents.filter(
        (event) => event.operationKind === 'github_delivery_reject',
      )
    expect(rejectionAudits).toHaveLength(1)
    expect(rejectionAudits[0]).toMatchObject({
      actorUserId: 'user-lead',
      authenticationKind: 'session_cookie',
      recordId: created.request.id,
      outcomeCode: 'delivery_rejected',
    })
    expect(JSON.stringify(rejectionAudits)).not.toMatch(
      /ghp_|Secret-looking|desktop-token|prBody|workspace/i,
    )
  })

  it('reserves and finalizes only redacted one-repository credential metadata', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)

    const reserved = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        expectedStateVersion: approved.request.stateVersion,
      },
      desktopPrincipal,
    )
    expect(reserved).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: false,
      request: { stateVersion: 3, status: 'publishing_branch' },
      grant: {
        id: 'github-grant-4',
        version: 1,
        requestId: approved.request.id,
        intentRevision: 1,
        approvalId: approved.approval.id,
        attempt: 1,
        repositoryId: '98765',
        permission: 'contents:write',
        repositoryCount: 1,
        status: 'issuing',
        requestedAt: '2026-08-11T10:00:00.000Z',
        issuedAt: null,
        credentialExpiresAt: null,
        redacted: true,
      },
    })
    if (!reserved.ok) throw new Error('fixture grant reservation failed')

    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: deliveryIntent({
            prPackageDigest: '2'.repeat(64),
            intentDigest: '3'.repeat(64),
          }),
          prTitle: 'Revised after grant',
          prBody: 'This must not replace an approved publication attempt.',
          expectedStateVersion: reserved.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'intent_conflict',
    })

    const finalized = await harness.repository.finalizeGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        grantId: reserved.grant.id,
        expectedStateVersion: reserved.request.stateVersion,
        expectedGrantVersion: reserved.grant.version,
        outcome: {
          status: 'issued',
          issuedAt: '2026-08-11T10:00:01.000Z',
          credentialExpiresAt: '2026-08-11T10:45:01.000Z',
          repositoryId: '98765',
          permission: 'contents:write',
          repositoryCount: 1,
        },
      },
      desktopPrincipal,
    )
    expect(finalized).toMatchObject({
      ok: true,
      outcomeCode: 'grant_finalized',
      request: { stateVersion: 4, status: 'publishing_branch' },
      grant: {
        id: reserved.grant.id,
        version: 2,
        status: 'issued',
        issuedAt: '2026-08-11T10:00:01.000Z',
        credentialExpiresAt: '2026-08-11T10:45:01.000Z',
      },
    })
    expect(JSON.stringify(harness.repository.inspectForTests())).not.toMatch(
      /credentialValue|accessToken|authorization|privateKey|rawResponse|stdout|stderr/,
    )
  })

  it('creates a numbered manual grant retry after a recoverable issuance failure', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)
    const first = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        expectedStateVersion: approved.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!first.ok) throw new Error('fixture grant reservation failed')
    const failed = await harness.repository.finalizeGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        grantId: first.grant.id,
        expectedStateVersion: first.request.stateVersion,
        expectedGrantVersion: first.grant.version,
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'credential_issue_failed',
        },
      },
      desktopPrincipal,
    )
    if (!failed.ok) throw new Error('fixture grant recovery failed')

    const retried = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        expectedStateVersion: failed.request.stateVersion,
      },
      desktopPrincipal,
    )
    expect(retried).toMatchObject({
      ok: true,
      replayed: false,
      request: { status: 'publishing_branch', outcomeCode: null },
      grant: { attempt: 2, status: 'issuing', outcomeCode: null },
    })
    expect(harness.repository.inspectForTests().grants).toMatchObject([
      { id: first.grant.id, status: 'failed', attempt: 1 },
      { status: 'issuing', attempt: 2 },
    ])
  })

  it('accepts a one-hour installation token issued after approval delay', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)
    harness.setTime('2026-08-11T10:10:00.000Z')
    const reserved = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        expectedStateVersion: approved.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!reserved.ok) throw new Error('fixture grant reservation failed')

    await expect(
      harness.repository.finalizeGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: approved.request.id,
          grantId: reserved.grant.id,
          expectedStateVersion: reserved.request.stateVersion,
          expectedGrantVersion: reserved.grant.version,
          outcome: {
            status: 'issued',
            issuedAt: '2026-08-11T10:10:01.000Z',
            credentialExpiresAt: '2026-08-11T11:10:01.000Z',
            repositoryId: '98765',
            permission: 'contents:write',
            repositoryCount: 1,
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      grant: { status: 'issued' },
    })
  })

  it('does not accept a Desktop publication report until the remote head is verified', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)

    const reported = await harness.repository.recordGitHubBranchPublicationReport(
      {
        projectId: 'project-a',
        requestId: issued.request.id,
        grantId: issued.grant.id,
        expectedStateVersion: issued.request.stateVersion,
        expectedGrantVersion: issued.grant.version,
        reportedOutcomeCode: 'pushed',
      },
      desktopPrincipal,
    )
    expect(reported).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'publication_reported',
      request: { stateVersion: 5, status: 'publishing_branch' },
      grant: {
        version: 3,
        status: 'consumed',
        consumedAt: '2026-08-11T10:00:00.000Z',
      },
      publication: {
        id: 'github-publication-5',
        version: 1,
        status: 'verifying',
        reportedOutcomeCode: 'pushed',
        verifiedHeadSha: null,
        verifiedAt: null,
        outcomeCode: null,
        redacted: true,
      },
    })
    if (!reported.ok) throw new Error('fixture publication report failed')

    await expect(
      harness.repository.finalizeGitHubBranchPublication(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          publicationId: reported.publication.id,
          expectedStateVersion: reported.request.stateVersion,
          expectedPublicationVersion: reported.publication.version,
          verification: {
            status: 'verified',
            verifiedHeadSha: shaA,
            verifiedAt: '2026-08-11T10:01:01.000Z',
            outcomeCode: 'branch_verified',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'publication_conflict',
    })

    const verified = await harness.repository.finalizeGitHubBranchPublication(
      {
        projectId: 'project-a',
        requestId: issued.request.id,
        publicationId: reported.publication.id,
        expectedStateVersion: reported.request.stateVersion,
        expectedPublicationVersion: reported.publication.version,
        verification: {
          status: 'verified',
          verifiedHeadSha: shaB,
          verifiedAt: '2026-08-11T10:01:01.000Z',
          outcomeCode: 'branch_verified',
        },
      },
      desktopPrincipal,
    )
    expect(verified).toMatchObject({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'publication_verified',
      request: { stateVersion: 6, status: 'branch_published' },
      publication: {
        version: 2,
        status: 'verified',
        verifiedHeadSha: shaB,
        verifiedAt: '2026-08-11T10:01:01.000Z',
        outcomeCode: 'branch_verified',
      },
    })
  })

  it('records an ambiguous branch lookup without inventing a verification timestamp', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    harness.setTime('2026-08-11T10:01:00.000Z')
    const reported = await harness.repository.recordGitHubBranchPublicationReport(
      {
        projectId: 'project-a',
        requestId: issued.request.id,
        grantId: issued.grant.id,
        expectedStateVersion: issued.request.stateVersion,
        expectedGrantVersion: issued.grant.version,
        reportedOutcomeCode: 'unknown',
      },
      desktopPrincipal,
    )
    if (!reported.ok) throw new Error('fixture publication report failed')

    const recovery = await harness.repository.finalizeGitHubBranchPublication(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          publicationId: reported.publication.id,
          expectedStateVersion: reported.request.stateVersion,
          expectedPublicationVersion: reported.publication.version,
          verification: {
            status: 'recovery_required',
            verifiedHeadSha: null,
            verifiedAt: null,
            outcomeCode: 'branch_verification_failed',
          },
        },
        desktopPrincipal,
    )
    expect(recovery).toMatchObject({
      ok: true,
      request: {
        status: 'recovery_required',
        outcomeCode: 'branch_verification_failed',
      },
      publication: {
        status: 'recovery_required',
        reportedAt: '2026-08-11T10:01:00.000Z',
        verifiedAt: null,
        outcomeCode: 'branch_verification_failed',
      },
    })
    if (!recovery.ok) throw new Error('fixture publication recovery failed')

    harness.setTime('2026-08-11T10:02:00.000Z')
    await expect(
      harness.repository.recordGitHubBranchPublicationReport(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          grantId: issued.grant.id,
          expectedStateVersion: recovery.request.stateVersion,
          expectedGrantVersion: reported.grant.version,
          reportedOutcomeCode: 'unknown',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { status: 'publishing_branch', outcomeCode: null },
      publication: {
        id: reported.publication.id,
        version: 3,
        status: 'verifying',
        reportedAt: '2026-08-11T10:02:00.000Z',
        verifiedAt: null,
        outcomeCode: null,
      },
    })
  })

  it('records exactly one matching Draft pull request outcome without merge authority', async () => {
    const harness = createHarness()
    const verified = await createVerifiedPublication(harness)

    const reserved = await harness.repository.reserveGitHubDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: verified.request.id,
        publicationId: verified.publication.id,
        expectedStateVersion: verified.request.stateVersion,
      },
      desktopPrincipal,
    )
    expect(reserved).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'pull_request_reserved',
      request: { stateVersion: 7, status: 'creating_pr' },
      pullRequest: {
        id: 'github-pr-outcome-6',
        version: 1,
        status: 'creating',
        pullRequestId: null,
        pullRequestNumber: null,
        safeUrl: null,
        draft: true,
        headBranch: 'devflow/run-1-pr-1',
        baseBranch: 'main',
        headSha: shaB,
        outcomeCode: null,
        redacted: true,
      },
    })
    if (!reserved.ok) throw new Error('fixture PR reservation failed')

    const completed = await harness.repository.finalizeGitHubDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: verified.request.id,
        pullRequestOutcomeId: reserved.pullRequest.id,
        expectedStateVersion: reserved.request.stateVersion,
        expectedPullRequestVersion: reserved.pullRequest.version,
        outcome: {
          status: 'completed',
          pullRequestId: '456789',
          pullRequestNumber: 42,
          safeUrl: 'https://github.com/example/project/pull/42',
          draft: true,
          repository: 'example/project',
          baseBranch: 'main',
          headBranch: 'devflow/run-1-pr-1',
          headSha: shaB,
          providerCreatedAt: '2026-08-11T10:01:02.000Z',
          outcomeCode: 'draft_pr_created',
        },
      },
      desktopPrincipal,
    )
    expect(completed).toMatchObject({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'pull_request_completed',
      request: {
        stateVersion: 8,
        status: 'completed',
        outcomeCode: 'draft_pr_created',
      },
      pullRequest: {
        version: 2,
        status: 'completed',
        pullRequestId: '456789',
        pullRequestNumber: 42,
        safeUrl: 'https://github.com/example/project/pull/42',
        draft: true,
        headSha: shaB,
        outcomeCode: 'draft_pr_created',
      },
    })
    expect(
      'mergeGitHubPullRequest' in harness.repository ||
        'deleteGitHubBranch' in harness.repository ||
        'closeGitHubPullRequest' in harness.repository,
    ).toBe(false)
  })

  it('reuses the same Draft PR outcome row for explicit reconciliation', async () => {
    const harness = createHarness()
    const verified = await createVerifiedPublication(harness)
    const reserved = await harness.repository.reserveGitHubDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: verified.request.id,
        publicationId: verified.publication.id,
        expectedStateVersion: verified.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!reserved.ok) throw new Error('fixture PR reservation failed')
    const recovery = await harness.repository.finalizeGitHubDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: verified.request.id,
        pullRequestOutcomeId: reserved.pullRequest.id,
        expectedStateVersion: reserved.request.stateVersion,
        expectedPullRequestVersion: reserved.pullRequest.version,
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'pull_request_failed',
        },
      },
      desktopPrincipal,
    )
    if (!recovery.ok) throw new Error('fixture PR recovery failed')

    await expect(
      harness.repository.reserveGitHubDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: verified.request.id,
          publicationId: verified.publication.id,
          expectedStateVersion: recovery.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { status: 'creating_pr', outcomeCode: null },
      pullRequest: {
        id: reserved.pullRequest.id,
        version: 3,
        status: 'creating',
        outcomeCode: null,
      },
    })
  })
})
