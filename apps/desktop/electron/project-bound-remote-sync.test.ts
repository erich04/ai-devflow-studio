import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopPairingCredential,
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { RemoteSyncClient } from './remote-sync'
import { createProjectBoundRemoteSync } from './project-bound-remote-sync'

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
  nodes: [{
    id: 'n-build',
    stage: 'build',
    title: 'Build',
    subtitle: 'Implement locally.',
    kind: 'task',
    status: 'running',
    ownerId: 'u-ling',
    retryCount: 0,
    artifactIds: [],
  }],
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

describe('project-bound Electron remote sync', () => {
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
      },
    })

    await boundRemoteSync.uploadCanonicalRunSummary(localRun.id)

    expect(uploadRunSummary).toHaveBeenCalledWith({
      ...runSummary,
      projectId: 'team-project-1',
    })
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
        throw new Error(
          'Canonical Run Summary is required before evidence sync: run-local-1 (team-project-1)',
        )
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

  it('uses the same single canonical-missing fallback for Review and Coding summaries', async () => {
    const acceptedUpload = {
      accepted: true,
      syncedAt: '2026-06-20T00:06:01.000Z',
      message: 'accepted',
    }
    const canonicalMissing = () =>
      new Error(
        'Canonical Run Summary is required before evidence sync: run-local-1 (team-project-1)',
      )
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
      throw new Error('Project access required')
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
      },
    })

    await expect(
      boundRemoteSync.uploadCanonicalTestEvidenceSummary(testEvidence.id),
    ).rejects.toThrow('Project access required')
    expect(uploadTestEvidenceSummary).toHaveBeenCalledTimes(1)
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })

  it('fails closed when the canonical fallback detects a cross-owner Run collision', async () => {
    const uploadRunSummary = vi.fn(async () => {
      throw new Error(
        'Remote Run Summary conflicts with canonical ownership or is stale: run-local-1 (team-project-1)',
      )
    })
    const uploadAgentReviewSummary = vi.fn(async () => {
      throw new Error(
        'Canonical Run Summary is required before evidence sync: run-local-1 (team-project-1)',
      )
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
      },
    })

    await expect(boundRemoteSync.uploadAgentReviewSummary(reviewSummary)).rejects.toThrow(
      'Remote Run Summary conflicts with canonical ownership or is stale',
    )
    expect(uploadAgentReviewSummary).toHaveBeenCalledTimes(1)
    expect(uploadRunSummary).toHaveBeenCalledTimes(1)
  })

  it('retries a dependent summary only once when canonical-missing persists', async () => {
    const canonicalMissing = new Error(
      'Canonical Run Summary is required before evidence sync: run-local-1 (team-project-1)',
    )
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
      },
    })

    await expect(boundRemoteSync.uploadCodingAgentSummary(codingSummary)).rejects.toThrow(
      'Canonical Run Summary is required before evidence sync',
    )
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
      },
    })

    await expect(boundRemoteSync.uploadCanonicalRunSummary(localRun.id)).rejects.toThrow(
      'Paired Team Project is not bound to a local project.',
    )
    expect(uploadRunSummary).not.toHaveBeenCalled()
  })
})
