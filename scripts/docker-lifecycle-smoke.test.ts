import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}
const lifecycleSmoke = readFileSync('scripts/docker-lifecycle-smoke.mjs', 'utf8').replace(
  /\r\n?/g,
  '\n',
)

describe('V1.5 Docker lifecycle smoke contract', () => {
  it('pins the released V1.4 baseline by annotated-tag commit and builds that source', () => {
    expect(lifecycleSmoke).toContain("const V14_TAG = 'v1.4.0'")
    expect(lifecycleSmoke).toContain(
      "const V14_COMMIT = 'e746843c1943755c50c8fb060bdf533b06442232'",
    )
    expect(lifecycleSmoke).toContain("'rev-parse', `${V14_TAG}^{}`")
    expect(lifecycleSmoke).toContain("'archive', '--format=tar'")
    expect(lifecycleSmoke).toContain("':(exclude,glob)**/*.test.ts'")
    expect(lifecycleSmoke).toContain("':(exclude,glob)**/*.test.tsx'")
    expect(lifecycleSmoke).toContain('assertV14BuildContextSafe(v14Source)')
    expect(lifecycleSmoke).toContain("'cat-file', '-t', V14_TAG")
    expect(lifecycleSmoke).toContain('`--output=${archivePath}`, V14_COMMIT')
  })

  it('proves fresh schema v17 and a volume-retained V1.4 schema v10 upgrade', () => {
    expect(lifecycleSmoke).toContain("const FRESH_DATABASE = 'devflow_fresh'")
    expect(lifecycleSmoke).toContain("const UPGRADE_DATABASE = 'devflow_upgrade'")
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FRESH_DATABASE, 17)")
    expect(lifecycleSmoke).toContain('startCurrentApiAgainstDatabase(FRESH_DATABASE)')
    expect(lifecycleSmoke).toContain('runV14Migration(UPGRADE_DATABASE)')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(UPGRADE_DATABASE, 10)")
    expect(lifecycleSmoke).toContain('restartPostgresWithRetainedVolume()')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(UPGRADE_DATABASE, 17)")
    expect(lifecycleSmoke).toContain('V1.4 retained sentinel')
    expect(lifecycleSmoke).toContain('snapshotBeforeV10Upgrade')
    expect(lifecycleSmoke).toContain('snapshotAfterV15Upgrade')
    expect(lifecycleSmoke).toContain('startCurrentApiAgainstDatabase(')
    expect(lifecycleSmoke).toContain("readiness.service === '@ai-devflow/api'")
    expect(lifecycleSmoke).toContain(
      'Current production API did not read the retained V1.4 sentinel.',
    )
    expect(lifecycleSmoke).not.toContain("'exec',\n      'exec',")
  })

  it('waits for the final Postgres process rather than the temporary healthy init server', () => {
    expect(lifecycleSmoke).toContain('waitForFinalPostgresReadiness({')
    expect(lifecycleSmoke).toContain("'/proc/1/comm'")
    expect(lifecycleSmoke).toContain("'pg_isready',")
    expect(lifecycleSmoke).toContain('healthStatus: state.stdout.trim()')
    expect(lifecycleSmoke).toContain('initProcessName')
    expect(lifecycleSmoke).toContain('liveProbeReady = true')
  })

  it('proves a populated v11 to v12 migration is transactional and retains exact data on retry', () => {
    expect(lifecycleSmoke).toContain("const FAILURE_DATABASE = 'devflow_failed_upgrade'")
    expect(lifecycleSmoke).toContain('0011_github_delivery.sql')
    expect(lifecycleSmoke).toContain('prepareV11FailureFixture')
    expect(lifecycleSmoke).toContain('github-delivery:not-a-digest')
    expect(lifecycleSmoke).toContain('snapshotBeforeFailedV12')
    expect(lifecycleSmoke).toContain('snapshotAfterFailedV12')
    expect(lifecycleSmoke).toContain('expectDockerFailure(')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FAILURE_DATABASE, 11)")
    expect(lifecycleSmoke).toMatch(
      /expectColumnMissing\(\s*FAILURE_DATABASE,\s*'github_delivery_requests',\s*'delivery_series_key'/,
    )
    expect(lifecycleSmoke).toContain('expectMigrationHistoryMissing(FAILURE_DATABASE, 12)')
    expect(lifecycleSmoke).toContain("SET logical_idempotency_key = 'github-delivery:' || repeat('9', 64)")
    expect(lifecycleSmoke).toContain('snapshotBeforeV12Retry')
    expect(lifecycleSmoke).toContain('assertRetainedV11DeliveryAfterV12')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FAILURE_DATABASE, 12)")
  })

  it('migrates a legacy issued v12 credential through v17 without inventing provider, Runtime, or Memory proof', () => {
    expect(lifecycleSmoke).toContain('prepareV12LegacyIssuedCredentialFixture')
    expect(lifecycleSmoke).toContain('expectMigrationHistoryMissing(FAILURE_DATABASE, 13)')
    expect(lifecycleSmoke).toContain('snapshotBeforeV13')
    expect(lifecycleSmoke).toContain('assertLegacyIssuedCredentialAfterV13')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FAILURE_DATABASE, 17)")
    expect(lifecycleSmoke).toContain('provider_expiry_contract_version')
    expect(lifecycleSmoke).toContain('provider_credential_expires_at')
    expect(lifecycleSmoke).toContain('provider_expiry_observed_at')
    expect(lifecycleSmoke).toContain('credential_provider_expiry_confirmed')
    expect(lifecycleSmoke).toContain('github_delivery_grants_provider_expiry_contract')
    expect(lifecycleSmoke).toContain('assertLegacyPublicationAfterV15')
    expect(lifecycleSmoke).toContain('source_publication_id')
    expect(lifecycleSmoke).toContain('github_branch_publications_authority_exactly_one')
    expect(lifecycleSmoke).toContain('assertAgentRuntimeProjectionAfterV16')
    expect(lifecycleSmoke).toContain('agent_runtime_summaries')
    expect(lifecycleSmoke).toContain('agent_runtime_projection_audits')
    expect(lifecycleSmoke).toContain(
      'V15-to-v16 migration invented Agent Runtime projection rows.',
    )
    expect(lifecycleSmoke).toContain('assertAgentMemoryProjectionAfterV17')
    expect(lifecycleSmoke).toContain('agent_memory_summaries')
    expect(lifecycleSmoke).toContain('agent_memory_projection_audits')
    expect(lifecycleSmoke).toContain(
      'V16-to-v17 migration invented Agent Memory projection rows.',
    )
  })

  it('fails the exact V1.4 API closed on v13, then proves authenticated backup restore on v10', () => {
    expect(lifecycleSmoke).toContain("const ROLLBACK_DATABASE = 'devflow_v14_rollback'")
    expect(lifecycleSmoke).toContain('backupV14Database(UPGRADE_DATABASE)')
    expect(lifecycleSmoke).toContain('expectV14ApiRejectsNewerSchema(UPGRADE_DATABASE)')
    expect(lifecycleSmoke).toContain('readinessResponse.status === 503')
    expect(lifecycleSmoke).toContain('restoreV14Database(v14Backup)')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(ROLLBACK_DATABASE, 10)")
    expect(lifecycleSmoke).toContain('startV14ApiAgainstRestoredDatabase')
    expect(lifecycleSmoke).toContain('/api/team/overview')
    expect(lifecycleSmoke).toContain('rollback overview did not retain the V1.4 sentinel')
    expect(lifecycleSmoke).toContain("'node',\n    'apps/api/dist/server.js'")
    expect(lifecycleSmoke).not.toContain("'tsx',\n    'src/server.ts'")
  })

  it('is explicit, no-cost, and outside the default verification command', () => {
    expect(packageJson.scripts['test:docker-lifecycle-smoke']).toBe(
      'node scripts/docker-lifecycle-smoke.mjs',
    )
    expect(packageJson.scripts.verify).not.toContain('test:docker-lifecycle-smoke')
    expect(lifecycleSmoke).not.toMatch(/OPENAI|ANTHROPIC|provider.*key/i)
  })

  it('runs as candidate evidence in the release workflow', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain('Docker lifecycle smoke')
    expect(workflow).toContain('corepack pnpm test:docker-lifecycle-smoke')
  })

  it('documents the bounded API and Desktop rollback windows', () => {
    const guide = readFileSync('docs/guides/devflow-studio-self-hosted-pilot.md', 'utf8')
    expect(guide).toContain('V1.5 lifecycle and rollback matrix')
    expect(guide).toContain('V1.4 API')
    expect(guide).toContain('Team schema v15')
    expect(guide).toContain('fails readiness closed')
    expect(guide).toContain('must not run the V1.4 migrator')
    expect(guide).toContain('Desktop schema v17')
    expect(guide).toContain('V1.4 schema v12')
    expect(guide).toContain('restore the pre-upgrade backup')
  })
})
