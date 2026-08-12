import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  GITHUB_CREDENTIAL_TOKEN_MAX_LENGTH,
  isGitHubCredentialToken,
  normalizeGitHubRepository,
} from '@ai-devflow/shared'
import {
  GITHUB_CREDENTIAL_MAX_TTL_MS,
  GITHUB_CREDENTIAL_PROVIDER_MAX_MS,
} from './repositories/github-delivery-contract'

const githubApiBaseUrl = 'https://api.github.com'
const githubWebHost = 'github.com'
const githubApiVersion = '2022-11-28'
const maxResponseBytes = 256 * 1_024
const maxPullRequestsPerLookup = 20
const numericIdPattern = /^[1-9][0-9]{0,15}$/u
const providerExpiryPattern = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{3}))?Z$/u
const imfFixdatePattern = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/u
const imfFixdateWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const imfFixdateMonths = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
const providerExpiryObservationSafetyMarginMs = 2_000
const idempotencyKeyPattern = /^github-delivery:([a-f0-9]{64})$/u
const embeddedMarkerPrefix = '<!-- devflow-delivery:'

export type GitHubAppJwtClaims = {
  iss: string
  iat: number
  exp: number
}

export type GitHubAppClientErrorCode =
  | 'github_credential_revocation_unconfirmed'
  | 'github_authentication_failed'
  | 'github_conflict'
  | 'github_forbidden'
  | 'github_invalid_request'
  | 'github_malformed_response'
  | 'github_not_found'
  | 'github_pull_request_conflict'
  | 'github_rate_limited'
  | 'github_repository_mismatch'
  | 'github_request_rejected'
  | 'github_response_too_large'
  | 'github_scope_mismatch'
  | 'github_timeout'
  | 'github_unauthorized'
  | 'github_unavailable'
  | 'github_validation_failed'

const safeErrorMessages: Record<GitHubAppClientErrorCode, string> = {
  github_credential_revocation_unconfirmed: 'GitHub credential revocation could not be confirmed',
  github_authentication_failed: 'GitHub App authentication failed',
  github_conflict: 'GitHub rejected the request because remote state conflicts',
  github_forbidden: 'GitHub denied the requested operation',
  github_invalid_request: 'GitHub App request is invalid',
  github_malformed_response: 'GitHub returned an invalid response',
  github_not_found: 'The requested GitHub resource was not found',
  github_pull_request_conflict: 'The GitHub pull request conflicts with the approved delivery',
  github_rate_limited: 'GitHub temporarily rate limited the request',
  github_repository_mismatch: 'The GitHub repository does not match the configured binding',
  github_request_rejected: 'GitHub rejected the request',
  github_response_too_large: 'GitHub returned a response larger than the safe limit',
  github_scope_mismatch: 'GitHub returned authority outside the requested repository scope',
  github_timeout: 'GitHub did not complete the request before the safe deadline',
  github_unauthorized: 'GitHub did not accept the supplied App authority',
  github_unavailable: 'GitHub is temporarily unavailable',
  github_validation_failed: 'GitHub could not validate the requested operation',
}

export class GitHubAppClientError extends Error {
  readonly code: GitHubAppClientErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly credentialRevocationConfirmed: boolean
  readonly providerCredentialAbsentConfirmed: boolean

  constructor(
    code: GitHubAppClientErrorCode,
    status?: number,
    credentialRevocationConfirmed = false,
    providerCredentialAbsentConfirmed = false,
  ) {
    super(safeErrorMessages[code])
    this.name = 'GitHubAppClientError'
    this.code = code
    this.retryable =
      code === 'github_rate_limited' || code === 'github_timeout' || code === 'github_unavailable'
    this.credentialRevocationConfirmed = credentialRevocationConfirmed
    this.providerCredentialAbsentConfirmed = providerCredentialAbsentConfirmed
    if (status !== undefined) {
      this.status = status
    }
  }

  toJSON(): {
    name: string
    code: GitHubAppClientErrorCode
    retryable: boolean
    status?: number
  } {
    const result: {
      name: string
      code: GitHubAppClientErrorCode
      retryable: boolean
      status?: number
    } = {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
    }
    if (this.status !== undefined) {
      result.status = this.status
    }
    return result
  }
}

export type CreateGitHubAppClientInput = {
  appId: string
  fetcher: typeof fetch
  clock: () => Date
  signJwt: (claims: GitHubAppJwtClaims) => Promise<string> | string
  requestTimeoutMs?: number
}

export type GitHubRepositoryAuthority = {
  installationId: string
  repositoryId: string
}

export type GitHubCredentialIssuanceAuthority = GitHubRepositoryAuthority & {
  issuanceDeadline: string
}

export type GitHubRepositoryContext = GitHubRepositoryAuthority & {
  repository: string
}

export type VerifiedGitHubRepository = GitHubRepositoryContext & {
  defaultBranch: string
  private: boolean
  visibility: 'public' | 'private' | 'internal'
  verifiedAt: string
}

export type GitHubRepositoryAccessToken = GitHubRepositoryAuthority & {
  token: string
  expiresAt: string
  providerExpiresAt: string
  permissions: { contents: 'write' }
}

export type GitHubProviderCredentialExpiryObservationInput = Pick<
  GitHubRepositoryAccessToken,
  'installationId' | 'providerExpiresAt'
>

export type GitHubProviderCredentialExpiryObservation =
  GitHubProviderCredentialExpiryObservationInput & {
    providerObservedAt: string
  }

export type GitHubBranchHead = {
  repository: string
  branch: string
  sha: string
  verifiedAt: string
}

export type GitHubDraftPullRequest = {
  id: string
  number: number
  url: string
  repository: string
  baseBranch: string
  headBranch: string
  headSha: string
  state: 'open'
  draft: true
  marker: string
  createdAt: string
}

export type GitHubDraftPullRequestIdentity = GitHubRepositoryContext & {
  baseBranch: string
  headBranch: string
  expectedHeadSha: string
  idempotencyKey: string
}

export type CreateGitHubDraftPullRequestInput = GitHubDraftPullRequestIdentity & {
  title: string
  body: string
}

export type GitHubDraftPullRequestResolution = {
  disposition: 'found' | 'created' | 'reconciled'
  pullRequest: GitHubDraftPullRequest
}

export type GitHubAppClient = {
  issueContentsWriteToken(
    input: GitHubCredentialIssuanceAuthority,
  ): Promise<GitHubRepositoryAccessToken>
  observeProviderCredentialExpiry(
    input: GitHubProviderCredentialExpiryObservationInput,
  ): Promise<GitHubProviderCredentialExpiryObservation>
  revokeInstallationAccessToken(token: string): Promise<void>
  verifyRepository(input: GitHubRepositoryAuthority): Promise<VerifiedGitHubRepository>
  getBranchHead(
    input: GitHubRepositoryContext & { branch: string },
  ): Promise<GitHubBranchHead>
  findDraftPullRequest(
    input: GitHubDraftPullRequestIdentity,
  ): Promise<GitHubDraftPullRequest | null>
  findOrCreateDraftPullRequest(
    input: CreateGitHubDraftPullRequestInput,
  ): Promise<GitHubDraftPullRequestResolution>
}

type InstallationPermission = 'contents' | 'pull_requests'
type InstallationPermissionLevel = 'read' | 'write'

type MintedInstallationToken = {
  token: string
  expiresAt: string
  providerExpiresAt: string
  installationId: string
  repositoryId: string
}

type NormalizedRepositoryContext = GitHubRepositoryContext

type NormalizedDraftIdentity = NormalizedRepositoryContext & {
  baseBranch: string
  headBranch: string
  expectedHeadSha: string
  marker: string
}

type NormalizedDraftInput = NormalizedDraftIdentity & {
  title: string
  body: string
  markedBody: string
}

function clientError(
  code: GitHubAppClientErrorCode,
  status?: number,
  credentialRevocationConfirmed = false,
  providerCredentialAbsentConfirmed = false,
): GitHubAppClientError {
  return new GitHubAppClientError(
    code,
    status,
    credentialRevocationConfirmed,
    providerCredentialAbsentConfirmed,
  )
}

function confirmedAbsentError(error: unknown): GitHubAppClientError {
  if (error instanceof GitHubAppClientError) {
    return clientError(error.code, error.status, false, true)
  }
  return clientError('github_invalid_request', undefined, false, true)
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw clientError('github_malformed_response')
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown): string {
  if (typeof value !== 'string') {
    throw clientError('github_malformed_response')
  }
  return value
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw clientError('github_malformed_response')
  }
  return value
}

function normalizeNumericId(value: string): string {
  if (!numericIdPattern.test(value)) {
    throw clientError('github_invalid_request')
  }
  const numericValue = Number(value)
  if (!Number.isSafeInteger(numericValue) || numericValue < 1) {
    throw clientError('github_invalid_request')
  }
  return String(numericValue)
}

function parseResponseNumericId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string' && numericIdPattern.test(value)) {
    const numericValue = Number(value)
    if (Number.isSafeInteger(numericValue) && numericValue > 0) {
      return String(numericValue)
    }
  }
  throw clientError('github_malformed_response')
}

function normalizeRepository(value: string): string {
  try {
    return normalizeGitHubRepository(value)
  } catch {
    throw clientError('github_invalid_request')
  }
}

function normalizeBranch(value: string): string {
  try {
    return assertSafeGitHubBranch(value)
  } catch {
    throw clientError('github_invalid_request')
  }
}

function normalizeDeliveryBranch(value: string): string {
  try {
    return assertSafeGitHubBranch(value, { requireDeliveryNamespace: true })
  } catch {
    throw clientError('github_invalid_request')
  }
}

function normalizeCommitSha(value: string): string {
  try {
    return assertFullGitCommitSha(value, 'GitHub commit')
  } catch {
    throw clientError('github_invalid_request')
  }
}

function parseCommitSha(value: unknown): string {
  if (typeof value !== 'string') {
    throw clientError('github_malformed_response')
  }
  try {
    return assertFullGitCommitSha(value, 'GitHub commit')
  } catch {
    throw clientError('github_malformed_response')
  }
}

function normalizeRepositoryContext(input: GitHubRepositoryContext): NormalizedRepositoryContext {
  if (typeof input !== 'object' || input === null) {
    throw clientError('github_invalid_request')
  }
  return {
    installationId: normalizeNumericId(input.installationId),
    repositoryId: normalizeNumericId(input.repositoryId),
    repository: normalizeRepository(input.repository),
  }
}

function normalizeAuthority(input: GitHubRepositoryAuthority): GitHubRepositoryAuthority {
  if (typeof input !== 'object' || input === null) {
    throw clientError('github_invalid_request')
  }
  return {
    installationId: normalizeNumericId(input.installationId),
    repositoryId: normalizeNumericId(input.repositoryId),
  }
}

function normalizeClockValue(clock: () => Date): Date {
  let value: Date
  try {
    value = clock()
  } catch {
    throw clientError('github_invalid_request')
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw clientError('github_invalid_request')
  }
  return value
}

function parseCanonicalIsoInstant(value: unknown, code: GitHubAppClientErrorCode): number {
  if (typeof value !== 'string') {
    throw clientError(code)
  }
  const instant = Date.parse(value)
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw clientError(code)
  }
  return instant
}

function parseProviderExpiry(value: unknown): number {
  if (typeof value !== 'string') {
    throw clientError('github_malformed_response')
  }
  const match = providerExpiryPattern.exec(value)
  if (!match) {
    throw clientError('github_malformed_response')
  }
  const [, year, month, day, hour, minute, second, millisecond = '000'] = match
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`
  const instant = Date.parse(normalized)
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== normalized) {
    throw clientError('github_malformed_response')
  }
  return instant
}

function parseStrictImfFixdate(value: string | null): number {
  if (value === null) {
    throw clientError('github_malformed_response')
  }
  const match = imfFixdatePattern.exec(value)
  if (!match) {
    throw clientError('github_malformed_response')
  }
  const [, weekday, rawDay, month, rawYear, rawHour, rawMinute, rawSecond] = match
  const day = Number(rawDay)
  const monthIndex = imfFixdateMonths.indexOf(month as typeof imfFixdateMonths[number])
  const year = Number(rawYear)
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  const second = Number(rawSecond)
  if (
    monthIndex < 0 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw clientError('github_malformed_response')
  }

  const parsed = new Date(0)
  parsed.setUTCHours(0, 0, 0, 0)
  parsed.setUTCFullYear(year, monthIndex, day)
  parsed.setUTCHours(hour, minute, second, 0)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second ||
    imfFixdateWeekdays[parsed.getUTCDay()] !== weekday
  ) {
    throw clientError('github_malformed_response')
  }
  return parsed.getTime()
}

function statusError(status: number): GitHubAppClientError {
  if (status === 401) {
    return clientError('github_unauthorized', status)
  }
  if (status === 403) {
    return clientError('github_forbidden', status)
  }
  if (status === 404) {
    return clientError('github_not_found', status)
  }
  if (status === 409) {
    return clientError('github_conflict', status)
  }
  if (status === 422) {
    return clientError('github_validation_failed', status)
  }
  if (status === 429) {
    return clientError('github_rate_limited', status)
  }
  if (status >= 500 && status <= 599) {
    return clientError('github_unavailable', status)
  }
  return clientError('github_request_rejected', status)
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    throw clientError('github_malformed_response')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      byteLength += next.value.byteLength
      if (byteLength > maxResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw clientError('github_response_too_large')
      }
      chunks.push(next.value)
    }
  } catch (error) {
    if (error instanceof GitHubAppClientError) {
      throw error
    }
    throw clientError('github_malformed_response')
  }

  if (byteLength === 0) {
    throw clientError('github_malformed_response')
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(text) as unknown
  } catch {
    throw clientError('github_malformed_response')
  }
}

function safeHeaders(authorization: string, includeJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization,
    'user-agent': 'AI DevFlow Studio',
    'x-github-api-version': githubApiVersion,
  }
  if (includeJsonBody) {
    headers['content-type'] = 'application/json'
  }
  return headers
}

function createClient(input: CreateGitHubAppClientInput): GitHubAppClient {
  if (
    !input ||
    typeof input.appId !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,100}$/u.test(input.appId) ||
    typeof input.fetcher !== 'function' ||
    typeof input.clock !== 'function' ||
    typeof input.signJwt !== 'function'
  ) {
    throw clientError('github_invalid_request')
  }
  const requestTimeoutMs = input.requestTimeoutMs ?? 30_000
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 10 ||
    requestTimeoutMs > GITHUB_CREDENTIAL_PROVIDER_MAX_MS
  ) {
    throw clientError('github_invalid_request')
  }

  const requestJson = async (
    url: string,
    request: {
      method: 'GET' | 'POST'
      authorization: string
      body?: Record<string, unknown>
      expectedStatus: number
    },
  ): Promise<unknown> => {
    const controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = (async () => {
      let response: Response
      try {
        response = await input.fetcher(url, {
          method: request.method,
          headers: safeHeaders(request.authorization, request.body !== undefined),
          signal: controller.signal,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        })
      } catch {
        throw clientError(timedOut ? 'github_timeout' : 'github_unavailable')
      }

      if (!(response instanceof Response)) {
        throw clientError('github_malformed_response')
      }
      if (response.status !== request.expectedStatus) {
        await response.body?.cancel().catch(() => undefined)
        throw statusError(response.status)
      }
      return readBoundedJson(response)
    })()
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(clientError('github_timeout'))
      }, requestTimeoutMs)
    })
    try {
      return await Promise.race([operation, deadline])
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }

  const requestProviderExpiryObservation = async (
    url: string,
    authorization: string,
  ): Promise<{ body: unknown; providerObservedAtMs: number }> => {
    const controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = (async () => {
      let response: Response
      try {
        response = await input.fetcher(url, {
          method: 'GET',
          headers: {
            ...safeHeaders(authorization, false),
            'cache-control': 'no-store',
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        })
      } catch {
        throw clientError(timedOut ? 'github_timeout' : 'github_unavailable')
      }

      if (!(response instanceof Response)) {
        throw clientError('github_malformed_response')
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw statusError(response.status)
      }
      if (response.redirected || response.url !== url) {
        await response.body?.cancel().catch(() => undefined)
        throw clientError('github_malformed_response')
      }
      const providerObservedAtMs = parseStrictImfFixdate(response.headers.get('date'))
      return {
        body: await readBoundedJson(response),
        providerObservedAtMs,
      }
    })()
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(clientError('github_timeout'))
      }, requestTimeoutMs)
    })
    try {
      return await Promise.race([operation, deadline])
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }

  const requestNoContent = async (
    url: string,
    request: {
      method: 'DELETE'
      authorization: string
      expectedStatus: 204
    },
  ): Promise<void> => {
    const controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = (async () => {
      let response: Response
      try {
        response = await input.fetcher(url, {
          method: request.method,
          headers: safeHeaders(request.authorization, false),
          signal: controller.signal,
        })
      } catch {
        throw clientError(timedOut ? 'github_timeout' : 'github_unavailable')
      }

      if (!(response instanceof Response)) {
        throw clientError('github_malformed_response')
      }
      if (response.status !== request.expectedStatus) {
        await response.body?.cancel().catch(() => undefined)
        throw statusError(response.status)
      }
      if (response.body !== null) {
        await response.body.cancel().catch(() => undefined)
        throw clientError('github_malformed_response')
      }
    })()
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(clientError('github_timeout'))
      }, requestTimeoutMs)
    })
    try {
      return await Promise.race([operation, deadline])
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }

  const revokeInstallationAccessToken = async (token: string): Promise<void> => {
    if (!isGitHubCredentialToken(token)) {
      throw clientError('github_invalid_request')
    }
    try {
      await requestNoContent(`${githubApiBaseUrl}/installation/token`, {
        method: 'DELETE',
        authorization: `Bearer ${token}`,
        expectedStatus: 204,
      })
    } catch {
      throw clientError('github_credential_revocation_unconfirmed')
    }
  }

  const compensateProviderToken = async (token: string): Promise<void> => {
    if (!/^[A-Za-z0-9._-]{16,16384}$/u.test(token)) {
      throw clientError('github_credential_revocation_unconfirmed')
    }
    try {
      await requestNoContent(`${githubApiBaseUrl}/installation/token`, {
        method: 'DELETE',
        authorization: `Bearer ${token}`,
        expectedStatus: 204,
      })
    } catch {
      throw clientError('github_credential_revocation_unconfirmed')
    }
  }

  const signAppJwt = async (absoluteDeadlineMs?: number): Promise<string> => {
    const current = normalizeClockValue(input.clock)
    const nowSeconds = Math.floor(current.getTime() / 1_000)
    // GitHub JWT expiry has whole-second precision. If the remaining authority
    // cannot be represented by a future exp, fail closed before signing.
    const deadlineSeconds = absoluteDeadlineMs === undefined
      ? nowSeconds + 540
      : Math.floor(absoluteDeadlineMs / 1_000)
    if (deadlineSeconds <= nowSeconds) {
      throw clientError('github_invalid_request')
    }
    let token: string
    try {
      token = await input.signJwt({
        iss: input.appId,
        iat: nowSeconds - 60,
        exp: Math.min(nowSeconds + 540, deadlineSeconds),
      })
    } catch {
      throw clientError('github_authentication_failed')
    }
    if (!isGitHubCredentialToken(token)) {
      throw clientError('github_authentication_failed')
    }
    return token
  }

  const mintInstallationToken = async (
    authority: GitHubRepositoryAuthority,
    permission: InstallationPermission,
    level: InstallationPermissionLevel,
    issuanceDeadline?: string,
  ): Promise<MintedInstallationToken> => {
    const tracksCredentialIssuance = permission === 'contents' && level === 'write'
    let normalized: GitHubRepositoryAuthority
    let appJwt: string
    try {
      normalized = normalizeAuthority(authority)
      let absoluteDeadlineMs: number | undefined
      if (tracksCredentialIssuance && issuanceDeadline === undefined) {
        throw clientError('github_invalid_request')
      }
      if (issuanceDeadline !== undefined) {
        absoluteDeadlineMs = Date.parse(issuanceDeadline)
        if (
          !Number.isFinite(absoluteDeadlineMs) ||
          new Date(absoluteDeadlineMs).toISOString() !== issuanceDeadline
        ) {
          throw clientError('github_invalid_request')
        }
      }
      appJwt = await signAppJwt(absoluteDeadlineMs)
      if (
        absoluteDeadlineMs !== undefined &&
        normalizeClockValue(input.clock).getTime() >= absoluteDeadlineMs
      ) {
        throw clientError('github_invalid_request')
      }
    } catch (error) {
      if (tracksCredentialIssuance) throw confirmedAbsentError(error)
      throw error
    }
    const response = expectRecord(
      await requestJson(
        `${githubApiBaseUrl}/app/installations/${normalized.installationId}/access_tokens`,
        {
          method: 'POST',
          authorization: `Bearer ${appJwt}`,
          body: {
            repository_ids: [Number(normalized.repositoryId)],
            permissions: { [permission]: level },
          },
          expectedStatus: 201,
        },
      ),
    )

    const token = expectString(response['token'])
    if (!/^[A-Za-z0-9._-]{16,}$/u.test(token)) {
      throw clientError('github_malformed_response')
    }

    try {
      if (token.length > GITHUB_CREDENTIAL_TOKEN_MAX_LENGTH) {
        throw clientError('github_malformed_response')
      }
      const expirationMs = parseProviderExpiry(response['expires_at'])
      const receivedAt = normalizeClockValue(input.clock)
      if (
        expirationMs <= receivedAt.getTime()
      ) {
        throw clientError('github_scope_mismatch')
      }
      // GitHub's one-hour lifetime starts on its clock when the credential is
      // created. A local clock that trails GitHub by even a millisecond must not
      // turn a valid response into a permanent issuance failure. Clamp the
      // locally enforced lifetime instead: this can only shorten authority.
      const enforcedExpirationMs = Math.min(
        expirationMs,
        receivedAt.getTime() + GITHUB_CREDENTIAL_MAX_TTL_MS,
      )

      if (response['repository_selection'] !== 'selected') {
        throw clientError('github_scope_mismatch')
      }

      const permissions = expectRecord(response['permissions'])
      for (const [name, value] of Object.entries(permissions)) {
        if (name === permission) {
          if (value !== level) {
            throw clientError('github_scope_mismatch')
          }
          continue
        }
        if (name !== 'metadata' || value !== 'read') {
          throw clientError('github_scope_mismatch')
        }
      }
      if (permissions[permission] !== level) {
        throw clientError('github_scope_mismatch')
      }

      const repositories = response['repositories']
      if (repositories !== undefined) {
        if (!Array.isArray(repositories) || repositories.length !== 1) {
          throw clientError('github_scope_mismatch')
        }
        const returnedRepository = expectRecord(repositories[0])
        if (parseResponseNumericId(returnedRepository['id']) !== normalized.repositoryId) {
          throw clientError('github_scope_mismatch')
        }
      }

      return {
        token,
        expiresAt: new Date(enforcedExpirationMs).toISOString(),
        providerExpiresAt: new Date(expirationMs).toISOString(),
        installationId: normalized.installationId,
        repositoryId: normalized.repositoryId,
      }
    } catch (error) {
      await compensateProviderToken(token)
      if (error instanceof GitHubAppClientError) {
        throw clientError(error.code, error.status, true)
      }
      throw clientError('github_malformed_response', undefined, true)
    }
  }

  const withInstallationToken = async <Result>(
    authority: GitHubRepositoryAuthority,
    permission: InstallationPermission,
    level: InstallationPermissionLevel,
    operation: (token: string) => Promise<Result>,
  ): Promise<Result> => {
    const grant = await mintInstallationToken(authority, permission, level)
    return operation(grant.token)
  }

  const parsePullRequest = (
    value: unknown,
    identity: NormalizedDraftIdentity,
  ): GitHubDraftPullRequest => {
    const response = expectRecord(value)
    const id = parseResponseNumericId(response['id'])
    const number = response['number']
    if (!Number.isSafeInteger(number) || typeof number !== 'number' || number < 1) {
      throw clientError('github_malformed_response')
    }

    const head = expectRecord(response['head'])
    const base = expectRecord(response['base'])
    const headRepository = expectRecord(head['repo'])
    const baseRepository = expectRecord(base['repo'])
    const headRef = expectString(head['ref'])
    const baseRef = expectString(base['ref'])

    let headRepositoryName: string
    let baseRepositoryName: string
    try {
      headRepositoryName = normalizeGitHubRepository(expectString(headRepository['full_name']))
      baseRepositoryName = normalizeGitHubRepository(expectString(baseRepository['full_name']))
    } catch (error) {
      if (error instanceof GitHubAppClientError) {
        throw error
      }
      throw clientError('github_malformed_response')
    }

    const headRepositoryId = parseResponseNumericId(headRepository['id'])
    const baseRepositoryId = parseResponseNumericId(baseRepository['id'])
    const parsedHeadSha = parseCommitSha(head['sha'])
    const body = expectString(response['body'])
    const markerOccurrences = body.split(identity.marker).length - 1

    if (
      response['state'] !== 'open' ||
      response['draft'] !== true ||
      headRef !== identity.headBranch ||
      baseRef !== identity.baseBranch ||
      headRepositoryName !== identity.repository ||
      baseRepositoryName !== identity.repository ||
      headRepositoryId !== identity.repositoryId ||
      baseRepositoryId !== identity.repositoryId ||
      parsedHeadSha !== identity.expectedHeadSha ||
      markerOccurrences !== 1
    ) {
      throw clientError('github_pull_request_conflict')
    }

    const rawUrl = expectString(response['html_url'])
    const rawCreatedAt = expectString(response['created_at'])
    const createdAtMs = Date.parse(rawCreatedAt)
    if (!Number.isFinite(createdAtMs)) {
      throw clientError('github_malformed_response')
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      throw clientError('github_malformed_response')
    }
    const expectedPath = `/${identity.repository}/pull/${number}`
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname.toLowerCase() !== githubWebHost ||
      parsedUrl.port !== '' ||
      parsedUrl.username !== '' ||
      parsedUrl.password !== '' ||
      parsedUrl.search !== '' ||
      parsedUrl.hash !== '' ||
      parsedUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()
    ) {
      throw clientError('github_malformed_response')
    }

    return {
      id,
      number,
      url: parsedUrl.toString(),
      repository: identity.repository,
      baseBranch: identity.baseBranch,
      headBranch: identity.headBranch,
      headSha: parsedHeadSha,
      state: 'open',
      draft: true,
      marker: identity.marker,
      createdAt: new Date(createdAtMs).toISOString(),
    }
  }

  const normalizeDraftIdentity = (
    delivery: GitHubDraftPullRequestIdentity,
  ): NormalizedDraftIdentity => {
    const context = normalizeRepositoryContext(delivery)
    return {
      ...context,
      baseBranch: normalizeBranch(delivery.baseBranch),
      headBranch: normalizeDeliveryBranch(delivery.headBranch),
      expectedHeadSha: normalizeCommitSha(delivery.expectedHeadSha),
      marker: createGitHubDeliveryMarker(delivery.idempotencyKey),
    }
  }

  const normalizeDraftInput = (
    delivery: CreateGitHubDraftPullRequestInput,
  ): NormalizedDraftInput => {
    const identity = normalizeDraftIdentity(delivery)
    if (
      typeof delivery.title !== 'string' ||
      delivery.title.length < 1 ||
      delivery.title.length > 256 ||
      delivery.title.trim() !== delivery.title ||
      /[\u0000-\u001f\u007f]/u.test(delivery.title)
    ) {
      throw clientError('github_invalid_request')
    }
    if (
      typeof delivery.body !== 'string' ||
      delivery.body.length > 60_000 ||
      delivery.body.includes('\u0000') ||
      delivery.body.includes(embeddedMarkerPrefix)
    ) {
      throw clientError('github_invalid_request')
    }
    return {
      ...identity,
      title: delivery.title,
      body: delivery.body,
      markedBody: delivery.body ? `${delivery.body}\n\n${identity.marker}` : identity.marker,
    }
  }

  const findDraftWithToken = async (
    identity: NormalizedDraftIdentity,
    token: string,
  ): Promise<GitHubDraftPullRequest | null> => {
    const [owner] = identity.repository.split('/')
    if (!owner) {
      throw clientError('github_invalid_request')
    }
    const url = new URL(`${githubApiBaseUrl}/repos/${identity.repository}/pulls`)
    url.searchParams.set('state', 'all')
    url.searchParams.set('base', identity.baseBranch)
    url.searchParams.set('head', `${owner}:${identity.headBranch}`)
    url.searchParams.set('per_page', String(maxPullRequestsPerLookup))

    const response = await requestJson(url.toString(), {
      method: 'GET',
      authorization: `Bearer ${token}`,
      expectedStatus: 200,
    })
    if (!Array.isArray(response) || response.length > maxPullRequestsPerLookup) {
      throw clientError('github_malformed_response')
    }

    const candidates: unknown[] = []
    for (const value of response) {
      const record = expectRecord(value)
      const head = expectRecord(record['head'])
      const base = expectRecord(record['base'])
      const headRepository = expectRecord(head['repo'])
      const baseRepository = expectRecord(base['repo'])
      let responseHeadRepository: string
      let responseBaseRepository: string
      try {
        responseHeadRepository = normalizeGitHubRepository(expectString(headRepository['full_name']))
        responseBaseRepository = normalizeGitHubRepository(expectString(baseRepository['full_name']))
      } catch (error) {
        if (error instanceof GitHubAppClientError) {
          throw error
        }
        throw clientError('github_malformed_response')
      }
      if (
        expectString(head['ref']) === identity.headBranch &&
        expectString(base['ref']) === identity.baseBranch &&
        responseHeadRepository === identity.repository &&
        responseBaseRepository === identity.repository
      ) {
        candidates.push(record)
      }
    }

    if (candidates.length === 0) {
      return null
    }
    if (candidates.length !== 1) {
      throw clientError('github_pull_request_conflict')
    }
    const candidate = expectRecord(candidates[0])
    const candidateBody = candidate['body']
    if (typeof candidateBody !== 'string' || !candidateBody.includes(identity.marker)) {
      throw clientError('github_pull_request_conflict')
    }
    return parsePullRequest(candidate, identity)
  }

  const createDraftWithToken = async (
    delivery: NormalizedDraftInput,
    token: string,
  ): Promise<GitHubDraftPullRequest> => {
    const response = await requestJson(
      `${githubApiBaseUrl}/repos/${delivery.repository}/pulls`,
      {
        method: 'POST',
        authorization: `Bearer ${token}`,
        body: {
          title: delivery.title,
          body: delivery.markedBody,
          head: delivery.headBranch,
          base: delivery.baseBranch,
          draft: true,
        },
        expectedStatus: 201,
      },
    )
    return parsePullRequest(response, delivery)
  }

  const shouldReconcileCreateFailure = (error: unknown): boolean =>
    error instanceof GitHubAppClientError &&
    [
      'github_conflict',
      'github_malformed_response',
      'github_rate_limited',
      'github_request_rejected',
      'github_response_too_large',
      'github_timeout',
      'github_unavailable',
      'github_validation_failed',
    ].includes(error.code)

  return {
    async issueContentsWriteToken(authority) {
      let issuanceDeadline: string | undefined
      try {
        issuanceDeadline = authority.issuanceDeadline
      } catch (error) {
        throw confirmedAbsentError(error)
      }
      const grant = await mintInstallationToken(
        authority,
        'contents',
        'write',
        issuanceDeadline,
      )
      return {
        token: grant.token,
        expiresAt: grant.expiresAt,
        providerExpiresAt: grant.providerExpiresAt,
        installationId: grant.installationId,
        repositoryId: grant.repositoryId,
        permissions: { contents: 'write' },
      }
    },

    async observeProviderCredentialExpiry(observationInput) {
      let normalizedInstallationId: string
      let normalizedProviderExpiresAt: string
      let providerExpiresAtMs: number
      let configuredAppId: string
      try {
        if (typeof observationInput !== 'object' || observationInput === null) {
          throw clientError('github_invalid_request')
        }
        normalizedInstallationId = normalizeNumericId(observationInput.installationId)
        normalizedProviderExpiresAt = observationInput.providerExpiresAt
        providerExpiresAtMs = parseCanonicalIsoInstant(
          normalizedProviderExpiresAt,
          'github_invalid_request',
        )
        configuredAppId = normalizeNumericId(input.appId)
      } catch (error) {
        if (error instanceof GitHubAppClientError) throw error
        throw clientError('github_invalid_request')
      }

      const appJwt = await signAppJwt()
      const observation = await requestProviderExpiryObservation(
        `${githubApiBaseUrl}/app/installations/${normalizedInstallationId}`,
        `Bearer ${appJwt}`,
      )
      const body = expectRecord(observation.body)
      const observedInstallationId = parseResponseNumericId(body['id'])
      const observedAppId = parseResponseNumericId(body['app_id'])
      if (
        observedInstallationId !== normalizedInstallationId ||
        observedAppId !== configuredAppId
      ) {
        throw clientError('github_conflict')
      }

      // Application safety premise: GitHub's HTTP Date is at most one second
      // ahead of the clock used to validate this credential. HTTP does not
      // supply that skew bound; the extra second is our fail-closed margin.
      if (
        observation.providerObservedAtMs <
        providerExpiresAtMs + providerExpiryObservationSafetyMarginMs
      ) {
        throw clientError('github_conflict')
      }
      return {
        installationId: normalizedInstallationId,
        providerExpiresAt: normalizedProviderExpiresAt,
        providerObservedAt: new Date(observation.providerObservedAtMs).toISOString(),
      }
    },

    async revokeInstallationAccessToken(token) {
      await revokeInstallationAccessToken(token)
    },

    async verifyRepository(repositoryInput) {
      const authority = normalizeAuthority(repositoryInput)
      return withInstallationToken(authority, 'contents', 'read', async (token) => {
        const response = expectRecord(
          await requestJson(`${githubApiBaseUrl}/repositories/${authority.repositoryId}`, {
            method: 'GET',
            authorization: `Bearer ${token}`,
            expectedStatus: 200,
          }),
        )
        const returnedId = parseResponseNumericId(response['id'])
        let returnedRepository: string
        let defaultBranch: string
        try {
          returnedRepository = normalizeGitHubRepository(expectString(response['full_name']))
          defaultBranch = assertSafeGitHubBranch(expectString(response['default_branch']))
        } catch (error) {
          if (error instanceof GitHubAppClientError) {
            throw error
          }
          throw clientError('github_malformed_response')
        }
        const isPrivate = expectBoolean(response['private'])
        const archived = expectBoolean(response['archived'])
        const disabled = expectBoolean(response['disabled'])
        const visibility = response['visibility']
        if (visibility !== 'public' && visibility !== 'private' && visibility !== 'internal') {
          throw clientError('github_malformed_response')
        }
        if (
          returnedId !== authority.repositoryId ||
          archived ||
          disabled
        ) {
          throw clientError('github_repository_mismatch')
        }
        return {
          ...authority,
          repository: returnedRepository,
          defaultBranch,
          private: isPrivate,
          visibility,
          verifiedAt: normalizeClockValue(input.clock).toISOString(),
        }
      })
    },

    async getBranchHead(branchInput) {
      const context = normalizeRepositoryContext(branchInput)
      const branch = normalizeBranch(branchInput.branch)
      return withInstallationToken(context, 'contents', 'read', async (token) => {
        const response = expectRecord(
          await requestJson(
            `${githubApiBaseUrl}/repos/${context.repository}/git/ref/heads/${encodeURIComponent(branch)}`,
            {
              method: 'GET',
              authorization: `Bearer ${token}`,
              expectedStatus: 200,
            },
          ),
        )
        if (response['ref'] !== `refs/heads/${branch}`) {
          throw clientError('github_malformed_response')
        }
        const object = expectRecord(response['object'])
        if (object['type'] !== 'commit') {
          throw clientError('github_malformed_response')
        }
        return {
          repository: context.repository,
          branch,
          sha: parseCommitSha(object['sha']),
          verifiedAt: normalizeClockValue(input.clock).toISOString(),
        }
      })
    },

    async findDraftPullRequest(delivery) {
      const identity = normalizeDraftIdentity(delivery)
      return withInstallationToken(identity, 'pull_requests', 'write', (token) =>
        findDraftWithToken(identity, token),
      )
    },

    async findOrCreateDraftPullRequest(delivery) {
      const normalized = normalizeDraftInput(delivery)
      return withInstallationToken(normalized, 'pull_requests', 'write', async (token) => {
        const existing = await findDraftWithToken(normalized, token)
        if (existing) {
          return { disposition: 'found', pullRequest: existing }
        }
        try {
          const created = await createDraftWithToken(normalized, token)
          return { disposition: 'created', pullRequest: created }
        } catch (error) {
          if (!shouldReconcileCreateFailure(error)) {
            throw error
          }
          try {
            const reconciled = await findDraftWithToken(normalized, token)
            if (reconciled) {
              return { disposition: 'reconciled', pullRequest: reconciled }
            }
          } catch (reconciliationError) {
            if (
              reconciliationError instanceof GitHubAppClientError &&
              reconciliationError.code === 'github_pull_request_conflict'
            ) {
              throw reconciliationError
            }
          }
          throw error
        }
      })
    },
  }
}

export function createGitHubDeliveryMarker(idempotencyKey: string): string {
  const match = idempotencyKeyPattern.exec(idempotencyKey)
  if (!match?.[1]) {
    throw clientError('github_invalid_request')
  }
  return `<!-- devflow-delivery:${match[1]} -->`
}

export const createGitHubAppClient = createClient
