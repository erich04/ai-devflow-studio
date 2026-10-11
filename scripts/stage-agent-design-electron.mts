import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import type { Artifact, WorkflowRun } from '../packages/shared/src/domain.ts'
import type {} from '../apps/desktop/src/desktop-api.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'

const sessionSecret = 'stage-design-smoke-isolated-session-secret-32'

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') throw new Error('No free port for the isolated Team API')
  return address.port
}

/**
 * In-memory demo Team API. Since #168 every stage model call is admitted against the paired
 * Team Project's policy snapshot and budget, so the design step needs a real Team boundary.
 */
async function startIsolatedTeamApi(workspace: string, root: string) {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  let log = ''
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.join(workspace, 'apps/api'),
    env: { ...process.env, DATABASE_URL: '', DEVFLOW_DATABASE_URL: '', DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEV_AUTH_ENABLED: 'true', DEVFLOW_SESSION_SECRET: sessionSecret, PORT: String(port), HOST: '127.0.0.1',
      DEVFLOW_GITHUB_APP_ID: '', DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64: '',
      DEVFLOW_API_DIAGNOSTICS_PATH: path.join(root, 'api-diagnostics.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { log = (log + chunk).slice(-8_000) })
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Isolated Team API exited: ${log}`)
    if (await fetch(`${url}/ready`).then((response) => response.ok).catch(() => false)) break
    if (attempt === 149) throw new Error(`Isolated Team API did not become ready: ${log}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const post = async (route: string, body: unknown) => {
    const payload = Buffer.from(JSON.stringify({ v: 1, authAccountId: 'acct-demo-u-erich',
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600 })).toString('base64url')
    const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
    const response = await fetch(`${url}${route}`, { method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `devflow_session=${payload}.${signature}` }, body: JSON.stringify(body) })
    assert.equal(response.status, 201, `Team API ${route} failed with ${response.status}`)
    return response.json() as Promise<Record<string, unknown>>
  }
  const project = await post('/api/team/projects', { name: 'Stage design smoke', slug: `stage-design-${Date.now()}`,
    repository: 'local/stage-design-smoke', description: 'Isolated no-cost design stage verification.' })
  const pairing = await post(`/api/team/projects/${encodeURIComponent(String(project.id))}/pairing-codes`, {})
  return {
    url,
    pairingCode: String(pairing.code),
    stop: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

/** Isolated real Main/preload/renderer test. All model responses and credentials are synthetic. */
export async function verifyDesignInElectron(input: {
  root: string; repository: string; run: WorkflowRun; artifacts: Artifact[]; endpoint: string
  setHold: (value: boolean) => void; requestCount: () => number
}) {
  const workspace = fileURLToPath(new URL('..', import.meta.url))
  const userData = path.join(input.root, 'electron-profile')
  const output = path.join(workspace, 'output', 'playwright', 'stage-agent-design')
  await mkdir(output, { recursive: true })
  const store = await createLocalStore({ dbPath: path.join(userData, 'devflow.sqlite') })
  await store.upsertProject({ id: input.run.projectId, name: 'Design verification fixture', path: input.repository,
    packageManager: 'npm', testCommand: 'npm test', createdAt: input.run.createdAt, updatedAt: input.run.updatedAt })
  await store.saveRun(input.run)
  for (const artifact of input.artifacts) await store.saveArtifact(artifact)
  await store.saveProviderCredential({ providerId: 'design-fixture', name: 'Local fixture model', model: 'contract-model',
    baseUrl: input.endpoint, maskedCredential: 'synthetic-only', updatedAt: input.run.updatedAt },
  Buffer.from('synthetic-not-billed').toString('base64'))
  await store.saveSettings({ selectedAgentProviderId: 'design-fixture', themePreference: 'dark' })
  store.close()
  const team = await startIsolatedTeamApi(workspace, input.root)
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: path.join(workspace, 'apps', 'desktop'), env: {
      PATH: process.env.PATH ?? '', HOME: input.root, XDG_CONFIG_HOME: path.join(input.root, 'config'),
      XDG_DATA_HOME: path.join(input.root, 'data'), XDG_CACHE_HOME: path.join(input.root, 'cache'),
      DEVFLOW_USER_DATA_DIR: userData, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userData, 'profiles.json'),
      DEVFLOW_OPENCODE_BIN: process.env.DEVFLOW_OPENCODE_BIN || 'opencode',
      DEVFLOW_API_BASE_URL: team.url, DEVFLOW_INITIAL_THEME: 'dark',
      VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    } })
    // No macOS keychain access: accept exactly the test secret seeded above, in this process only.
    // The pairing token saved by this test is encrypted with the same in-process adapter.
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isAsyncEncryptionAvailable = async () => true
      safeStorage.encryptStringAsync = async (value: string) => Buffer.from(`stage-design-smoke:${value}`)
      safeStorage.decryptStringAsync = async (bytes) => {
        const text = bytes.toString()
        if (text === 'synthetic-not-billed') return { result: text, shouldReEncrypt: false }
        if (text.startsWith('stage-design-smoke:')) return { result: text.slice('stage-design-smoke:'.length), shouldReEncrypt: false }
        throw new Error('Unexpected test credential')
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1672, 973))
    return page
  }
  try {
    let page = await launch()
    // Governed model calls need the paired Team Project's policy and budget (#168). The synthetic
    // model has no price, so this test project's budget guard is explicitly disabled.
    await page.evaluate((pairing) => window.aiDevFlowDesktop!.pairDesktop(pairing),
      { code: team.pairingCode, localProjectId: input.run.projectId })
    await page.evaluate((projectId) => window.aiDevFlowDesktop!.saveCodingRuntimeBudgetPolicy({
      projectId, enabled: false, monthlyLimitUsd: 1, warningThresholdUsd: 0.5 }), input.run.projectId)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('aside[aria-label="Primary navigation"]').getByRole('button', { name: /^任务中心/ }).click()
    try { await page.getByRole('button', { name: `继续任务：${input.run.title}`, exact: true }).click() } catch (error) {
      await page.screenshot({path:path.join(output,'failure-task-center.png')})
      console.error('Task center:', await page.locator('main').innerText().catch(()=>'unavailable'))
      throw error
    }
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
    // Sub-steps are folded into the browsed stage item (plan L2, Y6); open them before clicking a node.
    const openSubSteps = async () => {
      const toggle = page.locator('[data-testid="stage-item"][aria-expanded="false"]')
      if ((await toggle.count()) > 0) await toggle.click()
    }
    await openSubSteps()
    await page.getByTestId(`flow-node-${input.run.currentNodeId}`).click()
    await expect(page.getByRole('combobox', { name: '本节点使用的模型' })).toHaveValue('design-fixture')
    await page.getByRole('combobox', { name: '设计执行器' }).selectOption('local-agent')
    await page.screenshot({ path: path.join(output, '01-design-choice.png'), scale: 'css' })
    input.setHold(true)
    const callsBeforeCancel = input.requestCount()
    await page.getByTestId('complete-design-agent').click()
    await expect.poll(input.requestCount, { timeout: 45_000 }).toBeGreaterThan(callsBeforeCancel)
    await page.getByRole('button', { name: '取消生成', exact: true }).click()
    await expect(page.getByTestId('complete-design-agent')).toBeEnabled({ timeout: 15_000 })
    const cancelled = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    assert.equal(cancelled.runs[0]!.currentNodeId, input.run.currentNodeId)
    assert.equal(cancelled.artifacts.filter((item) => item.kind === 'design').length, 0)
    assert(cancelled.agentTraces.some((trace) => trace.steps.some((step) => step.summary.includes('cancelled'))))
    input.setHold(false)
    await page.getByTestId('complete-design-agent').click()
    try {
      await expect.poll(async () => (await page.evaluate(() => window.aiDevFlowDesktop!.loadState())).artifacts
        .filter((item) => item.kind === 'design').length, { timeout: 60_000 }).toBe(1)
    } catch (error) {
      // Say why the design was not produced: the latest traces, events and on-screen notice.
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
      await page.screenshot({ path: path.join(output, 'failure-retry.png'), scale: 'css' }).catch(() => undefined)
      console.error(JSON.stringify({
        statusRow: await page.getByTestId('task-status-row').innerText().catch(() => null),
        dialogs: await page.getByRole('dialog').allInnerTexts().catch(() => []),
        toast: await page.getByTestId('toast').textContent().catch(() => null),
        traces: state.agentTraces.slice(-3).map((trace) => trace.steps.map((step) => step.summary)),
        events: state.events.slice(-3).map((event) => event.message),
        providerRequests: input.requestCount(),
      }, null, 2))
      throw error
    }
    const completed = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const artifact = completed.artifacts.find((item) => item.kind === 'design')!
    assert.equal(artifact.designEvidence?.executor.kind, 'local-agent')
    assert.equal(artifact.designEvidence?.executor.providerId, 'design-fixture')
    assert.equal(artifact.designEvidence?.repositoryFindings?.citations[0]?.path, 'task.ts')
    assert.equal(completed.runs[0]!.nodes.find((node) => node.id === completed.runs[0]!.currentNodeId)?.kind, 'gate')
    assert.equal(completed.runs[0]!.nodes.find((node) => node.id === completed.runs[0]!.currentNodeId)?.status, 'running')
    const configuration = await page.evaluate((projectId) => window.aiDevFlowDesktop!.getCodingRuntimeConfiguration({ projectId }), input.run.projectId)
    assert.equal(configuration, null)
    await openSubSteps()
    await page.getByTestId(`flow-node-${input.run.currentNodeId}`).click()
    await page.getByTestId('node-inspector').getByRole('tab', { name: '材料与版本', exact: true }).click()
    await page.getByText('设计输入与代码核验依据', { exact: true }).click()
    await page.getByTestId('node-inspector').locator('details').last().scrollIntoViewIfNeeded()
    await expect(page.getByTestId('node-inspector')).toContainText('task.ts:1')
    await page.screenshot({ path: path.join(output, '02-design-evidence.png'), scale: 'css' })
    // A saved proposal never replaces a design automatically. Exercise the new real renderer → Main path.
    await page.getByRole('button', { name: '到方案评审生成新版', exact: true }).click()
    const revisionPanel = page.getByRole('region', { name: '修订方案', exact: true })
    await expect(revisionPanel).toBeVisible()
    await revisionPanel.getByRole('combobox', { name: '设计执行器' }).selectOption('direct-provider')
    await expect(revisionPanel.getByRole('button', { name: '根据提案生成新版方案', exact: true })).toBeDisabled()
    await revisionPanel.getByRole('checkbox').check()
    const beforeRevisionCalls = input.requestCount()
    input.setHold(true)
    await revisionPanel.getByRole('button', { name: '根据提案生成新版方案', exact: true }).click()
    await expect.poll(input.requestCount, { timeout: 30_000 }).toBeGreaterThan(beforeRevisionCalls)
    await page.getByRole('button', { name: '取消生成', exact: true }).click()
    await expect(revisionPanel.getByRole('button', { name: '根据提案生成新版方案', exact: true })).toBeEnabled({ timeout: 15_000 })
    const cancelledRevision = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    assert.deepEqual(cancelledRevision.runs, completed.runs)
    assert.deepEqual(cancelledRevision.artifacts, completed.artifacts)
    input.setHold(false)
    await revisionPanel.getByRole('button', { name: '根据提案生成新版方案', exact: true }).click()
    try {
      await expect.poll(async () => (await page.evaluate(() => window.aiDevFlowDesktop!.loadState())).artifacts
        .filter((item) => item.kind === 'design').length, { timeout: 30_000 }).toBe(2)
    } catch (error) {
      const state = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
      await page.screenshot({ path: path.join(output, 'failure-revision.png'), scale: 'css' })
      console.error(JSON.stringify({ revisionFailure: true,
        status: await page.getByTestId('task-status-row').innerText(),
        toast: await page.getByTestId('toast').textContent().catch(() => null),
        traces: state.agentTraces.slice(-3).map((trace) => trace.steps.map((step) => step.summary)),
        events: state.events.slice(-3).map((event) => event.message), providerRequests: input.requestCount() }, null, 2))
      throw error
    }
    const revised = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const newDesign = revised.artifacts.find((item) => item.designRevision)!
    assert.equal(newDesign.designRevision!.previous.artifactId, artifact.id)
    assert.equal(newDesign.designRevision!.proposals[0]!.artifactId, 'conversation-proposal-design-contract')
    assert.deepEqual(revised.artifacts.find((item) => item.id === artifact.id), artifact)
    assert.equal(revised.runs[0]!.currentNodeId, completed.runs[0]!.currentNodeId)
    assert.equal(revised.runs[0]!.status, 'paused_at_gate')
    assert.deepEqual(revised.runs[0]!.nodes.map((item) => item.status), completed.runs[0]!.nodes.map((item) => item.status))
    assert.equal(revised.runs[0]!.nodes.find((item) => item.id === revised.runs[0]!.currentNodeId)!.artifactIds.includes(newDesign.id), true)
    await expect(page.getByTestId('node-inspector')).toContainText('Revised task filter design')
    await page.screenshot({ path: path.join(output, '04-revised-design-awaiting-review.png'), scale: 'css' })
    await page.getByRole('button', { name: '查看历史方案与提案', exact: true }).click()
    await expect(page.getByRole('region', { name: '历史记录', exact: true })).toContainText('已被替代（历史）')
    await page.screenshot({ path: path.join(output, '05-design-history.png'), scale: 'css' })
    // The execution tool is configured in 设置／模型与执行方式 since S3 (plan Y2).
    await page.locator('aside[aria-label="Primary navigation"]').getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '模型与执行方式', exact: true }).click()
    const executionTool = page.locator('details.runtime-settings').filter({ has: page.locator('summary', { hasText: '项目执行工具 · 本地项目' }) })
    if ((await executionTool.getAttribute('open')) === null) await executionTool.locator(':scope > summary').click()
    await expect(page.getByText('DevFlow Native（内置编码执行器）', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: '执行工具', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, '03-execution-tool-names.png'), scale: 'css' })
    const callsBeforeRestart = input.requestCount()
    await app!.close(); app = undefined
    page = await launch()
    const restored = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    assert.deepEqual(restored.artifacts.find((item) => item.id === artifact.id), artifact)
    assert.deepEqual(restored.artifacts.find((item) => item.id === newDesign.id), newDesign)
    assert.deepEqual(restored.runs, revised.runs)
    assert.equal(input.requestCount(), callsBeforeRestart)
    assert.equal(callsBeforeRestart, beforeRevisionCalls + 2)
    console.log(JSON.stringify({ electronDesignPassed: true, realMainAndPreload: true,
      cancelAndRetry: true, designRevisionCancelAndRetry: true, previousDesignPreserved: true,
      reviewGateAwaitingHuman: true, codingConfigurationUnchanged: true,
      restartPreserved: true, governedByIsolatedTeamApi: true,
      keychain: 'synthetic test adapter; no OS credentials accessed' }))
  } finally {
    await app?.close()
    await team.stop()
  }
}
