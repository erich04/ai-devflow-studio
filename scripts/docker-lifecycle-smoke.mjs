import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V13_TAG = 'v1.3.0'
const V13_COMMIT = '06f3cc321300e3751aaa41c67f66d70cfaf6ebe4'
const FRESH_DATABASE = 'devflow_fresh'
const UPGRADE_DATABASE = 'devflow_upgrade'
const FAILURE_DATABASE = 'devflow_failed_upgrade'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-lifecycle-smoke-'))
const uniqueSuffix = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`
const networkName = `devflow-lifecycle-network-${uniqueSuffix}`
const volumeName = `devflow-lifecycle-postgres-${uniqueSuffix}`
const postgresContainerName = `devflow-lifecycle-postgres-${uniqueSuffix}`
const rollbackApiContainerName = `devflow-lifecycle-v13-api-${uniqueSuffix}`
const currentApiContainerName = `devflow-lifecycle-current-api-${uniqueSuffix}`
const currentApiImage = `devflow-lifecycle-current-api:${uniqueSuffix}`
const v13Image = `devflow-lifecycle-v13:${uniqueSuffix}`
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

async function expectDockerFailure(args) {
  try {
    await runDocker(args)
  } catch (error) {
    return error
  }
  throw new Error(`Expected docker ${args.join(' ')} to fail.`)
}

function databaseUrl(database) {
  return `postgresql://${postgresUser}:${postgresPassword}@postgres:5432/${database}`
}

async function verifyV13Tag() {
  const objectType = await execute('git', ['cat-file', '-t', V13_TAG])
  expect(
    objectType.stdout.trim() === 'tag',
    `${V13_TAG} is not an annotated tag object.`,
  )
  const resolved = await execute('git', ['rev-parse', `${V13_TAG}^{}`])
  expect(
    resolved.stdout.trim() === V13_COMMIT,
    `${V13_TAG} resolved to ${resolved.stdout.trim() || 'nothing'}, expected ${V13_COMMIT}.`,
  )
}

async function assertV13BuildContextSafe(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (
      entry.name === '__tests__' ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      throw new Error(
        `Refusing to send a V1.3 test path to the Docker build context: ${relativePath}`,
      )
    }
    if (entry.isDirectory()) {
      await assertV13BuildContextSafe(root, relativePath)
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
          `Refusing a UUID-shaped literal in the V1.3 production build context: ${relativePath}`,
        )
      }
    }
  }
}

async function buildImages() {
  const archivePath = path.join(temporaryRoot, 'v1.3.0.tar')
  const v13Source = path.join(temporaryRoot, 'v1.3.0')
  await mkdir(v13Source, { recursive: true })
  await execute('git', [
    'archive', '--format=tar', `--output=${archivePath}`, V13_COMMIT, '--',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    'packages/shared', 'apps/api',
    ':(exclude,glob)**/*.test.ts',
    ':(exclude,glob)**/*.test.tsx',
    ':(exclude,glob)**/*.spec.ts',
    ':(exclude,glob)**/*.spec.tsx',
    ':(exclude,glob)**/__tests__/**',
  ])
  await execute('tar', ['-xf', archivePath, '-C', v13Source])
  await assertV13BuildContextSafe(v13Source)
  const v13Dockerfile = path.join(v13Source, 'lifecycle.Dockerfile')
  await writeFile(
    v13Dockerfile,
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
    ['build', '--file', v13Dockerfile, '--tag', v13Image, v13Source],
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

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await runDocker([
      'inspect',
      '--format',
      '{{.State.Health.Status}}',
      postgresContainerName,
    ])
    if (state.stdout.trim() === 'healthy') return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for lifecycle Postgres health.')
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

async function runV13Migration(database) {
  await runDocker([
    'run',
    '--rm',
    '--network',
    networkName,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    v13Image,
    'corepack',
    'pnpm',
    '--filter',
    '@ai-devflow/api',
    'db:migrate',
  ])
}

async function seedV13(database) {
  await runDocker([
    'run',
    '--rm',
    '--network',
    networkName,
    '-e',
    `DEVFLOW_DATABASE_URL=${databaseUrl(database)}`,
    '-e',
    'DEVFLOW_ENABLE_DEMO_DATA=true',
    v13Image,
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

async function expectColumnMissing(database, table, column) {
  const result = await psql(
    database,
    `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}';\n`,
  )
  expect(
    result.stdout.trim() === '0',
    `${database}.${table}.${column} remained after the failed transactional migration.`,
  )
}

async function applyHistoricalMigration(database, fileName, version) {
  const sql = await readFile(
    path.join(repositoryRoot, 'apps', 'api', 'src', 'db', 'migrations', fileName),
    'utf8',
  )
  await psql(database, `${sql}\nUPDATE schema_meta SET value = '${version}' WHERE key = 'schema_version';\n`)
}

function createV13SessionCookie(projectId) {
  const session = {
    source: 'authenticated',
    organizationId: 'org-demo',
    userId: 'u-erich',
    role: 'owner',
    authAccountId: 'acct-demo-u-erich',
    projectMemberships: [{ projectId, userId: 'u-erich', role: 'owner' }],
  }
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')
  return `devflow_session=${payload}.${signature}`
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
        reject(new Error('Unable to allocate the V1.3 rollback API port.'))
      })
    })
  })
}

async function startV13ApiAgainstUpgradedDatabase(projectId) {
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
    `DEVFLOW_DATABASE_URL=${databaseUrl(UPGRADE_DATABASE)}`,
    '-e',
    'DEVFLOW_ENABLE_DEMO_DATA=false',
    '-e',
    'DEVFLOW_REQUIRE_AUTH=true',
    '-e',
    'DEV_AUTH_ENABLED=false',
    '-e',
    `DEVFLOW_SESSION_SECRET=${sessionSecret}`,
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=4310',
    v13Image,
    'node',
    'apps/api/dist/server.js',
  ])

  const apiUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/health`)
      if (response.ok) break
    } catch {
      // The exact V1.3 API is still starting.
    }
    if (attempt === 119) {
      const logs = await runDocker(['logs', rollbackApiContainerName])
      throw new Error(`Timed out waiting for the V1.3 rollback API.\n${logs.stdout}${logs.stderr}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  const overviewResponse = await fetch(`${apiUrl}/api/team/overview`, {
    headers: {
      accept: 'application/json',
      cookie: createV13SessionCookie(projectId),
    },
  })
  const overviewText = await overviewResponse.text()
  expect(
    overviewResponse.ok,
    `V1.3 rollback overview failed with ${overviewResponse.status}: ${overviewText}`,
  )
  const overview = JSON.parse(overviewText)
  expect(
    overview.runs?.some((run) => run.title === 'V1.3 retained sentinel'),
    'V1.3 rollback overview did not retain the V1.3 sentinel.',
  )
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
        'Current production API did not read the retained V1.3 sentinel.',
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
      ['image', 'rm', '-f', v13Image],
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
  await verifyV13Tag()
  await buildImages()
  await runDocker(['network', 'create', networkName])
  await runDocker(['volume', 'create', volumeName])
  await startPostgres()

  for (const database of [FRESH_DATABASE, UPGRADE_DATABASE, FAILURE_DATABASE]) {
    await createDatabase(database)
  }

  await runCurrentMigration(FRESH_DATABASE)
  await expectSchemaVersion(FRESH_DATABASE, 10)

  await runV13Migration(UPGRADE_DATABASE)
  await seedV13(UPGRADE_DATABASE)
  await expectSchemaVersion(UPGRADE_DATABASE, 7)
  const sentinel = await psql(
    UPGRADE_DATABASE,
    "UPDATE workflow_runs SET title = 'V1.3 retained sentinel' WHERE id = (SELECT id FROM workflow_runs ORDER BY id LIMIT 1) RETURNING project_id;\n",
  )
  const sentinelProjectId = sentinel.stdout.trim()
  expect(sentinelProjectId.length > 0, 'The V1.3 seed did not provide a retained Run sentinel.')

  await runV13Migration(FAILURE_DATABASE)
  await seedV13(FAILURE_DATABASE)
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0008_v14_work_authority.sql',
    8,
  )
  await applyHistoricalMigration(
    FAILURE_DATABASE,
    '0009_harden_work_request_timeline.sql',
    9,
  )
  await psql(
    FAILURE_DATABASE,
    `
      INSERT INTO gate_commands (
        id, organization_id, project_id, work_request_id, run_id, node_id,
        action, workflow_command, reason, requested_by_user_id, requested_role,
        auth_kind, auth_token_record_id, idempotency_key, request_fingerprint,
        expected_run_version, expected_policy_version, expected_blocker_ids,
        evaluation_status, evaluation_blocker_ids, status, outcome_code,
        expires_at, created_at, updated_at
      ) VALUES (
        'gate-lifecycle-invalid-auth', 'org-demo', 'p-payments', NULL,
        'run-lifecycle-invalid-auth', 'n-design-gate', 'reject', NULL,
        'V1.4 lifecycle failed-upgrade sentinel', 'u-erich', 'owner',
        'development_header', NULL, 'gate:lifecycle:invalid-auth', repeat('a', 64),
        1, 1, '[]'::jsonb, 'allowed', '[]'::jsonb, 'pending', NULL,
        now() + interval '10 minutes', now(), now()
      );
    `,
  )
  await expectSchemaVersion(FAILURE_DATABASE, 9)

  await restartPostgresWithRetainedVolume()
  await runCurrentMigration(UPGRADE_DATABASE)
  await expectSchemaVersion(UPGRADE_DATABASE, 10)
  const retained = await psql(
    UPGRADE_DATABASE,
    "SELECT count(*) FROM workflow_runs WHERE title = 'V1.3 retained sentinel';\n",
  )
  expect(retained.stdout.trim() === '1', 'V1.4 upgrade did not retain the V1.3 sentinel.')
  await startCurrentApiAgainstDatabase(
    UPGRADE_DATABASE,
    'V1.3 retained sentinel',
  )

  const failedMigration = await expectDockerFailure(currentMigrationArgs(FAILURE_DATABASE))
  expect(
    /gate_commands_browser_write_auth|check constraint/i.test(
      `${failedMigration.result?.stdout ?? ''}${failedMigration.result?.stderr ?? ''}`,
    ),
    'The v9 to v10 failure did not stop at the expected Gate authority constraint.',
  )
  await expectSchemaVersion(FAILURE_DATABASE, 9)
  await expectColumnMissing(FAILURE_DATABASE, 'gate_commands', 'version')
  await psql(
    FAILURE_DATABASE,
    `UPDATE gate_commands SET auth_kind = 'session_cookie' WHERE id = 'gate-lifecycle-invalid-auth';\n`,
  )
  await runCurrentMigration(FAILURE_DATABASE)
  await expectSchemaVersion(FAILURE_DATABASE, 10)
  await startCurrentApiAgainstDatabase(FAILURE_DATABASE)

  await startV13ApiAgainstUpgradedDatabase(sentinelProjectId)

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
    'Docker lifecycle smoke passed: fresh v10, retained V1.3-to-V1.4 upgrade, transactional failed-upgrade recovery, and bounded V1.3 API rollback read.',
  )
}
