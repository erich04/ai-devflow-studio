import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactDirectory = path.join(rootDirectory, 'out', 'desktop-pilot')
const artifactIndex = JSON.parse(
  await readFile(path.join(artifactDirectory, 'artifact-index.json'), 'utf8'),
)
const appDirectory = path.resolve(artifactDirectory, artifactIndex.appDirectory)
const executablePath = resolveDesktopExecutablePath(appDirectory, artifactIndex.platform)
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-pilot-smoke-'))
const userDataDirectory = path.join(temporaryDirectory, 'user-data')
const diagnostics = []
let hostileDevelopmentServerRequests = 0
let electronApp

const hostileDevelopmentServer = createServer((_request, response) => {
  hostileDevelopmentServerRequests += 1
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<title>Hostile development server</title><main>wrong renderer</main>')
})

await new Promise((resolve, reject) => {
  hostileDevelopmentServer.once('error', reject)
  hostileDevelopmentServer.listen(0, '127.0.0.1', resolve)
})
const address = hostileDevelopmentServer.address()
if (!address || typeof address === 'string') {
  throw new Error('Unable to allocate the hostile development server smoke port.')
}
const hostileDevelopmentServerUrl = `http://127.0.0.1:${address.port}/must-not-load`

async function waitForIsolatedStore() {
  const storePath = path.join(userDataDirectory, 'devflow.sqlite')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(storePath)
      return storePath
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Packaged Desktop did not create its isolated store: ${storePath}`)
}

try {
  await access(executablePath)
  electronApp = await electron.launch({
    executablePath,
    cwd: appDirectory,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDirectory,
      DEVFLOW_API_BASE_URL: 'http://127.0.0.1:9',
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: hostileDevelopmentServerUrl,
    },
    timeout: 30_000,
  })
  electronApp.process().stderr?.on('data', (chunk) => diagnostics.push(chunk.toString()))

  const page = await electronApp.firstWindow({ timeout: 30_000 })
  await page.waitForURL((url) => url.protocol !== 'about:', { timeout: 30_000 })
  await page.locator('#root').waitFor({ state: 'attached', timeout: 30_000 })
  const loadedUrl = page.url()
  if (!loadedUrl.startsWith('file://')) {
    throw new Error(`Packaged Desktop loaded a non-file renderer: ${loadedUrl}`)
  }
  if (hostileDevelopmentServerRequests !== 0) {
    throw new Error(
      `Packaged Desktop honored VITE_DEV_SERVER_URL (${hostileDevelopmentServerRequests} request(s)).`,
    )
  }
  const storePath = await waitForIsolatedStore()

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        executablePath,
        loadedProtocol: new URL(loadedUrl).protocol,
        hostileDevelopmentServerRequests,
        isolatedStore: path.relative(temporaryDirectory, storePath).split(path.sep).join('/'),
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (diagnostics.length > 0) {
    console.error(diagnostics.join(''))
  }
  throw error
} finally {
  if (electronApp) {
    await electronApp.close()
  }
  await new Promise((resolve) => hostileDevelopmentServer.close(resolve))
  await rm(temporaryDirectory, { recursive: true, force: true })
}
