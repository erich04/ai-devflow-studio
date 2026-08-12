import { describe, expect, it, vi } from 'vitest'
import {
  createGitHubDeliveryIntent,
  type Artifact,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type GitHubRepositoryBinding,
  type ManagedCodingWorkspace,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import { GitHubAppClientError, type GitHubAppClient } from '../github-app-client'
import { createGitHubDeliveryService } from '../github-delivery-service'
import type {
  GitHubBranchPublication,
  GitHubCredentialGrant,
  GitHubDeliveryApproval,
  GitHubDeliveryRequest,
} from '../repositories/github-delivery-contract'
import { createSeedGitHubDeliveryRepository } from '../repositories/seed-github-delivery-repository'
import {
  resolveGitHubDeliveryRoute,
  type GitHubDeliveryRouteResult,
} from './github-delivery-routes'

const projectId = 'project-a'
const organizationId = 'org-a'
const now = '2026-08-11T10:00:00.000Z'
const credentialExpiresAt = '2026-08-11T10:30:00.000Z'
const baseCommitSha = 'a'.repeat(40)
const expectedCommitSha = 'b'.repeat(40)
const diffDigest = 'c'.repeat(64)
const ephemeralToken = 'ghs_v15_ephemeral_not_durable_123456'

const ownerPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner',
    organizationId,
    userId: 'user-owner',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} satisfies RequestPrincipal

const desktopPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop',
    organizationId,
    userId: 'user-desktop',
    role: 'member',
    projectMemberships: [
      { projectId, userId: 'user-desktop', role: 'member' },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-1',
  },
} satisfies RequestPrincipal

function createIntentSource(repositoryBinding: GitHubRepositoryBinding) {
  const run: WorkflowRun = {
    id: 'run-1',
    version: 7,
    title: 'Ship the exact approved commit',
    request: 'Publish the tested managed-worktree change.',
    projectId: 'local-project-a',
    creatorId: 'user-desktop',
    status: 'testing',
    currentNodeId: 'run-1-pr',
    branchName: 'ai/planned-branch-is-not-the-source',
    createdAt: '2026-08-11T09:00:00.000Z',
    updatedAt: '2026-08-11T09:50:00.000Z',
    nodes: [
      {
        id: 'run-1-build',
        stage: 'build',
        title: 'Build',
        subtitle: 'Implement',
        kind: 'task',
        status: 'success',
        ownerId: 'user-desktop',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['diff-1'],
      },
      {
        id: 'run-1-pr',
        stage: 'pr',
        title: 'PR',
        subtitle: 'Deliver',
        kind: 'pr',
        status: 'running',
        ownerId: 'user-desktop',
        requiredRole: 'member',
        retryCount: 0,
        artifactIds: ['pr-package-1'],
      },
    ],
    edges: [],
  }
  const codingRun: CodingAgentRun = {
    id: 'coding-1',
    runId: run.id,
    nodeId: 'run-1-build',
    projectId: run.projectId,
    requestedBy: 'user-desktop',
    providerId: 'fake-coding-engine',
    engine: 'fake',
    status: 'completed',
    managedWorkspaceId: 'workspace-1',
    branchName: 'devflow/run-1-build-coding-1',
    userInstruction: 'Implement the bounded change.',
    prompt: 'redacted',
    summary: 'Completed.',
    changedPaths: ['apps/api/src/example.ts'],
    startedAt: '2026-08-11T09:10:00.000Z',
    completedAt: '2026-08-11T09:30:00.000Z',
    diffArtifactId: 'diff-1',
    testEvidenceId: 'test-evidence-1',
    redacted: true,
  }
  const workspace: ManagedCodingWorkspace = {
    id: 'workspace-1',
    projectId: run.projectId,
    codingRunId: codingRun.id,
    sourcePath: '/private/local/source',
    worktreePath: '/private/local/worktree',
    branchName: codingRun.branchName!,
    baseBranch: 'main',
    baseCommitSha,
    headCommitSha: expectedCommitSha,
    createdAt: '2026-08-11T09:05:00.000Z',
    cleanupStatus: 'active',
  }
  const diffArtifact: CodingDiffArtifact = {
    id: 'diff-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: run.projectId,
    changedPaths: ['apps/api/src/example.ts'],
    patch: '+ redacted patch',
    sourceDigest: diffDigest,
    truncated: false,
    redacted: true,
    createdAt: '2026-08-11T09:25:00.000Z',
  }
  const testEvidence = {
    id: 'test-evidence-1',
    runId: run.id,
    nodeId: codingRun.nodeId,
    projectId: run.projectId,
    command: 'pnpm test',
    cwd: workspace.worktreePath,
    status: 'passed',
    exitCode: 0,
    durationMs: 100,
    stdout: '',
    stderr: '',
    summary: 'Tests passed in the managed worktree.',
    redacted: true,
    sourceCommitSha: expectedCommitSha,
    createdAt: '2026-08-11T09:35:00.000Z',
  } satisfies TestEvidence & { sourceCommitSha: string }
  const prPackage: Artifact = {
    id: 'pr-package-1',
    runId: run.id,
    nodeId: 'run-1-pr',
    kind: 'pr',
    title: 'PR Draft: exact approved commit',
    summary: 'Bounded delivery package.',
    content: '# Exact approved commit\n\nEvidence only.',
    redacted: true,
    updatedAt: '2026-08-11T09:40:00.000Z',
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: codingRun.id,
      workspaceId: workspace.id,
      diffArtifactId: diffArtifact.id,
      diffSourceDigest: diffDigest,
      testEvidenceId: testEvidence.id,
      headBranch: workspace.branchName,
    },
  }
  return {
    id: 'local-delivery-intent-1',
    repositoryBinding,
    run,
    prNodeId: 'run-1-pr',
    codingRun,
    workspace,
    diffArtifact,
    prPackage,
    testEvidence,
    baseCommitSha,
    expectedCommitSha,
    now,
  }
}

function createHarness() {
  let nextId = 1
  const repository = createSeedGitHubDeliveryRepository({
    now: () => new Date(now),
    id: (kind) => `${kind}-${nextId++}`,
    resolveProjectRole: ({ organizationId: scopedOrganizationId, projectId: scopedProjectId, userId }) => {
      if (scopedOrganizationId !== organizationId || scopedProjectId !== projectId) {
        return null
      }
      return userId === 'user-owner'
        ? 'owner'
        : userId === 'user-desktop'
          ? 'member'
          : null
    },
    desktopTokenStillAuthorized: (input) =>
      input.organizationId === organizationId &&
      input.projectId === projectId &&
      input.userId === 'user-desktop' &&
      input.tokenRecordId === 'desktop-token-1',
    resolveCanonicalRunAuthority: (input) =>
      input.organizationId === organizationId &&
      input.projectId === projectId &&
      input.runId === 'run-1'
        ? {
            organizationId,
            projectId,
            runId: 'run-1',
            runVersion: 7,
            currentNodeId: 'run-1-pr',
            materializedByTokenRecordId: 'desktop-token-1',
          }
        : null,
  })

  const verifyRepository = vi.fn<GitHubAppClient['verifyRepository']>(
    async (input) => ({
      ...input,
      repository: 'example/project',
      defaultBranch: 'main',
      private: true,
      visibility: 'private',
      verifiedAt: now,
    }),
  )
  const issueContentsWriteToken = vi.fn<
    GitHubAppClient['issueContentsWriteToken']
  >(async (input) => ({
    ...input,
    token: ephemeralToken,
    expiresAt: credentialExpiresAt,
    providerExpiresAt: credentialExpiresAt,
    permissions: { contents: 'write' },
  }))
  const revokeInstallationAccessToken = vi.fn<
    GitHubAppClient['revokeInstallationAccessToken']
  >(async () => undefined)
  const observeProviderCredentialExpiry = vi.fn<
    GitHubAppClient['observeProviderCredentialExpiry']
  >(async (input) => ({
    ...input,
    providerObservedAt: '2026-08-11T16:00:02.000Z',
  }))
  const getBranchHead = vi.fn<GitHubAppClient['getBranchHead']>(
    async (input) => ({
      repository: input.repository,
      branch: input.branch,
      sha: expectedCommitSha,
      verifiedAt: now,
    }),
  )
  const findDraftPullRequest = vi.fn<GitHubAppClient['findDraftPullRequest']>(
    async () => null,
  )
  const findOrCreateDraftPullRequest = vi.fn<
    GitHubAppClient['findOrCreateDraftPullRequest']
  >(async (input) => ({
    disposition: 'created',
    pullRequest: {
      id: '456789',
      number: 42,
      url: `https://github.com/${input.repository}/pull/42`,
      repository: input.repository,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      headSha: input.expectedHeadSha,
      state: 'open',
      draft: true,
      marker: `<!-- devflow-delivery:${input.idempotencyKey.slice('github-delivery:'.length)} -->`,
      createdAt: now,
    },
  }))
  const client: GitHubAppClient = {
    verifyRepository,
    issueContentsWriteToken,
    observeProviderCredentialExpiry,
    revokeInstallationAccessToken,
    getBranchHead,
    findDraftPullRequest,
    findOrCreateDraftPullRequest,
  }
  const service = createGitHubDeliveryService({
    repository,
    client,
    clock: () => new Date(now),
  })
  return {
    repository,
    service,
    effects: {
      verifyRepository,
      issueContentsWriteToken,
      observeProviderCredentialExpiry,
      revokeInstallationAccessToken,
      getBranchHead,
      findDraftPullRequest,
      findOrCreateDraftPullRequest,
    },
  }
}

async function route(
  harness: ReturnType<typeof createHarness>,
  method: string,
  pathname: string,
  principal: RequestPrincipal,
  body?: unknown,
): Promise<GitHubDeliveryRouteResult | null> {
  return resolveGitHubDeliveryRoute(
    method,
    pathname,
    harness.repository,
    harness.service,
    body === undefined ? { principal } : { principal, body },
  )
}

describe('GitHub Delivery API integration', () => {
  it('invalidates an approved revision before any credential can be issued', async () => {
    const harness = createHarness()
    const bindingResult = await route(
      harness,
      'PUT',
      `/api/team/projects/${projectId}/github-repository-binding`,
      ownerPrincipal,
      {
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion: 0,
      },
    )
    const repositoryBinding = (
      bindingResult?.body as { binding: GitHubRepositoryBinding }
    ).binding
    const original = await createGitHubDeliveryIntent(
      createIntentSource(repositoryBinding),
    )
    const submitPath = `/api/desktop/projects/${projectId}/github-deliveries`
    const submitted = await route(harness, 'POST', submitPath, desktopPrincipal, {
      intent: original,
      prTitle: 'Deliver the exact approved commit',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    })
    const request = (submitted?.body as { request: GitHubDeliveryRequest }).request
    await expect(route(
      harness,
      'POST',
      `/api/team/projects/${projectId}/github-deliveries/${request.id}/approve`,
      ownerPrincipal,
      { expectedStateVersion: request.stateVersion },
    )).resolves.toMatchObject({
      status: 200,
      body: { request: { stateVersion: 2, intentRevision: 1, status: 'approved' } },
    })

    const revisedSource = createIntentSource(repositoryBinding)
    revisedSource.id = 'local-delivery-intent-revision-2'
    revisedSource.now = '2026-08-11T10:01:00.000Z'
    revisedSource.testEvidence = {
      ...revisedSource.testEvidence,
      id: 'test-evidence-revision-2',
      createdAt: '2026-08-11T09:55:00.000Z',
    }
    revisedSource.prPackage = {
      ...revisedSource.prPackage,
      summary: 'Materially revised delivery package.',
      content: '# Exact approved commit\n\nRevised evidence only.',
      updatedAt: '2026-08-11T09:56:00.000Z',
    }
    const revisedIntent = await createGitHubDeliveryIntent(revisedSource)
    expect(revisedIntent.deliverySeriesKey).toBe(original.deliverySeriesKey)
    expect(revisedIntent.idempotencyKey).toBe(original.idempotencyKey)
    expect(revisedIntent.intentDigest).not.toBe(original.intentDigest)

    const revised = await route(harness, 'POST', submitPath, desktopPrincipal, {
      intent: revisedIntent,
      prTitle: 'Deliver the revised exact commit',
      prBody: 'Bound to revised passing Test Evidence.',
      expectedStateVersion: 2,
    })
    expect(revised).toMatchObject({
      status: 200,
      body: {
        request: {
          id: request.id,
          localIntentId: revisedIntent.id,
          stateVersion: 3,
          intentRevision: 2,
          status: 'approval_required',
          intentDigest: revisedIntent.intentDigest,
        },
        outcomeCode: 'delivery_revised',
        replayed: false,
      },
    })
    const requestPath = `${submitPath}/${request.id}`
    await expect(route(harness, 'GET', requestPath, desktopPrincipal))
      .resolves.toMatchObject({
        status: 200,
        body: {
          snapshot: {
            request: { intentRevision: 2, status: 'approval_required' },
            approval: null,
            grant: null,
          },
        },
      })
    await expect(route(
      harness,
      'POST',
      `${requestPath}/credential-grant`,
      desktopPrincipal,
      { expectedStateVersion: 3 },
    )).resolves.toMatchObject({
      status: 409,
      body: { outcomeCode: 'approval_required', replayed: false },
    })
    expect(harness.effects.issueContentsWriteToken).not.toHaveBeenCalled()
  })

  it('revokes a provider token when owner binding revocation wins seed finalization', async () => {
    const harness = createHarness()
    const bindingPath = `/api/team/projects/${projectId}/github-repository-binding`
    const bindingResult = await route(
      harness,
      'PUT',
      bindingPath,
      ownerPrincipal,
      {
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion: 0,
      },
    )
    const repositoryBinding = (
      bindingResult?.body as { binding: GitHubRepositoryBinding }
    ).binding
    const intent = await createGitHubDeliveryIntent(
      createIntentSource(repositoryBinding),
    )
    const submitPath = `/api/desktop/projects/${projectId}/github-deliveries`
    const submitted = await route(
      harness,
      'POST',
      submitPath,
      desktopPrincipal,
      {
        intent,
        prTitle: 'Deliver the exact approved commit',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
    )
    const request = (submitted?.body as { request: GitHubDeliveryRequest }).request
    await expect(
      route(
        harness,
        'POST',
        `/api/team/projects/${projectId}/github-deliveries/${request.id}/approve`,
        ownerPrincipal,
        { expectedStateVersion: request.stateVersion },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { request: { stateVersion: 2, status: 'approved' } },
    })

    const minted = {
      installationId: '12345',
      repositoryId: '98765',
      token: ephemeralToken,
      expiresAt: credentialExpiresAt,
      providerExpiresAt: credentialExpiresAt,
      permissions: { contents: 'write' as const },
    }
    let resolveMint: ((access: typeof minted) => void) | undefined
    harness.effects.issueContentsWriteToken.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMint = resolve
        }),
    )
    const requestPath = `${submitPath}/${request.id}`
    const pendingCredential = route(
      harness,
      'POST',
      `${requestPath}/credential-grant`,
      desktopPrincipal,
      { expectedStateVersion: 2 },
    )
    await vi.waitFor(() =>
      expect(harness.effects.issueContentsWriteToken).toHaveBeenCalledTimes(1),
    )

    await expect(
      route(
        harness,
        'POST',
        `${bindingPath}/revoke`,
        ownerPrincipal,
        { expectedStateVersion: 1 },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        binding: { version: 2, status: 'revoked' },
        outcomeCode: 'binding_revoked',
        replayed: false,
      },
    })
    resolveMint!(minted)

    const credentialResult = await pendingCredential
    expect(credentialResult).toEqual({
      status: 409,
      body: {
        error: 'conflict',
        message: 'The Project GitHub repository binding is not active.',
        outcomeCode: 'binding_inactive',
        replayed: false,
      },
    })
    expect(harness.effects.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.effects.revokeInstallationAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.effects.revokeInstallationAccessToken).toHaveBeenCalledWith(
      ephemeralToken,
    )

    const snapshot = await route(
      harness,
      'GET',
      requestPath,
      desktopPrincipal,
    )
    expect(snapshot).toMatchObject({
      status: 200,
      body: {
        snapshot: {
          request: {
            status: 'revoked',
            outcomeCode: 'binding_revoked',
          },
        grant: {
          status: 'revoked',
          outcomeCode: 'credential_revocation_confirmed',
        },
        },
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain(ephemeralToken)
    expect(JSON.stringify(credentialResult)).not.toContain(ephemeralToken)
  })

  it('delivers one exact approved commit through separated Web/Desktop authority and replays its Draft PR without another provider effect', async () => {
    const harness = createHarness()
    const bindingPath = `/api/team/projects/${projectId}/github-repository-binding`

    await expect(
      route(harness, 'PUT', bindingPath, desktopPrincipal, {
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion: 0,
      }),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'authentication_forbidden', replayed: false },
    })
    expect(harness.effects.verifyRepository).not.toHaveBeenCalled()

    const bindingResult = await route(harness, 'PUT', bindingPath, ownerPrincipal, {
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 0,
    })
    expect(bindingResult).toMatchObject({
      status: 201,
      body: {
        binding: { stateVersion: 1, version: 1, status: 'active' },
        outcomeCode: 'binding_created',
        replayed: false,
      },
    })
    expect(harness.effects.verifyRepository).toHaveBeenCalledTimes(1)
    const repositoryBinding = (
      bindingResult?.body as { binding: GitHubRepositoryBinding }
    ).binding
    const intent = await createGitHubDeliveryIntent(
      createIntentSource(repositoryBinding),
    )
    const submitPath = `/api/desktop/projects/${projectId}/github-deliveries`
    const submitBody = {
      intent,
      prTitle: 'Deliver the exact approved commit',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    }

    await expect(
      route(harness, 'POST', submitPath, ownerPrincipal, submitBody),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'authentication_forbidden', replayed: false },
    })

    const submitted = await route(
      harness,
      'POST',
      submitPath,
      desktopPrincipal,
      submitBody,
    )
    expect(submitted).toMatchObject({
      status: 201,
      body: {
        request: {
          stateVersion: 1,
          intentRevision: 1,
          status: 'approval_required',
          expectedCommitSha,
        },
        outcomeCode: 'delivery_created',
        replayed: false,
      },
    })
    const request = (submitted?.body as { request: GitHubDeliveryRequest }).request
    const requestPath = `${submitPath}/${request.id}`

    await expect(
      route(
        harness,
        'POST',
        `/api/team/projects/${projectId}/github-deliveries/${request.id}/approve`,
        desktopPrincipal,
        { expectedStateVersion: 1 },
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { outcomeCode: 'authentication_forbidden', replayed: false },
    })

    const approved = await route(
      harness,
      'POST',
      `/api/team/projects/${projectId}/github-deliveries/${request.id}/approve`,
      ownerPrincipal,
      { expectedStateVersion: 1 },
    )
    expect(approved).toMatchObject({
      status: 200,
      body: {
        request: { stateVersion: 2, status: 'approved' },
        approval: {
          requestStateVersion: 1,
          authenticationKind: 'session_cookie',
        },
        outcomeCode: 'delivery_approved',
        replayed: false,
      },
    })
    const approval = (
      approved?.body as { approval: GitHubDeliveryApproval }
    ).approval
    expect(approval.approvedByUserId).toBe('user-owner')

    const credentialResult = await route(
      harness,
      'POST',
      `${requestPath}/credential-grant`,
      desktopPrincipal,
      { expectedStateVersion: 2 },
    )
    expect(credentialResult).toMatchObject({
      status: 200,
      body: {
        request: { stateVersion: 4, status: 'publishing_branch' },
        grant: { version: 2, status: 'issued', repositoryCount: 1 },
        credential: {
          token: ephemeralToken,
          expiresAt: credentialExpiresAt,
          repositoryId: '98765',
        },
        outcomeCode: 'grant_finalized',
        replayed: false,
      },
    })
    expect(harness.effects.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.effects.revokeInstallationAccessToken).not.toHaveBeenCalled()
    const credentialBody = credentialResult?.body as {
      grant: GitHubCredentialGrant
    }

    const issuedSnapshot = await route(
      harness,
      'GET',
      requestPath,
      desktopPrincipal,
    )
    expect(issuedSnapshot).toMatchObject({
      status: 200,
      body: {
        snapshot: {
          request: { stateVersion: 4, status: 'publishing_branch' },
          grant: { version: 2, status: 'issued', redacted: true },
          publication: null,
          pullRequest: null,
        },
      },
    })
    const issuedSnapshotBody = issuedSnapshot?.body as {
      snapshot: { grant: GitHubCredentialGrant }
    }
    expect(issuedSnapshotBody.snapshot.grant).not.toHaveProperty('token')
    expect(JSON.stringify(issuedSnapshot)).not.toContain(ephemeralToken)
    expect(JSON.stringify(issuedSnapshot)).not.toContain('/private/local/')

    const publicationResult = await route(
      harness,
      'POST',
      `${requestPath}/branch-publication`,
      desktopPrincipal,
      {
        grantId: credentialBody.grant.id,
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'pushed',
      },
    )
    expect(publicationResult).toMatchObject({
      status: 200,
      body: {
        request: { stateVersion: 6, status: 'branch_published' },
        publication: {
          version: 2,
          status: 'verified',
          verifiedHeadSha: expectedCommitSha,
          outcomeCode: 'branch_verified',
        },
        outcomeCode: 'publication_verified',
        replayed: false,
      },
    })
    expect(harness.effects.getBranchHead).toHaveBeenCalledTimes(1)
    expect(harness.effects.getBranchHead).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      branch: intent.headBranch,
    })
    const publication = (
      publicationResult?.body as { publication: GitHubBranchPublication }
    ).publication
    const pullRequestBody = {
      publicationId: publication.id,
      expectedStateVersion: 6,
    }

    const createdPullRequest = await route(
      harness,
      'POST',
      `${requestPath}/draft-pull-request`,
      desktopPrincipal,
      pullRequestBody,
    )
    expect(createdPullRequest).toMatchObject({
      status: 200,
      body: {
        request: { stateVersion: 8, status: 'completed' },
        pullRequest: {
          version: 2,
          status: 'completed',
          pullRequestId: '456789',
          pullRequestNumber: 42,
          safeUrl: 'https://github.com/example/project/pull/42',
          headSha: expectedCommitSha,
          draft: true,
          outcomeCode: 'draft_pr_created',
        },
        outcomeCode: 'pull_request_completed',
        replayed: false,
      },
    })
    expect(harness.effects.findOrCreateDraftPullRequest).toHaveBeenCalledWith({
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      baseBranch: 'main',
      headBranch: intent.headBranch,
      expectedHeadSha: expectedCommitSha,
      idempotencyKey: intent.idempotencyKey,
      title: submitBody.prTitle,
      body: submitBody.prBody,
    })

    const replayedPullRequest = await route(
      harness,
      'POST',
      `${requestPath}/draft-pull-request`,
      desktopPrincipal,
      pullRequestBody,
    )
    expect(replayedPullRequest).toMatchObject({
      status: 200,
      body: {
        request: { stateVersion: 8, status: 'completed' },
        pullRequest: { version: 2, status: 'completed' },
        outcomeCode: 'pull_request_completed',
        replayed: true,
      },
    })
    expect(harness.effects.findOrCreateDraftPullRequest).toHaveBeenCalledTimes(1)
    expect(harness.effects.findDraftPullRequest).not.toHaveBeenCalled()

    const completedSnapshot = await route(
      harness,
      'GET',
      requestPath,
      desktopPrincipal,
    )
    expect(completedSnapshot).toMatchObject({
      status: 200,
      body: {
        snapshot: {
          request: { stateVersion: 8, status: 'completed' },
          grant: { version: 3, status: 'consumed' },
          publication: { version: 2, status: 'verified' },
          pullRequest: { version: 2, status: 'completed' },
        },
      },
    })
    expect(JSON.stringify(completedSnapshot)).not.toContain(ephemeralToken)
  })

  it('adopts an earlier verified branch on a later attempt without another credential or push', async () => {
    const harness = createHarness()
    const bindingPath = `/api/team/projects/${projectId}/github-repository-binding`
    const bindingResult = await route(harness, 'PUT', bindingPath, ownerPrincipal, {
      installationId: '12345',
      repositoryId: '98765',
      expectedStateVersion: 0,
    })
    const repositoryBinding = (
      bindingResult?.body as { binding: GitHubRepositoryBinding }
    ).binding
    const submitPath = `/api/desktop/projects/${projectId}/github-deliveries`
    const firstIntent = await createGitHubDeliveryIntent(
      createIntentSource(repositoryBinding),
    )
    const requestBody = (intent: typeof firstIntent) => ({
      intent,
      prTitle: 'Deliver the exact approved commit',
      prBody: 'Bound to passing Test Evidence.',
      expectedStateVersion: 0,
    })
    const submitAndApprove = async (intent: typeof firstIntent) => {
      const submitted = await route(
        harness,
        'POST',
        submitPath,
        desktopPrincipal,
        requestBody(intent),
      )
      const deliveryRequest = (
        submitted?.body as { request: GitHubDeliveryRequest }
      ).request
      await expect(route(
        harness,
        'POST',
        `/api/team/projects/${projectId}/github-deliveries/${deliveryRequest.id}/approve`,
        ownerPrincipal,
        { expectedStateVersion: deliveryRequest.stateVersion },
      )).resolves.toMatchObject({
        status: 200,
        body: { request: { status: 'approved' } },
      })
      return deliveryRequest
    }

    const firstRequest = await submitAndApprove(firstIntent)
    const firstRequestPath = `${submitPath}/${firstRequest.id}`
    const credentialResult = await route(
      harness,
      'POST',
      `${firstRequestPath}/credential-grant`,
      desktopPrincipal,
      { expectedStateVersion: 2 },
    )
    const issuedGrant = (
      credentialResult?.body as { grant: GitHubCredentialGrant }
    ).grant
    const publicationResult = await route(
      harness,
      'POST',
      `${firstRequestPath}/branch-publication`,
      desktopPrincipal,
      {
        grantId: issuedGrant.id,
        expectedStateVersion: 4,
        expectedGrantVersion: issuedGrant.version,
        reportedOutcomeCode: 'pushed',
      },
    )
    const firstPublication = (
      publicationResult?.body as { publication: GitHubBranchPublication }
    ).publication
    harness.effects.findOrCreateDraftPullRequest.mockRejectedValueOnce(
      new GitHubAppClientError('github_request_rejected', 422),
    )
    await expect(route(
      harness,
      'POST',
      `${firstRequestPath}/draft-pull-request`,
      desktopPrincipal,
      {
        publicationId: firstPublication.id,
        expectedStateVersion: 6,
      },
    )).resolves.toMatchObject({
      status: 502,
      body: {
        code: 'github_request_rejected',
        retryable: false,
        phase: 'pull_request',
      },
    })
    await expect(route(
      harness,
      'GET',
      firstRequestPath,
      desktopPrincipal,
    )).resolves.toMatchObject({
      status: 200,
      body: {
        snapshot: {
          request: { status: 'failed', outcomeCode: 'pull_request_failed' },
          grant: { status: 'consumed' },
          publication: { status: 'verified', outcomeCode: 'branch_verified' },
          pullRequest: { status: 'failed', outcomeCode: 'pull_request_failed' },
        },
      },
    })

    const secondIntent = await createGitHubDeliveryIntent({
      ...createIntentSource(repositoryBinding),
      id: 'local-delivery-intent-2',
      deliveryAttempt: 2,
    })
    const secondRequest = await submitAndApprove(secondIntent)
    const secondRequestPath = `${submitPath}/${secondRequest.id}`
    const adopted = await route(
      harness,
      'POST',
      `${secondRequestPath}/branch-publication/recover`,
      desktopPrincipal,
      { expectedStateVersion: 2 },
    )
    expect(adopted).toMatchObject({
      status: 201,
      body: {
        request: { status: 'branch_published' },
        publication: {
          grantId: null,
          sourcePublicationId: firstPublication.id,
          status: 'verified',
          reportedOutcomeCode: 'already_present',
          verifiedHeadSha: expectedCommitSha,
          outcomeCode: 'branch_verified',
        },
        outcomeCode: 'publication_adopted',
        replayed: false,
      },
    })
    const adoptedBody = adopted?.body as {
      request: GitHubDeliveryRequest
      publication: GitHubBranchPublication
    }
    await expect(route(
      harness,
      'POST',
      `${secondRequestPath}/draft-pull-request`,
      desktopPrincipal,
      {
        publicationId: adoptedBody.publication.id,
        expectedStateVersion: adoptedBody.request.stateVersion,
      },
    )).resolves.toMatchObject({
      status: 200,
      body: {
        request: { status: 'completed', outcomeCode: 'draft_pr_created' },
        pullRequest: { status: 'completed', outcomeCode: 'draft_pr_created' },
        outcomeCode: 'pull_request_completed',
      },
    })
    expect(harness.effects.issueContentsWriteToken).toHaveBeenCalledTimes(1)
    expect(harness.effects.getBranchHead).toHaveBeenCalledTimes(1)
    expect(harness.effects.findOrCreateDraftPullRequest).toHaveBeenCalledTimes(2)
    expect(harness.effects.findDraftPullRequest).not.toHaveBeenCalled()
  })
})
