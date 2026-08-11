import {
  redactLocalAbsolutePaths,
  redactSensitiveText,
  isTerminalGitHubDeliveryStatus,
  type GitHubDeliveryIntent,
  type ManagedCodingWorkspace,
} from '@ai-devflow/shared'
import { deleteManagedCodingWorkspace } from './coding-runner.js'
import type {
  ManagedCodingWorkspaceCleanupMutation,
  ManagedCodingWorkspaceCleanupMutationResult,
} from './local-store.js'
import type { WorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'

export type ManagedWorkspaceCleanupStore = {
  listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]>
  listGitHubDeliveryIntents(runId?: string): Promise<GitHubDeliveryIntent[]>
  commitManagedCodingWorkspaceCleanup(
    mutation: ManagedCodingWorkspaceCleanupMutation,
  ): Promise<ManagedCodingWorkspaceCleanupMutationResult>
}

export type ManagedWorkspaceCleanupInput = {
  workspaceId: string
  projectId?: string
}

export function createManagedWorkspaceCleanupService(input: {
  store: ManagedWorkspaceCleanupStore
  coordinator: WorkspaceOperationCoordinator
  deleteWorkspace?: (
    workspace: ManagedCodingWorkspace,
  ) => Promise<ManagedCodingWorkspace>
}) {
  const deleteWorkspace = input.deleteWorkspace ?? deleteManagedCodingWorkspace

  return async function cleanupManagedWorkspace(
    request: ManagedWorkspaceCleanupInput,
  ): Promise<ManagedCodingWorkspace> {
    return input.coordinator.runExclusive(request.workspaceId, async () => {
      const matches = (await input.store.listManagedCodingWorkspaces(request.projectId))
        .filter((candidate) => candidate.id === request.workspaceId)
      if (matches.length !== 1) {
        throw new Error('Managed workspace is missing or ambiguous')
      }
      const workspace = matches[0]!
      if (workspace.cleanupStatus === 'deleted') {
        return workspace
      }
      const retained = (await input.store.listGitHubDeliveryIntents())
        .some((candidate) => (
          candidate.workspaceId === workspace.id &&
          !isTerminalGitHubDeliveryStatus(candidate.status)
        ))
      if (retained) {
        throw new Error('Managed workspace is retained by GitHub Delivery')
      }

      let cleaned: ManagedCodingWorkspace
      try {
        cleaned = await deleteWorkspace(workspace)
      } catch {
        cleaned = {
          ...workspace,
          deletedAt: new Date().toISOString(),
          cleanupStatus: 'cleanup_failed',
          cleanupError: 'Managed workspace cleanup failed safely.',
        }
      }
      if (cleaned.cleanupStatus === 'cleanup_failed') {
        const safeError = redactSensitiveText(
          redactLocalAbsolutePaths(
            cleaned.cleanupError || 'Managed workspace cleanup failed safely.',
          ).value,
        ).value.slice(0, 500)
        cleaned = {
          ...cleaned,
          deletedAt: cleaned.deletedAt ?? new Date().toISOString(),
          cleanupStatus: 'cleanup_failed',
          cleanupError: safeError || 'Managed workspace cleanup failed safely.',
        }
      }
      const committed = await input.store.commitManagedCodingWorkspaceCleanup({
        expectedWorkspace: workspace,
        workspace: cleaned,
      })
      if (!committed.committed) {
        throw new Error(`Managed workspace cleanup lost authority: ${committed.reason}`)
      }
      return committed.workspace
    })
  }
}
