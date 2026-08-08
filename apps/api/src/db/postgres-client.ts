import { Pool, type PoolConfig } from 'pg'
import {
  createTeamDbClient,
  type TeamDbConfig,
  type TeamDbPoolClient,
} from './client'

export function createPostgresPoolClient(config: TeamDbConfig): TeamDbPoolClient {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName,
    statement_timeout: config.statementTimeoutMs,
  }

  const pool = new Pool(poolConfig)
  const client = createTeamDbClient(pool)

  return {
    ...client,
    async checkout() {
      const connection = await pool.connect()
      return {
        async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
          const result = await connection.query(sql, params)
          return result.rows as T[]
        },
        release(): void {
          connection.release()
        },
      }
    },
  }
}
