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

  it('computes the same immutable checksum for LF and CRLF migration SQL', () => {
    const lfSql = 'BEGIN;\nSELECT 1;\nCOMMIT;\n'
    const crlfSql = lfSql.replace(/\n/g, '\r\n')

    expect(migrationChecksum(crlfSql)).toBe(migrationChecksum(lfSql))
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
    ])

    const [baseline, v14, workRequestHardening, gateCommandHardening, githubDelivery] =
      await readTeamMigrationCatalog()
    expect(baseline).toMatchObject({ version: 7, name: '0001_initial' })
    expect(baseline?.sql).toMatch(/^BEGIN;/)
    expect(migrationChecksum(baseline?.sql ?? '')).toMatch(/^[a-f0-9]{64}$/)
    expect(v14).toMatchObject({ version: 8, name: '0008_v14_work_authority' })
    expect(v14?.sql).not.toMatch(/^BEGIN;/)
    expect(workRequestHardening).toMatchObject({
      version: 9,
      name: '0009_harden_work_request_timeline',
    })
    expect(gateCommandHardening).toMatchObject({
      version: 10,
      name: '0010_harden_gate_command_delivery',
    })
    expect(migrationChecksum(gateCommandHardening?.sql ?? '')).toBe(
      '1de25f1b785f0b0c384d8bc5475040563812f9c8dd38f5b486aeb807296ae312',
    )
    expect(gateCommandHardening?.sql).toContain(
      'CREATE TABLE released_work_request_claims',
    )
    expect(githubDelivery).toMatchObject({
      version: 11,
      name: '0011_github_delivery',
    })
    expect(githubDelivery?.sql).toContain('CREATE TABLE github_delivery_requests')
    expect(githubDelivery?.sql).toContain('provider_created_at <= recorded_at')
  })

  it('orders the v10 Gate backfill before validation and keeps its SQL function atomic', async () => {
    const hardening = (await readTeamMigrationCatalog()).find(
      (migration) => migration.version === 10,
    )
    const statements = splitSqlStatements(hardening?.sql ?? '')
    const addEvaluatedAt = statements.findIndex((statement) =>
      statement.includes('ADD COLUMN evaluated_at timestamptz'),
    )
    const backfillEvaluatedAt = statements.findIndex((statement) =>
      statement.includes('SET evaluated_at = created_at'),
    )
    const requireEvaluatedAt = statements.findIndex((statement) =>
      statement.includes('ALTER COLUMN evaluated_at SET NOT NULL'),
    )
    const validateCommands = statements.findIndex((statement) =>
      statement.includes('ADD CONSTRAINT gate_commands_version_positive'),
    )

    expect(addEvaluatedAt).toBeGreaterThanOrEqual(0)
    expect(backfillEvaluatedAt).toBeGreaterThan(addEvaluatedAt)
    expect(requireEvaluatedAt).toBeGreaterThan(backfillEvaluatedAt)
    expect(validateCommands).toBeGreaterThan(requireEvaluatedAt)
    expect(
      statements.filter((statement) =>
        statement.includes('CREATE FUNCTION gate_command_blocker_ids_are_bounded'),
      ),
    ).toHaveLength(1)
    expect(hardening?.sql).not.toMatch(/^\s*(?:DELETE FROM|TRUNCATE TABLE)\b/im)
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

  it('rolls back all v10 hardening when legacy Gate rows fail constraint validation', async () => {
    const migrations = await readTeamMigrationCatalog()
    const hardening = migrations.find((migration) => migration.version === 10)
    const validationStatement = splitSqlStatements(hardening?.sql ?? '').find(
      (statement) => statement.includes(
        'ADD CONSTRAINT gate_commands_evaluation_status',
      ),
    )
    expect(validationStatement).toBeDefined()
    if (!validationStatement) {
      throw new Error('v10 Gate validation statement is missing')
    }
    expect(validationStatement).toContain(
      "expires_at <= created_at + interval '15 minutes'",
    )

    const historicalMigrations = migrations.filter(
      (migration) => migration.version <= 9,
    )
    const connection = new FakeConnection({
      schemaVersion: 9,
      historyExists: true,
      historyRows: historicalMigrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: migrationChecksum(migration.sql),
      })),
      failOnSql: validationStatement,
    })
    const pool = new FakePool(connection)

    await expect(runTeamMigrations(pool, migrations)).rejects.toThrow(
      /forced migration failure/,
    )

    expect(connection.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(connection.calls).not.toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("VALUES ('schema_version', $1)"),
      params: ['10'],
    }))
    expect(connection.calls).not.toContainEqual(expect.objectContaining({
      params: [
        10,
        '0010_harden_gate_command_delivery',
        expect.any(String),
        false,
      ],
    }))
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('rolls back v10 when a legacy Gate command used non-browser auth', async () => {
    const migrations = await readTeamMigrationCatalog()
    const hardening = migrations.find((migration) => migration.version === 10)
    const authValidationStatement = splitSqlStatements(
      hardening?.sql ?? '',
    ).find((statement) => statement.includes(
      'ADD CONSTRAINT gate_commands_browser_write_auth',
    ))
    expect(authValidationStatement).toContain("auth_kind = 'session_cookie'")
    expect(authValidationStatement).toContain(
      'auth_token_record_id IS NULL',
    )
    if (!authValidationStatement) {
      throw new Error('v10 Gate browser-write validation statement is missing')
    }

    const historicalMigrations = migrations.filter(
      (migration) => migration.version <= 9,
    )
    const connection = new FakeConnection({
      schemaVersion: 9,
      historyExists: true,
      historyRows: historicalMigrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: migrationChecksum(migration.sql),
      })),
      failOnSql: authValidationStatement,
    })

    await expect(
      runTeamMigrations(new FakePool(connection), migrations),
    ).rejects.toThrow(/forced migration failure/)

    expect(connection.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(connection.calls).not.toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("VALUES ('schema_version', $1)"),
      params: ['10'],
    }))
    expect(connection.calls).not.toContainEqual(expect.objectContaining({
      params: [
        10,
        '0010_harden_gate_command_delivery',
        expect.any(String),
        false,
      ],
    }))
    expect(connection.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(connection.releaseCount).toBe(1)
  })

  it('rolls back v10 when a legacy Gate receipt exceeds the bounded lease', async () => {
    const migrations = await readTeamMigrationCatalog()
    const hardening = migrations.find((migration) => migration.version === 10)
    const receiptValidationStatement = splitSqlStatements(
      hardening?.sql ?? '',
    ).find((statement) => statement.includes(
      'ADD CONSTRAINT gate_command_receipts_identifiers_bounded',
    ))
    expect(receiptValidationStatement).toContain(
      "lease_expires_at <= leased_at + interval '60 seconds'",
    )
    if (!receiptValidationStatement) {
      throw new Error('v10 Gate receipt validation statement is missing')
    }

    const historicalMigrations = migrations.filter(
      (migration) => migration.version <= 9,
    )
    const connection = new FakeConnection({
      schemaVersion: 9,
      historyExists: true,
      historyRows: historicalMigrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: migrationChecksum(migration.sql),
      })),
      failOnSql: receiptValidationStatement,
    })

    await expect(
      runTeamMigrations(new FakePool(connection), migrations),
    ).rejects.toThrow(/forced migration failure/)

    expect(connection.calls.map(({ sql }) => sql)).toContain('ROLLBACK')
    expect(connection.calls.map(({ sql }) => sql)).not.toContain('COMMIT')
    expect(connection.calls).not.toContainEqual(expect.objectContaining({
      params: [
        10,
        '0010_harden_gate_command_delivery',
        expect.any(String),
        false,
      ],
    }))
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
