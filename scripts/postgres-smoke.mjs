import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
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
const gateRunId = `run-postgres-gate-smoke-${suffix}`
const gateNodeId = 'n-design-gate'
const evidenceId = `evidence-postgres-smoke-${suffix}`
const remoteReviewId = `agent-review-postgres-smoke-${suffix}`
const timestamp = new Date().toISOString()
const pairedTamperTimestamp = new Date(Date.now() + 250).toISOString()
const pairedGateTimestamp = new Date(Date.now() + 500).toISOString()
const completedTimestamp = new Date(Date.now() + 1_000).toISOString()
let api

try {
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
  })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:seed'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
  })

  api = spawnService('api-postgres', ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DEVFLOW_DATABASE_URL: databaseUrl,
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    DEVFLOW_REQUIRE_AUTH: 'true',
    DEVFLOW_SESSION_SECRET: sessionSecret,
    DEV_AUTH_ENABLED: 'true',
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
