import { describe, expect, it, vi } from 'vitest'
import type { GitHubAppClient } from './github-app-client'
import {
  createGitHubDeliveryService,
  GitHubDeliveryServiceError,
} from './github-delivery-service'
import type {
  GitHubBranchPublication,
  GitHubCredentialGrant,
  GitHubDeliveryDesktopPrincipal,
  GitHubDeliveryRepository,
  GitHubDeliveryRequest,
  GitHubDeliverySessionPrincipal,
  GitHubPullRequestOutcome,
} from './repositories/github-delivery-contract'

const now = '2026-08-11T15:00:00.000Z'
const expectedCommitSha = 'b'.repeat(40)

const sessionPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner',
    userId: 'user-owner',
    organizationId: 'org-a',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} as GitHubDeliverySessionPrincipal

const desktopPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop',
    userId: 'user-dev',
    organizationId: 'org-a',
    role: 'member',
    projectMemberships: [],
  },
  authentication: { kind: 'desktop_bearer', tokenRecordId: 'desktop-token-1' },
} as GitHubDeliveryDesktopPrincipal

function request(overrides: Partial<GitHubDeliveryRequest> = {}): GitHubDeliveryRequest {
  return {
    id: 'delivery-1',
    stateVersion: 3,
    intentRevision: 1,
    organizationId: 'org-a',
    projectId: 'project-a',
    requestedByUserId: 'user-dev',
    localIntentId: 'local-intent-1',
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
    status: 'publishing_branch',
    outcomeCode: null,
    expectedRunVersion: 7,
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha,
    intentDigest: 'c'.repeat(64),
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

function grant(overrides: Partial<GitHubCredentialGrant> = {}): GitHubCredentialGrant {
  return {
    id: 'grant-1',
    version: 1,
    requestId: 'delivery-1',
    intentRevision: 1,
    approvalId: 'approval-1',
    attempt: 1,
    repositoryId: '98765',
    permission: 'contents:write',
    repositoryCount: 1,
    status: 'issuing',
    requestedAt: now,
    issuedAt: null,
    credentialExpiresAt: null,
    consumedAt: null,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function publication(
  overrides: Partial<GitHubBranchPublication> = {},
): GitHubBranchPublication {
  return {
    id: 'publication-1',
    version: 1,
    requestId: 'delivery-1',
    intentRevision: 1,
    grantId: 'grant-1',
    status: 'verifying',
    reportedOutcomeCode: 'pushed',
    verifiedHeadSha: null,
    reportedAt: now,
    verifiedAt: null,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function pullRequest(
  overrides: Partial<GitHubPullRequestOutcome> = {},
): GitHubPullRequestOutcome {
  return {
    id: 'pull-request-outcome-1',
    version: 1,
    requestId: 'delivery-1',
    intentRevision: 1,
    publicationId: 'publication-1',
    status: 'creating',
    pullRequestId: null,
    pullRequestNumber: null,
    safeUrl: null,
    draft: true,
    headBranch: 'devflow/run-1-pr-1',
    baseBranch: 'main',
    headSha: expectedCommitSha,
    providerCreatedAt: null,
    recordedAt: now,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function createHarness() {
  const repository = {
    upsertGitHubRepositoryBinding: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'binding_created' as const,
      replayed: false,
      binding: {
        stateVersion: 1 as const,
        id: 'binding-1',
        version: 1,
        organizationId: 'org-a',
        teamProjectId: input.projectId,
        installationId: input.installationId,
        repositoryId: input.repositoryId,
        repository: input.repository,
        defaultBranch: input.defaultBranch,
        status: 'active' as const,
        validatedAt: input.verifiedAt,
        updatedAt: now,
        redacted: true as const,
      },
    })),
    reserveGitHubCredentialGrant: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'grant_reserved' as const,
      replayed: false,
      request: request(),
      grant: grant(),
    })),
    finalizeGitHubCredentialGrant: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'grant_finalized' as const,
      replayed: false,
      request: request({ stateVersion: 4 }),
      grant: grant({
        version: 2,
        status: input.outcome.status,
        issuedAt: input.outcome.status === 'issued' ? input.outcome.issuedAt : null,
        credentialExpiresAt:
          input.outcome.status === 'issued' ? input.outcome.credentialExpiresAt : null,
        outcomeCode:
          input.outcome.status === 'issued' ? null : input.outcome.outcomeCode,
      }),
    })),
    recordGitHubBranchPublicationReport: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'publication_reported' as const,
      replayed: false,
      request: request({ stateVersion: 5 }),
      grant: grant({
        version: 3,
        status: 'consumed',
        issuedAt: now,
        credentialExpiresAt: '2026-08-11T16:00:00.000Z',
        consumedAt: now,
      }),
      publication: publication(),
    })),
    finalizeGitHubBranchPublication: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode:
        input.verification.status === 'verified'
          ? ('publication_verified' as const)
          : ('publication_failed' as const),
      replayed: false,
      request: request({
        stateVersion: 6,
        status:
          input.verification.status === 'verified'
            ? 'branch_published'
            : input.verification.status === 'failed'
              ? 'failed'
              : 'recovery_required',
      }),
      publication: publication({
        version: 2,
        status: input.verification.status,
        verifiedHeadSha: input.verification.verifiedHeadSha,
        verifiedAt: input.verification.verifiedAt,
        outcomeCode: input.verification.outcomeCode,
      }),
    })),
    reserveGitHubDraftPullRequest: vi.fn(async () => ({
      ok: true as const,
      responseStatus: 201 as const,
      outcomeCode: 'pull_request_reserved' as const,
      replayed: false,
      request: request({ stateVersion: 7, status: 'creating_pr' }),
      pullRequest: pullRequest(),
    })),
    finalizeGitHubDraftPullRequest: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode:
        input.outcome.status === 'completed'
          ? ('pull_request_completed' as const)
          : ('pull_request_failed' as const),
      replayed: false,
      request: request({
        stateVersion: 8,
        status:
          input.outcome.status === 'completed'
            ? 'completed'
            : input.outcome.status,
      }),
      pullRequest: pullRequest({
        version: 2,
        status: input.outcome.status,
        pullRequestId:
          input.outcome.status === 'completed'
            ? input.outcome.pullRequestId
            : null,
        pullRequestNumber:
          input.outcome.status === 'completed'
            ? input.outcome.pullRequestNumber
            : null,
        safeUrl:
          input.outcome.status === 'completed' ? input.outcome.safeUrl : null,
        providerCreatedAt:
          input.outcome.status === 'completed'
            ? input.outcome.providerCreatedAt
            : null,
        outcomeCode: input.outcome.outcomeCode,
      }),
    })),
  } as unknown as GitHubDeliveryRepository

  const client = {
    verifyRepository: vi.fn(async () => ({
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      defaultBranch: 'main',
      private: true,
      visibility: 'private' as const,
      verifiedAt: now,
    })),
    issueContentsWriteToken: vi.fn(async () => ({
      installationId: '12345',
      repositoryId: '98765',
      token: 'ghs_ephemeral_value_for_desktop_only',
      expiresAt: '2026-08-11T16:00:00.000Z',
      permissions: { contents: 'write' as const },
    })),
    getBranchHead: vi.fn(async () => ({
      repository: 'example/project',
      branch: 'devflow/run-1-pr-1',
      sha: expectedCommitSha,
      verifiedAt: now,
    })),
    findOrCreateDraftPullRequest: vi.fn(async () => ({
      disposition: 'created' as const,
      pullRequest: {
        id: '456789',
        number: 42,
        url: 'https://github.com/example/project/pull/42',
        repository: 'example/project',
        baseBranch: 'main',
        headBranch: 'devflow/run-1-pr-1',
        headSha: expectedCommitSha,
        state: 'open' as const,
        draft: true as const,
        marker: `<!-- devflow-delivery:${'d'.repeat(64)} -->`,
        createdAt: now,
      },
    })),
    findDraftPullRequest: vi.fn(async () => null),
  } as unknown as GitHubAppClient

  return {
    repository,
    client,
    service: createGitHubDeliveryService({ repository, client, clock: () => new Date(now) }),
  }
}

describe('GitHub Delivery service', () => {
  it('resolves repository metadata from numeric GitHub authority before persisting a binding', async () => {
    const harness = createHarness()

    await expect(
      harness.service.configureRepositoryBinding(
        {
          projectId: 'project-a',
          installationId: '12345',
          repositoryId: '98765',
          expectedStateVersion: 0,
        },
        sessionPrincipal,
      ),
    ).resolves.toMatchObject({ ok: true, outcomeCode: 'binding_created' })

    expect(harness.client.verifyRepository).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
    })
    expect(harness.repository.upsertGitHubRepositoryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'example/project',
        defaultBranch: 'main',
        verifiedAt: now,
      }),
      sessionPrincipal,
    )
  })

  it('durably finalizes grant metadata before returning the ephemeral token', async () => {
    const harness = createHarness()
    const events: string[] = []
    vi.mocked(harness.client.issueContentsWriteToken).mockImplementation(async () => {
      events.push('issued')
      return {
        installationId: '12345',
        repositoryId: '98765',
        token: 'ghs_ephemeral_value_for_desktop_only',
        expiresAt: '2026-08-11T16:00:00.000Z',
        permissions: { contents: 'write' },
      }
    })
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockImplementation(async (input) => {
      events.push('finalized')
      expect(JSON.stringify(input)).not.toContain('ghs_ephemeral')
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'grant_finalized',
        replayed: false,
        request: request({ stateVersion: 4 }),
        grant: grant({
          version: 2,
          status: 'issued',
          issuedAt: now,
          credentialExpiresAt: '2026-08-11T16:00:00.000Z',
        }),
      }
    })

    const result = await harness.service.issueCredentialGrant(
      { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
      desktopPrincipal,
    )

    expect(events).toEqual(['issued', 'finalized'])
    expect(result).toMatchObject({
      ok: true,
      credential: {
        username: 'x-access-token',
        token: 'ghs_ephemeral_value_for_desktop_only',
        repositoryId: '98765',
      },
    })
  })

  it('records a safe recovery state when token issuance fails without leaking the cause', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockRejectedValue(
      new Error('RAW_SECRET https://x-access-token:github_pat_secret@github.com/example/project'),
    )

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({ code: 'github_delivery_unavailable', retryable: true })
    expect(JSON.stringify(error)).not.toMatch(/RAW_SECRET|github_pat_|x-access-token/)
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'credential_issue_failed',
        },
      }),
      desktopPrincipal,
    )
  })

  it('does not expose a minted credential when durable grant finalization is ambiguous', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockRejectedValue(
      new Error('SQL RAW ghs_ephemeral_value_for_desktop_only /private/database'),
    )

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_delivery_state_conflict',
      retryable: false,
      phase: 'credential',
    })
    expect(JSON.stringify(error)).not.toMatch(/SQL RAW|ghs_|\/private\//)
  })

  it('independently verifies the exact remote branch head before finalizing publication', async () => {
    const harness = createHarness()

    const result = await harness.service.verifyBranchPublication(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'pushed',
      },
      desktopPrincipal,
    )

    expect(harness.client.getBranchHead).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      branch: 'devflow/run-1-pr-1',
    })
    expect(harness.repository.finalizeGitHubBranchPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        verification: {
          status: 'verified',
          verifiedHeadSha: expectedCommitSha,
          verifiedAt: now,
          outcomeCode: 'branch_verified',
        },
      }),
      desktopPrincipal,
    )
    expect(result).toMatchObject({ ok: true, outcomeCode: 'publication_verified' })
  })

  it('records a branch conflict instead of trusting a Desktop push report', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.getBranchHead).mockResolvedValue({
      repository: 'example/project',
      branch: 'devflow/run-1-pr-1',
      sha: '9'.repeat(40),
      verifiedAt: now,
    })

    const result = await harness.service.verifyBranchPublication(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'unknown',
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({ ok: true, outcomeCode: 'publication_failed' })
    expect(harness.repository.finalizeGitHubBranchPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        verification: {
          status: 'conflict',
          verifiedHeadSha: '9'.repeat(40),
          verifiedAt: now,
          outcomeCode: 'branch_conflict',
        },
      }),
      desktopPrincipal,
    )
  })

  it('records recoverable branch verification failure without retaining the raw error', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.getBranchHead).mockRejectedValue(
      new Error('RAW_BRANCH github_pat_secret /Users/private/repo'),
    )

    const error = await harness.service
      .verifyBranchPublication(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          grantId: 'grant-1',
          expectedStateVersion: 4,
          expectedGrantVersion: 2,
          reportedOutcomeCode: 'unknown',
        },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_delivery_unavailable',
      retryable: true,
      phase: 'publication',
    })
    expect(JSON.stringify(error)).not.toMatch(/RAW_BRANCH|github_pat_|\/Users\//)
    expect(harness.repository.finalizeGitHubBranchPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        verification: {
          status: 'recovery_required',
          verifiedHeadSha: null,
          verifiedAt: null,
          outcomeCode: 'branch_verification_failed',
        },
      }),
      desktopPrincipal,
    )
  })

  it('finds or creates one Draft PR and persists only validated safe metadata', async () => {
    const harness = createHarness()

    const result = await harness.service.createDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        publicationId: 'publication-1',
        expectedStateVersion: 6,
      },
      desktopPrincipal,
    )

    expect(harness.client.findOrCreateDraftPullRequest).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      baseBranch: 'main',
      headBranch: 'devflow/run-1-pr-1',
      expectedHeadSha: expectedCommitSha,
      idempotencyKey: `github-delivery:${'d'.repeat(64)}`,
      title: 'Deliver the approved change',
      body: 'Bound to exact evidence.',
    })
    expect(harness.repository.finalizeGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({
          status: 'completed',
          pullRequestId: '456789',
          pullRequestNumber: 42,
          safeUrl: 'https://github.com/example/project/pull/42',
          headSha: expectedCommitSha,
          outcomeCode: 'draft_pr_created',
        }),
      }),
      desktopPrincipal,
    )
    expect(result).toMatchObject({ ok: true, outcomeCode: 'pull_request_completed' })
  })

  it('records Draft PR recovery without retaining an ambiguous raw provider failure', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.findOrCreateDraftPullRequest).mockRejectedValue(
      new Error('RAW_RESPONSE github_pat_do_not_store /Users/private/repo'),
    )

    const error = await harness.service
      .createDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          publicationId: 'publication-1',
          expectedStateVersion: 6,
        },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_delivery_unavailable',
      retryable: true,
      phase: 'pull_request',
    })
    expect(JSON.stringify(error)).not.toMatch(/RAW_RESPONSE|github_pat_|\/Users\//)
    expect(harness.repository.finalizeGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'pull_request_failed',
        },
      }),
      desktopPrincipal,
    )
  })

  it('replays a completed Draft PR without another GitHub request', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.reserveGitHubDraftPullRequest).mockResolvedValue({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'pull_request_reserved',
      replayed: true,
      request: request({ stateVersion: 8, status: 'completed' }),
      pullRequest: pullRequest({
        version: 2,
        status: 'completed',
        pullRequestId: '456789',
        pullRequestNumber: 42,
        safeUrl: 'https://github.com/example/project/pull/42',
        providerCreatedAt: now,
        outcomeCode: 'draft_pr_created',
      }),
    })

    const result = await harness.service.createDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        publicationId: 'publication-1',
        expectedStateVersion: 7,
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'pull_request_completed',
      replayed: true,
    })
    expect(harness.client.findOrCreateDraftPullRequest).not.toHaveBeenCalled()
  })

  it('reconciles an in-flight replay read-only and never issues a second PR create', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.reserveGitHubDraftPullRequest).mockResolvedValue({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'pull_request_reserved',
      replayed: true,
      request: request({ stateVersion: 7, status: 'creating_pr' }),
      pullRequest: pullRequest(),
    })

    const result = await harness.service.createDraftPullRequest(
      {
        projectId: 'project-a',
        requestId: 'delivery-1',
        publicationId: 'publication-1',
        expectedStateVersion: 6,
      },
      desktopPrincipal,
    )

    expect(harness.client.findDraftPullRequest).toHaveBeenCalledTimes(1)
    expect(harness.client.findOrCreateDraftPullRequest).not.toHaveBeenCalled()
    expect(harness.repository.finalizeGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'pull_request_failed',
        },
      }),
      desktopPrincipal,
    )
    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'pull_request_failed',
    })
  })
})
