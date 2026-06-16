import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const devServerUrl = 'http://127.0.0.1:5173'
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
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: devServerUrl,
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

let vite

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
  await waitForServer(devServerUrl)

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
  await first.page.locator('.run-row').filter({ hasText: '重构 GitHub webhook 重试策略' }).click()
  await first.page.getByTestId('flow-node-n-design-gate').click({ force: true })
  await first.page.getByRole('button', { name: /通过 Gate/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('架构 Gate 已通过')
  await expect(first.page.getByTestId('node-inspector')).toContainText('approval')

  await first.page.getByRole('button', { name: /执行测试/ }).click()
  await expect(first.page.getByTestId('toast')).toContainText('测试通过，证据已归档', {
    timeout: 20_000,
  })
  await expect(first.page.getByTestId('tests-view')).toContainText('Local test evidence')
  await expect(first.page.getByTestId('tests-view')).toContainText('passed')
  await expect(first.page.getByTestId('tests-view')).toContainText('npm test')

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
  await rm(tempRoot, { recursive: true, force: true })
}
