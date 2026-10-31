import { createNativeRepositoryReviewProvider } from './knowledge-review-native.js'
import {legacyChatBudget} from './legacy-chat-budget'
import { createGovernedOpencodeProxy } from './governed-opencode-proxy.js'
import { createCodingRelayCallContext } from './coding-relay-accounting.js'
import { withGovernedStageAgent } from './governed-stage-agent.js'
import { withCleanupFailure } from './opencode-failure.js'
import { governAgentProvider, type ModelCallGovernance } from './governed-provider.js'
import { createDesktopModelCostRecovery } from './model-cost-recovery.js'
import { canonicalFinancialValue, type ModelCallAccountingScope } from '@ai-devflow/shared'
import { resolveDesignClarificationInput, resolveDesignRevisionInput, StageAgentExecutionError } from '@ai-devflow/shared'
import { commitDesignRevision } from './design-revision-completion.js'
import { StageAgentOperations } from './stage-agent-operations.js'
import { requireCurrentClarificationRevision } from './gate-approval-revision.js'
import { designApprovalEvent, isDesignReviewGate, requireCurrentDesignRevision, unexpectedDesignRevisionMessage } from './gate-approval-design.js'
import { WorkbenchConversationService } from './workbench-conversation-service.js'
import { createWorkbenchOpencodeExecutor } from './workbench-opencode-executor.js'
import { parseAgentReviewFeedbackInput } from './agent-review-feedback.js'
import { createCredentialWriteGuard } from './credential-write-guard.js'
import { createDiagnosticLog } from '@ai-devflow/shared/node/diagnostic-log'
import { diagnosticFetch } from './remote-diagnostics.js'
import { createCredentialAccess } from './credential-access.js'
import { createProviderOperationGuard, guardProviderCalls } from './provider-operation-guard.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  assessAgentReviewFreshness,
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildRemediationPlan,
  canApproveGateNow,
  canOverrideBlockedGate,
  createAcceptanceEvidenceBundleArtifact,
  createPrDraftArtifact,
  createWorkflowRunFromRequest,
  approveClarificationRevision,
  markClarificationRevisionsSuperseded,
  requestClarificationChanges,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  redactLocalAbsolutePaths,
  redactTestEvidenceForStorage,
  isActiveCodingAgentRunStatus,
  evaluateGateEnforcement,
  redactSecrets,
  resolveEffectivePolicy,
  runWorkflowStageAgent,
  type AgentEvent,
  type AgentProvider,
  type AgentTrace,
  type GateCommand,
  type StageAgentExecutorKind,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type LocalProject,
  type PolicySnapshot,
  type ProjectGitStatus,
  type ProviderCredentialMetadata,
  type RepositoryKnowledgeSnapshot,
  type RemoteTeamSnapshot,
  type TestEvidence,
  type WorkflowEvidenceSnapshot,
  type WorkflowNode,
  type WorkflowRun,
  createDemoTeamSessionHeaders,
  createAgentRuntimeRendererSnapshot,
  resolveDevFlowCodingExecutorSelection,
  resolveDevFlowRuntimeFlags,
  STAGE_AGENT_MEMORY_RECALL_BUDGET,
  validateTestCommandSafety,
} from '@ai-devflow/shared'
import {
  CURRENT_SCHEMA_VERSION,
  createLocalStore,
  getLocalStoreRevision,
  type LocalStore,
} from './local-store.js'
import {
  buildDesktopDataProfileDiagnostics,
  classifyDesktopDataProfileOpenError,
  persistDesktopDataProfileSelection,
  resolveDesktopDataProfile,
  safeDesktopDataProfileSummary,
} from './desktop-data-profile.js'
import { createDesktopAgentRuntime, type DesktopAgentRuntime } from './agent-runtime-runtime.js'
import { createAgentRuntimeRendererAccess } from './agent-runtime-renderer-access.js'
import { createAgentCoordinationRendererAccess } from './agent-coordination-renderer-access.js'
import { createAgentCoordinationCommands } from './agent-coordination-commands.js'
import { createBoundedAgentCoordinationPlan } from './agent-coordination-plan.js'
import { createSpecialistTaskAuthorityBroker } from './specialist-task-authority.js'
import { resolveSavedOpencodeProviderBinding } from './opencode-provider-binding.js'
import { createSpecialistRuntimeCoordinator } from './specialist-runtime-coordinator.js'
import { createAgentMemoryRendererAccess } from './agent-memory-renderer-access.js'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions.js'
import {
  createFixtureLocalMcpRuntime,
  type FixtureLocalMcpRuntime,
} from './local-mcp-runtime.js'
import {
  ipcChannels,
  parseCancelCodingAgentRunInput,
  parseCancelAgentRuntimeInput,
  parseDeleteRunInput,
  parseDeleteManagedWorktreeInput,
  parseEnsureCodingEngineInput,
  parseGetCodingRuntimeConfigurationInput,
  parseGetCodingRuntimeReadinessInput,
  parseGetCodingChangeSetPreviewInput,
  parseSaveCodingRuntimeConfigurationInput,
  parseSaveCodingRuntimeBudgetPolicyInput,
  parseCreateCodingRuntimeBudgetApprovalInput,
  parseListCodingAgentRunsInput,
  parseListWorkRequestsInput,
  parseMcpServersInput,
  parseMaterializeWorkRequestInput,
  parseOpenManagedWorktreeInput,
  parseAgentProviderCredentialInput,
  parseAgentProviderRemovalInput,
  parseProviderThinkingInput,
  parsePairDesktopInput,
  parseProjectGitStatusInput,
  parseTestEvidenceFreshnessInput,
  parseCreateAcceptanceBundleInput,
  parseCreatePrDraftInput,
  parsePrepareGitHubDeliveryInput,
  parseReviseGitHubDeliveryInput,
  parseRetryGitHubDeliveryInput,
  parseResumeGitHubDeliveryInput,
  parseStopGitHubDeliveryInput,
  parseVerifyGitHubDeliveryRevocationInput,
  parseCreateRunInput,
  parseAdvanceAgentRuntimeInput,
  parseCompleteWorkflowAgentNodeInput,
  parseCancelWorkflowAgentNodeInput,
  parseRequestClarificationChangesInput,
  parseListAgentReviewsInput,
  parseListAgentRuntimesInput,
  parseGetAgentRuntimeInput,
  parseListCoordinationSessionsInput,
  parseGetCoordinationSessionInput,
  parseStartCoordinationPlanInput,
  parseResumeCoordinationSessionInput,
  parseStartCoordinationTaskInput,
  parseCancelCoordinationSessionInput,
  parseListAgentMemoryLifecycleInput,
  parseDeleteAgentMemoryInput,
  parsePromoteAgentMemoryCandidateInput,
  parseDismissAgentMemoryCandidateInput,
  parseReviseAgentMemoryInput,
  parseConfigureProjectMemoryInput,
  parseProjectMemoryProjectInput,
  parseClearProjectMemoryInput,
  parseRefreshProjectKnowledgePageInput,
  parseForgetProjectMemoryInput,
  parseForgetProjectMemorySourceInput,
  parseListProjectMemoriesInput,
  parseUpdateProjectMemoryInput,
  parseReplyCodingPermissionInput,
  parseReplyCodingQuestionInput,
  parseRenewCodingPermissionInput,
  parseRemoteSnapshotInput,
  parseRetryRemoteSyncOperationInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRunProjectTestsInput,
  parseApproveGateInput,
  parseEvaluateGateEnforcementInput,
  parseListGateOverridesInput,
  parseLoadEnforcementPolicyInput,
  parseLoadRepositoryKnowledgeInput,
  parseRefreshRepositoryKnowledgeInput,
  parseSaveGateOverrideInput,
  parseSaveProjectTestCommandInput,
  parseStartRetryAttemptInput,
  parseStartAgentRuntimeInput,
  parseSettingsInput,
  parseSubscribeCodingRunInput,
  parseValidateTestCommandInput,
  type PrepareGitHubDeliveryInput,
  type ReviseGitHubDeliveryInput,
  type RetryGitHubDeliveryInput,
  type ResumeGitHubDeliveryInput,
  type ResumeGitHubDeliveryResult,
  type StopGitHubDeliveryInput,
  type StopGitHubDeliveryResult,
  type VerifyGitHubDeliveryRevocationInput,
  type VerifyGitHubDeliveryRevocationResult,
} from './ipc-contract.js'
import {
  createRemoteSyncClient as createBaseRemoteSyncClient,
  resolveRemoteApiBaseUrl,
  type RemoteSyncClient,
} from './remote-sync.js'
import { createDesktopWorkRequestService } from './work-request-service.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'
import { isGitWorkingTreeRoot } from './git-repository-boundary.js'
import { runWorkflowTestCommand } from './workflow-test-command.js'
import { evaluateTestEvidenceFreshness } from './test-evidence-freshness.js'
import { recordStageAgentFailure } from './stage-agent-failure.js'
import { buildOpencodeRuntimeEnv, createCodingEngineAdapterFromEnv } from './coding-engine.js'
import {
  createCodingExecutorCompatibilityAdapter,
  type CodingExecutor,
} from './coding-executor.js'
import {
  createDeterministicNativeCodingDecisionProvider,
  createNativeCodingExecutor,
} from './native-coding-executor.js'
import {
  createAgentProviderNativeCodingV2DecisionProvider,
  createNativeCodingExecutorV2,
} from './native-coding-executor-v2.js'
import { verifyCodingChangeSetDigest } from './coding-change-set.js'
import { createCodingRuntime } from './coding-runtime.js'
import { codingPromptDigest, recallScopedMemory } from './coding-context.js'
import {
  createGitHubDeliveryRuntime,
  type GitHubDeliveryRuntime,
} from './github-delivery-runtime.js'
import { createGitHubDeliveryRemoteClient } from './github-delivery-remote-client.js'
import { runGitHubDeliveryRevocationProbe } from './github-delivery-revocation-probe.js'
import {
  GitHubDeliveryRetryAuthorityError,
  assertGitHubDeliveryRetryAuthority,
} from './github-delivery-retry-authority.js'
import {
  GitHubRepositoryBindingSyncError,
  synchronizeGitHubRepositoryBinding,
} from './github-repository-binding-sync.js'
import {
  createGitHubDeliveryProcessor,
  reconcileCompletedGitHubDeliveryIntents,
  reconcileRemoteCompletedGitHubDeliveryIntents,
  type GitHubDeliveryActiveIntentOperation,
} from './github-delivery-processor.js'
import { stopGitHubDelivery } from './github-delivery-stop.js'
import { createGitHubDeliveryScheduler } from './github-delivery-scheduler.js'
import {
  GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS,
  createGitHubGitPublisher,
} from './github-git-publisher.js'
import { createGitHubOutboundContentScanner } from './github-outbound-content-scan.js'
import { createManagedWorkspaceCleanupService } from './managed-workspace-cleanup.js'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'
import { createOpencodeProcessManager } from './opencode-process.js'
import { createReadOnlyLocalStageAgentExecutor } from './stage-agent-executor.js'
import { isolatedOpencodeProfileEnv } from './opencode-profile-isolation.js'
import { createOpencodeHttpCodingEngineAdapter } from './opencode-http-engine.js'
import {
  detectCodingRuntimeEngines,
  inspectOpencodeRuntimeProfile,
  isSupportedOpencodeVersion,
} from './opencode-discovery.js'
import { stopOpencodeWithRetry } from './opencode-shutdown.js'
import { resolveTrustedCodingPermissionReply } from './coding-permission-authority.js'
import { resolveTrustedCodingRequest } from './coding-request-authority.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import {
  createElectronAgentProviderCredentialMetadata,
  listElectronAgentProviderConfigs,
  resolveElectronAgentProvider,
  resolveElectronAgentProviderMetadata,
} from './agent-provider-runtime.js'
import {
  createProjectBoundRemoteSync,
} from './project-bound-remote-sync.js'
import { createRemoteSyncOutboxClient } from './remote-sync-outbox-client.js'
import { createRemoteSyncOutboxProcessor } from './remote-sync-outbox-processor.js'
import { createRemoteSyncOutboxScheduler } from './remote-sync-outbox-scheduler.js'
import {
  createGateCommandProcessor,
  type FrozenGateCommandBinding,
  type LocalGateCommandEvaluation,
} from './gate-command-processor.js'
import { createGateCommandScheduler } from './gate-command-scheduler.js'
import { createBudgetContinuationPrompts, describeBudgetContinuation } from './model-budget-continuation.js'
import {
  deferBudgetContinuation,
  createKnowledgeReviewRuntimeBudgetGuard,
  createRuntimeBudgetGuard,
} from './runtime-budget-guard.js'
import {
  evaluateCodingRuntimeReadiness,
  resolveCodingRuntimeSelection,
  type ResolvedCodingRuntimeSelection,
} from './coding-runtime-configuration.js'
import { createKnowledgeReviewRuntime } from './knowledge-review-runtime.js'
import { createReadOnlyLocalKnowledgeReviewProvider } from './knowledge-review-local-agent.js'
import { createRepositoryKnowledgeCache } from './repository-knowledge-cache.js'
import { createRepositoryKnowledgeResolver } from './repository-knowledge-resolver.js'
import { createRepositoryKnowledgeService } from './repository-knowledge.js'
import { HindsightService, type HindsightScope } from './hindsight-service'
import { createHindsightContextService } from './hindsight-context'
import { createCodingModelContext } from './coding-model-context'
import { createHindsightClient, HINDSIGHT_PROTOCOL, normalizeHindsightEndpoint, type HindsightClient } from './hindsight-client'
import { registerProjectMemoryRecall } from './coding-context'
import { resolveProjectMemoryScope } from './project-memory-capture'
import { clearKnowledgePages, knowledgePageModelId, ProjectMemoryService } from './project-memory-service'
import { captureCommitProjectMemory } from './project-memory-commits'
import { createProjectMemoryRecall, type ProjectMemoryRecallService } from './project-memory-recall'
import { hindsightPairingMatches } from './hindsight-store'
import { activeProjectMemoryConfiguration, migrateLegacyProjectMemory, projectMemoryPairingBinding } from './project-memory-capture'
import { createMemoryModelRelay, MEMORY_RELAY_DEFAULT_PORT, type MemoryModelRelay, type MemoryRelayRoute } from './memory-model-relay'
import { parseHindsightSetup, PROJECT_KNOWLEDGE_PAGES, PROJECT_MEMORY_PAGE_SIZE, redactSensitiveText as redactProjectMemoryText, type ProjectKnowledgePages, type ProjectMemoryConfiguration, type ProjectMemoryPage, type ProjectMemoryStatus, type RetrievedKnowledgeManifest } from '@ai-devflow/shared'
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
import { resolveDesktopRendererEntry } from './renderer-entry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataProfileResolution = resolveDesktopDataProfile({
  mode: app.isPackaged ? 'packaged' : 'development',
  defaultUserDataDirectory: app.getPath('userData'),
  productDataRoot: path.join(app.getPath('appData'), 'AI DevFlow Studio'),
  env: process.env,
})
const selectedDataProfile = dataProfileResolution.status === 'selected'
  ? dataProfileResolution.profile
  : null
if (selectedDataProfile) {
  app.setPath('userData', selectedDataProfile.directory)
}
const DEFAULT_TEST_TIMEOUT_MS = 120_000
const GATE_COMMAND_CYCLE_TIMEOUT_MS = 30_000
const GITHUB_DELIVERY_OPERATION_TIMEOUT_MS = 15 * 60_000
const GITHUB_DELIVERY_QUIT_GRACE_MS = 5_000
const INITIAL_THEME = parseInitialTheme(process.env['DEVFLOW_INITIAL_THEME'])
const DEFAULT_CODING_RUN_TIMEOUT_MS = 10 * 60_000
const runtimeFlags = resolveDevFlowRuntimeFlags(process.env)
const execFileAsync = promisify(execFile)

let storePromise: Promise<LocalStore> | undefined
let desktopAgentRuntimePromise: Promise<DesktopAgentRuntime> | undefined
let fixtureLocalMcpRuntime: FixtureLocalMcpRuntime | undefined
let remoteSyncClient: RemoteSyncClient | undefined
let remoteSyncClientKey: string | undefined
let remoteSyncOutboxScheduler: ReturnType<typeof createRemoteSyncOutboxScheduler> | undefined
let remoteSyncOutboxSchedulerPromise:
  | Promise<ReturnType<typeof createRemoteSyncOutboxScheduler>>
  | undefined
let gateCommandScheduler: ReturnType<typeof createGateCommandScheduler> | undefined
let gateCommandSchedulerPromise:
  | Promise<ReturnType<typeof createGateCommandScheduler>>
  | undefined
let gateCommandCycleAbortController: AbortController | undefined
let githubDeliveryScheduler:
  | ReturnType<typeof createGitHubDeliveryScheduler>
  | undefined
let githubDeliverySchedulerPromise:
  | Promise<ReturnType<typeof createGitHubDeliveryScheduler>>
  | undefined
let githubDeliveryOperationQueue: Promise<void> = Promise.resolve()
let githubDeliveryOperationAbortController: AbortController | undefined
let githubDeliveryActiveIntentOperation:
  | GitHubDeliveryActiveIntentOperation
  | null = null
let githubDeliveryStopping = false
let githubDeliveryRuntimePromise: Promise<GitHubDeliveryRuntime> | undefined
let managedWorkspaceCleanupPromise:
  | Promise<ReturnType<typeof createManagedWorkspaceCleanupService>>
  | undefined
const workspaceOperationCoordinator = createWorkspaceOperationCoordinator()
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
const codingEngineAdapter = createCodingEngineAdapterFromEnv(process.env, {
  processManager: opencodeProcessManager,
})
const compatibilityCodingExecutor = createCodingExecutorCompatibilityAdapter(codingEngineAdapter)
const codingExecutorPromises = new Map<string, Promise<CodingExecutor>>()
const providerOperations = createProviderOperationGuard()
const writeCredential = createCredentialWriteGuard()
const diagnosticLog = createDiagnosticLog(path.join(app.getPath('userData'), 'diagnostics.json'))
const persistedCredentialDiagnostics = new Set<string>()
function createRemoteSyncClient(options: Parameters<typeof createBaseRemoteSyncClient>[0] = {}, projectId?: string) {
  return createBaseRemoteSyncClient({ ...options, fetcher: diagnosticFetch(options.fetcher ?? fetch, diagnosticLog.append, projectId) })
}
const credentialAccess = createCredentialAccess({
  storage: safeStorage,
  changed: (records) => {
    broadcastToRenderers(ipcChannels.credentialAccessUpdated, records)
    for (const record of records) {
      if (record.state === 'waiting' || persistedCredentialDiagnostics.has(record.id)) continue
      persistedCredentialDiagnostics.add(record.id)
      if (persistedCredentialDiagnostics.size > 1000) persistedCredentialDiagnostics.delete(persistedCredentialDiagnostics.values().next().value!)
      void diagnosticLog.append({ id: record.id, timestamp: record.startedAt, source: 'desktop',
        operation: record.category === 'provider' ? 'provider_credential' : 'team_credential', phase: record.operation,
        outcome: record.state, reason: record.code ?? 'ok', durationMs: record.durationMs, retryable: false,
      }).catch(() => {})
    }
  },
})
let quitCleanupComplete = false
let quitCleanupPromise: Promise<void> | undefined
const repositoryKnowledgeService = createRepositoryKnowledgeService()
const repositoryKnowledgeCache = createRepositoryKnowledgeCache({
  service: repositoryKnowledgeService,
})
const repositoryKnowledgeResolver = createRepositoryKnowledgeResolver({
  getStore,
  cache: repositoryKnowledgeCache,
})
const desktopWorkRequestService = createDesktopWorkRequestService({
  getStore,
  decryptToken: decryptTeamCredential,
  createClient: createRemoteSyncClient,
})
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function getStore() {
  if (!selectedDataProfile || dataProfileResolution.status !== 'selected') {
    throw new Error('Desktop data profile selection is blocked; LocalStore was not opened')
  }
  storePromise ??= createLocalStore({
    dbPath: selectedDataProfile.databasePath,
  }).then((store) => {
    persistDesktopDataProfileSelection({
      registryPath: dataProfileResolution.registryPath,
      profile: selectedDataProfile,
    })
    console.info('[desktop-data-profile]', safeDesktopDataProfileSummary(selectedDataProfile))
    projectMemoryRecall = createProjectMemoryRecall({ store, transportAvailable: hindsightTransportAvailable,
      client: projectMemoryHindsightClient,
      onDegraded: (reason) => console.warn('[project-memory] Recall unavailable; continuing without project memory.', { reason }) })
    registerProjectMemoryRecall(store, projectMemoryRecall)
    return store
  })
  return storePromise
}

let hindsightService: Promise<HindsightService> | undefined
let hindsightTimer: ReturnType<typeof setInterval> | undefined
let hindsightCycle: Promise<void> | undefined
let hindsightStopping = false
// Explicit deployment opt-in after the pinned protocol pilot; absent in default desktop builds.
const hindsightTransportAvailable = process.env.DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED === HINDSIGHT_PROTOCOL.commit

async function hindsightScope(projectId: string): Promise<HindsightScope> {
  const store = await getStore()
  if (!(await store.listProjects()).some((p) => p.id === projectId)) throw new Error('本地项目不存在。')
  const pairing = await store.getDesktopPairingCredential()
  if (pairing?.localProjectId === projectId) return { projectId, userId: pairing.userId }
  const principal = await store.resolveLocalProjectMemoryPrincipal(projectId)
  if (principal.status !== 'resolved') throw new Error('项目存在多个历史用户，无法自动确定记忆归属。')
  return { projectId, userId: principal.userId }
}
function getHindsightService() {
  hindsightService ??= getStore().then(async (store) => {
    const service = new HindsightService({
      store, transportAvailable: hindsightTransportAvailable,
      loadKnowledge: (projectId) => loadTrustedRepositoryKnowledge(projectId),
      client: async (config) => createHindsightClient({
        endpoint: config.endpoint,
        ...(config.encryptedApiKey ? { apiKey: await credentialAccess.decrypt(config.encryptedApiKey, 'provider', AbortSignal.timeout(2_000)) } : {}),
      }),
    })
    await store.recoverHindsightProjections()
    return service
  })
  return hindsightService
}
async function prepareRetrievedKnowledge(input: Parameters<ReturnType<typeof createHindsightContextService>['prepareRetrievedKnowledge']>[0]) {
  const service = await getHindsightService()
  input.signal?.throwIfAborted()
  const configuration = await (await getStore()).getHindsightConfiguration(input.projectId)
  if (!configuration?.enabled || configuration.ownerUserId !== input.userId) return undefined
  await loadTrustedRepositoryKnowledge(input.projectId, { refresh: true })
  return createHindsightContextService(service).prepareRetrievedKnowledge(input)
}
async function assertRetrievedKnowledgeCurrent(manifest: RetrievedKnowledgeManifest) {
  await loadTrustedRepositoryKnowledge(manifest.scope.projectId, { refresh: true })
  await (await getHindsightService()).assertContextCurrent(manifest)
}
function wakeHindsight() {
  if (hindsightStopping || hindsightCycle || !hindsightTransportAvailable) return
  hindsightCycle = (async () => {
    const results = await Promise.allSettled([
      (async () => {
        const service = await getHindsightService()
        if (!hindsightStopping && (await service.cycle()).refreshDeferred) console.warn('[hindsight] Source refresh deferred; cleanup processing continues.')
      })(),
      (async () => {
        await startMemoryRelay()
        if (!hindsightStopping) await scanCommitHistory()
        if (!hindsightStopping) await (await getProjectMemoryService()).process()
      })(),
    ])
    if (results.some((result) => result.status === 'rejected')) console.warn('[hindsight] A background worker is deferred; durable tasks retained.')
  })().catch(() => {
    console.warn('[hindsight] Synchronization deferred; durable tasks retained.')
  }).finally(() => { hindsightCycle = undefined })
}

// Project memory (ADR 0030): captured documents go to the project's Hindsight bank, and
// Hindsight's extraction calls come back through a loopback relay charged to the project budget.
let projectMemoryService: Promise<ProjectMemoryService> | undefined
let projectMemoryRecall: ProjectMemoryRecallService | undefined
async function projectMemoryHindsightClient(config: ProjectMemoryConfiguration) {
  return createHindsightClient({ endpoint: config.endpoint,
    ...(config.encryptedApiKey ? { apiKey: await credentialAccess.decrypt(config.encryptedApiKey, 'provider', AbortSignal.timeout(2_000)) } : {}),
  })
}
let memoryRelay: MemoryModelRelay | undefined
let memoryRelayFailure: string | undefined
const memoryRelayPort = (() => {
  const raw = process.env.DEVFLOW_MEMORY_RELAY_PORT?.trim()
  const port = raw ? Number(raw) : MEMORY_RELAY_DEFAULT_PORT
  return Number.isSafeInteger(port) && port >= 1024 && port <= 65_535 ? port : MEMORY_RELAY_DEFAULT_PORT
})()
// Docker Desktop reaches 127.0.0.1 through host.docker.internal; Linux Docker needs the bridge address.
const memoryRelayHost = isIP(process.env.DEVFLOW_MEMORY_RELAY_HOST?.trim() ?? '') ? process.env.DEVFLOW_MEMORY_RELAY_HOST!.trim() : '127.0.0.1'
const MEMORY_RELAY_TOKEN = /^[A-Za-z0-9_-]{32,200}$/u
function memoryRelayTokenFile(): string {
  return path.join(app.getPath('userData'), 'memory-relay-token')
}
/** Hindsight's deployment must present this token; it is created once and kept owner-readable only. */
async function memoryRelayToken(): Promise<string> {
  const fromEnv = process.env.DEVFLOW_MEMORY_RELAY_TOKEN?.trim()
  if (fromEnv) {
    if (!MEMORY_RELAY_TOKEN.test(fromEnv)) throw new Error('DEVFLOW_MEMORY_RELAY_TOKEN must be 32-200 URL-safe characters')
    return fromEnv
  }
  const file = memoryRelayTokenFile()
  try {
    const saved = (await readFile(file, 'utf8')).trim()
    if (MEMORY_RELAY_TOKEN.test(saved)) return saved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const token = randomBytes(32).toString('base64url')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return token
}
/**
 * Only the paired project may spend, because its calls are charged to that Team budget, and only
 * once its memory is on with a chosen Provider. The project's repository knowledge bank (ADR 0027)
 * extracts through the same route.
 */
async function resolveMemoryRelayBank(bankId: string): Promise<MemoryRelayRoute | null> {
  const store = await getStore()
  const pairing = await store.getDesktopPairingCredential()
  const memory = (await store.listProjectMemoryConfigurations()).find((item) => item.bankId === bankId)
  const knowledge = memory ? undefined
    : (await store.listHindsightConfigurations()).find((item) => item.enabled && item.knowledgeBank === bankId)
  const projectId = memory?.projectId ?? knowledge?.projectId
  if (!projectId || pairing?.localProjectId !== projectId) return null
  if (knowledge && (!hindsightPairingMatches(knowledge, pairing) ||
      (await store.getHindsightConfiguration(projectId))?.generation !== knowledge.generation)) return null
  const active = await activeProjectMemoryConfiguration(store, projectId)
  if (!active || (memory ? active.bankId !== bankId : active.ownerUserId !== knowledge?.ownerUserId)) return null
  const metadata = (await store.listProviderCredentials()).find((item) => item.providerId === active.providerId)
  if (!metadata) return null
  const binding = await resolveSavedOpencodeProviderBinding({
    providerId: active.providerId, modelId: metadata.model, credentialSource: store, decryptCredential,
  })
  return binding ? { projectId: active.projectId, binding } : null
}
let memoryRelayStarting: Promise<void> | undefined
let memoryRelayAttemptedAt = 0
/** Retried from the background cycle at most once a minute, e.g. after the port is freed. */
function startMemoryRelay(): Promise<void> {
  if (memoryRelay || memoryRelayStarting || hindsightStopping || !hindsightTransportAvailable ||
      Date.now() - memoryRelayAttemptedAt < 60_000) return memoryRelayStarting ?? Promise.resolve()
  memoryRelayAttemptedAt = Date.now()
  memoryRelayStarting = (async () => {
    try {
      memoryRelay = await createMemoryModelRelay({
        port: memoryRelayPort, host: memoryRelayHost, token: await memoryRelayToken(),
        resolveBank: resolveMemoryRelayBank,
        governance: async () => modelCallGovernance(await getStore()),
        onCall: (call) => {
          if (call.status !== 'succeeded') console.warn('[project-memory] Memory model call not completed', { status: call.status, reason: call.reason })
        },
      })
      memoryRelayFailure = undefined
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const failure = code === 'EADDRINUSE' ? `端口 ${memoryRelayPort} 已被占用` : '中继无法启动'
      if (failure !== memoryRelayFailure) console.warn('[project-memory] Memory model relay unavailable', { code: code ?? 'unknown' })
      memoryRelayFailure = failure
    }
  })().finally(() => { memoryRelayStarting = undefined })
  return memoryRelayStarting
}
function getProjectMemoryService() {
  projectMemoryService ??= getStore().then(async (store) => {
    const service = new ProjectMemoryService({
      store,
      client: projectMemoryHindsightClient,
      // Without the relay, extraction would fail and spend a retain attempt; hold new retains.
      canSubmit: () => Boolean(memoryRelay),
    })
    await service.recover()
    // Projects whose memory was turned on before the copy of earlier local Memory existed.
    for (const configuration of await store.listProjectMemoryConfigurations()) {
      if (configuration.enabled) await migrateLegacyMemory(configuration.projectId)
    }
    return service
  })
  return projectMemoryService
}
// Commit history (ADR 0030, phase 5): read each project whose memory is on at most every 10 minutes.
const commitScans = new Map<string, number>()
const COMMIT_SCAN_INTERVAL_MS = 10 * 60_000
async function scanCommitHistory(): Promise<void> {
  const store = await getStore()
  const projects = new Map((await store.listProjects()).map((project) => [project.id, project]))
  for (const configuration of await store.listProjectMemoryConfigurations()) {
    const project = projects.get(configuration.projectId)
    if (!configuration.enabled || !project || Date.now() - (commitScans.get(project.id) ?? 0) < COMMIT_SCAN_INTERVAL_MS) continue
    commitScans.set(project.id, Date.now())
    await captureCommitProjectMemory(store, project).catch(() => {
      console.warn('[project-memory] Commit history was not read; it is read again later.')
    })
  }
}
/** Best-effort copy of earlier local Memory (ADR 0030); retried at the next start if it fails. */
async function migrateLegacyMemory(projectId: string): Promise<void> {
  try { await migrateLegacyProjectMemory(await getStore(), projectId) }
  catch { console.warn('[project-memory] Earlier local Memory was not copied yet; it will be retried.') }
}
/** The project's memory, only for the user who owns it (viewing included). */
async function ownedProjectMemory(projectId: string) {
  const store = await getStore()
  if (!(await store.listProjects()).some((project) => project.id === projectId)) throw new Error('本地项目不存在。')
  const configuration = await store.getProjectMemoryConfiguration(projectId)
  if (!configuration) throw new Error('本项目尚未配置项目记忆。')
  const scope = await resolveProjectMemoryScope(store, projectId, 'project-memory')
  if (!scope || scope.userId !== configuration.ownerUserId) throw new Error('项目记忆属于另一位用户，不能查看或修改。')
  if (!hindsightTransportAvailable) throw new Error('当前构建未启用 Hindsight 传输。')
  return { store, configuration, client: await projectMemoryHindsightClient(configuration) }
}
/** The project's knowledge pages as Hindsight last wrote them; reading makes no model call. */
async function projectKnowledgePages(projectId: string): Promise<ProjectKnowledgePages> {
  const { configuration, client } = await ownedProjectMemory(projectId)
  const models = new Map((await client.listMentalModels(configuration.bankId)).map((model) => [model.id, model]))
  return { projectId, pages: PROJECT_KNOWLEDGE_PAGES.map((page) => {
    const model = models.get(knowledgePageModelId(page.id))
    return { id: page.id, title: page.title, content: redactProjectMemoryText(model?.content ?? '').value, stale: model?.stale ?? false,
      ...(model?.refreshedAt ? { refreshedAt: model.refreshedAt } : {}), ...(model?.failedAt ? { failedAt: model.failedAt } : {}) }
  }), ...(memoryRelay ? {} : { unavailableReason: '记忆模型中继未运行，知识页暂时不会更新。' }) }
}
/** Editing or forgetting memory empties the knowledge pages, so they never show what was removed. */
async function emptyKnowledgePages(client: HindsightClient, bankId: string): Promise<void> {
  try { await clearKnowledgePages(client, bankId) }
  catch { console.warn('[project-memory] Knowledge pages were not emptied; they may show removed memory until refreshed.') }
}
async function listProjectMemories(input: ReturnType<typeof parseListProjectMemoriesInput>): Promise<ProjectMemoryPage> {
  const { store, configuration, client } = await ownedProjectMemory(input.projectId)
  const offset = input.offset ?? 0
  const page = await client.listMemories(configuration.bankId, { type: input.kind, ...(input.query ? { query: input.query } : {}),
    offset, limit: PROJECT_MEMORY_PAGE_SIZE })
  const sources = new Map((await store.listProjectMemoryDocuments(input.projectId))
    .filter((document) => document.bankId === configuration.bankId).map((document) => [document.documentId, document]))
  return { total: page.total, offset, limit: PROJECT_MEMORY_PAGE_SIZE, items: page.items.map((memory) => {
    const source = memory.documentId ? sources.get(memory.documentId) : undefined
    return { id: memory.id, kind: memory.type, text: redactProjectMemoryText(memory.text).value,
      ...(memory.occurredAt ? { date: memory.occurredAt.slice(0, 10) } : {}), ...(memory.editedAt ? { editedAt: memory.editedAt } : {}),
      ...(source ? { source: { documentId: source.id, sourceKind: source.sourceKind, title: source.title } } : {}) }
  }) }
}
/**
 * ADR 0030 decision 3: once memory is set up for one project, a newly paired project that has no
 * memory configuration of its own starts with memory on, with the same Hindsight and Provider.
 * A project that already has a configuration, on or off, is never changed.
 */
async function autoEnableProjectMemory(projectId: string): Promise<void> {
  if (!hindsightTransportAvailable) return
  const store = await getStore()
  if (await store.getProjectMemoryConfiguration(projectId)) return
  const template = (await store.listProjectMemoryConfigurations())
    .filter((item) => item.enabled && item.projectId !== projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const pairing = await store.getDesktopPairingCredential()
  if (!template || pairing?.localProjectId !== projectId) return
  if (!(await store.listProviderCredentials()).some((item) => item.providerId === template.providerId)) return
  const scope = await resolveProjectMemoryScope(store, projectId, 'project-memory')
  if (!scope) return
  await store.configureProjectMemory({ projectId, ownerUserId: scope.userId, pairingBinding: projectMemoryPairingBinding(pairing),
    enabled: true, endpoint: template.endpoint, encryptedApiKey: template.encryptedApiKey, providerId: template.providerId })
  await migrateLegacyMemory(projectId)
  wakeHindsight()
}
async function projectMemoryStatus(projectId: string): Promise<ProjectMemoryStatus> {
  const store = await getStore()
  if (!(await store.listProjects()).some((project) => project.id === projectId)) throw new Error('本地项目不存在。')
  const configuration = await store.getProjectMemoryConfiguration(projectId)
  const active = await activeProjectMemoryConfiguration(store, projectId)
  const pairedProject = (await store.getDesktopPairingCredential())?.localProjectId === projectId
  const documents = configuration
    ? (await store.listProjectMemoryDocuments(projectId)).filter((document) => document.bankId === configuration.bankId)
    : []
  const counts: ProjectMemoryStatus['counts'] = {}
  for (const document of documents) counts[document.status] = (counts[document.status] ?? 0) + 1
  const unavailableReason = !hindsightTransportAvailable ? '当前构建未启用 Hindsight 传输。'
    : !memoryRelay ? `记忆模型中继未运行${memoryRelayFailure ? `：${memoryRelayFailure}` : ''}。`
      : configuration?.enabled && !active ? '项目配对或记忆归属已变化，请重新开启项目记忆。'
        : undefined
  return {
    projectId, configured: Boolean(configuration), enabled: Boolean(active),
    transportAvailable: hindsightTransportAvailable, pairedProject,
    endpoint: configuration?.endpoint ?? '', providerId: configuration?.providerId ?? null, bankId: configuration?.bankId ?? null,
    relay: { port: memoryRelayPort, running: Boolean(memoryRelay),
      tokenFile: process.env.DEVFLOW_MEMORY_RELAY_TOKEN?.trim() ? null : memoryRelayTokenFile(),
      hindsightBaseUrl: `http://host.docker.internal:${memoryRelayPort}/v1` },
    counts,
    recent: [...documents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20)
      .map((document) => ({ id: document.id, sourceKind: document.sourceKind, title: document.title, status: document.status,
        updatedAt: document.updatedAt, ...(document.lastError ? { lastError: document.lastError } : {}) })),
    ...(unavailableReason ? { unavailableReason } : {}),
  }
}

const codingBudgetProxies = new Set<Awaited<ReturnType<typeof createGovernedOpencodeProxy>>>()

/** Tool binaries (ripgrep) shared by the short-lived read-only OpenCode profiles (#209). */
function opencodeToolCacheDirectory(): string {
  return path.join(app.getPath('userData'), 'opencode-profiles', 'tool-bin')
}

async function resolveCodingExecutorForProject(projectId: string): Promise<{
  selection: ResolvedCodingRuntimeSelection
  executor: CodingExecutor | null
}> {
  const store = await getStore()
  const selection = await resolveCodingRuntimeSelection({ store, projectId, env: process.env })
  if (selection.executor === 'unconfigured') return { selection, executor: null }
  if (selection.executor === 'compatibility') {
    return { selection, executor: compatibilityCodingExecutor }
  }
  const providerBinding = selection.executor === 'opencode-http' && selection.configuration.executor === 'opencode-http'
    ? await resolveSavedOpencodeProviderBinding({
        providerId: selection.configuration.providerId,
        modelId: selection.configuration.modelId,
        credentialSource: store,
        decryptCredential,
      })
    : undefined
  const key = `${projectId}:${selection.configVersion}:${selection.executor}:${selection.providerId ?? ''}:${providerBinding?.fingerprint ?? ''}`
  let executorPromise = codingExecutorPromises.get(key)
  if (!executorPromise) {
    executorPromise = (async () => {
      if (selection.executor === 'opencode-http') {
        const configuration = selection.configuration
        if (configuration.executor !== 'opencode-http') {
          throw new Error('Project Coding Runtime configuration does not match the selected executor')
        }
        if (!providerBinding) throw new Error('请先保存项目所选 OpenCode Provider；受预算治理的调用不能使用未绑定的外部凭据。')
        const modelContext = createCodingModelContext()
        const codingSessionOwners = new Map<string, { workspaceId: string; sessionId: string }>()
        const budgetProxy=await createGovernedOpencodeProxy({binding:providerBinding,projectId,governance:await modelCallGovernance(store),
          assertContextCurrent: modelContext.assertCurrent,
          resolveCodingCall: (session) => {
            const owner = codingSessionOwners.get(session.codingRunId)
            if (!owner || owner.workspaceId !== session.workspaceId || owner.sessionId !== session.rootSessionId) {
              throw new Error('Coding relay session does not belong to this execution')
            }
            return createCodingRelayCallContext({
            store, projectId, providerId: providerBinding.providerId, model: providerBinding.modelId, configVersion: selection.configVersion,
            session,
            publishEvent: (event) => broadcastToRenderers(ipcChannels.codingEventAppended, event),
            publishRun: (run) => { broadcastToRenderers(ipcChannels.codingRunStatusUpdated, run); wakeRemoteSyncOutbox() },
            })
          },
        })
        codingBudgetProxies.add(budgetProxy)
        const adapter = createCodingExecutorCompatibilityAdapter(
          createOpencodeHttpCodingEngineAdapter({
            binaryPath: configuration.binaryPath,
            providerID: configuration.providerId,
            modelID: configuration.modelId,
            processManager: opencodeProcessManager,
            configurationFingerprint: `coding-runtime-configuration:${configuration.version}`,
            requireExecutionAuthorization: true,
            enableQuestions: true,
            enableTasks: true,
            onSessionCreated: ({ codingRunId, workspaceId, sessionId }) => {
              const previous = codingSessionOwners.get(codingRunId)
              if (previous && (previous.workspaceId !== workspaceId || previous.sessionId !== sessionId)) {
                throw new Error('Coding relay session ownership cannot be replaced')
              }
              codingSessionOwners.set(codingRunId, { workspaceId, sessionId })
            },
            runtimeEnv: {
              ...buildOpencodeRuntimeEnv({
                baseEnv: process.env,
                apiKeyEnvName: 'OPENCODE_API_KEY',
                providerBinding:budgetProxy.binding,
              }),
              // A bound Provider needs no personal profile; keep the user's global
              // instructions, plugins and skills out of coding runs (ADR 0025).
              ...isolatedOpencodeProfileEnv(path.join(
                app.getPath('userData'), 'opencode-profiles',
                `coding-${createHash('sha256').update(projectId).digest('hex').slice(0, 16)}`,
              )),
            },
          }),
        )
        return {
          ...adapter,
          start: (input) => modelContext.run(input.runtimeContext.assertContextCurrent, () => adapter.start(input)),
          continuePermission: (input) => modelContext.run(input.runtimeContext.assertContextCurrent, () => adapter.continuePermission(input)),
          ...(adapter.replyQuestion ? { replyQuestion: (input: Parameters<NonNullable<CodingExecutor['replyQuestion']>>[0]) =>
            modelContext.run(input.runtimeContext.assertContextCurrent, () => adapter.replyQuestion!(input)) } : {}),
          ...(adapter.refreshPermission ? { refreshPermission: (input: Parameters<NonNullable<CodingExecutor['refreshPermission']>>[0]) =>
            modelContext.run(input.runtimeContext.assertContextCurrent, () => adapter.refreshPermission!(input)) } : {}),
        } satisfies CodingExecutor
      }
      if (selection.executor === 'native-deterministic') {
        return createNativeCodingExecutor({
          store,
          decisionProvider: createDeterministicNativeCodingDecisionProvider(),
          runSavedTest: runLocalTestCommand,
        })
      }
      return createNativeCodingExecutorV2({
        store,
        decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(
          await resolveAgentProvider(store, selection.providerId!, projectId),
        ),
        configVersion: Math.max(1, selection.configVersion),
        runSavedTest: runLocalTestCommand,
        testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      })
    })()
    codingExecutorPromises.set(key, executorPromise)
  }
  try {
    return { selection, executor: await executorPromise }
  } catch (error) {
    codingExecutorPromises.delete(key)
    throw error
  }
}

async function getCodingExecutor(projectId?: string): Promise<{ executor: CodingExecutor; configVersion?: number }> {
  if (!projectId) return { executor: compatibilityCodingExecutor }
  const resolved = await resolveCodingExecutorForProject(projectId)
  if (!resolved.executor) {
    throw new Error('Project Coding Executor is not configured; no fallback executor was started')
  }
  return { executor: resolved.executor,
    ...(resolved.selection.executor === 'opencode-http' ? { configVersion: resolved.selection.configVersion } : {}) }
}

function getGitHubDeliveryRuntime() {
  githubDeliveryRuntimePromise ??= getStore().then((store) =>
    createGitHubDeliveryRuntime({
      store,
      runTestCommand: runLocalTestCommand,
      testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      idGenerator: (prefix) => `${prefix}-${randomUUID()}`,
      workspaceCoordinator: workspaceOperationCoordinator,
    }),
  )
  return githubDeliveryRuntimePromise
}

function getManagedWorkspaceCleanup() {
  managedWorkspaceCleanupPromise ??= getStore().then((store) =>
    createManagedWorkspaceCleanupService({
      store,
      coordinator: workspaceOperationCoordinator,
    }),
  )
  return managedWorkspaceCleanupPromise
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
  const authToken = encryptedToken ? await decryptTeamCredential(encryptedToken) : undefined
  if (await store.getDesktopPairingEncryptedToken() !== encryptedToken) {
    throw new Error('团队绑定已更新，请重新执行操作。')
  }
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

async function getRemoteSyncOutboxScheduler() {
  if (remoteSyncOutboxScheduler) return remoteSyncOutboxScheduler

  remoteSyncOutboxSchedulerPromise ??= (async () => {
    const store = await getStore()
    const processor = createRemoteSyncOutboxProcessor({
      store,
      getRemoteSync: ({ scope, signal }) =>
        createRemoteSyncOutboxClient({
          source: store,
          expectedScope: scope,
          signal,
          decryptToken: decryptTeamCredential,
        }),
      onStateChanged: async () => {
        broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
      },
    })
    remoteSyncOutboxScheduler = createRemoteSyncOutboxScheduler({
      processor,
      pollingIntervalMs: backgroundPollInterval,
      onError: async () => {
        console.warn('[remote-sync-outbox] A delivery cycle failed; the lease will be retried.')
        try {
          broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
        } catch {
          // The next scheduler cycle or renderer load will retry the state read.
        }
      },
    })
    return remoteSyncOutboxScheduler
  })()

  try {
    return await remoteSyncOutboxSchedulerPromise
  } finally {
    remoteSyncOutboxSchedulerPromise = undefined
  }
}

function wakeRemoteSyncOutbox(): void {
  void getRemoteSyncOutboxScheduler()
    .then((scheduler) => scheduler.wake())
    .catch(() => {
      console.warn('[remote-sync-outbox] Unable to wake the delivery scheduler.')
    })
}

async function runGitHubDeliveryExclusive<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const previousOperation = githubDeliveryOperationQueue
  let releaseOperation!: () => void
  const operationGate = new Promise<void>((resolve) => {
    releaseOperation = resolve
  })
  githubDeliveryOperationQueue = previousOperation.then(() => operationGate)
  await previousOperation

  if (githubDeliveryStopping) {
    releaseOperation()
    throw new Error('GitHub Delivery operations have stopped.')
  }

  const operationAbortController = new AbortController()
  githubDeliveryOperationAbortController = operationAbortController
  const operationTimeout = setTimeout(() => {
    operationAbortController.abort()
  }, GITHUB_DELIVERY_OPERATION_TIMEOUT_MS)
  try {
    return await operation(operationAbortController.signal)
  } finally {
    clearTimeout(operationTimeout)
    if (
      githubDeliveryOperationAbortController === operationAbortController
    ) {
      githubDeliveryOperationAbortController = undefined
    }
    releaseOperation()
  }
}

async function createCurrentGitHubDeliveryContext(signal: AbortSignal) {
  const store = await getStore()
  const bundle = await store.getDesktopPairingCredentialBundle()
  const credential = bundle?.credential
  const localProjectId = credential?.localProjectId
  const exactScopeFields = [
    credential?.tokenId,
    credential?.organizationId,
    credential?.projectId,
    localProjectId,
    credential?.userId,
  ]
  if (
    !bundle ||
    !credential ||
    typeof localProjectId !== 'string' ||
    localProjectId.length === 0 ||
    localProjectId.trim() !== localProjectId ||
    exactScopeFields.some(
      (value) =>
        typeof value !== 'string' ||
        value.length === 0 ||
        value.trim() !== value,
    ) ||
    !credential.projectMemberships.some(
      (membership) =>
        membership.projectId === credential.projectId &&
        membership.userId === credential.userId,
    )
  ) {
    return null
  }

  const authToken = await decryptTeamCredential(bundle.encryptedToken)
  signal.throwIfAborted()
  if (await store.getDesktopPairingEncryptedToken() !== bundle.encryptedToken) {
    throw new Error('团队绑定已更新，请重新执行操作。')
  }
  const remote = createGitHubDeliveryRemoteClient({
    apiBaseUrl: resolveRemoteApiBaseUrl(),
    authToken,
    signal,
  })
  return { store, credential, localProjectId, remote }
}

type CurrentGitHubDeliveryContext = NonNullable<
  Awaited<ReturnType<typeof createCurrentGitHubDeliveryContext>>
>

function createScopedGitHubDeliveryStore(
  context: CurrentGitHubDeliveryContext,
) {
  const { store, credential, localProjectId } = context
  return {
    listGitHubDeliveryIntents: async (runId?: string) =>
      (await store.listGitHubDeliveryIntents(runId)).filter(
        (intent) =>
          intent.organizationId === credential.organizationId &&
          intent.teamProjectId === credential.projectId &&
          intent.localProjectId === localProjectId,
      ),
    listGitHubDeliveryOperatorOutcomes: (intentId?: string) =>
      store.listGitHubDeliveryOperatorOutcomes(intentId),
    listArtifacts: (runId?: string) => store.listArtifacts(runId),
    listManagedCodingWorkspaces: async (projectId?: string) => {
      if (projectId && projectId !== localProjectId) return []
      return (await store.listManagedCodingWorkspaces(localProjectId)).filter(
        (workspace) => workspace.projectId === localProjectId,
      )
    },
    getRun: async (runId: string) => {
      const run = await store.getRun(runId)
      return run?.projectId === localProjectId ? run : null
    },
    commitGitHubDeliveryIntentStatus: (
      mutation: Parameters<LocalStore['commitGitHubDeliveryIntentStatus']>[0],
    ) => store.commitGitHubDeliveryIntentStatus(mutation),
    commitGitHubDeliveryIntentCompletion: (
      mutation: Parameters<LocalStore['commitGitHubDeliveryIntentCompletion']>[0],
    ) => store.commitGitHubDeliveryIntentCompletion(mutation),
    commitGitHubDeliveryContentScan: (
      input: Parameters<LocalStore['commitGitHubDeliveryContentScan']>[0],
    ) => store.commitGitHubDeliveryContentScan(input),
  }
}

async function createActiveGitHubDeliveryProcessor(
  signal: AbortSignal,
  context: CurrentGitHubDeliveryContext,
) {
  const { store, remote } = context
  const scopedStore = createScopedGitHubDeliveryStore(context)
  const publisher = createGitHubGitPublisher({ signal })
  const contentScanner = createGitHubOutboundContentScanner({ signal })
  return createGitHubDeliveryProcessor({
    store: scopedStore,
    remote,
    publisher,
    contentScanner,
    workflow: createWorkflowRuntime(store),
    preparationRuntime: await getGitHubDeliveryRuntime(),
    workspaceCoordinator: workspaceOperationCoordinator,
    maxIntentsPerCycle: 1,
    onIntentOperationChange: (active) => {
      githubDeliveryActiveIntentOperation = active
    },
    minimumCredentialLifetimeMs:
      GITHUB_GIT_PUBLISHER_REQUIRED_CREDENTIAL_LIFETIME_MS,
  })
}

async function createCurrentGitHubDeliveryProcessor(signal: AbortSignal) {
  const context = await createCurrentGitHubDeliveryContext(signal)
  if (!context) return null
  const { store, credential, remote } = context
  const binding = await synchronizeGitHubRepositoryBinding({
    store,
    remote,
    expectedPairing: credential,
  })
  if (!binding || binding.status !== 'active') return null
  return createActiveGitHubDeliveryProcessor(signal, context)
}

async function prepareGitHubDelivery(input: PrepareGitHubDeliveryInput) {
  try {
    return await runGitHubDeliveryExclusive(async (signal) => {
      const context = await createCurrentGitHubDeliveryContext(signal)
      if (!context) throw new GitHubRepositoryBindingSyncError()
      const binding = await synchronizeGitHubRepositoryBinding({
        store: context.store,
        remote: context.remote,
        expectedPairing: context.credential,
      })
      if (!binding || binding.status !== 'active') {
        throw new GitHubRepositoryBindingSyncError()
      }
      const runtime = await getGitHubDeliveryRuntime()
      return runtime.prepare(input)
    })
  } finally {
    await broadcastGitHubDeliveryState()
  }
}

async function replaceGitHubDelivery(
  kind: 'revise' | 'retry',
  input: ReviseGitHubDeliveryInput | RetryGitHubDeliveryInput,
) {
  try {
    return await runGitHubDeliveryExclusive(async (signal) => {
      const context = await createCurrentGitHubDeliveryContext(signal)
      if (!context) throw new GitHubRepositoryBindingSyncError()
      const binding = await synchronizeGitHubRepositoryBinding({
        store: context.store,
        remote: context.remote,
        expectedPairing: context.credential,
      })
      if (!binding || binding.status !== 'active') {
        throw new GitHubRepositoryBindingSyncError()
      }
      if (kind === 'retry') {
        const candidates = (await context.store.listGitHubDeliveryIntents()).filter(
          (intent) =>
            intent.id === input.intentId &&
            intent.updatedAt === input.expectedUpdatedAt &&
            intent.organizationId === context.credential.organizationId &&
            intent.teamProjectId === context.credential.projectId &&
            intent.localProjectId === context.localProjectId,
        )
        if (candidates.length !== 1) {
          throw new GitHubDeliveryRetryAuthorityError()
        }
        const intent = candidates[0]!
        assertGitHubDeliveryRetryAuthority({
          intent,
          binding,
          requests: await context.remote.listInbox(intent.teamProjectId),
        })
      }
      const runtime = await getGitHubDeliveryRuntime()
      return runtime[kind](input)
    })
  } finally {
    await broadcastGitHubDeliveryState()
  }
}

async function broadcastGitHubDeliveryState(): Promise<void> {
  try {
    const store = await getStore()
    broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
  } catch {
    console.warn('[github-delivery] Unable to broadcast the latest local state.')
  }
}

async function processAvailableGitHubDeliveries(): Promise<void> {
  const store = await getStore()
  const before = getLocalStoreRevision(store)
  try {
    await runGitHubDeliveryExclusive(async (signal) => {
      const intents = await store.listGitHubDeliveryIntents()
      const workflow = createWorkflowRuntime(store)
      await reconcileCompletedGitHubDeliveryIntents({
        store,
        workflow,
      })

      const hasPendingDelivery = intents.some(
        (intent) => !['completed', 'failed', 'revoked'].includes(intent.status),
      )
      // A completed delivery still has live repository authority. Observe its
      // revocation without starting a publisher; skip only truly idle scopes.
      if (!hasPendingDelivery) {
        const pairing = await store.getDesktopPairingCredential()
        if (!pairing) return
        const binding = await store.getGitHubRepositoryBinding(pairing.projectId)
        if (binding?.status !== 'active') return
      }

      const context = await createCurrentGitHubDeliveryContext(signal)
      if (!context) return
      const scopedStore = createScopedGitHubDeliveryStore(context)
      await reconcileRemoteCompletedGitHubDeliveryIntents({
        store: scopedStore,
        remote: context.remote,
        workflow,
      })

      const binding = await synchronizeGitHubRepositoryBinding({
        store,
        remote: context.remote,
        expectedPairing: context.credential,
      })
      if (!binding || binding.status !== 'active') return
      if (!hasPendingDelivery) return

      const processor = await createActiveGitHubDeliveryProcessor(signal, context)
      await processor.recoverAndAdvance()
    })
  } finally {
    if (before === undefined || before !== getLocalStoreRevision(store)) {
      await broadcastGitHubDeliveryState()
    }
  }
}

function safeGitHubDeliveryResult(
  result: ResumeGitHubDeliveryResult,
): ResumeGitHubDeliveryResult {
  return {
    intentId: result.intentId,
    remoteRequestId: result.remoteRequestId,
    disposition: result.disposition,
    outcomeCode: result.outcomeCode,
  }
}

async function resumeGitHubDelivery(
  input: ResumeGitHubDeliveryInput,
): Promise<ResumeGitHubDeliveryResult> {
  try {
    return await runGitHubDeliveryExclusive(async (signal) => {
      try {
        const processor = await createCurrentGitHubDeliveryProcessor(signal)
        if (!processor) {
          return {
            intentId: input.intentId,
            remoteRequestId: null,
            disposition: 'local_conflict',
            outcomeCode: 'pairing_required',
          }
        }
        return safeGitHubDeliveryResult(await processor.resume(input))
      } catch {
        return {
          intentId: input.intentId,
          remoteRequestId: null,
          disposition: 'recovery_required',
          outcomeCode: 'processor_unavailable',
        }
      }
    })
  } finally {
    await broadcastGitHubDeliveryState()
  }
}

async function verifyCurrentGitHubDeliveryRevocation(
  input: VerifyGitHubDeliveryRevocationInput,
): Promise<VerifyGitHubDeliveryRevocationResult> {
  try {
    return await runGitHubDeliveryExclusive(async (signal) => {
      const context = await createCurrentGitHubDeliveryContext(signal)
      if (!context) {
        return {
          intentId: input.intentId,
          disposition: 'unverified',
          outcomeCode: 'revocation_unavailable',
        }
      }
      return runGitHubDeliveryRevocationProbe(
        {
          store: context.store,
          remote: context.remote,
          expectedPairing: context.credential,
        },
        input,
      )
    })
  } catch {
    return {
      intentId: input.intentId,
      disposition: 'unverified',
      outcomeCode: 'revocation_unavailable',
    }
  } finally {
    await broadcastGitHubDeliveryState()
  }
}

async function stopCurrentGitHubDelivery(
  input: StopGitHubDeliveryInput,
): Promise<StopGitHubDeliveryResult> {
  try {
    const store = await getStore()
    const [credential, intents] = await Promise.all([
      store.getDesktopPairingCredential(),
      store.listGitHubDeliveryIntents(),
    ])
    const intent = intents.find((candidate) => candidate.id === input.intentId)
    if (
      !credential?.localProjectId ||
      !intent ||
      intent.organizationId !== credential.organizationId ||
      intent.teamProjectId !== credential.projectId ||
      intent.localProjectId !== credential.localProjectId
    ) {
      return {
        intentId: input.intentId,
        disposition: 'local_conflict',
        outcomeCode: 'intent_not_found',
      }
    }
    const expectedTimestamp = Date.parse(input.expectedUpdatedAt)
    const updatedAt = new Date(
      Math.max(Date.now(), expectedTimestamp + 1),
    ).toISOString()
    return await stopGitHubDelivery({
      input,
      updatedAt,
      stopIntent: (stopInput) =>
        store.stopGitHubDeliveryIntent(stopInput),
      getActiveOperation: () => {
        const active = githubDeliveryActiveIntentOperation
        const controller = githubDeliveryOperationAbortController
        if (!active || !controller) return null
        return {
          ...active,
          abort: () => {
            if (
              githubDeliveryActiveIntentOperation === active &&
              githubDeliveryOperationAbortController === controller
            ) {
              controller.abort()
            }
          },
        }
      },
    })
  } catch {
    return {
      intentId: input.intentId,
      disposition: 'local_conflict',
      outcomeCode: 'stop_unavailable',
    }
  } finally {
    await broadcastGitHubDeliveryState()
  }
}

async function getGitHubDeliveryScheduler() {
  if (githubDeliveryScheduler) return githubDeliveryScheduler

  githubDeliverySchedulerPromise ??= Promise.resolve().then(() => {
    githubDeliveryScheduler = createGitHubDeliveryScheduler({
      recoverAndAdvance: processAvailableGitHubDeliveries,
      pollingIntervalMs: backgroundPollInterval,
      onError: () => {
        console.warn('[github-delivery] A recovery cycle failed and will be retried.')
      },
    })
    return githubDeliveryScheduler
  })

  try {
    return await githubDeliverySchedulerPromise
  } finally {
    githubDeliverySchedulerPromise = undefined
  }
}

function wakeGitHubDeliveryScheduler(): void {
  if (githubDeliveryStopping) return
  void getGitHubDeliveryScheduler()
    .then((scheduler) => scheduler.wake())
    .catch(() => {
      console.warn('[github-delivery] Unable to wake the recovery scheduler.')
    })
}

async function waitForGitHubDeliveryCleanup(): Promise<void> {
  let cleanupTimeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      githubDeliveryOperationQueue,
      new Promise<void>((resolve) => {
        cleanupTimeout = setTimeout(resolve, GITHUB_DELIVERY_QUIT_GRACE_MS)
      }),
    ])
  } finally {
    if (cleanupTimeout) clearTimeout(cleanupTimeout)
  }
}

function freezeGateCommandBinding(
  credential: Awaited<ReturnType<LocalStore['getDesktopPairingCredential']>> & {
    localProjectId: string
  },
): FrozenGateCommandBinding {
  const pairing = {
    ...credential,
    projectMemberships: credential.projectMemberships.map((membership) => ({
      ...membership,
    })),
  }
  for (const membership of pairing.projectMemberships) {
    Object.freeze(membership)
  }
  Object.freeze(pairing.projectMemberships)
  Object.freeze(pairing)
  return Object.freeze({
    pairing,
    claimTokenId: pairing.tokenId,
    project: Object.freeze({
      teamProjectId: pairing.projectId,
      localProjectId: credential.localProjectId,
    }),
  })
}

function isKnownGateCommandEvaluationUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message ===
      'Repository knowledge is unavailable for this local project.' ||
    error.message ===
      'The requested Run does not belong to the selected local project.' ||
    error.message.startsWith('Run not found:') ||
    error.message.startsWith('Run node not found:')
  )
}

function withLatestBudgetDecision(
  evidence: Omit<WorkflowEvidenceSnapshot, 'budgetDecision'>,
): WorkflowEvidenceSnapshot {
  const latestCodingRun = [...evidence.codingRuns].sort((left, right) =>
    (right.completedAt ?? right.startedAt).localeCompare(
      left.completedAt ?? left.startedAt,
    ),
  )[0]
  return {
    ...evidence,
    ...(latestCodingRun?.budgetDecision
      ? { budgetDecision: latestCodingRun.budgetDecision }
      : {}),
  }
}

async function buildUnavailableGateCommandEvaluation(input: {
  command: GateCommand
  run: WorkflowRun
  store: LocalStore
  remoteSync: RemoteSyncClient
}): Promise<LocalGateCommandEvaluation> {
  const policyRefreshed = await refreshRemotePolicySnapshotForProject(
    input.command.projectId,
    input.remoteSync,
  )
  const [
    storedPolicySnapshot,
    artifacts,
    codingRuns,
    codingDiffs,
    testEvidence,
    agentReviews,
    githubDeliveryIntents,
    overrides,
  ] = await Promise.all([
    loadPolicySnapshotForProject(input.command.projectId),
    input.store.listArtifacts(input.run.id),
    input.store.listCodingAgentRuns(input.run.id),
    input.store.listCodingDiffArtifacts(input.run.id),
    input.store.listTestEvidence(input.run.id),
    input.store.listAgentReviews(input.run.id),
    input.store.listGitHubDeliveryIntents(input.run.id),
    input.store.listGateOverrides(input.run.id),
  ])
  const unavailableAt = new Date().toISOString()
  const policySnapshot: PolicySnapshot =
    policyRefreshed &&
    storedPolicySnapshot.source === 'remote_cache' &&
    storedPolicySnapshot.effectivePolicy !== null
      ? storedPolicySnapshot
      : {
          projectId: input.command.projectId,
          organizationPolicy: null,
          projectOverride: null,
          effectivePolicy: null,
          version: 0,
          updatedAt: unavailableAt,
          syncedAt: unavailableAt,
          source: 'unavailable',
        }
  const localUnavailableReason = {
    id: 'gate-command-local-evidence-unavailable',
    target: 'missing_agent_review' as const,
    ruleKey: 'gate-command.local-evidence-unavailable',
    action: 'block' as const,
    summary: 'Required local project evidence is unavailable.',
  }
  const decision: GateEnforcementDecision = {
    status:
      policySnapshot.source === 'unavailable'
        ? 'blocked_policy_unavailable'
        : 'hard_blocked',
    blocksApproval: true,
    blockingReasons: [localUnavailableReason],
    warningReasons: [],
    requiredActions: ['Restore the required local project evidence.'],
    canOverride: false,
    overrideRoleRequired: 'lead',
    policySource: policySnapshot.source,
    policyVersion: policySnapshot.version,
    provisional: policySnapshot.source !== 'remote_cache',
  }
  return {
    decision,
    policySnapshot,
    overrides,
    repositoryKnowledge: {
      projectId: input.run.projectId,
      evaluatedFingerprint: 'unavailable',
      observedFingerprint: 'unavailable',
    },
    evidence: withLatestBudgetDecision({
      artifacts,
      codingRuns,
      codingDiffs,
      testEvidence,
      agentReviews,
      githubDeliveryIntents,
    }),
  }
}

async function evaluateGateCommandLocally(input: {
  command: GateCommand
  run: WorkflowRun
  node: WorkflowNode
  store: LocalStore
  remoteSync: RemoteSyncClient
}): Promise<LocalGateCommandEvaluation> {
  try {
    const [evaluation, codingRuns, codingDiffs, githubDeliveryIntents] = await Promise.all([
      evaluateLocalGateEnforcement(
        {
          runId: input.run.id,
          nodeId: input.node.id,
          projectId: input.run.projectId,
        },
        {
          refreshPolicy: true,
          requireFreshPolicy: true,
          remoteSync: input.remoteSync,
        },
      ),
      input.store.listCodingAgentRuns(input.run.id),
      input.store.listCodingDiffArtifacts(input.run.id),
      input.store.listGitHubDeliveryIntents(input.run.id),
    ])
    const observedKnowledge = await loadTrustedRepositoryKnowledge(
      input.run.projectId,
    )
    return {
      decision: evaluation.decision,
      policySnapshot: evaluation.policySnapshot,
      overrides: evaluation.gateOverrides,
      repositoryKnowledge: {
        projectId: input.run.projectId,
        evaluatedFingerprint: evaluation.knowledgeSnapshot.contentHash,
        observedFingerprint: observedKnowledge.contentHash,
      },
      evidence: withLatestBudgetDecision({
        artifacts: evaluation.artifacts,
        codingRuns,
        codingDiffs,
        testEvidence: evaluation.testEvidence,
        agentReviews: evaluation.agentReviews,
        githubDeliveryIntents,
      }),
    }
  } catch (error) {
    if (!isKnownGateCommandEvaluationUnavailable(error)) {
      throw error
    }
    return buildUnavailableGateCommandEvaluation(input)
  }
}

async function processAvailableGateCommands(): Promise<void> {
  const store = await getStore()
  const bundle = await store.getDesktopPairingCredentialBundle()
  const localProjectId = bundle?.credential.localProjectId?.trim()
  if (
    !bundle ||
    !localProjectId ||
    !bundle.credential.tokenId.trim() ||
    !bundle.credential.organizationId.trim() ||
    !bundle.credential.projectId.trim()
  ) {
    return
  }

  const binding = freezeGateCommandBinding({
    ...bundle.credential,
    localProjectId,
  })
  const authToken = await decryptTeamCredential(bundle.encryptedToken)
  if (await store.getDesktopPairingEncryptedToken() !== bundle.encryptedToken) return
  const cycleAbortController = new AbortController()
  gateCommandCycleAbortController = cycleAbortController
  const cycleTimeout = setTimeout(() => {
    cycleAbortController.abort()
  }, GATE_COMMAND_CYCLE_TIMEOUT_MS)
  try {
    const gateRemoteSync = createRemoteSyncClient({
      authToken,
      signal: cycleAbortController.signal,
    })
    const processor = createGateCommandProcessor({
      store,
      remote: gateRemoteSync,
      evaluateLocalEnforcement: ({ command, run, node }) =>
        evaluateGateCommandLocally({
          command,
          run,
          node,
          store,
          remoteSync: gateRemoteSync,
        }),
    })
    await processor.processAvailable(binding)
  } finally {
    clearTimeout(cycleTimeout)
    if (gateCommandCycleAbortController === cycleAbortController) {
      gateCommandCycleAbortController = undefined
    }
  }
}

async function getGateCommandScheduler() {
  if (gateCommandScheduler) return gateCommandScheduler

  gateCommandSchedulerPromise ??= Promise.resolve().then(() => {
    gateCommandScheduler = createGateCommandScheduler({
      processAvailable: processAvailableGateCommands,
      pollingIntervalMs: backgroundPollInterval,
      onError: () => {
        console.warn('[gate-command] A processing cycle failed and will be retried.')
      },
    })
    return gateCommandScheduler
  })

  try {
    return await gateCommandSchedulerPromise
  } finally {
    gateCommandSchedulerPromise = undefined
  }
}

function wakeGateCommandScheduler(): void {
  void getGateCommandScheduler()
    .then((scheduler) => scheduler.wake())
    .catch(() => {
      console.warn('[gate-command] Unable to wake the processing scheduler.')
    })
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

function getDesktopAgentRuntime(): Promise<DesktopAgentRuntime> {
  desktopAgentRuntimePromise ??= getStore()
    .then(async (store) => {
      if (!runtimeFlags.localMcpFixtureEnabled) return createDesktopAgentRuntime({ store })
      const projects = await store.listProjects()
      if (projects.length !== 1) throw new Error('local_mcp_fixture_project_unavailable')
      fixtureLocalMcpRuntime = await createFixtureLocalMcpRuntime({
        store,
        localProjectPath: projects[0]!.path,
        executablePath: process.execPath,
        serverPath: path.join(__dirname, 'local-mcp-fixture-server.js'),
        environment: { ELECTRON_RUN_AS_NODE: '1' },
      })
      return createDesktopAgentRuntime({
        store,
        nativeToolRegistry: fixtureLocalMcpRuntime.nativeToolRegistry,
      })
    })
    .catch((error) => {
      desktopAgentRuntimePromise = undefined
      throw error
    })
  return desktopAgentRuntimePromise
}

async function assertNoActiveCodingAgentForRun(store: LocalStore, runId: string) {
  const codingRuns = await store.listCodingAgentRuns(runId)
  const activeRun = codingRuns.find((run) => isActiveCodingAgentRunStatus(run.status))
  if (activeRun) {
    throw new Error('这个 Run 还有运行中的 Coding Agent，请先取消 Coding Agent 后再删除 Run')
  }
}

async function assertNoGitHubDeliveryIntentForRun(store: LocalStore, runId: string) {
  if ((await store.listGitHubDeliveryIntents(runId)).length > 0) {
    throw new Error('Run is bound to a GitHub Delivery Intent.')
  }
}

async function cleanupManagedWorktreesForRun(store: LocalStore, runId: string) {
  await assertNoGitHubDeliveryIntentForRun(store, runId)
  const codingRuns = await store.listCodingAgentRuns(runId)
  const codingRunIds = new Set(codingRuns.map((run) => run.id))
  if (codingRunIds.size === 0) {
    return
  }

  const workspaces = (await store.listManagedCodingWorkspaces()).filter(
    (workspace) => codingRunIds.has(workspace.codingRunId) && workspace.cleanupStatus !== 'deleted',
  )

  for (const workspace of workspaces) {
    const result = await (await getManagedWorkspaceCleanup())({
      workspaceId: workspace.id,
      projectId: workspace.projectId,
    })
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

async function createCodingRuntimeForRequest(
  knowledgeSnapshot?: RepositoryKnowledgeSnapshot,
  projectId?: string,
) {
  const [remoteSync, store, selected] = await Promise.all([
    getProjectBoundRemoteSync(),
    getStore(),
    getCodingExecutor(projectId),
  ])
  return createCodingRuntime({
    store,
    executor: selected.executor,
    ...(selected.configVersion === undefined ? {} : { executorConfigVersion: selected.configVersion }),
    prepareRetrievedKnowledge,
    assertRetrievedKnowledgeCurrent,
    sessionAuthority: async (localProjectId) => {
      const pairing = await store.getDesktopPairingCredential()
      const trusted = resolveTrustedCodingPermissionReply({
        input: { requestId: 'session', codingRunId: 'session', decidedBy: '', decision: 'approved', comment: '' },
        projectId: localProjectId, pairing,
      })
      if (pairing?.expiresAt && Date.parse(pairing.expiresAt) <= Date.now()) throw new Error('Project pairing expired.')
      return { actorId: trusted.decidedBy, key: JSON.stringify([pairing?.organizationId, pairing?.projectId, pairing?.tokenId, localProjectId, trusted.decidedBy]) }
    },
    // Managed worktrees survive approval waits and restarts within the selected data profile.
    worktreeRoot: path.join(app.getPath('userData'), 'coding-worktrees'),
    ...(knowledgeSnapshot
      ? {
          knowledgeDocuments: knowledgeSnapshot.documents,
          knowledgeChunks: knowledgeSnapshot.chunks,
          knowledgeRoot: knowledgeSnapshot.knowledgeRoot ?? null,
          projectInstructions: knowledgeSnapshot.projectInstructions ?? null,
        }
      : {}),
    budgetGuard: createRuntimeBudgetGuard(remoteSync, true),
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
    cleanupWorkspace: async (input) => (await getManagedWorkspaceCleanup())(input),
    runTestCommand: runLocalTestCommand,
    runDependencyBootstrap: ({
      codingRun,
      project,
      workspace,
      previousDependencyHash,
      approvedNonFrozenInstall,
      timestamp,
    }) =>
      runDependencyBootstrap({
        codingRunId: codingRun.id,
        runId: codingRun.runId,
        nodeId: codingRun.nodeId,
        projectId: project.id,
        worktreePath: workspace.worktreePath,
        ...(previousDependencyHash ? { previousDependencyHash } : {}),
        ...(approvedNonFrozenInstall ? { approvedNonFrozenInstall } : {}),
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
      publishRunStatus: (run) => {
        broadcastToRenderers(ipcChannels.codingRunStatusUpdated, run)
        wakeRemoteSyncOutbox()
      },
      publishEvent: (event) => broadcastToRenderers(ipcChannels.codingEventAppended, event),
      publishPermission: (request) => broadcastToRenderers(ipcChannels.codingPermissionUpdated, request),
    },
    idGenerator: (prefix = 'id') => `${prefix}-${randomUUID()}`,
  })
}

async function getCodingReadiness(input: {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  runtimeBudgetApprovalId?: string
}) {
  const [store, remoteSync] = await Promise.all([
    getStore(),
    getProjectBoundRemoteSync(),
  ])
  let selection: ResolvedCodingRuntimeSelection = {
    source: 'none',
    executor: 'unconfigured',
    configVersion: 0,
  }
  let executor: CodingExecutor | null = null
  let engineAvailable: boolean | undefined
  let opencodeReadiness: Parameters<typeof evaluateCodingRuntimeReadiness>[0]['opencodeReadiness']
  try {
    const resolved = await resolveCodingExecutorForProject(input.projectId)
    selection = resolved.selection
    executor = resolved.executor
    if (selection.source === 'project' && selection.executor === 'opencode-http') {
      const configuration = selection.configuration
      if (configuration.executor !== 'opencode-http') {
        throw new Error('Project Coding Runtime configuration does not match the selected executor')
      }
      const discovery = await detectCodingRuntimeEngines({ projectId: input.projectId })
      const candidate = discovery.candidates[0]
      const binaryAvailable = Boolean(candidate?.binaryPath === configuration.binaryPath)
      const versionCompatible = Boolean(
        candidate?.version === configuration.detectedVersion &&
        isSupportedOpencodeVersion(configuration.detectedVersion),
      )
      engineAvailable = binaryAvailable && versionCompatible && candidate?.status === 'available'
      const runtimeProfile = engineAvailable && candidate?.binaryPath
        ? await inspectOpencodeRuntimeProfile({
            binaryPath: candidate.binaryPath,
            providerId: configuration.providerId,
            modelId: configuration.modelId,
            providerBinding: await resolveSavedOpencodeProviderBinding({
              providerId: configuration.providerId,
              modelId: configuration.modelId,
              credentialSource: store,
              decryptCredential,
            }),
          })
        : { authAvailable: false, profileAvailable: false, modelAvailable: false }
      opencodeReadiness = {
        binaryAvailable,
        versionCompatible,
        authAvailable: runtimeProfile.authAvailable,
        profileAvailable: runtimeProfile.profileAvailable,
        modelAvailable: runtimeProfile.modelAvailable,
      }
    }
  } catch {
    selection = await resolveCodingRuntimeSelection({
      store,
      projectId: input.projectId,
      env: process.env,
    })
  }
  return evaluateCodingRuntimeReadiness({
    store,
    selection,
    executor,
    ...(engineAvailable === undefined ? {} : { engineAvailable }),
    ...(opencodeReadiness ? { opencodeReadiness } : {}),
    ...input,
    getBudgetPolicy: (projectId) => remoteSync.getRuntimeBudgetPolicy(projectId),
    evaluateBudget: async (budgetInput) => deferBudgetContinuation(await remoteSync.evaluateRuntimeBudget(budgetInput)),
  })
}

async function resolveTrustedCodingRequestForMain<
  T extends { runId: string; projectId: string; requestedBy: string },
>(input: T): Promise<T & { requestedBy: string }> {
  const store = await getStore()
  const [run, pairing] = await Promise.all([
    store.getRun(input.runId),
    store.getDesktopPairingCredential(),
  ])
  return resolveTrustedCodingRequest({ input, run, pairing })
}

async function createKnowledgeReviewRuntimeForRequest(
  knowledgeSnapshot: RepositoryKnowledgeSnapshot,
  signal?: AbortSignal,
  beforeCommit?: () => void,
  projectId?: string,
  approvalId?: string,
  executor: StageAgentExecutorKind = 'direct-provider',
) {
  const [remoteSync, store] = await Promise.all([
    getProjectBoundRemoteSync(),
    getStore(),
  ])
  let activeKnowledge: RetrievedKnowledgeManifest | undefined
  return createKnowledgeReviewRuntime({
    ...(signal ? { signal } : {}),
    ...(beforeCommit ? { beforeCommit } : {}),
    store,
    prepareRetrievedKnowledge,
    assertRetrievedKnowledgeCurrent: async (manifest) => {
      await assertRetrievedKnowledgeCurrent(manifest)
      activeKnowledge = manifest
    },
    knowledgeDocuments: knowledgeSnapshot.documents,
    knowledgeChunks: knowledgeSnapshot.chunks,
    knowledgeRoot: knowledgeSnapshot.knowledgeRoot ?? null,
    projectInstructions: knowledgeSnapshot.projectInstructions ?? null,
    loadPolicySnapshot: async (projectId) =>
      loadPolicySnapshotForProject(await resolvePolicyProjectId(projectId)),
    resolveProviderMetadata: async (providerId) => {
      const metadata = await resolveElectronAgentProviderMetadata({
        providerId,
        fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
        credentialSource: store,
      })
      if (executor === 'native-agent') {
        if (!projectId) throw new Error('内置仓库审查需要当前项目。')
        await findProject(projectId)
        return { ...metadata, name: `内置仓库审查 · ${metadata.name}`, executorKind: 'native-agent' as const }
      }
      if (executor !== 'local-agent') return metadata
      // Checked before the review context is built, so the reason reaches the task unchanged.
      await resolveLocalAgentReviewTarget(store, providerId, projectId)
      return { ...metadata, name: `OpenCode（可读仓库）· ${metadata.name}`, executorKind: 'local-agent' as const }
    },
    resolveProvider: async (providerId) => executor === 'native-agent'
      ? createNativeRepositoryReviewProvider({ provider: await resolveAgentProvider(store, providerId, projectId, approvalId), projectPath: (await findProject(projectId!)).path, knowledgeRoot: knowledgeSnapshot.knowledgeRoot ?? null })
      : executor === 'local-agent'
      ? resolveLocalAgentReviewProvider(store, providerId, projectId, approvalId, knowledgeSnapshot.knowledgeRoot ?? null,
        async () => { if (activeKnowledge) await assertRetrievedKnowledgeCurrent(activeKnowledge) })
      : resolveAgentProvider(store, providerId, projectId, approvalId),
    budgetGuard: createKnowledgeReviewRuntimeBudgetGuard(remoteSync, true),
  })
}

/** Saved Provider and local OpenCode for a read-only Gate Review (knowledge-context K2). */
async function resolveLocalAgentReviewTarget(store: LocalStore, providerId: string, projectId: string | undefined) {
  if (providerId === 'fake-knowledge-review') {
    throw new Error('OpenCode 门禁审查需要已保存的模型 Provider；演示用的假 Provider 不能读取仓库。')
  }
  if (!projectId) throw new Error('请选择本地仓库。')
  const project = await findProject(projectId)
  const credential = (await store.listProviderCredentials()).find((item) => item.providerId === providerId)
  if (!credential) throw new Error('请先在设置中保存门禁审查使用的模型 Provider。')
  const discovery = await detectCodingRuntimeEngines({ projectId: project.id })
  const candidate = discovery.candidates.find((item) => item.engine === 'opencode-http' && item.status === 'available')
  if (!candidate?.binaryPath || !candidate.version) {
    throw new Error('未检测到兼容的本机 OpenCode，请先安装并在设置中检测；也可以把门禁审查方式改回只依据知识目录。')
  }
  return { project, credential, binaryPath: candidate.binaryPath }
}

async function resolveLocalAgentReviewProvider(
  store: LocalStore,
  providerId: string,
  projectId: string | undefined,
  approvalId: string | undefined,
  knowledgeRoot: string | null,
  assertContextCurrent?: () => Promise<void>,
): Promise<AgentProvider> {
  const { project, credential, binaryPath } = await resolveLocalAgentReviewTarget(store, providerId, projectId)
  const binding = await resolveSavedOpencodeProviderBinding({
    providerId,
    modelId: credential.model,
    credentialSource: store,
    decryptCredential,
  })
  if (!binding) throw new Error('无法读取所选 Provider 的凭据，请在设置中重新保存。')
  const metadata = await resolveElectronAgentProviderMetadata({
    providerId,
    fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
    credentialSource: store,
  })
  const provider = createReadOnlyLocalKnowledgeReviewProvider({
    projectId: project.id,
    projectPath: project.path,
    binaryPath,
    metadata,
    processManager: opencodeProcessManager,
    runtimeEnv: buildOpencodeRuntimeEnv({ baseEnv: process.env, apiKeyEnvName: 'OPENCODE_API_KEY' }),
    toolCacheDirectory: opencodeToolCacheDirectory(),
    knowledgeRoot,
    // Every OpenCode model round is admitted against the project budget, like stage Agents.
    openBudgetRelay: async () => createGovernedOpencodeProxy({
      binding,
      projectId: project.id,
      governance: await modelCallGovernance(store),
      ...(assertContextCurrent ? { assertContextCurrent } : {}),
      ...(approvalId ? { approvalId } : {}),
    }),
  })
  return guardProviderCalls(provider, {
    guard: providerOperations,
    credentialExists: async () => (await store.listProviderCredentials()).some((item) => item.providerId === providerId),
  })
}

function maskCredential(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}...`
  }

  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`
}

function encryptCredential(secret: string): Promise<string> {
  return credentialAccess.encrypt(secret, 'provider')
}

function decryptCredential(secret: string): Promise<string> {
  return credentialAccess.decrypt(secret, 'provider')
}

function decryptTeamCredential(secret: string): Promise<string> {
  return credentialAccess.decrypt(secret, 'team')
}

async function listAgentProviderConfigs() {
  const store = await getStore()
  const credentials = await store.listProviderCredentials()

  return listElectronAgentProviderConfigs({
    credentials,
    fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
  })
}

const explicitModelBudgetApprovals = new Map<string, string>()
async function modelCallAccountingScope(store: LocalStore): Promise<ModelCallAccountingScope> {
  const pairing = await store.getDesktopPairingCredential()
  if (!pairing?.localProjectId) throw new Error('请先将本地项目配对到团队项目。')
  return { organizationId: pairing.organizationId, userId: pairing.userId, teamProjectId: pairing.projectId, localProjectId: pairing.localProjectId }
}
async function desktopModelCostRecovery(store: LocalStore) {
  const scope = await modelCallAccountingScope(store)
  const remote = await getRemoteSyncClient()
  if (canonicalFinancialValue(scope) !== canonicalFinancialValue(await modelCallAccountingScope(store))) throw new Error('团队绑定已更新，请重试。')
  return { scope, remote, recovery: createDesktopModelCostRecovery({ store, scope, remote, getScope: () => modelCallAccountingScope(store) }) }
}
let budgetPromptPublication = 0
const budgetContinuationPrompts = createBudgetContinuationPrompts(cards => {
  const publication = ++budgetPromptPublication
  void getStore().then(modelCallAccountingScope).then(scope => {
    if (publication !== budgetPromptPublication) return
    broadcastToRenderers(ipcChannels.modelBudgetContinuationUpdated, cards.filter(card => card.localProjectId === scope.localProjectId && card.organizationId === scope.organizationId && card.actorId === scope.userId))
  }).catch(() => { if (publication === budgetPromptPublication) broadcastToRenderers(ipcChannels.modelBudgetContinuationUpdated, []) })
})
async function modelCallGovernance(store:LocalStore):Promise<ModelCallGovernance> {
  const { scope, remote, recovery } = await desktopModelCostRecovery(store)
  const sync = createProjectBoundRemoteSync({ remoteSync: remote, credentialSource: store,
    expectedScope: { localProjectId: scope.localProjectId, organizationId: scope.organizationId, teamProjectId: scope.teamProjectId }, expectedUploaderUserId: scope.userId })
  return {
    pending: recovery.pending,
    persist: (input, metadata) => store.saveModelCallSettlement(input, { final: metadata?.final === true, scope }),
    reserve:async(input, signal)=>{
      if (canonicalFinancialValue(scope) !== canonicalFinancialValue(await modelCallAccountingScope(store))) throw new Error('团队绑定已更新，请重新执行。')
      const policyProjectId = await resolvePolicyProjectId(input.projectId)
      if (!await refreshRemotePolicySnapshotForProject(policyProjectId)) throw new Error('尚未调用模型：无法同步当前团队流程策略，请检查 Team 连接后重试。')
      const snapshot=await loadPolicySnapshotForProject(policyProjectId)
      if (snapshot.source!=='remote_cache') throw new Error('尚未调用模型：请先同步当前团队流程 Policy。')
      for(const historical of legacyChatBudget(await store.listWorkbenchConversations(input.projectId),await listAgentProviderConfigs())) await sync.importHistoricalModelCall(historical)
      // Flush existing stage/review/coding consumption before the atomic admission.
      await sync.evaluateRuntimeBudget({projectId:input.projectId,providerId:input.providerId,projectedCostUsd:0})
      const active=(await store.listCodingAgentRuns()).find((run)=>run.projectId===input.projectId && run.providerId===input.providerId && isActiveCodingAgentRunStatus(run.status))
      const pairing = await store.getDesktopPairingCredential()
      const approvalId = input.approvalId ?? active?.budgetDecision?.approvalId ??
        explicitModelBudgetApprovals.get(`${pairing?.tokenId}:${input.projectId}:${input.providerId}`)
      const scopeKey = canonicalFinancialValue(scope)
      const continuationId = input.operation ? budgetContinuationPrompts.accepted(scopeKey, input.operation.id) : undefined
      const quote = { ...input, ...(approvalId ? { approvalId } : {}), ...(continuationId ? { continuationId } : {}) }
      let admission = await sync.reserveModelCall(quote)
      if (!admission.accepted && (admission.decision.continuationEligible || continuationId) && input.operation && input.boundBasis) {
        signal?.throwIfAborted()
        const card = await sync.prepareModelBudgetContinuation(input)
        const acceptedId = await budgetContinuationPrompts.wait({ ...card, localProjectId: input.projectId, localContext: describeBudgetContinuation(card, await store.listWorkbenchConversations(input.projectId)) }, scopeKey, async () => {
          if (scopeKey !== canonicalFinancialValue(await modelCallAccountingScope(store))) throw new Error('团队身份已变化，请重新发起操作。')
          await sync.confirmModelBudgetContinuation({ id: card.id, projectId: input.projectId, expectedVersion: card.version })
        }, signal)
        signal?.throwIfAborted()
        admission = await sync.reserveModelCall({ ...quote, continuationId: acceptedId })
      }
      broadcastToRenderers(ipcChannels.modelBudgetUpdated, { projectId: input.projectId, providerId: input.providerId, decision: admission.decision })
      return admission
    },
    settle: recovery.settle,
  }
}
async function resolveAgentProvider(store: LocalStore, providerId: string, projectId?: string, approvalId?:string) {
  const provider = await resolveElectronAgentProvider({
    providerId,
    fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
    credentialSource: store,
    decryptCredential,
  })
  return guardProviderCalls(projectId && providerId!=='fake-knowledge-review' ? governAgentProvider(provider,projectId,await modelCallGovernance(store),approvalId) : provider, {
    guard: providerOperations,
    credentialExists: async () => providerId === 'fake-knowledge-review'
      ? runtimeFlags.fakeRuntimeEnabled
      : (await store.listProviderCredentials()).some((item) => item.providerId === providerId),
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

async function loadTrustedRepositoryKnowledge(
  projectId: string,
  options: { refresh?: boolean } = {},
): Promise<RepositoryKnowledgeSnapshot> {
  return repositoryKnowledgeResolver.loadProject(projectId, options)
}

async function loadTrustedRunKnowledge(input: {
  runId: string
  nodeId: string
  projectId: string
}): Promise<{
  knowledgeSnapshot: RepositoryKnowledgeSnapshot
}> {
  return {
    knowledgeSnapshot: await repositoryKnowledgeResolver.loadRun(input),
  }
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

  if (!(await isGitWorkingTreeRoot(project.path))) {
    return {
      projectId: project.id,
      status: 'not_git',
      message: 'not a git repository root',
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

async function refreshRemotePolicySnapshotForProject(
  projectId: string,
  remoteSync?: RemoteSyncClient,
): Promise<boolean> {
  if (projectId.startsWith('local-')) {
    return false
  }

  try {
    const store = await getStore()
    const pairing = await store.getDesktopPairingCredential()
    if (!pairing || pairing.projectId !== projectId) {
      return false
    }

    const snapshot = await (remoteSync ?? await getRemoteSyncClient()).loadRemoteSnapshot({
      organizationId: pairing.organizationId,
    })
    const hasAuthoritativeProjectPolicy =
      snapshot.projects.some((project) => project.id === projectId) &&
      snapshot.enforcementPolicies?.effectivePolicies.some(
        (policy) => policy.projectId === projectId,
      ) === true
    if (!hasAuthoritativeProjectPolicy) {
      return false
    }
    await cacheRemotePolicySnapshots(snapshot)
    return true
  } catch {
    // Keep the last authoritative cache if the team API is offline.
    return false
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
  options: {
    refreshPolicy?: boolean
    requireFreshPolicy?: boolean
    remoteSync?: RemoteSyncClient
    knowledgeSnapshot?: RepositoryKnowledgeSnapshot
  } = {},
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
  if (input.projectId !== undefined && input.projectId !== run.projectId) {
    throw new Error('The requested Run does not belong to the selected local project.')
  }

  const knowledgeSnapshot = options.knowledgeSnapshot
    ?? await loadTrustedRepositoryKnowledge(run.projectId)
  if (knowledgeSnapshot.projectId !== run.projectId) {
    throw new Error('Repository knowledge is unavailable for this local project.')
  }

  const policyProjectId = await resolvePolicyProjectId(run.projectId)
  let policyRefreshSucceeded = !options.requireFreshPolicy
  if (options.refreshPolicy) {
    policyRefreshSucceeded = await refreshRemotePolicySnapshotForProject(
      policyProjectId,
      options.remoteSync,
    )
  }

  const [artifacts, testEvidence, agentReviews, gateOverrides, storedPolicySnapshot] = await Promise.all([
    store.listArtifacts(run.id),
    store.listTestEvidence(run.id),
    store.listAgentReviews(run.id),
    store.listGateOverrides(run.id),
    loadPolicySnapshotForProject(policyProjectId),
  ])
  const unavailableAt = new Date().toISOString()
  const policySnapshot: PolicySnapshot =
    options.requireFreshPolicy && !policyRefreshSucceeded
      ? {
          projectId: policyProjectId,
          organizationPolicy: null,
          projectOverride: null,
          effectivePolicy: null,
          version: 0,
          updatedAt: unavailableAt,
          syncedAt: unavailableAt,
          source: 'unavailable',
        }
      : storedPolicySnapshot
  const knowledgeReferences = buildKnowledgeReferences({
    run,
    artifacts,
    documents: knowledgeSnapshot.documents,
    chunks: knowledgeSnapshot.chunks,
    testEvidence,
  })
  const governanceChecks = buildKnowledgeGovernanceChecks({
    run,
    node,
    artifacts,
    documents: knowledgeSnapshot.documents,
    chunks: knowledgeSnapshot.chunks,
    testEvidence,
  })
  const nodeAgentReviews = agentReviews.filter((review) => review.nodeId === node.id)
  const reviewFreshness = await Promise.all(
    nodeAgentReviews.map(async (review) => ({
      review,
      freshness: await assessAgentReviewFreshness({ review, run, node, artifacts }),
    })),
  )
  const currentAgentReviews = reviewFreshness
    .filter(({ freshness }) => freshness.status !== 'stale')
    .map(({ review }) => review)
  const latestAgentReview =
    currentAgentReviews
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  const agentPolicyFindings = currentAgentReviews
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
    knowledgeSnapshot,
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

let workbenchConversationService: Promise<WorkbenchConversationService> | undefined
async function getWorkbenchConversationService() {
  workbenchConversationService ??= getStore().then(async (store) => {
    const service = new WorkbenchConversationService({
      nativeReadOnlyPilotEnabled: process.env.DEVFLOW_NATIVE_READONLY_PILOT_ENABLED === '1',
      nativeConversationsEnabled: process.env.DEVFLOW_NATIVE_CONVERSATIONS_ENABLED !== '0',
      store,
      memory: store,
      resolveProvider: (id, projectId) => resolveAgentProvider(store, id, projectId),
      openHarness: async ({ project, providerId, signal, query, investigationBudget }) => {
        const metadata = (await store.listProviderCredentials()).find((item) => item.providerId === providerId)
        if (!metadata) throw new Error('请先在 Agents 中保存所选模型的 Provider 配置。')
        const discovery = await detectCodingRuntimeEngines({ projectId: project.id })
        const candidate = discovery.candidates.find((item) => item.engine === 'opencode-http' && item.status === 'available')
        if (!candidate?.binaryPath) throw new Error('未检测到兼容的本机 OpenCode，请安装后重试。')
        signal.throwIfAborted()
        const binding = await resolveSavedOpencodeProviderBinding({ providerId, modelId: metadata.model,
          credentialSource: store, decryptCredential: (secret) => credentialAccess.decrypt(secret, 'provider', signal) })
        signal.throwIfAborted()
        if (!binding) throw new Error('所选模型的凭据已变更，请检查配置后重试。')
        if ((await store.listProviderCredentials()).find((item) => item.providerId === providerId)?.updatedAt !== metadata.updatedAt) throw new Error('所选模型配置已变更，请重试。')
        const budgetProxy=await createGovernedOpencodeProxy({binding,projectId:project.id,governance:await modelCallGovernance(store)})
        try {
          const harness=await createWorkbenchOpencodeExecutor({binaryPath:candidate.binaryPath,binding:budgetProxy.binding,signal,query,...(investigationBudget?{investigationBudget}:{})})
          return {...harness,completeStructuredJson:async(input)=>{
            const since=new Date().toISOString()
            const result=await harness.completeStructuredJson!(input)
            return {...result,usage:{...result.usage,...budgetProxy.usageSince(since)}}
          },close:async()=>{try{await harness.close?.()}finally{await budgetProxy.close()}}}
        } catch(error){await budgetProxy.close();throw error}
      },
      loadKnowledge: (projectId) => loadTrustedRepositoryKnowledge(projectId, { refresh: true }),
      knowledgeSearch: async (projectId, args, turn, signal) =>
        (await getHindsightService()).search(await hindsightScope(projectId), args, turn, signal),
      knowledgeRead: async (projectId, args) =>
        (await getHindsightService()).read(await hindsightScope(projectId), args),
      memorySearch: async (projectId, args, signal) =>
        (await projectMemoryRecall?.search({ projectId, query: args.query, limit: args.limit, signal })) ?? undefined,
      inspectGate: async (target) => {
        const evaluated = await evaluateLocalGateEnforcement(target)
        return { decision: evaluated.decision, policyVersion: evaluated.policySnapshot.version, policySource: evaluated.policySnapshot.source }
      },
      changed: (projectId) => broadcastToRenderers(ipcChannels.workbenchConversationUpdated, projectId),
      published: async () => broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState()),
    })
    await service.recoverInterrupted()
    return service
  })
  return workbenchConversationService
}

const stageAgentOperations = new StageAgentOperations()
const reviewOperations = new StageAgentOperations()

function registerIpcHandlers() {
  ipcMain.handle(ipcChannels.modelBudgetContinuation, async (_event, payload: unknown) => {
    const store = await getStore()
    if (!payload || typeof payload !== 'object') throw new Error('无效的预算确认请求。')
    const value = payload as Record<string, unknown>
    if (value.action === 'list') {
      const scope = await modelCallAccountingScope(store).catch(() => null)
      return scope ? budgetContinuationPrompts.list().filter(card => card.localProjectId === scope.localProjectId && card.organizationId === scope.organizationId && card.actorId === scope.userId) : []
    }
    if (value.action !== 'respond' || typeof value.id !== 'string' || typeof value.expectedVersion !== 'string' || typeof value.confirmed !== 'boolean') throw new Error('无效的预算确认请求。')
    const scope = await modelCallAccountingScope(store)
    await budgetContinuationPrompts.respond({ id: value.id, expectedVersion: value.expectedVersion, confirmed: value.confirmed }, canonicalFinancialValue(scope))
    return budgetContinuationPrompts.list().filter(card => card.localProjectId === scope.localProjectId && card.organizationId === scope.organizationId && card.actorId === scope.userId)
  })
  ipcMain.handle(ipcChannels.listDiagnosticRecords, () => diagnosticLog.list())
  ipcMain.handle(ipcChannels.listCredentialAccess, () => credentialAccess.list())
  ipcMain.handle(ipcChannels.cancelCredentialAccess, (_event, payload: unknown) => {
    if (typeof payload !== 'string' || !/^[a-f0-9-]{36}$/u.test(payload)) throw new Error('Invalid credential operation ID')
    return credentialAccess.cancel(payload)
  })
  ipcMain.handle(ipcChannels.workbenchConversation, async (_, payload: unknown) => {
    try { return await (await getWorkbenchConversationService()).command(payload) }
    catch (error) {
      const message = error instanceof Error && /^[\u4e00-\u9fff]/u.test(error.message) ? error.message.slice(0, 240) : '会话操作未完成，请重试。'
      return { conversations: [], error: message }
    }
  })
  ipcMain.handle(ipcChannels.loadState, async () => {
    const store = await getStore()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.loadDataProfileDiagnostics, async () => {
    if (!selectedDataProfile) {
      throw new Error('Desktop data profile selection is unavailable')
    }
    const state = await (await getStore()).loadState()
    return buildDesktopDataProfileDiagnostics({
      profile: selectedDataProfile,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectCount: state.projects.length,
      runs: state.runs,
    })
  })

  ipcMain.handle(ipcChannels.loadRepositoryKnowledge, async (_, payload: unknown) => {
    const input = parseLoadRepositoryKnowledgeInput(payload)
    return loadTrustedRepositoryKnowledge(input.projectId)
  })

  ipcMain.handle(ipcChannels.refreshRepositoryKnowledge, async (_, payload: unknown) => {
    const input = parseRefreshRepositoryKnowledgeInput(payload)
    return loadTrustedRepositoryKnowledge(input.projectId, { refresh: true })
  })

  ipcMain.handle(ipcChannels.getHindsightStatus, async (_, payload: unknown) => {
    const { projectId } = parseLoadRepositoryKnowledgeInput(payload)
    return (await getHindsightService()).status(await hindsightScope(projectId))
  })
  ipcMain.handle(ipcChannels.configureHindsight, async (_, payload: unknown) => writeCredential('provider', async () => {
    const input = parseHindsightSetup(payload)
    const scope = await hindsightScope(input.projectId)
    const previous = await (await getStore()).getHindsightConfiguration(input.projectId)
    const endpoint = normalizeHindsightEndpoint(input.endpoint)
    const encrypted = input.apiKey === undefined
      ? previous?.endpoint === endpoint && previous.ownerUserId === scope.userId ? previous.encryptedApiKey : null
      : input.apiKey ? await credentialAccess.encrypt(input.apiKey, 'provider') : null
    const status = await (await getHindsightService()).configure(scope, input, encrypted)
    wakeHindsight()
    return status
  }))
  ipcMain.handle(ipcChannels.refreshHindsight, async (_, payload: unknown) => {
    const { projectId } = parseLoadRepositoryKnowledgeInput(payload)
    const status = await (await getHindsightService()).refresh(await hindsightScope(projectId))
    wakeHindsight()
    return status
  })
  ipcMain.handle(ipcChannels.disableHindsight, async (_, payload: unknown) => {
    const { projectId } = parseLoadRepositoryKnowledgeInput(payload)
    const status = await (await getHindsightService()).disable(await hindsightScope(projectId))
    wakeHindsight()
    return status
  })

  ipcMain.handle(ipcChannels.getProjectMemoryStatus, async (_, payload: unknown) =>
    projectMemoryStatus(parseProjectMemoryProjectInput(payload).projectId))
  ipcMain.handle(ipcChannels.configureProjectMemory, async (_, payload: unknown) => writeCredential('provider', async () => {
    const input = parseConfigureProjectMemoryInput(payload)
    const store = await getStore()
    if (!(await store.listProjects()).some((project) => project.id === input.projectId)) throw new Error('本地项目不存在。')
    const previous = await store.getProjectMemoryConfiguration(input.projectId)
    const endpoint = normalizeHindsightEndpoint(input.endpoint)
    const keepKey = (ownerUserId: string) => input.apiKey === undefined
      ? Promise.resolve(previous?.endpoint === endpoint && previous.ownerUserId === ownerUserId ? previous.encryptedApiKey : null)
      : input.apiKey ? credentialAccess.encrypt(input.apiKey, 'provider') : Promise.resolve(null)
    if (!input.enabled && previous) {
      // Turning memory off keeps its owner, pairing and bank, even after the pairing changed.
      const { bankId: _bank, createdAt: _created, updatedAt: _updated, ...kept } = previous
      await store.configureProjectMemory({ ...kept, enabled: false, endpoint, providerId: input.providerId,
        encryptedApiKey: await keepKey(previous.ownerUserId) })
      wakeHindsight()
      return projectMemoryStatus(input.projectId)
    }
    const scope = await resolveProjectMemoryScope(store, input.projectId, 'project-memory')
    if (!scope) throw new Error('无法确定项目记忆属于哪位用户，请先完成项目配对。')
    const pairing = await store.getDesktopPairingCredential()
    const paired = pairing?.localProjectId === input.projectId ? pairing : null
    if (input.enabled) {
      if (!hindsightTransportAvailable) throw new Error('当前构建未启用 Hindsight 传输，无法开启项目记忆。')
      // Hindsight's extraction calls are charged to the paired Team project's model budget.
      if (!paired) throw new Error('项目记忆的模型调用计入团队预算，请先将本地项目配对到团队项目。')
      if (!(await store.listProviderCredentials()).some((item) => item.providerId === input.providerId)) {
        throw new Error('请先在设置中保存所选 Provider 的凭据。')
      }
    }
    await store.configureProjectMemory({
      projectId: input.projectId, ownerUserId: scope.userId,
      ...(paired ? { pairingBinding: projectMemoryPairingBinding(paired) } : {}),
      enabled: input.enabled, endpoint, encryptedApiKey: await keepKey(scope.userId), providerId: input.providerId,
    })
    if (input.enabled) await migrateLegacyMemory(input.projectId)
    wakeHindsight()
    return projectMemoryStatus(input.projectId)
  }))
  ipcMain.handle(ipcChannels.listProjectMemories, async (_, payload: unknown) => listProjectMemories(parseListProjectMemoriesInput(payload)))
  ipcMain.handle(ipcChannels.updateProjectMemory, async (_, payload: unknown) => {
    const input = parseUpdateProjectMemoryInput(payload)
    const { store, configuration, client } = await ownedProjectMemory(input.projectId)
    // Hindsight re-embeds the memory and consolidates again; that consolidation is a model call.
    await client.updateMemory(configuration.bankId, input.memoryId, redactProjectMemoryText(input.text).value)
    await store.markProjectMemoryChanged(input.projectId, input.memoryId)
    await emptyKnowledgePages(client, configuration.bankId)
    return projectMemoryStatus(input.projectId)
  })
  ipcMain.handle(ipcChannels.forgetProjectMemory, async (_, payload: unknown) => {
    const input = parseForgetProjectMemoryInput(payload)
    const { store, configuration, client } = await ownedProjectMemory(input.projectId)
    await client.invalidateMemory(configuration.bankId, input.memoryId, 'deleted by the user in DevFlow')
    await store.markProjectMemoryChanged(input.projectId, input.memoryId)
    await emptyKnowledgePages(client, configuration.bankId)
    return projectMemoryStatus(input.projectId)
  })
  ipcMain.handle(ipcChannels.forgetProjectMemorySource, async (_, payload: unknown) => {
    const input = parseForgetProjectMemorySourceInput(payload)
    const { store, configuration, client } = await ownedProjectMemory(input.projectId)
    await store.forgetProjectMemoryDocument(input.projectId, input.documentId)
    // Emptied again once Hindsight has deleted the document (project-memory-service).
    await emptyKnowledgePages(client, configuration.bankId)
    wakeHindsight()
    return projectMemoryStatus(input.projectId)
  })
  ipcMain.handle(ipcChannels.listProjectKnowledgePages, async (_, payload: unknown) =>
    projectKnowledgePages(parseProjectMemoryProjectInput(payload).projectId))
  ipcMain.handle(ipcChannels.refreshProjectKnowledgePage, async (_, payload: unknown) => {
    const input = parseRefreshProjectKnowledgePageInput(payload)
    const { configuration, client } = await ownedProjectMemory(input.projectId)
    // A refresh is a model call routed through the relay and charged to the Team budget.
    if (!memoryRelay) throw new Error('记忆模型中继未运行，无法刷新知识页。')
    await client.refreshMentalModel(configuration.bankId, knowledgePageModelId(input.pageId))
    return projectKnowledgePages(input.projectId)
  })
  ipcMain.handle(ipcChannels.clearProjectMemory, async (_, payload: unknown) => {
    const input = parseClearProjectMemoryInput(payload)
    const { store } = await ownedProjectMemory(input.projectId)
    await store.clearProjectMemory(input.projectId)
    wakeHindsight()
    return projectMemoryStatus(input.projectId)
  })

  ipcMain.handle(ipcChannels.retryRemoteSyncOperation, async (_, payload: unknown) => {
    const input = parseRetryRemoteSyncOperationInput(payload)
    const store = await getStore()
    const result = await store.retryRemoteSyncOperation({
      id: input.operationId,
      updatedAt: new Date().toISOString(),
    })
    if (!result.retried) {
      throw new Error(
        result.reason === 'not_found'
          ? 'Remote sync operation was not found.'
          : 'Only a terminal remote sync operation can be retried.',
      )
    }
    wakeRemoteSyncOutbox()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.loadDesktopPairing, async () => {
    const store = await getStore()
    return store.getDesktopPairingCredential()
  })

  ipcMain.handle(ipcChannels.pairDesktop, async (_, payload: unknown) => writeCredential('team', async () => {
    const input = parsePairDesktopInput(payload)
    await findProject(input.localProjectId)
    const exchangeResult = await createRemoteSyncClient({ signal: AbortSignal.timeout(30_000) }, input.localProjectId).exchangeDesktopPairingCode({ code: input.code })
    const { token, ...credential } = exchangeResult
    const boundCredential = {
      ...credential,
      localProjectId: input.localProjectId,
    }
    const encryptedToken = await credentialAccess.encrypt(token, 'team')
    githubDeliveryOperationAbortController?.abort()
    await runGitHubDeliveryExclusive(async () => {
      await findProject(input.localProjectId)
      const store = await getStore()
      await store.saveDesktopPairingCredential(boundCredential, encryptedToken)
      resetRemoteSyncClient()
      const retryAt = new Date().toISOString()
      for (const operation of await store.listRemoteSyncOperations()) {
        if (
          operation.localProjectId === input.localProjectId &&
          operation.organizationId === null &&
          operation.teamProjectId === null &&
          operation.status === 'terminal' &&
          operation.lastErrorCode === 'pairing_required'
        ) {
          await store.retryRemoteSyncOperation({ id: operation.id, updatedAt: retryAt })
        }
      }
    })
    wakeRemoteSyncOutbox()
    wakeGateCommandScheduler()
    wakeGitHubDeliveryScheduler()
    void autoEnableProjectMemory(input.localProjectId).catch(() => {
      console.warn('[project-memory] Could not turn on memory for the newly paired project.')
    })
    return { credential: boundCredential }
  }))

  ipcMain.handle(ipcChannels.loadRemoteSnapshot, async (_, payload: unknown) => {
    const input = parseRemoteSnapshotInput(payload)
    const snapshot = await (await getRemoteSyncClient()).loadRemoteSnapshot(input)
    await cacheRemotePolicySnapshots(snapshot)
    return snapshot
  })

  ipcMain.handle(ipcChannels.listWorkRequests, async (_, payload: unknown) => {
    const input = parseListWorkRequestsInput(payload)
    return desktopWorkRequestService.list(input)
  })

  ipcMain.handle(
    ipcChannels.materializeWorkRequest,
    async (_, payload: unknown) => {
      const input = parseMaterializeWorkRequestInput(payload)
      try {
        return await desktopWorkRequestService.materialize(input)
      } finally {
        wakeRemoteSyncOutbox()
        wakeGateCommandScheduler()
        wakeGitHubDeliveryScheduler()
      }
    },
  )

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

  ipcMain.handle(ipcChannels.getTestEvidenceFreshness, async (_, payload: unknown) => {
    const input = parseTestEvidenceFreshnessInput(payload)
    const store = await getStore()
    const run = await store.getRun(input.runId)
    if (!run) throw new Error(`Run not found: ${input.runId}`)
    const project = await findProject(run.projectId)
    return evaluateTestEvidenceFreshness({
      evidence: await store.listTestEvidence(run.id),
      projectId: project.id,
      projectPath: project.path,
      workspaces: await store.listManagedCodingWorkspaces(project.id),
    })
  })

  ipcMain.handle(ipcChannels.runProjectTests, async (_, payload: unknown) => {
    const input = parseRunProjectTestsInput(payload)
    const store = await getStore()
    const project = await findProject(input.projectId)
    const run = await store.getRun(input.runId)
    if (!run) {
      throw new Error(`Run not found: ${input.runId}`)
    }
    let testKnowledge: Awaited<ReturnType<typeof prepareRetrievedKnowledge>>
    return runWorkflowTestCommand({
      project,
      run,
      nodeId: input.nodeId,
      store,
      workspaceCoordinator: workspaceOperationCoordinator,
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      prepareKnowledge: async () => {
        const actor = resolveTrustedWorkflowActor(run, await store.getDesktopPairingCredential())
        testKnowledge = await prepareRetrievedKnowledge({
          projectId: run.projectId, userId: actor.userId, stage: 'test',
          query: [run.request, '测试 验收 边界条件', project.testCommand].join('\n'),
        })
      },
      assertKnowledgeCurrent: async () => { if (testKnowledge) await assertRetrievedKnowledgeCurrent(testKnowledge.manifest) },
      complete: async ({ command, cwd, result, sourceTree }) => {
        const createdAt = new Date().toISOString()
        const evidence: TestEvidence = redactTestEvidenceForStorage({
          id: `evidence-${randomUUID()}`,
          runId: input.runId,
          nodeId: input.nodeId,
          projectId: project.id,
          command,
          cwd,
          status: result.status,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
          summary: result.summary,
          redacted: result.redacted,
          ...(sourceTree ? { sourceTree } : {}),
          ...(testKnowledge ? { knowledgeContext: { retrievedKnowledge: testKnowledge.manifest } } : {}),
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
            nodeId: input.nodeId,
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
        wakeRemoteSyncOutbox()

        return {
          evidence,
          state: await store.loadState(),
        }
      },
    })
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
    const store = await getStore()
    const trustedCreator = await hindsightScope(input.projectId)
    const created = createWorkflowRunFromRequest({
      ...input,
      creatorId: trustedCreator.userId,
      runId: `run-${randomUUID()}`,
      now: new Date().toISOString(),
    })
    const result = await store.createWorkflow({
      run: created.run,
      artifacts: created.artifacts,
      events: created.events,
    })
    if (!result.created) {
      throw new Error(`Run already exists: ${created.run.id}`)
    }
    wakeRemoteSyncOutbox()
    return created.run
  })

  ipcMain.handle(ipcChannels.startAgentRuntime, async (_, payload: unknown) => {
    const input = parseStartAgentRuntimeInput(payload)
    const runtimeSnapshot = await (await getDesktopAgentRuntime()).start(input)
    const snapshot = createAgentRuntimeRendererSnapshot(runtimeSnapshot)
    broadcastToRenderers(ipcChannels.agentRuntimeUpdated, snapshot)
    return snapshot
  })

  ipcMain.handle(ipcChannels.advanceAgentRuntime, async (_, payload: unknown) => {
    const input = parseAdvanceAgentRuntimeInput(payload)
    const runtimeSnapshot = await (await getDesktopAgentRuntime()).advance(input)
    const snapshot = createAgentRuntimeRendererSnapshot(runtimeSnapshot)
    broadcastToRenderers(ipcChannels.agentRuntimeUpdated, snapshot)
    return snapshot
  })

  ipcMain.handle(ipcChannels.cancelAgentRuntime, async (_, payload: unknown) => {
    const input = parseCancelAgentRuntimeInput(payload)
    const runtimeSnapshot = await (await getDesktopAgentRuntime()).cancel(input)
    const snapshot = createAgentRuntimeRendererSnapshot(runtimeSnapshot)
    broadcastToRenderers(ipcChannels.agentRuntimeUpdated, snapshot)
    return snapshot
  })

  ipcMain.handle(ipcChannels.listAgentRuntimes, async (_, payload: unknown) => {
    const input = parseListAgentRuntimesInput(payload)
    const store = await getStore()
    return createAgentRuntimeRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.getAgentRuntime, async (_, payload: unknown) => {
    const input = parseGetAgentRuntimeInput(payload)
    const store = await getStore()
    return createAgentRuntimeRendererAccess(store).get(input)
  })

  ipcMain.handle(ipcChannels.listCoordinationSessions, async (_, payload: unknown) => {
    const input = parseListCoordinationSessionsInput(payload)
    const store = await getStore()
    return createAgentCoordinationRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.getCoordinationSession, async (_, payload: unknown) => {
    const input = parseGetCoordinationSessionInput(payload)
    const store = await getStore()
    return createAgentCoordinationRendererAccess(store).get(input)
  })

  ipcMain.handle(ipcChannels.startCoordinationPlan, async (_, payload: unknown) => {
    const input = parseStartCoordinationPlanInput(payload)
    const store = await getStore()
    const commands = createAgentCoordinationCommands({
      access: createAgentCoordinationRendererAccess(store),
      planner: createBoundedAgentCoordinationPlan({ store }),
      coordinator: createSpecialistRuntimeCoordinator({
        store,
        authorityBroker: createSpecialistTaskAuthorityBroker({ store }),
      }),
    })
    return commands.startPlan(input)
  })

  ipcMain.handle(ipcChannels.resumeCoordinationSession, async (_, payload: unknown) => {
    const input = parseResumeCoordinationSessionInput(payload)
    const store = await getStore()
    const commands = createAgentCoordinationCommands({
      access: createAgentCoordinationRendererAccess(store),
      planner: createBoundedAgentCoordinationPlan({ store }),
      coordinator: createSpecialistRuntimeCoordinator({
        store,
        authorityBroker: createSpecialistTaskAuthorityBroker({ store }),
      }),
    })
    return commands.resume(input)
  })

  ipcMain.handle(ipcChannels.startCoordinationTask, async (_, payload: unknown) => {
    const input = parseStartCoordinationTaskInput(payload)
    const store = await getStore()
    const commands = createAgentCoordinationCommands({
      access: createAgentCoordinationRendererAccess(store),
      planner: createBoundedAgentCoordinationPlan({ store }),
      coordinator: createSpecialistRuntimeCoordinator({
        store,
        authorityBroker: createSpecialistTaskAuthorityBroker({ store }),
      }),
    })
    return commands.startTask(input)
  })

  ipcMain.handle(ipcChannels.cancelCoordinationSession, async (_, payload: unknown) => {
    const input = parseCancelCoordinationSessionInput(payload)
    const store = await getStore()
    const commands = createAgentCoordinationCommands({
      access: createAgentCoordinationRendererAccess(store),
      planner: createBoundedAgentCoordinationPlan({ store }),
      coordinator: createSpecialistRuntimeCoordinator({
        store,
        authorityBroker: createSpecialistTaskAuthorityBroker({ store }),
      }),
    })
    return commands.cancel(input)
  })

  ipcMain.handle(ipcChannels.listAgentMemoryLifecycle, async (_, payload: unknown) => {
    const input = parseListAgentMemoryLifecycleInput(payload)
    const store = await getStore()
    return createAgentMemoryRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.promoteAgentMemoryCandidate, async (_, payload: unknown) => {
    const input = parsePromoteAgentMemoryCandidateInput(payload)
    const store = await getStore()
    await createAgentMemoryHumanActions({ store }).promote(input)
    return createAgentMemoryRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.dismissAgentMemoryCandidate, async (_, payload: unknown) => {
    const input = parseDismissAgentMemoryCandidateInput(payload)
    const store = await getStore()
    await createAgentMemoryHumanActions({ store }).dismiss(input)
    return createAgentMemoryRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.reviseAgentMemory, async (_, payload: unknown) => {
    const input = parseReviseAgentMemoryInput(payload)
    const store = await getStore()
    await createAgentMemoryHumanActions({ store }).revise(input)
    return createAgentMemoryRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.deleteAgentMemory, async (_, payload: unknown) => {
    const input = parseDeleteAgentMemoryInput(payload)
    const store = await getStore()
    await createAgentMemoryHumanActions({ store }).delete(input)
    return createAgentMemoryRendererAccess(store).list(input)
  })

  ipcMain.handle(ipcChannels.deleteRun, async (_, payload: unknown) => {
    const input = parseDeleteRunInput(payload)
    const store = await getStore()
    const localRun = (await store.listRuns()).find((candidate) => candidate.id === input.runId)

    if (!localRun && !input.deleteRemote) {
      throw new Error(`Run not found: ${input.runId}`)
    }

    await assertNoActiveCodingAgentForRun(store, input.runId)
    await assertNoGitHubDeliveryIntentForRun(store, input.runId)

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

  ipcMain.handle(ipcChannels.cancelWorkflowAgentNode, (_, payload: unknown) => {
    const input = parseCancelWorkflowAgentNodeInput(payload)
    return stageAgentOperations.cancel(input.runId, input.nodeId)
  })

  ipcMain.handle(ipcChannels.completeWorkflowAgentNode, async (_, payload: unknown) => {
    const input = parseCompleteWorkflowAgentNodeInput(payload)
    return stageAgentOperations.run(input.runId, input.nodeId, async (signal) => {
      const store = await getStore()
      const run = (await store.listRuns()).find((candidate) => candidate.id === input.runId)
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`)
      }
      const executorKind = input.executor ?? 'direct-provider'
      const stageConfiguration = executorKind === 'local-agent' && !input.providerId
        ? await store.getCodingRuntimeConfiguration(run.projectId)
        : null
      return providerOperations.use(stageConfiguration?.providerId ?? input.providerId, `Stage ${input.runId}`, async () => {
        let node = run.nodes.find((candidate) => candidate.id === input.nodeId)
        if (!node) {
          throw new Error(`Run node not found: ${input.nodeId}`)
        }
        if (!input.designRevision && (
          run.currentNodeId !== node.id ||
          node.kind !== 'agent' ||
          (node.stage !== 'clarify' && node.stage !== 'design') ||
          node.status !== 'running'
        )) {
          throw new Error('Only the current running clarification or design Agent node can execute')
        }
        const [artifacts, events] = await Promise.all([
          store.listArtifacts(run.id),
          store.listEvents(run.id),
        ])
        if (input.designRevision) {
          node = (await resolveDesignRevisionInput({ run, gateNodeId: input.nodeId, artifacts, request: input.designRevision })).node
        }
        const actor = resolveTrustedWorkflowActor(
          run,
          await store.getDesktopPairingCredential(),
        )
        let provider: Awaited<ReturnType<typeof resolveAgentProvider>> | undefined
        let executor: ReturnType<typeof createReadOnlyLocalStageAgentExecutor> | undefined
        let closeStageRelay: (() => Promise<void>) | undefined
        let activeStageKnowledge: RetrievedKnowledgeManifest | undefined
        if (executorKind === 'direct-provider') {
          if (!input.providerId) {
            throw new Error('Agent provider is not configured. Save Provider Name, Base URL, Model, and API Key before running this agent.')
          }
          provider = await resolveAgentProvider(store, input.providerId, run.projectId)
        } else {
          const project = (await store.listProjects()).find((candidate) => candidate.id === run.projectId)
          if (!project) throw new Error('请选择本地仓库。')
          // New node choices explicitly bind a saved Provider independently of Coding configuration.
          // Keep old clarification clients compatible with their previously confirmed OpenCode profile.
          let configuration = stageConfiguration
          if (input.providerId) {
            const metadata = (await store.listProviderCredentials()).find((item) => item.providerId === input.providerId)
            if (!metadata) throw new Error('请在节点选择已保存的模型 Provider。')
            const discovery = await detectCodingRuntimeEngines({ projectId: project.id })
            const candidate = discovery.candidates.find((item) => item.engine === 'opencode-http' && item.status === 'available')
            if (!candidate?.binaryPath || !candidate.version) throw new Error('未检测到兼容的本机 OpenCode，请先安装并检测。')
            configuration = { version: 1, projectId: project.id, executor: 'opencode-http',
              binaryPath: candidate.binaryPath, detectedVersion: candidate.version,
              providerId: input.providerId, modelId: metadata.model, updatedAt: new Date().toISOString() }
          } else if (node.stage !== 'clarify' || !configuration ||
            configuration.version !== (await store.getCodingRuntimeConfiguration(run.projectId))?.version) {
            throw new Error('请为本节点明确选择 Provider，旧配置已变化或不适用于方案设计。')
          }
          if (!configuration || configuration.executor !== 'opencode-http') {
            throw new Error('请在节点选择 OpenCode 和已保存的 Provider。')
          }
          const binding=await resolveSavedOpencodeProviderBinding({
              providerId: configuration.providerId,
              modelId: configuration.modelId,
              credentialSource: store,
              decryptCredential,
            })
          if (!binding) throw new Error('请先保存项目所选 OpenCode Provider。')
          const budgetProxy=await createGovernedOpencodeProxy({binding,projectId:project.id,governance:await modelCallGovernance(store),
            assertContextCurrent: async () => { if (activeStageKnowledge) await assertRetrievedKnowledgeCurrent(activeStageKnowledge) }})
          closeStageRelay = budgetProxy.close
          const stageExecutor = createReadOnlyLocalStageAgentExecutor({
            projectId: project.id,
            projectPath: project.path,
            binaryPath: configuration.binaryPath,
            providerId: configuration.providerId,
            modelId: configuration.modelId,
            detectedVersion: configuration.detectedVersion,
            processManager: opencodeProcessManager,
            providerBinding:budgetProxy.binding,
            // The relay's loopback address hides the Provider; price usage by the saved binding (#207).
            billingBinding: binding,
            toolCacheDirectory: opencodeToolCacheDirectory(),
            runtimeEnv: buildOpencodeRuntimeEnv({
              baseEnv: process.env,
              apiKeyEnvName: 'OPENCODE_API_KEY',
            }),
          })
          executor = withGovernedStageAgent(stageExecutor, budgetProxy)
        }
        let generated: Awaited<ReturnType<typeof runWorkflowStageAgent>> | undefined
        let revised: Awaited<ReturnType<typeof commitDesignRevision>> | undefined
        // Resident project knowledge (ADR 0025). A failed index never blocks generation.
        const stageKnowledge = await loadTrustedRepositoryKnowledge(run.projectId).catch(() => undefined)
        try {
          const retrievedKnowledge = await prepareRetrievedKnowledge({
            projectId: run.projectId, userId: actor.userId, stage: node.stage,
            query: [run.request, node.title, node.subtitle].join('\n'), signal,
          })
          // ADR 0024: scoped Memory as low-trust background, recalled fresh for every call.
          // Memory is optional: a recall failure generates without it instead of failing the stage.
          const recalledAt = new Date().toISOString()
          const stageRuntimeKey = codingPromptDigest(`${run.id}\n${node.id}`).slice(0, 32)
          const stageMemory = await recallScopedMemory({
            store, projectId: run.projectId, userId: actor.userId,
            runtimeId: `agent-runtime-stage-${stageRuntimeKey}`,
            requestId: `stage-memory-${codingPromptDigest(`${stageRuntimeKey}\n${recalledAt}`).slice(0, 32)}`,
            query: [run.request, node.title, node.subtitle].join('\n'),
            now: recalledAt, budget: STAGE_AGENT_MEMORY_RECALL_BUDGET,
          }).catch(() => {
            console.warn('[stage-agent] Memory recall failed; generating without recalled Memory.')
            return { context: [] as Array<{ id: string; revision: number; statement: string }> }
          })
          generated = await runWorkflowStageAgent({
            run,
            node,
            artifacts,
            ...(retrievedKnowledge ? { retrievedKnowledge,
              assertRetrievedKnowledgeCurrent: async (manifest: RetrievedKnowledgeManifest) => {
                await assertRetrievedKnowledgeCurrent(manifest)
                activeStageKnowledge = manifest
              },
            } : {}),
            ...(input.designRevision ? { designRevision: input.designRevision } : {}),
            ...(stageKnowledge ? { knowledge: {
              documents: stageKnowledge.documents,
              knowledgeRoot: stageKnowledge.knowledgeRoot ?? null,
              projectInstructions: stageKnowledge.projectInstructions ?? null,
            } } : {}),
            ...(provider ? { provider } : {}),
            ...(executor ? { executor } : {}),
            requestedBy: actor.userId,
            runtime: 'electron',
            signal,
            ...(stageMemory.context.length ? { memoryContext: stageMemory.context } : {}),
          })
          signal.throwIfAborted()
          const usedKnowledge = generated.provenance.knowledgeContext?.retrievedKnowledge
          if (usedKnowledge) await assertRetrievedKnowledgeCurrent(usedKnowledge)
          if (input.designRevision) {
            revised = await commitDesignRevision({ store, run, gateNodeId: input.nodeId,
              request: input.designRevision, generated, actor, beforeCommit: () => {
                signal.throwIfAborted()
                stageAgentOperations.seal(run.id, input.nodeId)
              } })
          }
          if (!revised && generated.artifact.designEvidence) {
            const currentRun = await store.getRun(run.id)
            if (!currentRun) throw new Error('Run 已不存在。')
            const currentInput = await resolveDesignClarificationInput(currentRun, await store.listArtifacts(run.id))
            if (JSON.stringify(currentInput.binding) !== JSON.stringify(generated.artifact.designEvidence.clarification)) {
              throw new Error('需求审批依据已变化，请重新生成方案设计。')
            }
          }
          if (!revised) stageAgentOperations.seal(run.id, node.id)
        } catch (error) {
          // Shared input/context validation can fail before execute() starts. Close that relay too.
          try { await closeStageRelay?.() } catch { error = withCleanupFailure(error, 'relay_close') }
          try {
            return await recordStageAgentFailure({
              store, run, nodeId: input.nodeId, executorKind, completedAt: new Date().toISOString(),
              sequence: events.length + 1, error: generated?.tokenUsage ? new StageAgentExecutionError(
                error instanceof StageAgentExecutionError ? error.terminalReason : 'evidence_invalid',
                error instanceof Error ? error.message : '阶段完成校验失败。', generated.tokenUsage,
                error instanceof StageAgentExecutionError ? error.reportedUsage : undefined,
                error instanceof StageAgentExecutionError ? error.failureDetails : undefined,
              ) : error,
            })
          } finally { wakeRemoteSyncOutbox() }
        }
        if (revised) {
          wakeRemoteSyncOutbox()
          return { ...revised, state: await store.loadState() }
        }
        const completedAt = generated.artifact.updatedAt
        const event: AgentEvent = {
          id: `event-${generated.artifact.id}`,
          runId: run.id,
          nodeId: node.id,
          sequence: events.length + 1,
          kind: 'thinking',
          message: `${actor.userName} generated ${generated.artifact.title}. Source: ${generated.source === 'local_agent' ? 'read-only local Agent' : generated.source === 'model' ? 'model generated' : 'fake/template'} · ${generated.providerId} · ${generated.model}.`,
          timestamp: completedAt,
          ...(generated.artifact.clarificationRevision
            ? {
                clarificationAudit: {
                  version: 1 as const,
                  action: 'revision_generated' as const,
                  artifactId: generated.artifact.id,
                  revision: generated.artifact.clarificationRevision.revision,
                  revisionDigest: generated.artifact.clarificationRevision.revisionDigest,
                  actorId: actor.userId,
                },
              }
            : {}),
        }
        const superseded = generated.artifact.kind === 'clarification'
          ? markClarificationRevisionsSuperseded(artifacts, generated.artifact.id)
              .filter((artifact, index) => artifact !== artifacts[index])
          : []
        const completed = await executeWorkflowCommandOrThrow(store, {
          runId: run.id,
          expectedRunUpdatedAt: run.updatedAt,
          command: {
            type: 'complete_agent',
            nodeId: node.id,
            artifactId: generated.artifact.id,
          },
          candidates: {
            artifacts: [...superseded, generated.artifact],
            events: [event],
            agentTraces: [generated.trace],
            ...(generated.tokenUsage ? { agentTokenUsage: [generated.tokenUsage] } : {}),
          },
          now: completedAt,
        })
        wakeRemoteSyncOutbox()

        return {
          run: completed.run,
          artifact: generated.artifact,
          event,
          state: await store.loadState(),
        }
      })
    })
  })

  ipcMain.handle(ipcChannels.requestClarificationChanges, async (_, payload: unknown) => {
    const input = parseRequestClarificationChangesInput(payload)
    const store = await getStore()
    const run = await store.getRun(input.runId)
    if (!run) throw new Error(`Run not found: ${input.runId}`)
    const actor = resolveTrustedWorkflowActor(
      run,
      await store.getDesktopPairingCredential(),
    )
    const [artifacts, events] = await Promise.all([
      store.listArtifacts(run.id),
      store.listEvents(run.id),
    ])
    const revision = await requestClarificationChanges({
      run,
      gateNodeId: input.nodeId,
      artifacts,
      existingEvents: events,
      actor: { id: actor.userId, name: actor.userName },
      reason: input.reason,
      expectedArtifactId: input.artifactId,
      expectedRevision: input.revision,
      expectedRevisionDigest: input.revisionDigest,
      now: new Date().toISOString(),
      ...(input.proposals ? { proposals: input.proposals } : {}),
    })
    const committed = await store.commitWorkflowMutation({
      expectedRun: run,
      run: revision.run,
      artifacts: [revision.updatedRevision, revision.feedbackArtifact],
      events: [revision.event],
    })
    if (!committed.committed) {
      throw new Error(committed.reason === 'stale_run'
        ? 'The clarification changed before feedback could be committed'
        : `Run not found: ${run.id}`)
    }
    wakeRemoteSyncOutbox()
    return {
      run: revision.run,
      revision: revision.updatedRevision,
      feedback: revision.feedbackArtifact,
      event: revision.event,
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
      managedWorkspaces,
      existingEvents,
      enforcement,
    ] = await Promise.all([
      loadDeliveryProjectReference(store, run.projectId),
      store.listArtifacts(run.id),
      store.listCodingDiffArtifacts(run.id),
      store.listTestEvidence(run.id),
      store.listAgentReviews(run.id),
      store.listCodingAgentRuns(run.id),
      store.listManagedCodingWorkspaces(run.projectId),
      store.listEvents(run.id),
      evaluateLocalGateEnforcement({ runId: run.id, nodeId: node.id }),
    ])
    const deliverySources = codingRuns.flatMap((codingRun) => {
      if (
        codingRun.status !== 'completed' ||
        !codingRun.completedAt ||
        !codingRun.managedWorkspaceId ||
        !codingRun.diffArtifactId ||
        !codingRun.testEvidenceId
      ) {
        return []
      }
      const buildNode = run.nodes.find((candidate) => candidate.id === codingRun.nodeId)
      const workspace = managedWorkspaces.find(
        (candidate) => candidate.id === codingRun.managedWorkspaceId,
      )
      const diff = codingDiffs.find((candidate) => candidate.id === codingRun.diffArtifactId)
      const test = testEvidence.find((candidate) => candidate.id === codingRun.testEvidenceId)
      if (
        !buildNode ||
        buildNode.kind !== 'task' ||
        buildNode.stage !== 'build' ||
        buildNode.status !== 'success' ||
        !workspace ||
        workspace.cleanupStatus !== 'active' ||
        workspace.deletedAt ||
        workspace.codingRunId !== codingRun.id ||
        workspace.projectId !== run.projectId ||
        !diff ||
        !diff.sourceDigest ||
        diff.truncated ||
        diff.runId !== run.id ||
        diff.nodeId !== codingRun.nodeId ||
        diff.projectId !== run.projectId ||
        !test ||
        test.runId !== run.id ||
        test.nodeId !== codingRun.nodeId ||
        test.projectId !== run.projectId
      ) {
        return []
      }
      return [{ codingRun, workspace, diff, test }]
    })
    if (deliverySources.length !== 1) {
      throw new Error('PR Delivery Package requires exactly one complete managed coding source')
    }
    const deliverySource = deliverySources[0]
    if (!deliverySource) {
      throw new Error('PR Delivery Package source resolution failed')
    }
    const {
      codingRun: deliveryCodingRun,
      workspace: deliveryWorkspace,
      diff: deliveryDiff,
      test: deliveryTest,
    } = deliverySource
    const deliveryDiffSourceDigest = deliveryDiff.sourceDigest
    if (!deliveryDiffSourceDigest) {
      throw new Error('PR Delivery Package source is missing its reviewed diff digest')
    }
    const timestamp = new Date().toISOString()
    const artifact = createPrDraftArtifact({
      run,
      project,
      artifacts,
      codingDiffs,
      testEvidence,
      deliverySource: {
        stateVersion: 1,
        codingRunId: deliveryCodingRun.id,
        workspaceId: deliveryWorkspace.id,
        diffArtifactId: deliveryDiff.id,
        diffSourceDigest: deliveryDiffSourceDigest,
        testEvidenceId: deliveryTest.id,
        headBranch: deliveryWorkspace.branchName,
      },
      agentReviewSummaries: agentReviews.map((review) => review.summary),
      enforcement: enforcement.decision,
      ...(deliveryCodingRun.budgetDecision
        ? { budgetDecision: deliveryCodingRun.budgetDecision }
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
    const attached = await executeWorkflowCommandOrThrow(store, {
      runId: run.id,
      expectedRunUpdatedAt: run.updatedAt,
      command: {
        type: 'attach_pr_package',
        nodeId: node.id,
        artifactId: artifact.id,
      },
      candidates: {
        artifacts: [artifact],
        events: [event],
      },
      now: timestamp,
    })
    wakeRemoteSyncOutbox()

    return {
      run: attached.run,
      artifact,
      event,
      state: await store.loadState(),
    }
  })

  ipcMain.handle(ipcChannels.prepareGitHubDelivery, async (_, payload: unknown) => {
    const input = parsePrepareGitHubDeliveryInput(payload)
    const result = await prepareGitHubDelivery(input)
    wakeRemoteSyncOutbox()
    wakeGitHubDeliveryScheduler()
    return result
  })

  ipcMain.handle(ipcChannels.reviseGitHubDelivery, async (_, payload: unknown) => {
    const input = parseReviseGitHubDeliveryInput(payload)
    const result = await replaceGitHubDelivery('revise', input)
    wakeRemoteSyncOutbox()
    wakeGitHubDeliveryScheduler()
    return result
  })

  ipcMain.handle(ipcChannels.retryGitHubDelivery, async (_, payload: unknown) => {
    const input = parseRetryGitHubDeliveryInput(payload)
    const result = await replaceGitHubDelivery('retry', input)
    wakeRemoteSyncOutbox()
    wakeGitHubDeliveryScheduler()
    return result
  })

  ipcMain.handle(ipcChannels.resumeGitHubDelivery, async (_, payload: unknown) => {
    const input = parseResumeGitHubDeliveryInput(payload)
    return resumeGitHubDelivery(input)
  })

  ipcMain.handle(ipcChannels.stopGitHubDelivery, async (_, payload: unknown) => {
    const input = parseStopGitHubDeliveryInput(payload)
    return stopCurrentGitHubDelivery(input)
  })

  ipcMain.handle(
    ipcChannels.verifyGitHubDeliveryRevocation,
    async (_, payload: unknown) => {
      const input = parseVerifyGitHubDeliveryRevocationInput(payload)
      return verifyCurrentGitHubDeliveryRevocation(input)
    },
  )

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
      deliveries,
      stageTraces,
    ] = await Promise.all([
      store.listArtifacts(run.id),
      store.listCodingDiffArtifacts(run.id),
      store.listTestEvidence(run.id),
      store.listAgentReviews(run.id),
      store.listCodingAgentRuns(run.id),
      store.listEvents(run.id),
      evaluateLocalGateEnforcement({ runId: run.id, nodeId: node.id }),
      store.listGitHubDeliveryIntents(run.id),
      store.listAgentTraces(run.id),
    ])
    const latestCodingRun = [...codingRuns].sort((left, right) =>
      (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    )[0]
    const delivery = deliveries.find((candidate) => candidate.status === 'completed' &&
      candidate.completion?.pullRequestUrl === run.pullRequestUrl)
    const timestamp = new Date().toISOString()
    const artifact = createAcceptanceEvidenceBundleArtifact({
      run,
      artifacts,
      codingDiffs,
      testEvidence,
      agentReviewSummaries: agentReviews.map((review) => review.summary),
      agentExecutionSummaries: [
        ...stageTraces.filter((trace) => trace.executorProvenance?.terminalReason === 'success')
          .map((trace) => `- ${trace.nodeId}: ${trace.executorProvenance!.kind}; ${trace.executorProvenance!.providerId ?? trace.executorProvenance!.executorId}; ${trace.executorProvenance!.model}; completed ${trace.createdAt}; trace=${trace.id}`),
        ...codingRuns.map((coding) => `- ${coding.nodeId}: Coding ${coding.engine}; ${coding.providerId}; ${coding.status}; ${coding.completedAt ?? coding.startedAt}; run=${coding.id}`),
        ...agentReviews.map((review) => `- ${review.nodeId}: Gate Review ${review.providerId}/${review.model}; ${review.createdAt}; review=${review.id}`),
      ],
      ...(delivery ? { delivery } : {}),
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
    wakeRemoteSyncOutbox()

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

    // A design version only belongs to the design-review Gate (plan S4, Z2).
    if (input.expectedDesignRevision && !isDesignReviewGate(node)) {
      throw new Error(unexpectedDesignRevisionMessage)
    }
    const timestamp = new Date().toISOString()
    const [existingEvents, codingRuns, artifacts] = await Promise.all([
      store.listEvents(run.id),
      node.kind === 'acceptance' ? store.listCodingAgentRuns(run.id) : Promise.resolve([]),
      node.kind === 'gate' && (node.stage === 'clarify' || node.stage === 'design') ? store.listArtifacts(run.id) : Promise.resolve([]),
    ])
    // The approver must name the design still linked to the Gate; nothing is written otherwise.
    const approvedDesign = isDesignReviewGate(node)
      ? await requireCurrentDesignRevision({ run, gateNode: node, artifacts, expected: input.expectedDesignRevision })
      : undefined
    let approvedClarification: ReturnType<typeof approveClarificationRevision> | undefined
    if (node.kind === 'gate' && node.stage === 'clarify') {
      const activeRevision = requireCurrentClarificationRevision({
        run,
        gateNode: node,
        artifacts,
        expected: input.expectedClarificationRevision,
      })
      approvedClarification = approveClarificationRevision({
        artifact: activeRevision,
        actorId: actor.userId,
        now: timestamp,
        sequence: existingEvents.length + 1,
        gateNodeId: node.id,
      })
    }
    const genericEvent: AgentEvent = {
      id: `event-approval-${randomUUID()}`,
      runId: run.id,
      nodeId: node.id,
      sequence: existingEvents.length + 1,
      kind: 'approval',
      message: `${actor.userName} Gate approved: ${node.title}`,
      timestamp,
    }
    const event: AgentEvent = approvedClarification?.event ?? (approvedDesign
      ? designApprovalEvent({ base: genericEvent, identity: approvedDesign.identity, actorId: actor.userId })
      : genericEvent)
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
      candidates: {
        events: [event],
        ...(approvedClarification ? { artifacts: [approvedClarification.artifact] } : {}),
      },
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
    wakeRemoteSyncOutbox()

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

  ipcMain.handle(ipcChannels.saveAgentProviderCredential, async (_, payload: unknown) => writeCredential('provider', async () => {
    const input = parseAgentProviderCredentialInput(payload)
    return providerOperations.use(input.providerId, 'Provider configuration', async () => {
      const store = await getStore()
      const providers = listElectronAgentProviderConfigs({
        credentials: await store.listProviderCredentials(),
        fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
      })
      const metadata = createElectronAgentProviderCredentialMetadata({
        name: input.name,
        providers,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        model: input.model,
        ...(input.thinking ? { thinking: input.thinking } : {}),
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        maskedCredential: maskCredential(input.apiKey),
        updatedAt: new Date().toISOString(),
        randomValue: randomUUID(),
      })

      return store.saveProviderCredential(metadata, await encryptCredential(input.apiKey))
    })
  }))

  ipcMain.handle(ipcChannels.inspectAgentProviderRemoval, async (_, payload: unknown) => {
    const { providerId } = parseAgentProviderRemovalInput(payload)
    const check = await (await getStore()).inspectProviderRemoval(providerId)
    return { ...check, references: [...check.references, ...providerOperations.references(providerId)] }
  })

  ipcMain.handle(ipcChannels.updateProviderThinking, async (_, payload: unknown) => writeCredential('provider', async () => {
    const input = parseProviderThinkingInput(payload)
    return providerOperations.use(input.providerId, 'Provider thinking configuration', async () => {
      const metadata = await (await getStore()).updateProviderThinking(input)
      codingExecutorPromises.clear()
      return metadata
    })
  }))

  ipcMain.handle(ipcChannels.removeAgentProviderCredential, async (_, payload: unknown) => writeCredential('provider', async () => {
    const { providerId, expectedUpdatedAt } = parseAgentProviderRemovalInput(payload, true)
    return providerOperations.remove(providerId, async () => {
      const store = await getStore()
      const activeReferences = providerOperations.references(providerId)
      if (activeReferences.length > 0) {
        const check = await store.inspectProviderRemoval(providerId)
        return { status: 'blocked', check: { ...check, references: [...check.references, ...activeReferences] } }
      }
      const result = await store.removeProviderCredential(providerId, expectedUpdatedAt!)
      if (result.status === 'deleted') {
        // Remove cached executors that could retain the deleted credential in memory.
        codingExecutorPromises.clear()
        broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
      }
      return result
    })
  }))

  ipcMain.handle(ipcChannels.listAgentReviews, async (_, payload: unknown) => {
    const input = parseListAgentReviewsInput(payload)
    const store = await getStore()
    return store.listAgentReviews(input.runId)
  })

  ipcMain.handle(ipcChannels.recordAgentReviewFeedback, async (_, payload: unknown) => {
    const store = await getStore()
    const review = await store.recordAgentReviewFeedback(parseAgentReviewFeedbackInput(payload))
    broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
    return review
  })

  ipcMain.handle(ipcChannels.ensureCodingEngine, async (_, payload: unknown) => {
    const input = parseEnsureCodingEngineInput(payload)
    const runtime = await createCodingRuntimeForRequest(undefined, input.projectId)
    return runtime.ensureCodingEngine(input)
  })

  ipcMain.handle(ipcChannels.getCodingRuntimeConfiguration, async (_, payload: unknown) => {
    const input = parseGetCodingRuntimeConfigurationInput(payload)
    return (await getStore()).getCodingRuntimeConfiguration(input.projectId)
  })

  ipcMain.handle(ipcChannels.saveCodingRuntimeConfiguration, async (_, payload: unknown) => {
    const input = parseSaveCodingRuntimeConfigurationInput(payload)
    return providerOperations.use(input.providerId, `Coding configuration ${input.projectId}`, async () => {
      const store = await getStore()
      await findProject(input.projectId)
      const current = await store.getCodingRuntimeConfiguration(input.projectId)
      let trustedOpencodeCandidate: { binaryPath: string; version: string } | undefined
      if (input.executor === 'native-model') {
        const [metadata, encryptedSecret] = await Promise.all([
          store.listProviderCredentials().then((credentials) =>
            credentials.find((candidate) => candidate.providerId === input.providerId),
          ),
          store.getProviderEncryptedSecret(input.providerId),
        ])
        if (!metadata || !encryptedSecret) {
          throw new Error(`Coding Provider credential is unavailable: ${input.providerId}`)
        }
      } else {
        const discovery = await detectCodingRuntimeEngines({ projectId: input.projectId })
        const candidate = discovery.candidates[0]
        if (
          candidate?.status !== 'available' ||
          candidate.binaryPath !== input.binaryPath ||
          candidate.version !== input.detectedVersion
        ) {
          throw new Error('OpenCode confirmation is stale; detect the local engine again')
        }
        trustedOpencodeCandidate = {
          binaryPath: candidate.binaryPath,
          version: candidate.version,
        }
      }
      await opencodeProcessManager.stopProject(input.projectId)
      const commonConfiguration = {
        projectId: input.projectId,
        providerId: input.providerId,
        version: (current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }
      const configuration = await store.saveCodingRuntimeConfiguration(
        input.executor === 'native-model'
          ? { ...commonConfiguration, executor: 'native-model' }
          : {
              ...commonConfiguration,
              executor: 'opencode-http',
              binaryPath: trustedOpencodeCandidate!.binaryPath,
              modelId: input.modelId,
              detectedVersion: trustedOpencodeCandidate!.version,
            },
      )
      for (const key of codingExecutorPromises.keys()) {
        if (key.startsWith(`${input.projectId}:`)) codingExecutorPromises.delete(key)
      }
      return configuration
    })
  })

  ipcMain.handle(ipcChannels.detectCodingRuntimeEngines, async (_, payload: unknown) => {
    const input = parseGetCodingRuntimeConfigurationInput(payload)
    await findProject(input.projectId)
    return detectCodingRuntimeEngines({ projectId: input.projectId })
  })

  ipcMain.handle(ipcChannels.getCodingRuntimeReadiness, async (_, payload: unknown) => {
    const input = await resolveTrustedCodingRequestForMain(
      parseGetCodingRuntimeReadinessInput(payload),
    )
    return getCodingReadiness(input)
  })

  ipcMain.handle(ipcChannels.getCodingChangeSetPreview, async (_, payload: unknown) => {
    const input = parseGetCodingChangeSetPreviewInput(payload)
    const store = await getStore()
    const [changeSet, codingRun, permissionRequests] = await Promise.all([
      store.getCodingChangeSet(input.changeSetId),
      store.listCodingAgentRuns().then((runs) =>
        runs.find((candidate) => candidate.id === input.codingRunId),
      ),
      store.listCodingPermissionRequests(input.codingRunId),
    ])
    const pendingPermission = permissionRequests.find((request) => (
      request.status === 'pending' &&
      request.changeSetId === input.changeSetId &&
      request.codingRunId === input.codingRunId
    ))
    const currentTime = Date.now()
    const permissionExpiry = pendingPermission ? Date.parse(pendingPermission.expiresAt) : Number.NaN
    const changeSetExpiry = changeSet ? Date.parse(changeSet.expiresAt) : Number.NaN
    if (
      !changeSet ||
      !codingRun ||
      !pendingPermission ||
      codingRun.status !== 'waiting_permission' ||
      pendingPermission.runId !== codingRun.runId ||
      pendingPermission.nodeId !== codingRun.nodeId ||
      changeSet.codingRunId !== codingRun.id ||
      codingRun.changeSetId !== changeSet.id ||
      pendingPermission.changeSetDigest !== changeSet.changeSetDigest ||
      !Number.isFinite(permissionExpiry) ||
      !Number.isFinite(changeSetExpiry) ||
      permissionExpiry <= currentTime ||
      changeSetExpiry <= currentTime
    ) {
      throw new Error('Coding Change Set preview is unavailable or stale')
    }
    verifyCodingChangeSetDigest(changeSet)
    return {
      stateVersion: 2 as const,
      id: changeSet.id,
      codingRunId: changeSet.codingRunId,
      phase: changeSet.phase,
      changedPaths: changeSet.changes.map((change) => change.path),
      unifiedDiff: changeSet.unifiedDiff,
      changeSetDigest: changeSet.changeSetDigest,
      createdAt: changeSet.createdAt,
      expiresAt: changeSet.expiresAt,
    }
  })

  ipcMain.handle(ipcChannels.getCodingRuntimeBudgetPolicy, async (_, payload: unknown) => {
    const input = parseGetCodingRuntimeConfigurationInput(payload)
    return (await getProjectBoundRemoteSync()).getRuntimeBudgetPolicy(input.projectId)
  })

  ipcMain.handle(ipcChannels.getModelCostRecovery, async (_, payload: unknown) => {
    const input = parseGetCodingRuntimeConfigurationInput(payload)
    const { recovery } = await desktopModelCostRecovery(await getStore())
    return recovery.load(input.projectId)
  })
  ipcMain.handle(ipcChannels.retryModelCostSettlements, async (_, payload: unknown) => {
    const input = parseGetCodingRuntimeConfigurationInput(payload)
    const { recovery } = await desktopModelCostRecovery(await getStore())
    return recovery.retry(input.projectId)
  })

  ipcMain.handle(ipcChannels.saveCodingRuntimeBudgetPolicy, async (_, payload: unknown) => {
    const input = parseSaveCodingRuntimeBudgetPolicyInput(payload)
    return (await getProjectBoundRemoteSync()).saveRuntimeBudgetPolicy(input)
  })

  ipcMain.handle(ipcChannels.createCodingRuntimeBudgetApproval, async (_, payload: unknown) => {
    const input = parseCreateCodingRuntimeBudgetApprovalInput(payload)
    const store = await getStore()
    const [configuration, pairing] = await Promise.all([
      store.getCodingRuntimeConfiguration(input.projectId),
      store.getDesktopPairingCredential(),
    ])
    const providerId = input.providerId ?? configuration?.providerId
    if (!providerId || !pairing || pairing.localProjectId !== input.projectId) {
      throw new Error('请先选择模型并完成当前项目的 Team 配对。')
    }
    if (!(await store.listProviderCredentials()).some((provider) => provider.providerId === providerId)) {
      throw new Error('当前项目使用的 Provider 凭据不可用。')
    }
    const approval = await (await getProjectBoundRemoteSync()).createRuntimeBudgetApproval({
      projectId: input.projectId,
      providerId,
      requestedBy: pairing.userId,
      maxAdditionalCostUsd: input.maxAdditionalCostUsd,
      reason: input.reason,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    explicitModelBudgetApprovals.set(`${pairing.tokenId}:${input.projectId}:${providerId}`, approval.id)
    return approval
  })

  ipcMain.handle(ipcChannels.listCodingAgentRuns, async (_, payload: unknown) => {
    const input = parseListCodingAgentRunsInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.listCodingAgentRuns(input)
  })

  ipcMain.handle(ipcChannels.runCodingAgent, async (_, payload: unknown) => {
    const input = await resolveTrustedCodingRequestForMain(parseRunCodingAgentInput(payload))
    const readiness = await getCodingReadiness(input)
    if (readiness.status !== 'ready') {
      const blockers = readiness.checks
        .filter((check) => check.status === 'blocked')
        .map((check) => check.message)
        .join(' ')
      throw new Error(`Coding Runtime is not ready. ${blockers}`)
    }
    const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
    const runtime = await createCodingRuntimeForRequest(knowledgeSnapshot, input.projectId)
    return runtime.runCodingAgent(input)
  })

  ipcMain.handle(ipcChannels.startRetryAttempt, async (_, payload: unknown) => {
    const input = await resolveTrustedCodingRequestForMain(parseStartRetryAttemptInput(payload))
    const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
    const readiness = await getCodingReadiness(input)
    if (readiness.status !== 'ready') {
      throw new Error('Coding Runtime is not ready for this remediation retry.')
    }
    const runtime = await createCodingRuntimeForRequest(knowledgeSnapshot, input.projectId)
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
      projectId: input.projectId,
    }, {
      knowledgeSnapshot,
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
    const store = await getStore()
    const codingRun = (await store.listCodingAgentRuns()).find(
      (candidate) => candidate.id === input.codingRunId,
    )
    const runtime = await createCodingRuntimeForRequest(undefined, codingRun?.projectId)
    return runtime.cancelCodingAgentRun(input)
  })

  ipcMain.handle(ipcChannels.replyCodingQuestion, async (_, payload: unknown) => {
    const input = parseReplyCodingQuestionInput(payload)
    const store = await getStore()
    const run = (await store.listCodingAgentRuns()).find((candidate) => candidate.id === input.codingRunId)
    if (!run) throw new Error('Coding Agent run is unavailable')
    const trusted = resolveTrustedCodingPermissionReply({
      input: { requestId: input.requestId, codingRunId: run.id, decidedBy: '', decision: 'approved', comment: '' },
      projectId: run.projectId, pairing: await store.getDesktopPairingCredential(),
    })
    const runtime = await createCodingRuntimeForRequest(undefined, run.projectId)
    return runtime.replyCodingQuestion({ ...input, answeredBy: trusted.decidedBy })
  })

  ipcMain.handle(ipcChannels.replyCodingPermission, async (_, payload: unknown) => {
    const input = parseReplyCodingPermissionInput(payload)
    const store = await getStore()
    const codingRun = (await store.listCodingAgentRuns()).find(
      (candidate) => candidate.id === input.codingRunId,
    )
    if (!codingRun) {
      throw new Error('Coding Agent run is unavailable')
    }
    const trustedInput = resolveTrustedCodingPermissionReply({
      input,
      projectId: codingRun.projectId,
      pairing: await store.getDesktopPairingCredential(),
    })
    const runtime = await createCodingRuntimeForRequest(undefined, codingRun.projectId)
    return runtime.replyCodingPermission(trustedInput)
  })

  ipcMain.handle(ipcChannels.codingSessionPermissions, async (_, payload: unknown) => {
    const input = parseSubscribeCodingRunInput(payload)
    const value = payload as Record<string, unknown>
    if (value['revokeId'] !== undefined && (typeof value['revokeId'] !== 'string' || !value['revokeId'].trim())) throw new Error('Invalid grant revocation')
    const store = await getStore()
    const codingRun = (await store.listCodingAgentRuns()).find((entry) => entry.id === input.codingRunId)
    if (!codingRun) throw new Error('Coding Agent run is unavailable')
    const runtime = await createCodingRuntimeForRequest(undefined, codingRun.projectId)
    return runtime.sessionPermissions({ ...input, ...(typeof value['revokeId'] === 'string' ? { revokeId: value['revokeId'] } : {}) })
  })

  ipcMain.handle(ipcChannels.subscribeCodingRun, async (_, payload: unknown) => {
    const input = parseSubscribeCodingRunInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    return runtime.subscribeCodingRun(input)
  })

  ipcMain.handle(ipcChannels.renewCodingPermission, async (_, payload: unknown) => {
    const input = parseRenewCodingPermissionInput(payload)
    const store = await getStore()
    const codingRun = (await store.listCodingAgentRuns()).find((candidate) => candidate.id === input.codingRunId)
    if (!codingRun) throw new Error('Coding Agent run is unavailable')
    const trusted = resolveTrustedCodingPermissionReply({
      input: { ...input, decision: 'expired', comment: '' },
      projectId: codingRun.projectId,
      pairing: await store.getDesktopPairingCredential(),
    })
    const runtime = await createCodingRuntimeForRequest(undefined, codingRun.projectId)
    return runtime.renewCodingPermission({ ...input, decidedBy: trusted.decidedBy })
  })

  ipcMain.handle(ipcChannels.openManagedWorktree, async (_, payload: unknown) => {
    const input = parseOpenManagedWorktreeInput(payload)
    const runtime = await createCodingRuntimeForRequest()
    const workspace = await runtime.findManagedWorktree(input)
    if (workspace.deletedAt || (workspace.cleanupStatus && workspace.cleanupStatus !== 'active')) {
      throw new Error('Managed worktree is no longer available')
    }
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

  ipcMain.handle(ipcChannels.cancelKnowledgeReview, (_, payload: unknown) => {
    const input = parseCancelWorkflowAgentNodeInput(payload)
    return reviewOperations.cancel(input.runId, input.nodeId)
  })

  ipcMain.handle(ipcChannels.runKnowledgeReview, async (_, payload: unknown) => {
    const input = parseRunKnowledgeReviewInput(payload)
    return reviewOperations.run(input.runId, input.nodeId, (signal) => providerOperations.use(input.providerId, `Review ${input.runId}`, async () => {
      const store = await getStore()
      const run = await store.getRun(input.runId)
      if (!run || run.projectId !== input.projectId) {
        throw new Error('Review request does not match a persisted Workflow run')
      }
      const actor = resolveTrustedWorkflowActor(
        run,
        await store.getDesktopPairingCredential(),
      )
      const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
      const runtime = await createKnowledgeReviewRuntimeForRequest(knowledgeSnapshot, signal, () => reviewOperations.seal(input.runId, input.nodeId), input.projectId, input.runtimeBudgetApprovalId, input.executor)
      try { return await runtime.run({ ...input, requestedBy: actor.userId }) }
      finally { wakeRemoteSyncOutbox(); broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState()) }
    }))
  })
}

function backgroundPollInterval(): number {
  const visible = BrowserWindow.getAllWindows().some((window) => window.isVisible() && !window.isMinimized())
  return visible ? 15_000 : 60_000
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
    resizable: true,
    title: 'AI DevFlow Studio',
    backgroundColor: initialBackgroundColor,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  window.on('focus', () => {
    wakeRemoteSyncOutbox()
    wakeGateCommandScheduler()
    wakeGitHubDeliveryScheduler()
  })

  const rendererEntry = resolveDesktopRendererEntry({
    isPackaged: app.isPackaged,
    developmentServerUrl: process.env['VITE_DEV_SERVER_URL'],
  })

  if (rendererEntry.kind === 'development_url') {
    void window.loadURL(rendererEntry.url)
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

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(async () => {
    const defaultSession = session.defaultSession
    defaultSession.setSpellCheckerDictionaryDownloadURL('data:,')
    defaultSession.setSpellCheckerEnabled(false)
    if (dataProfileResolution.status === 'blocked') {
      const candidateSummary = dataProfileResolution.candidates
        .map((candidate) => `${candidate.name} (${candidate.pathFingerprint})`)
        .join(', ')
      dialog.showErrorBox(
        'Desktop data profile selection required',
        `${dataProfileResolution.message}${candidateSummary ? `\n\nDetected profiles: ${candidateSummary}` : ''}`,
      )
      app.quit()
      return
    }
    try {
      await getStore()
    } catch (error) {
      const failure = classifyDesktopDataProfileOpenError(error)
      console.error('[desktop-data-profile]', { code: failure.code })
      dialog.showErrorBox(failure.title, failure.message)
      app.quit()
      return
    }
    registerIpcHandlers()
    createWindow()
    void startMemoryRelay()
    wakeHindsight()
    hindsightTimer = setInterval(wakeHindsight, 15_000)
    hindsightTimer.unref()
    void getRemoteSyncOutboxScheduler()
      .then((scheduler) => scheduler.start())
      .catch(() => {
        console.warn('[remote-sync-outbox] Unable to start the delivery scheduler.')
      })
    void getGateCommandScheduler()
      .then((scheduler) => scheduler.start())
      .catch(() => {
        console.warn('[gate-command] Unable to start the processing scheduler.')
      })
    void getGitHubDeliveryScheduler()
      .then((scheduler) => scheduler.start())
      .catch(() => {
        console.warn('[github-delivery] Unable to start the recovery scheduler.')
      })
    void getDesktopAgentRuntime()
      .then((runtime) => runtime.recover())
      .then((snapshots) => {
        for (const snapshot of snapshots) {
          broadcastToRenderers(
            ipcChannels.agentRuntimeUpdated,
            createAgentRuntimeRendererSnapshot(snapshot),
          )
        }
      })
      .catch(() => {
        console.warn('[agent-runtime] Unable to recover a durable runtime.')
      })
    void getStore()
      .then(async (store) => {
        const activeProjectIds = [
          ...new Set(
            (await store.listCodingAgentRuns())
              .filter((run) => isActiveCodingAgentRunStatus(run.status))
              .map((run) => run.projectId),
          ),
        ]
        for (const projectId of activeProjectIds) {
          await (await createCodingRuntimeForRequest(undefined, projectId))
            .recoverCodingAgentRuns()
        }
      })
      .catch(() => {
        console.warn('[native-coding] Unable to recover a durable Coding Executor run.')
      })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitCleanupComplete) {
    return
  }
  event.preventDefault()
  hindsightStopping = true
  clearInterval(hindsightTimer)
  githubDeliveryStopping = true
  gateCommandCycleAbortController?.abort()
  gateCommandScheduler?.stop()
  remoteSyncOutboxScheduler?.stop()
  credentialAccess.cancelAll()
  reviewOperations.cancelAll()
  stageAgentOperations.cancelAll()
  githubDeliveryScheduler?.stop()
  githubDeliveryOperationAbortController?.abort()
  quitCleanupPromise ??= Promise.all([
    hindsightCycle ?? Promise.resolve(),
    (projectMemoryService?.then((service) => service.shutdown()) ?? Promise.resolve()).catch(() => {
      console.warn('[project-memory] Unable to stop the memory worker before quit.')
    }),
    (memoryRelay?.close() ?? Promise.resolve()).catch(() => {
      console.warn('[project-memory] Unable to close the memory model relay before quit.')
    }),
    reviewOperations.drain(),
    stageAgentOperations.drain(),
    ...[...codingBudgetProxies].map((proxy)=>proxy.close()),
    (workbenchConversationService?.then((service) => service.shutdown()) ?? Promise.resolve()).catch(() => {
      console.warn('[workbench] Unable to complete conversation cleanup before quit.')
    }),
    (fixtureLocalMcpRuntime?.shutdown() ?? Promise.resolve()).catch(() => {
      console.warn('[local-mcp] Unable to complete fixture MCP cleanup before quit.')
    }),
    stopOpencodeWithRetry(opencodeProcessManager).catch(() => {
      console.warn('[opencode] Unable to complete managed runtime cleanup before quit.')
    }),
    waitForGitHubDeliveryCleanup().catch(() => {
      console.warn('[github-delivery] Unable to confirm operation cleanup before quit.')
    }),
  ])
    .then(() => diagnosticLog.flush())
    .finally(() => {
      quitCleanupComplete = true
      // Let the first native quit callback finish before requesting quit again.
      // A microtask can otherwise re-enter before macOS resets its prevented-quit state.
      setImmediate(() => app.quit())
    })
  void quitCleanupPromise
})
