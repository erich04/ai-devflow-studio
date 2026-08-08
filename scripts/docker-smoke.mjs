import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { createSessionCookie } from '../apps/api/src/auth/session-cookie'

const projectName = `devflow-docker-smoke-${Date.now()}`
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const apiPort = await findOpenPort()
const webPort = await findOpenPort()
const sessionSecret = 'devflow-docker-smoke-hmac-key-non-production-32-plus'
const agentCredentialKey = 'devflow-docker-smoke-agent-key-non-production-32-plus'
const composeEnv = {
  ...process.env,
  DEVFLOW_AGENT_CREDENTIAL_KEY: agentCredentialKey,
  DEVFLOW_API_PORT: String(apiPort),
  DEVFLOW_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  DEVFLOW_WEB_APP_URL: `http://127.0.0.1:${webPort}`,
  DEVFLOW_WEB_PORT: String(webPort),
  DEV_AUTH_ENABLED: 'false',
  DEVFLOW_REQUIRE_AUTH: 'true',
  DEVFLOW_SESSION_SECRET: sessionSecret,
  GITHUB_CLIENT_ID: 'docker-smoke-oauth-client',
  GITHUB_CLIENT_SECRET: 'docker-smoke-oauth-secret-not-production',
  GITHUB_OAUTH_REDIRECT_URI: `http://127.0.0.1:${apiPort}/api/auth/github/callback`,
  POSTGRES_DB: 'devflow',
  POSTGRES_PASSWORD: 'devflow',
  POSTGRES_USER: 'postgres',
}

const pilotSessionCookie = createSessionCookie(
  { authAccountId: 'acct-demo-u-erich' },
  sessionSecret,
).split(';', 1)[0]
const pilotSessionHeaders = {
  cookie: pilotSessionCookie,
}

function runDocker(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: repoRoot,
      env: composeEnv,
      stdio: options.stdio ?? 'inherit',
    })

    let stdout = ''
    let stderr = ''
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`docker ${args.join(' ')} exited with ${code}\n${stdout}${stderr}`))
      }
    })
  })
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port)
          return
        }
        reject(new Error('Unable to allocate an open port.'))
      })
    })
  })
}

async function waitForJson(url, label, headers = {}) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json', ...headers } })
      if (response.ok) {
        return response.json()
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function waitForText(url, label) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return response.text()
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
  })
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function bearerHeaders(token) {
  return { authorization: `Bearer ${token}` }
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
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

try {
  await runDocker(['compose', '-p', projectName, 'up', '--build', '-d'])

  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://127.0.0.1:${webPort}`
  const health = await waitForJson(`${apiUrl}/health`, 'API health')
  expect(health.status === 'ok', 'API health did not return ok.')
  const readiness = await waitForJson(`${apiUrl}/ready`, 'API readiness')
  expect(readiness.status === 'ready', 'API readiness did not return ready.')
  await runDocker(['compose', '-p', projectName, 'run', '--rm', 'seed'])
  const webHtml = await waitForText(webUrl, 'Web console')
  expect(webHtml.includes('AI DevFlow') || webHtml.includes('__next'), 'Web console did not render.')
  const staticAssetPath = Array.from(
    webHtml.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g),
    (match) => match[1],
  ).find((candidate) => /[a-f0-9]{8,}\.(?:css|js)$/.test(candidate))
  expect(
    staticAssetPath?.startsWith('/_next/static/'),
    'Docker Web page did not reference a hashed static asset.',
  )
  const assetResponse = await fetch(`${webUrl}${staticAssetPath}`)
  const assetBytes = await assetResponse.arrayBuffer()
  expect(
    assetResponse.ok && assetBytes.byteLength > 0,
    'Docker Web hashed static asset was unavailable.',
  )

  const oauthStart = await fetch(`${apiUrl}/api/auth/github/start`, {
    redirect: 'manual',
  })
  expect(oauthStart.status === 302, 'Docker GitHub OAuth start did not redirect.')
  expect(
    oauthStart.headers.get('location')?.startsWith('https://github.com/login/oauth/authorize'),
    'Docker GitHub OAuth start did not target GitHub.',
  )
  expect(
    oauthStart.headers.get('set-cookie')?.includes('devflow_oauth_state='),
    'Docker GitHub OAuth start did not set its state cookie.',
  )

  const pairingCode = await postJson(
    `${apiUrl}/api/team/projects/p-payments/pairing-codes`,
    {},
    pilotSessionHeaders,
  )
  expect(pairingCode.code?.includes('.'), 'Docker smoke did not create a copy-once pairing code.')
  const desktopPairing = await postJson(`${apiUrl}/api/desktop/pairing/exchange`, {
    code: pairingCode.code,
  })
  expect(desktopPairing.token?.includes('.'), 'Docker smoke did not exchange the pairing code for a token.')

  const runId = `run-docker-smoke-${Date.now()}`
  const nodeId = 'n-design-gate'
  const createdWorkRequest = await postJson(
    `${apiUrl}/api/team/projects/p-payments/work-requests`,
    {
      projectId: 'p-payments',
      title: 'Docker Gate Command smoke',
      request: 'Exercise the production-stack human rejection path.',
      idempotencyKey: `work-request:create:${runId}`,
      expiresAt: null,
    },
    pilotSessionHeaders,
  )
  const workRequest = createdWorkRequest.workRequest
  expect(
    workRequest?.version === 1 && workRequest.status === 'open',
    'Docker smoke did not create an open Work Request v1.',
  )
  const claimedWorkRequest = await postJson(
    `${apiUrl}/api/desktop/work-requests/${workRequest.id}/claim`,
    {
      workRequestId: workRequest.id,
      expectedVersion: 1,
      runId,
      idempotencyKey: `work-request:claim:${runId}`,
    },
    bearerHeaders(desktopPairing.token),
  )
  expect(
    claimedWorkRequest.workRequest?.version === 2 &&
      claimedWorkRequest.workRequest.status === 'claim_pending',
    'Docker smoke did not claim the Work Request at v2.',
  )
  const materializedWorkRequest = await postJson(
    `${apiUrl}/api/desktop/work-requests/${workRequest.id}/materialized`,
    {
      workRequestId: workRequest.id,
      expectedVersion: 2,
      runId,
      idempotencyKey: `work-request:materialize:${runId}`,
    },
    bearerHeaders(desktopPairing.token),
  )
  expect(
    materializedWorkRequest.workRequest?.version === 3 &&
      materializedWorkRequest.workRequest.status === 'materialized',
    'Docker smoke did not materialize the Work Request at v3.',
  )

  await postJson(
    `${apiUrl}/api/sync/run-summary`,
    {
      kind: 'run',
      runId,
      version: 3,
      projectId: 'p-payments',
      title: 'Docker Gate Command vertical smoke',
      status: 'paused_at_gate',
      currentNodeId: nodeId,
      currentNode: {
        id: nodeId,
        stage: 'design',
        kind: 'gate',
        status: 'blocked',
        requiredRole: 'lead',
      },
      branchName: 'codex/docker-gate-smoke',
      updatedAt: new Date().toISOString(),
    },
    bearerHeaders(desktopPairing.token),
  )
  const gateEvaluation = await postJson(
    `${apiUrl}/api/enforcement/evaluate`,
    { projectId: 'p-payments', runId, nodeId },
    pilotSessionHeaders,
  )
  const expectedBlockerIds = gateEvaluation.blockingReasons
    .map((reason) => reason.id)
    .sort()
  const createdGateCommand = await postJson(
    `${apiUrl}/api/team/projects/p-payments/gate-commands`,
    {
      projectId: 'p-payments',
      runId,
      nodeId,
      action: 'reject',
      reason: 'The pilot operator intentionally rejects this Docker smoke Gate.',
      expectedRunVersion: 3,
      expectedPolicyVersion: gateEvaluation.policyVersion,
      expectedBlockerIds,
      idempotencyKey: `gate-command:create:${runId}:v3`,
    },
    pilotSessionHeaders,
  )
  const command = createdGateCommand.command
  expect(
    command?.workRequestId === workRequest.id &&
      command.status === 'pending' &&
      command.action === 'reject',
    'Docker smoke did not bind the reject command to the materialized Work Request.',
  )
  const gateInbox = await getJson(
    `${apiUrl}/api/desktop/projects/p-payments/gate-commands/inbox`,
    bearerHeaders(desktopPairing.token),
  )
  expect(
    gateInbox.commands?.some((candidate) => candidate.id === command.id),
    'Docker smoke Desktop inbox did not include the Gate Command.',
  )
  const createdReceipt = await postJson(
    `${apiUrl}/api/desktop/gate-commands/${command.id}/receipts`,
    {},
    bearerHeaders(desktopPairing.token),
  )
  const receipt = createdReceipt.receipt
  expect(
    receipt?.commandId === command.id && receipt.acknowledgedAt === null,
    'Docker smoke did not create an active Gate Command receipt.',
  )
  const overviewBeforeAcknowledgement = await waitForJson(
    `${apiUrl}/api/team/overview`,
    'Team overview before Gate acknowledgement',
    pilotSessionHeaders,
  )
  const teamRunBeforeAcknowledgement = overviewBeforeAcknowledgement.runs?.find(
    (run) => run.id === runId,
  )
  expect(
    teamRunBeforeAcknowledgement,
    'Docker smoke overview did not include the bearer-token synced run before Gate ACK.',
  )
  const createdAcknowledgement = await postJson(
    `${apiUrl}/api/desktop/gate-command-receipts/${receipt.id}/acknowledgements`,
    {
      commandId: command.id,
      outcomeCode: 'human_rejected',
      beforeRunVersion: 3,
      afterRunVersion: 3,
      evaluatedAt: receipt.leasedAt,
    },
    bearerHeaders(desktopPairing.token),
  )
  const overview = await waitForJson(
    `${apiUrl}/api/team/overview`,
    'Team overview',
    pilotSessionHeaders,
  )
  const teamRun = overview.runs?.find((run) => run.id === runId)
  expect(teamRun, 'Docker smoke overview did not include the bearer-token synced run.')
  expect(
    teamRun.version === teamRunBeforeAcknowledgement.version,
    'Docker smoke Gate ACK mutated the Team Run version.',
  )
  expect(
    teamRun.status === teamRunBeforeAcknowledgement.status,
    'Docker smoke Gate ACK mutated the Team Run status.',
  )
  expect(
    teamRun.currentNodeId === teamRunBeforeAcknowledgement.currentNodeId,
    'Docker smoke Gate ACK mutated the Team Run current node.',
  )
  expect(
    createdAcknowledgement.acknowledgement?.outcomeCode === 'human_rejected' &&
      createdAcknowledgement.command?.status === 'applied',
    'Docker smoke did not acknowledge the human rejection.',
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
      overviewBeforeAcknowledgement,
      createdAcknowledgement,
      overview,
    },
    [
      pairingCode.code,
      desktopPairing.token,
      pilotSessionCookie,
      sessionSecret,
      agentCredentialKey,
    ],
    'Docker Gate vertical smoke responses',
  )

  console.log(`Docker smoke passed: API ${apiUrl}, Web ${webUrl}`)
} finally {
  await runDocker(['compose', '-p', projectName, 'down', '-v', '--remove-orphans']).catch(() => undefined)
}
