import { describe, expect, it, vi } from 'vitest'
import {
  GitHubAppClientError,
  type GitHubAppClient,
} from './github-app-client'
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
  GitHubCredentialClearanceAuthority,
} from './repositories/github-delivery-contract'

const now = '2026-08-11T15:00:00.000Z'
const expectedCommitSha = 'b'.repeat(40)
const clearanceAuthority = Object.freeze(
  Object.create(null),
) as GitHubCredentialClearanceAuthority

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
    providerExpiryContractVersion: 0,
    providerCredentialExpiresAt: null,
    providerExpiryObservedAt: null,
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
    providerRetryNotBefore: null,
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
      clearanceAuthority,
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
        providerExpiryContractVersion: input.outcome.status === 'issued' ? 1 : 0,
        providerCredentialExpiresAt:
          input.outcome.status === 'issued'
            ? input.outcome.providerCredentialExpiresAt
            : null,
        providerExpiryObservedAt: null,
        outcomeCode:
          input.outcome.status === 'issued' ? null : input.outcome.outcomeCode,
      }),
    })),
    confirmGitHubCredentialClearance: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: input.outcomeCode,
      replayed: false,
      request: request(),
      grant: grant({
        id: input.grantId,
        version: 3,
        status: 'failed',
        outcomeCode: input.outcomeCode,
      }),
    })),
    confirmGitHubCredentialProviderExpiry: vi.fn(async (input) => ({
      ok: true as const,
      responseStatus: 200 as const,
      outcomeCode: 'credential_provider_expiry_confirmed' as const,
      replayed: false,
      request: request({
        stateVersion: 4,
        status: 'recovery_required',
        outcomeCode: 'credential_issue_failed',
      }),
      grant: grant({
        id: input.grantId,
        version: 3,
        status: 'expired',
        issuedAt: now,
        credentialExpiresAt: input.providerCredentialExpiresAt,
        providerExpiryContractVersion: 1,
        providerCredentialExpiresAt: input.providerCredentialExpiresAt,
        providerExpiryObservedAt: input.providerExpiryObservedAt,
        outcomeCode: 'credential_provider_expiry_confirmed',
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
        providerRetryNotBefore:
          input.outcome.status === 'recovery_required' &&
          input.outcome.providerRetryAfterSeconds
            ? new Date(Date.parse(now) + input.outcome.providerRetryAfterSeconds * 1_000)
                .toISOString()
            : null,
        outcomeCode: input.outcome.outcomeCode,
      }),
    })),
    getGitHubDeliveryRecoverySnapshot: vi.fn(async () => null),
    authorizeGitHubDeliveryRecoveryLookup: vi.fn(async () => ({ ok: true as const })),
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
      providerExpiresAt: '2026-08-11T16:00:00.000Z',
      permissions: { contents: 'write' as const },
    })),
    observeProviderCredentialExpiry: vi.fn(async (expiryInput) => ({
      ...expiryInput,
      providerObservedAt: '2026-08-11T16:00:02.000Z',
    })),
    revokeInstallationAccessToken: vi.fn(async () => undefined),
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
        providerExpiresAt: '2026-08-11T16:00:00.000Z',
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
    expect(harness.client.issueContentsWriteToken).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
      issuanceDeadline: '2026-08-11T15:02:00.000Z',
    })
    expect(result).toMatchObject({
      ok: true,
      credential: {
        username: 'x-access-token',
        token: 'ghs_ephemeral_value_for_desktop_only',
        repositoryId: '98765',
      },
    })
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
  })

  it('does not cross the GitHub token boundary when a revoked binding rejects the grant', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.reserveGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 8 },
        desktopPrincipal,
      ),
    ).resolves.toEqual({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
    expect(harness.repository.finalizeGitHubCredentialGrant).not.toHaveBeenCalled()
  })

  it('does not cross the GitHub token boundary while prior credential authority is unresolved', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.reserveGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'credential_revocation_pending',
      replayed: false,
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 8 },
        desktopPrincipal,
      ),
    ).resolves.toEqual({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'credential_revocation_pending',
      replayed: false,
    })
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
    expect(harness.repository.finalizeGitHubCredentialGrant).not.toHaveBeenCalled()
    expect(harness.repository.confirmGitHubCredentialClearance).not.toHaveBeenCalled()
  })

  it.each([
    ['null access', null],
    [
      'throwing token getter',
      Object.defineProperty({}, 'token', {
        get: () => {
          throw new Error('RAW_TOKEN_GETTER ghs_must_not_escape')
        },
      }),
    ],
  ])('keeps the grant unresolved for a runtime %s result', async (_label, access) => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockResolvedValue(
      access as never,
    )

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
      phase: 'credential',
    })
    expect(String(error)).not.toMatch(/RAW_TOKEN_GETTER|ghs_/u)
    expect(JSON.stringify(error)).not.toMatch(/RAW_TOKEN_GETTER|ghs_/u)
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
    expect(harness.repository.confirmGitHubCredentialClearance).not.toHaveBeenCalled()
  })

  it('snapshots a valid token once before compensating a later runtime getter failure', async () => {
    const harness = createHarness()
    const mintedToken = 'ghs_ephemeral_value_for_desktop_only'
    let tokenReads = 0
    vi.mocked(harness.client.issueContentsWriteToken).mockResolvedValue(
      Object.defineProperties({}, {
        token: {
          get: () => {
            tokenReads += 1
            if (tokenReads > 1) throw new Error('RAW_SECOND_TOKEN_READ')
            return mintedToken
          },
        },
        installationId: { value: '12345' },
        repositoryId: {
          get: () => {
            throw new Error('RAW_REPOSITORY_GETTER')
          },
        },
      }) as never,
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
    expect(String(error)).not.toMatch(/RAW_|ghs_/u)
    expect(tokenReads).toBe(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledWith(
      mintedToken,
    )
    expect(harness.repository.confirmGitHubCredentialClearance).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'credential_revocation_confirmed' }),
      clearanceAuthority,
    )
  })

  it('revokes a token minted after repository revocation wins the finalization race', async () => {
    const harness = createHarness()
    const minted = {
      installationId: '12345',
      repositoryId: '98765',
      token: 'ghs_ephemeral_value_for_desktop_only',
      expiresAt: '2026-08-11T16:00:00.000Z',
      providerExpiresAt: '2026-08-11T16:00:00.000Z',
      permissions: { contents: 'write' as const },
    }
    let resolveMinted: ((access: typeof minted) => void) | undefined
    vi.mocked(harness.client.issueContentsWriteToken).mockImplementation(
      () => new Promise((resolve) => {
        resolveMinted = resolve
      }),
    )

    const pending = harness.service.issueCredentialGrant(
      { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
      desktopPrincipal,
    )
    await vi.waitFor(() => expect(resolveMinted).toBeTypeOf('function'))
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })
    resolveMinted!(minted)

    await expect(pending).resolves.toEqual({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledWith(minted.token)
  })

  it('fails closed without reissuing when minted credential revocation is unconfirmed', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })
    vi.mocked(harness.client.revokeInstallationAccessToken).mockRejectedValue(
      new Error('RAW_DELETE_FAILURE ghs_ephemeral_value_for_desktop_only'),
    )

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
      phase: 'credential',
    })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toMatch(/RAW_DELETE_FAILURE|ghs_/u)
    expect(JSON.stringify(error)).not.toMatch(/RAW_DELETE_FAILURE|ghs_/u)
    expect(harness.client.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
  })

  it('requires exact durable confirmation after compensating a finalization race', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })
    vi.mocked(harness.repository.confirmGitHubCredentialClearance).mockResolvedValue({
      ok: true,
      responseStatus: 200,
      outcomeCode: 'credential_revocation_confirmed',
      replayed: false,
      request: request({ id: 'wrong-request' }),
      grant: grant({
        version: 3,
        status: 'revoked',
        outcomeCode: 'credential_revocation_confirmed',
      }),
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
    })
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(
      harness.repository.confirmGitHubCredentialClearance,
    ).toHaveBeenCalledTimes(1)
  })

  it('rejects confirmation snapshots with an unresolved status or credential expiry', async () => {
    const invalidConfirmedGrants = [
      grant({
        version: 3,
        status: 'issuing',
        outcomeCode: 'credential_revocation_confirmed',
      }),
      grant({
        version: 3,
        status: 'failed',
        credentialExpiresAt: '2026-08-11T16:00:00.000Z',
        outcomeCode: 'credential_revocation_confirmed',
      }),
    ]

    for (const invalidGrant of invalidConfirmedGrants) {
      const harness = createHarness()
      vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
        ok: false,
        responseStatus: 409,
        outcomeCode: 'binding_inactive',
        replayed: false,
      })
      vi.mocked(
        harness.repository.confirmGitHubCredentialClearance,
      ).mockResolvedValue({
        ok: true,
        responseStatus: 200,
        outcomeCode: 'credential_revocation_confirmed',
        replayed: false,
        request: request(),
        grant: invalidGrant,
      })

      await expect(
        harness.service.issueCredentialGrant(
          { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
          desktopPrincipal,
        ),
      ).rejects.toMatchObject({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
      })
    }
  })

  it('never crosses the provider boundary after the fixed mint-start deadline', async () => {
    const harness = createHarness()
    const service = createGitHubDeliveryService({
      repository: harness.repository,
      client: harness.client,
      clock: () => new Date('2026-08-11T15:02:00.000Z'),
    })

    await expect(
      service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_delivery_state_conflict',
      retryable: false,
    })
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      }),
      desktopPrincipal,
    )
    expect(harness.repository.confirmGitHubCredentialClearance).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        outcomeCode: 'credential_mint_absent_confirmed',
      },
      clearanceAuthority,
    )
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
  })

  it('allows issuance at the last millisecond before the fixed mint-start deadline', async () => {
    const harness = createHarness()
    const service = createGitHubDeliveryService({
      repository: harness.repository,
      client: harness.client,
      clock: () => new Date('2026-08-11T15:01:59.999Z'),
    })

    await expect(
      service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      credential: { token: 'ghs_ephemeral_value_for_desktop_only' },
    })
    expect(harness.client.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({
          status: 'issued',
          issuedAt: '2026-08-11T15:01:59.999Z',
        }),
      }),
      desktopPrincipal,
    )
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
    expect(harness.repository.confirmGitHubCredentialClearance).not.toHaveBeenCalled()
  })

  it('revokes then hides non-revocation finalization rejections behind state conflict', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'stale_version',
      replayed: false,
    })

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
    expect(harness.client.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
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

  it('durably clears a grant only when the client proves the provider POST never happened', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockRejectedValue(
      new GitHubAppClientError(
        'github_authentication_failed',
        undefined,
        false,
        true,
      ),
    )

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_authentication_failed',
      retryable: false,
    })
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
    expect(harness.repository.confirmGitHubCredentialClearance).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        outcomeCode: 'credential_mint_absent_confirmed',
      },
      clearanceAuthority,
    )
  })

  it('durably confirms a client-compensated provider credential only after failure finalization', async () => {
    const harness = createHarness()
    const events: string[] = []
    vi.mocked(harness.client.issueContentsWriteToken).mockRejectedValue(
      new GitHubAppClientError(
        'github_malformed_response',
        undefined,
        true,
      ),
    )
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant)
      .mockImplementationOnce(async () => {
        events.push('failure-finalize-threw')
        throw new Error('RAW_TRANSIENT_DB_FAILURE')
      })
      .mockImplementationOnce(async (finalizeInput) => {
        events.push('failure-finalized')
        return {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'grant_finalized',
          replayed: false,
          request: request({ stateVersion: 4, status: 'failed' }),
          grant: grant({
            version: 2,
            status: 'failed',
            outcomeCode: finalizeInput.outcome.status === 'issued'
              ? null
              : finalizeInput.outcome.outcomeCode,
          }),
        }
      })
    vi.mocked(harness.repository.confirmGitHubCredentialClearance).mockImplementation(
      async () => {
        events.push('revocation-confirmed')
        return {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'credential_revocation_confirmed',
          replayed: false,
          request: request({ stateVersion: 4, status: 'failed' }),
          grant: grant({
            version: 3,
            status: 'failed',
            outcomeCode: 'credential_revocation_confirmed',
          }),
        }
      },
    )

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_malformed_response',
      retryable: false,
    })
    expect(events).toEqual([
      'failure-finalize-threw',
      'failure-finalized',
      'revocation-confirmed',
    ])
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
  })

  it('confirms a client-compensated credential when binding revocation wins failure finalization', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockRejectedValue(
      new GitHubAppClientError(
        'github_malformed_response',
        undefined,
        true,
      ),
    )
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_malformed_response',
      retryable: false,
    })
    expect(
      harness.repository.confirmGitHubCredentialClearance,
    ).toHaveBeenCalledTimes(1)
  })

  it('preserves an unconfirmed client compensation failure across a binding race', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockRejectedValue(
      new GitHubAppClientError('github_credential_revocation_unconfirmed'),
    )
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'binding_inactive',
      replayed: false,
    })

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
      phase: 'credential',
    })
    expect(error).not.toHaveProperty('cause')
    expect(harness.client.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).not.toHaveBeenCalled()
  })

  it('revokes a minted credential that does not match the reserved repository scope', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.issueContentsWriteToken).mockResolvedValue({
      installationId: '12345',
      repositoryId: '99999',
      token: 'ghs_wrong_scope_must_be_revoked',
      expiresAt: '2026-08-11T16:00:00.000Z',
      providerExpiresAt: '2026-08-11T16:00:00.000Z',
      permissions: { contents: 'write' },
    })

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_scope_mismatch',
      retryable: false,
      phase: 'credential',
    })
    expect(JSON.stringify(error)).not.toContain('ghs_wrong_scope_must_be_revoked')
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      }),
      desktopPrincipal,
    )
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledWith(
      'ghs_wrong_scope_must_be_revoked',
    )
  })

  it('keeps a compensated grant unresolved when issued finalization may have committed', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.finalizeGitHubCredentialGrant)
      .mockRejectedValueOnce(
        new Error('SQL RAW ghs_ephemeral_value_for_desktop_only /private/database'),
      )
      .mockResolvedValueOnce({
        ok: false,
        responseStatus: 409,
        outcomeCode: 'grant_conflict',
        replayed: false,
      })
    vi.mocked(harness.repository.confirmGitHubCredentialClearance).mockResolvedValue({
      ok: false,
      responseStatus: 409,
      outcomeCode: 'grant_conflict',
      replayed: false,
    })

    const error = await harness.service
      .issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 2 },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubDeliveryServiceError)
    expect(error).toMatchObject({
      code: 'github_credential_revocation_unconfirmed',
      retryable: false,
      phase: 'credential',
    })
    expect(JSON.stringify(error)).not.toMatch(/SQL RAW|ghs_|\/private\//)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledWith(
      'ghs_ephemeral_value_for_desktop_only',
    )
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledTimes(2)
    expect(
      harness.repository.confirmGitHubCredentialClearance,
    ).toHaveBeenCalledTimes(1)
  })

  it('revokes a minted credential when the issuance clock fails before finalization', async () => {
    const harness = createHarness()
    let clockCalls = 0
    const service = createGitHubDeliveryService({
      repository: harness.repository,
      client: harness.client,
      clock: () => {
        clockCalls += 1
        if (clockCalls === 1) return new Date(now)
        throw new Error('RAW CLOCK FAILURE ghs_must_not_escape')
      },
    })

    const error = await service
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
    expect(String(error)).not.toMatch(/RAW CLOCK FAILURE|ghs_/u)
    expect(JSON.stringify(error)).not.toMatch(/RAW CLOCK FAILURE|ghs_/u)
    expect(harness.client.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledTimes(1)
    expect(harness.repository.finalizeGitHubCredentialGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'failed',
          outcomeCode: 'credential_issue_failed',
        },
      }),
      desktopPrincipal,
    )
    expect(
      harness.repository.confirmGitHubCredentialClearance,
    ).toHaveBeenCalledTimes(1)
  })

  it('observes provider expiry on an issued replay without minting and requires an explicit retry', async () => {
    const harness = createHarness()
    const providerExpiresAt = '2026-08-11T16:00:00.000Z'
    vi.mocked(harness.repository.reserveGitHubCredentialGrant).mockResolvedValue({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: true,
      request: request({ stateVersion: 4 }),
      grant: grant({
        version: 2,
        status: 'issued',
        issuedAt: now,
        credentialExpiresAt: providerExpiresAt,
        providerExpiryContractVersion: 1,
        providerCredentialExpiresAt: providerExpiresAt,
      }),
      clearanceAuthority,
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 4 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'github_delivery_state_conflict',
      retryable: true,
      phase: 'credential',
    })
    expect(harness.client.observeProviderCredentialExpiry).toHaveBeenCalledWith({
      installationId: '12345',
      providerExpiresAt,
    })
    expect(harness.repository.confirmGitHubCredentialProviderExpiry).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        projectId: 'project-a',
        requestId: 'delivery-1',
        grantId: 'grant-1',
        providerCredentialExpiresAt: providerExpiresAt,
        providerExpiryObservedAt: '2026-08-11T16:00:02.000Z',
      },
      clearanceAuthority,
    )
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
    expect(harness.repository.finalizeGitHubCredentialGrant).not.toHaveBeenCalled()
  })

  it.each([
    ['legacy raw expiry is absent', { providerExpiryContractVersion: 0 as const, providerCredentialExpiresAt: null }],
    ['credential was consumed', { consumedAt: now }],
    ['legacy local expiry outcome is terminal', { status: 'expired' as const, outcomeCode: 'credential_expired' as const }],
  ])('fails closed on an issued replay when %s', async (_case, overrides) => {
    const harness = createHarness()
    vi.mocked(harness.repository.reserveGitHubCredentialGrant).mockResolvedValue({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: true,
      request: request({ stateVersion: 4 }),
      grant: grant({
        version: 2,
        status: 'issued',
        issuedAt: now,
        credentialExpiresAt: '2026-08-11T16:00:00.000Z',
        providerExpiryContractVersion: 1,
        providerCredentialExpiresAt: '2026-08-11T16:00:00.000Z',
        ...overrides,
      }),
      clearanceAuthority,
    })

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 4 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({ code: 'github_delivery_state_conflict' })
    expect(harness.client.observeProviderCredentialExpiry).not.toHaveBeenCalled()
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
    expect(harness.repository.confirmGitHubCredentialProviderExpiry).not.toHaveBeenCalled()
  })

  it('fails closed when the provider observation is early and never persists local-clock evidence', async () => {
    const harness = createHarness()
    const providerExpiresAt = '2026-08-11T16:00:00.000Z'
    vi.mocked(harness.repository.reserveGitHubCredentialGrant).mockResolvedValue({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: true,
      request: request({ stateVersion: 4 }),
      grant: grant({
        version: 2,
        status: 'issued',
        issuedAt: now,
        credentialExpiresAt: providerExpiresAt,
        providerExpiryContractVersion: 1,
        providerCredentialExpiresAt: providerExpiresAt,
      }),
      clearanceAuthority,
    })
    vi.mocked(harness.client.observeProviderCredentialExpiry).mockRejectedValue(
      new GitHubAppClientError('github_conflict'),
    )

    await expect(
      harness.service.issueCredentialGrant(
        { projectId: 'project-a', requestId: 'delivery-1', expectedStateVersion: 4 },
        desktopPrincipal,
      ),
    ).rejects.toMatchObject({ code: 'github_conflict', retryable: false })
    expect(harness.repository.confirmGitHubCredentialProviderExpiry).not.toHaveBeenCalled()
    expect(harness.client.issueContentsWriteToken).not.toHaveBeenCalled()
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

  it('records recoverable Draft PR state when GitHub rate limits a validated create', async () => {
    const harness = createHarness()
    vi.mocked(harness.client.findOrCreateDraftPullRequest).mockRejectedValue(
      new GitHubAppClientError('github_rate_limited', 422, false, false, 60),
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

    expect(error).toMatchObject({
      code: 'github_rate_limited',
      retryable: true,
      phase: 'pull_request',
    })
    expect(harness.repository.finalizeGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'pull_request_failed',
          providerRetryAfterSeconds: 60,
        },
      }),
      desktopPrincipal,
    )
  })

  it('reconciles but does not create a Draft PR before durable provider backoff expires', async () => {
    const harness = createHarness()
    const retryNotBefore = '2026-08-11T15:01:00.000Z'
    vi.mocked(harness.repository.getGitHubDeliveryRecoverySnapshot).mockResolvedValue({
      request: request({ stateVersion: 8, status: 'recovery_required' }),
      approval: null,
      grant: null,
      publication: publication({ status: 'verified', verifiedHeadSha: expectedCommitSha }),
      pullRequest: pullRequest({
        version: 2,
        status: 'recovery_required',
        recordedAt: now,
        providerRetryNotBefore: retryNotBefore,
        outcomeCode: 'pull_request_failed',
      }),
    })
    vi.mocked(harness.client.findDraftPullRequest).mockResolvedValue(null)

    const error = await harness.service
      .createDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          publicationId: 'publication-1',
          expectedStateVersion: 8,
        },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      code: 'github_rate_limited',
      retryable: true,
      phase: 'pull_request',
    })
    expect(harness.client.findDraftPullRequest).toHaveBeenCalledOnce()
    expect(harness.repository.reserveGitHubDraftPullRequest).not.toHaveBeenCalled()
    expect(harness.client.findOrCreateDraftPullRequest).not.toHaveBeenCalled()
  })

  it('does not mint a GitHub lookup credential when recovery authority is inactive', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.getGitHubDeliveryRecoverySnapshot).mockResolvedValue({
      request: request({ stateVersion: 8, status: 'recovery_required' }),
      approval: null,
      grant: null,
      publication: publication({ status: 'verified', verifiedHeadSha: expectedCommitSha }),
      pullRequest: pullRequest({
        version: 2,
        status: 'recovery_required',
        providerRetryNotBefore: '2026-08-11T15:01:00.000Z',
        outcomeCode: 'pull_request_failed',
      }),
    })
    vi.mocked(harness.repository.authorizeGitHubDeliveryRecoveryLookup)
      .mockResolvedValue({
        ok: false,
        responseStatus: 409,
        outcomeCode: 'binding_inactive',
        replayed: false,
      })

    await expect(
      harness.service.createDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          publicationId: 'publication-1',
          expectedStateVersion: 8,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'binding_inactive' })

    expect(harness.client.findDraftPullRequest).not.toHaveBeenCalled()
    expect(harness.repository.reserveGitHubDraftPullRequest).not.toHaveBeenCalled()
    expect(harness.client.findOrCreateDraftPullRequest).not.toHaveBeenCalled()
  })

  it('allows one Draft PR create at the durable provider backoff boundary', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.getGitHubDeliveryRecoverySnapshot).mockResolvedValue({
      request: request({ stateVersion: 8, status: 'recovery_required' }),
      approval: null,
      grant: null,
      publication: publication({ status: 'verified', verifiedHeadSha: expectedCommitSha }),
      pullRequest: pullRequest({
        version: 2,
        status: 'recovery_required',
        providerRetryNotBefore: now,
        outcomeCode: 'pull_request_failed',
      }),
    })

    await expect(
      harness.service.createDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          publicationId: 'publication-1',
          expectedStateVersion: 8,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: true, outcomeCode: 'pull_request_completed' })

    expect(harness.client.findDraftPullRequest).toHaveBeenCalledOnce()
    expect(harness.repository.reserveGitHubDraftPullRequest).toHaveBeenCalledOnce()
    expect(harness.client.findOrCreateDraftPullRequest).toHaveBeenCalledOnce()
  })

  it('durably extends provider backoff when Resume reconciliation is rate limited again', async () => {
    const harness = createHarness()
    vi.mocked(harness.repository.getGitHubDeliveryRecoverySnapshot).mockResolvedValue({
      request: request({ stateVersion: 8, status: 'recovery_required' }),
      approval: null,
      grant: null,
      publication: publication({ status: 'verified', verifiedHeadSha: expectedCommitSha }),
      pullRequest: pullRequest({
        version: 2,
        status: 'recovery_required',
        providerRetryNotBefore: '2026-08-11T15:01:00.000Z',
        outcomeCode: 'pull_request_failed',
      }),
    })
    vi.mocked(harness.client.findDraftPullRequest).mockRejectedValue(
      new GitHubAppClientError('github_rate_limited', 403, false, false, 120),
    )

    const error = await harness.service
      .createDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: 'delivery-1',
          publicationId: 'publication-1',
          expectedStateVersion: 8,
        },
        desktopPrincipal,
      )
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({ code: 'github_rate_limited', retryable: true })
    expect(harness.repository.finalizeGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStateVersion: 8,
        expectedPullRequestVersion: 2,
        outcome: {
          status: 'recovery_required',
          outcomeCode: 'pull_request_failed',
          providerRetryAfterSeconds: 120,
        },
      }),
      desktopPrincipal,
    )
    expect(harness.repository.reserveGitHubDraftPullRequest).not.toHaveBeenCalled()
    expect(harness.client.findOrCreateDraftPullRequest).not.toHaveBeenCalled()
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
