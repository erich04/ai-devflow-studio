// Isolated runtime for the workspace baseline: temp user data, sample Git repo,
// in-memory demo Team API and an Electron app that loads the built renderer.
// Never touches the default user data directory or an existing database.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { chooseAvailableE2ePortBase } from '../e2e-runtime.mjs'

const execFileAsync = promisify(execFile)

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const desktopDir = path.join(rootDir, 'apps/desktop')
export const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const sessionSecret = 'workspace-baseline-session-secret-non-production-32-plus'

export type SampleRepoVariant = 'pass' | 'fail' | 'sleep' | 'none'

export interface Workspace {
  tempRoot: string
  userDataDir: string
  registryPath: string
  repoDir: string
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function createWorkspace(prefix = 'devflow-workspace-baseline-'): Promise<Workspace> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix))
  const userDataDir = path.join(tempRoot, 'user-data')
  await mkdir(userDataDir, { recursive: true })
  return {
    tempRoot,
    userDataDir,
    // A fresh registry avoids `explicit_profile_conflict` with a developer's selected profile.
    registryPath: path.join(tempRoot, 'data-profiles.json'),
    repoDir: path.join(tempRoot, 'health-api'),
  }
}

const testScripts: Record<Exclude<SampleRepoVariant, 'none'>, string> = {
  pass: 'node --test',
  fail: 'node -e "process.exit(1)"',
  // Longer than the desktop's fixed 120 s test timeout, short enough that no orphan lingers.
  sleep: 'node -e "setTimeout(() => {}, 180000)"',
}

/** Same content as the 2026-09-28 walkthrough repo so the baseline stays comparable. */
export async function createSampleRepo(repoDir: string, variant: SampleRepoVariant = 'pass'): Promise<void> {
  await mkdir(path.join(repoDir, 'src'), { recursive: true })
  await mkdir(path.join(repoDir, 'docs'), { recursive: true })
  const pkg: Record<string, unknown> = { name: path.basename(repoDir), version: '1.0.0', type: 'module' }
  if (variant !== 'none') pkg.scripts = { test: testScripts[variant] }
  await writeFile(path.join(repoDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(path.join(repoDir, 'src/health.js'), 'export function health() { return { status: "ok" } }\n')
  await writeFile(
    path.join(repoDir, 'src/health.test.js'),
    'import test from "node:test"\nimport assert from "node:assert"\nimport { health } from "./health.js"\ntest("health", () => assert.equal(health().status, "ok"))\n',
  )
  await writeFile(
    path.join(repoDir, 'docs/api-standards.md'),
    '# API Standards\n\n## Error handling\n\nAll endpoints return JSON errors.\n\n## Timeouts\n\nDependency probes must time out within 300 ms.\n',
  )
  const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir })
  await git(['init', '-q', '-b', 'main'])
  await git(['add', '.'])
  await git(['-c', 'user.name=workspace-baseline', '-c', 'user.email=workspace-baseline@example.invalid', 'commit', '-qm', 'init'])
}

function spawnQuiet(command: string, args: string[], env: Record<string, string>): ChildProcess {
  return spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      child.kill(signal)
    }
  }
  kill('SIGTERM')
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    delay(3_000).then(() => false),
  ])
  if (!exited) kill('SIGKILL')
}

async function waitForServer(url: string, attempts = 90): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // keep waiting
    }
    await delay(1_000)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export interface TeamApi {
  url: string
  process: ChildProcess
  log: string[]
}

/** In-memory demo Team API on a free port; database variables are cleared on purpose. */
export async function startTeamApi(workspace: Workspace): Promise<TeamApi> {
  const port = await chooseAvailableE2ePortBase()
  const child = spawnQuiet(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'dev'], {
    DATABASE_URL: '',
    DEVFLOW_DATABASE_URL: '',
    DEVFLOW_API_DIAGNOSTICS_PATH: path.join(workspace.tempRoot, 'api-diagnostics.json'),
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    DEV_AUTH_ENABLED: 'true',
    DEVFLOW_SESSION_SECRET: sessionSecret,
    PORT: String(port),
  })
  const log: string[] = []
  child.stdout?.on('data', (chunk) => log.push(String(chunk)))
  child.stderr?.on('data', (chunk) => log.push(String(chunk)))
  const url = `http://127.0.0.1:${port}`
  try {
    await waitForServer(`${url}/health`)
  } catch (error) {
    await stopProcess(child)
    throw new Error(`${(error as Error).message}\n${log.join('').slice(-2_000)}`)
  }
  return { url, process: child, log }
}

export interface DesktopApp {
  app: ElectronApplication
  page: Page
  diagnostics: string[]
}

// ---------------------------------------------------------------------------------------------
// Team API helpers. Sessions are signed with this process's own secret; nothing reaches a real service.

function sessionCookie(authAccountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, authAccountId, expiresAt: Math.floor(Date.now() / 1_000) + 8 * 60 * 60 }),
    'utf8',
  ).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `devflow_session=${payload}.${signature}`
}

/** Demo-header session accepted only because the isolated API runs with DEV_AUTH_ENABLED. */
export const demoSessionHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-erich',
  'x-devflow-user-role': 'owner',
  'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
}

export async function teamRequest(
  api: TeamApi,
  method: string,
  route: string,
  options: { body?: unknown; account?: string; demo?: boolean } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
  if (options.demo) Object.assign(headers, demoSessionHeaders)
  else headers.cookie = sessionCookie(options.account ?? 'acct-demo-u-ling')
  const response = await fetch(`${api.url}${route}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // keep text
  }
  return { status: response.status, body }
}

/** One-time pairing code for a Team Project (the demo project `p-payments` by default). */
export async function createPairingCode(api: TeamApi, projectId = 'p-payments', account = 'acct-demo-u-ling'): Promise<string> {
  const result = await teamRequest(api, 'POST', `/api/team/projects/${encodeURIComponent(projectId)}/pairing-codes`, { body: {}, account })
  if (result.status !== 201 || typeof result.body?.code !== 'string') {
    throw new Error(`Unable to create a pairing code: ${result.status}`)
  }
  return result.body.code
}

export async function createTeamProject(api: TeamApi, name: string): Promise<{ id: string }> {
  const result = await teamRequest(api, 'POST', '/api/team/projects', {
    account: 'acct-demo-u-erich',
    body: { name, slug: `baseline-${Date.now()}`, description: 'Isolated workspace baseline project.', repository: 'local/workspace-baseline' },
  })
  if (result.status !== 201) throw new Error(`Unable to create a Team Project: ${result.status}`)
  return result.body
}

// ---------------------------------------------------------------------------------------------
// Controlled model endpoint. The desktop may only reach loopback hosts; `api.deepseek.com`
// is redirected here when a sample installs a model server.

export interface ModelServer {
  url: string
  requests: unknown[]
  close: () => Promise<void>
}

export async function startModelServer(
  handler: (body: any, response: ServerResponse) => void,
): Promise<ModelServer> {
  const requests: unknown[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    let body: any = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
    } catch {
      body = null
    }
    requests.push(body)
    handler(body, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

export interface LaunchOptions {
  workspace: Workspace
  apiUrl: string
  theme?: 'light' | 'dark'
  /** Extra environment for the desktop main process; `undefined` removes a variable. */
  env?: Record<string, string | undefined>
}

/** Electron with the built renderer (no Vite dev server), isolated data and deterministic runtimes. */
export async function launchDesktop(options: LaunchOptions): Promise<DesktopApp> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.VITE_DEV_SERVER_URL
  Object.assign(env, {
    DEVFLOW_USER_DATA_DIR: options.workspace.userDataDir,
    DEVFLOW_DATA_PROFILE_REGISTRY_PATH: options.workspace.registryPath,
    DEVFLOW_API_BASE_URL: options.apiUrl,
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    // Same flags as the 2026-09-28 walkthrough, so the numbers stay comparable.
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    DEV_AUTH_ENABLED: 'true',
    DEVFLOW_CODING_ENGINE: 'fake',
    DEVFLOW_INITIAL_THEME: options.theme ?? 'light',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  })
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  // Playwright emulates `prefers-color-scheme: light` unless told otherwise, which overrides
  // DEVFLOW_INITIAL_THEME for the default "system" preference. Emulate the requested theme.
  const app = await electron.launch({ args: ['.'], cwd: desktopDir, env, colorScheme: options.theme ?? 'light' })
  const diagnostics: string[] = []
  app.process().stderr?.on('data', (chunk) => diagnostics.push(String(chunk)))
  // Keep synthetic credentials out of the OS keychain, as the Native and conversation smokes do.
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true
    safeStorage.encryptStringAsync = async (value: string) => Buffer.from(`workspace-baseline:${value}`)
    safeStorage.decryptStringAsync = async (bytes: Buffer) => {
      if (!bytes.toString().startsWith('workspace-baseline:')) throw new Error('Unexpected baseline credential')
      return { result: bytes.toString().slice('workspace-baseline:'.length), shouldReEncrypt: false }
    }
  })
  // No request may leave the machine. `api.deepseek.com` goes to a sample's controlled model server.
  await app.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = (input: any, init?: any) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const modelUrl = (globalThis as any).__workspaceBaselineModelUrl as string | undefined
      if (url.hostname === 'api.deepseek.com' && modelUrl) return original(`${modelUrl}${url.pathname}`, init)
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        return Promise.reject(new Error('Workspace baseline blocks external requests'))
      }
      // A sample may hold result uploads so the "uploading" state stays on screen long enough.
      if ((globalThis as any).__workspaceBaselineHoldSync && url.pathname.startsWith('/api/sync')) {
        return new Promise((resolve, reject) => {
          const timer = setInterval(() => {
            if ((globalThis as any).__workspaceBaselineHoldSync) return
            clearInterval(timer)
            original(input, init).then(resolve, reject)
          }, 200)
        })
      }
      return original(input, init)
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.topbar').waitFor({ state: 'visible', timeout: 30_000 })
  return { app, page, diagnostics }
}

export async function holdResultUploads(desktop: DesktopApp, hold: boolean): Promise<void> {
  await desktop.app.evaluate((_, value) => {
    ;(globalThis as any).__workspaceBaselineHoldSync = value
  }, hold)
}

export async function routeModelRequests(desktop: DesktopApp, modelUrl: string): Promise<void> {
  await desktop.app.evaluate((_, url) => {
    ;(globalThis as any).__workspaceBaselineModelUrl = url
  }, modelUrl)
}

/** Database of an isolated workspace; only touched while Electron is closed. */
export function databasePath(workspace: Workspace): string {
  return path.join(workspace.userDataDir, 'devflow.sqlite')
}

/** Runs raw SQL against the isolated database (Electron must be closed). */
export async function runSql(workspace: Workspace, sql: string): Promise<void> {
  const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'))
  const initSqlJs = requireFromDesktop('sql.js') as (config: { locateFile: (file: string) => string }) => Promise<any>
  const dist = path.dirname(requireFromDesktop.resolve('sql.js/dist/sql-wasm.js'))
  const SQL = await initSqlJs({ locateFile: (file) => path.join(dist, file) })
  const file = databasePath(workspace)
  const db = new SQL.Database(await readFile(file))
  try {
    db.run(sql)
    const temp = `${file}.baseline-${process.pid}`
    await writeFile(temp, Buffer.from(db.export()))
    await rename(temp, file)
  } finally {
    db.close()
  }
}

/** Makes the native folder picker return the sample repo. */
export async function stubRepositoryPicker(app: ElectronApplication, repoDir: string): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, repoDir)
}

export interface ContentSizeResult {
  requested: { width: number; height: number }
  actual: { width: number; height: number }
  valid: boolean
  minimumSizeRelaxed: boolean
  zoomFactor: number
}

/**
 * Sets the content (CSS viewport) size. The product minimum window size (1180×760) is
 * relaxed only inside this measuring process when a smaller size is requested.
 */
export async function setContentSize(
  desktop: DesktopApp,
  width: number,
  height: number,
  zoomFactor = 1,
): Promise<ContentSizeResult> {
  const minimumSizeRelaxed = await desktop.app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('No desktop window')
    const [minWidth, minHeight] = window.getMinimumSize() as [number, number]
    const relax = size.width < minWidth || size.height < minHeight
    if (relax) window.setMinimumSize(Math.min(minWidth, size.width), Math.min(minHeight, size.height))
    window.setContentSize(size.width, size.height)
    window.webContents.setZoomFactor(size.zoomFactor)
    return relax
  }, { width, height, zoomFactor })
  await delay(800)
  const viewport = await desktop.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  // At zoom Z the CSS viewport is the content size divided by Z.
  const expected = { width: Math.round(width / zoomFactor), height: Math.round(height / zoomFactor) }
  return {
    requested: { width, height },
    actual: viewport,
    valid: Math.abs(viewport.width - expected.width) <= 1 && Math.abs(viewport.height - expected.height) <= 1,
    minimumSizeRelaxed,
    zoomFactor,
  }
}

export async function screenInfo(desktop: DesktopApp) {
  return desktop.app.evaluate(({ screen, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const display = window ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay()
    return { workArea: display.workArea, size: display.size, scaleFactor: display.scaleFactor }
  })
}

export async function removeWorkspace(workspace: Workspace): Promise<void> {
  await rm(workspace.tempRoot, { recursive: true, force: true })
}

/** Path of the Electron binary installed for the desktop app. */
export function electronExecutable(): string {
  const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'))
  return requireFromDesktop('electron') as string
}
