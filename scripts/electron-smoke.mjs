import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-electron-smoke-'))
const repoDir = path.join(tempRoot, 'fixture-repo')
const userDataDir = path.join(tempRoot, 'user-data')
const blockedCommand = 'powershell Remove-Item -Recurse -Force C:\\devflow'
const demoSessionHeaders = {
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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

async function launchApp() {
  const app = await electron.launch({
    args: ['.'],
    cwd: desktopDir,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDir,
      DEVFLOW_API_BASE_URL: apiServerUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: devServerUrl,
    },
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
  const response = await fetch(`${apiServerUrl}/api/enforcement/policy`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...demoSessionHeaders,
    },
    body: JSON.stringify({
      organizationPolicy: createRecommendedEnforcementPolicy(1, new Date().toISOString()),
    }),
  })

  if (!response.ok) {
    throw new Error(`Unable to save Electron smoke enforcement policy: ${response.status} ${await response.text()}`)
  }
}

async function selectRunByTitle(page, title) {
  const runRow = page.locator('.run-row').filter({ hasText: title })
  await expect(runRow).toBeVisible()
  await runRow.click()
  await expect(runRow).toHaveClass(/is-selected/)
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

let vite
let api
let web

try {
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

  api = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'])
  web = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/web', 'dev'], {
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

  const first = await launchApp()
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
    const snapshot = await window.aiDevFlowDesktop.loadRemoteSnapshot({ organizationId: 'org-demo' })
    const run = snapshot.runs.find((candidate) => candidate.id === 'run-health-001')
    if (!run) {
      throw new Error('Electron smoke could not find the seeded team Run.')
    }
    await window.aiDevFlowDesktop.createRun(run)
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

  await first.page.getByRole('button', { name: /选择本地仓库/ }).click()
  await expect(first.page.locator('.local-project-panel').getByText('electron-smoke-fixture')).toBeVisible()
  await expect(first.page.getByLabel('测试命令')).toHaveValue('npm test')
  await expect(first.page.getByText(/safe/i)).toBeVisible()

  await first.page.getByRole('button', { name: /Knowledge/ }).click()
  await expect(first.page.getByTestId('knowledge-view')).toContainText('Knowledge Governance')
  await first.page.getByLabel('Search runs and knowledge').fill('api')
  await expect(first.page.getByTestId('knowledge-view')).toContainText('API Health Endpoint Standard')
  await expect(first.page.getByTestId('knowledge-view')).toContainText('lexical')
  await expect(first.page.getByTestId('knowledge-view')).toContainText(/kh-[a-f0-9]{8}/)
  await first.page.getByLabel('Search runs and knowledge').fill('')

  await first.page.getByTestId('theme-toggle').click()
  await expect(first.page.locator('html')).toHaveAttribute('data-theme-preference', 'light')

  await first.page.getByRole('button', { name: /^MCP$/ }).click()
  await first.page.getByRole('button', { name: /Disable/ }).first().click()
  await expect(first.page.getByRole('button', { name: /Enable/ }).first()).toBeVisible()

  await first.page.getByRole('button', { name: /工作台/ }).click()
  await first.page.getByRole('button', { name: /新建 Run/ }).click()
  await first.page.getByRole('button', { name: /创建并开始澄清/ }).click()
  await expect(first.page.getByText('重构 GitHub webhook 重试策略')).toBeVisible()
  await selectRunByTitle(first.page, '重构 GitHub webhook 重试策略')

  const localRun = await first.page.evaluate(async () => {
    const state = await window.aiDevFlowDesktop.loadState()
    const localRuns = state.runs
      .filter((run) => run.title === '重构 GitHub webhook 重试策略')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return localRuns[0]
  })
  expect(localRun?.id, 'Electron smoke local Run was not persisted before Gate approval.').toBeTruthy()
  const clarifyGateDecision = await first.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.evaluateGateEnforcement({
      runId,
      nodeId: 'n-clarify-gate',
      projectId: 'p-payments',
    })
  }, localRun.id)
  expect(clarifyGateDecision.status).toBe('blocked')
  expect(clarifyGateDecision.blocksApproval).toBe(true)
  expect(clarifyGateDecision.blockingReasons.some((reason) => reason.target === 'missing_agent_review')).toBe(true)
  const directApproveRejected = await first.page.evaluate(async (runId) => {
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
  }, localRun.id)
  expect(directApproveRejected).toBe(true)
  const localLeadOverride = await first.page.evaluate(async ({ runId, decision }) => {
    return window.aiDevFlowDesktop.saveGateOverride({
      runId,
      nodeId: 'n-clarify-gate',
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead',
      reason: 'Electron smoke rejected local override for missing Knowledge Review.',
      blockedReasonIds: decision.blockingReasons.map((reason) => reason.id),
      policyVersion: decision.policyVersion,
      provisional: false,
    })
  }, { runId: localRun.id, decision: clarifyGateDecision })
  expect(localLeadOverride.status).toBe('rejected')
  const rejectedOverrideStillBlocksApproval = await first.page.evaluate(async (runId) => {
    try {
      await window.aiDevFlowDesktop.approveGate({
        runId,
        nodeId: 'n-clarify-gate',
        projectId: 'p-payments',
        userId: 'u-ling',
        userName: 'Ling',
        role: 'lead',
      })
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('blocked')
    }
  }, localRun.id)
  expect(rejectedOverrideStillBlocksApproval).toBe(true)

  await selectWorkflowNode(first.page, 'flow-node-n-design-gate', '架构 Gate')
  await first.page.getByRole('button', { name: /Agent Review/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('Knowledge Review 已归档', {
    timeout: 20_000,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('warning-only')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Build redacted context')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('provider_reported')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await selectWorkflowNode(first.page, 'flow-node-n-design-gate', '架构 Gate')
  await expect(first.page.getByTestId('node-inspector')).toContainText('Knowledge Review Agent')
  await expect(first.page.getByTestId('node-inspector')).toContainText('warning-only')

  await selectWorkflowNode(first.page, 'flow-node-n-build', '本地实现')
  await first.page.getByRole('button', { name: /^Coding Agent$/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('Coding Agent 已请求权限', {
    timeout: 20_000,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Permission Relay')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Apply fake coding diff')
  await first.page.getByRole('button', { name: /Approve once/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('Coding Agent 已完成 fake diff 归档', {
    timeout: 30_000,
  })
  await expect(first.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('Test evidence passed')
  await expect(first.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  await first.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')
  await first.page.getByRole('button', { name: /工作台/ }).click()

  await first.page.getByRole('button', { name: /执行测试/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试通过，证据已归档', {
    timeout: 20_000,
  })
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('passed')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')
  await first.page.getByRole('button', { name: /工作台/ }).click()
  await expect(first.page.getByTestId('node-inspector')).toContainText('Local Test Evidence Standard')
  await expect(first.page.getByTestId('node-inspector')).toContainText('satisfied')
  await first.page.evaluate(async (runId) => {
    const state = await window.aiDevFlowDesktop.loadState()
    const run = state.runs.find((candidate) => candidate.id === runId)
    if (!run) {
      throw new Error(`Run not found for smoke sync: ${runId}`)
    }
    await window.aiDevFlowDesktop.uploadRunSummary({
      kind: 'run',
      runId: run.id,
      projectId: run.projectId,
      title: run.title,
      status: run.status,
      currentNodeId: run.currentNodeId,
      branchName: run.branchName,
      updatedAt: run.updatedAt,
    })
  }, localRun.id)

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
  await first.page.getByLabel('测试命令').fill(blockedCommand)
  await expect(first.page.getByText(/blocked/i)).toBeVisible()
  await first.page.getByRole('button', { name: /保存测试命令/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试命令已阻断')
  await first.app.close()

  const second = await launchApp()
  await expect(second.page.locator('html')).toHaveAttribute('data-theme-preference', 'light')
  await expect(second.page.getByText('重构 GitHub webhook 重试策略')).toBeVisible()
  await selectRunByTitle(second.page, '重构 GitHub webhook 重试策略')
  await selectWorkflowNode(second.page, 'flow-node-n-design-gate', '架构 Gate')
  const restoredOverrides = await second.page.evaluate(async (runId) => {
    return window.aiDevFlowDesktop.listGateOverrides({ runId })
  }, localRun.id)
  expect(
    restoredOverrides.some(
      (override) => override.nodeId === 'n-clarify-gate' && override.status === 'rejected',
    ),
  ).toBe(true)
  await second.page.getByRole('button', { name: /^Agents$/ }).click()
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('completed')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('devflow-fake-change.txt')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('warning-only')
  await expect(second.page.getByTestId('agent-workbench')).toContainText('Build redacted context')
  await second.page.getByRole('button', { name: /^MCP$/ }).click()
  await expect(second.page.getByRole('button', { name: /Enable/ }).first()).toBeVisible()
  await second.page.getByRole('button', { name: /^测试$/ }).click()
  await expect(second.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(second.page.getByTestId('tests-view')).toContainText('passed')
  await second.app.close()
} finally {
  vite?.kill('SIGTERM')
  web?.kill('SIGTERM')
  api?.kill('SIGTERM')
  await rm(tempRoot, { recursive: true, force: true })
}
