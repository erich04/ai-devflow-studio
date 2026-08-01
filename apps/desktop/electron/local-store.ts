import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import {
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  normalizeWorkflowRunProgress,
  redactCodingAgentEventForStorage,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  type AgentEvent,
  type AgentReviewResult,
  type AgentTrace,
  type AgentTokenUsage,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type DesktopPairingCredential,
  type LocalExecutionState,
  type LocalProject,
  type LocalSettings,
  type ManagedCodingWorkspace,
  type McpServerDefinition,
  type GateOverrideDecision,
  type PolicySnapshot,
  type ProviderCredentialMetadata,
  type RetryAttempt,
  type TestEvidence,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
export const CURRENT_SCHEMA_VERSION = 8
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = { themePreference: 'system' }

const require = createRequire(import.meta.url)
const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))

let sqlPromise: Promise<SqlJsStatic> | undefined

function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (fileName) => path.join(sqlJsDist, fileName),
  })
  return sqlPromise
}

export type LocalStoreOptions = {
  dbPath: string
}

export type WorkflowMutation = {
  expectedRun: WorkflowRun
  run: WorkflowRun
  artifacts?: readonly Artifact[]
  events?: readonly AgentEvent[]
  testEvidence?: readonly TestEvidence[]
}

export type WorkflowCreation = {
  run: WorkflowRun
  artifacts: readonly Artifact[]
  events: readonly AgentEvent[]
}

export type WorkflowCreationResult =
  | { created: true }
  | { created: false; reason: 'run_exists' }

export type WorkflowMutationCommitResult =
  | { committed: true }
  | { committed: false; reason: 'run_not_found' | 'stale_run' }

export type LocalStore = {
  upsertProject(project: LocalProject): Promise<void>
  listProjects(): Promise<LocalProject[]>
  saveRun(run: WorkflowRun): Promise<void>
  deleteRun(runId: string): Promise<void>
  getRun(runId: string): Promise<WorkflowRun | null>
  listRuns(): Promise<WorkflowRun[]>
  createWorkflow(
    creation: WorkflowCreation,
  ): Promise<WorkflowCreationResult>
  commitWorkflowMutation(
    mutation: WorkflowMutation,
  ): Promise<WorkflowMutationCommitResult>
  saveArtifact(artifact: Artifact): Promise<void>
  listArtifacts(runId?: string): Promise<Artifact[]>
  saveEvent(event: AgentEvent): Promise<void>
  listEvents(runId?: string): Promise<AgentEvent[]>
  saveTestEvidence(evidence: TestEvidence): Promise<void>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  saveAgentReview(review: AgentReviewResult): Promise<void>
  listAgentReviews(runId?: string): Promise<AgentReviewResult[]>
  saveAgentTrace(trace: AgentTrace): Promise<void>
  listAgentTraces(runId?: string): Promise<AgentTrace[]>
  saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void>
  listAgentTokenUsage(runId?: string): Promise<AgentTokenUsage[]>
  saveCodingAgentRun(run: CodingAgentRun): Promise<void>
  listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]>
  saveCodingAgentEvent(event: CodingAgentEvent): Promise<void>
  listCodingAgentEvents(codingRunId?: string): Promise<CodingAgentEvent[]>
  saveCodingPermissionRequest(request: CodingPermissionRequest): Promise<void>
  listCodingPermissionRequests(codingRunId?: string): Promise<CodingPermissionRequest[]>
  saveCodingPermissionDecision(decision: CodingPermissionDecision): Promise<void>
  listCodingPermissionDecisions(codingRunId?: string): Promise<CodingPermissionDecision[]>
  saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace): Promise<void>
  listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]>
  saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence): Promise<void>
  listDependencyBootstrapEvidence(codingRunId?: string): Promise<DependencyBootstrapEvidence[]>
  saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void>
  listCodingDiffArtifacts(runId?: string): Promise<CodingDiffArtifact[]>
  saveProviderCredential(
    metadata: ProviderCredentialMetadata,
    encryptedSecret: string,
  ): Promise<ProviderCredentialMetadata>
  listProviderCredentials(): Promise<ProviderCredentialMetadata[]>
  getProviderEncryptedSecret(providerId: string): Promise<string | null>
  saveDesktopPairingCredential(
    credential: DesktopPairingCredential,
    encryptedToken: string,
  ): Promise<DesktopPairingCredential>
  getDesktopPairingCredential(): Promise<DesktopPairingCredential | null>
  getDesktopPairingEncryptedToken(): Promise<string | null>
  savePolicySnapshot(snapshot: PolicySnapshot): Promise<PolicySnapshot>
  getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null>
  saveGateOverride(decision: GateOverrideDecision): Promise<GateOverrideDecision>
  listGateOverrides(runId?: string): Promise<GateOverrideDecision[]>
  saveRetryAttempt(attempt: RetryAttempt): Promise<RetryAttempt>
  listRetryAttempts(runId?: string): Promise<RetryAttempt[]>
  saveSettings(settings: Partial<LocalSettings>): Promise<LocalSettings>
  getSettings(): Promise<LocalSettings>
  saveMcpServers(servers: McpServerDefinition[]): Promise<McpServerDefinition[]>
  listMcpServers(): Promise<McpServerDefinition[]>
  getSchemaVersion(): Promise<number>
  loadState(): Promise<LocalExecutionState>
  close(): void
}

type SchemaMigration = {
  version: number
  migrate(db: Database): void
}

const schemaMigrations: readonly SchemaMigration[] = [
  {
    version: 1,
    migrate(db) {
      db.run(`
    create table if not exists schema_meta (
      key text primary key,
      value text not null
    );

    create table if not exists local_projects (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_runs (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists artifacts (
      id text primary key,
      run_id text not null,
      json text not null,
      updated_at text not null
    );

    create table if not exists agent_events (
      id text primary key,
      run_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists test_evidence (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 2,
    migrate(db) {
      db.run(`
    create table if not exists local_settings (
      key text primary key,
      json text not null,
      updated_at text not null
    );

    create table if not exists mcp_servers (
      id text primary key,
      json text not null,
      updated_at text not null
    );

    insert into local_settings (key, json, updated_at)
    values ('settings', '${JSON.stringify(DEFAULT_LOCAL_SETTINGS)}', datetime('now'))
    on conflict(key) do nothing;
      `)
    },
  },
  {
    version: 3,
    migrate(db) {
      db.run(`

    create table if not exists agent_reviews (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_traces (
      id text primary key,
      run_id text not null,
      node_id text not null,
      review_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_token_usage (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists provider_credentials (
      provider_id text primary key,
      json text not null,
      encrypted_secret text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 4,
    migrate(db) {
      db.run(`

    create table if not exists coding_agent_runs (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      started_at text not null,
      updated_at text not null
    );

    create table if not exists coding_agent_events (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists coding_permission_requests (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      json text not null,
      requested_at text not null
    );

    create table if not exists coding_permission_decisions (
      id text primary key,
      request_id text not null,
      coding_run_id text not null,
      json text not null,
      decided_at text not null
    );

    create table if not exists managed_coding_workspaces (
      id text primary key,
      project_id text not null,
      coding_run_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists dependency_bootstrap_evidence (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists coding_diff_artifacts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 5,
    migrate(db) {
      db.run(`

    create table if not exists policy_snapshots (
      project_id text primary key,
      json text not null,
      synced_at text not null
    );

    create table if not exists gate_overrides (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 6,
    migrate(db) {
      db.run(`

    create table if not exists retry_attempts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 7,
    migrate(db) {
      db.run(`

    create table if not exists desktop_pairing_credentials (
      id text primary key,
      json text not null,
      encrypted_token text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 8,
    migrate(db) {
      db.run(`

    create table if not exists workflow_nodes (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      stage text not null,
      title text not null,
      subtitle text not null,
      kind text not null,
      status text not null,
      owner_id text not null,
      required_role text,
      retry_count integer not null default 0,
      token_usage_id text,
      artifact_ids text not null default '[]',
      position integer not null default 0,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_edges (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      source_node_id text not null,
      target_node_id text not null,
      kind text not null,
      position integer not null default 0,
      json text not null,
      created_at text not null
    );

    create index if not exists idx_workflow_nodes_run_id_position
      on workflow_nodes(run_id, position);

    create index if not exists idx_workflow_edges_run_id_position
      on workflow_edges(run_id, position);
      `)
      migrateWorkflowRunsIntoRelationalTables(db)
    },
  },
]

function migrateSchema(db: Database) {
  const schemaMetaExists = Boolean(
    db.exec("select name from sqlite_master where type = 'table' and name = 'schema_meta'")[0]
      ?.values.length,
  )
  const existingVersion = schemaMetaExists ? readSchemaVersion(db) : 0
  if (existingVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `DevFlow local database schema version ${existingVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    )
  }

  for (const migration of schemaMigrations) {
    if (migration.version <= existingVersion) {
      continue
    }

    db.run('begin transaction')
    try {
      migration.migrate(db)
      db.run(
        `insert into schema_meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value`,
        [String(migration.version)],
      )
      db.run('commit')
    } catch (error) {
      db.run('rollback')
      throw error
    }
  }

  db.run('begin transaction')
  try {
    redactStoredEvidencePrivacy(db)
    db.run('commit')
  } catch (error) {
    db.run('rollback')
    throw error
  }
}

function readSchemaVersion(db: Database): number {
  const result = db.exec("select value from schema_meta where key = 'schema_version'")
  const value = result[0]?.values[0]?.[0]
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('DevFlow local database schema version is missing or invalid')
  }

  return parsed
}

function parseJsonRows<T>(rows: SqlValue[][]): T[] {
  return rows.map((row) => JSON.parse(String(row[0])) as T)
}

function selectJson<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const result = db.exec(sql, params)
  const first = result[0]
  if (!first) {
    return []
  }

  return parseJsonRows<T>(first.values)
}

function selectStringColumn(db: Database, sql: string, params: SqlValue[] = []): string[] {
  const result = db.exec(sql, params)
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => String(row[0]))
}

function deleteWhereIn(db: Database, table: string, column: string, values: string[]): void {
  if (values.length === 0) {
    return
  }

  const placeholders = values.map(() => '?').join(', ')
  db.run(`delete from ${table} where ${column} in (${placeholders})`, values)
}

type StoredWorkflowRunJson = Omit<WorkflowRun, 'nodes' | 'edges'> & {
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

function workflowRunEnvelope(run: WorkflowRun): Omit<WorkflowRun, 'nodes' | 'edges'> {
  const { nodes: _nodes, edges: _edges, ...envelope } = run
  return envelope
}

function writeWorkflowRunEnvelope(db: Database, run: WorkflowRun): void {
  const envelope = workflowRunEnvelope(run)
  db.run(
    `
    insert into workflow_runs (id, json, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [run.id, JSON.stringify(envelope), run.createdAt, run.updatedAt],
  )
}

function replaceWorkflowNodes(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_nodes where run_id = ?', [run.id])
  for (const [position, node] of run.nodes.entries()) {
    db.run(
      `
      insert into workflow_nodes (
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
        artifact_ids,
        position,
        json,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        node.id,
        run.id,
        node.stage,
        node.title,
        node.subtitle,
        node.kind,
        node.status,
        node.ownerId,
        node.requiredRole ?? null,
        node.retryCount,
        node.tokenUsageId ?? null,
        JSON.stringify(node.artifactIds),
        position,
        JSON.stringify(node),
        run.createdAt,
        run.updatedAt,
      ],
    )
  }
}

function replaceWorkflowEdges(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_edges where run_id = ?', [run.id])
  for (const [position, edge] of run.edges.entries()) {
    db.run(
      `
      insert into workflow_edges (
        id,
        run_id,
        source_node_id,
        target_node_id,
        kind,
        position,
        json,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        edge.id,
        run.id,
        edge.source,
        edge.target,
        edge.kind,
        position,
        JSON.stringify(edge),
        run.createdAt,
      ],
    )
  }
}

function selectWorkflowNodeRows(db: Database): Array<{ runId: string; node: WorkflowNode }> {
  const result = db.exec('select run_id, json from workflow_nodes order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    node: JSON.parse(String(row[1])) as WorkflowNode,
  }))
}

function selectWorkflowEdgeRows(db: Database): Array<{ runId: string; edge: WorkflowEdge }> {
  const result = db.exec('select run_id, json from workflow_edges order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    edge: JSON.parse(String(row[1])) as WorkflowEdge,
  }))
}

function groupRowsByRunId<T>(rows: Array<{ runId: string } & T>): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const existing = grouped.get(row.runId) ?? []
    const { runId: _runId, ...value } = row
    grouped.set(row.runId, [...existing, value as T])
  }
  return grouped
}

function migrateWorkflowRunsIntoRelationalTables(db: Database): void {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  for (const storedRun of storedRuns) {
    const runNodes = storedRun.nodes ?? []
    const runEdges = storedRun.edges ?? []
    if (runNodes.length === 0 && runEdges.length === 0) {
      continue
    }

    const run = normalizeWorkflowRunProgress({
      ...storedRun,
      nodes: runNodes,
      edges: runEdges,
    })
    writeWorkflowRunEnvelope(db, run)
    replaceWorkflowNodes(db, run)
    replaceWorkflowEdges(db, run)
  }
}

function readWorkflowRuns(db: Database): WorkflowRun[] {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  const nodesByRun = groupRowsByRunId(selectWorkflowNodeRows(db)).entries()
  const edgesByRun = groupRowsByRunId(selectWorkflowEdgeRows(db)).entries()
  const nodeMap = new Map(
    Array.from(nodesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.node),
    ]),
  )
  const edgeMap = new Map(
    Array.from(edgesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.edge),
    ]),
  )

  return storedRuns.map((storedRun) =>
    normalizeWorkflowRunProgress({
      ...storedRun,
      nodes: nodeMap.get(storedRun.id) ?? storedRun.nodes ?? [],
      edges: edgeMap.get(storedRun.id) ?? storedRun.edges ?? [],
    }),
  )
}

function writeWorkflowRun(db: Database, run: WorkflowRun): void {
  writeWorkflowRunEnvelope(db, run)
  replaceWorkflowNodes(db, run)
  replaceWorkflowEdges(db, run)
}

function redactArtifactForStorage(artifact: Artifact): Artifact {
  if (artifact.kind !== 'test_report') {
    return artifact
  }
  const title = redactSensitiveText(artifact.title)
  const summary = redactSensitiveText(artifact.summary)
  const content = redactSensitiveText(artifact.content)
  return {
    ...artifact,
    title: title.value,
    summary: summary.value,
    content: content.value,
    redacted: true,
  }
}

function writeArtifact(db: Database, artifact: Artifact): void {
  const safeArtifact = redactArtifactForStorage(artifact)
  db.run(
    `
    insert into artifacts (id, run_id, json, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [
      safeArtifact.id,
      safeArtifact.runId,
      JSON.stringify(safeArtifact),
      safeArtifact.updatedAt,
    ],
  )
}

function redactAgentEventForStorage(event: AgentEvent): AgentEvent {
  return event.kind === 'test_result'
    ? { ...event, message: redactSensitiveText(event.message).value }
    : event
}

function writeAgentEvent(db: Database, event: AgentEvent): void {
  const safeEvent = redactAgentEventForStorage(event)
  db.run(
    `
    insert into agent_events (id, run_id, sequence, json, timestamp)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
    `,
    [
      safeEvent.id,
      safeEvent.runId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
    ],
  )
}

function writeCodingAgentEvent(db: Database, event: CodingAgentEvent): void {
  const safeEvent = redactCodingAgentEventForStorage(event)
  db.run(
    `
    insert into coding_agent_events (id, coding_run_id, run_id, node_id, sequence, json, timestamp)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
    `,
    [
      safeEvent.id,
      safeEvent.codingRunId,
      safeEvent.runId,
      safeEvent.nodeId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
    ],
  )
}

function writeTestEvidence(db: Database, evidence: TestEvidence): void {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  db.run(
    `
    insert into test_evidence (id, run_id, node_id, project_id, json, created_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
    `,
    [
      safeEvidence.id,
      safeEvidence.runId,
      safeEvidence.nodeId,
      safeEvidence.projectId,
      JSON.stringify(safeEvidence),
      safeEvidence.createdAt,
    ],
  )
}

function redactStoredEvidencePrivacy(db: Database): void {
  const stored = selectJson<TestEvidence>(
    db,
    'select json from test_evidence order by created_at asc',
  )
  const artifacts = selectJson<Artifact>(db, 'select json from artifacts')
  for (const artifact of artifacts) {
    const safeArtifact = redactArtifactForStorage(artifact)
    if (JSON.stringify(safeArtifact) !== JSON.stringify(artifact)) {
      writeArtifact(db, safeArtifact)
    }
  }
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const eventsById = new Map(
    selectJson<AgentEvent>(db, 'select json from agent_events').map((event) => [event.id, event]),
  )
  const codingEvents = selectJson<CodingAgentEvent>(
    db,
    'select json from coding_agent_events order by timestamp asc, sequence asc',
  )
  for (const event of codingEvents) {
    const safeEvent = redactCodingAgentEventForStorage(event)
    if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
      writeCodingAgentEvent(db, safeEvent)
    }
  }
  for (const event of eventsById.values()) {
    const safeEvent = redactAgentEventForStorage(event)
    if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
      writeAgentEvent(db, safeEvent)
    }
  }
  for (const evidence of stored) {
    const safeEvidence = redactTestEvidenceForStorage(evidence)
    const artifact = artifactsById.get(`artifact-${evidence.id}`)
    if (
      artifact?.kind === 'test_report' &&
      artifact.runId === evidence.runId &&
      artifact.nodeId === evidence.nodeId
    ) {
      const safeArtifact = createTestEvidenceArtifact(safeEvidence)
      if (JSON.stringify(safeArtifact) !== JSON.stringify(artifact)) {
        writeArtifact(db, safeArtifact)
      }
    }
    const event = eventsById.get(`event-${evidence.id}`)
    if (
      event?.kind === 'test_result' &&
      event.runId === evidence.runId &&
      event.nodeId === evidence.nodeId
    ) {
      const safeEvent = createTestEvidenceEvent(safeEvidence, event.sequence)
      if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
        writeAgentEvent(db, safeEvent)
      }
    }
    if (JSON.stringify(safeEvidence) !== JSON.stringify(evidence)) {
      writeTestEvidence(db, safeEvidence)
    }
  }
}

function assertWorkflowMutationScope(mutation: WorkflowMutation): void {
  if (mutation.expectedRun.id !== mutation.run.id) {
    throw new Error('Workflow mutation run does not match its expected run')
  }
  const runId = mutation.run.id
  if (
    mutation.artifacts?.some((artifact) => artifact.runId !== runId) ||
    mutation.events?.some((event) => event.runId !== runId) ||
    mutation.testEvidence?.some((evidence) => evidence.runId !== runId)
  ) {
    throw new Error('Workflow mutation candidates must belong to the mutated run')
  }
}

function assertWorkflowCreationScope(creation: WorkflowCreation): void {
  const runId = creation.run.id
  if (
    creation.artifacts.some((artifact) => artifact.runId !== runId) ||
    creation.events.some((event) => event.runId !== runId)
  ) {
    throw new Error('Workflow creation candidates must belong to the created run')
  }
}

class SqlJsLocalStore implements LocalStore {
  private persistenceQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly sql: SqlJsStatic,
    private db: Database,
    private readonly dbPath: string,
  ) {}

  async upsertProject(project: LocalProject): Promise<void> {
    this.db.run(
      `
      insert into local_projects (id, json, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [project.id, JSON.stringify(project), project.createdAt, project.updatedAt],
    )
    await this.persist()
  }

  async listProjects(): Promise<LocalProject[]> {
    return selectJson<LocalProject>(
      this.db,
      'select json from local_projects order by updated_at desc, created_at desc',
    )
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    const normalizedRun = normalizeWorkflowRunProgress(run)
    this.db.run('begin transaction')
    try {
      writeWorkflowRun(this.db, normalizedRun)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
  }

  async deleteRun(runId: string): Promise<void> {
    const trimmedRunId = runId.trim()
    if (!trimmedRunId) {
      throw new Error('Invalid runId')
    }

    this.db.run('begin transaction')
    try {
      const codingRunIds = selectStringColumn(
        this.db,
        'select id from coding_agent_runs where run_id = ? order by id asc',
        [trimmedRunId],
      )
      const permissionRequestIds = selectStringColumn(
        this.db,
        'select id from coding_permission_requests where run_id = ? order by id asc',
        [trimmedRunId],
      )

      deleteWhereIn(this.db, 'coding_permission_decisions', 'coding_run_id', codingRunIds)
      deleteWhereIn(this.db, 'coding_permission_decisions', 'request_id', permissionRequestIds)
      this.db.run('delete from coding_permission_requests where run_id = ?', [trimmedRunId])
      this.db.run('delete from dependency_bootstrap_evidence where run_id = ?', [trimmedRunId])
      deleteWhereIn(this.db, 'managed_coding_workspaces', 'coding_run_id', codingRunIds)
      this.db.run('delete from coding_agent_events where run_id = ?', [trimmedRunId])
      this.db.run('delete from coding_diff_artifacts where run_id = ?', [trimmedRunId])
      this.db.run('delete from retry_attempts where run_id = ?', [trimmedRunId])
      this.db.run('delete from gate_overrides where run_id = ?', [trimmedRunId])
      this.db.run('delete from coding_agent_runs where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_traces where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_reviews where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_token_usage where run_id = ?', [trimmedRunId])
      this.db.run('delete from test_evidence where run_id = ?', [trimmedRunId])
      this.db.run('delete from artifacts where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_events where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_edges where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_nodes where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_runs where id = ?', [trimmedRunId])
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }

    await this.persist()
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return readWorkflowRuns(this.db).find((run) => run.id === runId) ?? null
  }

  async listRuns(): Promise<WorkflowRun[]> {
    return readWorkflowRuns(this.db)
  }

  async createWorkflow(
    creation: WorkflowCreation,
  ): Promise<WorkflowCreationResult> {
    assertWorkflowCreationScope(creation)
    if (readWorkflowRuns(this.db).some((run) => run.id === creation.run.id)) {
      return { created: false, reason: 'run_exists' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeWorkflowRun(this.db, normalizeWorkflowRunProgress(creation.run))
      for (const artifact of creation.artifacts) {
        writeArtifact(this.db, artifact)
      }
      for (const event of creation.events) {
        writeAgentEvent(this.db, event)
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { created: true }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitWorkflowMutation(
    mutation: WorkflowMutation,
  ): Promise<WorkflowMutationCommitResult> {
    assertWorkflowMutationScope(mutation)
    const expectedRun = normalizeWorkflowRunProgress(mutation.expectedRun)
    const currentRun = readWorkflowRuns(this.db).find(
      (candidate) => candidate.id === expectedRun.id,
    )
    if (!currentRun) {
      return { committed: false, reason: 'run_not_found' }
    }
    if (JSON.stringify(currentRun) !== JSON.stringify(expectedRun)) {
      return { committed: false, reason: 'stale_run' }
    }

    const snapshot = this.db.export()
    const nextRun = normalizeWorkflowRunProgress(mutation.run)
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeWorkflowRun(this.db, nextRun)
      for (const artifact of mutation.artifacts ?? []) {
        writeArtifact(this.db, artifact)
      }
      for (const event of mutation.events ?? []) {
        writeAgentEvent(this.db, event)
      }
      for (const evidence of mutation.testEvidence ?? []) {
        writeTestEvidence(this.db, evidence)
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The snapshot below is authoritative even if SQLite already closed the transaction.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    writeArtifact(this.db, artifact)
    await this.persist()
  }

  async listArtifacts(runId?: string): Promise<Artifact[]> {
    if (runId) {
      return selectJson<Artifact>(
        this.db,
        'select json from artifacts where run_id = ? order by updated_at asc',
        [runId],
      )
    }

    return selectJson<Artifact>(this.db, 'select json from artifacts order by updated_at asc')
  }

  async saveEvent(event: AgentEvent): Promise<void> {
    writeAgentEvent(this.db, event)
    await this.persist()
  }

  async listEvents(runId?: string): Promise<AgentEvent[]> {
    if (runId) {
      return selectJson<AgentEvent>(
        this.db,
        'select json from agent_events where run_id = ? order by sequence asc, timestamp asc',
        [runId],
      )
    }

    return selectJson<AgentEvent>(
      this.db,
      'select json from agent_events order by timestamp asc, sequence asc',
    )
  }

  async saveTestEvidence(evidence: TestEvidence): Promise<void> {
    writeTestEvidence(this.db, evidence)
    await this.persist()
  }

  async listTestEvidence(runId?: string): Promise<TestEvidence[]> {
    if (runId) {
      return selectJson<TestEvidence>(
        this.db,
        'select json from test_evidence where run_id = ? order by created_at asc',
        [runId],
      )
    }

    return selectJson<TestEvidence>(this.db, 'select json from test_evidence order by created_at asc')
  }

  async saveAgentReview(review: AgentReviewResult): Promise<void> {
    this.db.run(
      `
      insert into agent_reviews (id, run_id, node_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [review.id, review.runId, review.nodeId, JSON.stringify(review), review.createdAt],
    )
    await this.persist()
  }

  async listAgentReviews(runId?: string): Promise<AgentReviewResult[]> {
    if (runId) {
      return selectJson<AgentReviewResult>(
        this.db,
        'select json from agent_reviews where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<AgentReviewResult>(
      this.db,
      'select json from agent_reviews order by created_at desc',
    )
  }

  async saveAgentTrace(trace: AgentTrace): Promise<void> {
    this.db.run(
      `
      insert into agent_traces (id, run_id, node_id, review_id, json, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [trace.id, trace.runId, trace.nodeId, trace.reviewId, JSON.stringify(trace), trace.createdAt],
    )
    await this.persist()
  }

  async listAgentTraces(runId?: string): Promise<AgentTrace[]> {
    if (runId) {
      return selectJson<AgentTrace>(
        this.db,
        'select json from agent_traces where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<AgentTrace>(
      this.db,
      'select json from agent_traces order by created_at desc',
    )
  }

  async saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void> {
    this.db.run(
      `
      insert into agent_token_usage (id, run_id, node_id, json, timestamp)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, timestamp = excluded.timestamp
      `,
      [usage.id, usage.runId, usage.nodeId, JSON.stringify(usage), usage.timestamp],
    )
    await this.persist()
  }

  async listAgentTokenUsage(runId?: string): Promise<AgentTokenUsage[]> {
    if (runId) {
      return selectJson<AgentTokenUsage>(
        this.db,
        'select json from agent_token_usage where run_id = ? order by timestamp desc',
        [runId],
      )
    }

    return selectJson<AgentTokenUsage>(
      this.db,
      'select json from agent_token_usage order by timestamp desc',
    )
  }

  async saveCodingAgentRun(run: CodingAgentRun): Promise<void> {
    this.db.run(
      `
      insert into coding_agent_runs (id, run_id, node_id, json, started_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [
        run.id,
        run.runId,
        run.nodeId,
        JSON.stringify(run),
        run.startedAt,
        run.completedAt ?? run.startedAt,
      ],
    )
    await this.persist()
  }

  async listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]> {
    if (runId) {
      return selectJson<CodingAgentRun>(
        this.db,
        'select json from coding_agent_runs where run_id = ? order by updated_at desc, started_at desc',
        [runId],
      )
    }

    return selectJson<CodingAgentRun>(
      this.db,
      'select json from coding_agent_runs order by updated_at desc, started_at desc',
    )
  }

  async saveCodingAgentEvent(event: CodingAgentEvent): Promise<void> {
    writeCodingAgentEvent(this.db, event)
    await this.persist()
  }

  async listCodingAgentEvents(codingRunId?: string): Promise<CodingAgentEvent[]> {
    if (codingRunId) {
      return selectJson<CodingAgentEvent>(
        this.db,
        'select json from coding_agent_events where coding_run_id = ? order by sequence asc, timestamp asc',
        [codingRunId],
      )
    }

    return selectJson<CodingAgentEvent>(
      this.db,
      'select json from coding_agent_events order by timestamp asc, sequence asc',
    )
  }

  async saveCodingPermissionRequest(request: CodingPermissionRequest): Promise<void> {
    this.db.run(
      `
      insert into coding_permission_requests (id, coding_run_id, run_id, node_id, json, requested_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, requested_at = excluded.requested_at
      `,
      [
        request.id,
        request.codingRunId,
        request.runId,
        request.nodeId,
        JSON.stringify(request),
        request.requestedAt,
      ],
    )
    await this.persist()
  }

  async listCodingPermissionRequests(codingRunId?: string): Promise<CodingPermissionRequest[]> {
    if (codingRunId) {
      return selectJson<CodingPermissionRequest>(
        this.db,
        'select json from coding_permission_requests where coding_run_id = ? order by requested_at asc',
        [codingRunId],
      )
    }

    return selectJson<CodingPermissionRequest>(
      this.db,
      'select json from coding_permission_requests order by requested_at asc',
    )
  }

  async saveCodingPermissionDecision(decision: CodingPermissionDecision): Promise<void> {
    this.db.run(
      `
      insert into coding_permission_decisions (id, request_id, coding_run_id, json, decided_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, decided_at = excluded.decided_at
      `,
      [
        decision.id,
        decision.requestId,
        decision.codingRunId,
        JSON.stringify(decision),
        decision.decidedAt,
      ],
    )
    await this.persist()
  }

  async listCodingPermissionDecisions(codingRunId?: string): Promise<CodingPermissionDecision[]> {
    if (codingRunId) {
      return selectJson<CodingPermissionDecision>(
        this.db,
        'select json from coding_permission_decisions where coding_run_id = ? order by decided_at asc',
        [codingRunId],
      )
    }

    return selectJson<CodingPermissionDecision>(
      this.db,
      'select json from coding_permission_decisions order by decided_at asc',
    )
  }

  async saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace): Promise<void> {
    this.db.run(
      `
      insert into managed_coding_workspaces (id, project_id, coding_run_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json
      `,
      [
        workspace.id,
        workspace.projectId,
        workspace.codingRunId,
        JSON.stringify(workspace),
        workspace.createdAt,
      ],
    )
    await this.persist()
  }

  async listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]> {
    if (projectId) {
      return selectJson<ManagedCodingWorkspace>(
        this.db,
        'select json from managed_coding_workspaces where project_id = ? order by created_at desc',
        [projectId],
      )
    }

    return selectJson<ManagedCodingWorkspace>(
      this.db,
      'select json from managed_coding_workspaces order by created_at desc',
    )
  }

  async saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence): Promise<void> {
    this.db.run(
      `
      insert into dependency_bootstrap_evidence (id, coding_run_id, run_id, node_id, project_id, json, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [
        evidence.id,
        evidence.codingRunId,
        evidence.runId,
        evidence.nodeId,
        evidence.projectId,
        JSON.stringify(evidence),
        evidence.createdAt,
      ],
    )
    await this.persist()
  }

  async listDependencyBootstrapEvidence(codingRunId?: string): Promise<DependencyBootstrapEvidence[]> {
    if (codingRunId) {
      return selectJson<DependencyBootstrapEvidence>(
        this.db,
        'select json from dependency_bootstrap_evidence where coding_run_id = ? order by created_at asc',
        [codingRunId],
      )
    }

    return selectJson<DependencyBootstrapEvidence>(
      this.db,
      'select json from dependency_bootstrap_evidence order by created_at asc',
    )
  }

  async saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void> {
    this.db.run(
      `
      insert into coding_diff_artifacts (id, run_id, node_id, project_id, json, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [
        artifact.id,
        artifact.runId,
        artifact.nodeId,
        artifact.projectId,
        JSON.stringify(artifact),
        artifact.createdAt,
      ],
    )
    await this.persist()
  }

  async listCodingDiffArtifacts(runId?: string): Promise<CodingDiffArtifact[]> {
    if (runId) {
      return selectJson<CodingDiffArtifact>(
        this.db,
        'select json from coding_diff_artifacts where run_id = ? order by created_at asc',
        [runId],
      )
    }

    return selectJson<CodingDiffArtifact>(
      this.db,
      'select json from coding_diff_artifacts order by created_at asc',
    )
  }

  async saveProviderCredential(
    metadata: ProviderCredentialMetadata,
    encryptedSecret: string,
  ): Promise<ProviderCredentialMetadata> {
    this.db.run(
      `
      insert into provider_credentials (provider_id, json, encrypted_secret, updated_at)
      values (?, ?, ?, ?)
      on conflict(provider_id) do update set
        json = excluded.json,
        encrypted_secret = excluded.encrypted_secret,
        updated_at = excluded.updated_at
      `,
      [
        metadata.providerId,
        JSON.stringify(metadata),
        encryptedSecret,
        metadata.updatedAt,
      ],
    )
    await this.persist()
    return metadata
  }

  async listProviderCredentials(): Promise<ProviderCredentialMetadata[]> {
    return selectJson<ProviderCredentialMetadata>(
      this.db,
      'select json from provider_credentials order by updated_at desc',
    )
  }

  async getProviderEncryptedSecret(providerId: string): Promise<string | null> {
    const result = this.db.exec(
      'select encrypted_secret from provider_credentials where provider_id = ?',
      [providerId],
    )
    const value = result[0]?.values[0]?.[0]
    return typeof value === 'string' ? value : null
  }

  async saveDesktopPairingCredential(
    credential: DesktopPairingCredential,
    encryptedToken: string,
  ): Promise<DesktopPairingCredential> {
    this.db.run(
      `
      insert into desktop_pairing_credentials (id, json, encrypted_token, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set
        json = excluded.json,
        encrypted_token = excluded.encrypted_token,
        updated_at = excluded.updated_at
      `,
      [
        'default',
        JSON.stringify(credential),
        encryptedToken,
        credential.createdAt,
      ],
    )
    await this.persist()
    return credential
  }

  async getDesktopPairingCredential(): Promise<DesktopPairingCredential | null> {
    const [credential] = selectJson<DesktopPairingCredential>(
      this.db,
      "select json from desktop_pairing_credentials where id = 'default'",
    )
    return credential ?? null
  }

  async getDesktopPairingEncryptedToken(): Promise<string | null> {
    const result = this.db.exec(
      "select encrypted_token from desktop_pairing_credentials where id = 'default'",
    )
    const value = result[0]?.values[0]?.[0]
    return typeof value === 'string' ? value : null
  }

  async savePolicySnapshot(snapshot: PolicySnapshot): Promise<PolicySnapshot> {
    this.db.run(
      `
      insert into policy_snapshots (project_id, json, synced_at)
      values (?, ?, ?)
      on conflict(project_id) do update set json = excluded.json, synced_at = excluded.synced_at
      `,
      [snapshot.projectId, JSON.stringify(snapshot), snapshot.syncedAt],
    )
    await this.persist()
    return snapshot
  }

  async getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null> {
    const [snapshot] = selectJson<PolicySnapshot>(
      this.db,
      'select json from policy_snapshots where project_id = ?',
      [projectId],
    )

    return snapshot ?? null
  }

  async saveGateOverride(decision: GateOverrideDecision): Promise<GateOverrideDecision> {
    this.db.run(
      `
      insert into gate_overrides (id, run_id, node_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [decision.id, decision.runId, decision.nodeId, JSON.stringify(decision), decision.createdAt],
    )
    await this.persist()
    return decision
  }

  async listGateOverrides(runId?: string): Promise<GateOverrideDecision[]> {
    if (runId) {
      return selectJson<GateOverrideDecision>(
        this.db,
        'select json from gate_overrides where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<GateOverrideDecision>(
      this.db,
      'select json from gate_overrides order by created_at desc',
    )
  }

  async saveRetryAttempt(attempt: RetryAttempt): Promise<RetryAttempt> {
    this.db.run(
      `
      insert into retry_attempts (id, run_id, node_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [attempt.id, attempt.runId, attempt.nodeId, JSON.stringify(attempt), attempt.createdAt],
    )
    await this.persist()
    return attempt
  }

  async listRetryAttempts(runId?: string): Promise<RetryAttempt[]> {
    if (runId) {
      return selectJson<RetryAttempt>(
        this.db,
        'select json from retry_attempts where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<RetryAttempt>(
      this.db,
      'select json from retry_attempts order by created_at desc',
    )
  }

  async saveSettings(settings: Partial<LocalSettings>): Promise<LocalSettings> {
    const updated: LocalSettings = {
      ...(await this.getSettings()),
      ...settings,
    }
    this.db.run(
      `
      insert into local_settings (key, json, updated_at)
      values ('settings', ?, ?)
      on conflict(key) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [JSON.stringify(updated), new Date().toISOString()],
    )
    await this.persist()
    return updated
  }

  async getSettings(): Promise<LocalSettings> {
    const [settings] = selectJson<LocalSettings>(
      this.db,
      "select json from local_settings where key = 'settings'",
    )
    return settings ?? DEFAULT_LOCAL_SETTINGS
  }

  async saveMcpServers(servers: McpServerDefinition[]): Promise<McpServerDefinition[]> {
    this.db.run('delete from mcp_servers')
    const updatedAt = new Date().toISOString()
    for (const server of servers) {
      this.db.run(
        `
        insert into mcp_servers (id, json, updated_at)
        values (?, ?, ?)
        `,
        [server.id, JSON.stringify(server), updatedAt],
      )
    }
    await this.persist()
    return servers
  }

  async listMcpServers(): Promise<McpServerDefinition[]> {
    return selectJson<McpServerDefinition>(
      this.db,
      "select json from mcp_servers order by json_extract(json, '$.name') asc, id asc",
    )
  }

  async getSchemaVersion(): Promise<number> {
    return readSchemaVersion(this.db)
  }

  async loadState(): Promise<LocalExecutionState> {
    const [
      projects,
      runs,
      artifacts,
      events,
      testEvidence,
      agentReviews,
      agentTraces,
      agentTokenUsage,
      codingRuns,
      codingEvents,
      codingPermissionRequests,
      codingPermissionDecisions,
      managedCodingWorkspaces,
      dependencyBootstrapEvidence,
      codingDiffArtifacts,
      retryAttempts,
      desktopPairingCredential,
      settings,
      mcpServers,
    ] = await Promise.all([
      this.listProjects(),
      this.listRuns(),
      this.listArtifacts(),
      this.listEvents(),
      this.listTestEvidence(),
      this.listAgentReviews(),
      this.listAgentTraces(),
      this.listAgentTokenUsage(),
      this.listCodingAgentRuns(),
      this.listCodingAgentEvents(),
      this.listCodingPermissionRequests(),
      this.listCodingPermissionDecisions(),
      this.listManagedCodingWorkspaces(),
      this.listDependencyBootstrapEvidence(),
      this.listCodingDiffArtifacts(),
      this.listRetryAttempts(),
      this.getDesktopPairingCredential(),
      this.getSettings(),
      this.listMcpServers(),
    ])

    return {
      projects,
      runs,
      artifacts,
      events,
      testEvidence,
      agentReviews,
      agentTraces,
      agentTokenUsage,
      codingRuns,
      codingEvents,
      codingPermissionRequests,
      codingPermissionDecisions,
      managedCodingWorkspaces,
      dependencyBootstrapEvidence,
      codingDiffArtifacts,
      retryAttempts,
      desktopPairingCredential,
      settings,
      mcpServers,
    }
  }

  close(): void {
    this.db.close()
  }

  private restore(snapshot: Uint8Array): void {
    this.db.close()
    this.db = new this.sql.Database(snapshot)
  }

  private async persist(): Promise<void> {
    const persistence = this.persistenceQueue.then(() => persistDatabase(this.db, this.dbPath))
    this.persistenceQueue = persistence.catch(() => undefined)
    await persistence
  }
}

export async function createLocalStore(options: LocalStoreOptions): Promise<LocalStore> {
  const SQL = await loadSql()

  try {
    const db = existsSync(options.dbPath)
      ? new SQL.Database(await readFile(options.dbPath))
      : new SQL.Database()

    migrateSchema(db)
    await persistDatabase(db, options.dbPath)

    return new SqlJsLocalStore(SQL, db, options.dbPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `DevFlow local database is unreadable at ${options.dbPath}. Back up or remove this file to rebuild local state. Cause: ${message}`,
    )
  }
}

async function persistDatabase(db: Database, dbPath: string): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true })
  const temporaryPath = `${dbPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, Buffer.from(db.export()))
    await rename(temporaryPath, dbPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
