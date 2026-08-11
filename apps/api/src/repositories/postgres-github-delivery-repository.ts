import { createHash, randomUUID } from 'node:crypto'
import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
  toTeamStoredNodeId,
  type GitHubDeliveryIntent,
  type GitHubDeliveryStatus,
  type GitHubRepositoryBinding,
  type Role,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import {
  withTeamDbTransaction,
  type TeamDbTransactionClient,
} from '../db/transaction'
import {
  fingerprintGitHubDeliveryRequest,
  GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
  githubDeliveryRejection,
  normalizeGitHubDeliveryRequestIntent,
  type CreateOrReviseGitHubDeliveryRequestInput,
  type DecideGitHubDeliveryRequestInput,
  type GitHubDeliveryDesktopPrincipal,
  type GitHubDeliveryApproval,
  type GitHubDeliveryRecoverySnapshot,
  type GitHubDeliveryDecisionResult,
  type FinalizeGitHubCredentialGrantInput,
  type FinalizeGitHubBranchPublicationInput,
  type GitHubBranchPublication,
  type GitHubBranchPublicationFinalizationResult,
  type GitHubBranchPublicationReportResult,
  type GitHubCredentialGrant,
  type GitHubCredentialGrantMutationResult,
  type ReserveGitHubCredentialGrantInput,
  type RecordGitHubBranchPublicationReportInput,
  type FinalizeGitHubDraftPullRequestInput,
  type GitHubPullRequestMutationResult,
  type GitHubPullRequestOutcome,
  type ReserveGitHubDraftPullRequestInput,
  type GitHubDeliveryRequest,
  type GitHubDeliveryRequestMutationResult,
  type GitHubDeliveryReadPrincipal,
  type GitHubDeliveryRepository,
  type GitHubDeliverySessionPrincipal,
  type GitHubRepositoryBindingMutationResult,
  type RevokeGitHubRepositoryBindingInput,
  type UpsertGitHubRepositoryBindingInput,
} from './github-delivery-contract'

type TimestampValue = string | Date
const MAX_CREDENTIAL_GRANT_ATTEMPTS = 3

type IdentityRow = {
  user_id: string
  organization_id: string
  organization_role: Role
  project_role: Role | null
}

type BearerIdentityRow = IdentityRow & { project_id: string }

type VerifiedIdentity = {
  organizationId: string
  projectId: string
  userId: string
  role: Role
  authKind: 'session_cookie' | 'desktop_bearer'
  tokenRecordId: string | null
  hasProjectAccess: boolean
}

type RepositoryBindingRow = {
  id: string
  version: number
  organization_id: string
  project_id: string
  installation_id: string
  repository_id: string
  full_name: string
  default_branch: string
  status: GitHubRepositoryBinding['status']
  configured_by_user_id: string
  updated_by_user_id: string
  validated_at: TimestampValue
  revoked_at: TimestampValue | null
  created_at: TimestampValue
  updated_at: TimestampValue
}

type IdempotencyRow = {
  request_fingerprint: string
  response_json: unknown
}

type StoredMutationResponse = {
  ok: boolean
  responseStatus: number
  outcomeCode: string
  recordId: string
  observedVersion: number | null
}

type DeliveryRequestRow = {
  id: string
  state_version: number
  intent_revision: number
  organization_id: string
  project_id: string
  requested_by_user_id: string
  requested_by_token_id: string
  local_intent_id: string
  local_project_id: string
  run_id: string
  run_version: number
  node_id: string
  binding_id: string
  binding_version: number
  installation_id: string
  repository_id: string
  repository_full_name: string
  coding_run_id: string
  workspace_id: string
  diff_artifact_id: string
  test_evidence_id: string
  pr_package_artifact_id: string
  status: GitHubDeliveryStatus
  outcome_code: GitHubDeliveryRequest['outcomeCode']
  expected_run_version: number
  base_branch: string
  head_branch: string
  base_commit_sha: string
  expected_commit_sha: string
  intent_digest: string
  logical_idempotency_key: string
  diff_digest: string
  test_evidence_digest: string
  package_digest: string
  changed_paths: unknown
  pr_title: string
  pr_body: string
  expires_at: TimestampValue
  created_at: TimestampValue
  updated_at: TimestampValue
}

type CanonicalDeliveryAuthorityRow = {
  run_version: number
  current_node_id: string
  node_stage: string
  node_kind: string
  node_status: string
  claim_status: string
  claimed_by_token_id: string
}

type DeliveryApprovalRow = {
  id: string
  request_id: string
  intent_revision: number
  request_state_version: number
  intent_digest: string
  binding_id: string
  binding_version: number
  run_id: string
  run_version: number
  node_id: string
  repository_id: string
  base_branch: string
  head_branch: string
  expected_commit_sha: string
  test_evidence_digest: string
  package_digest: string
  approved_by_user_id: string
  approved_role: 'lead' | 'owner'
  auth_kind: 'session_cookie'
  approved_at: TimestampValue
}

type CredentialGrantRow = {
  id: string
  version: number
  request_id: string
  intent_revision: number
  approval_id: string
  attempt: number
  issued_to_token_id: string
  repository_id: string
  permission: 'contents:write'
  repository_count: 1
  status: GitHubCredentialGrant['status']
  requested_at: TimestampValue
  issued_at: TimestampValue | null
  credential_expires_at: TimestampValue | null
  consumed_at: TimestampValue | null
  outcome_code: GitHubCredentialGrant['outcomeCode']
}

type BranchPublicationRow = {
  id: string
  version: number
  request_id: string
  intent_revision: number
  grant_id: string
  status: GitHubBranchPublication['status']
  reported_outcome_code: GitHubBranchPublication['reportedOutcomeCode']
  verified_head_sha: string | null
  reported_at: TimestampValue
  verified_at: TimestampValue | null
  outcome_code: GitHubBranchPublication['outcomeCode']
}

type PullRequestOutcomeRow = {
  id: string
  version: number
  request_id: string
  intent_revision: number
  publication_id: string
  status: GitHubPullRequestOutcome['status']
  pull_request_id: string | null
  pull_request_number: number | null
  safe_url: string | null
  draft: true
  head_branch: string
  base_branch: string
  head_sha: string
  provider_created_at: TimestampValue | null
  recorded_at: TimestampValue
  outcome_code: GitHubPullRequestOutcome['outcomeCode']
}

type GitHubDeliveryOperationKind =
  | 'github_binding_upsert'
  | 'github_binding_revoke'
  | 'github_delivery_submit'
  | 'github_delivery_revise'
  | 'github_delivery_approve'
  | 'github_delivery_reject'
  | 'github_delivery_grant'
  | 'github_branch_publication'
  | 'github_pull_request_create'

type GitHubDeliveryRecordKind =
  | 'github_binding'
  | 'github_delivery'
  | 'github_delivery_approval'
  | 'github_credential_grant'
  | 'github_branch_publication'
  | 'github_pull_request'

type MutationResultShape = {
  ok: boolean
  responseStatus: number
  outcomeCode: string
  replayed: boolean
}

type GitHubDeliveryIdKind =
  | 'binding'
  | 'delivery'
  | 'approval'
  | 'grant'
  | 'publication'
  | 'pull_request'
  | 'audit'
  | 'idempotency'

export type PostgresGitHubDeliveryRepositoryOptions = {
  now?: () => Date
  createId?: (kind: GitHubDeliveryIdKind) => string
}

const repositoryBindingColumns = `
  github_repository_bindings.id,
  github_repository_bindings.version,
  github_repository_bindings.organization_id,
  github_repository_bindings.project_id,
  github_repository_bindings.installation_id,
  github_repository_bindings.repository_id,
  github_repository_bindings.full_name,
  github_repository_bindings.default_branch,
  github_repository_bindings.status,
  github_repository_bindings.configured_by_user_id,
  github_repository_bindings.updated_by_user_id,
  github_repository_bindings.validated_at,
  github_repository_bindings.revoked_at,
  github_repository_bindings.created_at,
  github_repository_bindings.updated_at
`

const deliveryRequestColumns = `
  github_delivery_requests.id,
  github_delivery_requests.state_version,
  github_delivery_requests.intent_revision,
  github_delivery_requests.organization_id,
  github_delivery_requests.project_id,
  github_delivery_requests.requested_by_user_id,
  github_delivery_requests.requested_by_token_id,
  github_delivery_requests.local_intent_id,
  github_delivery_requests.local_project_id,
  github_delivery_requests.run_id,
  github_delivery_requests.run_version,
  github_delivery_requests.node_id,
  github_delivery_requests.binding_id,
  github_delivery_requests.binding_version,
  github_delivery_requests.installation_id,
  github_delivery_requests.repository_id,
  github_delivery_requests.repository_full_name,
  github_delivery_requests.coding_run_id,
  github_delivery_requests.workspace_id,
  github_delivery_requests.diff_artifact_id,
  github_delivery_requests.test_evidence_id,
  github_delivery_requests.pr_package_artifact_id,
  github_delivery_requests.status,
  github_delivery_requests.outcome_code,
  github_delivery_requests.expected_run_version,
  github_delivery_requests.base_branch,
  github_delivery_requests.head_branch,
  github_delivery_requests.base_commit_sha,
  github_delivery_requests.expected_commit_sha,
  github_delivery_requests.intent_digest,
  github_delivery_requests.logical_idempotency_key,
  github_delivery_requests.diff_digest,
  github_delivery_requests.test_evidence_digest,
  github_delivery_requests.package_digest,
  github_delivery_requests.changed_paths,
  github_delivery_requests.pr_title,
  github_delivery_requests.pr_body,
  github_delivery_requests.expires_at,
  github_delivery_requests.created_at,
  github_delivery_requests.updated_at
`

const deliveryApprovalColumns = `
  github_delivery_approvals.id,
  github_delivery_approvals.request_id,
  github_delivery_approvals.intent_revision,
  github_delivery_approvals.request_state_version,
  github_delivery_approvals.intent_digest,
  github_delivery_approvals.binding_id,
  github_delivery_approvals.binding_version,
  github_delivery_approvals.run_id,
  github_delivery_approvals.run_version,
  github_delivery_approvals.node_id,
  github_delivery_approvals.repository_id,
  github_delivery_approvals.base_branch,
  github_delivery_approvals.head_branch,
  github_delivery_approvals.expected_commit_sha,
  github_delivery_approvals.test_evidence_digest,
  github_delivery_approvals.package_digest,
  github_delivery_approvals.approved_by_user_id,
  github_delivery_approvals.approved_role,
  github_delivery_approvals.auth_kind,
  github_delivery_approvals.approved_at
`

const credentialGrantColumns = `
  github_delivery_credential_grants.id,
  github_delivery_credential_grants.version,
  github_delivery_credential_grants.request_id,
  github_delivery_credential_grants.intent_revision,
  github_delivery_credential_grants.approval_id,
  github_delivery_credential_grants.attempt,
  github_delivery_credential_grants.issued_to_token_id,
  github_delivery_credential_grants.repository_id,
  github_delivery_credential_grants.permission,
  github_delivery_credential_grants.repository_count,
  github_delivery_credential_grants.status,
  github_delivery_credential_grants.requested_at,
  github_delivery_credential_grants.issued_at,
  github_delivery_credential_grants.credential_expires_at,
  github_delivery_credential_grants.consumed_at,
  github_delivery_credential_grants.outcome_code
`

const branchPublicationColumns = `
  github_branch_publications.id,
  github_branch_publications.version,
  github_branch_publications.request_id,
  github_branch_publications.intent_revision,
  github_branch_publications.grant_id,
  github_branch_publications.status,
  github_branch_publications.reported_outcome_code,
  github_branch_publications.verified_head_sha,
  github_branch_publications.reported_at,
  github_branch_publications.verified_at,
  github_branch_publications.outcome_code
`

const pullRequestOutcomeColumns = `
  github_pull_request_outcomes.id,
  github_pull_request_outcomes.version,
  github_pull_request_outcomes.request_id,
  github_pull_request_outcomes.intent_revision,
  github_pull_request_outcomes.publication_id,
  github_pull_request_outcomes.status,
  github_pull_request_outcomes.pull_request_id,
  github_pull_request_outcomes.pull_request_number,
  github_pull_request_outcomes.safe_url,
  github_pull_request_outcomes.draft,
  github_pull_request_outcomes.head_branch,
  github_pull_request_outcomes.base_branch,
  github_pull_request_outcomes.head_sha,
  github_pull_request_outcomes.provider_created_at,
  github_pull_request_outcomes.recorded_at,
  github_pull_request_outcomes.outcome_code
`

function toIso(value: TimestampValue): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.valueOf())) {
    throw new Error('Invalid GitHub Delivery timestamp loaded from storage.')
  }
  return date.toISOString()
}

function mapRepositoryBindingRow(
  row: RepositoryBindingRow,
): GitHubRepositoryBinding {
  return {
    stateVersion: 1,
    id: row.id,
    version: row.version,
    organizationId: row.organization_id,
    teamProjectId: row.project_id,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    repository: row.full_name,
    defaultBranch: row.default_branch,
    status: row.status,
    validatedAt: toIso(row.validated_at),
    updatedAt: toIso(row.updated_at),
    redacted: true,
  }
}

function parseChangedPaths(value: unknown): string[] {
  const decoded = typeof value === 'string' ? JSON.parse(value) : value
  if (
    !Array.isArray(decoded) ||
    decoded.length < 1 ||
    decoded.length > 200 ||
    decoded.some((path) => typeof path !== 'string')
  ) {
    throw new Error('Invalid GitHub Delivery changed paths loaded from storage.')
  }
  return [...decoded] as string[]
}

function mapDeliveryRequestRow(row: DeliveryRequestRow): GitHubDeliveryRequest {
  return {
    id: row.id,
    stateVersion: row.state_version,
    intentRevision: row.intent_revision,
    organizationId: row.organization_id,
    projectId: row.project_id,
    requestedByUserId: row.requested_by_user_id,
    localIntentId: row.local_intent_id,
    localProjectId: row.local_project_id,
    runId: row.run_id,
    runVersion: row.run_version,
    nodeId: row.node_id,
    repositoryBindingId: row.binding_id,
    repositoryBindingVersion: row.binding_version,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    repository: row.repository_full_name,
    codingRunId: row.coding_run_id,
    workspaceId: row.workspace_id,
    diffArtifactId: row.diff_artifact_id,
    testEvidenceId: row.test_evidence_id,
    prPackageArtifactId: row.pr_package_artifact_id,
    status: row.status,
    outcomeCode: row.outcome_code,
    expectedRunVersion: row.expected_run_version,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    baseCommitSha: row.base_commit_sha,
    expectedCommitSha: row.expected_commit_sha,
    intentDigest: row.intent_digest,
    logicalIdempotencyKey: row.logical_idempotency_key,
    diffDigest: row.diff_digest,
    testEvidenceDigest: row.test_evidence_digest,
    packageDigest: row.package_digest,
    changedPaths: parseChangedPaths(row.changed_paths),
    prTitle: row.pr_title,
    prBody: row.pr_body,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    redacted: true,
  }
}

function mapDeliveryApprovalRow(row: DeliveryApprovalRow): GitHubDeliveryApproval {
  return {
    id: row.id,
    requestId: row.request_id,
    intentRevision: row.intent_revision,
    requestStateVersion: row.request_state_version,
    intentDigest: row.intent_digest,
    repositoryBindingId: row.binding_id,
    repositoryBindingVersion: row.binding_version,
    runId: row.run_id,
    runVersion: row.run_version,
    nodeId: row.node_id,
    repositoryId: row.repository_id,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    expectedCommitSha: row.expected_commit_sha,
    testEvidenceDigest: row.test_evidence_digest,
    packageDigest: row.package_digest,
    approvedByUserId: row.approved_by_user_id,
    approvedRole: row.approved_role,
    authenticationKind: row.auth_kind,
    approvedAt: toIso(row.approved_at),
    redacted: true,
  }
}

function mapCredentialGrantRow(row: CredentialGrantRow): GitHubCredentialGrant {
  return {
    id: row.id,
    version: row.version,
    requestId: row.request_id,
    intentRevision: row.intent_revision,
    approvalId: row.approval_id,
    attempt: row.attempt,
    repositoryId: row.repository_id,
    permission: row.permission,
    repositoryCount: row.repository_count,
    status: row.status,
    requestedAt: toIso(row.requested_at),
    issuedAt: row.issued_at === null ? null : toIso(row.issued_at),
    credentialExpiresAt:
      row.credential_expires_at === null
        ? null
        : toIso(row.credential_expires_at),
    consumedAt: row.consumed_at === null ? null : toIso(row.consumed_at),
    outcomeCode: row.outcome_code,
    redacted: true,
  }
}

function mapBranchPublicationRow(
  row: BranchPublicationRow,
): GitHubBranchPublication {
  return {
    id: row.id,
    version: row.version,
    requestId: row.request_id,
    intentRevision: row.intent_revision,
    grantId: row.grant_id,
    status: row.status,
    reportedOutcomeCode: row.reported_outcome_code,
    verifiedHeadSha: row.verified_head_sha,
    reportedAt: toIso(row.reported_at),
    verifiedAt: row.verified_at === null ? null : toIso(row.verified_at),
    outcomeCode: row.outcome_code,
    redacted: true,
  }
}

function mapPullRequestOutcomeRow(
  row: PullRequestOutcomeRow,
): GitHubPullRequestOutcome {
  return {
    id: row.id,
    version: row.version,
    requestId: row.request_id,
    intentRevision: row.intent_revision,
    publicationId: row.publication_id,
    status: row.status,
    pullRequestId: row.pull_request_id,
    pullRequestNumber: row.pull_request_number,
    safeUrl: row.safe_url,
    draft: true,
    headBranch: row.head_branch,
    baseBranch: row.base_branch,
    headSha: row.head_sha,
    providerCreatedAt:
      row.provider_created_at === null ? null : toIso(row.provider_created_at),
    recordedAt: toIso(row.recorded_at),
    outcomeCode: row.outcome_code,
    redacted: true,
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function unresolvedRecordId(
  kind: 'delivery' | 'grant' | 'publication' | 'pull-request',
  candidate: string,
): string {
  return `github-${kind}-unresolved-${sha256Text(candidate).slice(0, 32)}`
}

function decodeStoredMutationResponse(
  row: IdempotencyRow | null,
): StoredMutationResponse | null {
  if (!row) return null
  try {
    const value =
      typeof row.response_json === 'string'
        ? (JSON.parse(row.response_json) as unknown)
        : row.response_json
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const candidate = value as Record<string, unknown>
    if (
      typeof candidate['ok'] !== 'boolean' ||
      typeof candidate['responseStatus'] !== 'number' ||
      typeof candidate['outcomeCode'] !== 'string' ||
      typeof candidate['recordId'] !== 'string' ||
      (candidate['observedVersion'] !== null &&
        typeof candidate['observedVersion'] !== 'number')
    ) {
      return null
    }
    return {
      ok: candidate['ok'],
      responseStatus: candidate['responseStatus'],
      outcomeCode: candidate['outcomeCode'],
      recordId: candidate['recordId'],
      observedVersion: candidate['observedVersion'] as number | null,
    }
  } catch {
    return null
  }
}

export function createPostgresGitHubDeliveryRepository(
  db: TeamDbRepositoryClient,
  options: PostgresGitHubDeliveryRepositoryOptions = {},
): GitHubDeliveryRepository {
  const now = options.now ?? (() => new Date())
  const createId =
    options.createId ??
    ((kind: GitHubDeliveryIdKind) => `github-${kind}-${randomUUID()}`)

  async function lockProject(
    tx: TeamDbTransactionClient,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    await tx.query(
      `
        /* github_delivery:project-lock */
        SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
      `,
      [JSON.stringify(['github-delivery', organizationId, projectId])],
    )
  }

  async function lockRepository(
    tx: TeamDbTransactionClient,
    organizationId: string,
    repositoryId: string,
  ): Promise<void> {
    await tx.query(
      `
        /* github_delivery:repository-lock */
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            jsonb_build_array('github-delivery-repository', $1::text, $2::text)::text,
            0
          )
        )
      `,
      [
        organizationId,
        repositoryId,
      ],
    )
  }

  async function loadCookieIdentity(
    query: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
    lockAuthority = false,
  ): Promise<VerifiedIdentity | null> {
    if (
      principal.authentication.kind !== 'session_cookie' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await query.query<IdentityRow>(
      `
        /* github_delivery:cookie-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          (
            SELECT project_members.role
            FROM project_members
            WHERE project_members.project_id = projects.id
              AND project_members.user_id = users.id
            LIMIT 1
            ${lockAuthority ? 'FOR SHARE' : ''}
          ) AS project_role
        FROM auth_accounts
        JOIN users ON users.id = auth_accounts.user_id
        JOIN projects
          ON projects.id = $4
         AND projects.organization_id = users.organization_id
        WHERE auth_accounts.id = $1
          AND users.organization_id = $2
          AND users.id = $3
        LIMIT 1
        ${lockAuthority ? 'FOR SHARE OF auth_accounts, users, projects' : ''}
      `,
      [
        principal.session.authAccountId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row) return null
    const hasProjectAccess =
      row.organization_role === 'owner' || row.project_role !== null
    return {
      organizationId: row.organization_id,
      projectId,
      userId: row.user_id,
      role:
        row.organization_role === 'owner'
          ? 'owner'
          : (row.project_role ?? row.organization_role),
      authKind: 'session_cookie',
      tokenRecordId: null,
      hasProjectAccess,
    }
  }

  async function loadBearerIdentity(
    query: TeamDbTransactionClient,
    principal: RequestPrincipal,
    projectId: string,
    lockAuthority = false,
  ): Promise<VerifiedIdentity | null> {
    if (
      principal.authentication.kind !== 'desktop_bearer' ||
      principal.session.source !== 'authenticated'
    ) {
      return null
    }
    const [row] = await query.query<BearerIdentityRow>(
      `
        /* github_delivery:bearer-identity */
        SELECT
          users.id AS user_id,
          users.organization_id,
          users.role AS organization_role,
          desktop_tokens.project_id,
          (
            SELECT project_members.role
            FROM project_members
            WHERE project_members.project_id = projects.id
              AND project_members.user_id = users.id
            LIMIT 1
            ${lockAuthority ? 'FOR SHARE' : ''}
          ) AS project_role
        FROM desktop_tokens
        JOIN users
          ON users.id = desktop_tokens.user_id
         AND users.organization_id = desktop_tokens.organization_id
        JOIN projects
          ON projects.id = desktop_tokens.project_id
         AND projects.organization_id = desktop_tokens.organization_id
        WHERE desktop_tokens.id = $1
          AND desktop_tokens.organization_id = $2
          AND desktop_tokens.user_id = $3
          AND desktop_tokens.project_id = $4
          AND desktop_tokens.revoked_at IS NULL
        LIMIT 1
        ${lockAuthority ? 'FOR SHARE OF desktop_tokens, users, projects' : ''}
      `,
      [
        principal.authentication.tokenRecordId,
        principal.session.organizationId,
        principal.session.userId,
        projectId,
      ],
    )
    if (!row) return null
    const hasProjectAccess =
      row.organization_role === 'owner' || row.project_role !== null
    return {
      organizationId: row.organization_id,
      projectId: row.project_id,
      userId: row.user_id,
      role:
        row.organization_role === 'owner'
          ? 'owner'
          : (row.project_role ?? row.organization_role),
      authKind: 'desktop_bearer',
      tokenRecordId: principal.authentication.tokenRecordId,
      hasProjectAccess,
    }
  }

  async function loadReadIdentity(
    principal: GitHubDeliveryReadPrincipal,
    projectId: string,
  ): Promise<VerifiedIdentity | null> {
    return principal.authentication.kind === 'session_cookie'
      ? loadCookieIdentity(db, principal, projectId)
      : loadBearerIdentity(db, principal, projectId)
  }

  async function loadIdempotency(
    tx: TeamDbTransactionClient,
    identity: VerifiedIdentity,
    operation: GitHubDeliveryOperationKind,
    idempotencyKey: string,
  ): Promise<IdempotencyRow | null> {
    const [row] = await tx.query<IdempotencyRow>(
      `
        /* github_delivery:idempotency-read */
        SELECT request_fingerprint, response_json
        FROM collaboration_idempotency
        WHERE organization_id = $1
          AND project_id = $2
          AND actor_user_id = $3
          AND operation_kind = $4
          AND idempotency_key = $5
        LIMIT 1
      `,
      [
        identity.organizationId,
        identity.projectId,
        identity.userId,
        operation,
        idempotencyKey,
      ],
    )
    return row ?? null
  }

  async function appendAuditAndIdempotency(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      operation: GitHubDeliveryOperationKind
      recordKind: GitHubDeliveryRecordKind
      recordId: string
      expectedVersion: number | null
      observedVersion: number | null
      fingerprint: string
      idempotencyKey: string
      existingIdempotency: IdempotencyRow | null
      result: MutationResultShape
    },
  ): Promise<void> {
    if (input.existingIdempotency) return
    await tx.query(
      `
        /* github_delivery:audit-insert */
        INSERT INTO collaboration_audit_events (
          id,
          organization_id,
          project_id,
          actor_user_id,
          actor_role,
          auth_kind,
          auth_token_record_id,
          record_kind,
          record_id,
          action,
          expected_version,
          observed_version,
          outcome_code,
          request_fingerprint,
          details
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, '{}'::jsonb
        )
      `,
      [
        createId('audit'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.role,
        input.identity.authKind,
        input.identity.tokenRecordId,
        input.recordKind,
        input.recordId,
        input.operation,
        input.expectedVersion,
        input.observedVersion,
        input.result.outcomeCode,
        input.fingerprint,
      ],
    )
    const safeResponse = {
      ok: input.result.ok,
      responseStatus: input.result.responseStatus,
      outcomeCode: input.result.outcomeCode,
      recordId: input.recordId,
      observedVersion: input.observedVersion,
    }
    await tx.query(
      `
        /* github_delivery:idempotency-insert */
        INSERT INTO collaboration_idempotency (
          id,
          organization_id,
          project_id,
          actor_user_id,
          auth_kind,
          auth_token_record_id,
          operation_kind,
          idempotency_key,
          request_fingerprint,
          response_status,
          outcome_code,
          response_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        createId('idempotency'),
        input.identity.organizationId,
        input.identity.projectId,
        input.identity.userId,
        input.identity.authKind,
        input.identity.tokenRecordId,
        input.operation,
        input.idempotencyKey,
        input.fingerprint,
        input.result.responseStatus,
        input.result.outcomeCode,
        JSON.stringify(safeResponse),
      ],
    )
  }

  function operationFingerprint(
    operation: GitHubDeliveryOperationKind,
    material: unknown,
  ): { fingerprint: string; idempotencyKey: string } {
    const fingerprint = sha256([operation, material])
    return {
      fingerprint,
      idempotencyKey: `github-delivery:${fingerprint}`,
    }
  }

  async function finalizeMutation<T extends MutationResultShape>(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      operation: GitHubDeliveryOperationKind
      recordKind: GitHubDeliveryRecordKind
      recordId: string
      expectedVersion: number | null
      observedVersion: number | null
      fingerprint: string
      idempotencyKey: string
      existingIdempotency: IdempotencyRow | null
      result: T
    },
  ): Promise<T> {
    await appendAuditAndIdempotency(tx, input)
    return input.result
  }

  function invalidBindingInput(
    input: UpsertGitHubRepositoryBindingInput,
    at: string,
  ):
    | {
        repository: string
        defaultBranch: string
        verifiedAt: string
      }
    | null {
    try {
      const verifiedAt = toIso(input.verifiedAt)
      if (
        !/^[1-9][0-9]{0,19}$/u.test(input.installationId) ||
        !/^[1-9][0-9]{0,19}$/u.test(input.repositoryId) ||
        !Number.isSafeInteger(input.expectedStateVersion) ||
        input.expectedStateVersion < 0 ||
        Date.parse(verifiedAt) > Date.parse(at)
      ) {
        return null
      }
      return {
        repository: normalizeGitHubRepository(input.repository),
        defaultBranch: assertSafeGitHubBranch(input.defaultBranch),
        verifiedAt,
      }
    } catch {
      return null
    }
  }

  async function lockBinding(
    tx: TeamDbTransactionClient,
    identity: VerifiedIdentity,
  ): Promise<RepositoryBindingRow | null> {
    const [row] = await tx.query<RepositoryBindingRow>(
      `
        /* github_delivery:binding-lock */
        SELECT ${repositoryBindingColumns}
        FROM github_repository_bindings
        WHERE organization_id = $1
          AND project_id = $2
        ORDER BY version DESC
        LIMIT 1
        FOR UPDATE
      `,
      [identity.organizationId, identity.projectId],
    )
    return row ?? null
  }

  async function invalidateDeliveriesForBinding(
    tx: TeamDbTransactionClient,
    identity: VerifiedIdentity,
    bindingId: string,
    at: string,
  ): Promise<void> {
    await tx.query(
      `
        /* github_delivery:delivery-grants-revoke */
        UPDATE github_delivery_credential_grants AS grants
        SET version = grants.version + 1,
            status = 'revoked',
            outcome_code = 'binding_revoked'
        FROM github_delivery_requests AS requests
        WHERE requests.id = grants.request_id
          AND requests.intent_revision = grants.intent_revision
          AND requests.organization_id = $1
          AND requests.project_id = $2
          AND requests.binding_id = $3
          AND grants.status IN ('issuing', 'issued', 'recovery_required')
      `,
      [identity.organizationId, identity.projectId, bindingId],
    )
    await tx.query(
      `
        /* github_delivery:deliveries-revoke */
        UPDATE github_delivery_requests
        SET state_version = state_version + 1,
            status = 'revoked',
            outcome_code = 'binding_revoked',
            updated_at = $4
        WHERE organization_id = $1
          AND project_id = $2
          AND binding_id = $3
          AND status NOT IN ('completed', 'failed', 'revoked')
      `,
      [identity.organizationId, identity.projectId, bindingId, at],
    )
  }

  function validateDeliveryIntent(
    input: CreateOrReviseGitHubDeliveryRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
    binding: RepositoryBindingRow,
  ): GitHubDeliveryIntent | null {
    return normalizeGitHubDeliveryRequestIntent(input, {
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      binding: {
        id: binding.id,
        version: binding.version,
        installationId: binding.installation_id,
        repositoryId: binding.repository_id,
        repository: binding.full_name,
        defaultBranch: binding.default_branch,
      },
    })
  }

  async function loadCanonicalDeliveryAuthority(
    tx: TeamDbTransactionClient,
    input: {
      identity: VerifiedIdentity
      runId: string
      requestedByUserId: string
      requestedByTokenId: string
    },
  ): Promise<CanonicalDeliveryAuthorityRow | null> {
    const [row] = await tx.query<CanonicalDeliveryAuthorityRow>(
      `
        /* github_delivery:canonical-authority */
        SELECT
          workflow_runs.run_version,
          workflow_runs.current_node_id,
          workflow_nodes.stage AS node_stage,
          workflow_nodes.kind AS node_kind,
          workflow_nodes.status AS node_status,
          work_requests.status AS claim_status,
          work_requests.claimed_by_token_id
        FROM workflow_runs
        JOIN workflow_nodes
          ON workflow_nodes.run_id = workflow_runs.id
         AND workflow_nodes.id = workflow_runs.current_node_id
        JOIN work_requests
          ON work_requests.organization_id = workflow_runs.organization_id
         AND work_requests.project_id = workflow_runs.project_id
         AND work_requests.claimed_run_id = workflow_runs.id
         AND work_requests.status = 'materialized'
        WHERE workflow_runs.organization_id = $1
          AND workflow_runs.project_id = $2
          AND workflow_runs.id = $3
          AND workflow_runs.creator_id = $4
          AND workflow_runs.data_origin = 'remote'
          AND work_requests.claimed_by_token_id = $5
        LIMIT 1
        FOR SHARE OF workflow_runs, workflow_nodes, work_requests
      `,
      [
        input.identity.organizationId,
        input.identity.projectId,
        input.runId,
        input.requestedByUserId,
        input.requestedByTokenId,
      ],
    )
    return row ?? null
  }

  function canonicalAuthorityMatches(
    row: CanonicalDeliveryAuthorityRow | null,
    input: { runId: string; runVersion: number; nodeId: string; tokenId: string },
  ): boolean {
    return Boolean(
      row &&
        row.run_version === input.runVersion &&
        row.current_node_id === toTeamStoredNodeId(input.runId, input.nodeId) &&
        row.node_stage === 'pr' &&
        row.node_kind === 'pr' &&
        row.node_status === 'running' &&
        row.claim_status === 'materialized' &&
        row.claimed_by_token_id === input.tokenId,
    )
  }

  async function lockDeliveryByLogicalKey(
    tx: TeamDbTransactionClient,
    identity: VerifiedIdentity,
    logicalIdempotencyKey: string,
  ): Promise<DeliveryRequestRow | null> {
    const [row] = await tx.query<DeliveryRequestRow>(
      `
        /* github_delivery:delivery-logical-lock */
        SELECT ${deliveryRequestColumns}
        FROM github_delivery_requests
        WHERE organization_id = $1
          AND project_id = $2
          AND logical_idempotency_key = $3
        LIMIT 1
        FOR UPDATE
      `,
      [identity.organizationId, identity.projectId, logicalIdempotencyKey],
    )
    return row ?? null
  }

  async function lockDeliveryById(
    tx: TeamDbTransactionClient,
    identity: VerifiedIdentity,
    requestId: string,
  ): Promise<DeliveryRequestRow | null> {
    const [row] = await tx.query<DeliveryRequestRow>(
      `
        /* github_delivery:delivery-lock */
        SELECT ${deliveryRequestColumns}
        FROM github_delivery_requests
        WHERE id = $1
          AND organization_id = $2
          AND project_id = $3
        LIMIT 1
        FOR UPDATE
      `,
      [requestId, identity.organizationId, identity.projectId],
    )
    return row ?? null
  }

  async function loadCurrentApproval(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
  ): Promise<DeliveryApprovalRow | null> {
    const [row] = await tx.query<DeliveryApprovalRow>(
      `
        /* github_delivery:approval-current */
        SELECT ${deliveryApprovalColumns}
        FROM github_delivery_approvals
        WHERE request_id = $1
          AND intent_revision = $2
        LIMIT 1
        FOR SHARE
      `,
      [request.id, request.intent_revision],
    )
    return row ?? null
  }

  function approvalMatchesRequest(
    approval: DeliveryApprovalRow,
    request: DeliveryRequestRow,
  ): boolean {
    return (
      approval.request_id === request.id &&
      approval.intent_revision === request.intent_revision &&
      approval.intent_digest === request.intent_digest &&
      approval.binding_id === request.binding_id &&
      approval.binding_version === request.binding_version &&
      approval.run_id === request.run_id &&
      approval.run_version === request.run_version &&
      approval.node_id === request.node_id &&
      approval.repository_id === request.repository_id &&
      approval.base_branch === request.base_branch &&
      approval.head_branch === request.head_branch &&
      approval.expected_commit_sha === request.expected_commit_sha &&
      approval.test_evidence_digest === request.test_evidence_digest &&
      approval.package_digest === request.package_digest &&
      approval.auth_kind === 'session_cookie'
    )
  }

  async function loadCurrentGrant(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
  ): Promise<CredentialGrantRow | null> {
    const [row] = await tx.query<CredentialGrantRow>(
      `
        /* github_delivery:grant-current */
        SELECT ${credentialGrantColumns}
        FROM github_delivery_credential_grants
        WHERE request_id = $1
          AND intent_revision = $2
        ORDER BY attempt DESC
        LIMIT 1
        FOR UPDATE
      `,
      [request.id, request.intent_revision],
    )
    return row ?? null
  }

  async function lockGrantById(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
    grantId: string,
  ): Promise<CredentialGrantRow | null> {
    const [row] = await tx.query<CredentialGrantRow>(
      `
        /* github_delivery:grant-lock */
        SELECT ${credentialGrantColumns}
        FROM github_delivery_credential_grants
        WHERE id = $1
          AND request_id = $2
          AND intent_revision = $3
        LIMIT 1
        FOR UPDATE
      `,
      [grantId, request.id, request.intent_revision],
    )
    return row ?? null
  }

  function exactActiveBinding(
    binding: RepositoryBindingRow | null,
    request: DeliveryRequestRow,
  ): binding is RepositoryBindingRow {
    return Boolean(
      binding &&
        binding.status === 'active' &&
        binding.id === request.binding_id &&
        binding.version === request.binding_version &&
        binding.repository_id === request.repository_id &&
        binding.installation_id === request.installation_id &&
        binding.full_name === request.repository_full_name &&
        binding.default_branch === request.base_branch,
    )
  }

  async function loadCurrentPublication(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
  ): Promise<BranchPublicationRow | null> {
    const [row] = await tx.query<BranchPublicationRow>(
      `
        /* github_delivery:publication-current */
        SELECT ${branchPublicationColumns}
        FROM github_branch_publications
        WHERE request_id = $1
          AND intent_revision = $2
        LIMIT 1
        FOR UPDATE
      `,
      [request.id, request.intent_revision],
    )
    return row ?? null
  }

  async function lockPublicationById(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
    publicationId: string,
  ): Promise<BranchPublicationRow | null> {
    const [row] = await tx.query<BranchPublicationRow>(
      `
        /* github_delivery:publication-lock */
        SELECT ${branchPublicationColumns}
        FROM github_branch_publications
        WHERE id = $1
          AND request_id = $2
          AND intent_revision = $3
        LIMIT 1
        FOR UPDATE
      `,
      [publicationId, request.id, request.intent_revision],
    )
    return row ?? null
  }

  async function loadCurrentPullRequest(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
  ): Promise<PullRequestOutcomeRow | null> {
    const [row] = await tx.query<PullRequestOutcomeRow>(
      `
        /* github_delivery:pull-request-current */
        SELECT ${pullRequestOutcomeColumns}
        FROM github_pull_request_outcomes
        WHERE request_id = $1
          AND intent_revision = $2
        LIMIT 1
        FOR UPDATE
      `,
      [request.id, request.intent_revision],
    )
    return row ?? null
  }

  async function lockPullRequestById(
    tx: TeamDbTransactionClient,
    request: DeliveryRequestRow,
    outcomeId: string,
  ): Promise<PullRequestOutcomeRow | null> {
    const [row] = await tx.query<PullRequestOutcomeRow>(
      `
        /* github_delivery:pull-request-lock */
        SELECT ${pullRequestOutcomeColumns}
        FROM github_pull_request_outcomes
        WHERE id = $1
          AND request_id = $2
          AND intent_revision = $3
        LIMIT 1
        FOR UPDATE
      `,
      [outcomeId, request.id, request.intent_revision],
    )
    return row ?? null
  }

  async function upsertGitHubRepositoryBinding(
    input: UpsertGitHubRepositoryBindingInput,
    principal: Parameters<GitHubDeliveryRepository['upsertGitHubRepositoryBinding']>[1],
  ): Promise<GitHubRepositoryBindingMutationResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_binding_upsert' as const
      const operationMeta = operationFingerprint(operation, input)
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadCookieIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return githubDeliveryRejection('project_forbidden')
      }
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const recordId = createId('binding')
      const finalize = (
        result: GitHubRepositoryBindingMutationResult,
        observedVersion: number | null,
        resolvedRecordId = recordId,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_binding',
          recordId: resolvedRecordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (identity.role !== 'owner') {
        return finalize(githubDeliveryRejection('role_forbidden'), null)
      }
      const at = now().toISOString()
      const validated = invalidBindingInput(input, at)
      if (!validated) {
        return finalize(githubDeliveryRejection('invalid_state'), null)
      }
      await lockRepository(tx, identity.organizationId, input.repositoryId)
      const existing = await lockBinding(tx, identity)
      const observedVersion = existing?.version ?? 0
      const storedResponse = decodeStoredMutationResponse(existingIdempotency)
      if (
        existing &&
        existing.status === 'active' &&
        existing.version === input.expectedStateVersion + 1 &&
        existing.installation_id === input.installationId &&
        existing.repository_id === input.repositoryId &&
        existing.full_name === validated.repository &&
        existing.default_branch === validated.defaultBranch &&
        toIso(existing.validated_at) === validated.verifiedAt &&
        storedResponse?.ok === true &&
        (storedResponse.outcomeCode === 'binding_created' ||
          storedResponse.outcomeCode === 'binding_updated')
      ) {
        return finalize(
          {
            ok: true,
            responseStatus:
              storedResponse.outcomeCode === 'binding_created' ? 201 : 200,
            outcomeCode: storedResponse.outcomeCode,
            replayed: true,
            binding: mapRepositoryBindingRow(existing),
          },
          existing.version,
          existing.id,
        )
      }
      if (observedVersion !== input.expectedStateVersion) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          observedVersion,
          existing?.id,
        )
      }
      if (
        existing &&
        Date.parse(validated.verifiedAt) < Date.parse(toIso(existing.created_at))
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          existing.version,
          existing.id,
        )
      }
      const [conflict] = await tx.query<{ id: string }>(
        `
          /* github_delivery:binding-repository-conflict */
          SELECT id
          FROM github_repository_bindings
          WHERE organization_id = $1
            AND repository_id = $2
            AND status = 'active'
            AND ($3::text IS NULL OR id <> $3)
          LIMIT 1
        `,
        [identity.organizationId, input.repositoryId, existing?.id ?? null],
      )
      if (conflict) {
        return finalize(
          githubDeliveryRejection('binding_conflict'),
          observedVersion,
          existing?.id,
        )
      }

      const rows = existing
        ? await tx.query<RepositoryBindingRow>(
            `
              /* github_delivery:binding-update */
              UPDATE github_repository_bindings
              SET version = version + 1,
                  installation_id = $5,
                  repository_id = $6,
                  full_name = $7,
                  default_branch = $8,
                  status = 'active',
                  updated_by_user_id = $9,
                  validated_at = $10,
                  revoked_at = NULL,
                  updated_at = $11
              WHERE id = $1
                AND organization_id = $2
                AND project_id = $3
                AND version = $4
              RETURNING ${repositoryBindingColumns}
            `,
            [
              existing.id,
              identity.organizationId,
              identity.projectId,
              input.expectedStateVersion,
              input.installationId,
              input.repositoryId,
              validated.repository,
              validated.defaultBranch,
              identity.userId,
              validated.verifiedAt,
              at,
            ],
          )
        : await tx.query<RepositoryBindingRow>(
            `
              /* github_delivery:binding-create */
              INSERT INTO github_repository_bindings (
                id,
                version,
                organization_id,
                project_id,
                installation_id,
                repository_id,
                full_name,
                default_branch,
                status,
                configured_by_user_id,
                updated_by_user_id,
                validated_at,
                revoked_at,
                created_at,
                updated_at
              )
              VALUES (
                $1, 1, $2, $3, $4, $5, $6, $7, 'active',
                $8, $8, $9, NULL, $10, $11
              )
              ON CONFLICT DO NOTHING
              RETURNING ${repositoryBindingColumns}
            `,
            [
              recordId,
              identity.organizationId,
              identity.projectId,
              input.installationId,
              input.repositoryId,
              validated.repository,
              validated.defaultBranch,
              identity.userId,
              validated.verifiedAt,
              new Date(
                Math.min(Date.parse(validated.verifiedAt), Date.parse(at)),
              ).toISOString(),
              at,
            ],
          )
      const row = rows[0]
      if (!row) {
        return finalize(
          githubDeliveryRejection(
            existing ? 'stale_version' : 'binding_conflict',
          ),
          observedVersion,
          existing?.id,
        )
      }
      if (existing) {
        await invalidateDeliveriesForBinding(tx, identity, existing.id, at)
      }
      const result: GitHubRepositoryBindingMutationResult = {
        ok: true,
        responseStatus: existing ? 200 : 201,
        outcomeCode: existing ? 'binding_updated' : 'binding_created',
        replayed: false,
        binding: mapRepositoryBindingRow(row),
      }
      return finalize(result, row.version, row.id)
    })
  }

  async function revokeGitHubRepositoryBinding(
    input: RevokeGitHubRepositoryBindingInput,
    principal: Parameters<GitHubDeliveryRepository['revokeGitHubRepositoryBinding']>[1],
  ): Promise<GitHubRepositoryBindingMutationResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_binding_revoke' as const
      const operationMeta = operationFingerprint(operation, input)
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadCookieIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return githubDeliveryRejection('project_forbidden')
      }
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const existing = await lockBinding(tx, identity)
      const recordId = existing?.id ?? createId('binding')
      const finalize = (
        result: GitHubRepositoryBindingMutationResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_binding',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (identity.role !== 'owner') {
        return finalize(githubDeliveryRejection('role_forbidden'), null)
      }
      if (!existing) return finalize(githubDeliveryRejection('not_found'), null)
      const storedResponse = decodeStoredMutationResponse(existingIdempotency)
      if (
        existing.status === 'revoked' &&
        existing.version === input.expectedStateVersion + 1 &&
        storedResponse?.ok === true &&
        storedResponse.outcomeCode === 'binding_revoked'
      ) {
        return finalize(
          {
            ok: true,
            responseStatus: 200,
            outcomeCode: 'binding_revoked',
            replayed: true,
            binding: mapRepositoryBindingRow(existing),
          },
          existing.version,
        )
      }
      if (existing.version !== input.expectedStateVersion) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          existing.version,
        )
      }
      if (existing.status === 'revoked') {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          existing.version,
        )
      }
      const at = now().toISOString()
      const [row] = await tx.query<RepositoryBindingRow>(
        `
          /* github_delivery:binding-revoke */
          UPDATE github_repository_bindings
          SET version = version + 1,
              status = 'revoked',
              updated_by_user_id = $5,
              revoked_at = $6,
              updated_at = $6
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND version = $4
          RETURNING ${repositoryBindingColumns}
        `,
        [
          existing.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          identity.userId,
          at,
        ],
      )
      if (!row) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          existing.version,
        )
      }
      await invalidateDeliveriesForBinding(tx, identity, existing.id, at)
      return finalize(
        {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'binding_revoked',
          replayed: false,
          binding: mapRepositoryBindingRow(row),
        },
        row.version,
      )
    })
  }

  async function getGitHubRepositoryBinding(
    projectId: string,
    principal: GitHubDeliveryReadPrincipal,
  ): Promise<GitHubRepositoryBinding | null> {
    const identity = await loadReadIdentity(principal, projectId)
    if (!identity?.hasProjectAccess) return null
    const [row] = await db.query<RepositoryBindingRow>(
      `
        /* github_delivery:binding-read */
        SELECT ${repositoryBindingColumns}
        FROM github_repository_bindings
        WHERE organization_id = $1
          AND project_id = $2
        ORDER BY version DESC
        LIMIT 1
      `,
      [identity.organizationId, identity.projectId],
    )
    return row ? mapRepositoryBindingRow(row) : null
  }

  async function createOrReviseGitHubDeliveryRequest(
    input: CreateOrReviseGitHubDeliveryRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequestMutationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadBearerIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const binding = await lockBinding(tx, identity)
      const intent = binding
        ? validateDeliveryIntent(input, principal, binding)
        : null
      const existing = intent
        ? await lockDeliveryByLogicalKey(
            tx,
            identity,
            intent.idempotencyKey,
          )
        : null
      const operation =
        existing === null
          ? ('github_delivery_submit' as const)
          : ('github_delivery_revise' as const)
      const operationMeta = operationFingerprint(operation, input)
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const recordId = existing?.id ?? createId('delivery')
      const finalize = (
        result: GitHubDeliveryRequestMutationResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_delivery',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!binding || binding.status !== 'active') {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          existing?.state_version ?? null,
        )
      }
      if (!intent) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          existing?.state_version ?? null,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: intent.runId,
        requestedByUserId: identity.userId,
        requestedByTokenId: identity.tokenRecordId,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: intent.runId,
          runVersion: intent.runVersion,
          nodeId: intent.nodeId,
          tokenId: identity.tokenRecordId,
        })
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          existing?.state_version ?? null,
        )
      }

      const fingerprint = fingerprintGitHubDeliveryRequest(input)
      if (existing) {
        if (existing.requested_by_token_id !== identity.tokenRecordId) {
          return finalize(
            githubDeliveryRejection('project_forbidden'),
            existing.state_version,
          )
        }
        const storedFingerprint = fingerprintGitHubDeliveryRequest({
          intent: {
            intentDigest: existing.intent_digest,
            idempotencyKey: existing.logical_idempotency_key,
          } as GitHubDeliveryIntent,
          prTitle: existing.pr_title,
          prBody: existing.pr_body,
        })
        if (storedFingerprint === fingerprint) {
          const replayedCreate = existing.intent_revision === 1
          return finalize(
            {
              ok: true,
              responseStatus: replayedCreate ? 201 : 200,
              outcomeCode: replayedCreate
                ? 'delivery_created'
                : 'delivery_revised',
              replayed: true,
              request: mapDeliveryRequestRow(existing),
            },
            existing.state_version,
          )
        }
        if (existing.state_version !== input.expectedStateVersion) {
          return finalize(
            githubDeliveryRejection('stale_version'),
            existing.state_version,
          )
        }
        if (
          existing.status !== 'approval_required' &&
          existing.status !== 'approved'
        ) {
          return finalize(
            githubDeliveryRejection('intent_conflict'),
            existing.state_version,
          )
        }
        const at = now().toISOString()
        const maximumExpiry =
          Date.parse(toIso(existing.created_at)) + 24 * 60 * 60 * 1_000
        if (Date.parse(at) >= maximumExpiry) {
          return finalize(
            githubDeliveryRejection('expired'),
            existing.state_version,
          )
        }
        const expiresAt = new Date(maximumExpiry).toISOString()
        const [row] = await tx.query<DeliveryRequestRow>(
          `
            /* github_delivery:delivery-revise */
            UPDATE github_delivery_requests
            SET state_version = state_version + 1,
                intent_revision = intent_revision + 1,
                local_intent_id = $5,
                local_project_id = $6,
                run_id = $7,
                run_version = $8,
                node_id = $9,
                binding_id = $10,
                binding_version = $11,
                installation_id = $12,
                repository_id = $13,
                repository_full_name = $14,
                coding_run_id = $15,
                workspace_id = $16,
                diff_artifact_id = $17,
                test_evidence_id = $18,
                pr_package_artifact_id = $19,
                status = 'approval_required',
                outcome_code = NULL,
                expected_run_version = $20,
                base_branch = $21,
                head_branch = $22,
                base_commit_sha = $23,
                expected_commit_sha = $24,
                intent_digest = $25,
                diff_digest = $26,
                test_evidence_digest = $27,
                package_digest = $28,
                changed_paths = $29::jsonb,
                pr_title = $30,
                pr_body = $31,
                expires_at = $32,
                updated_at = $33
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND state_version = $4
            RETURNING ${deliveryRequestColumns}
          `,
          [
            existing.id,
            identity.organizationId,
            identity.projectId,
            input.expectedStateVersion,
            intent.id,
            intent.localProjectId,
            intent.runId,
            intent.runVersion,
            intent.nodeId,
            intent.repositoryBindingId,
            intent.repositoryBindingVersion,
            intent.installationId,
            intent.repositoryId,
            intent.repository,
            intent.codingRunId,
            intent.workspaceId,
            intent.diffArtifactId,
            intent.testEvidenceId,
            intent.prPackageArtifactId,
            intent.runVersion,
            intent.baseBranch,
            intent.headBranch,
            intent.baseCommitSha,
            intent.expectedCommitSha,
            intent.intentDigest,
            intent.diffSourceDigest,
            intent.testEvidenceDigest,
            intent.prPackageDigest,
            JSON.stringify(intent.changedPaths),
            input.prTitle,
            input.prBody,
            expiresAt,
            at,
          ],
        )
        if (!row) {
          return finalize(
            githubDeliveryRejection('stale_version'),
            existing.state_version,
          )
        }
        return finalize(
          {
            ok: true,
            responseStatus: 200,
            outcomeCode: 'delivery_revised',
            replayed: false,
            request: mapDeliveryRequestRow(row),
          },
          row.state_version,
        )
      }

      if (input.expectedStateVersion !== 0) {
        return finalize(githubDeliveryRejection('stale_version'), 0)
      }
      const [competing] = await tx.query<{ id: string }>(
        `
          /* github_delivery:delivery-active-target */
          SELECT id
          FROM github_delivery_requests
          WHERE organization_id = $1
            AND project_id = $2
            AND run_id = $3
            AND node_id = $4
            AND status NOT IN ('failed', 'revoked')
          LIMIT 1
          FOR SHARE
        `,
        [identity.organizationId, identity.projectId, intent.runId, intent.nodeId],
      )
      if (competing) {
        return finalize(githubDeliveryRejection('intent_conflict'), null)
      }
      const at = now().toISOString()
      const expiresAt = new Date(
        Date.parse(at) + 24 * 60 * 60 * 1_000,
      ).toISOString()
      const [row] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-create */
          INSERT INTO github_delivery_requests (
            id,
            state_version,
            intent_revision,
            organization_id,
            project_id,
            requested_by_user_id,
            requested_by_token_id,
            local_intent_id,
            local_project_id,
            run_id,
            run_version,
            node_id,
            binding_id,
            binding_version,
            installation_id,
            repository_id,
            repository_full_name,
            coding_run_id,
            workspace_id,
            diff_artifact_id,
            test_evidence_id,
            pr_package_artifact_id,
            status,
            outcome_code,
            expected_run_version,
            base_branch,
            head_branch,
            base_commit_sha,
            expected_commit_sha,
            intent_digest,
            logical_idempotency_key,
            diff_digest,
            test_evidence_digest,
            package_digest,
            changed_paths,
            pr_title,
            pr_body,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (
            $1, 1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            'approval_required', NULL, $21, $22, $23, $24, $25, $26,
            $27, $28, $29, $30, $31::jsonb, $32, $33, $34, $35, $35
          )
          RETURNING ${deliveryRequestColumns}
        `,
        [
          recordId,
          identity.organizationId,
          identity.projectId,
          identity.userId,
          identity.tokenRecordId,
          intent.id,
          intent.localProjectId,
          intent.runId,
          intent.runVersion,
          intent.nodeId,
          intent.repositoryBindingId,
          intent.repositoryBindingVersion,
          intent.installationId,
          intent.repositoryId,
          intent.repository,
          intent.codingRunId,
          intent.workspaceId,
          intent.diffArtifactId,
          intent.testEvidenceId,
          intent.prPackageArtifactId,
          intent.runVersion,
          intent.baseBranch,
          intent.headBranch,
          intent.baseCommitSha,
          intent.expectedCommitSha,
          intent.intentDigest,
          intent.idempotencyKey,
          intent.diffSourceDigest,
          intent.testEvidenceDigest,
          intent.prPackageDigest,
          JSON.stringify(intent.changedPaths),
          input.prTitle,
          input.prBody,
          expiresAt,
          at,
        ],
      )
      if (!row) {
        return finalize(githubDeliveryRejection('intent_conflict'), null)
      }
      return finalize(
        {
          ok: true,
          responseStatus: 201,
          outcomeCode: 'delivery_created',
          replayed: false,
          request: mapDeliveryRequestRow(row),
        },
        row.state_version,
      )
    })
  }

  async function listGitHubDeliveryInbox(
    projectId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequest[]> {
    const identity = await loadBearerIdentity(db, principal, projectId)
    if (!identity?.hasProjectAccess || !identity.tokenRecordId) return []
    const rows = await db.query<DeliveryRequestRow>(
      `
        /* github_delivery:delivery-list-desktop */
        SELECT ${deliveryRequestColumns}
        FROM github_delivery_requests
        WHERE organization_id = $1
          AND project_id = $2
          AND requested_by_token_id = $3
        ORDER BY created_at DESC, id ASC
      `,
      [identity.organizationId, identity.projectId, identity.tokenRecordId],
    )
    return rows.map(mapDeliveryRequestRow)
  }

  async function getGitHubDeliveryRecoverySnapshot(
    projectId: string,
    requestId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRecoverySnapshot | null> {
    return withTeamDbTransaction(
      db,
      async (tx) => {
        const identity = await loadBearerIdentity(tx, principal, projectId)
        if (!identity?.hasProjectAccess || !identity.tokenRecordId) return null
        const [request] = await tx.query<DeliveryRequestRow>(
          `
            /* github_delivery:recovery-delivery-read */
            SELECT ${deliveryRequestColumns}
            FROM github_delivery_requests
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND requested_by_token_id = $4
            LIMIT 1
          `,
          [
            requestId,
            identity.organizationId,
            identity.projectId,
            identity.tokenRecordId,
          ],
        )
        if (!request) return null

        const [approvalRows, grantRows, publicationRows, pullRequestRows] =
          await Promise.all([
            tx.query<DeliveryApprovalRow>(
              `
                /* github_delivery:recovery-approval-read */
                SELECT ${deliveryApprovalColumns}
                FROM github_delivery_approvals
                WHERE request_id = $1
                  AND intent_revision = $2
                LIMIT 1
              `,
              [request.id, request.intent_revision],
            ),
            tx.query<CredentialGrantRow>(
              `
                /* github_delivery:recovery-grant-read */
                SELECT ${credentialGrantColumns}
                FROM github_delivery_credential_grants
                WHERE request_id = $1
                  AND intent_revision = $2
                ORDER BY attempt DESC
                LIMIT 1
              `,
              [request.id, request.intent_revision],
            ),
            tx.query<BranchPublicationRow>(
              `
                /* github_delivery:recovery-publication-read */
                SELECT ${branchPublicationColumns}
                FROM github_branch_publications
                WHERE request_id = $1
                  AND intent_revision = $2
                LIMIT 1
              `,
              [request.id, request.intent_revision],
            ),
            tx.query<PullRequestOutcomeRow>(
              `
                /* github_delivery:recovery-pull-request-read */
                SELECT ${pullRequestOutcomeColumns}
                FROM github_pull_request_outcomes
                WHERE request_id = $1
                  AND intent_revision = $2
                LIMIT 1
              `,
              [request.id, request.intent_revision],
            ),
          ])

        return {
          request: mapDeliveryRequestRow(request),
          approval:
            approvalRows[0] === undefined
              ? null
              : mapDeliveryApprovalRow(approvalRows[0]),
          grant:
            grantRows[0] === undefined
              ? null
              : mapCredentialGrantRow(grantRows[0]),
          publication:
            publicationRows[0] === undefined
              ? null
              : mapBranchPublicationRow(publicationRows[0]),
          pullRequest:
            pullRequestRows[0] === undefined
              ? null
              : mapPullRequestOutcomeRow(pullRequestRows[0]),
        }
      },
      { isolationLevel: 'repeatable_read' },
    )
  }

  async function listGitHubDeliveryRequests(
    projectId: string,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryRequest[]> {
    const identity = await loadCookieIdentity(db, principal, projectId)
    if (!identity?.hasProjectAccess) return []
    const rows = await db.query<DeliveryRequestRow>(
      `
        /* github_delivery:delivery-list-browser */
        SELECT ${deliveryRequestColumns}
        FROM github_delivery_requests
        WHERE organization_id = $1
          AND project_id = $2
        ORDER BY created_at DESC, id ASC
      `,
      [identity.organizationId, identity.projectId],
    )
    return rows.map(mapDeliveryRequestRow)
  }

  async function decideGitHubDeliveryRequest(
    input: DecideGitHubDeliveryRequestInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryDecisionResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadCookieIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const operation =
        input.decision === 'approve'
          ? ('github_delivery_approve' as const)
          : ('github_delivery_reject' as const)
      const operationMeta = operationFingerprint(operation, input)
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const existingApproval = request
        ? await loadCurrentApproval(tx, request)
        : null
      const recordId =
        input.decision === 'approve'
          ? (existingApproval?.id ?? createId('approval'))
          : (request?.id ?? unresolvedRecordId('delivery', input.requestId))
      const finalize = (
        result: GitHubDeliveryDecisionResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind:
            input.decision === 'approve'
              ? 'github_delivery_approval'
              : 'github_delivery',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (identity.role !== 'lead' && identity.role !== 'owner') {
        return finalize(githubDeliveryRejection('role_forbidden'), null)
      }
      if (!request) return finalize(githubDeliveryRejection('not_found'), null)
      const storedResponse = decodeStoredMutationResponse(existingIdempotency)
      if (
        input.decision === 'reject' &&
        request.status === 'revoked' &&
        request.outcome_code === 'approval_rejected' &&
        request.state_version === input.expectedStateVersion + 1 &&
        storedResponse?.ok === true &&
        storedResponse.outcomeCode === 'delivery_rejected'
      ) {
        return finalize(
          {
            ok: true,
            responseStatus: 200,
            outcomeCode: 'delivery_rejected',
            replayed: true,
            request: mapDeliveryRequestRow(request),
            approval: null,
          },
          request.state_version,
        )
      }
      const binding = await lockBinding(tx, identity)
      if (
        !binding ||
        binding.status !== 'active' ||
        binding.id !== request.binding_id ||
        binding.version !== request.binding_version ||
        binding.repository_id !== request.repository_id
      ) {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          request.state_version,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(
          githubDeliveryRejection('approval_conflict'),
          request.state_version,
        )
      }
      if (
        input.decision === 'approve' &&
        request.status === 'approved' &&
        existingApproval?.approved_by_user_id === identity.userId &&
        approvalMatchesRequest(existingApproval, request)
      ) {
        return finalize(
          {
            ok: true,
            responseStatus: 200,
            outcomeCode: 'delivery_approved',
            replayed: true,
            request: mapDeliveryRequestRow(request),
            approval: mapDeliveryApprovalRow(existingApproval),
          },
          request.state_version,
        )
      }
      if (request.state_version !== input.expectedStateVersion) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      if (request.status !== 'approval_required') {
        return finalize(
          githubDeliveryRejection('approval_conflict'),
          request.state_version,
        )
      }
      const at = now().toISOString()
      if (Date.parse(at) >= Date.parse(toIso(request.expires_at))) {
        return finalize(
          githubDeliveryRejection('expired'),
          request.state_version,
        )
      }

      if (input.decision === 'reject') {
        const [rejected] = await tx.query<DeliveryRequestRow>(
          `
            /* github_delivery:delivery-reject */
            UPDATE github_delivery_requests
            SET state_version = state_version + 1,
                status = 'revoked',
                outcome_code = 'approval_rejected',
                updated_at = $5
            WHERE id = $1
              AND organization_id = $2
              AND project_id = $3
              AND state_version = $4
              AND status = 'approval_required'
            RETURNING ${deliveryRequestColumns}
          `,
          [
            request.id,
            identity.organizationId,
            identity.projectId,
            input.expectedStateVersion,
            at,
          ],
        )
        if (!rejected) {
          return finalize(
            githubDeliveryRejection('stale_version'),
            request.state_version,
          )
        }
        return finalize(
          {
            ok: true,
            responseStatus: 200,
            outcomeCode: 'delivery_rejected',
            replayed: false,
            request: mapDeliveryRequestRow(rejected),
            approval: null,
          },
          rejected.state_version,
        )
      }

      const [approvedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-approve */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = 'approved',
              outcome_code = NULL,
              updated_at = $5
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status = 'approval_required'
          RETURNING ${deliveryRequestColumns}
        `,
        [
          request.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          at,
        ],
      )
      if (!approvedRequest) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const [approval] = await tx.query<DeliveryApprovalRow>(
        `
          /* github_delivery:approval-create */
          INSERT INTO github_delivery_approvals (
            id,
            request_id,
            intent_revision,
            request_state_version,
            intent_digest,
            binding_id,
            binding_version,
            run_id,
            run_version,
            node_id,
            repository_id,
            base_branch,
            head_branch,
            expected_commit_sha,
            test_evidence_digest,
            package_digest,
            approved_by_user_id,
            approved_role,
            auth_kind,
            approved_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            'session_cookie', $19
          )
          RETURNING ${deliveryApprovalColumns}
        `,
        [
          recordId,
          request.id,
          request.intent_revision,
          request.state_version,
          request.intent_digest,
          request.binding_id,
          request.binding_version,
          request.run_id,
          request.run_version,
          request.node_id,
          request.repository_id,
          request.base_branch,
          request.head_branch,
          request.expected_commit_sha,
          request.test_evidence_digest,
          request.package_digest,
          identity.userId,
          identity.role,
          at,
        ],
      )
      if (!approval) {
        throw new Error('GitHub Delivery approval persistence failed.')
      }
      return finalize(
        {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'delivery_approved',
          replayed: false,
          request: mapDeliveryRequestRow(approvedRequest),
          approval: mapDeliveryApprovalRow(approval),
        },
        approvedRequest.state_version,
      )
    })
  }

  async function reserveGitHubCredentialGrant(
    input: ReserveGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantMutationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_delivery_grant' as const
      const operationMeta = operationFingerprint(operation, ['reserve', input])
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadBearerIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const existingGrant = request ? await loadCurrentGrant(tx, request) : null
      const existingPublication =
        request && existingGrant?.status === 'consumed'
          ? await loadCurrentPublication(tx, request)
          : null
      let recordId = existingGrant?.id ?? createId('grant')
      const finalize = (
        result: GitHubCredentialGrantMutationResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_credential_grant',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!request) return finalize(githubDeliveryRejection('not_found'), null)
      if (request.requested_by_token_id !== identity.tokenRecordId) {
        return finalize(
          githubDeliveryRejection('project_forbidden'),
          request.state_version,
        )
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          request.state_version,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(
          githubDeliveryRejection('approval_required'),
          request.state_version,
        )
      }
      const at = now().toISOString()
      const staleIssuingGrant = Boolean(
        existingGrant?.status === 'issuing' &&
          request.status === 'publishing_branch' &&
          Date.parse(at) >=
            Date.parse(toIso(existingGrant.requested_at)) +
              GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
      )
      const expiredIssuedGrant = Boolean(
        existingGrant?.status === 'issued' &&
          existingGrant.credential_expires_at !== null &&
          Date.parse(at) >=
            Date.parse(toIso(existingGrant.credential_expires_at)),
      )
      const replacingLostIssuedCredential = Boolean(
        existingGrant?.status === 'issued' &&
          !expiredIssuedGrant &&
          request.status === 'publishing_branch',
      )
      const consumedPublicationRecovery = Boolean(
        existingGrant?.status === 'consumed' &&
          existingPublication?.grant_id === existingGrant.id &&
          ['recovery_required', 'conflict'].includes(existingPublication.status) &&
          request.status === 'recovery_required',
      )
      const retrying = Boolean(
        existingGrant &&
          (['failed', 'recovery_required', 'expired'].includes(
            existingGrant.status,
          ) ||
            staleIssuingGrant ||
            expiredIssuedGrant ||
            replacingLostIssuedCredential ||
            consumedPublicationRecovery),
      )
      if (
        retrying &&
        existingGrant &&
        existingGrant.attempt >= MAX_CREDENTIAL_GRANT_ATTEMPTS
      ) {
        return finalize(
          githubDeliveryRejection('grant_conflict'),
          request.state_version,
        )
      }
      if (
        existingGrant &&
        existingGrant.issued_to_token_id === identity.tokenRecordId &&
        !retrying &&
        ['issuing', 'issued', 'consumed'].includes(existingGrant.status)
      ) {
        return finalize(
          {
            ok: true,
            responseStatus: 201,
            outcomeCode: 'grant_reserved',
            replayed: true,
            request: mapDeliveryRequestRow(request),
            grant: mapCredentialGrantRow(existingGrant),
          },
          request.state_version,
        )
      }
      if (request.state_version !== input.expectedStateVersion) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const recovering = Boolean(
        retrying &&
          existingGrant?.issued_to_token_id === identity.tokenRecordId &&
          (['failed', 'recovery_required'].includes(request.status) ||
            ((staleIssuingGrant || expiredIssuedGrant || replacingLostIssuedCredential) &&
              request.status === 'publishing_branch')),
      )
      if (request.status !== 'approved' && !recovering) {
        return finalize(
          githubDeliveryRejection('approval_required'),
          request.state_version,
        )
      }
      if (Date.parse(at) >= Date.parse(toIso(request.expires_at))) {
        return finalize(
          githubDeliveryRejection('expired'),
          request.state_version,
        )
      }
      if (recovering && existingGrant?.status === 'recovery_required') {
        const [closed] = await tx.query<CredentialGrantRow>(
          `
            /* github_delivery:grant-close-recovery */
            UPDATE github_delivery_credential_grants
            SET version = version + 1,
                status = 'failed',
                outcome_code = 'credential_issue_failed'
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'recovery_required'
            RETURNING ${credentialGrantColumns}
          `,
          [
            existingGrant.id,
            request.id,
            request.intent_revision,
            existingGrant.version,
          ],
        )
        if (!closed) {
          return finalize(
            githubDeliveryRejection('grant_conflict'),
            request.state_version,
          )
        }
      }
      if (recovering && existingGrant && staleIssuingGrant) {
        const [closed] = await tx.query<CredentialGrantRow>(
          `
            /* github_delivery:grant-close-stale-issuance */
            UPDATE github_delivery_credential_grants
            SET version = version + 1,
                status = 'failed',
                outcome_code = 'credential_issue_failed'
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'issuing'
            RETURNING ${credentialGrantColumns}
          `,
          [
            existingGrant.id,
            request.id,
            request.intent_revision,
            existingGrant.version,
          ],
        )
        if (!closed) {
          return finalize(
            githubDeliveryRejection('grant_conflict'),
            request.state_version,
          )
        }
      }
      if (recovering && existingGrant && expiredIssuedGrant) {
        const [expired] = await tx.query<CredentialGrantRow>(
          `
            /* github_delivery:grant-expire */
            UPDATE github_delivery_credential_grants
            SET version = version + 1,
                status = 'expired',
                outcome_code = 'credential_expired'
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'issued'
              AND credential_expires_at <= $5
            RETURNING ${credentialGrantColumns}
          `,
          [
            existingGrant.id,
            request.id,
            request.intent_revision,
            existingGrant.version,
            at,
          ],
        )
        if (!expired) {
          return finalize(
            githubDeliveryRejection('grant_conflict'),
            request.state_version,
          )
        }
      }
      if (recovering && existingGrant && replacingLostIssuedCredential) {
        const [superseded] = await tx.query<CredentialGrantRow>(
          `
            /* github_delivery:grant-supersede-lost-response */
            UPDATE github_delivery_credential_grants
            SET version = version + 1,
                status = 'failed',
                outcome_code = 'credential_superseded'
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'issued'
            RETURNING ${credentialGrantColumns}
          `,
          [
            existingGrant.id,
            request.id,
            request.intent_revision,
            existingGrant.version,
          ],
        )
        if (!superseded) {
          return finalize(
            githubDeliveryRejection('grant_conflict'),
            request.state_version,
          )
        }
      }
      const [publishing] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-start-publishing */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = 'publishing_branch',
              outcome_code = NULL,
              updated_at = $5
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status IN (
              'approved', 'failed', 'recovery_required', 'publishing_branch'
            )
          RETURNING ${deliveryRequestColumns}
        `,
        [
          request.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          at,
        ],
      )
      if (!publishing) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const attempt = existingGrant ? existingGrant.attempt + 1 : 1
      const grantId = recovering ? createId('grant') : recordId
      recordId = grantId
      const [grant] = await tx.query<CredentialGrantRow>(
        `
          /* github_delivery:grant-create */
          INSERT INTO github_delivery_credential_grants (
            id,
            version,
            request_id,
            intent_revision,
            approval_id,
            attempt,
            issued_to_token_id,
            repository_id,
            permission,
            repository_count,
            status,
            requested_at,
            issued_at,
            credential_expires_at,
            consumed_at,
            outcome_code
          )
          VALUES (
            $1, 1, $2, $3, $4, $5, $6, $7,
            'contents:write', 1, 'issuing', $8, NULL, NULL, NULL, NULL
          )
          RETURNING ${credentialGrantColumns}
        `,
        [
          grantId,
          request.id,
          request.intent_revision,
          approval.id,
          attempt,
          identity.tokenRecordId,
          request.repository_id,
          at,
        ],
      )
      if (!grant) {
        throw new Error('GitHub Delivery credential reservation failed.')
      }
      return finalize(
        {
          ok: true,
          responseStatus: 201,
          outcomeCode: 'grant_reserved',
          replayed: false,
          request: mapDeliveryRequestRow(publishing),
          grant: mapCredentialGrantRow(grant),
        },
        publishing.state_version,
      )
    })
  }

  function grantFinalizationMatches(
    grant: CredentialGrantRow,
    input: FinalizeGitHubCredentialGrantInput,
  ): boolean {
    if (input.outcome.status === 'issued') {
      return (
        grant.status === 'issued' &&
        grant.issued_at !== null &&
        grant.credential_expires_at !== null &&
        toIso(grant.issued_at) === toIso(input.outcome.issuedAt) &&
        toIso(grant.credential_expires_at) ===
          toIso(input.outcome.credentialExpiresAt) &&
        grant.repository_id === input.outcome.repositoryId &&
        grant.permission === input.outcome.permission &&
        grant.repository_count === input.outcome.repositoryCount
      )
    }
    return (
      grant.status === input.outcome.status &&
      grant.outcome_code === input.outcome.outcomeCode
    )
  }

  async function finalizeGitHubCredentialGrant(
    input: FinalizeGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantMutationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_delivery_grant' as const
      const operationMeta = operationFingerprint(operation, ['finalize', input])
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadBearerIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const grant = request
        ? await lockGrantById(tx, request, input.grantId)
        : null
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const finalize = (
        result: GitHubCredentialGrantMutationResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_credential_grant',
          recordId:
            grant?.id ?? unresolvedRecordId('grant', input.grantId),
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!request || !grant) {
        return finalize(githubDeliveryRejection('not_found'), null)
      }
      if (
        request.requested_by_token_id !== identity.tokenRecordId ||
        grant.issued_to_token_id !== identity.tokenRecordId
      ) {
        return finalize(
          githubDeliveryRejection('project_forbidden'),
          request.state_version,
        )
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          request.state_version,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(
          githubDeliveryRejection('approval_required'),
          request.state_version,
        )
      }
      try {
        if (grant.status !== 'issuing' && grantFinalizationMatches(grant, input)) {
          return finalize(
            {
              ok: true,
              responseStatus: 200,
              outcomeCode: 'grant_finalized',
              replayed: true,
              request: mapDeliveryRequestRow(request),
              grant: mapCredentialGrantRow(grant),
            },
            request.state_version,
          )
        }
      } catch {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (
        request.state_version !== input.expectedStateVersion ||
        grant.version !== input.expectedGrantVersion
      ) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      if (request.status !== 'publishing_branch' || grant.status !== 'issuing') {
        return finalize(
          githubDeliveryRejection('grant_conflict'),
          request.state_version,
        )
      }
      const at = now().toISOString()
      let issuedAt: string | null = null
      let credentialExpiresAt: string | null = null
      if (input.outcome.status === 'issued') {
        try {
          issuedAt = toIso(input.outcome.issuedAt)
          credentialExpiresAt = toIso(input.outcome.credentialExpiresAt)
        } catch {
          return finalize(
            githubDeliveryRejection('invalid_state'),
            request.state_version,
          )
        }
        if (
          input.outcome.repositoryId !== request.repository_id ||
          input.outcome.permission !== 'contents:write' ||
          input.outcome.repositoryCount !== 1 ||
          Date.parse(issuedAt) < Date.parse(toIso(grant.requested_at)) ||
          Date.parse(credentialExpiresAt) <= Date.parse(issuedAt) ||
          Date.parse(credentialExpiresAt) >
            Date.parse(issuedAt) + 60 * 60 * 1_000 ||
          Date.parse(credentialExpiresAt) > Date.parse(toIso(request.expires_at))
        ) {
          return finalize(
            githubDeliveryRejection('invalid_state'),
            request.state_version,
          )
        }
      }
      const grantStatus = input.outcome.status
      const grantOutcome =
        input.outcome.status === 'issued' ? null : input.outcome.outcomeCode
      const [updatedGrant] = await tx.query<CredentialGrantRow>(
        `
          /* github_delivery:grant-finalize */
          UPDATE github_delivery_credential_grants
          SET version = version + 1,
              status = $5,
              issued_at = $6,
              credential_expires_at = $7,
              outcome_code = $8
          WHERE id = $1
            AND request_id = $2
            AND intent_revision = $3
            AND version = $4
            AND status = 'issuing'
          RETURNING ${credentialGrantColumns}
        `,
        [
          grant.id,
          request.id,
          request.intent_revision,
          input.expectedGrantVersion,
          grantStatus,
          issuedAt,
          credentialExpiresAt,
          grantOutcome,
        ],
      )
      if (!updatedGrant) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const requestStatus =
        input.outcome.status === 'issued'
          ? 'publishing_branch'
          : input.outcome.status === 'failed'
            ? 'failed'
            : 'recovery_required'
      const requestOutcome =
        input.outcome.status === 'issued' ? null : 'credential_issue_failed'
      const [updatedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-finalize-grant */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = $5,
              outcome_code = $6,
              updated_at = $7
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status = 'publishing_branch'
          RETURNING ${deliveryRequestColumns}
        `,
        [
          request.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          requestStatus,
          requestOutcome,
          at,
        ],
      )
      if (!updatedRequest) {
        throw new Error('GitHub Delivery grant finalization lost request CAS.')
      }
      return finalize(
        {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'grant_finalized',
          replayed: false,
          request: mapDeliveryRequestRow(updatedRequest),
          grant: mapCredentialGrantRow(updatedGrant),
        },
        updatedRequest.state_version,
      )
    })
  }

  async function recordGitHubBranchPublicationReport(
    input: RecordGitHubBranchPublicationReportInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationReportResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_branch_publication' as const
      const operationMeta = operationFingerprint(operation, ['report', input])
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadBearerIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const grant = request
        ? await lockGrantById(tx, request, input.grantId)
        : null
      const publication = request
        ? await loadCurrentPublication(tx, request)
        : null
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const recordId = publication?.id ?? createId('publication')
      const finalize = (
        result: GitHubBranchPublicationReportResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_branch_publication',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!request || !grant) {
        return finalize(githubDeliveryRejection('not_found'), null)
      }
      if (
        request.requested_by_token_id !== identity.tokenRecordId ||
        grant.issued_to_token_id !== identity.tokenRecordId
      ) {
        return finalize(
          githubDeliveryRejection('project_forbidden'),
          request.state_version,
        )
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          request.state_version,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(
          githubDeliveryRejection('approval_required'),
          request.state_version,
        )
      }
      const rearmablePublication = Boolean(
        publication &&
          ['recovery_required', 'conflict'].includes(publication.status),
      )
      const recoveringWithExistingGrant = Boolean(
        publication &&
          rearmablePublication &&
          publication.grant_id === grant.id &&
          request.status === 'recovery_required' &&
          grant.status === 'consumed',
      )
      const recoveringWithNewGrant = Boolean(
        publication &&
          rearmablePublication &&
          publication.grant_id !== grant.id &&
          request.status === 'publishing_branch' &&
          grant.status === 'issued',
      )
      if (publication) {
        if (
          publication.grant_id !== grant.id &&
          !recoveringWithNewGrant
        ) {
          return finalize(
            githubDeliveryRejection('publication_conflict'),
            request.state_version,
          )
        }
        if (
          (publication.status === 'verifying' ||
            publication.status === 'verified') &&
          publication.reported_outcome_code === input.reportedOutcomeCode
        ) {
          return finalize(
            {
              ok: true,
              responseStatus: 201,
              outcomeCode: 'publication_reported',
              replayed: true,
              request: mapDeliveryRequestRow(request),
              grant: mapCredentialGrantRow(grant),
              publication: mapBranchPublicationRow(publication),
            },
            request.state_version,
          )
        }
      }
      if (
        request.state_version !== input.expectedStateVersion ||
        grant.version !== input.expectedGrantVersion
      ) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const recovering =
        recoveringWithExistingGrant || recoveringWithNewGrant
      const at = now().toISOString()
      if (
        !recovering &&
        (request.status !== 'publishing_branch' ||
          grant.status !== 'issued' ||
          grant.credential_expires_at === null ||
          Date.parse(at) >= Date.parse(toIso(grant.credential_expires_at)))
      ) {
        return finalize(
          githubDeliveryRejection('grant_conflict'),
          request.state_version,
        )
      }

      let updatedGrant = grant
      let updatedPublication: BranchPublicationRow | undefined
      if (recovering && publication) {
        if (recoveringWithNewGrant) {
          if (
            grant.credential_expires_at === null ||
            Date.parse(at) >=
              Date.parse(toIso(grant.credential_expires_at))
          ) {
            return finalize(
              githubDeliveryRejection('grant_conflict'),
              request.state_version,
            )
          }
          const [consumed] = await tx.query<CredentialGrantRow>(
            `
              /* github_delivery:grant-consume */
              UPDATE github_delivery_credential_grants
              SET version = version + 1,
                  status = 'consumed',
                  consumed_at = $5
              WHERE id = $1
                AND request_id = $2
                AND intent_revision = $3
                AND version = $4
                AND status = 'issued'
              RETURNING ${credentialGrantColumns}
            `,
            [
              grant.id,
              request.id,
              request.intent_revision,
              input.expectedGrantVersion,
              at,
            ],
          )
          if (!consumed) {
            return finalize(
              githubDeliveryRejection('stale_version'),
              request.state_version,
            )
          }
          updatedGrant = consumed
        }
        const [rearmed] = await tx.query<BranchPublicationRow>(
          `
            /* github_delivery:publication-rearm */
            UPDATE github_branch_publications
            SET version = version + 1,
                grant_id = $5,
                status = 'verifying',
                reported_outcome_code = $6,
                verified_head_sha = NULL,
                reported_at = $7,
                verified_at = NULL,
                outcome_code = NULL
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status IN ('recovery_required', 'conflict')
            RETURNING ${branchPublicationColumns}
          `,
          [
            publication.id,
            request.id,
            request.intent_revision,
            publication.version,
            grant.id,
            input.reportedOutcomeCode,
            at,
          ],
        )
        updatedPublication = rearmed
      } else {
        const [consumed] = await tx.query<CredentialGrantRow>(
          `
            /* github_delivery:grant-consume */
            UPDATE github_delivery_credential_grants
            SET version = version + 1,
                status = 'consumed',
                consumed_at = $5
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'issued'
            RETURNING ${credentialGrantColumns}
          `,
          [
            grant.id,
            request.id,
            request.intent_revision,
            input.expectedGrantVersion,
            at,
          ],
        )
        if (!consumed) {
          return finalize(
            githubDeliveryRejection('stale_version'),
            request.state_version,
          )
        }
        updatedGrant = consumed
        const [created] = await tx.query<BranchPublicationRow>(
          `
            /* github_delivery:publication-create */
            INSERT INTO github_branch_publications (
              id,
              version,
              request_id,
              intent_revision,
              grant_id,
              status,
              reported_outcome_code,
              verified_head_sha,
              reported_at,
              verified_at,
              outcome_code
            )
            VALUES (
              $1, 1, $2, $3, $4, 'verifying', $5,
              NULL, $6, NULL, NULL
            )
            RETURNING ${branchPublicationColumns}
          `,
          [
            recordId,
            request.id,
            request.intent_revision,
            grant.id,
            input.reportedOutcomeCode,
            at,
          ],
        )
        updatedPublication = created
      }
      if (!updatedPublication) {
        throw new Error('GitHub Delivery publication reservation failed.')
      }
      const [updatedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-touch-publication */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = 'publishing_branch',
              outcome_code = NULL,
              updated_at = $5
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status IN ('publishing_branch', 'recovery_required')
          RETURNING ${deliveryRequestColumns}
        `,
        [
          request.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          at,
        ],
      )
      if (!updatedRequest) {
        throw new Error('GitHub Delivery publication lost request CAS.')
      }
      return finalize(
        {
          ok: true,
          responseStatus: 201,
          outcomeCode: 'publication_reported',
          replayed: false,
          request: mapDeliveryRequestRow(updatedRequest),
          grant: mapCredentialGrantRow(updatedGrant),
          publication: mapBranchPublicationRow(updatedPublication),
        },
        updatedRequest.state_version,
      )
    })
  }

  function publicationFinalizationMatches(
    publication: BranchPublicationRow,
    input: FinalizeGitHubBranchPublicationInput,
  ): boolean {
    const verifiedHeadSha = input.verification.verifiedHeadSha
      ? assertFullGitCommitSha(input.verification.verifiedHeadSha, 'Verified head')
      : null
    const verifiedAt =
      input.verification.verifiedAt === null
        ? null
        : toIso(input.verification.verifiedAt)
    return (
      publication.status === input.verification.status &&
      publication.verified_head_sha === verifiedHeadSha &&
      (publication.verified_at === null
        ? verifiedAt === null
        : toIso(publication.verified_at) === verifiedAt) &&
      publication.outcome_code === input.verification.outcomeCode
    )
  }

  async function finalizeGitHubBranchPublication(
    input: FinalizeGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationFinalizationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_branch_publication' as const
      const operationMeta = operationFingerprint(operation, ['finalize', input])
      await lockProject(
        tx,
        principal.session.organizationId,
        input.projectId,
      )
      const identity = await loadBearerIdentity(
        tx,
        principal,
        input.projectId,
        true,
      )
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const publication = request
        ? await lockPublicationById(tx, request, input.publicationId)
        : null
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const finalize = (
        result: GitHubBranchPublicationFinalizationResult,
        observedVersion: number | null,
      ) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_branch_publication',
          recordId:
            publication?.id ??
            unresolvedRecordId('publication', input.publicationId),
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!request || !publication) {
        return finalize(githubDeliveryRejection('not_found'), null)
      }
      if (request.requested_by_token_id !== identity.tokenRecordId) {
        return finalize(
          githubDeliveryRejection('project_forbidden'),
          request.state_version,
        )
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(
          githubDeliveryRejection('binding_inactive'),
          request.state_version,
        )
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(
          githubDeliveryRejection('approval_required'),
          request.state_version,
        )
      }
      try {
        if (
          publication.status !== 'verifying' &&
          publicationFinalizationMatches(publication, input)
        ) {
          return finalize(
            {
              ok: true,
              responseStatus: 200,
              outcomeCode:
                publication.status === 'verified'
                  ? 'publication_verified'
                  : 'publication_failed',
              replayed: true,
              request: mapDeliveryRequestRow(request),
              publication: mapBranchPublicationRow(publication),
            },
            request.state_version,
          )
        }
      } catch {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (
        request.state_version !== input.expectedStateVersion ||
        publication.version !== input.expectedPublicationVersion
      ) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      if (
        request.status !== 'publishing_branch' ||
        publication.status !== 'verifying'
      ) {
        return finalize(
          githubDeliveryRejection('publication_conflict'),
          request.state_version,
        )
      }
      let verifiedAt: string | null
      let verifiedHeadSha: string | null
      try {
        verifiedAt =
          input.verification.verifiedAt === null
            ? null
            : toIso(input.verification.verifiedAt)
        verifiedHeadSha = input.verification.verifiedHeadSha
          ? assertFullGitCommitSha(
              input.verification.verifiedHeadSha,
              'Verified head',
            )
          : null
      } catch {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (
        (verifiedAt !== null &&
          Date.parse(verifiedAt) < Date.parse(toIso(publication.reported_at))) ||
        ((input.verification.status === 'verified' ||
          input.verification.status === 'conflict') &&
          verifiedAt === null)
      ) {
        return finalize(
          githubDeliveryRejection('invalid_state'),
          request.state_version,
        )
      }
      if (
        input.verification.status === 'verified' &&
        verifiedHeadSha !== request.expected_commit_sha
      ) {
        return finalize(
          githubDeliveryRejection('publication_conflict'),
          request.state_version,
        )
      }
      const [updatedPublication] = await tx.query<BranchPublicationRow>(
        `
          /* github_delivery:publication-finalize */
          UPDATE github_branch_publications
          SET version = version + 1,
              status = $5,
              verified_head_sha = $6,
              verified_at = $7,
              outcome_code = $8
          WHERE id = $1
            AND request_id = $2
            AND intent_revision = $3
            AND version = $4
            AND status = 'verifying'
          RETURNING ${branchPublicationColumns}
        `,
        [
          publication.id,
          request.id,
          request.intent_revision,
          input.expectedPublicationVersion,
          input.verification.status,
          verifiedHeadSha,
          verifiedAt,
          input.verification.outcomeCode,
        ],
      )
      if (!updatedPublication) {
        return finalize(
          githubDeliveryRejection('stale_version'),
          request.state_version,
        )
      }
      const requestStatus =
        input.verification.status === 'verified'
          ? 'branch_published'
          : input.verification.status === 'failed'
            ? 'failed'
            : 'recovery_required'
      const requestOutcome =
        input.verification.status === 'verified'
          ? null
          : input.verification.status === 'conflict'
            ? 'branch_conflict'
            : 'branch_verification_failed'
      const at = now().toISOString()
      const [updatedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-finalize-publication */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = $5,
              outcome_code = $6,
              updated_at = $7
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status = 'publishing_branch'
          RETURNING ${deliveryRequestColumns}
        `,
        [
          request.id,
          identity.organizationId,
          identity.projectId,
          input.expectedStateVersion,
          requestStatus,
          requestOutcome,
          at,
        ],
      )
      if (!updatedRequest) {
        throw new Error('GitHub Delivery publication finalization lost request CAS.')
      }
      return finalize(
        {
          ok: true,
          responseStatus: 200,
          outcomeCode:
            input.verification.status === 'verified'
              ? 'publication_verified'
              : 'publication_failed',
          replayed: false,
          request: mapDeliveryRequestRow(updatedRequest),
          publication: mapBranchPublicationRow(updatedPublication),
        },
        updatedRequest.state_version,
      )
    })
  }

  async function reserveGitHubDraftPullRequest(
    input: ReserveGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_pull_request_create' as const
      const operationMeta = operationFingerprint(operation, ['reserve', input])
      await lockProject(tx, principal.session.organizationId, input.projectId)
      const identity = await loadBearerIdentity(tx, principal, input.projectId, true)
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const publication = request
        ? await lockPublicationById(tx, request, input.publicationId)
        : null
      const existing = request ? await loadCurrentPullRequest(tx, request) : null
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const existingIdempotency = await loadIdempotency(
        tx,
        identity,
        operation,
        operationMeta.idempotencyKey,
      )
      const recordId = existing?.id ?? createId('pull_request')
      const finalize = (result: GitHubPullRequestMutationResult, observedVersion: number | null) =>
        finalizeMutation(tx, {
          identity,
          operation,
          recordKind: 'github_pull_request',
          recordId,
          expectedVersion: input.expectedStateVersion,
          observedVersion,
          ...operationMeta,
          existingIdempotency,
          result,
        })
      if (!request || !publication) {
        return finalize(githubDeliveryRejection('not_found'), null)
      }
      if (request.requested_by_token_id !== identity.tokenRecordId) {
        return finalize(githubDeliveryRejection('project_forbidden'), request.state_version)
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(githubDeliveryRejection('binding_inactive'), request.state_version)
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity,
        runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id,
          runVersion: request.run_version,
          nodeId: request.node_id,
          tokenId: request.requested_by_token_id,
        })
      ) {
        return finalize(githubDeliveryRejection('invalid_state'), request.state_version)
      }
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(githubDeliveryRejection('approval_required'), request.state_version)
      }
      if (existing && ['creating', 'completed'].includes(existing.status)) {
        if (existing.publication_id !== publication.id) {
          return finalize(githubDeliveryRejection('pull_request_conflict'), request.state_version)
        }
        return finalize(
          {
            ok: true,
            responseStatus: 201,
            outcomeCode: 'pull_request_reserved',
            replayed: true,
            request: mapDeliveryRequestRow(request),
            pullRequest: mapPullRequestOutcomeRow(existing),
          },
          request.state_version,
        )
      }
      if (request.state_version !== input.expectedStateVersion) {
        return finalize(githubDeliveryRejection('stale_version'), request.state_version)
      }
      const recovering = Boolean(
        existing &&
          existing.status === 'recovery_required' &&
          request.status === 'recovery_required' &&
          existing.publication_id === publication.id,
      )
      if (
        (!recovering && request.status !== 'branch_published') ||
        publication.status !== 'verified' ||
        publication.verified_head_sha !== request.expected_commit_sha
      ) {
        return finalize(githubDeliveryRejection('publication_conflict'), request.state_version)
      }
      const at = now().toISOString()
      let pullRequest: PullRequestOutcomeRow | undefined
      if (recovering && existing) {
        const [rearmed] = await tx.query<PullRequestOutcomeRow>(
          `
            /* github_delivery:pull-request-rearm */
            UPDATE github_pull_request_outcomes
            SET version = version + 1,
                status = 'creating',
                pull_request_id = NULL,
                pull_request_number = NULL,
                safe_url = NULL,
                provider_created_at = NULL,
                recorded_at = $5,
                outcome_code = NULL
            WHERE id = $1
              AND request_id = $2
              AND intent_revision = $3
              AND version = $4
              AND status = 'recovery_required'
            RETURNING ${pullRequestOutcomeColumns}
          `,
          [existing.id, request.id, request.intent_revision, existing.version, at],
        )
        pullRequest = rearmed
      } else {
        const [created] = await tx.query<PullRequestOutcomeRow>(
          `
            /* github_delivery:pull-request-create */
            INSERT INTO github_pull_request_outcomes (
              id, version, request_id, intent_revision, publication_id, status,
              pull_request_id, pull_request_number, safe_url, draft,
              head_branch, base_branch, head_sha, provider_created_at,
              recorded_at, outcome_code
            )
            VALUES (
              $1, 1, $2, $3, $4, 'creating', NULL, NULL, NULL, true,
              $5, $6, $7, NULL, $8, NULL
            )
            RETURNING ${pullRequestOutcomeColumns}
          `,
          [
            recordId,
            request.id,
            request.intent_revision,
            publication.id,
            request.head_branch,
            request.base_branch,
            request.expected_commit_sha,
            at,
          ],
        )
        pullRequest = created
      }
      if (!pullRequest) throw new Error('GitHub Delivery PR reservation failed.')
      const [updatedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-start-pull-request */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1,
              status = 'creating_pr',
              outcome_code = NULL,
              updated_at = $5
          WHERE id = $1
            AND organization_id = $2
            AND project_id = $3
            AND state_version = $4
            AND status IN ('branch_published', 'recovery_required')
          RETURNING ${deliveryRequestColumns}
        `,
        [request.id, identity.organizationId, identity.projectId, input.expectedStateVersion, at],
      )
      if (!updatedRequest) throw new Error('GitHub Delivery PR reservation lost request CAS.')
      return finalize(
        {
          ok: true,
          responseStatus: 201,
          outcomeCode: 'pull_request_reserved',
          replayed: false,
          request: mapDeliveryRequestRow(updatedRequest),
          pullRequest: mapPullRequestOutcomeRow(pullRequest),
        },
        updatedRequest.state_version,
      )
    })
  }

  function validateCompletedPullRequest(
    request: DeliveryRequestRow,
    outcome: Extract<FinalizeGitHubDraftPullRequestInput['outcome'], { status: 'completed' }>,
  ): { pullRequestId: string; safeUrl: string; headSha: string; providerCreatedAt: string } | null {
    try {
      if (
        !/^[1-9][0-9]{0,19}$/u.test(outcome.pullRequestId) ||
        !Number.isSafeInteger(outcome.pullRequestNumber) ||
        outcome.pullRequestNumber < 1 ||
        outcome.draft !== true ||
        normalizeGitHubRepository(outcome.repository) !== request.repository_full_name ||
        assertSafeGitHubBranch(outcome.baseBranch) !== request.base_branch ||
        assertSafeGitHubBranch(outcome.headBranch, { requireDeliveryNamespace: true }) !== request.head_branch
      ) return null
      const headSha = assertFullGitCommitSha(outcome.headSha, 'PR head')
      if (headSha !== request.expected_commit_sha) return null
      const url = new URL(outcome.safeUrl)
      if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase() !== 'github.com' ||
        url.port || url.username || url.password || url.search || url.hash ||
        url.pathname.toLowerCase() !== `/${request.repository_full_name}/pull/${outcome.pullRequestNumber}`
      ) return null
      return {
        pullRequestId: outcome.pullRequestId,
        safeUrl: url.toString(),
        headSha,
        providerCreatedAt: toIso(outcome.providerCreatedAt),
      }
    } catch {
      return null
    }
  }

  async function finalizeGitHubDraftPullRequest(
    input: FinalizeGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
    if (principal.authentication.kind !== 'desktop_bearer') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    return withTeamDbTransaction(db, async (tx) => {
      const operation = 'github_pull_request_create' as const
      const operationMeta = operationFingerprint(operation, ['finalize', input])
      await lockProject(tx, principal.session.organizationId, input.projectId)
      const identity = await loadBearerIdentity(tx, principal, input.projectId, true)
      if (!identity?.hasProjectAccess || !identity.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      const request = await lockDeliveryById(tx, identity, input.requestId)
      const pullRequest = request
        ? await lockPullRequestById(tx, request, input.pullRequestOutcomeId)
        : null
      const publication = request && pullRequest
        ? await lockPublicationById(tx, request, pullRequest.publication_id)
        : null
      const approval = request ? await loadCurrentApproval(tx, request) : null
      const existingIdempotency = await loadIdempotency(
        tx, identity, operation, operationMeta.idempotencyKey,
      )
      const finalize = (result: GitHubPullRequestMutationResult, observedVersion: number | null) =>
        finalizeMutation(tx, {
          identity, operation, recordKind: 'github_pull_request',
          recordId: pullRequest?.id ??
            unresolvedRecordId('pull-request', input.pullRequestOutcomeId),
          expectedVersion: input.expectedStateVersion, observedVersion,
          ...operationMeta, existingIdempotency, result,
        })
      if (!request || !pullRequest || !publication) {
        return finalize(githubDeliveryRejection('not_found'), null)
      }
      if (request.requested_by_token_id !== identity.tokenRecordId) {
        return finalize(githubDeliveryRejection('project_forbidden'), request.state_version)
      }
      const binding = await lockBinding(tx, identity)
      if (!exactActiveBinding(binding, request)) {
        return finalize(githubDeliveryRejection('binding_inactive'), request.state_version)
      }
      const authority = await loadCanonicalDeliveryAuthority(tx, {
        identity, runId: request.run_id,
        requestedByUserId: request.requested_by_user_id,
        requestedByTokenId: request.requested_by_token_id,
      })
      if (
        !canonicalAuthorityMatches(authority, {
          runId: request.run_id, runVersion: request.run_version,
          nodeId: request.node_id, tokenId: request.requested_by_token_id,
        })
      ) return finalize(githubDeliveryRejection('invalid_state'), request.state_version)
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return finalize(githubDeliveryRejection('approval_required'), request.state_version)
      }

      let validated = input.outcome.status === 'completed'
        ? validateCompletedPullRequest(request, input.outcome)
        : null
      const isReplay = pullRequest.status !== 'creating' &&
        pullRequest.status === input.outcome.status &&
        (input.outcome.status !== 'completed'
          ? pullRequest.outcome_code === input.outcome.outcomeCode
          : Boolean(validated &&
              pullRequest.pull_request_id === validated.pullRequestId &&
              pullRequest.pull_request_number === input.outcome.pullRequestNumber &&
              pullRequest.safe_url === validated.safeUrl &&
              pullRequest.provider_created_at !== null &&
              toIso(pullRequest.provider_created_at) === validated.providerCreatedAt))
      if (isReplay) {
        return finalize({
          ok: true, responseStatus: 200,
          outcomeCode: pullRequest.status === 'completed' ? 'pull_request_completed' : 'pull_request_failed',
          replayed: true,
          request: mapDeliveryRequestRow(request),
          pullRequest: mapPullRequestOutcomeRow(pullRequest),
        }, request.state_version)
      }
      if (
        request.state_version !== input.expectedStateVersion ||
        pullRequest.version !== input.expectedPullRequestVersion
      ) return finalize(githubDeliveryRejection('stale_version'), request.state_version)
      if (request.status !== 'creating_pr' || pullRequest.status !== 'creating') {
        return finalize(githubDeliveryRejection('pull_request_conflict'), request.state_version)
      }
      const at = now().toISOString()
      if (
        input.outcome.status === 'completed' &&
        (!validated ||
          publication.status !== 'verified' ||
          publication.verified_at === null ||
          Date.parse(validated.providerCreatedAt) > Date.parse(at))
      ) return finalize(githubDeliveryRejection('pull_request_conflict'), request.state_version)

      const status = input.outcome.status
      const providerCreatedAt = validated?.providerCreatedAt ?? null
      const [updatedPullRequest] = await tx.query<PullRequestOutcomeRow>(
        `
          /* github_delivery:pull-request-finalize */
          UPDATE github_pull_request_outcomes
          SET version = version + 1,
              status = $5,
              pull_request_id = $6,
              pull_request_number = $7,
              safe_url = $8,
              provider_created_at = $9,
              recorded_at = $10,
              outcome_code = $11
          WHERE id = $1 AND request_id = $2 AND intent_revision = $3
            AND version = $4 AND status = 'creating'
          RETURNING ${pullRequestOutcomeColumns}
        `,
        [
          pullRequest.id, request.id, request.intent_revision,
          input.expectedPullRequestVersion, status,
          validated?.pullRequestId ?? null,
          input.outcome.status === 'completed' ? input.outcome.pullRequestNumber : null,
          validated?.safeUrl ?? null,
          providerCreatedAt,
          at,
          input.outcome.outcomeCode,
        ],
      )
      if (!updatedPullRequest) return finalize(githubDeliveryRejection('stale_version'), request.state_version)
      const requestStatus = status === 'completed' ? 'completed' : status
      const requestOutcome = status === 'completed' ? 'draft_pr_created' : 'pull_request_failed'
      const [updatedRequest] = await tx.query<DeliveryRequestRow>(
        `
          /* github_delivery:delivery-finalize-pull-request */
          UPDATE github_delivery_requests
          SET state_version = state_version + 1, status = $5,
              outcome_code = $6, updated_at = $7
          WHERE id = $1 AND organization_id = $2 AND project_id = $3
            AND state_version = $4 AND status = 'creating_pr'
          RETURNING ${deliveryRequestColumns}
        `,
        [request.id, identity.organizationId, identity.projectId,
          input.expectedStateVersion, requestStatus, requestOutcome, at],
      )
      if (!updatedRequest) throw new Error('GitHub Delivery PR finalization lost request CAS.')
      return finalize({
        ok: true, responseStatus: 200,
        outcomeCode: status === 'completed' ? 'pull_request_completed' : 'pull_request_failed',
        replayed: false,
        request: mapDeliveryRequestRow(updatedRequest),
        pullRequest: mapPullRequestOutcomeRow(updatedPullRequest),
      }, updatedRequest.state_version)
    })
  }

  return {
    getGitHubRepositoryBinding,
    upsertGitHubRepositoryBinding,
    revokeGitHubRepositoryBinding,
    createOrReviseGitHubDeliveryRequest,
    listGitHubDeliveryInbox,
    getGitHubDeliveryRecoverySnapshot,
    listGitHubDeliveryRequests,
    decideGitHubDeliveryRequest,
    reserveGitHubCredentialGrant,
    finalizeGitHubCredentialGrant,
    recordGitHubBranchPublicationReport,
    finalizeGitHubBranchPublication,
    reserveGitHubDraftPullRequest,
    finalizeGitHubDraftPullRequest,
  }
}
