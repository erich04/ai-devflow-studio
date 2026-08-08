import { describe, expect, it, vi } from 'vitest'
import { createTeamDbClient, redactConnectionString, resolveTeamDbConfig } from './client'

describe('team database client boundary', () => {
  it('resolves Postgres config from DEVFLOW_DATABASE_URL first', () => {
    const config = resolveTeamDbConfig({
      DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@localhost:5432/devflow',
      DATABASE_URL: 'postgres://fallback:secret@localhost:5432/fallback',
      DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS: '2500',
    })

    expect(config).toEqual({
      connectionString: 'postgres://devflow:secret@localhost:5432/devflow',
      applicationName: 'ai-devflow-api',
      statementTimeoutMs: 2500,
    })
  })

  it.each(['0', '-1', '1e4', '0x2710', '2500ms', ' 2500 '])(
    'rejects a non-canonical database statement timeout %s',
    (statementTimeout) => {
      expect(() =>
        resolveTeamDbConfig({
          DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@localhost:5432/devflow',
          DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS: statementTimeout,
        }),
      ).toThrow(
        'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS must be a positive decimal integer.',
      )
    },
  )

  it('uses the bounded default when no database statement timeout is provided', () => {
    expect(
      resolveTeamDbConfig({
        DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@localhost:5432/devflow',
      })?.statementTimeoutMs,
    ).toBe(5000)
  })

  it('redacts credentials before a database URL is logged', () => {
    expect(redactConnectionString('postgres://devflow:secret@localhost:5432/devflow')).toBe(
      'postgres://devflow:***@localhost:5432/devflow',
    )
    expect(redactConnectionString('not-a-url')).toBe('[invalid database url]')
  })

  it('wraps a queryable connection without owning a specific driver', async () => {
    const end = vi.fn(async () => undefined)
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = []
    const client = createTeamDbClient({
      async query<T>(sql: string, params?: unknown[]) {
        calls.push({ sql, params })
        return { rows: [{ id: 'run-1' } as T] }
      },
      end,
    })

    await expect(client.query<{ id: string }>('select id from workflow_runs where id = $1', ['run-1']))
      .resolves.toEqual([{ id: 'run-1' }])
    await client.close()

    expect(calls).toEqual([
      { sql: 'select id from workflow_runs where id = $1', params: ['run-1'] },
    ])
    expect(end).toHaveBeenCalled()
  })
})
