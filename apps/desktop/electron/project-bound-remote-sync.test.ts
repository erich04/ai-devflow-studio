import { describe, expect, it, vi } from 'vitest'
import type {
  AgentReviewResult,
  CodingAgentRun,
  CodingDiffArtifact,
  DesktopPairingCredential,
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { RemoteSyncHttpError, type RemoteSyncClient } from './remote-sync'
import {
  CanonicalRemoteSyncEntityError,
  createProjectBoundRemoteSync,
} from './project-bound-remote-sync'

const pairingCredential: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'org-demo',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'u-ling',
  role: 'lead',
  authAccountId: 'acct-ling',
  projectMemberships: [{ projectId: 'team-project-1', userId: 'u-ling', role: 'lead' }],
  createdAt: '2026-06-20T00:00:00.000Z',
}

const runSummary: RemoteRunSummary = {
  kind: 'run',
  runId: 'run-local-1',
  projectId: 'local-project-1',
  title: 'Local run',
  status: 'building',
  currentNodeId: 'n-build',
  currentNode: {
    id: 'n-build',
    stage: 'build',
    kind: 'task',
    status: 'running',
  },
  branchName: 'ai/local-run',
  updatedAt: '2026-06-20T00:05:00.000Z',
}

const localRun: WorkflowRun = {
  id: runSummary.runId,
  title: runSummary.title,
  request: 'Verify canonical remote sync ordering.',
  projectId: runSummary.projectId,
  creatorId: 'u-ling',
  status: runSummary.status,
  currentNodeId: runSummary.currentNodeId,
  branchName: runSummary.branchName,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: runSummary.updatedAt,
  nodes: [
    {
      id: 'n-design-gate',
      stage: 'design',
      title: 'Design Gate',
      subtitle: 'Review the design.',
      kind: 'gate',
      status: 'success',
      ownerId: 'u-ling',
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: 'n-build',
      stage: 'build',
      title: 'Build',
      subtitle: 'Implement locally.',
      kind: 'task',
      status: 'running',
      ownerId: 'u-ling',
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: 'n-test',
      stage: 'test',
      title: 'Test',
      subtitle: 'Verify locally.',
      kind: 'task',
      status: 'pending',
      ownerId: 'u-ling',
      retryCount: 0,
      artifactIds: [],
    },
  ],
  edges: [],
}

const evidenceSummary: RemoteTestEvidenceSummary = {
  id: 'evidence-1',
  runId: 'run-local-1',
  nodeId: 'n-test',
  projectId: 'local-project-1',
  command: 'pnpm test',
  status: 'passed',
  exitCode: 0,
  durationMs: 100,
  summary: 'Tests passed.',
  redacted: true,
  createdAt: '2026-06-20T00:06:00.000Z',
}

const testEvidence: TestEvidence = {
  ...evidenceSummary,
  cwd: '/Users/alice/work/devflow',
  stdout: 'Tests passed.',
  stderr: '',
}

const reviewSummary: RemoteAgentReviewSummary = {
  id: 'review-1',
  runId: 'run-local-1',
  nodeId: 'n-design-gate',
  projectId: 'local-project-1',
  runtime: 'electron',
  providerId: 'fake-knowledge-review',
  model: 'fake',
  conclusion: 'Ready.',
  summary: 'Reviewed.',
  riskCount: 0,
  missingEvidenceCount: 0,
  advisoryLevel: 'info',
  blocksApproval: false,
  confidence: 0.82,
  redacted: true,
  createdAt: '2026-06-20T00:06:00.000Z',
}

const canonicalReview: AgentReviewResult = {
  id: reviewSummary.id,
  requestId: 'review-request-1',
  runId: reviewSummary.runId,
  nodeId: reviewSummary.nodeId,
  projectId: reviewSummary.projectId,
  runtime: reviewSummary.runtime,
  providerId: reviewSummary.providerId,
  model: reviewSummary.model,
  conclusion: 'Latest canonical conclusion.',
  summary: 'Latest canonical review.',
  risks: ['A current risk.'],
  missingEvidence: ['Current evidence gap.'],
  suggestedTests: ['Do not upload this local-only suggestion.'],
  knowledgeReferences: [],
  policyFindings: [],
  confidence: 0.91,
  gateAdvisory: {
    id: 'gate-advisory-review-1',
    runId: reviewSummary.runId,
    nodeId: reviewSummary.nodeId,
    level: 'warn',
    blocksApproval: false,
    summary: 'Latest canonical review.',
    missingEvidence: ['Current evidence gap.'],
    riskCount: 1,
    createdAt: reviewSummary.createdAt,
  },
  createdAt: reviewSummary.createdAt,
}

const codingSummary: RemoteCodingAgentSummary = {
  id: 'coding-run-1',
  runId: 'run-local-1',
  nodeId: 'n-build',
  projectId: 'local-project-1',
  requestedBy: 'u-ling',
  providerId: 'fake-coding-engine',
  engine: 'fake',
  status: 'completed',
  branchName: 'ai/local-run',
  summary: 'Coding completed.',
  changedPaths: ['src/index.ts'],
  startedAt: '2026-06-20T00:05:00.000Z',
  completedAt: '2026-06-20T00:06:00.000Z',
  redacted: true,
}

const canonicalCodingRun: CodingAgentRun = {
  id: codingSummary.id,
  runId: codingSummary.runId,
  nodeId: codingSummary.nodeId,
  projectId: codingSummary.projectId,
  requestedBy: codingSummary.requestedBy,
  providerId: codingSummary.providerId,
  engine: codingSummary.engine,
  status: codingSummary.status,
  branchName: codingSummary.branchName,
  userInstruction: 'Local-only instruction with api-key-secret.',
  prompt: 'Local-only assembled prompt with bearer-secret.',
  summary: 'Latest canonical coding result.',
  changedPaths: ['stale-path.ts'],
  startedAt: codingSummary.startedAt,
  completedAt: codingSummary.completedAt!,
  diffArtifactId: `coding-diff-${codingSummary.id}`,
  redacted: true,
}

const canonicalCodingDiff: CodingDiffArtifact = {
  id: `coding-diff-${codingSummary.id}`,
  runId: codingSummary.runId,
  nodeId: codingSummary.nodeId,
  projectId: codingSummary.projectId,
  changedPaths: ['src/latest.ts'],
  patch: '+raw patch must stay local',
  truncated: false,
  redacted: true,
  createdAt: codingSummary.completedAt!,
}

describe('project-bound Electron remote sync', () => {
  it('returns a structured operator-safe error when the canonical Run entity is missing', async () => {
    const uploadRunSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadRunSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalRunSummary('sensitive-local-run-id'),
    ).rejects.toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'entity_missing',
      entityKind: 'workflow_run',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('returns a structured operator-safe error when Test Evidence is missing', async () => {
    const uploadTestEvidenceSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadTestEvidenceSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary('sensitive-evidence-id'),
    ).rejects.toMatchObject({
      code: 'entity_missing',
      entityKind: 'test_evidence',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when Test Evidence has no canonical Run', async () => {
    const uploadTestEvidenceSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadTestEvidenceSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id),
    ).rejects.toMatchObject({ code: 'entity_missing', entityKind: 'workflow_run' })
    expect(uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when Test Evidence project scope is wrong', async () => {
    const uploadTestEvidenceSummary = vi.fn()
    const wrongProjectEvidence = { ...testEvidence, projectId: 'other-local-project' }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadTestEvidenceSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [wrongProjectEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(wrongProjectEvidence.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'test_evidence' })
    expect(uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when Test Evidence node scope is wrong', async () => {
    const uploadTestEvidenceSummary = vi.fn()
    const wrongNodeEvidence = { ...testEvidence, nodeId: 'n-foreign-test' }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadTestEvidenceSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [wrongNodeEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(wrongNodeEvidence.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'test_evidence' })
    expect(uploadTestEvidenceSummary).not.toHaveBeenCalled()
  })

  it('rebuilds a Review summary from the latest canonical entity identified by ID', async () => {
    const uploadAgentReviewSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:07:00.000Z',
      message: 'accepted',
    }))
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await boundRemoteSync.uploadCanonicalAgentReviewSummary(canonicalReview.id)

    expect(uploadAgentReviewSummary).toHaveBeenCalledWith({
      id: reviewSummary.id,
      runId: reviewSummary.runId,
      nodeId: reviewSummary.nodeId,
      projectId: 'team-project-1',
      runtime: reviewSummary.runtime,
      providerId: reviewSummary.providerId,
      model: reviewSummary.model,
      conclusion: 'Latest canonical conclusion.',
      summary: 'Latest canonical review.',
      riskCount: 1,
      missingEvidenceCount: 1,
      policyFindingCount: 0,
      policyFindingCategories: [],
      policyFindings: [],
      advisoryLevel: 'warn',
      blocksApproval: false,
      confidence: 0.91,
      redacted: true,
      createdAt: reviewSummary.createdAt,
    })
  })

  it('returns an operator-safe structured error when the Review entity is missing', async () => {
    const uploadAgentReviewSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalAgentReviewSummary('secret-review-identifier'),
    ).rejects.toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'entity_missing',
      entityKind: 'agent_review',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Review has no canonical local Run', async () => {
    const uploadAgentReviewSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalAgentReviewSummary(canonicalReview.id),
    ).rejects.toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'entity_missing',
      entityKind: 'workflow_run',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Review project does not match its canonical Run', async () => {
    const uploadAgentReviewSummary = vi.fn()
    const wrongProjectReview = { ...canonicalReview, projectId: 'other-local-project' }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [wrongProjectReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalAgentReviewSummary(wrongProjectReview.id),
    ).rejects.toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'scope_mismatch',
      entityKind: 'agent_review',
      message: 'Canonical remote sync entity scope does not match.',
    })
    expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Review node is outside its canonical Run', async () => {
    const uploadAgentReviewSummary = vi.fn()
    const wrongNodeReview = { ...canonicalReview, nodeId: 'n-foreign-review' }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [wrongNodeReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalAgentReviewSummary(wrongNodeReview.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'agent_review' })
    expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('fails closed when a Review Gate Advisory belongs to another canonical node', async () => {
    const uploadAgentReviewSummary = vi.fn()
    const wrongAdvisoryReview: AgentReviewResult = {
      ...canonicalReview,
      gateAdvisory: {
        ...canonicalReview.gateAdvisory,
        nodeId: 'n-build',
      },
    }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [wrongAdvisoryReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalAgentReviewSummary(wrongAdvisoryReview.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'agent_review' })
    expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
  })

  it('fails closed when a Review policy finding has a foreign identity', async () => {
    const finding = {
      id: 'finding-1',
      reviewId: canonicalReview.id,
      runId: canonicalReview.runId,
      nodeId: canonicalReview.nodeId,
      category: 'security_risk' as const,
      severity: 'high' as const,
      summary: 'Review this risk.',
      evidenceIds: [],
      knowledgeReferenceIds: [],
      createdAt: canonicalReview.createdAt,
    }

    for (const foreignFinding of [
      { ...finding, reviewId: 'review-foreign' },
      { ...finding, runId: 'run-foreign' },
      { ...finding, nodeId: 'node-foreign' },
    ]) {
      const uploadAgentReviewSummary = vi.fn()
      const wrongFindingReview = {
        ...canonicalReview,
        policyFindings: [foreignFinding],
      }
      const boundRemoteSync = createProjectBoundRemoteSync({
        remoteSync: { uploadAgentReviewSummary } as unknown as RemoteSyncClient,
        credentialSource: {
          getDesktopPairingCredential: async () => pairingCredential,
          listRuns: async () => [localRun],
          listTestEvidence: async () => [testEvidence],
          listAgentReviews: async () => [wrongFindingReview],
          listCodingAgentRuns: async () => [],
          listCodingDiffArtifacts: async () => [],
        },
      })

      await expect(
        boundRemoteSync.uploadCanonicalAgentReviewSummary(wrongFindingReview.id),
      ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'agent_review' })
      expect(uploadAgentReviewSummary).not.toHaveBeenCalled()
    }
  })

  it('rebuilds a Coding summary from its canonical run and exact canonical diff', async () => {
    const uploadCodingAgentSummary = vi.fn(async (_summary: RemoteCodingAgentSummary) => ({
      accepted: true,
      syncedAt: '2026-06-20T00:07:00.000Z',
      message: 'accepted',
    }))
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalCodingAgentSummary(canonicalCodingRun.id)

    expect(uploadCodingAgentSummary).toHaveBeenCalledWith({
      ...codingSummary,
      projectId: 'team-project-1',
      summary: 'Latest canonical coding result.',
      changedPaths: ['src/latest.ts'],
    })
    expect(JSON.stringify(uploadCodingAgentSummary.mock.calls[0]?.[0])).not.toContain(
      'raw patch must stay local',
    )
  })

  it('selects the Coding diff only through the canonical diffArtifactId reference', async () => {
    const uploadCodingAgentSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:07:00.000Z',
      message: 'accepted',
    }))
    const referencedCodingRun = {
      ...canonicalCodingRun,
      diffArtifactId: 'custom-canonical-diff',
    }
    const referencedDiff = {
      ...canonicalCodingDiff,
      id: 'custom-canonical-diff',
      changedPaths: ['src/referenced.ts'],
    }
    const unreferencedConventionalDiff = {
      ...canonicalCodingDiff,
      changedPaths: ['src/unreferenced.ts'],
    }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [referencedCodingRun],
        listCodingDiffArtifacts: async () => [unreferencedConventionalDiff, referencedDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalCodingAgentSummary(referencedCodingRun.id)

    expect(uploadCodingAgentSummary).toHaveBeenCalledWith(
      expect.objectContaining({ changedPaths: ['src/referenced.ts'] }),
    )
  })

  it('fails closed when a referenced canonical Coding diff is missing', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const missingDiffCodingRun = {
      ...canonicalCodingRun,
      diffArtifactId: 'missing-canonical-diff',
    }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [missingDiffCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary(missingDiffCodingRun.id),
    ).rejects.toMatchObject({ code: 'entity_missing', entityKind: 'coding_diff' })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('does not infer a Coding diff when the canonical run has no diff reference', async () => {
    const uploadCodingAgentSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:07:00.000Z',
      message: 'accepted',
    }))
    const { diffArtifactId: _ignoredDiffId, ...codingRunWithoutDiff } = canonicalCodingRun
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [codingRunWithoutDiff],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalCodingAgentSummary(codingRunWithoutDiff.id)

    expect(uploadCodingAgentSummary).toHaveBeenCalledWith(
      expect.objectContaining({ changedPaths: canonicalCodingRun.changedPaths }),
    )
  })

  it('validates and rebinds canonical Coding cost identity to the frozen Team scope', async () => {
    const uploadCodingAgentSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:07:00.000Z',
      message: 'accepted',
    }))
    const costedCodingRun: CodingAgentRun = {
      ...canonicalCodingRun,
      runtimeCostSummary: {
        id: 'coding-cost-1',
        runId: canonicalCodingRun.runId,
        nodeId: canonicalCodingRun.nodeId,
        userId: canonicalCodingRun.requestedBy,
        projectId: canonicalCodingRun.projectId,
        provider: 'openai',
        providerId: canonicalCodingRun.providerId,
        model: 'gpt-test',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        costUsd: 0.01,
        timestamp: canonicalCodingRun.completedAt!,
        source: 'provider_reported',
        redacted: true,
      },
    }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [costedCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalCodingAgentSummary(costedCodingRun.id)

    expect(uploadCodingAgentSummary).toHaveBeenCalledWith(expect.objectContaining({
      projectId: pairingCredential.projectId,
      costSummary: expect.objectContaining({ projectId: pairingCredential.projectId }),
    }))
  })

  it('fails closed when canonical Coding cost metadata has a foreign identity', async () => {
    const validCost = {
      id: 'coding-cost-foreign-check',
      runId: canonicalCodingRun.runId,
      nodeId: canonicalCodingRun.nodeId,
      userId: canonicalCodingRun.requestedBy,
      projectId: canonicalCodingRun.projectId,
      provider: 'openai' as const,
      providerId: canonicalCodingRun.providerId,
      model: 'gpt-test',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      costUsd: 0.01,
      timestamp: canonicalCodingRun.completedAt!,
      source: 'provider_reported' as const,
      redacted: true as const,
    }

    for (const foreignCost of [
      { ...validCost, runId: 'run-foreign' },
      { ...validCost, nodeId: 'node-foreign' },
      { ...validCost, userId: 'user-foreign' },
      { ...validCost, projectId: 'project-foreign' },
      { ...validCost, providerId: 'provider-foreign' },
    ]) {
      const uploadCodingAgentSummary = vi.fn()
      const wrongCostCodingRun = {
        ...canonicalCodingRun,
        runtimeCostSummary: foreignCost,
      }
      const boundRemoteSync = createProjectBoundRemoteSync({
        remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
        credentialSource: {
          getDesktopPairingCredential: async () => pairingCredential,
          listRuns: async () => [localRun],
          listTestEvidence: async () => [testEvidence],
          listAgentReviews: async () => [canonicalReview],
          listCodingAgentRuns: async () => [wrongCostCodingRun],
          listCodingDiffArtifacts: async () => [canonicalCodingDiff],
        },
      })

      await expect(
        boundRemoteSync.uploadCanonicalCodingAgentSummary(wrongCostCodingRun.id),
      ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'coding_agent_run' })
      expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
    }
  })

  it('returns an operator-safe structured error when the Coding entity is missing', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary('secret-coding-identifier'),
    ).rejects.toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'entity_missing',
      entityKind: 'coding_agent_run',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Coding Agent Run has no canonical Workflow Run', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary(canonicalCodingRun.id),
    ).rejects.toMatchObject({
      code: 'entity_missing',
      entityKind: 'workflow_run',
      message: 'Canonical remote sync entity is missing.',
    })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Coding project does not match its canonical Run', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const wrongProjectCodingRun = {
      ...canonicalCodingRun,
      projectId: 'other-local-project',
    }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [wrongProjectCodingRun],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary(wrongProjectCodingRun.id),
    ).rejects.toMatchObject({
      code: 'scope_mismatch',
      entityKind: 'coding_agent_run',
      message: 'Canonical remote sync entity scope does not match.',
    })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when a Coding node is outside its canonical Run', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const wrongNodeCodingRun = { ...canonicalCodingRun, nodeId: 'n-foreign-build' }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [wrongNodeCodingRun],
        listCodingDiffArtifacts: async () => [],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary(wrongNodeCodingRun.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'coding_agent_run' })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('fails closed before networking when an exact Coding diff has the wrong scope', async () => {
    const uploadCodingAgentSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadCodingAgentSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [
          { ...canonicalCodingDiff, projectId: 'other-local-project' },
        ],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalCodingAgentSummary(canonicalCodingRun.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'coding_diff' })
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('builds the remote Run summary from the canonical local Run', async () => {
    const uploadRunSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:06:00.000Z',
      message: 'accepted',
    }))
    const remoteSync = { uploadRunSummary } as unknown as RemoteSyncClient
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalRunSummary(localRun.id)

    expect(uploadRunSummary).toHaveBeenCalledWith({
      ...runSummary,
      projectId: 'team-project-1',
    })
  })

  it('does not accept a Team Project ID as the canonical local project ID', async () => {
    const uploadRunSummary = vi.fn()
    const wrongScopedRun = { ...localRun, projectId: pairingCredential.projectId }
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadRunSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [wrongScopedRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalRunSummary(wrongScopedRun.id),
    ).rejects.toMatchObject({ code: 'scope_mismatch', entityKind: 'workflow_run' })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('returns a structured safe error when the remote rejects a canonical summary', async () => {
    const uploadRunSummary = vi.fn(async () => ({
      accepted: false,
      syncedAt: '2026-06-20T00:06:00.000Z',
      message: 'Authorization: Bearer hostile-remote-token for sensitive-run-id',
    }))
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadRunSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    const error = await boundRemoteSync.uploadCanonicalRunSummary(localRun.id).catch(
      (failure: unknown) => failure,
    )

    expect(error).toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'remote_error',
      entityKind: 'workflow_run',
      message: 'Canonical remote sync summary was rejected.',
    })
    expect(String(error)).not.toContain('hostile-remote-token')
    expect(String(error)).not.toContain('sensitive-run-id')
  })

  it('converts canonical summary construction failures into structured safe errors', async () => {
    const hostileNodeId = 'Authorization: Bearer hostile-current-node-token'
    const malformedRun = { ...localRun, currentNodeId: hostileNodeId }
    const uploadRunSummary = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { uploadRunSummary } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [malformedRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    const error = await boundRemoteSync.uploadCanonicalRunSummary(malformedRun.id).catch(
      (failure: unknown) => failure,
    )

    expect(error).toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'invalid_response',
      entityKind: 'workflow_run',
      message: 'Canonical remote sync entity is invalid.',
    })
    expect(String(error)).not.toContain(hostileNodeId)
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('uploads dependent evidence when a newer canonical Run makes the local preflight stale', async () => {
    const uploadOrder: string[] = []
    const uploadRunSummary = vi.fn(async () => {
      uploadOrder.push('run')
      throw new Error(
        'Remote Run Summary conflicts with canonical ownership or is stale: run-local-1 (team-project-1)',
      )
    })
    const uploadTestEvidenceSummary = vi.fn(async () => {
      uploadOrder.push('evidence')
      return {
        accepted: true,
        syncedAt: '2026-06-20T00:06:01.000Z',
        message: 'evidence accepted',
      }
    })
    const remoteSync = {
      uploadRunSummary,
      uploadTestEvidenceSummary,
    } as unknown as RemoteSyncClient
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id)

    expect(uploadOrder).toEqual(['evidence'])
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('uploads the latest Run and retries evidence once when the canonical Run is missing', async () => {
    const uploadOrder: string[] = []
    const uploadRunSummary = vi.fn(async () => {
      uploadOrder.push('run')
      return {
        accepted: true,
        syncedAt: '2026-06-20T00:06:00.000Z',
        message: 'canonical run accepted',
      }
    })
    const uploadTestEvidenceSummary = vi
      .fn()
      .mockImplementationOnce(async () => {
        uploadOrder.push('evidence')
        throw new RemoteSyncHttpError({
          status: 409,
          code: 'canonical_run_required',
          path: '/api/sync/test-evidence-summary',
          retryable: false,
        })
      })
      .mockImplementationOnce(async () => {
        uploadOrder.push('evidence')
        return {
          accepted: true,
          syncedAt: '2026-06-20T00:06:01.000Z',
          message: 'evidence accepted',
        }
      })
    const remoteSync = {
      uploadRunSummary,
      uploadTestEvidenceSummary,
    } as unknown as RemoteSyncClient
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id),
    ).resolves.toEqual({
      accepted: true,
      syncedAt: '2026-06-20T00:06:01.000Z',
      message: 'evidence accepted',
    })
    expect(uploadOrder).toEqual(['evidence', 'run', 'evidence'])
    expect(uploadRunSummary).toHaveBeenCalledTimes(1)
    expect(uploadTestEvidenceSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps one expected Team scope frozen across canonical fallback and retry', async () => {
    const repairedCredential: DesktopPairingCredential = {
      ...pairingCredential,
      tokenId: 'desktop-token-2',
      organizationId: 'org-other',
      projectId: 'team-project-2',
      projectMemberships: [
        { projectId: 'team-project-2', userId: 'u-ling', role: 'lead' },
      ],
    }
    const getDesktopPairingCredential = vi.fn(async () => repairedCredential)
    const accepted = {
      accepted: true,
      syncedAt: '2026-06-20T00:06:01.000Z',
      message: 'accepted',
    }
    const uploadRunSummary = vi.fn(async () => accepted)
    const uploadTestEvidenceSummary = vi
      .fn()
      .mockRejectedValueOnce(new RemoteSyncHttpError({
        status: 409,
        code: 'canonical_run_required',
        path: '/api/sync/test-evidence-summary',
        retryable: false,
      }))
      .mockResolvedValueOnce(accepted)
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadTestEvidenceSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
      expectedScope: {
        localProjectId: 'local-project-1',
        organizationId: 'org-demo',
        teamProjectId: 'team-project-1',
      },
    })

    await boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id)

    expect(getDesktopPairingCredential).not.toHaveBeenCalled()
    expect(uploadRunSummary).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'team-project-1',
    }))
    expect(uploadTestEvidenceSummary).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ projectId: 'team-project-1' }),
    )
  })

  it('reads pairing once and freezes it for an unscoped canonical operation', async () => {
    const repairedCredential: DesktopPairingCredential = {
      ...pairingCredential,
      tokenId: 'desktop-token-2',
      projectId: 'team-project-2',
    }
    const getDesktopPairingCredential = vi
      .fn()
      .mockResolvedValueOnce(pairingCredential)
      .mockResolvedValueOnce(repairedCredential)
    const accepted = {
      accepted: true,
      syncedAt: '2026-06-20T00:06:01.000Z',
      message: 'accepted',
    }
    const uploadRunSummary = vi.fn(async () => accepted)
    const uploadTestEvidenceSummary = vi
      .fn()
      .mockRejectedValueOnce(new RemoteSyncHttpError({
        status: 409,
        code: 'canonical_run_required',
        path: '/api/sync/test-evidence-summary',
        retryable: false,
      }))
      .mockResolvedValueOnce(accepted)
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadTestEvidenceSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id)

    expect(getDesktopPairingCredential).toHaveBeenCalledTimes(1)
    expect(uploadRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'team-project-1' }),
    )
    expect(uploadTestEvidenceSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'team-project-1' }),
    )
  })

  it('uses the same single canonical-missing fallback for Review and Coding summaries', async () => {
    const acceptedUpload = {
      accepted: true,
      syncedAt: '2026-06-20T00:06:01.000Z',
      message: 'accepted',
    }
    const canonicalMissing = () =>
      new RemoteSyncHttpError({
        status: 409,
        code: 'canonical_run_required',
        path: '/api/sync/child-summary',
        retryable: false,
      })
    const uploadRunSummary = vi.fn(async () => acceptedUpload)
    const uploadAgentReviewSummary = vi
      .fn()
      .mockRejectedValueOnce(canonicalMissing())
      .mockResolvedValueOnce(acceptedUpload)
    const uploadCodingAgentSummary = vi
      .fn()
      .mockRejectedValueOnce(canonicalMissing())
      .mockResolvedValueOnce(acceptedUpload)
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadAgentReviewSummary,
        uploadCodingAgentSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(boundRemoteSync.uploadAgentReviewSummary(reviewSummary)).resolves.toEqual(
      acceptedUpload,
    )
    await expect(boundRemoteSync.uploadCodingAgentSummary(codingSummary)).resolves.toEqual(
      acceptedUpload,
    )

    expect(uploadRunSummary).toHaveBeenCalledTimes(2)
    expect(uploadAgentReviewSummary).toHaveBeenCalledTimes(2)
    expect(uploadCodingAgentSummary).toHaveBeenCalledTimes(2)
  })

  it('rethrows non-canonical dependent upload errors without a Run fallback', async () => {
    const uploadRunSummary = vi.fn()
    const uploadTestEvidenceSummary = vi.fn(async () => {
      throw new RemoteSyncHttpError({
        status: 403,
        code: 'forbidden',
        path: '/api/sync/test-evidence-summary',
        retryable: false,
      })
    })
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadTestEvidenceSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden', retryable: false })
    expect(uploadTestEvidenceSummary).toHaveBeenCalledTimes(1)
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('does not trust a canonical error code without the authoritative conflict status', async () => {
    const uploadRunSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:06:00.000Z',
      message: 'accepted',
    }))
    const uploadTestEvidenceSummary = vi.fn(async () => {
      throw new RemoteSyncHttpError({
        status: 400,
        code: 'canonical_run_required',
        path: '/api/sync/test-evidence-summary',
        retryable: false,
      })
    })
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadTestEvidenceSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id),
    ).rejects.toMatchObject({ status: 400, code: 'canonical_run_required' })
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('fails closed when the canonical fallback detects a cross-owner Run collision', async () => {
    const uploadRunSummary = vi.fn(async () => {
      throw new RemoteSyncHttpError({
        status: 409,
        code: 'conflict',
        path: '/api/sync/run-summary',
        retryable: false,
      })
    })
    const uploadAgentReviewSummary = vi.fn(async () => {
      throw new RemoteSyncHttpError({
        status: 409,
        code: 'canonical_run_required',
        path: '/api/sync/agent-review-summary',
        retryable: false,
      })
    })
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadAgentReviewSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(boundRemoteSync.uploadAgentReviewSummary(reviewSummary)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    })
    expect(uploadAgentReviewSummary).toHaveBeenCalledTimes(1)
    expect(uploadRunSummary).toHaveBeenCalledTimes(1)
  })

  it('retries a dependent summary only once when canonical-missing persists', async () => {
    const canonicalMissing = new RemoteSyncHttpError({
      status: 409,
      code: 'canonical_run_required',
      path: '/api/sync/coding-agent-summary',
      retryable: false,
    })
    const uploadRunSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-20T00:06:00.000Z',
      message: 'accepted',
    }))
    const uploadCodingAgentSummary = vi.fn(async () => {
      throw canonicalMissing
    })
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: {
        uploadRunSummary,
        uploadCodingAgentSummary,
      } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(boundRemoteSync.uploadCodingAgentSummary(codingSummary)).rejects.toMatchObject({
      status: 409,
      code: 'canonical_run_required',
    })
    expect(uploadCodingAgentSummary).toHaveBeenCalledTimes(2)
    expect(uploadRunSummary).toHaveBeenCalledTimes(1)
  })

  it('binds every project-bearing operation without preflighting existing dependent Runs', async () => {
    const acceptedUpload = {
      accepted: true,
      syncedAt: '2026-06-20T00:06:00.000Z',
      message: 'accepted',
    }
    const uploadRunSummary = vi.fn(async () => acceptedUpload)
    const uploadTestEvidenceSummary = vi.fn(async () => acceptedUpload)
    const uploadAgentReviewSummary = vi.fn(async () => acceptedUpload)
    const uploadCodingAgentSummary = vi.fn(async () => acceptedUpload)
    const saveGateOverride = vi.fn(async () => ({
      id: 'gate-override-1',
      runId: 'run-local-1',
      nodeId: 'n-design-gate',
      projectId: 'team-project-1',
      userId: 'u-ling',
      role: 'lead' as const,
      reason: 'Reviewed and approved.',
      blockedReasonIds: ['missing-review'],
      policyVersion: 2,
      provisional: false,
      status: 'accepted' as const,
      createdAt: '2026-06-20T00:07:00.000Z',
    }))
    const evaluateRuntimeBudget = vi.fn(async () => ({
      status: 'allowed' as const,
      blocksRun: false,
      currentSpendUsd: 1,
      projectedCostUsd: 0.1,
      reason: 'Within budget.',
    }))
    const remoteSync = {
      uploadRunSummary,
      uploadTestEvidenceSummary,
      uploadAgentReviewSummary,
      uploadCodingAgentSummary,
      saveGateOverride,
      evaluateRuntimeBudget,
    } as unknown as RemoteSyncClient
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })
    const gateOverride: Parameters<RemoteSyncClient['saveGateOverride']>[0] = {
      runId: 'run-local-1',
      nodeId: 'n-design-gate',
      projectId: 'local-project-1',
      reason: 'Reviewed and approved.',
      blockedReasonIds: ['missing-review'],
      policyVersion: 2,
    }
    const budgetRequest: Parameters<RemoteSyncClient['evaluateRuntimeBudget']>[0] = {
      projectId: 'local-project-1',
      providerId: 'double',
      projectedCostUsd: 0.1,
    }

    await boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id)
    await boundRemoteSync.uploadAgentReviewSummary(reviewSummary)
    await boundRemoteSync.uploadCodingAgentSummary(codingSummary)
    await boundRemoteSync.saveGateOverride(gateOverride)
    await boundRemoteSync.evaluateRuntimeBudget(budgetRequest)

    expect(uploadTestEvidenceSummary).toHaveBeenCalledWith({
      ...evidenceSummary,
      projectId: 'team-project-1',
    })
    expect(uploadAgentReviewSummary).toHaveBeenCalledWith({
      ...reviewSummary,
      projectId: 'team-project-1',
    })
    expect(uploadCodingAgentSummary).toHaveBeenCalledWith({
      ...codingSummary,
      projectId: 'team-project-1',
    })
    expect(saveGateOverride).toHaveBeenCalledWith({
      ...gateOverride,
      projectId: 'team-project-1',
    })
    expect(uploadRunSummary).not.toHaveBeenCalled()
    expect(evaluateRuntimeBudget).toHaveBeenCalledWith({
      ...budgetRequest,
      projectId: 'team-project-1',
    })
  })

  it('does not accept the Team Project ID in a local Gate or budget command', async () => {
    const saveGateOverride = vi.fn()
    const evaluateRuntimeBudget = vi.fn()
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync: { saveGateOverride, evaluateRuntimeBudget } as unknown as RemoteSyncClient,
      credentialSource: {
        getDesktopPairingCredential: async () => pairingCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(boundRemoteSync.evaluateRuntimeBudget({
      projectId: pairingCredential.projectId,
      providerId: 'double',
      projectedCostUsd: 0.1,
    })).rejects.toThrow('Paired Team Project is bound to a different local project.')
    await expect(boundRemoteSync.saveGateOverride({
      runId: localRun.id,
      nodeId: 'n-design-gate',
      projectId: pairingCredential.projectId,
      reason: 'Reviewed and approved.',
      blockedReasonIds: ['missing-review'],
      policyVersion: 2,
    })).rejects.toThrow('Paired Team Project is bound to a different local project.')

    expect(evaluateRuntimeBudget).not.toHaveBeenCalled()
    expect(saveGateOverride).not.toHaveBeenCalled()
  })

  it('fails closed before upload when legacy pairing metadata has no local binding', async () => {
    const uploadRunSummary = vi.fn()
    const remoteSync = { uploadRunSummary } as unknown as RemoteSyncClient
    const legacyCredential = { ...pairingCredential }
    delete legacyCredential.localProjectId
    const boundRemoteSync = createProjectBoundRemoteSync({
      remoteSync,
      credentialSource: {
        getDesktopPairingCredential: async () => legacyCredential,
        listRuns: async () => [localRun],
        listTestEvidence: async () => [testEvidence],
        listAgentReviews: async () => [canonicalReview],
        listCodingAgentRuns: async () => [canonicalCodingRun],
        listCodingDiffArtifacts: async () => [canonicalCodingDiff],
      },
    })

    await expect(boundRemoteSync.uploadCanonicalRunSummary(localRun.id)).rejects.toThrow(
      'Paired Team Project is not bound to a local project.',
    )
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })
})
