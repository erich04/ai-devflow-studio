import { describe, expect, it, vi } from 'vitest'
import type {
  GitHubDeliveryIntent,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  GitHubDeliveryServiceError,
  type GitHubDeliveryService,
} from '../github-delivery-service'
import type {
  GitHubBranchPublication,
  GitHubCredentialGrant,
  GitHubDeliveryApproval,
  GitHubDeliveryRepository,
  GitHubDeliveryRequest,
  GitHubPullRequestOutcome,
} from '../repositories/github-delivery-contract'
import { resolveGitHubDeliveryRoute } from './github-delivery-routes'

const now = '2026-08-11T15:00:00.000Z'

const cookieOwner: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner',
    organizationId: 'org-a',
    userId: 'user-owner',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

const desktopMember: RequestPrincipal = {
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

const developmentOwner: RequestPrincipal = {
  ...cookieOwner,
  authentication: { kind: 'development_header', tokenRecordId: null },
}

const cookieMember: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-member',
    organizationId: 'org-a',
    userId: 'user-member',
    role: 'member',
    projectMemberships: [
      { projectId: 'project-a', userId: 'user-member', role: 'member' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

function binding(
  overrides: Partial<GitHubRepositoryBinding> = {},
): GitHubRepositoryBinding {
  return {
    stateVersion: 1,
    id: 'binding-1',
    version: 1,
    organizationId: 'org-a',
    teamProjectId: 'project-a',
    installationId: '12345',
    repositoryId: '98765',
    repository: 'example/project',
    defaultBranch: 'main',
    status: 'active',
    validatedAt: now,
    updatedAt: now,
    redacted: true,
    ...overrides,
  }
}

function deliveryRequest(
  overrides: Partial<GitHubDeliveryRequest> = {},
): GitHubDeliveryRequest {
  return {
    id: 'delivery-1',
    stateVersion: 2,
    intentRevision: 1,
    organizationId: 'org-a',
    projectId: 'project-a',
    requestedByUserId: 'user-desktop',
    localIntentId: 'intent-1',
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    repository: 'example/project',
    codingRunId: 'coding-1',
    workspaceId: 'workspace-1',
    diffArtifactId: 'diff-1',
    testEvidenceId: 'test-1',
    prPackageArtifactId: 'package-1',
    status: 'approval_required',
    outcomeCode: null,
    expectedRunVersion: 7,
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha: 'b'.repeat(40),
    intentDigest: 'c'.repeat(64),
    deliverySeriesKey: `github-delivery:${'2'.repeat(64)}`,
    deliveryAttempt: 1,
    logicalIdempotencyKey: `github-delivery:${'d'.repeat(64)}`,
    diffDigest: 'e'.repeat(64),
    testEvidenceDigest: 'f'.repeat(64),
    packageDigest: '1'.repeat(64),
    changedPaths: ['apps/api/src/example.ts'],
    prTitle: 'Deliver the approved change',
    prBody: 'Bound to exact evidence.',
    expiresAt: '2026-08-12T14:00:00.000Z',
    createdAt: '2026-08-11T14:00:00.000Z',
    updatedAt: now,
    redacted: true,
    ...overrides,
  }
}

function approval(
  overrides: Partial<GitHubDeliveryApproval> = {},
): GitHubDeliveryApproval {
  return {
    id: 'approval-1',
    requestId: 'delivery-1',
    intentRevision: 1,
    requestStateVersion: 2,
    intentDigest: 'c'.repeat(64),
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryId: '98765',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    expectedCommitSha: 'b'.repeat(40),
    testEvidenceDigest: 'f'.repeat(64),
    packageDigest: '1'.repeat(64),
    approvedByUserId: 'user-owner',
    approvedRole: 'owner',
    authenticationKind: 'session_cookie',
    approvedAt: now,
    redacted: true,
    ...overrides,
  }
}

function deliveryIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'intent-1',
    organizationId: 'org-a',
    teamProjectId: 'project-a',
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-1',
    codingRunCompletedAt: '2026-08-11T13:55:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'2'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'example/project',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha: 'b'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'e'.repeat(64),
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T13:56:00.000Z',
    testEvidenceDigest: 'f'.repeat(64),
    prPackageArtifactId: 'package-1',
    prPackageUpdatedAt: '2026-08-11T13:57:00.000Z',
    prPackageDigest: '1'.repeat(64),
    changedPaths: ['apps/api/src/example.ts'],
    intentDigest: 'c'.repeat(64),
    idempotencyKey: `github-delivery:${'d'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T14:00:00.000Z',
    updatedAt: '2026-08-11T14:00:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function credentialGrant(
  overrides: Partial<GitHubCredentialGrant> = {},
): GitHubCredentialGrant {
  return {
    id: 'grant-1',
    version: 2,
    requestId: 'delivery-1',
    intentRevision: 1,
    approvalId: 'approval-1',
    attempt: 1,
    repositoryId: '98765',
    permission: 'contents:write',
    repositoryCount: 1,
    status: 'issued',
    requestedAt: now,
    issuedAt: now,
    credentialExpiresAt: '2026-08-11T16:00:00.000Z',
    providerExpiryContractVersion: 1,
    providerCredentialExpiresAt: '2026-08-11T16:00:00.000Z',
    providerExpiryObservedAt: null,
    consumedAt: null,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function branchPublication(
  overrides: Partial<GitHubBranchPublication> = {},
): GitHubBranchPublication {
  return {
    id: 'publication-1',
    version: 2,
    requestId: 'delivery-1',
    intentRevision: 1,
    grantId: 'grant-1',
    sourcePublicationId: null,
    status: 'verified',
    reportedOutcomeCode: 'pushed',
    verifiedHeadSha: 'b'.repeat(40),
    reportedAt: now,
    verifiedAt: now,
    outcomeCode: 'branch_verified',
    redacted: true,
    ...overrides,
  }
}

function pullRequestOutcome(
  overrides: Partial<GitHubPullRequestOutcome> = {},
): GitHubPullRequestOutcome {
  return {
    id: 'pull-request-outcome-1',
    version: 2,
    requestId: 'delivery-1',
    intentRevision: 1,
    publicationId: 'publication-1',
    status: 'completed',
    pullRequestId: '456789',
    pullRequestNumber: 42,
    safeUrl: 'https://github.com/example/project/pull/42',
    draft: true,
    headBranch: 'devflow/run-1-pr-1',
    baseBranch: 'main',
    headSha: 'b'.repeat(40),
    providerCreatedAt: now,
    providerRetryNotBefore: null,
    recordedAt: now,
    outcomeCode: 'draft_pr_created',
    redacted: true,
    ...overrides,
  }
}

function createHarness() {
  const repository = {
    getGitHubRepositoryBinding: vi.fn(async () => binding()),
    listGitHubDeliveryRequests: vi.fn(async () => [deliveryRequest()]),
    decideGitHubDeliveryRequest: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'delivery_approved' as const,
      replayed: false,
      request: deliveryRequest({ stateVersion: 3, status: 'approved' }),
      approval: approval(),
    })),
    createOrReviseGitHubDeliveryRequest: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'delivery_created' as const,
      replayed: false,
      request: deliveryRequest(),
    })),
    listGitHubDeliveryInbox: vi.fn(async () => [deliveryRequest()]),
    getGitHubDeliveryRecoverySnapshot: vi.fn(async () => ({
      request: deliveryRequest({ stateVersion: 7, status: 'creating_pr' }),
      approval: approval(),
      grant: credentialGrant({ version: 3, status: 'consumed' }),
      publication: branchPublication({ version: 3 }),
      pullRequest: pullRequestOutcome({ version: 1, status: 'creating' }),
    })),
    authorizeGitHubDeliveryRecoveryLookup: vi.fn(async () => ({ ok: true as const })),
    finalizeGitHubCredentialGrant: vi.fn(async () => {
      throw new Error('route must not expose credential finalization')
    }),
    finalizeGitHubBranchPublication: vi.fn(async () => {
      throw new Error('route must not expose publication finalization')
    }),
    finalizeGitHubDraftPullRequest: vi.fn(async () => {
      throw new Error('route must not expose pull request finalization')
    }),
    revokeGitHubRepositoryBinding: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'binding_revoked' as const,
      replayed: false,
      binding: binding({ version: 2, status: 'revoked' }),
    })),
  } as unknown as GitHubDeliveryRepository
  const service = {
    configureRepositoryBinding: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'binding_created' as const,
      replayed: false,
      binding: binding(),
    })),
    issueCredentialGrant: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'grant_finalized' as const,
      replayed: false,
      request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
      grant: credentialGrant(),
      credential: {
        grantId: 'grant-1',
        username: 'x-access-token' as const,
        token: 'ghs_ephemeral_desktop_only',
        expiresAt: '2026-08-11T16:00:00.000Z',
        repositoryId: '98765',
        canonicalHttpsUrl: 'https://github.com/example/project.git',
        authorizationHeader: 'Bearer must-not-escape',
      },
    })),
    verifyBranchPublication: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'publication_verified' as const,
      replayed: false,
      request: deliveryRequest({ stateVersion: 6, status: 'branch_published' }),
      publication: branchPublication(),
    })),
    adoptVerifiedBranchPublication: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'publication_adopted' as const,
      replayed: false,
      request: deliveryRequest({ stateVersion: 4, status: 'branch_published' }),
      publication: branchPublication({
        id: 'publication-2',
        version: 1,
        grantId: null,
        sourcePublicationId: 'publication-1',
        reportedOutcomeCode: 'already_present',
      }),
    })),
    createDraftPullRequest: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'pull_request_completed' as const,
      replayed: false,
      request: deliveryRequest({ stateVersion: 8, status: 'completed' }),
      pullRequest: pullRequestOutcome(),
    })),
  } as unknown as GitHubDeliveryService
  return { repository, service }
}

describe('GitHub Delivery routes', () => {
  it('returns null outside its exact surface and authenticates recognized routes before parsing', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'DELETE',
        '/api/team/projects/project-a/github-repository-binding',
        harness.repository,
        harness.service,
        { principal: cookieOwner },
      ),
    ).resolves.toBeNull()
    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
        harness.repository,
        harness.service,
        { principal: null, body: { token: 'must-not-be-reflected' } },
      ),
    ).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    })
  })

  it('configures a Project binding from numeric GitHub authority through a signed owner session', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'PUT',
        '/api/team/projects/project-a/github-repository-binding',
        harness.repository,
        harness.service,
        {
          principal: cookieOwner,
          body: {
            installationId: '12345',
            repositoryId: '98765',
            expectedStateVersion: 0,
          },
        },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        binding: binding(),
        outcomeCode: 'binding_created',
        replayed: false,
      },
    })
    expect(harness.service.configureRepositoryBinding).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion: 0,
      },
      cookieOwner,
    )
  })

  it('returns only the redacted binding projection to a signed browser session', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.getGitHubRepositoryBinding).mockResolvedValue({
      ...binding(),
      privateKey: 'do-not-return',
    } as unknown as GitHubRepositoryBinding)

    const result = await resolveGitHubDeliveryRoute(
      'GET',
      '/api/team/projects/project-a/github-repository-binding',
      harness.repository,
      harness.service,
      { principal: cookieOwner },
    )

    expect(result).toEqual({ status: 200, body: { binding: binding() } })
    expect(JSON.stringify(result)).not.toContain('privateKey')
    expect(harness.repository.getGitHubRepositoryBinding).toHaveBeenCalledWith(
      'project-a',
      cookieOwner,
    )
  })

  it('returns the exact redacted Project binding to the paired Desktop bearer only', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.getGitHubRepositoryBinding).mockResolvedValue({
      ...binding({ version: 2, status: 'revoked' }),
      privateKey: 'do-not-return',
      localPath: '/private/repository',
    } as unknown as GitHubRepositoryBinding)

    const result = await resolveGitHubDeliveryRoute(
      'GET',
      '/api/desktop/projects/project-a/github-repository-binding',
      harness.repository,
      harness.service,
      { principal: desktopMember },
    )

    expect(result).toEqual({
      status: 200,
      body: { binding: binding({ version: 2, status: 'revoked' }) },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /privateKey|localPath|private\/repository/u,
    )
    expect(harness.repository.getGitHubRepositoryBinding).toHaveBeenCalledWith(
      'project-a',
      desktopMember,
    )

    vi.mocked(
      harness.repository.getGitHubRepositoryBinding,
    ).mockResolvedValue(null)
    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/desktop/projects/project-a/github-repository-binding',
        harness.repository,
        harness.service,
        { principal: desktopMember },
      ),
    ).resolves.toEqual({ status: 200, body: { binding: null } })
  })

  it('revokes a binding through a distinct owner-only action', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/team/projects/project-a/github-repository-binding/revoke',
        harness.repository,
        harness.service,
        { principal: cookieOwner, body: { expectedStateVersion: 1 } },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        binding: binding({ version: 2, status: 'revoked' }),
        outcomeCode: 'binding_revoked',
        replayed: false,
      },
    })
    expect(harness.repository.revokeGitHubRepositoryBinding).toHaveBeenCalledWith(
      { projectId: 'project-a', expectedStateVersion: 1 },
      cookieOwner,
    )
  })

  it('lists only redacted delivery projections for an accessible signed browser session', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.listGitHubDeliveryRequests).mockResolvedValue([
      {
        ...deliveryRequest(),
        token: 'ghs_must_not_escape',
      } as unknown as GitHubDeliveryRequest,
    ])

    const result = await resolveGitHubDeliveryRoute(
      'GET',
      '/api/team/projects/project-a/github-deliveries',
      harness.repository,
      harness.service,
      { principal: cookieOwner },
    )

    expect(result).toEqual({
      status: 200,
      body: { requests: [deliveryRequest()] },
    })
    expect(JSON.stringify(result)).not.toContain('ghs_must_not_escape')
  })

  it('records an exact signed lead or owner approval without accepting intent fields', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/team/projects/project-a/github-deliveries/delivery-1/approve',
        harness.repository,
        harness.service,
        { principal: cookieOwner, body: { expectedStateVersion: 2 } },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        request: deliveryRequest({ stateVersion: 3, status: 'approved' }),
        approval: approval(),
        outcomeCode: 'delivery_approved',
        replayed: false,
      },
    })
    expect(harness.repository.decideGitHubDeliveryRequest).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        decision: 'approve',
        expectedStateVersion: 2,
      },
      cookieOwner,
    )
  })

  it('records a signed rejection without creating an approval', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.decideGitHubDeliveryRequest).mockResolvedValue({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'delivery_rejected',
      replayed: false,
      request: deliveryRequest({
        stateVersion: 3,
        status: 'revoked',
        outcomeCode: 'approval_rejected',
      }),
      approval: null,
    })

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/team/projects/project-a/github-deliveries/delivery-1/reject',
        harness.repository,
        harness.service,
        { principal: cookieOwner, body: { expectedStateVersion: 2 } },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        approval: null,
        outcomeCode: 'delivery_rejected',
      },
    })
    expect(harness.repository.decideGitHubDeliveryRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'reject' }),
      cookieOwner,
    )
  })

  it('submits an exact local Delivery Intent only through paired Desktop bearer authority', async () => {
    const harness = createHarness()
    const intent = deliveryIntent()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries',
        harness.repository,
        harness.service,
        {
          principal: desktopMember,
          body: {
            intent,
            prTitle: 'Deliver the approved change',
            prBody: 'Bound to exact evidence.',
            expectedStateVersion: 0,
          },
        },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        request: deliveryRequest(),
        outcomeCode: 'delivery_created',
        replayed: false,
      },
    })
    expect(
      harness.repository.createOrReviseGitHubDeliveryRequest,
    ).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        intent,
        prTitle: 'Deliver the approved change',
        prBody: 'Bound to exact evidence.',
        expectedStateVersion: 0,
      },
      desktopMember,
    )
  })

  it('returns the paired Desktop delivery inbox without provider credentials', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/desktop/projects/project-a/github-deliveries/inbox',
        harness.repository,
        harness.service,
        { principal: desktopMember },
      ),
    ).resolves.toEqual({
      status: 200,
      body: { requests: [deliveryRequest()] },
    })
    expect(harness.repository.listGitHubDeliveryInbox).toHaveBeenCalledWith(
      'project-a',
      desktopMember,
    )
  })

  it('returns a redacted recovery snapshot with crash-window IDs and versions to the exact paired Desktop', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1',
        harness.repository,
        harness.service,
        { principal: desktopMember },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        snapshot: {
          request: deliveryRequest({ stateVersion: 7, status: 'creating_pr' }),
          approval: approval(),
          grant: credentialGrant({ version: 3, status: 'consumed' }),
          publication: branchPublication({ version: 3 }),
          pullRequest: pullRequestOutcome({ version: 1, status: 'creating' }),
        },
      },
    })
    expect(
      harness.repository.getGitHubDeliveryRecoverySnapshot,
    ).toHaveBeenCalledWith('project-a', 'delivery-1', desktopMember)
  })

  it('allowlists every recovery snapshot record without exposing secrets or local paths', async () => {
    const harness = createHarness()
    vi.mocked(
      harness.repository.getGitHubDeliveryRecoverySnapshot,
    ).mockResolvedValue({
      request: {
        ...deliveryRequest({ stateVersion: 7, status: 'creating_pr' }),
        workspacePath: '/Users/example/private/repository',
      } as unknown as GitHubDeliveryRequest,
      approval: {
        ...approval(),
        privateKey: 'private-key-material',
      } as unknown as GitHubDeliveryApproval,
      grant: {
        ...credentialGrant({ version: 3, status: 'consumed' }),
        token: 'ghs_must_not_escape',
      } as unknown as GitHubCredentialGrant,
      publication: {
        ...branchPublication({ version: 3 }),
        stdout: 'credential output',
      } as unknown as GitHubBranchPublication,
      pullRequest: {
        ...pullRequestOutcome({ version: 1, status: 'creating' }),
        rawResponse: { authorization: 'Bearer secret' },
      } as unknown as GitHubPullRequestOutcome,
    })

    const result = await resolveGitHubDeliveryRoute(
      'GET',
      '/api/desktop/projects/project-a/github-deliveries/delivery-1',
      harness.repository,
      harness.service,
      { principal: desktopMember },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        snapshot: {
          request: { id: 'delivery-1', stateVersion: 7, redacted: true },
          approval: { id: 'approval-1', redacted: true },
          grant: { id: 'grant-1', version: 3, redacted: true },
          publication: { id: 'publication-1', version: 3, redacted: true },
          pullRequest: {
            id: 'pull-request-outcome-1',
            version: 1,
            redacted: true,
          },
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /ghs_|private.?key|workspacePath|\/Users\/|stdout|rawResponse|authorization/i,
    )
  })

  it('returns a fixed not-found response when the live paired token cannot read the recovery request', async () => {
    const harness = createHarness()
    vi.mocked(
      harness.repository.getGitHubDeliveryRecoverySnapshot,
    ).mockResolvedValue(null)

    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1',
        harness.repository,
        harness.service,
        { principal: desktopMember },
      ),
    ).resolves.toEqual({
      status: 404,
      body: {
        error: 'not_found',
        message: 'GitHub Delivery record not found.',
        outcomeCode: 'not_found',
        replayed: false,
      },
    })
  })

  it('rejects any recovery read body before repository access', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1',
        harness.repository,
        harness.service,
        { principal: desktopMember, body: { token: 'ghs_supplied' } },
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        error: 'bad_request',
        message: 'GitHub Delivery read input must be empty.',
      },
    })
    expect(
      harness.repository.getGitHubDeliveryRecoverySnapshot,
    ).not.toHaveBeenCalled()
  })

  it('issues one ephemeral repository credential only through the Desktop service boundary', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
        harness.repository,
        harness.service,
        { principal: desktopMember, body: { expectedStateVersion: 3 } },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
        grant: credentialGrant(),
        credential: {
          grantId: 'grant-1',
          username: 'x-access-token',
          token: 'ghs_ephemeral_desktop_only',
          expiresAt: '2026-08-11T16:00:00.000Z',
          repositoryId: '98765',
          canonicalHttpsUrl: 'https://github.com/example/project.git',
        },
        outcomeCode: 'grant_finalized',
        replayed: false,
      },
    })
    expect(harness.service.issueCredentialGrant).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        expectedStateVersion: 3,
      },
      desktopMember,
    )
    expect(harness.repository.finalizeGitHubCredentialGrant).not.toHaveBeenCalled()
  })

  it.each([5_001, 8_192])(
    'returns one valid %i-character ephemeral credential without truncation',
    async (length) => {
      const harness = createHarness()
      const token = `g${'x'.repeat(length - 1)}`
      vi.mocked(harness.service.issueCredentialGrant).mockResolvedValue({
        ok: true,
        responseStatus: 200,
        outcomeCode: 'grant_finalized',
        replayed: false,
        request: deliveryRequest({ stateVersion: 4, status: 'publishing_branch' }),
        grant: credentialGrant(),
        credential: {
          grantId: 'grant-1',
          username: 'x-access-token',
          token,
          expiresAt: '2026-08-11T16:00:00.000Z',
          repositoryId: '98765',
          canonicalHttpsUrl: 'https://github.com/example/project.git',
        },
      })

      await expect(
        resolveGitHubDeliveryRoute(
          'POST',
          '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
          harness.repository,
          harness.service,
          { principal: desktopMember, body: { expectedStateVersion: 3 } },
        ),
      ).resolves.toMatchObject({ status: 200, body: { credential: { token } } })
    },
  )

  it('accepts only a safe push outcome and lets the API service verify the remote branch', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/branch-publication',
        harness.repository,
        harness.service,
        {
          principal: desktopMember,
          body: {
            grantId: 'grant-1',
            expectedStateVersion: 4,
            expectedGrantVersion: 2,
            reportedOutcomeCode: 'pushed',
          },
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        request: deliveryRequest({ stateVersion: 6, status: 'branch_published' }),
        publication: branchPublication(),
        outcomeCode: 'publication_verified',
        replayed: false,
      },
    })
    expect(harness.service.verifyBranchPublication).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'pushed',
      },
      desktopMember,
    )
    expect(
      harness.repository.finalizeGitHubBranchPublication,
    ).not.toHaveBeenCalled()
  })

  it('adopts a verified prior branch publication without exposing a credential route', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/branch-publication/recover',
        harness.repository,
        harness.service,
        {
          principal: desktopMember,
          body: { expectedStateVersion: 3 },
        },
      ),
    ).resolves.toEqual({
      status: 201,
      body: {
        request: deliveryRequest({ stateVersion: 4, status: 'branch_published' }),
        publication: branchPublication({
          id: 'publication-2',
          version: 1,
          grantId: null,
          sourcePublicationId: 'publication-1',
          reportedOutcomeCode: 'already_present',
        }),
        outcomeCode: 'publication_adopted',
        replayed: false,
      },
    })
    expect(harness.service.adoptVerifiedBranchPublication).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        expectedStateVersion: 3,
      },
      desktopMember,
    )
    expect(harness.service.issueCredentialGrant).not.toHaveBeenCalled()
    expect(harness.service.verifyBranchPublication).not.toHaveBeenCalled()
  })

  it('creates or reconciles a Draft PR only through the API-owned GitHub service', async () => {
    const harness = createHarness()

    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/draft-pull-request',
        harness.repository,
        harness.service,
        {
          principal: desktopMember,
          body: { publicationId: 'publication-1', expectedStateVersion: 6 },
        },
      ),
    ).resolves.toEqual({
      status: 200,
      body: {
        request: deliveryRequest({ stateVersion: 8, status: 'completed' }),
        pullRequest: pullRequestOutcome(),
        outcomeCode: 'pull_request_completed',
        replayed: false,
      },
    })
    expect(harness.service.createDraftPullRequest).toHaveBeenCalledWith(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        publicationId: 'publication-1',
        expectedStateVersion: 6,
      },
      desktopMember,
    )
    expect(
      harness.repository.finalizeGitHubDraftPullRequest,
    ).not.toHaveBeenCalled()
  })

  it('enforces Cookie-only Web authority and Bearer-only Desktop authority on every route', async () => {
    const harness = createHarness()
    const webRoutes = [
      ['GET', '/api/team/projects/project-a/github-repository-binding', undefined],
      [
        'PUT',
        '/api/team/projects/project-a/github-repository-binding',
        { installationId: '12345', repositoryId: '98765', expectedStateVersion: 0 },
      ],
      [
        'POST',
        '/api/team/projects/project-a/github-repository-binding/revoke',
        { expectedStateVersion: 1 },
      ],
      ['GET', '/api/team/projects/project-a/github-deliveries', undefined],
      [
        'POST',
        '/api/team/projects/project-a/github-deliveries/delivery-1/approve',
        { expectedStateVersion: 2 },
      ],
      [
        'POST',
        '/api/team/projects/project-a/github-deliveries/delivery-1/reject',
        { expectedStateVersion: 2 },
      ],
    ] as const
    const desktopRoutes = [
      [
        'GET',
        '/api/desktop/projects/project-a/github-repository-binding',
        undefined,
      ],
      [
        'POST',
        '/api/desktop/projects/project-a/github-deliveries',
        {
          intent: deliveryIntent(),
          prTitle: 'Deliver the approved change',
          prBody: 'Bound to exact evidence.',
          expectedStateVersion: 0,
        },
      ],
      ['GET', '/api/desktop/projects/project-a/github-deliveries/inbox', undefined],
      [
        'GET',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1',
        undefined,
      ],
      [
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
        { expectedStateVersion: 3 },
      ],
      [
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/branch-publication',
        {
          grantId: 'grant-1',
          expectedStateVersion: 4,
          expectedGrantVersion: 2,
          reportedOutcomeCode: 'pushed',
        },
      ],
      [
        'POST',
        '/api/desktop/projects/project-a/github-deliveries/delivery-1/draft-pull-request',
        { publicationId: 'publication-1', expectedStateVersion: 6 },
      ],
    ] as const

    for (const [method, pathname, body] of webRoutes) {
      for (const principal of [desktopMember, developmentOwner]) {
        await expect(
          resolveGitHubDeliveryRoute(
            method,
            pathname,
            harness.repository,
            harness.service,
            { principal, body },
          ),
        ).resolves.toMatchObject({
          status: 403,
          body: { outcomeCode: 'authentication_forbidden' },
        })
      }
    }
    for (const [method, pathname, body] of desktopRoutes) {
      for (const principal of [cookieOwner, developmentOwner]) {
        await expect(
          resolveGitHubDeliveryRoute(
            method,
            pathname,
            harness.repository,
            harness.service,
            { principal, body },
          ),
        ).resolves.toMatchObject({
          status: 403,
          body: { outcomeCode: 'authentication_forbidden' },
        })
      }
    }
  })

  it('fails closed on unknown repository, ref, SHA, URL, credential, and private-key fields', async () => {
    const harness = createHarness()
    const unsafeCases: Array<{
      pathname: string
      principal: RequestPrincipal
      body: Record<string, unknown>
    }> = [
      {
        pathname: '/api/team/projects/project-a/github-repository-binding',
        principal: cookieOwner,
        body: {
          installationId: '12345',
          repositoryId: '98765',
          expectedStateVersion: 0,
          repository: 'attacker/selected',
        },
      },
      {
        pathname:
          '/api/team/projects/project-a/github-repository-binding/revoke',
        principal: cookieOwner,
        body: { expectedStateVersion: 1, privateKey: 'secret' },
      },
      {
        pathname:
          '/api/team/projects/project-a/github-deliveries/delivery-1/approve',
        principal: cookieOwner,
        body: { expectedStateVersion: 2, expectedCommitSha: '9'.repeat(40) },
      },
      {
        pathname:
          '/api/team/projects/project-a/github-deliveries/delivery-1/reject',
        principal: cookieOwner,
        body: { expectedStateVersion: 2, url: 'https://attacker.invalid' },
      },
      {
        pathname: '/api/desktop/projects/project-a/github-deliveries',
        principal: desktopMember,
        body: {
          intent: deliveryIntent(),
          prTitle: 'Deliver the approved change',
          prBody: 'Bound to exact evidence.',
          expectedStateVersion: 0,
          cloneUrl: 'https://attacker.invalid/repo.git',
        },
      },
      {
        pathname: '/api/desktop/projects/project-a/github-deliveries',
        principal: desktopMember,
        body: {
          intent: { ...deliveryIntent(), token: 'ghs_secret' },
          prTitle: 'Deliver the approved change',
          prBody: 'Bound to exact evidence.',
          expectedStateVersion: 0,
        },
      },
      {
        pathname:
          '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
        principal: desktopMember,
        body: { expectedStateVersion: 3, token: 'supplied-token' },
      },
      {
        pathname:
          '/api/desktop/projects/project-a/github-deliveries/delivery-1/branch-publication',
        principal: desktopMember,
        body: {
          grantId: 'grant-1',
          expectedStateVersion: 4,
          expectedGrantVersion: 2,
          reportedOutcomeCode: 'pushed',
          headSha: '9'.repeat(40),
        },
      },
      {
        pathname:
          '/api/desktop/projects/project-a/github-deliveries/delivery-1/draft-pull-request',
        principal: desktopMember,
        body: {
          publicationId: 'publication-1',
          expectedStateVersion: 6,
          safeUrl: 'https://attacker.invalid/pull/1',
        },
      },
    ]

    for (const unsafe of unsafeCases) {
      await expect(
        resolveGitHubDeliveryRoute(
          unsafe.pathname.includes('github-repository-binding') &&
            !unsafe.pathname.endsWith('/revoke')
            ? 'PUT'
            : 'POST',
          unsafe.pathname,
          harness.repository,
          harness.service,
          { principal: unsafe.principal, body: unsafe.body },
        ),
      ).resolves.toMatchObject({ status: 400, body: { error: 'bad_request' } })
    }
    await expect(
      resolveGitHubDeliveryRoute(
        'GET',
        '/api/team/projects/project-a/github-deliveries',
        harness.repository,
        harness.service,
        { principal: cookieOwner, body: { token: 'must-not-be-ignored' } },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: 'bad_request' } })

    expect(harness.service.configureRepositoryBinding).not.toHaveBeenCalled()
    expect(harness.repository.revokeGitHubRepositoryBinding).not.toHaveBeenCalled()
    expect(harness.repository.decideGitHubDeliveryRequest).not.toHaveBeenCalled()
    expect(
      harness.repository.createOrReviseGitHubDeliveryRequest,
    ).not.toHaveBeenCalled()
    expect(harness.service.issueCredentialGrant).not.toHaveBeenCalled()
    expect(harness.service.verifyBranchPublication).not.toHaveBeenCalled()
    expect(harness.service.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('maps provider failures to a fixed redacted route error', async () => {
    const harness = createHarness()
    vi.mocked(harness.service.issueCredentialGrant).mockRejectedValue(
      new GitHubDeliveryServiceError({
        code: 'github_unavailable',
        retryable: true,
        phase: 'credential',
      }),
    )

    const result = await resolveGitHubDeliveryRoute(
      'POST',
      '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
      harness.repository,
      harness.service,
      { principal: desktopMember, body: { expectedStateVersion: 3 } },
    )

    expect(result).toEqual({
      status: 503,
      body: {
        error: 'service_unavailable',
        message: 'GitHub is temporarily unavailable.',
        code: 'github_unavailable',
        retryable: true,
        phase: 'credential',
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/token|privateKey|Authorization/i)
  })

  it('maps unconfirmed credential revocation to a fixed non-retryable bad gateway', async () => {
    const harness = createHarness()
    vi.mocked(harness.service.issueCredentialGrant).mockRejectedValue(
      new GitHubDeliveryServiceError({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
        phase: 'credential',
      }),
    )

    const result = await resolveGitHubDeliveryRoute(
      'POST',
      '/api/desktop/projects/project-a/github-deliveries/delivery-1/credential-grant',
      harness.repository,
      harness.service,
      { principal: desktopMember, body: { expectedStateVersion: 3 } },
    )

    expect(result).toEqual({
      status: 502,
      body: {
        error: 'bad_gateway',
        message: 'GitHub credential revocation could not be confirmed.',
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
        phase: 'credential',
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/ghs_|privateKey|Authorization/i)
  })

  it('checks Project scope and live role before calling repository or provider operations', async () => {
    const harness = createHarness()
    const noProjectCookie: RequestPrincipal = {
      ...cookieMember,
      session: { ...cookieMember.session, projectMemberships: [] },
    }
    const noProjectDesktop: RequestPrincipal = {
      ...desktopMember,
      session: { ...desktopMember.session, projectMemberships: [] },
    }

    await expect(
      resolveGitHubDeliveryRoute(
        'PUT',
        '/api/team/projects/project-a/github-repository-binding',
        harness.repository,
        harness.service,
        {
          principal: cookieMember,
          body: {
            installationId: '12345',
            repositoryId: '98765',
            expectedStateVersion: 0,
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'role_forbidden' },
    })
    await expect(
      resolveGitHubDeliveryRoute(
        'POST',
        '/api/team/projects/project-a/github-deliveries/delivery-1/approve',
        harness.repository,
        harness.service,
        { principal: cookieMember, body: { expectedStateVersion: 2 } },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'role_forbidden' },
    })
    for (const [principal, pathname] of [
      [noProjectCookie, '/api/team/projects/project-a/github-deliveries'],
      [
        noProjectDesktop,
        '/api/desktop/projects/project-a/github-repository-binding',
      ],
      [
        noProjectDesktop,
        '/api/desktop/projects/project-a/github-deliveries/inbox',
      ],
    ] as const) {
      await expect(
        resolveGitHubDeliveryRoute(
          'GET',
          pathname,
          harness.repository,
          harness.service,
          { principal },
        ),
      ).resolves.toMatchObject({
        status: 403,
        body: { outcomeCode: 'project_forbidden' },
      })
    }

    expect(harness.service.configureRepositoryBinding).not.toHaveBeenCalled()
    expect(harness.repository.decideGitHubDeliveryRequest).not.toHaveBeenCalled()
    expect(harness.repository.listGitHubDeliveryRequests).not.toHaveBeenCalled()
    expect(harness.repository.listGitHubDeliveryInbox).not.toHaveBeenCalled()
  })
})
