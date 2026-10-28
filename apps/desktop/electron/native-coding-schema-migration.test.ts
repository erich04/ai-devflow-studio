// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalStore } from './local-store'
import { CURRENT_SCHEMA_VERSION, schemaMigrations } from './local-store-schema'

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

describe('Native v3 schema after merging main', () => {
  it('is migration 41, after main 39 (Hindsight) and 40 (memory candidates)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(41)
    expect(schemaMigrations.slice(-3).map((migration) => migration.version)).toEqual([39, 40, 41])
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
    expect(await store.getSchemaVersion()).toBe(41)
    expect(await store.listNativeCodingSessions('missing-project')).toEqual([])
    expect(await store.listHindsightConfigurations()).toEqual([])
    store.close()
    const migrated = new SQL.Database(await readFile(dbPath))
    expect(tables(migrated)).toEqual(expect.arrayContaining(['hindsight_configurations', 'hindsight_projections', 'native_coding_sessions']))
    expect(migrated.exec('pragma foreign_key_check')).toEqual([])
    migrated.close()
  })
})
