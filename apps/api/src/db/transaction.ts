import type { TeamDbConnectionProvider } from './client'

export type TeamDbTransactionClient = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
}

export async function withTeamDbTransaction<T>(
  provider: TeamDbConnectionProvider,
  work: (db: TeamDbTransactionClient) => Promise<T>,
): Promise<T> {
  const noFailure = Symbol('no transaction failure')
  const connection = await provider.checkout()
  const queryClient: TeamDbTransactionClient = {
    query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return connection.query<T>(sql, params)
    },
  }

  let transactionOpen = false
  let failure: unknown | typeof noFailure = noFailure
  let result: T | undefined

  try {
    await connection.query('BEGIN')
    transactionOpen = true
    result = await work(queryClient)
    await connection.query('COMMIT')
    transactionOpen = false
  } catch (error) {
    failure = error
    if (transactionOpen) {
      try {
        await connection.query('ROLLBACK')
      } catch {
        // Preserve the original failure without logging or wrapping sensitive detail.
      }
    }
  } finally {
    try {
      await connection.release()
    } catch (error) {
      if (failure === noFailure) {
        failure = error
      }
    }
  }

  if (failure !== noFailure) {
    throw failure
  }
  return result as T
}
