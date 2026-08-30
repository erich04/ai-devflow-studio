import { spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { waitForFinalPostgresReadiness } from './docker-lifecycle-readiness.mjs'

const V14_TAG = 'v1.4.0'
const V14_COMMIT = 'e746843c1943755c50c8fb060bdf533b06442232'
const FRESH_DATABASE = 'devflow_fresh'
const UPGRADE_DATABASE = 'devflow_upgrade'
const FAILURE_DATABASE = 'devflow_failed_upgrade'
const ROLLBACK_DATABASE = 'devflow_v14_rollback'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-lifecycle-smoke-'))
const uniqueSuffix = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`
const networkName = `devflow-lifecycle-network-${uniqueSuffix}`
const volumeName = `devflow-lifecycle-postgres-${uniqueSuffix}`
const postgresContainerName = `devflow-lifecycle-postgres-${uniqueSuffix}`
const rollbackApiContainerName = `devflow-lifecycle-v14-api-${uniqueSuffix}`
const currentApiContainerName = `devflow-lifecycle-current-api-${uniqueSuffix}`
const currentApiImage = `devflow-lifecycle-current-api:${uniqueSuffix}`
const v14Image = `devflow-lifecycle-v14:${uniqueSuffix}`
const postgresUser = 'postgres'
const postgresPassword = 'devflow-lifecycle-smoke-password'
const sessionSecret = 'devflow-lifecycle-session-secret-non-production-32-plus'
const agentCredentialKey =
  'devflow-lifecycle-agent-credential-key-non-production-32-plus'

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const inherit = options.inherit === true
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    if (!inherit) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.stdin.on('error', (error) => {
        if (error?.code !== 'EPIPE') reject(error)
      })
      child.stdin.end(options.input ?? '')
    }

    child.once('error', reject)
    child.once('close', (code) => {
      const result = { code, stdout, stderr }
      if (code === 0) {
        resolve(result)
        return
      }
      const error = new Error(
        `${command} ${args.join(' ')} exited with ${code}.\n${stdout}${stderr}`,
      )
      error.result = result
      reject(error)
    })
  })
}

function runDocker(args, options = {}) {
  return execute('docker', args, options)
}

async function expectDockerFailure(args, options = {}) {
  try {
    await runDocker(args, options)
  } catch (error) {
    return error
  }
  throw new Error(`Expected docker ${args.join(' ')} to fail.`)
}

function databaseUrl(database) {
  return `postgresql://${postgresUser}:${postgresPassword}@postgres:5432/${database}`
}

async function verifyV14Tag() {
  const objectType = await execute('git', ['cat-file', '-t', V14_TAG])
  expect(
    objectType.stdout.trim() === 'tag',
    `${V14_TAG} is not an annotated tag object.`,
  )
  const resolved = await execute('git', ['rev-parse', `${V14_TAG}^{}`])
  expect(
    resolved.stdout.trim() === V14_COMMIT,
    `${V14_TAG} resolved to ${resolved.stdout.trim() || 'nothing'}, expected ${V14_COMMIT}.`,
  )
}

async function assertV14BuildContextSafe(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (
      entry.name === '__tests__' ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      throw new Error(
        `Refusing to send a V1.4 test path to the Docker build context: ${relativePath}`,
      )
    }
    if (entry.isDirectory()) {
      await assertV14BuildContextSafe(root, relativePath)
      continue
    }
    if (!entry.isFile()) continue

    const sourcePath = path.join(root, relativePath)
    const sourceStats = await stat(sourcePath)
    if (
      sourceStats.size <= 5_000_000 &&
      (relativePath.startsWith(`apps${path.sep}`) ||
        relativePath.startsWith(`packages${path.sep}`))
    ) {
      const source = await readFile(sourcePath, 'utf8')
      if (/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(source)) {
        throw new Error(
          `Refusing a UUID-shaped literal in the V1.4 production build context: ${relativePath}`,
        )
      }
    }
  }
}

async function buildImages() {
  const archivePath = path.join(temporaryRoot, 'v1.4.0.tar')
  const v14Source = path.join(temporaryRoot, 'v1.4.0')
  await mkdir(v14Source, { recursive: true })
  await execute('git', [
    'archive', '--format=tar', `--output=${archivePath}`, V14_COMMIT, '--',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    'packages/shared', 'apps/api',
    ':(exclude,glob)**/*.test.ts',
    ':(exclude,glob)**/*.test.tsx',
    ':(exclude,glob)**/*.spec.ts',
    ':(exclude,glob)**/*.spec.tsx',
    ':(exclude,glob)**/__tests__/**',
  ])
  await execute('tar', ['-xf', archivePath, '-C', v14Source])
  await assertV14BuildContextSafe(v14Source)
  const v14Dockerfile = path.join(v14Source, 'lifecycle.Dockerfile')
  await writeFile(
    v14Dockerfile,
    `FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7
ENV CI=1
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @ai-devflow/shared build
RUN corepack pnpm --filter @ai-devflow/api build
CMD ["node", "apps/api/dist/server.js"]
`,
  )

  await runDocker(
    ['build', '--target', 'api-runtime', '--tag', currentApiImage, '.'],
    { inherit: true },
  )
  await runDocker(
    ['build', '--file', v14Dockerfile, '--tag', v14Image, v14Source],
    { inherit: true },
  )
}

async function startPostgres() {
  await runDocker([
    'run',
    '-d',
    '--name',
    postgresContainerName,
    '--network',
    networkName,
    '--network-alias',
    'postgres',
    '--health-cmd',
    `pg_isready -U ${postgresUser} -d postgres`,
    '--health-interval',
    '1s',
    '--health-timeout',
    '5s',
    '--health-retries',
    '60',
    '-e',
    `POSTGRES_USER=${postgresUser}`,
    '-e',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '-e',
    'POSTGRES_DB=postgres',
    '-v',
    `${volumeName}:/var/lib/postgresql/data`,
    'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
  ])

  await waitForFinalPostgresReadiness({
    readObservation: async () => {
      const state = await runDocker([
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        postgresContainerName,
      ])
      let initProcessName = 'unavailable'
      try {
        const process = await runDocker([
          'exec',
          postgresContainerName,
          'cat',
          '/proc/1/comm',
        ])
        initProcessName = process.stdout.trim()
      } catch {
        // A Docker exec launched during the entrypoint handoff can fail transiently.
      }
      let liveProbeReady = false
      if (initProcessName === 'postgres') {
        try {
          await runDocker([
            'exec',
            postgresContainerName,
            'pg_isready',
            '-U',
            postgresUser,
            '-d',
            'postgres',
          ])
          liveProbeReady = true
        } catch {
          // Docker health can still reflect the temporary init server; probe again.
        }
      }
      return {
        healthStatus: state.stdout.trim(),
        initProcessName,
        liveProbeReady,
      }
    },
    maxAttempts: 120,
    delay: () => new Promise((resolve) => setTimeout(resolve, 250)),
  })
}

async function restartPostgresWithRetainedVolume() {
  await runDocker(['stop', postgresContainerName])
  await runDocker(['rm', postgresContainerName])
  await startPostgres()
}

async function createDatabase(database) {
  await runDocker([
    'exec',
    postgresContainerName,
    'createdb',
    '-U',
    postgresUser,
    database,
  ])
}

async function psql(database, sql) {
  return runDocker(
    [
      'exec',
      '-i',
      postgresContainerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      postgresUser,
      '-d',
      database,
      '-Atq',
    ],
    { input: sql },
  )
}

async function backupV14Database(database) {
  const dump = await runDocker([
    'exec',
    postgresContainerName,
    'pg_dump',
    '--no-owner',
    '--no-privileges',
    '--format=p',
    '-U',
    postgresUser,
    database,
  ])
  expect(dump.stdout.length > 0, 'The V1.4 pre-upgrade backup was empty.')
  return dump.stdout
}

async function restoreV14Database(v14Backup) {
  await createDatabase(ROLLBACK_DATABASE)
  await psql(ROLLBACK_DATABASE, v14Backup)
}

function currentMigrationArgs(database) {
  return [
    'run',
    '--rm',
    '--network',
    networkName,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    '-e',
    'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS=15000',
    currentApiImage,
    'node',
    'migrate.js',
  ]
}

async function runCurrentMigration(database) {
  await runDocker(currentMigrationArgs(database))
}

async function runV14Migration(database) {
  await runDocker([
    'run',
    '--rm',
    '--network',
    networkName,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    v14Image,
    'corepack',
    'pnpm',
    '--filter',
    '@ai-devflow/api',
    'db:migrate',
  ])
}

async function seedV14(database) {
  await runDocker([
    'run',
    '--rm',
    '--network',
    networkName,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    '-e',
    'DEVFLOW_ENABLE_DEMO_DATA=true',
    v14Image,
    'corepack',
    'pnpm',
    '--filter',
    '@ai-devflow/api',
    'db:seed',
  ])
}

async function expectSchemaVersion(database, expectedVersion) {
  const result = await psql(
    database,
    "SELECT value FROM schema_meta WHERE key = 'schema_version';\n",
  )
  expect(
    result.stdout.trim() === String(expectedVersion),
    `${database} schema version was ${result.stdout.trim() || 'missing'}, expected ${expectedVersion}.`,
  )
}

async function assertAgentRuntimeProjectionAfterV16(database) {
  const inventory = await psql(
    database,
    `SELECT string_agg(table_name, ',' ORDER BY table_name)
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'agent_runtime_summaries',
         'agent_runtime_projection_audits'
       );\n`,
  )
  expect(
    inventory.stdout.trim() ===
      'agent_runtime_projection_audits,agent_runtime_summaries',
    `${database} did not create the exact V16 Agent Runtime projection tables.`,
  )
  const counts = await psql(
    database,
    `SELECT
       (SELECT count(*) FROM agent_runtime_summaries)::text || '|' ||
       (SELECT count(*) FROM agent_runtime_projection_audits)::text;\n`,
  )
  expect(
    counts.stdout.trim() === '0|0',
    'V15-to-v16 migration invented Agent Runtime projection rows.',
  )
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 16 AND name = '0016_agent_runtime_team_projection';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V16 Agent Runtime migration.`,
  )
}

async function assertAgentMemoryProjectionAfterV17(database) {
  const inventory = await psql(
    database,
    `SELECT string_agg(table_name, ',' ORDER BY table_name)
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'agent_memory_summaries',
         'agent_memory_projection_audits'
       );\n`,
  )
  expect(
    inventory.stdout.trim() ===
      'agent_memory_projection_audits,agent_memory_summaries',
    `${database} did not create the exact V17 Agent Memory projection tables.`,
  )
  const counts = await psql(
    database,
    `SELECT
       (SELECT count(*) FROM agent_memory_summaries)::text || '|' ||
       (SELECT count(*) FROM agent_memory_projection_audits)::text;\n`,
  )
  expect(
    counts.stdout.trim() === '0|0',
    'V16-to-v17 migration invented Agent Memory projection rows.',
  )
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 17 AND name = '0017_agent_memory_team_projection';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V17 Agent Memory migration.`,
  )
}

async function assertAgentMemoryProjectionQualityAfterV18(database) {
  const columns = await psql(
    database,
    `SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('agent_memory_summaries', 'agent_memory_projection_audits')
       AND column_name = 'quality_version';\n`,
  )
  expect(
    columns.stdout.trim() ===
      'agent_memory_projection_audits.quality_version,agent_memory_summaries.quality_version',
    `${database} did not create the exact V18 Agent Memory quality-version columns.`,
  )
  const primaryKey = await psql(
    database,
    `SELECT string_agg(attribute.attname, ',' ORDER BY key.ordinality)
     FROM pg_constraint AS constraint_record
     CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinality)
     JOIN pg_attribute AS attribute
       ON attribute.attrelid = constraint_record.conrelid
      AND attribute.attnum = key.attnum
     WHERE constraint_record.conrelid = 'agent_memory_projection_audits'::regclass
       AND constraint_record.contype = 'p';\n`,
  )
  expect(
    primaryKey.stdout.trim() === 'memory_id,head_version,quality_version',
    `${database} did not install the exact V18 Agent Memory quality audit key.`,
  )
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 18 AND name = '0018_agent_memory_projection_quality_version';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V18 Agent Memory quality migration.`,
  )
}

async function assertAgentCoordinationProjectionAfterV19(database) {
  const tables = await psql(
    database,
    `SELECT string_agg(table_name, ',' ORDER BY table_name)
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'agent_coordination_summaries',
         'agent_coordination_projection_audits'
       );\n`,
  )
  expect(
    tables.stdout.trim() ===
      'agent_coordination_projection_audits,agent_coordination_summaries',
    `${database} did not create the exact V19 Agent Coordination projection tables.`,
  )
  const rowCounts = await psql(
    database,
    `SELECT
       (SELECT count(*) FROM agent_coordination_summaries),
       (SELECT count(*) FROM agent_coordination_projection_audits);\n`,
  )
  expect(
    rowCounts.stdout.trim() === '0|0',
    `${database} V18-to-v19 migration invented Agent Coordination projection rows.`,
  )
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 19 AND name = '0019_agent_coordination_team_projection';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V19 Agent Coordination migration.`,
  )
}

async function assertLocalDevelopmentAuthAfterV20(
  database,
  { expectRetainedGitHubAccount = false } = {},
) {
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 20 AND name = '0020_local_development_auth';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V20 local-development auth migration.`,
  )
  const providerConstraint = await psql(
    database,
    `SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conrelid = 'auth_accounts'::regclass
       AND conname = 'auth_accounts_provider_check';\n`,
  )
  expect(
    providerConstraint.stdout.includes('github') &&
      providerConstraint.stdout.includes('local-development') &&
      !providerConstraint.stdout.includes('unknown-provider'),
    `${database} did not install the bounded V20 auth provider constraint.`,
  )
  if (expectRetainedGitHubAccount) {
    const retainedAccounts = await psql(
      database,
      "SELECT count(*) FROM auth_accounts WHERE provider = 'github';\n",
    )
    expect(
      Number(retainedAccounts.stdout.trim()) > 0,
      `${database} did not retain its GitHub auth account through V20.`,
    )
  }
}

async function assertNativeCodingEngineAfterV21(database) {
  const migrationHistory = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations
     WHERE version = 21 AND name = '0021_native_coding_agent_engine';\n`,
  )
  expect(
    migrationHistory.stdout.trim() === '1',
    `${database} did not record the exact V21 native Coding engine migration.`,
  )
  const engineConstraint = await psql(
    database,
    `SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conrelid = 'coding_agent_summaries'::regclass
       AND conname = 'coding_agent_summaries_engine_check';\n`,
  )
  expect(
    ['fake', 'native', 'opencode-http', 'opencode-acp'].every((engine) =>
      engineConstraint.stdout.includes(engine),
    ),
    `${database} did not install the bounded V21 native Coding engine constraint.`,
  )
}

async function expectColumnMissing(database, table, column) {
  const result = await psql(
    database,
    `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}';\n`,
  )
  expect(
    result.stdout.trim() === '0',
    `${database}.${table}.${column} was present when it should be absent.`,
  )
}

async function expectMigrationHistoryMissing(database, version) {
  const result = await psql(
    database,
    `SELECT count(*) FROM team_schema_migrations WHERE version = ${version};\n`,
  )
  expect(
    result.stdout.trim() === '0',
    `${database} retained migration history version ${version} after rollback.`,
  )
}

function migrationChecksum(sql) {
  return createHash('sha256')
    .update(sql.replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex')
}

async function applyHistoricalMigration(database, fileName, version, name) {
  const sql = await readFile(
    path.join(repositoryRoot, 'apps', 'api', 'src', 'db', 'migrations', fileName),
    'utf8',
  )
  const checksum = migrationChecksum(sql)
  await psql(
    database,
    `BEGIN;\n${sql}\nUPDATE schema_meta SET value = '${version}', updated_at = now() WHERE key = 'schema_version';\nINSERT INTO team_schema_migrations (version, name, checksum, adopted) VALUES (${version}, '${name}', '${checksum}', false);\nCOMMIT;\n`,
  )
}

async function readV14RunSnapshot(database) {
  const result = await psql(
    database,
    "SELECT to_jsonb(run)::text FROM workflow_runs AS run WHERE title = 'V1.4 retained sentinel';\n",
  )
  const snapshot = result.stdout.trim()
  expect(snapshot.length > 0, 'The populated V1.4 Run sentinel was missing.')
  return snapshot
}

async function readV11DeliverySnapshot(database) {
  const result = await psql(
    database,
    "SELECT to_jsonb(request)::text FROM github_delivery_requests AS request WHERE id = 'github-delivery-lifecycle-v11';\n",
  )
  const snapshot = result.stdout.trim()
  expect(snapshot.length > 0, 'The populated V11 GitHub Delivery fixture was missing.')
  return snapshot
}

async function prepareV11FailureFixture() {
  await runV14Migration(FAILURE_DATABASE)
  await seedV14(FAILURE_DATABASE)
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0011_github_delivery.sql',
    11,
    '0011_github_delivery',
  )
  await expectSchemaVersion(FAILURE_DATABASE, 11)
  await psql(
    FAILURE_DATABASE,
    `
      INSERT INTO desktop_tokens (
        id, organization_id, project_id, user_id, token_hash, created_at
      ) VALUES (
        'desktop-token-lifecycle-v11', 'org-demo', 'p-payments', 'u-erich',
        'sha256:lifecycle-v11-token-metadata', '2026-08-11T18:00:00.000Z'
      );

      INSERT INTO github_repository_bindings (
        id, version, organization_id, project_id, installation_id,
        repository_id, full_name, default_branch, status,
        configured_by_user_id, updated_by_user_id, validated_at,
        revoked_at, created_at, updated_at
      ) VALUES (
        'github-binding-lifecycle-v11', 1, 'org-demo', 'p-payments',
        '12345', '98765', 'example/lifecycle-v11', 'main', 'active',
        'u-erich', 'u-erich', '2026-08-11T18:00:00.000Z', NULL,
        '2026-08-11T18:00:00.000Z', '2026-08-11T18:00:00.000Z'
      );

      INSERT INTO github_delivery_requests (
        id, state_version, intent_revision, organization_id, project_id,
        requested_by_user_id, requested_by_token_id, local_intent_id,
        local_project_id, run_id, run_version, node_id, binding_id,
        binding_version, installation_id, repository_id, repository_full_name,
        coding_run_id, workspace_id, diff_artifact_id, test_evidence_id,
        pr_package_artifact_id, status, outcome_code, expected_run_version,
        base_branch, head_branch, base_commit_sha, expected_commit_sha,
        intent_digest, logical_idempotency_key, diff_digest,
        test_evidence_digest, package_digest, changed_paths, pr_title, pr_body,
        expires_at, created_at, updated_at
      ) VALUES (
        'github-delivery-lifecycle-v11', 7, 2, 'org-demo', 'p-payments',
        'u-erich', 'desktop-token-lifecycle-v11',
        'local-intent-lifecycle-v11', 'local-project-lifecycle-v11',
        'run-health-001', 1, 'n-pr', 'github-binding-lifecycle-v11',
        1, '12345', '98765', 'example/lifecycle-v11',
        'coding-run-lifecycle-v11', 'workspace-lifecycle-v11',
        'diff-lifecycle-v11', 'test-evidence-lifecycle-v11',
        'pr-package-lifecycle-v11', 'failed', 'pull_request_failed', 1,
        'main', 'devflow/lifecycle-v11', repeat('a', 40), repeat('b', 40),
        repeat('2', 64), 'github-delivery:not-a-digest', repeat('3', 64),
        repeat('4', 64), repeat('5', 64),
        '["src/lifecycle-v11.ts"]'::jsonb,
        'Retained V11 delivery', 'Retained redacted lifecycle body.',
        '2026-08-12T17:00:00.000Z', '2026-08-11T18:00:00.000Z',
        '2026-08-11T18:00:00.000Z'
      );
    `,
  )
  return readV11DeliverySnapshot(FAILURE_DATABASE)
}

async function assertRetainedV11DeliveryAfterV12(snapshotBeforeV12Retry) {
  const fields = await psql(
    FAILURE_DATABASE,
    "SELECT delivery_series_key || '|' || delivery_attempt::text FROM github_delivery_requests WHERE id = 'github-delivery-lifecycle-v11';\n",
  )
  expect(
    fields.stdout.trim() === `github-delivery:${'9'.repeat(64)}|1`,
    'V12 did not backfill the retained V11 delivery series and first attempt.',
  )
  const retained = await psql(
    FAILURE_DATABASE,
    "SELECT (to_jsonb(request) - 'delivery_series_key' - 'delivery_attempt')::text FROM github_delivery_requests AS request WHERE id = 'github-delivery-lifecycle-v11';\n",
  )
  expect(
    retained.stdout.trim() === snapshotBeforeV12Retry,
    'V12 changed retained V11 GitHub Delivery fields beyond the documented backfill.',
  )
}

async function prepareV12LegacyIssuedCredentialFixture() {
  await psql(
    FAILURE_DATABASE,
    `INSERT INTO github_delivery_approvals (
       id, request_id, intent_revision, request_state_version, intent_digest,
       binding_id, binding_version, run_id, run_version, node_id,
       repository_id, base_branch, head_branch, expected_commit_sha,
       test_evidence_digest, package_digest, approved_by_user_id,
       approved_role, auth_kind, approved_at
     ) VALUES (
       'github-approval-lifecycle-v12', 'github-delivery-lifecycle-v11', 2, 7,
       repeat('2', 64), 'github-binding-lifecycle-v11', 1, 'run-health-001',
       1, 'n-pr', '98765', 'main', 'devflow/lifecycle-v11', repeat('b', 40),
       repeat('4', 64), repeat('5', 64), 'u-erich', 'owner', 'session_cookie',
       '2026-08-11T18:01:00.000Z'
     );

     INSERT INTO github_delivery_credential_grants (
       id, version, request_id, intent_revision, approval_id, attempt,
       issued_to_token_id, repository_id, permission, repository_count,
       status, requested_at, issued_at, credential_expires_at,
       consumed_at, outcome_code
     ) VALUES (
       'github-grant-lifecycle-v12', 2, 'github-delivery-lifecycle-v11', 2,
       'github-approval-lifecycle-v12', 1, 'desktop-token-lifecycle-v11',
       '98765', 'contents:write', 1, 'issued',
       '2026-08-11T18:01:00.000Z', '2026-08-11T18:01:00.000Z',
       '2026-08-11T18:31:00.000Z', NULL, NULL
     );
    `,
  )
  const snapshot = await psql(
    FAILURE_DATABASE,
    "SELECT to_jsonb(grant_record)::text FROM github_delivery_credential_grants AS grant_record WHERE id = 'github-grant-lifecycle-v12';\n",
  )
  const snapshotBeforeV13 = snapshot.stdout.trim()
  expect(snapshotBeforeV13.length > 0, 'The populated V12 legacy issued credential was missing.')
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0013_github_credential_provider_expiry.sql',
    13,
    '0013_github_credential_provider_expiry',
  )
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0014_github_pull_request_retry_after.sql',
    14,
    '0014_github_pull_request_retry_after',
  )
  await expectSchemaVersion(FAILURE_DATABASE, 14)
  await expectMigrationHistoryMissing(FAILURE_DATABASE, 15)
  await psql(
    FAILURE_DATABASE,
    `INSERT INTO github_branch_publications (
       id, version, request_id, intent_revision, grant_id, status,
       reported_outcome_code, verified_head_sha, reported_at, verified_at,
       outcome_code
     ) VALUES (
       'github-publication-lifecycle-v14', 2,
       'github-delivery-lifecycle-v11', 2, 'github-grant-lifecycle-v12',
       'verified', 'pushed', repeat('b', 40),
       '2026-08-11T18:02:00.000Z', '2026-08-11T18:02:00.000Z',
       'branch_verified'
     );\n`,
  )
  const publicationSnapshot = await psql(
    FAILURE_DATABASE,
    "SELECT to_jsonb(publication)::text FROM github_branch_publications AS publication WHERE id = 'github-publication-lifecycle-v14';\n",
  )
  const snapshotBeforeV15 = publicationSnapshot.stdout.trim()
  expect(snapshotBeforeV15.length > 0, 'The populated V14 publication was missing.')
  return { snapshotBeforeV13, snapshotBeforeV15 }
}

async function assertLegacyIssuedCredentialAfterV13(snapshotBeforeV13) {
  const fields = await psql(
    FAILURE_DATABASE,
    `SELECT
       provider_expiry_contract_version::text || '|' ||
       coalesce(provider_credential_expires_at::text, 'NULL') || '|' ||
       coalesce(provider_expiry_observed_at::text, 'NULL') || '|' ||
       status || '|' || coalesce(outcome_code, 'NULL')
     FROM github_delivery_credential_grants
     WHERE id = 'github-grant-lifecycle-v12';\n`,
  )
  expect(
    fields.stdout.trim() === '0|NULL|NULL|issued|NULL',
    'V13 fabricated provider expiry proof for a legacy issued credential.',
  )

  const retained = await psql(
    FAILURE_DATABASE,
    `SELECT (
       to_jsonb(grant_record)
       - 'provider_expiry_contract_version'
       - 'provider_credential_expires_at'
       - 'provider_expiry_observed_at'
     )::text
     FROM github_delivery_credential_grants AS grant_record
     WHERE id = 'github-grant-lifecycle-v12';\n`,
  )
  expect(
    retained.stdout.trim() === snapshotBeforeV13,
    'V13 migration changed retained V12 credential fields.',
  )

  const expiryColumns = await psql(
    FAILURE_DATABASE,
    `SELECT string_agg(column_name, ',' ORDER BY column_name)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'github_delivery_credential_grants'
       AND column_name IN (
         'provider_expiry_contract_version',
         'provider_credential_expires_at',
         'provider_expiry_observed_at'
       );\n`,
  )
  expect(
    expiryColumns.stdout.trim() ===
      'provider_credential_expires_at,provider_expiry_contract_version,provider_expiry_observed_at',
    'V13 provider expiry column inventory was incomplete.',
  )

  const fabricatedConfirmation = await expectDockerFailure([
    'exec',
    '-i',
    postgresContainerName,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    postgresUser,
    '-d',
    FAILURE_DATABASE,
    '-Atq',
  ], {
    input: `UPDATE github_delivery_credential_grants
            SET status = 'expired', outcome_code = 'credential_provider_expiry_confirmed'
            WHERE id = 'github-grant-lifecycle-v12';\n`,
  })
  expect(
    /github_delivery_grants_provider_expiry_contract|check constraint/i.test(
      `${fabricatedConfirmation.result?.stdout ?? ''}${fabricatedConfirmation.result?.stderr ?? ''}`,
    ),
    'V13 did not fail closed on a fabricated legacy provider expiry confirmation.',
  )
}

async function assertLegacyPublicationAfterV15(snapshotBeforeV15) {
  const fields = await psql(
    FAILURE_DATABASE,
    `SELECT
       grant_id || '|' || coalesce(source_publication_id, 'NULL') || '|' ||
       status || '|' || reported_outcome_code || '|' || outcome_code
     FROM github_branch_publications
     WHERE id = 'github-publication-lifecycle-v14';\n`,
  )
  expect(
    fields.stdout.trim() ===
      'github-grant-lifecycle-v12|NULL|verified|pushed|branch_verified',
    'V15 did not preserve the legacy grant-backed publication authority.',
  )
  const retained = await psql(
    FAILURE_DATABASE,
    `SELECT (to_jsonb(publication) - 'source_publication_id')::text
     FROM github_branch_publications AS publication
     WHERE id = 'github-publication-lifecycle-v14';\n`,
  )
  expect(
    retained.stdout.trim() === snapshotBeforeV15,
    'V15 migration changed retained V14 publication fields.',
  )
  const publicationColumns = await psql(
    FAILURE_DATABASE,
    `SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'github_branch_publications'
       AND column_name = 'source_publication_id';\n`,
  )
  expect(
    publicationColumns.stdout.trim() === '1',
    'V15 source_publication_id column was missing.',
  )
  const invalidAuthority = await expectDockerFailure([
    'exec',
    '-i',
    postgresContainerName,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    postgresUser,
    '-d',
    FAILURE_DATABASE,
    '-Atq',
  ], {
    input: `UPDATE github_branch_publications
            SET grant_id = NULL, source_publication_id = NULL
            WHERE id = 'github-publication-lifecycle-v14';\n`,
  })
  expect(
    /github_branch_publications_authority_exactly_one|check constraint/i.test(
      `${invalidAuthority.result?.stdout ?? ''}${invalidAuthority.result?.stderr ?? ''}`,
    ),
    'V15 accepted a publication without exact grant or adoption authority.',
  )
}

function createCurrentSessionCookie() {
  const claims = {
    v: 1,
    authAccountId: 'acct-demo-u-erich',
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')
  return `devflow_session=${payload}.${signature}`
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('Unable to allocate the lifecycle API port.'))
      })
    })
  })
}

async function startV14Api(database) {
  const port = await findOpenPort()
  await runDocker([
    'run',
    '-d',
    '--name',
    rollbackApiContainerName,
    '--network',
    networkName,
    '-p',
    `127.0.0.1:${port}:4310`,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    '-e',
    'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS=15000',
    '-e',
    'DEVFLOW_DEPLOYMENT_PROFILE=pilot',
    '-e',
    'DEVFLOW_ENABLE_DEMO_DATA=false',
    '-e',
    'DEVFLOW_REQUIRE_AUTH=true',
    '-e',
    'DEV_AUTH_ENABLED=false',
    '-e',
    'DEVFLOW_ENABLE_FAKE_RUNTIME=false',
    '-e',
    `DEVFLOW_SESSION_SECRET=${sessionSecret}`,
    '-e',
    `DEVFLOW_AGENT_CREDENTIAL_KEY=${agentCredentialKey}`,
    '-e',
    'GITHUB_CLIENT_ID=lifecycle-smoke-client',
    '-e',
    'GITHUB_CLIENT_SECRET=lifecycle-smoke-secret-not-production',
    '-e',
    `GITHUB_OAUTH_REDIRECT_URI=http://127.0.0.1:${port}/api/auth/github/callback`,
    '-e',
    'DEVFLOW_WEB_APP_URL=http://127.0.0.1:4311',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=4310',
    v14Image,
    'node',
    'apps/api/dist/server.js',
  ])

  const apiUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/health`)
      if (response.ok) break
    } catch {
      // The exact V1.4 API is still starting.
    }
    if (attempt === 119) {
      const logs = await runDocker(['logs', rollbackApiContainerName])
      throw new Error(`Timed out waiting for the V1.4 API.\n${logs.stdout}${logs.stderr}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return apiUrl
}

async function expectV14ApiRejectsNewerSchema(database) {
  const apiUrl = await startV14Api(database)
  try {
    const readinessResponse = await fetch(`${apiUrl}/ready`)
    expect(
      readinessResponse.status === 503,
      `Exact V1.4 API did not fail closed on Team schema v21; received ${readinessResponse.status}.`,
    )
  } finally {
    await runDocker(['rm', '-f', rollbackApiContainerName])
  }
}

async function startV14ApiAgainstRestoredDatabase() {
  const apiUrl = await startV14Api(ROLLBACK_DATABASE)
  try {
    const readinessResponse = await fetch(`${apiUrl}/ready`)
    const readinessText = await readinessResponse.text()
    expect(
      readinessResponse.ok,
      `V1.4 restored API readiness failed with ${readinessResponse.status}: ${readinessText}`,
    )
    const readiness = JSON.parse(readinessText)
    expect(
      readiness.service === '@ai-devflow/api',
      'V1.4 restored API returned an unexpected readiness service.',
    )

    const overviewResponse = await fetch(`${apiUrl}/api/team/overview`, {
      headers: {
        accept: 'application/json',
        cookie: createCurrentSessionCookie(),
      },
    })
    const overviewText = await overviewResponse.text()
    expect(
      overviewResponse.ok,
      `V1.4 rollback overview failed with ${overviewResponse.status}: ${overviewText}`,
    )
    const overview = JSON.parse(overviewText)
    expect(
      overview.runs?.some((run) => run.title === 'V1.4 retained sentinel'),
      'V1.4 rollback overview did not retain the V1.4 sentinel.',
    )
  } finally {
    await runDocker(['rm', '-f', rollbackApiContainerName])
  }
}

async function startCurrentApiAgainstDatabase(database, expectedRunTitle) {
  const port = await findOpenPort()
  await runDocker([
    'run',
    '-d',
    '--name',
    currentApiContainerName,
    '--network',
    networkName,
    '-p',
    `127.0.0.1:${port}:4310`,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    '-e',
    'DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS=15000',
    '-e',
    'DEVFLOW_DEPLOYMENT_PROFILE=pilot',
    '-e',
    'DEVFLOW_REQUIRE_AUTH=true',
    '-e',
    'DEV_AUTH_ENABLED=false',
    '-e',
    'DEVFLOW_ENABLE_DEMO_DATA=false',
    '-e',
    'DEVFLOW_ENABLE_FAKE_RUNTIME=false',
    '-e',
    `DEVFLOW_SESSION_SECRET=${sessionSecret}`,
    '-e',
    `DEVFLOW_AGENT_CREDENTIAL_KEY=${agentCredentialKey}`,
    '-e',
    'GITHUB_CLIENT_ID=lifecycle-smoke-client',
    '-e',
    'GITHUB_CLIENT_SECRET=lifecycle-smoke-secret-not-production',
    '-e',
    `GITHUB_OAUTH_REDIRECT_URI=http://127.0.0.1:${port}/api/auth/github/callback`,
    '-e',
    'DEVFLOW_WEB_APP_URL=http://127.0.0.1:4311',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=4310',
    currentApiImage,
    'node',
    'server.js',
  ])

  const apiUrl = `http://127.0.0.1:${port}`
  try {
    let readiness
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const response = await fetch(`${apiUrl}/ready`)
        if (response.ok) {
          readiness = await response.json()
          break
        }
      } catch {
        // The current production API is still starting.
      }
      if (attempt === 119) {
        const logs = await runDocker(['logs', currentApiContainerName])
        throw new Error(
          `Timed out waiting for the current production API.\n${logs.stdout}${logs.stderr}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    expect(
      readiness?.status === 'ready' && readiness.service === '@ai-devflow/api',
      `Current production API readiness failed for ${database}.`,
    )

    if (expectedRunTitle) {
      const overviewResponse = await fetch(`${apiUrl}/api/team/overview`, {
        headers: {
          accept: 'application/json',
          cookie: createCurrentSessionCookie(),
        },
      })
      const overviewText = await overviewResponse.text()
      expect(
        overviewResponse.ok,
        `Current production API overview failed with ${overviewResponse.status}: ${overviewText}`,
      )
      const overview = JSON.parse(overviewText)
      expect(
        overview.runs?.some((run) => run.title === expectedRunTitle),
        'Current production API did not read the retained V1.4 sentinel.',
      )
    }
  } finally {
    await runDocker(['rm', '-f', currentApiContainerName])
  }
}

function isMissingDockerResource(error) {
  const output = `${error?.result?.stdout ?? ''}${error?.result?.stderr ?? ''}${error?.message ?? ''}`
  return /(?:no such (?:container|network|volume|image)|not found|does not exist)/i.test(
    output,
  )
}

let cleanupPromise

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    const errors = []
    for (const args of [
      ['rm', '-f', currentApiContainerName],
      ['rm', '-f', rollbackApiContainerName],
      ['rm', '-f', postgresContainerName],
      ['network', 'rm', networkName],
      ['volume', 'rm', volumeName],
      ['image', 'rm', '-f', currentApiImage],
      ['image', 'rm', '-f', v14Image],
    ]) {
      try {
        await runDocker(args)
      } catch (error) {
        if (!isMissingDockerResource(error)) errors.push(error)
      }
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Docker lifecycle smoke cleanup failed.')
    }
  })()
  return cleanupPromise
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cleanup()
      .catch((error) => {
        console.error(error)
      })
      .finally(() => process.exit(exitCode))
  })
}

let mainError
let completed = false
try {
  await verifyV14Tag()
  await buildImages()
  await runDocker(['network', 'create', networkName])
  await runDocker(['volume', 'create', volumeName])
  await startPostgres()

  for (const database of [FRESH_DATABASE, UPGRADE_DATABASE, FAILURE_DATABASE]) {
    await createDatabase(database)
  }

  await runCurrentMigration(FRESH_DATABASE)
  await expectSchemaVersion(FRESH_DATABASE, 21)
  await assertAgentRuntimeProjectionAfterV16(FRESH_DATABASE)
  await assertAgentMemoryProjectionAfterV17(FRESH_DATABASE)
  await assertAgentMemoryProjectionQualityAfterV18(FRESH_DATABASE)
  await assertAgentCoordinationProjectionAfterV19(FRESH_DATABASE)
  await assertLocalDevelopmentAuthAfterV20(FRESH_DATABASE)
  await assertNativeCodingEngineAfterV21(FRESH_DATABASE)
  await startCurrentApiAgainstDatabase(FRESH_DATABASE)

  await runV14Migration(UPGRADE_DATABASE)
  await seedV14(UPGRADE_DATABASE)
  await expectSchemaVersion(UPGRADE_DATABASE, 10)
  const sentinel = await psql(
    UPGRADE_DATABASE,
    "UPDATE workflow_runs SET title = 'V1.4 retained sentinel' WHERE id = (SELECT id FROM workflow_runs ORDER BY id LIMIT 1) RETURNING project_id;\n",
  )
  const sentinelProjectId = sentinel.stdout.trim()
  expect(sentinelProjectId.length > 0, 'The V1.4 seed did not provide a retained Run sentinel.')
  const snapshotBeforeV10Upgrade = await readV14RunSnapshot(UPGRADE_DATABASE)
  const v14Backup = await backupV14Database(UPGRADE_DATABASE)

  const snapshotBeforeFailedV12 = await prepareV11FailureFixture()

  await restartPostgresWithRetainedVolume()
  await runCurrentMigration(UPGRADE_DATABASE)
  await expectSchemaVersion(UPGRADE_DATABASE, 21)
  await assertAgentRuntimeProjectionAfterV16(UPGRADE_DATABASE)
  await assertAgentMemoryProjectionAfterV17(UPGRADE_DATABASE)
  await assertAgentMemoryProjectionQualityAfterV18(UPGRADE_DATABASE)
  await assertAgentCoordinationProjectionAfterV19(UPGRADE_DATABASE)
  await assertLocalDevelopmentAuthAfterV20(UPGRADE_DATABASE, {
    expectRetainedGitHubAccount: true,
  })
  await assertNativeCodingEngineAfterV21(UPGRADE_DATABASE)
  const snapshotAfterV15Upgrade = await readV14RunSnapshot(UPGRADE_DATABASE)
  expect(
    snapshotAfterV15Upgrade === snapshotBeforeV10Upgrade,
    'V1.5 upgrade changed the retained V1.4 Run row.',
  )
  const retained = await psql(
    UPGRADE_DATABASE,
    "SELECT count(*) FROM workflow_runs WHERE title = 'V1.4 retained sentinel';\n",
  )
  expect(retained.stdout.trim() === '1', 'V1.5 upgrade did not retain the V1.4 sentinel.')
  await startCurrentApiAgainstDatabase(
    UPGRADE_DATABASE,
    'V1.4 retained sentinel',
  )
  await expectV14ApiRejectsNewerSchema(UPGRADE_DATABASE)
  await restoreV14Database(v14Backup)
  await expectSchemaVersion(ROLLBACK_DATABASE, 10)
  await startV14ApiAgainstRestoredDatabase()

  const failedMigration = await expectDockerFailure(
    currentMigrationArgs(FAILURE_DATABASE),
  )
  expect(
    /github_delivery_requests_delivery_series_shape|check constraint/i.test(
      `${failedMigration.result?.stdout ?? ''}${failedMigration.result?.stderr ?? ''}`,
    ),
    'The v11 to v12 failure did not stop at the expected delivery-series constraint.',
  )
  await expectSchemaVersion(FAILURE_DATABASE, 11)
  await expectColumnMissing(
    FAILURE_DATABASE,
    'github_delivery_requests',
    'delivery_series_key',
  )
  await expectColumnMissing(
    FAILURE_DATABASE,
    'github_delivery_requests',
    'delivery_attempt',
  )
  await expectMigrationHistoryMissing(FAILURE_DATABASE, 12)
  const snapshotAfterFailedV12 = await readV11DeliverySnapshot(FAILURE_DATABASE)
  expect(
    snapshotAfterFailedV12 === snapshotBeforeFailedV12,
    'Failed V12 migration changed the populated V11 delivery row.',
  )
  await psql(
    FAILURE_DATABASE,
    `UPDATE github_delivery_requests
     SET logical_idempotency_key = 'github-delivery:' || repeat('9', 64)
     WHERE id = 'github-delivery-lifecycle-v11';\n`,
  )
  const snapshotBeforeV12Retry = await readV11DeliverySnapshot(FAILURE_DATABASE)
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0012_github_delivery_attempts.sql',
    12,
    '0012_github_delivery_attempts',
  )
  await expectSchemaVersion(FAILURE_DATABASE, 12)
  await assertRetainedV11DeliveryAfterV12(snapshotBeforeV12Retry)
  await expectColumnMissing(
    FAILURE_DATABASE,
    'github_delivery_credential_grants',
    'provider_expiry_contract_version',
  )
  await expectColumnMissing(
    FAILURE_DATABASE,
    'github_delivery_credential_grants',
    'provider_credential_expires_at',
  )
  await expectColumnMissing(
    FAILURE_DATABASE,
    'github_delivery_credential_grants',
    'provider_expiry_observed_at',
  )
  await expectMigrationHistoryMissing(FAILURE_DATABASE, 13)
  const retainedV14Fixture = await prepareV12LegacyIssuedCredentialFixture()
  await runCurrentMigration(FAILURE_DATABASE)
  await expectSchemaVersion(FAILURE_DATABASE, 21)
  await assertAgentRuntimeProjectionAfterV16(FAILURE_DATABASE)
  await assertAgentMemoryProjectionAfterV17(FAILURE_DATABASE)
  await assertAgentMemoryProjectionQualityAfterV18(FAILURE_DATABASE)
  await assertAgentCoordinationProjectionAfterV19(FAILURE_DATABASE)
  await assertLocalDevelopmentAuthAfterV20(FAILURE_DATABASE)
  await assertNativeCodingEngineAfterV21(FAILURE_DATABASE)
  await assertLegacyIssuedCredentialAfterV13(retainedV14Fixture.snapshotBeforeV13)
  await assertLegacyPublicationAfterV15(retainedV14Fixture.snapshotBeforeV15)
  await startCurrentApiAgainstDatabase(FAILURE_DATABASE)

  completed = true
} catch (error) {
  mainError = error
}

let cleanupError
try {
  await cleanup()
} catch (error) {
  cleanupError = error
}

if (mainError && cleanupError) {
  throw new AggregateError(
    [mainError, cleanupError],
    'Docker lifecycle smoke and cleanup both failed.',
  )
}
if (mainError) throw mainError
if (cleanupError) throw cleanupError
if (completed) {
  console.log(
    'Docker lifecycle smoke passed: fresh v21, retained V1.4 schema v10 upgrade, exact populated v11-to-v12 transactional retry, fail-closed v12-to-v13 provider expiry migration, durable v13-to-v14 provider backoff, exact v14-to-v15 verified publication adoption, v15-to-v16 metadata-only Agent Runtime projection, empty v16-to-v17 metadata-only Agent Memory projection, v17-to-v18 independent Memory quality audit versioning, v18-to-v19 metadata-only Agent Coordination projection, v19-to-v20 bounded local-development auth provider constraint, v20-to-v21 native Coding summary engine constraint, and bounded V1.4 backup/restore rollback.',
  )
}
