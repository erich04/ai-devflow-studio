import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyTestEvidenceToRun,
  buildAgentReviewContext,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createOpenAiCompatibleAgentProvider,
  createRemoteAgentReviewSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  knowledgeChunks,
  knowledgeDocuments,
  runKnowledgeReviewAgent,
  type AgentProviderConfig,
  type LocalProject,
  type ProviderCredentialMetadata,
  type TestEvidence,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store.js'
import {
  ipcChannels,
  parseAgentEventInput,
  parseCancelCodingAgentRunInput,
  parseDeleteManagedWorktreeInput,
  parseEnsureCodingEngineInput,
  parseListCodingAgentRunsInput,
  parseMcpServersInput,
  parseOpenManagedWorktreeInput,
  parseAgentProviderCredentialInput,
  parseListAgentReviewsInput,
  parseReplyCodingPermissionInput,
  parseRemoteCodingAgentSummaryInput,
  parseRemoteRunSummaryInput,
  parseRemoteSnapshotInput,
  parseRemoteTestEvidenceSummaryInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRunProjectTestsInput,
  parseSaveRunInput,
  parseSaveProjectTestCommandInput,
  parseSettingsInput,
  parseSubscribeCodingRunInput,
  parseValidateTestCommandInput,
} from './ipc-contract.js'
import { createRemoteSyncClient, type RemoteSyncClient } from './remote-sync.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'
import { createFakeCodingEngineAdapter } from './coding-engine.js'
import { createCodingRuntime } from './coding-runtime.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEST_TIMEOUT_MS = 120_000

let storePromise: Promise<LocalStore> | undefined
let remoteSyncClient: RemoteSyncClient | undefined
const codingPermissionTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const DEFAULT_OPENAI_PROVIDER_ID = 'openai-default'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'

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

function broadcastToRenderers(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

function scheduleCodingPermissionTimeout(requestId: string, expiresAt: string, expire: () => Promise<void>) {
  const existing = codingPermissionTimeouts.get(requestId)
  if (existing) {
    clearTimeout(existing)
  }

  const delayMs = Math.max(0, Date.parse(expiresAt) - Date.now())
  const timer = setTimeout(() => {
    codingPermissionTimeouts.delete(requestId)
    void expire().catch(() => undefined)
  }, delayMs)
  codingPermissionTimeouts.set(requestId, timer)
}

async function createCodingRuntimeForRequest() {
  return createCodingRuntime({
    store: await getStore(),
    engine: createFakeCodingEngineAdapter(),
    remoteSync: getRemoteSyncClient(),
    runTestCommand: runLocalTestCommand,
    testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    schedulePermissionTimeout: (request, expire) =>
      scheduleCodingPermissionTimeout(request.id, request.expiresAt, expire),
    publisher: {
      publishRunStatus: (run) => broadcastToRenderers(ipcChannels.codingRunStatusUpdated, run),
      publishEvent: (event) => broadcastToRenderers(ipcChannels.codingEventAppended, event),
      publishPermission: (request) => broadcastToRenderers(ipcChannels.codingPermissionUpdated, request),
    },
    idGenerator: (prefix = 'id') => `${prefix}-${randomUUID()}`,
  })
}

function maskCredential(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}...`
  }

  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`
}

function encryptCredential(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System credential encryption is not available')
  }

  return safeStorage.encryptString(secret).toString('base64')
}

function decryptCredential(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System credential encryption is not available')
  }

  return safeStorage.decryptString(Buffer.from(secret, 'base64'))
}

function providerConfigFromCredential(metadata: ProviderCredentialMetadata): AgentProviderConfig {
  return {
    id: metadata.providerId,
    name: metadata.providerId === DEFAULT_OPENAI_PROVIDER_ID ? 'OpenAI Compatible' : metadata.providerId,
    kind: 'openai-compatible',
    model: metadata.model,
    ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
    enabled: true,
    maskedCredential: metadata.maskedCredential,
    updatedAt: metadata.updatedAt,
  }
}

async function listAgentProviderConfigs(): Promise<AgentProviderConfig[]> {
  const store = await getStore()
  const credentials = await store.listProviderCredentials()

  return [
    {
      id: 'fake-knowledge-review',
      name: 'Deterministic Fake Provider',
      kind: 'fake',
      model: 'fake',
      enabled: true,
      updatedAt: new Date(0).toISOString(),
    },
    ...credentials.map(providerConfigFromCredential),
  ]
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

  ipcMain.handle(ipcChannels.uploadCodingAgentSummary, async (_, payload: unknown) => {
    const summary = parseRemoteCodingAgentSummaryInput(payload)
    return getRemoteSyncClient().uploadCodingAgentSummary(summary)
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

  ipcMain.handle(ipcChannels.listAgentProviders, async () => {
    return listAgentProviderConfigs()
  })

  ipcMain.handle(ipcChannels.saveAgentProviderCredential, async (_, payload: unknown) => {
    const input = parseAgentProviderCredentialInput(payload)
    const store = await getStore()
    const metadata: ProviderCredentialMetadata = {
      providerId: input.providerId,
      model: input.model,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      maskedCredential: maskCredential(input.apiKey),
      updatedAt: new Date().toISOString(),
    }

    return store.saveProviderCredential(metadata, encryptCredential(input.apiKey))
  })

  ipcMain.handle(ipcChannels.listAgentReviews, async (_, payload: unknown) => {
    const input = parseListAgentReviewsInput(payload)
    const store = await getStore()
    return store.listAgentReviews(input.runId)
  })

  ipcMain.handle(ipcChannels.ensureCodingEngine, async (_, payload: unknown) => {
    const input = parseEnsureCodingEngineInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.ensureCodingEngine(input)
  })

  ipcMain.handle(ipcChannels.listCodingAgentRuns, async (_, payload: unknown) => {
    const input = parseListCodingAgentRunsInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.listCodingAgentRuns(input)
  })

  ipcMain.handle(ipcChannels.runCodingAgent, async (_, payload: unknown) => {
    const input = parseRunCodingAgentInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.runCodingAgent(input)
  })

  ipcMain.handle(ipcChannels.cancelCodingAgentRun, async (_, payload: unknown) => {
    const input = parseCancelCodingAgentRunInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.cancelCodingAgentRun(input)
  })

  ipcMain.handle(ipcChannels.replyCodingPermission, async (_, payload: unknown) => {
    const input = parseReplyCodingPermissionInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.replyCodingPermission(input)
  })

  ipcMain.handle(ipcChannels.subscribeCodingRun, async (_, payload: unknown) => {
    const input = parseSubscribeCodingRunInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.subscribeCodingRun(input)
  })

  ipcMain.handle(ipcChannels.openManagedWorktree, async (_, payload: unknown) => {
    const input = parseOpenManagedWorktreeInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    const workspace = await runtime.findManagedWorktree(input)
    const error = await shell.openPath(workspace.worktreePath)
    if (error) {
      throw new Error(error)
    }
    return workspace
  })

  ipcMain.handle(ipcChannels.deleteManagedWorktree, async (_, payload: unknown) => {
    const input = parseDeleteManagedWorktreeInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.deleteManagedWorktree(input)
  })

  ipcMain.handle(ipcChannels.runKnowledgeReview, async (_, payload: unknown) => {
    const input = parseRunKnowledgeReviewInput(payload)
    const store = await getStore()
    const runs = await store.listRuns()
    const run = runs.find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }

    const artifacts = await store.listArtifacts(input.runId)
    const testEvidence = await store.listTestEvidence(input.runId)
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence,
      knowledgeDocuments,
      knowledgeChunks,
    })
    const providerId = input.providerId ?? 'fake-knowledge-review'
    const provider =
      providerId === 'fake-knowledge-review'
        ? createFakeAgentProvider()
        : (() => {
            return undefined
          })()
    let resolvedProvider = provider

    if (!resolvedProvider) {
      const credentials = await store.listProviderCredentials()
      const metadata = credentials.find((candidate) => candidate.providerId === providerId)
      const encryptedSecret = await store.getProviderEncryptedSecret(providerId)
      if (!metadata || !encryptedSecret) {
        throw new Error(`Agent provider credential not found: ${providerId}`)
      }
      resolvedProvider = createOpenAiCompatibleAgentProvider({
        id: metadata.providerId,
        name: 'OpenAI Compatible',
        model: metadata.model || DEFAULT_OPENAI_MODEL,
        baseUrl: metadata.baseUrl || DEFAULT_OPENAI_BASE_URL,
        apiKey: decryptCredential(encryptedSecret),
      })
    }

    const result = await runKnowledgeReviewAgent({
      request: {
        id: `review-request-${Date.now()}`,
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        requestedBy: input.requestedBy,
        runtime: 'electron',
        providerId,
      },
      context,
      provider: resolvedProvider,
    })
    const output = createAgentReviewArtifacts(result)
    const event: typeof output.event = {
      ...output.event,
      sequence: (await store.listEvents(input.runId)).length + 1,
    }

    await store.saveArtifact(output.artifact)
    await store.saveEvent(event)
    await store.saveAgentReview(result.review)
    await store.saveAgentTrace(result.trace)
    await store.saveAgentTokenUsage(result.tokenUsage)
    void getRemoteSyncClient()
      .uploadAgentReviewSummary(createRemoteAgentReviewSummary(result.review))
      .catch(() => undefined)

    return {
      ...result,
      state: await store.loadState(),
    }
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
