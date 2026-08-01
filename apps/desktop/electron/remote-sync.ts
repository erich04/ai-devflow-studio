import {
  parseBudgetGuardDecision,
  type AgentEvent,
  type Artifact,
  type DevFlowSessionHeaders,
  type DesktopPairingExchangeResult,
  type BudgetGuardDecision,
  type RemoteAgentReviewSummary,
  type RemoteCodingAgentSummary,
  type RemoteRunDeleteResult,
  type RemoteRunSummary,
  type RemoteSyncFailureCode,
  type RemoteSyncUploadResult,
  type RemoteTeamSnapshot,
  type RemoteTestEvidenceSummary,
  type EffectiveEnforcementPolicy,
  type GateOverrideDecision,
  type OrganizationEnforcementPolicy,
  type ProjectEnforcementPolicyOverride,
  type TeamMember,
  type Project,
  type TokenUsageRollup,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { LoadRemoteSnapshotInput } from './ipc-contract'

type Fetcher = typeof fetch

export type RemoteSyncErrorCode = RemoteSyncFailureCode

export class RemoteSyncHttpError extends Error {
  readonly status: number | null
  readonly code: RemoteSyncErrorCode
  readonly path: string
  readonly retryable: boolean

  constructor(input: {
    status: number | null
    code: RemoteSyncErrorCode
    path: string
    retryable: boolean
  }) {
    const statusLabel = input.status === null ? 'unavailable' : `HTTP ${input.status}`
    super(`Remote sync request failed (${statusLabel}, ${input.code}).`)
    this.name = 'RemoteSyncHttpError'
    this.status = input.status
    this.code = input.code
    this.path = input.path
    this.retryable = input.retryable
  }
}

export type RemoteSyncClientOptions = {
  apiBaseUrl?: string
  fetcher?: Fetcher
  authToken?: string
  sessionHeaders?: DevFlowSessionHeaders
}

export type RemoteRunsBundleResponse = {
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
}

export type RemoteTeamOverviewResponse = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  enforcementPolicies?: {
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverrides: ProjectEnforcementPolicyOverride[]
    effectivePolicies: EffectiveEnforcementPolicy[]
    gateOverrides: GateOverrideDecision[]
  }
}

export type RemoteSyncClient = {
  exchangeDesktopPairingCode(input: { code: string }): Promise<DesktopPairingExchangeResult>
  loadRemoteSnapshot(input?: LoadRemoteSnapshotInput): Promise<RemoteTeamSnapshot>
  uploadRunSummary(summary: RemoteRunSummary): Promise<RemoteSyncUploadResult>
  deleteRun(input: { runId: string }): Promise<RemoteRunDeleteResult>
  uploadTestEvidenceSummary(summary: RemoteTestEvidenceSummary): Promise<RemoteSyncUploadResult>
  uploadAgentReviewSummary(summary: RemoteAgentReviewSummary): Promise<RemoteSyncUploadResult>
  uploadCodingAgentSummary(summary: RemoteCodingAgentSummary): Promise<RemoteSyncUploadResult>
  saveGateOverride(input: RemoteGateOverrideInput): Promise<GateOverrideDecision>
  evaluateRuntimeBudget(input: RemoteRuntimeBudgetEvaluateInput): Promise<BudgetGuardDecision>
}

export type RemoteGateOverrideInput = {
  runId: string
  nodeId: string
  projectId: string
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
}

export type RemoteRuntimeBudgetEvaluateInput = {
  projectId: string
  providerId: string
  projectedCostUsd: number
  approvalId?: string
}

export function resolveRemoteApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

function buildUrl(baseUrl: string, pathname: string, input?: LoadRemoteSnapshotInput): string {
  const url = new URL(pathname, `${baseUrl}/`)
  if (input?.organizationId) {
    url.searchParams.set('organizationId', input.organizationId)
  }

  return url.toString()
}

function jsonGetHeaders(sessionHeaders: DevFlowSessionHeaders): Record<string, string> {
  return { accept: 'application/json', ...sessionHeaders }
}

function jsonPostHeaders(sessionHeaders: DevFlowSessionHeaders): Record<string, string> {
  return { ...jsonGetHeaders(sessionHeaders), 'content-type': 'application/json' }
}

function tokenGetHeaders(authToken: string): Record<string, string> {
  return { accept: 'application/json', authorization: `Bearer ${authToken}` }
}

function tokenPostHeaders(authToken: string): Record<string, string> {
  return { ...tokenGetHeaders(authToken), 'content-type': 'application/json' }
}

function hasAuthToken(authToken: string | undefined): authToken is string {
  return typeof authToken === 'string' && authToken.trim().length > 0
}

function missingRemoteAuthError(): Error {
  return new Error('Pair DevFlow Studio with a Team Project before syncing remote team state.')
}

function requireSessionHeaders(
  sessionHeaders: DevFlowSessionHeaders | undefined,
): DevFlowSessionHeaders {
  if (!sessionHeaders) {
    throw missingRemoteAuthError()
  }

  return sessionHeaders
}

function requireGetHeaders(input: {
  authToken: string | undefined
  sessionHeaders: DevFlowSessionHeaders | undefined
}): Record<string, string> {
  if (hasAuthToken(input.authToken)) {
    return tokenGetHeaders(input.authToken)
  }

  return jsonGetHeaders(requireSessionHeaders(input.sessionHeaders))
}

function requirePostHeaders(input: {
  authToken: string | undefined
  sessionHeaders: DevFlowSessionHeaders | undefined
}): Record<string, string> {
  if (hasAuthToken(input.authToken)) {
    return tokenPostHeaders(input.authToken)
  }

  return jsonPostHeaders(requireSessionHeaders(input.sessionHeaders))
}

function headersForSnapshotRequest(
  sessionHeaders: DevFlowSessionHeaders,
  input?: LoadRemoteSnapshotInput,
): DevFlowSessionHeaders {
  if (!input?.organizationId) {
    return sessionHeaders
  }

  return { ...sessionHeaders, 'x-devflow-organization-id': input.organizationId }
}

const CANONICAL_RUN_REQUIRED_MESSAGE =
  /^Canonical Run Summary is required before evidence sync: [A-Za-z0-9][A-Za-z0-9._:-]* \([A-Za-z0-9][A-Za-z0-9._:-]*\)$/

function classifyHttpError(status: number): RemoteSyncErrorCode {
  if (status >= 500) {
    return 'service_unavailable'
  }

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
    case 429:
      return 'rate_limited'
    default:
      return 'remote_error'
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    let code = classifyHttpError(response.status)
    if (response.status === 409) {
      try {
        const body = await response.clone().json() as { message?: unknown }
        if (
          typeof body.message === 'string' &&
          CANONICAL_RUN_REQUIRED_MESSAGE.test(body.message)
        ) {
          code = 'canonical_run_required'
        }
      } catch {
        // Response bodies are untrusted and never copied into the local error.
      }
    }
    throw new RemoteSyncHttpError({
      status: response.status,
      code,
      path,
      retryable: isRetryableHttpStatus(response.status),
    })
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new RemoteSyncHttpError({
      status: response.status,
      code: 'invalid_response',
      path,
      retryable: true,
    })
  }
}

async function fetchRemote(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  path: string,
): Promise<Response> {
  try {
    return await fetcher(url, init)
  } catch {
    throw new RemoteSyncHttpError({
      status: null,
      code: 'remote_unavailable',
      path,
      retryable: true,
    })
  }
}

async function postJson<T>(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetchRemote(
    fetcher,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    path,
  )

  return readJson<T>(response, path)
}

async function postRemoteSyncUpload(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
  headers: Record<string, string>,
): Promise<RemoteSyncUploadResult> {
  const response = await fetchRemote(
    fetcher,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    path,
  )
  const result = await readJson<unknown>(response, path)
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof Reflect.get(result, 'accepted') !== 'boolean' ||
    typeof Reflect.get(result, 'syncedAt') !== 'string' ||
    typeof Reflect.get(result, 'message') !== 'string'
  ) {
    throw new RemoteSyncHttpError({
      status: response.status,
      code: 'invalid_response',
      path,
      retryable: true,
    })
  }

  return result as RemoteSyncUploadResult
}

export function createRemoteSyncClient(
  options: RemoteSyncClientOptions = {},
): RemoteSyncClient {
  const apiBaseUrl = options.apiBaseUrl ?? resolveRemoteApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const authToken = options.authToken?.trim()
  const sessionHeaders = options.sessionHeaders

  return {
    async exchangeDesktopPairingCode(input) {
      return postJson<DesktopPairingExchangeResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/desktop/pairing/exchange'),
        input,
        '/api/desktop/pairing/exchange',
        { accept: 'application/json', 'content-type': 'application/json' },
      )
    },

    async loadRemoteSnapshot(input) {
      const overviewPath = '/api/team/overview'
      const runsPath = '/api/runs'
      const headers = hasAuthToken(authToken)
        ? tokenGetHeaders(authToken)
        : jsonGetHeaders(headersForSnapshotRequest(requireSessionHeaders(sessionHeaders), input))
      const [overview, runsBundle] = await Promise.all([
        fetchRemote(
          fetcher,
          buildUrl(apiBaseUrl, overviewPath, input),
          { headers },
          overviewPath,
        ).then((response) => readJson<RemoteTeamOverviewResponse>(response, overviewPath)),
        fetchRemote(
          fetcher,
          buildUrl(apiBaseUrl, runsPath, input),
          { headers },
          runsPath,
        ).then((response) => readJson<RemoteRunsBundleResponse>(response, runsPath)),
      ])

      return {
        projects: overview.projects,
        members: overview.members,
        runs: runsBundle.runs,
        artifacts: runsBundle.artifacts,
        events: runsBundle.events,
        projectCost: overview.projectCost,
        memberCost: overview.memberCost,
        totalCost: overview.totalCost,
        ...(overview.enforcementPolicies ? { enforcementPolicies: overview.enforcementPolicies } : {}),
      }
    },

    async uploadRunSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/run-summary'),
        summary,
        '/api/sync/run-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async deleteRun(input) {
      const path = `/api/runs/${encodeURIComponent(input.runId)}`
      const safePath = '/api/runs/:runId'
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, path),
        {
          method: 'DELETE',
          headers: requireGetHeaders({ authToken, sessionHeaders }),
        },
        safePath,
      )

      if (response.status === 404) {
        return {
          deleted: false,
          deletedAt: new Date().toISOString(),
          message: 'remote run not found',
        }
      }

      return readJson<RemoteRunDeleteResult>(response, safePath)
    },

    async uploadTestEvidenceSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/test-evidence-summary'),
        summary,
        '/api/sync/test-evidence-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async uploadAgentReviewSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-review-summary'),
        summary,
        '/api/sync/agent-review-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async uploadCodingAgentSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/coding-agent-summary'),
        summary,
        '/api/sync/coding-agent-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async saveGateOverride(input) {
      return postJson<GateOverrideDecision>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/gates/override'),
        {
          runId: input.runId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          reason: input.reason,
          blockedReasonIds: input.blockedReasonIds,
          policyVersion: input.policyVersion,
        },
        '/api/gates/override',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async evaluateRuntimeBudget(input) {
      const decision = await postJson<unknown>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/runtime/budget/evaluate'),
        {
          projectId: input.projectId,
          providerId: input.providerId,
          projectedCostUsd: input.projectedCostUsd,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
        '/api/runtime/budget/evaluate',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
      const parsedDecision = parseBudgetGuardDecision(decision)
      if (parsedDecision.projectedCostUsd !== input.projectedCostUsd) {
        throw new Error('Invalid runtime budget decision')
      }
      return parsedDecision
    },
  }
}
