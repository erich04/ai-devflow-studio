import type {
  GitHubDeliveryIntent,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type { GitHubDeliveryRequestRecord } from './github-delivery-remote-client.js'

export type GitHubDeliveryRetryAuthority = 'new_series' | 'next_attempt'

export class GitHubDeliveryRetryAuthorityError extends Error {
  constructor() {
    super('GitHub Delivery retry authority requires reconciliation.')
    this.name = 'GitHubDeliveryRetryAuthorityError'
  }
}

export function assertGitHubDeliveryRetryAuthority(input: {
  intent: GitHubDeliveryIntent
  binding: GitHubRepositoryBinding
  requests: readonly GitHubDeliveryRequestRecord[]
}): GitHubDeliveryRetryAuthority {
  const { intent, binding, requests } = input
  if (
    (intent.status !== 'failed' && intent.status !== 'revoked') ||
    binding.status !== 'active' ||
    binding.organizationId !== intent.organizationId ||
    binding.teamProjectId !== intent.teamProjectId
  ) {
    throw new GitHubDeliveryRetryAuthorityError()
  }

  const candidates = requests.filter((request) =>
    request.localIntentId === intent.id || (
      request.logicalIdempotencyKey === intent.idempotencyKey &&
      request.organizationId === intent.organizationId &&
      request.projectId === intent.teamProjectId &&
      request.runId === intent.runId &&
      request.nodeId === intent.nodeId &&
      request.deliverySeriesKey === intent.deliverySeriesKey &&
      request.deliveryAttempt === intent.deliveryAttempt
    ),
  )
  if (
    candidates.length !== 1 ||
    !matchesExactTerminalAuthority(intent, candidates[0]!)
  ) {
    throw new GitHubDeliveryRetryAuthorityError()
  }
  return binding.id !== intent.repositoryBindingId ||
    binding.version !== intent.repositoryBindingVersion
    ? 'new_series'
    : 'next_attempt'
}

function matchesExactTerminalAuthority(
  intent: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
): boolean {
  return (
    request.status === intent.status &&
    (request.status === 'failed' || request.status === 'revoked') &&
    request.outcomeCode !== null &&
    request.localIntentId === intent.id &&
    request.organizationId === intent.organizationId &&
    request.projectId === intent.teamProjectId &&
    request.localProjectId === intent.localProjectId &&
    request.runId === intent.runId &&
    request.runVersion === intent.runVersion &&
    request.expectedRunVersion === intent.runVersion &&
    request.nodeId === intent.nodeId &&
    request.repositoryBindingId === intent.repositoryBindingId &&
    request.repositoryBindingVersion === intent.repositoryBindingVersion &&
    request.installationId === intent.installationId &&
    request.repositoryId === intent.repositoryId &&
    request.repository === intent.repository &&
    request.codingRunId === intent.codingRunId &&
    request.workspaceId === intent.workspaceId &&
    request.deliverySeriesKey === intent.deliverySeriesKey &&
    request.deliveryAttempt === intent.deliveryAttempt &&
    request.diffArtifactId === intent.diffArtifactId &&
    request.testEvidenceId === intent.testEvidenceId &&
    request.prPackageArtifactId === intent.prPackageArtifactId &&
    request.baseBranch === intent.baseBranch &&
    request.headBranch === intent.headBranch &&
    request.baseCommitSha === intent.baseCommitSha &&
    request.expectedCommitSha === intent.expectedCommitSha &&
    request.intentDigest === intent.intentDigest &&
    request.logicalIdempotencyKey === intent.idempotencyKey &&
    request.diffDigest === intent.diffSourceDigest &&
    request.testEvidenceDigest === intent.testEvidenceDigest &&
    request.packageDigest === intent.prPackageDigest &&
    JSON.stringify(request.changedPaths) === JSON.stringify(intent.changedPaths)
  )
}
