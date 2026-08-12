import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildRemediationPlan,
  canApproveGateNow,
  canOverrideBlockedGate,
  createAcceptanceEvidenceBundleArtifact,
  createPrDraftArtifact,
  createWorkflowRunFromRequest,
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
  type GateCommand,
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
  parseListWorkRequestsInput,
  parseMcpServersInput,
  parseMaterializeWorkRequestInput,
  parseOpenManagedWorktreeInput,
  parseAgentProviderCredentialInput,
  parsePairDesktopInput,
  parseProjectGitStatusInput,
  parseCreateAcceptanceBundleInput,
  parseCreatePrDraftInput,
  parsePrepareGitHubDeliveryInput,
  parseReviseGitHubDeliveryInput,
  parseRetryGitHubDeliveryInput,
  parseResumeGitHubDeliveryInput,
  parseStopGitHubDeliveryInput,
  parseVerifyGitHubDeliveryRevocationInput,
  parseCreateRunInput,
  parseCompleteWorkflowAgentNodeInput,
  parseListAgentReviewsInput,
  parseReplyCodingPermissionInput,
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
  createRemoteSyncClient,
  resolveRemoteApiBaseUrl,
  type RemoteSyncClient,
} from './remote-sync.js'
import { createDesktopWorkRequestService } from './work-request-service.js'
import { inspectProjectDirectory, runLocalTestCommand } from './test-runner.js'
import { createCodingEngineAdapterFromEnv } from './coding-engine.js'
import { createCodingRuntime } from './coding-runtime.js'
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
import { createManagedWorkspaceCleanupService } from './managed-workspace-cleanup.js'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'
import { createOpencodeProcessManager } from './opencode-process.js'
import { stopOpencodeWithRetry } from './opencode-shutdown.js'
import { runDependencyBootstrap } from './dependency-bootstrap-runner.js'
import {
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
import {
  createKnowledgeReviewRuntimeBudgetGuard,
  createRuntimeBudgetGuard,
} from './runtime-budget-guard.js'
import { createKnowledgeReviewRuntime } from './knowledge-review-runtime.js'
import { createRepositoryKnowledgeCache } from './repository-knowledge-cache.js'
import { createRepositoryKnowledgeResolver } from './repository-knowledge-resolver.js'
import { createRepositoryKnowledgeService } from './repository-knowledge.js'
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
const configuredUserDataDirectory = process.env['DEVFLOW_USER_DATA_DIR']?.trim()
if (configuredUserDataDirectory) {
  app.setPath('userData', path.resolve(configuredUserDataDirectory))
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
  decryptToken: decryptCredential,
  createClient: createRemoteSyncClient,
})
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function getStore() {
  const userDataPath = app.getPath('userData')
  storePromise ??= createLocalStore({
    dbPath: path.join(userDataPath, 'devflow.sqlite'),
  })
  return storePromise
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
          decryptToken: decryptCredential,
        }),
      onStateChanged: async () => {
        broadcastToRenderers(ipcChannels.localStateUpdated, await store.loadState())
      },
    })
    remoteSyncOutboxScheduler = createRemoteSyncOutboxScheduler({
      processor,
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

  const authToken = decryptCredential(bundle.encryptedToken)
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
  }
}

async function createActiveGitHubDeliveryProcessor(
  signal: AbortSignal,
  context: CurrentGitHubDeliveryContext,
) {
  const { store, remote } = context
  const scopedStore = createScopedGitHubDeliveryStore(context)
  const publisher = createGitHubGitPublisher({ signal })
  return createGitHubDeliveryProcessor({
    store: scopedStore,
    remote,
    publisher,
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
  try {
    await runGitHubDeliveryExclusive(async (signal) => {
      const store = await getStore()
      const workflow = createWorkflowRuntime(store)
      await reconcileCompletedGitHubDeliveryIntents({
        store,
        workflow,
      })

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

      const processor = await createActiveGitHubDeliveryProcessor(signal, context)
      await processor.recoverAndAdvance()
    })
  } finally {
    await broadcastGitHubDeliveryState()
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
    overrides,
  ] = await Promise.all([
    loadPolicySnapshotForProject(input.command.projectId),
    input.store.listArtifacts(input.run.id),
    input.store.listCodingAgentRuns(input.run.id),
    input.store.listCodingDiffArtifacts(input.run.id),
    input.store.listTestEvidence(input.run.id),
    input.store.listAgentReviews(input.run.id),
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
    const [evaluation, codingRuns, codingDiffs] = await Promise.all([
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
  const authToken = decryptCredential(bundle.encryptedToken)
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
) {
  const [remoteSync, store] = await Promise.all([
    getProjectBoundRemoteSync(),
    getStore(),
  ])
  return createCodingRuntime({
    store,
    engine: codingEngineAdapter,
    ...(knowledgeSnapshot
      ? {
          knowledgeDocuments: knowledgeSnapshot.documents,
          knowledgeChunks: knowledgeSnapshot.chunks,
        }
      : {}),
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
    cleanupWorkspace: async (input) => (await getManagedWorkspaceCleanup())(input),
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

async function createKnowledgeReviewRuntimeForRequest(
  knowledgeSnapshot: RepositoryKnowledgeSnapshot,
) {
  const [remoteSync, store] = await Promise.all([
    getProjectBoundRemoteSync(),
    getStore(),
  ])
  return createKnowledgeReviewRuntime({
    store,
    knowledgeDocuments: knowledgeSnapshot.documents,
    knowledgeChunks: knowledgeSnapshot.chunks,
    resolveProviderMetadata: (providerId) =>
      resolveElectronAgentProviderMetadata({
        providerId,
        fakeRuntimeEnabled: runtimeFlags.fakeRuntimeEnabled,
        credentialSource: store,
      }),
    resolveProvider: (providerId) => resolveAgentProvider(store, providerId),
    budgetGuard: createKnowledgeReviewRuntimeBudgetGuard(remoteSync),
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

function registerIpcHandlers() {
  ipcMain.handle(ipcChannels.loadState, async () => {
    const store = await getStore()
    return store.loadState()
  })

  ipcMain.handle(ipcChannels.loadRepositoryKnowledge, async (_, payload: unknown) => {
    const input = parseLoadRepositoryKnowledgeInput(payload)
    return loadTrustedRepositoryKnowledge(input.projectId)
  })

  ipcMain.handle(ipcChannels.refreshRepositoryKnowledge, async (_, payload: unknown) => {
    const input = parseRefreshRepositoryKnowledgeInput(payload)
    return loadTrustedRepositoryKnowledge(input.projectId, { refresh: true })
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

  ipcMain.handle(ipcChannels.pairDesktop, async (_, payload: unknown) => {
    const input = parsePairDesktopInput(payload)
    await findProject(input.localProjectId)
    const exchangeResult = await createRemoteSyncClient().exchangeDesktopPairingCode({ code: input.code })
    const { token, ...credential } = exchangeResult
    const boundCredential = {
      ...credential,
      localProjectId: input.localProjectId,
    }
    const encryptedToken = encryptCredential(token)
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
    return { credential: boundCredential }
  })

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
    wakeRemoteSyncOutbox()

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
    wakeRemoteSyncOutbox()
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
    wakeRemoteSyncOutbox()

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
    const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
    const runtime = await createCodingRuntimeForRequest(knowledgeSnapshot)
    return runtime.runCodingAgent(input)
  })

  ipcMain.handle(ipcChannels.startRetryAttempt, async (_, payload: unknown) => {
    const input = parseStartRetryAttemptInput(payload)
    const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
    const runtime = await createCodingRuntimeForRequest(knowledgeSnapshot)
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
    const { knowledgeSnapshot } = await loadTrustedRunKnowledge(input)
    const runtime = await createKnowledgeReviewRuntimeForRequest(knowledgeSnapshot)
    const result = await runtime.run(input)
    wakeRemoteSyncOutbox()
    return result
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
      spellcheck: false,
    },
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

  app.whenReady().then(() => {
    registerIpcHandlers()
    createWindow()
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
  githubDeliveryStopping = true
  gateCommandCycleAbortController?.abort()
  gateCommandScheduler?.stop()
  remoteSyncOutboxScheduler?.stop()
  githubDeliveryScheduler?.stop()
  githubDeliveryOperationAbortController?.abort()
  quitCleanupPromise ??= Promise.all([
    stopOpencodeWithRetry(opencodeProcessManager).catch(() => {
      console.warn('[opencode] Unable to complete managed runtime cleanup before quit.')
    }),
    waitForGitHubDeliveryCleanup().catch(() => {
      console.warn('[github-delivery] Unable to confirm operation cleanup before quit.')
    }),
  ])
    .then(() => undefined)
    .finally(() => {
      quitCleanupComplete = true
      app.quit()
    })
  void quitCleanupPromise
})
