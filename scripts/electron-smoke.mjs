import { execFile, spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, chromium, expect } from '@playwright/test'
import { resolveE2eRuntime } from './e2e-runtime.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const {
  apiPort,
  webPort,
  desktopPort,
  apiUrl: apiServerUrl,
  webUrl: webServerUrl,
  desktopUrl: devServerUrl,
} = await resolveE2eRuntime()
const smokeReviewProviderId = 'fake-knowledge-review'
const sessionSecret = 'electron-smoke-session-secret-non-production-32-plus'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-electron-smoke-'))
const repoDir = path.join(tempRoot, 'fixture-repo')
const userDataDir = path.join(tempRoot, 'user-data')
const controlledOpencodePath = path.join(tempRoot, 'controlled-opencode')
const controlledOpencodeLogPath = path.join(tempRoot, 'controlled-opencode-events.ndjson')
const electronDiagnostics = []
const blockedCommand = 'powershell Remove-Item -Recurse -Force C:\\devflow'
const demoSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
}
const execFileAsync = promisify(execFile)

async function readOptionalUtf8(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function captureCheckoutAuthority(repositoryPath) {
  const [{ stdout: head }, { stdout: status }, message, value] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryPath }),
    readFile(path.join(repositoryPath, 'src/message.ts'), 'utf8'),
    readFile(path.join(repositoryPath, 'src/value.ts'), 'utf8'),
  ])
  return {
    head: head.trim(),
    status,
    message,
    value,
  }
}
function createBrowserSessionHeaders(authAccountId) {
  const claims = {
    v: 1,
    authAccountId,
    expiresAt: Math.floor(Date.now() / 1_000) + 8 * 60 * 60,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')
  return { cookie: `devflow_session=${payload}.${signature}` }
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
  const ports = [apiPort, webPort, desktopPort]
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

async function launchApp({ useProjectCodingRuntime = false } = {}) {
  const electronEnv = {
    ...process.env,
    DEVFLOW_USER_DATA_DIR: userDataDir,
    DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userDataDir, 'data-profiles.json'),
    DEVFLOW_API_BASE_URL: apiServerUrl,
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    DEVFLOW_OPENCODE_BIN: controlledOpencodePath,
    DEVFLOW_INITIAL_THEME: 'dark',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    VITE_DEV_SERVER_URL: devServerUrl,
  }
  if (useProjectCodingRuntime) {
    delete electronEnv.DEVFLOW_CODING_ENGINE
    delete electronEnv.DEVFLOW_CODING_EXECUTOR
  } else {
    electronEnv.DEVFLOW_CODING_ENGINE = 'fake'
  }
  const app = await electron.launch({
    args: ['.'],
    cwd: desktopDir,
    env: electronEnv,
  })
  app.process().stderr?.on('data', (chunk) => {
    electronDiagnostics.push(chunk.toString())
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
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
        remediation: 'Run the knowledge-grounded Gate Review for this protected Gate.',
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
          remediation: 'Address the Gate Review finding with a focused implementation retry.',
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
        ...createBrowserSessionHeaders('acct-demo-u-ling'),
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
        ...createBrowserSessionHeaders('acct-demo-u-ling'),
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
    clarifyAgent: findNode('clarify', 'agent'),
    clarifyGate: findNode('clarify', 'gate'),
    designAgent: findNode('design', 'agent'),
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
    const result = await window.aiDevFlowDesktop.runKnowledgeReview({
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      requestedBy: 'u-erich',
      runtime: 'electron',
      providerId: input.providerId,
    })
    const reviews = await window.aiDevFlowDesktop.listAgentReviews({ runId: input.runId })
    const matched = reviews.find((review) => review.id === result.review.id)
    if (!matched) {
      throw new Error(`Gate Review was not persisted for ${input.nodeId}`)
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
      requestedBy: 'renderer-spoofed-coding-user',
      userInstruction: 'Electron smoke should archive a fake implementation diff.',
    })
    if (result.codingRun.nodeId !== input.nodeId) {
      throw new Error(`Coding run started for unexpected node: ${result.codingRun.nodeId}`)
    }
    return {
      id: result.codingRun.id,
      status: result.codingRun.status,
      requestedBy: result.codingRun.requestedBy,
      permissionRequestId: result.state.codingPermissionRequests.find(
        (request) => request.codingRunId === result.codingRun.id && request.status === 'pending',
      )?.id,
    }
  }, { runId, nodeId, projectId })

  expect(codingRun.status).toBe('waiting_permission')
  expect(typeof codingRun.permissionRequestId).toBe('string')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(page, `flow-node-${nodeId}`, nodeTitle)
  await page.getByRole('button', { name: /^Agents$/ }).click()
  return codingRun
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
  const execution = await page.evaluate(async (input) => {
    const result = await window.aiDevFlowDesktop.runProjectTests({
      projectId: input.projectId,
      runId: input.runId,
      nodeId: input.nodeId,
    })
    const run = result.state.runs.find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found after test execution: ${input.runId}`)
    }
    return {
      evidence: {
        id: result.evidence.id,
        status: result.evidence.status,
        command: result.evidence.command,
      },
      run,
    }
  }, { runId, nodeId, projectId })

  expect(execution.evidence.status).toBe('passed')
  expect(execution.evidence.command).toBe('npm test')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.run-list').getByText(runTitle, { exact: true })).toBeVisible({ timeout: 20_000 })
  await selectRunByTitle(page, runTitle)
  await page.getByRole('button', { name: /^测试$/ }).click()
  return execution
}

async function prepareOpenCodeWorkflowAtBuild(page, { projectId, creatorId }) {
  const prepared = await page.evaluate(async (input) => {
    const run = await window.aiDevFlowDesktop.createRun({
      title: 'Controlled OpenCode Main lifecycle',
      request: 'Change both source modules in the managed worktree and verify the canonical test.',
      projectId: input.projectId,
      creatorId: input.creatorId,
      branchName: 'devflow/controlled-opencode-main',
    })
    const findNode = (stage, kind) => {
      const node = run.nodes.find((candidate) => candidate.stage === stage && candidate.kind === kind)
      if (!node) throw new Error(`Controlled OpenCode workflow omitted ${stage}/${kind}`)
      return node
    }
    const nodes = {
      clarifyAgent: findNode('clarify', 'agent'),
      clarifyGate: findNode('clarify', 'gate'),
      designAgent: findNode('design', 'agent'),
      designGate: findNode('design', 'gate'),
      build: findNode('build', 'task'),
      test: findNode('test', 'test'),
    }

    const clarified = await window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId: run.id,
      nodeId: nodes.clarifyAgent.id,
      userId: input.creatorId,
      userName: 'Electron Smoke Owner',
      providerId: input.reviewProviderId,
    })
    await window.aiDevFlowDesktop.runKnowledgeReview({
      runId: run.id,
      nodeId: nodes.clarifyGate.id,
      projectId: input.projectId,
      requestedBy: input.creatorId,
      runtime: 'electron',
      providerId: input.reviewProviderId,
    })
    const clarificationRevision = clarified.artifact.clarificationRevision
    if (!clarificationRevision) throw new Error('Controlled OpenCode clarification revision is missing')
    const afterClarify = await window.aiDevFlowDesktop.approveGate({
      runId: run.id,
      nodeId: nodes.clarifyGate.id,
      expectedClarificationRevision: {
        artifactId: clarified.artifact.id,
        revision: clarificationRevision.revision,
        revisionDigest: clarificationRevision.revisionDigest,
      },
    })
    if (afterClarify.run.currentNodeId !== nodes.designAgent.id) {
      throw new Error('Controlled OpenCode workflow did not advance to design')
    }

    await window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId: run.id,
      nodeId: nodes.designAgent.id,
      userId: input.creatorId,
      userName: 'Electron Smoke Owner',
      providerId: input.reviewProviderId,
    })
    await window.aiDevFlowDesktop.runKnowledgeReview({
      runId: run.id,
      nodeId: nodes.designGate.id,
      projectId: input.projectId,
      requestedBy: input.creatorId,
      runtime: 'electron',
      providerId: input.reviewProviderId,
    })
    const afterDesign = await window.aiDevFlowDesktop.approveGate({
      runId: run.id,
      nodeId: nodes.designGate.id,
    })
    return {
      run: afterDesign.run,
      nodes: Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, node.id])),
    }
  }, {
    projectId,
    creatorId,
    reviewProviderId: smokeReviewProviderId,
  })

  expect(prepared.run.currentNodeId).toBe(prepared.nodes.build)
  expect(prepared.run.status).toBe('building')
  return prepared
}

let vite
let api
let web

try {
  await assertSmokePortsAvailable()

  await mkdir(repoDir, { recursive: true })
  await writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify({
      name: 'electron-smoke-fixture',
      version: '1.0.0',
      scripts: {
        test: 'node test.js',
      },
    }),
  )
  await writeFile(
    path.join(repoDir, 'package-lock.json'),
    JSON.stringify({
      name: 'electron-smoke-fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'electron-smoke-fixture',
          version: '1.0.0',
        },
      },
    }),
  )
  await mkdir(path.join(repoDir, 'src'))
  await writeFile(path.join(repoDir, 'src/message.ts'), 'export const message = "old"\n')
  await writeFile(path.join(repoDir, 'src/value.ts'), 'export const value = 1\n')
  await writeFile(
    path.join(repoDir, 'test.js'),
    [
      "const { readFileSync } = require('node:fs')",
      "const message = readFileSync('src/message.ts', 'utf8')",
      "const value = readFileSync('src/value.ts', 'utf8')",
      "const baseline = message === 'export const message = \"old\"\\n' && value === 'export const value = 1\\n'",
      "const changed = message === 'export const message = \"new\"\\n' && value === 'export const value = 2\\n'",
      "if (!baseline && !changed) process.exit(1)",
      "console.log(changed ? 'controlled OpenCode canonical test passed' : 'smoke passed')",
      '',
    ].join('\n'),
  )
  await writeFile(
    controlledOpencodePath,
    [
      '#!/usr/bin/env node',
      "const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')",
      "const { createServer } = require('node:http')",
      "const { join } = require('node:path')",
      "const args = process.argv.slice(2)",
      `const eventLogPath = ${JSON.stringify(controlledOpencodeLogPath)}`,
      "const record = (event) => appendFileSync(eventLogPath, JSON.stringify(event) + '\\n')",
      "const sendJson = (response, value, statusCode = 200) => {",
      "  const body = JSON.stringify(value)",
      "  response.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })",
      "  response.end(body)",
      "}",
      "const readJson = (request) => new Promise((resolve, reject) => {",
      "  const chunks = []",
      "  request.on('data', (chunk) => chunks.push(chunk))",
      "  request.on('end', () => {",
      "    try {",
      "      const body = Buffer.concat(chunks).toString('utf8')",
      "      resolve(body ? JSON.parse(body) : {})",
      "    } catch (error) { reject(error) }",
      "  })",
      "  request.on('error', reject)",
      "})",
      "if (args.length === 1 && args[0] === '--version') console.log('1.18.15')",
      "else if (args.join(' ') === 'auth list --pure') console.log('\\u250c  Credentials /controlled/auth.json\\n\\u2502\\n\\u25cf  OpenAI api\\n\\u2502\\n\\u2514  1 credential')",
      "else if (args.join(' ') === 'models openai --pure') console.log('openai/gpt-4.1-mini')",
      "else if (args[0] === 'serve') {",
      "  const hostname = args[args.indexOf('--hostname') + 1]",
      "  const port = Number(args[args.indexOf('--port') + 1])",
      "  if (!hostname || !Number.isSafeInteger(port) || port <= 0) {",
      "    console.error('controlled opencode received invalid serve arguments')",
      "    process.exit(64)",
      "  }",
      "  const sessionId = 'controlled-main-session'",
      "  const server = createServer(async (request, response) => {",
      "    try {",
      "      const url = new URL(request.url || '/', `http://${hostname}:${port}`)",
      "      const directory = url.searchParams.get('directory')",
      "      if (request.method === 'GET' && url.pathname === '/permission') return sendJson(response, [])",
      "      if (request.method === 'POST' && url.pathname === '/session') {",
      "        const body = await readJson(request)",
      "        if (!directory) return sendJson(response, { error: 'directory_required' }, 400)",
      "        return sendJson(response, { id: sessionId, directory, permission: body.permission })",
      "      }",
      "      if (request.method === 'POST' && url.pathname === `/session/${sessionId}/message`) {",
      "        await readJson(request)",
      "        if (!directory) return sendJson(response, { error: 'directory_required' }, 400)",
      "        mkdirSync(join(directory, 'src'), { recursive: true })",
      "        writeFileSync(join(directory, 'src/message.ts'), 'export const message = \"new\"\\n')",
      "        writeFileSync(join(directory, 'src/value.ts'), 'export const value = 2\\n')",
      "        record({ event: 'message', directory, changedPaths: ['src/message.ts', 'src/value.ts'] })",
      "        return sendJson(response, { info: {}, parts: [] })",
      "      }",
      "      if (request.method === 'GET' && url.pathname === `/session/${sessionId}/message`) return sendJson(response, [])",
      "      if (request.method === 'GET' && url.pathname === '/session/status') return sendJson(response, { [sessionId]: { type: 'idle' } })",
      "      if (request.method === 'GET' && url.pathname === `/session/${sessionId}/diff`) {",
      "        return sendJson(response, [{ file: 'src/message.ts', patch: 'diff --git a/src/message.ts b/src/message.ts\\n+untrusted OpenCode summary\\n' }])",
      "      }",
      "      if (request.method === 'POST' && url.pathname === `/session/${sessionId}/abort`) return sendJson(response, true)",
      "      return sendJson(response, { error: 'not_found' }, 404)",
      "    } catch (error) {",
      "      record({ event: 'request_error', name: error instanceof Error ? error.name : 'UnknownError' })",
      "      return sendJson(response, { error: 'controlled_request_failed' }, 500)",
      "    }",
      "  })",
      "  server.listen(port, hostname, () => record({ event: 'serve', hostname, port }))",
      "  const shutdown = () => {",
      "    server.closeAllConnections?.()",
      "    server.close(() => process.exit(0))",
      "  }",
      "  process.on('SIGTERM', shutdown)",
      "  process.on('SIGINT', shutdown)",
      "}",
      "else { console.error('controlled opencode received an unexpected command'); process.exitCode = 64 }",
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  await run('git', ['init'], { cwd: repoDir })
  await run('git', ['config', 'user.email', 'devflow@example.com'], { cwd: repoDir })
  await run('git', ['config', 'user.name', 'DevFlow Smoke'], { cwd: repoDir })
  await run('git', ['add', '.'], { cwd: repoDir })
  await run('git', ['commit', '-m', 'fixture'], { cwd: repoDir })

  await run(corepack, ['pnpm', '--filter', '@ai-devflow/desktop', 'build'])

  api = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    DEV_AUTH_ENABLED: 'true',
    DEVFLOW_SESSION_SECRET: sessionSecret,
    PORT: String(apiPort),
  })
  web = spawnQuiet(
    corepack,
    [
      'pnpm',
      '--filter',
      '@ai-devflow/web',
      'exec',
      'next',
      'dev',
      '-H',
      '127.0.0.1',
      '-p',
      String(webPort),
    ],
    {
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEVFLOW_API_BASE_URL: apiServerUrl,
      NEXT_PUBLIC_DEVFLOW_API_URL: apiServerUrl,
    },
  )
  vite = spawnQuiet(corepack, [
    'pnpm',
    '--filter',
    '@ai-devflow/desktop',
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    String(desktopPort),
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
  const providerCatalog = await first.page.evaluate(async () => {
    return window.aiDevFlowDesktop.listAgentProviders()
  })
  expect(providerCatalog).toEqual([
    expect.objectContaining({
      id: smokeReviewProviderId,
      kind: 'fake',
      model: 'fake',
    }),
  ])
  await expect(first.page.getByTestId('runtime-source-badge')).toContainText('local SQLite empty')
  await expect(first.page.getByTestId('workflow-empty-state')).toContainText('暂无 Run')
  await expect(first.page.getByTestId('node-inspector-empty')).toContainText('选择真实 Run')

  await first.page.getByRole('button', { name: /选择本地仓库/ }).click()
  await expect(first.page.locator('.local-project-panel').getByText('electron-smoke-fixture')).toBeVisible()
  const localProjectId = await first.page.evaluate(async (repoPath) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const project = state.projects.find((candidate) => candidate.path === repoPath)
    if (!project) {
      throw new Error(`Local project not found for smoke repo: ${repoPath}`)
    }
    return project.id
  }, repoDir)
  await first.page.evaluate(async (projectId) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await window.aiDevFlowDesktop.unwatchProjectGitStatus({ projectId })
      await window.aiDevFlowDesktop.watchProjectGitStatus({ projectId })
    }
  }, localProjectId)
  await first.page.evaluate(async ({ code, projectId }) => {
    await window.aiDevFlowDesktop.pairDesktop({
      code,
      localProjectId: projectId,
    })
  }, { code: pairingCode, projectId: localProjectId })
  const trustedPairingUserId = await first.page.evaluate(async () => {
    const pairing = await window.aiDevFlowDesktop.loadDesktopPairing()
    if (!pairing) throw new Error('Electron smoke pairing was not persisted')
    return pairing.userId
  })
  expect(trustedPairingUserId).not.toBe('renderer-spoofed-coding-user')
  await first.page.evaluate(async (projectId) => {
    await window.aiDevFlowDesktop.saveCodingRuntimeBudgetPolicy({
      projectId,
      enabled: true,
      monthlyLimitUsd: 0.20,
      warningThresholdUsd: 0.10,
    })
  }, localProjectId)

  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(first.page.getByLabel('测试命令')).toHaveValue('npm test')
  await expect(first.page.getByText(/safe/i)).toBeVisible()

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
  const localNodes = resolveWorkflowNodes(localRun)
  expect(localRun.currentNodeId).toBe(localNodes.clarifyAgent.id)

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
  }, { runId: localRun.id, nodeId: localNodes.clarifyAgent.id, providerId: smokeReviewProviderId })
  expect(completedClarify.run.currentNodeId).toBe(localNodes.clarifyGate.id)
  expect(completedClarify.artifact.kind).toBe('clarification')
  expect(completedClarify.artifact.content).toContain('Acceptance Criteria')
  expect(completedClarify.artifact.clarificationRevision).toBeTruthy()
  expect(completedClarify.event.kind).toBe('thinking')
  expect(completedClarify.persistedArtifact?.id).toBe(completedClarify.artifact.id)
  localRun = completedClarify.run

  await runKnowledgeReviewViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.clarifyGate.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
    nodeTitle: localNodes.clarifyGate.title,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('基于知识的门禁审查')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Gate Review ready')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Reviewed 1 complete subject Artifact')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('provider_reported')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.clarifyGate.id}`, localNodes.clarifyGate.title)
  await expect(first.page.getByTestId('node-inspector')).toContainText('基于知识的门禁审查已生成 Gate Advisory')
  const clarifyGateDecision = await first.page.evaluate(async ({ runId, nodeId, projectId }) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId,
      projectId,
    })
  }, { runId: localRun.id, nodeId: localNodes.clarifyGate.id, projectId: localProjectId })
  expect(clarifyGateDecision.blocksApproval).toBe(false)

  const approvedClarify = await first.page.evaluate(async ({ runId, nodeId, expectedClarificationRevision }) => {
    return window.aiDevFlowDesktop.approveGate({
      runId,
      nodeId,
      expectedClarificationRevision,
    })
  }, {
    runId: localRun.id,
    nodeId: localNodes.clarifyGate.id,
    expectedClarificationRevision: {
      artifactId: completedClarify.artifact.id,
      revision: completedClarify.artifact.clarificationRevision.revision,
      revisionDigest: completedClarify.artifact.clarificationRevision.revisionDigest,
    },
  })
  expect(approvedClarify.event.kind).toBe('approval')
  expect(approvedClarify.run.currentNodeId).toBe(localNodes.designAgent.id)
  localRun = approvedClarify.run

  const completedDesign = await first.page.evaluate(async ({ runId, nodeId, providerId }) => {
    return window.aiDevFlowDesktop.completeWorkflowAgentNode({
      runId,
      nodeId,
      userId: 'u-erich',
      userName: 'Erich',
      providerId,
    })
  }, { runId: localRun.id, nodeId: localNodes.designAgent.id, providerId: smokeReviewProviderId })
  expect(completedDesign.run.currentNodeId).toBe(localNodes.designGate.id)
  expect(completedDesign.artifact.kind).toBe('design')
  expect(completedDesign.event.kind).toBe('thinking')
  localRun = completedDesign.run

  await runKnowledgeReviewViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.designGate.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
    nodeTitle: localNodes.designGate.title,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('基于知识的门禁审查')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Gate Review ready')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.designGate.id}`, localNodes.designGate.title)
  await expect(first.page.getByTestId('node-inspector')).toContainText('基于知识的门禁审查已生成 Gate Advisory')
  const designGateDecision = await first.page.evaluate(async ({ runId, nodeId, projectId }) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId,
      projectId,
    })
  }, { runId: localRun.id, nodeId: localNodes.designGate.id, projectId: localProjectId })
  expect(designGateDecision.blocksApproval).toBe(false)

  const legacyOverridePayloadError = await first.page.evaluate(async ({ runId, nodeId, projectId }) => {
    try {
      await window.aiDevFlowDesktop.saveGateOverride({
        runId,
        nodeId,
        reason: 'Legacy renderer trust fields must be rejected.',
        projectId,
        userId: 'spoofed-owner',
        role: 'owner',
        blockedReasonIds: [],
        policyVersion: 999,
        provisional: false,
      })
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { runId: localRun.id, nodeId: localNodes.designGate.id, projectId: localProjectId })
  expect(legacyOverridePayloadError).toMatch(/unexpected field/i)

  const approvedDesign = await first.page.evaluate(async ({ runId, nodeId }) => {
    return window.aiDevFlowDesktop.approveGate({
      runId,
      nodeId,
    })
  }, { runId: localRun.id, nodeId: localNodes.designGate.id })
  expect(approvedDesign.event.kind).toBe('approval')
  expect(approvedDesign.run.currentNodeId).toBe(localNodes.build.id)
  localRun = approvedDesign.run

  const codingAuthority = await runCodingAgentViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.build.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
    nodeTitle: localNodes.build.title,
  })
  expect(codingAuthority.requestedBy).toBe(trustedPairingUserId)
  await expect(first.page.getByTestId('agent-workbench')).toContainText('权限转发')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Apply fake coding diff')
  await first.page.getByRole('button', { name: /仅批准本次/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('Coding Agent 已完成 diff 归档', {
    timeout: 30_000,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Test evidence passed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  const permissionAuthority = await first.page.evaluate(async ({ codingRunId, requestId }) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const decision = state.codingPermissionDecisions.find(
      (candidate) => candidate.codingRunId === codingRunId && candidate.requestId === requestId,
    )
    return decision ? { decidedBy: decision.decidedBy, decision: decision.decision } : null
  }, {
    codingRunId: codingAuthority.id,
    requestId: codingAuthority.permissionRequestId,
  })
  expect(permissionAuthority).toEqual({
    decidedBy: trustedPairingUserId,
    decision: 'approved',
  })
  await expect
    .poll(async () =>
      first.page.evaluate(async (runId) => {
        const state = await window.aiDevFlowDesktop.loadState()
        return state.runs.find((run) => run.id === runId)?.currentNodeId
      }, localRun.id),
    )
    .toBe(localNodes.test.id)
  localRun = await first.page.evaluate(async (runId) => {
    const state = await window.aiDevFlowDesktop.loadState()
    return state.runs.find((run) => run.id === runId)
  }, localRun.id)
  expect(localRun.currentNodeId).toBe(localNodes.test.id)
  expect(localRun.nodes.find((node) => node.id === localNodes.build.id)?.status).toBe('success')
  expect(localRun.nodes.find((node) => node.id === localNodes.test.id)?.status).toBe('running')

  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('devflow-fake-change.txt')
  await first.page.getByRole('button', { name: /工作台/ }).click()

  const completedTest = await runProjectTestsViaDesktopApi(first.page, {
    runId: localRun.id,
    nodeId: localNodes.test.id,
    projectId: localProjectId,
    runTitle: '重构 GitHub webhook 重试策略',
  })
  localRun = completedTest.run
  expect(localRun.currentNodeId).toBe(localNodes.pr.id)
  expect(localRun.nodes.find((node) => node.id === localNodes.test.id)?.status).toBe('success')
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('passed')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')

  const createdPrDraft = await first.page.evaluate(async ({ runId, nodeId }) => {
    return window.aiDevFlowDesktop.createPrDraft({ runId, nodeId })
  }, { runId: localRun.id, nodeId: localNodes.pr.id })
  expect(createdPrDraft.artifact.kind).toBe('pr')
  expect(createdPrDraft.event.kind).toBe('thinking')
  expect(createdPrDraft.artifact.redacted).toBe(true)
  expect(createdPrDraft.artifact.githubDeliverySource).toMatchObject({
    stateVersion: 1,
    headBranch: expect.stringMatching(/^devflow\//),
    codingRunId: expect.any(String),
    workspaceId: expect.any(String),
    diffArtifactId: expect.any(String),
    testEvidenceId: expect.any(String),
  })
  expect(createdPrDraft.run.status).toBe('paused_at_gate')
  expect(createdPrDraft.run.currentNodeId).toBe(localNodes.pr.id)
  expect(createdPrDraft.run.pullRequestUrl).toBeUndefined()
  expect(createdPrDraft.run.nodes.find((node) => node.id === localNodes.pr.id)).toMatchObject({
    status: 'running',
    artifactIds: expect.arrayContaining([createdPrDraft.artifact.id]),
  })
  expect(createdPrDraft.run.nodes.find((node) => node.id === localNodes.accept.id)?.status).toBe(
    'pending',
  )
  localRun = createdPrDraft.run
  const localDeliveryIntents = await first.page.evaluate(async (runId) => {
    const state = await window.aiDevFlowDesktop.loadState()
    return state.githubDeliveryIntents.filter((intent) => intent.runId === runId)
  }, localRun.id)
  expect(localDeliveryIntents).toEqual([])

  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.pr.id}`, localNodes.pr.title)
  await expect(first.page.getByTestId('github-delivery-panel')).toContainText('ready_to_prepare')
  const prematureAcceptanceError = await first.page.evaluate(async ({ runId, nodeId }) => {
    try {
      await window.aiDevFlowDesktop.createAcceptanceBundle({ runId, nodeId })
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { runId: localRun.id, nodeId: localNodes.accept.id })
  expect(prematureAcceptanceError).toMatch(/Only the current Acceptance node/i)

  const rendererUploadSurface = await first.page.evaluate(() => ({
    run: 'uploadRunSummary' in window.aiDevFlowDesktop,
    testEvidence: 'uploadTestEvidenceSummary' in window.aiDevFlowDesktop,
    coding: 'uploadCodingAgentSummary' in window.aiDevFlowDesktop,
  }))
  expect(rendererUploadSurface).toEqual({
    run: false,
    testEvidence: false,
    coding: false,
  })

  await expect.poll(async () => {
    const response = await fetch(
      `${apiServerUrl}/api/team/overview`,
      { headers: demoSessionHeaders },
    )
    if (!response.ok) {
      return false
    }
    const overview = await response.json()
    const run = overview.runs.find((candidate) => candidate.id === localRun.id)
    const evidence = overview.testEvidenceSummaries.find(
      (candidate) => candidate.runId === localRun.id && candidate.nodeId === localNodes.test.id,
    )
    return (
      run?.status === 'paused_at_gate' &&
      run.version === localRun.version &&
      Boolean(evidence)
    )
  }, { timeout: 20_000 }).toBe(true)

  const overviewResponse = await fetchWithRetry(
    `${apiServerUrl}/api/team/overview`,
    { headers: demoSessionHeaders },
    'team overview after governed PR package sync',
  )
  expect(overviewResponse.ok).toBe(true)
  const syncedOverview = await overviewResponse.json()
  const syncedRun = syncedOverview.runs.find((run) => run.id === localRun.id)
  const syncedEvidence = syncedOverview.testEvidenceSummaries.find(
    (evidence) => evidence.runId === localRun.id && evidence.nodeId === localNodes.test.id,
  )
  expect(syncedRun).toMatchObject({
    title: '重构 GitHub webhook 重试策略',
    version: localRun.version,
    status: 'paused_at_gate',
    currentNodeId: localNodes.pr.id,
  })
  expect(syncedEvidence).toMatchObject({
    command: 'npm test',
    status: 'passed',
  })
  expect(JSON.stringify(syncedOverview)).not.toContain(repoDir)
  expect(JSON.stringify(syncedOverview)).not.toContain('smoke passed')

  const browser = await chromium.launch()
  try {
    const webPage = await browser.newPage()
    await expect
      .poll(async () => {
        await webPage.goto(webServerUrl)
        return (await webPage.locator('body').textContent()) ?? ''
      }, { timeout: 20_000 })
      .toContain('Payments API')
    await expect(webPage.getByText('Evidence Chain').first()).toBeVisible()
    await expect(webPage.getByText('Human Gate').first()).toBeVisible()
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
  const opencodeMainAuthority = await first.page.evaluate(async ({ projectId, runId, nodeId }) => {
    const discovery = await window.aiDevFlowDesktop.detectCodingRuntimeEngines({ projectId })
    const candidate = discovery.candidates.find((item) => item.executor === 'opencode-http')
    if (!candidate?.binaryPath || !candidate.version || candidate.status !== 'available') {
      throw new Error('Controlled OpenCode candidate was not discovered by Electron Main')
    }
    let staleConfirmationError = ''
    try {
      await window.aiDevFlowDesktop.saveCodingRuntimeConfiguration({
        projectId,
        executor: 'opencode-http',
        providerId: 'openai',
        binaryPath: '/renderer/forged/opencode',
        modelId: 'gpt-4.1-mini',
        detectedVersion: candidate.version,
      })
    } catch (error) {
      staleConfirmationError = error instanceof Error ? error.message : String(error)
    }
    const configuration = await window.aiDevFlowDesktop.saveCodingRuntimeConfiguration({
      projectId,
      executor: 'opencode-http',
      providerId: 'openai',
      binaryPath: candidate.binaryPath,
      modelId: 'gpt-4.1-mini',
      detectedVersion: candidate.version,
    })
    return { candidate, configuration, staleConfirmationError }
  }, {
    projectId: localProjectId,
    runId: localRun.id,
    nodeId: localNodes.pr.id,
  })
  expect(opencodeMainAuthority.staleConfirmationError).toMatch(/confirmation is stale/i)
  expect(opencodeMainAuthority.configuration).toMatchObject({
    executor: 'opencode-http',
    providerId: 'openai',
    binaryPath: opencodeMainAuthority.candidate.binaryPath,
    detectedVersion: opencodeMainAuthority.candidate.version,
    modelId: 'gpt-4.1-mini',
  })
  const controlledOpenCodeWorkflow = await prepareOpenCodeWorkflowAtBuild(first.page, {
    projectId: localProjectId,
    creatorId: trustedPairingUserId,
  })
  const sourceCheckoutAuthority = await captureCheckoutAuthority(repoDir)
  expect(sourceCheckoutAuthority).toMatchObject({
    status: '',
    message: 'export const message = "old"\n',
    value: 'export const value = 1\n',
  })
  expect(await readOptionalUtf8(controlledOpencodeLogPath)).toBeUndefined()
  await persistThemePreference(first.page, 'dark')
  const durableIdentityBeforeRestart = await first.page.evaluate(async (runId) => {
    const [state, profile, pairing, providers] = await Promise.all([
      window.aiDevFlowDesktop.loadState(),
      window.aiDevFlowDesktop.loadDataProfileDiagnostics(),
      window.aiDevFlowDesktop.loadDesktopPairing(),
      window.aiDevFlowDesktop.listAgentProviders(),
    ])
    const run = state.runs.find((candidate) => candidate.id === runId)
    return {
      profile,
      run: run
        ? { id: run.id, currentNodeId: run.currentNodeId, version: run.version }
        : null,
      pairing: pairing
        ? {
            tokenId: pairing.tokenId,
            organizationId: pairing.organizationId,
            projectId: pairing.projectId,
            localProjectId: pairing.localProjectId,
            userId: pairing.userId,
          }
        : null,
      providers: providers.map((provider) => ({
        id: provider.id,
        kind: provider.kind,
        model: provider.model,
        enabled: provider.enabled,
      })),
    }
  }, localRun.id)
  expect(durableIdentityBeforeRestart.run?.id).toBe(localRun.id)
  expect(durableIdentityBeforeRestart.profile.runCount).toBeGreaterThan(0)
  expect(durableIdentityBeforeRestart.profile.latestRunUpdatedAt).toBeTruthy()
  expect(durableIdentityBeforeRestart.pairing?.localProjectId).toBe(localProjectId)
  await first.app.close()

  const second = await launchApp({ useProjectCodingRuntime: true })
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
  const opencodeReadinessAuthority = await second.page.evaluate(async ({ projectId, runId, nodeId }) => {
    return window.aiDevFlowDesktop.getCodingRuntimeReadiness({
      projectId,
      runId,
      nodeId,
      requestedBy: 'renderer-spoofed-readiness-user',
    })
  }, {
    projectId: localProjectId,
    runId: localRun.id,
    nodeId: localNodes.pr.id,
  })
  expect(opencodeReadinessAuthority).toMatchObject({
    engine: 'opencode-http',
    executor: 'opencode-http',
    providerId: 'openai',
  })
  for (const code of [
    'binary_missing',
    'version_incompatible',
    'auth_unavailable',
    'profile_unavailable',
    'model_unavailable',
  ]) {
    expect(opencodeReadinessAuthority.checks.find((check) => check.code === code)?.status).toBe('ready')
  }

  const controlledOpenCodeStart = await second.page.evaluate(async (input) => {
    const result = await window.aiDevFlowDesktop.runCodingAgent({
      runId: input.runId,
      nodeId: input.buildNodeId,
      projectId: input.projectId,
      requestedBy: 'renderer-spoofed-opencode-user',
      userInstruction: 'Change src/message.ts to new and src/value.ts to 2, then run the saved canonical test.',
    })
    const permission = result.state.codingPermissionRequests.find(
      (candidate) => candidate.codingRunId === result.codingRun.id && candidate.status === 'pending',
    )
    const workspace = result.state.managedCodingWorkspaces.find(
      (candidate) => candidate.id === result.codingRun.managedWorkspaceId,
    )
    return { codingRun: result.codingRun, permission, workspace }
  }, {
    runId: controlledOpenCodeWorkflow.run.id,
    buildNodeId: controlledOpenCodeWorkflow.nodes.build,
    projectId: localProjectId,
  })
  expect(controlledOpenCodeStart.codingRun).toMatchObject({
    engine: 'opencode-http',
    status: 'waiting_permission',
    requestedBy: trustedPairingUserId,
  })
  expect(controlledOpenCodeStart.permission).toMatchObject({
    origin: 'execution_authorization',
    permission: 'write',
    status: 'pending',
  })
  expect(controlledOpenCodeStart.workspace?.worktreePath).toBeTruthy()
  expect(await readOptionalUtf8(controlledOpencodeLogPath)).toBeUndefined()
  const preAuthorizationWorktree = await captureCheckoutAuthority(
    controlledOpenCodeStart.workspace.worktreePath,
  )
  expect(preAuthorizationWorktree).toEqual(sourceCheckoutAuthority)
  expect(await captureCheckoutAuthority(repoDir)).toEqual(sourceCheckoutAuthority)

  const controlledOpenCodeExecution = await second.page.evaluate(async (input) => {
    await window.aiDevFlowDesktop.replyCodingPermission({
      requestId: input.executionAuthorizationId,
      codingRunId: input.codingRunId,
      decidedBy: 'renderer-spoofed-opencode-approver',
      decision: 'approved',
      comment: 'Authorize the controlled OpenCode process only in the managed worktree.',
    })
    const state = await window.aiDevFlowDesktop.loadState()
    const codingRun = state.codingRuns.find((candidate) => candidate.id === input.codingRunId)
    const workflowRun = state.runs.find((candidate) => candidate.id === input.runId)
    const workspace = state.managedCodingWorkspaces.find(
      (candidate) => candidate.id === codingRun?.managedWorkspaceId,
    )
    const diff = state.codingDiffArtifacts.find((candidate) => candidate.id === codingRun?.diffArtifactId)
    const changeAcceptance = state.codingPermissionRequests.find(
      (candidate) =>
        candidate.codingRunId === input.codingRunId &&
        candidate.origin === 'change_acceptance' &&
        candidate.status === 'pending',
    )
    const evidence = state.testEvidence.find(
      (candidate) => candidate.id === (changeAcceptance?.testEvidenceId ?? codingRun?.testEvidenceId),
    )
    const executionDecision = state.codingPermissionDecisions.find(
      (candidate) => candidate.requestId === input.executionAuthorizationId,
    )
    const events = state.codingEvents.filter((candidate) => candidate.codingRunId === input.codingRunId)
    return {
      codingRun,
      workflowRun,
      workspace,
      diff,
      evidence,
      changeAcceptance,
      executionDecision,
      events,
    }
  }, {
    runId: controlledOpenCodeWorkflow.run.id,
    codingRunId: controlledOpenCodeStart.codingRun.id,
    executionAuthorizationId: controlledOpenCodeStart.permission.id,
  })
  expect(controlledOpenCodeExecution.executionDecision).toMatchObject({
    decidedBy: trustedPairingUserId,
    decision: 'approved',
  })
  expect(controlledOpenCodeExecution.codingRun).toMatchObject({
    status: 'waiting_permission',
    changedPaths: ['src/message.ts', 'src/value.ts'],
  })
  expect(controlledOpenCodeExecution.workspace?.worktreePath).toBe(
    controlledOpenCodeStart.workspace.worktreePath,
  )
  expect(controlledOpenCodeExecution.diff).toMatchObject({
    changedPaths: ['src/message.ts', 'src/value.ts'],
    truncated: false,
  })
  expect(controlledOpenCodeExecution.diff.patch).toContain('diff --git a/src/message.ts b/src/message.ts')
  expect(controlledOpenCodeExecution.diff.patch).toContain('diff --git a/src/value.ts b/src/value.ts')
  expect(controlledOpenCodeExecution.diff.patch).not.toContain('untrusted OpenCode summary')
  expect(controlledOpenCodeExecution.evidence).toMatchObject({
    command: 'npm test',
    cwd: '<workspace>',
    status: 'passed',
  })
  expect(controlledOpenCodeExecution.changeAcceptance).toMatchObject({
    origin: 'change_acceptance',
    permission: 'patch',
    status: 'pending',
    diffArtifactId: controlledOpenCodeExecution.diff.id,
    testEvidenceId: controlledOpenCodeExecution.evidence.id,
    managedWorkspaceId: controlledOpenCodeExecution.workspace.id,
  })
  expect(controlledOpenCodeExecution.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: 'diff',
      metadata: expect.objectContaining({
        diffSource: 'managed_worktree_git',
        opencodeDiffStatus: 'mismatch',
      }),
    }),
  ]))
  expect(controlledOpenCodeExecution.workflowRun).toMatchObject({
    currentNodeId: controlledOpenCodeWorkflow.nodes.build,
    status: 'building',
  })
  const modifiedManagedWorktree = await captureCheckoutAuthority(
    controlledOpenCodeExecution.workspace.worktreePath,
  )
  expect(modifiedManagedWorktree).toMatchObject({
    head: sourceCheckoutAuthority.head,
    message: 'export const message = "new"\n',
    value: 'export const value = 2\n',
  })
  expect(modifiedManagedWorktree.status).toContain('src/message.ts')
  expect(modifiedManagedWorktree.status).toContain('src/value.ts')
  expect(await captureCheckoutAuthority(repoDir)).toEqual(sourceCheckoutAuthority)
  const controlledOpenCodeEvents = (await readFile(controlledOpencodeLogPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(controlledOpenCodeEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'serve' }),
  ]))
  const controlledMessageEvent = controlledOpenCodeEvents.find((event) => event.event === 'message')
  expect(controlledMessageEvent).toMatchObject({
    changedPaths: ['src/message.ts', 'src/value.ts'],
  })
  expect(await realpath(controlledMessageEvent.directory)).toBe(
    await realpath(controlledOpenCodeExecution.workspace.worktreePath),
  )

  const controlledOpenCodeAccepted = await second.page.evaluate(async (input) => {
    await window.aiDevFlowDesktop.replyCodingPermission({
      requestId: input.changeAcceptanceId,
      codingRunId: input.codingRunId,
      decidedBy: 'renderer-spoofed-change-approver',
      decision: 'approved',
      comment: 'Accept the exact authoritative Git diff and passed canonical test.',
    })
    const state = await window.aiDevFlowDesktop.loadState()
    return {
      codingRun: state.codingRuns.find((candidate) => candidate.id === input.codingRunId),
      workflowRun: state.runs.find((candidate) => candidate.id === input.runId),
      decision: state.codingPermissionDecisions.find(
        (candidate) => candidate.requestId === input.changeAcceptanceId,
      ),
    }
  }, {
    runId: controlledOpenCodeWorkflow.run.id,
    codingRunId: controlledOpenCodeStart.codingRun.id,
    changeAcceptanceId: controlledOpenCodeExecution.changeAcceptance.id,
  })
  expect(controlledOpenCodeAccepted.decision).toMatchObject({
    decidedBy: trustedPairingUserId,
    decision: 'approved',
  })
  expect(controlledOpenCodeAccepted.codingRun).toMatchObject({
    status: 'completed',
    changedPaths: ['src/message.ts', 'src/value.ts'],
  })
  expect(controlledOpenCodeAccepted.workflowRun).toMatchObject({
    status: 'testing',
    currentNodeId: controlledOpenCodeWorkflow.nodes.test,
    nodes: expect.arrayContaining([
      expect.objectContaining({ id: controlledOpenCodeWorkflow.nodes.build, status: 'success' }),
      expect.objectContaining({ id: controlledOpenCodeWorkflow.nodes.test, status: 'running' }),
    ]),
  })
  expect(await captureCheckoutAuthority(repoDir)).toEqual(sourceCheckoutAuthority)
  const durableIdentityAfterRestart = await second.page.evaluate(async (runId) => {
    const [state, profile, pairing, providers] = await Promise.all([
      window.aiDevFlowDesktop.loadState(),
      window.aiDevFlowDesktop.loadDataProfileDiagnostics(),
      window.aiDevFlowDesktop.loadDesktopPairing(),
      window.aiDevFlowDesktop.listAgentProviders(),
    ])
    const run = state.runs.find((candidate) => candidate.id === runId)
    return {
      profile,
      run: run
        ? { id: run.id, currentNodeId: run.currentNodeId, version: run.version }
        : null,
      pairing: pairing
        ? {
            tokenId: pairing.tokenId,
            organizationId: pairing.organizationId,
            projectId: pairing.projectId,
            localProjectId: pairing.localProjectId,
            userId: pairing.userId,
          }
        : null,
      providers: providers.map((provider) => ({
        id: provider.id,
        kind: provider.kind,
        model: provider.model,
        enabled: provider.enabled,
      })),
    }
  }, localRun.id)
  const {
    latestRunUpdatedAt: latestRunUpdatedAtBeforeRestart,
    ...profileBeforeRestart
  } = durableIdentityBeforeRestart.profile
  const {
    latestRunUpdatedAt: latestRunUpdatedAtAfterRestart,
    ...profileAfterRestart
  } = durableIdentityAfterRestart.profile
  expect({ ...durableIdentityAfterRestart, profile: profileAfterRestart }).toEqual({
    ...durableIdentityBeforeRestart,
    profile: profileBeforeRestart,
  })
  expect(Date.parse(latestRunUpdatedAtAfterRestart)).toBeGreaterThanOrEqual(
    Date.parse(latestRunUpdatedAtBeforeRestart),
  )
  await expect(
    second.page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true }),
  ).toBeVisible()
  await selectRunByTitle(second.page, '重构 GitHub webhook 重试策略')
  const restoredWorkflow = await second.page.evaluate(async (runId) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const run = state.runs.find((candidate) => candidate.id === runId)
    const reviews = await window.aiDevFlowDesktop.listAgentReviews({ runId })
    return {
      status: run?.status,
      currentNodeId: run?.currentNodeId,
      pullRequestUrl: run?.pullRequestUrl,
      acceptanceStatus: run?.nodes.find((node) => node.kind === 'acceptance')?.status,
      githubDeliveryIntentIds: state.githubDeliveryIntents
        .filter((intent) => intent.runId === runId)
        .map((intent) => intent.id),
      reviewNodeIds: reviews.map((review) => review.nodeId),
    }
  }, localRun.id)
  expect(restoredWorkflow.status).toBe('paused_at_gate')
  expect(restoredWorkflow.currentNodeId).toBe(localNodes.pr.id)
  expect(restoredWorkflow.pullRequestUrl).toBeUndefined()
  expect(restoredWorkflow.acceptanceStatus).toBe('pending')
  expect(restoredWorkflow.githubDeliveryIntentIds).toEqual([])
  expect(restoredWorkflow.reviewNodeIds).toEqual(
    expect.arrayContaining([
      localNodes.clarifyGate.id,
      localNodes.designGate.id,
    ]),
  )
  expect(restoredWorkflow.reviewNodeIds).not.toContain(localNodes.accept.id)
  await selectWorkflowNode(second.page, `flow-node-${localNodes.pr.id}`, localNodes.pr.title)
  await expect(second.page.getByTestId('github-delivery-panel')).toContainText('ready_to_prepare')
  const restoredOverrides = await second.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.listGateOverrides({ runId })
  }, localRun.id)
  expect(
    restoredOverrides.some(
      (override) => override.nodeId === localNodes.clarifyGate.id && override.status === 'accepted',
    ),
  ).toBe(false)
  await second.page.getByRole('button', { name: /^Agents$/ }).click()
  await expect(second.page.getByTestId('agent-workbench')).toContainText('暂无 Gate Advisory')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('审查总数4')
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
  expect(electronDiagnostics.join('')).not.toContain('MaxListenersExceededWarning')
  await second.app.close()
} finally {
  await Promise.all([stopSpawnedProcess(vite), stopSpawnedProcess(web), stopSpawnedProcess(api)])
  await rm(tempRoot, { recursive: true, force: true })
}
