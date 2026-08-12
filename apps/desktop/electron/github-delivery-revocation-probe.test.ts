import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopPairingCredential,
  GitHubDeliveryIntent,
  GitHubDeliveryRevocationCheck,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type {
  GitHubDeliveryRecoverySnapshot,
  GitHubDeliveryRequestRecord,
} from './github-delivery-remote-client'
import {
  runGitHubDeliveryRevocationProbe,
  type GitHubDeliveryRevocationProbeDeps,
} from './github-delivery-revocation-probe'

const intentUpdatedAt = '2026-08-11T12:10:02.000Z'
const checkedAt = '2026-08-11T12:12:00.000Z'

function pairing(): DesktopPairingCredential {
  return {
    tokenId: 'desktop-token-1',
    organizationId: 'org-1',
    projectId: 'team-project-1',
    localProjectId: 'local-project-1',
    userId: 'user-1',
    role: 'lead',
    authAccountId: 'auth-account-1',
    projectMemberships: [
      { projectId: 'team-project-1', userId: 'user-1', role: 'lead' },
    ],
    createdAt: '2026-08-11T10:00:00.000Z',
  }
}

function completedIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent & {
  status: 'completed'
  completion: NonNullable<GitHubDeliveryIntent['completion']>
} {
  return {
    stateVersion: 1,
    id: 'intent-1',
    organizationId: 'org-1',
    teamProjectId: 'team-project-1',
    localProjectId: 'local-project-1',
    runId: 'run-1',
    runVersion: 8,
    nodeId: 'run-1-pr',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 3,
    installationId: '101',
    repositoryId: '202',
    codingRunId: 'coding-1',
    codingRunCompletedAt: '2026-08-11T11:00:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'c'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'acme/widgets',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr',
    baseCommitSha: 'b'.repeat(40),
    expectedCommitSha: 'a'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'd'.repeat(64),
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T11:10:00.000Z',
    testEvidenceDigest: 'e'.repeat(64),
    prPackageArtifactId: 'artifact-pr-1',
    prPackageUpdatedAt: '2026-08-11T11:20:00.000Z',
    prPackageDigest: 'f'.repeat(64),
    changedPaths: ['src/widget.ts'],
    intentDigest: '1'.repeat(64),
    idempotencyKey: `github-delivery:${'2'.repeat(64)}`,
    status: 'completed',
    completion: {
      stateVersion: 1,
      remoteRequestId: 'request-1',
      publicationId: 'publication-1',
      pullRequestOutcomeId: 'pull-request-outcome-1',
      pullRequestId: '303',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
      providerCreatedAt: '2026-08-11T12:10:00.000Z',
      providerRetryNotBefore: null,
      recordedAt: intentUpdatedAt,
      draft: true,
      redacted: true,
    },
    createdAt: '2026-08-11T11:30:00.000Z',
    updatedAt: intentUpdatedAt,
    redacted: true,
    ...overrides,
  } as GitHubDeliveryIntent & {
    status: 'completed'
    completion: NonNullable<GitHubDeliveryIntent['completion']>
  }
}

function revokedBinding(
  overrides: Partial<GitHubRepositoryBinding> = {},
): GitHubRepositoryBinding {
  return {
    stateVersion: 1,
    id: 'binding-1',
    version: 4,
    organizationId: 'org-1',
    teamProjectId: 'team-project-1',
    installationId: '101',
    repositoryId: '202',
    repository: 'acme/widgets',
    defaultBranch: 'main',
    status: 'revoked',
    validatedAt: '2026-08-11T12:11:00.000Z',
    updatedAt: '2026-08-11T12:11:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function remoteRequest(
  source: ReturnType<typeof completedIntent>,
  overrides: Partial<GitHubDeliveryRequestRecord> = {},
): GitHubDeliveryRequestRecord {
  return {
    id: source.completion.remoteRequestId,
    stateVersion: 8,
    intentRevision: 1,
    organizationId: source.organizationId,
    projectId: source.teamProjectId,
    requestedByUserId: 'user-1',
    localIntentId: source.id,
    localProjectId: source.localProjectId,
    runId: source.runId,
    runVersion: source.runVersion,
    nodeId: source.nodeId,
    repositoryBindingId: source.repositoryBindingId,
    repositoryBindingVersion: source.repositoryBindingVersion,
    installationId: source.installationId,
    repositoryId: source.repositoryId,
    repository: source.repository,
    codingRunId: source.codingRunId,
    workspaceId: source.workspaceId,
    diffArtifactId: source.diffArtifactId,
    testEvidenceId: source.testEvidenceId,
    prPackageArtifactId: source.prPackageArtifactId,
    status: 'completed',
    outcomeCode: 'draft_pr_created',
    expectedRunVersion: source.runVersion,
    baseBranch: source.baseBranch,
    headBranch: source.headBranch,
    baseCommitSha: source.baseCommitSha,
    expectedCommitSha: source.expectedCommitSha,
    intentDigest: source.intentDigest,
    deliverySeriesKey: source.deliverySeriesKey,
    deliveryAttempt: source.deliveryAttempt,
    logicalIdempotencyKey: source.idempotencyKey,
    diffDigest: source.diffSourceDigest,
    testEvidenceDigest: source.testEvidenceDigest,
    packageDigest: source.prPackageDigest,
    changedPaths: [...source.changedPaths],
    prTitle: 'Ship widgets',
    prBody: 'Exact approved delivery.',
    expiresAt: '2026-08-12T11:30:00.000Z',
    createdAt: '2026-08-11T11:30:00.000Z',
    updatedAt: source.updatedAt,
    redacted: true,
    ...overrides,
  }
}

function recoverySnapshot(
  source: ReturnType<typeof completedIntent>,
  overrides: Partial<GitHubDeliveryRecoverySnapshot> = {},
): GitHubDeliveryRecoverySnapshot {
  return {
    request: remoteRequest(source),
    approval: null,
    grant: null,
    publication: {
      id: source.completion.publicationId,
      version: 1,
      requestId: source.completion.remoteRequestId,
      intentRevision: 1,
      grantId: 'grant-1',
      status: 'verified',
      reportedOutcomeCode: 'pushed',
      verifiedHeadSha: source.expectedCommitSha,
      reportedAt: '2026-08-11T12:09:00.000Z',
      verifiedAt: '2026-08-11T12:09:30.000Z',
      outcomeCode: 'branch_verified',
      redacted: true,
    },
    pullRequest: {
      id: source.completion.pullRequestOutcomeId,
      version: 1,
      requestId: source.completion.remoteRequestId,
      intentRevision: 1,
      publicationId: source.completion.publicationId,
      status: 'completed',
      pullRequestId: source.completion.pullRequestId,
      pullRequestNumber: source.completion.pullRequestNumber,
      safeUrl: source.completion.pullRequestUrl,
      draft: true,
      headBranch: source.headBranch,
      baseBranch: source.baseBranch,
      headSha: source.expectedCommitSha,
      providerCreatedAt: source.completion.providerCreatedAt,
      providerRetryNotBefore: null,
      recordedAt: '2026-08-11T12:10:01.000Z',
      outcomeCode: 'draft_pr_created',
      redacted: true,
    },
    ...overrides,
  }
}

function harness(
  overrides: Partial<GitHubDeliveryRevocationProbeDeps> = {},
) {
  const source = completedIntent()
  const currentBinding = revokedBinding()
  const expectedPairing = pairing()
  const check: GitHubDeliveryRevocationCheck = {
    stateVersion: 2,
    intentId: source.id,
    intentUpdatedAt: source.updatedAt,
    bindingId: currentBinding.id,
    bindingVersion: currentBinding.version,
    outcomeCode: 'binding_inactive',
    checkedAt,
    redacted: true,
  }
  const store: GitHubDeliveryRevocationProbeDeps['store'] = {
    listGitHubDeliveryIntents: vi.fn(async () => [source]),
    listGitHubDeliveryRevocationChecks: vi.fn(async () => []),
    commitGitHubRepositoryBindingObservation: vi.fn(async () => ({
      committed: true as const,
      replayed: false,
      binding: currentBinding,
    })),
    commitGitHubDeliveryRevocationCheck: vi.fn(async () => ({
      committed: true as const,
      replayed: false,
      check,
    })),
  }
  const remote: GitHubDeliveryRevocationProbeDeps['remote'] = {
    getRepositoryBinding: vi.fn(async () => currentBinding),
    getRecoverySnapshot: vi.fn(async () => recoverySnapshot(source)),
    verifyCredentialGrantBlocked: vi.fn(async () => ({
      status: 'blocked' as const,
      outcomeCode: 'binding_inactive' as const,
    })),
  }
  return {
    source,
    currentBinding,
    expectedPairing,
    check,
    store,
    remote,
    deps: {
      store,
      remote,
      expectedPairing,
      now: () => checkedAt,
      ...overrides,
    } satisfies GitHubDeliveryRevocationProbeDeps,
  }
}

describe('GitHub Delivery credential revocation probe', () => {
  it('records and returns only an exact revoked credential rejection', async () => {
    const { deps, source, currentBinding, expectedPairing, store, remote } =
      harness()

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'blocked',
      outcomeCode: 'binding_inactive',
    })
    expect(remote.getRecoverySnapshot).toHaveBeenCalledWith({
      projectId: expectedPairing.projectId,
      requestId: source.completion.remoteRequestId,
    })
    expect(remote.verifyCredentialGrantBlocked).toHaveBeenCalledWith({
      projectId: expectedPairing.projectId,
      requestId: source.completion.remoteRequestId,
      expectedStateVersion: 8,
    })
    expect(store.commitGitHubDeliveryRevocationCheck).toHaveBeenCalledWith({
      expectedIntent: source,
      expectedBinding: currentBinding,
      expectedPairing,
      check: {
        stateVersion: 2,
        intentId: source.id,
        intentUpdatedAt: source.updatedAt,
        bindingId: currentBinding.id,
        bindingVersion: currentBinding.version,
        outcomeCode: 'binding_inactive',
        checkedAt,
        redacted: true,
      },
    })
  })

  it('returns an unverified quarantine result and never commits revocation proof', async () => {
    const { deps, source, store, remote } = harness()
    vi.mocked(remote.verifyCredentialGrantBlocked).mockResolvedValue({
      status: 'pending',
      outcomeCode: 'credential_revocation_pending',
    })

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'credential_revocation_pending',
    })
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('refuses to probe while the freshly synchronized binding remains active', async () => {
    const { deps, source, store, remote } = harness()
    const active = revokedBinding({ status: 'active' })
    vi.mocked(remote.getRepositoryBinding).mockResolvedValue(active)
    vi.mocked(store.commitGitHubRepositoryBindingObservation).mockResolvedValue({
      committed: true,
      replayed: false,
      binding: active,
    })

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'binding_active',
    })
    expect(remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('fails stale local CAS before synchronizing or contacting the credential route', async () => {
    const { deps, source, store, remote } = harness()

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: '2026-08-11T12:09:59.000Z',
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'stale_intent',
    })
    expect(remote.getRepositoryBinding).not.toHaveBeenCalled()
    expect(remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('rejects ambiguous local claims to the completed remote request', async () => {
    const { deps, source, store, remote } = harness()
    const duplicate = completedIntent({ id: 'intent-duplicate' })
    vi.mocked(store.listGitHubDeliveryIntents).mockResolvedValue([
      source,
      duplicate,
    ])

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'remote_request_unavailable',
    })
    expect(remote.getRepositoryBinding).not.toHaveBeenCalled()
    expect(remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
  })

  it('rejects a missing or mismatched completed remote request before probing', async () => {
    const { deps, source, store, remote } = harness()
    vi.mocked(remote.getRecoverySnapshot).mockResolvedValue(
      recoverySnapshot(source, {
        request: remoteRequest(source, { localIntentId: 'intent-other' }),
      }),
    )

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'remote_request_unavailable',
    })
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('turns an unexpected credential response or raw failure into a fixed safe result', async () => {
    const { deps, source, store, remote } = harness()
    const rawFailure =
      'credential token ghs_secret at /Users/alice/private-worktree'
    vi.mocked(remote.verifyCredentialGrantBlocked).mockRejectedValue(
      new Error(rawFailure),
    )

    const result = await runGitHubDeliveryRevocationProbe(deps, {
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })

    expect(result).toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'revocation_unavailable',
    })
    expect(JSON.stringify(result)).not.toContain(rawFailure)
    expect(JSON.stringify(result)).not.toMatch(/ghs_secret|\/Users\/alice/u)
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('does not report a proof when its exact persistence CAS loses', async () => {
    const { deps, source, store } = harness()
    vi.mocked(store.commitGitHubDeliveryRevocationCheck).mockResolvedValue({
      committed: false,
      reason: 'intent_stale',
    })

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'stale_intent',
    })
  })

  it('replays only an exact durable proof without issuing another request', async () => {
    const { deps, source, check, store, remote } = harness()
    vi.mocked(store.listGitHubDeliveryRevocationChecks).mockResolvedValue([
      check,
    ])

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'blocked',
      outcomeCode: 'binding_inactive',
    })
    expect(remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
    expect(store.commitGitHubDeliveryRevocationCheck).not.toHaveBeenCalled()
  })

  it('never replays a stale v1 proof and verifies the remote authority again', async () => {
    const { deps, source, check, store, remote } = harness()
    vi.mocked(store.listGitHubDeliveryRevocationChecks).mockResolvedValue([
      { ...check, stateVersion: 1 } as unknown as GitHubDeliveryRevocationCheck,
    ])

    await expect(
      runGitHubDeliveryRevocationProbe(deps, {
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toEqual({
      intentId: source.id,
      disposition: 'blocked',
      outcomeCode: 'binding_inactive',
    })
    expect(remote.getRecoverySnapshot).toHaveBeenCalledTimes(1)
    expect(remote.verifyCredentialGrantBlocked).toHaveBeenCalledTimes(1)
    expect(store.commitGitHubDeliveryRevocationCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        check: expect.objectContaining({ stateVersion: 2 }),
      }),
    )
  })

  it('fails closed for a malformed durable proof projection', async () => {
    const { deps, source, check, store, remote } = harness()
    vi.mocked(store.listGitHubDeliveryRevocationChecks).mockResolvedValue([
      {
        ...check,
        token: 'ghs_corrupt_local_projection',
      } as GitHubDeliveryRevocationCheck,
    ])

    const result = await runGitHubDeliveryRevocationProbe(deps, {
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })

    expect(result).toEqual({
      intentId: source.id,
      disposition: 'unverified',
      outcomeCode: 'revocation_unavailable',
    })
    expect(JSON.stringify(result)).not.toContain('ghs_corrupt_local_projection')
    expect(remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(remote.verifyCredentialGrantBlocked).not.toHaveBeenCalled()
  })
})
