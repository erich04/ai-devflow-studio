import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { Pool } = requireFromApi('pg')
const apiUrl = 'http://127.0.0.1:4322'
const databaseUrl = process.env.DEVFLOW_DATABASE_URL ?? process.env.DATABASE_URL
const sessionSecret = 'devflow-postgres-smoke-hmac-key-non-production-32-plus'
const pilotSessionCookie = createSessionCookieValue('acct-demo-u-erich', sessionSecret)
const pilotSessionHeaders = {
  cookie: pilotSessionCookie,
}
const ownerSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
}
const memberSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-yu',
  'x-devflow-user-role': 'member',
  'x-devflow-project-roles': 'p-payments:member',
}
const leadSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-ling',
  'x-devflow-user-role': 'lead',
  'x-devflow-project-roles': 'p-payments:lead',
}
const independentLeadSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:lead',
}

if (!databaseUrl) {
  throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running test:postgres-smoke.')
}

function createSessionCookieValue(authAccountId, secret) {
  const claims = {
    v: 1,
    authAccountId,
    expiresAt: Math.floor(Date.now() / 1_000) + 8 * 60 * 60,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `devflow_session=${payload}.${signature}`
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
      }
    })
  })
}

function spawnService(name, args, env = {}) {
  const child = spawn(corepack, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.devflowStopping = false
  const writeServiceOutput = (stream, chunk) => {
    const text = chunk.toString()
    const expectedShutdownNoise =
      child.devflowStopping &&
      (text.includes('ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL') || text.includes('Exit status 143'))
    if (!expectedShutdownNoise) {
      stream.write(`[${name}] ${text}`)
    }
  }

  child.stdout.on('data', (chunk) => {
    writeServiceOutput(process.stdout, chunk)
  })
  child.stderr.on('data', (chunk) => {
    writeServiceOutput(process.stderr, chunk)
  })

  return child
}

function sendServiceSignal(child, signal) {
  if (!child?.pid) {
    return
  }

  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // Fall back to signaling the wrapper process below.
  }

  try {
    child.kill(signal)
  } catch {
    // The process may already be gone.
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.devflowStopping = true
  await new Promise((resolve) => {
    let settled = false
    let forceTimer
    let finalTimer
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(forceTimer)
      clearTimeout(finalTimer)
      resolve()
    }

    child.once('exit', finish)
    sendServiceSignal(child, 'SIGTERM')
    forceTimer = setTimeout(() => {
      sendServiceSignal(child, 'SIGKILL')
    }, 3_000)
    finalTimer = setTimeout(finish, 8_000)
  })
}

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

function jsonHeaders(sessionHeaders) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...sessionHeaders,
  }
}

async function postJson(pathname, body, sessionHeaders = ownerSessionHeaders) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'POST',
      headers: jsonHeaders(sessionHeaders),
      body: JSON.stringify(body),
    }),
    pathname,
  )
}

async function postJsonWithoutSession(pathname, body) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    pathname,
  )
}

async function postJsonWithBearer(pathname, body, token) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    pathname,
  )
}

async function postJsonResult(pathname, body, headers) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: 'POST',
    headers: jsonHeaders(headers),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed }
}

async function getJson(pathname, sessionHeaders) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      headers: { accept: 'application/json', ...sessionHeaders },
    }),
    pathname,
  )
}

async function getJsonWithBearer(pathname, token) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    }),
    pathname,
  )
}

async function putJson(pathname, body, sessionHeaders = ownerSessionHeaders) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'PUT',
      headers: jsonHeaders(sessionHeaders),
      body: JSON.stringify({ organizationPolicy: body }),
    }),
    pathname,
  )
}

async function putJsonBody(pathname, body, sessionHeaders) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'PUT',
      headers: jsonHeaders(sessionHeaders),
      body: JSON.stringify(body),
    }),
    pathname,
  )
}

async function expectPostRejected(pathname, body, sessionHeaders, expectedStatus, label) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: 'POST',
    headers: jsonHeaders(sessionHeaders),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  expect(
    response.status === expectedStatus,
    `${label} expected ${expectedStatus}, received ${response.status}: ${text}`,
  )
  return text
}

async function fetchOverview(label = '/api/team/overview', sessionHeaders = ownerSessionHeaders) {
  return readJson(
    await fetch(`${apiUrl}/api/team/overview`, {
      headers: { accept: 'application/json', ...sessionHeaders },
    }),
    label,
  )
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function migrationChecksum(sql) {
  return sha256Hex(sql.replace(/\r\n/g, '\n'))
}

function createRedactedGitHubDeliveryIntent({ binding, runId, nodeId, now }) {
  const deliverySeriesKey = `github-delivery:${sha256Hex(
    JSON.stringify({
      organizationId: 'org-demo',
      teamProjectId: 'p-payments',
      localProjectId: `local-project-${runId}`,
      runId,
      nodeId,
      repositoryBindingId: binding.id,
      repositoryBindingVersion: binding.version,
      workspaceId: `workspace-${runId}`,
    }),
  )}`
  const deliveryAttempt = 1
  const material = {
    stateVersion: 1,
    organizationId: 'org-demo',
    teamProjectId: 'p-payments',
    localProjectId: `local-project-${runId}`,
    runId,
    runVersion: 3,
    nodeId,
    repositoryBindingId: binding.id,
    repositoryBindingVersion: binding.version,
    installationId: binding.installationId,
    repositoryId: binding.repositoryId,
    codingRunId: `coding-${runId}`,
    codingRunCompletedAt: now,
    workspaceId: `workspace-${runId}`,
    deliverySeriesKey,
    deliveryAttempt,
    repository: binding.repository,
    baseBranch: binding.defaultBranch,
    headBranch: `devflow/${runId}`,
    baseCommitSha: 'a'.repeat(40),
    expectedCommitSha: 'b'.repeat(40),
    diffArtifactId: `diff-${runId}`,
    diffSourceDigest: 'c'.repeat(64),
    testEvidenceId: `test-${runId}`,
    testEvidenceCreatedAt: now,
    testEvidenceDigest: 'd'.repeat(64),
    prPackageArtifactId: `package-${runId}`,
    prPackageUpdatedAt: now,
    prPackageDigest: 'e'.repeat(64),
    changedPaths: ['apps/api/src/github-delivery-smoke.ts'],
  }
  const intentDigest = sha256Hex(JSON.stringify(material))
  const idempotencyKey = `github-delivery:${sha256Hex(
    JSON.stringify({ deliverySeriesKey, deliveryAttempt }),
  )}`
  return {
    id: `intent-${runId}`,
    ...material,
    intentDigest,
    idempotencyKey,
    status: 'approval_required',
    createdAt: now,
    updatedAt: now,
    redacted: true,
  }
}

async function prepareRetainedV12CredentialFixture() {
  const migrations = [
    { version: 7, name: '0001_initial', fileName: '0001_initial.sql' },
    {
      version: 8,
      name: '0008_v14_work_authority',
      fileName: '0008_v14_work_authority.sql',
    },
    {
      version: 9,
      name: '0009_harden_work_request_timeline',
      fileName: '0009_harden_work_request_timeline.sql',
    },
    {
      version: 10,
      name: '0010_harden_gate_command_delivery',
      fileName: '0010_harden_gate_command_delivery.sql',
    },
    {
      version: 11,
      name: '0011_github_delivery',
      fileName: '0011_github_delivery.sql',
    },
  ]
  const loadedMigrations = await Promise.all(
    migrations.map(async (migration) => ({
      ...migration,
      sql: await readFile(
        new URL(
          `../apps/api/src/db/migrations/${migration.fileName}`,
          import.meta.url,
        ),
        'utf8',
      ),
    })),
  )
  const migrationV12 = {
    version: 12,
    name: '0012_github_delivery_attempts',
    sql: await readFile(
      new URL(
        '../apps/api/src/db/migrations/0012_github_delivery_attempts.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  }
  const laterMigrations = await Promise.all([
    {
      version: 13,
      name: '0013_github_credential_provider_expiry',
      fileName: '0013_github_credential_provider_expiry.sql',
    },
    {
      version: 14,
      name: '0014_github_pull_request_retry_after',
      fileName: '0014_github_pull_request_retry_after.sql',
    },
  ].map(async (migration) => ({
    ...migration,
    sql: await readFile(
      new URL(
        `../apps/api/src/db/migrations/${migration.fileName}`,
        import.meta.url,
      ),
      'utf8',
    ),
  })))
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-v12-fixture',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  let transactionOpen = false
  const retainedRequestId = 'github-delivery-retained-v12'
  const retainedApprovalId = 'github-delivery-approval-retained-v12'
  const retainedGrantId = 'github-delivery-grant-retained-v12'
  const retainedLogicalKey = `github-delivery:${'1'.repeat(64)}`

  try {
    const state = await connection.query(`
      SELECT
        to_regclass('public.schema_meta')::text AS schema_meta_table,
        to_regclass('public.team_schema_migrations')::text AS migration_history_table
    `)
    expect(
      state.rows[0]?.schema_meta_table === null &&
        state.rows[0]?.migration_history_table === null,
      'Postgres GitHub Delivery smoke requires a fresh empty database.',
    )

    for (const migration of loadedMigrations) {
      if (migration.version === 7) {
        await connection.query(migration.sql)
        await connection.query(`
          CREATE TABLE team_schema_migrations (
            version integer PRIMARY KEY,
            name text NOT NULL,
            checksum text NOT NULL,
            adopted boolean NOT NULL DEFAULT false,
            applied_at timestamptz NOT NULL DEFAULT now()
          )
        `)
      } else {
        await connection.query('BEGIN')
        transactionOpen = true
        await connection.query(migration.sql)
        await connection.query(
          `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
           ON CONFLICT (key) DO UPDATE
           SET value = excluded.value, updated_at = now()`,
          [String(migration.version)],
        )
      }

      await connection.query(
        `INSERT INTO team_schema_migrations (version, name, checksum, adopted)
         VALUES ($1, $2, $3, false)`,
        [migration.version, migration.name, migrationChecksum(migration.sql)],
      )
      if (transactionOpen) {
        await connection.query('COMMIT')
        transactionOpen = false
      }
    }

    const schemaVersion = await connection.query(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    )
    expect(
      schemaVersion.rows[0]?.value === '11',
      'Retained-data fixture did not stop at Team schema v11 before population.',
    )

    const createdAt = new Date(Date.now() - 60_000).toISOString()
    const expiresAt = new Date(Date.parse(createdAt) + 23 * 60 * 60 * 1_000).toISOString()
    const credentialExpiresAt = new Date(
      Date.parse(createdAt) + 30 * 60 * 1_000,
    ).toISOString()
    await connection.query('BEGIN')
    transactionOpen = true
    await connection.query(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES ('org-retained-v11', 'Retained V11', 'retained-v11', $1, $1)`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO users (
         id, organization_id, name, email, avatar_url, role, avatar_initials,
         focus, created_at, updated_at
       ) VALUES (
         'user-retained-v11', 'org-retained-v11', 'Retained Owner',
         'retained-v11@example.invalid', NULL, 'owner', 'RO',
         'Migration retention', $1, $1
       )`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO projects (
         id, organization_id, name, slug, description, repository,
         default_branch, health, knowledge_base_path, test_command,
         created_at, updated_at
       ) VALUES (
         'project-retained-v11', 'org-retained-v11', 'Retained V11 Project',
         'retained-v11-project', 'Migration retention fixture',
         'example/retained-v11', 'main', 'on_track', 'docs/knowledge',
         'pnpm test', $1, $1
       )`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO desktop_tokens (
         id, organization_id, project_id, user_id, token_hash, created_at
       ) VALUES (
         'desktop-token-retained-v11', 'org-retained-v11',
         'project-retained-v11', 'user-retained-v11',
         'sha256:retained-v11-token-metadata', $1
       )`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO workflow_runs (
         id, run_version, organization_id, project_id, creator_id, data_origin,
         title, request, status, current_node_id, branch_name, created_at, updated_at
       ) VALUES (
         'run-retained-v11', 3, 'org-retained-v11', 'project-retained-v11',
         'user-retained-v11', 'remote', 'Retained V11 Run',
         'Retain this delivery through v12.', 'failed',
         'run-retained-v11:node-pr', 'devflow/retained-v11', $1, $1
       )`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO github_repository_bindings (
         id, version, organization_id, project_id, installation_id,
         repository_id, full_name, default_branch, status,
         configured_by_user_id, updated_by_user_id, validated_at,
         revoked_at, created_at, updated_at
       ) VALUES (
         'github-binding-retained-v11', 1, 'org-retained-v11',
         'project-retained-v11', '12345', '98765', 'example/retained-v11',
         'main', 'active', 'user-retained-v11', 'user-retained-v11',
         $1, NULL, $1, $1
       )`,
      [createdAt],
    )
    await connection.query(
      `INSERT INTO github_delivery_requests (
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
         $1, 7, 2, 'org-retained-v11', 'project-retained-v11',
         'user-retained-v11', 'desktop-token-retained-v11',
         'local-intent-retained-v11', 'local-project-retained-v11',
         'run-retained-v11', 3, 'node-pr', 'github-binding-retained-v11',
         1, '12345', '98765', 'example/retained-v11',
         'coding-run-retained-v11', 'workspace-retained-v11',
         'diff-retained-v11', 'test-evidence-retained-v11',
         'pr-package-retained-v11', 'failed', 'pull_request_failed', 3,
         'main', 'devflow/retained-v11', $2, $3, $4, $5, $6, $7, $8,
         '["src/retained-v11.ts"]'::jsonb,
         'Retained V11 delivery', 'Retained redacted delivery body.',
         $9, $10, $10
       )`,
      [
        retainedRequestId,
        'a'.repeat(40),
        'b'.repeat(40),
        '2'.repeat(64),
        retainedLogicalKey,
        '3'.repeat(64),
        '4'.repeat(64),
        '5'.repeat(64),
        expiresAt,
        createdAt,
      ],
    )
    await connection.query(
      `INSERT INTO github_delivery_approvals (
         id, request_id, intent_revision, request_state_version, intent_digest,
         binding_id, binding_version, run_id, run_version, node_id,
         repository_id, base_branch, head_branch, expected_commit_sha,
         test_evidence_digest, package_digest, approved_by_user_id,
         approved_role, auth_kind, approved_at
       ) VALUES (
         $1, $2, 2, 7, $3, 'github-binding-retained-v11', 1,
         'run-retained-v11', 3, 'node-pr', '98765', 'main',
         'devflow/retained-v11', $4, $5, $6, 'user-retained-v11',
         'owner', 'session_cookie', $7
       )`,
      [
        retainedApprovalId,
        retainedRequestId,
        '2'.repeat(64),
        'b'.repeat(40),
        '4'.repeat(64),
        '5'.repeat(64),
        createdAt,
      ],
    )
    await connection.query(
      `INSERT INTO github_delivery_credential_grants (
         id, version, request_id, intent_revision, approval_id, attempt,
         issued_to_token_id, repository_id, permission, repository_count,
         status, requested_at, issued_at, credential_expires_at,
         consumed_at, outcome_code
       ) VALUES (
         $1, 2, $2, 2, $3, 1, 'desktop-token-retained-v11', '98765',
         'contents:write', 1, 'issued', $4, $4, $5, NULL, NULL
       )`,
      [
        retainedGrantId,
        retainedRequestId,
        retainedApprovalId,
        createdAt,
        credentialExpiresAt,
      ],
    )
    await connection.query('COMMIT')
    transactionOpen = false

    const retainedRequest = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_delivery_requests AS retained
       WHERE id = $1`,
      [retainedRequestId],
    )
    const snapshotBeforeV12 = retainedRequest.rows[0]?.snapshot
    expect(snapshotBeforeV12, 'Populated v11 GitHub Delivery row was not retained.')

    await connection.query('BEGIN')
    transactionOpen = true
    await connection.query(migrationV12.sql)
    await connection.query(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE
       SET value = excluded.value, updated_at = now()`,
      [String(migrationV12.version)],
    )
    await connection.query(
      `INSERT INTO team_schema_migrations (version, name, checksum, adopted)
       VALUES ($1, $2, $3, false)`,
      [
        migrationV12.version,
        migrationV12.name,
        migrationChecksum(migrationV12.sql),
      ],
    )
    await connection.query('COMMIT')
    transactionOpen = false

    const schemaV12 = await connection.query(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    )
    expect(
      schemaV12.rows[0]?.value === '12',
      'Retained-data fixture did not stop at Team schema v12 before the current migrator.',
    )
    const migratedRequest = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_delivery_requests AS retained
       WHERE id = $1`,
      [retainedRequestId],
    )
    const migratedRequestRow = migratedRequest.rows[0]?.snapshot
    expect(
      migratedRequestRow?.delivery_series_key === retainedLogicalKey &&
        migratedRequestRow?.delivery_attempt === 1,
      'V12 did not backfill delivery series identity from the v11 logical key.',
    )
    const retainedRowWithoutV12Fields = { ...migratedRequestRow }
    delete retainedRowWithoutV12Fields.delivery_series_key
    delete retainedRowWithoutV12Fields.delivery_attempt
    expect(
      stableJson(retainedRowWithoutV12Fields) === stableJson(snapshotBeforeV12),
      'V12 migration changed retained v11 GitHub Delivery fields.',
    )

    await connection.query('BEGIN')
    transactionOpen = true
    let seriesUniquenessError
    try {
      await connection.query(
        `INSERT INTO github_delivery_requests
         SELECT (
           jsonb_populate_record(
             NULL::github_delivery_requests,
             to_jsonb(source) || jsonb_build_object(
               'id', 'github-delivery-retained-v12-duplicate',
               'logical_idempotency_key', $2::text
             )
           )
         ).*
         FROM github_delivery_requests AS source
         WHERE source.id = $1`,
        [retainedRequestId, `github-delivery:${'9'.repeat(64)}`],
      )
    } catch (error) {
      seriesUniquenessError = error
    }
    expect(
      seriesUniquenessError?.code === '23505' &&
        seriesUniquenessError?.constraint ===
          'github_delivery_requests_series_attempt_unique',
      'V12 did not enforce unique deliverySeriesKey/deliveryAttempt identity.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false

    const retainedGrant = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_delivery_credential_grants AS retained
       WHERE id = $1`,
      [retainedGrantId],
    )
    const snapshotBeforeV13 = retainedGrant.rows[0]?.snapshot
    expect(snapshotBeforeV13, 'Populated v12 legacy issued credential was not retained.')
    for (const migration of laterMigrations) {
      await connection.query('BEGIN')
      transactionOpen = true
      await connection.query(migration.sql)
      await connection.query(
        `UPDATE schema_meta SET value = $1, updated_at = now()
         WHERE key = 'schema_version'`,
        [String(migration.version)],
      )
      await connection.query(
        `INSERT INTO team_schema_migrations (version, name, checksum, adopted)
         VALUES ($1, $2, $3, false)`,
        [migration.version, migration.name, migrationChecksum(migration.sql)],
      )
      await connection.query('COMMIT')
      transactionOpen = false
    }
    const retainedPublicationId = 'github-publication-retained-v14'
    await connection.query(
      `INSERT INTO github_branch_publications (
         id, version, request_id, intent_revision, grant_id, status,
         reported_outcome_code, verified_head_sha, reported_at, verified_at,
         outcome_code
       ) VALUES (
         $1, 2, $2, 2, $3, 'verified', 'pushed', repeat('b', 40),
         $4, $4, 'branch_verified'
       )`,
      [retainedPublicationId, retainedRequestId, retainedGrantId, createdAt],
    )
    const retainedPublication = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_branch_publications AS retained
       WHERE id = $1`,
      [retainedPublicationId],
    )
    const snapshotBeforeV15 = retainedPublication.rows[0]?.snapshot
    expect(snapshotBeforeV15, 'Populated v14 branch publication was not retained.')
    return {
      retainedRequestId,
      retainedGrantId,
      retainedPublicationId,
      retainedLogicalKey,
      snapshotBeforeV12,
      snapshotBeforeV13,
      snapshotBeforeV15,
    }
  } catch (error) {
    if (transactionOpen) {
      await connection.query('ROLLBACK').catch(() => undefined)
    }
    throw error
  } finally {
    connection.release()
    await pool.end()
  }
}

async function assertRetainedV12CredentialAfterCurrentMigration(fixture) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-v19-assertion',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  let transactionOpen = false
  try {
    const schemaVersion = await connection.query(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    )
    expect(
      schemaVersion.rows[0]?.value === '19',
      'Team database did not migrate the retained fixture to schema v19.',
    )
    const retained = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_delivery_credential_grants AS retained
       WHERE id = $1`,
      [fixture.retainedGrantId],
    )
    const migratedRow = retained.rows[0]?.snapshot
    expect(migratedRow, 'V12 legacy issued credential was lost during v13 migration.')
    expect(
      migratedRow.provider_expiry_contract_version === 0 &&
        migratedRow.provider_credential_expires_at === null &&
        migratedRow.provider_expiry_observed_at === null &&
        migratedRow.status === 'issued' &&
        migratedRow.outcome_code === null,
      'V13 fabricated provider expiry proof for a legacy issued credential.',
    )
    const retainedGrantWithoutV13Fields = { ...migratedRow }
    delete retainedGrantWithoutV13Fields.provider_expiry_contract_version
    delete retainedGrantWithoutV13Fields.provider_credential_expires_at
    delete retainedGrantWithoutV13Fields.provider_expiry_observed_at
    expect(
      stableJson(retainedGrantWithoutV13Fields) ===
        stableJson(fixture.snapshotBeforeV13),
      'V13 migration changed retained v12 credential fields.',
    )

    const expiryColumns = await connection.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'github_delivery_credential_grants'
         AND column_name IN (
           'provider_expiry_contract_version',
           'provider_credential_expires_at',
           'provider_expiry_observed_at'
         )
       ORDER BY column_name`,
    )
    expect(
      stableJson(expiryColumns.rows.map((row) => row.column_name)) === stableJson([
        'provider_credential_expires_at',
        'provider_expiry_contract_version',
        'provider_expiry_observed_at',
      ]),
      'V13 provider expiry column inventory was incomplete.',
    )
    const retryColumns = await connection.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'github_pull_request_outcomes'
         AND column_name = 'provider_retry_not_before'`,
    )
    expect(
      retryColumns.rows.length === 1,
      'V14 provider retry not-before column was missing.',
    )
    const retainedPublication = await connection.query(
      `SELECT to_jsonb(retained) AS snapshot
       FROM github_branch_publications AS retained
       WHERE id = $1`,
      [fixture.retainedPublicationId],
    )
    const migratedPublication = retainedPublication.rows[0]?.snapshot
    expect(
      migratedPublication?.grant_id === fixture.retainedGrantId &&
        migratedPublication?.source_publication_id === null,
      'V15 did not preserve the legacy grant-backed publication authority.',
    )
    const retainedPublicationWithoutV15Fields = { ...migratedPublication }
    delete retainedPublicationWithoutV15Fields.source_publication_id
    expect(
      stableJson(retainedPublicationWithoutV15Fields) ===
        stableJson(fixture.snapshotBeforeV15),
      'V15 migration changed retained v14 publication fields.',
    )
    const publicationColumns = await connection.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'github_branch_publications'
         AND column_name = 'source_publication_id'`,
    )
    expect(
      publicationColumns.rows.length === 1,
      'V15 source_publication_id column was missing.',
    )
    const runtimeProjectionTables = await connection.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'agent_runtime_summaries',
           'agent_runtime_projection_audits'
         )
       ORDER BY table_name`,
    )
    expect(
      stableJson(runtimeProjectionTables.rows.map((row) => row.table_name)) ===
        stableJson([
          'agent_runtime_projection_audits',
          'agent_runtime_summaries',
        ]),
      'V16 Agent Runtime projection table inventory was incomplete.',
    )
    const retainedRuntimeProjectionCounts = await connection.query(
      `SELECT
         (SELECT count(*)::integer FROM agent_runtime_summaries) AS summaries,
         (SELECT count(*)::integer FROM agent_runtime_projection_audits) AS audits`,
    )
    expect(
      stableJson(retainedRuntimeProjectionCounts.rows[0]) ===
        stableJson({ summaries: 0, audits: 0 }),
      'V15-to-v16 migration invented Agent Runtime projection rows.',
    )
    const memoryProjectionTables = await connection.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'agent_memory_summaries',
           'agent_memory_projection_audits'
         )
       ORDER BY table_name`,
    )
    expect(
      stableJson(memoryProjectionTables.rows.map((row) => row.table_name)) ===
        stableJson([
          'agent_memory_projection_audits',
          'agent_memory_summaries',
        ]),
      'V17 Agent Memory projection table inventory was incomplete.',
    )
    const retainedMemoryProjectionCounts = await connection.query(
      `SELECT
         (SELECT count(*)::integer FROM agent_memory_summaries) AS summaries,
         (SELECT count(*)::integer FROM agent_memory_projection_audits) AS audits`,
    )
    expect(
      stableJson(retainedMemoryProjectionCounts.rows[0]) ===
        stableJson({ summaries: 0, audits: 0 }),
      'V16-to-v17 migration invented Agent Memory projection rows.',
    )
    const memoryQualityColumns = await connection.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('agent_memory_summaries', 'agent_memory_projection_audits')
         AND column_name = 'quality_version'
       ORDER BY table_name`,
    )
    expect(
      stableJson(memoryQualityColumns.rows) === stableJson([
        { table_name: 'agent_memory_projection_audits', column_name: 'quality_version' },
        { table_name: 'agent_memory_summaries', column_name: 'quality_version' },
      ]),
      'V18 Agent Memory quality-version column inventory was incomplete.',
    )
    const memoryQualityAuditPrimaryKey = await connection.query(
      `SELECT string_agg(attribute.attname, ',' ORDER BY key.ordinality) AS columns
       FROM pg_constraint AS constraint_record
       CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinality)
       JOIN pg_attribute AS attribute
         ON attribute.attrelid = constraint_record.conrelid
        AND attribute.attnum = key.attnum
       WHERE constraint_record.conrelid = 'agent_memory_projection_audits'::regclass
         AND constraint_record.contype = 'p'`,
    )
    expect(
      memoryQualityAuditPrimaryKey.rows[0]?.columns ===
        'memory_id,head_version,quality_version',
      'V18 Agent Memory quality audit primary key was not independently versioned.',
    )
    const memoryQualityMigration = await connection.query(
      `SELECT count(*)::integer AS count
       FROM team_schema_migrations
       WHERE version = 18
         AND name = '0018_agent_memory_projection_quality_version'`,
    )
    expect(
      memoryQualityMigration.rows[0]?.count === 1,
      'V18 Agent Memory quality-version migration history was missing.',
    )
    const coordinationProjection = await connection.query(
      `SELECT
         to_regclass('public.agent_coordination_summaries')::text AS summaries,
         to_regclass('public.agent_coordination_projection_audits')::text AS audits,
         (SELECT count(*)::integer FROM agent_coordination_summaries) AS summary_count,
         (SELECT count(*)::integer FROM agent_coordination_projection_audits) AS audit_count`,
    )
    expect(
      stableJson(coordinationProjection.rows[0]) === stableJson({
        summaries: 'agent_coordination_summaries',
        audits: 'agent_coordination_projection_audits',
        summary_count: 0,
        audit_count: 0,
      }),
      'V19 Agent Coordination projection tables were missing or fabricated rows.',
    )
    const coordinationMigration = await connection.query(
      `SELECT count(*)::integer AS count
       FROM team_schema_migrations
       WHERE version = 19
         AND name = '0019_agent_coordination_team_projection'`,
    )
    expect(
      coordinationMigration.rows[0]?.count === 1,
      'V19 Agent Coordination projection migration history was missing.',
    )

    await connection.query('BEGIN')
    transactionOpen = true
    let expiryConfirmationError
    try {
      await connection.query(
        `UPDATE github_delivery_credential_grants
         SET status = 'expired', outcome_code = 'credential_provider_expiry_confirmed'
         WHERE id = $1`,
        [fixture.retainedGrantId],
      )
    } catch (error) {
      expiryConfirmationError = error
    }
    expect(
      expiryConfirmationError?.code === '23514' &&
        expiryConfirmationError?.constraint ===
          'github_delivery_grants_provider_expiry_contract',
      'V13 did not fail closed on a fabricated legacy provider expiry confirmation.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false

    await connection.query('BEGIN')
    transactionOpen = true
    let publicationAuthorityError
    try {
      await connection.query(
        `UPDATE github_branch_publications
         SET grant_id = NULL, source_publication_id = NULL
         WHERE id = $1`,
        [fixture.retainedPublicationId],
      )
    } catch (error) {
      publicationAuthorityError = error
    }
    expect(
      publicationAuthorityError?.code === '23514' &&
        publicationAuthorityError?.constraint ===
          'github_branch_publications_authority_exactly_one',
      'V15 accepted a publication without exact grant or adoption authority.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      await connection.query('ROLLBACK').catch(() => undefined)
    }
    connection.release()
    await pool.end()
  }
}

async function assertAgentRuntimeProjectionDatabaseState({
  runtimeId,
  runId,
  nodeId,
  summary,
}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-agent-runtime-projection',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  let transactionOpen = false
  try {
    const state = await connection.query(
      `SELECT
         summary.runtime_id,
         summary.project_id,
         summary.run_id,
         summary.node_id,
         summary.runtime_version,
         summary.checkpoint_version,
         summary.status,
         summary.stop_reason,
         summary.steps,
         summary.tool_calls,
         summary.tokens,
         summary.cost_usd::text,
         summary.accepted_action_count,
         summary.context_digest,
         summary.capability_set_digest,
         summary.last_observation_digest,
         summary.last_result_digest,
         summary.redacted,
         count(audit.runtime_version)::integer AS audit_count,
         array_agg(audit.runtime_version ORDER BY audit.runtime_version) AS audit_versions
       FROM agent_runtime_summaries AS summary
       LEFT JOIN agent_runtime_projection_audits AS audit
         ON audit.runtime_id = summary.runtime_id
       WHERE summary.runtime_id = $1
       GROUP BY summary.runtime_id`,
      [runtimeId],
    )
    expect(state.rows.length === 1, 'Agent Runtime projection did not persist exactly once.')
    const row = state.rows[0]
    expect(
      row.project_id === summary.projectId &&
        row.run_id === runId &&
        row.node_id === `${runId}:${nodeId}` &&
        row.runtime_version === 2 &&
        row.checkpoint_version === 2 &&
        row.status === 'terminal' &&
        row.stop_reason === 'success' &&
        Number(row.steps) === 2 &&
        Number(row.tool_calls) === 1 &&
        Number(row.tokens) === 20 &&
        Number(row.cost_usd) === 0.02 &&
        Number(row.accepted_action_count) === 2 &&
        row.context_digest === summary.contextDigest &&
        row.capability_set_digest === summary.capabilitySetDigest &&
        row.last_observation_digest === summary.lastObservationDigest &&
        row.last_result_digest === summary.lastResultDigest &&
        row.redacted === true &&
        row.audit_count === 2 &&
        stableJson(row.audit_versions) === stableJson([1, 2]),
      `Agent Runtime projection state was not exact: ${stableJson(row)}`,
    )

    const forbiddenColumns = await connection.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (
           'agent_runtime_summaries',
           'agent_runtime_projection_audits'
         )
         AND lower(column_name) ~ '(prompt|source|patch|stdout|stderr|credential|path|checkpoint_data|raw_output)'`,
    )
    expect(
      forbiddenColumns.rows.length === 0,
      `Agent Runtime Team projection exposed forbidden columns: ${stableJson(
        forbiddenColumns.rows,
      )}`,
    )

    await connection.query('BEGIN')
    transactionOpen = true
    let runtimeConstraintError
    try {
      await connection.query(
        `UPDATE agent_runtime_summaries
         SET redacted = false
         WHERE runtime_id = $1`,
        [runtimeId],
      )
    } catch (error) {
      runtimeConstraintError = error
    }
    expect(
      runtimeConstraintError?.code === '23514' &&
        String(runtimeConstraintError?.constraint ?? '').includes(
          'agent_runtime_summaries',
        ),
      'V16 accepted a non-redacted Agent Runtime Team projection.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      await connection.query('ROLLBACK').catch(() => undefined)
    }
    connection.release()
    await pool.end()
  }
}

async function assertAgentMemoryProjectionDatabaseState({ memoryId, runId, nodeId, summary }) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-agent-memory-projection',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  let transactionOpen = false
  try {
    const state = await connection.query(
      `SELECT
         summary.project_id,
         summary.run_id,
         summary.node_id,
         summary.runtime_id,
         summary.head_version,
         summary.quality_version,
         summary.retrieval_count,
         summary.accepted_context_count,
         summary.citation_ids,
         summary.redacted,
         count(audit.quality_version)::integer AS audit_count,
         array_agg(audit.quality_version ORDER BY audit.quality_version) AS audit_versions
       FROM agent_memory_summaries AS summary
       LEFT JOIN agent_memory_projection_audits AS audit
         ON audit.memory_id = summary.memory_id
       WHERE summary.memory_id = $1
       GROUP BY summary.memory_id`,
      [memoryId],
    )
    expect(state.rows.length === 1, 'Agent Memory projection did not persist exactly once.')
    const row = state.rows[0]
    expect(
      row.project_id === summary.projectId &&
        row.run_id === runId &&
        row.node_id === `${runId}:${nodeId}` &&
        row.runtime_id === summary.runtimeId &&
        Number(row.head_version) === 1 &&
        Number(row.quality_version) === 3 &&
        Number(row.retrieval_count) === 2 &&
        Number(row.accepted_context_count) === 2 &&
        stableJson(row.citation_ids) === stableJson(['citation-a', 'citation-b']) &&
        row.redacted === true &&
        row.audit_count === 3 &&
        stableJson(row.audit_versions.map(Number)) === stableJson([1, 2, 3]),
      `Agent Memory projection state was not exact: ${stableJson(row)}`,
    )

    await connection.query('BEGIN')
    transactionOpen = true
    let qualityConstraintError
    try {
      await connection.query(
        `UPDATE agent_memory_summaries
         SET quality_version = accepted_context_count
         WHERE memory_id = $1`,
        [memoryId],
      )
    } catch (error) {
      qualityConstraintError = error
    }
    expect(
      qualityConstraintError?.code === '23514' &&
        qualityConstraintError?.constraint ===
          'agent_memory_summaries_quality_counts_are_exact',
      'V18 accepted an incoherent Agent Memory quality version.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      await connection.query('ROLLBACK').catch(() => undefined)
    }
    connection.release()
    await pool.end()
  }
}

async function assertAgentCoordinationProjectionDatabaseState({
  coordinationId,
  runId,
  nodeId,
  summary,
}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-agent-coordination-projection',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  let transactionOpen = false
  try {
    const state = await connection.query(
      `SELECT
         summary.project_id,
         summary.run_id,
         summary.node_id,
         summary.coordination_version,
         summary.graph_version,
         summary.status,
         summary.stop_reason,
         summary.role_counts,
         summary.task_status_counts,
         summary.failure_category_counts,
         summary.task_count,
         summary.edge_count,
         summary.specialist_starts,
         summary.accepted_handoff_count,
         summary.retry_count,
         summary.step_count,
         summary.tool_call_count,
         summary.token_count,
         summary.cost_usd::text,
         summary.single_agent_quality::text,
         summary.coordination_quality::text,
         summary.latency_ms,
         summary.human_intervention_count,
         summary.authority_violation_count,
         summary.isolation_violation_count,
         summary.termination_violation_count,
         summary.replay_violation_count,
         summary.redaction_violation_count,
         summary.isolated,
         summary.redacted,
         count(audit.coordination_version)::integer AS audit_count,
         array_agg(audit.coordination_version ORDER BY audit.coordination_version) AS audit_versions
       FROM agent_coordination_summaries AS summary
       LEFT JOIN agent_coordination_projection_audits AS audit
         ON audit.coordination_id = summary.coordination_id
       WHERE summary.coordination_id = $1
       GROUP BY summary.coordination_id`,
      [coordinationId],
    )
    expect(
      state.rows.length === 1,
      'Agent Coordination projection did not persist exactly once.',
    )
    const row = state.rows[0]
    expect(
      row.project_id === summary.projectId &&
        row.run_id === runId &&
        row.node_id === `${runId}:${nodeId}` &&
        Number(row.coordination_version) === 2 &&
        Number(row.graph_version) === 1 &&
        row.status === 'terminal' &&
        row.stop_reason === 'success' &&
        stableJson(row.role_counts) === stableJson(summary.roleCounts) &&
        stableJson(row.task_status_counts) === stableJson(summary.taskStatusCounts) &&
        stableJson(row.failure_category_counts) ===
          stableJson(summary.failureCategoryCounts) &&
        Number(row.task_count) === 2 &&
        Number(row.edge_count) === 1 &&
        Number(row.specialist_starts) === 2 &&
        Number(row.accepted_handoff_count) === 1 &&
        Number(row.retry_count) === 0 &&
        Number(row.step_count) === 4 &&
        Number(row.tool_call_count) === 2 &&
        Number(row.token_count) === 40 &&
        Number(row.cost_usd) === 0.04 &&
        Number(row.single_agent_quality) === 0.7 &&
        Number(row.coordination_quality) === 0.9 &&
        Number(row.latency_ms) === 1_000 &&
        Number(row.human_intervention_count) === 0 &&
        Number(row.authority_violation_count) === 0 &&
        Number(row.isolation_violation_count) === 0 &&
        Number(row.termination_violation_count) === 0 &&
        Number(row.replay_violation_count) === 0 &&
        Number(row.redaction_violation_count) === 0 &&
        row.isolated === true &&
        row.redacted === true &&
        row.audit_count === 2 &&
        stableJson(row.audit_versions.map(Number)) === stableJson([1, 2]),
      `Agent Coordination projection state was not exact: ${stableJson(row)}`,
    )

    const forbiddenColumns = await connection.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (
           'agent_coordination_summaries',
           'agent_coordination_projection_audits'
         )
         AND lower(column_name) ~ '(prompt|source|patch|stdout|stderr|credential|path|checkpoint_data|raw_output)'`,
    )
    expect(
      forbiddenColumns.rows.length === 0,
      `Agent Coordination Team projection exposed forbidden columns: ${stableJson(
        forbiddenColumns.rows,
      )}`,
    )

    await connection.query('BEGIN')
    transactionOpen = true
    let isolationConstraintError
    try {
      await connection.query(
        `UPDATE agent_coordination_summaries
         SET isolated = false
         WHERE coordination_id = $1`,
        [coordinationId],
      )
    } catch (error) {
      isolationConstraintError = error
    }
    expect(
      isolationConstraintError?.code === '23514' &&
        String(isolationConstraintError?.constraint ?? '').includes(
          'agent_coordination_summaries',
        ),
      'V19 accepted a non-isolated Agent Coordination Team projection.',
    )
    await connection.query('ROLLBACK')
    transactionOpen = false
  } finally {
    if (transactionOpen) {
      await connection.query('ROLLBACK').catch(() => undefined)
    }
    connection.release()
    await pool.end()
  }
}

function collectJsonFieldNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonFieldNames(item, names)
    return names
  }
  if (!value || typeof value !== 'object') return names
  for (const [key, child] of Object.entries(value)) {
    names.add(key)
    collectJsonFieldNames(child, names)
  }
  return names
}

async function assertGitHubDeliveryDatabaseState({
  requestId,
  bindingId,
  runId,
  nodeId,
  credentialLeakNeedles,
}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-postgres-smoke-github-assertions',
    statement_timeout: 10_000,
  })
  const connection = await pool.connect()
  try {
    const tableCountsResult = await connection.query(
      `SELECT
         (SELECT count(*)::integer
          FROM github_repository_bindings WHERE id = $1) AS bindings,
         (SELECT count(*)::integer
          FROM github_delivery_requests WHERE id = $2) AS requests,
         (SELECT count(*)::integer
          FROM github_delivery_approvals WHERE request_id = $2) AS approvals,
         (SELECT count(*)::integer
          FROM github_delivery_credential_grants WHERE request_id = $2) AS grants,
         (SELECT count(*)::integer
          FROM github_branch_publications WHERE request_id = $2) AS publications,
         (SELECT count(*)::integer
          FROM github_pull_request_outcomes WHERE request_id = $2) AS pull_requests`,
      [bindingId, requestId],
    )
    expect(
      stableJson(tableCountsResult.rows[0]) ===
        stableJson({
          bindings: 1,
          requests: 1,
          approvals: 1,
          grants: 1,
          publications: 1,
          pull_requests: 1,
        }),
      `GitHub Delivery durable counts were not exact: ${stableJson(
        tableCountsResult.rows[0],
      )}`,
    )

    await connection.query('BEGIN')
    let providerRetryConstraintError
    try {
      await connection.query(
        `UPDATE github_pull_request_outcomes
         SET provider_retry_not_before = recorded_at + interval '60 seconds'
         WHERE request_id = $1`,
        [requestId],
      )
    } catch (error) {
      providerRetryConstraintError = error
    }
    await connection.query('ROLLBACK')
    expect(
      providerRetryConstraintError?.code === '23514' &&
        providerRetryConstraintError?.constraint ===
          'github_pull_request_outcomes_retry_after',
      'V14 accepted a provider retry boundary on a completed pull request.',
    )

    const candidateAuthority = await connection.query(
      `/* github_delivery:candidate-authority-smoke */
       SELECT
         delivery.status AS delivery_status,
         delivery.state_version,
         delivery.outcome_code AS delivery_outcome_code,
         delivery.requested_by_user_id,
         delivery.requested_by_token_id,
         delivery.run_version AS delivery_run_version,
         delivery.node_id AS delivery_node_id,
         run.run_version AS canonical_run_version,
         run.current_node_id,
         run.creator_id,
         run.data_origin,
         node.stage AS node_stage,
         node.kind AS node_kind,
         node.status AS node_status,
         work_request.status AS work_request_status,
         work_request.claimed_by_token_id,
         approval.approved_by_user_id,
         approval.approved_role,
         approval.auth_kind,
         binding.status AS binding_status,
         credential_grant.status AS grant_status,
         credential_grant.version AS grant_version,
         publication.status AS publication_status,
         publication.version AS publication_version,
         publication.verified_head_sha,
         pull_request.status AS pull_request_status,
         pull_request.version AS pull_request_version,
         pull_request.draft,
         pull_request.head_sha
       FROM github_delivery_requests AS delivery
       JOIN workflow_runs AS run
         ON run.organization_id = delivery.organization_id
        AND run.project_id = delivery.project_id
        AND run.id = delivery.run_id
       JOIN workflow_nodes AS node
         ON node.run_id = run.id
        AND node.id = run.current_node_id
       JOIN work_requests AS work_request
         ON work_request.organization_id = run.organization_id
        AND work_request.project_id = run.project_id
        AND work_request.claimed_run_id = run.id
       JOIN github_repository_bindings AS binding
         ON binding.id = delivery.binding_id
       JOIN github_delivery_approvals AS approval
         ON approval.request_id = delivery.id
        AND approval.intent_revision = delivery.intent_revision
       JOIN github_delivery_credential_grants AS credential_grant
         ON credential_grant.request_id = delivery.id
        AND credential_grant.intent_revision = delivery.intent_revision
       JOIN github_branch_publications AS publication
         ON publication.request_id = delivery.id
        AND publication.intent_revision = delivery.intent_revision
       JOIN github_pull_request_outcomes AS pull_request
         ON pull_request.request_id = delivery.id
        AND pull_request.intent_revision = delivery.intent_revision
       WHERE delivery.id = $1`,
      [requestId],
    )
    expect(
      candidateAuthority.rows.length === 1,
      'GitHub Delivery candidate authority did not resolve exactly once.',
    )
    const authority = candidateAuthority.rows[0]
    expect(
      authority.delivery_status === 'completed' &&
        authority.state_version === 8 &&
        authority.delivery_outcome_code === 'draft_pr_created' &&
        authority.delivery_run_version === 3 &&
        authority.canonical_run_version === 3 &&
        authority.delivery_node_id === nodeId &&
        authority.current_node_id === `${runId}:${nodeId}` &&
        authority.creator_id === authority.requested_by_user_id &&
        authority.data_origin === 'remote' &&
        authority.node_stage === 'pr' &&
        authority.node_kind === 'pr' &&
        authority.node_status === 'running' &&
        authority.work_request_status === 'materialized' &&
        authority.claimed_by_token_id === authority.requested_by_token_id &&
        authority.approved_by_user_id === 'u-erich' &&
        authority.approved_role === 'owner' &&
        authority.auth_kind === 'session_cookie' &&
        authority.binding_status === 'revoked' &&
        authority.grant_status === 'consumed' &&
        authority.grant_version === 3 &&
        authority.publication_status === 'verified' &&
        authority.publication_version === 2 &&
        authority.verified_head_sha === githubExpectedCommitSha &&
        authority.pull_request_status === 'completed' &&
        authority.pull_request_version === 2 &&
        authority.draft === true &&
        authority.head_sha === githubExpectedCommitSha,
      `GitHub Delivery candidate authority was incomplete: ${stableJson(
        authority,
      )}`,
    )

    const expectedGitHubOperationCounts = {
      github_binding_revoke: 1,
      github_binding_upsert: 1,
      github_branch_publication: 2,
      github_delivery_approve: 1,
      github_delivery_grant: 3,
      github_delivery_submit: 1,
      github_pull_request_create: 2,
    }
    const idempotencyCounts = await connection.query(
      `SELECT operation_kind, count(*)::integer AS count
       FROM collaboration_idempotency
       WHERE organization_id = 'org-demo'
         AND project_id = 'p-payments'
         AND operation_kind LIKE 'github_%'
       GROUP BY operation_kind
       ORDER BY operation_kind`,
    )
    const auditCounts = await connection.query(
      `SELECT action, count(*)::integer AS count
       FROM collaboration_audit_events
       WHERE organization_id = 'org-demo'
         AND project_id = 'p-payments'
         AND action LIKE 'github_%'
       GROUP BY action
       ORDER BY action`,
    )
    const countsByOperation = (rows, key) =>
      Object.fromEntries(rows.map((row) => [row[key], row.count]))
    expect(
      stableJson(countsByOperation(idempotencyCounts.rows, 'operation_kind')) ===
        stableJson(expectedGitHubOperationCounts),
      `GitHub Delivery idempotency counts were not exact: ${stableJson(
        idempotencyCounts.rows,
      )}`,
    )
    expect(
      stableJson(countsByOperation(auditCounts.rows, 'action')) ===
        stableJson(expectedGitHubOperationCounts),
      `GitHub Delivery audit counts were not exact: ${stableJson(
        auditCounts.rows,
      )}`,
    )

    const expectedOutcomeCounts = {
      binding_created: 1,
      binding_inactive: 1,
      binding_revoked: 1,
      delivery_approved: 1,
      delivery_created: 1,
      grant_finalized: 1,
      grant_reserved: 1,
      publication_reported: 1,
      publication_verified: 1,
      pull_request_completed: 1,
      pull_request_reserved: 1,
    }
    const idempotencyOutcomeCounts = await connection.query(
      `SELECT outcome_code, count(*)::integer AS count
       FROM collaboration_idempotency
       WHERE organization_id = 'org-demo'
         AND project_id = 'p-payments'
         AND operation_kind LIKE 'github_%'
       GROUP BY outcome_code
       ORDER BY outcome_code`,
    )
    const auditOutcomeCounts = await connection.query(
      `SELECT outcome_code, count(*)::integer AS count
       FROM collaboration_audit_events
       WHERE organization_id = 'org-demo'
         AND project_id = 'p-payments'
         AND action LIKE 'github_%'
       GROUP BY outcome_code
       ORDER BY outcome_code`,
    )
    expect(
      stableJson(
        countsByOperation(idempotencyOutcomeCounts.rows, 'outcome_code'),
      ) === stableJson(expectedOutcomeCounts) &&
        stableJson(countsByOperation(auditOutcomeCounts.rows, 'outcome_code')) ===
          stableJson(expectedOutcomeCounts),
      'GitHub Delivery audit/idempotency outcomes were not exact.',
    )
    const auditIdempotencyPairs = await connection.query(
      `SELECT count(*)::integer AS count
       FROM collaboration_idempotency AS idempotency
       JOIN collaboration_audit_events AS audit
         ON audit.organization_id = idempotency.organization_id
        AND audit.project_id = idempotency.project_id
        AND audit.actor_user_id = idempotency.actor_user_id
        AND audit.action = idempotency.operation_kind
        AND audit.outcome_code = idempotency.outcome_code
        AND audit.request_fingerprint = idempotency.request_fingerprint
       WHERE idempotency.organization_id = 'org-demo'
         AND idempotency.project_id = 'p-payments'
         AND idempotency.operation_kind LIKE 'github_%'`,
    )
    expect(
      auditIdempotencyPairs.rows[0]?.count === 11,
      'GitHub Delivery audit/idempotency fingerprints were not one-to-one.',
    )

    const persistedRecords = await connection.query(
      `SELECT 'binding' AS kind, to_jsonb(binding) AS record
       FROM github_repository_bindings AS binding WHERE binding.id = $1
       UNION ALL
       SELECT 'request', to_jsonb(delivery)
       FROM github_delivery_requests AS delivery WHERE delivery.id = $2
       UNION ALL
       SELECT 'approval', to_jsonb(approval)
       FROM github_delivery_approvals AS approval WHERE approval.request_id = $2
       UNION ALL
       SELECT 'grant', to_jsonb(credential_grant)
       FROM github_delivery_credential_grants AS credential_grant
       WHERE credential_grant.request_id = $2
       UNION ALL
       SELECT 'publication', to_jsonb(publication)
       FROM github_branch_publications AS publication WHERE publication.request_id = $2
       UNION ALL
       SELECT 'pull_request', to_jsonb(pull_request)
       FROM github_pull_request_outcomes AS pull_request WHERE pull_request.request_id = $2
       UNION ALL
       SELECT 'idempotency', to_jsonb(idempotency)
       FROM collaboration_idempotency AS idempotency
       WHERE idempotency.organization_id = 'org-demo'
         AND idempotency.project_id = 'p-payments'
         AND idempotency.operation_kind LIKE 'github_%'
       UNION ALL
       SELECT 'audit', to_jsonb(audit)
       FROM collaboration_audit_events AS audit
       WHERE audit.organization_id = 'org-demo'
         AND audit.project_id = 'p-payments'
         AND audit.action LIKE 'github_%'`,
      [bindingId, requestId],
    )
    expect(
      persistedRecords.rows.length === 28,
      `GitHub Delivery persistence scan expected 28 records, received ${persistedRecords.rows.length}.`,
    )
    const persistedJson = JSON.stringify(persistedRecords.rows)
    for (const needle of credentialLeakNeedles) {
      expect(
        typeof needle !== 'string' ||
          needle.length === 0 ||
          !persistedJson.includes(needle),
        'GitHub Delivery persistence retained a copy-once credential.',
      )
    }
    const lowerPersistedJson = persistedJson.toLowerCase()
    for (const fragment of [
      '-----begin private key-----',
      'github_pat_',
      'x-access-token:',
      '/users/',
      '/private/',
      'file://',
      '\\users\\',
    ]) {
      expect(
        !lowerPersistedJson.includes(fragment),
        `GitHub Delivery persistence retained forbidden data: ${fragment}`,
      )
    }
    const forbiddenJsonFieldNames = new Set([
      'authorization',
      'credential',
      'privatekey',
      'rawpath',
      'token',
    ])
    const allowedTokenMetadataFields = new Set([
      'auth_token_record_id',
      'issued_to_token_id',
      'requested_by_token_id',
    ])
    for (const fieldName of collectJsonFieldNames(persistedRecords.rows)) {
      const normalizedFieldName = fieldName
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, '')
      expect(
        !forbiddenJsonFieldNames.has(normalizedFieldName),
        `GitHub Delivery persistence retained forbidden JSON field ${fieldName}.`,
      )
      expect(
        !fieldName.toLowerCase().includes('token') ||
          allowedTokenMetadataFields.has(fieldName),
        `GitHub Delivery persistence retained non-metadata token field ${fieldName}.`,
      )
    }

    const forbiddenColumns = await connection.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
         AND lower(regexp_replace(column_name, '[^a-z0-9]', '', 'g')) = ANY($2::text[])
       ORDER BY table_name, column_name`,
      [
        [
          'github_repository_bindings',
          'github_delivery_requests',
          'github_delivery_approvals',
          'github_delivery_credential_grants',
          'github_branch_publications',
          'github_pull_request_outcomes',
        ],
        [...forbiddenJsonFieldNames],
      ],
    )
    expect(
      forbiddenColumns.rows.length === 0,
      `GitHub Delivery tables exposed credential-bearing columns: ${stableJson(
        forbiddenColumns.rows,
      )}`,
    )
  } finally {
    connection.release()
    await pool.end()
  }
}

function canonicalLocalNodeId(runId, storedNodeId) {
  const prefix = `${runId}:`
  const nodeId = storedNodeId.startsWith(prefix)
    ? storedNodeId.slice(prefix.length)
    : storedNodeId
  expect(
    nodeId.length > 0 && !nodeId.startsWith(prefix),
    'Team node identity did not resolve to one canonical local node ID.',
  )
  return nodeId
}

function expectNoLocalOnlyFields(value, label) {
  const serialized = JSON.stringify(value).toLowerCase()
  const blockedFragments = [
    'cwd',
    'stdout',
    'stderr',
    'raw trace',
    'prompt',
    'secret',
    'sk-test',
    '/users/',
    '\\users\\',
  ]

  for (const fragment of blockedFragments) {
    expect(!serialized.includes(fragment), `${label} leaked local-only fragment: ${fragment}`)
  }
}

function expectNoCredentialLeak(value, credentials, label) {
  const serialized = JSON.stringify(value)
  for (const credential of credentials) {
    expect(
      typeof credential !== 'string' ||
        credential.length === 0 ||
        !serialized.includes(credential),
      `${label} leaked a copy-once credential.`,
    )
  }
}

function enforcementRule(target, category, statusOrSeverity, action, updatedAt, options = {}) {
  return {
    ruleKey: `${target}:${category}:${statusOrSeverity}`,
    target,
    category,
    statusOrSeverity,
    defaultAction: action,
    floorAction: options.floorAction ?? 'ignore',
    overridable: options.overridable ?? true,
    ...(options.remediation ? { remediation: options.remediation } : {}),
    updatedAt,
  }
}

function createRecommendedEnforcementPolicy(version, updatedAt) {
  return {
    id: 'enforcement-policy-org-demo-recommended',
    organizationId: 'org-demo',
    name: 'Recommended enforcement preset',
    version,
    updatedAt,
    rules: [
      enforcementRule('missing_agent_review', 'protected_gate', 'missing', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Run Knowledge Review Agent for this protected Gate.',
      }),
      enforcementRule('governance_check', 'testing_standard', 'needs_evidence', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Attach passing test evidence for the affected Run.',
      }),
      enforcementRule('governance_check', 'testing_standard', 'violated', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Fix the failing test evidence and rerun the configured test command.',
      }),
      enforcementRule('governance_check', 'api_contract', 'violated', 'block', updatedAt, {
        floorAction: 'block',
        remediation: 'Update the implementation or design artifact to satisfy the API contract.',
      }),
      enforcementRule('governance_check', 'review_checklist', 'needs_evidence', 'warn', updatedAt),
      enforcementRule('agent_finding', 'missing_evidence', 'medium', 'warn', updatedAt),
      enforcementRule('agent_finding', 'test_risk', 'high', 'warn', updatedAt),
      enforcementRule('agent_finding', 'api_contract_risk', 'high', 'warn', updatedAt),
      enforcementRule('agent_finding', 'security_risk', 'high', 'warn', updatedAt),
      enforcementRule('agent_finding', 'review_gap', 'low', 'warn', updatedAt),
    ],
  }
}

function expectMissingReviewBlock(decision, label) {
  expect(decision.status === 'blocked', `${label} should return blocked, received ${decision.status}`)
  expect(decision.blocksApproval === true, `${label} should block approval.`)
  expect(
    decision.blockingReasons?.some((reason) => reason.target === 'missing_agent_review'),
    `${label} did not include missing Agent Review as a blocking reason.`,
  )
}

const suffix = Date.now()
const runId = `run-postgres-smoke-${suffix}`
const pairedRunId = `run-postgres-paired-smoke-${suffix}`
const agentRuntimeId = `agent-runtime-postgres-smoke-${suffix}`
const agentMemoryId = `agent-memory-postgres-smoke-${suffix}`
const agentCoordinationId = `agent-coordination-postgres-smoke-${suffix}`
const gateRunId = `run-postgres-gate-smoke-${suffix}`
const githubRunId = `run-postgres-github-smoke-${suffix}`
const gateNodeId = 'n-design-gate'
const githubPrNodeId = 'n-pr-delivery'
const githubInstallationId = '12345'
const githubRepositoryId = '98765'
const githubRepository = 'example/project'
const githubExpectedCommitSha = 'b'.repeat(40)
const githubEphemeralCredential = 'ghs_postgres_smoke_ephemeral_1234567890'
const evidenceId = `evidence-postgres-smoke-${suffix}`
const remoteReviewId = `agent-review-postgres-smoke-${suffix}`
const timestamp = new Date().toISOString()
const pairedTamperTimestamp = new Date(Date.now() + 250).toISOString()
const pairedGateTimestamp = new Date(Date.now() + 500).toISOString()
const completedTimestamp = new Date(Date.now() + 1_000).toISOString()
let api

try {
  const retainedV12Fixture = await prepareRetainedV12CredentialFixture()
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
  })
  await assertRetainedV12CredentialAfterCurrentMigration(retainedV12Fixture)
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:seed'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
  })

  api = spawnService(
    'api-postgres',
    [
      'pnpm',
      '--filter',
      '@ai-devflow/api',
      'exec',
      'tsx',
      'src/test-fixtures/postgres-github-delivery-server.ts',
    ],
    {
      DEVFLOW_DATABASE_URL: databaseUrl,
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_REQUIRE_AUTH: 'true',
      DEVFLOW_SESSION_SECRET: sessionSecret,
      DEVFLOW_POSTGRES_SMOKE_GITHUB_INSTALLATION_ID: githubInstallationId,
      DEVFLOW_POSTGRES_SMOKE_GITHUB_REPOSITORY_ID: githubRepositoryId,
      DEVFLOW_POSTGRES_SMOKE_GITHUB_REPOSITORY: githubRepository,
      DEVFLOW_POSTGRES_SMOKE_GITHUB_EXPECTED_HEAD_SHA:
        githubExpectedCommitSha,
      DEVFLOW_POSTGRES_SMOKE_GITHUB_EPHEMERAL_CREDENTIAL:
        githubEphemeralCredential,
      DEV_AUTH_ENABLED: 'true',
      PORT: '4322',
    },
  )
  await waitForServer(`${apiUrl}/health`)

  const initialOverview = await fetchOverview()
  expect(
    initialOverview.projects?.some((project) => project.id === 'p-payments'),
    'Postgres overview did not include seeded Payments project.',
  )
  expect(
    initialOverview.runs?.some((run) => run.id === 'run-health-001'),
    'Postgres overview did not include seeded workflow run.',
  )
  expectNoLocalOnlyFields(initialOverview, 'initial overview')

  const seededRun = initialOverview.runs?.find((run) => run.id === 'run-health-001')
  expect(seededRun, 'Postgres overview did not return the seeded run object.')
  expect(
    seededRun.nodes?.some((node) => node.id === seededRun.currentNodeId),
    'Seeded run current node was not available for backend Knowledge Review.',
  )
  const protectedGates = seededRun.nodes?.filter((node) => node.kind === 'gate' || node.kind === 'acceptance') ?? []
  const compliantGate = protectedGates.find((node) => node.ownerId !== leadSessionHeaders['x-devflow-user-id'])
  const conflictedLeadGate = protectedGates.find((node) => node.ownerId === leadSessionHeaders['x-devflow-user-id'])
  expect(compliantGate?.kind === 'gate', 'Seeded run did not include the smoke protected Gate.')
  expect(
    seededRun.creatorId !== leadSessionHeaders['x-devflow-user-id'] &&
      compliantGate.ownerId !== leadSessionHeaders['x-devflow-user-id'],
    'Smoke compliant Gate must not be created or owned by the lead override actor.',
  )
  expect(
    conflictedLeadGate?.ownerId === leadSessionHeaders['x-devflow-user-id'],
    'Seeded run did not include a lead-owned Gate for conflict smoke coverage.',
  )
  const compliantGateLocalId = canonicalLocalNodeId(
    seededRun.id,
    compliantGate.id,
  )
  const conflictedLeadGateLocalId = canonicalLocalNodeId(
    seededRun.id,
    conflictedLeadGate.id,
  )

  expect(
    initialOverview.enforcementPolicies?.organizationPolicy?.name === 'Warn-only default enforcement policy',
    'Postgres overview did not start with the warn-only default enforcement policy.',
  )

  const pairingCode = await postJson('/api/team/projects/p-payments/pairing-codes', {}, leadSessionHeaders)
  expect(pairingCode.projectId === 'p-payments', 'Desktop pairing code was not scoped to the Payments project.')
  expect(
    typeof pairingCode.code === 'string' && pairingCode.code.includes('.'),
    'Desktop pairing code was not returned as a copy-once secret.',
  )
  expect(pairingCode.attemptsRemaining === 5, 'Desktop pairing code did not expose the expected attempt budget.')
  const desktopPairing = await postJsonWithoutSession('/api/desktop/pairing/exchange', {
    code: pairingCode.code,
  })
  expect(desktopPairing.token?.includes('.'), 'Desktop pairing exchange did not return a copy-once bearer token.')
  expect(desktopPairing.projectId === 'p-payments', 'Desktop bearer token was not scoped to the Payments project.')
  expect(desktopPairing.userId === leadSessionHeaders['x-devflow-user-id'], 'Desktop token user did not match the pairing lead.')

  const gatePairingCode = await postJson(
    '/api/team/projects/p-payments/pairing-codes',
    {},
    pilotSessionHeaders,
  )
  expect(
    typeof gatePairingCode.code === 'string' && gatePairingCode.code.includes('.'),
    'Gate vertical smoke did not create a signed-Cookie pairing code.',
  )
  const gateDesktopPairing = await postJsonWithoutSession(
    '/api/desktop/pairing/exchange',
    { code: gatePairingCode.code },
  )
  expect(
    typeof gateDesktopPairing.token === 'string' &&
      gateDesktopPairing.token.includes('.'),
    'Gate vertical smoke did not exchange the pairing code.',
  )

  const createdWorkRequest = await postJson(
    '/api/team/projects/p-payments/work-requests',
    {
      projectId: 'p-payments',
      title: 'Postgres Gate Command smoke',
      request: 'Exercise the version-bound human rejection path.',
      idempotencyKey: `work-request:create:${gateRunId}`,
      expiresAt: null,
    },
    pilotSessionHeaders,
  )
  const workRequest = createdWorkRequest.workRequest
  expect(
    workRequest?.version === 1 && workRequest.status === 'open',
    'Gate vertical smoke did not create an open Work Request v1.',
  )
  const claimedWorkRequest = await postJsonWithBearer(
    `/api/desktop/work-requests/${workRequest.id}/claim`,
    {
      workRequestId: workRequest.id,
      expectedVersion: 1,
      runId: gateRunId,
      idempotencyKey: `work-request:claim:${gateRunId}`,
    },
    gateDesktopPairing.token,
  )
  expect(
    claimedWorkRequest.workRequest?.version === 2 &&
      claimedWorkRequest.workRequest.status === 'claim_pending',
    'Gate vertical smoke did not claim the Work Request at v2.',
  )
  const materializedWorkRequest = await postJsonWithBearer(
    `/api/desktop/work-requests/${workRequest.id}/materialized`,
    {
      workRequestId: workRequest.id,
      expectedVersion: 2,
      runId: gateRunId,
      idempotencyKey: `work-request:materialize:${gateRunId}`,
    },
    gateDesktopPairing.token,
  )
  expect(
    materializedWorkRequest.workRequest?.version === 3 &&
      materializedWorkRequest.workRequest.status === 'materialized',
    'Gate vertical smoke did not materialize the Work Request at v3.',
  )

  const gateProjectedAt = new Date().toISOString()
  await postJsonWithBearer(
    '/api/sync/run-summary',
    {
      kind: 'run',
      runId: gateRunId,
      version: 3,
      projectId: 'p-payments',
      title: 'Postgres Gate Command vertical smoke',
      status: 'paused_at_gate',
      currentNodeId: gateNodeId,
      currentNode: {
        id: gateNodeId,
        stage: 'design',
        kind: 'gate',
        status: 'blocked',
        requiredRole: 'lead',
      },
      branchName: 'codex/postgres-gate-smoke',
      updatedAt: gateProjectedAt,
    },
    gateDesktopPairing.token,
  )
  const gateEvaluation = await postJson(
    '/api/enforcement/evaluate',
    { projectId: 'p-payments', runId: gateRunId, nodeId: gateNodeId },
    pilotSessionHeaders,
  )
  const expectedGateBlockerIds = gateEvaluation.blockingReasons
    .map((reason) => reason.id)
    .sort()
  const createdGateCommand = await postJson(
    '/api/team/projects/p-payments/gate-commands',
    {
      projectId: 'p-payments',
      runId: gateRunId,
      nodeId: gateNodeId,
      action: 'reject',
      reason: 'The pilot operator intentionally rejects this smoke Gate.',
      expectedRunVersion: 3,
      expectedPolicyVersion: gateEvaluation.policyVersion,
      expectedBlockerIds: expectedGateBlockerIds,
      idempotencyKey: `gate-command:create:${gateRunId}:v3`,
    },
    pilotSessionHeaders,
  )
  const command = createdGateCommand.command
  expect(
    command?.workRequestId === workRequest.id &&
      command.status === 'pending' &&
      command.action === 'reject',
    'Gate vertical smoke did not bind the reject command to the materialized Work Request.',
  )
  const gateInbox = await getJsonWithBearer(
    '/api/desktop/projects/p-payments/gate-commands/inbox',
    gateDesktopPairing.token,
  )
  expect(
    gateInbox.commands?.some((candidate) => candidate.id === command.id),
    'Gate vertical smoke inbox did not return the bound command.',
  )
  const createdReceipt = await postJsonWithBearer(
    `/api/desktop/gate-commands/${command.id}/receipts`,
    {},
    gateDesktopPairing.token,
  )
  const receipt = createdReceipt.receipt
  expect(
    receipt?.commandId === command.id && receipt.acknowledgedAt === null,
    'Gate vertical smoke did not create an active command receipt.',
  )
  const gateOverviewBeforeAck = await fetchOverview(
    '/api/team/overview before Gate Command ACK',
    pilotSessionHeaders,
  )
  const teamRunBeforeAck = gateOverviewBeforeAck.runs?.find(
    (run) => run.id === gateRunId,
  )
  expect(
    teamRunBeforeAck,
    'Gate vertical smoke Team overview did not include the Run before ACK.',
  )
  const createdAcknowledgement = await postJsonWithBearer(
    `/api/desktop/gate-command-receipts/${receipt.id}/acknowledgements`,
    {
      commandId: command.id,
      outcomeCode: 'human_rejected',
      beforeRunVersion: 3,
      afterRunVersion: 3,
      evaluatedAt: receipt.leasedAt,
    },
    gateDesktopPairing.token,
  )
  expect(
    createdAcknowledgement.acknowledgement?.outcomeCode === 'human_rejected' &&
      createdAcknowledgement.command?.status === 'applied',
    'Gate vertical smoke did not acknowledge the human rejection.',
  )

  const gateOverview = await fetchOverview(
    '/api/team/overview after Gate Command ACK',
    pilotSessionHeaders,
  )
  const teamRun = gateOverview.runs?.find((run) => run.id === gateRunId)
  expect(teamRun, 'Gate vertical smoke Team overview did not include the Run.')
  expect(
    teamRun.version === teamRunBeforeAck.version,
    'Gate Command ACK mutated the Team Run version.',
  )
  expect(
    teamRun.status === teamRunBeforeAck.status,
    'Gate Command ACK mutated the Team Run status.',
  )
  expect(
    teamRun.currentNodeId === teamRunBeforeAck.currentNodeId,
    'Gate Command ACK mutated the Team Run current node.',
  )
  expectNoCredentialLeak(
    {
      createdWorkRequest,
      claimedWorkRequest,
      materializedWorkRequest,
      gateEvaluation,
      createdGateCommand,
      gateInbox,
      createdReceipt,
      gateOverviewBeforeAck,
      createdAcknowledgement,
      gateOverview,
    },
    [
      gatePairingCode.code,
      gateDesktopPairing.token,
      pilotSessionCookie,
      sessionSecret,
    ],
    'Postgres Gate vertical smoke responses',
  )

  const githubWorkRequest = await postJson(
    '/api/team/projects/p-payments/work-requests',
    {
      projectId: 'p-payments',
      title: 'Postgres GitHub Delivery smoke',
      request: 'Publish one exact redacted commit as a Draft pull request.',
      idempotencyKey: `work-request:create:${githubRunId}`,
      expiresAt: null,
    },
    pilotSessionHeaders,
  )
  expect(
    githubWorkRequest.workRequest?.status === 'open' &&
      githubWorkRequest.workRequest.version === 1,
    'GitHub Delivery smoke did not create its canonical Work Request.',
  )
  const githubClaim = await postJsonWithBearer(
    `/api/desktop/work-requests/${githubWorkRequest.workRequest.id}/claim`,
    {
      workRequestId: githubWorkRequest.workRequest.id,
      expectedVersion: 1,
      runId: githubRunId,
      idempotencyKey: `work-request:claim:${githubRunId}`,
    },
    gateDesktopPairing.token,
  )
  expect(
    githubClaim.workRequest?.status === 'claim_pending' &&
      githubClaim.workRequest.version === 2,
    'GitHub Delivery smoke did not bind its Work Request to Desktop bearer authority.',
  )
  const githubMaterialization = await postJsonWithBearer(
    `/api/desktop/work-requests/${githubWorkRequest.workRequest.id}/materialized`,
    {
      workRequestId: githubWorkRequest.workRequest.id,
      expectedVersion: 2,
      runId: githubRunId,
      idempotencyKey: `work-request:materialize:${githubRunId}`,
    },
    gateDesktopPairing.token,
  )
  expect(
    githubMaterialization.workRequest?.status === 'materialized' &&
      githubMaterialization.workRequest.version === 3,
    'GitHub Delivery smoke did not materialize its canonical Work Request.',
  )
  const githubIntentTimestamp = new Date().toISOString()
  const githubRunProjection = await postJsonWithBearer(
    '/api/sync/run-summary',
    {
      kind: 'run',
      runId: githubRunId,
      version: 3,
      projectId: 'p-payments',
      title: 'Postgres GitHub Delivery exact commit',
      status: 'paused_at_gate',
      currentNodeId: githubPrNodeId,
      currentNode: {
        id: githubPrNodeId,
        stage: 'pr',
        kind: 'pr',
        status: 'running',
        requiredRole: 'member',
      },
      branchName: `devflow/${githubRunId}`,
      updatedAt: githubIntentTimestamp,
    },
    gateDesktopPairing.token,
  )
  expect(
    githubRunProjection?.accepted === true,
    'GitHub Delivery smoke did not persist the current running PR node.',
  )

  const githubBinding = await putJsonBody(
    '/api/team/projects/p-payments/github-repository-binding',
    {
      installationId: githubInstallationId,
      repositoryId: githubRepositoryId,
      expectedStateVersion: 0,
    },
    pilotSessionHeaders,
  )
  expect(
    githubBinding.outcomeCode === 'binding_created' &&
      githubBinding.binding?.status === 'active' &&
      githubBinding.binding.repository === githubRepository &&
      githubBinding.binding.redacted === true,
    'GitHub Delivery smoke did not persist one active verified repository binding.',
  )
  const githubIntent = createRedactedGitHubDeliveryIntent({
    binding: githubBinding.binding,
    runId: githubRunId,
    nodeId: githubPrNodeId,
    now: githubIntentTimestamp,
  })
  const githubSubmissionBody = {
    intent: githubIntent,
    prTitle: 'Postgres GitHub Delivery exact commit',
    prBody: 'Bound to the canonical running PR node and passing evidence digest.',
    expectedStateVersion: 0,
  }
  const githubSubmission = await postJsonWithBearer(
    '/api/desktop/projects/p-payments/github-deliveries',
    githubSubmissionBody,
    gateDesktopPairing.token,
  )
  expect(
    githubSubmission.outcomeCode === 'delivery_created' &&
      githubSubmission.request?.status === 'approval_required' &&
      githubSubmission.request.stateVersion === 1 &&
      githubSubmission.request.deliverySeriesKey ===
        githubIntent.deliverySeriesKey &&
      githubSubmission.request.deliveryAttempt === 1 &&
      githubSubmission.request.redacted === true,
    'GitHub Delivery smoke did not persist the exact redacted Delivery Request.',
  )
  const githubRequestId = githubSubmission.request.id
  const githubApprovalPath =
    `/api/team/projects/p-payments/github-deliveries/${githubRequestId}/approve`
  const githubApproval = await postJson(
    githubApprovalPath,
    { expectedStateVersion: 1 },
    pilotSessionHeaders,
  )
  expect(
    githubApproval.outcomeCode === 'delivery_approved' &&
      githubApproval.request?.status === 'approved' &&
      githubApproval.request.stateVersion === 2 &&
      githubApproval.approval?.approvedRole === 'owner' &&
      githubApproval.approval.authenticationKind === 'session_cookie' &&
      githubApproval.approval.approvedByUserId === 'u-erich' &&
      githubApproval.approval.redacted === true,
    'GitHub Delivery smoke did not persist signed owner approval.',
  )
  const githubApprovalReplay = await postJson(
    githubApprovalPath,
    { expectedStateVersion: 1 },
    pilotSessionHeaders,
  )
  expect(
    githubApprovalReplay.replayed === true &&
      githubApprovalReplay.approval?.id === githubApproval.approval.id,
    'GitHub Delivery signed approval was not idempotent.',
  )

  const githubRequestPath =
    `/api/desktop/projects/p-payments/github-deliveries/${githubRequestId}`
  const githubCredential = await postJsonWithBearer(
    `${githubRequestPath}/credential-grant`,
    { expectedStateVersion: 2 },
    gateDesktopPairing.token,
  )
  expect(
    githubCredential.outcomeCode === 'grant_finalized' &&
      githubCredential.request?.stateVersion === 4 &&
      githubCredential.request.status === 'publishing_branch' &&
      githubCredential.grant?.version === 2 &&
      githubCredential.grant.status === 'issued' &&
      githubCredential.grant.permission === 'contents:write' &&
      githubCredential.grant.repositoryCount === 1 &&
      githubCredential.grant.redacted === true &&
      githubCredential.credential?.token === githubEphemeralCredential,
    'GitHub Delivery smoke did not reserve and finalize bounded credential metadata.',
  )
  expect(
    !JSON.stringify(githubCredential.grant).includes(githubEphemeralCredential),
    'GitHub credential metadata retained the ephemeral credential.',
  )
  const githubIssuedSnapshot = await getJsonWithBearer(
    githubRequestPath,
    gateDesktopPairing.token,
  )
  expectNoCredentialLeak(
    githubIssuedSnapshot,
    [githubEphemeralCredential, gateDesktopPairing.token],
    'GitHub issued recovery snapshot',
  )

  const githubPublication = await postJsonWithBearer(
    `${githubRequestPath}/branch-publication`,
    {
      grantId: githubCredential.grant.id,
      expectedStateVersion: 4,
      expectedGrantVersion: 2,
      reportedOutcomeCode: 'pushed',
    },
    gateDesktopPairing.token,
  )
  expect(
    githubPublication.outcomeCode === 'publication_verified' &&
      githubPublication.request?.stateVersion === 6 &&
      githubPublication.request.status === 'branch_published' &&
      githubPublication.publication?.version === 2 &&
      githubPublication.publication.status === 'verified' &&
      githubPublication.publication.verifiedHeadSha ===
        githubExpectedCommitSha &&
      githubPublication.publication.outcomeCode === 'branch_verified' &&
      githubPublication.publication.redacted === true,
    'GitHub Delivery smoke did not independently finalize the exact remote head.',
  )

  const githubPullRequestBody = {
    publicationId: githubPublication.publication.id,
    expectedStateVersion: 6,
  }
  const githubPullRequest = await postJsonWithBearer(
    `${githubRequestPath}/draft-pull-request`,
    githubPullRequestBody,
    gateDesktopPairing.token,
  )
  expect(
    githubPullRequest.outcomeCode === 'pull_request_completed' &&
      githubPullRequest.request?.stateVersion === 8 &&
      githubPullRequest.request.status === 'completed' &&
      githubPullRequest.request.outcomeCode === 'draft_pr_created' &&
      githubPullRequest.pullRequest?.version === 2 &&
      githubPullRequest.pullRequest.status === 'completed' &&
      githubPullRequest.pullRequest.draft === true &&
      githubPullRequest.pullRequest.headSha === githubExpectedCommitSha &&
      githubPullRequest.pullRequest.safeUrl ===
        `https://github.com/${githubRepository}/pull/42` &&
      githubPullRequest.pullRequest.outcomeCode === 'draft_pr_created' &&
      githubPullRequest.pullRequest.redacted === true,
    'GitHub Delivery smoke did not reserve and finalize one Draft PR outcome.',
  )
  const githubPullRequestReplay = await postJsonWithBearer(
    `${githubRequestPath}/draft-pull-request`,
    githubPullRequestBody,
    gateDesktopPairing.token,
  )
  expect(
    githubPullRequestReplay.replayed === true &&
      githubPullRequestReplay.pullRequest?.id ===
        githubPullRequest.pullRequest.id,
    'GitHub Draft PR finalization was not idempotent.',
  )
  const githubRecoverySnapshot = await getJsonWithBearer(
    githubRequestPath,
    gateDesktopPairing.token,
  )
  expect(
    githubRecoverySnapshot.snapshot?.request?.status === 'completed' &&
      githubRecoverySnapshot.snapshot.request.stateVersion === 8 &&
      githubRecoverySnapshot.snapshot.approval?.id ===
        githubApproval.approval.id &&
      githubRecoverySnapshot.snapshot.grant?.status === 'consumed' &&
      githubRecoverySnapshot.snapshot.publication?.status === 'verified' &&
      githubRecoverySnapshot.snapshot.pullRequest?.status === 'completed',
    'GitHub Delivery recovery snapshot did not return the completed durable chain.',
  )
  expectNoCredentialLeak(
    githubRecoverySnapshot,
    [
      githubEphemeralCredential,
      gateDesktopPairing.token,
      pilotSessionCookie,
      sessionSecret,
    ],
    'GitHub completed recovery snapshot',
  )

  const githubBindingRevocation = await postJson(
    '/api/team/projects/p-payments/github-repository-binding/revoke',
    { expectedStateVersion: githubBinding.binding.version },
    pilotSessionHeaders,
  )
  expect(
    githubBindingRevocation.outcomeCode === 'binding_revoked' &&
      githubBindingRevocation.binding?.status === 'revoked' &&
      githubBindingRevocation.binding.version ===
        githubBinding.binding.version + 1,
    'GitHub Delivery smoke did not revoke the Project repository binding.',
  )
  const blockedCredentialGrant = await postJsonResult(
    `${githubRequestPath}/credential-grant`,
    { expectedStateVersion: 8 },
    { authorization: `Bearer ${gateDesktopPairing.token}` },
  )
  expect(
    blockedCredentialGrant.status === 409 &&
      blockedCredentialGrant.body?.outcomeCode === 'binding_inactive',
    'Revoked GitHub repository binding did not block a new credential grant.',
  )
  await assertGitHubDeliveryDatabaseState({
    requestId: githubRequestId,
    bindingId: githubBinding.binding.id,
    runId: githubRunId,
    nodeId: githubPrNodeId,
    credentialLeakNeedles: [
      githubEphemeralCredential,
      gateDesktopPairing.token,
      gatePairingCode.code,
      pilotSessionCookie,
      sessionSecret,
    ],
  })

  const concurrentGatePayload = {
    projectId: 'p-payments',
    runId: gateRunId,
    nodeId: gateNodeId,
    action: 'reject',
    reason: 'Concurrent Gate Command smoke contender.',
    expectedRunVersion: 3,
    expectedPolicyVersion: gateEvaluation.policyVersion,
    expectedBlockerIds: expectedGateBlockerIds,
  }
  const concurrentGateResults = await Promise.all([
    postJsonResult(
      '/api/team/projects/p-payments/gate-commands',
      {
        ...concurrentGatePayload,
        idempotencyKey: `gate-command:race:${gateRunId}:first`,
      },
      pilotSessionHeaders,
    ),
    postJsonResult(
      '/api/team/projects/p-payments/gate-commands',
      {
        ...concurrentGatePayload,
        idempotencyKey: `gate-command:race:${gateRunId}:second`,
      },
      pilotSessionHeaders,
    ),
  ])
  expect(
    concurrentGateResults.map(({ status }) => status).sort().join(',') ===
      '201,409',
    `Concurrent Gate create expected one 201 and one 409, received ${concurrentGateResults
      .map(({ status }) => status)
      .join(',')}.`,
  )
  expect(
    concurrentGateResults.find(({ status }) => status === 409)?.body
      ?.outcomeCode === 'active_command_conflict',
    'Concurrent Gate loser did not return active_command_conflict.',
  )
  const gateCommandsAfterRace = await getJson(
    '/api/team/projects/p-payments/gate-commands',
    pilotSessionHeaders,
  )
  const activeRaceCommands = gateCommandsAfterRace.commands.filter(
    (candidate) =>
      candidate.runId === gateRunId &&
      candidate.nodeId === gateNodeId &&
      candidate.expectedRunVersion === 3 &&
      (candidate.status === 'pending' || candidate.status === 'delivering'),
  )
  expect(
    activeRaceCommands.length === 1,
    `Concurrent Gate create persisted ${activeRaceCommands.length} active commands.`,
  )

  const releaseRaceRunId = `run-postgres-release-race-${suffix}`
  const releaseRaceRequest = await postJson(
    '/api/team/projects/p-payments/work-requests',
    {
      projectId: 'p-payments',
      title: 'Postgres release and upload race',
      request: 'Prove a released claim cannot accept a late canonical projection.',
      idempotencyKey: `work-request:create:${releaseRaceRunId}`,
      expiresAt: null,
    },
    pilotSessionHeaders,
  )
  const releaseRaceWorkRequest = releaseRaceRequest.workRequest
  await postJsonWithBearer(
    `/api/desktop/work-requests/${releaseRaceWorkRequest.id}/claim`,
    {
      workRequestId: releaseRaceWorkRequest.id,
      expectedVersion: 1,
      runId: releaseRaceRunId,
      idempotencyKey: `work-request:claim:${releaseRaceRunId}`,
    },
    gateDesktopPairing.token,
  )
  const releaseRaceResults = await Promise.all([
    postJsonResult(
      `/api/team/work-requests/${releaseRaceWorkRequest.id}/release`,
      {
        workRequestId: releaseRaceWorkRequest.id,
        expectedVersion: 2,
        idempotencyKey: `work-request:release:${releaseRaceRunId}`,
      },
      pilotSessionHeaders,
    ),
    postJsonResult(
      '/api/sync/run-summary',
      {
        kind: 'run',
        runId: releaseRaceRunId,
        version: 1,
        projectId: 'p-payments',
        title: 'Postgres late Run Summary contender',
        status: 'clarifying',
        currentNodeId: 'n-clarify',
        currentNode: {
          id: 'n-clarify',
          stage: 'clarify',
          kind: 'agent',
          status: 'running',
        },
        branchName: 'codex/postgres-release-race',
        updatedAt: new Date().toISOString(),
      },
      { authorization: `Bearer ${gateDesktopPairing.token}` },
    ),
  ])
  expect(
    releaseRaceResults.filter(({ status }) => status >= 200 && status < 300)
      .length === 1 &&
      releaseRaceResults.filter(({ status }) => status === 409).length === 1,
    `Release/upload race must have one success and one 409, received ${releaseRaceResults
      .map(({ status }) => status)
      .join(',')}.`,
  )
  const releaseRaceOverview = await fetchOverview(
    '/api/team/overview after release/upload race',
    pilotSessionHeaders,
  )
  const releaseWon = releaseRaceResults[0].status === 200
  expect(
    releaseRaceOverview.runs.some((candidate) => candidate.id === releaseRaceRunId) ===
      !releaseWon,
    'Release/upload race projection state did not match its single winning operation.',
  )

  await postJsonWithBearer(
    '/api/sync/run-summary',
    {
      kind: 'run',
      runId: pairedRunId,
      version: 1,
      projectId: 'p-payments',
      title: 'Postgres paired desktop synced run',
      status: 'testing',
      currentNodeId: 'n-test',
      currentNode: { id: 'n-test', stage: 'test', kind: 'test', status: 'running' },
      branchName: 'ai/postgres-paired-smoke',
      updatedAt: timestamp,
    },
    desktopPairing.token,
  )
  const pairedOverview = await fetchOverview('/api/team/overview after desktop pairing', leadSessionHeaders)
  expect(
    pairedOverview.runs?.some((run) => run.id === pairedRunId && run.status === 'testing'),
    'Postgres overview did not include the Desktop bearer-token synced run.',
  )
  const serializedPairedOverview = JSON.stringify(pairedOverview)
  expect(!serializedPairedOverview.includes(pairingCode.code), 'Team overview leaked the copy-once pairing code.')
  expect(!serializedPairedOverview.includes(desktopPairing.token), 'Team overview leaked the Desktop bearer token.')
  const agentRuntimeSummaryV1 = {
    stateVersion: 1,
    projectionVersion: 1,
    runtimeId: agentRuntimeId,
    projectId: 'p-payments',
    runId: pairedRunId,
    nodeId: 'n-test',
    runtimeVersion: 1,
    checkpointVersion: 1,
    status: 'running',
    stopReason: null,
    counters: { steps: 1, toolCalls: 0, tokens: 10, costUsd: 0.01 },
    acceptedActionCount: 1,
    contextDigest: '1'.repeat(64),
    capabilitySetDigest: '2'.repeat(64),
    lastObservationDigest: '3'.repeat(64),
    lastResultDigest: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    redacted: true,
  }
  await postJsonWithBearer(
    '/api/sync/agent-runtime-summary',
    agentRuntimeSummaryV1,
    desktopPairing.token,
  )
  await postJsonWithBearer(
    '/api/sync/agent-runtime-summary',
    agentRuntimeSummaryV1,
    desktopPairing.token,
  )
  await expectPostRejected(
    '/api/sync/agent-runtime-summary',
    { ...agentRuntimeSummaryV1, rawOutput: 'must-not-cross-team-boundary' },
    { authorization: `Bearer ${desktopPairing.token}` },
    400,
    'Agent Runtime raw output projection',
  )
  const agentRuntimeSummaryV2 = {
    ...agentRuntimeSummaryV1,
    runtimeVersion: 2,
    checkpointVersion: 2,
    status: 'terminal',
    stopReason: 'success',
    counters: { steps: 2, toolCalls: 1, tokens: 20, costUsd: 0.02 },
    acceptedActionCount: 2,
    lastResultDigest: '4'.repeat(64),
    updatedAt: completedTimestamp,
  }
  await postJsonWithBearer(
    '/api/sync/agent-runtime-summary',
    agentRuntimeSummaryV2,
    desktopPairing.token,
  )
  await expectPostRejected(
    '/api/sync/agent-runtime-summary',
    agentRuntimeSummaryV1,
    { authorization: `Bearer ${desktopPairing.token}` },
    409,
    'stale Agent Runtime projection',
  )
  const runtimeOverview = await fetchOverview(
    '/api/team/overview after Agent Runtime sync',
    leadSessionHeaders,
  )
  expect(
    runtimeOverview.agentRuntimeSummaries?.filter(
      (summary) =>
        summary.runtimeId === agentRuntimeId &&
        summary.runtimeVersion === 2 &&
        summary.status === 'terminal' &&
        summary.stopReason === 'success' &&
        summary.redacted === true,
    ).length === 1,
    'Postgres overview did not expose the exact terminal Agent Runtime summary.',
  )
  expectNoLocalOnlyFields(runtimeOverview.agentRuntimeSummaries, 'Agent Runtime overview')
  await assertAgentRuntimeProjectionDatabaseState({
    runtimeId: agentRuntimeId,
    runId: pairedRunId,
    nodeId: 'n-test',
    summary: agentRuntimeSummaryV2,
  })
  const zeroCoordinationFailureCounts = {
    timeout: 0,
    budget_exhausted: 0,
    policy_denied: 0,
    tool_error: 0,
    coding_executor_error: 0,
    invalid_result: 0,
    dependency_failed: 0,
  }
  const agentCoordinationSummaryV1 = {
    stateVersion: 1,
    projectionVersion: 1,
    coordinationId: agentCoordinationId,
    projectId: 'p-payments',
    runId: pairedRunId,
    nodeId: 'n-test',
    coordinationVersion: 1,
    graphVersion: 1,
    status: 'running',
    stopReason: null,
    roleCounts: [
      { roleId: 'coordinator', count: 1 },
      { roleId: 'implementer', count: 1 },
    ],
    taskStatusCounts: {
      pending: 0,
      ready: 1,
      running: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      blocked: 0,
    },
    failureCategoryCounts: zeroCoordinationFailureCounts,
    taskCount: 2,
    edgeCount: 1,
    specialistStarts: 1,
    acceptedHandoffCount: 0,
    retryCount: 0,
    stepCount: 2,
    toolCallCount: 1,
    tokenCount: 20,
    costUsd: 0.02,
    singleAgentQuality: null,
    coordinationQuality: null,
    latencyMs: 500,
    humanInterventionCount: 0,
    authorityViolationCount: 0,
    isolationViolationCount: 0,
    terminationViolationCount: 0,
    replayViolationCount: 0,
    redactionViolationCount: 0,
    updatedAt: timestamp,
    isolated: true,
    redacted: true,
  }
  await postJsonWithBearer(
    '/api/sync/agent-coordination-summary',
    agentCoordinationSummaryV1,
    desktopPairing.token,
  )
  await postJsonWithBearer(
    '/api/sync/agent-coordination-summary',
    agentCoordinationSummaryV1,
    desktopPairing.token,
  )
  await expectPostRejected(
    '/api/sync/agent-coordination-summary',
    { ...agentCoordinationSummaryV1, taskDetails: ['must-not-cross-team-boundary'] },
    { authorization: `Bearer ${desktopPairing.token}` },
    400,
    'Agent Coordination task-detail projection',
  )
  const agentCoordinationSummaryV2 = {
    ...agentCoordinationSummaryV1,
    coordinationVersion: 2,
    status: 'terminal',
    stopReason: 'success',
    taskStatusCounts: {
      pending: 0,
      ready: 0,
      running: 0,
      succeeded: 2,
      failed: 0,
      cancelled: 0,
      blocked: 0,
    },
    specialistStarts: 2,
    acceptedHandoffCount: 1,
    stepCount: 4,
    toolCallCount: 2,
    tokenCount: 40,
    costUsd: 0.04,
    singleAgentQuality: 0.7,
    coordinationQuality: 0.9,
    latencyMs: 1_000,
    updatedAt: completedTimestamp,
  }
  await postJsonWithBearer(
    '/api/sync/agent-coordination-summary',
    agentCoordinationSummaryV2,
    desktopPairing.token,
  )
  await expectPostRejected(
    '/api/sync/agent-coordination-summary',
    agentCoordinationSummaryV1,
    { authorization: `Bearer ${desktopPairing.token}` },
    409,
    'stale Agent Coordination projection',
  )
  const coordinationOverview = await fetchOverview(
    '/api/team/overview after Agent Coordination sync',
    leadSessionHeaders,
  )
  expect(
    coordinationOverview.agentCoordinationSummaries?.filter(
      (summary) =>
        summary.coordinationId === agentCoordinationId &&
        summary.coordinationVersion === 2 &&
        summary.status === 'terminal' &&
        summary.stopReason === 'success' &&
        summary.singleAgentQuality === 0.7 &&
        summary.coordinationQuality === 0.9 &&
        summary.isolated === true &&
        summary.redacted === true,
    ).length === 1,
    'Postgres overview did not expose the exact terminal Agent Coordination summary.',
  )
  expectNoLocalOnlyFields(
    coordinationOverview.agentCoordinationSummaries,
    'Agent Coordination overview',
  )
  await assertAgentCoordinationProjectionDatabaseState({
    coordinationId: agentCoordinationId,
    runId: pairedRunId,
    nodeId: 'n-test',
    summary: agentCoordinationSummaryV2,
  })
  const agentMemorySummaryV1 = {
    stateVersion: 1,
    projectionVersion: 1,
    memoryId: agentMemoryId,
    projectId: 'p-payments',
    runId: pairedRunId,
    nodeId: 'n-test',
    runtimeId: agentRuntimeId,
    ownerUserId: desktopPairing.userId,
    candidateId: `agent-memory-candidate-postgres-smoke-${suffix}`,
    currentRevision: 1,
    headVersion: 1,
    qualityVersion: 1,
    lifecycleStatus: 'active',
    visibility: 'user_project',
    sensitivity: 'private',
    retentionClass: 'until_deleted',
    provenanceDigest: '5'.repeat(64),
    citationIds: [],
    retrievalCount: 0,
    acceptedContextCount: 0,
    expiresAt: null,
    deletedAt: null,
    purgeStatus: null,
    purgedAt: null,
    updatedAt: completedTimestamp,
    redacted: true,
  }
  await postJsonWithBearer(
    '/api/sync/agent-memory-summary',
    agentMemorySummaryV1,
    desktopPairing.token,
  )
  await postJsonWithBearer(
    '/api/sync/agent-memory-summary',
    agentMemorySummaryV1,
    desktopPairing.token,
  )
  const agentMemorySummaryV2 = {
    ...agentMemorySummaryV1,
    qualityVersion: 2,
    citationIds: ['citation-a'],
    retrievalCount: 1,
    acceptedContextCount: 1,
  }
  await postJsonWithBearer(
    '/api/sync/agent-memory-summary',
    agentMemorySummaryV2,
    desktopPairing.token,
  )
  const agentMemorySummaryV3 = {
    ...agentMemorySummaryV2,
    qualityVersion: 3,
    citationIds: ['citation-a', 'citation-b'],
    retrievalCount: 2,
    acceptedContextCount: 2,
  }
  await postJsonWithBearer(
    '/api/sync/agent-memory-summary',
    agentMemorySummaryV3,
    desktopPairing.token,
  )
  await expectPostRejected(
    '/api/sync/agent-memory-summary',
    agentMemorySummaryV2,
    { authorization: `Bearer ${desktopPairing.token}` },
    409,
    'stale same-head Agent Memory quality projection',
  )
  await expectPostRejected(
    '/api/sync/agent-memory-summary',
    { ...agentMemorySummaryV3, statement: 'must-not-cross-team-boundary' },
    { authorization: `Bearer ${desktopPairing.token}` },
    400,
    'Agent Memory statement projection',
  )
  const memoryOverview = await fetchOverview(
    '/api/team/overview after Agent Memory sync',
    leadSessionHeaders,
  )
  expect(
    memoryOverview.agentMemorySummaries?.filter(
      (summary) =>
        summary.memoryId === agentMemoryId &&
        summary.headVersion === 1 &&
        summary.qualityVersion === 3 &&
        summary.acceptedContextCount === 2 &&
        summary.redacted === true,
    ).length === 1,
    'Postgres overview did not expose the exact same-head Agent Memory quality projection.',
  )
  expectNoLocalOnlyFields(memoryOverview.agentMemorySummaries, 'Agent Memory overview')
  await assertAgentMemoryProjectionDatabaseState({
    memoryId: agentMemoryId,
    runId: pairedRunId,
    nodeId: 'n-test',
    summary: agentMemorySummaryV3,
  })
  await expectPostRejected(
    '/api/sync/run-summary',
    {
      kind: 'run',
      runId: pairedRunId,
      version: 2,
      projectId: 'p-payments',
      title: 'Cross-user overwrite attempt',
      status: 'completed',
      currentNodeId: 'n-acceptance',
      currentNode: {
        id: 'n-acceptance',
        stage: 'accept',
        kind: 'acceptance',
        status: 'success',
        requiredRole: 'lead',
      },
      branchName: 'ai/postgres-paired-smoke',
      updatedAt: pairedTamperTimestamp,
    },
    memberSessionHeaders,
    409,
    'cross-user canonical Run overwrite',
  )

  const warnOnlyDecision = await postJson('/api/enforcement/evaluate', {
    runId: seededRun.id,
    nodeId: compliantGateLocalId,
    projectId: seededRun.projectId,
  })
  expect(
    warnOnlyDecision.status === 'warn' && warnOnlyDecision.blocksApproval === false,
    `Warn-only default should not block approval, received ${warnOnlyDecision.status}.`,
  )

  const policyV1UpdatedAt = new Date(Date.now() + 1_000).toISOString()
  const policyV1 = createRecommendedEnforcementPolicy(1, policyV1UpdatedAt)
  await putJson('/api/enforcement/policy', policyV1)

  await postJsonWithBearer(
    '/api/sync/run-summary',
    {
      kind: 'run',
      runId: pairedRunId,
      version: 2,
      projectId: 'p-payments',
      title: 'Postgres paired desktop synced run',
      status: 'paused_at_gate',
      currentNodeId: 'n-design-gate',
      currentNode: {
        id: 'n-design-gate',
        stage: 'design',
        kind: 'gate',
        status: 'blocked',
        requiredRole: 'lead',
      },
      branchName: 'ai/postgres-paired-smoke',
      updatedAt: pairedGateTimestamp,
    },
    desktopPairing.token,
  )
  const pairedBlockedDecision = await postJson('/api/enforcement/evaluate', {
    runId: pairedRunId,
    nodeId: 'n-design-gate',
    projectId: 'p-payments',
  }, independentLeadSessionHeaders)
  expectMissingReviewBlock(
    pairedBlockedDecision,
    'Desktop-synced Postgres Gate evaluation',
  )
  const pairedAcceptedOverride = await postJson('/api/gates/override', {
    runId: pairedRunId,
    nodeId: 'n-design-gate',
    projectId: 'p-payments',
    reason: 'Independent project lead reviewed the Desktop-synced Gate.',
    blockedReasonIds: pairedBlockedDecision.blockingReasons.map((reason) => reason.id),
    policyVersion: pairedBlockedDecision.policyVersion,
  }, independentLeadSessionHeaders)
  expect(
    pairedAcceptedOverride.status === 'accepted' &&
      pairedAcceptedOverride.nodeId === 'n-design-gate' &&
      pairedAcceptedOverride.userId === independentLeadSessionHeaders['x-devflow-user-id'],
    'Desktop-synced Postgres Gate override did not preserve the canonical local node identity.',
  )
  const pairedOverriddenDecision = await postJson('/api/enforcement/evaluate', {
    runId: pairedRunId,
    nodeId: 'n-design-gate',
    projectId: 'p-payments',
  }, independentLeadSessionHeaders)
  expect(
    pairedOverriddenDecision.status === 'overridden' &&
      pairedOverriddenDecision.blocksApproval === false,
    `Desktop-synced accepted override should unblock Gate, received ${pairedOverriddenDecision.status}.`,
  )

  const blockedDecision = await postJson('/api/enforcement/evaluate', {
    runId: seededRun.id,
    nodeId: compliantGateLocalId,
    projectId: seededRun.projectId,
  })
  expectMissingReviewBlock(blockedDecision, 'Recommended policy compliant Gate evaluation')
  const overridePayload = {
    runId: seededRun.id,
    nodeId: compliantGateLocalId,
    projectId: seededRun.projectId,
    reason: 'Postgres smoke lead override for missing Knowledge Review.',
    blockedReasonIds: blockedDecision.blockingReasons.map((reason) => reason.id),
    policyVersion: blockedDecision.policyVersion,
  }
  await expectPostRejected('/api/gates/override', overridePayload, ownerSessionHeaders, 403, 'owner override')
  await expectPostRejected('/api/gates/override', overridePayload, memberSessionHeaders, 403, 'member override')

  const conflictedLeadDecision = await postJson('/api/enforcement/evaluate', {
    runId: seededRun.id,
    nodeId: conflictedLeadGateLocalId,
    projectId: seededRun.projectId,
  }, leadSessionHeaders)
  expectMissingReviewBlock(conflictedLeadDecision, 'Recommended policy conflicted lead Gate evaluation')
  await expectPostRejected(
    '/api/gates/override',
    {
      ...overridePayload,
      nodeId: conflictedLeadGateLocalId,
      blockedReasonIds: conflictedLeadDecision.blockingReasons.map((reason) => reason.id),
      policyVersion: conflictedLeadDecision.policyVersion,
    },
    leadSessionHeaders,
    403,
    'conflicted lead override',
  )

  const acceptedOverride = await postJson('/api/gates/override', overridePayload, leadSessionHeaders)
  expect(acceptedOverride.status === 'accepted', 'Compliant lead override was not accepted.')
  expect(acceptedOverride.userId === leadSessionHeaders['x-devflow-user-id'], 'Lead override actor was not persisted.')

  const overriddenDecision = await postJson('/api/enforcement/evaluate', {
    runId: seededRun.id,
    nodeId: compliantGateLocalId,
    projectId: seededRun.projectId,
  }, leadSessionHeaders)
  expect(
    overriddenDecision.status === 'overridden' && overriddenDecision.blocksApproval === false,
    `Accepted lead override should unblock Gate, received ${overriddenDecision.status}.`,
  )

  const policyV2 = createRecommendedEnforcementPolicy(2, new Date(Date.now() + 2_000).toISOString())
  await putJson('/api/enforcement/policy', policyV2)
  await expectPostRejected(
    '/api/gates/override',
    overridePayload,
    leadSessionHeaders,
    403,
    'stale policy version override',
  )

  await expectPostRejected(
    '/api/sync/run-summary',
    {
      kind: 'approval',
      runId,
      version: 1,
      projectId: 'p-payments',
      title: 'Postgres smoke approval bypass attempt',
      status: 'building',
      currentNodeId: 'n-design-gate',
      currentNode: {
        id: 'n-design-gate',
        stage: 'design',
        kind: 'gate',
        status: 'blocked',
        requiredRole: 'lead',
      },
      branchName: 'ai/postgres-smoke',
      updatedAt: timestamp,
    },
    leadSessionHeaders,
    400,
    'approval summary sync bypass',
  )

  await postJson('/api/sync/run-summary', {
    kind: 'run',
    runId,
    version: 1,
    projectId: 'p-payments',
    title: 'Postgres smoke synced run',
    status: 'testing',
    currentNodeId: 'n-test',
    currentNode: { id: 'n-test', stage: 'test', kind: 'test', status: 'running' },
    branchName: 'ai/postgres-smoke',
    updatedAt: timestamp,
  })
  await postJson('/api/sync/test-evidence-summary', {
    id: evidenceId,
    runId,
    nodeId: 'n-test',
    projectId: 'p-payments',
    command: 'pnpm test',
    status: 'passed',
    exitCode: 0,
    durationMs: 321,
    summary: 'Postgres smoke tests passed.',
    redacted: true,
    createdAt: timestamp,
  })

  const testingOverview = await fetchOverview('/api/team/overview after test evidence sync')
  expect(
    testingOverview.runs?.some((run) => run.id === runId && run.status === 'testing'),
    'Test evidence must not advance the canonical Postgres workflow run.',
  )
  expect(
    testingOverview.testEvidenceSummaries?.some(
      (evidence) => evidence.id === evidenceId && evidence.redacted === true,
    ),
    'Postgres overview did not include the synced redacted test evidence summary.',
  )

  await postJson('/api/sync/run-summary', {
    kind: 'run',
    runId,
    version: 2,
    projectId: 'p-payments',
    title: 'Postgres smoke synced run',
    status: 'completed',
    currentNodeId: 'n-acceptance',
    currentNode: {
      id: 'n-acceptance',
      stage: 'accept',
      kind: 'acceptance',
      status: 'success',
      requiredRole: 'lead',
    },
    branchName: 'ai/postgres-smoke',
    updatedAt: completedTimestamp,
  })

  const backendReview = await postJson('/api/agent/knowledge-review', {
    runId: seededRun.id,
    nodeId: seededRun.currentNodeId,
    projectId: seededRun.projectId,
    providerId: 'fake-knowledge-review',
  })
  expect(backendReview.review?.runtime === 'api', 'Backend Knowledge Review did not run in API runtime.')
  expect(
    backendReview.review?.providerId === 'fake-knowledge-review',
    'Backend Knowledge Review did not use the deterministic fake provider.',
  )
  expect(
    backendReview.review?.gateAdvisory?.blocksApproval === false,
    'Backend Knowledge Review advisory should remain warning-only.',
  )
  expect(backendReview.trace?.steps?.length >= 4, 'Backend Knowledge Review did not include an agent trace.')
  expect(backendReview.tokenUsage?.id, 'Backend Knowledge Review did not include token usage.')
  expect(backendReview.artifact?.kind === 'agent_review', 'Backend Knowledge Review did not create review artifact.')
  expect(backendReview.event?.kind === 'agent_review', 'Backend Knowledge Review did not create review event.')
  expectNoLocalOnlyFields(
    {
      review: backendReview.review,
      tokenUsage: backendReview.tokenUsage,
      artifact: backendReview.artifact,
      event: backendReview.event,
    },
    'backend review bundle',
  )

  await postJson('/api/sync/agent-review-summary', {
    id: remoteReviewId,
    runId,
    nodeId: 'n-test',
    projectId: 'p-payments',
    runtime: 'electron',
    providerId: 'fake-knowledge-review',
    model: 'fake',
    conclusion: 'Postgres smoke synced Knowledge Review',
    summary: 'Warning-only redacted review summary from Electron smoke path.',
    riskCount: 1,
    missingEvidenceCount: 1,
    advisoryLevel: 'warn',
    blocksApproval: false,
    confidence: 0.82,
    redacted: true,
    createdAt: timestamp,
  })

  const syncedOverview = await fetchOverview('/api/team/overview after sync')
  expect(
    syncedOverview.runs?.some((run) => run.id === runId && run.status === 'completed'),
    'Postgres overview did not include the synced smoke run.',
  )
  expect(
    syncedOverview.testEvidenceSummaries?.some(
      (evidence) => evidence.id === evidenceId && evidence.redacted === true,
    ),
    'Postgres overview did not include the synced redacted test evidence summary.',
  )
  expect(
    syncedOverview.agentReviews?.some((review) => review.id === backendReview.review.id && review.runtime === 'api'),
    'Postgres overview did not include the backend Knowledge Review.',
  )
  expect(
    syncedOverview.agentTokenUsage?.some((usage) => usage.id === backendReview.tokenUsage.id),
    'Postgres overview did not include backend Knowledge Review token usage.',
  )
  expect(
    syncedOverview.agentReviews?.some(
      (review) =>
        review.id === remoteReviewId &&
        review.runtime === 'electron' &&
        review.gateAdvisory?.blocksApproval === false,
    ),
    'Postgres overview did not include the synced Electron Agent Review summary.',
  )
  expect(
    syncedOverview.enforcementPolicies?.organizationPolicy?.version === 2,
    'Postgres overview did not include the latest saved enforcement policy version.',
  )
  expect(
    syncedOverview.enforcementPolicies?.effectivePolicies?.some((policy) =>
      policy.rules?.some(
        (rule) =>
          rule.ruleKey === 'missing_agent_review:protected_gate:missing' &&
          rule.action === 'block' &&
          rule.floorAction === 'block',
      ),
    ),
    'Postgres overview did not include the blocking missing-review enforcement rule.',
  )
  expect(
    syncedOverview.enforcementPolicies?.gateOverrides?.some(
      (override) =>
        override.runId === seededRun.id &&
        override.nodeId === compliantGate.id &&
        override.userId === leadSessionHeaders['x-devflow-user-id'] &&
        override.status === 'accepted',
    ),
    'Postgres overview did not include accepted lead override audit.',
  )
  expect(
    syncedOverview.enforcementPolicies?.gateOverrides?.some(
      (override) =>
        override.runId === pairedRunId &&
        override.nodeId === `${pairedRunId}:n-design-gate` &&
        override.userId === independentLeadSessionHeaders['x-devflow-user-id'] &&
        override.status === 'accepted',
    ),
    'Postgres overview did not include the Desktop-synced Gate override audit.',
  )
  expectNoLocalOnlyFields(syncedOverview, 'synced overview')

  console.log('Postgres integration smoke passed.')
} finally {
  await stop(api)
}
