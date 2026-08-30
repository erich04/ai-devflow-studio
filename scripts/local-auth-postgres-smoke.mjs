import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { Pool } = requireFromApi('pg')
const baseDatabaseUrl = process.env.DEVFLOW_DATABASE_URL ?? process.env.DATABASE_URL
const webOrigin = 'http://127.0.0.1:4311'
const sessionSecret = 'devflow-local-auth-postgres-smoke-session-secret'

if (!baseDatabaseUrl) {
  throw new Error(
    'Set DEVFLOW_DATABASE_URL or DATABASE_URL before running test:local-auth-postgres-smoke.',
  )
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function scopedDatabaseUrl(databaseUrl, schemaName) {
  const url = new URL(databaseUrl)
  const existingOptions = url.searchParams.get('options')?.trim()
  url.searchParams.set(
    'options',
    `${existingOptions ? `${existingOptions} ` : ''}-c search_path=${schemaName}`,
  )
  return url.toString()
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function spawnApi(port, databaseUrl) {
  const child = spawn(
    corepack,
    [
      'pnpm',
      '--filter',
      '@ai-devflow/api',
      'exec',
      'tsx',
      'src/server.ts',
    ],
    {
      cwd: rootDir,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        DEVFLOW_DATABASE_URL: databaseUrl,
        DEVFLOW_DATABASE_APPLICATION_NAME: 'ai-devflow-local-auth-postgres-smoke',
        DEVFLOW_DEPLOYMENT_PROFILE: 'development',
        DEVFLOW_ENABLE_DEMO_DATA: 'false',
        DEVFLOW_LOCAL_AUTH_ENABLED: 'true',
        DEVFLOW_REQUIRE_AUTH: 'true',
        DEVFLOW_SESSION_SECRET: sessionSecret,
        DEVFLOW_WEB_APP_URL: webOrigin,
        DEV_AUTH_ENABLED: 'false',
        HOST: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (chunk) => process.stdout.write(`[local-auth-api] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[local-auth-api] ${chunk}`))
  return child
}

function signalProcess(child, signal) {
  if (!child?.pid) return
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // Fall back to the wrapper process.
  }
  try {
    child.kill(signal)
  } catch {
    // The process may already have exited.
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    let finished = false
    let forceTimer
    let finalTimer
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(forceTimer)
      clearTimeout(finalTimer)
      resolve()
    }
    child.once('exit', finish)
    signalProcess(child, 'SIGTERM')
    forceTimer = setTimeout(() => signalProcess(child, 'SIGKILL'), 3_000)
    finalTimer = setTimeout(finish, 8_000)
  })
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  expect(address && typeof address === 'object', 'Unable to allocate a local API port.')
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForReady(apiUrl) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/ready`)
      if (response.ok) return
    } catch {
      // Continue until the bounded timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${apiUrl}/ready`)
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => null)
  expect(body !== null, `${label} did not return JSON.`)
  return body
}

async function localLogin(apiUrl) {
  const response = await fetch(`${apiUrl}/api/auth/local/start`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: webOrigin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(),
  })
  expect(response.status === 303, `Local sign-in returned ${response.status}, expected 303.`)
  expect(
    response.headers.get('location') === `${webOrigin}/legacy-shell`,
    'Local sign-in did not use the fixed legacy-shell redirect.',
  )
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  expect(cookie?.startsWith('devflow_session='), 'Local sign-in did not set a session cookie.')
  return cookie
}

async function jsonRequest(url, { method = 'GET', cookie, bearer, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const payload = response.status === 204 ? null : await responseJson(response, url)
  return { response, payload }
}

const schemaName = `devflow_local_auth_${process.pid}_${Date.now()}`
expect(/^[a-z0-9_]+$/.test(schemaName), 'Generated smoke schema name was unsafe.')
const databaseUrl = scopedDatabaseUrl(baseDatabaseUrl, schemaName)
const adminPool = new Pool({
  connectionString: baseDatabaseUrl,
  application_name: 'ai-devflow-local-auth-postgres-smoke-admin',
  statement_timeout: 10_000,
})
let api

try {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
  })

  const port = await availablePort()
  const apiUrl = `http://127.0.0.1:${port}`
  api = spawnApi(port, databaseUrl)
  await waitForReady(apiUrl)

  const [firstCookie, secondCookie] = await Promise.all([
    localLogin(apiUrl),
    localLogin(apiUrl),
  ])
  expect(firstCookie && secondCookie, 'Concurrent local sign-in did not return two sessions.')

  const sessionResult = await jsonRequest(`${apiUrl}/api/auth/session`, {
    cookie: firstCookie,
  })
  expect(sessionResult.response.status === 200, 'Local session lookup failed.')
  expect(
    JSON.stringify(sessionResult.payload) === JSON.stringify({
      user: { id: 'u-local-owner', name: 'Local Developer', role: 'owner' },
      authentication: { provider: 'local-development' },
    }),
    'Local session projection did not match the fixed development identity.',
  )

  const initialOverview = await jsonRequest(`${apiUrl}/api/team/overview`, {
    cookie: firstCookie,
  })
  expect(initialOverview.response.status === 200, 'Local Team Overview failed to load.')
  expect(
    Array.isArray(initialOverview.payload.projects) &&
      initialOverview.payload.projects.length === 0,
    'Fresh local Team Overview was not project-empty.',
  )

  const projectResult = await jsonRequest(`${apiUrl}/api/team/projects`, {
    method: 'POST',
    cookie: firstCookie,
    body: {
      name: 'Local Mini Agent',
      slug: 'local-mini-agent',
      description: 'Local authentication vertical smoke project.',
      repository: 'local/devflow-mini-agent',
    },
  })
  expect(projectResult.response.status === 201, 'Local Team Project creation failed.')
  expect(projectResult.payload.id === 'p-local-mini-agent', 'Local Team Project ID was unexpected.')

  const budgetResult = await jsonRequest(`${apiUrl}/api/runtime/budget-policy`, {
    method: 'PUT',
    cookie: firstCookie,
    body: {
      projectId: projectResult.payload.id,
      enabled: true,
      monthlyLimitUsd: 25,
      warningThresholdUsd: 20,
    },
  })
  expect(
    budgetResult.response.status === 200 &&
      budgetResult.payload.projectId === projectResult.payload.id,
    'Local runtime budget policy was not saved.',
  )

  const pairingResult = await jsonRequest(
    `${apiUrl}/api/team/projects/${projectResult.payload.id}/pairing-codes`,
    { method: 'POST', cookie: firstCookie, body: {} },
  )
  expect(
    pairingResult.response.status === 201 &&
      typeof pairingResult.payload.code === 'string',
    'Local Desktop pairing code creation failed.',
  )
  const exchangeResult = await jsonRequest(`${apiUrl}/api/desktop/pairing/exchange`, {
    method: 'POST',
    body: { code: pairingResult.payload.code },
  })
  expect(
    exchangeResult.response.status === 201 &&
      typeof exchangeResult.payload.token === 'string',
    'Local Desktop pairing code exchange failed.',
  )

  const bearerOverview = await jsonRequest(`${apiUrl}/api/team/overview`, {
    bearer: exchangeResult.payload.token,
  })
  expect(bearerOverview.response.status === 200, 'Paired Desktop bearer could not read Team data.')
  expect(
    bearerOverview.payload.projects.some(
      (project) => project.id === projectResult.payload.id,
    ),
    'Paired Desktop bearer did not receive the local Team Project.',
  )

  const scopedPool = new Pool({
    connectionString: databaseUrl,
    application_name: 'ai-devflow-local-auth-postgres-smoke-assertion',
    statement_timeout: 10_000,
  })
  try {
    const identityRows = await scopedPool.query(
      `SELECT
         (SELECT count(*)::integer FROM organizations WHERE id = 'org-local') AS organizations,
         (SELECT count(*)::integer FROM users WHERE id = 'u-local-owner') AS users,
         (SELECT count(*)::integer FROM auth_accounts
          WHERE id = 'acct-local-owner'
            AND provider = 'local-development'
            AND provider_account_id = 'local-owner') AS accounts`,
    )
    expect(
      JSON.stringify(identityRows.rows[0]) ===
        JSON.stringify({ organizations: 1, users: 1, accounts: 1 }),
      'Concurrent local sign-in did not preserve exactly one fixed identity.',
    )
  } finally {
    await scopedPool.end()
  }

  console.log(
    'Local auth Postgres smoke passed: login, empty overview, project, budget, pairing, and bearer read.',
  )
} finally {
  await stopProcess(api)
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  } finally {
    await adminPool.end()
  }
}
