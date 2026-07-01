import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { _electron as electron, chromium, expect } from '@playwright/test'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const devServerUrl = 'http://127.0.0.1:5173'
const apiServerUrl = 'http://127.0.0.1:4310'
const webServerUrl = 'http://127.0.0.1:4311'
const smokeReviewProviderId = 'electron-smoke-review'
const smokeReviewModel = 'smoke-review-model'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-electron-smoke-'))
const repoDir = path.join(tempRoot, 'fixture-repo')
const userDataDir = path.join(tempRoot, 'user-data')
const blockedCommand = 'powershell Remove-Item -Recurse -Force C:\\devflow'
const demoSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
}
const leadSessionHeaders = {
  ...demoSessionHeaders,
  'x-devflow-user-id': 'u-ling',
  'x-devflow-user-role': 'lead',
  'x-devflow-project-roles': 'p-payments:lead',
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options,
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

function spawnQuiet(command, args, env = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options, label) {
  let lastError
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await fetch(url, options)
    } catch (error) {
      lastError = error
      await delay(500)
    }
  }

  throw new Error(`${label} failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
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

    await delay(1000)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function stopSpawnedProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  const kill = (signal) => {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal)
    } else {
      child.kill(signal)
    }
  }

  try {
    kill('SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }

  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3_000).then(() => false),
  ])

  if (exited === false && child.exitCode === null && child.signalCode === null) {
    try {
      kill('SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function assertSmokePortsAvailable() {
  const ports = [4310, 4311, 5173]
  const occupied = []
  for (const port of ports) {
    if (await isPortOpen(port)) {
      occupied.push(port)
    }
  }

  if (occupied.length > 0) {
    throw new Error(
      `Electron smoke requires clean dev ports, but these are already listening: ${occupied.join(', ')}`,
    )
  }
}

async function startReviewProviderMock() {
  const requests = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }

      let rawBody = ''
      request.setEncoding('utf8')
      for await (const chunk of request) {
        rawBody += chunk
      }
      requests.push(JSON.parse(rawBody))

      const isWorkflowArtifact =
        rawBody.includes('title, summary, goals') || rawBody.includes('acceptanceCriteria')
      const content = isWorkflowArtifact
        ? {
            title: '需求澄清结果',
            summary: 'Smoke clarification artifact.',
            content: 'Acceptance Criteria\n- Smoke acceptance captured.',
            goals: ['Clarify webhook retry scope.'],
            acceptanceCriteria: ['Smoke acceptance captured.'],
            nonGoals: [],
            openQuestions: [],
            assumptions: ['Local smoke provider.'],
            risks: [],
          }
        : {
            conclusion: 'warning-only',
            summary: 'Build redacted context before approval.',
            risks: ['Missing test evidence.'],
            missingEvidence: ['Attach passing test evidence.'],
            suggestedTests: ['pnpm test'],
            confidence: 0.82,
            policyFindings: [
              {
                severity: 'low',
                category: 'review_gap',
                summary: 'Build redacted context',
              },
            ],
          }

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(content) } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            cached_tokens: 5,
          },
        }),
      )
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { message: error instanceof Error ? error.message : String(error) },
        }),
      )
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Review provider mock did not bind to a TCP port.'))
        return
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()))
          }),
      })
    })
  })
}

async function launchApp() {
  const app = await electron.launch({
    args: ['.'],
    cwd: desktopDir,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDir,
      DEVFLOW_API_BASE_URL: apiServerUrl,
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_INITIAL_THEME: 'dark',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: devServerUrl,
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function saveSmokeReviewProvider(page, baseUrl) {
  await page.evaluate(
    async ({ providerId, providerBaseUrl, model }) => {
      await window.aiDevFlowDesktop.saveAgentProviderCredential({
        providerId,
        baseUrl: providerBaseUrl,
        model,
        apiKey: 'sk-electron-smoke',
      })
    },
    {
      providerId: smokeReviewProviderId,
      providerBaseUrl: baseUrl,
      model: smokeReviewModel,
    },
  )
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

async function saveRecommendedEnforcementPolicy() {
  const response = await fetchWithRetry(
    `${apiServerUrl}/api/enforcement/policy`,
    {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...demoSessionHeaders,
      },
      body: JSON.stringify({
        organizationPolicy: createRecommendedEnforcementPolicy(1, new Date().toISOString()),
      }),
    },
    'save recommended enforcement policy',
  )

  if (!response.ok) {
    throw new Error(`Unable to save Electron smoke enforcement policy: ${response.status} ${await response.text()}`)
  }
}

async function saveAgentFindingBlockingPolicy() {
  const updatedAt = new Date().toISOString()
  const policy = createRecommendedEnforcementPolicy(2, updatedAt)
  policy.id = 'enforcement-policy-org-demo-agent-finding-block'
  policy.name = 'Agent finding blocking smoke policy'
  policy.rules = policy.rules.map((rule) =>
    rule.ruleKey === 'agent_finding:review_gap:low'
      ? {
          ...rule,
          defaultAction: 'block',
          floorAction: 'block',
          remediation: 'Address the Agent Review finding with a focused implementation retry.',
          updatedAt,
        }
      : { ...rule, updatedAt },
  )

  const response = await fetchWithRetry(
    `${apiServerUrl}/api/enforcement/policy`,
    {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...leadSessionHeaders,
      },
      body: JSON.stringify({ organizationPolicy: policy }),
    },
    'save agent finding blocking policy',
  )

  if (!response.ok) {
    throw new Error(`Unable to save Electron smoke retry enforcement policy: ${response.status} ${await response.text()}`)
  }
}

async function createSmokePairingCode() {
  const response = await fetchWithRetry(
    `${apiServerUrl}/api/team/projects/p-payments/pairing-codes`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...leadSessionHeaders,
      },
      body: JSON.stringify({}),
    },
    'create desktop pairing code',
  )

  if (!response.ok) {
    throw new Error(`Unable to create Electron smoke pairing code: ${response.status} ${await response.text()}`)
  }

  const body = await response.json()
  if (typeof body.code !== 'string' || !body.code.includes('.')) {
    throw new Error('Electron smoke pairing code was not returned as a copy-once secret.')
  }

  return body.code
}

async function selectRunByTitle(page, title) {
  const runRow = page.locator('.run-row').filter({ hasText: title })
  await expect(runRow).toBeVisible()
  await runRow.click()
  await expect(runRow).toHaveClass(/is-selected/)
}

function resolveWorkflowNodes(run) {
  const findNode = (stage, kind) => run.nodes.find((node) => node.stage === stage && node.kind === kind)
  const nodes = {
    clarifyGate: findNode('clarify', 'gate'),
    designGate: findNode('design', 'gate'),
    build: findNode('build', 'task'),
    test: findNode('test', 'test'),
    pr: findNode('pr', 'pr'),
    accept: findNode('accept', 'acceptance'),
  }

  for (const [label, node] of Object.entries(nodes)) {
    if (!node) {
      throw new Error(`Electron smoke could not resolve ${label} node for Run ${run.id}`)
    }
  }

  return nodes
}

async function selectWorkflowNode(page, testId, expectedTitle) {
  const node = page.getByTestId(testId)
  const inspector = page.getByTestId('node-inspector')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(node).toBeAttached()
    await node.dispatchEvent('click')

    try {
      await expect(inspector).toContainText(expectedTitle, { timeout: 2_000 })
      return
    } catch (error) {
      if (attempt === 2) {
        throw error
      }
    }
  }
}

async function selectThemePreference(page, preference) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('html').getAttribute('data-theme-preference')) === preference) {
      return
    }
    await page.getByTestId('theme-toggle').click()
  }

  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', preference)
}

async function persistThemePreference(page, preference) {
  await selectThemePreference(page, preference)
  await page.evaluate(async (themePreference) => {
    await window.aiDevFlowDesktop.saveSettings({ themePreference })
  }, preference)
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        return (await window.aiDevFlowDesktop.loadState()).settings.themePreference
      }),
    )
    .toBe(preference)
}

async function runKnowledgeReviewViaDesktopApi(
  page,
  { runId, nodeId, projectId, runTitle, nodeTitle },
) {
  const persistedReview = await page.evaluate(async (input) => {
    const stateBeforeReview = await window.aiDevFlowDesktop.loadState()
    const runSnapshot = stateBeforeReview.runs.find((run) => run.id === input.runId)
    const result = await window.aiDevFlowDesktop.runKnowledgeReview({
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      requestedBy: 'u-erich',
      runtime: 'electron',
      providerId: input.providerId,
    })
    if (runSnapshot) {
      await window.aiDevFlowDesktop.saveRun(runSnapshot)
    }
    const reviews = await window.aiDevFlowDesktop.listAgentReviews({ runId: input.runId })
    const matched = reviews.find((review) => review.id === result.review.id)
    if (!matched) {
      throw new Error(`Knowledge Review was not persisted for ${input.nodeId}`)
    }
    return { id: matched.id, nodeId: matched.nodeId }
  }, { runId, nodeId, projectId, providerId: smokeReviewProviderId })

  expect(persistedReview.nodeId).toBe(nodeId)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(page, `flow-node-${nodeId}`, nodeTitle)
  await page.getByRole('button', { name: /^Agents$/ }).click()
}

async function runCodingAgentViaDesktopApi(
  page,
  { runId, nodeId, projectId, runTitle, nodeTitle },
) {
  const codingRun = await page.evaluate(async (input) => {
    const result = await window.aiDevFlowDesktop.runCodingAgent({
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      requestedBy: 'u-erich',
      providerId: 'fake-coding-engine',
      userInstruction: 'Electron smoke should archive a fake implementation diff.',
    })
    if (result.codingRun.nodeId !== input.nodeId) {
      throw new Error(`Coding run started for unexpected node: ${result.codingRun.nodeId}`)
    }
    return { id: result.codingRun.id, status: result.codingRun.status }
  }, { runId, nodeId, projectId })

  expect(codingRun.status).toBe('waiting_permission')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(page, `flow-node-${nodeId}`, nodeTitle)
  await page.getByRole('button', { name: /^Agents$/ }).click()
}

async function startRetryAttemptViaDesktopApi(
  page,
  { runId, nodeId, projectId, runTitle, nodeTitle },
) {
  const candidateId = `remediation-candidate-${runId}-${nodeId}-1`
  const retryAttempt = await page.evaluate(async (input) => {
    const result = await window.aiDevFlowDesktop.startRetryAttempt({
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      requestedBy: 'u-erich',
      providerId: 'fake-coding-engine',
      candidateIds: [input.candidateId],
      userInstruction: 'Electron smoke should retry coding from the remediation candidate.',
    })
    if (!result.retryAttempt.candidateIds.includes(input.candidateId)) {
      throw new Error(`Retry attempt did not include candidate ${input.candidateId}`)
    }
    return {
      id: result.retryAttempt.id,
      status: result.retryAttempt.status,
      codingRunId: result.retryAttempt.codingRunId,
    }
  }, { runId, nodeId, projectId, candidateId })

  expect(retryAttempt.status).toBe('started')
  expect(typeof retryAttempt.codingRunId).toBe('string')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(page, `flow-node-${nodeId}`, nodeTitle)
  await page.getByRole('button', { name: /^Agents$/ }).click()
}

async function runProjectTestsViaDesktopApi(
  page,
  { runId, nodeId, projectId, runTitle },
) {
  const evidence = await page.evaluate(async (input) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const run = state.runs.find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found for test execution: ${input.runId}`)
    }
    const result = await window.aiDevFlowDesktop.runProjectTests({
      projectId: input.projectId,
      runId: input.runId,
      nodeId: input.nodeId,
      run,
    })
    return { id: result.evidence.id, status: result.evidence.status, command: result.evidence.command }
  }, { runId, nodeId, projectId })

  expect(evidence.status).toBe('passed')
  expect(evidence.command).toBe('npm test')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /^测试$/ }).click()
}

let vite
let api
let web
let reviewProviderMock

try {
  await assertSmokePortsAvailable()
  reviewProviderMock = await startReviewProviderMock()

  await mkdir(repoDir, { recursive: true })
  await writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify({
      name: 'electron-smoke-fixture',
      scripts: {
        test: 'node test.js',
      },
    }),
  )
  await writeFile(path.join(repoDir, 'test.js'), "console.log('smoke passed');\n")
  await run('git', ['init'], { cwd: repoDir })
  await run('git', ['config', 'user.email', 'devflow@example.com'], { cwd: repoDir })
  await run('git', ['config', 'user.name', 'DevFlow Smoke'], { cwd: repoDir })
  await run('git', ['add', '.'], { cwd: repoDir })
  await run('git', ['commit', '-m', 'fixture'], { cwd: repoDir })

  await run(corepack, ['pnpm', '--filter', '@ai-devflow/desktop', 'build'])

  api = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
  })
  web = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/web', 'dev'], {
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    DEVFLOW_API_BASE_URL: apiServerUrl,
    NEXT_PUBLIC_DEVFLOW_API_URL: apiServerUrl,
  })
  vite = spawnQuiet(corepack, [
    'pnpm',
    '--filter',
    '@ai-devflow/desktop',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    '5173',
    '--strictPort',
  ])
  await Promise.all([
    waitForServer(`${apiServerUrl}/health`),
    waitForServer(webServerUrl),
    waitForServer(devServerUrl),
  ])
  await saveRecommendedEnforcementPolicy()
  const pairingCode = await createSmokePairingCode()

  const first = await launchApp()
  await first.page.evaluate(async (code) => {
    await window.aiDevFlowDesktop.pairDesktop({ code })
  }, pairingCode)
  await saveSmokeReviewProvider(first.page, reviewProviderMock.baseUrl)
  await persistThemePreference(first.page, 'dark')
  await first.app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
    })
  }, repoDir)

  const security = await first.page.evaluate(() => ({
    hasApi: typeof window.aiDevFlowDesktop === 'object',
    hasRequire: typeof window.require !== 'undefined',
    hasProcess: typeof window.process !== 'undefined',
  }))
  expect(security).toEqual({ hasApi: true, hasRequire: false, hasProcess: false })
  const remoteSeedRun = await first.page.evaluate(async () => {
    const snapshot = await window.aiDevFlowDesktop.loadRemoteSnapshot()
    const run = snapshot.runs.find((candidate) => candidate.id === 'run-health-001')
    if (!run) {
      throw new Error('Electron smoke could not find the seeded team Run.')
    }
    await window.aiDevFlowDesktop.saveRun(run)
    return run
  })

  const seededGateDecision = await first.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId: 'n-clarify-gate',
      projectId: 'p-payments',
    })
  }, remoteSeedRun.id)
  expect(seededGateDecision.status).toBe('blocked')
  expect(seededGateDecision.blocksApproval).toBe(true)
  const seededDirectApproveRejected = await first.page.evaluate(async (runId) => {
    try {
      await window.aiDevFlowDesktop.approveGate({
        runId,
        nodeId: 'n-clarify-gate',
        projectId: 'p-payments',
        userId: 'u-erich',
        userName: 'Erich',
        role: 'owner',
      })
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('override_required')
    }
  }, remoteSeedRun.id)
  expect(seededDirectApproveRejected).toBe(true)
  const confirmedTeamOverride = await first.page.evaluate(async ({ runId, decision }) => {
    return window.aiDevFlowDesktop.saveGateOverride({
      runId,
      nodeId: 'n-clarify-gate',
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead',
      reason: 'Electron smoke confirmed team override for missing Knowledge Review.',
      blockedReasonIds: decision.blockingReasons.map((reason) => reason.id),
      policyVersion: decision.policyVersion,
      provisional: false,
    })
  }, { runId: remoteSeedRun.id, decision: seededGateDecision })
  if (confirmedTeamOverride.status !== 'accepted') {
    throw new Error(`Electron smoke team override was not accepted: ${JSON.stringify(confirmedTeamOverride)}`)
  }
  expect(confirmedTeamOverride.status).toBe('accepted')
  const confirmedTeamApproval = await first.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.approveGate({
      runId,
      nodeId: 'n-clarify-gate',
      projectId: 'p-payments',
      userId: 'u-ling',
      userName: 'Ling',
      role: 'lead',
    })
  }, remoteSeedRun.id)
  expect(confirmedTeamApproval.event.kind).toBe('approval')

  await expect(first.page.getByTestId('runtime-source-badge')).toContainText('local SQLite empty')
  await expect(first.page.getByTestId('workflow-empty-state')).toContainText('暂无 Run')
  await expect(first.page.getByTestId('node-inspector-empty')).toContainText('选择真实 Run')

  await first.page.getByRole('button', { name: /选择本地仓库/ }).click()
  await expect(first.page.locator('.local-project-panel').getByText('electron-smoke-fixture')).toBeVisible()
  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(first.page.getByLabel('测试命令')).toHaveValue('npm test')
  await expect(first.page.getByText(/safe/i)).toBeVisible()
  const localProjectId = await first.page.evaluate(async (repoPath) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const project = state.projects.find((candidate) => candidate.path === repoPath)
    if (!project) {
      throw new Error(`Local project not found for smoke repo: ${repoPath}`)
    }
    return project.id
  }, repoDir)

  await first.page.getByRole('button', { name: /Knowledge/ }).click()
  await expect(first.page.getByTestId('knowledge-view')).toContainText('Knowledge Governance')
  await first.page.getByLabel('Search runs and knowledge').fill('api')
  await expect(first.page.getByTestId('knowledge-view')).toContainText('没有匹配的知识文档')
  await expect(first.page.getByTestId('knowledge-view')).toContainText('没有匹配的知识节点')
  await expect(first.page.getByTestId('search-results')).toContainText('没有匹配结果')
  await first.page.getByLabel('Search runs and knowledge').fill('')
  await first.page.getByRole('button', { name: /工作台/ }).click()

  await persistThemePreference(first.page, 'light')
  await persistThemePreference(first.page, 'dark')

  await first.page.getByRole('button', { name: /^MCP$/ }).click()
  await expect(first.page.getByTestId('mcp-view')).toContainText('本机工具连接器')
  const firstDisableMcpButton = first.page.getByRole('button', { name: /Disable/ }).first()
  if ((await firstDisableMcpButton.count()) > 0) {
    await firstDisableMcpButton.click()
    await expect(first.page.getByRole('button', { name: /Enable/ }).first()).toBeVisible()
  } else {
    await expect(first.page.getByTestId('mcp-view')).toContainText('未加载本地 MCP 连接器')
  }

  await first.page.getByRole('button', { name: /工作台/ }).click()
  await first.page.getByRole('button', { name: /新建 Run/ }).click()
  const createRunDialog = first.page.getByRole('dialog', { name: /Create new run/ })
  await createRunDialog.getByLabel('标题').fill('重构 GitHub webhook 重试策略')
  await createRunDialog.getByLabel('一句话需求').fill('请先澄清 webhook retry 的失败边界，再设计实现方案。')
  await createRunDialog.getByRole('button', { name: /创建并开始澄清/ }).click()
  await expect(first.page.locator('.run-list').getByText('重构 GitHub webhook 重试策略')).toBeVisible()
  await selectRunByTitle(first.page, '重构 GitHub webhook 重试策略')
  await first.page.getByRole('button', { name: /同步团队/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('本地 Run 已保留', { timeout: 20_000 })
  await expect(first.page.locator('.run-list').getByText('重构 GitHub webhook 重试策略')).toBeVisible()
  await expect(first.page.getByText(/Run Sources/)).toContainText('local')
  await expect(first.page.getByTestId('runtime-source-badge')).toContainText('remote snapshot + local merge')
  await selectRunByTitle(first.page, '重构 GitHub webhook 重试策略')

  let localRun = await first.page.evaluate(async () => {
    const state = await window.aiDevFlowDesktop.loadState()
    const localRuns = state.runs
      .filter((run) => run.title === '重构 GitHub webhook 重试策略')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return localRuns[0]
  })
  expect(localRun?.id, 'Electron smoke local Run was not persisted before Gate approval.').toBeTruthy()
  const clarifyAgent = localRun.nodes.find((node) => node.stage === 'clarify' && node.kind === 'agent')
  expect(clarifyAgent?.id, 'Electron smoke local Run does not have a clarify agent.').toBeTruthy()
  const completedClarify = await first.page.evaluate(async ({ runId, nodeId, providerId }) => {
    const result = await window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId,
      nodeId,
      userId: 'u-erich',
      userName: 'Erich',
      providerId,
    })
    const state = await window.aiDevFlowDesktop.loadState()
    return {
      run: result.run,
      artifact: result.artifact,
      event: result.event,
      persistedArtifact: state.artifacts.find((artifact) => artifact.id === result.artifact.id),
    }
  }, { runId: localRun.id, nodeId: clarifyAgent.id, providerId: smokeReviewProviderId })
  expect(completedClarify.run.currentNodeId).toContain('clarify-gate')
  expect(completedClarify.artifact.kind).toBe('clarification')
  expect(completedClarify.artifact.content).toContain('Acceptance Criteria')
  expect(completedClarify.event.kind).toBe('thinking')
  expect(completedClarify.persistedArtifact?.id).toBe(completedClarify.artifact.id)
  localRun = completedClarify.run
  const localNodes = resolveWorkflowNodes(localRun)
  const clarifyGateDecision = await first.page.evaluate(async ({ runId, nodeId }) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId,
      projectId: 'p-payments',
    })
  }, { runId: localRun.id, nodeId: localNodes.clarifyGate.id })
  expect(clarifyGateDecision.status).toBe('blocked')
  expect(clarifyGateDecision.blocksApproval).toBe(true)
  expect(clarifyGateDecision.blockingReasons.some((reason) => reason.target === 'missing_agent_review')).toBe(true)

  await runKnowledgeReviewViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.designGate.id,
    projectId: 'p-payments',
    runTitle: '重构 GitHub webhook 重试策略',
    nodeTitle: localNodes.designGate.title,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('warning-only')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Build redacted context')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('provider_reported')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.designGate.id}`, localNodes.designGate.title)
  await expect(first.page.getByTestId('node-inspector')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('node-inspector')).toContainText('warning-only')

  await runCodingAgentViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.build.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
    nodeTitle: localNodes.build.title,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Permission Relay')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Apply fake coding diff')
  await first.page.getByRole('button', { name: /Approve once/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('Coding Agent 已完成 diff 归档', {
    timeout: 30_000,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Test evidence passed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')

  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('devflow-fake-change.txt')
  await first.page.getByRole('button', { name: /工作台/ }).click()

  await runProjectTestsViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.build.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
  })
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('passed')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')
  await first.page.evaluate(async ({ runId, nodeId }) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run) {
      throw new Error(`Run not found for smoke sync: ${runId}`)
    }
    const evidence = state.testEvidence
      .filter((candidate) => candidate.runId === run.id && candidate.nodeId === nodeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (!evidence) {
      throw new Error(`Test evidence not found for smoke sync: ${runId}`)
    }
    await window.aiDevFlowDesktop.uploadRunSummary({
	      kind: 'run',
	      runId: run.id,
	      projectId: 'p-payments',
	      title: run.title,
      status: run.status,
      currentNodeId: run.currentNodeId,
      branchName: run.branchName,
      updatedAt: run.updatedAt,
    })
    await window.aiDevFlowDesktop.uploadTestEvidenceSummary({
	      id: evidence.id,
	      runId: evidence.runId,
	      nodeId: evidence.nodeId,
	      projectId: 'p-payments',
      command: evidence.command,
      status: evidence.status,
      exitCode: evidence.exitCode,
      durationMs: evidence.durationMs,
      summary: evidence.summary,
      redacted: true,
        createdAt: evidence.createdAt,
      })
  }, { runId: localRun.id, nodeId: localNodes.build.id })

  const browser = await chromium.launch()
  try {
    const webPage = await browser.newPage()
    await expect
      .poll(async () => {
        await webPage.goto(webServerUrl)
        return (await webPage.locator('body').textContent()) ?? ''
      }, { timeout: 20_000 })
      .toContain('重构 GitHub webhook 重试策略')
    await expect(webPage.locator('body')).toContainText(/Tests passed in/)
    await expect(webPage.locator('body')).toContainText('npm test')
    await expect(webPage.locator('body')).not.toContainText(repoDir)
    await expect(webPage.locator('body')).not.toContainText('smoke passed')
  } finally {
    await browser.close()
  }

  await first.page.getByRole('button', { name: /工作台/ }).click()
  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await first.page.getByLabel('测试命令').fill(blockedCommand)
  await expect(first.page.getByTestId('tests-view').getByText(/^blocked$/i)).toBeVisible()
  await first.page.getByRole('button', { name: /保存测试命令/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试命令已阻断')
  await persistThemePreference(first.page, 'dark')
  await first.app.close()

  const second = await launchApp()
  await expect
    .poll(async () =>
      second.page.evaluate(async () => {
        return (await window.aiDevFlowDesktop.loadState()).settings.themePreference
      }),
      { timeout: 20_000 },
    )
    .toBe('dark')
  await expect(second.page.locator('html')).toHaveAttribute('data-theme-preference', 'dark', {
    timeout: 20_000,
  })
  await expect(
    second.page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true }),
  ).toBeVisible()
  await selectRunByTitle(second.page, '重构 GitHub webhook 重试策略')
  await selectWorkflowNode(second.page, `flow-node-${localNodes.designGate.id}`, localNodes.designGate.title)
  const restoredOverrides = await second.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.listGateOverrides({ runId })
  }, localRun.id)
  expect(
    restoredOverrides.some(
      (override) => override.nodeId === localNodes.clarifyGate.id && override.status === 'accepted',
    ),
  ).toBe(false)
  await second.page.getByRole('button', { name: /^Agents$/ }).click()
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('warning-only')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Build redacted context')
  await second.page.getByRole('button', { name: /^MCP$/ }).click()
  const secondEnableMcpButton = second.page.getByRole('button', { name: /Enable/ }).first()
  if ((await secondEnableMcpButton.count()) > 0) {
    await expect(secondEnableMcpButton).toBeVisible()
  } else {
    await expect(second.page.getByTestId('mcp-view')).toContainText('未加载本地 MCP 连接器')
  }
  await second.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(second.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(second.page.getByTestId('tests-view')).toContainText('passed')
  await second.app.close()
} finally {
  await reviewProviderMock?.close().catch(() => {})
  await Promise.all([stopSpawnedProcess(vite), stopSpawnedProcess(web), stopSpawnedProcess(api)])
  await rm(tempRoot, { recursive: true, force: true })
}
