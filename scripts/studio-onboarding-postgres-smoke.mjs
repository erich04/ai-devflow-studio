import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron as electron, expect } from '@playwright/test'

// Real Web / API / Postgres / Electron integration. No model is invoked by this smoke.
const root = fileURLToPath(new URL('..', import.meta.url))
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { Pool } = requireApi('pg')
const baseDatabaseUrl = process.env.DEVFLOW_DATABASE_URL
if (!baseDatabaseUrl) throw new Error('Set DEVFLOW_DATABASE_URL to the dedicated smoke Postgres instance.')
const schema = `studio_onboarding_${process.pid}_${Date.now()}`
const databaseUrl = new URL(baseDatabaseUrl)
databaseUrl.searchParams.set('options', `${databaseUrl.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim())
const admin = new Pool({ connectionString: baseDatabaseUrl })
const db = new Pool({ connectionString: databaseUrl.toString() })
const temporary = await mkdtemp(path.join(tmpdir(), 'devflow-studio-onboarding-'))
const artifactDir = path.resolve(process.env.DEVFLOW_STUDIO_SMOKE_OUTPUT ?? path.join(root, 'out/studio-onboarding-smoke'))
await mkdir(artifactDir, { recursive: true })
const children = []
let browser
let desktop
const browserErrors = []

async function port() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
function start(args, env) {
  const child = spawn(corepack, args, { cwd: root, env: { ...process.env, ...env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  // Keep service logs in the parent test log; no headers or credentials are logged.
  child.stdout.on('data', (data) => process.stdout.write(data))
  child.stderr.on('data', (data) => process.stderr.write(data))
  return child
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* bounded retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Service did not become ready: ${new URL(url).origin}`)
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const signal = (name) => { try { process.platform === 'win32' ? child.kill(name) : process.kill(-child.pid, name) } catch { /* already stopped */ } }
  signal('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))])
  if (child.exitCode === null && child.signalCode === null) signal('SIGKILL')
}

try {
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const migration = start(['pnpm', '--filter', '@ai-devflow/api', 'db:migrate'], { DEVFLOW_DATABASE_URL: databaseUrl.toString() })
  if (await new Promise((resolve) => migration.once('exit', resolve)) !== 0) throw new Error('Smoke migration failed')
  const apiPort = await port()
  const webPort = await port()
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://127.0.0.1:${webPort}`
  const commonEnv = {
    DEVFLOW_DEPLOYMENT_PROFILE: 'development', DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
    DEVFLOW_LOCAL_AUTH_ENABLED: 'true', DEVFLOW_REQUIRE_AUTH: 'true', DEV_AUTH_ENABLED: 'false',
    DEVFLOW_SESSION_SECRET: randomBytes(32).toString('hex'), DEVFLOW_WEB_APP_URL: webUrl,
    DEVFLOW_DATABASE_URL: databaseUrl.toString(), DEVFLOW_API_BASE_URL: apiUrl, NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
  }
  start(['pnpm', '--filter', '@ai-devflow/api', 'exec', 'tsx', 'src/server.ts'], { ...commonEnv, HOST: '127.0.0.1', PORT: String(apiPort) })
  await ready(`${apiUrl}/ready`)
  start(['pnpm', '--filter', '@ai-devflow/web', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(webPort)], commonEnv)
  await ready(`${webUrl}/health`)
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const navigation = []
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigation.push(frame.url()) })
  await page.goto(webUrl)
  await page.getByRole('button', { name: '使用本地开发身份' }).click()
  await expect(page.getByText('还没有团队项目。')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建团队项目' })).toBeEnabled()
  await page.screenshot({ path: path.join(artifactDir, '01-empty-studio.png'), fullPage: true, caret: 'initial' })
  await page.getByRole('button', { name: '创建团队项目' }).click()
  const dialog = page.getByRole('dialog', { name: '创建团队项目' })
  for (const [label, value] of Object.entries({ Name: 'Studio Cold Start', Slug: 'studio-cold-start', Repository: 'fixture/mini-agent', Description: 'One small requirement from a fresh Studio project.' })) {
    await dialog.getByLabel(label, { exact: true }).fill(value)
  }
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page).toHaveURL(`${webUrl}/?projectId=p-studio-cold-start`)
  await page.getByLabel('Work Request title').fill('Update the README heading')
  await page.getByLabel('Work Request details').fill('Change the README heading to Mini Agent Ready, preserving all other content.')
  await page.getByRole('button', { name: 'Create Work Request', exact: true }).click()
  await expect(page.getByText('Work Request created. A paired Desktop can now claim it.')).toBeVisible()
  await page.screenshot({ path: path.join(artifactDir, '02-project-request.png'), fullPage: true, caret: 'initial' })
  expect(navigation.some((url) => url.includes('/legacy-shell'))).toBe(false)
  expect((await db.query("SELECT id FROM projects WHERE id = 'p-studio-cold-start'")).rowCount).toBe(1)

  // The copy-once pairing code stays in this process and the normal Electron IPC call.
  await page.getByRole('button', { name: 'Create desktop pairing code' }).click()
  const code = await page.getByLabel('Desktop pairing code for p-studio-cold-start').innerText()
  const repo = path.join(temporary, 'mini-agent')
  await mkdir(repo)
  await writeFile(path.join(repo, 'README.md'), '# Mini Agent\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.name=Studio QA', '-c', 'user.email=studio-qa@example.invalid', 'commit', '-m', 'Initialize fixture'], { cwd: repo, stdio: 'ignore' })
  const desktopEnv = { ...process.env, ...commonEnv, DEVFLOW_USER_DATA_DIR: path.join(temporary, 'profile'), DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(temporary, 'profiles.json') }
  delete desktopEnv.ELECTRON_RUN_AS_NODE
  delete desktopEnv.VITE_DEV_SERVER_URL
  desktop = await electron.launch({ executablePath: requireDesktop('electron'), cwd: path.join(root, 'apps/desktop'), args: ['.'], env: desktopEnv })
  const window = await desktop.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await desktop.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }) }, repo)
  await window.getByRole('button', { name: '选择本地仓库' }).click()
  const binding = await window.evaluate(async ({ code, repo }) => {
    const api = window.aiDevFlowDesktop
    const state = await api.loadState()
    const project = state.projects.find((item) => item.path === repo)
    if (!project) throw new Error('Selected local project is missing')
    await api.pairDesktop({ code, localProjectId: project.id })
    await api.loadRemoteSnapshot()
    const requests = await api.listWorkRequests({ localProjectId: project.id })
    const request = requests.find((item) => item.title === 'Update the README heading')
    if (!request) throw new Error('Cloud request is missing from Desktop inbox')
    const materialized = await api.materializeWorkRequest({ localProjectId: project.id, workRequestId: request.id, expectedVersion: request.version })
    const gate = materialized.run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')
    const input = { runId: materialized.run.id, nodeId: gate.id, projectId: project.id }
    const initial = await api.loadEnforcementPolicy({ projectId: project.id })
    const decision = await api.evaluateGateEnforcement(input)
    return { input, initialVersion: initial.version, initialSource: initial.source, initialStatus: decision.status }
  }, { code, repo })
  expect(binding.initialSource).toBe('remote_cache')
  expect(binding.initialVersion).toBe(1)
  expect(binding.initialStatus).toBe('warn')
  // Navigate away before any more screenshots so the one-time code is never captured.
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('link', { name: 'Policy', exact: true }).click()
  const policy = page.locator('#team-policy')
  await expect(policy).toContainText('默认回退 · 尚未保存到 Team')
  await policy.getByRole('button', { name: '使用 Recommended 预设' }).click()
  await expect(policy.getByLabel('规则 1 动作', { exact: true })).toHaveValue('block')
  await policy.getByRole('button', { name: '预览变更' }).click()
  await expect(policy.getByRole('region', { name: 'Policy 变更预览' })).toBeVisible()
  await page.screenshot({ path: path.join(artifactDir, '03-policy-preview.png'), fullPage: true, caret: 'initial' })
  await policy.getByRole('button', { name: '确认保存' }).click()
  await expect(policy.getByRole('status')).toContainText('v2')
  await expect(policy).toContainText('Team 已保存')
  await page.reload()
  await expect(policy.getByLabel('规则 1 动作', { exact: true })).toHaveValue('block')
  const rows = (await db.query('SELECT policy FROM enforcement_policies WHERE project_id IS NULL')).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].policy.version).toBe(2)

  // Competing confirmed edits must not silently overwrite one another.
  const prior = rows[0].policy
  const expectedPolicy = { id: prior.id, version: prior.version, updatedAt: prior.updatedAt }
  const edits = ['Concurrent A', 'Concurrent B'].map((name) => ({ ...prior, name, version: 3, updatedAt: new Date().toISOString() }))
  const writes = await Promise.all(edits.map((organizationPolicy) => context.request.put(`${apiUrl}/api/enforcement/policy`, { data: { organizationPolicy, expectedPolicy } })))
  expect(writes.map((response) => response.status()).sort()).toEqual([200, 409])
  const synced = await window.evaluate(async (input) => {
    await window.aiDevFlowDesktop.loadRemoteSnapshot()
    const policy = await window.aiDevFlowDesktop.loadEnforcementPolicy({ projectId: input.projectId })
    const decision = await window.aiDevFlowDesktop.evaluateGateEnforcement(input)
    return { source: policy.source, version: policy.version, status: decision.status, blocksApproval: decision.blocksApproval }
  }, binding.input)
  expect(synced).toMatchObject({ source: 'remote_cache', version: 3, status: 'blocked', blocksApproval: true })
  await writeFile(path.join(artifactDir, 'result.json'), JSON.stringify({ projectId: 'p-studio-cold-start', requestMaterialized: true, before: binding, after: synced, concurrentWrites: [200, 409], providerCalls: 0 }, null, 2))
  expect(browserErrors).toEqual([])
  console.log('Studio cold-start Web → Postgres → pairing → Desktop intake → Policy save/sync/Gate regression passed. No model calls.')
} finally {
  if (browserErrors.length) console.error('Browser errors:', browserErrors.map((error) => error.slice(0, 3000)))
  await desktop?.close().catch(() => {})
  await browser?.close().catch(() => {})
  for (const child of children.reverse()) await stop(child)
  await db.end()
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await admin.end()
  await rm(temporary, { recursive: true, force: true })
}
