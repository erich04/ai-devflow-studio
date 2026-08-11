import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTeamDbConfig } from './client'
import { createPostgresPoolClient } from './postgres-client'
import type { TeamDbCheckedOutClient, TeamDbConnectionProvider } from './client'

const MIGRATION_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('ai-devflow-team-migrations'))"
const MIGRATION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('ai-devflow-team-migrations'))"
const MIGRATION_HISTORY_TABLE = 'team_schema_migrations'
const BASELINE_SCHEMA_VERSION = 7

export type TeamMigration = {
  version: number
  name: string
  sql: string
}

export type TeamMigrationRunResult = {
  schemaVersion: number
  appliedVersions: number[]
  adoptedVersions: number[]
  statementsExecuted: number
}

export const teamMigrationCatalog = [
  { version: 7, name: '0001_initial', fileName: '0001_initial.sql' },
  {
    version: 8,
    name: '0008_v14_work_authority',
    fileName: '0008_v14_work_authority.sql',
  },
  {
    version: 9,
    name: '0009_harden_work_request_timeline',
    fileName: '0009_harden_work_request_timeline.sql',
  },
  {
    version: 10,
    name: '0010_harden_gate_command_delivery',
    fileName: '0010_harden_gate_command_delivery.sql',
  },
  {
    version: 11,
    name: '0011_github_delivery',
    fileName: '0011_github_delivery.sql',
  },
] as const

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

export async function readInitialMigrationSql(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return readFile(path.join(currentDir, 'migrations', '0001_initial.sql'), 'utf8')
}

export async function readTeamMigrationCatalog(): Promise<TeamMigration[]> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return Promise.all(teamMigrationCatalog.map(async (migration) => ({
    version: migration.version,
    name: migration.name,
    sql: await readFile(path.join(currentDir, 'migrations', migration.fileName), 'utf8'),
  })))
}

export function migrationChecksum(sql: string): string {
  const canonicalSql = sql.replace(/\r\n/g, '\n')
  return createHash('sha256').update(canonicalSql, 'utf8').digest('hex')
}

function migrationStatements(sql: string): string[] {
  const statements = splitSqlStatements(sql)
  if (statements[0]?.toUpperCase() === 'BEGIN') {
    statements.shift()
  }
  if (statements.at(-1)?.toUpperCase() === 'COMMIT') {
    statements.pop()
  }
  return statements
}

async function createMigrationHistoryTable(
  connection: TeamDbCheckedOutClient,
): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      adopted boolean NOT NULL DEFAULT false,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function recordMigration(
  connection: TeamDbCheckedOutClient,
  migration: TeamMigration,
  adopted: boolean,
): Promise<void> {
  await connection.query(
    `INSERT INTO ${MIGRATION_HISTORY_TABLE} (version, name, checksum, adopted)
     VALUES ($1, $2, $3, $4)`,
    [migration.version, migration.name, migrationChecksum(migration.sql), adopted],
  )
}

function validateMigrationCatalog(migrations: readonly TeamMigration[]): {
  baseline: TeamMigration
  latest: TeamMigration
} {
  const baseline = migrations[0]
  const latest = migrations.at(-1)
  if (!baseline || !latest || baseline.version !== BASELINE_SCHEMA_VERSION) {
    throw new Error(`Team migration catalog must start at baseline v${BASELINE_SCHEMA_VERSION}`)
  }
  for (const [index, migration] of migrations.entries()) {
    if (!Number.isSafeInteger(migration.version) || migration.version < BASELINE_SCHEMA_VERSION) {
      throw new Error(`Invalid Team migration version: ${migration.version}`)
    }
    if (index > 0 && migration.version <= migrations[index - 1]!.version) {
      throw new Error('Team migration catalog versions must be strictly increasing')
    }
  }
  return { baseline, latest }
}

async function applyMigration(
  connection: TeamDbCheckedOutClient,
  migration: TeamMigration,
): Promise<number> {
  const statements = migrationStatements(migration.sql)
  for (const statement of statements) {
    await connection.query(statement)
  }
  await connection.query(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
    [String(migration.version)],
  )
  return statements.length
}

export async function runTeamMigrations(
  db: TeamDbConnectionProvider,
  migrations: readonly TeamMigration[],
): Promise<TeamMigrationRunResult> {
  const { baseline, latest } = validateMigrationCatalog(migrations)
  const connection = await db.checkout()
  let lockAcquired = false
  let transactionOpen = false
  let statementsExecuted = 0

  try {
    await connection.query(MIGRATION_LOCK_SQL)
    lockAcquired = true
    await connection.query('BEGIN')
    transactionOpen = true

    const [state] = await connection.query<{
      schema_meta_table: string | null
      migration_history_table: string | null
    }>(`
      SELECT
        to_regclass('public.schema_meta')::text AS schema_meta_table,
        to_regclass('public.${MIGRATION_HISTORY_TABLE}')::text AS migration_history_table
    `)

    const appliedVersions: number[] = []
    const adoptedVersions: number[] = []
    let currentVersion = 0

    if (state?.schema_meta_table) {
      const [versionRow] = await connection.query<{ value: string }>(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'",
      )
      currentVersion = Number.parseInt(versionRow?.value ?? '', 10)
      if (currentVersion > latest.version) {
        throw new Error(
          `Team schema version ${currentVersion} is newer than supported version ${latest.version}`,
        )
      }
      if (!migrations.some((migration) => migration.version === currentVersion)) {
        throw new Error(`Unsupported Team schema version: ${versionRow?.value ?? 'missing'}`)
      }

      let history: Array<{ version: number; name: string; checksum: string }> = []
      if (state.migration_history_table) {
        history = await connection.query<{
          version: number
          name: string
          checksum: string
        }>(`
          SELECT version, name, checksum
          FROM ${MIGRATION_HISTORY_TABLE}
          ORDER BY version ASC
        `)
      } else {
        await createMigrationHistoryTable(connection)
      }

      const alreadyApplied = migrations.filter(
        (migration) => migration.version <= currentVersion,
      )
      if (history.length === 0) {
        for (const migration of alreadyApplied) {
          await recordMigration(connection, migration, true)
          adoptedVersions.push(migration.version)
        }
      } else {
        for (const migration of alreadyApplied) {
          const recorded = history.find((row) => row.version === migration.version)
          if (!recorded || recorded.name !== migration.name) {
            throw new Error(`Migration history is missing ${migration.name}`)
          }
          if (recorded.checksum !== migrationChecksum(migration.sql)) {
            throw new Error(`Migration checksum mismatch for ${migration.name}`)
          }
        }
        const historyAhead = history.find((row) => row.version > currentVersion)
        if (historyAhead) {
          throw new Error(
            `Migration history version ${historyAhead.version} is ahead of schema version ${currentVersion}`,
          )
        }
      }
    } else {
      statementsExecuted += await applyMigration(connection, baseline)
      appliedVersions.push(baseline.version)
      currentVersion = baseline.version
      await createMigrationHistoryTable(connection)
      await recordMigration(connection, baseline, false)
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) {
        continue
      }
      statementsExecuted += await applyMigration(connection, migration)
      await recordMigration(connection, migration, false)
      appliedVersions.push(migration.version)
      currentVersion = migration.version
    }

    await connection.query('COMMIT')
    transactionOpen = false
    return {
      schemaVersion: currentVersion,
      appliedVersions,
      adoptedVersions,
      statementsExecuted,
    }
  } catch (error) {
    if (transactionOpen) {
      await connection.query('ROLLBACK')
      transactionOpen = false
    }
    throw error
  } finally {
    try {
      if (lockAcquired) {
        await connection.query(MIGRATION_UNLOCK_SQL)
      }
    } finally {
      await connection.release()
    }
  }
}

async function main() {
  const config = resolveTeamDbConfig()
  if (!config) {
    throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running db:migrate.')
  }

  const db = createPostgresPoolClient(config)
  try {
    const result = await runTeamMigrations(db, await readTeamMigrationCatalog())
    console.log(
      `Team schema v${result.schemaVersion}; applied ${result.appliedVersions.length} migration(s) and ${result.statementsExecuted} statement(s).`,
    )
  } finally {
    await db.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
