import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  buildAgentReviewContext,
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildRemediationPlan,
  canApproveGateNow,
  canOverrideBlockedGate,
  createAcceptanceEvidenceBundleArtifact,
  createAgentReviewArtifacts,
  createPrDraftArtifact,
  createWorkflowRunFromRequest,
  createRemoteAgentReviewSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  redactLocalAbsolutePaths,
  redactTestEvidenceForStorage,
  isActiveCodingAgentRunStatus,
  evaluateGateEnforcement,
  redactSecrets,
  resolveEffectivePolicy,
  runKnowledgeReviewAgent,
  runWorkflowStageAgent,
  type AgentEvent,
  type GateOverrideDecision,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type LocalProject,
  type PolicySnapshot,
  type ProjectGitStatus,
  type ProviderCredentialMetadata,
  type RemoteTeamSnapshot,
  type TestEvidence,
  createDemoTeamSessionHeaders,
  resolveDevFlowRuntimeFlags,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store.js'
import {
  ipcChannels,
  parseCancelCodingAgentRunInput,
  parseDeleteRunInput,
  parseDeleteManagedWorktreeInput,
  parseEnsureCodingEngineInput,
  parseListCodingAgentRunsInput,
  parseMcpServersInput,
  parseOpenManagedWorktreeInput,
  parseAgentProviderCredentialInput,
  parsePairDesktopInput,
  parseProjectGitStatusInput,
  parseCreateAcceptanceBundleInput,
  parseCreatePrDraftInput,
  parseCreateRunInput,
  parseCompleteWorkflowAgentNodeInput,
  parseListAgentReviewsInput,
  parseReplyCodingPermissionInput,
  parseRemoteSnapshotInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRunProjectTestsInput,
  parseApproveGateInput,
  parseEvaluateGateEnforcementInput,
  parseListGateOverridesInput,
  parseLoadEnforcementPolicyInput,
  parseSaveGateOverrideInput,
  parseSaveProjectTestCommandInput,
  parseStartRetryAttemptInput,
  parseSettingsInput,
  parseSubscribeCodingRunInput,
  parseValidateTestCommandInput,
} from './ipc-contract.js'
import { createRemoteSyncClient, type RemoteSyncClient } from './remote-sync.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'
import { createCodingEngineAdapterFromEnv } from './coding-engine.js'
import { createCodingRuntime } from './coding-runtime.js'
import { deleteManagedCodingWorkspace as removeManagedCodingWorkspaceDirectory } from './coding-runner.js'
import { createOpencodeProcessManager } from './opencode-process.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import {
  listElectronAgentProviderConfigs,
  resolveElectronAgentProvider,
} from './agent-provider-runtime.js'
import {
  createProjectBoundRemoteSync,
} from './project-bound-remote-sync.js'
import { createRuntimeBudgetGuard } from './runtime-budget-guard.js'
import {
  loadPolicySnapshotForProject as loadStoredPolicySnapshotForProject,
  resolveLocalGateOverrideSettlement,
  selectRemoteGateOverridesForLocalStore,
} from './enforcement-policy.js'
import {
  createTrustedGateOverrideDraft,
  createWorkflowRuntime,
  resolveTrustedWorkflowActor,
} from './workflow-runtime.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEST_TIMEOUT_MS = 120_000
const INITIAL_THEME = parseInitialTheme(process.env['DEVFLOW_INITIAL_THEME'])
const DEFAULT_CODING_RUN_TIMEOUT_MS = 10 * 60_000
const runtimeFlags = resolveDevFlowRuntimeFlags(process.env)
const defaultKnowledgeDocuments: KnowledgeDocument[] = []
const defaultKnowledgeChunks: KnowledgeChunk[] = []
const execFileAsync = promisify(execFile)

let storePromise: Promise<LocalStore> | undefined
let remoteSyncClient: RemoteSyncClient | undefined
let remoteSyncClientKey: string | undefined
const codingPermissionTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
const codingRunTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
const gitStatusWatchers = new Map<
  number,
  {
    projectId: string
    watcher?: FSWatcher
    debounce?: ReturnType<typeof setTimeout>
  }
>()
const gitStatusWatcherCleanupRegistrations = new Set<number>()
const opencodeProcessManager = createOpencodeProcessManager()

function getStore() {
  const userDataPath = process.env['DEVFLOW_USER_DATA_DIR'] ?? app.getPath('userData')
  storePromise ??= createLocalStore({
    dbPath: path.join(userDataPath, 'devflow.sqlite'),
  })
  return storePromise
}

async function executeWorkflowCommandOrThrow(
  store: LocalStore,
  input: Parameters<ReturnType<typeof createWorkflowRuntime>['execute']>[0],
) {
  const result = await createWorkflowRuntime(store).execute(input)
  if (!result.applied) {
    const message = result.blockers
      .map((blocker) => `${blocker.code}: ${blocker.message}`)
      .join('; ')
    throw new Error(`Workflow command rejected: ${message}`)
  }
  return result
}

async function getRemoteSyncClient() {
  const store = await getStore()
  const encryptedToken = await store.getDesktopPairingEncryptedToken()
  const authToken = encryptedToken ? decryptCredential(encryptedToken) : undefined
  const nextKey = authToken ? `token:${authToken}` : runtimeFlags.demoDataEnabled ? 'demo' : 'unauthenticated'
  if (!remoteSyncClient || remoteSyncClientKey !== nextKey) {
    remoteSyncClient = createRemoteSyncClient(
      authToken
        ? { authToken }
        : runtimeFlags.demoDataEnabled
          ? { sessionHeaders: createDemoTeamSessionHeaders() }
          : {},
    )
    remoteSyncClientKey = nextKey
  }

  return remoteSyncClient
}

async function getProjectBoundRemoteSync() {
  const [remoteSync, store] = await Promise.all([getRemoteSyncClient(), getStore()])
  return createProjectBoundRemoteSync({
    remoteSync,
    credentialSource: store,
  })
}

function syncCanonicalRunInBackground(runId: string): void {
  void getProjectBoundRemoteSync()
    .then((client) => client.uploadCanonicalRunSummary(runId))
    .catch(() => undefined)
}

function syncCanonicalTestEvidenceInBackground(evidenceId: string): void {
  void getProjectBoundRemoteSync()
    .then((client) => client.uploadCanonicalTestEvidenceSummary(evidenceId))
    .catch(() => undefined)
}

function resetRemoteSyncClient() {
  remoteSyncClient = undefined
  remoteSyncClientKey = undefined
}

function broadcastToRenderers(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

async function assertNoActiveCodingAgentForRun(store: LocalStore, runId: string) {
  const codingRuns = await store.listCodingAgentRuns(runId)
  const activeRun = codingRuns.find((run) => isActiveCodingAgentRunStatus(run.status))
  if (activeRun) {
    throw new Error('这个 Run 还有运行中的 Coding Agent，请先取消 Coding Agent 后再删除 Run')
  }
}

async function cleanupManagedWorktreesForRun(store: LocalStore, runId: string) {
  const codingRuns = await store.listCodingAgentRuns(runId)
  const codingRunIds = new Set(codingRuns.map((run) => run.id))
  if (codingRunIds.size === 0) {
    return
  }

  const workspaces = (await store.listManagedCodingWorkspaces()).filter(
    (workspace) => codingRunIds.has(workspace.codingRunId) && workspace.cleanupStatus !== 'deleted',
  )

  for (const workspace of workspaces) {
    const result = await removeManagedCodingWorkspaceDirectory(workspace)
    if (result.cleanupStatus === 'cleanup_failed') {
      throw new Error(
        result.cleanupError
          ? `Managed worktree 清理失败：${result.cleanupError}`
          : 'Managed worktree 清理失败',
      )
    }
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

function scheduleCodingRunTimeout(codingRunId: string, expire: () => Promise<void>) {
  const existing = codingRunTimeouts.get(codingRunId)
  if (existing) {
    clearTimeout(existing)
  }

  const timer = setTimeout(() => {
    codingRunTimeouts.delete(codingRunId)
    void expire().catch(() => undefined)
  }, DEFAULT_CODING_RUN_TIMEOUT_MS)
  codingRunTimeouts.set(codingRunId, timer)
}

async function createCodingRuntimeForRequest() {
  const [remoteSync, store] = await Promise.all([
    getProjectBoundRemoteSync(),
    getStore(),
  ])
  return createCodingRuntime({
    store,
    engine: createCodingEngineAdapterFromEnv(process.env),
    remoteSync,
    budgetGuard: createRuntimeBudgetGuard(remoteSync),
    completeWorkflowBuild: async ({ runId, nodeId, codingRunId, diffId, now }) => {
      const existingEvents = await store.listEvents(runId)
      const event: AgentEvent = {
        id: `event-build-complete-${randomUUID()}`,
        runId,
        nodeId,
        sequence: existingEvents.length + 1,
        kind: 'file_change',
        message: `Coding Agent run ${codingRunId} completed with diff ${diffId}.`,
        timestamp: now,
      }
      await executeWorkflowCommandOrThrow(store, {
        runId,
        command: {
          type: 'complete_build',
          nodeId,
          codingRunId,
          diffId,
        },
        candidates: { events: [event] },
        now,
      })
    },
    runTestCommand: runLocalTestCommand,
    runDependencyBootstrap: ({ codingRun, project, workspace, previousDependencyHash, timestamp }) =>
      runDependencyBootstrap({
        codingRunId: codingRun.id,
        runId: codingRun.runId,
        nodeId: codingRun.nodeId,
        projectId: project.id,
        worktreePath: workspace.worktreePath,
        ...(previousDependencyHash ? { previousDependencyHash } : {}),
        runCommand: runLocalTestCommand,
        timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
        now: timestamp,
      }),
    testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    schedulePermissionTimeout: (request, expire) =>
      scheduleCodingPermissionTimeout(request.id, request.expiresAt, expire),
    scheduleRunTimeout: (codingRun, expire) =>
      scheduleCodingRunTimeout(codingRun.id, expire),
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

async function listAgentProviderConfigs() {
  const store = await getStore()
  const credentials = await store.listProviderCredentials()

  return listElectronAgentProviderConfigs({
    credentials,
    fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
  })
}

async function resolveAgentProvider(store: LocalStore, providerId: string) {
  return resolveElectronAgentProvider({
    providerId,
    fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
    credentialSource: store,
    decryptCredential,
  })
}

async function findProject(projectId: string): Promise<LocalProject> {
  const store = await getStore()
  const project = (await store.listProjects()).find((candidate) => candidate.id === projectId)
  if (!project) {
    throw new Error(`Local project not found: ${projectId}`)
  }

  return project
}

async function runGit(project: LocalProject, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', project.path, ...args], {
    timeout: 5000,
    windowsHide: true,
  })
  return String(stdout).trim()
}

async function readProjectGitStatus(project: LocalProject): Promise<ProjectGitStatus> {
  const refreshedAt = new Date().toISOString()

  try {
    const isWorkTree = await runGit(project, ['rev-parse', '--is-inside-work-tree'])
    if (isWorkTree !== 'true') {
      return {
        projectId: project.id,
        status: 'not_git',
        message: 'not a git repo',
        refreshedAt,
      }
    }
  } catch {
    return {
      projectId: project.id,
      status: 'not_git',
      message: 'not a git repo',
      refreshedAt,
    }
  }

  try {
    const headPathRaw = await runGit(project, ['rev-parse', '--git-path', 'HEAD'])
    const headPath = path.isAbsolute(headPathRaw) ? headPathRaw : path.resolve(project.path, headPathRaw)

    try {
      const branch = await runGit(project, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      return {
        projectId: project.id,
        status: 'branch',
        branch,
        refreshedAt,
        headPath,
      }
    } catch {
      const shortSha = await runGit(project, ['rev-parse', '--short', 'HEAD']).catch(() => 'unknown')
      return {
        projectId: project.id,
        status: 'detached',
        shortSha,
        refreshedAt,
        headPath,
      }
    }
  } catch (error) {
    return {
      projectId: project.id,
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'git status unavailable',
      refreshedAt,
    }
  }
}

function clearProjectGitStatusWatcher(webContentsId: number): void {
  const current = gitStatusWatchers.get(webContentsId)
  if (!current) {
    return
  }

  if (current.debounce) {
    clearTimeout(current.debounce)
  }
  current.watcher?.close()
  gitStatusWatchers.delete(webContentsId)
}

async function watchProjectGitStatus(
  window: Electron.WebContents,
  project: LocalProject,
): Promise<ProjectGitStatus> {
  clearProjectGitStatusWatcher(window.id)
  const status = await readProjectGitStatus(project)
  const watcherState: {
    projectId: string
    watcher?: FSWatcher
    debounce?: ReturnType<typeof setTimeout>
  } = { projectId: project.id }

  if ('headPath' in status && status.headPath) {
    const sendLatestStatus = () => {
      if (watcherState.debounce) {
        clearTimeout(watcherState.debounce)
      }

      watcherState.debounce = setTimeout(async () => {
        const latest = await readProjectGitStatus(project)
        if (!window.isDestroyed()) {
          window.send(ipcChannels.projectGitStatusUpdated, latest)
        }
      }, 100)
    }

    watcherState.watcher = watch(status.headPath, { persistent: false }, sendLatestStatus)
    watcherState.watcher.on('error', () => {
      clearProjectGitStatusWatcher(window.id)
    })
  }

  gitStatusWatchers.set(window.id, watcherState)
  if (!gitStatusWatcherCleanupRegistrations.has(window.id)) {
    gitStatusWatcherCleanupRegistrations.add(window.id)
    window.once('destroyed', () => {
      clearProjectGitStatusWatcher(window.id)
      gitStatusWatcherCleanupRegistrations.delete(window.id)
    })
  }
  return status
}

async function loadPolicySnapshotForProject(projectId: string): Promise<PolicySnapshot> {
  const store = await getStore()
  return loadStoredPolicySnapshotForProject(store, projectId)
}

async function resolvePolicyProjectId(projectId: string): Promise<string> {
  const pairing = await (await getStore()).getDesktopPairingCredential()
  return pairing?.localProjectId === projectId ? pairing.projectId : projectId
}

async function cacheRemotePolicySnapshots(snapshot: RemoteTeamSnapshot): Promise<void> {
  if (!snapshot.enforcementPolicies) {
    return
  }

  const store = await getStore()
  const syncedAt = new Date().toISOString()
  const { organizationPolicy, projectOverrides, effectivePolicies, gateOverrides } = snapshot.enforcementPolicies
  const [localRuns, existingOverrides, pairing] = await Promise.all([
    store.listRuns(),
    store.listGateOverrides(),
    store.getDesktopPairingCredential(),
  ])
  const remoteOverrides = selectRemoteGateOverridesForLocalStore({
    remoteOverrides: gateOverrides,
    existingOverrides,
    localRuns,
    pairing,
  })

  await Promise.all(
    [...snapshot.projects.map((project) => {
      const projectOverride = projectOverrides.find((override) => override.projectId === project.id) ?? null
      const effectivePolicy =
        effectivePolicies.find((policy) => policy.projectId === project.id) ??
        resolveEffectivePolicy(organizationPolicy, projectOverride)

      return store.savePolicySnapshot({
        projectId: project.id,
        organizationPolicy,
        projectOverride,
        effectivePolicy,
        version: effectivePolicy.version,
        updatedAt: effectivePolicy.updatedAt,
        syncedAt,
        source: 'remote_cache',
      })
    }), ...remoteOverrides.map((override) => store.saveGateOverride(override))],
  )
}

async function refreshRemotePolicySnapshotForProject(projectId: string): Promise<void> {
  if (projectId.startsWith('local-')) {
    return
  }

  try {
    const store = await getStore()
    const pairing = await store.getDesktopPairingCredential()
    if (!pairing) {
      return
    }

    const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot({
      organizationId: pairing.organizationId,
    })
    await cacheRemotePolicySnapshots(snapshot)
  } catch {
    // Keep the last authoritative cache if the team API is offline.
  }
}

async function loadDeliveryProjectReference(store: LocalStore, localProjectId: string) {
  const pairing = await store.getDesktopPairingCredential()
  if (!pairing || pairing.localProjectId !== localProjectId) {
    throw new Error('The workflow project is not bound to the paired Team project')
  }
  const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot({
    organizationId: pairing.organizationId,
  })
  const project = snapshot.projects.find((candidate) => candidate.id === pairing.projectId)
  if (!project) {
    throw new Error(`Paired Team project not found: ${pairing.projectId}`)
  }
  return {
    repository: project.repository,
    defaultBranch: project.defaultBranch,
  }
}

async function evaluateLocalGateEnforcement(
  input: { runId: string; nodeId: string; projectId?: string },
  options: { refreshPolicy?: boolean } = {},
) {
  const store = await getStore()
  const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`)
  }
  const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node) {
    throw new Error(`Run node not found: ${input.nodeId}`)
  }

  const policyProjectId = await resolvePolicyProjectId(input.projectId ?? run.projectId)
  if (options.refreshPolicy) {
    await refreshRemotePolicySnapshotForProject(policyProjectId)
  }

  const [artifacts, testEvidence, agentReviews, gateOverrides, policySnapshot] = await Promise.all([
    store.listArtifacts(run.id),
    store.listTestEvidence(run.id),
    store.listAgentReviews(run.id),
    store.listGateOverrides(run.id),
    loadPolicySnapshotForProject(policyProjectId),
  ])
  const knowledgeReferences = buildKnowledgeReferences({
    run,
    artifacts,
    documents: defaultKnowledgeDocuments,
    chunks: defaultKnowledgeChunks,
    testEvidence,
  })
  const governanceChecks = buildKnowledgeGovernanceChecks({
    run,
    node,
    artifacts,
    documents: defaultKnowledgeDocuments,
    chunks: defaultKnowledgeChunks,
    testEvidence,
  })
  const latestAgentReview =
    agentReviews
      .filter((review) => review.nodeId === node.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  const agentPolicyFindings = agentReviews
    .filter((review) => review.nodeId === node.id)
    .flatMap((review) => review.policyFindings)
  const decision = evaluateGateEnforcement({
    run,
    node,
    effectivePolicy: policySnapshot.effectivePolicy,
    governanceChecks,
    agentPolicyFindings,
    latestAgentReview,
    overrides: gateOverrides,
    policySource: policySnapshot.source,
  })

  return {
    run,
    node,
    artifacts,
    testEvidence,
    agentReviews,
    knowledgeReferences,
    governanceChecks,
    agentPolicyFindings,
    decision,
    policySnapshot,
    gateOverrides,
  }
}

function isRemoteGateOverrideRejection(message: string): boolean {
  return /Policy version is stale|Gate blockers changed|Run node not found|Canonical Run Summary|Lead override is not allowed|Project access|required|forbidden|denied/i.test(message)
}

async function settleGateOverrideWithTeamApi(
  override: GateOverrideDecision,
  policySource: PolicySnapshot['source'],
): Promise<GateOverrideDecision> {
  if (policySource !== 'remote_cache') {
    return resolveLocalGateOverrideSettlement(override, {
      status: 'confirmed',
      override: { ...override, provisional: false, status: 'accepted' },
    })
  }

  try {
    const confirmed = await (await getProjectBoundRemoteSync()).saveGateOverride({
      runId: override.runId,
      nodeId: override.nodeId,
      projectId: override.projectId,
      reason: override.reason,
      blockedReasonIds: override.blockedReasonIds,
      policyVersion: override.policyVersion,
    })
    return resolveLocalGateOverrideSettlement(override, { status: 'confirmed', override: confirmed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm Gate override with team API'
    return resolveLocalGateOverrideSettlement(
      override,
      isRemoteGateOverrideRejection(message)
        ? { status: 'rejected', reason: message }
        : { status: 'offline' },
    )
  }
}

async function reconcilePendingGateOverrides(
  store: LocalStore,
  runId?: string,
): Promise<GateOverrideDecision[]> {
  const overrides = await store.listGateOverrides(runId)
  const reconciled: GateOverrideDecision[] = []

  for (const override of overrides) {
    if (override.status !== 'provisional') {
      reconciled.push(override)
      continue
    }

    const snapshot = await loadPolicySnapshotForProject(
      await resolvePolicyProjectId(override.projectId),
    )
    if (snapshot.source !== 'remote_cache') {
      reconciled.push(override)
      continue
    }

    const settled = await settleGateOverrideWithTeamApi(override, snapshot.source)
    await store.saveGateOverride(settled)
    reconciled.push(settled)
  }

  return reconciled
}

function registerIpcHandlers() {
  ipcMain.handle(ipcChannels.loadState, async () => {
    const store = await getStore()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.loadDesktopPairing, async () => {
    const store = await getStore()
    return store.getDesktopPairingCredential()
  })

  ipcMain.handle(ipcChannels.pairDesktop, async (_, payload: unknown) => {
    const input = parsePairDesktopInput(payload)
    await findProject(input.localProjectId)
    const exchangeResult = await createRemoteSyncClient().exchangeDesktopPairingCode({ code: input.code })
    const { token, ...credential } = exchangeResult
    const boundCredential = {
      ...credential,
      localProjectId: input.localProjectId,
    }
    const store = await getStore()
    await store.saveDesktopPairingCredential(boundCredential, encryptCredential(token))
    resetRemoteSyncClient()
    return { credential: boundCredential }
  })

  ipcMain.handle(ipcChannels.loadRemoteSnapshot, async (_, payload: unknown) => {
    const input = parseRemoteSnapshotInput(payload)
    const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot(input)
    await cacheRemotePolicySnapshots(snapshot)
    return snapshot
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

  ipcMain.handle(ipcChannels.getProjectGitStatus, async (_, payload: unknown) => {
    const input = parseProjectGitStatusInput(payload)
    const project = await findProject(input.projectId)
    return readProjectGitStatus(project)
  })

  ipcMain.handle(ipcChannels.watchProjectGitStatus, async (event, payload: unknown) => {
    const input = parseProjectGitStatusInput(payload)
    const project = await findProject(input.projectId)
    return watchProjectGitStatus(event.sender, project)
  })

  ipcMain.handle(ipcChannels.unwatchProjectGitStatus, async (event, payload: unknown) => {
    const input = parseProjectGitStatusInput(payload)
    const current = gitStatusWatchers.get(event.sender.id)
    if (current?.projectId === input.projectId) {
      clearProjectGitStatusWatcher(event.sender.id)
    }
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
    const run = await store.getRun(input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    if (run.projectId !== project.id) {
      throw new Error('The selected local project does not own this workflow run')
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (
      !node ||
      run.currentNodeId !== node.id ||
      node.kind !== 'test' ||
      node.stage !== 'test' ||
      (node.status !== 'running' && node.status !== 'failed')
    ) {
      throw new Error('Only the current workflow Test node can execute the project test command')
    }
    const command = project.testCommand.trim()

    if (!command) {
      throw new Error('Local project has no test command')
    }

    const safety = validateTestCommandSafety(command)
    if (safety.level === 'blocked') {
      throw new Error(`Test command blocked: ${safety.reasons.join(' ')}`)
    }

    const result = await runLocalTestCommand({
      command: safety.normalizedCommand,
      cwd: project.path,
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    })
    const createdAt = new Date().toISOString()
    const evidence: TestEvidence = redactTestEvidenceForStorage({
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
    })
    const artifact = createTestEvidenceArtifact(evidence)
    const event = createTestEvidenceEvent(
      evidence,
      (await store.listEvents(input.runId)).length + 1,
    )
    await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: 'record_test_result',
        nodeId: node.id,
        evidenceId: evidence.id,
        artifactId: artifact.id,
      },
      candidates: {
        artifacts: [artifact],
        events: [event],
        testEvidence: [evidence],
      },
      now: createdAt,
    })
    syncCanonicalTestEvidenceInBackground(evidence.id)

    return {
      evidence,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.loadEnforcementPolicy, async (_, payload: unknown) => {
    const input = parseLoadEnforcementPolicyInput(payload)
    return loadPolicySnapshotForProject(await resolvePolicyProjectId(input.projectId))
  })

  ipcMain.handle(ipcChannels.evaluateGateEnforcement, async (_, payload: unknown) => {
    const input = parseEvaluateGateEnforcementInput(payload)
    return (await evaluateLocalGateEnforcement(input)).decision
  })

  ipcMain.handle(ipcChannels.saveGateOverride, async (_, payload: unknown) => {
    const input = parseSaveGateOverrideInput(payload)
    const store = await getStore()
    const { run, node, decision } = await evaluateLocalGateEnforcement(
      { runId: input.runId, nodeId: input.nodeId },
      { refreshPolicy: true },
    )
    const actor = resolveTrustedWorkflowActor(
      run,
      await store.getDesktopPairingCredential(),
    )
    const redactedReason = redactSecrets(
      redactLocalAbsolutePaths(input.reason).value,
    ).value

    if (!canOverrideBlockedGate({
      userRole: actor.role,
      userId: actor.userId,
      run,
      node,
      enforcement: decision,
      reason: redactedReason,
    })) {
      throw new Error('Lead override is not allowed for this Gate')
    }

    const timestamp = new Date().toISOString()
    const localOverride = createTrustedGateOverrideDraft({
      id: `gate-override-${run.id}-${node.id}-${randomUUID()}`,
      run,
      node,
      actor,
      reason: redactedReason,
      decision,
      createdAt: timestamp,
    })
    const settledOverride = await settleGateOverrideWithTeamApi(localOverride, decision.policySource)
    return store.saveGateOverride(settledOverride)
  })

  ipcMain.handle(ipcChannels.listGateOverrides, async (_, payload: unknown) => {
    const input = parseListGateOverridesInput(payload)
    const store = await getStore()
    return reconcilePendingGateOverrides(store, input.runId)
  })

  ipcMain.handle(ipcChannels.createRun, async (_, payload: unknown) => {
    const input = parseCreateRunInput(payload)
    const created = createWorkflowRunFromRequest({
      ...input,
      runId: `run-${randomUUID()}`,
      now: new Date().toISOString(),
    })
    const store = await getStore()
    const result = await store.createWorkflow({
      run: created.run,
      artifacts: created.artifacts,
      events: created.events,
    })
    if (!result.created) {
      throw new Error(`Run already exists: ${created.run.id}`)
    }
    syncCanonicalRunInBackground(created.run.id)
    return created.run
  })

  ipcMain.handle(ipcChannels.deleteRun, async (_, payload: unknown) => {
    const input = parseDeleteRunInput(payload)
    const store = await getStore()
    const localRun = (await store.listRuns()).find((candidate) => candidate.id === input.runId)

    if (!localRun && !input.deleteRemote) {
      throw new Error(`Run not found: ${input.runId}`)
    }

    await assertNoActiveCodingAgentForRun(store, input.runId)

    const remote = input.deleteRemote
      ? await (await getRemoteSyncClient()).deleteRun({ runId: input.runId })
      : undefined

    if (localRun) {
      await cleanupManagedWorktreesForRun(store, input.runId)
      await store.deleteRun(input.runId)
    }

    return {
      ...(remote ? { remote } : {}),
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.completeWorkflowAgentNode, async (_, payload: unknown) => {
    const input = parseCompleteWorkflowAgentNodeInput(payload)
    const store = await getStore()
    const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }
    if (
      run.currentNodeId !== node.id ||
      node.kind !== 'agent' ||
      (node.stage !== 'clarify' && node.stage !== 'design') ||
      node.status !== 'running'
    ) {
      throw new Error('Only the current running clarification or design Agent node can execute')
    }
    const [artifacts, events] = await Promise.all([
      store.listArtifacts(run.id),
      store.listEvents(run.id),
    ])
    const providerId = input.providerId
    if (!providerId) {
      throw new Error('Agent provider is not configured. Save Provider ID, Base URL, Model, and API Key before running this agent.')
    }
    const provider = await resolveAgentProvider(store, providerId)
    const completedAt = new Date().toISOString()
    const generated = await runWorkflowStageAgent({
      run,
      node,
      artifacts,
      provider,
      requestedBy: input.userId,
      runtime: 'electron',
      now: () => completedAt,
    })
    const event: AgentEvent = {
      id: `event-${generated.artifact.id}`,
      runId: run.id,
      nodeId: node.id,
      sequence: events.length + 1,
      kind: 'thinking',
      message: `${input.userName} generated ${generated.artifact.title}. Source: ${generated.source === 'model' ? 'model generated' : 'fake/template'} · ${generated.providerId} · ${generated.model}.`,
      timestamp: completedAt,
    }
    const completed = await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: 'complete_agent',
        nodeId: node.id,
        artifactId: generated.artifact.id,
      },
      candidates: {
        artifacts: [generated.artifact],
        events: [event],
      },
      now: completedAt,
    })
    syncCanonicalRunInBackground(completed.run.id)

    return {
      run: completed.run,
      artifact: generated.artifact,
      event,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.createPrDraft, async (_, payload: unknown) => {
    const input = parseCreatePrDraftInput(payload)
    const store = await getStore()
    const run = await store.getRun(input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (
      !node ||
      run.currentNodeId !== node.id ||
      node.kind !== 'pr' ||
      node.stage !== 'pr' ||
      node.status !== 'running'
    ) {
      throw new Error('Only the current running PR node can create a PR draft')
    }

    const [
      project,
      artifacts,
      codingDiffs,
      testEvidence,
      agentReviews,
      codingRuns,
      existingEvents,
      enforcement,
    ] = await Promise.all([
      loadDeliveryProjectReference(store, run.projectId),
      store.listArtifacts(run.id),
      store.listCodingDiffArtifacts(run.id),
      store.listTestEvidence(run.id),
      store.listAgentReviews(run.id),
      store.listCodingAgentRuns(run.id),
      store.listEvents(run.id),
      evaluateLocalGateEnforcement({ runId: run.id, nodeId: node.id }),
    ])
    const latestCodingRun = [...codingRuns].sort((left, right) =>
      (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    )[0]
    const timestamp = new Date().toISOString()
    const artifact = createPrDraftArtifact({
      run,
      project,
      artifacts,
      codingDiffs,
      testEvidence,
      agentReviewSummaries: agentReviews.map((review) => review.summary),
      enforcement: enforcement.decision,
      ...(latestCodingRun?.budgetDecision
        ? { budgetDecision: latestCodingRun.budgetDecision }
        : {}),
      now: timestamp,
    })
    const event: AgentEvent = {
      id: `event-${artifact.id}-${randomUUID()}`,
      runId: run.id,
      nodeId: node.id,
      sequence: existingEvents.length + 1,
      kind: 'thinking',
      message: 'PR draft artifact generated from trusted delivery evidence.',
      timestamp,
    }
    const completed = await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: 'complete_pr',
        nodeId: node.id,
        artifactId: artifact.id,
      },
      candidates: {
        artifacts: [artifact],
        events: [event],
      },
      now: timestamp,
    })
    syncCanonicalRunInBackground(completed.run.id)

    return {
      run: completed.run,
      artifact,
      event,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.createAcceptanceBundle, async (_, payload: unknown) => {
    const input = parseCreateAcceptanceBundleInput(payload)
    const store = await getStore()
    const run = await store.getRun(input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (
      !node ||
      run.currentNodeId !== node.id ||
      node.kind !== 'acceptance' ||
      node.stage !== 'accept' ||
      (node.status !== 'running' && node.status !== 'blocked')
    ) {
      throw new Error('Only the current Acceptance node can create an evidence bundle')
    }

    const [
      artifacts,
      codingDiffs,
      testEvidence,
      agentReviews,
      codingRuns,
      existingEvents,
      enforcement,
    ] = await Promise.all([
      store.listArtifacts(run.id),
      store.listCodingDiffArtifacts(run.id),
      store.listTestEvidence(run.id),
      store.listAgentReviews(run.id),
      store.listCodingAgentRuns(run.id),
      store.listEvents(run.id),
      evaluateLocalGateEnforcement({ runId: run.id, nodeId: node.id }),
    ])
    const latestCodingRun = [...codingRuns].sort((left, right) =>
      (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    )[0]
    const timestamp = new Date().toISOString()
    const artifact = createAcceptanceEvidenceBundleArtifact({
      run,
      artifacts,
      codingDiffs,
      testEvidence,
      agentReviewSummaries: agentReviews.map((review) => review.summary),
      enforcement: enforcement.decision,
      ...(latestCodingRun?.budgetDecision
        ? { budgetDecision: latestCodingRun.budgetDecision }
        : {}),
      now: timestamp,
    })
    const event: AgentEvent = {
      id: `event-${artifact.id}-${randomUUID()}`,
      runId: run.id,
      nodeId: node.id,
      sequence: existingEvents.length + 1,
      kind: 'thinking',
      message: 'Acceptance evidence bundle generated from trusted delivery evidence.',
      timestamp,
    }
    const completed = await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: 'attach_acceptance_bundle',
        nodeId: node.id,
        artifactId: artifact.id,
      },
      candidates: {
        artifacts: [artifact],
        events: [event],
      },
      now: timestamp,
    })
    syncCanonicalRunInBackground(completed.run.id)

    return {
      run: completed.run,
      artifact,
      event,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.approveGate, async (_, payload: unknown) => {
    const input = parseApproveGateInput(payload)
    const store = await getStore()
    const { run, node, decision, gateOverrides } = await evaluateLocalGateEnforcement({
      runId: input.runId,
      nodeId: input.nodeId,
    }, { refreshPolicy: true })
    const actor = resolveTrustedWorkflowActor(
      run,
      await store.getDesktopPairingCredential(),
    )
    const acceptedOverride = gateOverrides.find(
      (override) =>
        override.runId === run.id &&
        override.nodeId === node.id &&
        override.userId === actor.userId &&
        override.status === 'accepted' &&
        !override.provisional &&
        override.policyVersion === decision.policyVersion &&
        override.blockedReasonIds.length === decision.blockingReasons.length &&
        override.blockedReasonIds.every((id) =>
          decision.blockingReasons.some((reason) => reason.id === id),
        ),
    )
    const approval = canApproveGateNow({
      userRole: actor.role,
      userId: actor.userId,
      run,
      node,
      enforcement: decision,
      ...(acceptedOverride ? { override: acceptedOverride } : {}),
    })

    if (!approval.allowed) {
      throw new Error(`Gate approval rejected: ${approval.reason}`)
    }

    const timestamp = new Date().toISOString()
    const [existingEvents, codingRuns] = await Promise.all([
      store.listEvents(run.id),
      node.kind === 'acceptance' ? store.listCodingAgentRuns(run.id) : Promise.resolve([]),
    ])
    const event: AgentEvent = {
      id: `event-approval-${randomUUID()}`,
      runId: run.id,
      nodeId: node.id,
      sequence: existingEvents.length + 1,
      kind: 'approval',
      message: `${actor.userName} Gate approved: ${node.title}`,
      timestamp,
    }
    const latestCodingRun = [...codingRuns].sort((left, right) =>
      (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    )[0]
    const completed = await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: node.kind === 'acceptance' ? 'approve_acceptance' : 'approve_gate',
        nodeId: node.id,
      },
      candidates: { events: [event] },
      approval: {
        roleAllowed: true,
        policy: { blocksApproval: false },
        review: node.kind === 'acceptance' ? 'required' : 'not_required',
        budget: node.kind === 'acceptance' ? 'required' : 'not_required',
      },
      ...(latestCodingRun?.budgetDecision
        ? { budgetDecision: latestCodingRun.budgetDecision }
        : {}),
      now: timestamp,
    })
    syncCanonicalRunInBackground(completed.run.id)

    return {
      run: completed.run,
      event,
      state: await store.loadState(),
    }
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

  ipcMain.handle(ipcChannels.startRetryAttempt, async (_, payload: unknown) => {
    const input = parseStartRetryAttemptInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    const {
      run,
      node,
      decision,
      governanceChecks,
      agentPolicyFindings,
      testEvidence,
      knowledgeReferences,
    } = await evaluateLocalGateEnforcement({
      runId: input.runId,
      nodeId: input.nodeId,
    })
    const remediationPlan = buildRemediationPlan({
      run,
      node,
      decision,
      governanceChecks,
      agentPolicyFindings,
      testEvidence,
      knowledgeReferences,
      createdAt: new Date().toISOString(),
    })

    return runtime.startRetryAttempt({
      ...input,
      remediationPlan,
    })
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
    if (
      run.projectId !== input.projectId ||
      run.currentNodeId !== node.id ||
      (node.kind !== 'gate' && node.kind !== 'acceptance') ||
      (node.status !== 'running' && node.status !== 'blocked')
    ) {
      throw new Error('Knowledge Review can only run for the current Gate or Acceptance node')
    }

    const artifacts = await store.listArtifacts(input.runId)
    const testEvidence = await store.listTestEvidence(input.runId)
    const context = buildAgentReviewContext({
      run,
      node,
      artifacts,
      testEvidence,
      knowledgeDocuments: defaultKnowledgeDocuments,
      knowledgeChunks: defaultKnowledgeChunks,
    })
    const providerId = input.providerId
    if (!providerId) {
      throw new Error('Agent provider is not configured. Save Provider ID, Base URL, Model, and API Key before running Knowledge Review.')
    }
    const resolvedProvider = await resolveAgentProvider(store, providerId)

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
    void getProjectBoundRemoteSync()
      .then((client) => client.uploadAgentReviewSummary(createRemoteAgentReviewSummary(result.review)))
      .catch(() => undefined)

    return {
      ...result,
      state: await store.loadState(),
    }
  })
}

function createWindow() {
  if (INITIAL_THEME) {
    nativeTheme.themeSource = INITIAL_THEME
  }
  const initialBackgroundColor =
    INITIAL_THEME === 'dark'
      ? '#101214'
      : INITIAL_THEME === 'light'
        ? '#f7f8fa'
        : nativeTheme.shouldUseDarkColors
          ? '#101214'
          : '#f7f8fa'
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: 'AI DevFlow Studio',
    backgroundColor: initialBackgroundColor,
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

function parseInitialTheme(value: string | undefined): 'system' | 'light' | 'dark' | undefined {
  if (value === 'system' || value === 'light' || value === 'dark') {
    return value
  }
  return undefined
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

app.on('before-quit', () => {
  void opencodeProcessManager.stopAll()
})
