// Independent browser acceptance, not DevFlow canonical Test Evidence. No model/permission calls.
// Usage: node scripts/devflow-b-todo-browser-check.mjs /absolute/ready.json EXACT_CODING_RUN_ID
// Only a final change_acceptance pending / completed OpenCode Run is eligible. Reads its real
// Electron preload state, serves its retained worktree on a random loopback port, and writes only
// screenshots/report to the ignored scenario output. Never rewrites Todo sources or the profile.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { validateDescriptor } from './devflow-b-resume-desktop.mjs'

const storageKey = 'devflow-b-todo-v1'
const appFiles = { '/index.html': 'text/html; charset=utf-8', '/src/app.js': 'text/javascript; charset=utf-8', '/src/store.js': 'text/javascript; charset=utf-8' }
const sourceFiles = ['index.html', 'src/app.js', 'src/store.js', 'test/store.test.js', 'README.md', 'package.json']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export function selectFinalWorkspace(state, ready, codingRunId) {
  assert.equal(state.profileFingerprint, ready.profileFingerprint, 'Electron has another application profile')
  const run = state.runs.find(row => row.id === ready.runId)
  const project = state.projects.find(row => row.id === ready.projectId)
  assert(run?.projectId === ready.projectId && project?.path === ready.repo, 'Original Todo Workflow Run/project is missing')
  const coding = state.codingRuns.find(row => row.id === codingRunId)
  assert(coding?.runId === run.id && coding.projectId === project.id && coding.engine === 'opencode-http', 'Coding Run scope or engine mismatch')
  assert(['waiting_permission', 'completed'].includes(coding.status), 'Coding Run has not reached final change acceptance')
  const workspace = state.managedCodingWorkspaces.find(row => row.id === coding.managedWorkspaceId)
  assert(workspace?.codingRunId === coding.id && workspace.projectId === project.id && workspace.sourcePath === ready.repo, 'Managed worktree ownership mismatch')
  assert(!workspace.deletedAt && workspace.cleanupStatus !== 'deleted', 'Managed worktree was deleted')
  assert(workspace.worktreePath.startsWith(path.join(ready.profile, 'coding-worktrees') + path.sep), 'Worktree escaped the isolated profile')
  const permission = state.codingPermissionRequests.find(row => row.codingRunId === coding.id && row.origin === 'change_acceptance' &&
    row.status === (coding.status === 'completed' ? 'approved' : 'pending') && row.diffArtifactId === coding.diffArtifactId && row.testEvidenceId === coding.testEvidenceId)
  assert(permission?.runId === run.id && permission.nodeId === coding.nodeId && permission.managedWorkspaceId === workspace.id, 'Exact final change acceptance is missing')
  const evidence = state.testEvidence.find(row => row.id === permission.testEvidenceId)
  assert(evidence?.status === 'passed' && evidence.runId === run.id && evidence.nodeId === coding.nodeId && evidence.projectId === project.id && evidence.cwd === '<workspace>' && evidence.sourceTree?.workspaceId === workspace.id, 'Owned passed canonical test is missing')
  const diff = state.codingDiffArtifacts.find(row => row.id === permission.diffArtifactId)
  assert(diff?.runId === run.id && diff.nodeId === coding.nodeId && diff.projectId === project.id && !diff.truncated && /^[a-f0-9]{64}$/.test(diff.sourceDigest) && diff.sourceDigest === permission.diffSourceDigest, 'Exact final diff is missing')
  return { codingRunId, status: coding.status, workspaceId: workspace.id, worktreePath: workspace.worktreePath,
    permissionId: permission.id, permissionStatus: permission.status,
    canonicalTest: { id: evidence.id, status: evidence.status, command: evidence.command, sourceTree: evidence.sourceTree },
    diff: { id: diff.id, sourceDigest: diff.sourceDigest } }
}

async function fromElectron(ready, codingRunId) {
  const version = await (await fetch(new URL('/json/version', ready.cdpUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' })).json()
  const socket = new URL(version.webSocketDebuggerUrl)
  assert(socket.protocol === 'ws:' && socket.hostname === '127.0.0.1' && socket.port === new URL(ready.cdpUrl).port)
  const electron = await chromium.connectOverCDP(socket.href)
  try {
    const page = electron.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('file:') && page.url().endsWith('/index.html'))
    assert(page, 'A real Electron renderer is required')
    const state = await page.evaluate(async () => {
      const api = window.aiDevFlowDesktop
      if (!api) throw Error('Real Electron preload is missing')
      const [state, profile] = await Promise.all([api.loadState(), api.loadDataProfileDiagnostics()])
      const pick = (rows, keys) => rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]])))
      return { profileFingerprint: profile.pathFingerprint,
        runs: pick(state.runs, ['id', 'projectId']), projects: pick(state.projects, ['id', 'path']),
        codingRuns: pick(state.codingRuns, ['id', 'runId', 'projectId', 'nodeId', 'engine', 'status', 'managedWorkspaceId', 'diffArtifactId', 'testEvidenceId']),
        managedCodingWorkspaces: state.managedCodingWorkspaces,
        codingPermissionRequests: pick(state.codingPermissionRequests, ['id', 'codingRunId', 'runId', 'nodeId', 'managedWorkspaceId', 'origin', 'status', 'testEvidenceId', 'diffArtifactId', 'diffSourceDigest']),
        testEvidence: pick(state.testEvidence, ['id', 'runId', 'nodeId', 'projectId', 'status', 'cwd', 'command', 'sourceTree']),
        codingDiffArtifacts: pick(state.codingDiffArtifacts, ['id', 'runId', 'nodeId', 'projectId', 'truncated', 'sourceDigest']) }
    })
    return selectFinalWorkspace(state, ready, codingRunId)
  } finally { await electron.close() } // CDP disconnect only; does not close the existing Electron.
}

async function sourceSnapshot(worktree) {
  const files = {}
  for (const relative of sourceFiles) {
    const absolute = path.join(worktree, relative)
    assert.equal(await realpath(absolute), absolute, 'Todo source was replaced with a symlink')
    files[relative] = sha(await readFile(absolute))
  }
  return files
}

export async function serveTodo(worktree) {
  const server = createServer(async (request, response) => {
    try {
      // Exact allowlist avoids directory listings, dotfiles, path traversal and Git/profile exposure.
      const target = request.url === '/' ? '/index.html' : request.url
      if (!['GET', 'HEAD'].includes(request.method) || !Object.hasOwn(appFiles, target)) { response.writeHead(404).end(); return }
      const absolute = path.join(worktree, target)
      assert.equal(await realpath(absolute), absolute)
      const bytes = await readFile(absolute)
      assert(bytes.length <= 512 * 1024, 'Unexpectedly large Todo asset')
      response.writeHead(200, { 'Content-Type': appFiles[target], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch { response.writeHead(500).end('Unable to read isolated Todo asset') }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

async function exercise(page, origin, report, output) {
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey)
  const rows = page.getByRole('listitem')
  const rowFor = text => rows.filter({ has: page.getByRole('checkbox', { name: text, exact: true }) })
  const clear = page.getByRole('button', { name: /清除已完成/ })
  const check = async (name, operation) => { await operation(); report.checks.push({ name, status: 'passed' }) }
  const screenshot = async name => { const file = `${name}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.screenshots.push(file) }
  const matches = async expected => {
    assert.deepEqual(await stored(), expected, 'Stored objects/fields/order differ')
    await expect(rows).toHaveCount(expected.length)
    assert.deepEqual(await rows.getByRole('checkbox').evaluateAll(inputs => inputs.map(input => input.parentElement.textContent)), expected.map(task => task.text))
    for (const task of expected) await expect(rowFor(task.text).getByRole('checkbox')).toBeChecked({ checked: task.done })
  }
  const seed = [
    { id: 'keep-first', text: '保留第一项', done: false, priority: 2, metadata: { source: 'synthetic', labels: ['a'] } },
    { id: 'remove-one', text: '完成第一项', done: true, priority: 4 },
    { id: 'keep-second', text: '保留第二项', done: false, priority: 1, metadata: { source: 'synthetic', labels: ['b'] } },
    { id: 'remove-two', text: '完成第二项', done: true },
  ]
  await page.goto(origin, { waitUntil: 'networkidle' })
  // Seed once after initial navigation. Reloads below read the app's writes, never a reseeding hook.
  await page.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key: storageKey, seed })
  await page.reload({ waitUntil: 'networkidle' })
  await check('seed appears in order with checked states', () => matches(seed))
  await screenshot('01-seeded')
  const survivors = seed.filter(task => !task.done)
  await check('clear removes only completed items and preserves complete objects/order', async () => {
    await expect(clear).toBeEnabled(); await clear.click(); await matches(survivors); await expect(clear).toBeDisabled()
  })
  await screenshot('02-cleared')
  await check('refresh preserves cleared data', async () => { await page.reload(); await matches(survivors); await expect(clear).toBeDisabled() })
  let added
  await check('adding after clear and literal HTML text remain safe', async () => {
    await page.getByRole('textbox', { name: '新任务', exact: true }).fill('<b>x</b>')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const tasks = await stored(); added = tasks.at(-1)
    assert(added?.id && !survivors.some(task => task.id === added.id)); assert.equal(added.text, '<b>x</b>'); assert.equal(added.done, false)
    await matches([...survivors, added]); await expect(rowFor('<b>x</b>')).toContainText('<b>x</b>')
    await expect(rowFor('<b>x</b>').locator('b')).toHaveCount(0); await expect(clear).toBeDisabled()
  })
  await check('toggle both directions persists and controls clear availability', async () => {
    await rowFor(added.text).getByRole('checkbox').check(); await expect(clear).toBeEnabled()
    await page.reload(); await matches([...survivors, { ...added, done: true }]); await expect(clear).toBeEnabled()
    await rowFor(added.text).getByRole('checkbox').uncheck(); await matches([...survivors, added]); await expect(clear).toBeDisabled()
  })
  await screenshot('03-literal-text')
  await check('delete removes only its target and survives refresh', async () => {
    await rowFor(added.text).getByRole('button', { name: /删除/ }).click(); await matches(survivors)
    await page.reload(); await matches(survivors)
  })
  await check('clear all completed, refresh empty, then add again', async () => {
    for (const task of survivors) await rowFor(task.text).getByRole('checkbox').check()
    await expect(clear).toBeEnabled(); await clear.click(); await matches([]); await expect(clear).toBeDisabled()
    await page.reload(); await matches([]); await expect(clear).toBeDisabled()
    await page.getByRole('textbox', { name: '新任务', exact: true }).fill('清空后新增')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const tasks = await stored(); assert.equal(tasks.length, 1); assert.equal(tasks[0].text, '清空后新增'); assert.equal(tasks[0].done, false)
    await page.reload(); await matches(tasks); await expect(clear).toBeDisabled()
  })
  await screenshot('04-added-after-empty')
}

async function main() {
  const [readyFile, codingRunId, ...extra] = process.argv.slice(2)
  assert(readyFile && /^[\w-]+$/.test(codingRunId) && extra.length === 0, 'Provide ready.json and an exact CodingRun.id')
  const ready = validateDescriptor(JSON.parse(await readFile(readyFile, 'utf8')), readyFile)
  const selected = await fromElectron(ready, codingRunId)
  assert.equal(await realpath(selected.worktreePath), selected.worktreePath)
  await access(path.join(selected.worktreePath, '.git'))
  const before = await sourceSnapshot(selected.worktreePath)
  const output = path.join(ready.output, `todo-browser-${codingRunId}-${Date.now()}`)
  await mkdir(output, { mode: 0o700 })
  const report = { kind: 'independent-todo-browser-acceptance', status: 'running', startedAt: new Date().toISOString(),
    note: 'Independent real-browser behavior checks; does not replace, create or approve DevFlow canonical Test Evidence.',
    modelCalls: 0, syntheticLocalStorage: true, runId: ready.runId, projectId: ready.projectId, ...selected, sourceHashes: before,
    checks: [], screenshots: [], blockedNetwork: [], pageErrors: [] }
  let server, browser, page
  try {
    server = await serveTodo(selected.worktreePath)
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === server.origin) return route.continue()
      report.blockedNetwork.push({ protocol: url.protocol, hostname: url.hostname }); return route.abort()
    })
    await context.routeWebSocket('**/*', socket => { report.blockedNetwork.push({ protocol: 'websocket' }); socket.close() })
    page = await context.newPage()
    page.on('pageerror', error => report.pageErrors.push(error.message))
    await exercise(page, server.origin, report, output)
    assert.deepEqual(report.pageErrors, [], 'Browser JavaScript errors occurred')
    assert.deepEqual(report.blockedNetwork, [], 'Todo attempted an external request')
    const after = await fromElectron(ready, codingRunId)
    assert.equal(after.workspaceId, selected.workspaceId); assert.equal(after.worktreePath, selected.worktreePath)
    assert.deepEqual(after.diff, selected.diff); assert.deepEqual(after.canonicalTest, selected.canonicalTest)
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'; report.error = error.message
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).then(() => report.screenshots.push('failure.png')).catch(() => {})
    process.exitCode = 1
  } finally {
    await browser?.close(); await server?.close()
    try { assert.deepEqual(await sourceSnapshot(selected.worktreePath), before); report.sourceUnchanged = true }
    catch (error) { report.sourceUnchanged = false; report.status = 'failed'; report.sourceError = error.message; process.exitCode = 1 }
    report.completedAt = new Date().toISOString()
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ status: report.status, report: path.join(output, 'report.json'), modelCalls: 0 }))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
