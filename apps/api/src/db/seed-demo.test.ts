import { describe, expect, it } from 'vitest'
import { artifacts, events, mcpServers, members, projects, runs, skills, tokenUsage } from '@ai-devflow/shared'
import type { TeamDbClient } from './client'
import { seedDemoTeamData } from './seed-demo'

class FakeDb implements TeamDbClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })
    return []
  }

  async close(): Promise<void> {
    return undefined
  }
}

describe('DevFlow demo team seed', () => {
  it('seeds fixture-backed team data into Postgres-shaped tables', async () => {
    const db = new FakeDb()

    await expect(seedDemoTeamData(db)).resolves.toEqual({
      organizations: 1,
      users: members.length,
      authAccounts: members.length,
      projects: projects.length,
      projectMembers: projects.length * members.length,
      runs: runs.length,
      nodes: runs.reduce((sum, run) => sum + run.nodes.length, 0),
      edges: runs.reduce((sum, run) => sum + run.edges.length, 0),
      artifacts: artifacts.length,
      events: events.length,
      skills: skills.length,
      mcpServers: mcpServers.length,
      tokenUsage: tokenUsage.length,
    })

    expect(db.queries[0]?.sql).toContain('INSERT INTO organizations')
    expect(db.queries[0]?.params).toEqual(['org-demo', 'DevFlow Demo Team', 'devflow-demo'])
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO auth_accounts'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO project_members'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_runs'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO test_evidence_summaries'))).toBe(false)
  })

  it('namespaces workflow node and edge ids by run for Postgres uniqueness', async () => {
    const db = new FakeDb()

    await seedDemoTeamData(db)

    const runWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_runs'))
    const nodeWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_nodes'))
    const edgeWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_edges'))
    const artifactWrite = db.queries.find((query) => query.sql.includes('INSERT INTO artifacts'))

    expect(runWrite?.params).toContain('run-health-001:n-design-gate')
    expect(nodeWrite?.params?.[0]).toBe('run-health-001:n-clarify')
    expect(edgeWrite?.params?.slice(0, 4)).toEqual([
      'run-health-001:e1',
      'run-health-001',
      'run-health-001:n-clarify',
      'run-health-001:n-clarify-gate',
    ])
    expect(artifactWrite?.params?.[2]).toBe('run-health-001:n-clarify')
  })
})
