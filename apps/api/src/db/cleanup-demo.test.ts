import { describe, expect, it } from 'vitest'
import type { TeamDbClient } from './client'
import { cleanupDemoSeedData, inspectDemoSeedData } from './cleanup-demo'

class FakeCleanupDb implements TeamDbClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  constructor(
    private readonly input: {
      counts?: Record<string, number>
      projectIds?: string[]
    } = {},
  ) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params ? { sql, params } : { sql })

    if (sql.includes('SELECT id FROM projects')) {
      return (this.input.projectIds ?? ['p-payments', 'p-admin']).map((id) => ({ id }) as T)
    }

    if (sql.includes('SELECT count(*) AS count')) {
      return [{ count: this.countForSql(sql) } as T]
    }

    return []
  }

  async close(): Promise<void> {
    return undefined
  }

  private countForSql(sql: string): number {
    const counts = this.input.counts ?? {}
    if (sql.includes('FROM workflow_runs') && sql.includes("data_origin <> 'seed'")) {
      return counts['non_seed_runs'] ?? 0
    }
    if (sql.includes('FROM organizations')) return counts['organizations'] ?? 1
    if (sql.includes('FROM users')) return counts['users'] ?? 3
    if (sql.includes('FROM projects')) return counts['projects'] ?? 2
    if (sql.includes('FROM project_members')) return counts['project_members'] ?? 6
    if (sql.includes('FROM workflow_runs')) return counts['workflow_runs'] ?? 2
    if (sql.includes('FROM agent_provider_credentials')) {
      return counts['agent_provider_credentials'] ?? 0
    }
    if (sql.includes('FROM mcp_server_definitions')) return counts['mcp_server_definitions'] ?? 2
    if (sql.includes('FROM skills')) return counts['skills'] ?? 3
    if (sql.includes('FROM enforcement_policies')) return counts['enforcement_policies'] ?? 1
    return 0
  }
}

describe('demo seed cleanup', () => {
  it('reports grouped org-demo counts without deleting by default', async () => {
    const db = new FakeCleanupDb()

    const report = await inspectDemoSeedData(db)

    expect(report).toMatchObject({
      organizationId: 'org-demo',
      mode: 'dry-run',
      deleted: false,
      blockers: [],
      counts: {
        organizations: 1,
        projects: 2,
        workflow_runs: 2,
        non_seed_runs: 0,
      },
    })
    expect(db.queries.some((query) => query.sql === 'BEGIN')).toBe(false)
  })

  it('does not delete without the explicit confirm token', async () => {
    const db = new FakeCleanupDb()

    const report = await cleanupDemoSeedData(db)

    expect(report.deleted).toBe(false)
    expect(db.queries.some((query) => query.sql.startsWith('DELETE'))).toBe(false)
  })

  it('refuses to delete mixed org-demo data', async () => {
    const db = new FakeCleanupDb({
      counts: {
        non_seed_runs: 1,
      },
    })

    await expect(cleanupDemoSeedData(db, { confirm: 'org-demo' })).rejects.toThrow(
      'org-demo has 1 non-seed workflow run(s)',
    )
    expect(db.queries.some((query) => query.sql === 'BEGIN')).toBe(false)
  })

  it('refuses to delete provider credentials or non-fixture projects', async () => {
    const db = new FakeCleanupDb({
      counts: {
        agent_provider_credentials: 1,
      },
      projectIds: ['p-payments', 'p-custom'],
    })

    await expect(cleanupDemoSeedData(db, { confirm: 'org-demo' })).rejects.toThrow(
      'non-fixture project id(s): p-custom',
    )
    await expect(cleanupDemoSeedData(db, { confirm: 'org-demo' })).rejects.toThrow(
      'provider credential(s)',
    )
  })

  it('deletes org-demo seed data only after confirmation', async () => {
    const db = new FakeCleanupDb()

    const report = await cleanupDemoSeedData(db, { confirm: 'org-demo' })

    expect(report).toMatchObject({
      mode: 'delete',
      deleted: true,
    })
    expect(db.queries.map((query) => query.sql)).toEqual(
      expect.arrayContaining([
        'BEGIN',
        'DELETE FROM workflow_runs WHERE organization_id = $1',
        'DELETE FROM organizations WHERE id = $1',
        'COMMIT',
      ]),
    )
  })
})
