import { randomUUID } from 'node:crypto'
import {
  buildAgentReviewContext,
  assertAgentProviderNameAvailable,
  canOverrideBlockedGate,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createGeneratedAgentProviderId,
  createWarnOnlyDefaultPolicy,
  createOpenAiCompatibleAgentProvider,
  evaluateRuntimeBudgetGuard,
  type AgentProvider,
  type GateOverrideDecision,
  formatUsd,
  type KnowledgeChunk,
  type KnowledgeDocument,
  parseRemoteAgentReviewSummary,
  parseRemoteCodingAgentSummary,
  parseRemoteAgentMemorySummary,
  parseRemoteAgentRuntimeSummary,
  parseRemoteAgentCoordinationSummary,
  parseRemoteRunSummary,
  parseRemoteTestEvidenceSummary,
  type OrganizationEnforcementPolicy,
  resolveDevFlowRuntimeFlags,
  redactLocalAbsolutePaths,
  redactSecrets,
  redactSensitiveText,
  resolveEffectivePolicy,
  runBudgetedKnowledgeReviewAgent,
  validateEnforcementPolicy,
  type ProviderCredentialMetadata,
  type RemoteAgentReviewSummary,
  type RemoteAgentMemorySummary,
  type RemoteAgentRuntimeSummary,
  type RemoteAgentCoordinationSummary,
  type RemoteCodingAgentSummary,
  type RuntimeBudgetApproval,
  type RuntimeBudgetPolicy,
  type RemoteRunSummary,
  type RemoteTestEvidenceSummary,
  type TeamSession,
  type TestEvidence,
  type WorkflowRun,
  requireAgentProviderName,
  resolveAgentProviderDisplayName,
} from '@ai-devflow/shared'
import { canAccessProject, canSyncProject, getProjectMembershipRole } from '../auth/session'
import type { GitHubOAuthClient } from '../auth/github-oauth'
import type { RequestPrincipal } from '../auth/request-auth'
import {
  decryptAgentCredential,
  encryptAgentCredential,
  maskAgentCredential,
} from '../agent-credentials'
import {
  CanonicalRunRequiredError,
  RemoteChildSummaryConflictError,
  RemoteRunSummaryConflictError,
  TeamProjectScopeError,
  type RunsBundle,
  type TeamOverviewPayload,
  type TeamRepository,
} from '../repositories/team-repository'
import { clearSessionCookie, createSessionCookie } from '../auth/session-cookie'
import { resolveWorkRequestRoute } from './work-request-routes'
import { resolveGateCommandRoute } from './gate-command-routes'
import { evaluateTeamGateEnforcement } from '../repositories/team-gate-enforcement'
import { isLoopbackHost } from '../server-config'

const defaultKnowledgeDocuments: KnowledgeDocument[] = []
const defaultKnowledgeChunks: KnowledgeChunk[] = []

function isFakeRuntimeEnabled(): boolean {
  return resolveDevFlowRuntimeFlags({
    DEVFLOW_ENABLE_FAKE_RUNTIME: process.env.DEVFLOW_ENABLE_FAKE_RUNTIME,
  }).fakeRuntimeEnabled
}

export type ApiRouteResult = {
  status: number
  headers?: Record<string, string | string[]>
  body: unknown
}

export type ResolveTeamRouteOptions = {
  auth?: {
    sessionSecret: string
    createState?: () => string
    secureCookies?: boolean
  }
  body?: unknown
  cookies?: Record<string, string | undefined>
  githubOAuth?: GitHubOAuthClient
  localAuth?: {
    enabled: boolean
    requestContentType?: string
    requestHost?: string
    requestOrigin?: string
    webAppUrl: string
  }
  postAuthRedirectUrl?: string
  principal?: RequestPrincipal | null
  session?: TeamSession | null
  searchParams?: URLSearchParams
}

type AgentProviderCredentialInput = {
  name: string
  providerId?: string
  apiKey: string
  model: string
  baseUrl?: string
}

type KnowledgeReviewInput = {
  runId: string
  nodeId: string
  projectId: string
  providerId?: string
  runtimeBudgetApprovalId?: string
}

type EnforcementEvaluateInput = {
  runId: string
  nodeId: string
  projectId: string
}

type GateOverrideInput = EnforcementEvaluateInput & {
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
}

type RuntimeBudgetPolicyInput = {
  projectId: string
  enabled: boolean
  monthlyLimitUsd: number
  warningThresholdUsd: number
}

type RuntimeBudgetEvaluateInput = {
  projectId: string
  providerId: string
  projectedCostUsd: number
  approvalId?: string
}

type RuntimeBudgetApprovalInput = {
  projectId: string
  providerId: string
  requestedBy: string
  maxAdditionalCostUsd: number
  reason: string
  expiresAt: string
}

type TeamProjectCreateInput = {
  name: string
  slug: string
  description: string
  repository: string
  defaultBranch?: string
  knowledgeBasePath?: string
  testCommand?: string
}

type DesktopPairingExchangeInput = {
  code: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasSameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const raw = value[key]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Invalid ${key}`)
  }

  return raw.trim()
}

function readRequiredNumber(value: Record<string, unknown>, key: string): number {
  const raw = value[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`Invalid ${key}`)
  }

  return raw
}

function parseProviderCredential(value: unknown): AgentProviderCredentialInput {
  if (!isRecord(value)) {
    throw new Error('Invalid provider credential payload')
  }

  const baseUrl = value['baseUrl']
  const legacyProviderId = value['providerId']
  const providerId =
    typeof legacyProviderId === 'string' && legacyProviderId.trim()
      ? legacyProviderId.trim()
      : undefined

  return {
    name: requireAgentProviderName(
      value['name'] ?? (providerId ? resolveAgentProviderDisplayName({ providerId }) : undefined),
    ),
    ...(providerId ? { providerId } : {}),
    apiKey: readRequiredString(value, 'apiKey'),
    model: readRequiredString(value, 'model'),
    ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
  }
}

function parseKnowledgeReviewInput(value: unknown): KnowledgeReviewInput {
  if (!isRecord(value)) {
    throw new Error('Invalid Gate Review payload')
  }

  const providerId = value['providerId']
  const runtimeBudgetApprovalId = value['runtimeBudgetApprovalId']

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
    ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}),
    ...(typeof runtimeBudgetApprovalId === 'string' && runtimeBudgetApprovalId.trim()
      ? { runtimeBudgetApprovalId: runtimeBudgetApprovalId.trim() }
      : {}),
  }
}

function parseEnforcementEvaluateInput(value: unknown): EnforcementEvaluateInput {
  if (!isRecord(value)) {
    throw new Error('Invalid enforcement evaluate payload')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
  }
}

function parseGateOverrideInput(value: unknown): GateOverrideInput {
  if (!isRecord(value)) {
    throw new Error('Invalid gate override payload')
  }

  const blockedReasonIds = value['blockedReasonIds']
  const policyVersion = value['policyVersion']

  if (!Array.isArray(blockedReasonIds) || blockedReasonIds.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid blockedReasonIds')
  }

  if (typeof policyVersion !== 'number') {
    throw new Error('Invalid policyVersion')
  }

  return {
    ...parseEnforcementEvaluateInput(value),
    reason: readRequiredString(value, 'reason'),
    blockedReasonIds,
    policyVersion,
  }
}

function parseRuntimeBudgetPolicyInput(value: unknown): RuntimeBudgetPolicyInput {
  if (!isRecord(value)) {
    throw new Error('Invalid runtime budget policy payload')
  }
  const enabled = value['enabled']
  if (typeof enabled !== 'boolean') {
    throw new Error('Invalid enabled')
  }
  const monthlyLimitUsd = readRequiredNumber(value, 'monthlyLimitUsd')
  const warningThresholdUsd = readRequiredNumber(value, 'warningThresholdUsd')
  if (monthlyLimitUsd < 0 || warningThresholdUsd < 0 || warningThresholdUsd > monthlyLimitUsd) {
    throw new Error('Invalid runtime budget thresholds')
  }
  return {
    projectId: readRequiredString(value, 'projectId'),
    enabled,
    monthlyLimitUsd,
    warningThresholdUsd,
  }
}

function parseRuntimeBudgetEvaluateInput(value: unknown): RuntimeBudgetEvaluateInput {
  if (!isRecord(value)) {
    throw new Error('Invalid runtime budget evaluate payload')
  }
  const approvalId = value['approvalId']
  return {
    projectId: readRequiredString(value, 'projectId'),
    providerId: readRequiredString(value, 'providerId'),
    projectedCostUsd: readRequiredNumber(value, 'projectedCostUsd'),
    ...(typeof approvalId === 'string' && approvalId.trim() ? { approvalId: approvalId.trim() } : {}),
  }
}

function parseRuntimeBudgetApprovalInput(value: unknown): RuntimeBudgetApprovalInput {
  if (!isRecord(value)) {
    throw new Error('Invalid runtime budget approval payload')
  }
  const maxAdditionalCostUsd = readRequiredNumber(value, 'maxAdditionalCostUsd')
  if (maxAdditionalCostUsd <= 0) {
    throw new Error('Invalid maxAdditionalCostUsd')
  }
  return {
    projectId: readRequiredString(value, 'projectId'),
    providerId: readRequiredString(value, 'providerId'),
    requestedBy: readRequiredString(value, 'requestedBy'),
    maxAdditionalCostUsd,
    reason: readRequiredString(value, 'reason'),
    expiresAt: readRequiredString(value, 'expiresAt'),
  }
}

function parseTeamProjectCreateInput(value: unknown): TeamProjectCreateInput {
  if (!isRecord(value)) {
    throw new Error('Invalid project payload')
  }

  const slug = readRequiredString(value, 'slug')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Invalid slug')
  }

  const defaultBranch = value['defaultBranch']
  const knowledgeBasePath = value['knowledgeBasePath']
  const testCommand = value['testCommand']

  return {
    name: readRequiredString(value, 'name'),
    slug,
    description: readRequiredString(value, 'description'),
    repository: readRequiredString(value, 'repository'),
    ...(typeof defaultBranch === 'string' && defaultBranch.trim()
      ? { defaultBranch: defaultBranch.trim() }
      : {}),
    ...(typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim()
      ? { knowledgeBasePath: knowledgeBasePath.trim() }
      : {}),
    ...(typeof testCommand === 'string' ? { testCommand: testCommand.trim() } : {}),
  }
}

function parseDesktopPairingExchangeInput(value: unknown): DesktopPairingExchangeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid desktop pairing payload')
  }

  return {
    code: readRequiredString(value, 'code'),
  }
}

function parseOrganizationPolicyInput(value: unknown): OrganizationEnforcementPolicy {
  if (!isRecord(value) || !isRecord(value['organizationPolicy'])) {
    throw new Error('Invalid enforcement policy payload')
  }

  const policy = value['organizationPolicy'] as OrganizationEnforcementPolicy
  validateEnforcementPolicy(policy)
  return policy
}

function toTestEvidence(summary: RemoteTestEvidenceSummary): TestEvidence {
  return {
    ...summary,
    cwd: '',
    stdout: '',
    stderr: '',
    redacted: true,
  }
}

function badRequest(message: string): ApiRouteResult {
  return {
    status: 400,
    body: {
      error: 'bad_request',
      message,
    },
  }
}

function unauthorized(message = 'Authentication required'): ApiRouteResult {
  return {
    status: 401,
    body: {
      error: 'unauthorized',
      message,
    },
  }
}

function forbidden(message: string): ApiRouteResult {
  return {
    status: 403,
    body: {
      error: 'forbidden',
      message,
    },
  }
}

function notFound(message: string): ApiRouteResult {
  return {
    status: 404,
    body: {
      error: 'not_found',
      message,
    },
  }
}

function conflict(message: string): ApiRouteResult {
  return {
    status: 409,
    body: {
      error: 'conflict',
      message,
    },
  }
}

function serviceUnavailable(message: string): ApiRouteResult {
  return {
    status: 503,
    body: {
      error: 'service_unavailable',
      message,
    },
  }
}

function parseRequestHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null
  try {
    const parsed = new URL(`http://${hostHeader}`)
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

async function acceptCanonicalRunEvidence<T>(upload: () => Promise<T>): Promise<ApiRouteResult> {
  try {
    return {
      status: 202,
      body: await upload(),
    }
  } catch (error) {
    if (
      error instanceof CanonicalRunRequiredError ||
      error instanceof RemoteChildSummaryConflictError
    ) {
      return conflict(error.message)
    }
    throw error
  }
}

async function acceptCanonicalRunSummary<T>(upload: () => Promise<T>): Promise<ApiRouteResult> {
  try {
    return {
      status: 202,
      body: await upload(),
    }
  } catch (error) {
    if (error instanceof RemoteRunSummaryConflictError) {
      return conflict(error.message)
    }
    throw error
  }
}

function createOAuthStateCookie(state: string, secure = false): string {
  return `devflow_oauth_state=${state}; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax; Path=/; Max-Age=600`
}

function clearOAuthStateCookie(secure = false): string {
  return `devflow_oauth_state=; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax; Path=/; Max-Age=0`
}

function filterRunsBundleForSession(bundle: RunsBundle, session: TeamSession): RunsBundle {
  const runs = bundle.runs.filter((run) => canAccessProject(session, run.projectId))
  const runIds = new Set(runs.map((run) => run.id))

  return {
    runs,
    artifacts: bundle.artifacts.filter((artifact) => runIds.has(artifact.runId)),
    events: bundle.events.filter((event) => runIds.has(event.runId)),
  }
}

function filterOverviewForSession(
  overview: TeamOverviewPayload,
  session: TeamSession,
): TeamOverviewPayload {
  const projects = overview.projects.filter((project) => canAccessProject(session, project.id))
  const projectIds = new Set(projects.map((project) => project.id))
  const runs = overview.runs.filter((run) => projectIds.has(run.projectId))
  const runIds = new Set(runs.map((run) => run.id))
  const projectCost = overview.projectCost.filter((rollup) => projectIds.has(rollup.key))
  const organizationPolicy =
    overview.enforcementPolicies.organizationPolicy.organizationId === session.organizationId
      ? overview.enforcementPolicies.organizationPolicy
      : createWarnOnlyDefaultPolicy({ organizationId: session.organizationId })
  const projectOverrides = overview.enforcementPolicies.projectOverrides.filter((override) =>
    projectIds.has(override.projectId),
  )

  return {
    projects,
    members: overview.members,
    runs,
    projectCost,
    memberCost: projects.length === overview.projects.length ? overview.memberCost : [],
    totalCost: formatUsd(projectCost.reduce((sum, rollup) => sum + rollup.costUsd, 0)),
    testEvidenceSummaries: overview.testEvidenceSummaries.filter((evidence) =>
      projectIds.has(evidence.projectId) && runIds.has(evidence.runId),
    ),
    agentReviews: overview.agentReviews.filter(
      (review) => projectIds.has(review.projectId) && runIds.has(review.runId),
    ),
    agentTraces: overview.agentTraces.filter((trace) => runIds.has(trace.runId)),
    agentTokenUsage: overview.agentTokenUsage.filter(
      (usage) => projectIds.has(usage.projectId) && runIds.has(usage.runId),
    ),
    agentProviders: overview.agentProviders,
    codingAgentSummaries: overview.codingAgentSummaries.filter((summary) =>
      projectIds.has(summary.projectId) && runIds.has(summary.runId),
    ),
    agentRuntimeSummaries: overview.agentRuntimeSummaries.filter((summary) =>
      projectIds.has(summary.projectId) && runIds.has(summary.runId),
    ),
    agentMemorySummaries: overview.agentMemorySummaries.filter((summary) =>
      projectIds.has(summary.projectId) && runIds.has(summary.runId),
    ),
    agentCoordinationSummaries: overview.agentCoordinationSummaries.filter((summary) =>
      projectIds.has(summary.projectId) && runIds.has(summary.runId),
    ),
    policyAwareDeliverySummaries: overview.policyAwareDeliverySummaries.filter(
      (summary) =>
        projectIds.has(summary.projectId) && (!summary.runId || runIds.has(summary.runId)),
    ),
    enforcementPolicies: {
      organizationPolicy,
      projectOverrides,
      effectivePolicies: projects.map((project) => ({
        ...resolveEffectivePolicy(
          organizationPolicy,
          projectOverrides.find((override) => override.projectId === project.id) ?? null,
        ),
        projectId: project.id,
      })),
      gateOverrides: overview.enforcementPolicies.gateOverrides.filter((override) =>
        projectIds.has(override.projectId) && runIds.has(override.runId),
      ),
    },
    runtimeBudgetPolicies: overview.runtimeBudgetPolicies.filter((policy) =>
      projectIds.has(policy.projectId),
    ),
    runtimeBudgetApprovals: overview.runtimeBudgetApprovals.filter((approval) =>
      projectIds.has(approval.projectId),
    ),
  }
}

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
  options: ResolveTeamRouteOptions = {},
): Promise<ApiRouteResult | null> {
  if (
    method === 'POST' &&
    pathname === '/api/auth/local/start' &&
    options.localAuth?.enabled === true
  ) {
    if (!options.auth) {
      return serviceUnavailable('Local development authentication is unavailable')
    }
    if (options.body !== undefined) {
      return badRequest('Local development sign-in requires an empty request body')
    }

    const webOrigin = new URL(options.localAuth.webAppUrl).origin
    const webHostname = new URL(webOrigin).hostname.toLowerCase()
    const requestHostname = parseRequestHostname(options.localAuth.requestHost)
    const requestContentType = options.localAuth.requestContentType
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase()
    if (
      !options.localAuth.requestOrigin ||
      options.localAuth.requestOrigin !== webOrigin ||
      requestContentType !== 'application/x-www-form-urlencoded' ||
      !requestHostname ||
      !isLoopbackHost(requestHostname) ||
      requestHostname !== webHostname
    ) {
      return forbidden(
        'Local development sign-in requires an empty form from the configured loopback Web origin',
      )
    }

    const result = await repository.resolveOrBootstrapLocalDevelopmentIdentity()
    if (result.status === 'blocked') {
      return {
        status: 409,
        body: {
          error: 'organization_exists',
          message: 'Local development identity cannot bootstrap into an existing organization',
        },
      }
    }

    const redirectTo = new URL('/legacy-shell', webOrigin).toString()
    return {
      status: 303,
      headers: {
        location: redirectTo,
        'set-cookie': createSessionCookie(
          { authAccountId: result.identity.authAccount.id },
          options.auth.sessionSecret,
          { secure: options.auth.secureCookies === true },
        ),
      },
      body: { redirectTo },
    }
  }

  if (method === 'GET' && pathname === '/api/auth/github/start') {
    if (!options.githubOAuth || !options.auth) {
      return badRequest('GitHub OAuth is not configured')
    }

    const state = options.auth.createState?.() ?? randomUUID()
    const redirectTo = options.githubOAuth.createAuthorizationUrl({ state })
    return {
      status: 302,
      headers: {
        location: redirectTo,
        'set-cookie': createOAuthStateCookie(
          state,
          options.auth.secureCookies === true,
        ),
      },
      body: { redirectTo },
    }
  }

  if (method === 'GET' && pathname === '/api/auth/github/callback') {
    if (!options.githubOAuth || !options.auth) {
      return badRequest('GitHub OAuth is not configured')
    }

    const code = options.searchParams?.get('code')?.trim()
    const state = options.searchParams?.get('state')?.trim()
    if (!code || !state || options.cookies?.['devflow_oauth_state'] !== state) {
      return badRequest('Invalid GitHub OAuth callback')
    }

    const profile = await options.githubOAuth.exchangeCodeForProfile({ code })
    const result = await repository.resolveOrBootstrapGitHubIdentity(profile)
    if (result.status === 'blocked') {
      return forbidden('GitHub account is not linked to this organization')
    }

    const sessionCookie = createSessionCookie(
      { authAccountId: result.identity.authAccount.id },
      options.auth.sessionSecret,
      { secure: options.auth.secureCookies === true },
    )
    const redirectTo = options.postAuthRedirectUrl ?? '/'

    return {
      status: 302,
      headers: {
        location: redirectTo,
        'set-cookie': [
          sessionCookie,
          clearOAuthStateCookie(options.auth.secureCookies === true),
        ],
      },
      body: { redirectTo },
    }
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    return {
      status: 204,
      headers: {
        'set-cookie': clearSessionCookie({
          secure: options.auth?.secureCookies === true,
        }),
      },
      body: null,
    }
  }

  if (method === 'GET' && pathname === '/api/auth/session') {
    if (!options.principal) {
      return unauthorized()
    }
    if (options.principal.authentication.kind !== 'session_cookie') {
      return forbidden('A browser session is required')
    }

    const { session } = options.principal
    if (!('authAccountId' in session)) {
      return unauthorized()
    }
    const identity = await repository.getAuthenticatedIdentityByAuthAccountId(
      session.authAccountId,
    )
    if (!identity) {
      return unauthorized()
    }

    return {
      status: 200,
      body: {
        user: {
          id: identity.user.id,
          name: identity.user.name,
          role: identity.user.role,
        },
        authentication: {
          provider: identity.authAccount.provider,
        },
      },
    }
  }

  const workRequestResult = await resolveWorkRequestRoute(method, pathname, repository, {
    body: options.body,
    ...(options.principal !== undefined ? { principal: options.principal } : {}),
  })
  if (workRequestResult) {
    return workRequestResult
  }

  const gateCommandResult = await resolveGateCommandRoute(method, pathname, repository, {
    body: options.body,
    ...(options.principal !== undefined ? { principal: options.principal } : {}),
  })
  if (gateCommandResult) {
    return gateCommandResult
  }

  if (method === 'GET' && pathname === '/api/runs') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterRunsBundleForSession(
        await repository.getRunsBundle(options.session),
        options.session,
      ),
    }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/runs/')) {
    if (!options.session) {
      return unauthorized()
    }

    const rawRunId = pathname.slice('/api/runs/'.length)
    const runId = decodeURIComponent(rawRunId).trim()
    if (!runId) {
      return badRequest('Invalid runId')
    }

    const bundle = await repository.getRunsBundle(options.session)
    const run = bundle.runs.find((candidate) => candidate.id === runId)
    if (!run) {
      return notFound(`Run not found: ${runId}`)
    }

    if (!canAccessProject(options.session, run.projectId)) {
      return forbidden('Project access required')
    }

    if (!canSyncProject(options.session, run.projectId, 'lead')) {
      return forbidden('Project role lead required')
    }

    const result = await repository.deleteRun(runId, options.session)
    if (!result.deleted) {
      return conflict(result.message)
    }

    return {
      status: 200,
      body: result,
    }
  }

  if (method === 'GET' && pathname === '/api/team/overview') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterOverviewForSession(
        await repository.getTeamOverview(options.session),
        options.session,
      ),
    }
  }

  if (method === 'POST' && pathname === '/api/team/projects') {
    if (!options.session) {
      return unauthorized()
    }

    if (options.session.role !== 'owner') {
      return forbidden('Organization owner role required')
    }

    let input: TeamProjectCreateInput
    try {
      input = parseTeamProjectCreateInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid project payload')
    }

    return {
      status: 201,
      body: await repository.createProject(input, options.session),
    }
  }

  const projectPairingMatch = pathname.match(/^\/api\/team\/projects\/([^/]+)\/pairing-codes$/)
  if (method === 'POST' && projectPairingMatch) {
    if (!options.session) {
      return unauthorized()
    }

    if (options.principal?.authentication.kind !== 'session_cookie') {
      return forbidden('Signed browser session required')
    }

    const projectId = decodeURIComponent(projectPairingMatch[1] ?? '')
    if (!projectId) {
      return badRequest('Invalid projectId')
    }

    if (!canSyncProject(options.session, projectId, 'lead')) {
      return forbidden('Project role lead required')
    }

    const overview = await repository.getTeamOverview(options.session)
    if (!overview.projects.some((project) => project.id === projectId)) {
      return notFound('Project not found')
    }

    try {
      return {
        status: 201,
        body: await repository.createDesktopPairingCode({ projectId }, options.session),
      }
    } catch (error) {
      if (error instanceof TeamProjectScopeError) {
        return notFound('Project not found')
      }
      throw error
    }
  }

  if (method === 'POST' && pathname === '/api/desktop/pairing/exchange') {
    let input: DesktopPairingExchangeInput
    try {
      input = parseDesktopPairingExchangeInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid desktop pairing payload')
    }

    try {
      return {
        status: 201,
        body: await repository.exchangeDesktopPairingCode(input),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to exchange desktop pairing code'
      return message.includes('expired') || message.includes('invalid')
        ? unauthorized('Desktop pairing code is invalid or expired. Reconnect DevFlow Studio.')
        : badRequest(message)
    }
  }

  if (method === 'GET' && pathname === '/api/skills') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { skills: await repository.getSkills(options.session) },
    }
  }

  if (method === 'GET' && pathname === '/api/mcp') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { servers: await repository.getMcpServers(options.session) },
    }
  }

  if (method === 'GET' && pathname === '/api/enforcement/policy') {
    if (!options.session) {
      return unauthorized()
    }

    const projectId = options.searchParams?.get('projectId')
    if (!projectId) {
      return badRequest('Invalid projectId')
    }

    if (!canAccessProject(options.session, projectId)) {
      return forbidden('Project access required')
    }

    return {
      status: 200,
      body: await repository.getEnforcementPolicy(projectId, options.session),
    }
  }

  if (method === 'PUT' && pathname === '/api/enforcement/policy') {
    if (!options.session) {
      return unauthorized()
    }

    if (options.session.role !== 'owner') {
      return forbidden('Organization owner role required')
    }

    let policy: OrganizationEnforcementPolicy
    try {
      policy = parseOrganizationPolicyInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid enforcement policy payload')
    }

    if (policy.organizationId !== options.session.organizationId) {
      return forbidden('Organization policy must match the authenticated organization')
    }

    return {
      status: 200,
      body: await repository.saveEnforcementPolicy(policy, options.session),
    }
  }

  if (method === 'POST' && pathname === '/api/enforcement/evaluate') {
    if (!options.session) {
      return unauthorized()
    }

    let input: EnforcementEvaluateInput
    try {
      input = parseEnforcementEvaluateInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid enforcement evaluate payload')
    }

    try {
      const { decision } = await evaluateTeamGateEnforcement(repository, options.session, input)
      return { status: 200, body: decision }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to evaluate enforcement'
      return message.includes('access') ? forbidden(message) : badRequest(message)
    }
  }

  if (method === 'POST' && pathname === '/api/gates/override') {
    if (!options.session) {
      return unauthorized()
    }

    let input: GateOverrideInput
    try {
      input = parseGateOverrideInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid gate override payload')
    }

    try {
      const { run, node, decision } = await evaluateTeamGateEnforcement(repository, options.session, input)
      if (decision.policyVersion !== input.policyVersion) {
        return forbidden('Policy version is stale; re-evaluate before overriding')
      }
      const canonicalBlockedReasonIds = decision.blockingReasons.map((reason) => reason.id)
      if (!hasSameStringSet(input.blockedReasonIds, canonicalBlockedReasonIds)) {
        return forbidden('Gate blockers changed; re-evaluate before overriding')
      }
      const reason = redactSecrets(redactLocalAbsolutePaths(input.reason).value).value
      const projectRole = getProjectMembershipRole(options.session, input.projectId)
      if (!projectRole) {
        return forbidden('Lead override is not allowed for this Gate')
      }

      if (!canOverrideBlockedGate({
        userRole: projectRole,
        userId: options.session.userId,
        run,
        node,
        enforcement: decision,
        reason,
      })) {
        return forbidden('Lead override is not allowed for this Gate')
      }

      const timestamp = new Date().toISOString()
      const override: GateOverrideDecision = {
        id: `gate-override-${input.runId}-${input.nodeId}-${timestamp}`,
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        userId: options.session.userId,
        role: projectRole,
        reason,
        blockedReasonIds: [...canonicalBlockedReasonIds].sort(),
        policyVersion: input.policyVersion,
        provisional: false,
        status: 'accepted',
        createdAt: timestamp,
      }

      return {
        status: 201,
        body: await repository.saveGateOverride(override, options.session),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save gate override'
      return message.includes('access') ? forbidden(message) : badRequest(message)
    }
  }

  if (method === 'GET' && pathname === '/api/runtime/budget-policy') {
    if (!options.session) {
      return unauthorized()
    }
    const projectId = options.searchParams?.get('projectId') ?? ''
    if (!projectId) {
      return badRequest('Invalid projectId')
    }
    if (!canAccessProject(options.session, projectId)) {
      return forbidden('Project access required')
    }

    return {
      status: 200,
      body: {
        policy: await repository.getRuntimeBudgetPolicy(projectId, options.session),
      },
    }
  }

  if (method === 'PUT' && pathname === '/api/runtime/budget-policy') {
    if (!options.session) {
      return unauthorized()
    }
    let input: RuntimeBudgetPolicyInput
    try {
      input = parseRuntimeBudgetPolicyInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid runtime budget policy payload')
    }
    if (!canSyncProject(options.session, input.projectId, 'lead')) {
      return forbidden('Project role lead required')
    }
    const policy: RuntimeBudgetPolicy = {
      projectId: input.projectId,
      enabled: input.enabled,
      monthlyLimitUsd: input.monthlyLimitUsd,
      warningThresholdUsd: input.warningThresholdUsd,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    }

    return {
      status: 200,
      body: await repository.saveRuntimeBudgetPolicy(policy, options.session),
    }
  }

  if (method === 'POST' && pathname === '/api/runtime/budget/evaluate') {
    if (!options.session) {
      return unauthorized()
    }
    let input: RuntimeBudgetEvaluateInput
    try {
      input = parseRuntimeBudgetEvaluateInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid runtime budget evaluate payload')
    }
    if (!canAccessProject(options.session, input.projectId)) {
      return forbidden('Project access required')
    }
    const [overview, policy, approvals] = await Promise.all([
      repository.getTeamOverview(options.session),
      repository.getRuntimeBudgetPolicy(input.projectId, options.session),
      repository.listRuntimeBudgetApprovals({ projectId: input.projectId }, options.session),
    ])
    const currentSpendUsd =
      overview.projectCost.find((rollup) => rollup.key === input.projectId)?.costUsd ?? 0
    const approval = input.approvalId
      ? approvals.find((candidate) => candidate.id === input.approvalId) ?? null
      : null

    return {
      status: 200,
      body: evaluateRuntimeBudgetGuard({
        projectId: input.projectId,
        providerId: input.providerId,
        policy,
        currentSpendUsd,
        projectedCostUsd: input.projectedCostUsd,
        requestedBy: options.session.userId,
        approval,
        now: new Date().toISOString(),
      }),
    }
  }

  if (method === 'POST' && pathname === '/api/runtime/budget-approvals') {
    if (!options.session) {
      return unauthorized()
    }
    let input: RuntimeBudgetApprovalInput
    try {
      input = parseRuntimeBudgetApprovalInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid runtime budget approval payload')
    }
    if (!canSyncProject(options.session, input.projectId, 'lead')) {
      return forbidden('Project role lead required')
    }
    const approval: RuntimeBudgetApproval = {
      id: `runtime-budget-approval-${input.projectId}-${Date.now()}`,
      projectId: input.projectId,
      requestedBy: input.requestedBy,
      approvedBy: options.session.userId,
      role: options.session.role,
      providerId: input.providerId,
      maxAdditionalCostUsd: input.maxAdditionalCostUsd,
      reason: input.reason,
      status: 'approved',
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    }

    return {
      status: 201,
      body: await repository.saveRuntimeBudgetApproval(approval, options.session),
    }
  }

  if (method === 'GET' && pathname === '/api/agent/providers') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: {
        providers: await repository.listAgentProviders(options.session),
      },
    }
  }

  if (method === 'POST' && pathname === '/api/agent/providers') {
    if (!options.session) {
      return unauthorized()
    }

    if (options.session.role !== 'owner') {
      return forbidden('Organization owner role required')
    }

    let input: AgentProviderCredentialInput
    try {
      input = parseProviderCredential(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid provider credential payload')
    }

    const providerId = input.providerId ?? createGeneratedAgentProviderId(randomUUID())
    try {
      assertAgentProviderNameAvailable({
        name: input.name,
        providers: await repository.listAgentProviders(options.session),
        ...(input.providerId ? { providerId } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid provider name'
      return message === 'Provider name already exists.' ? conflict(message) : badRequest(message)
    }

    const metadata: ProviderCredentialMetadata = {
      providerId,
      name: input.name,
      model: input.model,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      maskedCredential: maskAgentCredential(input.apiKey),
      updatedAt: new Date().toISOString(),
    }

    return {
      status: 201,
      body: await repository.saveAgentProviderCredential(
        metadata,
        encryptAgentCredential(input.apiKey),
        options.session,
      ),
    }
  }

  if (method === 'GET' && pathname === '/api/agent/reviews') {
    if (!options.session) {
      return unauthorized()
    }

    const session = options.session
    const runId = options.searchParams?.get('runId')?.trim() || undefined
    const bundle = await repository.getRunsBundle(session)
    const visibleRuns = new Map(
      bundle.runs
        .filter((run) => canAccessProject(session, run.projectId))
        .map((run) => [run.id, run]),
    )
    let targetRun: WorkflowRun | undefined
    if (runId) {
      targetRun = visibleRuns.get(runId)
      if (!targetRun) {
        return notFound('Run not found')
      }
    }

    const reviews = await repository.listAgentReviews(runId ? { runId } : {}, session)
    return {
      status: 200,
      body: {
        reviews: reviews.filter((review) => {
          const visibleRun = visibleRuns.get(review.runId)
          return Boolean(
            visibleRun &&
              visibleRun.projectId === review.projectId &&
              (!targetRun || visibleRun.id === targetRun.id),
          )
        }),
      },
    }
  }

  if (method === 'POST' && pathname === '/api/agent/knowledge-review') {
    if (!options.session) {
      return unauthorized()
    }

    let input: KnowledgeReviewInput
    try {
      input = parseKnowledgeReviewInput(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid Gate Review payload')
    }

    if (!canSyncProject(options.session, input.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    const [bundle, overview] = await Promise.all([
      repository.getRunsBundle(options.session),
      repository.getTeamOverview(options.session),
    ])
    const run = bundle.runs.find((candidate) => candidate.id === input.runId)
    if (!run || run.projectId !== input.projectId || !canAccessProject(options.session, run.projectId)) {
      return forbidden('Project access required')
    }

    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      return badRequest(`Run node not found: ${input.nodeId}`)
    }
    if (node.id !== run.currentNodeId) {
      return badRequest('Knowledge-Grounded Gate Review requires the current Run node.')
    }
    if (node.kind !== 'gate' && node.kind !== 'acceptance') {
      return badRequest('Knowledge-Grounded Gate Review requires a Gate or Acceptance node.')
    }
    if (node.status !== 'running' && node.status !== 'blocked') {
      return badRequest('Knowledge-Grounded Gate Review requires a running or blocked node.')
    }

    const providerId = input.providerId?.trim()
    if (!providerId) {
      return badRequest('Gate Review provider is not configured. Save a provider credential before running Gate Review.')
    }

    const provider: AgentProvider | null = providerId === 'fake-knowledge-review'
      ? (() => {
          if (!isFakeRuntimeEnabled()) {
            return null
          }

          return createFakeAgentProvider()
        })()
      : (() => {
          const configuredProvider = overview.agentProviders.find(
            (candidate) => candidate.id === providerId && candidate.kind === 'openai-compatible',
          )
          if (!configuredProvider) {
            return null
          }

          return {
            id: configuredProvider.id,
            name: configuredProvider.name,
            model: configuredProvider.model,
            async reviewKnowledge(providerInput) {
              const credential = await repository.getAgentProviderCredential(providerId, options.session!)
              if (!credential) {
                throw new Error(`Agent provider credential not found: ${providerId}`)
              }
              if (credential.metadata.model !== configuredProvider.model) {
                throw new Error('Agent provider changed after the budget preflight. Retry the review.')
              }

              return createOpenAiCompatibleAgentProvider({
                id: credential.metadata.providerId,
                name: 'OpenAI Compatible',
                model: credential.metadata.model,
                ...(credential.metadata.baseUrl ? { baseUrl: credential.metadata.baseUrl } : {}),
                apiKey: decryptAgentCredential(credential.encryptedSecret),
              }).reviewKnowledge(providerInput)
            },
          }
        })()
    if (!provider) {
      return providerId === 'fake-knowledge-review'
        ? badRequest('Fake Gate Review requires DEVFLOW_ENABLE_FAKE_RUNTIME=true.')
        : badRequest(`Agent provider credential not found: ${providerId}`)
    }
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts: bundle.artifacts.filter((artifact) => artifact.runId === run.id),
      testEvidence: overview.testEvidenceSummaries
        .filter((summary) => summary.runId === run.id)
        .map(toTestEvidence),
      knowledgeDocuments: defaultKnowledgeDocuments,
      knowledgeChunks: defaultKnowledgeChunks,
    })
    const request = {
      id: `api-review-request-${Date.now()}`,
      runId: run.id,
      nodeId: node.id,
      projectId: run.projectId,
      requestedBy: options.session.userId,
      runtime: 'api' as const,
      providerId,
    }
    const result = await runBudgetedKnowledgeReviewAgent({
      request,
      context,
      provider,
      ...(input.runtimeBudgetApprovalId
        ? { approvalId: input.runtimeBudgetApprovalId }
        : {}),
      budgetGuard: async (budgetInput) => {
        const [policy, approvals] = await Promise.all([
          repository.getRuntimeBudgetPolicy(budgetInput.projectId, options.session!),
          repository.listRuntimeBudgetApprovals(
            { projectId: budgetInput.projectId },
            options.session!,
          ),
        ])
        const currentSpendUsd =
          overview.projectCost.find((rollup) => rollup.key === budgetInput.projectId)?.costUsd ?? 0

        return evaluateRuntimeBudgetGuard({
          projectId: budgetInput.projectId,
          providerId: budgetInput.providerId,
          policy,
          currentSpendUsd,
          projectedCostUsd: budgetInput.projectedCostUsd,
          requestedBy: budgetInput.requestedBy,
          approval: budgetInput.approvalId
            ? approvals.find((candidate) => candidate.id === budgetInput.approvalId) ?? null
            : null,
          now: new Date().toISOString(),
        })
      },
    })

    if (result.status === 'blocked') {
      const budgetDecision = {
        ...result.budgetDecision,
        reason: redactSensitiveText(result.budgetDecision.reason).value,
      }
      const audit = {
        id: `knowledge-review-budget-audit-${randomUUID()}`,
        runId: run.id,
        nodeId: node.id,
        sequence: bundle.events.filter((event) => event.runId === run.id).length + 1,
        kind: 'error' as const,
        message: [
          'Knowledge-Grounded Gate Review budget blocked.',
          `requestId=${request.id}`,
          `projectId=${run.projectId}`,
          `providerId=${providerId}`,
          `requestedBy=${options.session.userId}`,
          `approvalId=${input.runtimeBudgetApprovalId ?? 'none'}`,
          `status=${budgetDecision.status}`,
          `currentSpendUsd=${budgetDecision.currentSpendUsd}`,
          `projectedCostUsd=${budgetDecision.projectedCostUsd}`,
          `reason=${budgetDecision.reason}`,
          'redacted=true',
        ].join(' '),
        timestamp: new Date().toISOString(),
      }
      const savedAudit = await repository.saveAgentEvent(audit, options.session)

      return {
        status: 409,
        body: {
          status: 'blocked',
          budgetDecision,
          audit: savedAudit,
        },
      }
    }

    const artifactAndEvent = createAgentReviewArtifacts(result.execution)
    const event = {
      ...artifactAndEvent.event,
      sequence: bundle.events.filter((event) => event.runId === run.id).length + 1,
    }

    const saved = await repository.saveAgentReviewBundle(
      {
        ...result.execution,
        artifact: artifactAndEvent.artifact,
        event,
      },
      options.session,
    )

    return {
      status: 201,
      body: {
        ...saved,
        budgetDecision: result.budgetDecision,
        artifact: artifactAndEvent.artifact,
        event,
      },
    }
  }

  if (method === 'POST' && pathname === '/api/sync/run-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteRunSummary
    try {
      summary = parseRemoteRunSummary(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }

    if (summary.kind === 'approval') {
      return badRequest('Approval summaries must be produced by the Gate approval enforcement path')
    }

    const requiredRole = 'member'
    if (!canSyncProject(options.session, summary.projectId, requiredRole)) {
      return forbidden(`Project role ${requiredRole} required`)
    }

    const syncContext =
      options.principal?.authentication.kind === 'desktop_bearer'
        ? {
            ...options.session,
            tokenRecordId: options.principal.authentication.tokenRecordId,
          }
        : options.session
    return acceptCanonicalRunSummary(() =>
      repository.uploadRunSummary(summary, syncContext),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/test-evidence-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteTestEvidenceSummary
    try {
      summary = parseRemoteTestEvidenceSummary(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadTestEvidenceSummary(summary, options.session!),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/agent-review-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteAgentReviewSummary
    try {
      summary = parseRemoteAgentReviewSummary(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadAgentReviewSummary(summary, options.session!),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/coding-agent-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteCodingAgentSummary
    try {
      summary = parseRemoteCodingAgentSummary(options.body)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Invalid sync payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadCodingAgentSummary(summary, options.session!),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/agent-runtime-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteAgentRuntimeSummary
    try {
      summary = parseRemoteAgentRuntimeSummary(options.body)
    } catch {
      return badRequest('Invalid Agent Runtime Team projection payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadAgentRuntimeSummary(summary, options.session!),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/agent-memory-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteAgentMemorySummary
    try {
      summary = parseRemoteAgentMemorySummary(options.body)
    } catch {
      return badRequest('Invalid Agent Memory Team projection payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadAgentMemorySummary(summary, options.session!),
    )
  }

  if (method === 'POST' && pathname === '/api/sync/agent-coordination-summary') {
    if (!options.session) {
      return unauthorized()
    }

    let summary: RemoteAgentCoordinationSummary
    try {
      summary = parseRemoteAgentCoordinationSummary(options.body)
    } catch {
      return badRequest('Invalid Agent Coordination Team projection payload')
    }

    if (!canSyncProject(options.session, summary.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    return acceptCanonicalRunEvidence(() =>
      repository.uploadAgentCoordinationSummary(summary, options.session!),
    )
  }

  return null
}
