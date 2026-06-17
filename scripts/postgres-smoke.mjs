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

  child.devflowStopping = true
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

async function fetchOverview(label = '/api/team/overview') {
  return readJson(
    await fetch(`${apiUrl}/api/team/overview`, {
      headers: { accept: 'application/json', ...demoSessionHeaders },
    }),
    label,
  )
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
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

const suffix = Date.now()
const runId = `run-postgres-smoke-${suffix}`
const evidenceId = `evidence-postgres-smoke-${suffix}`
const remoteReviewId = `agent-review-postgres-smoke-${suffix}`
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
  expectNoLocalOnlyFields(syncedOverview, 'synced overview')

  console.log('Postgres integration smoke passed.')
} finally {
  stop(api)
}
