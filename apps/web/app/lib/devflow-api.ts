import type {
  DevFlowSessionHeaders,
  DesktopPairingCode,
  AgentProviderConfig,
  AgentReviewExecutionResult,
  AgentReviewResult,
  AgentTokenUsage,
  AgentTrace,
  EffectiveEnforcementPolicy,
  GateOverrideDecision,
  OrganizationEnforcementPolicy,
  PolicyAwareDeliverySummary,
  Project,
  ProjectEnforcementPolicyOverride,
  RemoteCodingAgentSummary,
  RemoteTestEvidenceSummary,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
  TeamMember,
  TokenUsageRollup,
  WorkflowRun,
} from '@ai-devflow/shared'

export type TeamOverviewResponse = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  testEvidenceSummaries: RemoteTestEvidenceSummary[]
  codingAgentSummaries: RemoteCodingAgentSummary[]
  policyAwareDeliverySummaries: PolicyAwareDeliverySummary[]
  agentReviews: AgentReviewResult[]
  agentTraces: AgentTrace[]
  agentTokenUsage: AgentTokenUsage[]
  agentProviders: AgentProviderConfig[]
  runtimeBudgetPolicies: RuntimeBudgetPolicy[]
  runtimeBudgetApprovals: RuntimeBudgetApproval[]
  enforcementPolicies: {
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverrides: ProjectEnforcementPolicyOverride[]
    effectivePolicies: EffectiveEnforcementPolicy[]
    gateOverrides: GateOverrideDecision[]
  }
}

export type FetchTeamOverviewOptions = {
  apiBaseUrl?: string
  cookieHeader?: string
  fetcher?: typeof fetch
  sessionHeaders?: DevFlowSessionHeaders
}

export function resolveDevFlowApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_INTERNAL_API_BASE_URL'] ??
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

export function resolveDevFlowPublicApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    env['DEVFLOW_API_BASE_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

function createApiHeaders(
  baseHeaders: Record<string, string>,
  options: FetchTeamOverviewOptions,
): Record<string, string> {
  return {
    ...baseHeaders,
    ...(options.cookieHeader ? { cookie: options.cookieHeader } : {}),
    ...(options.sessionHeaders ?? {}),
  }
}

export async function fetchTeamOverview(
  options: FetchTeamOverviewOptions = {},
): Promise<TeamOverviewResponse> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/team/overview`, {
    cache: 'no-store',
    headers: createApiHeaders({ accept: 'application/json' }, options),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/team/overview failed with ${response.status}`)
  }

  return response.json() as Promise<TeamOverviewResponse>
}

export type RunKnowledgeReviewOptions = FetchTeamOverviewOptions & {
  runId: string
  nodeId: string
  projectId: string
  providerId?: string
}

export async function runKnowledgeReview(
  options: RunKnowledgeReviewOptions,
): Promise<AgentReviewExecutionResult> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/agent/knowledge-review`, {
    method: 'POST',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
    body: JSON.stringify({
      runId: options.runId,
      nodeId: options.nodeId,
      projectId: options.projectId,
      providerId: options.providerId,
    }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/agent/knowledge-review failed with ${response.status}`)
  }

  return response.json() as Promise<AgentReviewExecutionResult>
}

export type SaveEnforcementPolicyOptions = FetchTeamOverviewOptions & {
  policy: OrganizationEnforcementPolicy
}

export async function saveEnforcementPolicy(
  options: SaveEnforcementPolicyOptions,
): Promise<OrganizationEnforcementPolicy> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/enforcement/policy`, {
    method: 'PUT',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
    body: JSON.stringify({ organizationPolicy: options.policy }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/enforcement/policy failed with ${response.status}`)
  }

  return response.json() as Promise<OrganizationEnforcementPolicy>
}

export type LoadRuntimeBudgetPolicyOptions = FetchTeamOverviewOptions & {
  projectId: string
}

export async function loadRuntimeBudgetPolicy(
  options: LoadRuntimeBudgetPolicyOptions,
): Promise<RuntimeBudgetPolicy | null> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/runtime/budget-policy?projectId=${encodeURIComponent(options.projectId)}`, {
    cache: 'no-store',
    headers: createApiHeaders({ accept: 'application/json' }, options),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/runtime/budget-policy failed with ${response.status}`)
  }

  const result = await response.json() as { policy: RuntimeBudgetPolicy | null }
  return result.policy
}

export type SaveRuntimeBudgetPolicyOptions = FetchTeamOverviewOptions & {
  projectId: string
  enabled: boolean
  monthlyLimitUsd: number
  warningThresholdUsd: number
}

export async function saveRuntimeBudgetPolicy(
  options: SaveRuntimeBudgetPolicyOptions,
): Promise<RuntimeBudgetPolicy> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/runtime/budget-policy`, {
    method: 'PUT',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
    body: JSON.stringify({
      projectId: options.projectId,
      enabled: options.enabled,
      monthlyLimitUsd: options.monthlyLimitUsd,
      warningThresholdUsd: options.warningThresholdUsd,
    }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/runtime/budget-policy failed with ${response.status}`)
  }

  return response.json() as Promise<RuntimeBudgetPolicy>
}

export type CreateRuntimeBudgetApprovalOptions = FetchTeamOverviewOptions & {
  projectId: string
  providerId: string
  requestedBy: string
  maxAdditionalCostUsd: number
  reason: string
  expiresAt: string
}

export async function createRuntimeBudgetApproval(
  options: CreateRuntimeBudgetApprovalOptions,
): Promise<RuntimeBudgetApproval> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/runtime/budget-approvals`, {
    method: 'POST',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
    body: JSON.stringify({
      projectId: options.projectId,
      providerId: options.providerId,
      requestedBy: options.requestedBy,
      maxAdditionalCostUsd: options.maxAdditionalCostUsd,
      reason: options.reason,
      expiresAt: options.expiresAt,
    }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/runtime/budget-approvals failed with ${response.status}`)
  }

  return response.json() as Promise<RuntimeBudgetApproval>
}

export type CreateTeamProjectOptions = FetchTeamOverviewOptions & {
  name: string
  slug: string
  description: string
  repository: string
}

export async function createTeamProject(options: CreateTeamProjectOptions): Promise<Project> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/team/projects`, {
    method: 'POST',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
    body: JSON.stringify({
      name: options.name,
      slug: options.slug,
      description: options.description,
      repository: options.repository,
    }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/team/projects failed with ${response.status}`)
  }

  return response.json() as Promise<Project>
}

export type CreateDesktopPairingCodeOptions = FetchTeamOverviewOptions & {
  projectId: string
}

export async function createDesktopPairingCode(
  options: CreateDesktopPairingCodeOptions,
): Promise<DesktopPairingCode> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/team/projects/${options.projectId}/pairing-codes`, {
    method: 'POST',
    cache: 'no-store',
    headers: createApiHeaders(
      {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      options,
    ),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/team/projects/:projectId/pairing-codes failed with ${response.status}`)
  }

  return response.json() as Promise<DesktopPairingCode>
}
