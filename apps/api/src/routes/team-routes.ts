import { randomUUID } from 'node:crypto'
import {
  buildAgentReviewContext,
  buildKnowledgeGovernanceChecks,
  canOverrideBlockedGate,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createOpenAiCompatibleAgentProvider,
  evaluateGateEnforcement,
  type GateOverrideDecision,
  formatUsd,
  type OrganizationEnforcementPolicy,
  knowledgeChunks,
  knowledgeDocuments,
  runKnowledgeReviewAgent,
  validateEnforcementPolicy,
  type ProviderCredentialMetadata,
  type RemoteAgentReviewSummary,
  type RemoteCodingAgentSummary,
  type RemoteRunSummary,
  type RemoteTestEvidenceSummary,
  type TeamSession,
  type TestEvidence,
} from '@ai-devflow/shared'
import { canAccessProject, canSyncProject } from '../auth/session'
import type { GitHubOAuthClient } from '../auth/github-oauth'
import {
  decryptAgentCredential,
  encryptAgentCredential,
  maskAgentCredential,
} from '../agent-credentials'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from '../repositories/team-repository'
import { clearSessionCookie, createSessionCookie } from '../auth/session-cookie'

export type ApiRouteResult = {
  status: number
  headers?: Record<string, string | string[]>
  body: unknown
}

export type ResolveTeamRouteOptions = {
  auth?: {
    sessionSecret: string
    createState?: () => string
  }
  body?: unknown
  cookies?: Record<string, string | undefined>
  githubOAuth?: GitHubOAuthClient
  session?: TeamSession | null
  searchParams?: URLSearchParams
}

type AgentProviderCredentialInput = {
  providerId: string
  apiKey: string
  model: string
  baseUrl?: string
}

type KnowledgeReviewInput = {
  runId: string
  nodeId: string
  projectId: string
  providerId?: string
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

function hasLocalOnlyEvidenceField(value: Record<string, unknown>): boolean {
  return 'cwd' in value || 'stdout' in value || 'stderr' in value
}

function isRemoteRunSummary(value: unknown): value is RemoteRunSummary {
  return (
    isRecord(value) &&
    (value['kind'] === 'run' || value['kind'] === 'approval' || value['kind'] === 'event') &&
    typeof value['runId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['status'] === 'string' &&
    typeof value['currentNodeId'] === 'string' &&
    typeof value['branchName'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  )
}

function isRemoteTestEvidenceStatus(value: unknown): value is RemoteTestEvidenceSummary['status'] {
  return value === 'running' || value === 'passed' || value === 'failed' || value === 'timed_out'
}

function isRemoteTestEvidenceSummary(value: unknown): value is RemoteTestEvidenceSummary {
  return (
    isRecord(value) &&
    !hasLocalOnlyEvidenceField(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['command'] === 'string' &&
    isRemoteTestEvidenceStatus(value['status']) &&
    (typeof value['exitCode'] === 'number' || value['exitCode'] === null) &&
    typeof value['durationMs'] === 'number' &&
    typeof value['summary'] === 'string' &&
    typeof value['redacted'] === 'boolean' &&
    typeof value['createdAt'] === 'string'
  )
}

function isRemoteAgentReviewSummary(value: unknown): value is RemoteAgentReviewSummary {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    (value['runtime'] === 'electron' || value['runtime'] === 'api') &&
    typeof value['providerId'] === 'string' &&
    typeof value['model'] === 'string' &&
    typeof value['conclusion'] === 'string' &&
    typeof value['summary'] === 'string' &&
    typeof value['riskCount'] === 'number' &&
    typeof value['missingEvidenceCount'] === 'number' &&
    (value['policyFindingCount'] === undefined || typeof value['policyFindingCount'] === 'number') &&
    (value['policyFindingCategories'] === undefined ||
      (Array.isArray(value['policyFindingCategories']) &&
        value['policyFindingCategories'].every((category) => typeof category === 'string'))) &&
    (value['advisoryLevel'] === 'info' ||
      value['advisoryLevel'] === 'warn' ||
      value['advisoryLevel'] === 'block') &&
    typeof value['blocksApproval'] === 'boolean' &&
    typeof value['confidence'] === 'number' &&
    value['redacted'] === true &&
    typeof value['createdAt'] === 'string'
  )
}

function hasLocalOnlyCodingField(value: Record<string, unknown>): boolean {
  return (
    'cwd' in value ||
    'stdout' in value ||
    'stderr' in value ||
    'prompt' in value ||
    'patch' in value ||
    'rawTrace' in value ||
    'providerSecret' in value ||
    'secret' in value
  )
}

function isRepoRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.replace(/\\/g, '/').trim()
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.startsWith('../') &&
    !normalized.includes('/../') &&
    !/^[A-Za-z]:\//.test(normalized)
  )
}

function isRemoteCodingAgentSummary(value: unknown): value is RemoteCodingAgentSummary {
  return (
    isRecord(value) &&
    !hasLocalOnlyCodingField(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['requestedBy'] === 'string' &&
    typeof value['providerId'] === 'string' &&
    (value['engine'] === 'fake' || value['engine'] === 'opencode-http' || value['engine'] === 'opencode-acp') &&
    typeof value['status'] === 'string' &&
    typeof value['branchName'] === 'string' &&
    typeof value['summary'] === 'string' &&
    Array.isArray(value['changedPaths']) &&
    value['changedPaths'].length <= 50 &&
    value['changedPaths'].every(isRepoRelativePath) &&
    typeof value['startedAt'] === 'string' &&
    (value['completedAt'] === undefined || typeof value['completedAt'] === 'string') &&
    value['redacted'] === true
  )
}

function parseRemoteRunSummary(value: unknown): RemoteRunSummary {
  if (!isRemoteRunSummary(value)) {
    throw new Error('Invalid remote run summary payload')
  }

  return value
}

function parseRemoteTestEvidenceSummary(value: unknown): RemoteTestEvidenceSummary {
  if (isRecord(value) && hasLocalOnlyEvidenceField(value)) {
    throw new Error('Remote test evidence summary contains local-only fields')
  }

  if (!isRemoteTestEvidenceSummary(value)) {
    throw new Error('Invalid remote test evidence summary payload')
  }

  return value
}

function parseRemoteAgentReviewSummary(value: unknown): RemoteAgentReviewSummary {
  if (!isRemoteAgentReviewSummary(value)) {
    throw new Error('Invalid remote agent review summary payload')
  }

  return value
}

function parseRemoteCodingAgentSummary(value: unknown): RemoteCodingAgentSummary {
  if (isRecord(value) && hasLocalOnlyCodingField(value)) {
    throw new Error('Remote coding agent summary contains local-only fields')
  }

  if (!isRemoteCodingAgentSummary(value)) {
    throw new Error('Invalid remote coding agent summary payload')
  }

  return value
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const raw = value[key]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Invalid ${key}`)
  }

  return raw.trim()
}

function parseProviderCredential(value: unknown): AgentProviderCredentialInput {
  if (!isRecord(value)) {
    throw new Error('Invalid provider credential payload')
  }

  const baseUrl = value['baseUrl']

  return {
    providerId: readRequiredString(value, 'providerId'),
    apiKey: readRequiredString(value, 'apiKey'),
    model: readRequiredString(value, 'model'),
    ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
  }
}

function parseKnowledgeReviewInput(value: unknown): KnowledgeReviewInput {
  if (!isRecord(value)) {
    throw new Error('Invalid knowledge review payload')
  }

  const providerId = value['providerId']

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
    ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}),
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

function unauthorized(): ApiRouteResult {
  return {
    status: 401,
    body: {
      error: 'unauthorized',
      message: 'Authentication required',
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

function createOAuthStateCookie(state: string): string {
  return `devflow_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
}

function clearOAuthStateCookie(): string {
  return 'devflow_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
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
  const projectCost = overview.projectCost.filter((rollup) => projectIds.has(rollup.key))

  return {
    ...overview,
    projects,
    runs: overview.runs.filter((run) => projectIds.has(run.projectId)),
    projectCost,
    totalCost: formatUsd(projectCost.reduce((sum, rollup) => sum + rollup.costUsd, 0)),
    testEvidenceSummaries: overview.testEvidenceSummaries.filter((evidence) =>
      projectIds.has(evidence.projectId),
    ),
    codingAgentSummaries: overview.codingAgentSummaries.filter((summary) =>
      projectIds.has(summary.projectId),
    ),
    policyAwareDeliverySummaries: overview.policyAwareDeliverySummaries.filter((summary) =>
      projectIds.has(summary.projectId),
    ),
  }
}

async function evaluateEnforcementForInput(
  repository: TeamRepository,
  session: TeamSession,
  input: EnforcementEvaluateInput,
) {
  if (!canAccessProject(session, input.projectId)) {
    throw new Error('Project access required')
  }

  const [bundle, overview, policyBundle, overrides] = await Promise.all([
    repository.getRunsBundle(),
    repository.getTeamOverview(),
    repository.getEnforcementPolicy(input.projectId, session),
    repository.listGateOverrides({ runId: input.runId }, session),
  ])
  const run = bundle.runs.find((candidate) => candidate.id === input.runId)
  if (!run || run.projectId !== input.projectId || !canAccessProject(session, run.projectId)) {
    throw new Error('Project access required')
  }

  const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node) {
    throw new Error(`Run node not found: ${input.nodeId}`)
  }

  const governanceChecks = buildKnowledgeGovernanceChecks({
    run,
    node,
    artifacts: bundle.artifacts.filter((artifact) => artifact.runId === run.id),
    documents: knowledgeDocuments,
    chunks: knowledgeChunks,
    testEvidence: overview.testEvidenceSummaries
      .filter((summary) => summary.runId === run.id)
      .map(toTestEvidence),
  })
  const latestAgentReview = overview.agentReviews
    .filter((review) => review.runId === run.id && review.nodeId === node.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  const agentPolicyFindings = overview.agentReviews
    .filter((review) => review.runId === run.id && review.nodeId === node.id)
    .flatMap((review) => review.policyFindings)

  return {
    run,
    node,
    policyBundle,
    decision: evaluateGateEnforcement({
      run,
      node,
      effectivePolicy: policyBundle.effectivePolicy,
      governanceChecks,
      agentPolicyFindings,
      latestAgentReview,
      overrides,
      policySource: 'remote_cache',
    }),
  }
}

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
  options: ResolveTeamRouteOptions = {},
): Promise<ApiRouteResult | null> {
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
        'set-cookie': createOAuthStateCookie(state),
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
      {
        source: 'authenticated',
        organizationId: result.identity.user.organizationId,
        userId: result.identity.user.id,
        role: result.identity.user.role,
        authAccountId: result.identity.authAccount.id,
        projectMemberships: result.identity.projectMemberships,
      },
      options.auth.sessionSecret,
    )

    return {
      status: 302,
      headers: {
        location: '/',
        'set-cookie': [sessionCookie, clearOAuthStateCookie()],
      },
      body: { redirectTo: '/' },
    }
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    return {
      status: 204,
      headers: {
        'set-cookie': clearSessionCookie(),
      },
      body: null,
    }
  }

  if (method === 'GET' && pathname === '/api/runs') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterRunsBundleForSession(await repository.getRunsBundle(), options.session),
    }
  }

  if (method === 'GET' && pathname === '/api/team/overview') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: filterOverviewForSession(await repository.getTeamOverview(), options.session),
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

    const projectId = decodeURIComponent(projectPairingMatch[1] ?? '')
    if (!projectId) {
      return badRequest('Invalid projectId')
    }

    if (!canSyncProject(options.session, projectId, 'lead')) {
      return forbidden('Project role lead required')
    }

    return {
      status: 201,
      body: await repository.createDesktopPairingCode({ projectId }, options.session),
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
        ? unauthorized()
        : badRequest(message)
    }
  }

  if (method === 'GET' && pathname === '/api/skills') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { skills: await repository.getSkills() },
    }
  }

  if (method === 'GET' && pathname === '/api/mcp') {
    if (!options.session) {
      return unauthorized()
    }

    return {
      status: 200,
      body: { servers: await repository.getMcpServers() },
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
      const { decision } = await evaluateEnforcementForInput(repository, options.session, input)
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
      const { run, node, decision } = await evaluateEnforcementForInput(repository, options.session, input)
      if (decision.policyVersion !== input.policyVersion) {
        return forbidden('Policy version is stale; re-evaluate before overriding')
      }

      if (!canOverrideBlockedGate({
        userRole: options.session.role,
        userId: options.session.userId,
        run,
        node,
        enforcement: decision,
        reason: input.reason,
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
        role: options.session.role,
        reason: input.reason,
        blockedReasonIds: input.blockedReasonIds,
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

    const metadata: ProviderCredentialMetadata = {
      providerId: input.providerId,
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

    const runId = options.searchParams?.get('runId') ?? undefined
    return {
      status: 200,
      body: {
        reviews: await repository.listAgentReviews(runId ? { runId } : {}, options.session),
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
      return badRequest(error instanceof Error ? error.message : 'Invalid knowledge review payload')
    }

    if (!canSyncProject(options.session, input.projectId, 'member')) {
      return forbidden('Project role member required')
    }

    const [bundle, overview] = await Promise.all([
      repository.getRunsBundle(),
      repository.getTeamOverview(),
    ])
    const run = bundle.runs.find((candidate) => candidate.id === input.runId)
    if (!run || run.projectId !== input.projectId || !canAccessProject(options.session, run.projectId)) {
      return forbidden('Project access required')
    }

    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      return badRequest(`Run node not found: ${input.nodeId}`)
    }

    const providerId = input.providerId ?? 'fake-knowledge-review'
    const provider =
      providerId === 'fake-knowledge-review'
        ? createFakeAgentProvider()
        : await (async () => {
            const credential = await repository.getAgentProviderCredential(providerId, options.session!)
            if (!credential) {
              throw new Error(`Agent provider credential not found: ${providerId}`)
            }

            return createOpenAiCompatibleAgentProvider({
              id: credential.metadata.providerId,
              name: 'OpenAI Compatible',
              model: credential.metadata.model,
              ...(credential.metadata.baseUrl ? { baseUrl: credential.metadata.baseUrl } : {}),
              apiKey: decryptAgentCredential(credential.encryptedSecret),
            })
          })()
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts: bundle.artifacts.filter((artifact) => artifact.runId === run.id),
      testEvidence: overview.testEvidenceSummaries
        .filter((summary) => summary.runId === run.id)
        .map(toTestEvidence),
      knowledgeDocuments,
      knowledgeChunks,
    })
    const result = await runKnowledgeReviewAgent({
      request: {
        id: `api-review-request-${Date.now()}`,
        runId: run.id,
        nodeId: node.id,
        projectId: run.projectId,
        requestedBy: options.session.userId,
        runtime: 'api',
        providerId,
      },
      context,
      provider,
    })
    const artifactAndEvent = createAgentReviewArtifacts(result)
    const event = {
      ...artifactAndEvent.event,
      sequence: bundle.events.filter((event) => event.runId === run.id).length + 1,
    }

    const saved = await repository.saveAgentReviewBundle(
      {
        ...result,
        artifact: artifactAndEvent.artifact,
        event,
      },
      options.session,
    )

    return {
      status: 201,
      body: {
        ...saved,
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

    return {
      status: 202,
      body: await repository.uploadRunSummary(summary, options.session),
    }
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

    return {
      status: 202,
      body: await repository.uploadTestEvidenceSummary(summary, options.session),
    }
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

    return {
      status: 202,
      body: await repository.uploadAgentReviewSummary(summary, options.session),
    }
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

    return {
      status: 202,
      body: await repository.uploadCodingAgentSummary(summary, options.session),
    }
  }

  return null
}
