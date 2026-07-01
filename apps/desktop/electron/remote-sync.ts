import type {
  AgentEvent,
  Artifact,
  DevFlowSessionHeaders,
  DesktopPairingExchangeResult,
  BudgetGuardDecision,
  RemoteAgentReviewSummary,
  RemoteCodingAgentSummary,
  RemoteRunDeleteResult,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  EffectiveEnforcementPolicy,
  GateOverrideDecision,
  OrganizationEnforcementPolicy,
  ProjectEnforcementPolicyOverride,
  TeamMember,
  Project,
  TokenUsageRollup,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { LoadRemoteSnapshotInput } from './ipc-contract'

type Fetcher = typeof fetch

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
  userId: string
  role: GateOverrideDecision['role']
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
}

export type RemoteRuntimeBudgetEvaluateInput = {
  projectId: string
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

function headersForGateOverride(
  sessionHeaders: DevFlowSessionHeaders,
  input: RemoteGateOverrideInput,
): DevFlowSessionHeaders {
  return {
    ...sessionHeaders,
    'x-devflow-user-id': input.userId,
    'x-devflow-user-role': input.role,
    'x-devflow-project-roles': `${input.projectId}:${input.role}`,
  }
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

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    let message = `DevFlow API ${path} failed with ${response.status}`
    try {
      const body = await response.clone().json() as { message?: unknown }
      if (typeof body.message === 'string' && body.message.trim()) {
        message = body.message
      }
    } catch {
      // Keep the status-based fallback when the API does not return JSON.
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

async function postJson<T>(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetcher(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  return readJson<T>(response, path)
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
        fetcher(buildUrl(apiBaseUrl, overviewPath, input), {
          headers,
        }).then((response) => readJson<RemoteTeamOverviewResponse>(response, overviewPath)),
        fetcher(buildUrl(apiBaseUrl, runsPath, input), {
          headers,
        }).then((response) => readJson<RemoteRunsBundleResponse>(response, runsPath)),
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
      return postJson<RemoteSyncUploadResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/run-summary'),
        summary,
        '/api/sync/run-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async deleteRun(input) {
      const path = `/api/runs/${encodeURIComponent(input.runId)}`
      const response = await fetcher(buildUrl(apiBaseUrl, path), {
        method: 'DELETE',
        headers: requireGetHeaders({ authToken, sessionHeaders }),
      })

      if (response.status === 404) {
        return {
          deleted: false,
          deletedAt: new Date().toISOString(),
          message: 'remote run not found',
        }
      }

      return readJson<RemoteRunDeleteResult>(response, path)
    },

    async uploadTestEvidenceSummary(summary) {
      return postJson<RemoteSyncUploadResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/test-evidence-summary'),
        summary,
        '/api/sync/test-evidence-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async uploadAgentReviewSummary(summary) {
      return postJson<RemoteSyncUploadResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-review-summary'),
        summary,
        '/api/sync/agent-review-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },

    async uploadCodingAgentSummary(summary) {
      return postJson<RemoteSyncUploadResult>(
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
        hasAuthToken(authToken)
          ? tokenPostHeaders(authToken)
          : jsonPostHeaders(headersForGateOverride(requireSessionHeaders(sessionHeaders), input)),
      )
    },

    async evaluateRuntimeBudget(input) {
      return postJson<BudgetGuardDecision>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/runtime/budget/evaluate'),
        {
          projectId: input.projectId,
          projectedCostUsd: input.projectedCostUsd,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
        '/api/runtime/budget/evaluate',
        requirePostHeaders({ authToken, sessionHeaders }),
      )
    },
  }
}
