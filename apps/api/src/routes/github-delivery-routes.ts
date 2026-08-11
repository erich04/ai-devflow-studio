import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
  type GitHubDeliveryIntent,
} from '@ai-devflow/shared'
import {
  cloneGitHubDeliveryApproval,
  cloneGitHubBranchPublication,
  cloneGitHubCredentialGrant,
  cloneGitHubDeliveryRequest,
  cloneGitHubPullRequestOutcome,
  cloneGitHubRepositoryBinding,
  githubDeliveryRejectionMessage,
} from '../repositories/github-delivery-contract'
import { getProjectMembershipRole, getProjectRole } from '../auth/session'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  GitHubDeliveryServiceError,
  type GitHubDeliveryService,
} from '../github-delivery-service'
import type {
  GitHubDeliveryRepository,
  GitHubDeliveryDesktopPrincipal,
  GitHubDeliveryRejectionResult,
  GitHubDeliverySessionPrincipal,
  GitHubRepositoryBindingMutationResult,
} from '../repositories/github-delivery-contract'

export type GitHubDeliveryRouteResult = {
  status: number
  body: unknown
}

export type ResolveGitHubDeliveryRouteOptions = {
  body?: unknown
  principal?: RequestPrincipal | null
}

const numericGitHubIdPattern = /^[1-9][0-9]{0,19}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u
const identifierPattern = /^[^\u0000-\u001f\u007f]{1,200}$/u

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isEmptyBody(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && Object.keys(value).length === 0)
  )
}

function parseBindingInput(value: unknown): {
  installationId: string
  repositoryId: string
  expectedStateVersion: number
} | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'installationId',
      'repositoryId',
      'expectedStateVersion',
    ]) ||
    typeof value.installationId !== 'string' ||
    !numericGitHubIdPattern.test(value.installationId) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 0
  ) {
    return null
  }
  return {
    installationId: value.installationId,
    repositoryId: value.repositoryId,
    expectedStateVersion: value.expectedStateVersion as number,
  }
}

function parseExpectedStateVersion(value: unknown): number | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['expectedStateVersion']) ||
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 1
  ) {
    return null
  }
  return value.expectedStateVersion as number
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
    value.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

function parseDeliveryIntent(value: unknown): GitHubDeliveryIntent | null {
  if (!isRecord(value) || !hasExactKeys(value, deliveryIntentKeys)) return null
  if (
    value.stateVersion !== 1 ||
    value.redacted !== true ||
    value.status !== 'approval_required' ||
    !Number.isSafeInteger(value.runVersion) ||
    (value.runVersion as number) < 1 ||
    !Number.isSafeInteger(value.repositoryBindingVersion) ||
    (value.repositoryBindingVersion as number) < 1 ||
    typeof value.installationId !== 'string' ||
    !numericGitHubIdPattern.test(value.installationId) ||
    typeof value.repositoryId !== 'string' ||
    !numericGitHubIdPattern.test(value.repositoryId) ||
    typeof value.repository !== 'string' ||
    normalizeGitHubRepository(value.repository) !== value.repository ||
    typeof value.baseBranch !== 'string' ||
    assertSafeGitHubBranch(value.baseBranch) !== value.baseBranch ||
    typeof value.headBranch !== 'string' ||
    assertSafeGitHubBranch(value.headBranch, { requireDeliveryNamespace: true }) !==
      value.headBranch ||
    typeof value.baseCommitSha !== 'string' ||
    assertFullGitCommitSha(value.baseCommitSha, 'Base commit') !==
      value.baseCommitSha ||
    typeof value.expectedCommitSha !== 'string' ||
    assertFullGitCommitSha(value.expectedCommitSha, 'Expected commit') !==
      value.expectedCommitSha ||
    value.baseCommitSha === value.expectedCommitSha ||
    typeof value.diffSourceDigest !== 'string' ||
    !sha256Pattern.test(value.diffSourceDigest) ||
    typeof value.testEvidenceDigest !== 'string' ||
    !sha256Pattern.test(value.testEvidenceDigest) ||
    typeof value.prPackageDigest !== 'string' ||
    !sha256Pattern.test(value.prPackageDigest) ||
    typeof value.intentDigest !== 'string' ||
    !sha256Pattern.test(value.intentDigest) ||
    typeof value.idempotencyKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.idempotencyKey) ||
    !intentIdentifierKeys.every(
      (key) =>
        typeof value[key] === 'string' &&
        identifierPattern.test(value[key] as string) &&
        (value[key] as string).trim() === value[key],
    ) ||
    !intentDateKeys.every((key) => isCanonicalDate(value[key])) ||
    !Array.isArray(value.changedPaths) ||
    value.changedPaths.length === 0 ||
    value.changedPaths.length > 200 ||
    !value.changedPaths.every(isSafeChangedPath) ||
    new Set(value.changedPaths).size !== value.changedPaths.length ||
    [...value.changedPaths].sort((left, right) => left.localeCompare(right)).some(
      (path, index) => path !== (value.changedPaths as string[])[index],
    )
  ) {
    return null
  }
  return value as GitHubDeliveryIntent
}

function parseSubmitInput(value: unknown): {
  intent: GitHubDeliveryIntent
  prTitle: string
  prBody: string
  expectedStateVersion: number
} | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'intent',
      'prTitle',
      'prBody',
      'expectedStateVersion',
    ]) ||
    typeof value.prTitle !== 'string' ||
    value.prTitle.length === 0 ||
    value.prTitle.length > 256 ||
    value.prTitle.trim() !== value.prTitle ||
    typeof value.prBody !== 'string' ||
    value.prBody.length > 65_536 ||
    value.prBody.includes('\u0000') ||
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 0
  ) {
    return null
  }
  let intent: GitHubDeliveryIntent | null
  try {
    intent = parseDeliveryIntent(value.intent)
  } catch {
    intent = null
  }
  if (!intent) return null
  return {
    intent,
    prTitle: value.prTitle,
    prBody: value.prBody,
    expectedStateVersion: value.expectedStateVersion as number,
  }
}

function parsePublicationInput(value: unknown): {
  grantId: string
  expectedStateVersion: number
  expectedGrantVersion: number
  reportedOutcomeCode: 'pushed' | 'already_present' | 'unknown'
} | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'grantId',
      'expectedStateVersion',
      'expectedGrantVersion',
      'reportedOutcomeCode',
    ]) ||
    typeof value.grantId !== 'string' ||
    !identifierPattern.test(value.grantId) ||
    value.grantId.trim() !== value.grantId ||
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 1 ||
    !Number.isSafeInteger(value.expectedGrantVersion) ||
    (value.expectedGrantVersion as number) < 1 ||
    (value.reportedOutcomeCode !== 'pushed' &&
      value.reportedOutcomeCode !== 'already_present' &&
      value.reportedOutcomeCode !== 'unknown')
  ) {
    return null
  }
  return {
    grantId: value.grantId,
    expectedStateVersion: value.expectedStateVersion as number,
    expectedGrantVersion: value.expectedGrantVersion as number,
    reportedOutcomeCode: value.reportedOutcomeCode,
  }
}

function parseDraftPullRequestInput(value: unknown): {
  publicationId: string
  expectedStateVersion: number
} | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['publicationId', 'expectedStateVersion']) ||
    typeof value.publicationId !== 'string' ||
    !identifierPattern.test(value.publicationId) ||
    value.publicationId.trim() !== value.publicationId ||
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 1
  ) {
    return null
  }
  return {
    publicationId: value.publicationId,
    expectedStateVersion: value.expectedStateVersion as number,
  }
}

function decodeIdentifier(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    if (
      decoded.length === 0 ||
      decoded.length > 200 ||
      decoded.trim() !== decoded ||
      decoded.includes('/')
    ) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

function badRequest(message: string): GitHubDeliveryRouteResult {
  return { status: 400, body: { error: 'bad_request', message } }
}

function unauthorized(): GitHubDeliveryRouteResult {
  return {
    status: 401,
    body: { error: 'unauthorized', message: 'Authentication required' },
  }
}

function authenticationForbidden(): GitHubDeliveryRouteResult {
  return {
    status: 403,
    body: {
      error: 'forbidden',
      message: 'This authentication method cannot perform that GitHub Delivery operation.',
      outcomeCode: 'authentication_forbidden',
      replayed: false,
    },
  }
}

function bindingMutationResult(
  result: GitHubRepositoryBindingMutationResult,
  principal: GitHubDeliverySessionPrincipal,
  projectId: string,
  allowedOutcomes: ReadonlySet<
    'binding_created' | 'binding_updated' | 'binding_revoked'
  >,
): GitHubDeliveryRouteResult {
  if (!result.ok) return rejectionResult(result)
  const expectedStatus = result.outcomeCode === 'binding_created' ? 201 : 200
  if (
    !allowedOutcomes.has(result.outcomeCode) ||
    result.responseStatus !== expectedStatus ||
    typeof result.replayed !== 'boolean' ||
    result.binding.organizationId !== principal.session.organizationId ||
    result.binding.teamProjectId !== projectId ||
    result.binding.redacted !== true ||
    (result.outcomeCode === 'binding_revoked' &&
      result.binding.status !== 'revoked') ||
    (result.outcomeCode !== 'binding_revoked' &&
      result.binding.status !== 'active')
  ) {
    throw new Error('Invalid GitHub Delivery repository result.')
  }
  return {
    status: result.responseStatus,
    body: {
      binding: cloneGitHubRepositoryBinding(result.binding),
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function rejectionResult(
  result: GitHubDeliveryRejectionResult,
): GitHubDeliveryRouteResult {
  const error =
    result.responseStatus === 403
      ? 'forbidden'
      : result.responseStatus === 404
        ? 'not_found'
        : result.responseStatus === 410
          ? 'gone'
          : 'conflict'
  return {
    status: result.responseStatus,
    body: {
      error,
      message: githubDeliveryRejectionMessage(result.outcomeCode),
      outcomeCode: result.outcomeCode,
      replayed: result.replayed,
    },
  }
}

function serviceFailureResult(
  error: GitHubDeliveryServiceError,
): GitHubDeliveryRouteResult {
  const invalidCodes = new Set([
    'github_invalid_request',
    'github_validation_failed',
  ])
  const conflictCodes = new Set([
    'github_conflict',
    'github_pull_request_conflict',
    'github_repository_mismatch',
    'github_scope_mismatch',
    'github_delivery_state_conflict',
  ])
  const unavailableCodes = new Set([
    'github_rate_limited',
    'github_timeout',
    'github_unavailable',
    'github_delivery_unavailable',
  ])
  const status = invalidCodes.has(error.code)
    ? 400
    : error.code === 'github_not_found'
      ? 404
      : conflictCodes.has(error.code)
        ? 409
        : unavailableCodes.has(error.code)
          ? 503
          : 502
  const routeError =
    status === 400
      ? 'bad_request'
      : status === 404
        ? 'not_found'
        : status === 409
          ? 'conflict'
          : status === 503
            ? 'service_unavailable'
            : 'bad_gateway'
  return {
    status,
    body: {
      error: routeError,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      phase: error.phase,
    },
  }
}

async function resolveGitHubDeliveryRouteUnchecked(
  method: string,
  pathname: string,
  repository: GitHubDeliveryRepository,
  service: GitHubDeliveryService,
  options: ResolveGitHubDeliveryRouteOptions = {},
): Promise<GitHubDeliveryRouteResult | null> {
  const bindingMatch = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/github-repository-binding$/,
  )
  const revokeMatch = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/github-repository-binding\/revoke$/,
  )
  const deliveryListMatch = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/github-deliveries$/,
  )
  const decisionMatch = pathname.match(
    /^\/api\/team\/projects\/([^/]+)\/github-deliveries\/([^/]+)\/(approve|reject)$/,
  )
  const submitMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries$/,
  )
  const inboxMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries\/inbox$/,
  )
  const recoveryMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries\/([^/]+)$/,
  )
  const credentialMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries\/([^/]+)\/credential-grant$/,
  )
  const publicationMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries\/([^/]+)\/branch-publication$/,
  )
  const pullRequestMatch = pathname.match(
    /^\/api\/desktop\/projects\/([^/]+)\/github-deliveries\/([^/]+)\/draft-pull-request$/,
  )
  const isBindingRoute =
    bindingMatch !== null && (method === 'GET' || method === 'PUT')
  const isRevokeRoute = revokeMatch !== null && method === 'POST'
  const isDeliveryListRoute = deliveryListMatch !== null && method === 'GET'
  const isDecisionRoute = decisionMatch !== null && method === 'POST'
  const isSubmitRoute = submitMatch !== null && method === 'POST'
  const isInboxRoute = inboxMatch !== null && method === 'GET'
  const isRecoveryRoute =
    recoveryMatch !== null && inboxMatch === null && method === 'GET'
  const isCredentialRoute = credentialMatch !== null && method === 'POST'
  const isPublicationRoute = publicationMatch !== null && method === 'POST'
  const isPullRequestRoute = pullRequestMatch !== null && method === 'POST'
  const isDesktopRoute =
    isSubmitRoute ||
    isInboxRoute ||
    isRecoveryRoute ||
    isCredentialRoute ||
    isPublicationRoute ||
    isPullRequestRoute
  if (
    !isBindingRoute &&
    !isRevokeRoute &&
    !isDeliveryListRoute &&
    !isDecisionRoute &&
    !isSubmitRoute &&
    !isInboxRoute &&
    !isRecoveryRoute &&
    !isCredentialRoute &&
    !isPublicationRoute &&
    !isPullRequestRoute
  ) {
    return null
  }

  const principal = options.principal
  if (!principal) return unauthorized()
  if (
    (isDesktopRoute && principal.authentication.kind !== 'desktop_bearer') ||
    (!isDesktopRoute && principal.authentication.kind !== 'session_cookie')
  ) {
    return authenticationForbidden()
  }

  const projectId = decodeIdentifier(
    (isBindingRoute
      ? bindingMatch?.[1]
      : isRevokeRoute
        ? revokeMatch?.[1]
        : isDeliveryListRoute
          ? deliveryListMatch?.[1]
          : isDecisionRoute
            ? decisionMatch?.[1]
            : isSubmitRoute
              ? submitMatch?.[1]
              : isInboxRoute
                ? inboxMatch?.[1]
                : isRecoveryRoute
                  ? recoveryMatch?.[1]
                  : isCredentialRoute
                    ? credentialMatch?.[1]
                    : isPublicationRoute
                      ? publicationMatch?.[1]
                      : pullRequestMatch?.[1]) ?? '',
  )
  if (projectId === null) {
    return badRequest('Invalid GitHub Delivery route identifier.')
  }
  const projectRole = isDesktopRoute
    ? getProjectMembershipRole(principal.session, projectId)
    : getProjectRole(principal.session, projectId)
  if (projectRole === null) {
    return {
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Project access required.',
        outcomeCode: 'project_forbidden',
        replayed: false,
      },
    }
  }
  if (
    (isInboxRoute || isRecoveryRoute || isDeliveryListRoute ||
      (isBindingRoute && method === 'GET')) &&
    !isEmptyBody(options.body)
  ) {
    return badRequest('GitHub Delivery read input must be empty.')
  }
  if (isSubmitRoute) {
    const parsed = parseSubmitInput(options.body)
    if (
      !parsed ||
      parsed.intent.organizationId !== principal.session.organizationId ||
      parsed.intent.teamProjectId !== projectId
    ) {
      return badRequest('Invalid GitHub Delivery request input.')
    }
    const result = await repository.createOrReviseGitHubDeliveryRequest(
      { projectId, ...parsed },
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (!result.ok) return rejectionResult(result)
    const expectedResponseStatus =
      result.outcomeCode === 'delivery_created' ? 201 : 200
    if (
      (result.outcomeCode !== 'delivery_created' &&
        result.outcomeCode !== 'delivery_revised') ||
      result.responseStatus !== expectedResponseStatus ||
      typeof result.replayed !== 'boolean' ||
      result.request.organizationId !== principal.session.organizationId ||
      result.request.projectId !== projectId ||
      result.request.localIntentId !== parsed.intent.id ||
      result.request.intentDigest !== parsed.intent.intentDigest ||
      result.request.logicalIdempotencyKey !== parsed.intent.idempotencyKey ||
      result.request.status !== 'approval_required' ||
      result.request.redacted !== true
    ) {
      throw new Error('Invalid GitHub Delivery repository result.')
    }
    return {
      status: result.responseStatus,
      body: {
        request: cloneGitHubDeliveryRequest(result.request),
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }
  if (isInboxRoute) {
    const records = await repository.listGitHubDeliveryInbox(
      projectId,
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (!Array.isArray(records)) {
      throw new Error('Invalid GitHub Delivery repository result.')
    }
    return {
      status: 200,
      body: {
        requests: records.map((request) => {
          if (
            request.organizationId !== principal.session.organizationId ||
            request.projectId !== projectId ||
            request.redacted !== true
          ) {
            throw new Error(
              'GitHub Delivery repository returned an out-of-scope request.',
            )
          }
          return cloneGitHubDeliveryRequest(request)
        }),
      },
    }
  }
  if (isRecoveryRoute) {
    const requestId = decodeIdentifier(recoveryMatch?.[2] ?? '')
    if (requestId === null) {
      return badRequest('Invalid GitHub Delivery route identifier.')
    }
    const snapshot = await repository.getGitHubDeliveryRecoverySnapshot(
      projectId,
      requestId,
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (snapshot === null) {
      return rejectionResult({
        ok: false,
        responseStatus: 404,
        outcomeCode: 'not_found',
        replayed: false,
      })
    }
    const { request, approval, grant, publication, pullRequest } = snapshot
    if (
      request.id !== requestId ||
      request.organizationId !== principal.session.organizationId ||
      request.projectId !== projectId ||
      request.redacted !== true ||
      (approval !== null &&
        (approval.requestId !== requestId ||
          approval.intentRevision !== request.intentRevision ||
          approval.redacted !== true)) ||
      (grant !== null &&
        (grant.requestId !== requestId ||
          grant.intentRevision !== request.intentRevision ||
          grant.redacted !== true)) ||
      (publication !== null &&
        (publication.requestId !== requestId ||
          publication.intentRevision !== request.intentRevision ||
          publication.redacted !== true)) ||
      (pullRequest !== null &&
        (pullRequest.requestId !== requestId ||
          pullRequest.intentRevision !== request.intentRevision ||
          pullRequest.redacted !== true))
    ) {
      throw new Error(
        'GitHub Delivery repository returned an out-of-scope recovery snapshot.',
      )
    }
    return {
      status: 200,
      body: {
        snapshot: {
          request: cloneGitHubDeliveryRequest(request),
          approval:
            approval === null ? null : cloneGitHubDeliveryApproval(approval),
          grant: grant === null ? null : cloneGitHubCredentialGrant(grant),
          publication:
            publication === null
              ? null
              : cloneGitHubBranchPublication(publication),
          pullRequest:
            pullRequest === null
              ? null
              : cloneGitHubPullRequestOutcome(pullRequest),
        },
      },
    }
  }
  if (isCredentialRoute) {
    const requestId = decodeIdentifier(credentialMatch?.[2] ?? '')
    const expectedStateVersion = parseExpectedStateVersion(options.body)
    if (requestId === null || expectedStateVersion === null) {
      return badRequest('Invalid GitHub credential grant input.')
    }
    const result = await service.issueCredentialGrant(
      { projectId, requestId, expectedStateVersion },
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (!result.ok) return rejectionResult(result)
    const credential = result.credential
    const expectedUrl = `https://github.com/${result.request.repository}.git`
    if (
      result.responseStatus !== 200 ||
      result.outcomeCode !== 'grant_finalized' ||
      typeof result.replayed !== 'boolean' ||
      result.request.organizationId !== principal.session.organizationId ||
      result.request.projectId !== projectId ||
      result.request.id !== requestId ||
      result.request.redacted !== true ||
      result.grant.requestId !== requestId ||
      result.grant.status !== 'issued' ||
      result.grant.permission !== 'contents:write' ||
      result.grant.repositoryCount !== 1 ||
      result.grant.redacted !== true ||
      credential.grantId !== result.grant.id ||
      credential.repositoryId !== result.request.repositoryId ||
      credential.repositoryId !== result.grant.repositoryId ||
      credential.username !== 'x-access-token' ||
      typeof credential.token !== 'string' ||
      credential.token.length === 0 ||
      credential.token.length > 5_000 ||
      !isCanonicalDate(credential.expiresAt) ||
      credential.expiresAt !== result.grant.credentialExpiresAt ||
      credential.canonicalHttpsUrl !== expectedUrl
    ) {
      throw new Error('Invalid GitHub Delivery service result.')
    }
    return {
      status: 200,
      body: {
        request: cloneGitHubDeliveryRequest(result.request),
        grant: cloneGitHubCredentialGrant(result.grant),
        credential: {
          grantId: credential.grantId,
          username: credential.username,
          token: credential.token,
          expiresAt: credential.expiresAt,
          repositoryId: credential.repositoryId,
          canonicalHttpsUrl: credential.canonicalHttpsUrl,
        },
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }
  if (isPublicationRoute) {
    const requestId = decodeIdentifier(publicationMatch?.[2] ?? '')
    const parsed = parsePublicationInput(options.body)
    if (requestId === null || !parsed) {
      return badRequest('Invalid GitHub branch publication input.')
    }
    const result = await service.verifyBranchPublication(
      { projectId, requestId, ...parsed },
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (!result.ok) return rejectionResult(result)
    if (
      result.responseStatus !== 200 ||
      (result.outcomeCode !== 'publication_verified' &&
        result.outcomeCode !== 'publication_failed') ||
      typeof result.replayed !== 'boolean' ||
      result.request.organizationId !== principal.session.organizationId ||
      result.request.projectId !== projectId ||
      result.request.id !== requestId ||
      result.request.redacted !== true ||
      result.publication.requestId !== requestId ||
      result.publication.grantId !== parsed.grantId ||
      result.publication.redacted !== true ||
      (result.outcomeCode === 'publication_verified' &&
        result.publication.status !== 'verified') ||
      (result.outcomeCode === 'publication_failed' &&
        result.publication.status === 'verified')
    ) {
      throw new Error('Invalid GitHub Delivery service result.')
    }
    return {
      status: 200,
      body: {
        request: cloneGitHubDeliveryRequest(result.request),
        publication: cloneGitHubBranchPublication(result.publication),
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }
  if (isPullRequestRoute) {
    const requestId = decodeIdentifier(pullRequestMatch?.[2] ?? '')
    const parsed = parseDraftPullRequestInput(options.body)
    if (requestId === null || !parsed) {
      return badRequest('Invalid GitHub Draft pull request input.')
    }
    const result = await service.createDraftPullRequest(
      { projectId, requestId, ...parsed },
      principal as GitHubDeliveryDesktopPrincipal,
    )
    if (!result.ok) return rejectionResult(result)
    if (
      result.responseStatus !== 200 ||
      (result.outcomeCode !== 'pull_request_completed' &&
        result.outcomeCode !== 'pull_request_failed') ||
      typeof result.replayed !== 'boolean' ||
      result.request.organizationId !== principal.session.organizationId ||
      result.request.projectId !== projectId ||
      result.request.id !== requestId ||
      result.request.redacted !== true ||
      result.pullRequest.requestId !== requestId ||
      result.pullRequest.publicationId !== parsed.publicationId ||
      result.pullRequest.redacted !== true ||
      result.pullRequest.draft !== true ||
      (result.outcomeCode === 'pull_request_completed' &&
        result.pullRequest.status !== 'completed') ||
      (result.outcomeCode === 'pull_request_failed' &&
        result.pullRequest.status === 'completed')
    ) {
      throw new Error('Invalid GitHub Delivery service result.')
    }
    return {
      status: 200,
      body: {
        request: cloneGitHubDeliveryRequest(result.request),
        pullRequest: cloneGitHubPullRequestOutcome(result.pullRequest),
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }
  if (isDeliveryListRoute) {
    const records = await repository.listGitHubDeliveryRequests(
      projectId,
      principal as GitHubDeliverySessionPrincipal,
    )
    if (!Array.isArray(records)) {
      throw new Error('Invalid GitHub Delivery repository result.')
    }
    return {
      status: 200,
      body: {
        requests: records.map((request) => {
          if (
            request.organizationId !== principal.session.organizationId ||
            request.projectId !== projectId ||
            request.redacted !== true
          ) {
            throw new Error(
              'GitHub Delivery repository returned an out-of-scope request.',
            )
          }
          return cloneGitHubDeliveryRequest(request)
        }),
      },
    }
  }
  if (isDecisionRoute) {
    if (projectRole !== 'lead' && projectRole !== 'owner') {
      return {
        status: 403,
        body: {
          error: 'forbidden',
          message: 'Lead or owner authority is required.',
          outcomeCode: 'role_forbidden',
          replayed: false,
        },
      }
    }
    const requestId = decodeIdentifier(decisionMatch?.[2] ?? '')
    if (requestId === null) {
      return badRequest('Invalid GitHub Delivery route identifier.')
    }
    const expectedStateVersion = parseExpectedStateVersion(options.body)
    if (expectedStateVersion === null) {
      return badRequest('Invalid GitHub Delivery decision input.')
    }
    const decision = decisionMatch?.[3] as 'approve' | 'reject'
    const result = await repository.decideGitHubDeliveryRequest(
      { projectId, requestId, decision, expectedStateVersion },
      principal as GitHubDeliverySessionPrincipal,
    )
    if (!result.ok) return rejectionResult(result)
    const expectedOutcome =
      decision === 'approve' ? 'delivery_approved' : 'delivery_rejected'
    if (
      result.responseStatus !== 200 ||
      result.outcomeCode !== expectedOutcome ||
      typeof result.replayed !== 'boolean' ||
      result.request.organizationId !== principal.session.organizationId ||
      result.request.projectId !== projectId ||
      result.request.id !== requestId ||
      result.request.redacted !== true ||
      (decision === 'approve' && result.request.status !== 'approved') ||
      (decision === 'reject' &&
        (result.request.status !== 'revoked' ||
          result.request.outcomeCode !== 'approval_rejected')) ||
      (decision === 'approve' && result.approval === null) ||
      (decision === 'reject' && result.approval !== null) ||
      (result.approval !== null &&
        (result.approval.requestId !== requestId ||
          result.approval.authenticationKind !== 'session_cookie' ||
          result.approval.redacted !== true))
    ) {
      throw new Error('Invalid GitHub Delivery repository result.')
    }
    return {
      status: 200,
      body: {
        request: cloneGitHubDeliveryRequest(result.request),
        approval:
          result.approval === null
            ? null
            : cloneGitHubDeliveryApproval(result.approval),
        outcomeCode: result.outcomeCode,
        replayed: result.replayed,
      },
    }
  }
  if (isBindingRoute && method === 'GET') {
    const binding = await repository.getGitHubRepositoryBinding(
      projectId,
      principal as GitHubDeliverySessionPrincipal,
    )
    if (binding === null) return { status: 200, body: { binding: null } }
    if (
      binding.organizationId !== principal.session.organizationId ||
      binding.teamProjectId !== projectId ||
      binding.redacted !== true
    ) {
      throw new Error('GitHub Delivery repository returned an out-of-scope binding.')
    }
    return {
      status: 200,
      body: { binding: cloneGitHubRepositoryBinding(binding) },
    }
  }
  if (projectRole !== 'owner') {
    return {
      status: 403,
      body: {
        error: 'forbidden',
        message: 'Owner authority is required.',
        outcomeCode: 'role_forbidden',
        replayed: false,
      },
    }
  }

  if (isRevokeRoute) {
    const expectedStateVersion = parseExpectedStateVersion(options.body)
    if (expectedStateVersion === null) {
      return badRequest('Invalid GitHub repository binding revocation input.')
    }
    return bindingMutationResult(
      await repository.revokeGitHubRepositoryBinding(
        { projectId, expectedStateVersion },
        principal as GitHubDeliverySessionPrincipal,
      ),
      principal as GitHubDeliverySessionPrincipal,
      projectId,
      new Set(['binding_revoked']),
    )
  }

  const parsed = parseBindingInput(options.body)
  if (!parsed) {
    return badRequest('Invalid GitHub repository binding input.')
  }
  const result = await service.configureRepositoryBinding(
    { projectId, ...parsed },
    principal as GitHubDeliverySessionPrincipal,
  )
  return bindingMutationResult(
    result,
    principal as GitHubDeliverySessionPrincipal,
    projectId,
    new Set(['binding_created', 'binding_updated']),
  )
}

export async function resolveGitHubDeliveryRoute(
  method: string,
  pathname: string,
  repository: GitHubDeliveryRepository,
  service: GitHubDeliveryService,
  options: ResolveGitHubDeliveryRouteOptions = {},
): Promise<GitHubDeliveryRouteResult | null> {
  try {
    return await resolveGitHubDeliveryRouteUnchecked(
      method,
      pathname,
      repository,
      service,
      options,
    )
  } catch (error) {
    if (error instanceof GitHubDeliveryServiceError) {
      return serviceFailureResult(error)
    }
    throw error
  }
}
