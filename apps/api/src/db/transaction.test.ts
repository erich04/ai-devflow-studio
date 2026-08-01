import { describe, expect, it } from 'vitest'
import { withTeamDbTransaction } from './transaction'

class FakeTransactionConnection {
  readonly calls: Array<{ sql: string; params: unknown[] }> = []
  releaseCount = 0

  constructor(private readonly failOnSql?: string) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params })
    if (sql === this.failOnSql) {
      throw new Error(`forced transaction failure: ${sql}`)
    }
    return []
  }

  release(): void {
    this.releaseCount += 1
  }
}

class FakeTransactionProvider {
  checkoutCount = 0

  constructor(readonly connection: FakeTransactionConnection) {}

  async checkout(): Promise<FakeTransactionConnection> {
    this.checkoutCount += 1
    return this.connection
  }
}

describe('withTeamDbTransaction', () => {
  it('opens an explicitly requested repeatable-read snapshot before any work query', async () => {
    const connection = new FakeTransactionConnection()
    const provider = new FakeTransactionProvider(connection)

    await withTeamDbTransaction(
      provider,
      async (db) => {
        await db.query('SELECT policy_version FROM enforcement_policies')
      },
      { isolationLevel: 'repeatable_read' },
    )

    expect(connection.calls.map(({ sql }) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
      'SELECT policy_version FROM enforcement_policies',
      'COMMIT',
    ])
  })

  it('uses one checked-out client and returns the generic work result after commit', async () => {
    const connection = new FakeTransactionConnection()
    const provider = new FakeTransactionProvider(connection)

    const result = await withTeamDbTransaction(provider, async (db) => {
      expect('release' in db).toBe(false)
      await db.query('INSERT INTO work_items (id) VALUES ($1)', ['work-1'])
      return { id: 'work-1', version: 1 }
    })

    expect(result).toEqual({ id: 'work-1', version: 1 })
    expect(provider.checkoutCount).toBe(1)
    expect(connection.calls).toEqual([
      { sql: 'BEGIN', params: [] },
      {
        sql: 'INSERT INTO work_items (id) VALUES ($1)',
        params: ['work-1'],
      },
      { sql: 'COMMIT', params: [] },
    ])
    expect(connection.releaseCount).toBe(1)
  })

  it('rethrows the original work error and releases even when rollback fails', async () => {
    const connection = new FakeTransactionConnection('ROLLBACK')
    const provider = new FakeTransactionProvider(connection)
    const sensitiveError = new Error('private database detail: API_TOKEN=do-not-wrap')
    let caught: unknown

    try {
      await withTeamDbTransaction(provider, async () => {
        throw sensitiveError
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(sensitiveError)
    expect(connection.calls.map(({ sql }) => sql)).toEqual(['BEGIN', 'ROLLBACK'])
    expect(connection.releaseCount).toBe(1)
  })
})
