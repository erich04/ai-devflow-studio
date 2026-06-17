import {
  buildAgentReviewContext,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createOpenAiCompatibleAgentProvider,
  formatUsd,
  knowledgeChunks,
  knowledgeDocuments,
  runKnowledgeReviewAgent,
  type ProviderCredentialMetadata,
  type RemoteAgentReviewSummary,
  type RemoteCodingAgentSummary,
  type RemoteRunSummary,
  type RemoteTestEvidenceSummary,
  type TeamSession,
  type TestEvidence,
} from '@ai-devflow/shared'
import { canAccessProject, canSyncProject } from '../auth/session'
import {
  decryptAgentCredential,
  encryptAgentCredential,
  maskAgentCredential,
} from '../agent-credentials'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from '../repositories/team-repository'

export type ApiRouteResult = {
  status: number
  body: unknown
}

export type ResolveTeamRouteOptions = {
  body?: unknown
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
  }
}

export async function resolveTeamRoute(
  method: string,
  pathname: string,
  repository: TeamRepository,
  options: ResolveTeamRouteOptions = {},
): Promise<ApiRouteResult | null> {
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

    const requiredRole = summary.kind === 'approval' ? 'lead' : 'member'
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
