import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireFromDesktop = createRequire(
  path.join(rootDirectory, 'apps', 'desktop', 'package.json'),
)
const initSqlJs = requireFromDesktop('sql.js')
const artifactDirectory = path.join(rootDirectory, 'out', 'desktop-pilot')
const artifactIndex = JSON.parse(
  await readFile(path.join(artifactDirectory, 'artifact-index.json'), 'utf8'),
)
const appDirectory = path.resolve(artifactDirectory, artifactIndex.appDirectory)
const executablePath = resolveDesktopExecutablePath(appDirectory, artifactIndex.platform)
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-pilot-smoke-'))
const userDataDirectory = path.join(temporaryDirectory, 'user-data')
const runtimeProjectDirectory = path.join(temporaryDirectory, 'runtime-project')
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

async function launchPackagedDesktop() {
  const app = await electron.launch({
    executablePath,
    cwd: appDirectory,
    env: {
      ...process.env,
      DEVFLOW_USER_DATA_DIR: userDataDirectory,
      DEVFLOW_API_BASE_URL: 'http://127.0.0.1:9',
      DEVFLOW_CODING_ENGINE: 'fake',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_ENABLE_LOCAL_MCP_FIXTURE: 'true',
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: hostileDevelopmentServerUrl,
    },
    timeout: 30_000,
  })
  app.process().stderr?.on('data', (chunk) => diagnostics.push(chunk.toString()))
  const page = await app.firstWindow({ timeout: 30_000 })
  await page.waitForURL((url) => url.protocol !== 'about:', { timeout: 30_000 })
  await page.locator('#root').waitFor({ state: 'attached', timeout: 30_000 })
  return { app, page }
}

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
  await mkdir(runtimeProjectDirectory, { recursive: true })
  await writeFile(
    path.join(runtimeProjectDirectory, 'package.json'),
    `${JSON.stringify({ name: 'devflow-agent-runtime-smoke', private: true }, null, 2)}\n`,
  )

  const firstLaunch = await launchPackagedDesktop()
  electronApp = firstLaunch.app
  const page = firstLaunch.page
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
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
  }, runtimeProjectDirectory)
  const runtimeBeforeRestart = await page.evaluate(async () => {
    const project = await window.aiDevFlowDesktop.selectLocalProject()
    if (!project) throw new Error('Packaged Runtime smoke project was not selected')
    const run = await window.aiDevFlowDesktop.createRun({
      title: 'Packaged Agent Runtime smoke',
      request: 'Complete one bounded no-side-effect observation.',
      projectId: project.id,
      creatorId: 'packaged-smoke-user',
      branchName: 'devflow/packaged-agent-runtime-smoke',
    })
    let snapshot = await window.aiDevFlowDesktop.startAgentRuntime({
      runId: run.id,
      nodeId: run.currentNodeId,
    })
    for (let iteration = 0; iteration < 3; iteration += 1) {
      snapshot = await window.aiDevFlowDesktop.advanceAgentRuntime({
        runtimeId: snapshot.runtime.id,
      })
    }
    return snapshot
  })
  if (
    runtimeBeforeRestart.runtime.status !== 'terminal' ||
    runtimeBeforeRestart.runtime.stopReason !== 'success'
  ) {
    throw new Error('Packaged Agent Runtime did not reach the exact success terminal state.')
  }
  if (
    runtimeBeforeRestart.runtime.acceptedActionIds.length !== 1 ||
    runtimeBeforeRestart.events.filter((event) => event.type === 'action_requested').length !== 1 ||
    runtimeBeforeRestart.terminalSummary?.acceptedActionCount !== 1
  ) {
    throw new Error('Packaged Agent Runtime did not accept exactly one deterministic action.')
  }

  await electronApp.close()
  electronApp = undefined
  const secondLaunch = await launchPackagedDesktop()
  electronApp = secondLaunch.app
  const runtimeAfterRestart = await secondLaunch.page.evaluate(async (runtimeId) => {
    const runtimes = await window.aiDevFlowDesktop.listAgentRuntimes()
    return runtimes.find((candidate) => candidate.runtime.id === runtimeId)
  }, runtimeBeforeRestart.runtime.id)
  if (
    !runtimeAfterRestart ||
    runtimeAfterRestart.runtime.status !== 'terminal' ||
    runtimeAfterRestart.runtime.stopReason !== 'success' ||
    runtimeAfterRestart.runtime.acceptedActionIds.length !== 1 ||
    runtimeAfterRestart.terminalSummary?.acceptedActionCount !== 1
  ) {
    throw new Error('Packaged Agent Runtime was not restored exactly after restart.')
  }
  await electronApp.close()
  electronApp = undefined

  const SQL = await initSqlJs({
    locateFile: (file) => requireFromDesktop.resolve(`sql.js/dist/${file}`),
  })
  const database = new SQL.Database(await readFile(storePath))
  const schemaVersion = Number(
    database.exec("select value from schema_meta where key = 'schema_version'")[0]?.values[0]?.[0],
  )
  const localMcpAudit = database.exec(
    `select tool_id, source, installation_id, installation_version,
            sum(case when status = 'started' then 1 else 0 end),
            sum(case when status = 'succeeded' then 1 else 0 end),
            count(*),
            sum(case when result_digest is not null then 1 else 0 end)
       from agent_runtime_tool_audits
      where runtime_id = ?
      group by tool_id, source, installation_id, installation_version`,
    [runtimeBeforeRestart.runtime.id],
  )[0]?.values[0]
  const localMcpInstallations = database.exec(
    `select id, version, enabled
       from local_mcp_installations
      order by id`,
  )[0]?.values ?? []
  database.close()
  if (schemaVersion !== 20) {
    throw new Error(`Packaged Desktop did not initialize schema 20: ${schemaVersion}`)
  }
  const [toolId, source, installationId, installationVersion, started, succeeded, records, results] =
    localMcpAudit ?? []
  const [persistedInstallation] = localMcpInstallations
  if (
    toolId !== 'scenario.evaluate' ||
    source !== 'mcp' ||
    installationId !== 'local-mcp-installation-runtime-fixture' ||
    Number(installationVersion) !== 2 ||
    Number(started) !== 1 ||
    Number(succeeded) !== 1 ||
    Number(records) !== 2 ||
    Number(results) !== 1 ||
    localMcpInstallations.length !== 1 ||
    persistedInstallation?.[0] !== installationId ||
    Number(persistedInstallation?.[1]) !== Number(installationVersion) ||
    Number(persistedInstallation?.[2]) !== 1
  ) {
    throw new Error('Packaged Agent Runtime did not persist one exact bounded Local MCP audit.')
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        executablePath,
        loadedProtocol: new URL(loadedUrl).protocol,
        hostileDevelopmentServerRequests,
        isolatedStore: path.relative(temporaryDirectory, storePath).split(path.sep).join('/'),
        agentRuntime: {
          status: runtimeAfterRestart.runtime.status,
          stopReason: runtimeAfterRestart.runtime.stopReason,
          acceptedActionCount: runtimeAfterRestart.terminalSummary.acceptedActionCount,
          restartDuplicateEffects: 0,
          localMcp: {
            installationId,
            installationVersion: Number(installationVersion),
            toolId,
            source,
            started: Number(started),
            succeeded: Number(succeeded),
            durableRecords: Number(records),
          },
        },
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
