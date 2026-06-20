import type {
  DevFlowSessionHeaders,
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
  enforcementPolicies: {
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverrides: ProjectEnforcementPolicyOverride[]
    effectivePolicies: EffectiveEnforcementPolicy[]
    gateOverrides: GateOverrideDecision[]
  }
}

export type FetchTeamOverviewOptions = {
  apiBaseUrl?: string
  fetcher?: typeof fetch
  sessionHeaders?: DevFlowSessionHeaders
}

export function resolveDevFlowApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

export async function fetchTeamOverview(
  options: FetchTeamOverviewOptions = {},
): Promise<TeamOverviewResponse> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const sessionHeaders = options.sessionHeaders ?? {}
  const response = await fetcher(`${apiBaseUrl}/api/team/overview`, {
    cache: 'no-store',
    headers: { accept: 'application/json', ...sessionHeaders },
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
  const sessionHeaders = options.sessionHeaders ?? {}
  const response = await fetcher(`${apiBaseUrl}/api/agent/knowledge-review`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...sessionHeaders,
    },
    body: JSON.stringify({
      runId: options.runId,
      nodeId: options.nodeId,
      projectId: options.projectId,
      providerId: options.providerId ?? 'fake-knowledge-review',
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
  const sessionHeaders = options.sessionHeaders ?? {}
  const response = await fetcher(`${apiBaseUrl}/api/enforcement/policy`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...sessionHeaders,
    },
    body: JSON.stringify({ organizationPolicy: options.policy }),
  })

  if (!response.ok) {
    throw new Error(`DevFlow API /api/enforcement/policy failed with ${response.status}`)
  }

  return response.json() as Promise<OrganizationEnforcementPolicy>
}
