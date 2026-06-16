import { Pool, type PoolConfig } from 'pg'
import {
  createTeamDbClient,
  type TeamDbClient,
  type TeamDbConfig,
} from './client'

export function createPostgresPoolClient(config: TeamDbConfig): TeamDbClient {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName,
    statement_timeout: config.statementTimeoutMs,
  }

  return createTeamDbClient(new Pool(poolConfig))
}
