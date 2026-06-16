import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTeamDbConfig } from './client'
import { createPostgresPoolClient } from './postgres-client'
import type { TeamDbClient } from './client'

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

export async function runTeamMigrations(db: TeamDbClient, migrationSql: string): Promise<number> {
  const statements = splitSqlStatements(migrationSql)

  for (const statement of statements) {
    await db.query(statement)
  }

  return statements.length
}

async function main() {
  const config = resolveTeamDbConfig()
  if (!config) {
    throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running db:migrate.')
  }

  const db = createPostgresPoolClient(config)
  try {
    const count = await runTeamMigrations(db, await readInitialMigrationSql())
    console.log(`Applied ${count} team database migration statements.`)
  } finally {
    await db.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
