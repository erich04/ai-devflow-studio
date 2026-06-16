import {
  formatUsd,
  rollupTokenUsage,
  type AgentEvent,
  type AgentEventKind,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type ArtifactKind,
  type McpServerDefinition,
  type NodeKind,
  type NodeStage,
  type NodeStatus,
  type Project,
  type ProviderCredentialMetadata,
  type RemoteTestEvidenceSummary,
  type RequiredGateRole,
  type Role,
  type TestEvidenceStatus,
  type RunStatus,
  type SkillDefinition,
  type TeamMember,
  type TokenUsage,
  type TokenUsageSource,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { TeamDbClient } from '../db/client'
import type {
  AgentProviderCredentialRecord,
  AgentReviewBundle,
  RunsBundle,
  TeamOverviewPayload,
  TeamRepository,
  TeamRepositorySyncContext,
} from './team-repository'

type TimestampValue = string | Date

type ProjectRow = {
  id: string
  name: string
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
    confidence: Number(row.confidence),
    gateAdvisory: row.gate_advisory as AgentReviewResult['gateAdvisory'],
    createdAt: timestamp(row.created_at),
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

  return {
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
      ])
      const tokenUsage = tokenRows.map(mapTokenUsage)

      return {
        projects: projectRows.map(mapProject),
        members: memberRows.map(mapMember),
        runs: runsBundle.runs,
        projectCost: rollupTokenUsage(tokenUsage, 'projectId'),
        memberCost: rollupTokenUsage(tokenUsage, 'userId'),
        totalCost: formatUsd(tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)),
        testEvidenceSummaries: evidenceRows.map(mapTestEvidenceSummary),
        agentReviews: agentReviewRows.map(mapAgentReview),
        agentTraces: agentTraceRows.map(mapAgentTrace),
        agentTokenUsage: agentTokenRows.map(mapAgentTokenUsage),
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
            confidence,
            gate_advisory,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, '[]'::jsonb, '[]'::jsonb, $14, $15::jsonb, $16)
          ON CONFLICT (id) DO UPDATE
          SET conclusion = excluded.conclusion,
              summary = excluded.summary,
              risks = excluded.risks,
              missing_evidence = excluded.missing_evidence,
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
            confidence,
            gate_advisory,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17::jsonb, $18)
          ON CONFLICT (id) DO UPDATE
          SET conclusion = excluded.conclusion,
              summary = excluded.summary,
              risks = excluded.risks,
              missing_evidence = excluded.missing_evidence,
              suggested_tests = excluded.suggested_tests,
              knowledge_references = excluded.knowledge_references,
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
          bundle.review.confidence,
          JSON.stringify(bundle.review.gateAdvisory),
          bundle.review.createdAt,
        ],
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
  }
}
