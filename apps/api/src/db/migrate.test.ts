import { describe, expect, it } from 'vitest'
import {
  migrationChecksum,
  readTeamMigrationCatalog,
  runTeamMigrations,
  splitSqlStatements,
  teamMigrationCatalog,
} from './migrate'

class FakeConnection {
  readonly calls: Array<{ sql: string; params: unknown[] }> = []
  releaseCount = 0

  constructor(private readonly state: {
    schemaVersion?: number
    historyExists?: boolean
    historyRows?: Array<{ version: number; name: string; checksum: string }>
    failOnSql?: string
  } = {}) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params })
    if (sql === this.state.failOnSql) {
      throw new Error(`forced migration failure: ${sql}`)
    }
    if (sql.includes("to_regclass('public.schema_meta')")) {
      return [{
        schema_meta_table: this.state.schemaVersion === undefined ? null : 'schema_meta',
        migration_history_table: this.state.historyExists ? 'team_schema_migrations' : null,
      } as T]
    }
    if (sql.includes("FROM schema_meta WHERE key = 'schema_version'")) {
      return this.state.schemaVersion === undefined
        ? []
        : [{ value: String(this.state.schemaVersion) } as T]
    }
    if (sql.includes('FROM team_schema_migrations')) {
      return (this.state.historyRows ?? []) as T[]
    }
    return []
  }

  release(): void {
    this.releaseCount += 1
  }
}

class FakePool {
  checkoutCount = 0

  constructor(readonly connection: FakeConnection) {}

  async checkout(): Promise<FakeConnection> {
    this.checkoutCount += 1
    return this.connection
  }
}

describe('team database migration runner', () => {
  it('splits SQL migration files into executable statements', () => {
    expect(splitSqlStatements('BEGIN;\nCREATE TABLE demo (id text);\nCOMMIT;\n')).toEqual([
      'BEGIN',
      'CREATE TABLE demo (id text)',
      'COMMIT',
    ])
  })

  it('catalogs the frozen v7 baseline before the V1.4 migration', async () => {
    expect(teamMigrationCatalog).toEqual([
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
    ])

    const [baseline, v14, hardening] = await readTeamMigrationCatalog()
    expect(baseline).toMatchObject({ version: 7, name: '0001_initial' })
    expect(baseline?.sql).toMatch(/^BEGIN;/)
    expect(migrationChecksum(baseline?.sql ?? '')).toMatch(/^[a-f0-9]{64}$/)
    expect(v14).toMatchObject({ version: 8, name: '0008_v14_work_authority' })
    expect(v14?.sql).not.toMatch(/^BEGIN;/)
    expect(hardening).toMatchObject({
      version: 9,
      name: '0009_harden_work_request_timeline',
    })
  })

  it('runs a fresh baseline inside one checked-out client and filters its outer transaction', async () => {
    const connection = new FakeConnection()
    const pool = new FakePool(connection)

    await runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    }])

    expect(pool.checkoutCount).toBe(1)
    expect(connection.calls.filter(({ sql }) => sql === 'BEGIN')).toHaveLength(1)
    expect(connection.calls.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(1)
    expect(connection.calls.map(({ sql }) => sql)).toContain('SELECT 1')
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('adopts an existing v7 schema that predates migration history without replaying the baseline', async () => {
    const connection = new FakeConnection({ schemaVersion: 7 })
    const pool = new FakePool(connection)

    const result = await runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT baseline_side_effect();\nCOMMIT;\n',
    }])

    expect(result).toMatchObject({
      schemaVersion: 7,
      appliedVersions: [],
      adoptedVersions: [7],
      statementsExecuted: 0,
    })
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('SELECT baseline_side_effect()')
    expect(connection.calls).toContainEqual(expect.objectContaining({
      params: [7, '0001_initial', expect.any(String), true],
    }))
  })

  it('rejects a database schema newer than the migration catalog and still unlocks the session', async () => {
    const connection = new FakeConnection({ schemaVersion: 8 })
    const pool = new FakePool(connection)

    await expect(runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    }])).rejects.toThrow(/newer than supported/i)

    expect(connection.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('rejects checksum drift for an already recorded migration', async () => {
    const connection = new FakeConnection({
      schemaVersion: 7,
      historyExists: true,
      historyRows: [{
        version: 7,
        name: '0001_initial',
        checksum: 'tampered-checksum',
      }],
    })
    const pool = new FakePool(connection)

    await expect(runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    }])).rejects.toThrow(/checksum.*0001_initial/i)

    expect(connection.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('applies only catalog entries newer than the recorded v7 baseline', async () => {
    const baselineSql = 'BEGIN;\nSELECT baseline_side_effect();\nCOMMIT;\n'
    const connection = new FakeConnection({
      schemaVersion: 7,
      historyExists: true,
      historyRows: [{
        version: 7,
        name: '0001_initial',
        checksum: migrationChecksum(baselineSql),
      }],
    })
    const pool = new FakePool(connection)

    const result = await runTeamMigrations(pool, [
      { version: 7, name: '0001_initial', sql: baselineSql },
      { version: 8, name: '0002_example', sql: 'SELECT apply_example_v8();\n' },
    ])

    expect(result).toMatchObject({
      schemaVersion: 8,
      appliedVersions: [8],
      adoptedVersions: [],
      statementsExecuted: 1,
    })
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('SELECT baseline_side_effect()')
    expect(connection.calls.map(({ sql }) => sql)).toContain('SELECT apply_example_v8()')
  })

  it('treats an already recorded latest catalog version as a no-op', async () => {
    const baselineSql = 'BEGIN;\nSELECT baseline_side_effect();\nCOMMIT;\n'
    const nextSql = 'SELECT apply_example_v8();\n'
    const connection = new FakeConnection({
      schemaVersion: 8,
      historyExists: true,
      historyRows: [
        {
          version: 7,
          name: '0001_initial',
          checksum: migrationChecksum(baselineSql),
        },
        {
          version: 8,
          name: '0002_example',
          checksum: migrationChecksum(nextSql),
        },
      ],
    })
    const pool = new FakePool(connection)

    const result = await runTeamMigrations(pool, [
      { version: 7, name: '0001_initial', sql: baselineSql },
      { version: 8, name: '0002_example', sql: nextSql },
    ])

    expect(result).toEqual({
      schemaVersion: 8,
      appliedVersions: [],
      adoptedVersions: [],
      statementsExecuted: 0,
    })
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('SELECT baseline_side_effect()')
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('SELECT apply_example_v8()')
  })

  it('rolls back a failed migration before unlocking and releasing the same client', async () => {
    const connection = new FakeConnection({ failOnSql: 'SELECT explode()' })
    const pool = new FakePool(connection)

    await expect(runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT explode();\nCOMMIT;\n',
    }])).rejects.toThrow('forced migration failure: SELECT explode()')

    expect(connection.calls.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      'SELECT explode()',
      'ROLLBACK',
    ]))
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('releases the checked-out client even when advisory unlock fails', async () => {
    const unlockSql = "SELECT pg_advisory_unlock(hashtext('ai-devflow-team-migrations'))"
    const connection = new FakeConnection({ failOnSql: unlockSql })
    const pool = new FakePool(connection)

    await expect(runTeamMigrations(pool, [{
      version: 7,
      name: '0001_initial',
      sql: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    }])).rejects.toThrow(`forced migration failure: ${unlockSql}`)

    expect(connection.releaseCount).toBe(1)
  })
})
