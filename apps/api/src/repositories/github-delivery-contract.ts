import { createHash } from 'node:crypto'
import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
  redactSensitiveText,
  toTeamStoredNodeId,
  type GitHubDeliveryIntent,
  type GitHubDeliveryStatus,
  type GitHubRepositoryBinding,
  type Role,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'

export const GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS = 2 * 60 * 1_000
export const GITHUB_CREDENTIAL_PROVIDER_MAX_MS = 2 * 60 * 1_000
export const GITHUB_CREDENTIAL_MAX_TTL_MS = 60 * 60 * 1_000

export type GitHubDeliverySessionPrincipal = RequestPrincipal & {
  authentication: { kind: 'session_cookie'; tokenRecordId: null }
}

export type GitHubDeliveryDesktopPrincipal = RequestPrincipal & {
  authentication: { kind: 'desktop_bearer'; tokenRecordId: string }
}

export type GitHubDeliveryReadPrincipal =
  | GitHubDeliverySessionPrincipal
  | GitHubDeliveryDesktopPrincipal

export type GitHubDeliveryAuthorityLookup = {
  organizationId: string
  projectId: string
  userId: string
}

export type GitHubDeliveryDesktopAuthorityLookup =
  GitHubDeliveryAuthorityLookup & {
    tokenRecordId: string
  }

export type GitHubDeliveryCanonicalRunAuthorityLookup = {
  organizationId: string
  projectId: string
  runId: string
}

export type GitHubDeliveryCanonicalRunAuthority =
  GitHubDeliveryCanonicalRunAuthorityLookup & {
    runVersion: number
    currentNodeId: string
    materializedByTokenRecordId: string
  }

export type UpsertGitHubRepositoryBindingInput = {
  projectId: string
  installationId: string
  repositoryId: string
  repository: string
  defaultBranch: string
  verifiedAt: string
  expectedStateVersion: number
}

export type RevokeGitHubRepositoryBindingInput = {
  projectId: string
  expectedStateVersion: number
}

export type GitHubDeliveryOutcomeCode =
  | 'approval_rejected'
  | 'binding_revoked'
  | 'credential_issue_failed'
  | 'credential_expired'
  | 'branch_conflict'
  | 'branch_verification_failed'
  | 'draft_pr_created'
  | 'pull_request_failed'

export type GitHubDeliveryRequest = {
  id: string
  stateVersion: number
  intentRevision: number
  organizationId: string
  projectId: string
  requestedByUserId: string
  localIntentId: string
  localProjectId: string
  runId: string
  runVersion: number
  nodeId: string
  repositoryBindingId: string
  repositoryBindingVersion: number
  installationId: string
  repositoryId: string
  repository: string
  codingRunId: string
  workspaceId: string
  deliverySeriesKey: string
  deliveryAttempt: number
  diffArtifactId: string
  testEvidenceId: string
  prPackageArtifactId: string
  status: GitHubDeliveryStatus
  outcomeCode: GitHubDeliveryOutcomeCode | null
  expectedRunVersion: number
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  intentDigest: string
  logicalIdempotencyKey: string
  diffDigest: string
  testEvidenceDigest: string
  packageDigest: string
  changedPaths: string[]
  prTitle: string
  prBody: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  redacted: true
}

export type CreateOrReviseGitHubDeliveryRequestInput = {
  projectId: string
  intent: GitHubDeliveryIntent
  prTitle: string
  prBody: string
  expectedStateVersion: number
}

export type GitHubDeliveryIntentValidationAuthority = {
  organizationId: string
  projectId: string
  binding: {
    id: string
    version: number
    installationId: string
    repositoryId: string
    repository: string
    defaultBranch: string
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isSafeDeliveryIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f/\\]/u.test(value) &&
    !value.startsWith('~') &&
    !redactSensitiveText(value).redacted
  )
}

function expectedIntentDigest(intent: GitHubDeliveryIntent): string {
  return sha256Text(JSON.stringify({
    stateVersion: intent.stateVersion,
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    runVersion: intent.runVersion,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    installationId: intent.installationId,
    repositoryId: intent.repositoryId,
    codingRunId: intent.codingRunId,
    codingRunCompletedAt: intent.codingRunCompletedAt,
    workspaceId: intent.workspaceId,
    deliverySeriesKey: intent.deliverySeriesKey,
    deliveryAttempt: intent.deliveryAttempt,
    repository: intent.repository,
    baseBranch: intent.baseBranch,
    headBranch: intent.headBranch,
    baseCommitSha: intent.baseCommitSha,
    expectedCommitSha: intent.expectedCommitSha,
    diffArtifactId: intent.diffArtifactId,
    diffSourceDigest: intent.diffSourceDigest,
    testEvidenceId: intent.testEvidenceId,
    testEvidenceCreatedAt: intent.testEvidenceCreatedAt,
    testEvidenceDigest: intent.testEvidenceDigest,
    prPackageArtifactId: intent.prPackageArtifactId,
    prPackageUpdatedAt: intent.prPackageUpdatedAt,
    prPackageDigest: intent.prPackageDigest,
    changedPaths: intent.changedPaths,
  }))
}

function expectedDeliverySeriesKey(intent: GitHubDeliveryIntent): string {
  return `github-delivery:${sha256Text(JSON.stringify({
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    workspaceId: intent.workspaceId,
  }))}`
}

function expectedLogicalDeliveryKey(intent: GitHubDeliveryIntent): string {
  return `github-delivery:${sha256Text(JSON.stringify({
    deliverySeriesKey: intent.deliverySeriesKey,
    deliveryAttempt: intent.deliveryAttempt,
  }))}`
}

export function normalizeGitHubDeliveryRequestIntent(
  input: CreateOrReviseGitHubDeliveryRequestInput,
  authority: GitHubDeliveryIntentValidationAuthority,
): GitHubDeliveryIntent | null {
  try {
    const intent = input.intent
    const repository = normalizeGitHubRepository(intent.repository)
    const baseBranch = assertSafeGitHubBranch(intent.baseBranch)
    const headBranch = assertSafeGitHubBranch(intent.headBranch, {
      requireDeliveryNamespace: true,
    })
    const baseCommitSha = assertFullGitCommitSha(intent.baseCommitSha, 'Base commit')
    const expectedCommitSha = assertFullGitCommitSha(
      intent.expectedCommitSha,
      'Expected commit',
    )
    const changedPaths = [...new Set(intent.changedPaths)].sort((left, right) =>
      left.localeCompare(right),
    )
    const safePaths =
      changedPaths.length > 0 &&
      changedPaths.length <= 200 &&
      changedPaths.every(
        (path) =>
          path.length > 0 &&
          path.length <= 500 &&
          path.trim() === path &&
          !path.startsWith('/') &&
          !path.startsWith('~') &&
          !path.includes('\\') &&
          !redactSensitiveText(path).redacted &&
          path
            .split('/')
            .every((segment) => segment && segment !== '.' && segment !== '..'),
      )
    const digest = (value: string) => /^[a-f0-9]{64}$/u.test(value)
    const titleRedaction = redactSensitiveText(input.prTitle)
    const bodyRedaction = redactSensitiveText(input.prBody)
    const validTitle =
      input.prTitle.length > 0 &&
      input.prTitle.length <= 256 &&
      input.prTitle.trim() === input.prTitle &&
      !/[\u0000-\u001f\u007f]/u.test(input.prTitle) &&
      !titleRedaction.redacted
    const validBody =
      input.prBody.length > 0 &&
      input.prBody.length <= 20_000 &&
      !input.prBody.includes('\u0000') &&
      !bodyRedaction.redacted
    const normalizedIntent: GitHubDeliveryIntent = {
      ...intent,
      repository,
      baseBranch,
      headBranch,
      baseCommitSha,
      expectedCommitSha,
      changedPaths,
    }
    if (
      intent.stateVersion !== 1 ||
      intent.redacted !== true ||
      intent.status !== 'approval_required' ||
      ![
        intent.id,
        intent.localProjectId,
        intent.runId,
        intent.nodeId,
        intent.repositoryBindingId,
        intent.codingRunId,
        intent.workspaceId,
        intent.diffArtifactId,
        intent.testEvidenceId,
        intent.prPackageArtifactId,
      ].every(isSafeDeliveryIdentifier) ||
      intent.organizationId !== authority.organizationId ||
      intent.teamProjectId !== authority.projectId ||
      intent.repositoryBindingId !== authority.binding.id ||
      intent.repositoryBindingVersion !== authority.binding.version ||
      intent.installationId !== authority.binding.installationId ||
      intent.repositoryId !== authority.binding.repositoryId ||
      repository !== authority.binding.repository ||
      baseBranch !== authority.binding.defaultBranch ||
      baseCommitSha === expectedCommitSha ||
      !Number.isSafeInteger(input.expectedStateVersion) ||
      input.expectedStateVersion < 0 ||
      !Number.isSafeInteger(intent.runVersion) ||
      intent.runVersion < 1 ||
      !Number.isSafeInteger(intent.deliveryAttempt) ||
      intent.deliveryAttempt < 1 ||
      !digest(intent.intentDigest) ||
      !digest(intent.diffSourceDigest) ||
      !digest(intent.testEvidenceDigest) ||
      !digest(intent.prPackageDigest) ||
      !/^github-delivery:[a-f0-9]{64}$/u.test(intent.deliverySeriesKey) ||
      !/^github-delivery:[a-f0-9]{64}$/u.test(intent.idempotencyKey) ||
      intent.intentDigest !== expectedIntentDigest(normalizedIntent) ||
      intent.deliverySeriesKey !== expectedDeliverySeriesKey(normalizedIntent) ||
      intent.idempotencyKey !== expectedLogicalDeliveryKey(normalizedIntent) ||
      !safePaths ||
      changedPaths.some((path, index) => path !== intent.changedPaths[index]) ||
      !validTitle ||
      !validBody
    ) {
      return null
    }
    toTeamStoredNodeId(intent.runId, intent.nodeId)
    return normalizedIntent
  } catch {
    return null
  }
}

export type GitHubDeliveryRequestMutationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode: 'delivery_created' | 'delivery_revised'
      replayed: boolean
      request: GitHubDeliveryRequest
    }
  | GitHubDeliveryRejectionResult

export type GitHubDeliveryApproval = {
  id: string
  requestId: string
  intentRevision: number
  requestStateVersion: number
  intentDigest: string
  repositoryBindingId: string
  repositoryBindingVersion: number
  runId: string
  runVersion: number
  nodeId: string
  repositoryId: string
  baseBranch: string
  headBranch: string
  expectedCommitSha: string
  testEvidenceDigest: string
  packageDigest: string
  approvedByUserId: string
  approvedRole: 'lead' | 'owner'
  authenticationKind: 'session_cookie'
  approvedAt: string
  redacted: true
}

export type DecideGitHubDeliveryRequestInput = {
  projectId: string
  requestId: string
  decision: 'approve' | 'reject'
  expectedStateVersion: number
}

export type GitHubDeliveryDecisionResult =
  | {
      ok: true
      responseStatus: 200
      outcomeCode: 'delivery_approved' | 'delivery_rejected'
      replayed: boolean
      request: GitHubDeliveryRequest
      approval: GitHubDeliveryApproval | null
    }
  | GitHubDeliveryRejectionResult

export type GitHubCredentialGrantStatus =
  | 'issuing'
  | 'issued'
  | 'consumed'
  | 'failed'
  | 'recovery_required'
  | 'expired'
  | 'revoked'

export type GitHubCredentialGrant = {
  id: string
  version: number
  requestId: string
  intentRevision: number
  approvalId: string
  attempt: number
  repositoryId: string
  permission: 'contents:write'
  repositoryCount: 1
  status: GitHubCredentialGrantStatus
  requestedAt: string
  issuedAt: string | null
  credentialExpiresAt: string | null
  providerExpiryContractVersion: 0 | 1
  providerCredentialExpiresAt: string | null
  providerExpiryObservedAt: string | null
  consumedAt: string | null
  outcomeCode:
    | 'credential_issue_failed'
    | 'credential_expired'
    | 'credential_superseded'
    | 'binding_revoked'
    | 'credential_mint_absent_confirmed'
    | 'credential_revocation_confirmed'
    | 'credential_provider_expiry_confirmed'
    | null
  redacted: true
}

export type ReserveGitHubCredentialGrantInput = {
  projectId: string
  requestId: string
  expectedStateVersion: number
}

export type FinalizeGitHubCredentialGrantInput = {
  projectId: string
  requestId: string
  grantId: string
  expectedStateVersion: number
  expectedGrantVersion: number
  outcome:
    | {
        status: 'issued'
        issuedAt: string
        credentialExpiresAt: string
        providerCredentialExpiresAt: string
        repositoryId: string
        permission: 'contents:write'
        repositoryCount: 1
      }
    | {
        status: 'failed' | 'recovery_required'
        outcomeCode: 'credential_issue_failed'
      }
}

export type ConfirmGitHubCredentialClearanceInput = {
  organizationId: string
  projectId: string
  requestId: string
  grantId: string
  outcomeCode:
    | 'credential_mint_absent_confirmed'
    | 'credential_revocation_confirmed'
}

declare const gitHubCredentialClearanceAuthorityBrand: unique symbol

/**
 * An in-process, repository-issued capability for settling one exact credential
 * reservation. Implementations validate object identity; this brand prevents
 * callers from constructing or serializing a substitute.
 */
export type GitHubCredentialClearanceAuthority = {
  readonly [gitHubCredentialClearanceAuthorityBrand]: true
}

export type GitHubCredentialGrantMutationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode: 'grant_reserved' | 'grant_finalized'
      replayed: boolean
      request: GitHubDeliveryRequest
      grant: GitHubCredentialGrant
    }
  | GitHubDeliveryRejectionResult

export type GitHubCredentialGrantReservationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode: 'grant_reserved'
      replayed: boolean
      request: GitHubDeliveryRequest
      grant: GitHubCredentialGrant
      clearanceAuthority: GitHubCredentialClearanceAuthority
    }
  | GitHubDeliveryRejectionResult

export type GitHubCredentialClearanceConfirmationResult =
  | {
      ok: true
      responseStatus: 200
      outcomeCode:
        | 'credential_mint_absent_confirmed'
        | 'credential_revocation_confirmed'
      replayed: boolean
      request: GitHubDeliveryRequest
      grant: GitHubCredentialGrant
    }
  | GitHubDeliveryRejectionResult

export type ConfirmGitHubCredentialProviderExpiryInput = {
  organizationId: string
  projectId: string
  requestId: string
  grantId: string
  providerCredentialExpiresAt: string
  providerExpiryObservedAt: string
}

export type GitHubCredentialProviderExpiryConfirmationResult =
  | {
      ok: true
      responseStatus: 200
      outcomeCode: 'credential_provider_expiry_confirmed'
      replayed: boolean
      request: GitHubDeliveryRequest
      grant: GitHubCredentialGrant
    }
  | GitHubDeliveryRejectionResult

export type GitHubBranchPublication = {
  id: string
  version: number
  requestId: string
  intentRevision: number
  grantId: string
  status: 'verifying' | 'verified' | 'conflict' | 'recovery_required' | 'failed'
  reportedOutcomeCode: 'pushed' | 'already_present' | 'unknown'
  verifiedHeadSha: string | null
  reportedAt: string
  verifiedAt: string | null
  outcomeCode:
    | 'branch_verified'
    | 'branch_conflict'
    | 'branch_verification_failed'
    | null
  redacted: true
}

export type RecordGitHubBranchPublicationReportInput = {
  projectId: string
  requestId: string
  grantId: string
  expectedStateVersion: number
  expectedGrantVersion: number
  reportedOutcomeCode: GitHubBranchPublication['reportedOutcomeCode']
}

export type FinalizeGitHubBranchPublicationInput = {
  projectId: string
  requestId: string
  publicationId: string
  expectedStateVersion: number
  expectedPublicationVersion: number
  verification:
    | {
        status: 'verified'
        verifiedHeadSha: string
        verifiedAt: string
        outcomeCode: 'branch_verified'
      }
    | {
        status: 'conflict'
        verifiedHeadSha: string | null
        verifiedAt: string
        outcomeCode: 'branch_conflict'
      }
    | {
        status: 'failed' | 'recovery_required'
        verifiedHeadSha: string | null
        verifiedAt: string | null
        outcomeCode: 'branch_verification_failed'
      }
}

export type GitHubBranchPublicationReportResult =
  | {
      ok: true
      responseStatus: 201
      outcomeCode: 'publication_reported'
      replayed: boolean
      request: GitHubDeliveryRequest
      grant: GitHubCredentialGrant
      publication: GitHubBranchPublication
    }
  | GitHubDeliveryRejectionResult

export type GitHubBranchPublicationFinalizationResult =
  | {
      ok: true
      responseStatus: 200
      outcomeCode: 'publication_verified' | 'publication_failed'
      replayed: boolean
      request: GitHubDeliveryRequest
      publication: GitHubBranchPublication
    }
  | GitHubDeliveryRejectionResult

export type GitHubPullRequestOutcome = {
  id: string
  version: number
  requestId: string
  intentRevision: number
  publicationId: string
  status: 'creating' | 'completed' | 'recovery_required' | 'failed'
  pullRequestId: string | null
  pullRequestNumber: number | null
  safeUrl: string | null
  draft: true
  headBranch: string
  baseBranch: string
  headSha: string
  providerCreatedAt: string | null
  recordedAt: string
  outcomeCode: 'draft_pr_created' | 'pull_request_failed' | null
  redacted: true
}

export type ReserveGitHubDraftPullRequestInput = {
  projectId: string
  requestId: string
  publicationId: string
  expectedStateVersion: number
}

export type FinalizeGitHubDraftPullRequestInput = {
  projectId: string
  requestId: string
  pullRequestOutcomeId: string
  expectedStateVersion: number
  expectedPullRequestVersion: number
  outcome:
    | {
        status: 'completed'
        pullRequestId: string
        pullRequestNumber: number
        safeUrl: string
        draft: true
        repository: string
        baseBranch: string
        headBranch: string
        headSha: string
        providerCreatedAt: string
        outcomeCode: 'draft_pr_created'
      }
    | {
        status: 'failed' | 'recovery_required'
        outcomeCode: 'pull_request_failed'
      }
}

export type GitHubPullRequestMutationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode:
        | 'pull_request_reserved'
        | 'pull_request_completed'
        | 'pull_request_failed'
      replayed: boolean
      request: GitHubDeliveryRequest
      pullRequest: GitHubPullRequestOutcome
    }
  | GitHubDeliveryRejectionResult

export type GitHubDeliveryRecoverySnapshot = {
  request: GitHubDeliveryRequest
  approval: GitHubDeliveryApproval | null
  grant: GitHubCredentialGrant | null
  publication: GitHubBranchPublication | null
  pullRequest: GitHubPullRequestOutcome | null
}

export type GitHubDeliveryRejectionCode =
  | 'authentication_forbidden'
  | 'project_forbidden'
  | 'role_forbidden'
  | 'not_found'
  | 'stale_version'
  | 'binding_inactive'
  | 'credential_revocation_pending'
  | 'binding_conflict'
  | 'invalid_state'
  | 'intent_conflict'
  | 'approval_required'
  | 'approval_conflict'
  | 'grant_conflict'
  | 'publication_conflict'
  | 'pull_request_conflict'
  | 'expired'

export type GitHubDeliveryRejectionResult = {
  ok: false
  responseStatus: 403 | 404 | 409 | 410
  outcomeCode: GitHubDeliveryRejectionCode
  replayed: boolean
}

export type GitHubRepositoryBindingMutationResult =
  | {
      ok: true
      responseStatus: 200 | 201
      outcomeCode: 'binding_created' | 'binding_updated' | 'binding_revoked'
      replayed: boolean
      binding: GitHubRepositoryBinding
    }
  | GitHubDeliveryRejectionResult

export type GitHubDeliveryRepository = {
  getGitHubRepositoryBinding(
    projectId: string,
    principal: GitHubDeliveryReadPrincipal,
  ): Promise<GitHubRepositoryBinding | null>
  upsertGitHubRepositoryBinding(
    input: UpsertGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult>
  revokeGitHubRepositoryBinding(
    input: RevokeGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult>
  createOrReviseGitHubDeliveryRequest(
    input: CreateOrReviseGitHubDeliveryRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequestMutationResult>
  listGitHubDeliveryInbox(
    projectId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequest[]>
  getGitHubDeliveryRecoverySnapshot(
    projectId: string,
    requestId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRecoverySnapshot | null>
  listGitHubDeliveryRequests(
    projectId: string,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryRequest[]>
  decideGitHubDeliveryRequest(
    input: DecideGitHubDeliveryRequestInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryDecisionResult>
  reserveGitHubCredentialGrant(
    input: ReserveGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantReservationResult>
  finalizeGitHubCredentialGrant(
    input: FinalizeGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantMutationResult>
  confirmGitHubCredentialClearance(
    input: ConfirmGitHubCredentialClearanceInput,
    authority: GitHubCredentialClearanceAuthority,
  ): Promise<GitHubCredentialClearanceConfirmationResult>
  confirmGitHubCredentialProviderExpiry(
    input: ConfirmGitHubCredentialProviderExpiryInput,
    authority: GitHubCredentialClearanceAuthority,
  ): Promise<GitHubCredentialProviderExpiryConfirmationResult>
  recordGitHubBranchPublicationReport(
    input: RecordGitHubBranchPublicationReportInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationReportResult>
  finalizeGitHubBranchPublication(
    input: FinalizeGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationFinalizationResult>
  reserveGitHubDraftPullRequest(
    input: ReserveGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult>
  finalizeGitHubDraftPullRequest(
    input: FinalizeGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult>
}

export type GitHubDeliveryProjectRole = Role | null

export function githubDeliveryRejection(
  outcomeCode: GitHubDeliveryRejectionCode,
): GitHubDeliveryRejectionResult {
  const responseStatus: Record<
    GitHubDeliveryRejectionCode,
    403 | 404 | 409 | 410
  > = {
    authentication_forbidden: 403,
    project_forbidden: 403,
    role_forbidden: 403,
    not_found: 404,
    stale_version: 409,
    binding_inactive: 409,
    credential_revocation_pending: 409,
    binding_conflict: 409,
    invalid_state: 409,
    intent_conflict: 409,
    approval_required: 409,
    approval_conflict: 409,
    grant_conflict: 409,
    publication_conflict: 409,
    pull_request_conflict: 409,
    expired: 410,
  }
  return {
    ok: false,
    responseStatus: responseStatus[outcomeCode],
    outcomeCode,
    replayed: false,
  }
}

export function githubDeliveryRejectionMessage(
  outcomeCode: GitHubDeliveryRejectionCode,
): string {
  switch (outcomeCode) {
    case 'authentication_forbidden':
      return 'This authentication method cannot perform that GitHub Delivery operation.'
    case 'project_forbidden':
      return 'Project access required.'
    case 'role_forbidden':
      return 'Lead or owner authority is required.'
    case 'not_found':
      return 'GitHub Delivery record not found.'
    case 'stale_version':
      return 'GitHub Delivery state changed; refresh before retrying.'
    case 'binding_inactive':
      return 'The Project GitHub repository binding is not active.'
    case 'credential_revocation_pending':
      return 'GitHub credential revocation remains conservatively quarantined.'
    case 'binding_conflict':
      return 'The GitHub repository binding conflicts with current Project state.'
    case 'invalid_state':
      return 'The GitHub Delivery request is invalid.'
    case 'intent_conflict':
      return 'The logical Delivery Intent conflicts with durable publication state.'
    case 'approval_required':
      return 'A current lead or owner approval is required.'
    case 'approval_conflict':
      return 'The Delivery approval conflicts with current intent state.'
    case 'grant_conflict':
      return 'The credential grant conflicts with current delivery state.'
    case 'publication_conflict':
      return 'The published branch does not match the approved commit.'
    case 'pull_request_conflict':
      return 'The Draft pull request does not match the approved delivery.'
    case 'expired':
      return 'The GitHub Delivery request expired.'
  }
}

export function cloneGitHubRepositoryBinding(
  binding: GitHubRepositoryBinding,
): GitHubRepositoryBinding {
  const {
    stateVersion,
    id,
    version,
    organizationId,
    teamProjectId,
    installationId,
    repositoryId,
    repository,
    defaultBranch,
    status,
    validatedAt,
    updatedAt,
    redacted,
  } = binding
  return {
    stateVersion,
    id,
    version,
    organizationId,
    teamProjectId,
    installationId,
    repositoryId,
    repository,
    defaultBranch,
    status,
    validatedAt,
    updatedAt,
    redacted,
  }
}

export function cloneGitHubDeliveryRequest(
  request: GitHubDeliveryRequest,
): GitHubDeliveryRequest {
  const {
    id,
    stateVersion,
    intentRevision,
    organizationId,
    projectId,
    requestedByUserId,
    localIntentId,
    localProjectId,
    runId,
    runVersion,
    nodeId,
    repositoryBindingId,
    repositoryBindingVersion,
    installationId,
    repositoryId,
    repository,
    codingRunId,
    workspaceId,
    deliverySeriesKey,
    deliveryAttempt,
    diffArtifactId,
    testEvidenceId,
    prPackageArtifactId,
    status,
    outcomeCode,
    expectedRunVersion,
    baseBranch,
    headBranch,
    baseCommitSha,
    expectedCommitSha,
    intentDigest,
    logicalIdempotencyKey,
    diffDigest,
    testEvidenceDigest,
    packageDigest,
    changedPaths,
    prTitle,
    prBody,
    expiresAt,
    createdAt,
    updatedAt,
    redacted,
  } = request
  return {
    id,
    stateVersion,
    intentRevision,
    organizationId,
    projectId,
    requestedByUserId,
    localIntentId,
    localProjectId,
    runId,
    runVersion,
    nodeId,
    repositoryBindingId,
    repositoryBindingVersion,
    installationId,
    repositoryId,
    repository,
    codingRunId,
    workspaceId,
    deliverySeriesKey,
    deliveryAttempt,
    diffArtifactId,
    testEvidenceId,
    prPackageArtifactId,
    status,
    outcomeCode,
    expectedRunVersion,
    baseBranch,
    headBranch,
    baseCommitSha,
    expectedCommitSha,
    intentDigest,
    logicalIdempotencyKey,
    diffDigest,
    testEvidenceDigest,
    packageDigest,
    changedPaths: [...changedPaths],
    prTitle,
    prBody,
    expiresAt,
    createdAt,
    updatedAt,
    redacted,
  }
}

export function cloneGitHubDeliveryApproval(
  approval: GitHubDeliveryApproval,
): GitHubDeliveryApproval {
  const {
    id,
    requestId,
    intentRevision,
    requestStateVersion,
    intentDigest,
    repositoryBindingId,
    repositoryBindingVersion,
    runId,
    runVersion,
    nodeId,
    repositoryId,
    baseBranch,
    headBranch,
    expectedCommitSha,
    testEvidenceDigest,
    packageDigest,
    approvedByUserId,
    approvedRole,
    authenticationKind,
    approvedAt,
    redacted,
  } = approval
  return {
    id,
    requestId,
    intentRevision,
    requestStateVersion,
    intentDigest,
    repositoryBindingId,
    repositoryBindingVersion,
    runId,
    runVersion,
    nodeId,
    repositoryId,
    baseBranch,
    headBranch,
    expectedCommitSha,
    testEvidenceDigest,
    packageDigest,
    approvedByUserId,
    approvedRole,
    authenticationKind,
    approvedAt,
    redacted,
  }
}

export function cloneGitHubCredentialGrant(
  grant: GitHubCredentialGrant,
): GitHubCredentialGrant {
  const {
    id,
    version,
    requestId,
    intentRevision,
    approvalId,
    attempt,
    repositoryId,
    permission,
    repositoryCount,
    status,
    requestedAt,
    issuedAt,
    credentialExpiresAt,
    providerExpiryContractVersion,
    providerCredentialExpiresAt,
    providerExpiryObservedAt,
    consumedAt,
    outcomeCode,
    redacted,
  } = grant
  return {
    id,
    version,
    requestId,
    intentRevision,
    approvalId,
    attempt,
    repositoryId,
    permission,
    repositoryCount,
    status,
    requestedAt,
    issuedAt,
    credentialExpiresAt,
    providerExpiryContractVersion,
    providerCredentialExpiresAt,
    providerExpiryObservedAt,
    consumedAt,
    outcomeCode,
    redacted,
  }
}

export function cloneGitHubBranchPublication(
  publication: GitHubBranchPublication,
): GitHubBranchPublication {
  const {
    id,
    version,
    requestId,
    intentRevision,
    grantId,
    status,
    reportedOutcomeCode,
    verifiedHeadSha,
    reportedAt,
    verifiedAt,
    outcomeCode,
    redacted,
  } = publication
  return {
    id,
    version,
    requestId,
    intentRevision,
    grantId,
    status,
    reportedOutcomeCode,
    verifiedHeadSha,
    reportedAt,
    verifiedAt,
    outcomeCode,
    redacted,
  }
}

export function cloneGitHubPullRequestOutcome(
  pullRequest: GitHubPullRequestOutcome,
): GitHubPullRequestOutcome {
  const {
    id,
    version,
    requestId,
    intentRevision,
    publicationId,
    status,
    pullRequestId,
    pullRequestNumber,
    safeUrl,
    draft,
    headBranch,
    baseBranch,
    headSha,
    providerCreatedAt,
    recordedAt,
    outcomeCode,
    redacted,
  } = pullRequest
  return {
    id,
    version,
    requestId,
    intentRevision,
    publicationId,
    status,
    pullRequestId,
    pullRequestNumber,
    safeUrl,
    draft,
    headBranch,
    baseBranch,
    headSha,
    providerCreatedAt,
    recordedAt,
    outcomeCode,
    redacted,
  }
}

export function fingerprintGitHubDeliveryRequest(
  input: Pick<
    CreateOrReviseGitHubDeliveryRequestInput,
    'intent' | 'prTitle' | 'prBody'
  >,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'github_delivery_request',
        input.intent.intentDigest,
        input.intent.idempotencyKey,
        input.prTitle,
        input.prBody,
      ]),
      'utf8',
    )
    .digest('hex')
}
