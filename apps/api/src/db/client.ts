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

const DEFAULT_APPLICATION_NAME = 'ai-devflow-api'
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000

export function resolveTeamDbConfig(
  env: Record<string, string | undefined> = process.env,
): TeamDbConfig | null {
  const connectionString = env['DEVFLOW_DATABASE_URL'] ?? env['DATABASE_URL']
  if (!connectionString) {
    return null
  }

  const statementTimeoutMs = Number.parseInt(
    env['DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS'] ?? '',
    10,
  )

  return {
    connectionString,
    applicationName: env['DEVFLOW_DATABASE_APPLICATION_NAME'] ?? DEFAULT_APPLICATION_NAME,
    statementTimeoutMs: Number.isFinite(statementTimeoutMs)
      ? statementTimeoutMs
      : DEFAULT_STATEMENT_TIMEOUT_MS,
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
