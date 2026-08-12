import { createHash } from 'node:crypto'
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

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function expectedIntentDigest(intent: GitHubDeliveryIntent): string {
  return sha256Text(JSON.stringify({
    stateVersion: intent.stateVersion,
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    runVersion: intent.runVersion,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    installationId: intent.installationId,
    repositoryId: intent.repositoryId,
    codingRunId: intent.codingRunId,
    codingRunCompletedAt: intent.codingRunCompletedAt,
    workspaceId: intent.workspaceId,
    deliverySeriesKey: intent.deliverySeriesKey,
    deliveryAttempt: intent.deliveryAttempt,
    repository: intent.repository,
    baseBranch: intent.baseBranch,
    headBranch: intent.headBranch,
    baseCommitSha: intent.baseCommitSha,
    expectedCommitSha: intent.expectedCommitSha,
    diffArtifactId: intent.diffArtifactId,
    diffSourceDigest: intent.diffSourceDigest,
    testEvidenceId: intent.testEvidenceId,
    testEvidenceCreatedAt: intent.testEvidenceCreatedAt,
    testEvidenceDigest: intent.testEvidenceDigest,
    prPackageArtifactId: intent.prPackageArtifactId,
    prPackageUpdatedAt: intent.prPackageUpdatedAt,
    prPackageDigest: intent.prPackageDigest,
    changedPaths: intent.changedPaths,
  }))
}

function expectedDeliverySeriesKey(intent: GitHubDeliveryIntent): string {
  return `github-delivery:${sha256Text(JSON.stringify({
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    workspaceId: intent.workspaceId,
  }))}`
}

function expectedLogicalDeliveryKey(intent: GitHubDeliveryIntent): string {
  return `github-delivery:${sha256Text(JSON.stringify({
    deliverySeriesKey: intent.deliverySeriesKey,
    deliveryAttempt: intent.deliveryAttempt,
  }))}`
}

function deliveryIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  const intent: GitHubDeliveryIntent = {
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
    deliverySeriesKey: `github-delivery:${'f'.repeat(64)}`,
    deliveryAttempt: 1,
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
    intentDigest: 'd'.repeat(64),
    idempotencyKey: `github-delivery:${'e'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T09:58:00.000Z',
    updatedAt: '2026-08-11T09:58:00.000Z',
    redacted: true,
    ...overrides,
  }
  if (!Object.hasOwn(overrides, 'deliverySeriesKey')) {
    intent.deliverySeriesKey = expectedDeliverySeriesKey(intent)
  }
  if (!Object.hasOwn(overrides, 'intentDigest')) {
    intent.intentDigest = expectedIntentDigest(intent)
  }
  if (!Object.hasOwn(overrides, 'idempotencyKey')) {
    intent.idempotencyKey = expectedLogicalDeliveryKey(intent)
  }
  return intent
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
        providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
        repositoryId: '98765',
        permission: 'contents:write',
        repositoryCount: 1,
      },
    },
    desktopPrincipal,
  )
  if (!finalized.ok) throw new Error('fixture grant finalize failed')
  return {
    ...finalized,
    clearanceAuthority: reserved.clearanceAuthority,
  }
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

  it('rejects a post-revocation credential probe before grant reservation or provider issuance', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)
    await harness.repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )
    const revokedRequest = harness.repository
      .inspectForTests()
      .requests.find((request) => request.id === approved.request.id)
    if (!revokedRequest) throw new Error('fixture revoked request missing')

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: revokedRequest.id,
          expectedStateVersion: revokedRequest.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
    })
    expect(harness.repository.inspectForTests().grants).toHaveLength(0)
  })

  it('quarantines an unresolved unissued grant indefinitely until exact confirmation', async () => {
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
    if (!reserved.ok) throw new Error('fixture grant reservation failed')
    await harness.repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )
    const expectedStateVersion = reserved.request.stateVersion + 1

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: reserved.request.id,
          expectedStateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'credential_revocation_pending',
    })

    const confirmed = await harness.repository.confirmGitHubCredentialClearance(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: reserved.request.id,
        grantId: reserved.grant.id,
        outcomeCode: 'credential_revocation_confirmed',
      },
      reserved.clearanceAuthority,
    )
    expect(confirmed).toMatchObject({
      ok: true,
      replayed: false,
      outcomeCode: 'credential_revocation_confirmed',
      grant: {
        id: reserved.grant.id,
        status: 'revoked',
        outcomeCode: 'credential_revocation_confirmed',
      },
    })
    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({ ok: true, replayed: true })
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: reserved.request.id,
          expectedStateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'binding_inactive' })

    const second = createHarness()
    const secondApproved = await createApprovedDelivery(second)
    const secondReserved = await second.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: secondApproved.request.id,
        expectedStateVersion: secondApproved.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!secondReserved.ok) throw new Error('fixture second reservation failed')
    await second.repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )
    second.setTime('2036-08-11T11:09:00.000Z')
    await expect(
      second.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: secondReserved.request.id,
          expectedStateVersion: secondReserved.request.stateVersion + 1,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'credential_revocation_pending',
    })
  })

  it('settles an issuing grant through its server capability after the Desktop bearer is revoked', async () => {
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
    if (!reserved.ok) throw new Error('fixture grant reservation failed')
    expect(Object.keys(reserved)).not.toContain('clearanceAuthority')
    expect(JSON.stringify(reserved)).not.toMatch(
      /clearanceAuthority|desktop-token-1/u,
    )
    harness.authorizedDesktopTokens.delete('org-a:project-a:desktop-token-1')

    await expect(
      harness.repository.finalizeGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          expectedStateVersion: reserved.request.stateVersion,
          expectedGrantVersion: reserved.grant.version,
          outcome: {
            status: 'failed',
            outcomeCode: 'credential_issue_failed',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'project_forbidden' })

    const confirmed = await harness.repository.confirmGitHubCredentialClearance(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: reserved.request.id,
        grantId: reserved.grant.id,
        outcomeCode: 'credential_mint_absent_confirmed',
      },
      reserved.clearanceAuthority,
    )
    expect(confirmed).toMatchObject({
      ok: true,
      replayed: false,
      outcomeCode: 'credential_mint_absent_confirmed',
      request: {
        id: reserved.request.id,
        projectId: 'project-a',
        stateVersion: reserved.request.stateVersion + 1,
        status: 'failed',
        outcomeCode: 'credential_issue_failed',
      },
      grant: {
        id: reserved.grant.id,
        requestId: reserved.request.id,
        status: 'failed',
        issuedAt: null,
        credentialExpiresAt: null,
        outcomeCode: 'credential_mint_absent_confirmed',
      },
    })
    if (!confirmed.ok) throw new Error('fixture grant clearance failed')
    harness.authorizedDesktopTokens.add('org-a:project-a:desktop-token-1')
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: confirmed.request.id,
          expectedStateVersion: confirmed.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { status: 'publishing_branch' },
      grant: { attempt: 2, status: 'issuing' },
    })
    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_mint_absent_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      outcomeCode: 'credential_mint_absent_confirmed',
      grant: {
        id: reserved.grant.id,
        outcomeCode: 'credential_mint_absent_confirmed',
      },
    })
  })

  it('blocks a later delivery attempt while the same series has an unresolved credential', async () => {
    const harness = createHarness()
    const firstApproved = await createApprovedDelivery(harness)
    const first = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: firstApproved.request.id,
        expectedStateVersion: firstApproved.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!first.ok) throw new Error('fixture first reservation failed')
    const firstFailed = await harness.repository.finalizeGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: first.request.id,
        grantId: first.grant.id,
        expectedStateVersion: first.request.stateVersion,
        expectedGrantVersion: first.grant.version,
        outcome: {
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      },
      desktopPrincipal,
    )
    if (!firstFailed.ok) throw new Error('fixture first failure failed')
    const secondIntent = deliveryIntent({
      id: 'local-intent-2',
      deliveryAttempt: 2,
    })
    const secondCreated = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: secondIntent,
        prTitle: 'Retry the reviewed change',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )
    if (!secondCreated.ok) throw new Error('fixture second request failed')
    const secondApproved = await harness.repository.decideGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        requestId: secondCreated.request.id,
        decision: 'approve',
        expectedStateVersion: secondCreated.request.stateVersion,
      },
      leadPrincipal,
    )
    if (!secondApproved.ok) throw new Error('fixture second approval failed')

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: secondApproved.request.id,
          expectedStateVersion: secondApproved.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'credential_revocation_pending',
    })
    expect(harness.repository.inspectForTests().grants).toEqual([
      expect.objectContaining({
        id: first.grant.id,
        issuedAt: null,
        outcomeCode: 'credential_issue_failed',
      }),
    ])

    await harness.repository.confirmGitHubCredentialClearance(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: first.request.id,
        grantId: first.grant.id,
        outcomeCode: 'credential_mint_absent_confirmed',
      },
      first.clearanceAuthority,
    )
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: secondApproved.request.id,
          expectedStateVersion: secondApproved.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: true, grant: { attempt: 1 } })
  })

  it('blocks a different series on an updated active binding until its historical unissued grant is confirmed', async () => {
    const harness = createHarness()
    const first = await createApprovedDelivery(harness)
    const reserved = await harness.repository.reserveGitHubCredentialGrant({
      projectId: 'project-a',
      requestId: first.request.id,
      expectedStateVersion: first.request.stateVersion,
    }, desktopPrincipal)
    if (!reserved.ok) throw new Error('fixture first reserve failed')
    harness.setTime('2026-08-11T10:01:00.000Z')
    const updated = await harness.repository.upsertGitHubRepositoryBinding({
      projectId: 'project-a',
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      defaultBranch: 'main',
      verifiedAt: '2026-08-11T10:01:00.000Z',
      expectedStateVersion: 1,
    }, ownerPrincipal)
    if (!updated.ok) throw new Error('fixture binding update failed')
    const secondIntent = deliveryIntent({
      id: 'local-intent-2',
      repositoryBindingVersion: updated.binding.version,
      workspaceId: 'workspace-2',
      codingRunId: 'coding-2',
      diffArtifactId: 'diff-2',
      testEvidenceId: 'test-2',
      prPackageArtifactId: 'package-2',
    })
    const second = await harness.repository.createOrReviseGitHubDeliveryRequest({
      projectId: 'project-a',
      intent: secondIntent,
      prTitle: 'Second reviewed change',
      prBody: 'Different series on the same binding identity.',
      expectedStateVersion: 0,
    }, desktopPrincipal)
    if (!second.ok) throw new Error('fixture second request failed')
    const approved = await harness.repository.decideGitHubDeliveryRequest({
      projectId: 'project-a',
      requestId: second.request.id,
      decision: 'approve',
      expectedStateVersion: second.request.stateVersion,
    }, leadPrincipal)
    if (!approved.ok) throw new Error('fixture second approval failed')
    await expect(harness.repository.reserveGitHubCredentialGrant({
      projectId: 'project-a',
      requestId: second.request.id,
      expectedStateVersion: approved.request.stateVersion,
    }, desktopPrincipal)).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'credential_revocation_pending',
    })
    const cleared = await harness.repository.confirmGitHubCredentialClearance({
      organizationId: 'org-a',
      projectId: 'project-a',
      requestId: reserved.request.id,
      grantId: reserved.grant.id,
      outcomeCode: 'credential_mint_absent_confirmed',
    }, reserved.clearanceAuthority)
    if (!cleared.ok) throw new Error('fixture old grant confirmation failed')
    await expect(harness.repository.reserveGitHubCredentialGrant({
      projectId: 'project-a',
      requestId: second.request.id,
      expectedStateVersion: approved.request.stateVersion,
    }, desktopPrincipal)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { status: 'issuing', attempt: 1 },
    })
  })

  it('clears one exact issued commit after provider revocation but never treats it as mint absence', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: issued.request.id,
          grantId: issued.grant.id,
          outcomeCode: 'credential_mint_absent_confirmed',
        },
        issued.clearanceAuthority,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'grant_conflict' })

    const cleared =
      await harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: issued.request.id,
          grantId: issued.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        issued.clearanceAuthority,
      )
    expect(cleared).toMatchObject({
      ok: true,
      replayed: false,
      request: {
        stateVersion: issued.request.stateVersion + 1,
        status: 'failed',
        outcomeCode: 'credential_issue_failed',
      },
      grant: {
        version: issued.grant.version + 1,
        status: 'revoked',
        issuedAt: issued.grant.issuedAt,
        credentialExpiresAt: issued.grant.credentialExpiresAt,
        consumedAt: null,
        outcomeCode: 'credential_revocation_confirmed',
      },
    })
    if (!cleared.ok) throw new Error('fixture issued clearance failed')
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: cleared.request.id,
          expectedStateVersion: cleared.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { attempt: 2, status: 'issuing' },
    })
  })

  it('accepts only the exact repository-issued capability and exact reservation scope', async () => {
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
    if (!reserved.ok) throw new Error('fixture grant reservation failed')

    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        Object.freeze(Object.create(null)) as typeof reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'authentication_forbidden',
    })
    const otherRepositoryInstance = createHarness()
    await expect(
      otherRepositoryInstance.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'authentication_forbidden',
    })
    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-other',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'project_forbidden' })
    expect(
      harness.repository.inspectForTests().grants.find(
        (grant) => grant.id === reserved.grant.id,
      ),
    ).toMatchObject({ status: 'issuing', outcomeCode: null })

    const failed = await harness.repository.finalizeGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: reserved.request.id,
        grantId: reserved.grant.id,
        expectedStateVersion: reserved.request.stateVersion,
        expectedGrantVersion: reserved.grant.version,
        outcome: {
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      },
      desktopPrincipal,
    )
    if (!failed.ok) throw new Error('fixture grant failure finalization failed')

    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_revocation_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'credential_revocation_confirmed',
      grant: { status: 'failed' },
    })
    await expect(
      harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: reserved.request.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_mint_absent_confirmed',
        },
        reserved.clearanceAuthority,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'grant_conflict' })
  })

  it('returns one redacted recovery snapshot for the exact paired Desktop claimant', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)

    await expect(
      harness.repository.getGitHubDeliveryRecoverySnapshot(
        'project-a',
        issued.request.id,
        desktopPrincipal,
      ),
    ).resolves.toEqual({
      request: issued.request,
      approval: expect.objectContaining({
        requestId: issued.request.id,
        redacted: true,
      }),
      grant: issued.grant,
      publication: null,
      pullRequest: null,
    })
    const snapshot = await harness.repository.getGitHubDeliveryRecoverySnapshot(
      'project-a',
      issued.request.id,
      desktopPrincipal,
    )
    expect(JSON.stringify(snapshot)).not.toMatch(
      /authorization|access.token|private.key|raw.response|workspace.path|stdout|stderr/i,
    )
  })

  it('does not replace a still-live issued credential after its response is lost', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)

    const replacement = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: issued.request.id,
        expectedStateVersion: issued.request.stateVersion,
      },
      desktopPrincipal,
    )

    expect(replacement).toMatchObject({
      ok: true,
      replayed: true,
      request: issued.request,
      grant: issued.grant,
    })
    expect(harness.repository.inspectForTests().grants).toEqual([
      expect.objectContaining({
        id: issued.grant.id,
        status: 'issued',
        outcomeCode: null,
      }),
    ])
  })

  it('releases an issued response-loss quarantine only from an exact provider expiry observation', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    const replayed = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: issued.request.id,
        expectedStateVersion: issued.request.stateVersion,
      },
      desktopPrincipal,
    )
    if (!replayed.ok) throw new Error('fixture grant replay failed')

    const confirmed = await harness.repository.confirmGitHubCredentialProviderExpiry(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: replayed.request.id,
        grantId: replayed.grant.id,
        providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
        providerExpiryObservedAt: '2026-08-11T10:45:03.000Z',
      },
      replayed.clearanceAuthority,
    )

    expect(confirmed).toMatchObject({
      ok: true,
      replayed: false,
      outcomeCode: 'credential_provider_expiry_confirmed',
      request: {
        stateVersion: issued.request.stateVersion + 1,
        status: 'recovery_required',
        outcomeCode: 'credential_issue_failed',
      },
      grant: {
        version: issued.grant.version + 1,
        status: 'expired',
        providerExpiryContractVersion: 1,
        providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
        providerExpiryObservedAt: '2026-08-11T10:45:03.000Z',
        outcomeCode: 'credential_provider_expiry_confirmed',
      },
    })
    await expect(
      harness.repository.confirmGitHubCredentialProviderExpiry(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: replayed.request.id,
          grantId: replayed.grant.id,
          providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
          providerExpiryObservedAt: '2026-08-11T10:45:03.000Z',
        },
        replayed.clearanceAuthority,
      ),
    ).resolves.toMatchObject({ ok: true, replayed: true })
    if (!confirmed.ok) throw new Error('fixture provider expiry confirmation failed')

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          expectedStateVersion: confirmed.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { status: 'issuing', attempt: 2 },
    })
  })

  it.each([
    [
      'an early observation',
      '2026-08-11T10:45:01.000Z',
      '2026-08-11T10:45:02.999Z',
    ],
    [
      'a mismatched raw expiry',
      '2026-08-11T10:45:00.000Z',
      '2026-08-11T10:45:03.000Z',
    ],
  ])('fails closed on provider expiry confirmation from %s', async (
    _case,
    providerCredentialExpiresAt,
    providerExpiryObservedAt,
  ) => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    const replayed = await harness.repository.reserveGitHubCredentialGrant({
      projectId: 'project-a',
      requestId: issued.request.id,
      expectedStateVersion: issued.request.stateVersion,
    }, desktopPrincipal)
    if (!replayed.ok) throw new Error('fixture replay failed')
    await expect(harness.repository.confirmGitHubCredentialProviderExpiry({
      organizationId: 'org-a',
      projectId: 'project-a',
      requestId: issued.request.id,
      grantId: issued.grant.id,
      providerCredentialExpiresAt,
      providerExpiryObservedAt,
    }, replayed.clearanceAuthority)).resolves.toMatchObject({ ok: false })
    expect(harness.repository.inspectForTests().grants).toMatchObject([
      { id: issued.grant.id, status: 'issued', outcomeCode: null },
    ])
  })

  it('rejects a forged provider expiry capability', async () => {
    const harness = createHarness()
    const issued = await createIssuedGrant(harness)
    await expect(harness.repository.confirmGitHubCredentialProviderExpiry({
      organizationId: 'org-a',
      projectId: 'project-a',
      requestId: issued.request.id,
      grantId: issued.grant.id,
      providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
      providerExpiryObservedAt: '2026-08-11T10:45:03.000Z',
    }, Object.freeze(Object.create(null)) as typeof issued.clearanceAuthority))
      .resolves.toMatchObject({
        ok: false,
        outcomeCode: 'authentication_forbidden',
      })
  })

  it('fails closed after three credential attempts for one approved intent revision', async () => {
    const harness = createHarness()
    const approved = await createApprovedDelivery(harness)
    let currentRequest = approved.request
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const reserved = await harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: currentRequest.id,
          expectedStateVersion: currentRequest.stateVersion,
        },
        desktopPrincipal,
      )
      if (!reserved.ok) throw new Error(`fixture grant ${attempt} reservation failed`)
      expect(reserved.grant.attempt).toBe(attempt)
      const failed = await harness.repository.finalizeGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: currentRequest.id,
          grantId: reserved.grant.id,
          expectedStateVersion: reserved.request.stateVersion,
          expectedGrantVersion: reserved.grant.version,
          outcome: {
            status: 'failed',
            outcomeCode: 'credential_issue_failed',
          },
        },
        desktopPrincipal,
      )
      if (!failed.ok) throw new Error(`fixture grant ${attempt} failure failed`)
      const cleared = await harness.repository.confirmGitHubCredentialClearance(
        {
          organizationId: 'org-a',
          projectId: 'project-a',
          requestId: currentRequest.id,
          grantId: reserved.grant.id,
          outcomeCode: 'credential_mint_absent_confirmed',
        },
        reserved.clearanceAuthority,
      )
      if (!cleared.ok) throw new Error(`fixture grant ${attempt} clearance failed`)
      currentRequest = failed.request
    }

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: currentRequest.id,
          expectedStateVersion: currentRequest.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'grant_conflict',
      replayed: false,
    })
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
        intentDigest: input.intent.intentDigest,
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
        intentDigest: deliveryIntent({
          testEvidenceId: 'test-2',
          testEvidenceDigest: 'f'.repeat(64),
        }).intentDigest,
      },
    })
    expect(JSON.stringify(revised)).not.toMatch(
      /authorization|access.token|private.key|raw.response|workspace.path|stdout|stderr/i,
    )
  })

  it('creates only the next delivery attempt after a rejected request without regressing the terminal request', async () => {
    const harness = createHarness()
    await createBinding(harness)
    const first = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: deliveryIntent(),
        prTitle: 'Deliver the reviewed change',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )
    if (!first.ok) throw new Error('fixture delivery create failed')
    const rejected = await harness.repository.decideGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        requestId: first.request.id,
        decision: 'reject',
        expectedStateVersion: first.request.stateVersion,
      },
      leadPrincipal,
    )
    if (!rejected.ok) throw new Error('fixture delivery rejection failed')

    const skippedAttempt = deliveryIntent({
      id: 'local-intent-3',
      deliveryAttempt: 3,
    })
    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: skippedAttempt,
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'intent_conflict' })

    const nextAttempt = deliveryIntent({
      id: 'local-intent-2',
      deliveryAttempt: 2,
    })
    const retried = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: nextAttempt,
        prTitle: 'Deliver the reviewed change',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )

    expect(retried).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'delivery_created',
      request: {
        id: expect.not.stringMatching(first.request.id),
        deliverySeriesKey: nextAttempt.deliverySeriesKey,
        deliveryAttempt: 2,
        intentRevision: 1,
        status: 'approval_required',
      },
    })
    expect(harness.repository.inspectForTests().requests).toEqual([
      expect.objectContaining({
        id: first.request.id,
        deliveryAttempt: 1,
        status: 'revoked',
        outcomeCode: 'approval_rejected',
      }),
      expect.objectContaining({
        deliveryAttempt: 2,
        status: 'approval_required',
      }),
    ])
  })

  it('does not extend a delivery request beyond its original 24-hour lifetime', async () => {
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
    expect(created.request.expiresAt).toBe('2026-08-12T10:00:00.000Z')

    harness.setTime('2026-08-12T09:59:00.000Z')
    const revised = await harness.repository.createOrReviseGitHubDeliveryRequest(
      {
        ...input,
        intent: deliveryIntent({
          testEvidenceId: 'test-2',
          testEvidenceDigest: 'f'.repeat(64),
        }),
        expectedStateVersion: created.request.stateVersion,
      },
      desktopPrincipal,
    )
    expect(revised).toMatchObject({
      ok: true,
      request: { stateVersion: 2, expiresAt: '2026-08-12T10:00:00.000Z' },
    })

    harness.setTime('2026-08-12T10:00:00.000Z')
    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        {
          ...input,
          intent: deliveryIntent({
            testEvidenceId: 'test-3',
            testEvidenceDigest: '2'.repeat(64),
          }),
          expectedStateVersion: 2,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'expired' })
  })

  it.each([
    [
      'a tampered intent digest',
      deliveryIntent({ intentDigest: '0'.repeat(64) }),
      'Deliver the reviewed change',
      'Bound to passing Test Evidence.',
    ],
    [
      'a local path disguised as an identifier',
      deliveryIntent({ workspaceId: '/Users/example/private/worktree' }),
      'Deliver the reviewed change',
      'Bound to passing Test Evidence.',
    ],
    [
      'credential material in a changed path',
      deliveryIntent({
        changedPaths: ['fixtures/ghp_123456789012345678901234.txt'],
      }),
      'Deliver the reviewed change',
      'Bound to passing Test Evidence.',
    ],
    [
      'credential material in PR copy',
      deliveryIntent(),
      'Deliver the reviewed change',
      'Read /Users/example/private/repo with ghp_123456789012345678901234.',
    ],
  ])('rejects %s before Seed persistence', async (_label, intent, prTitle, prBody) => {
    const harness = createHarness()
    await createBinding(harness)

    await expect(
      harness.repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent,
          prTitle,
          prBody,
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(harness.repository.inspectForTests().requests).toEqual([])
    expect(JSON.stringify(harness.repository.inspectForTests())).not.toMatch(
      /ghp_123456789012345678901234|\/Users\/example\/private/u,
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
        intentDigest: input.intent.intentDigest,
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
      intentDigest: input.intent.intentDigest,
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
          providerCredentialExpiresAt: '2026-08-11T10:45:01.000Z',
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

  it('does not replace an ambiguous recoverable issuance failure', async () => {
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
      ok: false,
      replayed: false,
      outcomeCode: 'credential_revocation_pending',
    })
    expect(harness.repository.inspectForTests().grants).toMatchObject([
      { id: first.grant.id, status: 'recovery_required', attempt: 1 },
    ])

    const cleared = await harness.repository.confirmGitHubCredentialClearance(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: first.request.id,
        grantId: first.grant.id,
        outcomeCode: 'credential_revocation_confirmed',
      },
      first.clearanceAuthority,
    )
    expect(cleared).toMatchObject({
      ok: true,
      grant: {
        status: 'failed',
        issuedAt: null,
        outcomeCode: 'credential_revocation_confirmed',
      },
    })
    if (!cleared.ok) throw new Error('fixture recovery clearance failed')
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: cleared.request.id,
          expectedStateVersion: cleared.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { attempt: 2, status: 'issuing' },
    })
  })

  it('creates a new attempt only after provider absence is durably confirmed', async () => {
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
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      },
      desktopPrincipal,
    )
    if (!failed.ok) throw new Error('fixture grant failure failed')
    const cleared = await harness.repository.confirmGitHubCredentialClearance(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: approved.request.id,
        grantId: first.grant.id,
        outcomeCode: 'credential_mint_absent_confirmed',
      },
      first.clearanceAuthority,
    )
    if (!cleared.ok) throw new Error('fixture absence confirmation failed')

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: approved.request.id,
          expectedStateVersion: failed.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { attempt: 2, status: 'issuing' },
    })
  })

  it('never replaces an ambiguous issuing credential solely because its lease elapsed', async () => {
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

    harness.setTime('2026-08-11T10:01:59.999Z')
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: approved.request.id,
          expectedStateVersion: first.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toEqual({ ...first, replayed: true })

    harness.setTime('2026-08-11T10:02:00.000Z')
    const recovered = await harness.repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: approved.request.id,
        expectedStateVersion: first.request.stateVersion,
      },
      desktopPrincipal,
    )
    expect(recovered).toEqual({ ...first, replayed: true })
    expect(harness.repository.inspectForTests().grants).toMatchObject([
      {
        id: first.grant.id,
        version: 1,
        status: 'issuing',
        outcomeCode: null,
      },
    ])

    await expect(
      harness.repository.finalizeGitHubCredentialGrant(
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
      ),
    ).resolves.toMatchObject({ ok: true, outcomeCode: 'grant_finalized' })
  })

  it('fails closed when an issuing credential outlives its delivery request', async () => {
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
    harness.setTime('2026-08-12T10:00:00.000Z')

    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: approved.request.id,
          expectedStateVersion: first.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'expired' })
    expect(harness.repository.inspectForTests().grants).toHaveLength(1)
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
            providerCredentialExpiresAt: '2026-08-11T11:10:01.000Z',
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

  it('never replaces a consumed credential without provider clearance', async () => {
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
    if (!recovery.ok) throw new Error('fixture publication recovery failed')

    harness.setTime('2026-08-11T10:02:00.000Z')
    await expect(
      harness.repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: issued.request.id,
          expectedStateVersion: recovery.request.stateVersion,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      request: { status: 'recovery_required' },
      grant: { attempt: 1, status: 'consumed' },
    })

    expect(harness.repository.inspectForTests().grants).toHaveLength(1)
  })

  it('rechecks canonical Run authority after remote branch lookup and before finalization', async () => {
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
    if (!reported.ok) throw new Error('fixture publication report failed')
    harness.setCanonicalRunAuthority({ runVersion: 8 })

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
            verifiedHeadSha: shaB,
            verifiedAt: '2026-08-11T10:01:01.000Z',
            outcomeCode: 'branch_verified',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
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
          providerCreatedAt: '2026-08-11T09:50:00.000Z',
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
        providerCreatedAt: '2026-08-11T09:50:00.000Z',
        recordedAt: '2026-08-11T10:00:00.000Z',
        outcomeCode: 'draft_pr_created',
      },
    })
    expect(
      'mergeGitHubPullRequest' in harness.repository ||
        'deleteGitHubBranch' in harness.repository ||
        'closeGitHubPullRequest' in harness.repository,
    ).toBe(false)
  })

  it('rejects a Draft PR creation timestamp later than the API observation', async () => {
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

    await expect(
      harness.repository.finalizeGitHubDraftPullRequest(
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
            providerCreatedAt: '2026-08-11T10:00:00.001Z',
            outcomeCode: 'draft_pr_created',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'pull_request_conflict' })
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

  it('rechecks canonical Run authority after GitHub PR creation and before finalization', async () => {
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
    harness.setCanonicalRunAuthority({ currentNodeId: 'acceptance-1' })

    await expect(
      harness.repository.finalizeGitHubDraftPullRequest(
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
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
  })
})
