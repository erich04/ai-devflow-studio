import {
  redactConnectionString,
  resolveTeamDbConfig,
  type TeamDbClient,
  type TeamDbConfig,
} from '../db/client'
import { resolveDevFlowRuntimeFlags } from '@ai-devflow/shared'
import { createPostgresPoolClient } from '../db/postgres-client'
import { createPostgresTeamRepository } from './postgres-team-repository'
import { createSeedTeamRepository, type TeamRepository } from './team-repository'

export type TeamRepositorySource = 'seed' | 'postgres'

export type TeamRepositoryRuntime = {
  source: TeamRepositorySource
  repository: TeamRepository
  close(): Promise<void>
}

export type TeamRepositoryRuntimeOptions = {
  env?: Record<string, string | undefined>
  createPostgresClient?: (config: TeamDbConfig) => TeamDbClient
  logger?: Pick<Console, 'info'>
}

export async function createTeamRepositoryRuntime(
  options: TeamRepositoryRuntimeOptions = {},
): Promise<TeamRepositoryRuntime> {
  const env = options.env ?? process.env
  const logger = options.logger ?? console
  const config = resolveTeamDbConfig(env)
  const flags = resolveDevFlowRuntimeFlags(env)

  if (!config) {
    if (!flags.demoDataEnabled) {
      throw new Error(
        'Set DEVFLOW_DATABASE_URL or DATABASE_URL before starting the DevFlow API, or explicitly set DEVFLOW_ENABLE_DEMO_DATA=true to use the seed repository.',
      )
    }

    logger.info('AI DevFlow API using seed team repository.')
    return {
      source: 'seed',
      repository: createSeedTeamRepository(),
      async close() {
        return undefined
      },
    }
  }

  const db = options.createPostgresClient
    ? options.createPostgresClient(config)
    : createPostgresPoolClient(config)

  logger.info(
    `AI DevFlow API using Postgres team repository: ${redactConnectionString(config.connectionString)}`,
  )

  return {
    source: 'postgres',
    repository: createPostgresTeamRepository(db, {
      fakeRuntimeEnabled: flags.fakeRuntimeEnabled,
    }),
    async close() {
      await db.close()
    },
  }
}
