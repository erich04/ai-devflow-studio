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
  createRemoteCodingAgentSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  knowledgeChunks,
  knowledgeDocuments,
  runKnowledgeReviewAgent,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
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
import {
  completeFakeCodingRun,
  createFakeCodingRunBundle,
  createManagedCodingWorkspace,
  deleteManagedCodingWorkspace,
  findActiveCodingRun,
} from './coding-runner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEST_TIMEOUT_MS = 120_000

let storePromise: Promise<LocalStore> | undefined
let remoteSyncClient: RemoteSyncClient | undefined

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
    await findProject(input.projectId)
    return {
      projectId: input.projectId,
      engine: 'fake' as const,
      status: 'ready' as const,
    }
  })

  ipcMain.handle(ipcChannels.listCodingAgentRuns, async (_, payload: unknown) => {
    const input = parseListCodingAgentRunsInput(payload)
    const store = await getStore()
    return store.listCodingAgentRuns(input.runId)
  })

  ipcMain.handle(ipcChannels.runCodingAgent, async (_, payload: unknown) => {
    const input = parseRunCodingAgentInput(payload)
    const store = await getStore()
    const project = await findProject(input.projectId)
    const active = findActiveCodingRun(await store.listCodingAgentRuns(), input.projectId)
    if (active) {
      throw new Error(`Coding Agent run already active for this project: ${active.id}`)
    }

    const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }
    if (node.stage !== 'build' && node.kind !== 'task') {
      throw new Error('Coding Agent can only run from an implementation/build node')
    }

    const codingRunId = `coding-run-${randomUUID()}`
    const workspace = await createManagedCodingWorkspace({
      project,
      codingRunId,
      runId: run.id,
      nodeId: node.id,
    })
    const bundle = createFakeCodingRunBundle({
      id: codingRunId,
      runId: run.id,
      nodeId: node.id,
      project,
      requestedBy: input.requestedBy,
      userInstruction: input.userInstruction,
      workspace,
      run,
      node,
    })

    await store.saveManagedCodingWorkspace(workspace)
    await store.saveCodingAgentRun(bundle.codingRun)
    for (const event of bundle.events) {
      await store.saveCodingAgentEvent(event)
    }
    await store.saveCodingPermissionRequest(bundle.permissionRequest)

    return {
      codingRun: bundle.codingRun,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.cancelCodingAgentRun, async (_, payload: unknown) => {
    const input = parseCancelCodingAgentRunInput(payload)
    const store = await getStore()
    const codingRun = (await store.listCodingAgentRuns()).find((candidate) => candidate.id === input.codingRunId)
    if (!codingRun) {
      throw new Error(`Coding Agent run not found: ${input.codingRunId}`)
    }
    const timestamp = new Date().toISOString()
    const updated: CodingAgentRun = {
      ...codingRun,
      status: 'interrupted',
      summary: 'Coding Agent run interrupted by user cancel.',
      completedAt: timestamp,
    }
    const event: CodingAgentEvent = {
      id: `coding-event-${randomUUID()}`,
      codingRunId: updated.id,
      runId: updated.runId,
      nodeId: updated.nodeId,
      sequence: (await store.listCodingAgentEvents(updated.id)).length + 1,
      kind: 'status',
      message: 'Coding Agent run interrupted by user cancel.',
      timestamp,
      redacted: true,
    }
    await store.saveCodingAgentRun(updated)
    await store.saveCodingAgentEvent(event)
    return updated
  })

  ipcMain.handle(ipcChannels.replyCodingPermission, async (_, payload: unknown) => {
    const input = parseReplyCodingPermissionInput(payload)
    const store = await getStore()
    const request = (await store.listCodingPermissionRequests(input.codingRunId)).find(
      (candidate) => candidate.id === input.requestId,
    )
    if (!request) {
      throw new Error(`Coding permission request not found: ${input.requestId}`)
    }
    const timestamp = new Date().toISOString()
    const updatedRequest: CodingPermissionRequest = {
      ...request,
      status:
        input.decision === 'approved'
          ? 'approved'
          : input.decision === 'expired'
            ? 'expired'
            : 'rejected',
    }
    const decision: CodingPermissionDecision = {
      id: `coding-permission-decision-${randomUUID()}`,
      requestId: request.id,
      codingRunId: input.codingRunId,
      decidedBy: input.decidedBy,
      decision: input.decision,
      comment: input.comment,
      decidedAt: timestamp,
    }

    await store.saveCodingPermissionRequest(updatedRequest)
    await store.saveCodingPermissionDecision(decision)

    const codingRun = (await store.listCodingAgentRuns()).find((candidate) => candidate.id === input.codingRunId)
    if (!codingRun) {
      throw new Error(`Coding Agent run not found: ${input.codingRunId}`)
    }

    if (input.decision === 'approved') {
      const workspace = (await store.listManagedCodingWorkspaces(codingRun.projectId)).find(
        (candidate) => candidate.id === codingRun.managedWorkspaceId,
      )
      if (!workspace) {
        throw new Error(`Managed worktree not found: ${codingRun.managedWorkspaceId}`)
      }
      const project = await findProject(codingRun.projectId)
      const completed = await completeFakeCodingRun({
        codingRun,
        workspace,
        project,
        now: timestamp,
      })
      await store.saveCodingAgentRun(completed.codingRun)
      await store.saveDependencyBootstrapEvidence(completed.bootstrapEvidence)
      await store.saveCodingDiffArtifact(completed.diff)
      for (const event of completed.events) {
        await store.saveCodingAgentEvent(event)
      }
      void getRemoteSyncClient()
        .uploadCodingAgentSummary(createRemoteCodingAgentSummary(completed.codingRun, completed.diff))
        .catch(() => undefined)
    } else {
      const updatedRun: CodingAgentRun = {
        ...codingRun,
        status: 'interrupted',
        summary: `Coding Agent permission ${input.decision}; run interrupted.`,
        completedAt: timestamp,
      }
      const event: CodingAgentEvent = {
        id: `coding-event-${randomUUID()}`,
        codingRunId: updatedRun.id,
        runId: updatedRun.runId,
        nodeId: updatedRun.nodeId,
        sequence: (await store.listCodingAgentEvents(updatedRun.id)).length + 1,
        kind: 'permission',
        message: `Coding permission ${input.decision}; run interrupted.`,
        timestamp,
        metadata: { requestId: request.id },
        redacted: true,
      }
      await store.saveCodingAgentRun(updatedRun)
      await store.saveCodingAgentEvent(event)
    }

    return updatedRequest
  })

  ipcMain.handle(ipcChannels.subscribeCodingRun, async (_, payload: unknown) => {
    parseSubscribeCodingRunInput(payload)
    const store = await getStore()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.openManagedWorktree, async (_, payload: unknown) => {
    const input = parseOpenManagedWorktreeInput(payload)
    const store = await getStore()
    const workspace = (await store.listManagedCodingWorkspaces()).find((candidate) => candidate.id === input.workspaceId)
    if (!workspace) {
      throw new Error(`Managed worktree not found: ${input.workspaceId}`)
    }
    const error = await shell.openPath(workspace.worktreePath)
    if (error) {
      throw new Error(error)
    }
    return workspace
  })

  ipcMain.handle(ipcChannels.deleteManagedWorktree, async (_, payload: unknown) => {
    const input = parseDeleteManagedWorktreeInput(payload)
    const store = await getStore()
    const workspace = (await store.listManagedCodingWorkspaces()).find((candidate) => candidate.id === input.workspaceId)
    if (!workspace) {
      throw new Error(`Managed worktree not found: ${input.workspaceId}`)
    }
    const deleted = await deleteManagedCodingWorkspace(workspace)
    await store.saveManagedCodingWorkspace(deleted)
    return deleted
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
