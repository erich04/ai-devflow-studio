import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projects } from '@ai-devflow/shared/fixtures'
import { resolveTeamDbConfig } from './client'
import { createPostgresPoolClient } from './postgres-client'
import type { TeamDbClient } from './client'

const DEMO_ORGANIZATION_ID = 'org-demo'
const seedProjectIds = new Set(projects.map((project) => project.id))

type CleanupMode = 'dry-run' | 'delete'

export type DemoCleanupReport = {
  organizationId: string
  mode: CleanupMode
  blockers: string[]
  counts: Record<string, number>
  deleted: boolean
}

async function countRows(
  db: TeamDbClient,
  key: string,
  sql: string,
  params: unknown[],
): Promise<[string, number]> {
  const [row] = await db.query<{ count: string | number }>(sql, params)
  return [key, Number(row?.count ?? 0)]
}

async function listIds(db: TeamDbClient, sql: string, params: unknown[]): Promise<string[]> {
  const rows = await db.query<{ id: string }>(sql, params)
  return rows.map((row) => row.id)
}

export async function inspectDemoSeedData(
  db: TeamDbClient,
  organizationId = DEMO_ORGANIZATION_ID,
): Promise<DemoCleanupReport> {
  const entries = await Promise.all([
    countRows(db, 'organizations', 'SELECT count(*) AS count FROM organizations WHERE id = $1', [organizationId]),
    countRows(db, 'users', 'SELECT count(*) AS count FROM users WHERE organization_id = $1', [organizationId]),
    countRows(db, 'projects', 'SELECT count(*) AS count FROM projects WHERE organization_id = $1', [organizationId]),
    countRows(db, 'project_members', `
      SELECT count(*) AS count
      FROM project_members
      WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)
    `, [organizationId]),
    countRows(db, 'workflow_runs', 'SELECT count(*) AS count FROM workflow_runs WHERE organization_id = $1', [organizationId]),
    countRows(db, 'non_seed_runs', `
      SELECT count(*) AS count
      FROM workflow_runs
      WHERE organization_id = $1 AND data_origin <> 'seed'
    `, [organizationId]),
    countRows(db, 'agent_provider_credentials', `
      SELECT count(*) AS count
      FROM agent_provider_credentials
      WHERE organization_id = $1
    `, [organizationId]),
    countRows(db, 'mcp_server_definitions', `
      SELECT count(*) AS count
      FROM mcp_server_definitions
      WHERE organization_id = $1
    `, [organizationId]),
    countRows(db, 'skills', 'SELECT count(*) AS count FROM skills WHERE organization_id = $1', [organizationId]),
    countRows(db, 'enforcement_policies', `
      SELECT count(*) AS count
      FROM enforcement_policies
      WHERE organization_id = $1
    `, [organizationId]),
  ])
  const counts = Object.fromEntries(entries)
  const projectIds = await listIds(db, 'SELECT id FROM projects WHERE organization_id = $1', [organizationId])
  const nonSeedProjectIds = projectIds.filter((projectId) => !seedProjectIds.has(projectId))
  const blockers = [
    (counts['non_seed_runs'] ?? 0) > 0
      ? `org-demo has ${counts['non_seed_runs'] ?? 0} non-seed workflow run(s)`
      : '',
    nonSeedProjectIds.length > 0
      ? `org-demo has non-fixture project id(s): ${nonSeedProjectIds.join(', ')}`
      : '',
    (counts['agent_provider_credentials'] ?? 0) > 0
      ? `org-demo has ${counts['agent_provider_credentials'] ?? 0} provider credential(s)`
      : '',
  ].filter(Boolean)

  return {
    organizationId,
    mode: 'dry-run',
    blockers,
    counts,
    deleted: false,
  }
}

export async function cleanupDemoSeedData(
  db: TeamDbClient,
  options: { organizationId?: string; confirm?: string } = {},
): Promise<DemoCleanupReport> {
  const organizationId = options.organizationId ?? DEMO_ORGANIZATION_ID
  const report = await inspectDemoSeedData(db, organizationId)
  const confirmed = options.confirm === organizationId
  if (!confirmed) {
    return report
  }

  if (report.blockers.length > 0) {
    throw new Error(`Refusing to clean demo data: ${report.blockers.join('; ')}`)
  }

  await db.query('BEGIN')
  try {
    await db.query('DELETE FROM workflow_runs WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM runtime_budget_approvals WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM runtime_budget_policies WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM desktop_tokens WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM desktop_pairing_codes WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM auth_accounts WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [
      organizationId,
    ])
    await db.query('DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)', [
      organizationId,
    ])
    await db.query('DELETE FROM enforcement_policies WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM mcp_server_definitions WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM skills WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM projects WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM users WHERE organization_id = $1', [organizationId])
    await db.query('DELETE FROM organizations WHERE id = $1', [organizationId])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }

  return {
    ...report,
    mode: 'delete',
    deleted: true,
  }
}

function parseConfirmArg(argv: string[]): string | undefined {
  const confirmIndex = argv.indexOf('--confirm')
  if (confirmIndex < 0) {
    return undefined
  }

  return argv[confirmIndex + 1]
}

async function main() {
  const config = resolveTeamDbConfig()
  if (!config) {
    throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running db:cleanup-demo.')
  }

  const db = createPostgresPoolClient(config)
  try {
    const confirm = parseConfirmArg(process.argv.slice(2))
    const report = await cleanupDemoSeedData(db, confirm ? { confirm } : {})
    console.log(JSON.stringify(report, null, 2))
    if (!report.deleted) {
      console.log('Dry run only. Re-run with --confirm org-demo to delete demo seed data.')
    }
  } finally {
    await db.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
