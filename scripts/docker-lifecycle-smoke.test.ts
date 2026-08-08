import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}
const lifecycleSmoke = readFileSync('scripts/docker-lifecycle-smoke.mjs', 'utf8').replace(
  /\r\n?/g,
  '\n',
)

describe('V1.4 Docker lifecycle smoke contract', () => {
  it('pins the released V1.3 baseline by annotated-tag commit and builds that source', () => {
    expect(lifecycleSmoke).toContain("const V13_TAG = 'v1.3.0'")
    expect(lifecycleSmoke).toContain(
      "const V13_COMMIT = '06f3cc321300e3751aaa41c67f66d70cfaf6ebe4'",
    )
    expect(lifecycleSmoke).toContain("'rev-parse', `${V13_TAG}^{}`")
    expect(lifecycleSmoke).toContain("'archive', '--format=tar'")
    expect(lifecycleSmoke).toContain("':(exclude,glob)**/*.test.ts'")
    expect(lifecycleSmoke).toContain("':(exclude,glob)**/*.test.tsx'")
    expect(lifecycleSmoke).toContain('assertV13BuildContextSafe(v13Source)')
    expect(lifecycleSmoke).toContain("'cat-file', '-t', V13_TAG")
    expect(lifecycleSmoke).toContain('`--output=${archivePath}`, V13_COMMIT')
  })

  it('proves fresh schema creation and a volume-retained V1.3 to V1.4 upgrade', () => {
    expect(lifecycleSmoke).toContain("const FRESH_DATABASE = 'devflow_fresh'")
    expect(lifecycleSmoke).toContain("const UPGRADE_DATABASE = 'devflow_upgrade'")
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FRESH_DATABASE, 10)")
    expect(lifecycleSmoke).toContain("expectSchemaVersion(UPGRADE_DATABASE, 7)")
    expect(lifecycleSmoke).toContain('restartPostgresWithRetainedVolume()')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(UPGRADE_DATABASE, 10)")
    expect(lifecycleSmoke).toContain('V1.3 retained sentinel')
    expect(lifecycleSmoke).toContain('startCurrentApiAgainstDatabase(')
    expect(lifecycleSmoke).toContain("readiness.service === '@ai-devflow/api'")
    expect(lifecycleSmoke).toContain(
      'Current production API did not read the retained V1.3 sentinel.',
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

  it('proves a failed v9 to v10 migration rolls back before remediation and retry', () => {
    expect(lifecycleSmoke).toContain("const FAILURE_DATABASE = 'devflow_failed_upgrade'")
    expect(lifecycleSmoke).toContain('0008_v14_work_authority.sql')
    expect(lifecycleSmoke).toContain('0009_harden_work_request_timeline.sql')
    expect(lifecycleSmoke).toContain('development_header')
    expect(lifecycleSmoke).toContain('expectDockerFailure(')
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FAILURE_DATABASE, 9)")
    expect(lifecycleSmoke).toContain("expectColumnMissing(FAILURE_DATABASE, 'gate_commands', 'version')")
    expect(lifecycleSmoke).toContain("SET auth_kind = 'session_cookie'")
    expect(lifecycleSmoke).toContain("expectSchemaVersion(FAILURE_DATABASE, 10)")
  })

  it('starts the exact V1.3 API against schema v10 and exercises an authenticated read', () => {
    expect(lifecycleSmoke).toContain('startV13ApiAgainstUpgradedDatabase')
    expect(lifecycleSmoke).toContain("source: 'authenticated'")
    expect(lifecycleSmoke).toContain('/api/team/overview')
    expect(lifecycleSmoke).toContain('rollback overview did not retain the V1.3 sentinel')
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
    expect(guide).toContain('V1.4 lifecycle and rollback matrix')
    expect(guide).toContain('V1.3 API')
    expect(guide).toContain('schema v10')
    expect(guide).toContain('must not run the V1.3 migrator')
    expect(guide).toContain('Desktop schema v12')
    expect(guide).toContain('V1.3 schema v8')
    expect(guide).toContain('restore the pre-upgrade backup')
  })
})
