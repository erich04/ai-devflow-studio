import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'

// Real Electron/IPC/SQLite/Git, synthetic local files, explicitly no Hindsight/model traffic.
// Build the desktop before running this script.
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-hindsight-electron-'))
const repository = path.join(temp, 'repository')
const userData = path.join(temp, 'user-data')
const git = (args) => promisify(execFile)('git', args, { cwd: repository })
const server = createServer((_request, response) => { response.writeHead(503); response.end() })
let app
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  await mkdir(path.join(repository, 'docs/knowledge'), { recursive: true })
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'hindsight-smoke', version: '1.0.0' }))
  await writeFile(path.join(repository, 'docs/knowledge/model.json'), JSON.stringify({
    version: 'smoke-v1', dimensions: [{ key: 'sem_kind', type: 'text' }],
  }))
  await writeFile(path.join(repository, 'docs/knowledge/refund.md'), '# 退款规则\n\n退款需要原始订单。\n')
  await git(['init', '-b', 'main'])
  await git(['add', '.'])
  const env = { ...process.env, DEVFLOW_USER_DATA_DIR: userData,
    DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(userData, 'data-profiles.json'),
    DEVFLOW_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true', DEVFLOW_CODING_ENGINE: 'fake',
    DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED: '', VITE_DEV_SERVER_URL: '',
  }
  async function launch() {
    app = await electron.launch({ args: ['.'], cwd: path.join(root, 'apps/desktop'), env })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return page
  }
  let page = await launch()
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, repository)
  const projectId = await page.evaluate(async () => {
    const project = await window.aiDevFlowDesktop.selectLocalProject()
    if (!project) throw new Error('Missing synthetic project')
    await window.aiDevFlowDesktop.createRun({ projectId: project.id, creatorId: 'hindsight-smoke-user',
      title: 'Hindsight 本地验证', request: '读取合成退款规范。', branchName: 'devflow/hindsight-smoke' })
    return project.id
  })
  const initial = await page.evaluate((projectId) => window.aiDevFlowDesktop.getHindsightStatus({ projectId }), projectId)
  expect(initial).toMatchObject({ configured: false, enabled: false, selectedPaths: [], transportAvailable: false })
  await page.reload()
  await page.locator('aside[aria-label="Primary navigation"]').getByRole('button', { name: '知识', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Hindsight 知识与记忆' })
  await expect(panel).toContainText('网络试点尚未启用')
  await panel.locator('summary').click()
  await panel.getByRole('checkbox', { name: '退款规则', exact: true }).check()
  await panel.getByRole('checkbox', { name: '允许此项目同步以上来源及脱敏搜索查询' }).check()
  await panel.getByRole('button', { name: '保存选择', exact: true }).click()
  await expect(panel).toContainText('已选择启用')
  const saved = await page.evaluate((projectId) => window.aiDevFlowDesktop.getHindsightStatus({ projectId }), projectId)
  expect(saved).toMatchObject({ configured: true, enabled: true, transportAvailable: false,
    selectedPaths: ['docs/knowledge/refund.md'], counts: { queued: 1 } })
  expect(JSON.stringify(saved)).not.toContain('encryptedApiKey')
  const forgedScopeRejected = await page.evaluate(async (projectId) => {
    try {
      await window.aiDevFlowDesktop.configureHindsight({ projectId, userId: 'forged',
        endpoint: 'http://127.0.0.1:8888', selectedPaths: [], includeMemories: false, enabled: true })
      return false
    } catch { return true }
  }, projectId)
  expect(forgedScopeRejected).toBe(true)
  await app.close(); app = undefined
  page = await launch()
  const restored = await page.evaluate((projectId) => window.aiDevFlowDesktop.getHindsightStatus({ projectId }), projectId)
  expect(restored).toMatchObject({ enabled: true, counts: { queued: 1 }, transportAvailable: false })
  // The cached catalogue cannot hide current source/model bytes.
  await writeFile(path.join(repository, 'docs/knowledge/refund.md'), '# 退款规则\n\n修改后的合成规范。\n')
  const revised = await page.evaluate((projectId) => window.aiDevFlowDesktop.refreshHindsight({ projectId }), projectId)
  expect(revised).toMatchObject({ counts: { queued: 1, cancelled: 1 } })
  await writeFile(path.join(repository, 'docs/knowledge/model.json'), JSON.stringify({
    version: 'smoke-v2', dimensions: [{ key: 'sem_kind', type: 'text' }],
  }))
  const changed = await page.evaluate((projectId) => window.aiDevFlowDesktop.refreshHindsight({ projectId }), projectId)
  expect(changed).toMatchObject({ enabled: false, counts: { cancelled: 2 } })
  console.log(JSON.stringify({ status: 'passed', realHindsight: false, paidModels: false,
    checks: ['renderer-selection', 'main-owned-scope', 'default-network-off', 'durable-restart', 'current-source-refresh', 'model-revocation'] }))
} finally {
  await app?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
