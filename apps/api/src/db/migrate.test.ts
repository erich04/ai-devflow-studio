import { describe, expect, it } from 'vitest'
import type { TeamDbClient } from './client'
import { runTeamMigrations, splitSqlStatements } from './migrate'

class FakeDb implements TeamDbClient {
  readonly statements: string[] = []

  async query<T>(sql: string): Promise<T[]> {
    this.statements.push(sql)
    return []
  }

  async close(): Promise<void> {
    return undefined
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

  it('runs each migration statement in order', async () => {
    const db = new FakeDb()

    await expect(runTeamMigrations(db, 'BEGIN;\nSELECT 1;\nCOMMIT;\n')).resolves.toBe(3)

    expect(db.statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT'])
  })
})
