export type TeamDbConfig = {
  connectionString: string
  applicationName: string
  statementTimeoutMs: number
}

export type TeamDbQueryResult<T> = {
  rows: T[]
}

export type TeamDbQueryable = {
  query<T>(sql: string, params?: unknown[]): Promise<TeamDbQueryResult<T>>
  end?: () => Promise<void> | void
  release?: () => void
}

export type TeamDbClient = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

export type TeamDbCheckedOutClient = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  release(): Promise<void> | void
}

export type TeamDbConnectionProvider = {
  checkout(): Promise<TeamDbCheckedOutClient>
}

export type TeamDbRepositoryClient = TeamDbClient & TeamDbConnectionProvider

export type TeamDbPoolClient = TeamDbRepositoryClient

const DEFAULT_APPLICATION_NAME = 'ai-devflow-api'
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000
const MAX_STATEMENT_TIMEOUT_MS = 2_147_483_647

export function isValidDatabaseStatementTimeout(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false
  const parsed = Number(value)
  return (
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_STATEMENT_TIMEOUT_MS
  )
}

export function resolveTeamDbConfig(
  env: Record<string, string | undefined> = process.env,
): TeamDbConfig | null {
  const connectionString = env['DEVFLOW_DATABASE_URL'] ?? env['DATABASE_URL']
  if (!connectionString) {
    return null
  }

  const configuredStatementTimeout = env['DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS']
  if (
    configuredStatementTimeout !== undefined &&
    !isValidDatabaseStatementTimeout(configuredStatementTimeout)
  ) {
    throw new Error(
      'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS must be a positive decimal integer.',
    )
  }
  const statementTimeoutMs = configuredStatementTimeout
    ? Number(configuredStatementTimeout)
    : DEFAULT_STATEMENT_TIMEOUT_MS

  return {
    connectionString,
    applicationName: env['DEVFLOW_DATABASE_APPLICATION_NAME'] ?? DEFAULT_APPLICATION_NAME,
    statementTimeoutMs,
  }
}

export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    if (url.password) {
      url.password = '***'
    }

    return url.toString()
  } catch {
    return '[invalid database url]'
  }
}

export function createTeamDbClient(connection: TeamDbQueryable): TeamDbClient {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await connection.query<T>(sql, params)
      return result.rows
    },

    async close(): Promise<void> {
      if (connection.end) {
        await connection.end()
        return
      }

      connection.release?.()
    },
  }
}
