import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  Artifact,
  GitHubDeliveryIntent,
  GitHubDeliveryOperatorOutcome,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  createGitHubDeliveryProcessor,
  reconcileCompletedGitHubDeliveryIntents,
  reconcileRemoteCompletedGitHubDeliveryIntents,
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
import { GitHubGitPublisherError } from './github-git-publisher.js'
import { GitHubOutboundContentScanError } from './github-outbound-content-scan.js'

const sha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const initialTime = '2026-08-11T12:00:00.000Z'

function intent(overrides: Partial<GitHubDeliveryIntent> = {}): GitHubDeliveryIntent {
  const source: GitHubDeliveryIntent = {
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
    baseCommitSha: baseSha,
    expectedCommitSha: sha,
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'diff-digest',
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T11:10:00.000Z',
    testEvidenceDigest: 'test-digest',
    prPackageArtifactId: 'artifact-pr-1',
    prPackageUpdatedAt: '2026-08-11T11:20:00.000Z',
    prPackageDigest: '',
    changedPaths: ['src/widget.ts'],
    intentDigest: 'intent-digest',
    idempotencyKey: 'github-delivery:key',
    status: 'approval_required',
    createdAt: initialTime,
    updatedAt: initialTime,
    redacted: true,
    ...overrides,
  }
  if (overrides.prPackageDigest === undefined) {
    source.prPackageDigest = packageDigest(packageArtifact(source))
  }
  return source
}

function packageArtifact(source: GitHubDeliveryIntent): Artifact {
  return {
    id: source.prPackageArtifactId,
    runId: source.runId,
    nodeId: source.nodeId,
    kind: 'pr',
    title: 'Ship widgets',
    summary: 'Package',
    content: '# Ship widgets',
    redacted: true,
    updatedAt: source.prPackageUpdatedAt,
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: source.codingRunId,
      workspaceId: source.workspaceId,
      diffArtifactId: source.diffArtifactId,
      diffSourceDigest: source.diffSourceDigest,
      testEvidenceId: source.testEvidenceId,
      headBranch: source.headBranch,
    },
  }
}

function packageDigest(artifact: Artifact): string {
  return createHash('sha256').update(JSON.stringify({
    id: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    githubDeliverySource: artifact.githubDeliverySource,
    updatedAt: artifact.updatedAt,
  }), 'utf8').digest('hex')
}

function pendingPrRun(source: GitHubDeliveryIntent): WorkflowRun {
  return {
    id: source.runId,
    version: source.runVersion,
    title: 'Ship widgets',
    request: 'Ship the approved widget change.',
    projectId: source.localProjectId,
    creatorId: 'user-1',
    status: 'paused_at_gate',
    currentNodeId: source.nodeId,
    branchName: 'ai/non-authoritative-plan',
    createdAt: initialTime,
    updatedAt: initialTime,
    nodes: [{
      id: source.nodeId,
      stage: 'pr',
      title: 'PR',
      subtitle: 'Deliver',
      kind: 'pr',
      status: 'running',
      ownerId: 'user-1',
      requiredRole: 'member',
      retryCount: 0,
      artifactIds: [source.prPackageArtifactId],
    }],
    edges: [],
  }
}

function completedIntent(): GitHubDeliveryIntent & {
  status: 'completed'
  completion: NonNullable<GitHubDeliveryIntent['completion']>
} {
  const recordedAt = '2026-08-11T12:10:02.000Z'
  const source = intent()
  return {
    ...source,
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
      recordedAt,
      draft: true,
      redacted: true,
    },
    updatedAt: recordedAt,
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
    deliverySeriesKey: source.deliverySeriesKey,
    deliveryAttempt: source.deliveryAttempt,
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
    providerExpiryContractVersion: 1,
    providerCredentialExpiresAt: '2026-08-11T13:00:00.000Z',
    providerExpiryObservedAt: null,
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
    sourcePublicationId: null,
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
    providerRetryNotBefore: null,
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

function harness(
  source = intent(),
  limits?: number | {
    maxIntentsPerCycle?: number
    maxIntentsScannedPerCycle?: number
    onIntentOperationChange?: (
      active: { intentId: string; expectedUpdatedAt: string } | null,
    ) => void | Promise<void>
  },
) {
  let current = source
  const store = {
    listGitHubDeliveryIntents: vi.fn(async () => [current]),
    listGitHubDeliveryOperatorOutcomes: vi.fn(
      async (): Promise<GitHubDeliveryOperatorOutcome[]> => [],
    ),
    listArtifacts: vi.fn(async () => [packageArtifact(source)]),
    listManagedCodingWorkspaces: vi.fn(async () => [{
      id: source.workspaceId,
      projectId: source.localProjectId,
      worktreePath: '/private/managed/worktree',
      headCommitSha: source.expectedCommitSha,
      cleanupStatus: 'active',
      deletedAt: null as string | null | undefined,
    }]),
    getRun: vi.fn(async () => pendingPrRun(source)),
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
    commitGitHubDeliveryContentScan: vi.fn(async ({ expectedIntent, scan }) => {
      if (current !== expectedIntent) return { committed: false as const, reason: 'source_stale' as const }
      return { committed: true as const, replayed: false, scan }
    }),
  }
  const remote = {
    submit: vi.fn(),
    listInbox: vi.fn(async (): Promise<GitHubDeliveryRequestRecord[]> => []),
    getRecoverySnapshot: vi.fn(),
    withCredentialGrant: vi.fn(),
    reportBranchPublication: vi.fn(),
    adoptVerifiedBranchPublication: vi.fn(),
    createDraftPullRequest: vi.fn(),
  }
  const publisher = { publish: vi.fn() }
  const contentScanner = {
    scan: vi.fn(async (input: {
      worktreePath: string
      baseCommitSha: string
      expectedCommitSha: string
    }) => ({
      stateVersion: 1 as const,
      scannerVersion: 1 as const,
      baseCommitSha: input.baseCommitSha,
      expectedCommitSha: input.expectedCommitSha,
      commitCount: 1,
      scannedByteCount: 128,
      secretMatchCount: 0 as const,
      scanDigest: 'f'.repeat(64),
      status: 'safe' as const,
      scannedAt: '2026-08-11T12:04:00.000Z',
    })),
  }
  const workflow = { execute: vi.fn() }
  const preparationRuntime = {
    prepare: vi.fn(async (_input: { runId: string }) => ({
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
    contentScanner,
    workflow,
    preparationRuntime,
    workspaceCoordinator,
    maxIntentsPerCycle: typeof limits === 'number'
      ? limits
      : limits?.maxIntentsPerCycle,
    maxIntentsScannedPerCycle: typeof limits === 'number'
      ? undefined
      : limits?.maxIntentsScannedPerCycle,
    onIntentOperationChange: typeof limits === 'number'
      ? undefined
      : limits?.onIntentOperationChange,
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
    contentScanner,
    workflow,
    preparationRuntime,
    workspaceCoordinator,
    current: () => current,
  }
}

describe('GitHub Delivery processor', () => {
  it('durably blocks hostile outbound content before requesting any GitHub credential', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.contentScanner.scan.mockRejectedValue(
      new GitHubOutboundContentScanError('content_scan_blocked'),
    )

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: approvedRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'content_scan_blocked',
      }],
    })
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.store.commitGitHubDeliveryContentScan).not.toHaveBeenCalled()
    expect(test.store.commitGitHubDeliveryIntentStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ operatorOutcomeCode: 'content_scan_blocked' }),
    )
  })

  it('never resumes an exact credential-content block or re-enters the provider boundary', async () => {
    const source = intent({ status: 'recovery_required' })
    const test = harness(source)
    test.store.listGitHubDeliveryOperatorOutcomes.mockResolvedValue([{
      stateVersion: 1,
      intentId: source.id,
      intentUpdatedAt: source.updatedAt,
      outcomeCode: 'content_scan_blocked',
      recordedAt: source.updatedAt,
      redacted: true,
    }])

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toEqual({
      intentId: source.id,
      remoteRequestId: null,
      disposition: 'recovery_required',
      outcomeCode: 'content_scan_blocked',
    })
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.contentScanner.scan).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

  it('durably converts a provider-text block into the same non-resumable operator outcome', async () => {
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
    test.remote.createDraftPullRequest.mockRejectedValue(new GitHubDeliveryRemoteError({
      status: 409,
      code: 'conflict',
      operation: 'draft_pull_request',
      retryable: false,
      operatorOutcomeCode: 'content_scan_blocked',
    }))

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toMatchObject({
      disposition: 'recovery_required',
      outcomeCode: 'conflict',
    })
    expect(test.store.commitGitHubDeliveryIntentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ operatorOutcomeCode: 'content_scan_blocked' }),
    )
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

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

  it('revises the existing logical request and invalidates its old approval before credential work', async () => {
    const original = intent()
    const revised = intent({
      id: 'intent-revision-2',
      intentDigest: 'intent-digest-revision-2',
      testEvidenceId: 'test-revision-2',
      testEvidenceCreatedAt: '2026-08-11T12:02:00.000Z',
      testEvidenceDigest: 'test-digest-revision-2',
      prPackageUpdatedAt: '2026-08-11T12:03:00.000Z',
      createdAt: '2026-08-11T12:04:00.000Z',
      updatedAt: '2026-08-11T12:04:00.000Z',
    })
    const approvedOriginal = request(original, {
      stateVersion: 2,
      intentRevision: 1,
      status: 'approved',
    })
    const revisedRequest = request(revised, {
      id: approvedOriginal.id,
      stateVersion: 3,
      intentRevision: 2,
      status: 'approval_required',
      updatedAt: revised.updatedAt,
    })
    const test = harness(revised)
    test.remote.listInbox.mockResolvedValue([approvedOriginal])
    test.remote.submit.mockResolvedValue({
      request: revisedRequest,
      outcomeCode: 'delivery_revised',
      replayed: false,
    })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: revised.id,
        remoteRequestId: approvedOriginal.id,
        disposition: 'submitted',
        outcomeCode: 'delivery_revised',
      }],
    })
    expect(test.remote.submit).toHaveBeenCalledWith({
      projectId: revised.teamProjectId,
      intent: revised,
      prTitle: 'Ship widgets',
      prBody: '# Ship widgets',
      expectedStateVersion: approvedOriginal.stateVersion,
    })
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
  })

  it('keeps a local revision approval-waiting when its remote revision CAS loses a race', async () => {
    const original = intent()
    const revised = intent({
      id: 'intent-revision-race',
      intentDigest: 'intent-digest-revision-race',
      testEvidenceId: 'test-revision-race',
      testEvidenceDigest: 'test-digest-revision-race',
      createdAt: '2026-08-11T12:04:00.000Z',
      updatedAt: '2026-08-11T12:04:00.000Z',
    })
    const oldRequest = request(original, {
      stateVersion: 1,
      intentRevision: 1,
      status: 'approval_required',
    })
    const test = harness(revised)
    test.remote.listInbox.mockResolvedValue([oldRequest])
    test.remote.submit.mockRejectedValue(new GitHubDeliveryRemoteError({
      status: 409,
      code: 'conflict',
      operation: 'submit',
      retryable: false,
      outcomeCode: 'stale_version',
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: revised.id,
        remoteRequestId: oldRequest.id,
        disposition: 'local_conflict',
        outcomeCode: 'stale_intent',
      }],
    })
    expect(test.current().status).toBe('approval_required')
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

  it('fails a local revision closed when more than one remote request claims its logical scope', async () => {
    const original = intent()
    const revised = intent({
      id: 'intent-revision-ambiguous',
      intentDigest: 'intent-digest-revision-ambiguous',
      createdAt: '2026-08-11T12:04:00.000Z',
      updatedAt: '2026-08-11T12:04:00.000Z',
    })
    const oldRequest = request(original, { status: 'approval_required' })
    const test = harness(revised)
    test.remote.listInbox.mockResolvedValue([
      oldRequest,
      { ...oldRequest, id: 'request-ambiguous-2' },
    ])

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: revised.id,
        remoteRequestId: oldRequest.id,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.remote.submit).not.toHaveBeenCalled()
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
  })

  it('does not revise a terminal remote predecessor or reuse any prior approval', async () => {
    const original = intent()
    const revised = intent({
      id: 'intent-revision-after-terminal',
      intentDigest: 'intent-digest-revision-after-terminal',
      createdAt: '2026-08-11T12:04:00.000Z',
      updatedAt: '2026-08-11T12:04:00.000Z',
    })
    const terminal = request(original, {
      status: 'failed',
      outcomeCode: 'pull_request_failed',
    })
    const test = harness(revised)
    test.remote.listInbox.mockResolvedValue([terminal])

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: revised.id,
        remoteRequestId: terminal.id,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.remote.submit).not.toHaveBeenCalled()
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
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
    expect(test.contentScanner.scan).toHaveBeenCalledWith({
      worktreePath: '/private/managed/worktree',
      baseCommitSha: source.baseCommitSha,
      expectedCommitSha: source.expectedCommitSha,
    })
    expect(test.store.commitGitHubDeliveryContentScan).toHaveBeenCalledWith({
      expectedIntent: expect.objectContaining({
        id: source.id,
        status: 'publishing_branch',
      }),
      scan: expect.objectContaining({
        intentId: source.id,
        workspaceId: source.workspaceId,
        expectedCommitSha: source.expectedCommitSha,
        scanDigest: 'f'.repeat(64),
        status: 'safe',
      }),
    })
    expect(
      test.store.commitGitHubDeliveryContentScan.mock.invocationCallOrder[0],
    ).toBeLessThan(test.remote.withCredentialGrant.mock.invocationCallOrder[0]!)
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
    expect(test.preparationRuntime.prepare).toHaveBeenCalledTimes(9)
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

  it('rejects a managed workspace carrying any non-empty deletion timestamp', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const publishingRequest = request(source, {
      stateVersion: 4,
      status: 'publishing_branch',
    })
    const test = harness(source)
    test.store.listManagedCodingWorkspaces.mockResolvedValue([{
      id: source.workspaceId,
      projectId: source.localProjectId,
      worktreePath: '/private/managed/worktree',
      headCommitSha: source.expectedCommitSha,
      cleanupStatus: 'active',
      deletedAt: '2026-08-11T12:00:30.000Z',
    }])
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockImplementation(async (_input, callback) => ({
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

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: approvedRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'invalid_delivery_source',
      }],
    })
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(JSON.stringify(test.current())).not.toContain('secret-ephemeral-token')
    expect(JSON.stringify(test.current())).not.toContain('/private/managed/worktree')
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

  it('never reissues a credential from background recovery after local state requires explicit resume', async () => {
    const source = intent({ status: 'recovery_required' })
    const approvedRequest = request(source, {
      stateVersion: 2,
      status: 'approved',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode: 'explicit_resume_required',
      }],
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('resumes a Stop before first submission by creating the same attempt without an approval', async () => {
    const source = intent({ status: 'recovery_required' })
    const submittedIntent = { ...source, status: 'approval_required' as const }
    const submittedRequest = request(submittedIntent, {
      status: 'approval_required',
      outcomeCode: null,
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([])
    test.remote.submit.mockResolvedValue({
      request: submittedRequest,
      outcomeCode: 'delivery_created',
      replayed: false,
    })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode: 'explicit_resume_required',
      }],
    })
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.submit).not.toHaveBeenCalled()

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toEqual({
      intentId: source.id,
      remoteRequestId: submittedRequest.id,
      disposition: 'submitted',
      outcomeCode: 'delivery_created',
    })
    expect(test.remote.submit).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      intent: submittedIntent,
      prTitle: 'Ship widgets',
      prBody: '# Ship widgets',
      expectedStateVersion: 0,
    })
    expect(test.current()).toEqual(source)
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('resumes a Stop after submission by reconciling the same approval-wait request', async () => {
    const source = intent({ status: 'recovery_required' })
    const approvalRequired = request(source, {
      status: 'approval_required',
      outcomeCode: null,
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvalRequired])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvalRequired))

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toEqual({
      intentId: source.id,
      remoteRequestId: approvalRequired.id,
      disposition: 'waiting_for_approval',
      outcomeCode: null,
    })
    expect(test.remote.submit).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('never creates a pull request from background recovery even when the remote branch is already verified', async () => {
    const source = intent({ status: 'recovery_required' })
    const publishedRequest = request(source, {
      stateVersion: 6,
      status: 'branch_published',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([publishedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(publishedRequest, {
      approval: approval(source, publishedRequest),
      grant: grant({ status: 'consumed', consumedAt: initialTime }),
      publication: publication(),
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode: 'explicit_resume_required',
      }],
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
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

  it('adopts the verified publication on an explicit later-attempt resume without another credential or push', async () => {
    const source = intent({
      id: 'intent-2',
      deliveryAttempt: 2,
      status: 'recovery_required',
    })
    const approvedRequest = request(source, {
      id: 'request-2',
      stateVersion: 3,
      status: 'approved',
    })
    const adoptedRequest = request(source, {
      id: approvedRequest.id,
      stateVersion: 4,
      status: 'branch_published',
    })
    const completedRequest = request(source, {
      id: approvedRequest.id,
      stateVersion: 6,
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })
    const adoptedPublication = publication({
      id: 'publication-2',
      requestId: approvedRequest.id,
      grantId: null,
      sourcePublicationId: 'publication-1',
      reportedOutcomeCode: 'already_present',
    })
    const completedPullRequest = pullRequest({
      requestId: approvedRequest.id,
      publicationId: adoptedPublication.id,
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(
      snapshot(approvedRequest, {
        approval: approval(source, approvedRequest),
      }),
    )
    test.remote.adoptVerifiedBranchPublication.mockResolvedValue({
      request: adoptedRequest,
      publication: adoptedPublication,
      outcomeCode: 'publication_adopted',
      replayed: false,
    })
    test.remote.createDraftPullRequest.mockResolvedValue({
      request: completedRequest,
      pullRequest: completedPullRequest,
      outcomeCode: 'pull_request_completed',
      replayed: false,
    })
    test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

    await expect(
      test.processor.resume({
        intentId: source.id,
        expectedUpdatedAt: source.updatedAt,
      }),
    ).resolves.toMatchObject({
      disposition: 'workflow_advanced',
      outcomeCode: 'draft_pr_created',
    })
    expect(test.remote.adoptVerifiedBranchPublication).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: approvedRequest.id,
      expectedStateVersion: approvedRequest.stateVersion,
    })
    expect(test.remote.createDraftPullRequest).toHaveBeenCalledWith({
      projectId: source.teamProjectId,
      requestId: approvedRequest.id,
      publicationId: adoptedPublication.id,
      expectedStateVersion: adoptedRequest.stateVersion,
    })
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.reportBranchPublication).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.workspaceCoordinator.runExclusive).not.toHaveBeenCalled()
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
    expect(test.workspaceCoordinator.runExclusive).toHaveBeenCalledTimes(1)
    expect(test.remote.withCredentialGrant).toHaveBeenCalledTimes(1)
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

  it('recovers an adopted-publication completion crash window without another credential or pull request', async () => {
    const source = intent({
      id: 'intent-2',
      deliveryAttempt: 2,
      status: 'creating_pr',
    })
    const completedRequest = request(source, {
      id: 'request-2',
      stateVersion: 6,
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })
    const adoptedPublication = publication({
      id: 'publication-2',
      requestId: completedRequest.id,
      grantId: null,
      sourcePublicationId: 'publication-1',
      reportedOutcomeCode: 'already_present',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
      approval: approval(source, completedRequest),
      grant: null,
      publication: adoptedPublication,
      pullRequest: pullRequest({
        requestId: completedRequest.id,
        publicationId: adoptedPublication.id,
      }),
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
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.reportBranchPublication).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
    expect(test.current().status).toBe('completed')
  })

  it('leaves evidence-only remote completion to the bounded read-only reconciler', async () => {
    const source = intent({ status: 'recovery_required' })
    const completedRequest = request(source, {
      stateVersion: 8,
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
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode: 'explicit_resume_required',
      }],
    })
    expect(test.current().status).toBe('recovery_required')
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.workflow.execute).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it.each(['creating_pr', 'recovery_required'] as const)(
    'read-only reconciles a remote completion from local %s without current binding or provider writes',
    async (status) => {
      const source = intent({ status })
      const completedRequest = request(source, {
        stateVersion: 8,
        status: 'completed',
        outcomeCode: 'draft_pr_created',
      })
      const test = harness(source)
      test.preparationRuntime.prepare.mockRejectedValue(
        new Error('the current repository binding is revoked'),
      )
      test.remote.listInbox.mockResolvedValue([completedRequest])
      test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
        approval: approval(source, completedRequest),
        grant: grant({
          status: 'consumed',
          consumedAt: '2026-08-11T12:01:00.000Z',
        }),
        publication: publication(),
        pullRequest: pullRequest({ providerCreatedAt: '2026-08-11T12:02:00.000Z' }),
      }))
      test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

      await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
        store: test.store,
        remote: test.remote,
        workflow: test.workflow,
        now: () => '2026-08-11T12:03:00.000Z',
        maxIntentsPerCycle: 1,
        maxIntentsScannedPerCycle: 1,
      })).resolves.toEqual({
        results: [{
          intentId: source.id,
          remoteRequestId: completedRequest.id,
          disposition: 'workflow_advanced',
          outcomeCode: 'draft_pr_created',
        }],
      })
      expect(test.current().status).toBe('completed')
      expect(test.store.commitGitHubDeliveryIntentCompletion).toHaveBeenCalledTimes(1)
      expect(test.workflow.execute).toHaveBeenCalledTimes(1)
      expect(test.preparationRuntime.prepare).not.toHaveBeenCalled()
      expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
      expect(test.publisher.publish).not.toHaveBeenCalled()
      expect(test.remote.reportBranchPublication).not.toHaveBeenCalled()
      expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
    },
  )

  it('read-only reconciles a completed later attempt backed by an adopted verified publication', async () => {
    const source = intent({
      id: 'intent-2',
      deliveryAttempt: 2,
      status: 'recovery_required',
    })
    const completedRequest = request(source, {
      id: 'request-2',
      stateVersion: 6,
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })
    const adoptedPublication = publication({
      id: 'publication-2',
      requestId: completedRequest.id,
      grantId: null,
      sourcePublicationId: 'publication-1',
      reportedOutcomeCode: 'already_present',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
      approval: approval(source, completedRequest),
      grant: null,
      publication: adoptedPublication,
      pullRequest: pullRequest({
        requestId: completedRequest.id,
        publicationId: adoptedPublication.id,
      }),
    }))
    test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

    await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
      store: test.store,
      remote: test.remote,
      workflow: test.workflow,
      now: () => '2026-08-11T12:03:00.000Z',
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: completedRequest.id,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(test.current().status).toBe('completed')
    expect(test.store.commitGitHubDeliveryIntentCompletion).toHaveBeenCalledTimes(1)
    expect(test.workflow.execute).toHaveBeenCalledTimes(1)
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.reportBranchPublication).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('rejects remote completion reconciliation across delivery attempts before snapshot access', async () => {
    const source = intent({ status: 'recovery_required' })
    const completedRequest = {
      ...request(source, {
        stateVersion: 8,
        status: 'completed',
        outcomeCode: 'draft_pr_created',
      }),
      deliveryAttempt: source.deliveryAttempt + 1,
    }
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])

    await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
      store: test.store,
      remote: test.remote,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: completedRequest.id,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.store.commitGitHubDeliveryIntentCompletion).not.toHaveBeenCalled()
    expect(test.workflow.execute).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('rejects a remote completion whose consumed grant and publication chain disagree', async () => {
    const source = intent({ status: 'creating_pr' })
    const completedRequest = request(source, {
      stateVersion: 8,
      status: 'completed',
      outcomeCode: 'draft_pr_created',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([completedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(completedRequest, {
      approval: approval(source, completedRequest),
      grant: grant({
        id: 'grant-current',
        status: 'consumed',
        consumedAt: '2026-08-11T12:01:00.000Z',
      }),
      publication: publication({ grantId: 'grant-different' }),
      pullRequest: pullRequest({ providerCreatedAt: '2026-08-11T12:02:00.000Z' }),
    }))

    await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
      store: test.store,
      remote: test.remote,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: completedRequest.id,
        disposition: 'local_conflict',
        outcomeCode: 'completion_evidence_invalid',
      }],
    })
    expect(test.store.commitGitHubDeliveryIntentCompletion).not.toHaveBeenCalled()
    expect(test.workflow.execute).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('leaves a non-completed remote request untouched in the read-only completion seam', async () => {
    const source = intent({ status: 'recovery_required' })
    const approvedRequest = request(source, {
      stateVersion: 2,
      status: 'approved',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])

    await expect(reconcileRemoteCompletedGitHubDeliveryIntents({
      store: test.store,
      remote: test.remote,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })).resolves.toEqual({ results: [] })
    expect(test.remote.getRecoverySnapshot).not.toHaveBeenCalled()
    expect(test.store.commitGitHubDeliveryIntentCompletion).not.toHaveBeenCalled()
    expect(test.workflow.execute).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('reconciles a durable completed intent into Workflow without remote or active-binding authority', async () => {
    const source = completedIntent()
    const test = harness(source)
    test.preparationRuntime.prepare.mockRejectedValue(
      new Error('the current repository binding is revoked'),
    )
    test.workflow.execute.mockResolvedValue({
      applied: true,
      blockers: [],
      run: {
        ...pendingPrRun(source),
        pullRequestUrl: source.completion.pullRequestUrl,
      },
    })

    await expect(reconcileCompletedGitHubDeliveryIntents({
      store: test.store,
      workflow: test.workflow,
      now: () => '2026-08-11T12:11:00.000Z',
      maxIntentsPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: source.completion.remoteRequestId,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(test.workflow.execute).toHaveBeenCalledWith({
      runId: source.runId,
      command: {
        type: 'complete_pr',
        nodeId: source.nodeId,
        artifactId: source.prPackageArtifactId,
      },
      now: '2026-08-11T12:11:00.000Z',
      expectedRunUpdatedAt: initialTime,
    })
    expect(test.preparationRuntime.prepare).not.toHaveBeenCalled()
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.publisher.publish).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('background-reconciles a local completion without consulting current binding authority', async () => {
    const source = completedIntent()
    const test = harness(source)
    test.preparationRuntime.prepare.mockRejectedValue(
      new Error('the current repository binding is revoked'),
    )
    test.workflow.execute.mockResolvedValue({ applied: true, blockers: [], run: {} })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: source.completion.remoteRequestId,
        disposition: 'workflow_advanced',
        outcomeCode: 'draft_pr_created',
      }],
    })
    expect(test.workflow.execute).toHaveBeenCalledTimes(1)
    expect(test.preparationRuntime.prepare).not.toHaveBeenCalled()
    expect(test.remote.listInbox).not.toHaveBeenCalled()
  })

  it('rejects completed reconciliation when the immutable PR package was changed', async () => {
    const source = completedIntent()
    const test = harness(source)
    test.store.listArtifacts.mockResolvedValue([{
      ...packageArtifact(source),
      content: '# Tampered package',
    }])

    await expect(reconcileCompletedGitHubDeliveryIntents({
      store: test.store,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: source.completion.remoteRequestId,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.workflow.execute).not.toHaveBeenCalled()
  })

  it('rejects completed reconciliation when the Workflow run no longer matches the intent', async () => {
    const source = completedIntent()
    const test = harness(source)
    test.store.getRun.mockResolvedValue({
      ...pendingPrRun(source),
      version: source.runVersion + 1,
    })

    await expect(reconcileCompletedGitHubDeliveryIntents({
      store: test.store,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: source.completion.remoteRequestId,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.workflow.execute).not.toHaveBeenCalled()
  })

  it('rejects completed reconciliation when completion evidence is noncanonical', async () => {
    const source = completedIntent()
    source.completion = {
      ...source.completion,
      pullRequestUrl: 'https://github.com/acme/widgets/pull/43',
    }
    const test = harness(source)

    await expect(reconcileCompletedGitHubDeliveryIntents({
      store: test.store,
      workflow: test.workflow,
      maxIntentsPerCycle: 1,
    })).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: source.completion.remoteRequestId,
        disposition: 'local_conflict',
        outcomeCode: 'authority_mismatch',
      }],
    })
    expect(test.workflow.execute).not.toHaveBeenCalled()
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

  it.each([
    {
      name: 'forbidden response',
      error: new GitHubDeliveryRemoteError({
        status: 403,
        code: 'forbidden',
        operation: 'inbox',
        retryable: false,
        outcomeCode: 'project_forbidden',
      }),
      outcomeCode: 'project_forbidden',
    },
    {
      name: 'expired response without a terminal snapshot',
      error: new GitHubDeliveryRemoteError({
        status: 409,
        code: 'conflict',
        operation: 'inbox',
        retryable: false,
        outcomeCode: 'expired',
      }),
      outcomeCode: 'expired',
    },
    {
      name: 'gone response without a terminal snapshot',
      error: new GitHubDeliveryRemoteError({
        status: 410,
        code: 'gone',
        operation: 'inbox',
        retryable: false,
      }),
      outcomeCode: 'gone',
    },
  ])('does not invent terminal local state from a $name', async ({ error, outcomeCode }) => {
    const source = intent()
    const test = harness(source)
    test.remote.listInbox.mockRejectedValue(error)

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode,
      }],
    })
    expect(test.current().status).toBe('recovery_required')
  })

  it('atomically persists a typed operator outcome only for an exact publisher error', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const publishingRequest = request(source, {
      stateVersion: 4,
      status: 'publishing_branch',
    })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockImplementation(async (_input, callback) => {
      try {
        return {
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
        }
      } catch (error) {
        if (!(error instanceof GitHubGitPublisherError)) throw error
        throw new GitHubDeliveryRemoteError({
          status: null,
          code: error.code,
          operation: 'credential_grant',
          retryable: false,
          operatorOutcomeCode: error.code,
        })
      }
    })
    test.publisher.publish.mockRejectedValue(
      new GitHubGitPublisherError('workspace_dirty'),
    )

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: approvedRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'workspace_dirty',
      }],
    })
    expect(test.store.commitGitHubDeliveryIntentStatus.mock.calls.map(
      ([mutation]) => ({
        status: mutation.intent.status,
        operatorOutcomeCode: mutation.operatorOutcomeCode,
      }),
    )).toEqual([
      { status: 'publishing_branch', operatorOutcomeCode: undefined },
      { status: 'recovery_required', operatorOutcomeCode: 'workspace_dirty' },
    ])
  })

  it('never persists an operator outcome for a generic remote-unavailable API error', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockRejectedValue(new GitHubDeliveryRemoteError({
      status: null,
      code: 'remote_unavailable',
      operation: 'recovery_snapshot',
      retryable: true,
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toMatchObject({
      results: [{
        disposition: 'recovery_required',
        outcomeCode: 'remote_unavailable',
      }],
    })
    expect(test.store.commitGitHubDeliveryIntentStatus).toHaveBeenCalledTimes(1)
    expect(test.store.commitGitHubDeliveryIntentStatus.mock.calls[0]?.[0]).not.toHaveProperty(
      'operatorOutcomeCode',
    )
  })

  it('does not mistake a credential API failure for a publisher outcome', async () => {
    const source = intent({ status: 'approved' })
    const approvedRequest = request(source, { stateVersion: 2, status: 'approved' })
    const test = harness(source)
    test.remote.listInbox.mockResolvedValue([approvedRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(approvedRequest, {
      approval: approval(source, approvedRequest),
    }))
    test.remote.withCredentialGrant.mockRejectedValue(new GitHubDeliveryRemoteError({
      status: null,
      code: 'remote_unavailable',
      operation: 'credential_grant',
      retryable: true,
    }))

    await expect(test.processor.recoverAndAdvance()).resolves.toMatchObject({
      results: [{
        disposition: 'recovery_required',
        outcomeCode: 'remote_unavailable',
      }],
    })
    const recoveryMutation = test.store.commitGitHubDeliveryIntentStatus.mock.calls.find(
      ([mutation]) => mutation.intent.status === 'recovery_required',
    )?.[0]
    expect(recoveryMutation).toBeDefined()
    expect(recoveryMutation).not.toHaveProperty('operatorOutcomeCode')
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

  it('does not let an older passive approval wait consume the bounded actionable-write budget', async () => {
    const approved = intent({
      id: 'intent-approved-newer',
      runId: 'run-approved-newer',
      nodeId: 'run-approved-newer-pr',
      status: 'approved',
      createdAt: '2026-08-11T12:01:00.000Z',
    })
    const waiting = intent({
      id: 'intent-waiting-older',
      runId: 'run-waiting-older',
      nodeId: 'run-waiting-older-pr',
      status: 'approval_required',
      createdAt: initialTime,
    })
    const waitingRequest = request(waiting, {
      id: 'request-waiting-older',
      status: 'approval_required',
    })
    const approvedRequest = request(approved, {
      id: 'request-approved-newer',
      stateVersion: 2,
      status: 'approved',
    })
    const test = harness(approved, 1)
    test.store.listGitHubDeliveryIntents.mockImplementation(async () => [
      waiting,
      test.current(),
    ])
    test.preparationRuntime.prepare.mockImplementation(async ({ runId: selectedRunId }) => ({
      status: 'prepared' as const,
      replayed: true,
      intent: selectedRunId === waiting.runId ? waiting : test.current(),
      testEvidence: {},
    }))
    test.remote.listInbox.mockResolvedValue([waitingRequest, approvedRequest])
    test.remote.getRecoverySnapshot.mockImplementation(async ({ requestId }) =>
      requestId === waitingRequest.id
        ? snapshot(waitingRequest)
        : snapshot(approvedRequest, {
            approval: approval(approved, approvedRequest),
          }),
    )
    test.remote.withCredentialGrant.mockRejectedValue(
      new Error('bounded provider failure'),
    )

    const result = await test.processor.recoverAndAdvance()

    expect(result.results).toEqual([
      {
        intentId: waiting.id,
        remoteRequestId: waitingRequest.id,
        disposition: 'waiting_for_approval',
        outcomeCode: null,
      },
      {
        intentId: approved.id,
        remoteRequestId: approvedRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'processor_failed',
      },
    ])
    expect(test.remote.withCredentialGrant).toHaveBeenCalledTimes(1)
    expect(test.current().status).toBe('recovery_required')
  })

  it('does not let an older manual recovery consume the bounded actionable-write budget', async () => {
    const approved = intent({
      id: 'intent-approved-after-recovery',
      runId: 'run-approved-after-recovery',
      nodeId: 'run-approved-after-recovery-pr',
      status: 'approved',
      createdAt: '2026-08-11T12:01:00.000Z',
    })
    const manualRecovery = intent({
      id: 'intent-manual-recovery-older',
      runId: 'run-manual-recovery-older',
      nodeId: 'run-manual-recovery-older-pr',
      status: 'recovery_required',
      createdAt: initialTime,
    })
    const recoveryRequest = request(manualRecovery, {
      id: 'request-manual-recovery-older',
      stateVersion: 2,
      status: 'approved',
    })
    const approvedRequest = request(approved, {
      id: 'request-approved-after-recovery',
      stateVersion: 2,
      status: 'approved',
    })
    const test = harness(approved, 1)
    test.store.listGitHubDeliveryIntents.mockImplementation(async () => [
      manualRecovery,
      test.current(),
    ])
    test.preparationRuntime.prepare.mockImplementation(async ({ runId: selectedRunId }) => ({
      status: 'prepared' as const,
      replayed: true,
      intent: selectedRunId === manualRecovery.runId
        ? manualRecovery
        : test.current(),
      testEvidence: {},
    }))
    test.remote.listInbox.mockResolvedValue([recoveryRequest, approvedRequest])
    test.remote.getRecoverySnapshot.mockImplementation(async ({ requestId }) =>
      requestId === recoveryRequest.id
        ? snapshot(recoveryRequest, {
            approval: approval(manualRecovery, recoveryRequest),
          })
        : snapshot(approvedRequest, {
            approval: approval(approved, approvedRequest),
          }),
    )
    test.remote.withCredentialGrant.mockRejectedValue(
      new Error('bounded provider failure'),
    )

    const result = await test.processor.recoverAndAdvance()

    expect(result.results).toEqual([
      {
        intentId: manualRecovery.id,
        remoteRequestId: null,
        disposition: 'recovery_required',
        outcomeCode: 'explicit_resume_required',
      },
      {
        intentId: approved.id,
        remoteRequestId: approvedRequest.id,
        disposition: 'recovery_required',
        outcomeCode: 'processor_failed',
      },
    ])
    expect(test.remote.withCredentialGrant).toHaveBeenCalledTimes(1)
    expect(test.current().status).toBe('recovery_required')
  })

  it('bounds passive scans while rotating to newer actionable work across cycles', async () => {
    const approved = intent({
      id: 'intent-approved-after-bounded-scans',
      runId: 'run-approved-after-bounded-scans',
      nodeId: 'run-approved-after-bounded-scans-pr',
      status: 'approved',
      createdAt: '2026-08-11T12:02:00.000Z',
    })
    const firstWaiting = intent({
      id: 'intent-first-waiting',
      runId: 'run-first-waiting',
      nodeId: 'run-first-waiting-pr',
      status: 'approval_required',
      createdAt: initialTime,
    })
    const secondWaiting = intent({
      id: 'intent-second-waiting',
      runId: 'run-second-waiting',
      nodeId: 'run-second-waiting-pr',
      status: 'approval_required',
      createdAt: '2026-08-11T12:01:00.000Z',
    })
    const firstRequest = request(firstWaiting, {
      id: 'request-first-waiting',
      status: 'approval_required',
    })
    const secondRequest = request(secondWaiting, {
      id: 'request-second-waiting',
      status: 'approval_required',
    })
    const approvedRequest = request(approved, {
      id: 'request-approved-after-bounded-scans',
      stateVersion: 2,
      status: 'approved',
    })
    const test = harness(approved, {
      maxIntentsPerCycle: 1,
      maxIntentsScannedPerCycle: 1,
    })
    test.store.listGitHubDeliveryIntents.mockImplementation(async () => [
      firstWaiting,
      secondWaiting,
      test.current(),
    ])
    test.preparationRuntime.prepare.mockImplementation(async ({ runId: selectedRunId }) => ({
      status: 'prepared' as const,
      replayed: true,
      intent: selectedRunId === firstWaiting.runId
        ? firstWaiting
        : selectedRunId === secondWaiting.runId
          ? secondWaiting
          : test.current(),
      testEvidence: {},
    }))
    test.remote.listInbox.mockResolvedValue([
      firstRequest,
      secondRequest,
      approvedRequest,
    ])
    test.remote.getRecoverySnapshot.mockImplementation(async ({ requestId }) => {
      if (requestId === firstRequest.id) return snapshot(firstRequest)
      if (requestId === secondRequest.id) return snapshot(secondRequest)
      return snapshot(approvedRequest, {
        approval: approval(approved, approvedRequest),
      })
    })
    test.remote.withCredentialGrant.mockRejectedValue(
      new Error('bounded provider failure'),
    )

    const firstCycle = await test.processor.recoverAndAdvance()
    const secondCycle = await test.processor.recoverAndAdvance()
    const thirdCycle = await test.processor.recoverAndAdvance()

    expect(firstCycle.results.map((result) => result.intentId)).toEqual([firstWaiting.id])
    expect(secondCycle.results.map((result) => result.intentId)).toEqual([secondWaiting.id])
    expect(thirdCycle.results).toEqual([{
      intentId: approved.id,
      remoteRequestId: approvedRequest.id,
      disposition: 'recovery_required',
      outcomeCode: 'processor_failed',
    }])
    expect(test.remote.getRecoverySnapshot).toHaveBeenCalledTimes(3)
    expect(test.remote.withCredentialGrant).toHaveBeenCalledTimes(1)
  })

  it('fences each of two processed intents with its exact source version', async () => {
    const first = intent({
      id: 'intent-fence-first',
      runId: 'run-fence-first',
      nodeId: 'run-fence-first-pr',
      createdAt: initialTime,
      updatedAt: '2026-08-11T12:00:10.000Z',
    })
    const second = intent({
      id: 'intent-fence-second',
      runId: 'run-fence-second',
      nodeId: 'run-fence-second-pr',
      createdAt: '2026-08-11T12:01:00.000Z',
      updatedAt: '2026-08-11T12:01:10.000Z',
    })
    const firstRequest = request(first, {
      id: 'request-fence-first',
      status: 'approval_required',
    })
    const secondRequest = request(second, {
      id: 'request-fence-second',
      status: 'approval_required',
    })
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(first, {
      maxIntentsPerCycle: 1,
      onIntentOperationChange: (active) => {
        operations.push(active)
      },
    })
    test.store.listGitHubDeliveryIntents.mockResolvedValue([first, second])
    test.preparationRuntime.prepare.mockImplementation(async ({ runId: selectedRunId }) => ({
      status: 'prepared' as const,
      replayed: true,
      intent: selectedRunId === first.runId ? first : second,
      testEvidence: {},
    }))
    test.remote.listInbox.mockResolvedValue([firstRequest, secondRequest])
    test.remote.getRecoverySnapshot.mockImplementation(async ({ requestId }) =>
      requestId === firstRequest.id
        ? snapshot(firstRequest)
        : snapshot(secondRequest),
    )

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [
        {
          intentId: first.id,
          remoteRequestId: firstRequest.id,
          disposition: 'waiting_for_approval',
          outcomeCode: null,
        },
        {
          intentId: second.id,
          remoteRequestId: secondRequest.id,
          disposition: 'waiting_for_approval',
          outcomeCode: null,
        },
      ],
    })
    expect(operations).toEqual([
      { intentId: first.id, expectedUpdatedAt: first.updatedAt },
      null,
      { intentId: second.id, expectedUpdatedAt: second.updatedAt },
      null,
    ])
  })

  it('rejects a Stop CAS between the intent snapshot and active-fence registration', async () => {
    const source = intent()
    const stopped = {
      ...source,
      status: 'recovery_required' as const,
      updatedAt: '2026-08-11T12:00:30.000Z',
    }
    let stopCommitted = false
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(source, {
      onIntentOperationChange: (active) => {
        operations.push(active)
        if (active) stopCommitted = true
      },
    })
    test.store.listGitHubDeliveryIntents.mockImplementation(async () => [
      stopCommitted ? stopped : source,
    ])

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'local_conflict',
        outcomeCode: 'stale_intent',
      }],
    })
    expect(operations).toEqual([
      { intentId: source.id, expectedUpdatedAt: source.updatedAt },
      null,
    ])
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.submit).not.toHaveBeenCalled()
    expect(test.remote.withCredentialGrant).not.toHaveBeenCalled()
    expect(test.remote.createDraftPullRequest).not.toHaveBeenCalled()
  })

  it('clears the active intent fence in finally when processing escapes unexpectedly', async () => {
    const source = intent({ status: 'approved' })
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(source, {
      onIntentOperationChange: (active) => {
        operations.push(active)
      },
    })
    let intentReads = 0
    test.store.listGitHubDeliveryIntents.mockImplementation(async () => {
      intentReads += 1
      if (intentReads === 1) return [source]
      throw new Error('unexpected local reload failure')
    })
    test.remote.listInbox.mockRejectedValue(new Error('bounded remote failure'))

    await expect(test.processor.recoverAndAdvance()).rejects.toThrow(
      'unexpected local reload failure',
    )
    expect(operations).toEqual([
      { intentId: source.id, expectedUpdatedAt: source.updatedAt },
      null,
    ])
  })

  it('fails closed before processing when active-fence registration throws', async () => {
    const source = intent()
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(source, {
      onIntentOperationChange: (active) => {
        operations.push(active)
        if (active) throw new Error('active fence unavailable')
      },
    })

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: null,
        disposition: 'local_conflict',
        outcomeCode: 'processor_failed',
      }],
    })
    expect(operations).toEqual([
      { intentId: source.id, expectedUpdatedAt: source.updatedAt },
      null,
    ])
    expect(test.remote.listInbox).not.toHaveBeenCalled()
    expect(test.remote.submit).not.toHaveBeenCalled()
  })

  it('does not replace a settled processor result when fence cleanup throws', async () => {
    const source = intent()
    const waitingRequest = request(source, { status: 'approval_required' })
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(source, {
      onIntentOperationChange: (active) => {
        operations.push(active)
        if (active === null) throw new Error('fence cleanup failed')
      },
    })
    test.remote.listInbox.mockResolvedValue([waitingRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(waitingRequest))

    await expect(test.processor.recoverAndAdvance()).resolves.toEqual({
      results: [{
        intentId: source.id,
        remoteRequestId: waitingRequest.id,
        disposition: 'waiting_for_approval',
        outcomeCode: null,
      }],
    })
    expect(operations).toEqual([
      { intentId: source.id, expectedUpdatedAt: source.updatedAt },
      null,
    ])
  })

  it('fences an explicit resume with the exact caller-visible intent version', async () => {
    const source = intent({ status: 'recovery_required' })
    const waitingRequest = request(source, { status: 'approval_required' })
    const operations: Array<{
      intentId: string
      expectedUpdatedAt: string
    } | null> = []
    const test = harness(source, {
      onIntentOperationChange: (active) => {
        operations.push(active)
      },
    })
    test.remote.listInbox.mockResolvedValue([waitingRequest])
    test.remote.getRecoverySnapshot.mockResolvedValue(snapshot(waitingRequest))

    await expect(test.processor.resume({
      intentId: source.id,
      expectedUpdatedAt: source.updatedAt,
    })).resolves.toEqual({
      intentId: source.id,
      remoteRequestId: waitingRequest.id,
      disposition: 'waiting_for_approval',
      outcomeCode: null,
    })
    expect(operations).toEqual([
      { intentId: source.id, expectedUpdatedAt: source.updatedAt },
      null,
    ])
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
