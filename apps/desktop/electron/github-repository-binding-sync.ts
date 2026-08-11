import type {
  DesktopPairingCredential,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store'

export type GitHubRepositoryBindingReader = {
  getRepositoryBinding(
    projectId: string,
  ): Promise<GitHubRepositoryBinding | null>
}

export class GitHubRepositoryBindingSyncError extends Error {
  readonly code = 'binding_observation_rejected' as const

  constructor() {
    super('GitHub repository authority could not be synchronized safely.')
    this.name = 'GitHubRepositoryBindingSyncError'
  }

  toJSON(): {
    name: 'GitHubRepositoryBindingSyncError'
    code: 'binding_observation_rejected'
    message: string
  } {
    return {
      name: 'GitHubRepositoryBindingSyncError',
      code: this.code,
      message: this.message,
    }
  }
}

export async function synchronizeGitHubRepositoryBinding(input: {
  remote: GitHubRepositoryBindingReader
  store: Pick<LocalStore, 'commitGitHubRepositoryBindingObservation'>
  expectedPairing: DesktopPairingCredential
}): Promise<GitHubRepositoryBinding | null> {
  try {
    if (!input.expectedPairing.localProjectId) {
      throw new GitHubRepositoryBindingSyncError()
    }
    const binding = await input.remote.getRepositoryBinding(
      input.expectedPairing.projectId,
    )
    if (
      binding !== null &&
      (binding.organizationId !== input.expectedPairing.organizationId ||
        binding.teamProjectId !== input.expectedPairing.projectId)
    ) {
      throw new GitHubRepositoryBindingSyncError()
    }
    const committed =
      await input.store.commitGitHubRepositoryBindingObservation({
        expectedPairing: input.expectedPairing,
        binding,
      })
    if (!committed.committed) {
      throw new GitHubRepositoryBindingSyncError()
    }
    return committed.binding
  } catch {
    throw new GitHubRepositoryBindingSyncError()
  }
}
