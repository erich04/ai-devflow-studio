import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import type {
  AgentEvent,
  Artifact,
  LocalExecutionState,
  LocalProject,
  LocalSettings,
  McpServerDefinition,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'

export const CURRENT_SCHEMA_VERSION = 2
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
    const [projects, runs, artifacts, events, testEvidence, settings, mcpServers] = await Promise.all([
      this.listProjects(),
      this.listRuns(),
      this.listArtifacts(),
      this.listEvents(),
      this.listTestEvidence(),
      this.getSettings(),
      this.listMcpServers(),
    ])

    return { projects, runs, artifacts, events, testEvidence, settings, mcpServers }
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
