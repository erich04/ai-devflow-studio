import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const apiUrl = 'http://127.0.0.1:4322'
const databaseUrl = process.env.DEVFLOW_DATABASE_URL ?? process.env.DATABASE_URL
const demoSessionHeaders = {
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
}

if (!databaseUrl) {
  throw new Error('Set DEVFLOW_DATABASE_URL or DATABASE_URL before running test:postgres-smoke.')
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`)
  })

  return child
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

function stop(child) {
  if (!child || child.killed) {
    return
  }

  child.kill('SIGTERM')
}

async function readJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

async function postJson(pathname, body) {
  return readJson(
    await fetch(`${apiUrl}${pathname}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...demoSessionHeaders,
      },
      body: JSON.stringify(body),
    }),
    pathname,
  )
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const runId = `run-postgres-smoke-${Date.now()}`
const evidenceId = `evidence-postgres-smoke-${Date.now()}`
const timestamp = new Date().toISOString()
let api

try {
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
  })

  api = spawnService('api-postgres', ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
    DEVFLOW_REQUIRE_AUTH: 'true',
    PORT: '4322',
  })
  await waitForServer(`${apiUrl}/health`)

  const initialOverview = await readJson(
    await fetch(`${apiUrl}/api/team/overview`, {
      headers: { accept: 'application/json', ...demoSessionHeaders },
    }),
    '/api/team/overview',
  )
  expect(
    initialOverview.projects?.some((project) => project.id === 'p-payments'),
    'Postgres overview did not include seeded Payments project.',
  )
  expect(
    initialOverview.runs?.some((run) => run.id === 'run-health-001'),
    'Postgres overview did not include seeded workflow run.',
  )

  await postJson('/api/sync/run-summary', {
    kind: 'run',
    runId,
    projectId: 'p-payments',
    title: 'Postgres smoke synced run',
    status: 'testing',
    currentNodeId: 'n-test',
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

  const syncedOverview = await readJson(
    await fetch(`${apiUrl}/api/team/overview`, {
      headers: { accept: 'application/json', ...demoSessionHeaders },
    }),
    '/api/team/overview',
  )
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

  console.log('Postgres integration smoke passed.')
} finally {
  stop(api)
}
