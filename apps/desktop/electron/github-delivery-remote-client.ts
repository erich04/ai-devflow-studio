import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  isGitHubCredentialToken,
  normalizeGitHubRepository,
  type GitHubDeliveryIntent,
  type GitHubDeliveryStatus,
  type GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import {
  GitHubGitPublisherError,
  type GitHubGitPublisherErrorCode,
} from './github-git-publisher.js'

type Fetcher = typeof fetch

export type GitHubDeliveryRemoteOperation =
  | 'repository_binding'
  | 'submit'
  | 'inbox'
  | 'recovery_snapshot'
  | 'credential_grant'
  | 'branch_publication'
  | 'draft_pull_request'

export type GitHubDeliveryRemoteErrorCode =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'rate_limited'
  | 'service_unavailable'
  | 'remote_error'
  | 'remote_unavailable'
  | 'request_timeout'
  | 'request_cancelled'
  | 'invalid_response'
  | 'response_too_large'
  | 'credential_unexpectedly_issued'
  | 'publisher_failed'
  | GitHubGitPublisherErrorCode

export type GitHubDeliveryRejectionOutcome =
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
  | 'publication_evidence_missing'
  | 'publication_conflict'
  | 'pull_request_conflict'
  | 'expired'

const safeErrorMessages: Record<GitHubDeliveryRemoteErrorCode, string> = {
  invalid_configuration: 'GitHub Delivery remote client configuration is invalid.',
  invalid_request: 'GitHub Delivery remote request is invalid.',
  bad_request: 'The GitHub Delivery API rejected the request.',
  unauthorized: 'Desktop pairing authority is required for GitHub Delivery.',
  forbidden: 'The paired Desktop is not authorized for this GitHub Delivery.',
  not_found: 'The GitHub Delivery record was not found.',
  conflict: 'GitHub Delivery state changed and requires reconciliation.',
  gone: 'The GitHub Delivery authority has expired.',
  rate_limited: 'The GitHub Delivery API is temporarily rate limited.',
  service_unavailable: 'The GitHub Delivery API is temporarily unavailable.',
  remote_error: 'The GitHub Delivery API request failed.',
  remote_unavailable: 'The GitHub Delivery API could not be reached.',
  request_timeout: 'The GitHub Delivery API request timed out.',
  request_cancelled: 'The GitHub Delivery API request was cancelled.',
  invalid_response: 'The GitHub Delivery API returned an invalid response.',
  response_too_large: 'The GitHub Delivery API response exceeded the safe limit.',
  credential_unexpectedly_issued:
    'GitHub credential revocation could not be verified safely.',
  publisher_failed: 'The exact GitHub commit could not be published.',
  invalid_delivery_source: 'The approved GitHub delivery source is invalid.',
  operation_cancelled: 'GitHub delivery publication was cancelled safely.',
  publisher_cleanup_failed: 'GitHub delivery credential cleanup failed safely.',
  remote_branch_diverged: 'The remote delivery branch points to a different commit.',
  repository_mismatch: 'The local Git remote does not match the approved repository.',
  push_result_unknown: 'The exact Git push result requires reconciliation.',
  workspace_dirty: 'The managed workspace changed after delivery approval.',
  workspace_mismatch: 'The managed workspace HEAD does not match the approved commit.',
}

const retryablePublisherErrors = new Set<GitHubGitPublisherErrorCode>([
  'operation_cancelled',
  'publisher_cleanup_failed',
  'remote_branch_diverged',
  'remote_unavailable',
  'push_result_unknown',
])

export class GitHubDeliveryRemoteError extends Error {
  readonly status: number | null
  readonly code: GitHubDeliveryRemoteErrorCode
  readonly operation: GitHubDeliveryRemoteOperation
  readonly retryable: boolean
  readonly outcomeCode: GitHubDeliveryRejectionOutcome | null
  readonly operatorOutcomeCode: GitHubGitPublisherErrorCode | null

  constructor(input: {
    status: number | null
    code: GitHubDeliveryRemoteErrorCode
    operation: GitHubDeliveryRemoteOperation
    retryable: boolean
    outcomeCode?: GitHubDeliveryRejectionOutcome | null
    operatorOutcomeCode?: GitHubGitPublisherErrorCode | null
  }) {
    super(safeErrorMessages[input.code])
    this.name = 'GitHubDeliveryRemoteError'
    this.status = input.status
    this.code = input.code
    this.operation = input.operation
    this.retryable = input.retryable
    this.outcomeCode = input.outcomeCode ?? null
    this.operatorOutcomeCode = input.operatorOutcomeCode ?? null
  }

  toJSON(): {
    name: 'GitHubDeliveryRemoteError'
    status: number | null
    code: GitHubDeliveryRemoteErrorCode
    operation: GitHubDeliveryRemoteOperation
    retryable: boolean
    outcomeCode: GitHubDeliveryRejectionOutcome | null
    operatorOutcomeCode: GitHubGitPublisherErrorCode | null
  } {
    return {
      name: 'GitHubDeliveryRemoteError',
      status: this.status,
      code: this.code,
      operation: this.operation,
      retryable: this.retryable,
      outcomeCode: this.outcomeCode,
      operatorOutcomeCode: this.operatorOutcomeCode,
    }
  }
}

export type GitHubDeliveryRequestRecord = {
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
  diffArtifactId: string
  testEvidenceId: string
  prPackageArtifactId: string
  status: GitHubDeliveryStatus
  outcomeCode:
    | 'approval_rejected'
    | 'binding_revoked'
    | 'credential_issue_failed'
    | 'credential_expired'
    | 'branch_conflict'
    | 'branch_verification_failed'
    | 'draft_pr_created'
    | 'pull_request_failed'
    | null
  expectedRunVersion: number
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  intentDigest: string
  deliverySeriesKey: string
  deliveryAttempt: number
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

export type SubmitGitHubDeliveryInput = {
  projectId: string
  intent: GitHubDeliveryIntent
  prTitle: string
  prBody: string
  expectedStateVersion: number
}

export type SubmitGitHubDeliveryResult = {
  request: GitHubDeliveryRequestRecord
  outcomeCode: 'delivery_created' | 'delivery_revised'
  replayed: boolean
}

export type GitHubDeliveryApprovalRecord = {
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

export type GitHubCredentialGrantRecord = {
  id: string
  version: number
  requestId: string
  intentRevision: number
  approvalId: string
  attempt: number
  repositoryId: string
  permission: 'contents:write'
  repositoryCount: 1
  status:
    | 'issuing'
    | 'issued'
    | 'consumed'
    | 'failed'
    | 'recovery_required'
    | 'expired'
    | 'revoked'
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
    | 'credential_revocation_confirmed'
    | 'credential_mint_absent_confirmed'
    | 'credential_provider_expiry_confirmed'
    | null
  redacted: true
}

export type EphemeralGitHubDeliveryCredential = {
  grantId: string
  username: 'x-access-token'
  token: string
  expiresAt: string
  repositoryId: string
  canonicalHttpsUrl: string
  repository: string
  headBranch: string
  expectedCommitSha: string
}

export type ExactGitHubDeliveryPublisherResult = {
  outcome: 'pushed' | 'already_present'
  expectedCommitSha: string
  repository: string
  headBranch: string
}

export type ExactGitHubDeliveryPublisher = (
  credential: Readonly<EphemeralGitHubDeliveryCredential>,
) => Promise<ExactGitHubDeliveryPublisherResult>

export type GitHubCredentialGrantInput = {
  projectId: string
  requestId: string
  expectedStateVersion: number
}

export type VerifyGitHubCredentialGrantBlockedResult = {
  status: 'blocked'
  outcomeCode: 'binding_inactive'
} | {
  status: 'pending'
  outcomeCode: 'credential_revocation_pending'
}

export type GitHubCredentialPublishResult = {
  request: GitHubDeliveryRequestRecord
  grant: GitHubCredentialGrantRecord
  outcomeCode: 'grant_finalized'
  replayed: boolean
  publisherResult: ExactGitHubDeliveryPublisherResult
}

export type GitHubBranchPublicationRecord = {
  id: string
  version: number
  requestId: string
  intentRevision: number
  grantId: string | null
  sourcePublicationId: string | null
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

export type ReportGitHubBranchPublicationInput = {
  projectId: string
  requestId: string
  grantId: string
  expectedStateVersion: number
  expectedGrantVersion: number
  reportedOutcomeCode: 'pushed' | 'already_present' | 'unknown'
}

export type ReportGitHubBranchPublicationResult = {
  request: GitHubDeliveryRequestRecord
  publication: GitHubBranchPublicationRecord
  outcomeCode: 'publication_verified' | 'publication_failed'
  replayed: boolean
}

export type AdoptVerifiedGitHubBranchPublicationInput = {
  projectId: string
  requestId: string
  expectedStateVersion: number
}

export type AdoptVerifiedGitHubBranchPublicationResult = {
  request: GitHubDeliveryRequestRecord
  publication: GitHubBranchPublicationRecord
  outcomeCode: 'publication_adopted'
  replayed: boolean
}

export type GitHubPullRequestOutcomeRecord = {
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
  providerRetryNotBefore: string | null
  recordedAt: string
  outcomeCode: 'draft_pr_created' | 'pull_request_failed' | null
  redacted: true
}

export type CreateGitHubDraftPullRequestInput = {
  projectId: string
  requestId: string
  publicationId: string
  expectedStateVersion: number
}

export type CreateGitHubDraftPullRequestResult = {
  request: GitHubDeliveryRequestRecord
  pullRequest: GitHubPullRequestOutcomeRecord
  outcomeCode: 'pull_request_completed' | 'pull_request_failed'
  replayed: boolean
}

export type GetGitHubDeliveryRecoverySnapshotInput = {
  projectId: string
  requestId: string
}

export type GitHubDeliveryRecoverySnapshot = {
  request: GitHubDeliveryRequestRecord
  approval: GitHubDeliveryApprovalRecord | null
  grant: GitHubCredentialGrantRecord | null
  publication: GitHubBranchPublicationRecord | null
  pullRequest: GitHubPullRequestOutcomeRecord | null
}

export type GitHubDeliveryRemoteClientOptions = {
  apiBaseUrl?: string
  authToken: string
  fetcher?: Fetcher
  timeoutMs?: number
  signal?: AbortSignal
}

const requestKeys = [
  'id',
  'stateVersion',
  'intentRevision',
  'organizationId',
  'projectId',
  'requestedByUserId',
  'localIntentId',
  'localProjectId',
  'runId',
  'runVersion',
  'nodeId',
  'repositoryBindingId',
  'repositoryBindingVersion',
  'installationId',
  'repositoryId',
  'repository',
  'codingRunId',
  'workspaceId',
  'diffArtifactId',
  'testEvidenceId',
  'prPackageArtifactId',
  'status',
  'outcomeCode',
  'expectedRunVersion',
  'baseBranch',
  'headBranch',
  'baseCommitSha',
  'expectedCommitSha',
  'intentDigest',
  'deliverySeriesKey',
  'deliveryAttempt',
  'logicalIdempotencyKey',
  'diffDigest',
  'testEvidenceDigest',
  'packageDigest',
  'changedPaths',
  'prTitle',
  'prBody',
  'expiresAt',
  'createdAt',
  'updatedAt',
  'redacted',
] as const

const repositoryBindingKeys = [
  'stateVersion',
  'id',
  'version',
  'organizationId',
  'teamProjectId',
  'installationId',
  'repositoryId',
  'repository',
  'defaultBranch',
  'status',
  'validatedAt',
  'updatedAt',
  'redacted',
] as const

const deliveryIntentKeys = [
  'stateVersion',
  'id',
  'organizationId',
  'teamProjectId',
  'localProjectId',
  'runId',
  'runVersion',
  'nodeId',
  'repositoryBindingId',
  'repositoryBindingVersion',
  'installationId',
  'repositoryId',
  'codingRunId',
  'codingRunCompletedAt',
  'workspaceId',
  'deliverySeriesKey',
  'deliveryAttempt',
  'repository',
  'baseBranch',
  'headBranch',
  'baseCommitSha',
  'expectedCommitSha',
  'diffArtifactId',
  'diffSourceDigest',
  'testEvidenceId',
  'testEvidenceCreatedAt',
  'testEvidenceDigest',
  'prPackageArtifactId',
  'prPackageUpdatedAt',
  'prPackageDigest',
  'changedPaths',
  'intentDigest',
  'idempotencyKey',
  'status',
  'createdAt',
  'updatedAt',
  'redacted',
] as const

const intentIdentifierKeys = [
  'id',
  'organizationId',
  'teamProjectId',
  'localProjectId',
  'runId',
  'nodeId',
  'repositoryBindingId',
  'codingRunId',
  'workspaceId',
  'diffArtifactId',
  'testEvidenceId',
  'prPackageArtifactId',
] as const

const intentDateKeys = [
  'codingRunCompletedAt',
  'testEvidenceCreatedAt',
  'prPackageUpdatedAt',
  'createdAt',
  'updatedAt',
] as const

const requestIdentifierKeys = [
  'id',
  'organizationId',
  'projectId',
  'requestedByUserId',
  'localIntentId',
  'localProjectId',
  'runId',
  'nodeId',
  'repositoryBindingId',
  'codingRunId',
  'workspaceId',
  'diffArtifactId',
  'testEvidenceId',
  'prPackageArtifactId',
] as const

const grantKeys = [
  'id',
  'version',
  'requestId',
  'intentRevision',
  'approvalId',
  'attempt',
  'repositoryId',
  'permission',
  'repositoryCount',
  'status',
  'requestedAt',
  'issuedAt',
  'credentialExpiresAt',
  'providerExpiryContractVersion',
  'providerCredentialExpiresAt',
  'providerExpiryObservedAt',
  'consumedAt',
  'outcomeCode',
  'redacted',
] as const
const approvalKeys = [
  'id',
  'requestId',
  'intentRevision',
  'requestStateVersion',
  'intentDigest',
  'repositoryBindingId',
  'repositoryBindingVersion',
  'runId',
  'runVersion',
  'nodeId',
  'repositoryId',
  'baseBranch',
  'headBranch',
  'expectedCommitSha',
  'testEvidenceDigest',
  'packageDigest',
  'approvedByUserId',
  'approvedRole',
  'authenticationKind',
  'approvedAt',
  'redacted',
] as const
const publicationKeys = [
  'id',
  'version',
  'requestId',
  'intentRevision',
  'grantId',
  'sourcePublicationId',
  'status',
  'reportedOutcomeCode',
  'verifiedHeadSha',
  'reportedAt',
  'verifiedAt',
  'outcomeCode',
  'redacted',
] as const
const pullRequestKeys = [
  'id',
  'version',
  'requestId',
  'intentRevision',
  'publicationId',
  'status',
  'pullRequestId',
  'pullRequestNumber',
  'safeUrl',
  'draft',
  'headBranch',
  'baseBranch',
  'headSha',
  'providerCreatedAt',
  'providerRetryNotBefore',
  'recordedAt',
  'outcomeCode',
  'redacted',
] as const

const deliveryStatuses = new Set<GitHubDeliveryStatus>([
  'approval_required',
  'approved',
  'publishing_branch',
  'branch_published',
  'creating_pr',
  'completed',
  'failed',
  'recovery_required',
  'revoked',
])
const deliveryOutcomeCodes = new Set([
  'approval_rejected',
  'binding_revoked',
  'credential_issue_failed',
  'credential_expired',
  'branch_conflict',
  'branch_verification_failed',
  'draft_pr_created',
  'pull_request_failed',
])
const credentialGrantStatuses = new Set([
  'issuing',
  'issued',
  'consumed',
  'failed',
  'recovery_required',
  'expired',
  'revoked',
])
const credentialGrantOutcomeCodes = new Set([
  'credential_issue_failed',
  'credential_expired',
  'credential_superseded',
  'binding_revoked',
  'credential_revocation_confirmed',
  'credential_mint_absent_confirmed',
  'credential_provider_expiry_confirmed',
])
const branchPublicationStatuses = new Set([
  'verifying',
  'verified',
  'conflict',
  'recovery_required',
  'failed',
])
const reportedPublicationOutcomes = new Set([
  'pushed',
  'already_present',
  'unknown',
])
const branchPublicationOutcomeCodes = new Set([
  'branch_verified',
  'branch_conflict',
  'branch_verification_failed',
])
const pullRequestStatuses = new Set([
  'creating',
  'completed',
  'recovery_required',
  'failed',
])
const identifierPattern = /^[^\u0000-\u001f\u007f]{1,200}$/u
const numericGitHubIdPattern = /^[1-9][0-9]{0,19}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u
const maximumResponseBytes = 1024 * 1024
const defaultTimeoutMs = 15_000
const maximumTimeoutMs = 30_000
const providerRetryAfterMaxMs = 24 * 60 * 60 * 1_000
const bindingInactiveRejectionMessage =
  'The Project GitHub repository binding is not active.'
const credentialRevocationPendingMessage =
  'GitHub credential revocation remains conservatively quarantined.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    identifierPattern.test(value) &&
    value.trim() === value
  )
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function isSafeChangedPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    value.trim() === value &&
    !value.startsWith('/') &&
    !value.startsWith('~') &&
    !value.includes('\\') &&
    value
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

function isCanonicalRepository(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return normalizeGitHubRepository(value) === value
  } catch {
    return false
  }
}

function isSafeBranch(
  value: unknown,
  requireDeliveryNamespace = false,
): value is string {
  if (typeof value !== 'string') return false
  try {
    return (
      assertSafeGitHubBranch(value, { requireDeliveryNamespace }) === value
    )
  } catch {
    return false
  }
}

function isFullSha(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return assertFullGitCommitSha(value, 'GitHub commit') === value
  } catch {
    return false
  }
}

function parseRepositoryBinding(value: unknown): GitHubRepositoryBinding | null {
  if (!isRecord(value) || !hasExactKeys(value, repositoryBindingKeys)) {
    return null
  }
  if (
    value.stateVersion !== 1 ||
    !isIdentifier(value.id) ||
    !isPositiveInteger(value.version) ||
    !isIdentifier(value.organizationId) ||
    !isIdentifier(value.teamProjectId) ||
    typeof value.installationId !== 'string' ||
    !numericGitHubIdPattern.test(value.installationId) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    !isCanonicalRepository(value.repository) ||
    !isSafeBranch(value.defaultBranch) ||
    (value.status !== 'active' &&
      value.status !== 'stale' &&
      value.status !== 'revoked') ||
    !isCanonicalDate(value.validatedAt) ||
    !isCanonicalDate(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.validatedAt) ||
    value.redacted !== true
  ) {
    return null
  }
  return {
    stateVersion: 1,
    id: value.id,
    version: value.version,
    organizationId: value.organizationId,
    teamProjectId: value.teamProjectId,
    installationId: value.installationId,
    repositoryId: value.repositoryId,
    repository: value.repository,
    defaultBranch: value.defaultBranch,
    status: value.status,
    validatedAt: value.validatedAt,
    updatedAt: value.updatedAt,
    redacted: true,
  }
}

function parseRequest(value: unknown): GitHubDeliveryRequestRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, requestKeys)) return null
  const changedPaths = Array.isArray(value.changedPaths)
    ? value.changedPaths
    : null
  if (
    !requestIdentifierKeys.every((key) => isIdentifier(value[key])) ||
    !isPositiveInteger(value.stateVersion) ||
    !isPositiveInteger(value.intentRevision) ||
    !isPositiveInteger(value.runVersion) ||
    !isPositiveInteger(value.expectedRunVersion) ||
    !isPositiveInteger(value.repositoryBindingVersion) ||
    typeof value.installationId !== 'string' ||
    !numericGitHubIdPattern.test(value.installationId) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    !isCanonicalRepository(value.repository) ||
    typeof value.status !== 'string' ||
    !deliveryStatuses.has(value.status as GitHubDeliveryStatus) ||
    (value.outcomeCode !== null &&
      (typeof value.outcomeCode !== 'string' ||
        !deliveryOutcomeCodes.has(value.outcomeCode))) ||
    !isSafeBranch(value.baseBranch) ||
    !isSafeBranch(value.headBranch, true) ||
    !isFullSha(value.baseCommitSha) ||
    !isFullSha(value.expectedCommitSha) ||
    value.baseCommitSha === value.expectedCommitSha ||
    typeof value.intentDigest !== 'string' ||
    !sha256Pattern.test(value.intentDigest) ||
    typeof value.deliverySeriesKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.deliverySeriesKey) ||
    !isPositiveInteger(value.deliveryAttempt) ||
    typeof value.logicalIdempotencyKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.logicalIdempotencyKey) ||
    typeof value.diffDigest !== 'string' ||
    !sha256Pattern.test(value.diffDigest) ||
    typeof value.testEvidenceDigest !== 'string' ||
    !sha256Pattern.test(value.testEvidenceDigest) ||
    typeof value.packageDigest !== 'string' ||
    !sha256Pattern.test(value.packageDigest) ||
    changedPaths === null ||
    changedPaths.length === 0 ||
    changedPaths.length > 200 ||
    !changedPaths.every(isSafeChangedPath) ||
    new Set(changedPaths).size !== changedPaths.length ||
    [...changedPaths]
      .sort((left, right) => left.localeCompare(right))
      .some((path, index) => path !== changedPaths[index]) ||
    typeof value.prTitle !== 'string' ||
    value.prTitle.length === 0 ||
    value.prTitle.length > 256 ||
    value.prTitle.trim() !== value.prTitle ||
    typeof value.prBody !== 'string' ||
    value.prBody.length > 65_536 ||
    value.prBody.includes('\u0000') ||
    !isCanonicalDate(value.expiresAt) ||
    !isCanonicalDate(value.createdAt) ||
    !isCanonicalDate(value.updatedAt) ||
    value.redacted !== true
  ) {
    return null
  }
  return {
    ...(value as GitHubDeliveryRequestRecord),
    changedPaths: [...changedPaths],
  }
}

function parseSubmitIntent(value: unknown): GitHubDeliveryIntent | null {
  if (!isRecord(value) || !hasExactKeys(value, deliveryIntentKeys)) return null
  const changedPaths = Array.isArray(value.changedPaths)
    ? value.changedPaths
    : null
  if (
    value.stateVersion !== 1 ||
    value.redacted !== true ||
    value.status !== 'approval_required' ||
    !intentIdentifierKeys.every((key) => isIdentifier(value[key])) ||
    !intentDateKeys.every((key) => isCanonicalDate(value[key])) ||
    !isPositiveInteger(value.runVersion) ||
    !isPositiveInteger(value.repositoryBindingVersion) ||
    !isPositiveInteger(value.deliveryAttempt) ||
    typeof value.installationId !== 'string' ||
    !numericGitHubIdPattern.test(value.installationId) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    !isCanonicalRepository(value.repository) ||
    !isSafeBranch(value.baseBranch) ||
    !isSafeBranch(value.headBranch, true) ||
    !isFullSha(value.baseCommitSha) ||
    !isFullSha(value.expectedCommitSha) ||
    value.baseCommitSha === value.expectedCommitSha ||
    typeof value.diffSourceDigest !== 'string' ||
    !sha256Pattern.test(value.diffSourceDigest) ||
    typeof value.testEvidenceDigest !== 'string' ||
    !sha256Pattern.test(value.testEvidenceDigest) ||
    typeof value.prPackageDigest !== 'string' ||
    !sha256Pattern.test(value.prPackageDigest) ||
    typeof value.intentDigest !== 'string' ||
    !sha256Pattern.test(value.intentDigest) ||
    typeof value.deliverySeriesKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.deliverySeriesKey) ||
    typeof value.idempotencyKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.idempotencyKey) ||
    changedPaths === null ||
    changedPaths.length === 0 ||
    changedPaths.length > 200 ||
    !changedPaths.every(isSafeChangedPath) ||
    new Set(changedPaths).size !== changedPaths.length ||
    [...changedPaths]
      .sort((left, right) => left.localeCompare(right))
      .some((path, index) => path !== changedPaths[index])
  ) {
    return null
  }
  return {
    ...(value as unknown as GitHubDeliveryIntent),
    changedPaths: [...changedPaths],
  }
}

function parseCredentialGrant(value: unknown): GitHubCredentialGrantRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, grantKeys)) return null
  const providerCredentialExpiresAt = value.providerCredentialExpiresAt
  const providerExpiryObservedAt = value.providerExpiryObservedAt
  const credentialExpiresAt = value.credentialExpiresAt
  const issuedAt = value.issuedAt
  const providerContractIsValid =
    value.providerExpiryContractVersion === 0
      ? providerCredentialExpiresAt === null &&
        providerExpiryObservedAt === null &&
        value.outcomeCode !== 'credential_provider_expiry_confirmed'
      : value.providerExpiryContractVersion === 1 &&
        isCanonicalDate(issuedAt) &&
        isCanonicalDate(credentialExpiresAt) &&
        isCanonicalDate(providerCredentialExpiresAt) &&
        Date.parse(credentialExpiresAt) <= Date.parse(providerCredentialExpiresAt) &&
        (providerExpiryObservedAt === null
          ? value.outcomeCode !== 'credential_provider_expiry_confirmed'
          : isCanonicalDate(providerExpiryObservedAt) &&
            value.status === 'expired' &&
            value.outcomeCode === 'credential_provider_expiry_confirmed' &&
            Date.parse(providerExpiryObservedAt) >=
              Date.parse(providerCredentialExpiresAt) + 2_000)
  if (
    !isIdentifier(value.id) ||
    !isIdentifier(value.requestId) ||
    !isIdentifier(value.approvalId) ||
    !isPositiveInteger(value.version) ||
    !isPositiveInteger(value.intentRevision) ||
    !isPositiveInteger(value.attempt) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    value.permission !== 'contents:write' ||
    value.repositoryCount !== 1 ||
    typeof value.status !== 'string' ||
    !credentialGrantStatuses.has(value.status) ||
    !isCanonicalDate(value.requestedAt) ||
    (issuedAt !== null && !isCanonicalDate(issuedAt)) ||
    (credentialExpiresAt !== null && !isCanonicalDate(credentialExpiresAt)) ||
    !providerContractIsValid ||
    (value.consumedAt !== null && !isCanonicalDate(value.consumedAt)) ||
    (value.outcomeCode !== null &&
      (typeof value.outcomeCode !== 'string' ||
        !credentialGrantOutcomeCodes.has(value.outcomeCode))) ||
    value.redacted !== true
  ) {
    return null
  }
  return value as GitHubCredentialGrantRecord
}

function parseApproval(value: unknown): GitHubDeliveryApprovalRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, approvalKeys)) return null
  if (
    !isIdentifier(value.id) ||
    !isIdentifier(value.requestId) ||
    !isIdentifier(value.repositoryBindingId) ||
    !isIdentifier(value.runId) ||
    !isIdentifier(value.nodeId) ||
    !isIdentifier(value.approvedByUserId) ||
    !isPositiveInteger(value.intentRevision) ||
    !isPositiveInteger(value.requestStateVersion) ||
    !isPositiveInteger(value.repositoryBindingVersion) ||
    !isPositiveInteger(value.runVersion) ||
    typeof value.intentDigest !== 'string' ||
    !sha256Pattern.test(value.intentDigest) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    !isSafeBranch(value.baseBranch) ||
    !isSafeBranch(value.headBranch, true) ||
    !isFullSha(value.expectedCommitSha) ||
    typeof value.testEvidenceDigest !== 'string' ||
    !sha256Pattern.test(value.testEvidenceDigest) ||
    typeof value.packageDigest !== 'string' ||
    !sha256Pattern.test(value.packageDigest) ||
    (value.approvedRole !== 'lead' && value.approvedRole !== 'owner') ||
    value.authenticationKind !== 'session_cookie' ||
    !isCanonicalDate(value.approvedAt) ||
    value.redacted !== true
  ) {
    return null
  }
  return value as GitHubDeliveryApprovalRecord
}

function parseCredential(value: unknown): Omit<EphemeralGitHubDeliveryCredential, 'repository' | 'headBranch' | 'expectedCommitSha'> | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'grantId',
      'username',
      'token',
      'expiresAt',
      'repositoryId',
      'canonicalHttpsUrl',
    ]) ||
    !isIdentifier(value.grantId) ||
    value.username !== 'x-access-token' ||
    typeof value.token !== 'string' ||
    !isGitHubCredentialToken(value.token) ||
    !isCanonicalDate(value.expiresAt) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    typeof value.canonicalHttpsUrl !== 'string'
  ) {
    return null
  }
  return value as Omit<
    EphemeralGitHubDeliveryCredential,
    'repository' | 'headBranch' | 'expectedCommitSha'
  >
}

function parseBranchPublication(
  value: unknown,
): GitHubBranchPublicationRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, publicationKeys)) return null
  if (
    !isIdentifier(value.id) ||
    !isIdentifier(value.requestId) ||
    !(
      (isIdentifier(value.grantId) && value.sourcePublicationId === null) ||
      (value.grantId === null && isIdentifier(value.sourcePublicationId))
    ) ||
    !isPositiveInteger(value.version) ||
    !isPositiveInteger(value.intentRevision) ||
    typeof value.status !== 'string' ||
    !branchPublicationStatuses.has(value.status) ||
    typeof value.reportedOutcomeCode !== 'string' ||
    !reportedPublicationOutcomes.has(value.reportedOutcomeCode) ||
    (value.verifiedHeadSha !== null && !isFullSha(value.verifiedHeadSha)) ||
    !isCanonicalDate(value.reportedAt) ||
    (value.verifiedAt !== null && !isCanonicalDate(value.verifiedAt)) ||
    (value.outcomeCode !== null &&
      (typeof value.outcomeCode !== 'string' ||
        !branchPublicationOutcomeCodes.has(value.outcomeCode))) ||
    value.redacted !== true
  ) {
    return null
  }
  return value as GitHubBranchPublicationRecord
}

function parsePullRequestOutcome(
  value: unknown,
): GitHubPullRequestOutcomeRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, pullRequestKeys)) return null
  if (
    !isIdentifier(value.id) ||
    !isIdentifier(value.requestId) ||
    !isIdentifier(value.publicationId) ||
    !isPositiveInteger(value.version) ||
    !isPositiveInteger(value.intentRevision) ||
    typeof value.status !== 'string' ||
    !pullRequestStatuses.has(value.status) ||
    (value.pullRequestId !== null &&
      (typeof value.pullRequestId !== 'string' ||
        !numericGitHubIdPattern.test(value.pullRequestId))) ||
    (value.pullRequestNumber !== null &&
      !isPositiveInteger(value.pullRequestNumber)) ||
    (value.safeUrl !== null && typeof value.safeUrl !== 'string') ||
    value.draft !== true ||
    !isSafeBranch(value.headBranch, true) ||
    !isSafeBranch(value.baseBranch) ||
    !isFullSha(value.headSha) ||
    (value.providerCreatedAt !== null &&
      !isCanonicalDate(value.providerCreatedAt)) ||
    (value.providerRetryNotBefore !== null &&
      !isCanonicalDate(value.providerRetryNotBefore)) ||
    !isCanonicalDate(value.recordedAt) ||
    (value.outcomeCode !== null &&
      value.outcomeCode !== 'draft_pr_created' &&
      value.outcomeCode !== 'pull_request_failed') ||
    value.redacted !== true
  ) {
    return null
  }
  if (value.providerRetryNotBefore !== null) {
    const recordedAt = Date.parse(value.recordedAt)
    const retryNotBefore = Date.parse(value.providerRetryNotBefore)
    if (
      value.status !== 'recovery_required' ||
      value.outcomeCode !== 'pull_request_failed' ||
      retryNotBefore <= recordedAt ||
      retryNotBefore > recordedAt + providerRetryAfterMaxMs
    ) {
      return null
    }
  }
  return value as GitHubPullRequestOutcomeRecord
}

function matchesPullRequestUrl(
  safeUrl: string,
  repository: string,
  pullRequestNumber: number,
): boolean {
  let url: URL
  try {
    url = new URL(safeUrl)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.hostname.toLowerCase() === 'github.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname.toLowerCase() ===
      `/${repository}/pull/${pullRequestNumber}`.toLowerCase()
  )
}

function parseRecoverySnapshot(
  value: unknown,
  input: GetGitHubDeliveryRecoverySnapshotInput,
  status: number,
): GitHubDeliveryRecoverySnapshot {
  const operation = 'recovery_snapshot'
  if (
    status !== 200 ||
    !isRecord(value) ||
    !hasExactKeys(value, ['snapshot']) ||
    !isRecord(value.snapshot) ||
    !hasExactKeys(value.snapshot, [
      'request',
      'approval',
      'grant',
      'publication',
      'pullRequest',
    ])
  ) {
    throw invalid(operation, 'invalid_response', status, true)
  }
  const snapshot = value.snapshot
  const request = parseRequest(snapshot.request)
  const approval = snapshot.approval === null ? null : parseApproval(snapshot.approval)
  const grant =
    snapshot.grant === null ? null : parseCredentialGrant(snapshot.grant)
  const publication =
    snapshot.publication === null
      ? null
      : parseBranchPublication(snapshot.publication)
  const pullRequest =
    snapshot.pullRequest === null
      ? null
      : parsePullRequestOutcome(snapshot.pullRequest)
  const publicationReferencesRecoverablePriorGrant = Boolean(
    publication !== null &&
      grant !== null &&
      publication.grantId !== grant.id &&
      request?.status === 'publishing_branch' &&
      grant.status === 'issued' &&
      (publication.status === 'recovery_required' || publication.status === 'conflict') &&
      pullRequest === null,
  )
  if (
    !request ||
    (snapshot.approval !== null && !approval) ||
    (snapshot.grant !== null && !grant) ||
    (snapshot.publication !== null && !publication) ||
    (snapshot.pullRequest !== null && !pullRequest) ||
    request.id !== input.requestId ||
    request.projectId !== input.projectId ||
    (approval !== null &&
      (approval.requestId !== request.id ||
        approval.intentRevision !== request.intentRevision ||
        approval.requestStateVersion > request.stateVersion ||
        approval.intentDigest !== request.intentDigest ||
        approval.repositoryBindingId !== request.repositoryBindingId ||
        approval.repositoryBindingVersion !== request.repositoryBindingVersion ||
        approval.runId !== request.runId ||
        approval.runVersion !== request.runVersion ||
        approval.nodeId !== request.nodeId ||
        approval.repositoryId !== request.repositoryId ||
        approval.baseBranch !== request.baseBranch ||
        approval.headBranch !== request.headBranch ||
        approval.expectedCommitSha !== request.expectedCommitSha ||
        approval.testEvidenceDigest !== request.testEvidenceDigest ||
        approval.packageDigest !== request.packageDigest)) ||
    (grant !== null &&
      (approval === null ||
        grant.requestId !== request.id ||
        grant.intentRevision !== request.intentRevision ||
        grant.approvalId !== approval.id ||
        grant.repositoryId !== request.repositoryId)) ||
    (publication !== null &&
      (grant === null ||
        publication.requestId !== request.id ||
        publication.intentRevision !== request.intentRevision ||
        (publication.grantId !== grant.id &&
          !publicationReferencesRecoverablePriorGrant) ||
        (publication.status === 'verified' &&
          publication.verifiedHeadSha !== request.expectedCommitSha))) ||
    (pullRequest !== null &&
      (publication === null ||
        pullRequest.requestId !== request.id ||
        pullRequest.intentRevision !== request.intentRevision ||
        pullRequest.publicationId !== publication.id ||
        pullRequest.headBranch !== request.headBranch ||
        pullRequest.baseBranch !== request.baseBranch ||
        pullRequest.headSha !== request.expectedCommitSha ||
        (pullRequest.status === 'completed' &&
          (pullRequest.pullRequestId === null ||
            pullRequest.pullRequestNumber === null ||
            pullRequest.safeUrl === null ||
            pullRequest.providerCreatedAt === null ||
            pullRequest.outcomeCode !== 'draft_pr_created' ||
            !matchesPullRequestUrl(
              pullRequest.safeUrl,
              request.repository,
              pullRequest.pullRequestNumber,
            )))))
  ) {
    throw invalid(operation, 'invalid_response', status, true)
  }
  return { request, approval, grant, publication, pullRequest }
}

function invalid(
  operation: GitHubDeliveryRemoteOperation,
  code: GitHubDeliveryRemoteErrorCode,
  status: number | null,
  retryable: boolean,
  outcomeCode: GitHubDeliveryRejectionOutcome | null = null,
  operatorOutcomeCode: GitHubGitPublisherErrorCode | null = null,
): GitHubDeliveryRemoteError {
  return new GitHubDeliveryRemoteError({
    status,
    code,
    operation,
    retryable,
    outcomeCode,
    operatorOutcomeCode,
  })
}

async function readBoundedJson(
  response: Response,
  operation: GitHubDeliveryRemoteOperation,
  signal?: AbortSignal,
): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    (/^[0-9]+$/u.test(contentLength) === false ||
      Number(contentLength) > maximumResponseBytes)
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw invalid(operation, 'response_too_large', response.status, true)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw invalid(operation, 'invalid_response', response.status, true)
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let byteCount = 0
  let text = ''
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteCount += chunk.value.byteLength
      if (byteCount > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw invalid(operation, 'response_too_large', response.status, true)
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    if (signal?.aborted) throw new Error('github_delivery_request_aborted')
  } catch (error) {
    if (error instanceof GitHubDeliveryRemoteError) throw error
    throw invalid(operation, 'invalid_response', response.status, true)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalid(operation, 'invalid_response', response.status, true)
  }
}

const rejectionOutcomes = new Set<GitHubDeliveryRejectionOutcome>([
  'authentication_forbidden',
  'project_forbidden',
  'role_forbidden',
  'not_found',
  'stale_version',
  'binding_inactive',
  'credential_revocation_pending',
  'binding_conflict',
  'invalid_state',
  'intent_conflict',
  'approval_required',
  'approval_conflict',
  'grant_conflict',
  'publication_evidence_missing',
  'publication_conflict',
  'pull_request_conflict',
  'expired',
])

const serviceFailureStatuses = {
  github_credential_revocation_unconfirmed: 502,
  github_authentication_failed: 502,
  github_conflict: 409,
  github_forbidden: 502,
  github_invalid_request: 400,
  github_malformed_response: 502,
  github_not_found: 404,
  github_pull_request_conflict: 409,
  github_rate_limited: 503,
  github_repository_mismatch: 409,
  github_request_rejected: 502,
  github_response_too_large: 502,
  github_scope_mismatch: 409,
  github_timeout: 503,
  github_unauthorized: 502,
  github_unavailable: 503,
  github_validation_failed: 400,
  github_delivery_content_blocked: 409,
  github_delivery_state_conflict: 409,
  github_delivery_unavailable: 503,
} as const

const serviceFailurePhases = new Set([
  'binding',
  'credential',
  'publication',
  'pull_request',
])

const servicePhaseByOperation: Partial<
  Record<GitHubDeliveryRemoteOperation, string>
> = {
  credential_grant: 'credential',
  branch_publication: 'publication',
  draft_pull_request: 'pull_request',
}

function routeErrorForStatus(status: number): string | null {
  switch (status) {
    case 400:
      return 'bad_request'
    case 404:
      return 'not_found'
    case 409:
      return 'conflict'
    case 502:
      return 'bad_gateway'
    case 503:
      return 'service_unavailable'
    default:
      return null
  }
}

function parseServiceFailureRetryable(
  body: unknown,
  status: number,
  operation: GitHubDeliveryRemoteOperation,
): boolean | null {
  if (
    !isRecord(body) ||
    !hasExactKeys(body, ['error', 'message', 'code', 'retryable', 'phase']) ||
    typeof body.error !== 'string' ||
    typeof body.message !== 'string' ||
    typeof body.code !== 'string' ||
    typeof body.retryable !== 'boolean' ||
    typeof body.phase !== 'string' ||
    !serviceFailurePhases.has(body.phase) ||
    !Object.prototype.hasOwnProperty.call(serviceFailureStatuses, body.code)
  ) {
    return null
  }
  const code = body.code as keyof typeof serviceFailureStatuses
  if (
    serviceFailureStatuses[code] !== status ||
    routeErrorForStatus(status) !== body.error ||
    servicePhaseByOperation[operation] !== body.phase
  ) {
    return null
  }
  return body.retryable
}

function classifyHttpStatus(status: number): GitHubDeliveryRemoteErrorCode {
  if (status >= 500) return 'service_unavailable'
  switch (status) {
    case 400:
      return 'bad_request'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 408:
      return 'request_timeout'
    case 409:
      return 'conflict'
    case 410:
      return 'gone'
    case 429:
      return 'rate_limited'
    default:
      return 'remote_error'
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function throwHttpError(
  response: Response,
  operation: GitHubDeliveryRemoteOperation,
  signal?: AbortSignal,
): Promise<never> {
  let outcomeCode: GitHubDeliveryRejectionOutcome | null = null
  let serviceRetryable: boolean | null = null
  try {
    const body = await readBoundedJson(response, operation, signal)
    if (
      isRecord(body) &&
      hasExactKeys(body, ['error', 'message', 'outcomeCode', 'replayed']) &&
      typeof body.error === 'string' &&
      typeof body.message === 'string' &&
      typeof body.outcomeCode === 'string' &&
      rejectionOutcomes.has(body.outcomeCode as GitHubDeliveryRejectionOutcome) &&
      typeof body.replayed === 'boolean'
    ) {
      outcomeCode = body.outcomeCode as GitHubDeliveryRejectionOutcome
    } else {
      serviceRetryable = parseServiceFailureRetryable(
        body,
        response.status,
        operation,
      )
    }
  } catch (error) {
    if (signal?.aborted) throw new Error('github_delivery_request_aborted')
    if (
      error instanceof GitHubDeliveryRemoteError &&
      error.code === 'response_too_large'
    ) {
      throw error
    }
    // Malformed error bodies are untrusted and never copied into the safe error.
  }
  throw invalid(
    operation,
    classifyHttpStatus(response.status),
    response.status,
    serviceRetryable ?? isRetryableHttpStatus(response.status),
    outcomeCode,
  )
}

async function requestRemoteJson(input: {
  fetcher: Fetcher
  url: string
  init: RequestInit
  operation: GitHubDeliveryRemoteOperation
  timeoutMs: number
  signal: AbortSignal | undefined
}): Promise<{ response: Response; body: unknown }> {
  if (input.signal?.aborted) {
    throw invalid(input.operation, 'request_cancelled', null, false)
  }
  const controller = new AbortController()
  let timedOut = false
  let callerCancelled = false
  const onCallerAbort = () => {
    callerCancelled = true
    controller.abort()
  }
  input.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs)
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('github_delivery_request_aborted')),
      { once: true },
    )
  })
  try {
    const requested = (async () => {
      const response = await input.fetcher(input.url, {
        ...input.init,
        signal: controller.signal,
      })
      if (!response.ok) {
        await throwHttpError(response, input.operation, controller.signal)
      }
      const body = await readBoundedJson(
        response,
        input.operation,
        controller.signal,
      )
      return { response, body }
    })()
    return await Promise.race([requested, aborted])
  } catch (error) {
    if (error instanceof GitHubDeliveryRemoteError) throw error
    if (timedOut) {
      throw invalid(input.operation, 'request_timeout', null, true)
    }
    if (callerCancelled || input.signal?.aborted) {
      throw invalid(input.operation, 'request_cancelled', null, false)
    }
    throw invalid(input.operation, 'remote_unavailable', null, true)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onCallerAbort)
  }
}

function parseSubmitResult(
  value: unknown,
  input: SubmitGitHubDeliveryInput,
  status: number,
): SubmitGitHubDeliveryResult {
  const operation = 'submit'
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['request', 'outcomeCode', 'replayed']) ||
    (value.outcomeCode !== 'delivery_created' &&
      value.outcomeCode !== 'delivery_revised') ||
    typeof value.replayed !== 'boolean'
  ) {
    throw invalid(operation, 'invalid_response', status, true)
  }
  const request = parseRequest(value.request)
  if (
    !request ||
    request.projectId !== input.projectId ||
    request.localIntentId !== input.intent.id ||
    request.intentDigest !== input.intent.intentDigest ||
    request.deliverySeriesKey !== input.intent.deliverySeriesKey ||
    request.deliveryAttempt !== input.intent.deliveryAttempt ||
    request.logicalIdempotencyKey !== input.intent.idempotencyKey ||
    request.status !== 'approval_required' ||
    request.prTitle !== input.prTitle ||
    request.prBody !== input.prBody ||
    (value.outcomeCode === 'delivery_created' && status !== 201) ||
    (value.outcomeCode === 'delivery_revised' && status !== 200)
  ) {
    throw invalid(operation, 'invalid_response', status, true)
  }
  return {
    request,
    outcomeCode: value.outcomeCode,
    replayed: value.replayed,
  }
}

function normalizeBaseUrl(value: string | undefined): string {
  let url: URL
  try {
    url = new URL(value ?? 'http://127.0.0.1:4310')
  } catch {
    throw invalid('submit', 'invalid_configuration', null, false)
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' &&
      url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '::1')
  ) {
    throw invalid('submit', 'invalid_configuration', null, false)
  }
  return url.toString().replace(/\/$/u, '')
}

function normalizeAuthToken(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 8_192 ||
    value.trim() !== value ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalid('submit', 'invalid_configuration', null, false)
  }
  return value
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? defaultTimeoutMs
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > maximumTimeoutMs
  ) {
    throw invalid('submit', 'invalid_configuration', null, false)
  }
  return timeoutMs
}

function requireSubmitInput(input: SubmitGitHubDeliveryInput): GitHubDeliveryIntent {
  const intent = parseSubmitIntent(input?.intent)
  if (
    !isIdentifier(input?.projectId) ||
    !intent ||
    intent.teamProjectId !== input.projectId ||
    typeof input.prTitle !== 'string' ||
    input.prTitle.length === 0 ||
    input.prTitle.length > 256 ||
    input.prTitle.trim() !== input.prTitle ||
    typeof input.prBody !== 'string' ||
    input.prBody.length > 65_536 ||
    input.prBody.includes('\u0000') ||
    !Number.isSafeInteger(input.expectedStateVersion) ||
    input.expectedStateVersion < 0
  ) {
    throw invalid('submit', 'invalid_request', null, false)
  }
  return intent
}

export function createGitHubDeliveryRemoteClient(
  options: GitHubDeliveryRemoteClientOptions,
) {
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl)
  const authToken = normalizeAuthToken(options.authToken)
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const fetcher = options.fetcher ?? fetch

  return {
    async getRepositoryBinding(
      projectId: string,
    ): Promise<GitHubRepositoryBinding | null> {
      const operation = 'repository_binding'
      if (!isIdentifier(projectId)) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(projectId)}/github-repository-binding`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
          },
        },
      })
      if (
        response.status !== 200 ||
        !isRecord(body) ||
        !hasExactKeys(body, ['binding'])
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      if (body.binding === null) return null
      const binding = parseRepositoryBinding(body.binding)
      if (!binding || binding.teamProjectId !== projectId) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      return binding
    },

    async submit(
      input: SubmitGitHubDeliveryInput,
    ): Promise<SubmitGitHubDeliveryResult> {
      const intent = requireSubmitInput(input)
      const operation = 'submit'
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intent,
            prTitle: input.prTitle,
            prBody: input.prBody,
            expectedStateVersion: input.expectedStateVersion,
          }),
        },
      })
      return parseSubmitResult(body, input, response.status)
    },

    async listInbox(projectId: string): Promise<GitHubDeliveryRequestRecord[]> {
      const operation = 'inbox'
      if (!isIdentifier(projectId)) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(projectId)}/github-deliveries/inbox`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
          },
        },
      })
      if (
        !isRecord(body) ||
        !hasExactKeys(body, ['requests']) ||
        !Array.isArray(body.requests)
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      const requests = body.requests.map(parseRequest)
      if (
        requests.some((request) => request === null) ||
        requests.some((request) => request?.projectId !== projectId)
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      return requests as GitHubDeliveryRequestRecord[]
    },

    async getRecoverySnapshot(
      input: GetGitHubDeliveryRecoverySnapshotInput,
    ): Promise<GitHubDeliveryRecoverySnapshot> {
      const operation = 'recovery_snapshot'
      if (!isIdentifier(input?.projectId) || !isIdentifier(input?.requestId)) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
          },
        },
      })
      return parseRecoverySnapshot(body, input, response.status)
    },

    async verifyCredentialGrantBlocked(
      input: GitHubCredentialGrantInput,
    ): Promise<VerifyGitHubCredentialGrantBlockedResult> {
      const operation = 'credential_grant'
      if (
        !isIdentifier(input?.projectId) ||
        !isIdentifier(input?.requestId) ||
        !isPositiveInteger(input?.expectedStateVersion)
      ) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      if (options.signal?.aborted) {
        throw invalid(operation, 'request_cancelled', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}/credential-grant`
      const controller = new AbortController()
      let timedOut = false
      let callerCancelled = false
      const onCallerAbort = () => {
        callerCancelled = true
        controller.abort()
      }
      options.signal?.addEventListener('abort', onCallerAbort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('github_delivery_request_aborted')),
          { once: true },
        )
      })
      try {
        const requested = (async () => {
          const response = await fetcher(`${apiBaseUrl}${pathname}`, {
            method: 'POST',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${authToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              expectedStateVersion: input.expectedStateVersion,
            }),
            signal: controller.signal,
          })
          if (response.status >= 200 && response.status < 300) {
            void response.body?.cancel().catch(() => undefined)
            throw invalid(
              operation,
              'credential_unexpectedly_issued',
              response.status,
              false,
            )
          }
          if (response.status !== 409) {
            await throwHttpError(response, operation, controller.signal)
          }
          const body = await readBoundedJson(
            response,
            operation,
            controller.signal,
          )
          if (
            !isRecord(body) ||
            !hasExactKeys(body, [
              'error',
              'message',
              'outcomeCode',
              'replayed',
            ]) ||
            body.error !== 'conflict' ||
            body.replayed !== false
          ) {
            throw invalid(operation, 'invalid_response', response.status, false)
          }
          if (
            body.message === credentialRevocationPendingMessage &&
            body.outcomeCode === 'credential_revocation_pending'
          ) {
            return {
              status: 'pending' as const,
              outcomeCode: 'credential_revocation_pending' as const,
            }
          }
          if (
            body.message !== bindingInactiveRejectionMessage ||
            body.outcomeCode !== 'binding_inactive'
          ) {
            throw invalid(operation, 'invalid_response', response.status, false)
          }
          return {
            status: 'blocked' as const,
            outcomeCode: 'binding_inactive' as const,
          }
        })()
        return await Promise.race([requested, aborted])
      } catch (error) {
        if (error instanceof GitHubDeliveryRemoteError) throw error
        if (timedOut) {
          throw invalid(operation, 'request_timeout', null, true)
        }
        if (callerCancelled || options.signal?.aborted) {
          throw invalid(operation, 'request_cancelled', null, false)
        }
        throw invalid(operation, 'remote_unavailable', null, true)
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onCallerAbort)
      }
    },

    async withCredentialGrant(
      input: GitHubCredentialGrantInput,
      publishExactCommit: ExactGitHubDeliveryPublisher,
    ): Promise<GitHubCredentialPublishResult> {
      const operation = 'credential_grant'
      if (
        !isIdentifier(input?.projectId) ||
        !isIdentifier(input?.requestId) ||
        !isPositiveInteger(input?.expectedStateVersion) ||
        typeof publishExactCommit !== 'function'
      ) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}/credential-grant`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expectedStateVersion: input.expectedStateVersion }),
        },
      })
      if (
        response.status !== 200 ||
        !isRecord(body) ||
        !hasExactKeys(body, [
          'request',
          'grant',
          'credential',
          'outcomeCode',
          'replayed',
        ]) ||
        body.outcomeCode !== 'grant_finalized' ||
        typeof body.replayed !== 'boolean'
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      const request = parseRequest(body.request)
      const grant = parseCredentialGrant(body.grant)
      const credential = parseCredential(body.credential)
      const expectedUrl = request
        ? `https://github.com/${request.repository}.git`
        : null
      if (
        !request ||
        !grant ||
        !credential ||
        request.projectId !== input.projectId ||
        request.id !== input.requestId ||
        request.status !== 'publishing_branch' ||
        grant.id !== credential.grantId ||
        grant.requestId !== input.requestId ||
        grant.intentRevision !== request.intentRevision ||
        grant.repositoryId !== request.repositoryId ||
        grant.repositoryId !== credential.repositoryId ||
        grant.status !== 'issued' ||
        grant.issuedAt === null ||
        grant.credentialExpiresAt !== credential.expiresAt ||
        grant.outcomeCode !== null ||
        credential.canonicalHttpsUrl !== expectedUrl
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      let publisherResult: ExactGitHubDeliveryPublisherResult
      try {
        publisherResult = await publishExactCommit({
          ...credential,
          repository: request.repository,
          headBranch: request.headBranch,
          expectedCommitSha: request.expectedCommitSha,
        })
      } catch (error) {
        if (error instanceof GitHubGitPublisherError) {
          throw invalid(
            operation,
            error.code,
            null,
            retryablePublisherErrors.has(error.code),
            null,
            error.code,
          )
        }
        throw invalid(operation, 'publisher_failed', null, false)
      }
      if (
        !isRecord(publisherResult) ||
        !hasExactKeys(publisherResult, [
          'outcome',
          'expectedCommitSha',
          'repository',
          'headBranch',
        ]) ||
        (publisherResult.outcome !== 'pushed' &&
          publisherResult.outcome !== 'already_present') ||
        publisherResult.expectedCommitSha !== request.expectedCommitSha ||
        publisherResult.repository !== request.repository ||
        publisherResult.headBranch !== request.headBranch
      ) {
        throw invalid(operation, 'publisher_failed', null, false)
      }
      const safePublisherResult: ExactGitHubDeliveryPublisherResult = {
        outcome: publisherResult.outcome,
        expectedCommitSha: publisherResult.expectedCommitSha,
        repository: publisherResult.repository,
        headBranch: publisherResult.headBranch,
      }
      return {
        request,
        grant,
        outcomeCode: 'grant_finalized',
        replayed: body.replayed,
        publisherResult: safePublisherResult,
      }
    },

    async reportBranchPublication(
      input: ReportGitHubBranchPublicationInput,
    ): Promise<ReportGitHubBranchPublicationResult> {
      const operation = 'branch_publication'
      if (
        !isIdentifier(input?.projectId) ||
        !isIdentifier(input?.requestId) ||
        !isIdentifier(input?.grantId) ||
        !isPositiveInteger(input?.expectedStateVersion) ||
        !isPositiveInteger(input?.expectedGrantVersion) ||
        !reportedPublicationOutcomes.has(input?.reportedOutcomeCode)
      ) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}/branch-publication`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            grantId: input.grantId,
            expectedStateVersion: input.expectedStateVersion,
            expectedGrantVersion: input.expectedGrantVersion,
            reportedOutcomeCode: input.reportedOutcomeCode,
          }),
        },
      })
      if (
        response.status !== 200 ||
        !isRecord(body) ||
        !hasExactKeys(body, [
          'request',
          'publication',
          'outcomeCode',
          'replayed',
        ]) ||
        (body.outcomeCode !== 'publication_verified' &&
          body.outcomeCode !== 'publication_failed') ||
        typeof body.replayed !== 'boolean'
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      const request = parseRequest(body.request)
      const publication = parseBranchPublication(body.publication)
      if (
        !request ||
        !publication ||
        request.projectId !== input.projectId ||
        request.id !== input.requestId ||
        publication.requestId !== input.requestId ||
        publication.intentRevision !== request.intentRevision ||
        publication.grantId !== input.grantId ||
        publication.reportedOutcomeCode !== input.reportedOutcomeCode ||
        (body.outcomeCode === 'publication_verified' &&
          (request.status !== 'branch_published' ||
            publication.status !== 'verified' ||
            publication.verifiedHeadSha !== request.expectedCommitSha ||
            publication.verifiedAt === null ||
            publication.outcomeCode !== 'branch_verified')) ||
        (body.outcomeCode === 'publication_failed' &&
          publication.status === 'verified')
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      return {
        request,
        publication,
        outcomeCode: body.outcomeCode,
        replayed: body.replayed,
      }
    },

    async adoptVerifiedBranchPublication(
      input: AdoptVerifiedGitHubBranchPublicationInput,
    ): Promise<AdoptVerifiedGitHubBranchPublicationResult> {
      const operation = 'branch_publication'
      if (
        !isIdentifier(input?.projectId) ||
        !isIdentifier(input?.requestId) ||
        !isPositiveInteger(input?.expectedStateVersion)
      ) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}/branch-publication/recover`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            expectedStateVersion: input.expectedStateVersion,
          }),
        },
      })
      if (
        response.status !== 201 ||
        !isRecord(body) ||
        !hasExactKeys(body, [
          'request',
          'publication',
          'outcomeCode',
          'replayed',
        ]) ||
        body.outcomeCode !== 'publication_adopted' ||
        typeof body.replayed !== 'boolean'
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      const request = parseRequest(body.request)
      const publication = parseBranchPublication(body.publication)
      if (
        !request ||
        !publication ||
        request.projectId !== input.projectId ||
        request.id !== input.requestId ||
        request.status !== 'branch_published' ||
        request.outcomeCode !== null ||
        publication.requestId !== input.requestId ||
        publication.intentRevision !== request.intentRevision ||
        publication.grantId !== null ||
        publication.sourcePublicationId === null ||
        publication.status !== 'verified' ||
        publication.reportedOutcomeCode !== 'already_present' ||
        publication.verifiedHeadSha !== request.expectedCommitSha ||
        publication.verifiedAt === null ||
        publication.outcomeCode !== 'branch_verified'
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      return {
        request,
        publication,
        outcomeCode: 'publication_adopted',
        replayed: body.replayed,
      }
    },

    async createDraftPullRequest(
      input: CreateGitHubDraftPullRequestInput,
    ): Promise<CreateGitHubDraftPullRequestResult> {
      const operation = 'draft_pull_request'
      if (
        !isIdentifier(input?.projectId) ||
        !isIdentifier(input?.requestId) ||
        !isIdentifier(input?.publicationId) ||
        !isPositiveInteger(input?.expectedStateVersion)
      ) {
        throw invalid(operation, 'invalid_request', null, false)
      }
      const pathname = `/api/desktop/projects/${encodeURIComponent(input.projectId)}/github-deliveries/${encodeURIComponent(input.requestId)}/draft-pull-request`
      const { response, body } = await requestRemoteJson({
        fetcher,
        url: `${apiBaseUrl}${pathname}`,
        operation,
        timeoutMs,
        signal: options.signal,
        init: {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            publicationId: input.publicationId,
            expectedStateVersion: input.expectedStateVersion,
          }),
        },
      })
      if (
        response.status !== 200 ||
        !isRecord(body) ||
        !hasExactKeys(body, [
          'request',
          'pullRequest',
          'outcomeCode',
          'replayed',
        ]) ||
        (body.outcomeCode !== 'pull_request_completed' &&
          body.outcomeCode !== 'pull_request_failed') ||
        typeof body.replayed !== 'boolean'
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      const request = parseRequest(body.request)
      const pullRequest = parsePullRequestOutcome(body.pullRequest)
      if (
        !request ||
        !pullRequest ||
        request.projectId !== input.projectId ||
        request.id !== input.requestId ||
        pullRequest.requestId !== input.requestId ||
        pullRequest.intentRevision !== request.intentRevision ||
        pullRequest.publicationId !== input.publicationId ||
        pullRequest.headBranch !== request.headBranch ||
        pullRequest.baseBranch !== request.baseBranch ||
        pullRequest.headSha !== request.expectedCommitSha ||
        (body.outcomeCode === 'pull_request_completed' &&
          (request.status !== 'completed' ||
            request.outcomeCode !== 'draft_pr_created' ||
            pullRequest.status !== 'completed' ||
            pullRequest.outcomeCode !== 'draft_pr_created' ||
            pullRequest.pullRequestId === null ||
            pullRequest.pullRequestNumber === null ||
            pullRequest.safeUrl === null ||
            pullRequest.providerCreatedAt === null ||
            !matchesPullRequestUrl(
              pullRequest.safeUrl,
              request.repository,
              pullRequest.pullRequestNumber,
            ))) ||
        (body.outcomeCode === 'pull_request_failed' &&
          pullRequest.status === 'completed')
      ) {
        throw invalid(operation, 'invalid_response', response.status, true)
      }
      return {
        request,
        pullRequest,
        outcomeCode: body.outcomeCode,
        replayed: body.replayed,
      }
    },
  }
}
