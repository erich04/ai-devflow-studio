import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import type {
  AgentEvent,
  AgentReviewResult,
  AgentTrace,
  AgentTokenUsage,
  Artifact,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  LocalExecutionState,
  LocalProject,
  LocalSettings,
  ManagedCodingWorkspace,
  McpServerDefinition,
  GateOverrideDecision,
  PolicySnapshot,
  ProviderCredentialMetadata,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'

export const CURRENT_SCHEMA_VERSION = 5
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

export type LocalStore = {
  upsertProject(project: LocalProject): Promise<void>
  listProjects(): Promise<LocalProject[]>
  saveRun(run: WorkflowRun): Promise<void>
  listRuns(): Promise<WorkflowRun[]>
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
  savePolicySnapshot(snapshot: PolicySnapshot): Promise<PolicySnapshot>
  getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null>
  saveGateOverride(decision: GateOverrideDecision): Promise<GateOverrideDecision>
  listGateOverrides(runId?: string): Promise<GateOverrideDecision[]>
  saveSettings(settings: Partial<LocalSettings>): Promise<LocalSettings>
  getSettings(): Promise<LocalSettings>
  saveMcpServers(servers: McpServerDefinition[]): Promise<McpServerDefinition[]>
  listMcpServers(): Promise<McpServerDefinition[]>
  getSchemaVersion(): Promise<number>
  loadState(): Promise<LocalExecutionState>
  close(): void
}

function migrateSchema(db: Database) {
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

    create table if not exists provider_credentials (
      provider_id text primary key,
      json text not null,
      encrypted_secret text not null,
      updated_at text not null
    );

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

    insert into schema_meta (key, value)
    values ('schema_version', '${CURRENT_SCHEMA_VERSION}')
    on conflict(key) do update set value = excluded.value;

    insert into local_settings (key, json, updated_at)
    values ('settings', '${JSON.stringify(DEFAULT_LOCAL_SETTINGS)}', datetime('now'))
    on conflict(key) do nothing;
  `)
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

class SqlJsLocalStore implements LocalStore {
  constructor(
    private readonly db: Database,
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
    this.db.run(
      `
      insert into workflow_runs (id, json, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [run.id, JSON.stringify(run), run.createdAt, run.updatedAt],
    )
    await this.persist()
  }

  async listRuns(): Promise<WorkflowRun[]> {
    return selectJson<WorkflowRun>(
      this.db,
      'select json from workflow_runs order by updated_at desc, created_at desc',
    )
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.db.run(
      `
      insert into artifacts (id, run_id, json, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [artifact.id, artifact.runId, JSON.stringify(artifact), artifact.updatedAt],
    )
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
    this.db.run(
      `
      insert into agent_events (id, run_id, sequence, json, timestamp)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
      `,
      [event.id, event.runId, event.sequence, JSON.stringify(event), event.timestamp],
    )
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
    this.db.run(
      `
      insert into test_evidence (id, run_id, node_id, project_id, json, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [
        evidence.id,
        evidence.runId,
        evidence.nodeId,
        evidence.projectId,
        JSON.stringify(evidence),
        evidence.createdAt,
      ],
    )
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
    this.db.run(
      `
      insert into coding_agent_events (id, coding_run_id, run_id, node_id, sequence, json, timestamp)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
      `,
      [
        event.id,
        event.codingRunId,
        event.runId,
        event.nodeId,
        event.sequence,
        JSON.stringify(event),
        event.timestamp,
      ],
    )
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
      settings,
      mcpServers,
    }
  }

  close(): void {
    this.db.close()
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.dbPath), { recursive: true })
    await writeFile(this.dbPath, Buffer.from(this.db.export()))
  }
}

export async function createLocalStore(options: LocalStoreOptions): Promise<LocalStore> {
  const SQL = await loadSql()

  try {
    const db = existsSync(options.dbPath)
      ? new SQL.Database(await readFile(options.dbPath))
      : new SQL.Database()

    migrateSchema(db)

    return new SqlJsLocalStore(db, options.dbPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `DevFlow local database is unreadable at ${options.dbPath}. Back up or remove this file to rebuild local state. Cause: ${message}`,
    )
  }
}
