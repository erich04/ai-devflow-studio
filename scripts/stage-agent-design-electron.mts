import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import type { Artifact, WorkflowRun } from '../packages/shared/src/domain.ts'
import type {} from '../apps/desktop/src/desktop-api.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'

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
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: path.join(workspace, 'apps', 'desktop'), env: {
      PATH: process.env.PATH ?? '', HOME: input.root, XDG_CONFIG_HOME: path.join(input.root, 'config'),
      XDG_DATA_HOME: path.join(input.root, 'data'), XDG_CACHE_HOME: path.join(input.root, 'cache'),
      DEVFLOW_USER_DATA_DIR: userData, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userData, 'profiles.json'),
      DEVFLOW_OPENCODE_BIN: process.env.DEVFLOW_OPENCODE_BIN || 'opencode',
      DEVFLOW_API_BASE_URL: 'http://127.0.0.1:9', DEVFLOW_INITIAL_THEME: 'dark',
      VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    } })
    // No macOS keychain access: accept exactly the test secret seeded above, in this process only.
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isAsyncEncryptionAvailable = async () => true
      safeStorage.decryptStringAsync = async (bytes) => {
        if (bytes.toString() !== 'synthetic-not-billed') throw new Error('Unexpected test credential')
        return { result: 'synthetic-not-billed', shouldReEncrypt: false }
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1672, 973))
    return page
  }
  try {
    let page = await launch()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
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
    await expect.poll(async () => (await page.evaluate(() => window.aiDevFlowDesktop!.loadState())).artifacts
      .filter((item) => item.kind === 'design').length, { timeout: 60_000 }).toBe(1)
    const completed = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    const artifact = completed.artifacts.find((item) => item.kind === 'design')!
    assert.equal(artifact.designEvidence?.executor.kind, 'local-agent')
    assert.equal(artifact.designEvidence?.executor.providerId, 'design-fixture')
    assert.equal(artifact.designEvidence?.repositoryFindings?.citations[0]?.path, 'task.ts')
    assert.equal(completed.runs[0]!.nodes.find((node) => node.id === completed.runs[0]!.currentNodeId)?.kind, 'gate')
    assert.equal(completed.runs[0]!.nodes.find((node) => node.id === completed.runs[0]!.currentNodeId)?.status, 'running')
    const configuration = await page.evaluate((projectId) => window.aiDevFlowDesktop!.getCodingRuntimeConfiguration({ projectId }), input.run.projectId)
    assert.equal(configuration, null)
    await page.getByTestId(`flow-node-${input.run.currentNodeId}`).click()
    await page.getByTestId('node-inspector').getByRole('tab', { name: '产物', exact: true }).click()
    await page.getByText('设计输入与代码核验依据', { exact: true }).click()
    await page.getByTestId('node-inspector').locator('details').last().scrollIntoViewIfNeeded()
    await expect(page.getByTestId('node-inspector')).toContainText('task.ts:1')
    await page.screenshot({ path: path.join(output, '02-design-evidence.png'), scale: 'css' })
    await page.getByRole('button', { name: 'Agents', exact: true }).click()
    await expect(page.getByText('DevFlow Native（内置编码执行器）', { exact: true })).toBeVisible()
    await expect(page.getByText('项目执行工具', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: '执行工具', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, '03-execution-tool-names.png'), scale: 'css' })
    await app!.close(); app = undefined
    page = await launch()
    const restored = await page.evaluate(() => window.aiDevFlowDesktop!.loadState())
    assert.deepEqual(restored.artifacts.find((item) => item.id === artifact.id), artifact)
    assert.deepEqual(restored.runs, completed.runs)
    assert.equal(input.requestCount(), callsBeforeCancel + 3)
    console.log(JSON.stringify({ electronDesignPassed: true, realMainAndPreload: true,
      cancelAndRetry: true, reviewGateAwaitingHuman: true, codingConfigurationUnchanged: true,
      restartPreserved: true, keychain: 'synthetic test adapter; no OS credentials accessed' }))
  } finally { await app?.close() }
}
