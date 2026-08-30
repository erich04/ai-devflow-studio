import type {
  DevFlowSessionHeaders,
  DesktopPairingCode,
  AgentProviderConfig,
  AgentReviewExecutionResult,
  AgentReviewResult,
  AgentTokenUsage,
  AgentTrace,
  AuthProvider,
  EffectiveEnforcementPolicy,
  GateCommand,
  GateEnforcementDecision,
  GateOverrideDecision,
  GitHubDeliveryStatus,
  GitHubRepositoryBinding,
  OrganizationEnforcementPolicy,
  PolicyAwareDeliverySummary,
  Project,
  ProjectMembership,
  ProjectEnforcementPolicyOverride,
  RemoteCodingAgentSummary,
  RemoteAgentMemorySummary,
  RemoteAgentRuntimeSummary,
  RemoteAgentCoordinationSummary,
  RemoteTestEvidenceSummary,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
  TeamMember,
  TokenUsageRollup,
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
  redactSensitiveText,
  parseWorkRequestCreate,
  parseWorkRequestRecord,
  parseGateCommandCreate,
  parseGateCommandRecord,
  parseRemoteAgentMemorySummary,
  parseRemoteAgentRuntimeSummary,
  parseRemoteAgentCoordinationSummary,
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
  agentRuntimeSummaries: RemoteAgentRuntimeSummary[]
  agentMemorySummaries: RemoteAgentMemorySummary[]
  agentCoordinationSummaries: RemoteAgentCoordinationSummary[]
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

export type BrowserAuthSessionResponse = {
  user: {
    id: string
    name: string
    role: 'owner' | 'lead' | 'member'
  }
  authentication: {
    provider: AuthProvider
  }
  projectMemberships: ProjectMembership[]
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

export type GitHubDeliveryFeedbackCode =
  | 'provider_unavailable'
  | 'authority_required'
  | 'state_conflict'
  | 'not_found'
  | 'expired'
  | 'service_unavailable'

export class GitHubDeliveryApiError extends DevFlowApiError {
  constructor(
    endpoint: string,
    status: number,
    readonly feedbackCode: GitHubDeliveryFeedbackCode,
    readonly retryable: boolean,
  ) {
    super(endpoint, status)
    this.name = 'GitHubDeliveryApiError'
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
    throw new DevFlowApiError('/api/team/overview', response.status)
  }

  const value = await response.json() as TeamOverviewResponse
  if (!Array.isArray(value.agentRuntimeSummaries)) {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Runtime projection')
  }
  try {
    value.agentRuntimeSummaries = value.agentRuntimeSummaries.map(
      parseRemoteAgentRuntimeSummary,
    )
  } catch {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Runtime projection')
  }
  if (!Array.isArray(value.agentMemorySummaries)) {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Memory projection')
  }
  try {
    value.agentMemorySummaries = value.agentMemorySummaries.map(
      parseRemoteAgentMemorySummary,
    )
  } catch {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Memory projection')
  }
  if (!Array.isArray(value.agentCoordinationSummaries)) {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Coordination projection')
  }
  try {
    value.agentCoordinationSummaries = value.agentCoordinationSummaries.map(
      parseRemoteAgentCoordinationSummary,
    )
  } catch {
    throw new Error('DevFlow API /api/team/overview returned an invalid Agent Coordination projection')
  }
  return value
}

export async function fetchAuthSession(
  options: FetchTeamOverviewOptions = {},
): Promise<BrowserAuthSessionResponse> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${apiBaseUrl}/api/auth/session`, {
    cache: 'no-store',
    headers: createApiHeaders({ accept: 'application/json' }, options),
  })
  if (!response.ok) {
    throw new DevFlowApiError('/api/auth/session', response.status)
  }

  const value = await response.json() as BrowserAuthSessionResponse
  if (
    !value ||
    typeof value.user?.id !== 'string' ||
    typeof value.user?.name !== 'string' ||
    !['owner', 'lead', 'member'].includes(value.user?.role) ||
    !['github', 'local-development'].includes(value.authentication?.provider) ||
    !Array.isArray(value.projectMemberships) ||
    value.projectMemberships.some(
      (membership) =>
        !membership ||
        typeof membership.projectId !== 'string' ||
        membership.userId !== value.user.id ||
        !['owner', 'lead', 'member'].includes(membership.role),
    )
  ) {
    throw new Error('DevFlow API /api/auth/session returned an invalid session')
  }
  return value
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

export type RevokeDesktopPairingCodeOptions = FetchTeamOverviewOptions & {
  projectId: string
  pairingCodeId: string
}

export async function revokeDesktopPairingCode(
  options: RevokeDesktopPairingCodeOptions,
): Promise<void> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/pairing-codes/:pairingCodeId'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/pairing-codes/${encodeURIComponent(options.pairingCodeId)}`,
    {
      method: 'DELETE',
      cache: 'no-store',
      headers: createApiHeaders({ accept: 'application/json' }, options),
    },
  )
  if (!response.ok) {
    throw new DevFlowApiError(endpoint, response.status)
  }
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

const githubBindingKeys = [
  'stateVersion',
  'id',
  'version',
  'organizationId',
  'teamProjectId',
  'installationId',
  'repositoryId',
  'repository',
  'defaultBranch',
  'status',
  'validatedAt',
  'updatedAt',
  'redacted',
] as const

const githubDeliveryRequestKeys = [
  'id',
  'stateVersion',
  'intentRevision',
  'organizationId',
  'projectId',
  'requestedByUserId',
  'localIntentId',
  'localProjectId',
  'runId',
  'runVersion',
  'nodeId',
  'repositoryBindingId',
  'repositoryBindingVersion',
  'installationId',
  'repositoryId',
  'repository',
  'codingRunId',
  'workspaceId',
  'deliverySeriesKey',
  'deliveryAttempt',
  'diffArtifactId',
  'testEvidenceId',
  'prPackageArtifactId',
  'status',
  'outcomeCode',
  'expectedRunVersion',
  'baseBranch',
  'headBranch',
  'baseCommitSha',
  'expectedCommitSha',
  'intentDigest',
  'logicalIdempotencyKey',
  'diffDigest',
  'testEvidenceDigest',
  'packageDigest',
  'changedPaths',
  'prTitle',
  'prBody',
  'expiresAt',
  'createdAt',
  'updatedAt',
  'redacted',
] as const

const githubDeliveryStatuses: ReadonlySet<GitHubDeliveryStatus> = new Set([
  'approval_required',
  'approved',
  'publishing_branch',
  'branch_published',
  'creating_pr',
  'completed',
  'failed',
  'recovery_required',
  'revoked',
])

const githubDeliveryOutcomeCodes = new Set([
  'approval_rejected',
  'binding_revoked',
  'credential_issue_failed',
  'credential_expired',
  'branch_conflict',
  'branch_verification_failed',
  'draft_pr_created',
  'pull_request_failed',
])

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !value.startsWith('~') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function parseGitHubRepositoryBindingPayload(
  value: unknown,
  expectedProjectId: string,
): GitHubRepositoryBinding | null {
  if (!isExactRecord(value, ['binding'])) {
    throw new Error('GitHub repository binding response was invalid.')
  }
  if (value.binding === null) return null
  const binding = value.binding
  if (
    !isExactRecord(binding, githubBindingKeys) ||
    binding.stateVersion !== 1 ||
    !isSafeIdentifier(binding.id) ||
    !isPositiveInteger(binding.version) ||
    !isSafeIdentifier(binding.organizationId) ||
    binding.teamProjectId !== expectedProjectId ||
    typeof binding.installationId !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(binding.installationId) ||
    typeof binding.repositoryId !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(binding.repositoryId) ||
    typeof binding.repository !== 'string' ||
    normalizeGitHubRepository(binding.repository) !== binding.repository ||
    typeof binding.defaultBranch !== 'string' ||
    assertSafeGitHubBranch(binding.defaultBranch) !== binding.defaultBranch ||
    (binding.status !== 'active' && binding.status !== 'stale' && binding.status !== 'revoked') ||
    !isCanonicalTimestamp(binding.validatedAt) ||
    !isCanonicalTimestamp(binding.updatedAt) ||
    binding.redacted !== true
  ) {
    throw new Error('GitHub repository binding response was invalid.')
  }
  return binding as GitHubRepositoryBinding
}

export type GitHubDeliveryRequestView = {
  id: string
  stateVersion: number
  intentRevision: number
  projectId: string
  runId: string
  runVersion: number
  nodeId: string
  repositoryBindingId: string
  repositoryBindingVersion: number
  deliverySeriesKey: string
  deliveryAttempt: number
  repositoryId: string
  repository: string
  status: GitHubDeliveryStatus
  outcomeCode: string | null
  expectedRunVersion: number
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  intentDigest: string
  diffDigest: string
  testEvidenceId: string
  testEvidenceDigest: string
  packageDigest: string
  changedPaths: string[]
  prTitle: string
  expiresAt: string
  updatedAt: string
}

const githubDeliveryViewKeys = [
  'id',
  'stateVersion',
  'intentRevision',
  'projectId',
  'runId',
  'runVersion',
  'nodeId',
  'repositoryBindingId',
  'repositoryBindingVersion',
  'deliverySeriesKey',
  'deliveryAttempt',
  'repositoryId',
  'repository',
  'status',
  'outcomeCode',
  'expectedRunVersion',
  'baseBranch',
  'headBranch',
  'baseCommitSha',
  'expectedCommitSha',
  'intentDigest',
  'diffDigest',
  'testEvidenceId',
  'testEvidenceDigest',
  'packageDigest',
  'changedPaths',
  'prTitle',
  'expiresAt',
  'updatedAt',
] as const

export function parseGitHubDeliveryRequestView(
  value: unknown,
  expectedProjectId: string,
): GitHubDeliveryRequestView {
  const changedPaths = Array.isArray(
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).changedPaths
      : undefined,
  )
    ? (value as Record<string, unknown>).changedPaths as unknown[]
    : null
  const canonicalChangedPaths = changedPaths?.every(
    (path): path is string =>
      typeof path === 'string' &&
      path.length > 0 &&
      path.length <= 500 &&
      path.trim() === path &&
      !path.startsWith('/') &&
      !path.startsWith('~') &&
      !path.includes('\\') &&
      path.split('/').every(
        (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
      ) &&
      !redactSensitiveText(path).redacted,
  )
    ? [...new Set(changedPaths)].sort((left, right) =>
        left.localeCompare(right),
      )
    : null
  if (
    !isExactRecord(value, githubDeliveryViewKeys) ||
    !isSafeIdentifier(value.id) ||
    !isPositiveInteger(value.stateVersion) ||
    !isPositiveInteger(value.intentRevision) ||
    value.projectId !== expectedProjectId ||
    !isSafeIdentifier(value.projectId) ||
    !isSafeIdentifier(value.runId) ||
    !isPositiveInteger(value.runVersion) ||
    !isSafeIdentifier(value.nodeId) ||
    !isSafeIdentifier(value.repositoryBindingId) ||
    !isPositiveInteger(value.repositoryBindingVersion) ||
    typeof value.deliverySeriesKey !== 'string' ||
    !/^github-delivery:[a-f0-9]{64}$/u.test(value.deliverySeriesKey) ||
    !isPositiveInteger(value.deliveryAttempt) ||
    typeof value.repositoryId !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(value.repositoryId) ||
    typeof value.repository !== 'string' ||
    normalizeGitHubRepository(value.repository) !== value.repository ||
    typeof value.status !== 'string' ||
    !githubDeliveryStatuses.has(value.status as GitHubDeliveryStatus) ||
    (value.outcomeCode !== null &&
      (typeof value.outcomeCode !== 'string' || !githubDeliveryOutcomeCodes.has(value.outcomeCode))) ||
    !isPositiveInteger(value.expectedRunVersion) ||
    value.expectedRunVersion !== value.runVersion ||
    typeof value.baseBranch !== 'string' ||
    assertSafeGitHubBranch(value.baseBranch) !== value.baseBranch ||
    typeof value.headBranch !== 'string' ||
    assertSafeGitHubBranch(value.headBranch, { requireDeliveryNamespace: true }) !== value.headBranch ||
    typeof value.baseCommitSha !== 'string' ||
    assertFullGitCommitSha(value.baseCommitSha, 'Base commit') !== value.baseCommitSha ||
    typeof value.expectedCommitSha !== 'string' ||
    assertFullGitCommitSha(value.expectedCommitSha, 'Expected commit') !== value.expectedCommitSha ||
    !['intentDigest', 'diffDigest', 'testEvidenceDigest', 'packageDigest'].every(
      (key) => typeof value[key] === 'string' && /^[a-f0-9]{64}$/u.test(value[key] as string),
    ) ||
    !isSafeIdentifier(value.testEvidenceId) ||
    canonicalChangedPaths === null ||
    canonicalChangedPaths.length === 0 ||
    canonicalChangedPaths.length > 200 ||
    JSON.stringify(canonicalChangedPaths) !== JSON.stringify(changedPaths) ||
    typeof value.prTitle !== 'string' ||
    value.prTitle.length === 0 ||
    value.prTitle.length > 256 ||
    value.prTitle.trim() !== value.prTitle ||
    /[\u0000-\u001f\u007f]/u.test(value.prTitle) ||
    redactSensitiveText(value.prTitle).redacted ||
    !isCanonicalTimestamp(value.expiresAt) ||
    !isCanonicalTimestamp(value.updatedAt)
  ) {
    throw new Error('GitHub Delivery response was invalid.')
  }
  return {
    id: value.id,
    stateVersion: value.stateVersion,
    intentRevision: value.intentRevision,
    projectId: value.projectId,
    runId: value.runId,
    runVersion: value.runVersion,
    nodeId: value.nodeId,
    repositoryBindingId: value.repositoryBindingId,
    repositoryBindingVersion: value.repositoryBindingVersion,
    deliverySeriesKey: value.deliverySeriesKey,
    deliveryAttempt: value.deliveryAttempt,
    repositoryId: value.repositoryId,
    repository: value.repository,
    status: value.status as GitHubDeliveryStatus,
    outcomeCode: value.outcomeCode as string | null,
    expectedRunVersion: value.expectedRunVersion,
    baseBranch: value.baseBranch,
    headBranch: value.headBranch,
    baseCommitSha: value.baseCommitSha,
    expectedCommitSha: value.expectedCommitSha,
    intentDigest: value.intentDigest as string,
    diffDigest: value.diffDigest as string,
    testEvidenceId: value.testEvidenceId,
    testEvidenceDigest: value.testEvidenceDigest as string,
    packageDigest: value.packageDigest as string,
    changedPaths: canonicalChangedPaths,
    prTitle: value.prTitle,
    expiresAt: value.expiresAt,
    updatedAt: value.updatedAt,
  }
}

function parseGitHubDeliveryRequest(
  value: unknown,
  expectedProjectId: string,
): GitHubDeliveryRequestView {
  if (!isExactRecord(value, githubDeliveryRequestKeys) || value.redacted !== true) {
    throw new Error('GitHub Delivery response was invalid.')
  }
  return parseGitHubDeliveryRequestView({
    id: value.id,
    stateVersion: value.stateVersion,
    intentRevision: value.intentRevision,
    projectId: value.projectId,
    runId: value.runId,
    runVersion: value.runVersion,
    nodeId: value.nodeId,
    repositoryBindingId: value.repositoryBindingId,
    repositoryBindingVersion: value.repositoryBindingVersion,
    deliverySeriesKey: value.deliverySeriesKey,
    deliveryAttempt: value.deliveryAttempt,
    repositoryId: value.repositoryId,
    repository: value.repository,
    status: value.status as GitHubDeliveryStatus,
    outcomeCode: value.outcomeCode as string | null,
    expectedRunVersion: value.expectedRunVersion,
    baseBranch: value.baseBranch,
    headBranch: value.headBranch,
    baseCommitSha: value.baseCommitSha,
    expectedCommitSha: value.expectedCommitSha,
    intentDigest: value.intentDigest as string,
    diffDigest: value.diffDigest as string,
    testEvidenceId: value.testEvidenceId,
    testEvidenceDigest: value.testEvidenceDigest as string,
    packageDigest: value.packageDigest as string,
    changedPaths: value.changedPaths,
    prTitle: value.prTitle,
    expiresAt: value.expiresAt,
    updatedAt: value.updatedAt,
  }, expectedProjectId)
}

export type FetchGitHubDeliveryOptions = FetchTeamOverviewOptions & {
  projectId: string
}

export async function fetchGitHubRepositoryBinding(
  options: FetchGitHubDeliveryOptions,
): Promise<GitHubRepositoryBinding | null> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/github-repository-binding'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/github-repository-binding`,
    {
      cache: 'no-store',
      headers: createApiHeaders({ accept: 'application/json' }, options),
    },
  )
  if (response.status !== 200) throw new DevFlowApiError(endpoint, response.status)
  return parseGitHubRepositoryBindingPayload(await response.json(), options.projectId)
}

export async function fetchGitHubDeliveryRequests(
  options: FetchGitHubDeliveryOptions,
): Promise<GitHubDeliveryRequestView[]> {
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/github-deliveries'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/github-deliveries`,
    {
      cache: 'no-store',
      headers: createApiHeaders({ accept: 'application/json' }, options),
    },
  )
  if (response.status !== 200) throw new DevFlowApiError(endpoint, response.status)
  const payload = await response.json()
  if (!isExactRecord(payload, ['requests']) || !Array.isArray(payload.requests)) {
    throw new Error('GitHub Delivery response was invalid.')
  }
  const seen = new Set<string>()
  return payload.requests.map((request) => {
    const parsed = parseGitHubDeliveryRequest(request, options.projectId)
    if (seen.has(parsed.id)) throw new Error('GitHub Delivery response was invalid.')
    seen.add(parsed.id)
    return parsed
  })
}

function githubDeliveryFeedbackCode(status: number): GitHubDeliveryFeedbackCode {
  if (status === 503) return 'provider_unavailable'
  if (status === 403) return 'authority_required'
  if (status === 409) return 'state_conflict'
  if (status === 404) return 'not_found'
  if (status === 410) return 'expired'
  return 'service_unavailable'
}

async function throwGitHubDeliveryFailure(
  endpoint: string,
  response: Response,
): Promise<never> {
  const payload = await response.json().catch(() => null)
  const retryable =
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).retryable === true
  throw new GitHubDeliveryApiError(
    endpoint,
    response.status,
    githubDeliveryFeedbackCode(response.status),
    retryable,
  )
}

function assertGitHubNumericId(value: string, label: string): string {
  if (!/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

export type ConfigureGitHubRepositoryBindingOptions = FetchGitHubDeliveryOptions & {
  installationId: string
  repositoryId: string
  expectedStateVersion: number
}

export type GitHubRepositoryBindingMutation = {
  binding: GitHubRepositoryBinding
  outcomeCode: 'binding_created' | 'binding_updated' | 'binding_revoked'
  replayed: boolean
}

function parseGitHubRepositoryBindingMutation(
  value: unknown,
  expectedProjectId: string,
  allowedOutcomes: ReadonlySet<GitHubRepositoryBindingMutation['outcomeCode']>,
): GitHubRepositoryBindingMutation {
  if (
    !isExactRecord(value, ['binding', 'outcomeCode', 'replayed']) ||
    typeof value.outcomeCode !== 'string' ||
    !allowedOutcomes.has(value.outcomeCode as GitHubRepositoryBindingMutation['outcomeCode']) ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new Error('GitHub repository binding response was invalid.')
  }
  const binding = parseGitHubRepositoryBindingPayload(
    { binding: value.binding },
    expectedProjectId,
  )
  if (!binding) throw new Error('GitHub repository binding response was invalid.')
  return {
    binding,
    outcomeCode: value.outcomeCode as GitHubRepositoryBindingMutation['outcomeCode'],
    replayed: value.replayed,
  }
}

export async function configureGitHubRepositoryBinding(
  options: ConfigureGitHubRepositoryBindingOptions,
): Promise<GitHubRepositoryBindingMutation> {
  const installationId = assertGitHubNumericId(options.installationId, 'GitHub installation id')
  const repositoryId = assertGitHubNumericId(options.repositoryId, 'GitHub repository id')
  if (!Number.isSafeInteger(options.expectedStateVersion) || options.expectedStateVersion < 0) {
    throw new Error('GitHub repository binding version is invalid.')
  }
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/github-repository-binding'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/github-repository-binding`,
    {
      method: 'PUT',
      cache: 'no-store',
      headers: createApiHeaders(
        { accept: 'application/json', 'content-type': 'application/json' },
        options,
      ),
      body: JSON.stringify({
        installationId,
        repositoryId,
        expectedStateVersion: options.expectedStateVersion,
      }),
    },
  )
  if (response.status !== 200 && response.status !== 201) {
    return throwGitHubDeliveryFailure(endpoint, response)
  }
  return parseGitHubRepositoryBindingMutation(
    await response.json(),
    options.projectId,
    new Set(['binding_created', 'binding_updated']),
  )
}

export type RevokeGitHubRepositoryBindingOptions = FetchGitHubDeliveryOptions & {
  expectedStateVersion: number
}

export async function revokeGitHubRepositoryBinding(
  options: RevokeGitHubRepositoryBindingOptions,
): Promise<GitHubRepositoryBindingMutation> {
  if (!Number.isSafeInteger(options.expectedStateVersion) || options.expectedStateVersion < 1) {
    throw new Error('GitHub repository binding version is invalid.')
  }
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/github-repository-binding/revoke'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/github-repository-binding/revoke`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: createApiHeaders(
        { accept: 'application/json', 'content-type': 'application/json' },
        options,
      ),
      body: JSON.stringify({ expectedStateVersion: options.expectedStateVersion }),
    },
  )
  if (response.status !== 200) return throwGitHubDeliveryFailure(endpoint, response)
  return parseGitHubRepositoryBindingMutation(
    await response.json(),
    options.projectId,
    new Set(['binding_revoked']),
  )
}

export type DecideGitHubDeliveryRequestOptions = FetchGitHubDeliveryOptions & {
  requestId: string
  decision: 'approve' | 'reject'
  expectedStateVersion: number
}

export type GitHubDeliveryDecision = {
  request: GitHubDeliveryRequestView
  outcomeCode: 'delivery_approved' | 'delivery_rejected'
  replayed: boolean
}

export async function decideGitHubDeliveryRequest(
  options: DecideGitHubDeliveryRequestOptions,
): Promise<GitHubDeliveryDecision> {
  if (!isSafeIdentifier(options.requestId) || options.requestId.includes('/')) {
    throw new Error('GitHub Delivery request id is invalid.')
  }
  if (!Number.isSafeInteger(options.expectedStateVersion) || options.expectedStateVersion < 1) {
    throw new Error('GitHub Delivery request version is invalid.')
  }
  const apiBaseUrl = options.apiBaseUrl ?? resolveDevFlowApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const endpoint = '/api/team/projects/:projectId/github-deliveries/:requestId/:decision'
  const response = await fetcher(
    `${apiBaseUrl}/api/team/projects/${encodeURIComponent(options.projectId)}/github-deliveries/${encodeURIComponent(options.requestId)}/${options.decision}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: createApiHeaders(
        { accept: 'application/json', 'content-type': 'application/json' },
        options,
      ),
      body: JSON.stringify({ expectedStateVersion: options.expectedStateVersion }),
    },
  )
  if (response.status !== 200) return throwGitHubDeliveryFailure(endpoint, response)
  const payload = await response.json()
  const expectedOutcome = options.decision === 'approve'
    ? 'delivery_approved'
    : 'delivery_rejected'
  if (
    !isExactRecord(payload, ['approval', 'outcomeCode', 'replayed', 'request']) ||
    payload.outcomeCode !== expectedOutcome ||
    typeof payload.replayed !== 'boolean' ||
    (options.decision === 'approve' &&
      (typeof payload.approval !== 'object' || payload.approval === null || Array.isArray(payload.approval))) ||
    (options.decision === 'reject' && payload.approval !== null)
  ) {
    throw new Error('GitHub Delivery decision response was invalid.')
  }
  const request = parseGitHubDeliveryRequest(payload.request, options.projectId)
  if (
    request.id !== options.requestId ||
    request.stateVersion <= options.expectedStateVersion ||
    (options.decision === 'approve' && request.status !== 'approved') ||
    (options.decision === 'reject' &&
      (request.status !== 'revoked' || request.outcomeCode !== 'approval_rejected'))
  ) {
    throw new Error('GitHub Delivery decision response was invalid.')
  }
  return {
    request,
    outcomeCode: expectedOutcome,
    replayed: payload.replayed,
  }
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
