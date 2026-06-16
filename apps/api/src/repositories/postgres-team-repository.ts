import {
  formatUsd,
  rollupTokenUsage,
  type AgentEvent,
  type AgentEventKind,
  type Artifact,
  type ArtifactKind,
  type McpServerDefinition,
  type NodeKind,
  type NodeStage,
  type NodeStatus,
  type Project,
  type RemoteTestEvidenceSummary,
  type RequiredGateRole,
  type Role,
  type RunStatus,
  type SkillDefinition,
  type TeamMember,
  type TokenUsage,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { TeamDbClient } from '../db/client'
import type { RunsBundle, TeamOverviewPayload, TeamRepository } from './team-repository'

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
      const [projectRows, memberRows, runsBundle, tokenRows, evidenceRows] = await Promise.all([
        db.query<ProjectRow>('SELECT * FROM projects ORDER BY name ASC'),
        db.query<UserRow>('SELECT * FROM users ORDER BY name ASC'),
        loadRunsBundle(),
        db.query<TokenUsageRow>('SELECT * FROM token_usage ORDER BY timestamp DESC'),
        db.query<TestEvidenceSummaryRow>(
          'SELECT * FROM test_evidence_summaries ORDER BY created_at DESC',
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

    async uploadRunSummary() {
      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'run summary accepted by Postgres repository boundary',
      }
    },

    async uploadTestEvidenceSummary() {
      return {
        accepted: true,
        syncedAt: new Date().toISOString(),
        message: 'test evidence summary accepted by Postgres repository boundary',
      }
    },
  }
}
