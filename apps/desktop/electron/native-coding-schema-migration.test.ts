// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalProject } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { CURRENT_SCHEMA_VERSION, schemaMigrations } from './local-store-schema'
import { createNativeCodingSession } from './native-coding-session'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function sql() {
  const require = createRequire(import.meta.url)
  return initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), file) })
}

function tables(db: import('sql.js').Database): string[] {
  return (db.exec("select name from sqlite_master where type = 'table' order by name")[0]?.values ?? []).map((row) => String(row[0]))
}

function schemaObjects(db: import('sql.js').Database) {
  return db.exec("select type, name, tbl_name, sql from sqlite_master order by type, name")[0]?.values ?? []
}

const now = '2026-11-01T00:00:00.000Z'
const project: LocalProject = {
  id: 'schema-project', name: 'schema', path: '/tmp/schema-project', packageManager: 'npm',
  detectedTestCommand: 'npm test', testCommand: 'npm test', createdAt: now, updatedAt: now,
}
const nativeSession = (id: string) => createNativeCodingSession({
  id, localProjectId: project.id, codingRunId: `coding-${id}`, workflowRunId: 'workflow', nodeId: 'build',
  providerId: 'fake', model: 'test', objective: 'Keep the session across the upgrade', now,
})
const projectMemorySetting = (ownerUserId: string) => ({
  projectId: project.id, ownerUserId, enabled: true, endpoint: 'http://127.0.0.1:8890', encryptedApiKey: null, providerId: 'fake',
})
const NATIVE_SESSION_TABLES = ['native_coding_sessions']
const PROJECT_MEMORY_TABLES = ['project_memory_configurations', 'project_memory_documents']

/** Writes one project, one project memory setting and document and one Native v3 session at the current schema. */
async function seededDatabase() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-schema-'))
  directories.push(directory)
  const dbPath = path.join(directory, 'devflow.sqlite')
  const store = await createLocalStore({ dbPath })
  await store.upsertProject(project)
  const owner = await store.resolveLocalProjectMemoryPrincipal(project.id)
  if (owner.status !== 'resolved') throw new Error('No project memory principal')
  const memory = await store.configureProjectMemory(projectMemorySetting(owner.userId))
  expect(await store.recordProjectMemoryDocument(memory, {
    documentId: 'conversation:chat', sourceKind: 'conversation', sourceId: 'chat', title: 'Schema upgrade',
    payload: JSON.stringify([{ role: 'user', content: 'Keep this row.', timestamp: now }]), context: 'Synthetic', tags: ['source:conversation'], occurredAt: now,
  })).not.toBeNull()
  const session = nativeSession('native-kept')
  expect(await store.saveNativeCodingSession(session, 0)).toBe(true)
  const documents = await store.listProjectMemoryDocuments()
  store.close()
  return { dbPath, ownerUserId: owner.userId, memory, documents, session }
}

/** Turns the seeded file into a database at an earlier schema: tables created after it are dropped. */
async function retainAt(dbPath: string, version: number, dropped: string[]) {
  const SQL = await sql()
  const db = new SQL.Database(await readFile(dbPath))
  for (const table of dropped) db.run(`drop table ${table}`)
  db.run("update schema_meta set value = ? where key = 'schema_version'", [String(version)])
  await writeFile(dbPath, Buffer.from(db.export()))
  db.close()
}

describe('Native v3 schema after merging main', () => {
  it('is migration 42, after main 39 (Hindsight), 40 (memory candidates) and 41 (project memory)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(42)
    expect(schemaMigrations.slice(-4).map((migration) => migration.version)).toEqual([39, 40, 41, 42])
  })

  it('opens a database the draft branch wrote at its own schema 39 and adds what main 39 created', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-schema-'))
    directories.push(directory)
    const dbPath = path.join(directory, 'devflow.sqlite')
    const SQL = await sql()
    const draft = new SQL.Database()
    const hooks = { migrateWorkflowRunsIntoRelationalTables: () => undefined, afterMigrations: () => undefined }
    for (const migration of schemaMigrations.filter((item) => item.version <= 38)) migration.migrate(draft, hooks)
    // The draft branch's schema 39 (codex/native-coding-harness-v3 before the merge).
    draft.run(`
      create table if not exists native_coding_sessions (
        id text primary key,
        local_project_id text not null references local_projects(id) on delete cascade,
        coding_run_id text not null unique,
        version integer not null check (version > 0),
        status text not null,
        updated_at text not null,
        json text not null
      );
      create index if not exists native_coding_sessions_project on native_coding_sessions(local_project_id, updated_at);
    `)
    draft.run("insert into schema_meta(key,value) values('schema_version','39') on conflict(key) do update set value='39'")
    expect(tables(draft)).not.toContain('hindsight_configurations')
    await writeFile(dbPath, Buffer.from(draft.export()))
    draft.close()

    const store = await createLocalStore({ dbPath })
    expect(await store.getSchemaVersion()).toBe(42)
    expect(await store.listNativeCodingSessions('missing-project')).toEqual([])
    expect(await store.listHindsightConfigurations()).toEqual([])
    expect(await store.listProjectMemoryConfigurations()).toEqual([])
    store.close()
    const migrated = new SQL.Database(await readFile(dbPath))
    expect(tables(migrated)).toEqual(expect.arrayContaining(['hindsight_configurations', 'hindsight_projections', ...PROJECT_MEMORY_TABLES, ...NATIVE_SESSION_TABLES]))
    expect(migrated.exec('pragma foreign_key_check')).toEqual([])
    migrated.close()
  })

  it.each([
    { from: 'schema 40, which runs main 41 and then 42', version: 40, dropped: [...NATIVE_SESSION_TABLES, 'project_memory_documents', 'project_memory_configurations'] },
    { from: "main's schema 41, which runs only 42", version: 41, dropped: NATIVE_SESSION_TABLES },
    { from: "the draft branch's schema 41, which has the session table but skipped main 41", version: 41, dropped: ['project_memory_documents', 'project_memory_configurations'] },
  ])('upgrades a database at $from', async ({ version, dropped }) => {
    const seeded = await seededDatabase()
    await retainAt(seeded.dbPath, version, dropped)
    const SQL = await sql()
    const retained = new SQL.Database(await readFile(seeded.dbPath))
    expect(tables(retained).filter((table) => dropped.includes(table))).toEqual([])
    retained.close()

    const store = await createLocalStore({ dbPath: seeded.dbPath })
    expect(await store.getSchemaVersion()).toBe(42)
    expect(await store.listProjects()).toEqual([project])
    const keptSessions = dropped.includes('native_coding_sessions') ? [] : [seeded.session]
    const keptMemory = dropped.includes('project_memory_configurations') ? [] : [seeded.memory]
    expect(await store.listNativeCodingSessions(project.id)).toEqual(keptSessions)
    expect(await store.listProjectMemoryConfigurations()).toEqual(keptMemory)
    expect(await store.listProjectMemoryDocuments()).toEqual(keptMemory.length ? seeded.documents : [])
    // The tables 42 created accept writes.
    expect(await store.saveNativeCodingSession(nativeSession('native-after-upgrade'), 0)).toBe(true)
    if (!keptMemory.length) await store.configureProjectMemory(projectMemorySetting(seeded.ownerUserId))
    expect(await store.listNativeCodingSessions(project.id)).toHaveLength(keptSessions.length + 1)
    expect(await store.getProjectMemoryConfiguration(project.id)).not.toBeNull()
    store.close()

    const migrated = new SQL.Database(await readFile(seeded.dbPath))
    expect(tables(migrated)).toEqual(expect.arrayContaining(['hindsight_configurations', 'hindsight_projections', ...PROJECT_MEMORY_TABLES, ...NATIVE_SESSION_TABLES]))
    expect(migrated.exec('pragma foreign_key_check')).toEqual([])
    migrated.close()
  })

  it('changes nothing when migration 42 runs again', async () => {
    const seeded = await seededDatabase()
    const SQL = await sql()
    const before = new SQL.Database(await readFile(seeded.dbPath))
    const objects = schemaObjects(before)
    before.close()
    await retainAt(seeded.dbPath, 41, [])

    const store = await createLocalStore({ dbPath: seeded.dbPath })
    expect(await store.getSchemaVersion()).toBe(42)
    expect(await store.getNativeCodingSession(seeded.session.id)).toEqual(seeded.session)
    expect(await store.listProjectMemoryConfigurations()).toEqual([seeded.memory])
    expect(await store.listProjectMemoryDocuments()).toEqual(seeded.documents)
    store.close()
    const after = new SQL.Database(await readFile(seeded.dbPath))
    expect(schemaObjects(after)).toEqual(objects)
    after.close()
  })
})
