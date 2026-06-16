import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyTestEvidenceToRun,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  type LocalProject,
  type TestEvidence,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store.js'
import {
  ipcChannels,
  parseAgentEventInput,
  parseMcpServersInput,
  parseRemoteRunSummaryInput,
  parseRemoteSnapshotInput,
  parseRemoteTestEvidenceSummaryInput,
  parseRunProjectTestsInput,
  parseSaveRunInput,
  parseSaveProjectTestCommandInput,
  parseSettingsInput,
  parseValidateTestCommandInput,
} from './ipc-contract.js'
import { createRemoteSyncClient, type RemoteSyncClient } from './remote-sync.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEST_TIMEOUT_MS = 120_000

let storePromise: Promise<LocalStore> | undefined
let remoteSyncClient: RemoteSyncClient | undefined

function getStore() {
  const userDataPath = process.env['DEVFLOW_USER_DATA_DIR'] ?? app.getPath('userData')
  storePromise ??= createLocalStore({
    dbPath: path.join(userDataPath, 'devflow.sqlite'),
  })
  return storePromise
}

function getRemoteSyncClient() {
  remoteSyncClient ??= createRemoteSyncClient()
  return remoteSyncClient
}

async function findProject(projectId: string): Promise<LocalProject> {
  const store = await getStore()
  const project = (await store.listProjects()).find((candidate) => candidate.id === projectId)
  if (!project) {
    throw new Error(`Local project not found: ${projectId}`)
  }

  return project
}

function registerIpcHandlers() {
  ipcMain.handle(ipcChannels.loadState, async () => {
    const store = await getStore()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.loadRemoteSnapshot, async (_, payload: unknown) => {
    const input = parseRemoteSnapshotInput(payload)
    return getRemoteSyncClient().loadRemoteSnapshot(input)
  })

  ipcMain.handle(ipcChannels.uploadRunSummary, async (_, payload: unknown) => {
    const summary = parseRemoteRunSummaryInput(payload)
    return getRemoteSyncClient().uploadRunSummary(summary)
  })

  ipcMain.handle(ipcChannels.uploadTestEvidenceSummary, async (_, payload: unknown) => {
    const summary = parseRemoteTestEvidenceSummaryInput(payload)
    return getRemoteSyncClient().uploadTestEvidenceSummary(summary)
  })

  ipcMain.handle(ipcChannels.selectProject, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择本地仓库',
      properties: ['openDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    const store = await getStore()
    const inspected = await inspectProjectDirectory(result.filePaths[0])
    const existing = (await store.listProjects()).find((project) => project.id === inspected.id)
    const timestamp = new Date().toISOString()
    const project: LocalProject = existing
      ? {
          ...inspected,
          testCommand: existing.testCommand || inspected.testCommand,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        }
      : inspected

    await store.upsertProject(project)
    return project
  })

  ipcMain.handle(ipcChannels.saveProjectTestCommand, async (_, payload: unknown) => {
    const input = parseSaveProjectTestCommandInput(payload)
    const store = await getStore()
    const project = await findProject(input.projectId)
    const updated: LocalProject = {
      ...project,
      testCommand: input.testCommand,
      updatedAt: new Date().toISOString(),
    }

    await store.upsertProject(updated)
    return updated
  })

  ipcMain.handle(ipcChannels.validateTestCommand, async (_, payload: unknown) => {
    const input = parseValidateTestCommandInput(payload)
    await findProject(input.projectId)
    return validateTestCommandSafety(input.testCommand)
  })

  ipcMain.handle(ipcChannels.runProjectTests, async (_, payload: unknown) => {
    const input = parseRunProjectTestsInput(payload)
    const store = await getStore()
    const project = await findProject(input.projectId)
    const command = project.testCommand.trim()

    if (!command) {
      throw new Error('Local project has no test command')
    }

    const safety = validateTestCommandSafety(command)
    if (safety.level === 'blocked') {
      throw new Error(`Test command blocked: ${safety.reasons.join(' ')}`)
    }

    if (!input.run.nodes.some((node) => node.id === input.nodeId)) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }

    const result = await runLocalTestCommand({
      command: safety.normalizedCommand,
      cwd: project.path,
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    })
    const createdAt = new Date().toISOString()
    const evidence: TestEvidence = {
      id: `evidence-${randomUUID()}`,
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: project.id,
      command: safety.normalizedCommand,
      cwd: project.path,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: result.summary,
      redacted: result.redacted,
      createdAt,
    }
    const artifact = createTestEvidenceArtifact(evidence)
    const event = createTestEvidenceEvent(
      evidence,
      (await store.listEvents(input.runId)).length + 1,
    )
    const updatedRun = applyTestEvidenceToRun(input.run, evidence, artifact.id)

    await store.saveRun(updatedRun)
    await store.saveArtifact(artifact)
    await store.saveEvent(event)
    await store.saveTestEvidence(evidence)

    return {
      evidence,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.createRun, async (_, payload: unknown) => {
    const run = parseSaveRunInput(payload)
    const store = await getStore()
    await store.saveRun(run)
    return run
  })

  ipcMain.handle(ipcChannels.saveRun, async (_, payload: unknown) => {
    const run = parseSaveRunInput(payload)
    const store = await getStore()
    await store.saveRun(run)
    return run
  })

  ipcMain.handle(ipcChannels.saveEvent, async (_, payload: unknown) => {
    const event = parseAgentEventInput(payload)
    const store = await getStore()
    await store.saveEvent(event)
    return event
  })

  ipcMain.handle(ipcChannels.saveSettings, async (_, payload: unknown) => {
    const settings = parseSettingsInput(payload)
    const store = await getStore()
    return store.saveSettings(settings)
  })

  ipcMain.handle(ipcChannels.saveMcpServers, async (_, payload: unknown) => {
    const servers = parseMcpServersInput(payload)
    const store = await getStore()
    return store.saveMcpServers(servers)
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: 'AI DevFlow Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101214' : '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const devServerUrl = process.env['VITE_DEV_SERVER_URL']

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
