import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-electron-smoke-'))
const repoDir = path.join(tempRoot, 'fixture-repo')
const userDataDir = path.join(tempRoot, 'user-data')
const electronDiagnostics = []
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
    DEV_AUTH_ENABLED: 'true',
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
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review ready')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('1 evidence gap')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('provider_reported')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.clarifyGate.id}`, localNodes.clarifyGate.title)
  await expect(first.page.getByTestId('node-inspector')).toContainText('已有 Knowledge Review advisory')
  const clarifyGateDecision = await first.page.evaluate(async ({ runId, nodeId, projectId }) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId,
      projectId,
    })
  }, { runId: localRun.id, nodeId: localNodes.clarifyGate.id, projectId: localProjectId })
  expect(clarifyGateDecision.blocksApproval).toBe(false)

  const approvedClarify = await first.page.evaluate(async ({ runId, nodeId }) => {
    return window.aiDevFlowDesktop.approveGate({
      runId,
      nodeId,
    })
  }, { runId: localRun.id, nodeId: localNodes.clarifyGate.id })
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
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review ready')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, `flow-node-${localNodes.designGate.id}`, localNodes.designGate.title)
  await expect(first.page.getByTestId('node-inspector')).toContainText('已有 Knowledge Review advisory')
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
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Total reviews2')
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
