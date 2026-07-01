import { describe, expect, it, vi } from 'vitest'
import type { TeamDbClient, TeamDbConfig } from '../db/client'
import { createTeamRepositoryRuntime } from './repository-runtime'

function createFakeDb(): TeamDbClient {
  return {
    async query<T>() {
      return [] as T[]
    },
    async close() {
      return undefined
    },
  }
}

describe('team repository runtime', () => {
  it('fails fast when no database URL is configured and demo data is disabled', async () => {
    await expect(createTeamRepositoryRuntime({
      env: {},
      logger: { info: vi.fn() },
    })).rejects.toThrow(
      'Set DEVFLOW_DATABASE_URL or DATABASE_URL before starting the DevFlow API',
    )
  })

  it('uses the seed repository only when demo data is explicitly enabled', async () => {
    const logger = { info: vi.fn() }

    const runtime = await createTeamRepositoryRuntime({
      env: { DEVFLOW_ENABLE_DEMO_DATA: 'true' },
      logger,
    })

    expect(runtime.source).toBe('seed')
    await expect(runtime.repository.getTeamOverview()).resolves.toMatchObject({
      projects: expect.any(Array),
      members: expect.any(Array),
    })
    expect(logger.info).toHaveBeenCalledWith('AI DevFlow API using seed team repository.')
  })

  it('uses Postgres when a database URL is configured and redacts logs', async () => {
    const close = vi.fn(async () => undefined)
    const logger = { info: vi.fn() }
    const createPostgresClient = vi.fn((config: TeamDbConfig): TeamDbClient => ({
      ...createFakeDb(),
      close,
      async query<T>() {
        return [] as T[]
      },
    }))

    const runtime = await createTeamRepositoryRuntime({
      env: {
        DEVFLOW_DATABASE_URL: 'postgres://devflow:secret@localhost:5432/devflow',
      },
      logger,
      createPostgresClient,
    })

    expect(runtime.source).toBe('postgres')
    expect(createPostgresClient).toHaveBeenCalledWith({
      connectionString: 'postgres://devflow:secret@localhost:5432/devflow',
      applicationName: 'ai-devflow-api',
      statementTimeoutMs: 5000,
    })
    expect(logger.info).toHaveBeenCalledWith(
      'AI DevFlow API using Postgres team repository: postgres://devflow:***@localhost:5432/devflow',
    )

    await runtime.close()
    expect(close).toHaveBeenCalled()
  })
})
