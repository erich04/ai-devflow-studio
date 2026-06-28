import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  applyTestEvidenceToRun,
  buildAgentReviewContext,
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildRemediationPlan,
  canApproveGateNow,
  canOverrideBlockedGate,
  createAgentReviewArtifacts,
  createFakeAgentProvider,
  createOpenAiCompatibleAgentProvider,
  completeWorkflowAgentNode,
  createWorkflowRunFromRequest,
  createRemoteAgentReviewSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  advanceWorkflowAfterGateApproval,
  knowledgeChunks,
  knowledgeDocuments,
  evaluateGateEnforcement,
  redactSecrets,
  resolveEffectivePolicy,
  runKnowledgeReviewAgent,
  type AgentEvent,
  type AgentProviderConfig,
  type GateOverrideDecision,
  type LocalProject,
  type PolicySnapshot,
  type ProjectGitStatus,
  type BudgetGuardDecision,
  type ProviderCredentialMetadata,
  type RemoteTeamSnapshot,
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
  parsePairDesktopInput,
  parseProjectGitStatusInput,
  parseCreateRunInput,
  parseCompleteWorkflowAgentNodeInput,
  parseListAgentReviewsInput,
  parseReplyCodingPermissionInput,
  parseRemoteCodingAgentSummaryInput,
  parseRemoteRunSummaryInput,
  parseRemoteSnapshotInput,
  parseRemoteTestEvidenceSummaryInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRunProjectTestsInput,
  parseApproveGateInput,
  parseEvaluateGateEnforcementInput,
  parseListGateOverridesInput,
  parseLoadEnforcementPolicyInput,
  parseSaveGateOverrideInput,
  parseSaveArtifactInput,
  parseSaveRunInput,
  parseSaveProjectTestCommandInput,
  parseStartRetryAttemptInput,
  parseSettingsInput,
  parseSubscribeCodingRunInput,
  parseValidateTestCommandInput,
} from './ipc-contract.js'
import { createRemoteSyncClient, type RemoteSyncClient } from './remote-sync.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'
import { createCodingEngineAdapterFromEnv } from './coding-engine.js'
import { createCodingRuntime, type CodingRuntimeBudgetGuard } from './coding-runtime.js'
import { createOpencodeProcessManager } from './opencode-process.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import {
  loadPolicySnapshotForProject as loadStoredPolicySnapshotForProject,
  resolveLocalGateOverrideSettlement,
} from './enforcement-policy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEST_TIMEOUT_MS = 120_000
const INITIAL_THEME = parseInitialTheme(process.env['DEVFLOW_INITIAL_THEME'])
const DEFAULT_CODING_RUN_TIMEOUT_MS = 10 * 60_000
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
const opencodeProcessManager = createOpencodeProcessManager()

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

async function getRemoteSyncClient() {
  const store = await getStore()
  const encryptedToken = await store.getDesktopPairingEncryptedToken()
  const authToken = encryptedToken ? decryptCredential(encryptedToken) : undefined
  const nextKey = authToken ? `token:${authToken}` : 'demo'
  if (!remoteSyncClient || remoteSyncClientKey !== nextKey) {
    remoteSyncClient = createRemoteSyncClient(authToken ? { authToken } : {})
    remoteSyncClientKey = nextKey
  }

  return remoteSyncClient
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
  const remoteSync = await getRemoteSyncClient()
  return createCodingRuntime({
    store: await getStore(),
    engine: createCodingEngineAdapterFromEnv(process.env),
    remoteSync,
    budgetGuard: createRuntimeBudgetGuard(remoteSync),
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

function createRuntimeBudgetGuard(remoteSync: RemoteSyncClient): CodingRuntimeBudgetGuard {
  return async ({ estimatedCost, project, approvalId }) => {
    if (estimatedCost.costUsd <= 0) {
      return {
        status: 'disabled',
        blocksRun: false,
        currentSpendUsd: 0,
        projectedCostUsd: estimatedCost.costUsd,
        reason: 'Runtime budget guard is skipped for cost-free local or fake provider runs.',
      } satisfies BudgetGuardDecision
    }

    try {
      return await remoteSync.evaluateRuntimeBudget({
        projectId: project.id,
        projectedCostUsd: estimatedCost.costUsd,
        ...(approvalId ? { approvalId } : {}),
      })
    } catch {
      return {
        status: 'disabled',
        blocksRun: false,
        currentSpendUsd: 0,
        projectedCostUsd: estimatedCost.costUsd,
        reason: 'Runtime budget guard is unavailable; no team budget decision was applied.',
      } satisfies BudgetGuardDecision
    }
  }
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
  window.once('destroyed', () => clearProjectGitStatusWatcher(window.id))
  return status
}

async function loadPolicySnapshotForProject(projectId: string): Promise<PolicySnapshot> {
  const store = await getStore()
  return loadStoredPolicySnapshotForProject(store, projectId)
}

async function cacheRemotePolicySnapshots(snapshot: RemoteTeamSnapshot): Promise<void> {
  if (!snapshot.enforcementPolicies) {
    return
  }

  const store = await getStore()
  const syncedAt = new Date().toISOString()
  const { organizationPolicy, projectOverrides, effectivePolicies } = snapshot.enforcementPolicies

  await Promise.all(
    snapshot.projects.map((project) => {
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
    }),
  )
}

async function refreshRemotePolicySnapshotForProject(projectId: string): Promise<void> {
  if (projectId.startsWith('local-')) {
    return
  }

  try {
    const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot({ organizationId: 'org-demo' })
    await cacheRemotePolicySnapshots(snapshot)
  } catch {
    // Keep the last authoritative cache if the team API is offline.
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

  if (options.refreshPolicy) {
    await refreshRemotePolicySnapshotForProject(input.projectId ?? run.projectId)
  }

  const [artifacts, testEvidence, agentReviews, gateOverrides, policySnapshot] = await Promise.all([
    store.listArtifacts(run.id),
    store.listTestEvidence(run.id),
    store.listAgentReviews(run.id),
    store.listGateOverrides(run.id),
    loadPolicySnapshotForProject(input.projectId ?? run.projectId),
  ])
  const knowledgeReferences = buildKnowledgeReferences({
    run,
    artifacts,
    documents: knowledgeDocuments,
    chunks: knowledgeChunks,
    testEvidence,
  })
  const governanceChecks = buildKnowledgeGovernanceChecks({
    run,
    node,
    artifacts,
    documents: knowledgeDocuments,
    chunks: knowledgeChunks,
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
  return /Policy version is stale|Lead override is not allowed|Project access|required|forbidden|denied/i.test(message)
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
    const confirmed = await (await getRemoteSyncClient()).saveGateOverride({
      runId: override.runId,
      nodeId: override.nodeId,
      projectId: override.projectId,
      userId: override.userId,
      role: override.role,
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

    const snapshot = await loadPolicySnapshotForProject(override.projectId)
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
    const exchangeResult = await createRemoteSyncClient().exchangeDesktopPairingCode(input)
    const { token, ...credential } = exchangeResult
    const store = await getStore()
    await store.saveDesktopPairingCredential(credential, encryptCredential(token))
    resetRemoteSyncClient()
    return { credential }
  })

  ipcMain.handle(ipcChannels.loadRemoteSnapshot, async (_, payload: unknown) => {
    const input = parseRemoteSnapshotInput(payload)
    const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot(input)
    await cacheRemotePolicySnapshots(snapshot)
    return snapshot
  })

  ipcMain.handle(ipcChannels.uploadRunSummary, async (_, payload: unknown) => {
    const summary = parseRemoteRunSummaryInput(payload)
    return (await getRemoteSyncClient()).uploadRunSummary(summary)
  })

  ipcMain.handle(ipcChannels.uploadTestEvidenceSummary, async (_, payload: unknown) => {
    const summary = parseRemoteTestEvidenceSummaryInput(payload)
    return (await getRemoteSyncClient()).uploadTestEvidenceSummary(summary)
  })

  ipcMain.handle(ipcChannels.uploadCodingAgentSummary, async (_, payload: unknown) => {
    const summary = parseRemoteCodingAgentSummaryInput(payload)
    return (await getRemoteSyncClient()).uploadCodingAgentSummary(summary)
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

  ipcMain.handle(ipcChannels.loadEnforcementPolicy, async (_, payload: unknown) => {
    const input = parseLoadEnforcementPolicyInput(payload)
    return loadPolicySnapshotForProject(input.projectId)
  })

  ipcMain.handle(ipcChannels.evaluateGateEnforcement, async (_, payload: unknown) => {
    const input = parseEvaluateGateEnforcementInput(payload)
    return (await evaluateLocalGateEnforcement(input)).decision
  })

  ipcMain.handle(ipcChannels.saveGateOverride, async (_, payload: unknown) => {
    const input = parseSaveGateOverrideInput(payload)
    const store = await getStore()
    const { run, node, decision } = await evaluateLocalGateEnforcement(input)
    const redactedReason = redactSecrets(input.reason).value

    if (decision.policyVersion !== input.policyVersion) {
      throw new Error('Policy version is stale; re-evaluate before overriding')
    }

    if (!canOverrideBlockedGate({
      userRole: input.role,
      userId: input.userId,
      run,
      node,
      enforcement: decision,
      reason: redactedReason,
    })) {
      throw new Error('Lead override is not allowed for this Gate')
    }

    const timestamp = new Date().toISOString()
    const localOverride: GateOverrideDecision = {
      id: `gate-override-${input.runId}-${input.nodeId}-${randomUUID()}`,
      runId: input.runId,
      nodeId: input.nodeId,
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
      reason: redactedReason,
      blockedReasonIds: input.blockedReasonIds,
      policyVersion: input.policyVersion,
      provisional: input.provisional === true,
      status: input.provisional === true ? 'provisional' : 'accepted',
      createdAt: timestamp,
    }
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
    await store.saveRun(created.run)
    for (const artifact of created.artifacts) {
      await store.saveArtifact(artifact)
    }
    for (const event of created.events) {
      await store.saveEvent(event)
    }
    return created.run
  })

  ipcMain.handle(ipcChannels.completeWorkflowAgentNode, async (_, payload: unknown) => {
    const input = parseCompleteWorkflowAgentNodeInput(payload)
    const store = await getStore()
    const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    const [artifacts, events] = await Promise.all([
      store.listArtifacts(run.id),
      store.listEvents(run.id),
    ])
    const completed = completeWorkflowAgentNode({
      run,
      nodeId: input.nodeId,
      artifacts,
      existingEvents: events,
      actorName: input.userName,
      now: new Date().toISOString(),
    })

    await store.saveRun(completed.run)
    await store.saveArtifact(completed.artifact)
    await store.saveEvent(completed.event)

    return {
      run: completed.run,
      artifact: completed.artifact,
      event: completed.event,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.saveRun, async (_, payload: unknown) => {
    const run = parseSaveRunInput(payload)
    const store = await getStore()
    await store.saveRun(run)
    return run
  })

  ipcMain.handle(ipcChannels.saveArtifact, async (_, payload: unknown) => {
    const artifact = parseSaveArtifactInput(payload)
    const store = await getStore()
    await store.saveArtifact(artifact)
    return artifact
  })

  ipcMain.handle(ipcChannels.approveGate, async (_, payload: unknown) => {
    const input = parseApproveGateInput(payload)
    const store = await getStore()
    const { run, node, decision, gateOverrides } = await evaluateLocalGateEnforcement({
      runId: input.runId,
      nodeId: input.nodeId,
    }, { refreshPolicy: true })
    const acceptedOverride = gateOverrides.find(
      (override) => override.runId === run.id && override.nodeId === node.id,
    )
    const approval = canApproveGateNow({
      userRole: input.role,
      userId: input.userId,
      run,
      node,
      enforcement: decision,
      ...(acceptedOverride ? { override: acceptedOverride } : {}),
    })

    if (!approval.allowed) {
      throw new Error(`Gate approval rejected: ${approval.reason}`)
    }

    const timestamp = new Date().toISOString()
    const existingEvents = await store.listEvents(run.id)
    const { run: updatedRun } = advanceWorkflowAfterGateApproval({
      run,
      approvedNodeId: node.id,
      now: timestamp,
    })
    const event: AgentEvent = {
      id: `event-approval-${randomUUID()}`,
      runId: run.id,
      nodeId: node.id,
      sequence: existingEvents.length + 1,
      kind: 'approval',
      message: `${input.userName} Gate approved: ${node.title}`,
      timestamp,
    }

    await store.saveRun(updatedRun)
    await store.saveEvent(event)

    return {
      run: updatedRun,
      event,
      state: await store.loadState(),
    }
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
