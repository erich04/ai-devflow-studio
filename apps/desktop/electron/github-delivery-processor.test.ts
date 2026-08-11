import { describe, expect, it, vi } from 'vitest'
import type { GitHubDeliveryIntent } from '@ai-devflow/shared'
import {
  createGitHubDeliveryProcessor,
  type GitHubDeliveryProcessorDeps,
} from './github-delivery-processor.js'
import type {
  GitHubDeliveryApprovalRecord,
  GitHubBranchPublicationRecord,
  GitHubCredentialGrantRecord,
  GitHubDeliveryRecoverySnapshot,
  GitHubDeliveryRequestRecord,
  GitHubPullRequestOutcomeRecord,
} from './github-delivery-remote-client.js'
import { GitHubDeliveryRemoteError } from './github-delivery-remote-client.js'

const sha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const initialTime = '2026-08-11T12:00:00.000Z'

function intent(overrides: Partial<GitHubDeliveryIntent> = {}): GitHubDeliveryIntent {
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
    repository: 'acme/widgets',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr',
    baseCommitSha: baseSha,
    expectedCommitSha: sha,
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'diff-digest',
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T11:10:00.000Z',
    testEvidenceDigest: 'test-digest',
    prPackageArtifactId: 'artifact-pr-1',
    prPackageUpdatedAt: '2026-08-11T11:20:00.000Z',
    prPackageDigest: 'package-digest',
    changedPaths: ['src/widget.ts'],
    intentDigest: 'intent-digest',
    idempotencyKey: 'github-delivery:key',
    status: 'approval_required',
    createdAt: initialTime,
    updatedAt: initialTime,
    redacted: true,
    ...overrides,
  }
}

function request(
  source: GitHubDeliveryIntent,
  overrides: Partial<GitHubDeliveryRequestRecord> = {},
): GitHubDeliveryRequestRecord {
  return {
    id: 'request-1',
    stateVersion: 1,
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
    status: source.status,
    outcomeCode: null,
    expectedRunVersion: source.runVersion,
    baseBranch: source.baseBranch,
    headBranch: source.headBranch,
    baseCommitSha: source.baseCommitSha,
    expectedCommitSha: source.expectedCommitSha,
    intentDigest: source.intentDigest,
    logicalIdempotencyKey: source.idempotencyKey,
    diffDigest: source.diffSourceDigest,
    testEvidenceDigest: source.testEvidenceDigest,
    packageDigest: source.prPackageDigest,
    changedPaths: [...source.changedPaths],
    prTitle: 'Ship widgets',
    prBody: '# Ship widgets',
    expiresAt: '2026-08-12T12:00:00.000Z',
    createdAt: initialTime,
    updatedAt: initialTime,
    redacted: true,
    ...overrides,
  }
}

function grant(overrides: Partial<GitHubCredentialGrantRecord> = {}): GitHubCredentialGrantRecord {
  return {
    id: 'grant-1',
    version: 1,
    requestId: 'request-1',
    intentRevision: 1,
    approvalId: 'approval-1',
    attempt: 1,
    repositoryId: '202',
    permission: 'contents:write',
    repositoryCount: 1,
    status: 'issued',
    requestedAt: initialTime,
    issuedAt: initialTime,
    credentialExpiresAt: '2026-08-11T13:00:00.000Z',
    consumedAt: null,
    outcomeCode: null,
    redacted: true,
    ...overrides,
  }
}

function approval(
  source: GitHubDeliveryIntent,
  deliveryRequest: GitHubDeliveryRequestRecord,
): GitHubDeliveryApprovalRecord {
  return {
    id: 'approval-1',
    requestId: deliveryRequest.id,
    intentRevision: deliveryRequest.intentRevision,
    requestStateVersion: deliveryRequest.stateVersion,
    intentDigest: source.intentDigest,
    repositoryBindingId: source.repositoryBindingId,
    repositoryBindingVersion: source.repositoryBindingVersion,
    runId: source.runId,
    runVersion: source.runVersion,
    nodeId: source.nodeId,
    repositoryId: source.repositoryId,
    baseBranch: source.baseBranch,
    headBranch: source.headBranch,
    expectedCommitSha: source.expectedCommitSha,
    testEvidenceDigest: source.testEvidenceDigest,
    packageDigest: source.prPackageDigest,
    approvedByUserId: 'lead-1',
    approvedRole: 'lead',
    authenticationKind: 'session_cookie',
    approvedAt: initialTime,
    redacted: true,
  }
}

function publication(
  overrides: Partial<GitHubBranchPublicationRecord> = {},
): GitHubBranchPublicationRecord {
  return {
    id: 'publication-1',
    version: 1,
    requestId: 'request-1',
    intentRevision: 1,
    grantId: 'grant-1',
    status: 'verified',
    reportedOutcomeCode: 'pushed',
    verifiedHeadSha: sha,
    reportedAt: initialTime,
    verifiedAt: initialTime,
    outcomeCode: 'branch_verified',
    redacted: true,
    ...overrides,
  }
}

function pullRequest(
  overrides: Partial<GitHubPullRequestOutcomeRecord> = {},
): GitHubPullRequestOutcomeRecord {
  return {
    id: 'pull-request-outcome-1',
    version: 1,
    requestId: 'request-1',
    intentRevision: 1,
    publicationId: 'publication-1',
    status: 'completed',
    pullRequestId: '303',
    pullRequestNumber: 42,
    safeUrl: 'https://github.com/acme/widgets/pull/42',
    draft: true,
    headBranch: 'devflow/run-1-pr',
    baseBranch: 'main',
    headSha: sha,
    providerCreatedAt: '2026-08-11T12:10:00.000Z',
    recordedAt: '2026-08-11T12:10:01.000Z',
    outcomeCode: 'draft_pr_created',
    redacted: true,
    ...overrides,
  }
}

function snapshot(
  deliveryRequest: GitHubDeliveryRequestRecord,
  overrides: Partial<GitHubDeliveryRecoverySnapshot> = {},
): GitHubDeliveryRecoverySnapshot {
  return {
    request: deliveryRequest,
    approval: null,
    grant: null,
    publication: null,
    pullRequest: null,
    ...overrides,
  }
}

function harness(source = intent(), maxIntentsPerCycle?: number) {
  let current = source
  const store = {
    listGitHubDeliveryIntents: vi.fn(async () => [current]),
    listArtifacts: vi.fn(async () => [{
      id: source.prPackageArtifactId,
      runId: source.runId,
      nodeId: source.nodeId,
      kind: 'pr',
      title: 'Ship widgets',
      summary: 'Package',
      content: '# Ship widgets',
      redacted: true,
      updatedAt: source.prPackageUpdatedAt,
    }]),
    listManagedCodingWorkspaces: vi.fn(async () => [{
      id: source.workspaceId,
      projectId: source.localProjectId,
      worktreePath: '/private/managed/worktree',
      headCommitSha: source.expectedCommitSha,
      cleanupStatus: 'active',
      deletedAt: null,
    }]),
    getRun: vi.fn(async () => ({
      id: source.runId,
      updatedAt: initialTime,
      nodes: [{ id: source.nodeId, status: 'running' }],
      pullRequestUrl: undefined,
    })),
    commitGitHubDeliveryIntentStatus: vi.fn(async ({ expectedIntent, intent: next }) => {
      if (current !== expectedIntent) return { committed: false as const, reason: 'source_stale' as const }
      current = next
      return { committed: true as const, replayed: false, intent: current }
    }),
    commitGitHubDeliveryIntentCompletion: vi.fn(async ({ expectedIntent, intent: next }) => {
      if (current !== expectedIntent) return { committed: false as const, reason: 'source_stale' as const }
      current = next
      return { committed: true as const, replayed: false, intent: current }
    }),
  }
  const remote = {
    submit: vi.fn(),
    listInbox: vi.fn(async (): Promise<GitHubDeliveryRequestRecord[]> => []),
    getRecoverySnapshot: vi.fn(),
    withCredentialGrant: vi.fn(),
    reportBranchPublication: vi.fn(),
    createDraftPullRequest: vi.fn(),
  }
  const publisher = { publish: vi.fn() }
  const workflow = { execute: vi.fn() }
  const preparationRuntime = {
    prepare: vi.fn(async () => ({
      status: 'prepared' as const,
      replayed: true,
      intent: current,
      testEvidence: {},
    })),
  }
  const workspaceCoordinator = {
    runExclusive: vi.fn(async (_workspaceId: string, operation: () => Promise<unknown>) => operation()),
  }
  const processor = createGitHubDeliveryProcessor({
    store,
    remote,
    publisher,
    workflow,
    preparationRuntime,
    workspaceCoordinator,
    maxIntentsPerCycle,
    now: (() => {
      let tick = 0
      return () => new Date(Date.parse(initialTime) + (++tick * 60_000)).toISOString()
    })(),
  } as unknown as GitHubDeliveryProcessorDeps)
  return {
    processor,
    store,
    remote,
    publisher,
    workflow,
    preparationRuntime,
    workspaceCoordinator,
    current: () => current,
  }
}

describe('GitHub Delivery processor', () => {
  it('submits one exact prepared intent and returns only redacted identifiers and disposition', async () => {
    const source = intent()
    const deliveryRequest = request(source)
    const test = harness(source)
    test.remote.submit.mockResolvedValue({
      request: deliveryRequest,
      outcomeCode: 'delivery_created',
      replayed: false,
    })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: deliveryRequest.id,
        disposition: 'submitted',
        outcomeCode: 'delivery_created',
      }],
    })
    expect(test.remote.submit).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      intent: source,
      prTitle: 'Ship widgets',
      prBody: '# Ship widgets',
      expectedStateVersion: 0,
    })
  })

  it('refuses a remote request that reuses the local id with different authority', async () => {
    const source = intent()
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([
      request(source, { repositoryId: '999' }),
    ])

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: 'request-1',
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
  })

  it('publishes and completes the normal approved delivery using server versions', async () => {
    const source = intent()
    const approvedRequest = request(source, {
      stateVersion: 2,
      status: 'approved',
    })
    const publishingRequest = { ...approvedRequest, stateVersion: 4, status: 'publishing_branch' as const }
    const publishedRequest = { ...approvedRequest, stateVersion: 6, status: 'branch_published' as const }
    const completedRequest = {
      ...approvedRequest,
      stateVersion: 8,
      status: 'completed' as const,
      outcomeCode: 'draft_pr_created' as const,
    }
    const branch = publication()
    const pr = pullRequest({ providerCreatedAt: '2026-08-11T12:02:00.000Z' })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: {
        id: 'approval-1',
        requestId: approvedRequest.id,
        intentRevision: approvedRequest.intentRevision,
        requestStateVersion: approvedRequest.stateVersion,
        intentDigest: source.intentDigest,
        repositoryBindingId: source.repositoryBindingId,
        repositoryBindingVersion: source.repositoryBindingVersion,
        runId: source.runId,
        runVersion: source.runVersion,
        nodeId: source.nodeId,
        repositoryId: source.repositoryId,
        baseBranch: source.baseBranch,
        headBranch: source.headBranch,
        expectedCommitSha: source.expectedCommitSha,
        testEvidenceDigest: source.testEvidenceDigest,
        packageDigest: source.prPackageDigest,
        approvedByUserId: 'lead-1',
        approvedRole: 'lead',
        authenticationKind: 'session_cookie',
        approvedAt: initialTime,
        redacted: true,
      },
    }))
    test.publisher.publish.mockResolvedValue({
      outcome: 'pushed',
      expectedCommitSha: sha,
      repository: source.repository,
      headBranch: source.headBranch,
    })
    test.remote.withCredentialGrant.mockImplementation(async (input, callback) => ({
      request: publishingRequest,
      grant: grant({ version: 2 }),
      outcomeCode: 'grant_finalized',
      replayed: false,
      publisherResult: await callback({
        grantId: 'grant-1',
        username: 'x-access-token',
        token: 'secret-ephemeral-token',
        expiresAt: '2026-08-11T13:00:00.000Z',
        repositoryId: source.repositoryId,
        canonicalHttpsUrl: `https://github.com/${source.repository}.git`,
        repository: source.repository,
        headBranch: source.headBranch,
        expectedCommitSha: source.expectedCommitSha,
      }),
    }))
    test.remote.reportBranchPublication.mockResolvedValue({
      request: publishedRequest,
      publication: branch,
      outcomeCode: 'publication_verified',
      replayed: false,
    })
    test.remote.createDraftPullRequest.mockResolvedValue({
      request: completedRequest,
      pullRequest: pr,
      outcomeCode: 'pull_request_completed',
      replayed: false,
    })
    test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

    const result = await test.processor.recoverAndAdvance()

    expect(result).toEqual({ results: [{
      intentId: source.id,
      remoteRequestId: approvedRequest.id,
      disposition: 'workflow_advanced',
      outcomeCode: 'draft_pr_created',
    }] })
    expect(test.remote.withCredentialGrant).toHaveBeenCalledWith(
      { projectId: source.teamProjectId, requestId: approvedRequest.id, expectedStateVersion: 2 },
      expect.any(Function),
    )
    expect(test.publisher.publish).toHaveBeenCalledWith({
      worktreePath: '/private/managed/worktree',
      repository: source.repository,
      headBranch: source.headBranch,
      expectedCommitSha: source.expectedCommitSha,
      token: 'secret-ephemeral-token',
    })
    expect(test.workspaceCoordinator.runExclusive).toHaveBeenCalledWith(
      source.workspaceId,
      expect.any(Function),
    )
    expect(test.preparationRuntime.prepare).toHaveBeenCalledTimes(10)
    expect(test.remote.reportBranchPublication).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: approvedRequest.id,
      grantId: 'grant-1',
      expectedStateVersion: 4,
      expectedGrantVersion: 2,
      reportedOutcomeCode: 'pushed',
    })
    expect(test.remote.createDraftPullRequest).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: approvedRequest.id,
      publicationId: branch.id,
      expectedStateVersion: 6,
    })
    expect(test.store.commitGitHubDeliveryIntentCompletion.mock.invocationCallOrder[0]).toBeLessThan(
      test.workflow.execute.mock.invocationCallOrder[0]!,
    )
    expect(JSON.stringify(result)).not.toContain('secret-ephemeral-token')
    expect(JSON.stringify(result)).not.toContain('/private/managed/worktree')
  })

  it('requires an explicit, current resume after recovering an issued grant with no publication', async () => {
    const source = intent({ status: 'publishing_branch' })
    const publishingRequest = request(source, {
      stateVersion: 4,
      status: 'publishing_branch',
    })
    const issued = grant()
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([publishingRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(publishingRequest, {
      approval: approval(source, publishingRequest),
      grant: issued,
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: publishingRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'credential_issued_without_publication',
      }],
    })
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.current().status).toBe('recovery_required')

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toEqual({
      intentId: source.id,
      remoteRequestId: null,
      disposition: 'local_conflict',
      outcomeCode: 'stale_intent',
    })

    test.remote.withCredentialGrant.mockRejectedValue(new Error('/raw/provider/token'))
    const resumed = await test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: test.current().updatedAt,
    })
    expect(test.remote.withCredentialGrant).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: publishingRequest.id,
      expectedStateVersion: 4,
    }, expect.any(Function))
    expect(resumed).toEqual({
      intentId: source.id,
      remoteRequestId: publishingRequest.id,
      disposition: 'recovery_required',
      outcomeCode: 'processor_failed',
    })
    expect(JSON.stringify(resumed)).not.toContain('/raw/provider/token')
  })

  it('catches local approval state up before recording a remote issued-grant crash window', async () => {
    const source = intent({ status: 'approval_required' })
    const publishingRequest = request(source, {
      stateVersion: 4,
      status: 'publishing_branch',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([publishingRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(publishingRequest, {
      approval: approval(source, publishingRequest),
      grant: grant(),
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: publishingRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'credential_issued_without_publication',
      }],
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.store.commitGitHubDeliveryIntentStatus.mock.calls.map(
      ([mutation]) => mutation.intent.status,
    )).toEqual(['approved', 'publishing_branch', 'recovery_required'])
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

  it('routes an explicit grant-phase recovery back through credential issuance', async () => {
    const source = intent({ status: 'recovery_required' })
    const recoveryRequest = request(source, {
      stateVersion: 5,
      status: 'recovery_required',
      outcomeCode: 'credential_issue_failed',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([recoveryRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(recoveryRequest, {
      approval: approval(source, recoveryRequest),
    }))
    test.remote.withCredentialGrant.mockRejectedValue(new Error('bounded fake stop'))

    await test.processor.resume({ intentId: source.id, expectedUpdatedAt: source.updatedAt })

    expect(test.remote.withCredentialGrant).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: recoveryRequest.id,
      expectedStateVersion: 5,
    }, expect.any(Function))
  })

  it('accepts a replacement issued grant alongside a prior recovery publication only on resume', async () => {
    const source = intent({ status: 'recovery_required' })
    const publishingRequest = request(source, {
      stateVersion: 8,
      status: 'publishing_branch',
    })
    const replacement = grant({ id: 'grant-2', attempt: 2 })
    const prior = publication({
      grantId: 'grant-1',
      status: 'recovery_required',
      verifiedHeadSha: null,
      verifiedAt: null,
      outcomeCode: 'branch_verification_failed',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([publishingRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(publishingRequest, {
      approval: approval(source, publishingRequest),
      grant: replacement,
      publication: prior,
    }))
    test.remote.withCredentialGrant.mockRejectedValue(new Error('bounded fake stop'))

    await test.processor.resume({ intentId: source.id, expectedUpdatedAt: source.updatedAt })

    expect(test.remote.withCredentialGrant).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: publishingRequest.id,
      expectedStateVersion: 8,
    }, expect.any(Function))
  })

  it('routes an explicit PR-phase recovery to draft reconciliation without republishing', async () => {
    const source = intent({ status: 'recovery_required' })
    const recoveryRequest = request(source, {
      stateVersion: 9,
      status: 'recovery_required',
      outcomeCode: 'pull_request_failed',
    })
    const verified = publication()
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([recoveryRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(recoveryRequest, {
      approval: approval(source, recoveryRequest),
      grant: grant({ status: 'consumed', consumedAt: initialTime }),
      publication: verified,
      pullRequest: pullRequest({
        status: 'recovery_required',
        pullRequestId: null,
        pullRequestNumber: null,
        safeUrl: null,
        providerCreatedAt: null,
        outcomeCode: 'pull_request_failed',
      }),
    }))
    test.remote.createDraftPullRequest.mockRejectedValue(new Error('bounded fake stop'))

    await test.processor.resume({ intentId: source.id, expectedUpdatedAt: source.updatedAt })

    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: recoveryRequest.id,
      publicationId: verified.id,
      expectedStateVersion: 9,
    })
  })

  it('parks in recovery when authority changes after publishing state is persisted', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    let preparations = 0
    test.preparationRuntime.prepare.mockImplementation(async () => ({
      status: 'prepared' as const,
      replayed: true,
      intent: ++preparations === 4
        ? { ...test.current(), expectedCommitSha: 'c'.repeat(40) }
        : test.current(),
      testEvidence: {},
    }))

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({
      disposition: 'recovery_required',
      outcomeCode: 'authority_mismatch',
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

  it('parks in recovery when authority changes after creating-PR state is persisted', async () => {
    const source = intent({ status: 'branch_published' })
    const publishedRequest = request(source, { stateVersion: 6, status: 'branch_published' })
    const verified = publication()
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([publishedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(publishedRequest, {
      approval: approval(source, publishedRequest),
      grant: grant({ status: 'consumed', consumedAt: initialTime }),
      publication: verified,
    }))
    let preparations = 0
    test.preparationRuntime.prepare.mockImplementation(async () => ({
      status: 'prepared' as const,
      replayed: true,
      intent: ++preparations === 4
        ? { ...test.current(), expectedCommitSha: 'c'.repeat(40) }
        : test.current(),
      testEvidence: {},
    }))

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({
      disposition: 'recovery_required',
      outcomeCode: 'authority_mismatch',
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('persists a reported publication failure instead of misclassifying its recovery request', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const publishingRequest = request(source, { status: 'publishing_branch', stateVersion: 4 })
    const recoveryRequest = request(source, {
      status: 'recovery_required',
      stateVersion: 6,
      outcomeCode: 'branch_verification_failed',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockResolvedValue({
      request: publishingRequest,
      grant: grant({ version: 2 }),
      outcomeCode: 'grant_finalized',
      replayed: false,
      publisherResult: {
        outcome: 'pushed', expectedCommitSha: sha, repository: source.repository, headBranch: source.headBranch,
      },
    })
    test.remote.reportBranchPublication.mockResolvedValue({
      request: recoveryRequest,
      publication: publication({
        status: 'recovery_required',
        verifiedHeadSha: null,
        verifiedAt: null,
        outcomeCode: 'branch_verification_failed',
      }),
      outcomeCode: 'publication_failed',
      replayed: false,
    })

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({
      disposition: 'recovery_required',
      outcomeCode: 'branch_verification_failed',
    })
    expect(test.current().status).toBe('recovery_required')
  })

  it('reuses a locally persisted publishing phase when remote approval is one step behind', async () => {
    const source = intent({ status: 'publishing_branch' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockRejectedValue(new Error('bounded fake stop'))

    await test.processor.recoverAndAdvance()

    expect(test.remote.withCredentialGrant).toHaveBeenCalled()
    expect(test.store.commitGitHubDeliveryIntentStatus.mock.calls.map(
      ([mutation]) => mutation.intent.status,
    )).toEqual(['recovery_required'])
  })

  it.each(['branch_published', 'creating_pr'] as const)(
    'reuses a locally persisted creating phase while remote is %s',
    async (remoteStatus) => {
      const source = intent({ status: 'creating_pr' })
      const remoteRequest = request(source, { status: remoteStatus, stateVersion: 6 })
      const verified = publication()
      const test = harness(source)
      test.remote.listInbox.mockResolvedValue([remoteRequest])
      test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(remoteRequest, {
        approval: approval(source, remoteRequest),
        grant: grant({ status: 'consumed', consumedAt: initialTime }),
        publication: verified,
        ...(remoteStatus === 'creating_pr'
          ? { pullRequest: pullRequest({
              status: 'creating',
              pullRequestId: null,
              pullRequestNumber: null,
              safeUrl: null,
              providerCreatedAt: null,
              outcomeCode: null,
            }) }
          : {}),
      }))
      test.remote.createDraftPullRequest.mockRejectedValue(new Error('bounded fake stop'))

      await test.processor.recoverAndAdvance()

      expect(test.remote.createDraftPullRequest).toHaveBeenCalled()
      expect(test.store.commitGitHubDeliveryIntentStatus.mock.calls.map(
        ([mutation]) => mutation.intent.status,
      )).toEqual(['recovery_required'])
    },
  )

  it('rejects a completed request whose publication chain is not verified', async () => {
    const source = intent({ status: 'creating_pr' })
    const completedRequest = request(source, {
      status: 'completed',
      stateVersion: 8,
      outcomeCode: 'draft_pr_created',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
      approval: approval(source, completedRequest),
      grant: grant({ status: 'consumed', consumedAt: initialTime }),
      publication: publication({
        status: 'recovery_required',
        verifiedHeadSha: null,
        verifiedAt: null,
        outcomeCode: 'branch_verification_failed',
      }),
      pullRequest: pullRequest(),
    }))

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({ disposition: 'recovery_required' })
    expect(test.store.commitGitHubDeliveryIntentCompletion).not.toHaveBeenCalled()
    expect(test.workflow.execute).not.toHaveBeenCalled()
  })

  it('rechecks canonical intent authority after credential issuance and before the lock', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const publishingRequest = request(source, { status: 'publishing_branch', stateVersion: 4 })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    let preparations = 0
    test.preparationRuntime.prepare.mockImplementation(async () => ({
      status: 'prepared' as const,
      replayed: true,
      intent: ++preparations === 5
        ? { ...test.current(), expectedCommitSha: 'c'.repeat(40) }
        : test.current(),
      testEvidence: {},
    }))
    test.remote.withCredentialGrant.mockImplementation(async (_input, callback) => ({
      request: publishingRequest,
      grant: grant({ version: 2 }),
      outcomeCode: 'grant_finalized',
      replayed: false,
      publisherResult: await callback({
        grantId: 'grant-1', username: 'x-access-token', token: 'secret-ephemeral-token',
        expiresAt: '2026-08-11T13:00:00.000Z', repositoryId: source.repositoryId,
        canonicalHttpsUrl: `https://github.com/${source.repository}.git`, repository: source.repository,
        headBranch: source.headBranch, expectedCommitSha: source.expectedCommitSha,
      }),
    }))

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({ disposition: 'recovery_required' })
    expect(test.workspaceCoordinator.runExclusive).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
  })

  it('does not publish when lock acquisition leaves too little credential lifetime', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const publishingRequest = request(source, { status: 'publishing_branch', stateVersion: 4 })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockImplementation(async (_input, callback) => ({
      request: publishingRequest,
      grant: grant({ version: 2, credentialExpiresAt: '2026-08-11T12:04:00.000Z' }),
      outcomeCode: 'grant_finalized',
      replayed: false,
      publisherResult: await callback({
        grantId: 'grant-1', username: 'x-access-token', token: 'secret-ephemeral-token',
        expiresAt: '2026-08-11T12:04:00.000Z', repositoryId: source.repositoryId,
        canonicalHttpsUrl: `https://github.com/${source.repository}.git`, repository: source.repository,
        headBranch: source.headBranch, expectedCommitSha: source.expectedCommitSha,
      }),
    }))

    const result = await test.processor.recoverAndAdvance()

    expect(result.results[0]).toMatchObject({ disposition: 'recovery_required' })
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret-ephemeral-token')
    expect(JSON.stringify(result)).not.toContain('/private/managed/worktree')
  })

  it('recovers a remote-completed crash window without creating another pull request', async () => {
    const source = intent({ status: 'creating_pr' })
    const completedRequest = request(source, {
      stateVersion: 7,
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
      approval: approval(source, completedRequest),
      grant: grant({ status: 'consumed', consumedAt: '2026-08-11T12:01:00.000Z' }),
      publication: publication(),
      pullRequest: pullRequest({ providerCreatedAt: '2026-08-11T12:02:00.000Z' }),
    }))
    test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: completedRequest.id,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.reportBranchPublication).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
    expect(test.current().status).toBe('completed')
  })

  it('turns a retryable remote error into durable recovery without exposing its message', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockRejectedValue(new GitHubDeliveryRemoteError({
      status: 503,
      code: 'service_unavailable',
      operation: 'recovery_snapshot',
      retryable: true,
    }))

    const result = await test.processor.recoverAndAdvance()
    expect(result).toEqual({ results: [{
      intentId: source.id,
      remoteRequestId: approvedRequest.id,
      disposition: 'recovery_required',
      outcomeCode: 'service_unavailable',
    }] })
    expect(test.current().status).toBe('recovery_required')
    expect(JSON.stringify(result)).not.toContain('GitHub Delivery API')
  })

  it('discards an unexpected raw error and persists recovery from an approved local state', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { status: 'approved', stateVersion: 2 })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockRejectedValue(
      new Error('/private/worktree/raw-provider-body secret-token'),
    )

    const result = await test.processor.recoverAndAdvance()
    expect(result).toEqual({ results: [{
      intentId: source.id,
      remoteRequestId: approvedRequest.id,
      disposition: 'recovery_required',
      outcomeCode: 'processor_failed',
    }] })
    expect(test.current().status).toBe('recovery_required')
    expect(JSON.stringify(result)).not.toMatch(/private|provider-body|secret-token/u)
  })

  it('stops before submission when preparation no longer verifies the stored authority', async () => {
    const source = intent()
    const test = harness(source)
    test.preparationRuntime.prepare.mockResolvedValue({
      status: 'prepared',
      replayed: true,
      intent: { ...source, expectedCommitSha: 'c'.repeat(40) },
      testEvidence: {},
    })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.remote.submit).not.toHaveBeenCalled()
  })

  it('bounds actionable work without letting older terminal history starve the cycle', async () => {
    const source = intent({ id: 'intent-active', createdAt: '2026-08-11T12:01:00.000Z' })
    const terminal = intent({
      id: 'intent-old-terminal',
      status: 'failed',
      createdAt: initialTime,
    })
    const test = harness(source, 1)
    test.store.listGitHubDeliveryIntents.mockResolvedValue([source, terminal])
    test.remote.submit.mockResolvedValue({
      request: request(source),
      outcomeCode: 'delivery_created',
      replayed: false,
    })

    const result = await test.processor.recoverAndAdvance()

    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.intentId).toBe(source.id)
    expect(test.remote.submit).toHaveBeenCalledTimes(1)
  })
})
