import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  formatUsd,
  buildPolicyAwareDeliverySummaries,
  rollupTokenUsage,
  runtimeCostSummaryToTokenUsage,
  type AgentEvent,
  type AgentEventKind,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type ArtifactKind,
  type AuthAccount,
  type AuthProvider,
  type AuthenticatedIdentity,
  type DesktopPairingCode,
  type McpServerDefinition,
  type NodeKind,
  type NodeStage,
  type NodeStatus,
  type Project,
  type ProjectMembership,
  type ProviderCredentialMetadata,
  type RemoteCodingAgentSummary,
  type RuntimeBudgetApproval,
  type RuntimeBudgetPolicy,
  type RemoteTestEvidenceSummary,
  type RequiredGateRole,
  type Role,
  type TestEvidenceStatus,
  type RunStatus,
  type SkillDefinition,
  type TeamMember,
  type TeamSession,
  type TokenUsage,
  type TokenUsageSource,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
  createWarnOnlyDefaultPolicy,
  resolveEffectivePolicy,
  type EffectiveEnforcementPolicy,
  type GateOverrideDecision,
  type OrganizationEnforcementPolicy,
  type ProjectEnforcementPolicyOverride,
} from '@ai-devflow/shared'
import type { TeamDbClient } from '../db/client'
import type {
  AgentProviderCredentialRecord,
  AgentReviewBundle,
  GitHubIdentityBootstrapResult,
  GitHubIdentityProfile,
  RunsBundle,
  TeamOverviewPayload,
  TeamRepository,
  TeamRepositorySyncContext,
} from './team-repository'

type TimestampValue = string | Date

type ProjectRow = {
  id: string
  name: string
  slug: string
  description: string
  repository: string
  default_branch: string
  health: Project['health']
  knowledge_base_path: string
  test_command: string
}

type UserRow = {
  id: string
  name: string
  role: Role
  avatar_initials: string
  focus: string
}

type AuthenticatedIdentityRow = {
  auth_account_id: string
  auth_account_user_id: string
  provider: AuthProvider
  provider_account_id: string
  username: string | null
  auth_account_email: string | null
  auth_account_created_at: TimestampValue
  auth_account_updated_at: TimestampValue
  user_id: string
  organization_id: string
  name: string
  role: Role
  email: string | null
  avatar_url: string | null
  avatar_initials: string
  focus: string | null
  user_created_at: TimestampValue
  user_updated_at: TimestampValue
}

type ProjectMembershipRow = {
  project_id: string
  user_id: string
  role: Role
}

type OrganizationRow = {
  id: string
  name: string
  slug: string
}

type WorkflowRunRow = {
  id: string
  title: string
  request: string
  project_id: string
  creator_id: string
  status: RunStatus
  current_node_id: string
  branch_name: string
  pull_request_url: string | null
  created_at: TimestampValue
  updated_at: TimestampValue
}

type WorkflowNodeRow = {
  id: string
  run_id: string
  stage: NodeStage
  title: string
  subtitle: string
  kind: NodeKind
  status: NodeStatus
  owner_id: string
  required_role: RequiredGateRole | null
  retry_count: number
  token_usage_id: string | null
  position: number
}

type WorkflowEdgeRow = {
  id: string
  run_id?: string
  source_node_id: string
  target_node_id: string
  kind: WorkflowEdge['kind']
}

type ArtifactRow = {
  id: string
  run_id: string
  node_id: string
  kind: ArtifactKind
  title: string
  summary: string
  content: string
  redacted: boolean
  updated_at: TimestampValue
}

type AgentEventRow = {
  id: string
  run_id: string
  node_id: string | null
  sequence: number
  kind: AgentEventKind
  message: string
  timestamp: TimestampValue
}

type TokenUsageRow = {
  id: string
  run_id: string
  node_id: string
  user_id: string
  project_id: string
  provider: TokenUsage['provider']
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cost_usd: string | number
  timestamp: TimestampValue
}

type SkillRow = {
  id: string
  name: string
  stage: SkillDefinition['stage']
  description: string
  version: string
  enabled: boolean
  source: SkillDefinition['source']
}

type McpServerRow = {
  id: string
  name: string
  command: string
  permission: McpServerDefinition['permission']
  enabled_by_default: boolean
  last_audit_event: string
}

type TestEvidenceSummaryRow = {
  id: string
  run_id: string
  node_id: string
  project_id: string
  command: string
  status: RemoteTestEvidenceSummary['status']
  exit_code: number | null
  duration_ms: number
  summary: string
  redacted: boolean
  created_at: TimestampValue
}

type AgentProviderCredentialRow = {
  provider_id: string
  model: string
  base_url: string | null
  masked_credential: string
  encrypted_secret: string
  updated_at: TimestampValue
}

type AgentReviewRow = {
  id: string
  request_id: string
  run_id: string
  node_id: string
  project_id: string
  runtime: AgentReviewResult['runtime']
  provider_id: string
  model: string
  conclusion: string
  summary: string
  risks: unknown
  missing_evidence: unknown
  suggested_tests: unknown
  knowledge_references: unknown
  policy_findings: unknown
  confidence: string | number
  gate_advisory: unknown
  created_at: TimestampValue
}

type AgentTraceRow = {
  id: string
  run_id: string
  node_id: string
  review_id: string
  runtime: AgentTrace['runtime']
  steps: unknown
  created_at: TimestampValue
}

type AgentTokenUsageRow = TokenUsageRow & {
  source: TokenUsageSource
}

type CodingAgentSummaryRow = {
  id: string
  run_id: string
  node_id: string
  project_id: string
  requested_by: string
  provider_id: string
  engine: RemoteCodingAgentSummary['engine']
  status: RemoteCodingAgentSummary['status']
  branch_name: string
  summary: string
  changed_paths: unknown
  started_at: TimestampValue
  completed_at: TimestampValue | null
  cost_provider: NonNullable<RemoteCodingAgentSummary['costSummary']>['provider'] | null
  cost_model: string | null
  cost_input_tokens: number | null
  cost_output_tokens: number | null
  cost_cache_read_tokens: number | null
  cost_usd: string | number | null
  cost_source: NonNullable<RemoteCodingAgentSummary['costSummary']>['source'] | null
  redacted: boolean
}

type EnforcementPolicyRow = {
  id: string
  project_id: string | null
  name: string
  version: number
  policy: unknown
  updated_at: TimestampValue
}

type GateOverrideDecisionRow = {
  id: string
  run_id: string
  node_id: string
  project_id: string
  user_id: string
  role: GateOverrideDecision['role']
  reason: string
  blocked_reason_ids: unknown
  policy_version: number
  provisional: boolean
  status: GateOverrideDecision['status']
  created_at: TimestampValue
}

type RuntimeBudgetPolicyRow = {
  project_id: string
  enabled: boolean
  monthly_limit_usd: string | number
  warning_threshold_usd: string | number
  currency: 'USD'
  updated_at: TimestampValue
}

type RuntimeBudgetApprovalRow = {
  id: string
  project_id: string
  requested_by: string
  approved_by: string
  role: RuntimeBudgetApproval['role']
  provider_id: string
  max_additional_cost_usd: string | number
  reason: string
  status: RuntimeBudgetApproval['status']
  created_at: TimestampValue
  expires_at: TimestampValue
}

type DesktopPairingCodeRow = {
  id: string
  organization_id: string
  project_id: string
  created_by_user_id: string
  code_hash: string
  expires_at: TimestampValue
  consumed_at: TimestampValue | null
  failed_attempts: number
  created_at: TimestampValue
}

type DesktopTokenSessionRow = {
  token_id: string
  organization_id: string
  project_id: string
  user_id: string
  token_hash: string
  revoked_at: TimestampValue | null
  role: Role
  auth_account_id: string
}

function timestamp(value: TimestampValue): string {
  return value instanceof Date ? value.toISOString() : value
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const groupKey = key(item)
    map.set(groupKey, [...(map.get(groupKey) ?? []), item])
  }

  return map
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repository: row.repository,
    defaultBranch: row.default_branch,
    health: row.health,
    knowledgeBasePath: row.knowledge_base_path,
    testCommand: row.test_command,
  }
}

function mapMember(row: UserRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatarInitials: row.avatar_initials,
    focus: row.focus,
  }
}

function mapAuthenticatedIdentityRow(
  row: AuthenticatedIdentityRow,
): Pick<AuthenticatedIdentity, 'user' | 'authAccount'> {
  const user: AuthenticatedIdentity['user'] = {
    id: row.user_id,
    organizationId: row.organization_id,
    name: row.name,
    role: row.role,
    avatarInitials: row.avatar_initials,
    createdAt: timestamp(row.user_created_at),
    updatedAt: timestamp(row.user_updated_at),
  }
  if (row.email) {
    user.email = row.email
  }
  if (row.avatar_url) {
    user.avatarUrl = row.avatar_url
  }
  if (row.focus) {
    user.focus = row.focus
  }

  const authAccount: AuthAccount = {
    id: row.auth_account_id,
    userId: row.auth_account_user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    createdAt: timestamp(row.auth_account_created_at),
    updatedAt: timestamp(row.auth_account_updated_at),
  }
  if (row.username) {
    authAccount.username = row.username
  }
  if (row.auth_account_email) {
    authAccount.email = row.auth_account_email
  }

  return { user, authAccount }
}

function mapProjectMembership(row: ProjectMembershipRow): ProjectMembership {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
  }
}

function safeIdSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'unknown'
}

function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function parseCopyOnceSecret(value: string): { id: string; secret: string } | null {
  const separatorIndex = value.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null
  }

  return {
    id: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  }
}

function initialsForName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return 'U'
  }

  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }

  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    content: row.content,
    redacted: row.redacted,
    updatedAt: timestamp(row.updated_at),
  }
}

function mapEvent(row: AgentEventRow): AgentEvent {
  const event: AgentEvent = {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    kind: row.kind,
    message: row.message,
    timestamp: timestamp(row.timestamp),
  }

  if (row.node_id) {
    event.nodeId = row.node_id
  }

  return event
}

function mapNode(row: WorkflowNodeRow, artifactIds: string[]): WorkflowNode {
  const node: WorkflowNode = {
    id: row.id,
    stage: row.stage,
    title: row.title,
    subtitle: row.subtitle,
    kind: row.kind,
    status: row.status,
    ownerId: row.owner_id,
    retryCount: row.retry_count,
    artifactIds,
  }

  if (row.required_role) {
    node.requiredRole = row.required_role
  }

  if (row.token_usage_id) {
    node.tokenUsageId = row.token_usage_id
  }

  return node
}

function mapEdge(row: WorkflowEdgeRow): WorkflowEdge {
  return {
    id: row.id,
    source: row.source_node_id,
    target: row.target_node_id,
    kind: row.kind,
  }
}

function mapRun(
  row: WorkflowRunRow,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowRun {
  const run: WorkflowRun = {
    id: row.id,
    title: row.title,
    request: row.request,
    projectId: row.project_id,
    creatorId: row.creator_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    branchName: row.branch_name,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    nodes,
    edges,
  }

  if (row.pull_request_url) {
    run.pullRequestUrl = row.pull_request_url
  }

  return run
}

function mapTokenUsage(row: TokenUsageRow): TokenUsage {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    userId: row.user_id,
    projectId: row.project_id,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    costUsd: Number(row.cost_usd),
    timestamp: timestamp(row.timestamp),
  }
}

function mapTestEvidenceSummary(row: TestEvidenceSummaryRow): RemoteTestEvidenceSummary {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    projectId: row.project_id,
    command: row.command,
    status: row.status,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    summary: row.summary,
    redacted: row.redacted,
    createdAt: timestamp(row.created_at),
  }
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function mapProviderCredential(row: AgentProviderCredentialRow): AgentProviderCredentialRecord {
  const metadata: ProviderCredentialMetadata = {
    providerId: row.provider_id,
    model: row.model,
    ...(row.base_url ? { baseUrl: row.base_url } : {}),
    maskedCredential: row.masked_credential,
    updatedAt: timestamp(row.updated_at),
  }

  return {
    metadata,
    encryptedSecret: row.encrypted_secret,
  }
}

function mapProviderConfig(row: AgentProviderCredentialRow): AgentProviderConfig {
  return {
    id: row.provider_id,
    name: row.provider_id === 'openai-default' ? 'OpenAI Compatible' : row.provider_id,
    kind: 'openai-compatible',
    ...(row.base_url ? { baseUrl: row.base_url } : {}),
    model: row.model,
    enabled: true,
    maskedCredential: row.masked_credential,
    updatedAt: timestamp(row.updated_at),
  }
}

function mapAgentReview(row: AgentReviewRow): AgentReviewResult {
  return {
    id: row.id,
    requestId: row.request_id,
    runId: row.run_id,
    nodeId: row.node_id,
    projectId: row.project_id,
    runtime: row.runtime,
    providerId: row.provider_id,
    model: row.model,
    conclusion: row.conclusion,
    summary: row.summary,
    risks: readArray<string>(row.risks),
    missingEvidence: readArray<string>(row.missing_evidence),
    suggestedTests: readArray<string>(row.suggested_tests),
    knowledgeReferences: readArray(row.knowledge_references),
    policyFindings: readArray(row.policy_findings),
    confidence: Number(row.confidence),
    gateAdvisory: row.gate_advisory as AgentReviewResult['gateAdvisory'],
    createdAt: timestamp(row.created_at),
  }
}

function isOrganizationPolicy(value: unknown): value is OrganizationEnforcementPolicy {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'rules' in value)
}

function isProjectOverride(value: unknown): value is ProjectEnforcementPolicyOverride {
  return Boolean(value && typeof value === 'object' && 'projectId' in value && 'rules' in value)
}

function mapOrganizationPolicy(row: EnforcementPolicyRow | undefined): OrganizationEnforcementPolicy {
  if (row && isOrganizationPolicy(row.policy)) {
    return row.policy
  }

  return createWarnOnlyDefaultPolicy()
}

function mapProjectOverride(row: EnforcementPolicyRow | undefined): ProjectEnforcementPolicyOverride | null {
  if (row && isProjectOverride(row.policy)) {
    return row.policy
  }

  return null
}

function mapGateOverride(row: GateOverrideDecisionRow): GateOverrideDecision {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    reason: row.reason,
    blockedReasonIds: readArray<string>(row.blocked_reason_ids),
    policyVersion: row.policy_version,
    provisional: row.provisional,
    status: row.status,
    createdAt: timestamp(row.created_at),
  }
}

function mapRuntimeBudgetPolicy(row: RuntimeBudgetPolicyRow): RuntimeBudgetPolicy {
  return {
    projectId: row.project_id,
    enabled: row.enabled,
    monthlyLimitUsd: Number(row.monthly_limit_usd),
    warningThresholdUsd: Number(row.warning_threshold_usd),
    currency: row.currency,
    updatedAt: timestamp(row.updated_at),
  }
}

function mapRuntimeBudgetApproval(row: RuntimeBudgetApprovalRow): RuntimeBudgetApproval {
  return {
    id: row.id,
    projectId: row.project_id,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    role: row.role,
    providerId: row.provider_id,
    maxAdditionalCostUsd: Number(row.max_additional_cost_usd),
    reason: row.reason,
    status: row.status,
    createdAt: timestamp(row.created_at),
    expiresAt: timestamp(row.expires_at),
  }
}

function mapAgentTrace(row: AgentTraceRow): AgentTrace {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    reviewId: row.review_id,
    runtime: row.runtime,
    steps: readArray(row.steps),
    createdAt: timestamp(row.created_at),
  }
}

function mapAgentTokenUsage(row: AgentTokenUsageRow): AgentTokenUsage {
  return {
    ...mapTokenUsage(row),
    source: row.source,
  }
}

function mapCodingAgentSummary(row: CodingAgentSummaryRow): RemoteCodingAgentSummary {
  const changedPaths = Array.isArray(row.changed_paths)
    ? row.changed_paths.filter((value): value is string => typeof value === 'string')
    : []

  const summary: RemoteCodingAgentSummary = {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    projectId: row.project_id,
    requestedBy: row.requested_by,
    providerId: row.provider_id,
    engine: row.engine,
    status: row.status,
    branchName: row.branch_name,
    summary: row.summary,
    changedPaths,
    startedAt: timestamp(row.started_at),
    ...(row.completed_at ? { completedAt: timestamp(row.completed_at) } : {}),
    redacted: row.redacted,
  }

  if (row.cost_provider && row.cost_model && row.cost_source) {
    summary.costSummary = {
      id: `coding-runtime-cost-${row.run_id}-${row.node_id}`,
      runId: row.run_id,
      nodeId: row.node_id,
      userId: row.requested_by,
      projectId: row.project_id,
      provider: row.cost_provider,
      providerId: row.provider_id,
      model: row.cost_model,
      inputTokens: Number(row.cost_input_tokens ?? 0),
      outputTokens: Number(row.cost_output_tokens ?? 0),
      cacheReadTokens: Number(row.cost_cache_read_tokens ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
      timestamp: timestamp(row.completed_at ?? row.started_at),
      source: row.cost_source,
      redacted: true,
    }
  }

  return summary
}

function mapSkill(row: SkillRow): SkillDefinition {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    description: row.description,
    version: row.version,
    enabled: row.enabled,
    source: row.source,
  }
}

function mapMcpServer(row: McpServerRow): McpServerDefinition {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    permission: row.permission,
    enabledLocally: row.enabled_by_default,
    lastAuditEvent: row.last_audit_event,
  }
}

function remoteNodeId(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`
}

function mapEvidenceStatusToNodeStatus(status: TestEvidenceStatus): NodeStatus {
  if (status === 'passed') {
    return 'success'
  }

  if (status === 'running') {
    return 'running'
  }

  return 'failed'
}

function mapEvidenceStatusToRunStatus(status: TestEvidenceStatus): RunStatus {
  if (status === 'passed') {
    return 'completed'
  }

  if (status === 'running') {
    return 'testing'
  }

  return 'failed'
}

export function createPostgresTeamRepository(db: TeamDbClient): TeamRepository {
  async function loadAuthenticatedIdentity(input: {
    provider: AuthProvider
    providerAccountId: string
  }): Promise<AuthenticatedIdentity | null> {
    const [identityRow] = await db.query<AuthenticatedIdentityRow>(
      `
        SELECT
          auth_accounts.id AS auth_account_id,
          auth_accounts.user_id AS auth_account_user_id,
          auth_accounts.provider,
          auth_accounts.provider_account_id,
          auth_accounts.username,
          auth_accounts.email AS auth_account_email,
          auth_accounts.created_at AS auth_account_created_at,
          auth_accounts.updated_at AS auth_account_updated_at,
          users.id AS user_id,
          users.organization_id,
          users.name,
          users.role,
          users.email,
          users.avatar_url,
          users.avatar_initials,
          users.focus,
          users.created_at AS user_created_at,
          users.updated_at AS user_updated_at
        FROM auth_accounts
        JOIN users ON users.id = auth_accounts.user_id
        WHERE auth_accounts.provider = $1
          AND auth_accounts.provider_account_id = $2
        LIMIT 1
      `,
      [input.provider, input.providerAccountId],
    )

    if (!identityRow) {
      return null
    }

    const identity = mapAuthenticatedIdentityRow(identityRow)
    const membershipRows = await db.query<ProjectMembershipRow>(
      `
        SELECT project_id, user_id, role
        FROM project_members
        WHERE user_id = $1
        ORDER BY project_id ASC
      `,
      [identity.user.id],
    )

    return {
      ...identity,
      projectMemberships: membershipRows.map(mapProjectMembership),
    }
  }

  async function createFirstGitHubOwner(
    input: GitHubIdentityProfile,
  ): Promise<GitHubIdentityBootstrapResult> {
    const [existingOrganization] = await db.query<OrganizationRow>(
      'SELECT id, name, slug FROM organizations ORDER BY created_at ASC LIMIT 1',
    )

    if (existingOrganization) {
      return {
        status: 'blocked',
        reason: 'organization_exists',
      }
    }

    const idSegment = safeIdSegment(input.providerAccountId)
    const now = new Date().toISOString()
    const organizationId = 'org-default'
    const userId = `u-github-${idSegment}`
    const accountId = `acct-github-${idSegment}`
    const displayName = input.name.trim() || input.username?.trim() || 'GitHub User'

    await db.query(
      `
        INSERT INTO organizations (id, name, slug, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4)
      `,
      [organizationId, 'Default Team', 'default', now],
    )
    await db.query(
      `
        INSERT INTO users (
          id,
          organization_id,
          name,
          email,
          avatar_url,
          role,
          avatar_initials,
          focus,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        userId,
        organizationId,
        displayName,
        input.email ?? null,
        input.avatarUrl ?? null,
        'owner',
        initialsForName(displayName),
        'Team pilot owner',
        now,
      ],
    )
    await db.query(
      `
        INSERT INTO auth_accounts (
          id,
          user_id,
          provider,
          provider_account_id,
          username,
          email,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      `,
      [
        accountId,
        userId,
        'github',
        input.providerAccountId,
        input.username ?? null,
        input.email ?? null,
        now,
      ],
    )

    return {
      status: 'created',
      identity: {
        user: {
          id: userId,
          organizationId,
          name: displayName,
          role: 'owner',
          ...(input.email ? { email: input.email } : {}),
          ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
          avatarInitials: initialsForName(displayName),
          focus: 'Team pilot owner',
          createdAt: now,
          updatedAt: now,
        },
        authAccount: {
          id: accountId,
          userId,
          provider: 'github',
          providerAccountId: input.providerAccountId,
          ...(input.username ? { username: input.username } : {}),
          ...(input.email ? { email: input.email } : {}),
          createdAt: now,
          updatedAt: now,
        },
        projectMemberships: [],
      },
    }
  }

  async function loadRunsBundle(): Promise<RunsBundle> {
    const [runRows, nodeRows, edgeRows, artifactRows, eventRows] = await Promise.all([
      db.query<WorkflowRunRow>('SELECT * FROM workflow_runs ORDER BY updated_at DESC'),
      db.query<WorkflowNodeRow>('SELECT * FROM workflow_nodes ORDER BY run_id, position ASC'),
      db.query<WorkflowEdgeRow>('SELECT * FROM workflow_edges ORDER BY run_id, created_at ASC'),
      db.query<ArtifactRow>('SELECT * FROM artifacts ORDER BY updated_at DESC'),
      db.query<AgentEventRow>('SELECT * FROM agent_events ORDER BY run_id, sequence ASC'),
    ])

    const artifacts = artifactRows.map(mapArtifact)
    const events = eventRows.map(mapEvent)
    const artifactsByNode = groupBy(artifacts, (artifact) => artifact.nodeId)
    const nodesByRun = groupBy(nodeRows, (node) => node.run_id)
    const edgesByRun = groupBy(edgeRows, (edge) => edge.run_id ?? '')

    const runs = runRows.map((runRow) => {
      const runNodes = (nodesByRun.get(runRow.id) ?? []).map((nodeRow) =>
        mapNode(
          nodeRow,
          (artifactsByNode.get(nodeRow.id) ?? []).map((artifact) => artifact.id),
        ),
      )
      const runEdges = (edgesByRun.get(runRow.id) ?? []).map(mapEdge)

      return mapRun(runRow, runNodes, runEdges)
    })

    return { runs, artifacts, events }
  }

  async function resolveDesktopTokenSessionFromToken(token: string): Promise<TeamSession | null> {
    const parsed = parseCopyOnceSecret(token)
    if (!parsed) {
      return null
    }

    const [tokenRow] = await db.query<DesktopTokenSessionRow>(
      `
        SELECT
          desktop_tokens.id AS token_id,
          desktop_tokens.organization_id,
          desktop_tokens.project_id,
          desktop_tokens.user_id,
          desktop_tokens.token_hash,
          desktop_tokens.revoked_at,
          users.role,
          auth_accounts.id AS auth_account_id
        FROM desktop_tokens
        JOIN users ON users.id = desktop_tokens.user_id
        JOIN auth_accounts ON auth_accounts.user_id = users.id
        WHERE desktop_tokens.id = $1
        LIMIT 1
      `,
      [parsed.id],
    )

    if (!tokenRow || tokenRow.revoked_at || tokenRow.token_hash !== hashSecret(parsed.secret)) {
      return null
    }

    const membershipRows = await db.query<ProjectMembershipRow>(
      `
        SELECT project_id, user_id, role
        FROM project_members
        WHERE user_id = $1
        ORDER BY project_id ASC
      `,
      [tokenRow.user_id],
    )
    await db.query(
      `
        UPDATE desktop_tokens
        SET last_used_at = $2
        WHERE id = $1
      `,
      [tokenRow.token_id, new Date().toISOString()],
    )

    return {
      source: 'authenticated',
      organizationId: tokenRow.organization_id,
      userId: tokenRow.user_id,
      role: tokenRow.role,
      authAccountId: tokenRow.auth_account_id,
      projectMemberships: membershipRows.map(mapProjectMembership),
    }
  }

  return {
    async getAuthenticatedIdentity(input) {
      return loadAuthenticatedIdentity(input)
    },

    async resolveOrBootstrapGitHubIdentity(input) {
      const existing = await loadAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: input.providerAccountId,
      })

      if (existing) {
        return { status: 'existing', identity: existing }
      }

      return createFirstGitHubOwner(input)
    },

    async createProject(input, context) {
      const slug = safeIdSegment(input.slug)
      const now = new Date().toISOString()
      const project: Project = {
        id: `p-${slug}`,
        name: input.name,
        slug,
        description: input.description,
        repository: input.repository,
        defaultBranch: input.defaultBranch ?? 'main',
        health: 'on_track',
        knowledgeBasePath: input.knowledgeBasePath ?? `docs/${slug}/`,
        testCommand: input.testCommand ?? '',
      }

      await db.query(
        `
          INSERT INTO projects (
            id,
            organization_id,
            name,
            slug,
            description,
            repository,
            default_branch,
            health,
            knowledge_base_path,
            test_command,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        `,
        [
          project.id,
          context.organizationId,
          project.name,
          project.slug,
          project.description,
          project.repository,
          project.defaultBranch,
          project.health,
          project.knowledgeBasePath,
          project.testCommand,
          now,
        ],
      )
      await db.query(
        `
          INSERT INTO project_members (project_id, user_id, role)
          VALUES ($1, $2, $3)
        `,
        [project.id, context.userId, 'owner'],
      )

      return project
    },

    async createDesktopPairingCode(input, context): Promise<DesktopPairingCode> {
      const id = `desktop-pairing-${randomUUID()}`
      const secret = randomSecret()
      const createdAt = new Date().toISOString()
      const expiresAt = new Date(Date.parse(createdAt) + 10 * 60 * 1000).toISOString()

      await db.query(
        `
          INSERT INTO desktop_pairing_codes (
            id,
            organization_id,
            project_id,
            created_by_user_id,
            code_hash,
            expires_at,
            failed_attempts,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          id,
          context.organizationId,
          input.projectId,
          context.userId,
          hashSecret(secret),
          expiresAt,
          0,
          createdAt,
        ],
      )

      return {
        id,
        organizationId: context.organizationId,
        projectId: input.projectId,
        createdByUserId: context.userId,
        code: `${id}.${secret}`,
        expiresAt,
        createdAt,
        attemptsRemaining: 5,
      }
    },

    async exchangeDesktopPairingCode(input) {
      const parsed = parseCopyOnceSecret(input.code)
      if (!parsed) {
        throw new Error('invalid desktop pairing code')
      }

      const [pairing] = await db.query<DesktopPairingCodeRow>(
        `
          SELECT *
          FROM desktop_pairing_codes
          WHERE id = $1
          LIMIT 1
        `,
        [parsed.id],
      )
      if (!pairing) {
        throw new Error('invalid desktop pairing code')
      }

      if (pairing.consumed_at || pairing.failed_attempts >= 5) {
        throw new Error('invalid desktop pairing code')
      }

      if (Date.parse(timestamp(pairing.expires_at)) <= Date.now()) {
        throw new Error('expired desktop pairing code')
      }

      if (pairing.code_hash !== hashSecret(parsed.secret)) {
        await db.query(
          `
            UPDATE desktop_pairing_codes
            SET failed_attempts = failed_attempts + 1
            WHERE id = $1
          `,
          [pairing.id],
        )
        throw new Error('invalid desktop pairing code')
      }

      const tokenId = `desktop-token-${randomUUID()}`
      const tokenSecret = randomSecret(32)
      const token = `${tokenId}.${tokenSecret}`
      const createdAt = new Date().toISOString()
      await db.query(
        `
          INSERT INTO desktop_tokens (
            id,
            organization_id,
            project_id,
            user_id,
            token_hash,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          tokenId,
          pairing.organization_id,
          pairing.project_id,
          pairing.created_by_user_id,
          hashSecret(tokenSecret),
          createdAt,
        ],
      )
      await db.query(
        `
          UPDATE desktop_pairing_codes
          SET consumed_at = $2
          WHERE id = $1
        `,
        [pairing.id, createdAt],
      )

      const session = await resolveDesktopTokenSessionFromToken(token)
      if (!session || session.source !== 'authenticated') {
        throw new Error('unable to create desktop session')
      }

      return {
        token,
        tokenId,
        organizationId: session.organizationId,
        projectId: pairing.project_id,
        userId: session.userId,
        role: session.role,
        authAccountId: session.authAccountId,
        projectMemberships: session.projectMemberships,
        createdAt,
      }
    },

    async resolveDesktopTokenSession(token): Promise<TeamSession | null> {
      return resolveDesktopTokenSessionFromToken(token)
    },

    async getRunsBundle() {
      return loadRunsBundle()
    },

    async getTeamOverview(): Promise<TeamOverviewPayload> {
      const [
        projectRows,
        memberRows,
        runsBundle,
        tokenRows,
        evidenceRows,
        agentReviewRows,
        agentTraceRows,
        agentTokenRows,
        providerRows,
        codingSummaryRows,
        enforcementPolicyRows,
        gateOverrideRows,
        runtimeBudgetPolicyRows,
        runtimeBudgetApprovalRows,
      ] = await Promise.all([
        db.query<ProjectRow>('SELECT * FROM projects ORDER BY name ASC'),
        db.query<UserRow>('SELECT * FROM users ORDER BY name ASC'),
        loadRunsBundle(),
        db.query<TokenUsageRow>('SELECT * FROM token_usage ORDER BY timestamp DESC'),
        db.query<TestEvidenceSummaryRow>(
          'SELECT * FROM test_evidence_summaries ORDER BY created_at DESC',
        ),
        db.query<AgentReviewRow>('SELECT * FROM agent_reviews ORDER BY created_at DESC'),
        db.query<AgentTraceRow>('SELECT * FROM agent_traces ORDER BY created_at DESC'),
        db.query<AgentTokenUsageRow>('SELECT * FROM agent_token_usage ORDER BY timestamp DESC'),
        db.query<AgentProviderCredentialRow>(
          'SELECT * FROM agent_provider_credentials ORDER BY updated_at DESC',
        ),
        db.query<CodingAgentSummaryRow>(
          'SELECT * FROM coding_agent_summaries ORDER BY started_at DESC',
        ),
        db.query<EnforcementPolicyRow>(
          'SELECT * FROM enforcement_policies ORDER BY project_id NULLS FIRST, updated_at DESC',
        ),
        db.query<GateOverrideDecisionRow>(
          'SELECT * FROM gate_override_decisions ORDER BY created_at DESC',
        ),
        db.query<RuntimeBudgetPolicyRow>(
          'SELECT * FROM runtime_budget_policies ORDER BY updated_at DESC',
        ),
        db.query<RuntimeBudgetApprovalRow>(
          'SELECT * FROM runtime_budget_approvals ORDER BY created_at DESC',
        ),
      ])
      const tokenUsage = tokenRows.map(mapTokenUsage)
      const organizationPolicy = mapOrganizationPolicy(
        enforcementPolicyRows.find((row) => row.project_id === null),
      )
      const projectOverrides = enforcementPolicyRows
        .filter((row) => row.project_id !== null)
        .map(mapProjectOverride)
        .filter((override): override is ProjectEnforcementPolicyOverride => Boolean(override))

      const testEvidenceSummaries = evidenceRows.map(mapTestEvidenceSummary)
      const agentReviews = agentReviewRows.map(mapAgentReview)
      const codingAgentSummaries = codingSummaryRows.map(mapCodingAgentSummary)
      const codingTokenUsage = codingAgentSummaries
        .map((summary) => summary.costSummary)
        .filter((summary): summary is NonNullable<RemoteCodingAgentSummary['costSummary']> => Boolean(summary))
        .map(runtimeCostSummaryToTokenUsage)
      const allTokenUsage = [...tokenUsage, ...codingTokenUsage]
      const gateOverrides = gateOverrideRows.map(mapGateOverride)
      const runtimeBudgetPolicies = runtimeBudgetPolicyRows.map(mapRuntimeBudgetPolicy)
      const runtimeBudgetApprovals = runtimeBudgetApprovalRows.map(mapRuntimeBudgetApproval)

      return {
        projects: projectRows.map(mapProject),
        members: memberRows.map(mapMember),
        runs: runsBundle.runs,
        projectCost: rollupTokenUsage(allTokenUsage, 'projectId'),
        memberCost: rollupTokenUsage(allTokenUsage, 'userId'),
        totalCost: formatUsd(allTokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
        testEvidenceSummaries,
        agentReviews,
        agentTraces: agentTraceRows.map(mapAgentTrace),
        agentTokenUsage: agentTokenRows.map(mapAgentTokenUsage),
        codingAgentSummaries,
        policyAwareDeliverySummaries: buildPolicyAwareDeliverySummaries({
          projectIds: projectRows.map((project) => project.id),
          testEvidenceSummaries,
          agentReviews,
          codingAgentSummaries,
          gateOverrides,
          updatedAt: new Date().toISOString(),
        }),
        enforcementPolicies: {
          organizationPolicy,
          projectOverrides,
          effectivePolicies: projectRows.map((project) =>
            resolveEffectivePolicy(
              organizationPolicy,
              projectOverrides.find((override) => override.projectId === project.id) ?? null,
            ),
          ),
          gateOverrides,
        },
        runtimeBudgetPolicies,
        runtimeBudgetApprovals,
        agentProviders: [
          {
            id: 'fake-knowledge-review',
            name: 'Deterministic Fake Provider',
            kind: 'fake',
            model: 'fake',
            enabled: true,
            updatedAt: new Date(0).toISOString(),
          },
          ...providerRows.map(mapProviderConfig),
        ],
      }
    },

    async getSkills() {
      const rows = await db.query<SkillRow>('SELECT * FROM skills ORDER BY name ASC')
      return rows.map(mapSkill)
    },

    async getMcpServers() {
      const rows = await db.query<McpServerRow>(
        'SELECT * FROM mcp_server_definitions ORDER BY name ASC',
      )
      return rows.map(mapMcpServer)
    },

    async uploadRunSummary(summary, context: TeamRepositorySyncContext) {
      await db.query(
        `
          INSERT INTO workflow_runs (
            id,
            organization_id,
            project_id,
            creator_id,
            data_origin,
            title,
            request,
            status,
            current_node_id,
            branch_name,
            pull_request_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'remote', $5, $6, $7, $8, $9, NULL, $10, $10)
          ON CONFLICT (id) DO UPDATE
          SET title = excluded.title,
              project_id = excluded.project_id,
              status = excluded.status,
              current_node_id = excluded.current_node_id,
              branch_name = excluded.branch_name,
              updated_at = excluded.updated_at
        `,
        [
          summary.runId,
          context.organizationId,
          summary.projectId,
          context.userId,
          summary.title,
          'Synced from DevFlow Electron.',
          summary.status,
          remoteNodeId(summary.runId, summary.currentNodeId),
          summary.branchName,
          summary.updatedAt,
        ],
      )

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'run summary written to Postgres repository',
      }
    },

    async uploadTestEvidenceSummary(summary, context: TeamRepositorySyncContext) {
      const syncedNodeId = remoteNodeId(summary.runId, summary.nodeId)
      const nodeStatus = mapEvidenceStatusToNodeStatus(summary.status)

      await db.query(
        `
          INSERT INTO workflow_runs (
            id,
            organization_id,
            project_id,
            creator_id,
            data_origin,
            title,
            request,
            status,
            current_node_id,
            branch_name,
            pull_request_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'remote', $5, $6, $7, $8, $9, NULL, $10, $10)
          ON CONFLICT (id) DO UPDATE
          SET status = excluded.status,
              current_node_id = excluded.current_node_id,
              updated_at = excluded.updated_at
        `,
        [
          summary.runId,
          context.organizationId,
          summary.projectId,
          context.userId,
          'Synced test evidence',
          'Redacted test evidence summary synced from DevFlow Electron.',
          mapEvidenceStatusToRunStatus(summary.status),
          syncedNodeId,
          `sync/${summary.runId}`,
          summary.createdAt,
        ],
      )
      await db.query(
        `
          INSERT INTO workflow_nodes (
            id,
            run_id,
            stage,
            title,
            subtitle,
            kind,
            status,
            owner_id,
            required_role,
            retry_count,
            token_usage_id,
            position,
            created_at,
            updated_at
          )
          VALUES ($1, $2, 'test', 'Test Evidence', $3, 'test', $4, $5, NULL, 0, NULL, 999, $6, $6)
          ON CONFLICT (id) DO UPDATE
          SET subtitle = excluded.subtitle,
              status = excluded.status,
              updated_at = excluded.updated_at
        `,
        [
          syncedNodeId,
          summary.runId,
          summary.command,
          nodeStatus,
          context.userId,
          summary.createdAt,
        ],
      )
      await db.query(
        `
          INSERT INTO test_evidence_summaries (
            id,
            run_id,
            node_id,
            project_id,
            command,
            status,
            exit_code,
            duration_ms,
            summary,
            redacted,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE
          SET command = excluded.command,
              status = excluded.status,
              exit_code = excluded.exit_code,
              duration_ms = excluded.duration_ms,
              summary = excluded.summary,
              redacted = excluded.redacted,
              created_at = excluded.created_at
        `,
        [
          summary.id,
          summary.runId,
          syncedNodeId,
          summary.projectId,
          summary.command,
          summary.status,
          summary.exitCode,
          summary.durationMs,
          summary.summary,
          summary.redacted,
          summary.createdAt,
        ],
      )

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'test evidence summary written to Postgres repository',
      }
    },

    async uploadAgentReviewSummary(summary, context) {
      const syncedNodeId = remoteNodeId(summary.runId, summary.nodeId)

      await db.query(
        `
          INSERT INTO workflow_runs (
            id,
            organization_id,
            project_id,
            creator_id,
            data_origin,
            title,
            request,
            status,
            current_node_id,
            branch_name,
            pull_request_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'remote', $5, $6, 'paused_at_gate', $7, $8, NULL, $9, $9)
          ON CONFLICT (id) DO UPDATE
          SET current_node_id = excluded.current_node_id,
              updated_at = excluded.updated_at
        `,
        [
          summary.runId,
          context.organizationId,
          summary.projectId,
          context.userId,
          'Synced agent review',
          'Redacted Knowledge Review Agent summary synced from DevFlow Electron.',
          syncedNodeId,
          `sync/${summary.runId}`,
          summary.createdAt,
        ],
      )
      await db.query(
        `
          INSERT INTO workflow_nodes (
            id,
            run_id,
            stage,
            title,
            subtitle,
            kind,
            status,
            owner_id,
            required_role,
            retry_count,
            token_usage_id,
            position,
            created_at,
            updated_at
          )
          VALUES ($1, $2, 'design', 'Knowledge Review Target', $3, 'gate', 'blocked', $4, 'lead', 0, NULL, 998, $5, $5)
          ON CONFLICT (id) DO UPDATE
          SET subtitle = excluded.subtitle,
              updated_at = excluded.updated_at
        `,
        [
          syncedNodeId,
          summary.runId,
          summary.conclusion,
          context.userId,
          summary.createdAt,
        ],
      )
      await db.query(
        `
          INSERT INTO agent_reviews (
            id,
            organization_id,
            request_id,
            run_id,
            node_id,
            project_id,
            runtime,
            provider_id,
            model,
            conclusion,
            summary,
            risks,
            missing_evidence,
            suggested_tests,
            knowledge_references,
            policy_findings,
            confidence,
            gate_advisory,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $14, $15::jsonb, $16)
          ON CONFLICT (id) DO UPDATE
          SET conclusion = excluded.conclusion,
              summary = excluded.summary,
              risks = excluded.risks,
              missing_evidence = excluded.missing_evidence,
              policy_findings = excluded.policy_findings,
              confidence = excluded.confidence,
              gate_advisory = excluded.gate_advisory
        `,
        [
          summary.id,
          context.organizationId,
          `remote-summary-${summary.id}`,
          summary.runId,
          syncedNodeId,
          summary.projectId,
          summary.runtime,
          summary.providerId,
          summary.model,
          summary.conclusion,
          summary.summary,
          JSON.stringify(Array.from({ length: summary.riskCount }, (_, index) => `Remote summary risk ${index + 1}`)),
          JSON.stringify(
            Array.from(
              { length: summary.missingEvidenceCount },
              (_, index) => `Remote summary missing evidence ${index + 1}`,
            ),
          ),
          summary.confidence,
          JSON.stringify({
            id: `gate-advisory-${summary.id}`,
            runId: summary.runId,
            nodeId: syncedNodeId,
            level: summary.advisoryLevel,
            blocksApproval: summary.blocksApproval,
            summary: summary.summary,
            missingEvidence: [],
            riskCount: summary.riskCount,
            createdAt: summary.createdAt,
          }),
          summary.createdAt,
        ],
      )

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'agent review summary written to Postgres repository',
      }
    },

    async uploadCodingAgentSummary(summary: RemoteCodingAgentSummary, context) {
      const syncedNodeId = remoteNodeId(summary.runId, summary.nodeId)

      await db.query(
        `
          INSERT INTO workflow_runs (
            id,
            organization_id,
            project_id,
            creator_id,
            data_origin,
            title,
            request,
            status,
            current_node_id,
            branch_name,
            pull_request_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'remote', $5, $6, 'building', $7, $8, NULL, $9, $9)
          ON CONFLICT (id) DO UPDATE
          SET current_node_id = excluded.current_node_id,
              updated_at = excluded.updated_at
        `,
        [
          summary.runId,
          context.organizationId,
          summary.projectId,
          context.userId,
          'Synced coding agent run',
          'Redacted Coding Agent summary synced from DevFlow Electron.',
          syncedNodeId,
          summary.branchName,
          summary.completedAt ?? summary.startedAt,
        ],
      )
      await db.query(
        `
          INSERT INTO coding_agent_summaries (
            id,
            organization_id,
            run_id,
            node_id,
            project_id,
            requested_by,
            provider_id,
            engine,
            status,
            branch_name,
            summary,
            changed_paths,
            started_at,
            completed_at,
            cost_provider,
            cost_model,
            cost_input_tokens,
            cost_output_tokens,
            cost_cache_read_tokens,
            cost_usd,
            cost_source,
            redacted
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT (id) DO UPDATE
          SET node_id = excluded.node_id,
              project_id = excluded.project_id,
              requested_by = excluded.requested_by,
              provider_id = excluded.provider_id,
              engine = excluded.engine,
              status = excluded.status,
              branch_name = excluded.branch_name,
              summary = excluded.summary,
              changed_paths = excluded.changed_paths,
              started_at = excluded.started_at,
              completed_at = excluded.completed_at,
              cost_provider = excluded.cost_provider,
              cost_model = excluded.cost_model,
              cost_input_tokens = excluded.cost_input_tokens,
              cost_output_tokens = excluded.cost_output_tokens,
              cost_cache_read_tokens = excluded.cost_cache_read_tokens,
              cost_usd = excluded.cost_usd,
              cost_source = excluded.cost_source,
              redacted = excluded.redacted
        `,
        [
          summary.id,
          context.organizationId,
          summary.runId,
          syncedNodeId,
          summary.projectId,
          context.userId,
          summary.providerId,
          summary.engine,
          summary.status,
          summary.branchName,
          summary.summary,
          JSON.stringify(summary.changedPaths),
          summary.startedAt,
          summary.completedAt ?? null,
          summary.costSummary?.provider ?? null,
          summary.costSummary?.model ?? null,
          summary.costSummary?.inputTokens ?? null,
          summary.costSummary?.outputTokens ?? null,
          summary.costSummary?.cacheReadTokens ?? null,
          summary.costSummary?.costUsd ?? null,
          summary.costSummary?.source ?? null,
          summary.redacted,
        ],
      )

      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'coding agent summary written to Postgres repository',
      }
    },

    async listAgentProviders() {
      const rows = await db.query<AgentProviderCredentialRow>(
        'SELECT * FROM agent_provider_credentials ORDER BY updated_at DESC',
      )

      return [
        {
          id: 'fake-knowledge-review',
          name: 'Deterministic Fake Provider',
          kind: 'fake',
          model: 'fake',
          enabled: true,
          updatedAt: new Date(0).toISOString(),
        },
        ...rows.map(mapProviderConfig),
      ]
    },

    async saveAgentProviderCredential(metadata, encryptedSecret, context) {
      await db.query(
        `
          INSERT INTO agent_provider_credentials (
            organization_id,
            provider_id,
            model,
            base_url,
            masked_credential,
            encrypted_secret,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (organization_id, provider_id) DO UPDATE
          SET model = excluded.model,
              base_url = excluded.base_url,
              masked_credential = excluded.masked_credential,
              encrypted_secret = excluded.encrypted_secret,
              updated_at = excluded.updated_at
        `,
        [
          context.organizationId,
          metadata.providerId,
          metadata.model,
          metadata.baseUrl ?? null,
          metadata.maskedCredential,
          encryptedSecret,
          metadata.updatedAt,
        ],
      )

      return metadata
    },

    async getAgentProviderCredential(providerId, context) {
      const rows = await db.query<AgentProviderCredentialRow>(
        `
          SELECT *
          FROM agent_provider_credentials
          WHERE organization_id = $1 AND provider_id = $2
          LIMIT 1
        `,
        [context.organizationId, providerId],
      )

      return rows[0] ? mapProviderCredential(rows[0]) : null
    },

    async saveAgentReviewBundle(bundle: AgentReviewBundle, context: TeamRepositorySyncContext) {
      await db.query(
        `
          INSERT INTO artifacts (
            id,
            run_id,
            node_id,
            kind,
            title,
            summary,
            content,
            redacted,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE
          SET title = excluded.title,
              summary = excluded.summary,
              content = excluded.content,
              redacted = excluded.redacted,
              updated_at = excluded.updated_at
        `,
        [
          bundle.artifact.id,
          bundle.artifact.runId,
          bundle.artifact.nodeId,
          bundle.artifact.kind,
          bundle.artifact.title,
          bundle.artifact.summary,
          bundle.artifact.content,
          bundle.artifact.redacted,
          bundle.artifact.updatedAt,
        ],
      )
      await db.query(
        `
          INSERT INTO agent_events (
            id,
            run_id,
            node_id,
            sequence,
            kind,
            message,
            timestamp
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (run_id, sequence) DO UPDATE
          SET id = excluded.id,
              node_id = excluded.node_id,
              kind = excluded.kind,
              message = excluded.message,
              timestamp = excluded.timestamp
        `,
        [
          bundle.event.id,
          bundle.event.runId,
          bundle.event.nodeId ?? null,
          bundle.event.sequence,
          bundle.event.kind,
          bundle.event.message,
          bundle.event.timestamp,
        ],
      )
      await db.query(
        `
          INSERT INTO agent_reviews (
            id,
            organization_id,
            request_id,
            run_id,
            node_id,
            project_id,
            runtime,
            provider_id,
            model,
            conclusion,
            summary,
            risks,
            missing_evidence,
            suggested_tests,
            knowledge_references,
            policy_findings,
            confidence,
            gate_advisory,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::jsonb, $19)
          ON CONFLICT (id) DO UPDATE
          SET conclusion = excluded.conclusion,
              summary = excluded.summary,
              risks = excluded.risks,
              missing_evidence = excluded.missing_evidence,
              suggested_tests = excluded.suggested_tests,
              knowledge_references = excluded.knowledge_references,
              policy_findings = excluded.policy_findings,
              confidence = excluded.confidence,
              gate_advisory = excluded.gate_advisory
        `,
        [
          bundle.review.id,
          context.organizationId,
          bundle.review.requestId,
          bundle.review.runId,
          bundle.review.nodeId,
          bundle.review.projectId,
          bundle.review.runtime,
          bundle.review.providerId,
          bundle.review.model,
          bundle.review.conclusion,
          bundle.review.summary,
          JSON.stringify(bundle.review.risks),
          JSON.stringify(bundle.review.missingEvidence),
          JSON.stringify(bundle.review.suggestedTests),
          JSON.stringify(bundle.review.knowledgeReferences),
          JSON.stringify(bundle.review.policyFindings),
          bundle.review.confidence,
          JSON.stringify(bundle.review.gateAdvisory),
          bundle.review.createdAt,
        ],
      )
      await Promise.all(
        bundle.review.policyFindings.map((finding) =>
          db.query(
            `
              INSERT INTO agent_policy_findings (
                id,
                organization_id,
                review_id,
                run_id,
                node_id,
                category,
                severity,
                summary,
                evidence_ids,
                knowledge_reference_ids,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
              ON CONFLICT (id) DO UPDATE
              SET category = excluded.category,
                  severity = excluded.severity,
                  summary = excluded.summary,
                  evidence_ids = excluded.evidence_ids,
                  knowledge_reference_ids = excluded.knowledge_reference_ids,
                  created_at = excluded.created_at
            `,
            [
              finding.id,
              context.organizationId,
              finding.reviewId,
              finding.runId,
              finding.nodeId,
              finding.category,
              finding.severity,
              finding.summary,
              JSON.stringify(finding.evidenceIds),
              JSON.stringify(finding.knowledgeReferenceIds),
              finding.createdAt,
            ],
          ),
        ),
      )
      await db.query(
        `
          INSERT INTO agent_traces (
            id,
            organization_id,
            run_id,
            node_id,
            review_id,
            runtime,
            steps,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          ON CONFLICT (id) DO UPDATE
          SET steps = excluded.steps,
              created_at = excluded.created_at
        `,
        [
          bundle.trace.id,
          context.organizationId,
          bundle.trace.runId,
          bundle.trace.nodeId,
          bundle.trace.reviewId,
          bundle.trace.runtime,
          JSON.stringify(bundle.trace.steps),
          bundle.trace.createdAt,
        ],
      )
      await db.query(
        `
          INSERT INTO agent_token_usage (
            id,
            organization_id,
            run_id,
            node_id,
            user_id,
            project_id,
            provider,
            model,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cost_usd,
            timestamp,
            source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (id) DO UPDATE
          SET input_tokens = excluded.input_tokens,
              output_tokens = excluded.output_tokens,
              cache_read_tokens = excluded.cache_read_tokens,
              cost_usd = excluded.cost_usd,
              timestamp = excluded.timestamp,
              source = excluded.source
        `,
        [
          bundle.tokenUsage.id,
          context.organizationId,
          bundle.tokenUsage.runId,
          bundle.tokenUsage.nodeId,
          bundle.tokenUsage.userId,
          bundle.tokenUsage.projectId,
          bundle.tokenUsage.provider,
          bundle.tokenUsage.model,
          bundle.tokenUsage.inputTokens,
          bundle.tokenUsage.outputTokens,
          bundle.tokenUsage.cacheReadTokens,
          bundle.tokenUsage.costUsd,
          bundle.tokenUsage.timestamp,
          bundle.tokenUsage.source,
        ],
      )
      await db.query(
        `
          INSERT INTO token_usage (
            id,
            run_id,
            node_id,
            user_id,
            project_id,
            provider,
            model,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cost_usd,
            timestamp
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE
          SET input_tokens = excluded.input_tokens,
              output_tokens = excluded.output_tokens,
              cache_read_tokens = excluded.cache_read_tokens,
              cost_usd = excluded.cost_usd,
              timestamp = excluded.timestamp
        `,
        [
          bundle.tokenUsage.id,
          bundle.tokenUsage.runId,
          bundle.tokenUsage.nodeId,
          bundle.tokenUsage.userId,
          bundle.tokenUsage.projectId,
          bundle.tokenUsage.provider,
          bundle.tokenUsage.model,
          bundle.tokenUsage.inputTokens,
          bundle.tokenUsage.outputTokens,
          bundle.tokenUsage.cacheReadTokens,
          bundle.tokenUsage.costUsd,
          bundle.tokenUsage.timestamp,
        ],
      )

      return {
        review: bundle.review,
        trace: bundle.trace,
        tokenUsage: bundle.tokenUsage,
      }
    },

    async listAgentReviews(input, context) {
      const rows = await db.query<AgentReviewRow>(
        `
          SELECT *
          FROM agent_reviews
          WHERE organization_id = $1
            AND ($2::text IS NULL OR run_id = $2)
          ORDER BY created_at DESC
        `,
        [context.organizationId, input.runId ?? null],
      )

      return rows.map(mapAgentReview)
    },

    async getEnforcementPolicy(projectId, context) {
      const rows = await db.query<EnforcementPolicyRow>(
        `
          SELECT *
          FROM enforcement_policies
          WHERE organization_id = $1
            AND (project_id IS NULL OR project_id = $2)
          ORDER BY project_id NULLS FIRST, updated_at DESC
        `,
        [context.organizationId, projectId],
      )
      const organizationPolicy = mapOrganizationPolicy(rows.find((row) => row.project_id === null))
      const projectOverride = mapProjectOverride(rows.find((row) => row.project_id === projectId))

      return {
        organizationPolicy,
        projectOverride,
        effectivePolicy: resolveEffectivePolicy(organizationPolicy, projectOverride),
      }
    },

    async saveEnforcementPolicy(policy, context) {
      await db.query(
        `
          INSERT INTO enforcement_policies (
            id,
            organization_id,
            project_id,
            name,
            version,
            policy,
            updated_at
          )
          VALUES ($1, $2, NULL, $3, $4, $5::jsonb, $6)
          ON CONFLICT (id) DO UPDATE
          SET name = excluded.name,
              version = excluded.version,
              policy = excluded.policy,
              updated_at = excluded.updated_at
        `,
        [
          policy.id,
          context.organizationId,
          policy.name,
          policy.version,
          JSON.stringify(policy),
          policy.updatedAt,
        ],
      )

      return policy
    },

    async saveGateOverride(decision, context) {
      await db.query(
        `
          INSERT INTO gate_override_decisions (
            id,
            organization_id,
            run_id,
            node_id,
            project_id,
            user_id,
            role,
            reason,
            blocked_reason_ids,
            policy_version,
            provisional,
            status,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE
          SET reason = excluded.reason,
              blocked_reason_ids = excluded.blocked_reason_ids,
              policy_version = excluded.policy_version,
              provisional = excluded.provisional,
              status = excluded.status,
              created_at = excluded.created_at
        `,
        [
          decision.id,
          context.organizationId,
          decision.runId,
          decision.nodeId,
          decision.projectId,
          decision.userId,
          decision.role,
          decision.reason,
          JSON.stringify(decision.blockedReasonIds),
          decision.policyVersion,
          decision.provisional,
          decision.status,
          decision.createdAt,
        ],
      )

      return decision
    },

    async listGateOverrides(input, context) {
      const rows = await db.query<GateOverrideDecisionRow>(
        `
          SELECT *
          FROM gate_override_decisions
          WHERE organization_id = $1
            AND ($2::text IS NULL OR run_id = $2)
          ORDER BY created_at DESC
        `,
        [context.organizationId, input.runId ?? null],
      )

      return rows.map(mapGateOverride)
    },

    async getRuntimeBudgetPolicy(projectId, context) {
      const rows = await db.query<RuntimeBudgetPolicyRow>(
        `
          SELECT *
          FROM runtime_budget_policies
          WHERE organization_id = $1
            AND project_id = $2
          LIMIT 1
        `,
        [context.organizationId, projectId],
      )

      return rows[0] ? mapRuntimeBudgetPolicy(rows[0]) : null
    },

    async saveRuntimeBudgetPolicy(policy, context) {
      await db.query(
        `
          INSERT INTO runtime_budget_policies (
            project_id,
            organization_id,
            enabled,
            monthly_limit_usd,
            warning_threshold_usd,
            currency,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (project_id) DO UPDATE
          SET enabled = excluded.enabled,
              monthly_limit_usd = excluded.monthly_limit_usd,
              warning_threshold_usd = excluded.warning_threshold_usd,
              currency = excluded.currency,
              updated_at = excluded.updated_at
        `,
        [
          policy.projectId,
          context.organizationId,
          policy.enabled,
          policy.monthlyLimitUsd,
          policy.warningThresholdUsd,
          policy.currency,
          policy.updatedAt,
        ],
      )

      return policy
    },

    async saveRuntimeBudgetApproval(approval, context) {
      await db.query(
        `
          INSERT INTO runtime_budget_approvals (
            id,
            organization_id,
            project_id,
            requested_by,
            approved_by,
            role,
            provider_id,
            max_additional_cost_usd,
            reason,
            status,
            created_at,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE
          SET max_additional_cost_usd = excluded.max_additional_cost_usd,
              reason = excluded.reason,
              status = excluded.status,
              expires_at = excluded.expires_at
        `,
        [
          approval.id,
          context.organizationId,
          approval.projectId,
          approval.requestedBy,
          approval.approvedBy,
          approval.role,
          approval.providerId,
          approval.maxAdditionalCostUsd,
          approval.reason,
          approval.status,
          approval.createdAt,
          approval.expiresAt,
        ],
      )

      return approval
    },

    async listRuntimeBudgetApprovals(input, context) {
      const rows = await db.query<RuntimeBudgetApprovalRow>(
        `
          SELECT *
          FROM runtime_budget_approvals
          WHERE organization_id = $1
            AND ($2::text IS NULL OR project_id = $2)
          ORDER BY created_at DESC
        `,
        [context.organizationId, input.projectId ?? null],
      )

      return rows.map(mapRuntimeBudgetApproval)
    },
  }
}
