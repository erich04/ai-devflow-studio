import { describe, expect, it, vi } from 'vitest'
import type {
  GitHubDeliveryIntent,
  ManagedCodingWorkspace,
} from '@ai-devflow/shared'
import { createManagedWorkspaceCleanupService } from './managed-workspace-cleanup'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator'

const workspace: ManagedCodingWorkspace = {
  id: 'workspace-1',
  projectId: 'project-1',
  codingRunId: 'coding-1',
  sourcePath: '/private/source',
  worktreePath: '/private/worktree',
  branchName: 'devflow/run-build-coding',
  baseBranch: 'main',
  baseCommitSha: '0000000000000000000000000000000000000000',
  headCommitSha: '1111111111111111111111111111111111111111',
  createdAt: '2026-08-11T13:00:00.000Z',
  cleanupStatus: 'active',
}

function intent(): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'intent-1',
    organizationId: 'org-1',
    teamProjectId: 'team-project-1',
    localProjectId: workspace.projectId,
    runId: 'run-1',
    runVersion: 1,
    nodeId: 'run-1-pr',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    installationId: '123',
    repositoryId: '456',
    codingRunId: workspace.codingRunId,
    codingRunCompletedAt: '2026-08-11T13:01:00.000Z',
    workspaceId: workspace.id,
    repository: 'owner/repository',
    baseBranch: workspace.baseBranch,
    headBranch: workspace.branchName,
    baseCommitSha: workspace.baseCommitSha!,
    expectedCommitSha: workspace.headCommitSha!,
    diffArtifactId: 'diff-1',
    diffSourceDigest: '2'.repeat(64),
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T13:01:00.000Z',
    testEvidenceDigest: '3'.repeat(64),
    prPackageArtifactId: 'package-1',
    prPackageUpdatedAt: '2026-08-11T13:01:00.000Z',
    prPackageDigest: '4'.repeat(64),
    changedPaths: ['src/index.ts'],
    intentDigest: '5'.repeat(64),
    idempotencyKey: `github-delivery:${'6'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T13:01:00.000Z',
    updatedAt: '2026-08-11T13:01:00.000Z',
    redacted: true,
  }
}

describe('managed workspace cleanup service', () => {
  it('refuses physical deletion while any Delivery Intent owns the workspace', async () => {
    const deleteWorkspace = vi.fn()
    const store = {
      listManagedCodingWorkspaces: vi.fn(async () => [workspace]),
      listGitHubDeliveryIntents: vi.fn(async () => [intent()]),
      commitManagedCodingWorkspaceCleanup: vi.fn(),
    }
    const cleanup = createManagedWorkspaceCleanupService({
      store,
      coordinator: createWorkspaceOperationCoordinator(),
      deleteWorkspace,
    })

    await expect(cleanup({ workspaceId: workspace.id, projectId: workspace.projectId }))
      .rejects.toThrow('Managed workspace is retained by GitHub Delivery')
    expect(deleteWorkspace).not.toHaveBeenCalled()
    expect(store.commitManagedCodingWorkspaceCleanup).not.toHaveBeenCalled()
  })

  it('deletes the lock-time workspace and preserves its recorded commit through cleanup CAS', async () => {
    const deletedWorkspace: ManagedCodingWorkspace = {
      ...workspace,
      deletedAt: '2026-08-11T13:02:00.000Z',
      cleanupStatus: 'deleted',
    }
    const deleteWorkspace = vi.fn(async () => deletedWorkspace)
    const store = {
      listManagedCodingWorkspaces: vi.fn(async () => [workspace]),
      listGitHubDeliveryIntents: vi.fn(async () => []),
      commitManagedCodingWorkspaceCleanup: vi.fn(async (mutation: {
        expectedWorkspace: ManagedCodingWorkspace
        workspace: ManagedCodingWorkspace
      }) => ({
        committed: true as const,
        replayed: false,
        workspace: mutation.workspace,
      })),
    }
    const cleanup = createManagedWorkspaceCleanupService({
      store,
      coordinator: createWorkspaceOperationCoordinator(),
      deleteWorkspace,
    })

    await expect(cleanup({ workspaceId: workspace.id, projectId: workspace.projectId }))
      .resolves.toEqual(deletedWorkspace)
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.commitManagedCodingWorkspaceCleanup).toHaveBeenCalledWith({
      expectedWorkspace: workspace,
      workspace: deletedWorkspace,
    })
  })
})
