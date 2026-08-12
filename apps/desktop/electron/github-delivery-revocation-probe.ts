import type {
  DesktopPairingCredential,
  GitHubDeliveryIntent,
  GitHubDeliveryRevocationCheck,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type {
  GitHubDeliveryRecoverySnapshot,
  GitHubDeliveryRequestRecord,
  createGitHubDeliveryRemoteClient,
} from './github-delivery-remote-client.js'
import { synchronizeGitHubRepositoryBinding } from './github-repository-binding-sync.js'
import type {
  VerifyGitHubDeliveryRevocationInput,
  VerifyGitHubDeliveryRevocationResult,
} from './ipc-contract.js'

type GitHubDeliveryRemoteClient = ReturnType<
  typeof createGitHubDeliveryRemoteClient
>

export type GitHubDeliveryRevocationProbeDeps = {
  store: Pick<
    LocalStore,
    | 'listGitHubDeliveryIntents'
    | 'listGitHubDeliveryRevocationChecks'
    | 'commitGitHubRepositoryBindingObservation'
    | 'commitGitHubDeliveryRevocationCheck'
  >
  remote: Pick<
    GitHubDeliveryRemoteClient,
    | 'getRepositoryBinding'
    | 'getRecoverySnapshot'
    | 'verifyCredentialGrantBlocked'
  >
  expectedPairing: DesktopPairingCredential
  now?: () => string
}

function unverified(
  intentId: string,
  outcomeCode: Extract<
    VerifyGitHubDeliveryRevocationResult,
    { disposition: 'unverified' }
  >['outcomeCode'],
): VerifyGitHubDeliveryRevocationResult {
  return { intentId, disposition: 'unverified', outcomeCode }
}

function isExactPairingScope(
  pairing: DesktopPairingCredential,
  intent: GitHubDeliveryIntent,
): boolean {
  return (
    pairing.localProjectId === intent.localProjectId &&
    pairing.organizationId === intent.organizationId &&
    pairing.projectId === intent.teamProjectId &&
    pairing.projectMemberships.some(
      (membership) =>
        membership.projectId === pairing.projectId &&
        membership.userId === pairing.userId,
    )
  )
}

function isExactRevokedBinding(
  binding: GitHubRepositoryBinding,
  intent: GitHubDeliveryIntent,
): boolean {
  return (
    binding.status === 'revoked' &&
    binding.id === intent.repositoryBindingId &&
    binding.version > intent.repositoryBindingVersion &&
    binding.organizationId === intent.organizationId &&
    binding.teamProjectId === intent.teamProjectId &&
    binding.installationId === intent.installationId &&
    binding.repositoryId === intent.repositoryId &&
    binding.repository === intent.repository &&
    binding.defaultBranch === intent.baseBranch
  )
}

function isExactCompletedRequest(
  request: GitHubDeliveryRequestRecord,
  intent: GitHubDeliveryIntent & {
    status: 'completed'
    completion: NonNullable<GitHubDeliveryIntent['completion']>
  },
): boolean {
  return (
    request.id === intent.completion.remoteRequestId &&
    request.organizationId === intent.organizationId &&
    request.projectId === intent.teamProjectId &&
    request.localIntentId === intent.id &&
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
    request.diffArtifactId === intent.diffArtifactId &&
    request.testEvidenceId === intent.testEvidenceId &&
    request.prPackageArtifactId === intent.prPackageArtifactId &&
    request.status === 'completed' &&
    request.outcomeCode === 'draft_pr_created' &&
    request.baseBranch === intent.baseBranch &&
    request.headBranch === intent.headBranch &&
    request.baseCommitSha === intent.baseCommitSha &&
    request.expectedCommitSha === intent.expectedCommitSha &&
    request.intentDigest === intent.intentDigest &&
    request.deliverySeriesKey === intent.deliverySeriesKey &&
    request.deliveryAttempt === intent.deliveryAttempt &&
    request.logicalIdempotencyKey === intent.idempotencyKey &&
    request.diffDigest === intent.diffSourceDigest &&
    request.testEvidenceDigest === intent.testEvidenceDigest &&
    request.packageDigest === intent.prPackageDigest &&
    JSON.stringify(request.changedPaths) === JSON.stringify(intent.changedPaths)
  )
}

function isExactCompletionSnapshot(
  snapshot: GitHubDeliveryRecoverySnapshot,
  intent: GitHubDeliveryIntent & {
    status: 'completed'
    completion: NonNullable<GitHubDeliveryIntent['completion']>
  },
): boolean {
  const { completion } = intent
  return (
    isExactCompletedRequest(snapshot.request, intent) &&
    snapshot.publication?.id === completion.publicationId &&
    snapshot.publication.requestId === completion.remoteRequestId &&
    snapshot.publication.status === 'verified' &&
    snapshot.publication.verifiedHeadSha === intent.expectedCommitSha &&
    snapshot.publication.outcomeCode === 'branch_verified' &&
    snapshot.pullRequest?.id === completion.pullRequestOutcomeId &&
    snapshot.pullRequest.requestId === completion.remoteRequestId &&
    snapshot.pullRequest.publicationId === completion.publicationId &&
    snapshot.pullRequest.status === 'completed' &&
    snapshot.pullRequest.outcomeCode === 'draft_pr_created' &&
    snapshot.pullRequest.pullRequestId === completion.pullRequestId &&
    snapshot.pullRequest.pullRequestNumber === completion.pullRequestNumber &&
    snapshot.pullRequest.safeUrl === completion.pullRequestUrl &&
    snapshot.pullRequest.providerCreatedAt === completion.providerCreatedAt &&
    snapshot.pullRequest.draft === true &&
    snapshot.pullRequest.headBranch === intent.headBranch &&
    snapshot.pullRequest.baseBranch === intent.baseBranch &&
    snapshot.pullRequest.headSha === intent.expectedCommitSha
  )
}

function canonicalCheckedAt(
  now: string,
  intent: GitHubDeliveryIntent,
  binding: GitHubRepositoryBinding,
): string | null {
  const timestamps = [now, intent.updatedAt, binding.updatedAt].map(Date.parse)
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function isExactExistingCheck(
  check: GitHubDeliveryRevocationCheck,
  intent: GitHubDeliveryIntent,
  binding: GitHubRepositoryBinding,
): boolean {
  const keys = Object.keys(check).sort()
  const expectedKeys = [
    'bindingId',
    'bindingVersion',
    'checkedAt',
    'intentId',
    'intentUpdatedAt',
    'outcomeCode',
    'redacted',
    'stateVersion',
  ]
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    check.stateVersion === 1 &&
    check.intentId === intent.id &&
    check.intentUpdatedAt === intent.updatedAt &&
    check.bindingId === binding.id &&
    check.bindingVersion === binding.version &&
    check.outcomeCode === 'binding_inactive' &&
    canonicalCheckedAt(check.checkedAt, intent, binding) === check.checkedAt &&
    check.redacted === true
  )
}

export async function runGitHubDeliveryRevocationProbe(
  deps: GitHubDeliveryRevocationProbeDeps,
  input: VerifyGitHubDeliveryRevocationInput,
): Promise<VerifyGitHubDeliveryRevocationResult> {
  try {
    const intents = await deps.store.listGitHubDeliveryIntents()
    const intent = intents.find((candidate) => candidate.id === input.intentId)
    if (
      !intent ||
      intent.status !== 'completed' ||
      !intent.completion ||
      intent.updatedAt !== intent.completion.recordedAt ||
      !isExactPairingScope(deps.expectedPairing, intent)
    ) {
      return unverified(input.intentId, 'intent_not_found')
    }
    if (intent.updatedAt !== input.expectedUpdatedAt) {
      return unverified(input.intentId, 'stale_intent')
    }
    const completedIntent = intent as GitHubDeliveryIntent & {
      status: 'completed'
      completion: NonNullable<GitHubDeliveryIntent['completion']>
    }
    const sameRemoteAuthority = intents.filter(
      (candidate) =>
        candidate.status === 'completed' &&
        candidate.completion?.remoteRequestId ===
          completedIntent.completion.remoteRequestId &&
        isExactPairingScope(deps.expectedPairing, candidate),
    )
    if (sameRemoteAuthority.length !== 1) {
      return unverified(input.intentId, 'remote_request_unavailable')
    }

    const binding = await synchronizeGitHubRepositoryBinding({
      store: deps.store,
      remote: deps.remote,
      expectedPairing: deps.expectedPairing,
    })
    if (binding?.status === 'active') {
      return unverified(input.intentId, 'binding_active')
    }
    if (!binding || !isExactRevokedBinding(binding, completedIntent)) {
      return unverified(input.intentId, 'revocation_unavailable')
    }

    const existing = await deps.store.listGitHubDeliveryRevocationChecks(
      completedIntent.id,
    )
    if (
      existing.length === 1 &&
      existing[0] &&
      isExactExistingCheck(existing[0], completedIntent, binding)
    ) {
      return {
        intentId: completedIntent.id,
        disposition: 'blocked',
        outcomeCode: 'binding_inactive',
      }
    }
    if (existing.length > 0) {
      return unverified(input.intentId, 'revocation_unavailable')
    }

    const snapshot = await deps.remote.getRecoverySnapshot({
      projectId: deps.expectedPairing.projectId,
      requestId: completedIntent.completion.remoteRequestId,
    })
    if (!isExactCompletionSnapshot(snapshot, completedIntent)) {
      return unverified(input.intentId, 'remote_request_unavailable')
    }
    const proof = await deps.remote.verifyCredentialGrantBlocked({
      projectId: deps.expectedPairing.projectId,
      requestId: completedIntent.completion.remoteRequestId,
      expectedStateVersion: snapshot.request.stateVersion,
    })
    if (
      proof.status !== 'blocked' ||
      proof.outcomeCode !== 'binding_inactive'
    ) {
      return unverified(input.intentId, 'revocation_unavailable')
    }
    const checkedAt = canonicalCheckedAt(
      deps.now?.() ?? new Date().toISOString(),
      completedIntent,
      binding,
    )
    if (!checkedAt) {
      return unverified(input.intentId, 'revocation_unavailable')
    }
    const committed = await deps.store.commitGitHubDeliveryRevocationCheck({
      check: {
        stateVersion: 1,
        intentId: completedIntent.id,
        intentUpdatedAt: completedIntent.updatedAt,
        bindingId: binding.id,
        bindingVersion: binding.version,
        outcomeCode: 'binding_inactive',
        checkedAt,
        redacted: true,
      },
      expectedIntent: completedIntent,
      expectedBinding: binding,
      expectedPairing: deps.expectedPairing,
    })
    if (!committed.committed) {
      return unverified(
        input.intentId,
        committed.reason === 'intent_stale'
          ? 'stale_intent'
          : 'revocation_unavailable',
      )
    }
    return {
      intentId: completedIntent.id,
      disposition: 'blocked',
      outcomeCode: 'binding_inactive',
    }
  } catch {
    return unverified(input.intentId, 'revocation_unavailable')
  }
}
