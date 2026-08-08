import type {
  DevFlowSessionHeaders,
  DesktopPairingCode,
  AgentProviderConfig,
  AgentReviewExecutionResult,
  AgentReviewResult,
  AgentTokenUsage,
  AgentTrace,
  EffectiveEnforcementPolicy,
  GateCommand,
  GateEnforcementDecision,
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
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  parseWorkRequestCreate,
  parseWorkRequestRecord,
  parseGateCommandCreate,
  parseGateCommandRecord,
  type CreateGateCommandInput,
  type CreateWorkRequestInput,
} from '@ai-devflow/shared'
import { parseDesktopPairingCodePayload } from './pairing-code'

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

export class DevFlowApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
  ) {
    super(`DevFlow API ${endpoint} failed with ${status}`)
    this.name = 'DevFlowApiError'
  }
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
    env['DEVFLOW_PUBLIC_API_BASE_URL'] ??
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
  runtimeBudgetApprovalId?: string
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
      runtimeBudgetApprovalId: options.runtimeBudgetApprovalId,
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
  const endpoint = '/api/team/projects/:projectId/pairing-codes'
  const response = await fetcher(`${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/pairing-codes`, {
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
    throw new DevFlowApiError(endpoint, response.status)
  }

  const payload = await response.json().catch(() => {
    throw new Error('Pairing code response was invalid.')
  })
  return parseDesktopPairingCodePayload(payload, options.projectId)
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...keys].sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function parseWorkRequestListPayload(
  value: unknown,
  expectedProjectId: string,
): WorkRequest[] {
  if (!isExactRecord(value, ['workRequests']) || !Array.isArray(value.workRequests)) {
    throw new Error('Work Request response was invalid.')
  }

  try {
    return value.workRequests.map((item) => {
      const workRequest = parseWorkRequestRecord(item)
      if (workRequest.projectId !== expectedProjectId) {
        throw new Error('project mismatch')
      }
      return workRequest
    })
  } catch {
    throw new Error('Work Request response was invalid.')
  }
}

export type FetchWorkRequestsOptions = FetchTeamOverviewOptions & {
  projectId: string
}

export async function fetchWorkRequests(
  options: FetchWorkRequestsOptions,
): Promise<WorkRequest[]> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/work-requests'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/work-requests`,
    {
      cache: 'no-store',
      headers: createApiHeaders({ accept: 'application/json' }, options),
    },
  )

  if (!response.ok) {
    throw new DevFlowApiError(endpoint, response.status)
  }

  const payload = await response.json().catch(() => {
    throw new Error('Work Request response was invalid.')
  })
  return parseWorkRequestListPayload(payload, options.projectId)
}

export type CreateWorkRequestOptions = FetchTeamOverviewOptions &
  CreateWorkRequestInput

export type CreateWorkRequestResult = {
  workRequest: WorkRequest
  replayed: boolean
  outcomeCode: 'created'
}

function parseCreateWorkRequestPayload(
  value: unknown,
  expectedProjectId: string,
): CreateWorkRequestResult {
  if (
    !isExactRecord(value, ['outcomeCode', 'replayed', 'workRequest']) ||
    value.outcomeCode !== 'created' ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new Error('Work Request response was invalid.')
  }

  try {
    const workRequest = parseWorkRequestRecord(value.workRequest)
    if (workRequest.projectId !== expectedProjectId) {
      throw new Error('project mismatch')
    }
    return {
      workRequest,
      replayed: value.replayed,
      outcomeCode: 'created',
    }
  } catch {
    throw new Error('Work Request response was invalid.')
  }
}

export async function createWorkRequest(
  options: CreateWorkRequestOptions,
): Promise<CreateWorkRequestResult> {
  const input = parseWorkRequestCreate({
    projectId: options.projectId,
    title: options.title,
    request: options.request,
    idempotencyKey: options.idempotencyKey,
    expiresAt: options.expiresAt,
  })
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/work-requests'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(input.projectId)}/work-requests`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: createApiHeaders(
        {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        options,
      ),
      body: JSON.stringify(input),
    },
  )

  if (!response.ok) {
    throw new DevFlowApiError(endpoint, response.status)
  }

  const payload = await response.json().catch(() => {
    throw new Error('Work Request response was invalid.')
  })
  return parseCreateWorkRequestPayload(payload, input.projectId)
}

function parseGateCommandListPayload(
  value: unknown,
  expectedProjectId: string,
): GateCommand[] {
  if (!isExactRecord(value, ['commands']) || !Array.isArray(value.commands)) {
    throw new Error('Gate Command response was invalid.')
  }
  try {
    return value.commands.map((item) => {
      const command = parseGateCommandRecord(item)
      if (command.projectId !== expectedProjectId) throw new Error('scope mismatch')
      return command
    })
  } catch {
    throw new Error('Gate Command response was invalid.')
  }
}

export type FetchGateCommandsOptions = FetchTeamOverviewOptions & {
  projectId: string
}

export async function fetchGateCommands(
  options: FetchGateCommandsOptions,
): Promise<GateCommand[]> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/gate-commands'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/gate-commands`,
    {
      cache: 'no-store',
      headers: createApiHeaders({ accept: 'application/json' }, options),
    },
  )
  if (response.status !== 200) {
    throw new DevFlowApiError(endpoint, response.status)
  }
  const payload = await response.json().catch(() => {
    throw new Error('Gate Command response was invalid.')
  })
  return parseGateCommandListPayload(payload, options.projectId)
}

export type CreateGateCommandOptions = FetchTeamOverviewOptions &
  CreateGateCommandInput

export type CreateGateCommandResult = {
  command: GateCommand
  replayed: boolean
  outcomeCode: 'created'
}

function parseCreateGateCommandPayload(
  value: unknown,
  expected: CreateGateCommandInput,
): CreateGateCommandResult {
  if (
    !isExactRecord(value, ['command', 'outcomeCode', 'replayed']) ||
    value.outcomeCode !== 'created' ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new Error('Gate Command response was invalid.')
  }
  try {
    const command = parseGateCommandRecord(value.command)
    if (
      command.projectId !== expected.projectId ||
      command.runId !== expected.runId ||
      command.nodeId !== expected.nodeId ||
      command.action !== expected.action ||
      command.reason !== expected.reason ||
      command.expectedRunVersion !== expected.expectedRunVersion ||
      command.expectedPolicyVersion !== expected.expectedPolicyVersion ||
      command.idempotencyKey !== expected.idempotencyKey ||
      command.workRequestId === null ||
      command.status !== 'pending' ||
      command.evaluationStatus !== 'allowed' ||
      command.expectedBlockerIds.length !== expected.expectedBlockerIds.length ||
      command.expectedBlockerIds.some(
        (blockerId, index) => blockerId !== expected.expectedBlockerIds[index],
      )
    ) {
      throw new Error('scope mismatch')
    }
    return { command, replayed: value.replayed, outcomeCode: 'created' }
  } catch {
    throw new Error('Gate Command response was invalid.')
  }
}

export async function createGateCommand(
  options: CreateGateCommandOptions,
): Promise<CreateGateCommandResult> {
  const input = parseGateCommandCreate({
    projectId: options.projectId,
    runId: options.runId,
    nodeId: options.nodeId,
    action: options.action,
    reason: options.reason,
    expectedRunVersion: options.expectedRunVersion,
    expectedPolicyVersion: options.expectedPolicyVersion,
    expectedBlockerIds: options.expectedBlockerIds,
    idempotencyKey: options.idempotencyKey,
  })
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/gate-commands'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(input.projectId)}/gate-commands`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: createApiHeaders(
        {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        options,
      ),
      body: JSON.stringify(input),
    },
  )
  if (response.status !== 201) {
    throw new DevFlowApiError(endpoint, response.status)
  }
  const payload = await response.json().catch(() => {
    throw new Error('Gate Command response was invalid.')
  })
  return parseCreateGateCommandPayload(payload, input)
}

export type GateCommandEvaluationSnapshot = Pick<
  GateEnforcementDecision,
  'status' | 'blocksApproval' | 'policyVersion'
> & {
  expectedBlockerIds: string[]
}

export type EvaluateGateCommandSnapshotOptions = FetchTeamOverviewOptions & {
  projectId: string
  runId: string
  nodeId: string
}

const enforcementDecisionKeys = [
  'blockingReasons',
  'blocksApproval',
  'canOverride',
  'overrideRoleRequired',
  'policySource',
  'policyVersion',
  'provisional',
  'requiredActions',
  'status',
  'warningReasons',
] as const

function isBoundedString(value: unknown, maximum = 8_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function parseEnforcementReason(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid reason')
  }
  const reason = value as Record<string, unknown>
  const allowedKeys = new Set([
    'action',
    'id',
    'remediation',
    'ruleKey',
    'sourceId',
    'summary',
    'target',
  ])
  if (
    Object.keys(reason).some((key) => !allowedKeys.has(key)) ||
    !isBoundedString(reason.id, 200) ||
    reason.id.trim() !== reason.id ||
    !isBoundedString(reason.ruleKey, 200) ||
    !isBoundedString(reason.summary) ||
    (reason.action !== 'warn' && reason.action !== 'block') ||
    (reason.target !== 'governance_check' &&
      reason.target !== 'agent_finding' &&
      reason.target !== 'missing_agent_review') ||
    (reason.remediation !== undefined && !isBoundedString(reason.remediation)) ||
    (reason.sourceId !== undefined && !isBoundedString(reason.sourceId, 200))
  ) {
    throw new Error('invalid reason')
  }
  return reason.id
}

function parseGateCommandEvaluationSnapshot(
  value: unknown,
): GateCommandEvaluationSnapshot {
  if (
    !isExactRecord(value, enforcementDecisionKeys) ||
    !Array.isArray(value.blockingReasons) ||
    !Array.isArray(value.warningReasons) ||
    !Array.isArray(value.requiredActions) ||
    typeof value.blocksApproval !== 'boolean' ||
    typeof value.canOverride !== 'boolean' ||
    value.overrideRoleRequired !== 'lead' ||
    (value.policySource !== 'remote_cache' &&
      value.policySource !== 'built_in_default' &&
      value.policySource !== 'unavailable') ||
    !Number.isInteger(value.policyVersion) ||
    (value.policyVersion as number) < 0 ||
    (value.policyVersion as number) > 2_147_483_647 ||
    typeof value.provisional !== 'boolean' ||
    (value.status !== 'pass' &&
      value.status !== 'warn' &&
      value.status !== 'blocked' &&
      value.status !== 'hard_blocked' &&
      value.status !== 'overridden' &&
      value.status !== 'blocked_policy_unavailable') ||
    value.requiredActions.length > 100 ||
    value.requiredActions.some((item) => !isBoundedString(item))
  ) {
    throw new Error('Gate enforcement response was invalid.')
  }
  try {
    const rawBlockerIds = value.blockingReasons.map(parseEnforcementReason)
    value.warningReasons.forEach(parseEnforcementReason)
    const expectedBlockerIds = [...new Set(rawBlockerIds)].sort()
    if (expectedBlockerIds.length !== rawBlockerIds.length) {
      throw new Error('duplicate blocker')
    }
    return {
      status: value.status,
      blocksApproval: value.blocksApproval,
      policyVersion: value.policyVersion as number,
      expectedBlockerIds,
    }
  } catch {
    throw new Error('Gate enforcement response was invalid.')
  }
}

export async function evaluateGateCommandSnapshot(
  options: EvaluateGateCommandSnapshotOptions,
): Promise<GateCommandEvaluationSnapshot> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/enforcement/evaluate'
  const response = await fetcher(`${apiBaseUrl}${endpoint}`, {
    method: 'POST',
    cache: 'no-store',
    headers: createApiHeaders(
      { accept: 'application/json', 'content-type': 'application/json' },
      options,
    ),
    body: JSON.stringify({
      projectId: options.projectId,
      runId: options.runId,
      nodeId: options.nodeId,
    }),
  })
  if (response.status !== 200) {
    throw new DevFlowApiError(endpoint, response.status)
  }
  const payload = await response.json().catch(() => {
    throw new Error('Gate enforcement response was invalid.')
  })
  return parseGateCommandEvaluationSnapshot(payload)
}
