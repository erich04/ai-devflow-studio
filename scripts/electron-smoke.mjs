import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { _electron as electron, chromium, expect } from '@playwright/test'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const devServerUrl = 'http://127.0.0.1:5173'
const apiServerUrl = 'http://127.0.0.1:4310'
const webServerUrl = 'http://127.0.0.1:4311'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-electron-smoke-'))
const repoDir = path.join(tempRoot, 'fixture-repo')
const userDataDir = path.join(tempRoot, 'user-data')

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

  await run('corepack', ['pnpm', '--filter', '@ai-devflow/desktop', 'build'])

  api = spawnQuiet('corepack', ['pnpm', '--filter', '@ai-devflow/api', 'dev'])
  web = spawnQuiet('corepack', ['pnpm', '--filter', '@ai-devflow/web', 'dev'], {
    DEVFLOW_API_BASE_URL: apiServerUrl,
    NEXT_PUBLIC_DEVFLOW_API_URL: apiServerUrl,
  })
  vite = spawnQuiet('corepack', [
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

  await first.page.getByRole('button', { name: /选择本地仓库/ }).click()
  await expect(first.page.locator('.local-project-panel').getByText('electron-smoke-fixture')).toBeVisible()
  await expect(first.page.getByLabel('测试命令')).toHaveValue('npm test')
  await expect(first.page.getByText(/safe/i)).toBeVisible()

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
  await selectWorkflowNode(first.page, 'flow-node-n-design-gate', '架构 Gate')
  const approveGateButton = first.page.getByRole('button', { name: /通过 Gate/ })
  await expect(approveGateButton).toBeEnabled()
  await approveGateButton.click()
  await expect(first.page.getByTestId('toast')).toContainText('架构 Gate 已通过')
  await expect(first.page.getByTestId('node-inspector')).toContainText('approval')

  await first.page.getByRole('button', { name: /执行测试/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试通过，证据已归档', {
    timeout: 20_000,
  })
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('passed')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')

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
  await first.page.getByLabel('测试命令').fill('rm -rf /tmp/devflow')
  await expect(first.page.getByText(/blocked/i)).toBeVisible()
  await first.page.getByRole('button', { name: /保存测试命令/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试命令已阻断')
  await first.app.close()

  const second = await launchApp()
  await expect(second.page.locator('html')).toHaveAttribute('data-theme-preference', 'light')
  await expect(second.page.getByText('重构 GitHub webhook 重试策略')).toBeVisible()
  await expect(second.page.getByTestId('node-inspector')).toContainText('approval')
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
