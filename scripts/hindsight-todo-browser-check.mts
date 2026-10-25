/**
 * Run only after the generated Todo changes have been reviewed and applied.
 * DEVFLOW_TODO_MANAGED_REPOSITORY=<verified managed Todo path>
 * DEVFLOW_TODO_ORIGINAL_REPOSITORY=<this run's unchanged isolated Todo baseline>
 * DEVFLOW_TODO_BROWSER_OUTPUT=<evidence directory>
 * node --import tsx scripts/hindsight-todo-browser-check.mts
 *
 * Uses an installed Playwright Chromium with a new private profile. No model calls,
 * package installation or source writes. All page requests must stay on its loopback origin.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'

const execute = promisify(execFile)
const storageKey = 'tasklist.tasks.v1'
const warning = '当前浏览器无法保存数据，刷新后内容会丢失'
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
type Task = { id: string; text: string; done: boolean; createdAt: number }
export interface HindsightTodoBrowserInput {
  managedRepository: string
  originalRepository: string
  output: string
  chromiumExecutablePath?: string
  headed?: boolean
}
export interface HindsightTodoBrowserReport {
  passed: boolean
  startedAt: string
  finishedAt?: string
  engine: 'real-playwright-chromium'
  modelCalls: false
  originalRepository?: string
  managedRepository?: string
  privateProfile?: string
  executablePath?: string
  origin?: string
  checks: string[]
  screenshots: string[]
  blockedExternalRequests: string[]
  pageErrors: string[]
  sourceDigestsBefore?: Record<string, string>
  sourceDigestsAfter?: Record<string, string>
  sourceBytesUnchanged?: boolean
  storageFailure?: { memoryUiRemovedCompleted: true; persistedDataUnchanged: true; refreshRestoresOldData: true }
  failure?: string
}

async function repositoryDigests(repository: string) {
  const { stdout } = await execute('git', ['-C', repository, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { maxBuffer: 1024 * 1024 })
  const files = [...new Set(stdout.split('\0').filter(Boolean))].sort()
  assert(files.length > 0 && files.length <= 1000, 'Expected the small isolated Todo repository')
  return Object.fromEntries(await Promise.all(files.map(async (file) => {
    const target = await realpath(path.join(repository, file))
    assert(inside(repository, target), 'A Todo source resolved outside the validated repository')
    return [file, digest(await readFile(target))]
  })))
}

export async function verifyHindsightTodoBrowser(input: HindsightTodoBrowserInput): Promise<HindsightTodoBrowserReport> {
  assert(input.managedRepository && input.originalRepository && input.output, 'Provide both verified repositories and an evidence directory')
  const output = path.resolve(input.output)
  await mkdir(output, { recursive: true })
  const report: HindsightTodoBrowserReport = {
    passed: false, startedAt: new Date().toISOString(), engine: 'real-playwright-chromium', modelCalls: false,
    checks: [], screenshots: [], blockedExternalRequests: [], pageErrors: [],
  }
  const save = () => writeFile(path.join(output, 'browser-check-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  let context: BrowserContext | undefined
  let server: Server | undefined
  let page: Page | undefined
  let originalServerPath: string | undefined
  let originalServerDigest: string | undefined
  let dialogs = 0
  const screenshot = async (name: string) => {
    if (!page || page.isClosed()) return
    const destination = path.join(output, name)
    await page.screenshot({ path: destination, fullPage: true, scale: 'css' })
    report.screenshots.push(destination)
  }
  const checked = async (name: string) => { report.checks.push(name); await save() }
  try {
    const original = await realpath(input.originalRepository)
    const managed = await realpath(input.managedRepository)
    const isolatedRoot = path.dirname(original)
    assert(path.basename(isolatedRoot).startsWith('devflow-hindsight-fullchain-') &&
      inside(await realpath(os.tmpdir()), isolatedRoot), 'Expected the authorized isolated fullchain baseline')
    assert(original !== managed && inside(isolatedRoot, managed), 'The managed Todo must belong to the same isolated run')
    assert(!inside(original, output) && !inside(managed, output), 'Evidence must not be written inside either source repository')
    report.originalRepository = original
    report.managedRepository = managed
    originalServerPath = await realpath(path.join(original, 'scripts/dev-server.js'))
    assert(inside(original, originalServerPath))
    originalServerDigest = digest(await readFile(originalServerPath))
    const source = JSON.parse(await readFile(new URL('./fixtures/hindsight-todo/source.json', import.meta.url), 'utf8'))
    assert.equal(originalServerDigest, source.files.find((file: { path: string }) => file.path === 'scripts/dev-server.js')?.sha256,
      'The static server must match the fixed untouched Todo baseline')
    report.sourceDigestsBefore = await repositoryDigests(managed)
    const executablePath = input.chromiumExecutablePath ?? chromium.executablePath()
    await access(executablePath) // Never download or install a browser implicitly.
    report.executablePath = executablePath
    const serverModule = await import(pathToFileURL(originalServerPath).href)
    server = serverModule.createServer(managed) as Server
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    report.origin = origin
    report.privateProfile = await mkdtemp(path.join(os.tmpdir(), 'devflow-hindsight-todo-browser-'))
    context = await chromium.launchPersistentContext(report.privateProfile, {
      executablePath, headless: !input.headed, viewport: { width: 1100, height: 850 },
      serviceWorkers: 'block',
    })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === origin) await route.continue()
      else {
        report.blockedExternalRequests.push(`${url.protocol}//${url.host}${url.pathname}`)
        await route.abort('blockedbyclient')
      }
    })
    page = context.pages()[0] ?? await context.newPage()
    page.on('pageerror', (error) => report.pageErrors.push(error.message))
    page.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss() })
    await page.goto(origin, { waitUntil: 'networkidle' })
    const todo = page
    const clear = todo.getByRole('button', { name: '清除已完成', exact: true })
    const inputField = todo.getByLabel('新任务内容', { exact: true })
    const persisted = () => todo.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as Task[], storageKey)
    const seed = async (tasks: Task[]) => {
      await todo.evaluate(({ key, tasks }) => localStorage.setItem(key, JSON.stringify(tasks)), { key: storageKey, tasks })
      await todo.reload({ waitUntil: 'networkidle' })
      await expect(todo.locator('.task-item')).toHaveCount(tasks.length)
    }
    const initial: Task[] = [
      { id: 'todo-kept-a', text: '保留甲', done: false, createdAt: 101 },
      { id: 'todo-done-b', text: '清理乙', done: true, createdAt: 102 },
      { id: 'todo-kept-c', text: '保留丙', done: false, createdAt: 103 },
    ]
    await seed(initial)
    await expect(clear).toBeEnabled()
    await clear.click()
    await expect(todo.getByText('已清除 1 项', { exact: true })).toBeVisible()
    await checked('mixed-completion-cleanup')
    assert.deepEqual(await persisted(), [initial[0], initial[2]])
    await checked('survivor-fields-and-order')
    await expect(clear).toBeDisabled()
    await checked('disabled-button')
    await todo.reload({ waitUntil: 'networkidle' })
    await expect(todo.locator('.task-item')).toHaveCount(2)
    assert.deepEqual(await persisted(), [initial[0], initial[2]])
    await checked('actual-refresh-persistence')
    await inputField.fill('新增中文任务丁')
    await inputField.press('Enter')
    await expect(todo.locator('.task-item')).toHaveCount(3)
    await checked('Chinese-input-and-enter')
    await todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为已完成', exact: true }).click()
    await expect(todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为未完成', exact: true })).toBeChecked()
    await expect(clear).toBeEnabled()
    await todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为未完成', exact: true }).click()
    await expect(todo.getByRole('checkbox', { name: '标记“新增中文任务丁”为已完成', exact: true })).not.toBeChecked()
    await expect(clear).toBeDisabled()
    await checked('toggle-and-untoggle')
    await todo.getByRole('button', { name: '删除“新增中文任务丁”', exact: true }).click()
    await expect(todo.locator('.task-item')).toHaveCount(2)
    await checked('single-delete')
    for (const checkbox of await todo.getByRole('checkbox').all()) await checkbox.check()
    await clear.click()
    await expect(todo.getByText('已清除 2 项', { exact: true })).toBeVisible()
    await expect(todo.locator('#empty-state')).toBeVisible()
    await todo.reload({ waitUntil: 'networkidle' })
    await expect(clear).toBeDisabled()
    await expect(todo.locator('.task-item')).toHaveCount(0)
    await checked('clear-all-and-original-empty-state')
    await screenshot('todo-clear-all.png')

    for (const key of ['Enter', 'Space']) {
      await seed(initial)
      await clear.focus()
      await expect(clear).toBeFocused()
      await todo.keyboard.press(key)
      await expect(todo.getByText('已清除 1 项', { exact: true })).toBeVisible()
      await expect(todo.locator('.task-item')).toHaveCount(2)
      assert.deepEqual(await persisted(), [initial[0], initial[2]])
      await expect(clear).toBeDisabled()
      await checked(`clear-button-keyboard-${key.toLowerCase()}`)
    }

    await seed([])
    const emoji200 = '😀'.repeat(200)
    assert.equal(Array.from(emoji200).length, 200)
    await inputField.fill(emoji200)
    assert.equal(await inputField.inputValue(), emoji200)
    await inputField.press('Enter')
    await expect(todo.locator('.task-item')).toHaveCount(1)
    assert.equal((await persisted())[0]?.text, emoji200)
    await checked('emoji-200-codepoints-accepted')
    const emoji201 = '😀'.repeat(201)
    await inputField.fill(emoji201)
    assert.equal(await inputField.inputValue(), emoji201)
    await inputField.press('Enter')
    await expect(todo.getByText('任务内容不能超过 200 个字符', { exact: true })).toBeVisible()
    await expect(todo.locator('.task-item')).toHaveCount(1)
    assert.equal((await persisted()).length, 1)
    await checked('emoji-201-codepoints-rejected')
    await screenshot('todo-unicode-boundary.png')

    // Install the fault after successful startup, so this exercises a runtime write
    // failure rather than the separate startup fallback storage implementation.
    await seed(initial)
    await expect(todo.locator('#storage-warning')).toHaveText('')
    assert.deepEqual(await persisted(), initial)
    await todo.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('Synthetic Todo quota failure', 'QuotaExceededError')
      }
    })
    await clear.click()
    await expect(todo.locator('.task-item')).toHaveCount(2)
    await expect(todo.locator('.task-text')).toHaveText(['保留甲', '保留丙'])
    await expect(clear).toBeDisabled()
    await expect(todo.locator('#storage-warning')).toHaveText(warning)
    assert.deepEqual(await persisted(), initial)
    await checked('runtime-quota-failure-keeps-memory-ui-usable-and-warns')
    await checked('runtime-quota-failure-does-not-overwrite-persisted-data')
    await screenshot('todo-storage-quota-warning.png')
    // Reload removes the page-local test override. The unpersisted completed task
    // correctly reappears; claiming persistence for the failed write would be false.
    await todo.reload({ waitUntil: 'networkidle' })
    await expect(todo.locator('.task-item')).toHaveCount(initial.length)
    assert.deepEqual(await persisted(), initial)
    await expect(clear).toBeEnabled()
    report.storageFailure = {
      memoryUiRemovedCompleted: true, persistedDataUnchanged: true, refreshRestoresOldData: true,
    }
    await checked('runtime-quota-failure-refresh-restores-old-persisted-data')
    assert.equal(dialogs, 0)
    await checked('no-confirmation-dialog')
    assert.deepEqual(report.pageErrors, [])
    assert.deepEqual(report.blockedExternalRequests, [])
    await screenshot('todo-browser-final.png')
    report.passed = true
  } catch (error) {
    report.failure = error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000)
    await screenshot('todo-browser-failure.png').catch(() => undefined)
  } finally {
    await context?.close().catch(() => undefined)
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server!.close(() => resolve()))
    }
    try {
      if (report.managedRepository && report.sourceDigestsBefore) {
        report.sourceDigestsAfter = await repositoryDigests(report.managedRepository)
        assert.deepEqual(report.sourceDigestsAfter, report.sourceDigestsBefore)
        assert.equal(digest(await readFile(originalServerPath!)), originalServerDigest)
        report.sourceBytesUnchanged = true
      }
    } catch (error) {
      report.passed = false
      report.failure = `${report.failure ? `${report.failure}\n` : ''}Source integrity: ${error instanceof Error ? error.message : String(error)}`
    }
    report.finishedAt = new Date().toISOString()
    await save()
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyHindsightTodoBrowser({
    managedRepository: process.env.DEVFLOW_TODO_MANAGED_REPOSITORY ?? '',
    originalRepository: process.env.DEVFLOW_TODO_ORIGINAL_REPOSITORY ?? '',
    output: process.env.DEVFLOW_TODO_BROWSER_OUTPUT ?? '',
    ...(process.env.DEVFLOW_TODO_CHROMIUM_EXECUTABLE ? { chromiumExecutablePath: process.env.DEVFLOW_TODO_CHROMIUM_EXECUTABLE } : {}),
    headed: process.env.DEVFLOW_TODO_BROWSER_HEADED === '1',
  })
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure,
    output: process.env.DEVFLOW_TODO_BROWSER_OUTPUT, profile: report.privateProfile }))
  if (!report.passed) process.exitCode = 1
}
