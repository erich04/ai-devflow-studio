import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import {
  parseNativeToolAuditRecord,
  type NativeToolCapabilityGrantRecord,
  type NativeToolAuditRecord,
} from './native-tool-registry.js'
import {
  parseLocalMcpInstallation,
  type LocalMcpInstallation,
} from './local-mcp-installation.js'
import {
  digestSpecialistCapabilitySet,
  deriveSpecialistRecoveryEntityId,
  getAcceptedSpecialistRoleIds,
  resolveSpecialistDescriptor,
  resolveSpecialistToolLeasePolicy,
  SPECIALIST_RUNTIME_MAX_CHECKPOINT_BYTES,
  SPECIALIST_RUNTIME_MAX_TOOL_RESULT_BYTES,
  SPECIALIST_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES,
  type SpecialistToolLeasePolicy,
} from './specialist-runtime-registry.js'
import {
  resolveSpecialistTaskAuthority,
  type SpecialistTaskAuthority,
} from './specialist-task-authority.js'
import {
  activateKnowledgeIndexSnapshot as activateKnowledgeIndexSnapshotInDatabase,
  getCurrentKnowledgeIndexSnapshot as readCurrentKnowledgeIndexSnapshot,
  getCurrentKnowledgeSnapshotIdentitySet as readCurrentKnowledgeSnapshotIdentitySet,
  rebuildKnowledgeIndexSnapshot as rebuildKnowledgeIndexSnapshotInDatabase,
  type ActivateKnowledgeIndexSnapshotInput,
  type ActivateKnowledgeIndexSnapshotResult,
  type KnowledgeIndexSnapshot,
} from './knowledge-index-local-store.js'
export type {
  ActivateKnowledgeIndexSnapshotInput,
  ActivateKnowledgeIndexSnapshotResult,
  KnowledgeIndexChunk,
  KnowledgeIndexEmbedding,
  KnowledgeIndexSnapshot,
  KnowledgeIndexSnapshotInput,
  KnowledgeIndexSnapshotScope,
} from './knowledge-index-local-store.js'
export { KNOWLEDGE_INDEX_CHUNK_COUNT_MAX } from './knowledge-index-local-store.js'
import {
  acceptAgentHandoff,
  acceptCoordinationResourceLease,
  applyWorkflowCommand,
  applyCoordinationHandoff,
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  canApproveGateNow,
  canRunAgentRuntimeOnNode,
  cancelAgentRuntime,
  cancelCoordinationSession,
  createAgentMemoryTombstone,
  createAgentMemoryCandidate,
  createAgentMemoryRendererSnapshot,
  createCoordinationSessionState,
  createGitHubDeliveryCompletion,
  createGitHubDeliveryIntent,
  createRemoteSyncIdempotencyKey,
  createRemoteSyncOperation,
  createWorkflowRunFromRequest,
  isExactAgentRuntimeTransition,
  isActiveCodingAgentRunStatus,
  normalizeGitHubRepository,
  REMOTE_SYNC_CLAIM_LEASE_MS,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  normalizeWorkflowRunProgress,
  parseAgentMemoryCandidate,
  parseAgentRuntimeContextAttachment,
  parseAgentMemoryRetrievalRequest,
  parseAgentMemoryTombstone,
  parseDurableAgentMemoryRevision,
  parseAgentCheckpoint,
  parseAgentRuntimeEvent,
  parseAgentRuntimeState,
  parseAgentRuntimeTransition,
  parseAgentTaskGraph,
  parseCoordinationSessionRequest,
  parseCoordinationSessionState,
  parseCoordinationResourceLease,
  parseSpecialistAllocationRequest,
  recordCoordinationTaskResult,
  retryCoordinationTask,
  parseWorkRequestRecord,
  promoteAgentMemoryCandidate,
  reviseAgentMemoryRevision,
  startCoordinationTask,
  settleCoordinationResourceLease,
  redactCodingAgentEventForStorage,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  validateTestCommandSafety,
  sanitizeRemoteSyncErrorMessage,
  parseGateCommandRecord,
  parseGateCommandAcknowledgementRecord,
  parseGateCommandReceiptRecord,
  type AgentEvent,
  type AgentMemoryCandidate,
  type AgentMemoryDeletionAuthority,
  type AgentMemoryPromotionAuthority,
  type AgentMemoryRetrievalRequest,
  type AgentMemoryRevisionAuthority,
  type AgentMemoryTombstone,
  type CreateRemoteAgentMemorySummaryInput,
  type AgentCheckpoint,
  type AgentRuntimeEvent,
  type AgentRuntimeContextAttachment,
  type AgentRuntimeState,
  type AgentRuntimeStopReason,
  type AgentRuntimeTransition,
  type AgentTaskGraph,
  type AgentTaskResourceRequirement,
  type AgentHandoff,
  type AcceptedSpecialistResult,
  type AgentReviewResult,
  type AgentTrace,
  type AgentTokenUsage,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type CoordinationSessionRequest,
  type CoordinationResourceLease,
  type CoordinationSessionState,
  type CoordinationTaskFailure,
  type CoordinationTaskResult,
  type CoordinationUsageDelta,
  type SpecialistAllocationRequest,
  type SpecialistBudget,
  type DependencyBootstrapEvidence,
  type DesktopPairingCredential,
  type DurableAgentMemoryRevision,
  type LocalExecutionState,
  type LocalProject,
  type KnowledgeRetrievalScope,
  type KnowledgeSnapshotIdentitySet,
  type LocalSettings,
  type ManagedCodingWorkspace,
  type McpServerDefinition,
  type GateOverrideDecision,
  type GateCommand,
  type GateCommandAcknowledgement,
  type GateCommandOutcomeCode,
  type GateCommandReceipt,
  type GateEnforcementDecision,
  type GitHubDeliveryIntent,
  type GitHubDeliveryCompletion,
  type GitHubDeliveryOperatorOutcome,
  type GitHubDeliveryOperatorOutcomeCode,
  type GitHubDeliveryRevocationCheck,
  type GitHubDeliveryStatus,
  type GitHubRepositoryBinding,
  type PolicySnapshot,
  type ProviderCredentialMetadata,
  type RetryAttempt,
  type RemoteSyncFailureCode,
  type RemoteSyncOperation,
  type RemoteSyncRecovery,
  type TestEvidence,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowEvidenceSnapshot,
  type WorkflowRun,
  type WorkRequest,
  AGENT_MEMORY_ACTIVE_REVISIONS_MAX,
} from '@ai-devflow/shared'
export const CURRENT_SCHEMA_VERSION = 28
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = { themePreference: 'system' }

const require = createRequire(import.meta.url)
const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))

let sqlPromise: Promise<SqlJsStatic> | undefined

function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (fileName) => path.join(sqlJsDist, fileName),
  })
  return sqlPromise
}

export type LocalStoreOptions = {
  dbPath: string
}

export type WorkflowMutation = {
  expectedRun: WorkflowRun
  run: WorkflowRun
  artifacts?: readonly Artifact[]
  events?: readonly AgentEvent[]
  testEvidence?: readonly TestEvidence[]
}

export type GitHubDeliveryPreparationMutation = {
  intent: GitHubDeliveryIntent
  expectedProject: LocalProject
  expectedPairingCredential: DesktopPairingCredential
  expectedRepositoryBinding: GitHubRepositoryBinding
  expectedRun: WorkflowRun
  expectedCodingRun: CodingAgentRun
  expectedWorkspace: ManagedCodingWorkspace
  expectedDiffArtifact: CodingDiffArtifact
  testEvidence: TestEvidence
  expectedPrPackage: Artifact
}

export type GitHubDeliveryPreparationMutationResult =
  | {
      committed: true
      replayed: boolean
      intent: GitHubDeliveryIntent
    }
  | {
      committed: false
      reason: 'source_stale' | 'id_conflict' | 'active_intent_exists'
    }

export type GitHubDeliveryReplacementKind = 'revision' | 'retry'

export type GitHubDeliveryReplacementMutation =
  Omit<GitHubDeliveryPreparationMutation, 'intent'> & {
    kind: GitHubDeliveryReplacementKind
    expectedIntent: GitHubDeliveryIntent
    intent: GitHubDeliveryIntent
  }

export type GitHubDeliveryReplacementMutationResult =
  | {
      committed: true
      replayed: boolean
      intent: GitHubDeliveryIntent
    }
  | {
      committed: false
      reason:
        | 'source_stale'
        | 'id_conflict'
        | 'active_intent_exists'
        | 'intent_stale'
        | 'intent_ineligible'
        | 'replacement_invalid'
    }

export type CommitGitHubRepositoryBindingObservationInput = {
  expectedPairing: DesktopPairingCredential
  binding: GitHubRepositoryBinding | null
}

export type CommitGitHubRepositoryBindingObservationResult =
  | {
      committed: true
      replayed: boolean
      binding: GitHubRepositoryBinding | null
    }
  | {
      committed: false
      reason: 'invalid_input' | 'pairing_scope_mismatch' | 'binding_conflict'
    }

export type GitHubDeliveryIntentStatusMutation = {
  expectedIntent: GitHubDeliveryIntent
  intent: GitHubDeliveryIntent
  operatorOutcomeCode?: GitHubDeliveryOperatorOutcomeCode
}

export type GitHubDeliveryIntentStatusMutationResult =
  | {
      committed: true
      replayed: boolean
      intent: GitHubDeliveryIntent
    }
  | {
      committed: false
      reason: 'intent_not_found' | 'source_stale'
    }

export type GitHubDeliveryIntentCompletionMutation = {
  expectedIntent: GitHubDeliveryIntent
  intent: GitHubDeliveryIntent & {
    status: 'completed'
    completion: GitHubDeliveryCompletion
  }
}

export type GitHubDeliveryIntentCompletionMutationResult =
  GitHubDeliveryIntentStatusMutationResult

export type StopGitHubDeliveryIntentInput = {
  intentId: string
  expectedUpdatedAt: string
  updatedAt: string
}

export type StopGitHubDeliveryIntentResult =
  | {
      committed: true
      replayed: boolean
      intent: GitHubDeliveryIntent
      outcome: GitHubDeliveryOperatorOutcome
    }
  | {
      committed: false
      reason: 'intent_not_found' | 'source_stale' | 'intent_terminal'
    }

export type CommitGitHubDeliveryRevocationCheckInput = {
  check: GitHubDeliveryRevocationCheck
  expectedIntent: GitHubDeliveryIntent
  expectedBinding: GitHubRepositoryBinding
  expectedPairing: DesktopPairingCredential
}

export type CommitGitHubDeliveryRevocationCheckResult =
  | {
      committed: true
      replayed: boolean
      check: GitHubDeliveryRevocationCheck
    }
  | {
      committed: false
      reason:
        | 'invalid_input'
        | 'intent_not_found'
        | 'intent_stale'
        | 'intent_ineligible'
        | 'binding_not_found'
        | 'binding_stale'
        | 'binding_ineligible'
        | 'pairing_not_found'
        | 'pairing_stale'
        | 'authority_mismatch'
        | 'check_conflict'
    }

export type ManagedCodingWorkspaceHeadMutation = {
  expectedWorkspace: ManagedCodingWorkspace
  workspace: ManagedCodingWorkspace
}

export type ManagedCodingWorkspaceHeadMutationResult =
  | {
      committed: true
      replayed: boolean
      workspace: ManagedCodingWorkspace
    }
  | {
      committed: false
      reason: 'source_stale'
    }

export type ManagedCodingWorkspaceCleanupMutation = {
  expectedWorkspace: ManagedCodingWorkspace
  workspace: ManagedCodingWorkspace
}

export type ManagedCodingWorkspaceCleanupMutationResult =
  | {
      committed: true
      replayed: boolean
      workspace: ManagedCodingWorkspace
    }
  | {
      committed: false
      reason: 'source_stale' | 'delivery_intent_exists'
    }

export type CodingAgentMutation = {
  expectedRun: CodingAgentRun
  expectedPendingPermissionRequestIds: readonly string[]
  run?: CodingAgentRun
  expectedPermissionRequests?: readonly CodingPermissionRequest[]
  permissionRequests?: readonly CodingPermissionRequest[]
  permissionDecisions?: readonly CodingPermissionDecision[]
  events?: readonly CodingAgentEvent[]
  diffArtifacts?: readonly CodingDiffArtifact[]
}

export type CodingAgentMutationResult =
  | { committed: true; run: CodingAgentRun }
  | {
      committed: false
      reason: 'run_not_found'
      run: null
    }
  | {
      committed: false
      reason: 'stale_run' | 'terminal_run' | 'stale_permission_request' | 'stale_permission_set'
      run: CodingAgentRun
    }

export type ReserveCodingAgentRunResult =
  | { reserved: true; run: CodingAgentRun }
  | {
      reserved: false
      reason: 'active_run_exists' | 'run_id_exists'
      run: CodingAgentRun
    }

export type WorkflowCreation = {
  run: WorkflowRun
  artifacts: readonly Artifact[]
  events: readonly AgentEvent[]
}

export type WorkflowCreationResult =
  | { created: true }
  | { created: false; reason: 'run_exists' }

export type WorkRequestMaterializationExpectedPairing = {
  tokenId: string
  organizationId: string
  projectId: string
  localProjectId: string
}

export type WorkRequestMaterializationBinding = {
  workRequestId: string
  organizationId: string
  teamProjectId: string
  localProjectId: string
  runId: string
  claimVersion: number
  sourceFingerprint: string
  materializeIdempotencyKey: string
  status: 'pending_ack' | 'acknowledged'
  acknowledgedVersion: number | null
  createdAt: string
  updatedAt: string
  acknowledgedAt: string | null
}

export type MaterializeClaimedWorkRequestInput = {
  workRequest: WorkRequest
  creation: WorkflowCreation
  expectedPairing: WorkRequestMaterializationExpectedPairing
  sourceFingerprint: string
  materializeIdempotencyKey: string
}

export type MaterializeClaimedWorkRequestResult = {
  status: 'created' | 'replayed' | 'conflict' | 'pairing_scope_mismatch'
}

export type MarkWorkRequestMaterializationAcknowledgedInput = {
  workRequestId: string
  runId: string
  materializedVersion: number
  acknowledgedAt: string
  expectedPairing: WorkRequestMaterializationExpectedPairing
  sourceFingerprint: string
  materializeIdempotencyKey: string
}

export type MarkWorkRequestMaterializationAcknowledgedResult =
  | { acknowledged: true }
  | {
      acknowledged: false
      reason: 'not_found' | 'conflict' | 'pairing_scope_mismatch'
    }

export type LocalGateCommandExecution = {
  commandId: string
  organizationId: string
  teamProjectId: string
  localProjectId: string
  claimTokenId: string
  workRequestId: string | null
  runId: string
  nodeId: string
  action: GateCommand['action']
  workflowCommand: GateCommand['workflowCommand']
  requestedByUserId: string
  requestedRole: GateCommand['requestedRole']
  serverRequestFingerprint: string
  executionFingerprint: string
  expectedRunVersion: number
  expectedPolicyVersion: number
  expectedBlockerIdsHash: string
  outcomeCode: GateCommandOutcomeCode
  beforeRunVersion: number
  afterRunVersion: number
  evaluatedAt: string
  commandExpiresAt: string
  createdAt: string
}

export type LocalGateCommandReceiptObservation = {
  receiptId: string
  commandId: string
  attempt: number
  leasedAt: string
  leaseExpiresAt: string
  receivedAt: string
  organizationId: string
  teamProjectId: string
  localProjectId: string
  workRequestId: string | null
  runId: string
  nodeId: string
  claimTokenId: string
  executionFingerprint: string
  status: 'received' | 'evaluated'
  outcomeCode: GateCommandOutcomeCode | null
  evaluatedAt: string | null
}

export type RecordGateCommandReceiptObservationInput = {
  command: GateCommand
  receipt: GateCommandReceipt
  expectedPairing: WorkRequestMaterializationExpectedPairing
  receivedAt: string
}

export type RecordGateCommandReceiptObservationResult =
  | {
      recorded: true
      replayed: boolean
      observation: LocalGateCommandReceiptObservation
    }
  | {
      recorded: false
      reason:
        | 'invalid_input'
        | 'pairing_scope_mismatch'
        | 'fingerprint_conflict'
        | 'receipt_conflict'
    }

export type LocalGateCommandAcknowledgement = {
  receiptId: string
  commandId: string
  outcomeCode: GateCommandOutcomeCode
  beforeRunVersion: number
  afterRunVersion: number
  evaluatedAt: string
  status: 'pending' | 'acknowledged' | 'terminal'
  remoteAcknowledgementId: string | null
  remoteCreatedAt: string | null
  remoteReplayed: boolean | null
  createdAt: string
  acknowledgedAt: string | null
  failureCode: RemoteSyncFailureCode | null
  failedAt: string | null
}

export type CommitGateCommandExecutionInput = {
  command: GateCommand
  receipt: GateCommandReceipt
  expectedPairing: WorkRequestMaterializationExpectedPairing
  outcomeCode: GateCommandOutcomeCode
  evaluatedAt: string
  expectedRun?: WorkflowRun
  run?: WorkflowRun
  event?: AgentEvent
  evaluationBinding?: GateCommandEvaluationBinding
}

export type GateCommandEvaluationBinding = Readonly<{
  policySnapshot: PolicySnapshot
  enforcement: GateEnforcementDecision
  overrides: readonly GateOverrideDecision[]
  selectedOverrideId: string | null
  evidence: Omit<WorkflowEvidenceSnapshot, 'approval'>
  repositoryKnowledge: Readonly<{
    projectId: string
    evaluatedFingerprint: string
    observedFingerprint: string
  }>
}>

export type CommitGateCommandExecutionResult =
  | {
      committed: true
      replayed: boolean
      execution: LocalGateCommandExecution
      acknowledgement: LocalGateCommandAcknowledgement
    }
  | {
      committed: false
      reason:
        | 'invalid_input'
        | 'pairing_scope_mismatch'
        | 'fingerprint_conflict'
        | 'receipt_conflict'
        | 'run_not_found'
        | 'stale_run'
    }

export type RecordGateCommandAcknowledgementInput = {
  receiptId: string
  acknowledgement: GateCommandAcknowledgement
  replayed: boolean
  acknowledgedAt: string
}

export type RecordGateCommandAcknowledgementResult =
  | {
      recorded: true
      replayed: boolean
      acknowledgement: LocalGateCommandAcknowledgement
    }
  | {
      recorded: false
      reason: 'invalid_input' | 'not_found' | 'acknowledgement_conflict'
    }

export type TerminalizeGateCommandAcknowledgementInput = {
  receiptId: string
  failureCode: RemoteSyncFailureCode
  failedAt: string
}

export type TerminalizeGateCommandAcknowledgementResult =
  | {
      terminalized: true
      replayed: boolean
      acknowledgement: LocalGateCommandAcknowledgement
    }
  | {
      terminalized: false
      reason: 'invalid_input' | 'not_found' | 'conflict'
    }

export type WorkflowMutationCommitResult =
  | { committed: true }
  | { committed: false; reason: 'run_not_found' | 'stale_run' }

export type EnqueueRemoteSyncOperationResult =
  | { enqueued: true; operation: RemoteSyncOperation }
  | { enqueued: false; reason: 'coalesced'; operation: RemoteSyncOperation }
  | {
      enqueued: false
      reason: 'invalid_idempotency_key' | 'invalid_operation' | 'scope_mismatch'
    }

export type BindRemoteSyncOperationScopeInput = {
  id: string
  generation: number
  organizationId: string
  teamProjectId: string
  updatedAt: string
}

export type BindRemoteSyncOperationScopeResult =
  | { bound: true; operation: RemoteSyncOperation }
  | {
      bound: false
      reason: 'not_found' | 'not_sending' | 'stale_generation' | 'scope_mismatch'
    }

export type SettleRemoteSyncOperationInput = {
  id: string
  generation: number
  status: 'completed' | 'retry-scheduled' | 'terminal'
  updatedAt: string
  nextAttemptAt?: string | null
  lastErrorCode?: RemoteSyncFailureCode | null
  lastErrorMessage?: string | null
  recovery?: RemoteSyncRecovery
  completedAt?: string | null
}

export type SettleRemoteSyncOperationResult =
  | { settled: true; operation: RemoteSyncOperation }
  | { settled: false; reason: 'not_found' | 'stale_generation' | 'not_sending' }

export type RetryRemoteSyncOperationInput = {
  id: string
  updatedAt: string
}

export type RetryRemoteSyncOperationResult =
  | { retried: true; operation: RemoteSyncOperation }
  | { retried: false; reason: 'not_found' | 'not_terminal' }

export type CommitAgentRuntimeTransitionInput = {
  expectedRuntime: AgentRuntimeState | null
  transition: AgentRuntimeTransition
  contextAttachment?: AgentRuntimeContextAttachment
  memoryCandidate?: AgentMemoryCandidate
}

export type CommitAgentRuntimeTransitionResult =
  | { committed: true; replayed: boolean; runtime: AgentRuntimeState }
  | {
      committed: false
      reason: 'runtime_exists' | 'runtime_not_found' | 'stale_checkpoint' | 'invalid_transition'
    }

export type AgentRuntimeTerminalSummary = {
  stateVersion: 1
  runtimeId: string
  checkpointVersion: number
  stopReason: AgentRuntimeStopReason
  counters: AgentRuntimeState['counters']
  acceptedActionCount: number
  lastObservationDigest: string
  lastResultDigest: string | null
  completedAt: string
  redacted: true
}

export type AgentRuntimeCapabilityGrant = NativeToolCapabilityGrantRecord

export type ReserveAgentRuntimeCapabilityGrantResult =
  | { reserved: true; grant: AgentRuntimeCapabilityGrant }
  | { reserved: false; reason: 'invalid_grant' | 'runtime_stale' | 'grant_exists' }

export type BeginAgentRuntimeToolExecutionResult =
  | { consumed: true }
  | { consumed: false; reason: 'invalid_input' | 'grant_stale' }

export type AuthorizeCoordinationSessionRecoveryInput = {
  coordinationId: string
  expectedSessionVersion: number
  now: string
}

export type AuthorizeCoordinationSessionRecoveryResult =
  | {
      authorized: true
      snapshot: CoordinationRecoverySnapshot
      runtimes: AgentRuntimeState[]
      readyTaskIds: string[]
    }
  | {
      authorized: false
      reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state'
    }

export type CommitLocalMcpInstallationResult =
  | { committed: true; installation: LocalMcpInstallation }
  | { committed: false; reason: 'invalid_installation' | 'version_conflict' }

export type DeleteLocalMcpInstallationResult =
  | { deleted: true }
  | { deleted: false; reason: 'invalid_installation' | 'version_conflict' }

export type LocalStore = {
  getSpecialistTaskAuthorityStoreIdentity(): object
  upsertProject(project: LocalProject): Promise<void>
  listProjects(): Promise<LocalProject[]>
  activateKnowledgeIndexSnapshot(
    input: ActivateKnowledgeIndexSnapshotInput,
  ): Promise<ActivateKnowledgeIndexSnapshotResult>
  getCurrentKnowledgeIndexSnapshot(
    localProjectId: string,
  ): Promise<KnowledgeIndexSnapshot | null>
  getCurrentKnowledgeSnapshotIdentitySet(
    scope: KnowledgeRetrievalScope,
  ): Promise<KnowledgeSnapshotIdentitySet | null>
  rebuildKnowledgeIndexSnapshot(
    input: ActivateKnowledgeIndexSnapshotInput,
  ): Promise<ActivateKnowledgeIndexSnapshotResult>
  saveAgentMemoryCandidate(
    candidate: AgentMemoryCandidate,
  ): Promise<SaveAgentMemoryCandidateResult>
  listAgentMemoryCandidates(localProjectId?: string): Promise<AgentMemoryCandidate[]>
  authorizeAgentMemoryPromotion(
    input: AuthorizeAgentMemoryPromotionInput,
  ): Promise<AuthorizeAgentMemoryPromotionResult>
  commitAgentMemoryPromotion(
    input: CommitAgentMemoryPromotionInput,
    capability: AgentMemoryPromotionCapability,
  ): Promise<CommitAgentMemoryPromotionResult>
  listAgentMemoryRevisions(memoryId: string): Promise<DurableAgentMemoryRevision[]>
  listAgentMemoryHeads(localProjectId?: string): Promise<AgentMemoryHeadRecord[]>
  getAgentMemoryHead(memoryId: string): Promise<AgentMemoryHeadRecord | null>
  getAgentMemoryTeamProjectionInput(
    memoryId: string,
  ): Promise<CreateRemoteAgentMemorySummaryInput | null>
  retrieveAgentMemoryRevisions(
    input: AgentMemoryRetrievalRequest,
  ): Promise<DurableAgentMemoryRevision[]>
  authorizeAgentMemoryRevision(
    input: AuthorizeAgentMemoryRevisionInput,
  ): Promise<AuthorizeAgentMemoryRevisionResult>
  commitAgentMemoryRevision(
    input: CommitAgentMemoryRevisionInput,
    capability: AgentMemoryRevisionCapability,
  ): Promise<CommitAgentMemoryRevisionResult>
  authorizeAgentMemoryDeletion(
    input: AuthorizeAgentMemoryDeletionInput,
  ): Promise<AuthorizeAgentMemoryDeletionResult>
  commitAgentMemoryDeletion(
    input: CommitAgentMemoryDeletionInput,
    capability: AgentMemoryDeletionCapability,
  ): Promise<CommitAgentMemoryDeletionResult>
  getAgentMemoryTombstone(memoryId: string): Promise<AgentMemoryTombstone | null>
  purgeAgentMemoryDerivedState(
    input: PurgeAgentMemoryDerivedStateInput,
  ): Promise<PurgeAgentMemoryDerivedStateResult>
  saveRun(run: WorkflowRun): Promise<void>
  deleteRun(runId: string): Promise<void>
  getRun(runId: string): Promise<WorkflowRun | null>
  listRuns(): Promise<WorkflowRun[]>
  enqueueRemoteSyncOperation(
    operation: RemoteSyncOperation,
  ): Promise<EnqueueRemoteSyncOperationResult>
  listRemoteSyncOperations(runId?: string): Promise<RemoteSyncOperation[]>
  claimNextRemoteSyncOperation(now: string): Promise<RemoteSyncOperation | null>
  bindRemoteSyncOperationScope(
    input: BindRemoteSyncOperationScopeInput,
  ): Promise<BindRemoteSyncOperationScopeResult>
  settleRemoteSyncOperation(
    input: SettleRemoteSyncOperationInput,
  ): Promise<SettleRemoteSyncOperationResult>
  retryRemoteSyncOperation(
    input: RetryRemoteSyncOperationInput,
  ): Promise<RetryRemoteSyncOperationResult>
  recoverInterruptedRemoteSyncOperations(updatedAt: string): Promise<number>
  commitAgentRuntimeTransition(
    input: CommitAgentRuntimeTransitionInput,
  ): Promise<CommitAgentRuntimeTransitionResult>
  createCoordinationSession(
    input: CreateCoordinationSessionInput,
  ): Promise<CreateCoordinationSessionResult>
  commitSpecialistRuntimeStart(
    input: CommitSpecialistRuntimeStartInput,
  ): Promise<CommitSpecialistRuntimeStartResult>
  commitSpecialistRuntimeCompletion(
    input: CommitSpecialistRuntimeCompletionInput,
  ): Promise<CommitSpecialistRuntimeCompletionResult>
  commitSpecialistRuntimeRecovery(
    input: CommitSpecialistRuntimeRecoveryInput,
  ): Promise<CommitSpecialistRuntimeRecoveryResult>
  commitCoordinationSessionCancellation(
    input: CommitCoordinationSessionCancellationInput,
  ): Promise<CommitCoordinationSessionCancellationResult>
  acquireCoordinationResourceLease(
    input: AcquireCoordinationResourceLeaseInput,
  ): Promise<AcquireCoordinationResourceLeaseResult>
  settleCoordinationResourceLease(
    input: SettleCoordinationResourceLeaseInput,
  ): Promise<SettleCoordinationResourceLeaseResult>
  commitCoordinationTaskStart(
    input: CommitCoordinationTaskStartInput,
  ): Promise<CommitCoordinationTaskStartResult>
  commitCoordinationTaskResult(
    input: CommitCoordinationTaskResultInput,
  ): Promise<CommitCoordinationTaskResultOutcome>
  commitCoordinationHandoff(
    input: CommitCoordinationHandoffInput,
  ): Promise<CommitCoordinationHandoffResult>
  getCoordinationSession(coordinationId: string): Promise<DurableCoordinationSession | null>
  getCoordinationRecoverySnapshot(
    coordinationId: string,
  ): Promise<CoordinationRecoverySnapshot | null>
  listCoordinationRecoverySnapshots(): Promise<CoordinationRecoverySnapshot[]>
  authorizeCoordinationSessionRecovery(
    input: AuthorizeCoordinationSessionRecoveryInput,
  ): Promise<AuthorizeCoordinationSessionRecoveryResult>
  getAgentRuntimeContextAttachment(
    runtimeId: string,
  ): Promise<AgentRuntimeContextAttachment | null>
  isAgentRuntimeContextCurrent(runtimeId: string, now: string): Promise<boolean>
  getAgentRuntime(runtimeId: string): Promise<AgentRuntimeState | null>
  listAgentRuntimes(): Promise<AgentRuntimeState[]>
  listRecoverableAgentRuntimes(): Promise<AgentRuntimeState[]>
  listAgentRuntimeEvents(runtimeId: string): Promise<AgentRuntimeEvent[]>
  listAgentRuntimeCheckpoints(runtimeId: string): Promise<AgentCheckpoint[]>
  getAgentRuntimeTerminalSummary(
    runtimeId: string,
  ): Promise<AgentRuntimeTerminalSummary | null>
  reserveAgentRuntimeCapabilityGrant(
    grant: AgentRuntimeCapabilityGrant,
  ): Promise<ReserveAgentRuntimeCapabilityGrantResult>
  beginAgentRuntimeToolExecution(input: {
    expectedGrant: AgentRuntimeCapabilityGrant
    audit: NativeToolAuditRecord
  }): Promise<BeginAgentRuntimeToolExecutionResult>
  appendAgentRuntimeToolAudit(audit: NativeToolAuditRecord): Promise<void>
  listAgentRuntimeToolAudits(runtimeId?: string): Promise<NativeToolAuditRecord[]>
  listAgentRuntimeCapabilityGrants(runtimeId?: string): Promise<AgentRuntimeCapabilityGrant[]>
  commitLocalMcpInstallation(input: {
    expectedInstallation: LocalMcpInstallation | null
    installation: LocalMcpInstallation
  }): Promise<CommitLocalMcpInstallationResult>
  deleteLocalMcpInstallation(
    expectedInstallation: LocalMcpInstallation,
  ): Promise<DeleteLocalMcpInstallationResult>
  getLocalMcpInstallation(installationId: string): Promise<LocalMcpInstallation | null>
  listLocalMcpInstallations(): Promise<LocalMcpInstallation[]>
  createWorkflow(
    creation: WorkflowCreation,
  ): Promise<WorkflowCreationResult>
  materializeClaimedWorkRequest(
    input: MaterializeClaimedWorkRequestInput,
  ): Promise<MaterializeClaimedWorkRequestResult>
  markWorkRequestMaterializationAcknowledged(
    input: MarkWorkRequestMaterializationAcknowledgedInput,
  ): Promise<MarkWorkRequestMaterializationAcknowledgedResult>
  getWorkRequestMaterializationByWorkRequestId(
    workRequestId: string,
  ): Promise<WorkRequestMaterializationBinding | null>
  getWorkRequestMaterializationByRunId(
    runId: string,
  ): Promise<WorkRequestMaterializationBinding | null>
  recordGateCommandReceiptObservation(
    input: RecordGateCommandReceiptObservationInput,
  ): Promise<RecordGateCommandReceiptObservationResult>
  getGateCommandReceiptObservation(
    receiptId: string,
  ): Promise<LocalGateCommandReceiptObservation | null>
  commitGateCommandExecution(
    input: CommitGateCommandExecutionInput,
  ): Promise<CommitGateCommandExecutionResult>
  getGateCommandExecution(
    commandId: string,
  ): Promise<LocalGateCommandExecution | null>
  getGateCommandAcknowledgement(
    receiptId: string,
  ): Promise<LocalGateCommandAcknowledgement | null>
  listPendingGateCommandAcknowledgements(): Promise<
    LocalGateCommandAcknowledgement[]
  >
  recordGateCommandAcknowledgement(
    input: RecordGateCommandAcknowledgementInput,
  ): Promise<RecordGateCommandAcknowledgementResult>
  terminalizeGateCommandAcknowledgement(
    input: TerminalizeGateCommandAcknowledgementInput,
  ): Promise<TerminalizeGateCommandAcknowledgementResult>
  commitWorkflowMutation(
    mutation: WorkflowMutation,
  ): Promise<WorkflowMutationCommitResult>
  commitGitHubDeliveryPreparation(
    mutation: GitHubDeliveryPreparationMutation,
  ): Promise<GitHubDeliveryPreparationMutationResult>
  commitGitHubDeliveryReplacement(
    mutation: GitHubDeliveryReplacementMutation,
  ): Promise<GitHubDeliveryReplacementMutationResult>
  commitGitHubDeliveryIntentStatus(
    mutation: GitHubDeliveryIntentStatusMutation,
  ): Promise<GitHubDeliveryIntentStatusMutationResult>
  commitGitHubDeliveryIntentCompletion(
    mutation: GitHubDeliveryIntentCompletionMutation,
  ): Promise<GitHubDeliveryIntentCompletionMutationResult>
  listGitHubDeliveryIntents(runId?: string): Promise<GitHubDeliveryIntent[]>
  listGitHubDeliveryOperatorOutcomes(
    intentId?: string,
  ): Promise<GitHubDeliveryOperatorOutcome[]>
  stopGitHubDeliveryIntent(
    input: StopGitHubDeliveryIntentInput,
  ): Promise<StopGitHubDeliveryIntentResult>
  commitGitHubDeliveryRevocationCheck(
    input: CommitGitHubDeliveryRevocationCheckInput,
  ): Promise<CommitGitHubDeliveryRevocationCheckResult>
  listGitHubDeliveryRevocationChecks(
    intentId?: string,
  ): Promise<GitHubDeliveryRevocationCheck[]>
  commitGitHubRepositoryBindingObservation(
    input: CommitGitHubRepositoryBindingObservationInput,
  ): Promise<CommitGitHubRepositoryBindingObservationResult>
  saveGitHubRepositoryBinding(
    binding: GitHubRepositoryBinding,
  ): Promise<GitHubRepositoryBinding>
  getGitHubRepositoryBinding(teamProjectId: string): Promise<GitHubRepositoryBinding | null>
  listGitHubRepositoryBindings(): Promise<GitHubRepositoryBinding[]>
  saveArtifact(artifact: Artifact): Promise<void>
  listArtifacts(runId?: string): Promise<Artifact[]>
  saveEvent(event: AgentEvent): Promise<void>
  listEvents(runId?: string): Promise<AgentEvent[]>
  saveTestEvidence(evidence: TestEvidence): Promise<void>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  saveAgentReview(review: AgentReviewResult): Promise<void>
  listAgentReviews(runId?: string): Promise<AgentReviewResult[]>
  saveAgentTrace(trace: AgentTrace): Promise<void>
  listAgentTraces(runId?: string): Promise<AgentTrace[]>
  saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void>
  listAgentTokenUsage(runId?: string): Promise<AgentTokenUsage[]>
  saveCodingAgentRun(run: CodingAgentRun): Promise<void>
  reserveCodingAgentRun(run: CodingAgentRun): Promise<ReserveCodingAgentRunResult>
  commitCodingAgentMutation(
    mutation: CodingAgentMutation,
  ): Promise<CodingAgentMutationResult>
  listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]>
  saveCodingAgentEvent(event: CodingAgentEvent): Promise<void>
  listCodingAgentEvents(codingRunId?: string): Promise<CodingAgentEvent[]>
  saveCodingPermissionRequest(request: CodingPermissionRequest): Promise<void>
  listCodingPermissionRequests(codingRunId?: string): Promise<CodingPermissionRequest[]>
  saveCodingPermissionDecision(decision: CodingPermissionDecision): Promise<void>
  listCodingPermissionDecisions(codingRunId?: string): Promise<CodingPermissionDecision[]>
  saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace): Promise<void>
  commitManagedCodingWorkspaceHead(
    mutation: ManagedCodingWorkspaceHeadMutation,
  ): Promise<ManagedCodingWorkspaceHeadMutationResult>
  commitManagedCodingWorkspaceCleanup(
    mutation: ManagedCodingWorkspaceCleanupMutation,
  ): Promise<ManagedCodingWorkspaceCleanupMutationResult>
  listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]>
  saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence): Promise<void>
  listDependencyBootstrapEvidence(codingRunId?: string): Promise<DependencyBootstrapEvidence[]>
  saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void>
  listCodingDiffArtifacts(runId?: string): Promise<CodingDiffArtifact[]>
  saveProviderCredential(
    metadata: ProviderCredentialMetadata,
    encryptedSecret: string,
  ): Promise<ProviderCredentialMetadata>
  listProviderCredentials(): Promise<ProviderCredentialMetadata[]>
  getProviderEncryptedSecret(providerId: string): Promise<string | null>
  saveDesktopPairingCredential(
    credential: DesktopPairingCredential,
    encryptedToken: string,
  ): Promise<DesktopPairingCredential>
  getDesktopPairingCredential(): Promise<DesktopPairingCredential | null>
  getDesktopPairingEncryptedToken(): Promise<string | null>
  getDesktopPairingCredentialBundle(): Promise<{
    credential: DesktopPairingCredential
    encryptedToken: string
  } | null>
  savePolicySnapshot(snapshot: PolicySnapshot): Promise<PolicySnapshot>
  getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null>
  saveGateOverride(decision: GateOverrideDecision): Promise<GateOverrideDecision>
  listGateOverrides(runId?: string): Promise<GateOverrideDecision[]>
  saveRetryAttempt(attempt: RetryAttempt): Promise<RetryAttempt>
  listRetryAttempts(runId?: string): Promise<RetryAttempt[]>
  saveSettings(settings: Partial<LocalSettings>): Promise<LocalSettings>
  getSettings(): Promise<LocalSettings>
  saveMcpServers(servers: McpServerDefinition[]): Promise<McpServerDefinition[]>
  listMcpServers(): Promise<McpServerDefinition[]>
  getSchemaVersion(): Promise<number>
  loadState(): Promise<LocalExecutionState>
  close(): void
}

export type CreateCoordinationSessionInput = {
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  startedAt: string
}

export type DurableCoordinationSession = {
  coordination: CoordinationSessionRequest
  graph: AgentTaskGraph
  state: CoordinationSessionState
}

export type CoordinationTrajectoryAudit = {
  id: string
  taskId: string | null
  eventKind:
    | 'session_started'
    | 'task_started'
    | 'task_result'
    | 'task_retried'
    | 'handoff_accepted'
    | 'session_cancelled'
  sessionVersion: number
  metadata: Readonly<Record<string, string | number | null>>
  createdAt: string
}

export type DurableCoordinationCheckpoint = {
  checkpointVersion: number
  sessionVersion: number
  graphVersion: number
  state: CoordinationSessionState
  createdAt: string
}

export type CoordinationRecoverySnapshot = DurableCoordinationSession & {
  handoffs: AgentHandoff[]
  leases: CoordinationResourceLease[]
  audits: CoordinationTrajectoryAudit[]
  checkpoints: DurableCoordinationCheckpoint[]
}

export type CreateCoordinationSessionResult =
  | { committed: true; replayed: boolean; state: CoordinationSessionState }
  | { committed: false; reason: 'invalid_input' | 'authority_mismatch' | 'session_exists' }

export type AcquireCoordinationResourceLeaseInput = {
  expectedState: CoordinationSessionState
  lease: CoordinationResourceLease
}

export type AcquireCoordinationResourceLeaseResult =
  | { committed: true; replayed: boolean; lease: CoordinationResourceLease }
  | {
      committed: false
      reason:
        | 'invalid_input'
        | 'authority_mismatch'
        | 'conflicting_lease'
        | 'not_found'
        | 'stale_state'
    }

export type SettleCoordinationResourceLeaseInput = {
  expectedState: CoordinationSessionState
  expectedLease: CoordinationResourceLease
  outcome: Exclude<CoordinationResourceLease['status'], 'active'>
  now: string
}

export type SettleCoordinationResourceLeaseResult =
  | { committed: true; replayed: boolean; lease: CoordinationResourceLease }
  | {
      committed: false
      reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state'
    }

export type CommitCoordinationTaskStartInput = {
  expectedState: CoordinationSessionState
  allocation: SpecialistAllocationRequest
  supervisorCapabilityIds: readonly string[]
  supervisorResourceRequirements: readonly AgentTaskResourceRequirement[]
  remainingBudget: SpecialistBudget
  runtimeId: string
  runtimeVersion: number
  now: string
}

export type CommitCoordinationTaskStartResult =
  | { committed: true; replayed: boolean; state: CoordinationSessionState }
  | { committed: false; reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state' }

export type CommitSpecialistRuntimeStartInput = {
  authorityCapability: SpecialistTaskAuthority
  allocation: SpecialistAllocationRequest
  transition: AgentRuntimeTransition
  contextAttachment: AgentRuntimeContextAttachment
  now: string
}

export type CommitSpecialistRuntimeStartResult =
  | {
      committed: true
      replayed: false
      runtime: AgentRuntimeState
      state: CoordinationSessionState
    }
  | {
      committed: false
      reason:
        | 'invalid_input'
        | 'authority_mismatch'
        | 'stale_state'
    }

export type SpecialistRuntimeHandoffDraft = {
  id: string
  targetTaskId: string
  expectedTargetTaskVersion: number
  summary: string
}

export type CommitSpecialistRuntimeCompletionInput = {
  coordinationId: string
  expectedSessionVersion: number
  taskId: string
  expectedTaskVersion: number
  expectedRuntimeVersion: number
  transition: AgentRuntimeTransition
  evidenceDigests: string[]
  resourceLeaseOutcome: AgentHandoff['resourceLeaseOutcome']
  handoffs: SpecialistRuntimeHandoffDraft[]
}

export type CommitSpecialistRuntimeCompletionResult =
  | {
      committed: true
      replayed: boolean
      runtime: AgentRuntimeState
      state: CoordinationSessionState
      handoffs: AgentHandoff[]
    }
  | {
      committed: false
      reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state'
    }

export type CommitSpecialistRuntimeRecoveryInput = {
  recoveryId: string
  coordinationId: string
  expectedSessionVersion: number
  taskId: string
  expectedTaskVersion: number
  expectedRuntimeVersion: number
  failureTransition: AgentRuntimeTransition
  replacementTransition: AgentRuntimeTransition
  contextAttachment: AgentRuntimeContextAttachment
}

export type CommitSpecialistRuntimeRecoveryResult =
  | {
      committed: true
      replayed: boolean
      failedRuntime: AgentRuntimeState
      runtime: AgentRuntimeState
      state: CoordinationSessionState
    }
  | {
      committed: false
      reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state'
    }

export type CommitCoordinationSessionCancellationInput = {
  coordinationId: string
  expectedSessionVersion: number
  now: string
}

export type CommitCoordinationSessionCancellationResult =
  | {
      committed: true
      replayed: boolean
      state: CoordinationSessionState
      runtimes: AgentRuntimeState[]
      leases: CoordinationResourceLease[]
    }
  | {
      committed: false
      reason: 'invalid_input' | 'not_found' | 'stale_state'
    }

export type CommitCoordinationTaskResultInput = {
  expectedState: CoordinationSessionState
  taskId: string
  runtimeId: string
  runtimeVersion: number
  result: CoordinationTaskResult
  usage: CoordinationUsageDelta
  now: string
}

export type CommitCoordinationTaskResultOutcome =
  | { committed: true; replayed: boolean; state: CoordinationSessionState }
  | { committed: false; reason: 'invalid_input' | 'authority_mismatch' | 'not_found' | 'stale_state' }

export type CommitCoordinationHandoffInput = {
  expectedState: CoordinationSessionState
  handoff: AgentHandoff
  sourceResult: AcceptedSpecialistResult
}

export type CommitCoordinationHandoffResult =
  | { committed: true; replayed: boolean; state: CoordinationSessionState }
  | {
      committed: false
      reason: 'invalid_input' | 'authority_mismatch' | 'conflicting_handoff' | 'not_found' | 'stale_state'
    }

export type SaveAgentMemoryCandidateResult =
  | { committed: true; replayed: boolean; candidate: AgentMemoryCandidate }
  | {
      committed: false
      reason: 'invalid_candidate' | 'source_not_found' | 'scope_mismatch' | 'id_conflict'
    }

declare const agentMemoryPromotionCapabilityBrand: unique symbol

export type AgentMemoryPromotionCapability = Readonly<{
  [agentMemoryPromotionCapabilityBrand]: true
}>

export type AuthorizeAgentMemoryPromotionInput = {
  candidateId: string
  memoryId: string
  authority: AgentMemoryPromotionAuthority
}

export type AuthorizeAgentMemoryPromotionResult =
  | {
      authorized: true
      capability: AgentMemoryPromotionCapability
      revision: DurableAgentMemoryRevision
    }
  | {
      authorized: false
      reason:
        | 'invalid_input'
        | 'candidate_not_found'
        | 'scope_mismatch'
        | 'already_promoted'
        | 'id_conflict'
    }

export type CommitAgentMemoryPromotionInput = {
  revision: DurableAgentMemoryRevision
}

export type CommitAgentMemoryPromotionResult =
  | {
      committed: true
      replayed: boolean
      revision: DurableAgentMemoryRevision
    }
  | {
      committed: false
      reason: 'invalid_authority' | 'invalid_revision' | 'source_stale' | 'id_conflict'
    }

export type AgentMemoryHeadRecord = {
  memoryId: string
  currentRevision: number
  scope: KnowledgeRetrievalScope
  status: 'active' | 'conflict' | 'expired' | 'purge_pending' | 'deleted'
  version: number
  updatedAt: string
}

type AgentMemoryPromotionCapabilityDescriptor = {
  owner: object
  candidate: AgentMemoryCandidate
  revision: DurableAgentMemoryRevision
}

const agentMemoryPromotionCapabilities = new WeakMap<
  object,
  AgentMemoryPromotionCapabilityDescriptor
>()

declare const agentMemoryRevisionCapabilityBrand: unique symbol

export type AgentMemoryRevisionCapability = Readonly<{
  [agentMemoryRevisionCapabilityBrand]: true
}>

export type AuthorizeAgentMemoryRevisionInput = {
  memoryId: string
  expectedHeadVersion: number
  statement: string
  authority: AgentMemoryRevisionAuthority
}

export type AuthorizeAgentMemoryRevisionResult =
  | {
      authorized: true
      capability: AgentMemoryRevisionCapability
      revision: DurableAgentMemoryRevision
    }
  | {
      authorized: false
      reason: 'invalid_input' | 'memory_not_found' | 'scope_mismatch' | 'version_conflict' | 'id_conflict'
    }

export type CommitAgentMemoryRevisionInput = {
  revision: DurableAgentMemoryRevision
  recordedAt: string
}

export type CommitAgentMemoryRevisionResult =
  | {
      committed: true
      replayed: boolean
      revision: DurableAgentMemoryRevision
    }
  | {
      committed: false
      reason: 'invalid_authority' | 'invalid_revision' | 'source_stale' | 'id_conflict'
    }
  | {
      committed: false
      reason: 'version_conflict'
      currentRevision: DurableAgentMemoryRevision
      currentHead: AgentMemoryHeadRecord
    }

type AgentMemoryRevisionCapabilityDescriptor = {
  owner: object
  expectedHeadVersion: number
  currentRevision: DurableAgentMemoryRevision
  revision: DurableAgentMemoryRevision
}

const agentMemoryRevisionCapabilities = new WeakMap<
  object,
  AgentMemoryRevisionCapabilityDescriptor
>()

declare const agentMemoryDeletionCapabilityBrand: unique symbol

export type AgentMemoryDeletionCapability = Readonly<{
  [agentMemoryDeletionCapabilityBrand]: true
}>

export type AuthorizeAgentMemoryDeletionInput = {
  authority: AgentMemoryDeletionAuthority
}

export type AuthorizeAgentMemoryDeletionResult =
  | {
      authorized: true
      capability: AgentMemoryDeletionCapability
      tombstone: AgentMemoryTombstone
    }
  | {
      authorized: false
      reason:
        | 'invalid_input'
        | 'memory_not_found'
        | 'scope_mismatch'
        | 'version_conflict'
        | 'already_deleted'
        | 'id_conflict'
    }

export type CommitAgentMemoryDeletionInput = {
  tombstone: AgentMemoryTombstone
}

export type CommitAgentMemoryDeletionResult =
  | {
      committed: true
      replayed: boolean
      tombstone: AgentMemoryTombstone
    }
  | {
      committed: false
      reason: 'invalid_authority' | 'invalid_tombstone' | 'source_stale' | 'id_conflict'
    }

export type PurgeAgentMemoryDerivedStateInput = {
  memoryId: string
  expectedDeletionVersion: number
  purgedAt: string
}

export type PurgeAgentMemoryDerivedStateResult =
  | {
      purged: true
      replayed: boolean
      tombstone: AgentMemoryTombstone
    }
  | {
      purged: false
      reason: 'invalid_input' | 'not_found' | 'version_conflict' | 'source_stale'
    }

type AgentMemoryDeletionCapabilityDescriptor = {
  owner: object
  expectedHeadVersion: number
  currentRevision: DurableAgentMemoryRevision
  tombstone: AgentMemoryTombstone
}

const agentMemoryDeletionCapabilities = new WeakMap<
  object,
  AgentMemoryDeletionCapabilityDescriptor
>()

function agentMemoryScopeMatchesPairing(
  scope: KnowledgeRetrievalScope,
  pairing: DesktopPairingCredential | null,
): boolean {
  return scope.kind === 'local' || (
    pairing !== null &&
    pairing.organizationId === scope.organizationId &&
    pairing.projectId === scope.projectId &&
    pairing.userId === scope.userId &&
    pairing.tokenId === scope.sessionId &&
    pairing.localProjectId === scope.localProjectId
  )
}

type SchemaMigration = {
  version: number
  migrate(db: Database): void
}

const schemaMigrations: readonly SchemaMigration[] = [
  {
    version: 1,
    migrate(db) {
      db.run(`
    create table if not exists schema_meta (
      key text primary key,
      value text not null
    );

    create table if not exists local_projects (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_runs (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists artifacts (
      id text primary key,
      run_id text not null,
      json text not null,
      updated_at text not null
    );

    create table if not exists agent_events (
      id text primary key,
      run_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists test_evidence (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 2,
    migrate(db) {
      db.run(`
    create table if not exists local_settings (
      key text primary key,
      json text not null,
      updated_at text not null
    );

    create table if not exists mcp_servers (
      id text primary key,
      json text not null,
      updated_at text not null
    );

    insert into local_settings (key, json, updated_at)
    values ('settings', '${JSON.stringify(DEFAULT_LOCAL_SETTINGS)}', datetime('now'))
    on conflict(key) do nothing;
      `)
    },
  },
  {
    version: 3,
    migrate(db) {
      db.run(`

    create table if not exists agent_reviews (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_traces (
      id text primary key,
      run_id text not null,
      node_id text not null,
      review_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_token_usage (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists provider_credentials (
      provider_id text primary key,
      json text not null,
      encrypted_secret text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 4,
    migrate(db) {
      db.run(`

    create table if not exists coding_agent_runs (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      started_at text not null,
      updated_at text not null
    );

    create table if not exists coding_agent_events (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists coding_permission_requests (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      json text not null,
      requested_at text not null
    );

    create table if not exists coding_permission_decisions (
      id text primary key,
      request_id text not null,
      coding_run_id text not null,
      json text not null,
      decided_at text not null
    );

    create table if not exists managed_coding_workspaces (
      id text primary key,
      project_id text not null,
      coding_run_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists dependency_bootstrap_evidence (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists coding_diff_artifacts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 5,
    migrate(db) {
      db.run(`

    create table if not exists policy_snapshots (
      project_id text primary key,
      json text not null,
      synced_at text not null
    );

    create table if not exists gate_overrides (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 6,
    migrate(db) {
      db.run(`

    create table if not exists retry_attempts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 7,
    migrate(db) {
      db.run(`

    create table if not exists desktop_pairing_credentials (
      id text primary key,
      json text not null,
      encrypted_token text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 8,
    migrate(db) {
      db.run(`

    create table if not exists workflow_nodes (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      stage text not null,
      title text not null,
      subtitle text not null,
      kind text not null,
      status text not null,
      owner_id text not null,
      required_role text,
      retry_count integer not null default 0,
      token_usage_id text,
      artifact_ids text not null default '[]',
      position integer not null default 0,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_edges (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      source_node_id text not null,
      target_node_id text not null,
      kind text not null,
      position integer not null default 0,
      json text not null,
      created_at text not null
    );

    create index if not exists idx_workflow_nodes_run_id_position
      on workflow_nodes(run_id, position);

    create index if not exists idx_workflow_edges_run_id_position
      on workflow_edges(run_id, position);
      `)
      migrateWorkflowRunsIntoRelationalTables(db)
    },
  },
  {
    version: 9,
    migrate(db) {
      db.run(`

    create table if not exists remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    create index if not exists idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 10,
    migrate(db) {
      db.run(`

    create table if not exists work_request_materializations (
      work_request_id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null unique references workflow_runs(id) on delete restrict,
      claim_version integer not null,
      source_fingerprint text not null,
      materialize_idempotency_key text not null unique,
      status text not null,
      acknowledged_version integer,
      created_at text not null,
      updated_at text not null,
      acknowledged_at text,
      check (length(trim(work_request_id)) > 0 and trim(work_request_id) = work_request_id),
      check (length(trim(organization_id)) > 0 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and trim(run_id) = run_id),
      check (claim_version > 0),
      check (
        length(source_fingerprint) = 64 and
        source_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(trim(materialize_idempotency_key)) > 0 and
        length(materialize_idempotency_key) <= 200 and
        trim(materialize_idempotency_key) = materialize_idempotency_key
      ),
      check (status in ('pending_ack', 'acknowledged')),
      check (updated_at >= created_at),
      check (
        (status = 'pending_ack' and acknowledged_version is null and acknowledged_at is null) or
        (status = 'acknowledged' and acknowledged_version = claim_version + 1 and acknowledged_at is not null)
      )
    );

    create index if not exists idx_work_request_materializations_pending
      on work_request_materializations(status, updated_at, work_request_id);

    create index if not exists idx_work_request_materializations_run_id
      on work_request_materializations(run_id);
      `)
    },
  },
  {
    version: 11,
    migrate(db) {
      db.run(`

    create table if not exists gate_command_executions (
      command_id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      claim_token_id text not null,
      work_request_id text,
      run_id text not null,
      node_id text not null,
      action text not null,
      workflow_command text,
      requested_by_user_id text not null,
      requested_role text not null,
      server_request_fingerprint text not null,
      execution_fingerprint text not null,
      expected_run_version integer not null,
      expected_policy_version integer not null,
      expected_blocker_ids_hash text not null,
      outcome_code text not null,
      before_run_version integer not null,
      after_run_version integer not null,
      evaluated_at text not null,
      command_expires_at text not null,
      created_at text not null,
      check (length(trim(command_id)) > 0 and length(command_id) <= 200 and trim(command_id) = command_id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(claim_token_id)) > 0 and length(claim_token_id) <= 200 and trim(claim_token_id) = claim_token_id),
      check (work_request_id is null or (length(trim(work_request_id)) > 0 and length(work_request_id) <= 200 and trim(work_request_id) = work_request_id)),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (
        (action = 'approve' and workflow_command in ('approve_gate', 'approve_acceptance')) or
        (action = 'reject' and workflow_command is null)
      ),
      check (requested_role in ('owner', 'lead', 'member')),
      check (
        length(server_request_fingerprint) = 64 and
        server_request_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(execution_fingerprint) = 64 and
        execution_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_blocker_ids_hash) = 64 and
        expected_blocker_ids_hash not glob '*[^0-9a-f]*'
      ),
      check (expected_run_version between 1 and 2147483647),
      check (expected_policy_version between 0 and 2147483647),
      check (before_run_version between 1 and 2147483647),
      check (after_run_version between 1 and 2147483647),
      check (outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (
        (outcome_code = 'applied' and action = 'approve' and
          before_run_version = expected_run_version and
          after_run_version = before_run_version + 1) or
        (outcome_code = 'human_rejected' and action = 'reject' and
          before_run_version = expected_run_version and
          after_run_version = before_run_version) or
        (outcome_code not in ('applied', 'human_rejected') and
          after_run_version = before_run_version)
      ),
      check (command_expires_at > created_at),
      check (
        (julianday(command_expires_at) - julianday(created_at)) * 86400.0 <= 900.0001
      ),
      check (evaluated_at >= created_at)
    );

    create table if not exists gate_command_receipts (
      receipt_id text primary key,
      command_id text not null references gate_command_executions(command_id) on delete restrict,
      attempt integer not null,
      leased_at text not null,
      lease_expires_at text not null,
      acknowledged_at text,
      received_at text not null,
      check (length(trim(receipt_id)) > 0 and length(receipt_id) <= 200 and trim(receipt_id) = receipt_id),
      check (attempt between 1 and 2147483647),
      check (lease_expires_at > leased_at),
      check (
        (julianday(lease_expires_at) - julianday(leased_at)) * 86400.0 <= 60.0001
      ),
      check (acknowledged_at is null or acknowledged_at >= leased_at),
      check (received_at >= leased_at),
      unique (command_id, attempt),
      unique (receipt_id, command_id)
    );

    create index if not exists idx_gate_command_receipts_command
      on gate_command_receipts(command_id, attempt, leased_at);

    create table if not exists gate_command_acknowledgements (
      receipt_id text primary key references gate_command_receipts(receipt_id) on delete restrict,
      command_id text not null references gate_command_executions(command_id) on delete restrict,
      outcome_code text not null,
      before_run_version integer not null,
      after_run_version integer not null,
      evaluated_at text not null,
      status text not null,
      remote_acknowledgement_id text,
      remote_created_at text,
      remote_replayed integer,
      created_at text not null,
      acknowledged_at text,
      failure_code text,
      failed_at text,
      check (outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (before_run_version between 1 and 2147483647),
      check (after_run_version between 1 and 2147483647),
      check (status in ('pending', 'acknowledged', 'terminal')),
      check (failure_code is null or failure_code in (
        'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict',
        'scope_mismatch', 'remote_error'
      )),
      check (failed_at is null or failed_at >= created_at),
      check (
        (status = 'pending' and remote_acknowledgement_id is null and
          remote_created_at is null and remote_replayed is null and
          acknowledged_at is null and failure_code is null and failed_at is null) or
        (status = 'acknowledged' and remote_acknowledgement_id is not null and
          remote_created_at is not null and remote_replayed in (0, 1) and
          acknowledged_at is not null and failure_code is null and failed_at is null) or
        (status = 'terminal' and remote_acknowledgement_id is null and
          remote_created_at is null and remote_replayed is null and
          acknowledged_at is null and failure_code is not null and failed_at is not null)
      ),
      unique (remote_acknowledgement_id),
      foreign key (receipt_id, command_id)
        references gate_command_receipts(receipt_id, command_id) on delete restrict
    );

    create index if not exists idx_gate_command_acknowledgements_pending
      on gate_command_acknowledgements(status, created_at, receipt_id);
      `)
    },
  },
  {
    version: 12,
    migrate(db) {
      db.run(`

    create table if not exists gate_command_receipt_observations (
      receipt_id text primary key,
      command_id text not null,
      attempt integer not null,
      leased_at text not null,
      lease_expires_at text not null,
      received_at text not null,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      work_request_id text,
      run_id text not null,
      node_id text not null,
      claim_token_id text not null,
      execution_fingerprint text not null,
      status text not null,
      outcome_code text,
      evaluated_at text,
      check (length(trim(receipt_id)) > 0 and length(receipt_id) <= 200 and trim(receipt_id) = receipt_id),
      check (length(trim(command_id)) > 0 and length(command_id) <= 200 and trim(command_id) = command_id),
      check (attempt between 1 and 2147483647),
      check (lease_expires_at > leased_at),
      check (
        (julianday(lease_expires_at) - julianday(leased_at)) * 86400.0 <= 60.0001
      ),
      check (received_at >= leased_at),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (work_request_id is null or (length(trim(work_request_id)) > 0 and length(work_request_id) <= 200 and trim(work_request_id) = work_request_id)),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(claim_token_id)) > 0 and length(claim_token_id) <= 200 and trim(claim_token_id) = claim_token_id),
      check (
        length(execution_fingerprint) = 64 and
        execution_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (status in ('received', 'evaluated')),
      check (outcome_code is null or outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (
        (status = 'received' and outcome_code is null and evaluated_at is null) or
        (status = 'evaluated' and outcome_code is not null and
          evaluated_at is not null and evaluated_at >= received_at)
      ),
      unique (command_id, attempt)
    );

    create index if not exists idx_gate_command_receipt_observations_command
      on gate_command_receipt_observations(command_id, attempt, received_at);

    insert into gate_command_receipt_observations (
      receipt_id, command_id, attempt, leased_at, lease_expires_at, received_at,
      organization_id, team_project_id, local_project_id, work_request_id,
      run_id, node_id, claim_token_id, execution_fingerprint,
      status, outcome_code, evaluated_at
    )
    select
      receipt.receipt_id, receipt.command_id, receipt.attempt,
      receipt.leased_at, receipt.lease_expires_at, receipt.received_at,
      execution.organization_id, execution.team_project_id,
      execution.local_project_id, execution.work_request_id,
      execution.run_id, execution.node_id, execution.claim_token_id,
      execution.execution_fingerprint, 'evaluated', execution.outcome_code,
      receipt.received_at
    from gate_command_receipts as receipt
    join gate_command_executions as execution
      on execution.command_id = receipt.command_id;
      `)
    },
  },
  {
    version: 13,
    migrate(db) {
      db.run(`
    create table if not exists github_repository_bindings (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      installation_id text not null,
      repository_id text not null,
      version integer not null,
      status text not null,
      json text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (version between 1 and 2147483647),
      check (status in ('active', 'stale', 'revoked')),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1)
    );

    create unique index if not exists idx_github_repository_bindings_active_project
      on github_repository_bindings(team_project_id)
      where status = 'active';

    create table if not exists github_delivery_intents (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      repository_binding_id text not null,
      repository_binding_version integer not null,
      installation_id text not null,
      repository_id text not null,
      coding_run_id text not null,
      workspace_id text not null,
      diff_artifact_id text not null,
      test_evidence_id text not null,
      pr_package_artifact_id text not null,
      base_commit_sha text not null,
      expected_commit_sha text not null,
      intent_digest text not null unique,
      idempotency_key text not null unique,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(repository_binding_id)) > 0 and length(repository_binding_id) <= 200 and trim(repository_binding_id) = repository_binding_id),
      check (repository_binding_version between 1 and 2147483647),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (length(trim(coding_run_id)) > 0 and length(coding_run_id) <= 200 and trim(coding_run_id) = coding_run_id),
      check (length(trim(workspace_id)) > 0 and length(workspace_id) <= 200 and trim(workspace_id) = workspace_id),
      check (length(trim(diff_artifact_id)) > 0 and length(diff_artifact_id) <= 200 and trim(diff_artifact_id) = diff_artifact_id),
      check (length(trim(test_evidence_id)) > 0 and length(test_evidence_id) <= 200 and trim(test_evidence_id) = test_evidence_id),
      check (length(trim(pr_package_artifact_id)) > 0 and length(pr_package_artifact_id) <= 200 and trim(pr_package_artifact_id) = pr_package_artifact_id),
      check (
        length(base_commit_sha) in (40, 64) and
        base_commit_sha not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_commit_sha) in (40, 64) and
        expected_commit_sha not glob '*[^0-9a-f]*' and
        expected_commit_sha <> base_commit_sha
      ),
      check (
        length(intent_digest) = 64 and
        intent_digest not glob '*[^0-9a-f]*'
      ),
      check (
        length(idempotency_key) = 80 and
        substr(idempotency_key, 1, 16) = 'github-delivery:' and
        substr(idempotency_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'completed', 'failed',
        'recovery_required', 'revoked'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.runId') = run_id),
      check (json_extract(json, '$.nodeId') = node_id),
      check (json_extract(json, '$.repositoryBindingId') = repository_binding_id),
      check (json_extract(json, '$.repositoryBindingVersion') = repository_binding_version),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.codingRunId') = coding_run_id),
      check (json_extract(json, '$.workspaceId') = workspace_id),
      check (json_extract(json, '$.diffArtifactId') = diff_artifact_id),
      check (json_extract(json, '$.testEvidenceId') = test_evidence_id),
      check (json_extract(json, '$.prPackageArtifactId') = pr_package_artifact_id),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentDigest') = intent_digest),
      check (json_extract(json, '$.idempotencyKey') = idempotency_key),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1),
      check (updated_at >= created_at)
    );

    create index if not exists idx_github_delivery_intents_run
      on github_delivery_intents(run_id, created_at, id);

    create index if not exists idx_github_delivery_intents_status
      on github_delivery_intents(status, updated_at, id);

    create unique index if not exists idx_github_delivery_intents_active_scope
      on github_delivery_intents(run_id, node_id)
      where status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'recovery_required'
      );
      `)
    },
  },
  {
    version: 14,
    migrate(db) {
      db.run(`
    create table if not exists github_delivery_operator_outcomes (
      intent_id text primary key,
      intent_updated_at text not null,
      outcome_code text not null,
      state_version integer not null,
      json text not null,
      recorded_at text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (outcome_code in (
        'invalid_delivery_source', 'operation_cancelled',
        'publisher_cleanup_failed', 'remote_branch_diverged',
        'remote_unavailable', 'repository_mismatch', 'push_result_unknown',
        'workspace_dirty', 'workspace_mismatch'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.recordedAt') = recorded_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index if not exists idx_github_delivery_operator_outcomes_recorded
      on github_delivery_operator_outcomes(recorded_at, intent_id);
      `)
    },
  },
  {
    version: 15,
    migrate(db) {
      db.run(`
    alter table github_delivery_intents rename to github_delivery_intents_v14;

    drop index idx_github_delivery_intents_run;
    drop index idx_github_delivery_intents_status;
    drop index idx_github_delivery_intents_active_scope;

    create table github_delivery_intents (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      repository_binding_id text not null,
      repository_binding_version integer not null,
      installation_id text not null,
      repository_id text not null,
      coding_run_id text not null,
      workspace_id text not null,
      diff_artifact_id text not null,
      test_evidence_id text not null,
      pr_package_artifact_id text not null,
      base_commit_sha text not null,
      expected_commit_sha text not null,
      intent_digest text not null unique,
      idempotency_key text not null,
      delivery_series_key text not null,
      delivery_attempt integer not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(repository_binding_id)) > 0 and length(repository_binding_id) <= 200 and trim(repository_binding_id) = repository_binding_id),
      check (repository_binding_version between 1 and 2147483647),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (length(trim(coding_run_id)) > 0 and length(coding_run_id) <= 200 and trim(coding_run_id) = coding_run_id),
      check (length(trim(workspace_id)) > 0 and length(workspace_id) <= 200 and trim(workspace_id) = workspace_id),
      check (length(trim(diff_artifact_id)) > 0 and length(diff_artifact_id) <= 200 and trim(diff_artifact_id) = diff_artifact_id),
      check (length(trim(test_evidence_id)) > 0 and length(test_evidence_id) <= 200 and trim(test_evidence_id) = test_evidence_id),
      check (length(trim(pr_package_artifact_id)) > 0 and length(pr_package_artifact_id) <= 200 and trim(pr_package_artifact_id) = pr_package_artifact_id),
      check (
        length(base_commit_sha) in (40, 64) and
        base_commit_sha not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_commit_sha) in (40, 64) and
        expected_commit_sha not glob '*[^0-9a-f]*' and
        expected_commit_sha <> base_commit_sha
      ),
      check (
        length(intent_digest) = 64 and
        intent_digest not glob '*[^0-9a-f]*'
      ),
      check (
        length(idempotency_key) = 80 and
        substr(idempotency_key, 1, 16) = 'github-delivery:' and
        substr(idempotency_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (
        length(delivery_series_key) = 80 and
        substr(delivery_series_key, 1, 16) = 'github-delivery:' and
        substr(delivery_series_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (delivery_attempt between 1 and 2147483647),
      check (status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'completed', 'failed',
        'recovery_required', 'revoked'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.runId') = run_id),
      check (json_extract(json, '$.nodeId') = node_id),
      check (json_extract(json, '$.repositoryBindingId') = repository_binding_id),
      check (json_extract(json, '$.repositoryBindingVersion') = repository_binding_version),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.codingRunId') = coding_run_id),
      check (json_extract(json, '$.workspaceId') = workspace_id),
      check (json_extract(json, '$.diffArtifactId') = diff_artifact_id),
      check (json_extract(json, '$.testEvidenceId') = test_evidence_id),
      check (json_extract(json, '$.prPackageArtifactId') = pr_package_artifact_id),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentDigest') = intent_digest),
      check (json_extract(json, '$.idempotencyKey') = idempotency_key),
      check (json_extract(json, '$.deliverySeriesKey') = delivery_series_key),
      check (json_extract(json, '$.deliveryAttempt') = delivery_attempt),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1),
      check (updated_at >= created_at)
    );

    insert into github_delivery_intents (
      id, organization_id, team_project_id, local_project_id,
      run_id, node_id, repository_binding_id, repository_binding_version,
      installation_id, repository_id, coding_run_id, workspace_id,
      diff_artifact_id, test_evidence_id, pr_package_artifact_id,
      base_commit_sha, expected_commit_sha, intent_digest, idempotency_key,
      delivery_series_key, delivery_attempt, status, state_version, json,
      created_at, updated_at
    )
    select
      id, organization_id, team_project_id, local_project_id,
      run_id, node_id, repository_binding_id, repository_binding_version,
      installation_id, repository_id, coding_run_id, workspace_id,
      diff_artifact_id, test_evidence_id, pr_package_artifact_id,
      base_commit_sha, expected_commit_sha, intent_digest, idempotency_key,
      coalesce(json_extract(json, '$.deliverySeriesKey'), idempotency_key),
      coalesce(json_extract(json, '$.deliveryAttempt'), 1),
      status, state_version,
      json_set(
        json,
        '$.deliverySeriesKey', coalesce(json_extract(json, '$.deliverySeriesKey'), idempotency_key),
        '$.deliveryAttempt', coalesce(json_extract(json, '$.deliveryAttempt'), 1)
      ),
      created_at, updated_at
    from github_delivery_intents_v14;

    drop table github_delivery_intents_v14;

    create index idx_github_delivery_intents_run
      on github_delivery_intents(run_id, created_at, id);

    create index idx_github_delivery_intents_status
      on github_delivery_intents(status, updated_at, id);

    create index idx_github_delivery_intents_idempotency
      on github_delivery_intents(idempotency_key, created_at, id);

    create unique index idx_github_delivery_intents_active_scope
      on github_delivery_intents(run_id, node_id)
      where status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'recovery_required'
      );
      `)
    },
  },
  {
    version: 16,
    migrate(db) {
      db.run(`
    create table if not exists github_delivery_revocation_checks (
      intent_id text primary key,
      intent_updated_at text not null,
      binding_id text not null,
      binding_version integer not null,
      outcome_code text not null,
      checked_at text not null,
      state_version integer not null,
      json text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (length(trim(binding_id)) > 0 and length(binding_id) <= 200 and trim(binding_id) = binding_id),
      check (binding_version between 1 and 2147483647),
      check (outcome_code = 'binding_inactive'),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.bindingId') = binding_id),
      check (json_extract(json, '$.bindingVersion') = binding_version),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.checkedAt') = checked_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index if not exists idx_github_delivery_revocation_checks_checked
      on github_delivery_revocation_checks(checked_at, intent_id);
      `)
    },
  },
  {
    version: 17,
    migrate(db) {
      db.run(`
    drop table if exists github_delivery_revocation_checks;

    create table github_delivery_revocation_checks (
      intent_id text primary key,
      intent_updated_at text not null,
      binding_id text not null,
      binding_version integer not null,
      outcome_code text not null,
      checked_at text not null,
      state_version integer not null,
      json text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (length(trim(binding_id)) > 0 and length(binding_id) <= 200 and trim(binding_id) = binding_id),
      check (binding_version between 1 and 2147483647),
      check (outcome_code = 'binding_inactive'),
      check (state_version = 2),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.bindingId') = binding_id),
      check (json_extract(json, '$.bindingVersion') = binding_version),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.checkedAt') = checked_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index idx_github_delivery_revocation_checks_checked
      on github_delivery_revocation_checks(checked_at, intent_id);
      `)
    },
  },
  {
    version: 18,
    migrate(db) {
      db.run(`
    create table agent_runtimes (
      id text primary key,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      run_version integer not null,
      policy_version integer not null,
      context_digest text not null,
      capability_set_digest text not null,
      status text not null,
      stop_reason text,
      version integer not null,
      checkpoint_version integer not null,
      next_sequence integer not null,
      state_version integer not null,
      json text not null,
      requested_at text not null,
      started_at text not null,
      updated_at text not null,
      deadline text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (run_version between 1 and 2147483647),
      check (policy_version between 1 and 2147483647),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(capability_set_digest) = 64 and capability_set_digest not glob '*[^0-9a-f]*'),
      check (status in ('running', 'waiting_permission', 'waiting_action', 'checkpointed', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check ((status = 'terminal') = (stop_reason is not null)),
      check (version between 1 and 2147483647),
      check (checkpoint_version = version),
      check (next_sequence between 4 and 2147483647),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.scope.kind') = scope_kind),
      check (json_extract(json, '$.scope.organizationId') is organization_id),
      check (json_extract(json, '$.scope.projectId') is team_project_id),
      check (json_extract(json, '$.scope.userId') = user_id),
      check (json_extract(json, '$.scope.sessionId') = session_id),
      check (json_extract(json, '$.scope.localProjectId') = local_project_id),
      check (json_extract(json, '$.authority.runId') = run_id),
      check (json_extract(json, '$.authority.nodeId') = node_id),
      check (json_extract(json, '$.authority.runVersion') = run_version),
      check (json_extract(json, '$.authority.policyVersion') = policy_version),
      check (json_extract(json, '$.contextDigest') = context_digest),
      check (json_extract(json, '$.capabilitySetDigest') = capability_set_digest),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.stopReason') is stop_reason),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.nextSequence') = next_sequence),
      check (requested_at = json_extract(json, '$.requestedAt')),
      check (started_at = json_extract(json, '$.startedAt')),
      check (updated_at = json_extract(json, '$.updatedAt')),
      check (deadline = json_extract(json, '$.deadline')),
      check (started_at = requested_at and updated_at >= started_at and deadline > requested_at)
    );

    create index idx_agent_runtimes_run
      on agent_runtimes(run_id, node_id, updated_at, id);

    create index idx_agent_runtimes_recovery
      on agent_runtimes(status, updated_at, id);

    create table agent_runtime_events (
      runtime_id text not null,
      sequence integer not null,
      checkpoint_version integer not null,
      type text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (runtime_id, sequence),
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (sequence between 1 and 2147483647),
      check (checkpoint_version between 1 and 2147483647),
      check (type in (
        'runtime_started', 'context_attached', 'runtime_resumed',
        'decision_recorded', 'action_requested', 'permission_decided',
        'action_result', 'observation_recorded', 'evaluation_recorded',
        'checkpointed', 'runtime_stopped'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.sequence') = sequence),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.type') = type),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create index idx_agent_runtime_events_checkpoint
      on agent_runtime_events(runtime_id, checkpoint_version, sequence);

    create table agent_runtime_checkpoints (
      runtime_id text not null,
      version integer not null,
      runtime_version integer not null,
      status text not null,
      stop_reason text,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (runtime_id, version),
      unique (runtime_id, runtime_version),
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (runtime_version between 1 and 2147483647),
      check (status in ('running', 'waiting_permission', 'waiting_action', 'checkpointed', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check ((status = 'terminal') = (stop_reason is not null)),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.runtimeVersion') = runtime_version),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.stopReason') is stop_reason),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create table agent_runtime_evaluations (
      runtime_id text not null,
      sequence integer not null,
      checkpoint_version integer not null,
      evaluation text not null,
      summary text not null,
      event_json text not null,
      created_at text not null,
      primary key (runtime_id, sequence),
      foreign key (runtime_id, sequence)
        references agent_runtime_events(runtime_id, sequence) on delete cascade,
      check (evaluation in ('continue', 'success', 'failure')),
      check (length(summary) between 1 and 2000),
      check (json_valid(event_json)),
      check (json_extract(event_json, '$.type') = 'evaluation_recorded'),
      check (json_extract(event_json, '$.metadata.evaluation') = evaluation),
      check (json_extract(event_json, '$.metadata.summary') = summary),
      check (json_extract(event_json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(event_json, '$.createdAt') = created_at)
    );

    create table agent_runtime_capability_grants (
      id text primary key,
      runtime_id text not null,
      capability_id text not null,
      capability_version integer not null,
      request_digest text not null,
      status text not null,
      granted_at text not null,
      expires_at text not null,
      settled_at text,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(capability_id)) > 0 and length(capability_id) <= 200 and trim(capability_id) = capability_id),
      check (capability_version between 1 and 2147483647),
      check (length(request_digest) = 64 and request_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'consumed', 'denied', 'expired', 'cancelled')),
      check (expires_at > granted_at),
      check ((status = 'active') = (settled_at is null))
    );

    create unique index idx_agent_runtime_capability_grants_active
      on agent_runtime_capability_grants(runtime_id, capability_id)
      where status = 'active';

    create table agent_runtime_terminal_summaries (
      runtime_id text primary key,
      checkpoint_version integer not null,
      stop_reason text not null,
      state_version integer not null,
      json text not null,
      completed_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (checkpoint_version between 1 and 2147483647),
      check (stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.stopReason') = stop_reason),
      check (json_extract(json, '$.completedAt') = completed_at),
      check (json_extract(json, '$.redacted') = 1)
    );
      `)
    },
  },
  {
    version: 19,
    migrate(db) {
      db.run(`
    alter table agent_runtime_capability_grants
      add column permission_class text check (permission_class in ('read', 'edit', 'execute'));
    alter table agent_runtime_capability_grants
      add column resource_kind text check (resource_kind in ('local_project', 'managed_workspace'));
    alter table agent_runtime_capability_grants
      add column resource_id text check (
        resource_id is null or
        (length(trim(resource_id)) > 0 and length(resource_id) <= 200 and trim(resource_id) = resource_id)
      );

    create table agent_runtime_tool_audits (
      id text primary key,
      runtime_id text not null,
      action_id text not null,
      grant_id text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      local_project_id text not null,
      tool_id text not null,
      tool_version integer not null,
      permission_class text not null,
      side_effect_class text not null,
      resource_kind text not null,
      resource_id text not null,
      status text not null,
      code text,
      input_digest text not null,
      result_digest text,
      result_bytes integer,
      redaction_state text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      foreign key (grant_id) references agent_runtime_capability_grants(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(action_id)) > 0 and length(action_id) <= 200 and trim(action_id) = action_id),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      ),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(tool_id)) > 0 and length(tool_id) <= 200 and trim(tool_id) = tool_id),
      check (tool_version between 1 and 2147483647),
      check (permission_class in ('read', 'edit', 'execute')),
      check (side_effect_class in ('none', 'workspace_write', 'local_process')),
      check (resource_kind in ('local_project', 'managed_workspace')),
      check (length(trim(resource_id)) > 0 and length(resource_id) <= 200 and trim(resource_id) = resource_id),
      check (status in ('started', 'succeeded', 'failed', 'cancelled', 'timeout')),
      check (code is null or code in (
        'invalid_output', 'result_too_large', 'redaction_failed',
        'handler_failed', 'deadline_exceeded', 'cancelled'
      )),
      check (length(input_digest) = 64 and input_digest not glob '*[^0-9a-f]*'),
      check (result_digest is null or (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*')),
      check (result_bytes is null or result_bytes between 0 and 262144),
      check (redaction_state in ('not_recorded', 'passed', 'applied', 'failed')),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.actionId') = action_id),
      check (json_extract(json, '$.grantId') = grant_id),
      check (json_extract(json, '$.organizationId') is organization_id),
      check (json_extract(json, '$.projectId') is team_project_id),
      check (json_extract(json, '$.userId') = user_id),
      check (json_extract(json, '$.sessionId') = session_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.toolId') = tool_id),
      check (json_extract(json, '$.toolVersion') = tool_version),
      check (json_extract(json, '$.permissionClass') = permission_class),
      check (json_extract(json, '$.sideEffectClass') = side_effect_class),
      check (json_extract(json, '$.resourceKind') = resource_kind),
      check (json_extract(json, '$.resourceId') = resource_id),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.code') is code),
      check (json_extract(json, '$.inputDigest') = input_digest),
      check (json_extract(json, '$.resultDigest') is result_digest),
      check (json_extract(json, '$.resultBytes') is result_bytes),
      check (json_extract(json, '$.redactionState') = redaction_state),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create unique index idx_agent_runtime_tool_audits_started
      on agent_runtime_tool_audits(grant_id) where status = 'started';

    create unique index idx_agent_runtime_tool_audits_terminal
      on agent_runtime_tool_audits(grant_id) where status <> 'started';

    create index idx_agent_runtime_tool_audits_runtime
      on agent_runtime_tool_audits(runtime_id, created_at, id);
      `)
    },
  },
  {
    version: 20,
    migrate(db) {
      db.run(`
    update agent_runtime_tool_audits
       set json = json_set(
         json,
         '$.source', 'native',
         '$.installationId', json('null'),
         '$.installationVersion', json('null')
       );

    alter table agent_runtime_tool_audits
      add column source text not null default 'native'
      check (
        source in ('native', 'mcp') and
        json_extract(json, '$.source') = source
      );
    alter table agent_runtime_tool_audits
      add column installation_id text
      check (
        (installation_id is null or
          (length(trim(installation_id)) > 0 and length(installation_id) <= 200 and trim(installation_id) = installation_id)) and
        json_extract(json, '$.installationId') is installation_id
      );
    alter table agent_runtime_tool_audits
      add column installation_version integer
      check (
        (installation_version is null or installation_version between 1 and 2147483647) and
        json_extract(json, '$.installationVersion') is installation_version and
        (
          (source = 'native' and installation_id is null and installation_version is null) or
          (source = 'mcp' and installation_id is not null and installation_version is not null)
        )
      );

    create table local_mcp_installations (
      id text primary key,
      version integer not null,
      enabled integer not null,
      transport text not null,
      executable_sha256 text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (version between 1 and 2147483647),
      check (enabled in (0, 1)),
      check (transport = 'stdio'),
      check (length(executable_sha256) = 64 and executable_sha256 not glob '*[^0-9a-f]*'),
      check (state_version = 1),
      check (updated_at >= created_at),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.enabled') = enabled),
      check (json_extract(json, '$.transport') = transport),
      check (json_extract(json, '$.executableSha256') = executable_sha256),
      check (json_extract(json, '$.createdAt') = created_at),
      check (json_extract(json, '$.updatedAt') = updated_at)
    );

    create index idx_local_mcp_installations_enabled
      on local_mcp_installations(enabled, id);
      `)
    },
  },
  {
    version: 21,
    migrate(db) {
      db.run(`
    drop index if exists idx_remote_sync_outbox_due;
    alter table remote_sync_outbox rename to remote_sync_outbox_v20;

    create table remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    insert into remote_sync_outbox (
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    )
    select
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    from remote_sync_outbox_v20;

    drop table remote_sync_outbox_v20;

    create index idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 22,
    migrate(db) {
      db.run(`
    create table knowledge_index_snapshots (
      id text primary key,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      snapshot_hash text not null,
      embedding_model_id text not null,
      embedding_model_version text not null,
      vector_dimensions integer not null,
      status text not null,
      state_version integer not null,
      created_at text not null,
      updated_at text not null,
      activated_at text,
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      ),
      check (organization_id is null or (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id)),
      check (team_project_id is null or (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id)),
      check (
        length(snapshot_hash) = 71 and
        substr(snapshot_hash, 1, 7) = 'sha256:' and
        substr(snapshot_hash, 8) not glob '*[^0-9a-f]*'
      ),
      check (length(trim(embedding_model_id)) > 0 and length(embedding_model_id) <= 200 and trim(embedding_model_id) = embedding_model_id),
      check (length(trim(embedding_model_version)) > 0 and length(embedding_model_version) <= 200 and trim(embedding_model_version) = embedding_model_version),
      check (vector_dimensions between 1 and 4096),
      check (status in ('building', 'current', 'superseded', 'failed')),
      check (state_version = 1),
      check (updated_at >= created_at),
      check (
        (status in ('current', 'superseded') and activated_at is not null) or
        (status in ('building', 'failed') and activated_at is null)
      )
    );

    create unique index idx_knowledge_index_snapshots_current
      on knowledge_index_snapshots(local_project_id)
      where status = 'current';
    create index idx_knowledge_index_snapshots_scope
      on knowledge_index_snapshots(organization_id, team_project_id, local_project_id, created_at);

    create table knowledge_index_chunks (
      snapshot_id text not null,
      document_id text not null,
      chunk_id text not null,
      source_path text not null,
      heading_path_json text not null,
      content_hash text not null,
      content_text text not null,
      ordinal integer not null,
      state_version integer not null,
      primary key (snapshot_id, chunk_id),
      unique (snapshot_id, document_id, chunk_id, content_hash),
      foreign key (snapshot_id) references knowledge_index_snapshots(id) on delete cascade,
      check (length(trim(document_id)) > 0 and length(document_id) <= 200 and trim(document_id) = document_id),
      check (length(trim(chunk_id)) > 0 and length(chunk_id) <= 200 and trim(chunk_id) = chunk_id),
      check (length(trim(source_path)) > 0 and length(source_path) <= 500 and trim(source_path) = source_path),
      check (substr(source_path, 1, 1) <> '/' and instr(source_path, '\\') = 0 and instr(source_path, '//') = 0),
      check (json_valid(heading_path_json) and json_type(heading_path_json) = 'array' and json_array_length(heading_path_json) > 0),
      check (length(trim(content_hash)) > 0 and length(content_hash) <= 200 and trim(content_hash) = content_hash),
      check (length(content_text) between 1 and 65536 and trim(content_text) = content_text),
      check (ordinal between 0 and 2147483647),
      check (state_version = 1)
    );

    create index idx_knowledge_index_chunks_document
      on knowledge_index_chunks(snapshot_id, document_id, ordinal, chunk_id);

    create table knowledge_index_vectors (
      snapshot_id text not null,
      chunk_id text not null,
      model_id text not null,
      model_version text not null,
      vector_dimensions integer not null,
      vector_json text not null,
      created_at text not null,
      primary key (snapshot_id, chunk_id),
      foreign key (snapshot_id, chunk_id)
        references knowledge_index_chunks(snapshot_id, chunk_id) on delete cascade,
      check (length(trim(model_id)) > 0 and length(model_id) <= 200 and trim(model_id) = model_id),
      check (length(trim(model_version)) > 0 and length(model_version) <= 200 and trim(model_version) = model_version),
      check (vector_dimensions between 1 and 4096),
      check (
        json_valid(vector_json) and
        json_type(vector_json) = 'array' and
        json_array_length(vector_json) = vector_dimensions
      )
    );

    create table knowledge_citations (
      id text primary key,
      snapshot_id text not null,
      request_id text not null,
      document_id text not null,
      chunk_id text not null,
      content_hash text not null,
      strategy_chain_json text not null,
      rank integer not null,
      score real not null,
      state_version integer not null,
      cited_at text not null,
      foreign key (snapshot_id, document_id, chunk_id, content_hash)
        references knowledge_index_chunks(snapshot_id, document_id, chunk_id, content_hash)
        on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(request_id)) > 0 and length(request_id) <= 200 and trim(request_id) = request_id),
      check (json_valid(strategy_chain_json) and json_type(strategy_chain_json) = 'array' and json_array_length(strategy_chain_json) between 1 and 4),
      check (rank between 1 and 20),
      check (score between 0 and 1),
      check (state_version = 1)
    );

    create index idx_knowledge_citations_request
      on knowledge_citations(request_id, rank, id);
      `)
    },
  },
  {
    version: 23,
    migrate(db) {
      db.run(`
    create table agent_memory_candidates (
      id text primary key,
      scope_kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      runtime_id text not null,
      action_id text not null,
      checkpoint_version integer not null,
      observation_sequence integer not null,
      result_digest text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      unique (local_project_id, provenance_digest, content_digest),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (organization_id is null or (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id)),
      check (team_project_id is null or (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id)),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (length(trim(action_id)) > 0 and length(action_id) <= 200 and trim(action_id) = action_id),
      check (checkpoint_version between 1 and 2147483647),
      check (observation_sequence between 1 and 2147483647),
      check (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (status = 'candidate'),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.scope.kind') = scope_kind),
      check (json_extract(json, '$.scope.localProjectId') = local_project_id),
      check (json_extract(json, '$.scope.organizationId') is organization_id),
      check (json_extract(json, '$.scope.projectId') is team_project_id),
      check (json_extract(json, '$.scope.userId') = user_id),
      check (json_extract(json, '$.scope.sessionId') = session_id),
      check (json_extract(json, '$.provenance.runtimeId') = runtime_id),
      check (json_extract(json, '$.provenance.actionId') = action_id),
      check (json_extract(json, '$.provenance.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.provenance.sequence') = observation_sequence),
      check (json_extract(json, '$.provenance.resultDigest') = result_digest),
      check (json_extract(json, '$.statement') = statement),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create index idx_agent_memory_candidates_scope
      on agent_memory_candidates(
        organization_id, team_project_id, user_id, session_id, local_project_id, created_at, id
      );
      `)
    },
  },
  {
    version: 24,
    migrate(db) {
      db.run(`
    create table agent_memory_revisions (
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      visibility text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      source_candidate_id text not null unique,
      supersedes_revision integer,
      sensitivity text not null,
      retention_class text not null,
      expires_at text,
      promotion_decision_id text not null unique,
      promotion_actor_kind text not null,
      promotion_actor_id text not null,
      promotion_policy_id text not null,
      promotion_policy_version integer not null,
      promotion_authority_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (memory_id, revision),
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      foreign key (source_candidate_id) references agent_memory_candidates(id),
      check (length(trim(memory_id)) > 0 and length(memory_id) <= 200 and trim(memory_id) = memory_id),
      check (revision between 1 and 2147483647),
      check (
        (revision = 1 and supersedes_revision is null) or
        (revision > 1 and supersedes_revision = revision - 1)
      ),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (visibility in ('runtime', 'user_project', 'project_shared')),
      check (visibility <> 'project_shared' or scope_kind = 'team'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (sensitivity in ('private', 'internal')),
      check (retention_class in ('session', 'thirty_days', 'until_deleted')),
      check (
        (retention_class = 'until_deleted' and expires_at is null) or
        (retention_class <> 'until_deleted' and expires_at is not null and expires_at > created_at)
      ),
      check (promotion_actor_kind in ('human', 'policy')),
      check (promotion_policy_version between 1 and 2147483647),
      check (length(promotion_authority_digest) = 64 and promotion_authority_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'conflict')),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = memory_id),
      check (json_extract(json, '$.revision') = revision),
      check (json_extract(json, '$.sourceCandidateId') = source_candidate_id),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create table agent_memory_heads (
      memory_id text primary key,
      current_revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      status text not null,
      version integer not null,
      updated_at text not null,
      foreign key (memory_id, current_revision)
        references agent_memory_revisions(memory_id, revision),
      check (current_revision between 1 and 2147483647),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (status in ('active', 'conflict', 'expired', 'purge_pending', 'deleted')),
      check (version between 1 and 2147483647)
    );

    create index idx_agent_memory_heads_scope
      on agent_memory_heads(
        organization_id, team_project_id, user_id, session_id, local_project_id, status, memory_id
      );

    create table agent_memory_tombstones (
      memory_id text primary key,
      deletion_version integer not null,
      last_revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      actor_kind text not null,
      actor_id text not null,
      authority_digest text not null,
      purge_status text not null,
      state_version integer not null,
      json text not null,
      deleted_at text not null,
      purged_at text,
      foreign key (memory_id, last_revision)
        references agent_memory_revisions(memory_id, revision),
      check (deletion_version between 1 and 2147483647),
      check (last_revision between 1 and 2147483647),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (actor_kind in ('human', 'policy')),
      check (length(authority_digest) = 64 and authority_digest not glob '*[^0-9a-f]*'),
      check (purge_status in ('pending', 'completed')),
      check (
        (purge_status = 'pending' and purged_at is null) or
        (purge_status = 'completed' and purged_at is not null and purged_at >= deleted_at)
      ),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object')
    );

    create table agent_memory_index_entries (
      memory_id text not null,
      revision integer not null,
      model_id text not null,
      model_version text not null,
      vector_dimensions integer not null,
      vector_json text not null,
      created_at text not null,
      primary key (memory_id, revision, model_id, model_version),
      foreign key (memory_id, revision)
        references agent_memory_revisions(memory_id, revision) on delete cascade,
      check (vector_dimensions between 1 and 4096),
      check (
        json_valid(vector_json) and json_type(vector_json) = 'array' and
        json_array_length(vector_json) = vector_dimensions
      )
    );

    create table agent_memory_audits (
      id text primary key,
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      event_kind text not null,
      actor_kind text not null,
      actor_id text not null,
      authority_digest text not null,
      state_version integer not null,
      metadata_json text not null,
      created_at text not null,
      foreign key (memory_id, revision)
        references agent_memory_revisions(memory_id, revision),
      check (event_kind in (
        'candidate_promoted', 'memory_revised', 'conflict_recorded',
        'memory_expired', 'memory_deleted', 'purge_completed'
      )),
      check (actor_kind in ('human', 'policy', 'system')),
      check (length(authority_digest) = 64 and authority_digest not glob '*[^0-9a-f]*'),
      check (state_version = 1),
      check (json_valid(metadata_json) and json_type(metadata_json) = 'object')
    );

    create index idx_agent_memory_audits_memory
      on agent_memory_audits(memory_id, revision, created_at, id);
      `)
    },
  },
  {
    version: 25,
    migrate(db) {
      db.run('pragma legacy_alter_table = on')
      try {
        db.run(`
    alter table agent_memory_revisions rename to agent_memory_revisions_v24;

    create table agent_memory_revisions (
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      visibility text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      source_candidate_id text not null,
      supersedes_revision integer,
      sensitivity text not null,
      retention_class text not null,
      expires_at text,
      promotion_decision_id text not null unique,
      promotion_actor_kind text not null,
      promotion_actor_id text not null,
      promotion_policy_id text not null,
      promotion_policy_version integer not null,
      promotion_authority_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (memory_id, revision),
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      foreign key (source_candidate_id) references agent_memory_candidates(id),
      check (length(trim(memory_id)) > 0 and length(memory_id) <= 200 and trim(memory_id) = memory_id),
      check (revision between 1 and 2147483647),
      check (
        (revision = 1 and supersedes_revision is null) or
        (revision > 1 and supersedes_revision = revision - 1)
      ),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (visibility in ('runtime', 'user_project', 'project_shared')),
      check (visibility <> 'project_shared' or scope_kind = 'team'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (sensitivity in ('private', 'internal')),
      check (retention_class in ('session', 'thirty_days', 'until_deleted')),
      check (
        (retention_class = 'until_deleted' and expires_at is null) or
        (retention_class <> 'until_deleted' and expires_at is not null and expires_at > created_at)
      ),
      check (promotion_actor_kind in ('human', 'policy')),
      check (promotion_policy_version between 1 and 2147483647),
      check (length(promotion_authority_digest) = 64 and promotion_authority_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'conflict')),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = memory_id),
      check (json_extract(json, '$.revision') = revision),
      check (json_extract(json, '$.sourceCandidateId') = source_candidate_id),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    insert into agent_memory_revisions (
      memory_id, revision, local_project_id, scope_kind, organization_id,
      team_project_id, user_id, session_id, visibility, statement,
      content_digest, provenance_digest, source_candidate_id, supersedes_revision,
      sensitivity, retention_class, expires_at, promotion_decision_id,
      promotion_actor_kind, promotion_actor_id, promotion_policy_id,
      promotion_policy_version, promotion_authority_digest, status,
      state_version, json, created_at
    )
    select
      memory_id, revision, local_project_id, scope_kind, organization_id,
      team_project_id, user_id, session_id, visibility, statement,
      content_digest, provenance_digest, source_candidate_id, supersedes_revision,
      sensitivity, retention_class, expires_at, promotion_decision_id,
      promotion_actor_kind, promotion_actor_id, promotion_policy_id,
      promotion_policy_version, promotion_authority_digest, status,
      state_version, json, created_at
    from agent_memory_revisions_v24;

    drop table agent_memory_revisions_v24;
        `)
      } finally {
        db.run('pragma legacy_alter_table = off')
      }
    },
  },
  {
    version: 26,
    migrate(db) {
      db.run(`
    create table agent_runtime_context_attachments (
      id text primary key,
      runtime_id text not null unique,
      checkpoint_version integer not null,
      context_digest text not null unique,
      knowledge_identity_digest text not null,
      memory_identity_digest text not null,
      knowledge_citation_count integer not null,
      memory_revision_count integer not null,
      state_version integer not null,
      json text not null,
      attached_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (checkpoint_version between 1 and 2147483647),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(knowledge_identity_digest) = 64 and knowledge_identity_digest not glob '*[^0-9a-f]*'),
      check (length(memory_identity_digest) = 64 and memory_identity_digest not glob '*[^0-9a-f]*'),
      check (knowledge_citation_count between 0 and 20),
      check (memory_revision_count between 0 and 32),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (length(cast(json as blob)) <= 524288),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.contextDigest') = context_digest),
      check (json_extract(json, '$.knowledgeIdentityDigest') = knowledge_identity_digest),
      check (json_extract(json, '$.memoryIdentityDigest') = memory_identity_digest),
      check (json_array_length(json_extract(json, '$.knowledgeCitations')) = knowledge_citation_count),
      check (json_array_length(json_extract(json, '$.memoryRevisions')) = memory_revision_count),
      check (json_extract(json, '$.attachedAt') = attached_at)
    );

    create index idx_agent_runtime_context_attachments_attached
      on agent_runtime_context_attachments(attached_at, runtime_id);
      `)
    },
  },
  {
    version: 27,
    migrate(db) {
      db.run(`
    drop index if exists idx_remote_sync_outbox_due;
    alter table remote_sync_outbox rename to remote_sync_outbox_v26;

    create table remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary', 'agent-memory-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    insert into remote_sync_outbox (
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    )
    select
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    from remote_sync_outbox_v26;

    drop table remote_sync_outbox_v26;

    create index idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 28,
    migrate(db) {
      db.run(`
    create table agent_coordination_sessions (
      id text primary key,
      contract_version integer not null,
      local_project_id text not null,
      organization_id text not null,
      team_project_id text not null,
      user_id text not null,
      scope_session_id text not null,
      run_id text not null,
      node_id text not null,
      supervisor_runtime_id text not null,
      graph_id text not null unique,
      graph_version integer not null,
      version integer not null,
      status text not null,
      stop_reason text,
      context_digest text not null,
      capability_set_digest text not null,
      request_json text not null,
      state_json text not null,
      requested_at text not null,
      started_at text not null,
      updated_at text not null,
      deadline text not null,
      foreign key (local_project_id) references local_projects(id) on delete restrict,
      foreign key (run_id) references workflow_runs(id) on delete restrict,
      foreign key (supervisor_runtime_id) references agent_runtimes(id) on delete restrict,
      check (contract_version = 1),
      check (graph_version between 1 and 2147483647),
      check (version between 1 and 2147483647),
      check (status in ('running', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout', 'budget_exhausted',
        'policy_denied', 'blocked_dependency'
      )),
      check (
        (status = 'running' and stop_reason is null) or
        (status = 'terminal' and stop_reason is not null)
      ),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(capability_set_digest) = 64 and capability_set_digest not glob '*[^0-9a-f]*'),
      check (json_valid(request_json) and json_type(request_json) = 'object'),
      check (json_valid(state_json) and json_type(state_json) = 'object'),
      check (length(cast(request_json as blob)) <= 262144),
      check (length(cast(state_json as blob)) <= 262144),
      check (requested_at <= started_at and started_at <= updated_at and updated_at < deadline)
    );

    create index idx_agent_coordination_sessions_scope
      on agent_coordination_sessions(
        organization_id, team_project_id, user_id, scope_session_id,
        local_project_id, run_id, status, id
      );

    create table agent_coordination_graphs (
      id text primary key,
      coordination_id text not null unique,
      version integer not null,
      node_count integer not null,
      edge_count integer not null,
      graph_json text not null,
      created_at text not null,
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (node_count between 1 and 12),
      check (edge_count between 0 and 24),
      check (json_valid(graph_json) and json_type(graph_json) = 'object'),
      check (length(cast(graph_json as blob)) <= 262144)
    );

    create table agent_coordination_tasks (
      coordination_id text not null,
      task_id text not null,
      graph_id text not null,
      role_id text not null,
      version integer not null,
      status text not null,
      agent_id text,
      runtime_id text,
      runtime_version integer,
      state_json text not null,
      updated_at text not null,
      primary key (coordination_id, task_id),
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      foreign key (graph_id) references agent_coordination_graphs(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (status in ('pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
      check (
        (runtime_id is null and runtime_version is null) or
        (runtime_id is not null and runtime_version between 1 and 2147483647)
      ),
      check (json_valid(state_json) and json_type(state_json) = 'object'),
      check (length(cast(state_json as blob)) <= 65536)
    );

    create index idx_agent_coordination_tasks_status
      on agent_coordination_tasks(coordination_id, status, task_id);

    create table agent_coordination_handoffs (
      id text primary key,
      coordination_id text not null,
      sequence integer not null,
      source_task_id text not null,
      target_task_id text not null,
      result_digest text not null,
      handoff_json text not null,
      created_at text not null,
      foreign key (coordination_id, source_task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      foreign key (coordination_id, target_task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      unique (coordination_id, sequence),
      check (sequence between 1 and 16),
      check (source_task_id <> target_task_id),
      check (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*'),
      check (json_valid(handoff_json) and json_type(handoff_json) = 'object'),
      check (length(cast(handoff_json as blob)) <= 65536)
    );

    create table agent_coordination_leases (
      id text primary key,
      coordination_id text not null,
      task_id text not null,
      resource_id text not null,
      resource_digest text not null,
      mode text not null,
      status text not null,
      version integer not null,
      lease_json text not null,
      acquired_at text not null,
      expires_at text not null,
      released_at text,
      foreign key (coordination_id, task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      check (mode in ('read', 'write')),
      check (status in ('active', 'released', 'expired', 'cancelled')),
      check (version between 1 and 2147483647),
      check (length(resource_digest) = 64 and resource_digest not glob '*[^0-9a-f]*'),
      check (json_valid(lease_json) and json_type(lease_json) = 'object'),
      check (length(cast(lease_json as blob)) <= 65536),
      check (acquired_at < expires_at),
      check (
        (status = 'active' and released_at is null) or
        (status <> 'active' and released_at is not null and released_at >= acquired_at)
      )
    );

    create index idx_agent_coordination_leases_resource
      on agent_coordination_leases(coordination_id, resource_id, status, mode, id);

    create table agent_coordination_audits (
      id text primary key,
      coordination_id text not null,
      task_id text,
      event_kind text not null,
      session_version integer not null,
      metadata_json text not null,
      created_at text not null,
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      foreign key (coordination_id, task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      check (session_version between 1 and 2147483647),
      check (json_valid(metadata_json) and json_type(metadata_json) = 'object'),
      check (length(cast(metadata_json as blob)) <= 65536)
    );

    create index idx_agent_coordination_audits_session
      on agent_coordination_audits(coordination_id, created_at, id);

    create table agent_coordination_checkpoints (
      coordination_id text not null,
      checkpoint_version integer not null,
      session_version integer not null,
      graph_version integer not null,
      checkpoint_json text not null,
      created_at text not null,
      primary key (coordination_id, checkpoint_version),
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      check (checkpoint_version between 1 and 2147483647),
      check (session_version between 1 and 2147483647),
      check (graph_version between 1 and 2147483647),
      check (json_valid(checkpoint_json) and json_type(checkpoint_json) = 'object'),
      check (length(cast(checkpoint_json as blob)) <= 262144)
    );
      `)
    },
  },
]

function migrateSchema(db: Database) {
  const schemaMetaExists = Boolean(
    db.exec("select name from sqlite_master where type = 'table' and name = 'schema_meta'")[0]
      ?.values.length,
  )
  const existingVersion = schemaMetaExists ? readSchemaVersion(db) : 0
  if (existingVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `DevFlow local database schema version ${existingVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    )
  }

  for (const migration of schemaMigrations) {
    if (migration.version <= existingVersion) {
      continue
    }

    db.run('begin transaction')
    try {
      migration.migrate(db)
      db.run(
        `insert into schema_meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value`,
        [String(migration.version)],
      )
      db.run('commit')
    } catch (error) {
      db.run('rollback')
      throw error
    }
  }

  db.run('begin transaction')
  try {
    redactStoredEvidencePrivacy(db)
    db.run('commit')
  } catch (error) {
    db.run('rollback')
    throw error
  }
}

function readSchemaVersion(db: Database): number {
  const result = db.exec("select value from schema_meta where key = 'schema_version'")
  const value = result[0]?.values[0]?.[0]
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('DevFlow local database schema version is missing or invalid')
  }

  return parsed
}

function parseJsonRows<T>(rows: SqlValue[][]): T[] {
  return rows.map((row) => JSON.parse(String(row[0])) as T)
}

function selectJson<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const result = db.exec(sql, params)
  const first = result[0]
  if (!first) {
    return []
  }

  return parseJsonRows<T>(first.values)
}

function selectStringColumn(db: Database, sql: string, params: SqlValue[] = []): string[] {
  const result = db.exec(sql, params)
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => String(row[0]))
}

function parseStoredAgentRuntime(value: unknown): AgentRuntimeState {
  try {
    return parseAgentRuntimeState(value)
  } catch {
    throw new Error('Stored Agent Runtime state is invalid')
  }
}

function parseStoredAgentRuntimeEvent(value: unknown): AgentRuntimeEvent {
  try {
    return parseAgentRuntimeEvent(value)
  } catch {
    throw new Error('Stored Agent Runtime event is invalid')
  }
}

function parseStoredAgentCheckpoint(value: unknown): AgentCheckpoint {
  try {
    return parseAgentCheckpoint(value)
  } catch {
    throw new Error('Stored Agent Runtime checkpoint is invalid')
  }
}

function parseAgentRuntimeCapabilityGrant(value: unknown): AgentRuntimeCapabilityGrant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_agent_runtime_capability_grant')
  }
  const grant = value as Record<string, unknown>
  const expectedKeys = [
    'stateVersion',
    'id',
    'runtimeId',
    'capabilityId',
    'capabilityVersion',
    'requestDigest',
    'permissionClass',
    'resourceKind',
    'resourceId',
    'status',
    'grantedAt',
    'expiresAt',
    'settledAt',
  ].sort()
  const keys = Object.keys(grant).sort()
  if (
    keys.length !== expectedKeys.length ||
    !keys.every((key, index) => key === expectedKeys[index]) ||
    grant.stateVersion !== 1 ||
    !isNonEmptyIdentifier(grant.id) ||
    grant.id.length > 200 ||
    !isNonEmptyIdentifier(grant.runtimeId) ||
    grant.runtimeId.length > 200 ||
    !isNonEmptyIdentifier(grant.capabilityId) ||
    grant.capabilityId.length > 200 ||
    !Number.isInteger(grant.capabilityVersion) ||
    Number(grant.capabilityVersion) < 1 ||
    Number(grant.capabilityVersion) > 2_147_483_647 ||
    typeof grant.requestDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(grant.requestDigest) ||
    !['read', 'edit', 'execute'].includes(String(grant.permissionClass)) ||
    !['local_project', 'managed_workspace'].includes(String(grant.resourceKind)) ||
    !isNonEmptyIdentifier(grant.resourceId) ||
    grant.resourceId.length > 200 ||
    !['active', 'consumed', 'denied', 'expired', 'cancelled'].includes(String(grant.status)) ||
    !isCanonicalIsoTimestamp(grant.grantedAt) ||
    !isCanonicalIsoTimestamp(grant.expiresAt) ||
    Date.parse(grant.expiresAt) <= Date.parse(grant.grantedAt) ||
    !(
      (grant.status === 'active' && grant.settledAt === null) ||
      (grant.status !== 'active' &&
        isCanonicalIsoTimestamp(grant.settledAt) &&
        Date.parse(grant.settledAt) >= Date.parse(grant.grantedAt))
    )
  ) {
    throw new Error('invalid_agent_runtime_capability_grant')
  }
  return JSON.parse(JSON.stringify(grant)) as AgentRuntimeCapabilityGrant
}

function sameNativeToolAuditIdentity(
  started: NativeToolAuditRecord,
  terminal: NativeToolAuditRecord,
): boolean {
  return (
    started.runtimeId === terminal.runtimeId &&
    started.actionId === terminal.actionId &&
    started.grantId === terminal.grantId &&
    started.organizationId === terminal.organizationId &&
    started.projectId === terminal.projectId &&
    started.userId === terminal.userId &&
    started.sessionId === terminal.sessionId &&
    started.localProjectId === terminal.localProjectId &&
    started.toolId === terminal.toolId &&
    started.toolVersion === terminal.toolVersion &&
    started.source === terminal.source &&
    started.installationId === terminal.installationId &&
    started.installationVersion === terminal.installationVersion &&
    started.permissionClass === terminal.permissionClass &&
    started.sideEffectClass === terminal.sideEffectClass &&
    started.resourceKind === terminal.resourceKind &&
    started.resourceId === terminal.resourceId &&
    started.inputDigest === terminal.inputDigest
  )
}

function writeNativeToolAudit(db: Database, value: NativeToolAuditRecord): void {
  const audit = parseNativeToolAuditRecord(value)
  db.run(
    `insert into agent_runtime_tool_audits (
       id, runtime_id, action_id, grant_id, organization_id, team_project_id,
       user_id, session_id, local_project_id, tool_id, tool_version,
       source, installation_id, installation_version,
       permission_class, side_effect_class, resource_kind, resource_id,
       status, code, input_digest, result_digest, result_bytes,
       redaction_state, state_version, json, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      audit.id,
      audit.runtimeId,
      audit.actionId,
      audit.grantId,
      audit.organizationId,
      audit.projectId,
      audit.userId,
      audit.sessionId,
      audit.localProjectId,
      audit.toolId,
      audit.toolVersion,
      audit.source,
      audit.installationId,
      audit.installationVersion,
      audit.permissionClass,
      audit.sideEffectClass,
      audit.resourceKind,
      audit.resourceId,
      audit.status,
      audit.code,
      audit.inputDigest,
      audit.resultDigest,
      audit.resultBytes,
      audit.redactionState,
      audit.stateVersion,
      JSON.stringify(audit),
      audit.createdAt,
    ],
  )
}

function selectAgentRuntime(
  db: Database,
  runtimeId: string,
): AgentRuntimeState | null {
  const value = selectJson<unknown>(
    db,
    'select json from agent_runtimes where id = ? limit 1',
    [runtimeId],
  )[0]
  return value === undefined ? null : parseStoredAgentRuntime(value)
}

function coordinationStartAuditId(coordinationId: string): string {
  return `coordination-audit-${createHash('sha256').update(coordinationId).digest('hex').slice(0, 32)}-1`
}

function coordinationStartAuditMetadata(
  graph: AgentTaskGraph,
): Record<string, string | number> {
  return {
    stateVersion: 1,
    graphId: graph.id,
    graphVersion: graph.version,
    taskCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  }
}

function coordinationTransitionAuditId(
  coordinationId: string,
  sessionVersion: number,
): string {
  return `coordination-audit-${createHash('sha256').update(coordinationId).digest('hex').slice(0, 32)}-${sessionVersion}`
}

function coordinationTaskStartedAuditMetadata(
  allocation: SpecialistAllocationRequest,
  state: CoordinationSessionState,
): Record<string, string | number> {
  const task = state.tasks.find((candidate) => candidate.id === allocation.taskId)
  if (task === undefined || task.agentId === null || task.runtimeId === null || task.runtimeVersion === null) {
    throw new Error('invalid_coordination_task_start_audit')
  }
  return {
    stateVersion: 1,
    allocationId: allocation.id,
    taskId: task.id,
    taskVersion: task.version,
    agentId: task.agentId,
    runtimeId: task.runtimeId,
    runtimeVersion: task.runtimeVersion,
  }
}

function coordinationSessionCancelledAuditMetadata(
  previous: CoordinationSessionState,
): Record<string, string | number> {
  return {
    stateVersion: 1,
    runtimeCount: previous.tasks.filter((task) =>
      task.status === 'running' && task.runtimeId !== null
    ).length,
  }
}

function coordinationTaskResultAuditMetadata(
  input: CommitCoordinationTaskResultInput,
  state: CoordinationSessionState,
): Record<string, string | number | null> {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId)
  if (task === undefined || task.runtimeId === null || task.runtimeVersion === null) {
    throw new Error('invalid_coordination_task_result_audit')
  }
  return {
    stateVersion: 1,
    taskId: task.id,
    taskVersion: task.version,
    runtimeId: task.runtimeId,
    runtimeVersion: task.runtimeVersion,
    status: task.status,
    resultDigest: task.resultDigest,
    failureCategory: task.failure?.category ?? null,
    failureCode: task.failure?.code ?? null,
    steps: input.usage.steps,
    toolCalls: input.usage.toolCalls,
    tokens: input.usage.tokens,
    costUsd: input.usage.costUsd,
  }
}

function specialistRuntimeFailure(
  currentRuntime: AgentRuntimeState,
  transition: AgentRuntimeTransition,
  taskId: string,
): CoordinationTaskFailure | null {
  const stopReason = transition.runtime.stopReason
  if (stopReason === 'timeout') {
    return { category: 'timeout', code: 'specialist_runtime_timeout', sourceTaskId: taskId }
  }
  if (stopReason === 'step_limit' || stopReason === 'budget_exhausted') {
    return {
      category: 'budget_exhausted',
      code: 'specialist_budget_exhausted',
      sourceTaskId: taskId,
    }
  }
  if (stopReason === 'policy_denied') {
    return {
      category: 'policy_denied',
      code: 'specialist_policy_denied',
      sourceTaskId: taskId,
    }
  }
  if (stopReason !== 'failure') return null
  const resultTooLarge = transition.events.some((event) =>
    event.type === 'runtime_stopped' && event.metadata.failureCode === 'result_too_large')
  if (resultTooLarge) {
    return {
      category: 'invalid_result',
      code: 'specialist_result_too_large',
      sourceTaskId: taskId,
    }
  }
  if (currentRuntime.activeAction?.kind === 'tool') {
    return { category: 'tool_error', code: 'specialist_tool_failed', sourceTaskId: taskId }
  }
  if (currentRuntime.activeAction?.kind === 'coding_executor') {
    return {
      category: 'coding_executor_error',
      code: 'specialist_coding_executor_failed',
      sourceTaskId: taskId,
    }
  }
  return { category: 'invalid_result', code: 'specialist_runtime_failed', sourceTaskId: taskId }
}

function matchesSpecialistRuntimeFailure(
  stopReason: AgentRuntimeStopReason | null,
  failure: CoordinationTaskFailure | null,
): boolean {
  if (failure === null) return false
  if (stopReason === 'timeout') {
    return failure.category === 'timeout' && failure.code === 'specialist_runtime_timeout'
  }
  if (stopReason === 'step_limit' || stopReason === 'budget_exhausted') {
    return failure.category === 'budget_exhausted' &&
      failure.code === 'specialist_budget_exhausted'
  }
  if (stopReason === 'policy_denied') {
    return failure.category === 'policy_denied' && failure.code === 'specialist_policy_denied'
  }
  if (stopReason !== 'failure') return false
  return (
    failure.category === 'tool_error' && failure.code === 'specialist_tool_failed'
  ) || (
    failure.category === 'coding_executor_error' &&
    failure.code === 'specialist_coding_executor_failed'
  ) || (
    failure.category === 'invalid_result' &&
    (failure.code === 'specialist_result_too_large' ||
      failure.code === 'specialist_runtime_failed')
  )
}

function coordinationTaskRetryAuditMetadata(input: {
  recoveryId: string
  taskId: string
  failedRuntimeId: string
  failedRuntimeVersion: number
  replacementRuntimeId: string
  replacementRuntimeVersion: number
  failure: CoordinationTaskFailure
  usage: CoordinationUsageDelta
}, state: CoordinationSessionState): Record<string, string | number> {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId)
  if (
    task === undefined ||
    task.status !== 'running' ||
    task.runtimeId !== input.replacementRuntimeId ||
    task.runtimeVersion !== input.replacementRuntimeVersion
  ) throw new Error('invalid_coordination_task_retry_audit')
  return {
    stateVersion: 1,
    recoveryId: input.recoveryId,
    taskId: input.taskId,
    taskVersion: task.version,
    failedRuntimeId: input.failedRuntimeId,
    failedRuntimeVersion: input.failedRuntimeVersion,
    replacementRuntimeId: input.replacementRuntimeId,
    replacementRuntimeVersion: input.replacementRuntimeVersion,
    failureCategory: input.failure.category,
    failureCode: input.failure.code,
    steps: input.usage.steps,
    toolCalls: input.usage.toolCalls,
    tokens: input.usage.tokens,
    costUsd: input.usage.costUsd,
  }
}

function coordinationHandoffAuditMetadata(
  handoff: AgentHandoff,
  state: CoordinationSessionState,
): Record<string, string | number> {
  const targetTask = state.tasks.find((candidate) => candidate.id === handoff.targetTaskId)
  if (targetTask === undefined) throw new Error('invalid_coordination_handoff_audit')
  return {
    stateVersion: 1,
    handoffId: handoff.id,
    sequence: handoff.sequence,
    sourceTaskId: handoff.sourceTaskId,
    sourceTaskVersion: handoff.sourceTaskVersion,
    targetTaskId: handoff.targetTaskId,
    targetTaskVersion: targetTask.version,
    targetStatus: targetTask.status,
    resultDigest: handoff.resultDigest,
  }
}

function selectAgentCoordinationHandoffs(
  db: Database,
  coordinationId: string,
): AgentHandoff[] {
  const rows = db.exec(
    `select id, coordination_id, sequence, source_task_id, target_task_id,
            result_digest, handoff_json, created_at
     from agent_coordination_handoffs
     where coordination_id = ? order by sequence asc`,
    [coordinationId],
  )[0]?.values ?? []
  return rows.map((row) => {
    let value: unknown
    try {
      value = JSON.parse(String(row[6]))
    } catch {
      throw new Error('Stored Agent Coordination handoff is invalid')
    }
    if (
      typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('id' in value) || value.id !== String(row[0]) ||
      !('coordinationId' in value) || value.coordinationId !== String(row[1]) ||
      value.coordinationId !== coordinationId ||
      !('sequence' in value) || value.sequence !== Number(row[2]) ||
      !('sourceTaskId' in value) || value.sourceTaskId !== String(row[3]) ||
      !('targetTaskId' in value) || value.targetTaskId !== String(row[4]) ||
      !('resultDigest' in value) || value.resultDigest !== String(row[5]) ||
      !('createdAt' in value) || value.createdAt !== String(row[7]) ||
      !isCanonicalIsoTimestamp(value.createdAt)
    ) {
      throw new Error('Stored Agent Coordination handoff is invalid')
    }
    return value as AgentHandoff
  })
}

function selectAgentCoordinationResourceLeases(
  db: Database,
  durable: DurableCoordinationSession,
): CoordinationResourceLease[] {
  const rows = db.exec(
    `select id, coordination_id, task_id, resource_id, resource_digest, mode,
            status, version, lease_json, acquired_at, expires_at, released_at
       from agent_coordination_leases
      where coordination_id = ?
      order by acquired_at asc, id asc`,
    [durable.coordination.id],
  )[0]?.values ?? []
  const leases = rows.map((row) => {
    let value: unknown
    try {
      value = JSON.parse(String(row[8]))
    } catch {
      throw new Error('Stored Agent Coordination lease is invalid')
    }
    let lease: CoordinationResourceLease
    try {
      lease = parseCoordinationResourceLease(value, {
        coordination: durable.coordination,
        graph: durable.graph,
      })
    } catch {
      throw new Error('Stored Agent Coordination lease is invalid')
    }
    if (
      lease.id !== String(row[0]) ||
      lease.coordinationId !== String(row[1]) ||
      lease.taskId !== String(row[2]) ||
      lease.resourceId !== String(row[3]) ||
      lease.resourceDigest !== String(row[4]) ||
      lease.mode !== String(row[5]) ||
      lease.status !== String(row[6]) ||
      lease.version !== Number(row[7]) ||
      lease.acquiredAt !== String(row[9]) ||
      lease.expiresAt !== String(row[10]) ||
      lease.releasedAt !== (row[11] === null ? null : String(row[11]))
    ) throw new Error('Stored Agent Coordination lease is invalid')
    const task = durable.state.tasks.find((candidate) => candidate.id === lease.taskId)
    if (
      lease.status === 'active' &&
      (
        task === undefined ||
        task.status !== 'running' ||
        task.version !== lease.taskVersion ||
        task.runtimeId !== lease.runtimeId ||
        task.runtimeVersion !== lease.runtimeVersion
      )
    ) throw new Error('Stored Agent Coordination lease is invalid')
    return lease
  })

  for (let leftIndex = 0; leftIndex < leases.length; leftIndex += 1) {
    const left = leases[leftIndex]!
    const leftEnd = left.releasedAt === null ? Number.POSITIVE_INFINITY : Date.parse(left.releasedAt)
    for (let rightIndex = leftIndex + 1; rightIndex < leases.length; rightIndex += 1) {
      const right = leases[rightIndex]!
      const sameOwner = left.taskId === right.taskId &&
        left.runtimeId === right.runtimeId &&
        left.capabilityId === right.capabilityId
      if (
        left.resourceId !== right.resourceId ||
        (left.mode === 'read' && right.mode === 'read' && !sameOwner)
      ) continue
      const rightEnd = right.releasedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(right.releasedAt)
      if (
        Date.parse(left.acquiredAt) < rightEnd &&
        Date.parse(right.acquiredAt) < leftEnd
      ) throw new Error('Stored Agent Coordination lease is invalid')
    }
  }
  return leases
}

function selectDurableCoordinationSession(
  db: Database,
  coordinationId: string,
): DurableCoordinationSession | null {
  const stateValue = selectJson<unknown>(
    db,
    'select state_json from agent_coordination_sessions where id = ? limit 1',
    [coordinationId],
  )[0]
  if (stateValue === undefined) return null

  const state = parseCoordinationSessionState(stateValue)
  const coordinationValue = selectJson<unknown>(
    db,
    'select request_json from agent_coordination_sessions where id = ? limit 1',
    [coordinationId],
  )[0]
  const graphValue = selectJson<unknown>(
    db,
    'select graph_json from agent_coordination_graphs where coordination_id = ? limit 1',
    [coordinationId],
  )[0]
  if (coordinationValue === undefined || graphValue === undefined) {
    throw new Error('Stored Agent Coordination session is incomplete')
  }

  const coordination = parseCoordinationSessionRequest(coordinationValue, state.bounds)
  const graph = parseAgentTaskGraph(graphValue, {
    coordinationId: coordination.id,
    acceptedRoleIds: getAcceptedSpecialistRoleIds(),
    maxTaskNodes: coordination.bounds.maxTaskNodes,
    maxDependencyEdges: coordination.bounds.maxDependencyEdges,
  }).graph
  const initialState = parseCoordinationSessionState(createCoordinationSessionState({
    coordination,
    graph,
    startedAt: state.startedAt,
  }))
  const storedTasks = selectJson<unknown>(
    db,
    `select state_json from agent_coordination_tasks
     where coordination_id = ? order by task_id asc`,
    [coordinationId],
  )
  const storedAudit = selectJson<unknown>(
    db,
    `select metadata_json from agent_coordination_audits
     where id = ? and coordination_id = ? and event_kind = 'session_started'
       and session_version = 1 limit 1`,
    [coordinationStartAuditId(coordinationId), coordinationId],
  )
  const storedCheckpoints = selectJson<unknown>(
    db,
    `select checkpoint_json from agent_coordination_checkpoints
     where coordination_id = ? and checkpoint_version = 1 limit 1`,
    [coordinationId],
  )
  if (
    coordination.id !== state.id ||
    graph.id !== state.graphId ||
    graph.version !== state.graphVersion ||
    !sameJson(coordination.scope, state.scope) ||
    !sameJson(coordination.authority, state.authority) ||
    coordination.contextDigest !== state.contextDigest ||
    coordination.capabilitySetDigest !== state.capabilitySetDigest ||
    !sameJson(coordination.bounds, state.bounds) ||
    coordination.requestedAt !== state.requestedAt ||
    coordination.deadline !== state.deadline ||
    !sameJson(
      graph.nodes.map((node) => node.id).sort((left, right) => left.localeCompare(right)),
      state.tasks.map((task) => task.id),
    ) ||
    !sameJson(storedTasks, state.tasks) ||
    !sameJson(storedAudit, [coordinationStartAuditMetadata(graph)]) ||
    !sameJson(storedCheckpoints, [initialState])
  ) {
    throw new Error('Stored Agent Coordination session is invalid')
  }

  return { coordination, graph, state }
}

const COORDINATION_METADATA_MAX_BYTES = 256 * 1_024
const coordinationIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

function assertCoordinationMetadataBound(db: Database, coordinationId: string): void {
  const value = db.exec(
    `select coalesce(sum(bytes), 0) from (
       select length(cast(request_json as blob)) + length(cast(state_json as blob)) as bytes
         from agent_coordination_sessions where id = ?
       union all
       select length(cast(graph_json as blob))
         from agent_coordination_graphs where coordination_id = ?
       union all
       select length(cast(state_json as blob))
         from agent_coordination_tasks where coordination_id = ?
       union all
       select length(cast(handoff_json as blob))
         from agent_coordination_handoffs where coordination_id = ?
       union all
       select length(cast(lease_json as blob))
         from agent_coordination_leases where coordination_id = ?
       union all
       select length(cast(metadata_json as blob))
         from agent_coordination_audits where coordination_id = ?
       union all
       select length(cast(checkpoint_json as blob))
         from agent_coordination_checkpoints where coordination_id = ?
     )`,
    Array.from({ length: 7 }, () => coordinationId),
  )[0]?.values[0]?.[0]
  const bytes = Number(value)
  if (!Number.isSafeInteger(bytes) || bytes > COORDINATION_METADATA_MAX_BYTES) {
    throw new Error('coordination_metadata_too_large')
  }
}

function hasExactCoordinationKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isCoordinationMetadataRecord(
  value: unknown,
): value is Record<string, string | number | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([key, item]) =>
    coordinationIdentifierPattern.test(key) &&
    (
      item === null ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      (
        typeof item === 'string' &&
        item.length <= 200 &&
        redactSensitiveText(item).value === item
      )
    )) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536
}

function selectCoordinationTrajectoryAudits(
  db: Database,
  coordinationId: string,
): CoordinationTrajectoryAudit[] {
  const rows = db.exec(
    `select id, task_id, event_kind, session_version, metadata_json, created_at
     from agent_coordination_audits
     where coordination_id = ? order by session_version asc, id asc`,
    [coordinationId],
  )[0]?.values ?? []
  return rows.map((row) => {
    let metadata: unknown
    try {
      metadata = JSON.parse(String(row[4]))
    } catch {
      throw new Error('Stored Agent Coordination trajectory is invalid')
    }
    const eventKind = String(row[2])
    const audit: CoordinationTrajectoryAudit = {
      id: String(row[0]),
      taskId: row[1] === null ? null : String(row[1]),
      eventKind: eventKind as CoordinationTrajectoryAudit['eventKind'],
      sessionVersion: Number(row[3]),
      metadata: metadata as CoordinationTrajectoryAudit['metadata'],
      createdAt: String(row[5]),
    }
    if (
      !coordinationIdentifierPattern.test(audit.id) ||
      (audit.taskId !== null && !coordinationIdentifierPattern.test(audit.taskId)) ||
      ![
        'session_started',
        'task_started',
        'task_result',
        'task_retried',
        'handoff_accepted',
        'session_cancelled',
      ].includes(eventKind) ||
      !Number.isInteger(audit.sessionVersion) ||
      audit.sessionVersion < 1 ||
      !isCoordinationMetadataRecord(metadata) ||
      !isCanonicalIsoTimestamp(audit.createdAt)
    ) {
      throw new Error('Stored Agent Coordination trajectory is invalid')
    }
    return audit
  })
}

function selectCoordinationCheckpoints(
  db: Database,
  coordinationId: string,
): DurableCoordinationCheckpoint[] {
  const rows = db.exec(
    `select checkpoint_version, session_version, graph_version, checkpoint_json, created_at
     from agent_coordination_checkpoints
     where coordination_id = ? order by checkpoint_version asc`,
    [coordinationId],
  )[0]?.values ?? []
  return rows.map((row) => {
    let stateValue: unknown
    try {
      stateValue = JSON.parse(String(row[3]))
    } catch {
      throw new Error('Stored Agent Coordination trajectory is invalid')
    }
    const checkpoint: DurableCoordinationCheckpoint = {
      checkpointVersion: Number(row[0]),
      sessionVersion: Number(row[1]),
      graphVersion: Number(row[2]),
      state: parseCoordinationSessionState(stateValue),
      createdAt: String(row[4]),
    }
    if (
      !Number.isInteger(checkpoint.checkpointVersion) ||
      !Number.isInteger(checkpoint.sessionVersion) ||
      !Number.isInteger(checkpoint.graphVersion) ||
      checkpoint.checkpointVersion < 1 ||
      checkpoint.sessionVersion < 1 ||
      checkpoint.graphVersion < 1 ||
      !isCanonicalIsoTimestamp(checkpoint.createdAt)
    ) {
      throw new Error('Stored Agent Coordination trajectory is invalid')
    }
    return checkpoint
  })
}

function isNonNegativeCoordinationUsage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateCoordinationTaskStartCheckpoint(
  previous: CoordinationSessionState,
  current: CoordinationSessionState,
  audit: CoordinationTrajectoryAudit,
): boolean {
  const metadata = audit.metadata
  if (!hasExactCoordinationKeys(metadata, [
    'stateVersion',
    'allocationId',
    'taskId',
    'taskVersion',
    'agentId',
    'runtimeId',
    'runtimeVersion',
  ]) || metadata.stateVersion !== 1 ||
    typeof metadata.allocationId !== 'string' ||
    !coordinationIdentifierPattern.test(metadata.allocationId) ||
    typeof metadata.taskId !== 'string' || audit.taskId !== metadata.taskId) return false
  const previousTask = previous.tasks.find((task) => task.id === metadata.taskId)
  const currentTask = current.tasks.find((task) => task.id === metadata.taskId)
  if (
    previousTask === undefined || currentTask === undefined ||
    previousTask.status !== 'ready' ||
    currentTask.status !== 'running' ||
    currentTask.version !== previousTask.version + 1 ||
    currentTask.agentId === null || currentTask.runtimeId === null ||
    currentTask.runtimeVersion === null ||
    metadata.taskVersion !== currentTask.version ||
    metadata.agentId !== currentTask.agentId ||
    metadata.runtimeId !== currentTask.runtimeId ||
    metadata.runtimeVersion !== currentTask.runtimeVersion
  ) return false
  const expected: CoordinationSessionState = {
    ...previous,
    version: previous.version + 1,
    tasks: previous.tasks.map((task) => task.id === currentTask.id ? currentTask : task),
    counters: {
      ...previous.counters,
      specialistStarts: previous.counters.specialistStarts + 1,
      activeSpecialists: previous.counters.activeSpecialists + 1,
    },
    updatedAt: current.updatedAt,
  }
  return sameJson(expected, current)
}

function validateCoordinationTaskResultCheckpoint(
  previous: CoordinationSessionState,
  current: CoordinationSessionState,
  audit: CoordinationTrajectoryAudit,
): boolean {
  const metadata = audit.metadata
  if (!hasExactCoordinationKeys(metadata, [
    'stateVersion',
    'taskId',
    'taskVersion',
    'runtimeId',
    'runtimeVersion',
    'status',
    'resultDigest',
    'failureCategory',
    'failureCode',
    'steps',
    'toolCalls',
    'tokens',
    'costUsd',
  ]) || metadata.stateVersion !== 1 ||
    typeof metadata.taskId !== 'string' || audit.taskId !== metadata.taskId ||
    typeof metadata.runtimeId !== 'string' ||
    typeof metadata.runtimeVersion !== 'number' ||
    !isNonNegativeCoordinationUsage(metadata.steps) ||
    !isNonNegativeCoordinationUsage(metadata.toolCalls) ||
    !isNonNegativeCoordinationUsage(metadata.tokens) ||
    !isNonNegativeCoordinationUsage(metadata.costUsd)) return false
  const previousTask = previous.tasks.find((task) => task.id === metadata.taskId)
  const currentTask = current.tasks.find((task) => task.id === metadata.taskId)
  if (
    previousTask === undefined || currentTask === undefined ||
    previousTask.status !== 'running' ||
    (currentTask.status !== 'succeeded' && currentTask.status !== 'failed') ||
    metadata.taskVersion !== currentTask.version ||
    metadata.runtimeId !== currentTask.runtimeId ||
    metadata.runtimeVersion !== currentTask.runtimeVersion ||
    metadata.status !== currentTask.status ||
    metadata.resultDigest !== currentTask.resultDigest ||
    metadata.failureCategory !== (currentTask.failure?.category ?? null) ||
    metadata.failureCode !== (currentTask.failure?.code ?? null)
  ) return false
  try {
    const transitionInput: CommitCoordinationTaskResultInput = {
      expectedState: previous,
      taskId: currentTask.id,
      runtimeId: metadata.runtimeId,
      runtimeVersion: metadata.runtimeVersion,
      result: {
        status: currentTask.status,
        resultDigest: currentTask.resultDigest,
        failure: currentTask.failure,
      },
      usage: {
        steps: metadata.steps,
        toolCalls: metadata.toolCalls,
        tokens: metadata.tokens,
        costUsd: metadata.costUsd,
      },
      now: current.updatedAt,
    }
    const expected = recordCoordinationTaskResult({
      state: previous,
      taskId: transitionInput.taskId,
      runtimeId: transitionInput.runtimeId,
      expectedRuntimeVersion: previousTask.runtimeVersion ?? transitionInput.runtimeVersion,
      runtimeVersion: transitionInput.runtimeVersion,
      result: transitionInput.result,
      usage: transitionInput.usage,
      now: transitionInput.now,
      expectedSessionVersion: previous.version,
      expectedTaskVersion: previousTask.version,
    })
    const expectedMetadata = coordinationTaskResultAuditMetadata(transitionInput, current)
    return sameJson(expected, current) && sameJson(expectedMetadata, metadata)
  } catch {
    return false
  }
}

function validateCoordinationTaskRetryCheckpoint(
  previous: CoordinationSessionState,
  current: CoordinationSessionState,
  audit: CoordinationTrajectoryAudit,
): boolean {
  const metadata = audit.metadata
  if (!hasExactCoordinationKeys(metadata, [
    'stateVersion',
    'recoveryId',
    'taskId',
    'taskVersion',
    'failedRuntimeId',
    'failedRuntimeVersion',
    'replacementRuntimeId',
    'replacementRuntimeVersion',
    'failureCategory',
    'failureCode',
    'steps',
    'toolCalls',
    'tokens',
    'costUsd',
  ]) || metadata.stateVersion !== 1 ||
    typeof metadata.recoveryId !== 'string' ||
    !coordinationIdentifierPattern.test(metadata.recoveryId) ||
    typeof metadata.taskId !== 'string' || audit.taskId !== metadata.taskId ||
    typeof metadata.taskVersion !== 'number' ||
    typeof metadata.failedRuntimeId !== 'string' ||
    typeof metadata.failedRuntimeVersion !== 'number' ||
    typeof metadata.replacementRuntimeId !== 'string' ||
    typeof metadata.replacementRuntimeVersion !== 'number' ||
    typeof metadata.failureCategory !== 'string' ||
    typeof metadata.failureCode !== 'string' ||
    !isNonNegativeCoordinationUsage(metadata.steps) ||
    !isNonNegativeCoordinationUsage(metadata.toolCalls) ||
    !isNonNegativeCoordinationUsage(metadata.tokens) ||
    !isNonNegativeCoordinationUsage(metadata.costUsd)) return false
  const previousTask = previous.tasks.find((task) => task.id === metadata.taskId)
  const currentTask = current.tasks.find((task) => task.id === metadata.taskId)
  if (
    previousTask === undefined || currentTask === undefined ||
    previousTask.status !== 'running' || currentTask.status !== 'running' ||
    !coordinationIdentifierPattern.test(metadata.failedRuntimeId) ||
    !coordinationIdentifierPattern.test(metadata.replacementRuntimeId) ||
    !Number.isInteger(metadata.taskVersion) || metadata.taskVersion < 1 ||
    !Number.isInteger(metadata.failedRuntimeVersion) || metadata.failedRuntimeVersion < 1 ||
    !Number.isInteger(metadata.replacementRuntimeVersion) ||
    metadata.replacementRuntimeVersion < 1 ||
    metadata.taskVersion !== currentTask.version ||
    currentTask.agentId !== previousTask.agentId ||
    currentTask.runtimeId !== metadata.replacementRuntimeId ||
    currentTask.runtimeVersion !== metadata.replacementRuntimeVersion
  ) return false
  const failure = {
    category: metadata.failureCategory,
    code: metadata.failureCode,
    sourceTaskId: currentTask.id,
  } as CoordinationTaskFailure
  const usage = {
    steps: metadata.steps,
    toolCalls: metadata.toolCalls,
    tokens: metadata.tokens,
    costUsd: metadata.costUsd,
  }
  try {
    const expected = retryCoordinationTask({
      state: previous,
      expectedSessionVersion: previous.version,
      taskId: currentTask.id,
      expectedTaskVersion: previousTask.version,
      runtimeId: metadata.failedRuntimeId,
      expectedRuntimeVersion: previousTask.runtimeVersion!,
      runtimeVersion: metadata.failedRuntimeVersion,
      failure,
      replacementRuntimeId: metadata.replacementRuntimeId,
      replacementRuntimeVersion: metadata.replacementRuntimeVersion,
      usage,
      now: current.updatedAt,
    })
    const expectedMetadata = coordinationTaskRetryAuditMetadata({
      recoveryId: metadata.recoveryId,
      taskId: currentTask.id,
      failedRuntimeId: metadata.failedRuntimeId,
      failedRuntimeVersion: metadata.failedRuntimeVersion,
      replacementRuntimeId: metadata.replacementRuntimeId,
      replacementRuntimeVersion: metadata.replacementRuntimeVersion,
      failure,
      usage,
    }, current)
    return sameJson(expected, current) && sameJson(expectedMetadata, metadata)
  } catch {
    return false
  }
}

function validateCoordinationSessionCancellationCheckpoint(
  previous: CoordinationSessionState,
  current: CoordinationSessionState,
  audit: CoordinationTrajectoryAudit,
): boolean {
  if (
    audit.taskId !== null ||
    !hasExactCoordinationKeys(audit.metadata, ['stateVersion', 'runtimeCount']) ||
    audit.metadata.stateVersion !== 1 ||
    !Number.isInteger(audit.metadata.runtimeCount) ||
    Number(audit.metadata.runtimeCount) < 0
  ) return false
  try {
    return sameJson(current, cancelCoordinationSession({
      state: previous,
      expectedSessionVersion: previous.version,
      now: current.updatedAt,
    })) && sameJson(audit.metadata, coordinationSessionCancelledAuditMetadata(previous))
  } catch {
    return false
  }
}

function selectCoordinationRecoverySnapshot(
  db: Database,
  coordinationId: string,
): CoordinationRecoverySnapshot | null {
  const durable = selectDurableCoordinationSession(db, coordinationId)
  if (durable === null) return null
  try {
    const audits = selectCoordinationTrajectoryAudits(db, coordinationId)
    const checkpoints = selectCoordinationCheckpoints(db, coordinationId)
    const rawHandoffs = selectAgentCoordinationHandoffs(db, coordinationId)
    const leases = selectAgentCoordinationResourceLeases(db, durable)
    if (
      audits.length !== durable.state.version ||
      checkpoints.length !== durable.state.version
    ) throw new Error('invalid_coordination_trajectory_length')

    const acceptedHandoffs: AgentHandoff[] = []
    const initialState = parseCoordinationSessionState(createCoordinationSessionState({
      coordination: durable.coordination,
      graph: durable.graph,
      startedAt: durable.state.startedAt,
    }))
    for (let index = 0; index < checkpoints.length; index += 1) {
      const expectedVersion = index + 1
      const checkpoint = checkpoints[index]
      const audit = audits[index]
      if (
        checkpoint === undefined || audit === undefined ||
        checkpoint.checkpointVersion !== expectedVersion ||
        checkpoint.sessionVersion !== expectedVersion ||
        checkpoint.graphVersion !== durable.graph.version ||
        checkpoint.state.id !== durable.coordination.id ||
        checkpoint.state.version !== expectedVersion ||
        checkpoint.state.graphId !== durable.graph.id ||
        checkpoint.state.graphVersion !== durable.graph.version ||
        checkpoint.state.updatedAt !== checkpoint.createdAt ||
        audit.id !== coordinationTransitionAuditId(coordinationId, expectedVersion) ||
        audit.sessionVersion !== expectedVersion ||
        audit.createdAt !== checkpoint.createdAt
      ) throw new Error('invalid_coordination_trajectory_identity')

      if (expectedVersion === 1) {
        if (
          audit.eventKind !== 'session_started' || audit.taskId !== null ||
          !sameJson(audit.metadata, coordinationStartAuditMetadata(durable.graph)) ||
          !sameJson(checkpoint.state, initialState)
        ) throw new Error('invalid_coordination_start_trajectory')
        continue
      }

      const previous = checkpoints[index - 1]?.state
      if (previous === undefined) throw new Error('invalid_coordination_trajectory_predecessor')
      if (audit.eventKind === 'task_started') {
        if (!validateCoordinationTaskStartCheckpoint(previous, checkpoint.state, audit)) {
          throw new Error('invalid_coordination_task_start_trajectory')
        }
        continue
      }
      if (audit.eventKind === 'task_result') {
        if (!validateCoordinationTaskResultCheckpoint(previous, checkpoint.state, audit)) {
          throw new Error('invalid_coordination_task_result_trajectory')
        }
        continue
      }
      if (audit.eventKind === 'task_retried') {
        if (!validateCoordinationTaskRetryCheckpoint(previous, checkpoint.state, audit)) {
          throw new Error('invalid_coordination_task_retry_trajectory')
        }
        continue
      }
      if (audit.eventKind === 'session_cancelled') {
        if (!validateCoordinationSessionCancellationCheckpoint(previous, checkpoint.state, audit)) {
          throw new Error('invalid_coordination_session_cancellation_trajectory')
        }
        continue
      }
      if (audit.eventKind !== 'handoff_accepted') {
        throw new Error('invalid_coordination_trajectory_event')
      }
      const metadata = audit.metadata
      if (!hasExactCoordinationKeys(metadata, [
        'stateVersion',
        'handoffId',
        'sequence',
        'sourceTaskId',
        'sourceTaskVersion',
        'targetTaskId',
        'targetTaskVersion',
        'targetStatus',
        'resultDigest',
      ]) || metadata.stateVersion !== 1 || typeof metadata.handoffId !== 'string') {
        throw new Error('invalid_coordination_handoff_metadata')
      }
      const rawHandoff = rawHandoffs.find((handoff) => handoff.id === metadata.handoffId)
      const previousTargetTask = previous.tasks.find(
        (task) => task.id === rawHandoff?.targetTaskId,
      )
      if (rawHandoff === undefined || previousTargetTask === undefined) {
        throw new Error('invalid_coordination_handoff_identity')
      }
      const sourceResult: AcceptedSpecialistResult = {
        taskId: rawHandoff.sourceTaskId,
        taskVersion: rawHandoff.sourceTaskVersion,
        runtimeId: rawHandoff.sourceRuntimeId,
        runtimeVersion: rawHandoff.sourceRuntimeVersion,
        status: 'succeeded',
        resultDigest: rawHandoff.resultDigest,
        evidenceDigests: rawHandoff.evidenceDigests,
        contextDigest: rawHandoff.contextDigest,
        resourceLeaseOutcome: rawHandoff.resourceLeaseOutcome,
      }
      const handoff = acceptAgentHandoff(rawHandoff, {
        coordination: durable.coordination,
        graph: durable.graph,
        sourceResult,
        targetTaskVersion: previousTargetTask.version,
        expectedSequence: acceptedHandoffs.length + 1,
        maxSummaryBytes: durable.coordination.bounds.maxHandoffSummaryBytes,
        existingHandoff: null,
      }).handoff
      const expected = applyCoordinationHandoff({
        state: previous,
        coordination: durable.coordination,
        graph: durable.graph,
        handoff,
        sourceResult,
        expectedSessionVersion: previous.version,
        expectedTargetTaskVersion: previousTargetTask.version,
        priorAcceptedHandoffs: acceptedHandoffs,
      })
      if (
        audit.taskId !== handoff.targetTaskId ||
        !sameJson(expected, checkpoint.state) ||
        !sameJson(coordinationHandoffAuditMetadata(handoff, checkpoint.state), metadata)
      ) throw new Error('invalid_coordination_handoff_trajectory')
      acceptedHandoffs.push(handoff)
    }

    if (
      acceptedHandoffs.length !== rawHandoffs.length ||
      !sameJson(acceptedHandoffs.map((handoff) => handoff.id), durable.state.acceptedHandoffIds) ||
      !sameJson(checkpoints.at(-1)?.state, durable.state)
    ) throw new Error('invalid_coordination_trajectory_terminal')

    const snapshot: CoordinationRecoverySnapshot = {
      ...durable,
      handoffs: acceptedHandoffs,
      leases,
      audits,
      checkpoints,
    }
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > COORDINATION_METADATA_MAX_BYTES) {
      throw new Error('invalid_coordination_trajectory_size')
    }
    return snapshot
  } catch {
    throw new Error('Stored Agent Coordination trajectory is invalid')
  }
}

function selectAgentRuntimeEvents(
  db: Database,
  runtimeId: string,
  checkpointVersion?: number,
): AgentRuntimeEvent[] {
  const values = checkpointVersion === undefined
    ? selectJson<unknown>(
        db,
        'select json from agent_runtime_events where runtime_id = ? order by sequence asc',
        [runtimeId],
      )
    : selectJson<unknown>(
        db,
        `select json from agent_runtime_events
         where runtime_id = ? and checkpoint_version = ? order by sequence asc`,
        [runtimeId, checkpointVersion],
      )
  return values.map(parseStoredAgentRuntimeEvent)
}

function selectAgentRuntimeCheckpoints(
  db: Database,
  runtimeId: string,
): AgentCheckpoint[] {
  return selectJson<unknown>(
    db,
    'select json from agent_runtime_checkpoints where runtime_id = ? order by version asc',
    [runtimeId],
  ).map(parseStoredAgentCheckpoint)
}

async function selectAgentRuntimeContextAttachment(
  db: Database,
  runtimeId: string,
): Promise<AgentRuntimeContextAttachment | null> {
  const value = selectJson<unknown>(
    db,
    'select json from agent_runtime_context_attachments where runtime_id = ? limit 1',
    [runtimeId],
  )[0]
  if (value === undefined) return null
  try {
    return await parseAgentRuntimeContextAttachment(value)
  } catch {
    throw new Error('Stored Agent Runtime Context attachment is invalid')
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function selectAgentMemoryCandidate(
  db: Database,
  candidateId: string,
): unknown | undefined {
  return selectJson<unknown>(
    db,
    'select json from agent_memory_candidates where id = ? limit 1',
    [candidateId],
  )[0]
}

function writeAgentMemoryCandidate(db: Database, candidate: AgentMemoryCandidate): void {
  db.run(
    `insert into agent_memory_candidates (
       id, scope_kind, local_project_id, organization_id, team_project_id,
       user_id, session_id, runtime_id, action_id, checkpoint_version,
       observation_sequence, result_digest, statement, content_digest,
       provenance_digest, status, state_version, json, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      candidate.id,
      candidate.scope.kind,
      candidate.scope.localProjectId,
      candidate.scope.organizationId,
      candidate.scope.projectId,
      candidate.scope.userId,
      candidate.scope.sessionId,
      candidate.provenance.runtimeId,
      candidate.provenance.actionId,
      candidate.provenance.checkpointVersion,
      candidate.provenance.sequence,
      candidate.provenance.resultDigest,
      candidate.statement,
      candidate.contentDigest,
      candidate.provenanceDigest,
      candidate.status,
      candidate.stateVersion,
      JSON.stringify(candidate),
      candidate.createdAt,
    ],
  )
}

function createAgentRuntimeTerminalSummary(
  runtime: AgentRuntimeState & { status: 'terminal'; stopReason: AgentRuntimeStopReason },
): AgentRuntimeTerminalSummary {
  return {
    stateVersion: 1,
    runtimeId: runtime.id,
    checkpointVersion: runtime.checkpointVersion,
    stopReason: runtime.stopReason,
    counters: { ...runtime.counters },
    acceptedActionCount: runtime.acceptedActionIds.length,
    lastObservationDigest: runtime.lastObservationDigest,
    lastResultDigest: runtime.lastResultDigest,
    completedAt: runtime.updatedAt,
    redacted: true,
  }
}

function writeAgentRuntimeRow(db: Database, runtime: AgentRuntimeState): void {
  db.run(
    `insert into agent_runtimes (
       id, scope_kind, organization_id, team_project_id, user_id, session_id,
       local_project_id, run_id, node_id, run_version, policy_version,
       context_digest, capability_set_digest, status, stop_reason, version,
       checkpoint_version, next_sequence, state_version, json,
       requested_at, started_at, updated_at, deadline
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       status = excluded.status,
       stop_reason = excluded.stop_reason,
       version = excluded.version,
       checkpoint_version = excluded.checkpoint_version,
       next_sequence = excluded.next_sequence,
       json = excluded.json,
       updated_at = excluded.updated_at`,
    [
      runtime.id,
      runtime.scope.kind,
      runtime.scope.organizationId,
      runtime.scope.projectId,
      runtime.scope.userId,
      runtime.scope.sessionId,
      runtime.scope.localProjectId,
      runtime.authority.runId,
      runtime.authority.nodeId,
      runtime.authority.runVersion,
      runtime.authority.policyVersion,
      runtime.contextDigest,
      runtime.capabilitySetDigest,
      runtime.status,
      runtime.stopReason,
      runtime.version,
      runtime.checkpointVersion,
      runtime.nextSequence,
      runtime.stateVersion,
      JSON.stringify(runtime),
      runtime.requestedAt,
      runtime.startedAt,
      runtime.updatedAt,
      runtime.deadline,
    ],
  )
}

function writeAgentRuntimeTransition(db: Database, transition: AgentRuntimeTransition): void {
  writeAgentRuntimeRow(db, transition.runtime)
  for (const event of transition.events) {
    db.run(
      `insert into agent_runtime_events (
         runtime_id, sequence, checkpoint_version, type, state_version, json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.runtimeId,
        event.sequence,
        event.checkpointVersion,
        event.type,
        event.stateVersion,
        JSON.stringify(event),
        event.createdAt,
      ],
    )
    if (event.type === 'evaluation_recorded') {
      db.run(
        `insert into agent_runtime_evaluations (
           runtime_id, sequence, checkpoint_version, evaluation, summary, event_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
        [
          event.runtimeId,
          event.sequence,
          event.checkpointVersion,
          String(event.metadata.evaluation),
          String(event.metadata.summary),
          JSON.stringify(event),
          event.createdAt,
        ],
      )
    }
  }
  const checkpoint = transition.checkpoint
  db.run(
    `insert into agent_runtime_checkpoints (
       runtime_id, version, runtime_version, status, stop_reason,
       state_version, json, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      checkpoint.runtimeId,
      checkpoint.version,
      checkpoint.runtimeVersion,
      checkpoint.status,
      checkpoint.stopReason,
      checkpoint.stateVersion,
      JSON.stringify(checkpoint),
      checkpoint.createdAt,
    ],
  )
  if (transition.runtime.status === 'terminal' && transition.runtime.stopReason !== null) {
    const summary = createAgentRuntimeTerminalSummary(
      transition.runtime as AgentRuntimeState & {
        status: 'terminal'
        stopReason: AgentRuntimeStopReason
      },
    )
    db.run(
      `insert into agent_runtime_terminal_summaries (
         runtime_id, checkpoint_version, stop_reason, state_version, json, completed_at
       ) values (?, ?, ?, ?, ?, ?)`,
      [
        summary.runtimeId,
        summary.checkpointVersion,
        summary.stopReason,
        summary.stateVersion,
        JSON.stringify(summary),
        summary.completedAt,
      ],
    )
  }
}

function writeAgentRuntimeContextAttachment(
  db: Database,
  attachment: AgentRuntimeContextAttachment,
): void {
  db.run(
    `insert into agent_runtime_context_attachments (
       id, runtime_id, checkpoint_version, context_digest,
       knowledge_identity_digest, memory_identity_digest,
       knowledge_citation_count, memory_revision_count,
       state_version, json, attached_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachment.id,
      attachment.runtimeId,
      attachment.checkpointVersion,
      attachment.contextDigest,
      attachment.knowledgeIdentityDigest,
      attachment.memoryIdentityDigest,
      attachment.knowledgeCitations.length,
      attachment.memoryRevisions.length,
      attachment.stateVersion,
      JSON.stringify(attachment),
      attachment.attachedAt,
    ],
  )
}

function selectRemoteSyncOperations(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): RemoteSyncOperation[] {
  const result = db.exec(sql, params)
  const rows = result[0]?.values ?? []
  return rows.map((row) => ({
    id: String(row[0]),
    kind: String(row[1]) as RemoteSyncOperation['kind'],
    localProjectId: String(row[2]),
    organizationId: row[3] === null ? null : String(row[3]),
    teamProjectId: row[4] === null ? null : String(row[4]),
    runId: String(row[5]),
    entityId: String(row[6]),
    idempotencyKey: String(row[7]),
    status: String(row[8]) as RemoteSyncOperation['status'],
    generation: Number(row[9]),
    attemptCount: Number(row[10]),
    nextAttemptAt: row[11] === null ? null : String(row[11]),
    leaseExpiresAt: row[12] === null ? null : String(row[12]),
    lastAttemptAt: row[13] === null ? null : String(row[13]),
    lastErrorCode: row[14] === null ? null : String(row[14]) as RemoteSyncFailureCode,
    lastErrorMessage: row[15] === null ? null : String(row[15]),
    recovery: String(row[16]) as RemoteSyncRecovery,
    completedAt: row[17] === null ? null : String(row[17]),
    createdAt: String(row[18]),
    updatedAt: String(row[19]),
  }))
}

const REMOTE_SYNC_OPERATION_COLUMNS = `
  id, kind, local_project_id, organization_id, team_project_id, run_id, entity_id,
  idempotency_key, status, generation, attempt_count, next_attempt_at, lease_expires_at, last_attempt_at,
  last_error_code, last_error_message, recovery, completed_at, created_at, updated_at
`

const REMOTE_SYNC_OPERATION_KINDS: readonly RemoteSyncOperation['kind'][] = [
  'run-summary',
  'test-evidence-summary',
  'agent-review-summary',
  'coding-agent-summary',
  'agent-runtime-summary',
  'agent-memory-summary',
]

function isNonEmptyIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return false
  }
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isCanonicalInitialRemoteSyncOperation(
  operation: RemoteSyncOperation,
): boolean {
  const hasNullScope =
    operation.organizationId === null && operation.teamProjectId === null
  const hasCompleteScope =
    isNonEmptyIdentifier(operation.organizationId) &&
    isNonEmptyIdentifier(operation.teamProjectId)

  return (
    isNonEmptyIdentifier(operation.id) &&
    isNonEmptyIdentifier(operation.localProjectId) &&
    isNonEmptyIdentifier(operation.runId) &&
    isNonEmptyIdentifier(operation.entityId) &&
    REMOTE_SYNC_OPERATION_KINDS.includes(operation.kind) &&
    (hasNullScope || hasCompleteScope) &&
    operation.status === 'pending' &&
    operation.generation === 1 &&
    operation.attemptCount === 0 &&
    isCanonicalIsoTimestamp(operation.createdAt) &&
    operation.updatedAt === operation.createdAt &&
    operation.nextAttemptAt === operation.createdAt &&
    operation.leaseExpiresAt === null &&
    operation.lastAttemptAt === null &&
    operation.lastErrorCode === null &&
    operation.lastErrorMessage === null &&
    operation.recovery === 'none' &&
    operation.completedAt === null
  )
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

function hasErrorDetails(input: SettleRemoteSyncOperationInput): boolean {
  return (
    typeof input.lastErrorCode === 'string' &&
    typeof input.lastErrorMessage === 'string' &&
    input.lastErrorMessage.trim().length > 0
  )
}

function isValidRemoteSyncSettlement(input: SettleRemoteSyncOperationInput): boolean {
  if (!isCanonicalIsoTimestamp(input.updatedAt)) return false

  if (input.status === 'completed') {
    return (
      isAbsent(input.nextAttemptAt) &&
      isAbsent(input.lastErrorCode) &&
      isAbsent(input.lastErrorMessage) &&
      (isAbsent(input.recovery) || input.recovery === 'none') &&
      (isAbsent(input.completedAt) || isCanonicalIsoTimestamp(input.completedAt))
    )
  }

  if (input.status === 'retry-scheduled') {
    return (
      isCanonicalIsoTimestamp(input.nextAttemptAt) &&
      Date.parse(input.nextAttemptAt) > Date.parse(input.updatedAt) &&
      hasErrorDetails(input) &&
      (isAbsent(input.recovery) || input.recovery === 'none') &&
      isAbsent(input.completedAt)
    )
  }

  return (
    isAbsent(input.nextAttemptAt) &&
    hasErrorDetails(input) &&
    isAbsent(input.completedAt)
  )
}

function deleteWhereIn(db: Database, table: string, column: string, values: string[]): void {
  if (values.length === 0) {
    return
  }

  const placeholders = values.map(() => '?').join(', ')
  db.run(`delete from ${table} where ${column} in (${placeholders})`, values)
}

type StoredWorkflowRunJson = Omit<WorkflowRun, 'nodes' | 'edges' | 'version'> & {
  version?: number
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

function hydrateStoredWorkflowRun(input: {
  storedRun: StoredWorkflowRunJson
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}): WorkflowRun {
  return normalizeWorkflowRunProgress({
    ...input.storedRun,
    version: input.storedRun.version ?? 1,
    nodes: input.nodes,
    edges: input.edges,
  })
}

function workflowRunEnvelope(run: WorkflowRun): Omit<WorkflowRun, 'nodes' | 'edges'> {
  const { nodes: _nodes, edges: _edges, ...envelope } = run
  return envelope
}

function writeWorkflowRunEnvelope(db: Database, run: WorkflowRun): void {
  const envelope = workflowRunEnvelope(run)
  db.run(
    `
    insert into workflow_runs (id, json, created_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [run.id, JSON.stringify(envelope), run.createdAt, run.updatedAt],
  )
}

function replaceWorkflowNodes(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_nodes where run_id = ?', [run.id])
  for (const [position, node] of run.nodes.entries()) {
    db.run(
      `
      insert into workflow_nodes (
        id,
        run_id,
        stage,
        title,
        subtitle,
        kind,
        status,
        owner_id,
        required_role,
        retry_count,
        token_usage_id,
        artifact_ids,
        position,
        json,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        node.id,
        run.id,
        node.stage,
        node.title,
        node.subtitle,
        node.kind,
        node.status,
        node.ownerId,
        node.requiredRole ?? null,
        node.retryCount,
        node.tokenUsageId ?? null,
        JSON.stringify(node.artifactIds),
        position,
        JSON.stringify(node),
        run.createdAt,
        run.updatedAt,
      ],
    )
  }
}

function replaceWorkflowEdges(db: Database, run: WorkflowRun): void {
  db.run('delete from workflow_edges where run_id = ?', [run.id])
  for (const [position, edge] of run.edges.entries()) {
    db.run(
      `
      insert into workflow_edges (
        id,
        run_id,
        source_node_id,
        target_node_id,
        kind,
        position,
        json,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        edge.id,
        run.id,
        edge.source,
        edge.target,
        edge.kind,
        position,
        JSON.stringify(edge),
        run.createdAt,
      ],
    )
  }
}

function selectWorkflowNodeRows(db: Database): Array<{ runId: string; node: WorkflowNode }> {
  const result = db.exec('select run_id, json from workflow_nodes order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    node: JSON.parse(String(row[1])) as WorkflowNode,
  }))
}

function selectWorkflowEdgeRows(db: Database): Array<{ runId: string; edge: WorkflowEdge }> {
  const result = db.exec('select run_id, json from workflow_edges order by run_id asc, position asc')
  const first = result[0]
  if (!first) {
    return []
  }

  return first.values.map((row) => ({
    runId: String(row[0]),
    edge: JSON.parse(String(row[1])) as WorkflowEdge,
  }))
}

function groupRowsByRunId<T>(rows: Array<{ runId: string } & T>): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const existing = grouped.get(row.runId) ?? []
    const { runId: _runId, ...value } = row
    grouped.set(row.runId, [...existing, value as T])
  }
  return grouped
}

function migrateWorkflowRunsIntoRelationalTables(db: Database): void {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  for (const storedRun of storedRuns) {
    const runNodes = storedRun.nodes ?? []
    const runEdges = storedRun.edges ?? []
    if (runNodes.length === 0 && runEdges.length === 0) {
      continue
    }

    const run = hydrateStoredWorkflowRun({
      storedRun,
      nodes: runNodes,
      edges: runEdges,
    })
    writeWorkflowRunEnvelope(db, run)
    replaceWorkflowNodes(db, run)
    replaceWorkflowEdges(db, run)
  }
}

function readWorkflowRuns(db: Database): WorkflowRun[] {
  const storedRuns = selectJson<StoredWorkflowRunJson>(
    db,
    'select json from workflow_runs order by updated_at desc, created_at desc',
  )
  const nodesByRun = groupRowsByRunId(selectWorkflowNodeRows(db)).entries()
  const edgesByRun = groupRowsByRunId(selectWorkflowEdgeRows(db)).entries()
  const nodeMap = new Map(
    Array.from(nodesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.node),
    ]),
  )
  const edgeMap = new Map(
    Array.from(edgesByRun).map(([runId, rows]) => [
      runId,
      rows.map((row) => row.edge),
    ]),
  )

  return storedRuns.map((storedRun) =>
    hydrateStoredWorkflowRun({
      storedRun,
      nodes: nodeMap.get(storedRun.id) ?? storedRun.nodes ?? [],
      edges: edgeMap.get(storedRun.id) ?? storedRun.edges ?? [],
    }),
  )
}

function writeWorkflowRun(db: Database, run: WorkflowRun): void {
  writeWorkflowRunEnvelope(db, run)
  replaceWorkflowNodes(db, run)
  replaceWorkflowEdges(db, run)
}

function redactArtifactForStorage(artifact: Artifact): Artifact {
  if (artifact.kind !== 'test_report') {
    return artifact
  }
  const title = redactSensitiveText(artifact.title)
  const summary = redactSensitiveText(artifact.summary)
  const content = redactSensitiveText(artifact.content)
  return {
    ...artifact,
    title: title.value,
    summary: summary.value,
    content: content.value,
    redacted: true,
  }
}

function writeArtifact(db: Database, artifact: Artifact): void {
  const safeArtifact = redactArtifactForStorage(artifact)
  db.run(
    `
    insert into artifacts (id, run_id, json, updated_at)
    values (?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [
      safeArtifact.id,
      safeArtifact.runId,
      JSON.stringify(safeArtifact),
      safeArtifact.updatedAt,
    ],
  )
}

function redactAgentEventForStorage(event: AgentEvent): AgentEvent {
  return event.kind === 'test_result'
    ? { ...event, message: redactSensitiveText(event.message).value }
    : event
}

function writeAgentEvent(db: Database, event: AgentEvent): void {
  const safeEvent = redactAgentEventForStorage(event)
  db.run(
    `
    insert into agent_events (id, run_id, sequence, json, timestamp)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
    `,
    [
      safeEvent.id,
      safeEvent.runId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
    ],
  )
}

function writeCodingAgentEvent(db: Database, event: CodingAgentEvent): void {
  const safeEvent = redactCodingAgentEventForStorage(event)
  db.run(
    `
    insert into coding_agent_events (id, coding_run_id, run_id, node_id, sequence, json, timestamp)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, sequence = excluded.sequence, timestamp = excluded.timestamp
    `,
    [
      safeEvent.id,
      safeEvent.codingRunId,
      safeEvent.runId,
      safeEvent.nodeId,
      safeEvent.sequence,
      JSON.stringify(safeEvent),
      safeEvent.timestamp,
    ],
  )
}

function writeCodingAgentRun(db: Database, run: CodingAgentRun): void {
  db.run(
    `
    insert into coding_agent_runs (id, run_id, node_id, json, started_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
    `,
    [
      run.id,
      run.runId,
      run.nodeId,
      JSON.stringify(run),
      run.startedAt,
      run.completedAt ?? run.startedAt,
    ],
  )
}

function writeCodingPermissionRequest(db: Database, request: CodingPermissionRequest): void {
  db.run(
    `
    insert into coding_permission_requests (id, coding_run_id, run_id, node_id, json, requested_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, requested_at = excluded.requested_at
    `,
    [
      request.id,
      request.codingRunId,
      request.runId,
      request.nodeId,
      JSON.stringify(request),
      request.requestedAt,
    ],
  )
}

function writeCodingPermissionDecision(db: Database, decision: CodingPermissionDecision): void {
  db.run(
    `
    insert into coding_permission_decisions (id, request_id, coding_run_id, json, decided_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, decided_at = excluded.decided_at
    `,
    [
      decision.id,
      decision.requestId,
      decision.codingRunId,
      JSON.stringify(decision),
      decision.decidedAt,
    ],
  )
}

function writeCodingDiffArtifact(db: Database, artifact: CodingDiffArtifact): void {
  db.run(
    `
    insert into coding_diff_artifacts (id, run_id, node_id, project_id, json, created_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
    `,
    [
      artifact.id,
      artifact.runId,
      artifact.nodeId,
      artifact.projectId,
      JSON.stringify(artifact),
      artifact.createdAt,
    ],
  )
}

function writeTestEvidence(db: Database, evidence: TestEvidence): void {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  db.run(
    `
    insert into test_evidence (id, run_id, node_id, project_id, json, created_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
    `,
    [
      safeEvidence.id,
      safeEvidence.runId,
      safeEvidence.nodeId,
      safeEvidence.projectId,
      JSON.stringify(safeEvidence),
      safeEvidence.createdAt,
    ],
  )
}

function selectGitHubDeliveryIntent(
  db: Database,
  column: 'id' | 'intent_digest' | 'idempotency_key',
  value: string,
): GitHubDeliveryIntent | null {
  return selectJson<GitHubDeliveryIntent>(
    db,
    `select json from github_delivery_intents
     where ${column} = ?
     order by
       case when status in (
         'approval_required', 'approved', 'publishing_branch',
         'branch_published', 'creating_pr', 'recovery_required'
       ) then 1 else 0 end desc,
       updated_at desc, created_at desc, id desc
     limit 1`,
    [value],
  )[0] ?? null
}

function writeGitHubDeliveryIntent(db: Database, intent: GitHubDeliveryIntent): void {
  db.run(
    `
    insert into github_delivery_intents (
      id, organization_id, team_project_id, local_project_id,
      run_id, node_id, repository_binding_id, repository_binding_version,
      installation_id, repository_id, coding_run_id, workspace_id,
      diff_artifact_id, test_evidence_id, pr_package_artifact_id,
      base_commit_sha, expected_commit_sha, intent_digest, idempotency_key,
      delivery_series_key, delivery_attempt, status, state_version, json,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      intent.id,
      intent.organizationId,
      intent.teamProjectId,
      intent.localProjectId,
      intent.runId,
      intent.nodeId,
      intent.repositoryBindingId,
      intent.repositoryBindingVersion,
      intent.installationId,
      intent.repositoryId,
      intent.codingRunId,
      intent.workspaceId,
      intent.diffArtifactId,
      intent.testEvidenceId,
      intent.prPackageArtifactId,
      intent.baseCommitSha,
      intent.expectedCommitSha,
      intent.intentDigest,
      intent.idempotencyKey,
      intent.deliverySeriesKey,
      intent.deliveryAttempt,
      intent.status,
      intent.stateVersion,
      JSON.stringify(intent),
      intent.createdAt,
      intent.updatedAt,
    ],
  )
}

const gitHubDeliveryOperatorOutcomeCodes: ReadonlySet<
  GitHubDeliveryOperatorOutcomeCode
> = new Set([
  'invalid_delivery_source',
  'operation_cancelled',
  'publisher_cleanup_failed',
  'remote_branch_diverged',
  'remote_unavailable',
  'repository_mismatch',
  'push_result_unknown',
  'workspace_dirty',
  'workspace_mismatch',
])

function createGitHubDeliveryOperatorOutcome(
  intent: GitHubDeliveryIntent,
  outcomeCode: GitHubDeliveryOperatorOutcomeCode,
): GitHubDeliveryOperatorOutcome {
  if (
    intent.status !== 'recovery_required' ||
    !gitHubDeliveryOperatorOutcomeCodes.has(outcomeCode) ||
    !isCanonicalIsoTimestamp(intent.updatedAt)
  ) {
    throw new Error('GitHub Delivery operator outcome is invalid')
  }
  return {
    stateVersion: 1,
    intentId: intent.id,
    intentUpdatedAt: intent.updatedAt,
    outcomeCode,
    recordedAt: intent.updatedAt,
    redacted: true,
  }
}

function selectGitHubDeliveryOperatorOutcome(
  db: Database,
  intentId: string,
): GitHubDeliveryOperatorOutcome | null {
  return selectJson<GitHubDeliveryOperatorOutcome>(
    db,
    'select json from github_delivery_operator_outcomes where intent_id = ? limit 1',
    [intentId],
  )[0] ?? null
}

function writeGitHubDeliveryOperatorOutcome(
  db: Database,
  outcome: GitHubDeliveryOperatorOutcome,
): void {
  db.run(
    `
    insert into github_delivery_operator_outcomes (
      intent_id, intent_updated_at, outcome_code, state_version, json, recorded_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(intent_id) do update set
      intent_updated_at = excluded.intent_updated_at,
      outcome_code = excluded.outcome_code,
      state_version = excluded.state_version,
      json = excluded.json,
      recorded_at = excluded.recorded_at
    `,
    [
      outcome.intentId,
      outcome.intentUpdatedAt,
      outcome.outcomeCode,
      outcome.stateVersion,
      JSON.stringify(outcome),
      outcome.recordedAt,
    ],
  )
}

const GITHUB_DELIVERY_REVOCATION_CHECK_KEYS = [
  'stateVersion',
  'intentId',
  'intentUpdatedAt',
  'bindingId',
  'bindingVersion',
  'outcomeCode',
  'checkedAt',
  'redacted',
] as const

function isCanonicalGitHubDeliveryRevocationCheck(
  check: GitHubDeliveryRevocationCheck,
): boolean {
  const actualKeys = Object.keys(check).sort()
  const expectedKeys = [...GITHUB_DELIVERY_REVOCATION_CHECK_KEYS].sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    check.stateVersion === 2 &&
    isNonEmptyIdentifier(check.intentId) &&
    check.intentId.length <= 200 &&
    isCanonicalIsoTimestamp(check.intentUpdatedAt) &&
    isNonEmptyIdentifier(check.bindingId) &&
    check.bindingId.length <= 200 &&
    Number.isSafeInteger(check.bindingVersion) &&
    check.bindingVersion >= 1 &&
    check.bindingVersion <= 2_147_483_647 &&
    check.outcomeCode === 'binding_inactive' &&
    isCanonicalIsoTimestamp(check.checkedAt) &&
    Date.parse(check.checkedAt) >= Date.parse(check.intentUpdatedAt) &&
    check.redacted === true
  )
}

function writeGitHubDeliveryRevocationCheck(
  db: Database,
  check: GitHubDeliveryRevocationCheck,
): void {
  db.run(
    `insert into github_delivery_revocation_checks (
      intent_id, intent_updated_at, binding_id, binding_version,
      outcome_code, checked_at, state_version, json
    ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      check.intentId,
      check.intentUpdatedAt,
      check.bindingId,
      check.bindingVersion,
      check.outcomeCode,
      check.checkedAt,
      check.stateVersion,
      JSON.stringify(check),
    ],
  )
}

const githubDeliveryStatusTransitions: Readonly<
  Record<GitHubDeliveryStatus, ReadonlySet<GitHubDeliveryStatus>>
> = {
  approval_required: new Set(['approved', 'failed', 'recovery_required', 'revoked']),
  approved: new Set(['publishing_branch', 'failed', 'recovery_required', 'revoked']),
  publishing_branch: new Set(['branch_published', 'failed', 'recovery_required', 'revoked']),
  branch_published: new Set(['creating_pr', 'failed', 'recovery_required', 'revoked']),
  creating_pr: new Set(['failed', 'recovery_required', 'revoked']),
  recovery_required: new Set([
    'approved',
    'publishing_branch',
    'branch_published',
    'creating_pr',
    'failed',
    'revoked',
  ]),
  completed: new Set(),
  failed: new Set(),
  revoked: new Set(),
}

function assertGitHubDeliveryIntentStatusMutation(
  mutation: GitHubDeliveryIntentStatusMutation,
): void {
  const expected = mutation.expectedIntent
  const intent = mutation.intent
  const expectedShape = {
    ...expected,
    status: intent.status,
    updatedAt: intent.updatedAt,
  }
  if (JSON.stringify(intent) !== JSON.stringify(expectedShape)) {
    throw new Error('GitHub Delivery Intent status mutation may only change status and updatedAt')
  }
  const expectedUpdatedAt = Date.parse(expected.updatedAt)
  const updatedAt = Date.parse(intent.updatedAt)
  if (
    !Number.isFinite(expectedUpdatedAt) ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= expectedUpdatedAt
  ) {
    throw new Error('GitHub Delivery Intent status mutation timestamp is invalid')
  }
  if (!githubDeliveryStatusTransitions[expected.status].has(intent.status)) {
    throw new Error('GitHub Delivery Intent status transition is invalid')
  }
}

function assertGitHubDeliveryIntentCompletionMutation(
  mutation: GitHubDeliveryIntentCompletionMutation,
): void {
  const expected = mutation.expectedIntent
  const intent = mutation.intent
  const canonicalCompletion = createGitHubDeliveryCompletion({
    intent: expected,
    remoteRequestId: intent.completion.remoteRequestId,
    publicationId: intent.completion.publicationId,
    pullRequestOutcomeId: intent.completion.pullRequestOutcomeId,
    pullRequestId: intent.completion.pullRequestId,
    pullRequestNumber: intent.completion.pullRequestNumber,
    pullRequestUrl: intent.completion.pullRequestUrl,
    repository: expected.repository,
    baseBranch: expected.baseBranch,
    headBranch: expected.headBranch,
    headSha: expected.expectedCommitSha,
    draft: intent.completion.draft,
    providerCreatedAt: intent.completion.providerCreatedAt,
    recordedAt: intent.completion.recordedAt,
  })
  if (
    intent.updatedAt !== canonicalCompletion.recordedAt ||
    JSON.stringify(intent.completion) !== JSON.stringify(canonicalCompletion) ||
    JSON.stringify(intent) !== JSON.stringify({
      ...expected,
      status: 'completed',
      completion: canonicalCompletion,
      updatedAt: canonicalCompletion.recordedAt,
    })
  ) {
    throw new Error('GitHub Delivery Intent completion mutation is invalid')
  }
}

function writeGitHubRepositoryBinding(
  db: Database,
  binding: GitHubRepositoryBinding,
): void {
  db.run(
    `
    insert into github_repository_bindings (
      id, organization_id, team_project_id, installation_id, repository_id,
      version, status, json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      organization_id = excluded.organization_id,
      team_project_id = excluded.team_project_id,
      installation_id = excluded.installation_id,
      repository_id = excluded.repository_id,
      version = excluded.version,
      status = excluded.status,
      json = excluded.json,
      updated_at = excluded.updated_at
    `,
    [
      binding.id,
      binding.organizationId,
      binding.teamProjectId,
      binding.installationId,
      binding.repositoryId,
      binding.version,
      binding.status,
      JSON.stringify(binding),
      binding.updatedAt,
    ],
  )
}

const GITHUB_REPOSITORY_BINDING_KEYS = [
  'stateVersion',
  'id',
  'version',
  'organizationId',
  'teamProjectId',
  'installationId',
  'repositoryId',
  'repository',
  'defaultBranch',
  'status',
  'validatedAt',
  'updatedAt',
  'redacted',
] as const

function isCanonicalGitHubRepositoryBinding(
  binding: GitHubRepositoryBinding,
): boolean {
  const actualKeys = Object.keys(binding).sort()
  const expectedKeys = [...GITHUB_REPOSITORY_BINDING_KEYS].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    binding.stateVersion !== 1 ||
    !isNonEmptyIdentifier(binding.id) ||
    binding.id.length > 200 ||
    !Number.isSafeInteger(binding.version) ||
    binding.version < 1 ||
    binding.version > 2_147_483_647 ||
    !isNonEmptyIdentifier(binding.organizationId) ||
    binding.organizationId.length > 200 ||
    !isNonEmptyIdentifier(binding.teamProjectId) ||
    binding.teamProjectId.length > 200 ||
    !/^[1-9][0-9]{0,19}$/u.test(binding.installationId) ||
    !/^[1-9][0-9]{0,19}$/u.test(binding.repositoryId) ||
    (binding.status !== 'active' &&
      binding.status !== 'stale' &&
      binding.status !== 'revoked') ||
    !isCanonicalIsoTimestamp(binding.validatedAt) ||
    !isCanonicalIsoTimestamp(binding.updatedAt) ||
    Date.parse(binding.updatedAt) < Date.parse(binding.validatedAt) ||
    binding.redacted !== true
  ) {
    return false
  }
  try {
    return (
      normalizeGitHubRepository(binding.repository) === binding.repository &&
      assertSafeGitHubBranch(binding.defaultBranch) === binding.defaultBranch
    )
  } catch {
    return false
  }
}

function isCanonicalBindingObservationInput(
  input: CommitGitHubRepositoryBindingObservationInput,
): boolean {
  const pairing = input.expectedPairing
  if (
    !isNonEmptyIdentifier(pairing.tokenId) ||
    !isNonEmptyIdentifier(pairing.organizationId) ||
    !isNonEmptyIdentifier(pairing.projectId) ||
    !isNonEmptyIdentifier(pairing.localProjectId) ||
    !isNonEmptyIdentifier(pairing.userId) ||
    !isCanonicalIsoTimestamp(pairing.createdAt)
  ) {
    return false
  }
  return (
    input.binding === null ||
    (isCanonicalGitHubRepositoryBinding(input.binding) &&
      input.binding.organizationId === pairing.organizationId &&
      input.binding.teamProjectId === pairing.projectId)
  )
}

function redactStoredEvidencePrivacy(db: Database): void {
  const stored = selectJson<TestEvidence>(
    db,
    'select json from test_evidence order by created_at asc',
  )
  const artifacts = selectJson<Artifact>(db, 'select json from artifacts')
  for (const artifact of artifacts) {
    const safeArtifact = redactArtifactForStorage(artifact)
    if (JSON.stringify(safeArtifact) !== JSON.stringify(artifact)) {
      writeArtifact(db, safeArtifact)
    }
  }
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const eventsById = new Map(
    selectJson<AgentEvent>(db, 'select json from agent_events').map((event) => [event.id, event]),
  )
  const codingEvents = selectJson<CodingAgentEvent>(
    db,
    'select json from coding_agent_events order by timestamp asc, sequence asc',
  )
  for (const event of codingEvents) {
    const safeEvent = redactCodingAgentEventForStorage(event)
    if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
      writeCodingAgentEvent(db, safeEvent)
    }
  }
  for (const event of eventsById.values()) {
    const safeEvent = redactAgentEventForStorage(event)
    if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
      writeAgentEvent(db, safeEvent)
    }
  }
  for (const evidence of stored) {
    const safeEvidence = redactTestEvidenceForStorage(evidence)
    const artifact = artifactsById.get(`artifact-${evidence.id}`)
    if (
      artifact?.kind === 'test_report' &&
      artifact.runId === evidence.runId &&
      artifact.nodeId === evidence.nodeId
    ) {
      const safeArtifact = createTestEvidenceArtifact(safeEvidence)
      if (JSON.stringify(safeArtifact) !== JSON.stringify(artifact)) {
        writeArtifact(db, safeArtifact)
      }
    }
    const event = eventsById.get(`event-${evidence.id}`)
    if (
      event?.kind === 'test_result' &&
      event.runId === evidence.runId &&
      event.nodeId === evidence.nodeId
    ) {
      const safeEvent = createTestEvidenceEvent(safeEvidence, event.sequence)
      if (JSON.stringify(safeEvent) !== JSON.stringify(event)) {
        writeAgentEvent(db, safeEvent)
      }
    }
    if (JSON.stringify(safeEvidence) !== JSON.stringify(evidence)) {
      writeTestEvidence(db, safeEvidence)
    }
  }
}

function assertWorkflowMutationScope(mutation: WorkflowMutation): void {
  if (mutation.expectedRun.id !== mutation.run.id) {
    throw new Error('Workflow mutation run does not match its expected run')
  }
  const runId = mutation.run.id
  if (
    mutation.artifacts?.some((artifact) => artifact.runId !== runId) ||
    mutation.events?.some((event) => event.runId !== runId) ||
    mutation.testEvidence?.some((evidence) => evidence.runId !== runId)
  ) {
    throw new Error('Workflow mutation candidates must belong to the mutated run')
  }
}

function assertWorkflowCreationScope(creation: WorkflowCreation): void {
  const runId = creation.run.id
  if (
    creation.artifacts.some((artifact) => artifact.runId !== runId) ||
    creation.events.some((event) => event.runId !== runId)
  ) {
    throw new Error('Workflow creation candidates must belong to the created run')
  }
}

type WorkRequestMaterializationRow = {
  work_request_id: string
  organization_id: string
  team_project_id: string
  local_project_id: string
  run_id: string
  claim_version: number
  source_fingerprint: string
  materialize_idempotency_key: string
  status: WorkRequestMaterializationBinding['status']
  acknowledged_version: number | null
  created_at: string
  updated_at: string
  acknowledged_at: string | null
}

const WORK_REQUEST_MATERIALIZATION_COLUMNS = `
  work_request_id,
  organization_id,
  team_project_id,
  local_project_id,
  run_id,
  claim_version,
  source_fingerprint,
  materialize_idempotency_key,
  status,
  acknowledged_version,
  created_at,
  updated_at,
  acknowledged_at
`

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonEmptyUnpadded(value: string): boolean {
  return value.length > 0 && value.trim() === value
}

function hasExpectedMaterializationPairing(
  current: DesktopPairingCredential | undefined,
  expected: WorkRequestMaterializationExpectedPairing,
): current is DesktopPairingCredential & { localProjectId: string } {
  return (
    current !== undefined &&
    current.tokenId === expected.tokenId &&
    current.organizationId === expected.organizationId &&
    current.projectId === expected.projectId &&
    current.localProjectId === expected.localProjectId
  )
}

function mapWorkRequestMaterializationRow(
  row: WorkRequestMaterializationRow,
): WorkRequestMaterializationBinding {
  return {
    workRequestId: row.work_request_id,
    organizationId: row.organization_id,
    teamProjectId: row.team_project_id,
    localProjectId: row.local_project_id,
    runId: row.run_id,
    claimVersion: row.claim_version,
    sourceFingerprint: row.source_fingerprint,
    materializeIdempotencyKey: row.materialize_idempotency_key,
    status: row.status,
    acknowledgedVersion: row.acknowledged_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acknowledgedAt: row.acknowledged_at,
  }
}

function selectWorkRequestMaterialization(
  db: Database,
  where: 'work_request_id' | 'run_id' | 'materialize_idempotency_key',
  value: string,
): WorkRequestMaterializationBinding | null {
  const result = db.exec(
    `select ${WORK_REQUEST_MATERIALIZATION_COLUMNS}
     from work_request_materializations
     where ${where} = ?
     limit 1`,
    [value],
  )
  const row = result[0]?.values[0]
  if (!row) {
    return null
  }
  return mapWorkRequestMaterializationRow({
    work_request_id: String(row[0]),
    organization_id: String(row[1]),
    team_project_id: String(row[2]),
    local_project_id: String(row[3]),
    run_id: String(row[4]),
    claim_version: Number(row[5]),
    source_fingerprint: String(row[6]),
    materialize_idempotency_key: String(row[7]),
    status: String(row[8]) as WorkRequestMaterializationBinding['status'],
    acknowledged_version: row[9] === null ? null : Number(row[9]),
    created_at: String(row[10]),
    updated_at: String(row[11]),
    acknowledged_at: row[12] === null ? null : String(row[12]),
  })
}

function validateMaterializationInput(
  input: MaterializeClaimedWorkRequestInput,
  currentPairing: DesktopPairingCredential & { localProjectId: string },
): {
  workRequest: WorkRequest
  creation: WorkflowCreation
} | null {
  try {
    const workRequest = parseWorkRequestRecord(input.workRequest)
    const claim = workRequest.claim
    if (
      workRequest.status !== 'claim_pending' ||
      claim === null ||
      claim.materializedAt !== null ||
      workRequest.organizationId !== input.expectedPairing.organizationId ||
      workRequest.projectId !== input.expectedPairing.projectId ||
      input.creation.run.id !== claim.runId ||
      input.creation.run.projectId !== input.expectedPairing.localProjectId ||
      input.creation.run.creatorId !== currentPairing.userId ||
      workRequest.updatedAt !== claim.claimedAt ||
      !/^[0-9a-f]{64}$/.test(input.sourceFingerprint) ||
      !isNonEmptyUnpadded(input.materializeIdempotencyKey) ||
      input.materializeIdempotencyKey.length > 200
    ) {
      return null
    }

    const canonicalCreation = createWorkflowRunFromRequest({
      runId: claim.runId,
      title: workRequest.title,
      request: workRequest.request,
      projectId: input.expectedPairing.localProjectId,
      creatorId: currentPairing.userId,
      branchName: input.creation.run.branchName,
      now: claim.claimedAt,
    })
    if (JSON.stringify(canonicalCreation) !== JSON.stringify(input.creation)) {
      return null
    }
    return { workRequest, creation: canonicalCreation }
  } catch {
    return null
  }
}

function bindingMatchesMaterialization(
  binding: WorkRequestMaterializationBinding,
  input: MaterializeClaimedWorkRequestInput,
  workRequest: WorkRequest,
): boolean {
  return (
    binding.workRequestId === workRequest.id &&
    binding.organizationId === workRequest.organizationId &&
    binding.teamProjectId === workRequest.projectId &&
    binding.localProjectId === input.expectedPairing.localProjectId &&
    binding.runId === workRequest.claim?.runId &&
    binding.claimVersion === workRequest.version &&
    binding.sourceFingerprint === input.sourceFingerprint &&
    binding.materializeIdempotencyKey === input.materializeIdempotencyKey
  )
}

type GateCommandExecutionRow = {
  command_id: string
  organization_id: string
  team_project_id: string
  local_project_id: string
  claim_token_id: string
  work_request_id: string | null
  run_id: string
  node_id: string
  action: GateCommand['action']
  workflow_command: GateCommand['workflowCommand']
  requested_by_user_id: string
  requested_role: GateCommand['requestedRole']
  server_request_fingerprint: string
  execution_fingerprint: string
  expected_run_version: number
  expected_policy_version: number
  expected_blocker_ids_hash: string
  outcome_code: GateCommandOutcomeCode
  before_run_version: number
  after_run_version: number
  evaluated_at: string
  command_expires_at: string
  created_at: string
}

const GATE_COMMAND_EXECUTION_COLUMNS = `
  command_id, organization_id, team_project_id, local_project_id, claim_token_id,
  work_request_id, run_id, node_id, action, workflow_command,
  requested_by_user_id, requested_role, server_request_fingerprint,
  execution_fingerprint, expected_run_version, expected_policy_version,
  expected_blocker_ids_hash, outcome_code, before_run_version,
  after_run_version, evaluated_at, command_expires_at, created_at
`

function mapGateCommandExecutionRow(
  row: GateCommandExecutionRow,
): LocalGateCommandExecution {
  return {
    commandId: row.command_id,
    organizationId: row.organization_id,
    teamProjectId: row.team_project_id,
    localProjectId: row.local_project_id,
    claimTokenId: row.claim_token_id,
    workRequestId: row.work_request_id,
    runId: row.run_id,
    nodeId: row.node_id,
    action: row.action,
    workflowCommand: row.workflow_command,
    requestedByUserId: row.requested_by_user_id,
    requestedRole: row.requested_role,
    serverRequestFingerprint: row.server_request_fingerprint,
    executionFingerprint: row.execution_fingerprint,
    expectedRunVersion: row.expected_run_version,
    expectedPolicyVersion: row.expected_policy_version,
    expectedBlockerIdsHash: row.expected_blocker_ids_hash,
    outcomeCode: row.outcome_code,
    beforeRunVersion: row.before_run_version,
    afterRunVersion: row.after_run_version,
    evaluatedAt: row.evaluated_at,
    commandExpiresAt: row.command_expires_at,
    createdAt: row.created_at,
  }
}

function selectGateCommandExecution(
  db: Database,
  commandId: string,
): LocalGateCommandExecution | null {
  const row = db.exec(
    `select ${GATE_COMMAND_EXECUTION_COLUMNS}
     from gate_command_executions where command_id = ? limit 1`,
    [commandId],
  )[0]?.values[0]
  if (!row) return null
  return mapGateCommandExecutionRow({
    command_id: String(row[0]),
    organization_id: String(row[1]),
    team_project_id: String(row[2]),
    local_project_id: String(row[3]),
    claim_token_id: String(row[4]),
    work_request_id: row[5] === null ? null : String(row[5]),
    run_id: String(row[6]),
    node_id: String(row[7]),
    action: String(row[8]) as GateCommand['action'],
    workflow_command:
      row[9] === null ? null : String(row[9]) as GateCommand['workflowCommand'],
    requested_by_user_id: String(row[10]),
    requested_role: String(row[11]) as GateCommand['requestedRole'],
    server_request_fingerprint: String(row[12]),
    execution_fingerprint: String(row[13]),
    expected_run_version: Number(row[14]),
    expected_policy_version: Number(row[15]),
    expected_blocker_ids_hash: String(row[16]),
    outcome_code: String(row[17]) as GateCommandOutcomeCode,
    before_run_version: Number(row[18]),
    after_run_version: Number(row[19]),
    evaluated_at: String(row[20]),
    command_expires_at: String(row[21]),
    created_at: String(row[22]),
  })
}

const GATE_COMMAND_RECEIPT_OBSERVATION_COLUMNS = `
  receipt_id, command_id, attempt, leased_at, lease_expires_at, received_at,
  organization_id, team_project_id, local_project_id, work_request_id,
  run_id, node_id, claim_token_id, execution_fingerprint,
  status, outcome_code, evaluated_at
`

function mapGateCommandReceiptObservationRow(
  row: SqlValue[],
): LocalGateCommandReceiptObservation {
  return {
    receiptId: String(row[0]),
    commandId: String(row[1]),
    attempt: Number(row[2]),
    leasedAt: String(row[3]),
    leaseExpiresAt: String(row[4]),
    receivedAt: String(row[5]),
    organizationId: String(row[6]),
    teamProjectId: String(row[7]),
    localProjectId: String(row[8]),
    workRequestId: row[9] === null ? null : String(row[9]),
    runId: String(row[10]),
    nodeId: String(row[11]),
    claimTokenId: String(row[12]),
    executionFingerprint: String(row[13]),
    status: String(row[14]) as LocalGateCommandReceiptObservation['status'],
    outcomeCode:
      row[15] === null ? null : String(row[15]) as GateCommandOutcomeCode,
    evaluatedAt: row[16] === null ? null : String(row[16]),
  }
}

function selectGateCommandReceiptObservation(
  db: Database,
  receiptId: string,
): LocalGateCommandReceiptObservation | null {
  const row = db.exec(
    `select ${GATE_COMMAND_RECEIPT_OBSERVATION_COLUMNS}
     from gate_command_receipt_observations where receipt_id = ? limit 1`,
    [receiptId],
  )[0]?.values[0]
  return row ? mapGateCommandReceiptObservationRow(row) : null
}

function selectGateCommandReceiptObservationByAttempt(
  db: Database,
  commandId: string,
  attempt: number,
): LocalGateCommandReceiptObservation | null {
  const row = db.exec(
    `select ${GATE_COMMAND_RECEIPT_OBSERVATION_COLUMNS}
     from gate_command_receipt_observations
     where command_id = ? and attempt = ? limit 1`,
    [commandId, attempt],
  )[0]?.values[0]
  return row ? mapGateCommandReceiptObservationRow(row) : null
}

function insertGateCommandReceiptObservation(
  db: Database,
  observation: LocalGateCommandReceiptObservation,
): void {
  db.run(
    `insert into gate_command_receipt_observations (
       ${GATE_COMMAND_RECEIPT_OBSERVATION_COLUMNS}
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      observation.receiptId,
      observation.commandId,
      observation.attempt,
      observation.leasedAt,
      observation.leaseExpiresAt,
      observation.receivedAt,
      observation.organizationId,
      observation.teamProjectId,
      observation.localProjectId,
      observation.workRequestId,
      observation.runId,
      observation.nodeId,
      observation.claimTokenId,
      observation.executionFingerprint,
      observation.status,
      observation.outcomeCode,
      observation.evaluatedAt,
    ],
  )
}

type GateCommandReceiptObservationConflictReason =
  | 'pairing_scope_mismatch'
  | 'fingerprint_conflict'
  | 'receipt_conflict'

function gateCommandReceiptObservationBindingConflict(input: {
  observation: LocalGateCommandReceiptObservation
  command: GateCommand
  receipt: GateCommandReceipt
  expectedPairing: WorkRequestMaterializationExpectedPairing
  executionFingerprint: string
}): GateCommandReceiptObservationConflictReason | null {
  const { observation, command, receipt, expectedPairing, executionFingerprint } = input
  if (
    observation.organizationId !== command.organizationId ||
    observation.teamProjectId !== command.projectId ||
    observation.organizationId !== expectedPairing.organizationId ||
    observation.teamProjectId !== expectedPairing.projectId ||
    observation.localProjectId !== expectedPairing.localProjectId ||
    observation.claimTokenId !== expectedPairing.tokenId
  ) {
    return 'pairing_scope_mismatch'
  }
  if (observation.executionFingerprint !== executionFingerprint) {
    return 'fingerprint_conflict'
  }
  if (
    observation.receiptId !== receipt.id ||
    observation.commandId !== command.id ||
    observation.attempt !== receipt.attempt ||
    observation.leasedAt !== receipt.leasedAt ||
    observation.leaseExpiresAt !== receipt.leaseExpiresAt ||
    observation.workRequestId !== command.workRequestId ||
    observation.runId !== command.runId ||
    observation.nodeId !== command.nodeId
  ) {
    return 'receipt_conflict'
  }
  return null
}

function finalizeGateCommandReceiptObservation(input: {
  db: Database
  command: GateCommand
  receipt: GateCommandReceipt
  expectedPairing: WorkRequestMaterializationExpectedPairing
  executionFingerprint: string
  outcomeCode: GateCommandOutcomeCode
  evaluatedAt: string
  allowEvaluatedReplay: boolean
}): GateCommandReceiptObservationConflictReason | null {
  const existing = selectGateCommandReceiptObservation(input.db, input.receipt.id)
  if (existing) {
    const conflict = gateCommandReceiptObservationBindingConflict({
      observation: existing,
      command: input.command,
      receipt: input.receipt,
      expectedPairing: input.expectedPairing,
      executionFingerprint: input.executionFingerprint,
    })
    if (conflict) return conflict
    if (existing.status === 'evaluated') {
      return input.allowEvaluatedReplay && existing.outcomeCode === input.outcomeCode
        ? null
        : 'receipt_conflict'
    }
    if (Date.parse(input.evaluatedAt) < Date.parse(existing.receivedAt)) {
      return 'receipt_conflict'
    }
    input.db.run(
      `update gate_command_receipt_observations
       set status = 'evaluated', outcome_code = ?, evaluated_at = ?
       where receipt_id = ? and status = 'received'
         and outcome_code is null and evaluated_at is null`,
      [input.outcomeCode, input.evaluatedAt, input.receipt.id],
    )
    if (input.db.getRowsModified() !== 1) {
      throw new Error('Gate Command receipt observation evaluation was not atomic.')
    }
    return null
  }

  const existingAttempt = selectGateCommandReceiptObservationByAttempt(
    input.db,
    input.command.id,
    input.receipt.attempt,
  )
  if (existingAttempt) {
    return gateCommandReceiptObservationBindingConflict({
      observation: existingAttempt,
      command: input.command,
      receipt: input.receipt,
      expectedPairing: input.expectedPairing,
      executionFingerprint: input.executionFingerprint,
    }) ?? 'receipt_conflict'
  }

  insertGateCommandReceiptObservation(input.db, {
    receiptId: input.receipt.id,
    commandId: input.command.id,
    attempt: input.receipt.attempt,
    leasedAt: input.receipt.leasedAt,
    leaseExpiresAt: input.receipt.leaseExpiresAt,
    receivedAt: input.evaluatedAt,
    organizationId: input.command.organizationId,
    teamProjectId: input.command.projectId,
    localProjectId: input.expectedPairing.localProjectId,
    workRequestId: input.command.workRequestId,
    runId: input.command.runId,
    nodeId: input.command.nodeId,
    claimTokenId: input.expectedPairing.tokenId,
    executionFingerprint: input.executionFingerprint,
    status: 'evaluated',
    outcomeCode: input.outcomeCode,
    evaluatedAt: input.evaluatedAt,
  })
  return null
}

function selectGateCommandAcknowledgement(
  db: Database,
  receiptId: string,
): LocalGateCommandAcknowledgement | null {
  const row = db.exec(
    `select receipt_id, command_id, outcome_code, before_run_version,
            after_run_version, evaluated_at, status,
            remote_acknowledgement_id, remote_created_at, remote_replayed,
            created_at, acknowledged_at, failure_code, failed_at
     from gate_command_acknowledgements where receipt_id = ? limit 1`,
    [receiptId],
  )[0]?.values[0]
  if (!row) return null
  return {
    receiptId: String(row[0]),
    commandId: String(row[1]),
    outcomeCode: String(row[2]) as GateCommandOutcomeCode,
    beforeRunVersion: Number(row[3]),
    afterRunVersion: Number(row[4]),
    evaluatedAt: String(row[5]),
    status: String(row[6]) as LocalGateCommandAcknowledgement['status'],
    remoteAcknowledgementId: row[7] === null ? null : String(row[7]),
    remoteCreatedAt: row[8] === null ? null : String(row[8]),
    remoteReplayed: row[9] === null ? null : Number(row[9]) === 1,
    createdAt: String(row[10]),
    acknowledgedAt: row[11] === null ? null : String(row[11]),
    failureCode:
      row[12] === null ? null : String(row[12]) as RemoteSyncFailureCode,
    failedAt: row[13] === null ? null : String(row[13]),
  }
}

function selectPendingGateCommandAcknowledgementByCommand(
  db: Database,
  commandId: string,
): LocalGateCommandAcknowledgement | null {
  const receiptId = db.exec(
    `select receipt_id from gate_command_acknowledgements
     where command_id = ? and status = 'pending'
     order by created_at asc, receipt_id asc limit 1`,
    [commandId],
  )[0]?.values[0]?.[0]
  return receiptId === undefined
    ? null
    : selectGateCommandAcknowledgement(db, String(receiptId))
}

const GATE_COMMAND_TERMINAL_ACK_FAILURE_CODES = new Set<RemoteSyncFailureCode>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'scope_mismatch',
  'remote_error',
])

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    )
  }
  return value
}

function stableJsonMatches(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right))
}

function canonicalUniqueStrings(values: readonly string[]): string[] | null {
  if (values.some((value) => !isNonEmptyUnpadded(value))) return null
  const unique = new Set(values)
  return unique.size === values.length ? [...unique].sort() : null
}

function canonicalGateOverrides(
  overrides: readonly GateOverrideDecision[],
): GateOverrideDecision[] {
  return [...overrides].sort((left, right) => left.id.localeCompare(right.id))
}

export function gateCommandExecutionFingerprint(command: GateCommand): string {
  return sha256Canonical({
    id: command.id,
    organizationId: command.organizationId,
    projectId: command.projectId,
    workRequestId: command.workRequestId,
    runId: command.runId,
    nodeId: command.nodeId,
    action: command.action,
    workflowCommand: command.workflowCommand,
    reason: command.reason,
    requestedByUserId: command.requestedByUserId,
    requestedRole: command.requestedRole,
    idempotencyKey: command.idempotencyKey,
    serverRequestFingerprint: command.requestFingerprint,
    expectedRunVersion: command.expectedRunVersion,
    expectedPolicyVersion: command.expectedPolicyVersion,
    expectedBlockerIds: command.expectedBlockerIds,
    evaluationStatus: command.evaluationStatus,
    evaluationBlockerIds: command.evaluationBlockerIds,
    serverEvaluatedAt: command.evaluatedAt,
    expiresAt: command.expiresAt,
    createdAt: command.createdAt,
  })
}

function isGateReceiptEvaluationWindowValid(input: {
  command: GateCommand
  receipt: GateCommandReceipt
  outcomeCode: GateCommandOutcomeCode
  evaluatedAt: string
}): boolean {
  if (!isCanonicalIsoTimestamp(input.evaluatedAt)) return false
  const evaluatedAt = Date.parse(input.evaluatedAt)
  const isReceiptScopeValid =
    input.command.status === 'delivering' &&
    input.command.outcomeCode === null &&
    input.receipt.commandId === input.command.id &&
    input.receipt.acknowledgedAt === null &&
    evaluatedAt >= Date.parse(input.receipt.leasedAt)
  if (!isReceiptScopeValid) return false
  return input.outcomeCode === 'expired'
    ? evaluatedAt >= Date.parse(input.command.expiresAt)
    : evaluatedAt < Date.parse(input.receipt.leaseExpiresAt) &&
        evaluatedAt < Date.parse(input.command.expiresAt)
}

function gateRunEnvelopeIsImmutable(
  expectedRun: WorkflowRun,
  run: WorkflowRun,
): boolean {
  return (
    run.id === expectedRun.id &&
    run.title === expectedRun.title &&
    run.request === expectedRun.request &&
    run.projectId === expectedRun.projectId &&
    run.creatorId === expectedRun.creatorId &&
    run.branchName === expectedRun.branchName &&
    run.pullRequestUrl === expectedRun.pullRequestUrl &&
    run.createdAt === expectedRun.createdAt &&
    JSON.stringify(run.edges) === JSON.stringify(expectedRun.edges)
  )
}

type PersistedGateEvidence = Omit<WorkflowEvidenceSnapshot, 'approval'>

function readPersistedGateEvidence(
  db: Database,
  runId: string,
): PersistedGateEvidence {
  const artifacts = selectJson<Artifact>(
    db,
    'select json from artifacts where run_id = ? order by updated_at asc',
    [runId],
  )
  const codingRuns = selectJson<CodingAgentRun>(
    db,
    'select json from coding_agent_runs where run_id = ? order by updated_at desc, started_at desc',
    [runId],
  )
  const codingDiffs = selectJson<CodingDiffArtifact>(
    db,
    'select json from coding_diff_artifacts where run_id = ? order by created_at asc',
    [runId],
  )
  const testEvidence = selectJson<TestEvidence>(
    db,
    'select json from test_evidence where run_id = ? order by created_at asc',
    [runId],
  )
  const agentReviews = selectJson<AgentReviewResult>(
    db,
    'select json from agent_reviews where run_id = ? order by created_at desc',
    [runId],
  )
  const latestCodingRun = [...codingRuns].sort((left, right) =>
    (right.completedAt ?? right.startedAt).localeCompare(
      left.completedAt ?? left.startedAt,
    ),
  )[0]
  return {
    artifacts,
    codingRuns,
    codingDiffs,
    testEvidence,
    agentReviews,
    ...(latestCodingRun?.budgetDecision
      ? { budgetDecision: latestCodingRun.budgetDecision }
      : {}),
  }
}

function canonicalPersistedGateEvidence(
  evidence: PersistedGateEvidence,
): PersistedGateEvidence {
  const byId = <T extends { id: string }>(values: readonly T[]): T[] =>
    [...values].sort((left, right) => left.id.localeCompare(right.id))
  return {
    artifacts: byId(evidence.artifacts),
    codingRuns: byId(evidence.codingRuns),
    codingDiffs: byId(evidence.codingDiffs),
    testEvidence: byId(evidence.testEvidence),
    agentReviews: byId(evidence.agentReviews),
    ...(evidence.budgetDecision
      ? { budgetDecision: evidence.budgetDecision }
      : {}),
  }
}

function replayCanonicalGateTransition(input: {
  run: WorkflowRun
  command: GateCommand
  evaluatedAt: string
  evidence: PersistedGateEvidence
  approvalAllowed: boolean
}): WorkflowRun | null {
  if (input.command.workflowCommand === null) return null
  const node = input.run.nodes.find(
    (candidate) => candidate.id === input.command.nodeId,
  )
  if (!node) return null
  const result = applyWorkflowCommand({
    run: input.run,
    command: {
      type: input.command.workflowCommand,
      nodeId: input.command.nodeId,
    },
    evidence: {
      ...input.evidence,
      approval: {
        roleAllowed: true,
        policy: { blocksApproval: !input.approvalAllowed },
        review: node.kind === 'acceptance' ? 'required' : 'not_required',
        budget: node.kind === 'acceptance' ? 'required' : 'not_required',
      },
    },
    now: input.evaluatedAt,
  })
  return result.applied ? normalizeWorkflowRunProgress(result.run) : null
}

class SqlJsLocalStore implements LocalStore {
  private persistenceQueue: Promise<void> = Promise.resolve()
  private readonly agentMemoryPromotionOwner = Object.freeze(Object.create(null)) as object
  private readonly specialistTaskAuthorityStoreIdentity = Object.freeze(Object.create(null)) as object

  constructor(
    private readonly sql: SqlJsStatic,
    private db: Database,
    private readonly dbPath: string,
  ) {}

  getSpecialistTaskAuthorityStoreIdentity(): object {
    return this.specialistTaskAuthorityStoreIdentity
  }

  async upsertProject(project: LocalProject): Promise<void> {
    this.db.run(
      `
      insert into local_projects (id, json, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [project.id, JSON.stringify(project), project.createdAt, project.updatedAt],
    )
    await this.persist()
  }

  async listProjects(): Promise<LocalProject[]> {
    return selectJson<LocalProject>(
      this.db,
      'select json from local_projects order by updated_at desc, created_at desc',
    )
  }

  async activateKnowledgeIndexSnapshot(
    input: ActivateKnowledgeIndexSnapshotInput,
  ): Promise<ActivateKnowledgeIndexSnapshotResult> {
    const result = activateKnowledgeIndexSnapshotInDatabase(this.db, input)
    if (result.activated && !result.replayed) await this.persist()
    return result
  }

  async getCurrentKnowledgeIndexSnapshot(
    localProjectId: string,
  ): Promise<KnowledgeIndexSnapshot | null> {
    return readCurrentKnowledgeIndexSnapshot(this.db, localProjectId)
  }

  async getCurrentKnowledgeSnapshotIdentitySet(
    scope: KnowledgeRetrievalScope,
  ): Promise<KnowledgeSnapshotIdentitySet | null> {
    return readCurrentKnowledgeSnapshotIdentitySet(this.db, scope)
  }

  async rebuildKnowledgeIndexSnapshot(
    input: ActivateKnowledgeIndexSnapshotInput,
  ): Promise<ActivateKnowledgeIndexSnapshotResult> {
    const result = rebuildKnowledgeIndexSnapshotInDatabase(this.db, input)
    if (result.activated) await this.persist()
    return result
  }

  async saveAgentMemoryCandidate(
    value: AgentMemoryCandidate,
  ): Promise<SaveAgentMemoryCandidateResult> {
    let candidate: AgentMemoryCandidate
    try {
      candidate = await parseAgentMemoryCandidate(value)
    } catch {
      return { committed: false, reason: 'invalid_candidate' }
    }

    const localProjectExists = Boolean(selectJson<unknown>(
      this.db,
      'select json from local_projects where id = ? limit 1',
      [candidate.scope.localProjectId],
    )[0])
    const runtime = selectAgentRuntime(this.db, candidate.provenance.runtimeId)
    if (!localProjectExists || runtime === null) {
      return { committed: false, reason: 'source_not_found' }
    }
    if (JSON.stringify(runtime.scope) !== JSON.stringify(candidate.scope)) {
      return { committed: false, reason: 'scope_mismatch' }
    }
    const observation = selectAgentRuntimeEvents(this.db, runtime.id).find(
      (event) => event.sequence === candidate.provenance.sequence,
    )
    if (
      observation?.type !== 'observation_recorded' ||
      observation.checkpointVersion !== candidate.provenance.checkpointVersion ||
      observation.metadata.actionId !== candidate.provenance.actionId ||
      observation.metadata.resultDigest !== candidate.provenance.resultDigest ||
      !runtime.acceptedActionIds.includes(candidate.provenance.actionId) ||
      Date.parse(candidate.createdAt) < Date.parse(observation.createdAt)
    ) {
      return { committed: false, reason: 'source_not_found' }
    }
    if (candidate.scope.kind === 'team') {
      const pairing = await this.getDesktopPairingCredential()
      if (
        pairing === null ||
        pairing.organizationId !== candidate.scope.organizationId ||
        pairing.projectId !== candidate.scope.projectId ||
        pairing.userId !== candidate.scope.userId ||
        pairing.tokenId !== candidate.scope.sessionId ||
        pairing.localProjectId !== candidate.scope.localProjectId
      ) {
        return { committed: false, reason: 'scope_mismatch' }
      }
    }

    const existingValue = selectAgentMemoryCandidate(this.db, candidate.id)
    if (existingValue !== undefined) {
      const existing = await parseAgentMemoryCandidate(existingValue)
      return JSON.stringify(existing) === JSON.stringify(candidate)
        ? { committed: true, replayed: true, candidate: existing }
        : { committed: false, reason: 'id_conflict' }
    }
    const sameSource = selectJson<unknown>(
      this.db,
      `select json from agent_memory_candidates
       where local_project_id = ? and provenance_digest = ? and content_digest = ? limit 1`,
      [candidate.scope.localProjectId, candidate.provenanceDigest, candidate.contentDigest],
    )[0]
    if (sameSource !== undefined) {
      return { committed: false, reason: 'id_conflict' }
    }

    writeAgentMemoryCandidate(this.db, candidate)
    await this.persist()
    return { committed: true, replayed: false, candidate }
  }

  async listAgentMemoryCandidates(localProjectId?: string): Promise<AgentMemoryCandidate[]> {
    if (
      localProjectId !== undefined &&
      (!isNonEmptyIdentifier(localProjectId) || localProjectId.length > 200)
    ) {
      throw new Error('Invalid Local Project id')
    }
    const values = localProjectId === undefined
      ? selectJson<unknown>(
          this.db,
          'select json from agent_memory_candidates order by created_at asc, id asc',
        )
      : selectJson<unknown>(
          this.db,
          `select json from agent_memory_candidates
           where local_project_id = ? order by created_at asc, id asc`,
          [localProjectId],
        )
    return Promise.all(values.map(parseAgentMemoryCandidate))
  }

  async authorizeAgentMemoryPromotion(
    input: AuthorizeAgentMemoryPromotionInput,
  ): Promise<AuthorizeAgentMemoryPromotionResult> {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isNonEmptyIdentifier(input.candidateId) ||
      input.candidateId.length > 200 ||
      !isNonEmptyIdentifier(input.memoryId) ||
      input.memoryId.length > 200
    ) {
      return { authorized: false, reason: 'invalid_input' }
    }
    const candidateValue = selectJson<unknown>(
      this.db,
      'select json from agent_memory_candidates where id = ? limit 1',
      [input.candidateId],
    )[0]
    if (candidateValue === undefined) {
      return { authorized: false, reason: 'candidate_not_found' }
    }
    let candidate: AgentMemoryCandidate
    let revision: DurableAgentMemoryRevision
    try {
      candidate = await parseAgentMemoryCandidate(candidateValue)
      revision = await promoteAgentMemoryCandidate({
        candidate,
        memoryId: input.memoryId,
        authority: input.authority,
      })
    } catch {
      return { authorized: false, reason: 'invalid_input' }
    }
    const pairing = candidate.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(candidate.scope, pairing)) {
      return { authorized: false, reason: 'scope_mismatch' }
    }
    const sourceAlreadyPromoted = this.db.exec(
      'select 1 from agent_memory_revisions where source_candidate_id = ? limit 1',
      [candidate.id],
    )[0]?.values[0] !== undefined
    if (sourceAlreadyPromoted) {
      return { authorized: false, reason: 'already_promoted' }
    }
    const identityConflict = this.db.exec(
      `select 1 from agent_memory_revisions
       where memory_id = ? or promotion_decision_id = ? limit 1`,
      [revision.id, revision.promotionDecisionId],
    )[0]?.values[0] !== undefined
    if (identityConflict) {
      return { authorized: false, reason: 'id_conflict' }
    }

    const capability = Object.freeze(
      new Proxy(Object.create(null), {}),
    ) as AgentMemoryPromotionCapability
    const internalRevision = structuredClone(revision)
    agentMemoryPromotionCapabilities.set(capability, {
      owner: this.agentMemoryPromotionOwner,
      candidate,
      revision: internalRevision,
    })
    return { authorized: true, capability, revision: structuredClone(internalRevision) }
  }

  async commitAgentMemoryPromotion(
    input: CommitAgentMemoryPromotionInput,
    capability: AgentMemoryPromotionCapability,
  ): Promise<CommitAgentMemoryPromotionResult> {
    if (typeof capability !== 'object' || capability === null) {
      return { committed: false, reason: 'invalid_authority' }
    }
    const descriptor = agentMemoryPromotionCapabilities.get(capability)
    if (descriptor === undefined || descriptor.owner !== this.agentMemoryPromotionOwner) {
      return { committed: false, reason: 'invalid_authority' }
    }
    agentMemoryPromotionCapabilities.delete(capability)

    let revision: DurableAgentMemoryRevision
    try {
      revision = await parseDurableAgentMemoryRevision(input.revision)
    } catch {
      return { committed: false, reason: 'invalid_revision' }
    }
    if (!stableJsonMatches(revision, descriptor.revision)) {
      return { committed: false, reason: 'invalid_revision' }
    }
    const candidateValue = selectJson<unknown>(
      this.db,
      'select json from agent_memory_candidates where id = ? limit 1',
      [descriptor.candidate.id],
    )[0]
    if (candidateValue === undefined) {
      return { committed: false, reason: 'source_stale' }
    }
    let candidate: AgentMemoryCandidate
    try {
      candidate = await parseAgentMemoryCandidate(candidateValue)
    } catch {
      return { committed: false, reason: 'source_stale' }
    }
    if (!stableJsonMatches(candidate, descriptor.candidate)) {
      return { committed: false, reason: 'source_stale' }
    }
    const pairing = candidate.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(candidate.scope, pairing)) {
      return { committed: false, reason: 'source_stale' }
    }

    const existingValue = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? or source_candidate_id = ? or promotion_decision_id = ?
       order by revision asc limit 1`,
      [revision.id, revision.sourceCandidateId, revision.promotionDecisionId],
    )[0]
    if (existingValue !== undefined) {
      try {
        const existing = await parseDurableAgentMemoryRevision(existingValue)
        const head = stableJsonMatches(existing, revision)
          ? await this.getAgentMemoryHead(revision.id)
          : null
        const auditExists = this.db.exec(
          `select 1 from agent_memory_audits
           where id = ? and memory_id = ? and revision = ?
             and event_kind = 'candidate_promoted' and authority_digest = ? limit 1`,
          [
            `memory-promotion-audit-${revision.promotionDecisionId}`,
            revision.id,
            revision.revision,
            revision.promotionAuthorityDigest,
          ],
        )[0]?.values[0] !== undefined
        return head !== null &&
          auditExists &&
          head.currentRevision === revision.revision &&
          head.status === revision.status &&
          stableJsonMatches(head.scope, revision.scope)
            ? { committed: true, replayed: true, revision: existing }
            : { committed: false, reason: 'id_conflict' }
      } catch {
        return { committed: false, reason: 'id_conflict' }
      }
    }

    const scope = revision.scope
    this.db.run(
      `insert into agent_memory_revisions (
         memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, visibility, statement,
         content_digest, provenance_digest, source_candidate_id, supersedes_revision,
         sensitivity, retention_class, expires_at, promotion_decision_id,
         promotion_actor_kind, promotion_actor_id, promotion_policy_id,
         promotion_policy_version, promotion_authority_digest, status,
         state_version, json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        revision.id,
        revision.revision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        revision.visibility,
        revision.statement,
        revision.contentDigest,
        revision.provenanceDigest,
        revision.sourceCandidateId,
        revision.supersedesRevision,
        revision.sensitivity,
        revision.retentionClass,
        revision.expiresAt,
        revision.promotionDecisionId,
        revision.promotionActorKind,
        revision.promotionActorId,
        revision.promotionPolicyId,
        revision.promotionPolicyVersion,
        revision.promotionAuthorityDigest,
        revision.status,
        revision.stateVersion,
        JSON.stringify(revision),
        revision.createdAt,
      ],
    )
    this.db.run(
      `insert into agent_memory_heads (
         memory_id, current_revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, status, version, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        revision.id,
        revision.revision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        revision.status,
        1,
        revision.createdAt,
      ],
    )
    const auditMetadata = {
      candidateId: candidate.id,
      contentDigest: revision.contentDigest,
      provenanceDigest: revision.provenanceDigest,
      visibility: revision.visibility,
      sensitivity: revision.sensitivity,
      retentionClass: revision.retentionClass,
      expiresAt: revision.expiresAt,
      status: revision.status,
      policyId: revision.promotionPolicyId,
      policyVersion: revision.promotionPolicyVersion,
    }
    this.db.run(
      `insert into agent_memory_audits (
         id, memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
         authority_digest, state_version, metadata_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `memory-promotion-audit-${revision.promotionDecisionId}`,
        revision.id,
        revision.revision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        'candidate_promoted',
        revision.promotionActorKind,
        revision.promotionActorId,
        revision.promotionAuthorityDigest,
        revision.stateVersion,
        JSON.stringify(auditMetadata),
        revision.createdAt,
      ],
    )
    await this.enqueueCanonicalAgentMemoryProjection(revision.id, revision.createdAt)
    await this.persist()
    return { committed: true, replayed: false, revision }
  }

  async listAgentMemoryRevisions(memoryId: string): Promise<DurableAgentMemoryRevision[]> {
    if (!isNonEmptyIdentifier(memoryId) || memoryId.length > 200) {
      throw new Error('Invalid Agent Memory id')
    }
    const values = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? order by revision asc`,
      [memoryId],
    )
    return Promise.all(values.map(parseDurableAgentMemoryRevision))
  }

  async listAgentMemoryHeads(localProjectId?: string): Promise<AgentMemoryHeadRecord[]> {
    if (
      localProjectId !== undefined &&
      (!isNonEmptyIdentifier(localProjectId) || localProjectId.length > 200)
    ) {
      throw new Error('Invalid Local Project id')
    }
    const rows = localProjectId === undefined
      ? this.db.exec(
          `select memory_id from agent_memory_heads
           order by updated_at desc, memory_id asc`,
        )[0]?.values ?? []
      : this.db.exec(
          `select memory_id from agent_memory_heads
           where local_project_id = ? order by updated_at desc, memory_id asc`,
          [localProjectId],
        )[0]?.values ?? []
    return Promise.all(rows.map(async (row) => {
      const head = await this.getAgentMemoryHead(String(row[0]))
      if (head === null) throw new Error('Stored Agent Memory head is invalid')
      return head
    }))
  }

  async getAgentMemoryHead(memoryId: string): Promise<AgentMemoryHeadRecord | null> {
    if (!isNonEmptyIdentifier(memoryId) || memoryId.length > 200) {
      throw new Error('Invalid Agent Memory id')
    }
    const row = this.db.exec(
      `select h.memory_id, h.current_revision, h.local_project_id, h.scope_kind,
              h.organization_id, h.team_project_id, h.user_id, h.session_id,
              h.status, h.version, h.updated_at, r.json
       from agent_memory_heads h
       join agent_memory_revisions r
         on r.memory_id = h.memory_id and r.revision = h.current_revision
       where h.memory_id = ? limit 1`,
      [memoryId],
    )[0]?.values[0]
    if (row === undefined) return null
    const currentRevision = Number(row[1])
    const version = Number(row[9])
    const scope: KnowledgeRetrievalScope = row[3] === 'team'
      ? {
          kind: 'team',
          organizationId: String(row[4]),
          projectId: String(row[5]),
          userId: String(row[6]),
          sessionId: String(row[7]),
          localProjectId: String(row[2]),
        }
      : {
          kind: 'local',
          organizationId: null,
          projectId: null,
          userId: String(row[6]),
          sessionId: String(row[7]),
          localProjectId: String(row[2]),
        }
    const status = String(row[8])
    const updatedAt = String(row[10])
    let revision: DurableAgentMemoryRevision
    try {
      revision = await parseDurableAgentMemoryRevision(JSON.parse(String(row[11])))
    } catch {
      throw new Error('Stored Agent Memory head is invalid')
    }
    if (
      row[0] !== memoryId ||
      !Number.isInteger(currentRevision) ||
      currentRevision < 1 ||
      !Number.isInteger(version) ||
      version < 1 ||
      !['active', 'conflict', 'expired', 'purge_pending', 'deleted'].includes(status) ||
      !isCanonicalIsoTimestamp(updatedAt) ||
      revision.id !== memoryId ||
      revision.revision !== currentRevision ||
      !stableJsonMatches(revision.scope, scope)
    ) {
      throw new Error('Stored Agent Memory head is invalid')
    }
    return {
      memoryId,
      currentRevision,
      scope,
      status: status as AgentMemoryHeadRecord['status'],
      version,
      updatedAt,
    }
  }

  async getAgentMemoryTeamProjectionInput(
    memoryId: string,
  ): Promise<CreateRemoteAgentMemorySummaryInput | null> {
    const head = await this.getAgentMemoryHead(memoryId)
    if (head === null || head.scope.kind !== 'team') return null
    const pairing = await this.getDesktopPairingCredential()
    if (!agentMemoryScopeMatchesPairing(head.scope, pairing)) return null

    const [revisions, tombstone] = await Promise.all([
      this.listAgentMemoryRevisions(memoryId),
      this.getAgentMemoryTombstone(memoryId),
    ])
    const revision = revisions.find((candidate) => candidate.revision === head.currentRevision)
    if (
      revision === undefined ||
      !stableJsonMatches(revision.scope, head.scope) ||
      (tombstone !== null && !stableJsonMatches(tombstone.scope, head.scope))
    ) return null

    const candidateValue = selectJson<unknown>(
      this.db,
      'select json from agent_memory_candidates where id = ? limit 1',
      [revision.sourceCandidateId],
    )[0]
    if (candidateValue === undefined) return null
    let candidate: AgentMemoryCandidate
    try {
      candidate = await parseAgentMemoryCandidate(candidateValue)
    } catch {
      return null
    }
    if (!stableJsonMatches(candidate.scope, head.scope)) return null

    const runtime = await this.getAgentRuntime(candidate.provenance.runtimeId)
    const run = runtime === null ? null : await this.getRun(runtime.authority.runId)
    if (
      runtime === null ||
      run === null ||
      !stableJsonMatches(runtime.scope, head.scope) ||
      run.projectId !== head.scope.localProjectId ||
      !run.nodes.some((node) => node.id === runtime.authority.nodeId)
    ) return null

    const sourceAttachment = await this.getAgentRuntimeContextAttachment(runtime.id)
    if (
      sourceAttachment !== null &&
      !stableJsonMatches(sourceAttachment.scope, head.scope)
    ) return null
    const citationIds = [...new Set(
      sourceAttachment?.knowledgeCitations.map((citation) => citation.requestId) ?? [],
    )].sort()

    const attachmentValues = selectJson<unknown>(
      this.db,
      'select json from agent_runtime_context_attachments order by attached_at asc, id asc',
    )
    const attachments: AgentRuntimeContextAttachment[] = []
    try {
      for (const value of attachmentValues) {
        attachments.push(await parseAgentRuntimeContextAttachment(value))
      }
    } catch {
      return null
    }
    const acceptedContextAttachments = attachments.filter((attachment) =>
      stableJsonMatches(attachment.scope, head.scope) &&
      attachment.memoryRevisions.some((memory) => memory.id === memoryId),
    )
    const acceptedContextCount = acceptedContextAttachments.length
    const qualityUpdatedAt = acceptedContextAttachments.reduce(
      (latest, attachment) => Date.parse(attachment.attachedAt) > Date.parse(latest)
        ? attachment.attachedAt
        : latest,
      head.updatedAt,
    )

    let memory
    try {
      memory = createAgentMemoryRendererSnapshot({
        scope: head.scope,
        candidates: [],
        memories: [{ head, revision, tombstone }],
        observedAt: head.updatedAt,
      }).memories[0]
    } catch {
      return null
    }
    if (memory === undefined) return null

    return {
      memory,
      runId: runtime.authority.runId,
      nodeId: runtime.authority.nodeId,
      runtimeId: runtime.id,
      citationIds,
      retrievalCount: acceptedContextCount,
      acceptedContextCount,
      qualityVersion: acceptedContextCount + 1,
      qualityUpdatedAt,
    }
  }

  async retrieveAgentMemoryRevisions(
    input: AgentMemoryRetrievalRequest,
  ): Promise<DurableAgentMemoryRevision[]> {
    let request: AgentMemoryRetrievalRequest
    try {
      request = parseAgentMemoryRetrievalRequest(input)
    } catch {
      throw new Error('Invalid Agent Memory retrieval request')
    }
    const pairing = request.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(request.scope, pairing)) {
      return []
    }

    const values = selectJson<unknown>(
      this.db,
      `select r.json
       from agent_memory_heads h
       join agent_memory_revisions r
         on r.memory_id = h.memory_id and r.revision = h.current_revision
       join agent_memory_candidates c on c.id = r.source_candidate_id
       left join agent_memory_tombstones t on t.memory_id = h.memory_id
       where h.status = 'active'
         and r.status = 'active'
         and t.memory_id is null
         and h.local_project_id = ?
         and h.scope_kind = ?
         and h.organization_id is ?
         and h.team_project_id is ?
         and (
           (r.visibility = 'runtime' and h.user_id = ? and h.session_id = ? and c.runtime_id = ?) or
           (r.visibility = 'user_project' and h.user_id = ?) or
           (r.visibility = 'project_shared' and h.scope_kind = 'team')
         )
       order by r.created_at asc, r.memory_id asc
       limit ?`,
      [
        request.scope.localProjectId,
        request.scope.kind,
        request.scope.organizationId,
        request.scope.projectId,
        request.scope.userId,
        request.scope.sessionId,
        request.runtimeId,
        request.scope.userId,
        AGENT_MEMORY_ACTIVE_REVISIONS_MAX + 1,
      ],
    )
    if (values.length > AGENT_MEMORY_ACTIVE_REVISIONS_MAX) {
      throw new Error('Agent Memory scope exceeds the active revision hard maximum')
    }

    const revisions = await Promise.all(values.map(parseDurableAgentMemoryRevision))
    const retrievable: DurableAgentMemoryRevision[] = []
    let expiredAny = false
    for (const revision of revisions) {
      const head = await this.getAgentMemoryHead(revision.id)
      if (
        head === null ||
        head.status !== 'active' ||
        head.currentRevision !== revision.revision ||
        !stableJsonMatches(head.scope, revision.scope)
      ) {
        throw new Error('Stored Agent Memory retrieval state is invalid')
      }
      if (
        revision.expiresAt !== null &&
        Date.parse(revision.expiresAt) <= Date.parse(request.requestedAt)
      ) {
        const expiredAt = Date.parse(request.requestedAt) >= Date.parse(head.updatedAt)
          ? request.requestedAt
          : head.updatedAt
        this.db.run(
          `update agent_memory_heads
           set status = 'expired', version = version + 1, updated_at = ?
           where memory_id = ? and current_revision = ? and version = ? and status = 'active'`,
          [expiredAt, revision.id, revision.revision, head.version],
        )
        if (this.db.getRowsModified() !== 1) {
          throw new Error('Agent Memory expiry CAS was lost')
        }
        const authorityDigest = sha256Canonical({
          stateVersion: revision.stateVersion,
          memoryId: revision.id,
          revision: revision.revision,
          expiresAt: revision.expiresAt,
          status: 'expired',
        })
        this.db.run(
          `insert into agent_memory_audits (
             id, memory_id, revision, local_project_id, scope_kind, organization_id,
             team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
             authority_digest, state_version, metadata_json, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `memory-expiry-audit-${revision.id}-${revision.revision}`,
            revision.id,
            revision.revision,
            revision.scope.localProjectId,
            revision.scope.kind,
            revision.scope.organizationId,
            revision.scope.projectId,
            revision.scope.userId,
            revision.scope.sessionId,
            'memory_expired',
            'system',
            'electron-main-memory-retention',
            authorityDigest,
            revision.stateVersion,
            JSON.stringify({ expiresAt: revision.expiresAt, status: 'expired' }),
            expiredAt,
          ],
        )
        await this.enqueueCanonicalAgentMemoryProjection(revision.id, expiredAt)
        expiredAny = true
        continue
      }
      if (retrievable.length < request.limit) {
        retrievable.push(revision)
      }
    }
    if (expiredAny) await this.persist()
    return retrievable
  }

  async authorizeAgentMemoryRevision(
    input: AuthorizeAgentMemoryRevisionInput,
  ): Promise<AuthorizeAgentMemoryRevisionResult> {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isNonEmptyIdentifier(input.memoryId) ||
      input.memoryId.length > 200 ||
      !Number.isInteger(input.expectedHeadVersion) ||
      input.expectedHeadVersion < 1
    ) {
      return { authorized: false, reason: 'invalid_input' }
    }
    const head = await this.getAgentMemoryHead(input.memoryId)
    if (head === null) {
      return { authorized: false, reason: 'memory_not_found' }
    }
    if (head.status !== 'active' || head.version !== input.expectedHeadVersion) {
      return { authorized: false, reason: 'version_conflict' }
    }
    const currentValue = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? and revision = ? limit 1`,
      [head.memoryId, head.currentRevision],
    )[0]
    if (currentValue === undefined) {
      return { authorized: false, reason: 'memory_not_found' }
    }
    let currentRevision: DurableAgentMemoryRevision
    let revision: DurableAgentMemoryRevision
    try {
      currentRevision = await parseDurableAgentMemoryRevision(currentValue)
      revision = await reviseAgentMemoryRevision({
        currentRevision,
        statement: input.statement,
        authority: input.authority,
      })
    } catch {
      return { authorized: false, reason: 'invalid_input' }
    }
    if (!stableJsonMatches(currentRevision.scope, head.scope)) {
      return { authorized: false, reason: 'scope_mismatch' }
    }
    const pairing = currentRevision.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(currentRevision.scope, pairing)) {
      return { authorized: false, reason: 'scope_mismatch' }
    }
    const decisionConflict = this.db.exec(
      `select 1 from agent_memory_revisions where promotion_decision_id = ?
       union all
       select 1 from agent_memory_audits where id in (?, ?)
       limit 1`,
      [
        revision.promotionDecisionId,
        `memory-revision-audit-${revision.promotionDecisionId}`,
        `memory-conflict-audit-${revision.promotionDecisionId}`,
      ],
    )[0]?.values[0] !== undefined
    if (decisionConflict) {
      return { authorized: false, reason: 'id_conflict' }
    }

    const capability = Object.freeze(
      new Proxy(Object.create(null), {}),
    ) as AgentMemoryRevisionCapability
    const internalCurrentRevision = structuredClone(currentRevision)
    const internalRevision = structuredClone(revision)
    agentMemoryRevisionCapabilities.set(capability, {
      owner: this.agentMemoryPromotionOwner,
      expectedHeadVersion: input.expectedHeadVersion,
      currentRevision: internalCurrentRevision,
      revision: internalRevision,
    })
    return { authorized: true, capability, revision: structuredClone(internalRevision) }
  }

  async commitAgentMemoryRevision(
    input: CommitAgentMemoryRevisionInput,
    capability: AgentMemoryRevisionCapability,
  ): Promise<CommitAgentMemoryRevisionResult> {
    if (typeof capability !== 'object' || capability === null) {
      return { committed: false, reason: 'invalid_authority' }
    }
    const descriptor = agentMemoryRevisionCapabilities.get(capability)
    if (descriptor === undefined || descriptor.owner !== this.agentMemoryPromotionOwner) {
      return { committed: false, reason: 'invalid_authority' }
    }
    agentMemoryRevisionCapabilities.delete(capability)

    let revision: DurableAgentMemoryRevision
    try {
      revision = await parseDurableAgentMemoryRevision(input.revision)
    } catch {
      return { committed: false, reason: 'invalid_revision' }
    }
    if (
      !stableJsonMatches(revision, descriptor.revision) ||
      !isCanonicalIsoTimestamp(input.recordedAt) ||
      Date.parse(input.recordedAt) < Date.parse(revision.createdAt)
    ) {
      return { committed: false, reason: 'invalid_revision' }
    }

    const existingValue = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? and (revision = ? or promotion_decision_id = ?)
       order by revision asc limit 1`,
      [revision.id, revision.revision, revision.promotionDecisionId],
    )[0]
    if (existingValue !== undefined) {
      try {
        const existing = await parseDurableAgentMemoryRevision(existingValue)
        const head = stableJsonMatches(existing, revision)
          ? await this.getAgentMemoryHead(revision.id)
          : null
        const auditExists = this.db.exec(
          `select 1 from agent_memory_audits
           where id = ? and memory_id = ? and revision = ?
             and event_kind = 'memory_revised' and authority_digest = ? limit 1`,
          [
            `memory-revision-audit-${revision.promotionDecisionId}`,
            revision.id,
            revision.revision,
            revision.promotionAuthorityDigest,
          ],
        )[0]?.values[0] !== undefined
        return head !== null &&
          auditExists &&
          head.currentRevision === revision.revision &&
          head.status === revision.status
            ? { committed: true, replayed: true, revision: existing }
            : await this.recordAgentMemoryRevisionConflict(descriptor, input.recordedAt)
      } catch {
        return { committed: false, reason: 'id_conflict' }
      }
    }

    const currentHead = await this.getAgentMemoryHead(revision.id)
    const currentValue = currentHead === null
      ? undefined
      : selectJson<unknown>(
          this.db,
          `select json from agent_memory_revisions
           where memory_id = ? and revision = ? limit 1`,
          [revision.id, currentHead.currentRevision],
        )[0]
    if (currentHead === null || currentValue === undefined) {
      return { committed: false, reason: 'source_stale' }
    }
    let currentRevision: DurableAgentMemoryRevision
    try {
      currentRevision = await parseDurableAgentMemoryRevision(currentValue)
    } catch {
      return { committed: false, reason: 'source_stale' }
    }
    const pairing = currentRevision.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(currentRevision.scope, pairing)) {
      return { committed: false, reason: 'source_stale' }
    }
    if (
      currentHead.status !== 'active' ||
      currentHead.version !== descriptor.expectedHeadVersion ||
      !stableJsonMatches(currentRevision, descriptor.currentRevision)
    ) {
      return this.recordAgentMemoryRevisionConflict(descriptor, input.recordedAt)
    }

    const scope = revision.scope
    this.db.run(
      `insert into agent_memory_revisions (
         memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, visibility, statement,
         content_digest, provenance_digest, source_candidate_id, supersedes_revision,
         sensitivity, retention_class, expires_at, promotion_decision_id,
         promotion_actor_kind, promotion_actor_id, promotion_policy_id,
         promotion_policy_version, promotion_authority_digest, status,
         state_version, json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        revision.id,
        revision.revision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        revision.visibility,
        revision.statement,
        revision.contentDigest,
        revision.provenanceDigest,
        revision.sourceCandidateId,
        revision.supersedesRevision,
        revision.sensitivity,
        revision.retentionClass,
        revision.expiresAt,
        revision.promotionDecisionId,
        revision.promotionActorKind,
        revision.promotionActorId,
        revision.promotionPolicyId,
        revision.promotionPolicyVersion,
        revision.promotionAuthorityDigest,
        revision.status,
        revision.stateVersion,
        JSON.stringify(revision),
        revision.createdAt,
      ],
    )
    this.db.run(
      `update agent_memory_heads
       set current_revision = ?, status = ?, version = version + 1, updated_at = ?
       where memory_id = ? and current_revision = ? and version = ? and status = 'active'`,
      [
        revision.revision,
        revision.status,
        input.recordedAt,
        revision.id,
        descriptor.currentRevision.revision,
        descriptor.expectedHeadVersion,
      ],
    )
    if (this.db.getRowsModified() !== 1) {
      throw new Error('Agent Memory revision CAS was lost')
    }
    const auditMetadata = {
      previousRevision: descriptor.currentRevision.revision,
      contentDigest: revision.contentDigest,
      provenanceDigest: revision.provenanceDigest,
      visibility: revision.visibility,
      sensitivity: revision.sensitivity,
      retentionClass: revision.retentionClass,
      expiresAt: revision.expiresAt,
      status: revision.status,
      policyId: revision.promotionPolicyId,
      policyVersion: revision.promotionPolicyVersion,
    }
    this.db.run(
      `insert into agent_memory_audits (
         id, memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
         authority_digest, state_version, metadata_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `memory-revision-audit-${revision.promotionDecisionId}`,
        revision.id,
        revision.revision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        'memory_revised',
        revision.promotionActorKind,
        revision.promotionActorId,
        revision.promotionAuthorityDigest,
        revision.stateVersion,
        JSON.stringify(auditMetadata),
        input.recordedAt,
      ],
    )
    await this.enqueueCanonicalAgentMemoryProjection(revision.id, input.recordedAt)
    await this.persist()
    return { committed: true, replayed: false, revision }
  }

  private async recordAgentMemoryRevisionConflict(
    descriptor: AgentMemoryRevisionCapabilityDescriptor,
    recordedAt: string,
  ): Promise<CommitAgentMemoryRevisionResult> {
    const currentHead = await this.getAgentMemoryHead(descriptor.revision.id)
    if (currentHead === null) {
      return { committed: false, reason: 'source_stale' }
    }
    const currentValue = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? and revision = ? limit 1`,
      [currentHead.memoryId, currentHead.currentRevision],
    )[0]
    if (currentValue === undefined || !stableJsonMatches(currentHead.scope, descriptor.revision.scope)) {
      return { committed: false, reason: 'source_stale' }
    }
    const currentRevision = await parseDurableAgentMemoryRevision(currentValue)
    const pairing = currentRevision.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (
      currentHead.status !== 'active' ||
      !agentMemoryScopeMatchesPairing(currentRevision.scope, pairing) ||
      Date.parse(recordedAt) < Date.parse(currentHead.updatedAt)
    ) {
      return { committed: false, reason: 'source_stale' }
    }
    const proposed = descriptor.revision
    const metadata = {
      decisionId: proposed.promotionDecisionId,
      expectedRevision: descriptor.currentRevision.revision,
      expectedHeadVersion: descriptor.expectedHeadVersion,
      currentRevision: currentRevision.revision,
      currentHeadVersion: currentHead.version,
      proposedContentDigest: proposed.contentDigest,
    }
    const auditId = `memory-conflict-audit-${proposed.promotionDecisionId}`
    const existingMetadata = selectJson<unknown>(
      this.db,
      `select metadata_json from agent_memory_audits
       where id = ? and memory_id = ? and revision = ?
         and event_kind = 'conflict_recorded' and authority_digest = ? limit 1`,
      [auditId, currentRevision.id, currentRevision.revision, proposed.promotionAuthorityDigest],
    )[0]
    if (existingMetadata !== undefined) {
      return stableJsonMatches(existingMetadata, metadata)
        ? {
            committed: false,
            reason: 'version_conflict',
            currentRevision,
            currentHead,
          }
        : { committed: false, reason: 'id_conflict' }
    }
    this.db.run(
      `insert into agent_memory_audits (
         id, memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
         authority_digest, state_version, metadata_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        currentRevision.id,
        currentRevision.revision,
        currentRevision.scope.localProjectId,
        currentRevision.scope.kind,
        currentRevision.scope.organizationId,
        currentRevision.scope.projectId,
        currentRevision.scope.userId,
        currentRevision.scope.sessionId,
        'conflict_recorded',
        proposed.promotionActorKind,
        proposed.promotionActorId,
        proposed.promotionAuthorityDigest,
        proposed.stateVersion,
        JSON.stringify(metadata),
        recordedAt,
      ],
    )
    await this.persist()
    return {
      committed: false,
      reason: 'version_conflict',
      currentRevision,
      currentHead,
    }
  }

  async authorizeAgentMemoryDeletion(
    input: AuthorizeAgentMemoryDeletionInput,
  ): Promise<AuthorizeAgentMemoryDeletionResult> {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof input.authority !== 'object' ||
      input.authority === null ||
      !isNonEmptyIdentifier(input.authority.memoryId) ||
      input.authority.memoryId.length > 200
    ) {
      return { authorized: false, reason: 'invalid_input' }
    }
    const head = await this.getAgentMemoryHead(input.authority.memoryId)
    if (head === null) {
      return { authorized: false, reason: 'memory_not_found' }
    }
    if (head.status === 'purge_pending' || head.status === 'deleted') {
      return { authorized: false, reason: 'already_deleted' }
    }
    if (
      head.currentRevision !== input.authority.expectedRevision ||
      head.version !== input.authority.expectedHeadVersion
    ) {
      return { authorized: false, reason: 'version_conflict' }
    }
    const currentValue = selectJson<unknown>(
      this.db,
      `select json from agent_memory_revisions
       where memory_id = ? and revision = ? limit 1`,
      [head.memoryId, head.currentRevision],
    )[0]
    if (currentValue === undefined) {
      return { authorized: false, reason: 'memory_not_found' }
    }
    let currentRevision: DurableAgentMemoryRevision
    let tombstone: AgentMemoryTombstone
    try {
      currentRevision = await parseDurableAgentMemoryRevision(currentValue)
      tombstone = await createAgentMemoryTombstone({
        currentRevision,
        authority: input.authority,
      })
    } catch {
      return { authorized: false, reason: 'invalid_input' }
    }
    if (!stableJsonMatches(currentRevision.scope, head.scope)) {
      return { authorized: false, reason: 'scope_mismatch' }
    }
    const pairing = currentRevision.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (!agentMemoryScopeMatchesPairing(currentRevision.scope, pairing)) {
      return { authorized: false, reason: 'scope_mismatch' }
    }
    const existingTombstone = this.db.exec(
      'select 1 from agent_memory_tombstones where memory_id = ? limit 1',
      [tombstone.memoryId],
    )[0]?.values[0] !== undefined
    if (existingTombstone) {
      return { authorized: false, reason: 'already_deleted' }
    }
    const identityConflict = this.db.exec(
      `select 1 from agent_memory_tombstones
       where json_extract(json, '$.decisionId') = ?
       union all
       select 1 from agent_memory_audits where id = ?
       limit 1`,
      [tombstone.decisionId, `memory-deletion-audit-${tombstone.decisionId}`],
    )[0]?.values[0] !== undefined
    if (identityConflict) {
      return { authorized: false, reason: 'id_conflict' }
    }

    const capability = Object.freeze(
      new Proxy(Object.create(null), {}),
    ) as AgentMemoryDeletionCapability
    const internalCurrentRevision = structuredClone(currentRevision)
    const internalTombstone = structuredClone(tombstone)
    agentMemoryDeletionCapabilities.set(capability, {
      owner: this.agentMemoryPromotionOwner,
      expectedHeadVersion: input.authority.expectedHeadVersion,
      currentRevision: internalCurrentRevision,
      tombstone: internalTombstone,
    })
    return {
      authorized: true,
      capability,
      tombstone: structuredClone(internalTombstone),
    }
  }

  async commitAgentMemoryDeletion(
    input: CommitAgentMemoryDeletionInput,
    capability: AgentMemoryDeletionCapability,
  ): Promise<CommitAgentMemoryDeletionResult> {
    if (typeof capability !== 'object' || capability === null) {
      return { committed: false, reason: 'invalid_authority' }
    }
    const descriptor = agentMemoryDeletionCapabilities.get(capability)
    if (descriptor === undefined || descriptor.owner !== this.agentMemoryPromotionOwner) {
      return { committed: false, reason: 'invalid_authority' }
    }
    agentMemoryDeletionCapabilities.delete(capability)

    let tombstone: AgentMemoryTombstone
    try {
      tombstone = parseAgentMemoryTombstone(input.tombstone)
    } catch {
      return { committed: false, reason: 'invalid_tombstone' }
    }
    if (!stableJsonMatches(tombstone, descriptor.tombstone)) {
      return { committed: false, reason: 'invalid_tombstone' }
    }

    const auditMetadata = {
      decisionId: tombstone.decisionId,
      lastRevision: tombstone.lastRevision,
      deletionVersion: tombstone.deletionVersion,
      purgeStatus: tombstone.purgeStatus,
      policyId: tombstone.policyId,
      policyVersion: tombstone.policyVersion,
    }
    const existing = await this.getAgentMemoryTombstone(tombstone.memoryId)
    if (existing !== null) {
      const existingPendingShape = existing.purgeStatus === 'completed'
        ? { ...existing, purgeStatus: 'pending' as const, purgedAt: null }
        : existing
      const sameDeletion = stableJsonMatches(existingPendingShape, tombstone)
      const head = sameDeletion
        ? await this.getAgentMemoryHead(tombstone.memoryId)
        : null
      const existingAuditMetadata = selectJson<unknown>(
        this.db,
        `select metadata_json from agent_memory_audits
         where id = ? and memory_id = ? and revision = ?
           and event_kind = 'memory_deleted' and authority_digest = ? limit 1`,
        [
          `memory-deletion-audit-${tombstone.decisionId}`,
          tombstone.memoryId,
          tombstone.lastRevision,
          tombstone.authorityDigest,
        ],
      )[0]
      const headMatches = existing.purgeStatus === 'pending'
        ? head?.status === 'purge_pending' && head.version === tombstone.deletionVersion
        : head?.status === 'deleted' && head.version === tombstone.deletionVersion + 1
      return head !== null &&
        stableJsonMatches(existingAuditMetadata, auditMetadata) &&
        head.currentRevision === tombstone.lastRevision &&
        stableJsonMatches(head.scope, tombstone.scope) &&
        headMatches
        ? { committed: true, replayed: true, tombstone: existing }
        : { committed: false, reason: 'id_conflict' }
    }

    const currentHead = await this.getAgentMemoryHead(tombstone.memoryId)
    const currentValue = currentHead === null
      ? undefined
      : selectJson<unknown>(
          this.db,
          `select json from agent_memory_revisions
           where memory_id = ? and revision = ? limit 1`,
          [currentHead.memoryId, currentHead.currentRevision],
        )[0]
    if (currentHead === null || currentValue === undefined) {
      return { committed: false, reason: 'source_stale' }
    }
    let currentRevision: DurableAgentMemoryRevision
    try {
      currentRevision = await parseDurableAgentMemoryRevision(currentValue)
    } catch {
      return { committed: false, reason: 'source_stale' }
    }
    const pairing = currentRevision.scope.kind === 'team'
      ? await this.getDesktopPairingCredential()
      : null
    if (
      !agentMemoryScopeMatchesPairing(currentRevision.scope, pairing) ||
      !stableJsonMatches(currentRevision, descriptor.currentRevision) ||
      !stableJsonMatches(currentRevision.scope, tombstone.scope) ||
      currentHead.currentRevision !== tombstone.lastRevision ||
      currentHead.version !== descriptor.expectedHeadVersion ||
      !['active', 'conflict', 'expired'].includes(currentHead.status)
    ) {
      return { committed: false, reason: 'source_stale' }
    }

    const scope = tombstone.scope
    this.db.run(
      `insert into agent_memory_tombstones (
         memory_id, deletion_version, last_revision, local_project_id, scope_kind,
         organization_id, team_project_id, user_id, session_id, actor_kind,
         actor_id, authority_digest, purge_status, state_version, json,
         deleted_at, purged_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tombstone.memoryId,
        tombstone.deletionVersion,
        tombstone.lastRevision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        tombstone.actorKind,
        tombstone.actorId,
        tombstone.authorityDigest,
        tombstone.purgeStatus,
        tombstone.stateVersion,
        JSON.stringify(tombstone),
        tombstone.deletedAt,
        tombstone.purgedAt,
      ],
    )
    this.db.run(
      `update agent_memory_heads
       set status = 'purge_pending', version = version + 1, updated_at = ?
       where memory_id = ? and current_revision = ? and version = ?
         and status in ('active', 'conflict', 'expired')`,
      [
        tombstone.deletedAt,
        tombstone.memoryId,
        tombstone.lastRevision,
        descriptor.expectedHeadVersion,
      ],
    )
    if (this.db.getRowsModified() !== 1) {
      throw new Error('Agent Memory deletion CAS was lost')
    }
    this.db.run(
      `insert into agent_memory_audits (
         id, memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
         authority_digest, state_version, metadata_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `memory-deletion-audit-${tombstone.decisionId}`,
        tombstone.memoryId,
        tombstone.lastRevision,
        scope.localProjectId,
        scope.kind,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        scope.sessionId,
        'memory_deleted',
        tombstone.actorKind,
        tombstone.actorId,
        tombstone.authorityDigest,
        tombstone.stateVersion,
        JSON.stringify(auditMetadata),
        tombstone.deletedAt,
      ],
    )
    await this.enqueueCanonicalAgentMemoryProjection(tombstone.memoryId, tombstone.deletedAt)
    await this.persist()
    return { committed: true, replayed: false, tombstone }
  }

  async getAgentMemoryTombstone(memoryId: string): Promise<AgentMemoryTombstone | null> {
    if (!isNonEmptyIdentifier(memoryId) || memoryId.length > 200) {
      throw new Error('Invalid Agent Memory id')
    }
    const value = selectJson<unknown>(
      this.db,
      'select json from agent_memory_tombstones where memory_id = ? limit 1',
      [memoryId],
    )[0]
    if (value === undefined) return null
    try {
      const tombstone = parseAgentMemoryTombstone(value)
      if (tombstone.memoryId !== memoryId) {
        throw new Error('Stored Agent Memory tombstone identity does not match')
      }
      return tombstone
    } catch {
      throw new Error('Stored Agent Memory tombstone is invalid')
    }
  }

  async purgeAgentMemoryDerivedState(
    input: PurgeAgentMemoryDerivedStateInput,
  ): Promise<PurgeAgentMemoryDerivedStateResult> {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isNonEmptyIdentifier(input.memoryId) ||
      input.memoryId.length > 200 ||
      !Number.isInteger(input.expectedDeletionVersion) ||
      input.expectedDeletionVersion < 1 ||
      !isCanonicalIsoTimestamp(input.purgedAt)
    ) {
      return { purged: false, reason: 'invalid_input' }
    }
    const tombstone = await this.getAgentMemoryTombstone(input.memoryId)
    if (tombstone === null) {
      return { purged: false, reason: 'not_found' }
    }
    if (tombstone.deletionVersion !== input.expectedDeletionVersion) {
      return { purged: false, reason: 'version_conflict' }
    }
    const completed = tombstone.purgeStatus === 'completed'
    if (completed) {
      const head = await this.getAgentMemoryHead(tombstone.memoryId)
      const metadata = {
        deletionVersion: tombstone.deletionVersion,
        lastRevision: tombstone.lastRevision,
        purgeStatus: tombstone.purgeStatus,
      }
      const authorityDigest = sha256Canonical({
        stateVersion: tombstone.stateVersion,
        memoryId: tombstone.memoryId,
        deletionVersion: tombstone.deletionVersion,
        lastRevision: tombstone.lastRevision,
        purgeStatus: tombstone.purgeStatus,
      })
      const existingAuditMetadata = selectJson<unknown>(
        this.db,
        `select metadata_json from agent_memory_audits
         where id = ? and memory_id = ? and revision = ?
           and event_kind = 'purge_completed' and authority_digest = ? limit 1`,
        [
          `memory-purge-audit-${tombstone.memoryId}-${tombstone.deletionVersion}`,
          tombstone.memoryId,
          tombstone.lastRevision,
          authorityDigest,
        ],
      )[0]
      return tombstone.purgedAt === input.purgedAt &&
        head !== null &&
        head.status === 'deleted' &&
        head.version === tombstone.deletionVersion + 1 &&
        head.currentRevision === tombstone.lastRevision &&
        stableJsonMatches(head.scope, tombstone.scope) &&
        stableJsonMatches(existingAuditMetadata, metadata)
        ? { purged: true, replayed: true, tombstone }
        : { purged: false, reason: 'version_conflict' }
    }
    if (Date.parse(input.purgedAt) < Date.parse(tombstone.deletedAt)) {
      return { purged: false, reason: 'invalid_input' }
    }
    const head = await this.getAgentMemoryHead(tombstone.memoryId)
    if (
      head === null ||
      head.status !== 'purge_pending' ||
      head.currentRevision !== tombstone.lastRevision ||
      head.version !== tombstone.deletionVersion ||
      !stableJsonMatches(head.scope, tombstone.scope)
    ) {
      return { purged: false, reason: 'source_stale' }
    }
    let completedTombstone: AgentMemoryTombstone
    try {
      completedTombstone = parseAgentMemoryTombstone({
        ...tombstone,
        purgeStatus: 'completed',
        purgedAt: input.purgedAt,
      })
    } catch {
      return { purged: false, reason: 'invalid_input' }
    }

    this.db.run(
      'delete from agent_memory_index_entries where memory_id = ?',
      [tombstone.memoryId],
    )
    this.db.run(
      `update agent_memory_tombstones
       set purge_status = 'completed', json = ?, purged_at = ?
       where memory_id = ? and deletion_version = ? and purge_status = 'pending'`,
      [
        JSON.stringify(completedTombstone),
        completedTombstone.purgedAt,
        tombstone.memoryId,
        tombstone.deletionVersion,
      ],
    )
    if (this.db.getRowsModified() !== 1) {
      throw new Error('Agent Memory purge tombstone CAS was lost')
    }
    this.db.run(
      `update agent_memory_heads
       set status = 'deleted', version = version + 1, updated_at = ?
       where memory_id = ? and current_revision = ? and version = ?
         and status = 'purge_pending'`,
      [
        completedTombstone.purgedAt,
        tombstone.memoryId,
        tombstone.lastRevision,
        tombstone.deletionVersion,
      ],
    )
    if (this.db.getRowsModified() !== 1) {
      throw new Error('Agent Memory purge head CAS was lost')
    }
    const authorityDigest = sha256Canonical({
      stateVersion: tombstone.stateVersion,
      memoryId: tombstone.memoryId,
      deletionVersion: tombstone.deletionVersion,
      lastRevision: tombstone.lastRevision,
      purgeStatus: completedTombstone.purgeStatus,
    })
    const metadata = {
      deletionVersion: tombstone.deletionVersion,
      lastRevision: tombstone.lastRevision,
      purgeStatus: completedTombstone.purgeStatus,
    }
    this.db.run(
      `insert into agent_memory_audits (
         id, memory_id, revision, local_project_id, scope_kind, organization_id,
         team_project_id, user_id, session_id, event_kind, actor_kind, actor_id,
         authority_digest, state_version, metadata_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `memory-purge-audit-${tombstone.memoryId}-${tombstone.deletionVersion}`,
        tombstone.memoryId,
        tombstone.lastRevision,
        tombstone.scope.localProjectId,
        tombstone.scope.kind,
        tombstone.scope.organizationId,
        tombstone.scope.projectId,
        tombstone.scope.userId,
        tombstone.scope.sessionId,
        'purge_completed',
        'system',
        'electron-main-memory-purge',
        authorityDigest,
        tombstone.stateVersion,
        JSON.stringify(metadata),
        completedTombstone.purgedAt,
      ],
    )
    await this.enqueueCanonicalAgentMemoryProjection(
      tombstone.memoryId,
      completedTombstone.purgedAt!,
    )
    await this.persist()
    return { purged: true, replayed: false, tombstone: completedTombstone }
  }

  async getAgentRuntime(runtimeId: string): Promise<AgentRuntimeState | null> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) {
      throw new Error('Invalid Agent Runtime id')
    }
    return selectAgentRuntime(this.db, runtimeId)
  }

  async listRecoverableAgentRuntimes(): Promise<AgentRuntimeState[]> {
    return selectJson<unknown>(
      this.db,
      `select runtime.json from agent_runtimes runtime
       where runtime.status <> 'terminal'
         and not exists (
           select 1 from agent_coordination_sessions session
           where session.supervisor_runtime_id = runtime.id
         )
         and not exists (
           select 1 from agent_coordination_tasks task
           where task.runtime_id = runtime.id
         )
       order by runtime.updated_at asc, runtime.id asc`,
    ).map(parseStoredAgentRuntime)
  }

  async listAgentRuntimes(): Promise<AgentRuntimeState[]> {
    return selectJson<unknown>(
      this.db,
      'select json from agent_runtimes order by updated_at asc, id asc',
    ).map(parseStoredAgentRuntime)
  }

  async listAgentRuntimeEvents(runtimeId: string): Promise<AgentRuntimeEvent[]> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) {
      throw new Error('Invalid Agent Runtime id')
    }
    return selectAgentRuntimeEvents(this.db, runtimeId)
  }

  async listAgentRuntimeCheckpoints(runtimeId: string): Promise<AgentCheckpoint[]> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) {
      throw new Error('Invalid Agent Runtime id')
    }
    return selectAgentRuntimeCheckpoints(this.db, runtimeId)
  }

  async getAgentRuntimeTerminalSummary(
    runtimeId: string,
  ): Promise<AgentRuntimeTerminalSummary | null> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) {
      throw new Error('Invalid Agent Runtime id')
    }
    const value = selectJson<AgentRuntimeTerminalSummary>(
      this.db,
      'select json from agent_runtime_terminal_summaries where runtime_id = ? limit 1',
      [runtimeId],
    )[0]
    if (value === undefined) return null
    const runtime = selectAgentRuntime(this.db, runtimeId)
    if (
      !runtime ||
      runtime.status !== 'terminal' ||
      runtime.stopReason === null ||
      !sameJson(value, createAgentRuntimeTerminalSummary(
        runtime as AgentRuntimeState & {
          status: 'terminal'
          stopReason: AgentRuntimeStopReason
        },
      ))
    ) {
      throw new Error('Stored Agent Runtime terminal summary is invalid')
    }
    return value
  }

  async reserveAgentRuntimeCapabilityGrant(
    grantValue: AgentRuntimeCapabilityGrant,
  ): Promise<ReserveAgentRuntimeCapabilityGrantResult> {
    let grant: AgentRuntimeCapabilityGrant
    try {
      grant = parseAgentRuntimeCapabilityGrant(grantValue)
    } catch {
      return { reserved: false, reason: 'invalid_grant' }
    }
    if (grant.status !== 'active') return { reserved: false, reason: 'invalid_grant' }
    const runtime = selectAgentRuntime(this.db, grant.runtimeId)
    if (
      !runtime ||
      runtime.status !== 'waiting_action' ||
      runtime.stopReason !== null ||
      runtime.activeAction?.kind !== 'tool' ||
      runtime.activeAction.capabilityId !== grant.capabilityId ||
      runtime.activeAction.capabilityVersion !== grant.capabilityVersion ||
      runtime.activeAction.requestDigest !== grant.requestDigest ||
      grant.grantedAt < runtime.updatedAt ||
      grant.expiresAt > runtime.deadline
    ) {
      return { reserved: false, reason: 'runtime_stale' }
    }
    let contextAttachment: AgentRuntimeContextAttachment | null
    try {
      contextAttachment = await selectAgentRuntimeContextAttachment(this.db, runtime.id)
    } catch {
      return { reserved: false, reason: 'runtime_stale' }
    }
    if (
      contextAttachment !== null &&
      (
        contextAttachment.runtimeId !== runtime.id ||
        contextAttachment.contextDigest !== runtime.contextDigest ||
        !sameJson(contextAttachment.scope, runtime.scope) ||
        !sameJson(contextAttachment.authority, runtime.authority) ||
        !await this.areAgentRuntimeContextSourcesCurrent(contextAttachment, grant.grantedAt)
      )
    ) {
      return { reserved: false, reason: 'runtime_stale' }
    }
    if (
      this.db.exec(
        `select 1
         from agent_runtime_capability_grants grants
         left join agent_runtime_tool_audits audits
           on audits.grant_id = grants.id and audits.status = 'started'
         where grants.id = ? or (
           grants.runtime_id = ? and grants.capability_id = ? and (
             grants.status = 'active' or (
               grants.request_digest = ? and audits.action_id = ?
             )
           )
         ) limit 1`,
        [
          grant.id,
          grant.runtimeId,
          grant.capabilityId,
          grant.requestDigest,
          runtime.activeAction.id,
        ],
      )[0]
    ) {
      return { reserved: false, reason: 'grant_exists' }
    }
    this.db.run(
      `insert into agent_runtime_capability_grants (
         id, runtime_id, capability_id, capability_version, request_digest,
         permission_class, resource_kind, resource_id,
         status, granted_at, expires_at, settled_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grant.id,
        grant.runtimeId,
        grant.capabilityId,
        grant.capabilityVersion,
        grant.requestDigest,
        grant.permissionClass,
        grant.resourceKind,
        grant.resourceId,
        grant.status,
        grant.grantedAt,
        grant.expiresAt,
        grant.settledAt,
      ],
    )
    await this.persist()
    return { reserved: true, grant }
  }

  async beginAgentRuntimeToolExecution(input: {
    expectedGrant: AgentRuntimeCapabilityGrant
    audit: NativeToolAuditRecord
  }): Promise<BeginAgentRuntimeToolExecutionResult> {
    let grant: AgentRuntimeCapabilityGrant
    let audit: NativeToolAuditRecord
    try {
      grant = parseAgentRuntimeCapabilityGrant(input.expectedGrant)
      audit = parseNativeToolAuditRecord(input.audit)
    } catch {
      return { consumed: false, reason: 'invalid_input' }
    }
    const runtime = selectAgentRuntime(this.db, grant.runtimeId)
    if (
      grant.status !== 'active' ||
      audit.status !== 'started' ||
      audit.grantId !== grant.id ||
      audit.runtimeId !== grant.runtimeId ||
      audit.toolId !== grant.capabilityId ||
      audit.toolVersion !== grant.capabilityVersion ||
      audit.inputDigest !== grant.requestDigest ||
      audit.permissionClass !== grant.permissionClass ||
      audit.resourceKind !== grant.resourceKind ||
      audit.resourceId !== grant.resourceId ||
      audit.createdAt < grant.grantedAt ||
      audit.createdAt >= grant.expiresAt ||
      !runtime ||
      runtime.status !== 'waiting_action' ||
      runtime.stopReason !== null ||
      runtime.activeAction?.id !== audit.actionId ||
      runtime.activeAction.capabilityId !== grant.capabilityId ||
      runtime.activeAction.capabilityVersion !== grant.capabilityVersion ||
      runtime.activeAction.requestDigest !== grant.requestDigest ||
      runtime.scope.organizationId !== audit.organizationId ||
      runtime.scope.projectId !== audit.projectId ||
      runtime.scope.userId !== audit.userId ||
      runtime.scope.sessionId !== audit.sessionId ||
      runtime.scope.localProjectId !== audit.localProjectId
    ) {
      return { consumed: false, reason: 'grant_stale' }
    }

    const coordinationRows = this.db.exec(
      `select distinct coordination_id from agent_coordination_tasks
       where runtime_id = ? order by coordination_id asc`,
      [runtime.id],
    )[0]?.values ?? []
    if (coordinationRows.length > 1) {
      return { consumed: false, reason: 'grant_stale' }
    }
    if (coordinationRows.length === 1) {
      let stored: CoordinationRecoverySnapshot
      let policy: SpecialistToolLeasePolicy
      try {
        const coordinationId = String(coordinationRows[0]![0])
        const snapshot = selectCoordinationRecoverySnapshot(this.db, coordinationId)
        if (snapshot === null) throw new Error('specialist_runtime_lease_invalid')
        stored = snapshot
        policy = resolveSpecialistToolLeasePolicy(grant.capabilityId)
      } catch {
        return { consumed: false, reason: 'grant_stale' }
      }
      const task = stored.state.tasks.find((candidate) => candidate.runtimeId === runtime.id)
      const graphTask = stored.graph.nodes.find((candidate) => candidate.id === task?.id)
      if (task === undefined || graphTask === undefined) {
        return { consumed: false, reason: 'grant_stale' }
      }
      let expectedCapabilitySetDigest: string
      try {
        const descriptor = resolveSpecialistDescriptor(graphTask.roleId)
        expectedCapabilitySetDigest = digestSpecialistCapabilitySet({
          roleId: descriptor.id,
          roleVersion: descriptor.version,
          taskContextDigest: graphTask.contextDigest,
          capabilityIds: graphTask.capabilityIds,
        })
      } catch {
        return { consumed: false, reason: 'grant_stale' }
      }
      const matchingLeases = stored.leases.filter((lease) =>
        lease.coordinationId === stored.coordination.id &&
        lease.taskId === task.id &&
        lease.taskVersion === task.version &&
        lease.runtimeId === runtime.id &&
        lease.runtimeVersion === task.runtimeVersion &&
        sameJson(lease.scope, stored.coordination.scope) &&
        lease.capabilityId === policy.capabilityId &&
        lease.capabilityVersion === 1 &&
        lease.resourceId === grant.resourceId &&
        policy.acceptedModes.includes(lease.mode) &&
        lease.status === 'active' &&
        lease.releasedAt === null &&
        Date.parse(lease.acquiredAt) <= Date.parse(grant.grantedAt) &&
        Date.parse(grant.expiresAt) <= Date.parse(lease.expiresAt) &&
        Date.parse(audit.createdAt) < Date.parse(lease.expiresAt)
      )
      if (
        task.status !== 'running' ||
        task.runtimeVersion === null ||
        matchingLeases.length !== 1 ||
        runtime.scope.kind !== 'team' ||
        runtime.scope.organizationId !== stored.coordination.scope.organizationId ||
        runtime.scope.projectId !== stored.coordination.scope.projectId ||
        runtime.scope.userId !== stored.coordination.scope.userId ||
        runtime.scope.sessionId !== stored.coordination.scope.sessionId ||
        runtime.scope.localProjectId !== stored.coordination.scope.localProjectId ||
        runtime.authority.runId !== stored.coordination.authority.runId ||
        runtime.authority.nodeId !== stored.coordination.authority.nodeId ||
        runtime.authority.runVersion !== stored.coordination.authority.runVersion ||
        runtime.authority.policyVersion !== stored.coordination.authority.policyVersion ||
        runtime.capabilitySetDigest !== expectedCapabilitySetDigest ||
        Date.parse(runtime.requestedAt) < Date.parse(stored.coordination.requestedAt) ||
        Date.parse(runtime.deadline) > Date.parse(stored.coordination.deadline) ||
        !await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)
      ) {
        return { consumed: false, reason: 'grant_stale' }
      }
      const current = selectCoordinationRecoverySnapshot(
        this.db,
        stored.coordination.id,
      )
      if (
        current === null ||
        !sameJson(current.coordination, stored.coordination) ||
        !sameJson(current.graph, stored.graph) ||
        !sameJson(current.state, stored.state) ||
        !sameJson(current.leases, stored.leases)
      ) {
        return { consumed: false, reason: 'grant_stale' }
      }
    }

    this.db.run('begin transaction')
    try {
      this.db.run(
        `update agent_runtime_capability_grants
         set status = 'consumed', settled_at = ?
         where id = ? and runtime_id = ? and capability_id = ? and capability_version = ?
           and request_digest = ? and permission_class = ? and resource_kind = ? and resource_id = ?
           and status = 'active' and granted_at = ? and expires_at = ?
           and settled_at is null and expires_at > ?`,
        [
          audit.createdAt,
          grant.id,
          grant.runtimeId,
          grant.capabilityId,
          grant.capabilityVersion,
          grant.requestDigest,
          grant.permissionClass,
          grant.resourceKind,
          grant.resourceId,
          grant.grantedAt,
          grant.expiresAt,
          audit.createdAt,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        return { consumed: false, reason: 'grant_stale' }
      }
      writeNativeToolAudit(this.db, audit)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
    return { consumed: true }
  }

  async appendAgentRuntimeToolAudit(value: NativeToolAuditRecord): Promise<void> {
    const audit = parseNativeToolAuditRecord(value)
    if (audit.status === 'started') throw new Error('invalid_native_tool_audit')
    const startedValue = selectJson<unknown>(
      this.db,
      `select json from agent_runtime_tool_audits
       where grant_id = ? and status = 'started' limit 1`,
      [audit.grantId],
    )[0]
    if (startedValue === undefined) throw new Error('invalid_native_tool_audit')
    const started = parseNativeToolAuditRecord(startedValue)
    if (!sameNativeToolAuditIdentity(started, audit) || audit.createdAt < started.createdAt) {
      throw new Error('invalid_native_tool_audit')
    }
    const existingTerminalValue = selectJson<unknown>(
      this.db,
      `select json from agent_runtime_tool_audits
       where grant_id = ? and status <> 'started' limit 1`,
      [audit.grantId],
    )[0]
    if (existingTerminalValue !== undefined) {
      const existingTerminal = parseNativeToolAuditRecord(existingTerminalValue)
      if (
        sameJson(existingTerminal, audit) ||
        (
          existingTerminal.status === 'cancelled' &&
          existingTerminal.code === 'cancelled' &&
          audit.status === 'cancelled' &&
          audit.code === 'cancelled' &&
          sameNativeToolAuditIdentity(existingTerminal, audit) &&
          existingTerminal.resultDigest === null &&
          existingTerminal.resultBytes === null &&
          existingTerminal.redactionState === audit.redactionState &&
          existingTerminal.createdAt <= audit.createdAt
        )
      ) return
      throw new Error('invalid_native_tool_audit')
    }
    writeNativeToolAudit(this.db, audit)
    await this.persist()
  }

  async listAgentRuntimeToolAudits(runtimeId?: string): Promise<NativeToolAuditRecord[]> {
    if (runtimeId !== undefined && (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200)) {
      throw new Error('Invalid Agent Runtime id')
    }
    return selectJson<unknown>(
      this.db,
      runtimeId === undefined
        ? 'select json from agent_runtime_tool_audits order by created_at asc, id asc'
        : 'select json from agent_runtime_tool_audits where runtime_id = ? order by created_at asc, id asc',
      runtimeId === undefined ? [] : [runtimeId],
    ).map(parseNativeToolAuditRecord)
  }

  async listAgentRuntimeCapabilityGrants(
    runtimeId?: string,
  ): Promise<AgentRuntimeCapabilityGrant[]> {
    if (runtimeId !== undefined && (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200)) {
      throw new Error('Invalid Agent Runtime id')
    }
    const result = this.db.exec(
      `select id, runtime_id, capability_id, capability_version, request_digest,
              permission_class, resource_kind, resource_id,
              status, granted_at, expires_at, settled_at
       from agent_runtime_capability_grants
       ${runtimeId === undefined ? '' : 'where runtime_id = ?'}
       order by granted_at asc, id asc`,
      runtimeId === undefined ? [] : [runtimeId],
    )[0]
    return (result?.values ?? []).map((row) =>
      parseAgentRuntimeCapabilityGrant({
        stateVersion: 1,
        id: String(row[0]),
        runtimeId: String(row[1]),
        capabilityId: String(row[2]),
        capabilityVersion: Number(row[3]),
        requestDigest: String(row[4]),
        permissionClass: String(row[5]),
        resourceKind: String(row[6]),
        resourceId: String(row[7]),
        status: String(row[8]),
        grantedAt: String(row[9]),
        expiresAt: String(row[10]),
        settledAt: row[11] === null ? null : String(row[11]),
      }),
    )
  }

  async getAgentRuntimeContextAttachment(
    runtimeId: string,
  ): Promise<AgentRuntimeContextAttachment | null> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) {
      throw new Error('Invalid Agent Runtime id')
    }
    return selectAgentRuntimeContextAttachment(this.db, runtimeId)
  }

  private async areAgentRuntimeContextSourcesCurrent(
    attachment: AgentRuntimeContextAttachment,
    now: string,
  ): Promise<boolean> {
    if (!isCanonicalIsoTimestamp(now)) return false
    if (attachment.scope.kind === 'team') {
      const pairing = await this.getDesktopPairingCredential()
      if (
        pairing === null ||
        pairing.organizationId !== attachment.scope.organizationId ||
        pairing.projectId !== attachment.scope.projectId ||
        pairing.userId !== attachment.scope.userId ||
        pairing.tokenId !== attachment.scope.sessionId ||
        pairing.localProjectId !== attachment.scope.localProjectId
      ) return false
    }

    if (attachment.knowledgeCitations.length > 0) {
      const current = await this.getCurrentKnowledgeSnapshotIdentitySet(attachment.scope)
      if (current === null) return false
      for (const citation of attachment.knowledgeCitations) {
        const currentChunk = current.chunks.find((chunk) =>
          chunk.documentId === citation.documentId && chunk.chunkId === citation.chunkId
        )
        if (
          current.knowledgeSnapshotHash !== citation.knowledgeSnapshotHash ||
          currentChunk === undefined ||
          currentChunk.sourcePath !== citation.sourcePath ||
          !sameJson(currentChunk.headingPath, citation.headingPath) ||
          currentChunk.contentHash !== citation.contentHash
        ) return false
      }
    }

    const candidates = attachment.memoryRevisions.length === 0
      ? []
      : await this.listAgentMemoryCandidates(attachment.scope.localProjectId)
    for (let index = 0; index < attachment.memoryRevisions.length; index += 1) {
      const revision = attachment.memoryRevisions[index]!
      const identity = attachment.memoryRevisionIdentities[index]
      const [head, revisions, tombstone] = await Promise.all([
        this.getAgentMemoryHead(revision.id),
        this.listAgentMemoryRevisions(revision.id),
        this.getAgentMemoryTombstone(revision.id),
      ])
      const storedRevision = revisions.find((candidate) => candidate.revision === revision.revision)
      const sourceCandidate = candidates.find((candidate) => candidate.id === revision.sourceCandidateId)
      if (
        identity === undefined ||
        head === null ||
        tombstone !== null ||
        storedRevision === undefined ||
        sourceCandidate === undefined ||
        head.status !== 'active' ||
        head.currentRevision !== identity.revision ||
        head.version !== identity.headVersion ||
        head.updatedAt !== identity.updatedAt ||
        identity.memoryId !== revision.id ||
        identity.contentDigest !== revision.contentDigest ||
        identity.sourceRuntimeId !== sourceCandidate.provenance.runtimeId ||
        !sameJson(head.scope, identity.scope) ||
        !sameJson(storedRevision, revision) ||
        (revision.expiresAt !== null && Date.parse(revision.expiresAt) <= Date.parse(now))
      ) return false
    }
    return true
  }

  async isAgentRuntimeContextCurrent(runtimeId: string, now: string): Promise<boolean> {
    if (!isNonEmptyIdentifier(runtimeId) || runtimeId.length > 200) return false
    const [runtime, attachment] = await Promise.all([
      this.getAgentRuntime(runtimeId),
      this.getAgentRuntimeContextAttachment(runtimeId),
    ])
    if (
      runtime === null ||
      attachment === null ||
      attachment.runtimeId !== runtime.id ||
      attachment.contextDigest !== runtime.contextDigest ||
      !sameJson(attachment.scope, runtime.scope) ||
      !sameJson(attachment.authority, runtime.authority)
    ) return false
    return this.areAgentRuntimeContextSourcesCurrent(attachment, now)
  }

  private async isCoordinationSupervisorAuthorityCurrent(
    coordination: CoordinationSessionRequest,
  ): Promise<boolean> {
    const supervisor = selectAgentRuntime(
      this.db,
      coordination.authority.supervisorRuntimeId,
    )
    if (supervisor === null) return false
    try {
      parseCoordinationSessionRequest(coordination, supervisor.bounds)
    } catch {
      return false
    }
    const currentRun = await this.getRun(coordination.authority.runId)
    const currentProject = (await this.listProjects()).find(
      (candidate) => candidate.id === coordination.scope.localProjectId,
    )
    const currentPolicy = await this.getPolicySnapshot(coordination.scope.localProjectId)
    const pairing = await this.getDesktopPairingCredential()
    return !(
      supervisor.status === 'terminal' ||
      supervisor.version !== coordination.authority.supervisorRuntimeVersion ||
      supervisor.scope.kind !== 'team' ||
      supervisor.scope.organizationId !== coordination.scope.organizationId ||
      supervisor.scope.projectId !== coordination.scope.projectId ||
      supervisor.scope.userId !== coordination.scope.userId ||
      supervisor.scope.sessionId !== coordination.scope.sessionId ||
      supervisor.scope.localProjectId !== coordination.scope.localProjectId ||
      supervisor.authority.runId !== coordination.authority.runId ||
      supervisor.authority.nodeId !== coordination.authority.nodeId ||
      supervisor.authority.runVersion !== coordination.authority.runVersion ||
      supervisor.authority.policyVersion !== coordination.authority.policyVersion ||
      supervisor.contextDigest !== coordination.contextDigest ||
      supervisor.capabilitySetDigest !== coordination.capabilitySetDigest ||
      Date.parse(coordination.requestedAt) < Date.parse(supervisor.requestedAt) ||
      Date.parse(coordination.deadline) > Date.parse(supervisor.deadline) ||
      currentRun === null ||
      currentProject === undefined ||
      currentRun.projectId !== currentProject.id ||
      currentRun.version !== coordination.authority.runVersion ||
      currentRun.currentNodeId !== coordination.authority.nodeId ||
      !currentRun.nodes.some((node) =>
        node.id === coordination.authority.nodeId && canRunAgentRuntimeOnNode(node)) ||
      (currentPolicy === null
        ? coordination.authority.policyVersion !== 1
        : currentPolicy.version !== coordination.authority.policyVersion) ||
      pairing === null ||
      pairing.organizationId !== coordination.scope.organizationId ||
      pairing.projectId !== coordination.scope.projectId ||
      pairing.userId !== coordination.scope.userId ||
      pairing.tokenId !== coordination.scope.sessionId ||
      pairing.localProjectId !== coordination.scope.localProjectId
    )
  }

  async getCoordinationSession(
    coordinationId: string,
  ): Promise<DurableCoordinationSession | null> {
    if (!isNonEmptyIdentifier(coordinationId) || coordinationId.length > 200) return null
    const snapshot = selectCoordinationRecoverySnapshot(this.db, coordinationId)
    return snapshot === null
      ? null
      : {
          coordination: snapshot.coordination,
          graph: snapshot.graph,
          state: snapshot.state,
        }
  }

  async getCoordinationRecoverySnapshot(
    coordinationId: string,
  ): Promise<CoordinationRecoverySnapshot | null> {
    if (!isNonEmptyIdentifier(coordinationId) || coordinationId.length > 200) return null
    return selectCoordinationRecoverySnapshot(this.db, coordinationId)
  }

  async listCoordinationRecoverySnapshots(): Promise<CoordinationRecoverySnapshot[]> {
    return selectStringColumn(
      this.db,
      `select id from agent_coordination_sessions
       order by updated_at desc, id asc`,
    ).map((coordinationId) => selectCoordinationRecoverySnapshot(this.db, coordinationId))
      .filter((snapshot): snapshot is CoordinationRecoverySnapshot => snapshot !== null)
  }

  async authorizeCoordinationSessionRecovery(
    input: AuthorizeCoordinationSessionRecoveryInput,
  ): Promise<AuthorizeCoordinationSessionRecoveryResult> {
    if (
      !isNonEmptyIdentifier(input.coordinationId) ||
      input.coordinationId.length > 200 ||
      !Number.isInteger(input.expectedSessionVersion) ||
      input.expectedSessionVersion < 1 ||
      !isCanonicalTimestamp(input.now)
    ) return { authorized: false, reason: 'invalid_input' }

    const stored = selectCoordinationRecoverySnapshot(this.db, input.coordinationId)
    if (stored === null) return { authorized: false, reason: 'not_found' }
    if (stored.state.version !== input.expectedSessionVersion) {
      return { authorized: false, reason: 'stale_state' }
    }
    if (
      stored.state.status !== 'running' ||
      stored.state.stopReason !== null ||
      Date.parse(input.now) < Date.parse(stored.state.updatedAt) ||
      Date.parse(input.now) >= Date.parse(stored.coordination.deadline)
    ) return { authorized: false, reason: 'authority_mismatch' }

    const runningTasks = stored.state.tasks.filter((task) => task.status === 'running')
    const runtimes = runningTasks.map((task) =>
      task.runtimeId === null ? null : selectAgentRuntime(this.db, task.runtimeId))
    for (let index = 0; index < runningTasks.length; index += 1) {
      const task = runningTasks[index]!
      const runtime = runtimes[index]
      const graphTask = stored.graph.nodes.find((candidate) => candidate.id === task.id)
      if (
        runtime === null ||
        runtime === undefined ||
        graphTask === undefined ||
        task.runtimeId !== runtime.id ||
        task.runtimeVersion === null ||
        runtime.version < task.runtimeVersion ||
        runtime.status === 'terminal' ||
        runtime.stopReason !== null ||
        runtime.scope.kind !== 'team' ||
        runtime.scope.organizationId !== stored.coordination.scope.organizationId ||
        runtime.scope.projectId !== stored.coordination.scope.projectId ||
        runtime.scope.userId !== stored.coordination.scope.userId ||
        runtime.scope.sessionId !== stored.coordination.scope.sessionId ||
        runtime.scope.localProjectId !== stored.coordination.scope.localProjectId ||
        !sameJson(runtime.authority, {
          runId: stored.coordination.authority.runId,
          nodeId: stored.coordination.authority.nodeId,
          runVersion: stored.coordination.authority.runVersion,
          policyVersion: stored.coordination.authority.policyVersion,
        }) ||
        runtime.contextDigest.length === 0 ||
        Date.parse(runtime.requestedAt) < Date.parse(stored.coordination.requestedAt) ||
        Date.parse(runtime.requestedAt) > Date.parse(input.now) ||
        Date.parse(input.now) >= Date.parse(runtime.deadline) ||
        Date.parse(runtime.deadline) > Date.parse(stored.coordination.deadline)
      ) return { authorized: false, reason: 'authority_mismatch' }
      try {
        const descriptor = resolveSpecialistDescriptor(graphTask.roleId)
        if (runtime.capabilitySetDigest !== digestSpecialistCapabilitySet({
          roleId: descriptor.id,
          roleVersion: descriptor.version,
          taskContextDigest: graphTask.contextDigest,
          capabilityIds: graphTask.capabilityIds,
        })) return { authorized: false, reason: 'authority_mismatch' }
      } catch {
        return { authorized: false, reason: 'authority_mismatch' }
      }
    }
    const authorizedRuntimes = runtimes.filter(
      (runtime): runtime is AgentRuntimeState => runtime !== null,
    )

    const activeLeases = stored.leases.filter((lease) => lease.status === 'active')
    if (activeLeases.some((lease) => {
      const task = runningTasks.find((candidate) => candidate.id === lease.taskId)
      const runtime = authorizedRuntimes.find((candidate) => candidate.id === lease.runtimeId)
      return (
        task === undefined ||
        runtime === undefined ||
        runtime === null ||
        task.version !== lease.taskVersion ||
        task.runtimeId !== lease.runtimeId ||
        task.runtimeVersion !== lease.runtimeVersion ||
        !sameJson(lease.scope, stored.coordination.scope) ||
        lease.releasedAt !== null ||
        Date.parse(lease.acquiredAt) > Date.parse(input.now) ||
        Date.parse(input.now) >= Date.parse(lease.expiresAt)
      )
    })) return { authorized: false, reason: 'authority_mismatch' }

    const contextsCurrent = await Promise.all([
      this.isAgentRuntimeContextCurrent(
        stored.coordination.authority.supervisorRuntimeId,
        input.now,
      ),
      ...authorizedRuntimes.map((runtime) =>
        this.isAgentRuntimeContextCurrent(runtime.id, input.now)),
    ])
    if (contextsCurrent.some((current) => !current)) {
      return { authorized: false, reason: 'authority_mismatch' }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { authorized: false, reason: 'authority_mismatch' }
    }

    const current = selectCoordinationRecoverySnapshot(this.db, input.coordinationId)
    const currentRuntimes = runningTasks.map((task) =>
      task.runtimeId === null ? null : selectAgentRuntime(this.db, task.runtimeId))
    if (
      current === null ||
      !sameJson(current, stored) ||
      !sameJson(currentRuntimes, runtimes) ||
      !await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)
    ) return { authorized: false, reason: 'stale_state' }
    const currentContexts = await Promise.all([
      this.isAgentRuntimeContextCurrent(
        stored.coordination.authority.supervisorRuntimeId,
        input.now,
      ),
      ...authorizedRuntimes.map((runtime) =>
        this.isAgentRuntimeContextCurrent(runtime.id, input.now)),
    ])
    if (currentContexts.some((currentContext) => !currentContext)) {
      return { authorized: false, reason: 'authority_mismatch' }
    }

    return {
      authorized: true,
      snapshot: stored,
      runtimes: authorizedRuntimes,
      readyTaskIds: stored.state.tasks
        .filter((task) => task.status === 'ready')
        .map((task) => task.id)
        .sort((left, right) => left.localeCompare(right)),
    }
  }

  async acquireCoordinationResourceLease(
    input: AcquireCoordinationResourceLeaseInput,
  ): Promise<AcquireCoordinationResourceLeaseResult> {
    let expectedState: CoordinationSessionState
    try {
      expectedState = parseCoordinationSessionState(input.expectedState)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const stored = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (stored === null) return { committed: false, reason: 'not_found' }
    if (!sameJson(stored.state, expectedState)) {
      return { committed: false, reason: 'stale_state' }
    }

    let accepted
    try {
      accepted = acceptCoordinationResourceLease(input.lease, {
        coordination: stored.coordination,
        graph: stored.graph,
        state: stored.state,
        existingLeases: stored.leases,
      })
    } catch (error) {
      return {
        committed: false,
        reason: error instanceof Error && error.message === 'coordination_resource_conflict'
          ? 'conflicting_lease'
          : 'invalid_input',
      }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }
    const current = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (
      current === null ||
      !sameJson(current.coordination, stored.coordination) ||
      !sameJson(current.graph, stored.graph) ||
      !sameJson(current.state, stored.state) ||
      !sameJson(current.leases, stored.leases)
    ) return { committed: false, reason: 'stale_state' }
    if (accepted.replayed) {
      return { committed: true, replayed: true, lease: accepted.lease }
    }

    const lease = accepted.lease
    this.db.run('begin transaction')
    try {
      this.db.run(
        `insert into agent_coordination_leases (
           id, coordination_id, task_id, resource_id, resource_digest, mode,
           status, version, lease_json, acquired_at, expires_at, released_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lease.id,
          lease.coordinationId,
          lease.taskId,
          lease.resourceId,
          lease.resourceDigest,
          lease.mode,
          lease.status,
          lease.version,
          JSON.stringify(lease),
          lease.acquiredAt,
          lease.expiresAt,
          lease.releasedAt,
        ],
      )
      assertCoordinationMetadataBound(this.db, lease.coordinationId)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      const existing = selectCoordinationRecoverySnapshot(this.db, lease.coordinationId)
        ?.leases.find((candidate) => candidate.id === lease.id)
      return existing !== undefined && sameJson(existing, lease)
        ? { committed: true, replayed: true, lease: existing }
        : { committed: false, reason: 'conflicting_lease' }
    }
    await this.persist()
    return { committed: true, replayed: false, lease }
  }

  async settleCoordinationResourceLease(
    input: SettleCoordinationResourceLeaseInput,
  ): Promise<SettleCoordinationResourceLeaseResult> {
    let expectedState: CoordinationSessionState
    try {
      expectedState = parseCoordinationSessionState(input.expectedState)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const stored = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (stored === null) return { committed: false, reason: 'not_found' }
    let expectedLease: CoordinationResourceLease
    let nextLease: CoordinationResourceLease
    try {
      expectedLease = parseCoordinationResourceLease(input.expectedLease, {
        coordination: stored.coordination,
        graph: stored.graph,
      })
      nextLease = settleCoordinationResourceLease({
        lease: expectedLease,
        expectedVersion: expectedLease.version,
        outcome: input.outcome,
        now: input.now,
      }, {
        coordination: stored.coordination,
        graph: stored.graph,
      })
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    if (!sameJson(stored.state, expectedState)) {
      return { committed: false, reason: 'stale_state' }
    }
    const durableLease = stored.leases.find((lease) => lease.id === expectedLease.id)
    if (sameJson(durableLease, nextLease)) {
      return { committed: true, replayed: true, lease: nextLease }
    }
    if (!sameJson(durableLease, expectedLease)) {
      return { committed: false, reason: 'stale_state' }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }
    const current = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (
      current === null ||
      !sameJson(current.coordination, stored.coordination) ||
      !sameJson(current.graph, stored.graph) ||
      !sameJson(current.state, stored.state) ||
      !sameJson(current.leases, stored.leases)
    ) return { committed: false, reason: 'stale_state' }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update agent_coordination_leases
         set status = ?, version = ?, lease_json = ?, released_at = ?
         where id = ? and coordination_id = ? and task_id = ?
           and resource_id = ? and resource_digest = ? and mode = ?
           and status = 'active' and version = ? and lease_json = ?
           and released_at is null`,
        [
          nextLease.status,
          nextLease.version,
          JSON.stringify(nextLease),
          nextLease.releasedAt,
          expectedLease.id,
          expectedLease.coordinationId,
          expectedLease.taskId,
          expectedLease.resourceId,
          expectedLease.resourceDigest,
          expectedLease.mode,
          expectedLease.version,
          JSON.stringify(expectedLease),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_lease')
      assertCoordinationMetadataBound(this.db, expectedState.id)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, lease: nextLease }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      if (error instanceof Error && error.message === 'stale_coordination_lease') {
        return { committed: false, reason: 'stale_state' }
      }
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      throw error
    }
  }

  async createCoordinationSession(
    input: CreateCoordinationSessionInput,
  ): Promise<CreateCoordinationSessionResult> {
    let coordination: CoordinationSessionRequest
    let graph: AgentTaskGraph
    let state: CoordinationSessionState
    try {
      coordination = parseCoordinationSessionRequest(
        input.coordination,
        input.coordination.bounds,
      )
      graph = parseAgentTaskGraph(input.graph, {
        coordinationId: coordination.id,
        acceptedRoleIds: getAcceptedSpecialistRoleIds(),
        maxTaskNodes: coordination.bounds.maxTaskNodes,
        maxDependencyEdges: coordination.bounds.maxDependencyEdges,
      }).graph
      state = parseCoordinationSessionState(createCoordinationSessionState({
        coordination,
        graph,
        startedAt: input.startedAt,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }

    const existing = selectCoordinationRecoverySnapshot(this.db, coordination.id)
    if (existing !== null) {
      return sameJson(existing.coordination, coordination) &&
        sameJson(existing.graph, graph) &&
        sameJson(existing.state, state)
        ? { committed: true, replayed: true, state: existing.state }
        : { committed: false, reason: 'session_exists' }
    }
    const graphOwner = selectStringColumn(
      this.db,
      'select coordination_id from agent_coordination_graphs where id = ? limit 1',
      [graph.id],
    )[0]
    if (graphOwner !== undefined) return { committed: false, reason: 'session_exists' }

    if (!await this.isCoordinationSupervisorAuthorityCurrent(coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }

    const auditMetadata = coordinationStartAuditMetadata(graph)
    this.db.run('begin transaction')
    try {
      this.db.run(
        `insert into agent_coordination_sessions (
           id, contract_version, local_project_id, organization_id, team_project_id,
           user_id, scope_session_id, run_id, node_id, supervisor_runtime_id,
           graph_id, graph_version, version, status, stop_reason, context_digest,
           capability_set_digest, request_json, state_json, requested_at, started_at,
           updated_at, deadline
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          coordination.id,
          coordination.stateVersion,
          coordination.scope.localProjectId,
          coordination.scope.organizationId,
          coordination.scope.projectId,
          coordination.scope.userId,
          coordination.scope.sessionId,
          coordination.authority.runId,
          coordination.authority.nodeId,
          coordination.authority.supervisorRuntimeId,
          graph.id,
          graph.version,
          state.version,
          state.status,
          state.stopReason,
          state.contextDigest,
          state.capabilitySetDigest,
          JSON.stringify(coordination),
          JSON.stringify(state),
          state.requestedAt,
          state.startedAt,
          state.updatedAt,
          state.deadline,
        ],
      )
      this.db.run(
        `insert into agent_coordination_graphs (
           id, coordination_id, version, node_count, edge_count, graph_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
        [
          graph.id,
          coordination.id,
          graph.version,
          graph.nodes.length,
          graph.edges.length,
          JSON.stringify(graph),
          state.startedAt,
        ],
      )
      for (const task of state.tasks) {
        const node = graph.nodes.find((candidate) => candidate.id === task.id)
        if (node === undefined) throw new Error('invalid_coordination_task')
        this.db.run(
          `insert into agent_coordination_tasks (
             coordination_id, task_id, graph_id, role_id, version, status,
             agent_id, runtime_id, runtime_version, state_json, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            coordination.id,
            task.id,
            graph.id,
            node.roleId,
            task.version,
            task.status,
            task.agentId,
            task.runtimeId,
            task.runtimeVersion,
            JSON.stringify(task),
            state.updatedAt,
          ],
        )
      }
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, null, 'session_started', ?, ?, ?)`,
        [
          coordinationStartAuditId(coordination.id),
          coordination.id,
          state.version,
          JSON.stringify(auditMetadata),
          state.startedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, 1, ?, ?, ?, ?)`,
        [
          coordination.id,
          state.version,
          state.graphVersion,
          JSON.stringify(state),
          state.startedAt,
        ],
      )
      assertCoordinationMetadataBound(this.db, coordination.id)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      throw error
    }
    await this.persist()
    return { committed: true, replayed: false, state }
  }

  async commitCoordinationTaskStart(
    input: CommitCoordinationTaskStartInput,
  ): Promise<CommitCoordinationTaskStartResult> {
    let expectedState: CoordinationSessionState
    try {
      expectedState = parseCoordinationSessionState(input.expectedState)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const stored = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (stored === null) return { committed: false, reason: 'not_found' }

    let allocation: SpecialistAllocationRequest
    let nextState: CoordinationSessionState
    const expectedTask = expectedState.tasks.find(
      (candidate) => candidate.id === input.allocation.taskId,
    )
    if (expectedTask === undefined) return { committed: false, reason: 'invalid_input' }
    try {
      allocation = parseSpecialistAllocationRequest(input.allocation, {
        coordination: stored.coordination,
        graph: stored.graph,
        readyTaskIds: expectedState.tasks
          .filter((task) => task.status === 'ready')
          .map((task) => task.id),
        supervisorCapabilityIds: input.supervisorCapabilityIds,
        supervisorResourceRequirements: input.supervisorResourceRequirements,
        remainingBudget: input.remainingBudget,
      })
      nextState = parseCoordinationSessionState(startCoordinationTask({
        state: expectedState,
        allocation,
        expectedSessionVersion: expectedState.version,
        expectedTaskVersion: expectedTask.version,
        runtimeId: input.runtimeId,
        runtimeVersion: input.runtimeVersion,
        now: input.now,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }

    const auditMetadata = coordinationTaskStartedAuditMetadata(allocation, nextState)
    if (sameJson(stored.state, nextState)) {
      const storedAudit = selectJson<unknown>(
        this.db,
        `select metadata_json from agent_coordination_audits
         where id = ? and coordination_id = ? and event_kind = 'task_started'
           and session_version = ? limit 1`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          nextState.version,
        ],
      )[0]
      const storedCheckpoint = selectJson<unknown>(
        this.db,
        `select checkpoint_json from agent_coordination_checkpoints
         where coordination_id = ? and checkpoint_version = ?
           and session_version = ? and graph_version = ? limit 1`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
        ],
      )[0]
      return sameJson(storedAudit, auditMetadata) && sameJson(storedCheckpoint, nextState)
        ? { committed: true, replayed: true, state: stored.state }
        : { committed: false, reason: 'stale_state' }
    }
    if (!sameJson(stored.state, expectedState)) {
      return { committed: false, reason: 'stale_state' }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }

    const nextTask = nextState.tasks.find((candidate) => candidate.id === allocation.taskId)
    const storedTask = stored.state.tasks.find((candidate) => candidate.id === allocation.taskId)
    const graphNode = stored.graph.nodes.find((candidate) => candidate.id === allocation.taskId)
    if (nextTask === undefined || storedTask === undefined || graphNode === undefined) {
      return { committed: false, reason: 'invalid_input' }
    }

    this.db.run('begin transaction')
    try {
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      this.db.run(
        `update agent_coordination_tasks
         set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
             state_json = ?, updated_at = ?
         where coordination_id = ? and task_id = ? and graph_id = ?
           and version = ? and state_json = ?`,
        [
          nextTask.version,
          nextTask.status,
          nextTask.agentId,
          nextTask.runtimeId,
          nextTask.runtimeVersion,
          JSON.stringify(nextTask),
          nextState.updatedAt,
          stored.coordination.id,
          nextTask.id,
          stored.graph.id,
          storedTask.version,
          JSON.stringify(storedTask),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'task_started', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          nextTask.id,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' || error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      throw error
    }
    await this.persist()
    return { committed: true, replayed: false, state: nextState }
  }

  async commitSpecialistRuntimeStart(
    input: CommitSpecialistRuntimeStartInput,
  ): Promise<CommitSpecialistRuntimeStartResult> {
    let taskAuthority
    try {
      taskAuthority = await resolveSpecialistTaskAuthority(
        this,
        input.authorityCapability,
        input.now,
      )
    } catch {
      return { committed: false, reason: 'authority_mismatch' }
    }

    let transition: AgentRuntimeTransition
    let contextAttachment: AgentRuntimeContextAttachment
    try {
      transition = parseAgentRuntimeTransition(input.transition)
      contextAttachment = await parseAgentRuntimeContextAttachment(input.contextAttachment)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    if (
      !isExactAgentRuntimeTransition(null, transition) ||
      contextAttachment.runtimeId !== transition.runtime.id ||
      contextAttachment.checkpointVersion !== transition.checkpoint.version ||
      contextAttachment.contextDigest !== transition.runtime.contextDigest ||
      contextAttachment.attachedAt !== transition.runtime.requestedAt ||
      !sameJson(contextAttachment.scope, transition.runtime.scope) ||
      !sameJson(contextAttachment.authority, transition.runtime.authority) ||
      contextAttachment.knowledgeCitations.length !== 0 ||
      contextAttachment.memoryRevisions.length !== 0 ||
      !await this.areAgentRuntimeContextSourcesCurrent(contextAttachment, input.now)
    ) return { committed: false, reason: 'invalid_input' }

    const stored = selectCoordinationRecoverySnapshot(this.db, taskAuthority.coordinationId)
    const storedTask = stored?.state.tasks.find((task) => task.id === taskAuthority.taskId)
    if (
      stored === null ||
      stored === undefined ||
      stored.state.version !== taskAuthority.sessionVersion ||
      stored.graph.id !== taskAuthority.graphId ||
      stored.graph.version !== taskAuthority.graphVersion ||
      storedTask === undefined ||
      storedTask.version !== taskAuthority.taskVersion ||
      storedTask.status !== 'ready'
    ) return { committed: false, reason: 'stale_state' }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }
    const currentAfterAuthority = selectCoordinationRecoverySnapshot(
      this.db,
      taskAuthority.coordinationId,
    )
    if (
      currentAfterAuthority === null ||
      !sameJson(currentAfterAuthority.state, stored.state) ||
      !sameJson(currentAfterAuthority.graph, stored.graph) ||
      !sameJson(currentAfterAuthority.coordination, stored.coordination)
    ) return { committed: false, reason: 'stale_state' }

    let allocation: SpecialistAllocationRequest
    let nextState: CoordinationSessionState
    try {
      allocation = parseSpecialistAllocationRequest(input.allocation, {
        coordination: stored.coordination,
        graph: stored.graph,
        readyTaskIds: stored.state.tasks
          .filter((task) => task.status === 'ready')
          .map((task) => task.id),
        supervisorCapabilityIds: taskAuthority.capabilityIds,
        supervisorResourceRequirements: taskAuthority.resourceRequirements,
        remainingBudget: taskAuthority.remainingBudget,
      })
      if (
        allocation.taskId !== taskAuthority.taskId ||
        allocation.roleId !== taskAuthority.roleId ||
        allocation.contextDigest !== taskAuthority.contextDigest ||
        !sameJson(allocation.scope, taskAuthority.scope) ||
        !sameJson(allocation.authority, taskAuthority.authority)
      ) throw new Error('invalid_specialist_allocation')
      nextState = parseCoordinationSessionState(startCoordinationTask({
        state: stored.state,
        allocation,
        expectedSessionVersion: taskAuthority.sessionVersion,
        expectedTaskVersion: taskAuthority.taskVersion,
        runtimeId: transition.runtime.id,
        runtimeVersion: transition.runtime.version,
        now: input.now,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }

    const expectedRuntimeScope = {
      kind: 'team' as const,
      organizationId: taskAuthority.scope.organizationId,
      projectId: taskAuthority.scope.projectId,
      userId: taskAuthority.scope.userId,
      sessionId: taskAuthority.scope.sessionId,
      localProjectId: taskAuthority.scope.localProjectId,
    }
    const expectedRuntimeAuthority = {
      runId: taskAuthority.authority.runId,
      nodeId: taskAuthority.authority.nodeId,
      runVersion: taskAuthority.authority.runVersion,
      policyVersion: taskAuthority.authority.policyVersion,
    }
    const expectedCapabilitySetDigest = digestSpecialistCapabilitySet({
      roleId: taskAuthority.roleId,
      roleVersion: taskAuthority.roleVersion,
      taskContextDigest: taskAuthority.contextDigest,
      capabilityIds: taskAuthority.capabilityIds,
    })
    if (
      !sameJson(transition.runtime.scope, expectedRuntimeScope) ||
      !sameJson(transition.runtime.authority, expectedRuntimeAuthority) ||
      transition.runtime.capabilitySetDigest !== expectedCapabilitySetDigest ||
      transition.runtime.requestedAt !== input.now ||
      transition.runtime.requestedAt !== allocation.requestedAt ||
      transition.runtime.deadline !== allocation.deadline ||
      transition.runtime.bounds.maxSteps !== allocation.budget.maxSteps ||
      transition.runtime.bounds.maxWallTimeMs !== allocation.budget.maxWallTimeMs ||
      transition.runtime.bounds.maxToolCalls !== allocation.budget.maxToolCalls ||
      transition.runtime.bounds.maxTokens !== allocation.budget.maxTokens ||
      transition.runtime.bounds.maxCostUsd !== allocation.budget.maxCostUsd ||
      transition.runtime.bounds.maxToolResultBytes !== SPECIALIST_RUNTIME_MAX_TOOL_RESULT_BYTES ||
      transition.runtime.bounds.maxTrajectoryMetadataBytes !==
        SPECIALIST_RUNTIME_MAX_TRAJECTORY_METADATA_BYTES ||
      transition.runtime.bounds.maxCheckpointBytes !== SPECIALIST_RUNTIME_MAX_CHECKPOINT_BYTES ||
      selectAgentRuntime(this.db, transition.runtime.id) !== null
    ) return { committed: false, reason: 'invalid_input' }

    const nextTask = nextState.tasks.find((task) => task.id === taskAuthority.taskId)
    if (nextTask === undefined) return { committed: false, reason: 'invalid_input' }
    const auditMetadata = coordinationTaskStartedAuditMetadata(allocation, nextState)
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeAgentRuntimeTransition(this.db, transition)
      writeAgentRuntimeContextAttachment(this.db, contextAttachment)
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      this.db.run(
        `update agent_coordination_tasks
         set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
             state_json = ?, updated_at = ?
         where coordination_id = ? and task_id = ? and graph_id = ?
           and version = ? and state_json = ?`,
        [
          nextTask.version,
          nextTask.status,
          nextTask.agentId,
          nextTask.runtimeId,
          nextTask.runtimeVersion,
          JSON.stringify(nextTask),
          nextState.updatedAt,
          stored.coordination.id,
          nextTask.id,
          stored.graph.id,
          storedTask.version,
          JSON.stringify(storedTask),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'task_started', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          nextTask.id,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'agent-runtime-summary',
        localProjectId: transition.runtime.scope.localProjectId,
        runId: transition.runtime.authority.runId,
        entityId: transition.runtime.id,
        createdAt: transition.runtime.updatedAt,
      })
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return {
        committed: true,
        replayed: false,
        runtime: transition.runtime,
        state: nextState,
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' ||
          error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      if (
        error instanceof Error &&
        (error.message === 'coordination_metadata_too_large' ||
          /unique constraint failed: agent_runtimes\.id/iu.test(error.message))
      ) return { committed: false, reason: 'invalid_input' }
      throw error
    }
  }

  async commitSpecialistRuntimeCompletion(
    input: CommitSpecialistRuntimeCompletionInput,
  ): Promise<CommitSpecialistRuntimeCompletionResult> {
    let transition: AgentRuntimeTransition
    try {
      transition = parseAgentRuntimeTransition(input.transition)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const successfulCompletion = transition.runtime.stopReason === 'success'
    const failedCompletion = transition.runtime.stopReason === 'failure' ||
      transition.runtime.stopReason === 'timeout' ||
      transition.runtime.stopReason === 'step_limit' ||
      transition.runtime.stopReason === 'budget_exhausted' ||
      transition.runtime.stopReason === 'policy_denied'
    if (
      !isNonEmptyIdentifier(input.coordinationId) ||
      !isNonEmptyIdentifier(input.taskId) ||
      !Number.isInteger(input.expectedSessionVersion) ||
      input.expectedSessionVersion < 1 ||
      !Number.isInteger(input.expectedTaskVersion) ||
      input.expectedTaskVersion < 1 ||
      !Number.isInteger(input.expectedRuntimeVersion) ||
      input.expectedRuntimeVersion < 1 ||
      transition.runtime.status !== 'terminal' ||
      (!successfulCompletion && !failedCompletion) ||
      (successfulCompletion && transition.runtime.lastResultDigest === null) ||
      !Array.isArray(input.evidenceDigests) ||
      (input.resourceLeaseOutcome !== 'not_required' &&
        input.resourceLeaseOutcome !== 'released') ||
      !Array.isArray(input.handoffs)
    ) return { committed: false, reason: 'invalid_input' }

    const stored = selectCoordinationRecoverySnapshot(this.db, input.coordinationId)
    if (stored === null) return { committed: false, reason: 'not_found' }
    const storedTask = stored.state.tasks.find((task) => task.id === input.taskId)
    const graphTask = stored.graph.nodes.find((task) => task.id === input.taskId)
    const currentRuntime = selectAgentRuntime(this.db, transition.runtime.id)
    const outgoingEdges = stored.graph.edges.filter((edge) => edge.sourceTaskId === input.taskId)
    const runtimeLeases = stored.leases.filter((lease) =>
      lease.taskId === input.taskId && lease.runtimeId === transition.runtime.id
    )
    const allRuntimeLeasesReleased = runtimeLeases.length > 0 &&
      runtimeLeases.every((lease) => lease.status === 'released')
    if (
      runtimeLeases.some((lease) => lease.status === 'active') ||
      (successfulCompletion && (
        input.resourceLeaseOutcome !== (runtimeLeases.length === 0 ? 'not_required' : 'released') ||
        (runtimeLeases.length > 0 && !allRuntimeLeasesReleased)
      )) ||
      (successfulCompletion
        ? input.handoffs.length !== outgoingEdges.length
        : input.handoffs.length !== 0 || input.evidenceDigests.length !== 0) ||
      (input.handoffs.length === 0 && input.evidenceDigests.length !== 0) ||
      new Set(input.handoffs.map((handoff) => handoff.id)).size !== input.handoffs.length ||
      input.handoffs.some((handoff, index) =>
        handoff.targetTaskId !== outgoingEdges[index]?.targetTaskId)
    ) return { committed: false, reason: 'invalid_input' }
    if (
      storedTask !== undefined &&
      graphTask !== undefined &&
      currentRuntime !== null &&
      sameJson(currentRuntime, transition.runtime) &&
      stored.state.version === input.expectedSessionVersion + 1 + input.handoffs.length &&
      storedTask.version === input.expectedTaskVersion + 1 &&
      storedTask.status === (successfulCompletion ? 'succeeded' : 'failed') &&
      storedTask.runtimeId === transition.runtime.id &&
      storedTask.runtimeVersion === transition.runtime.version &&
      (successfulCompletion
        ? storedTask.resultDigest === transition.runtime.lastResultDigest &&
          storedTask.failure === null
        : storedTask.resultDigest === null &&
          matchesSpecialistRuntimeFailure(transition.runtime.stopReason, storedTask.failure))
    ) {
      const events = selectAgentRuntimeEvents(
        this.db,
        transition.runtime.id,
        transition.runtime.checkpointVersion,
      )
      const checkpoint = selectAgentRuntimeCheckpoints(this.db, transition.runtime.id)
        .find((candidate) => candidate.version === transition.checkpoint.version)
      const firstSequence = stored.state.counters.acceptedHandoffs - input.handoffs.length + 1
      const replayedHandoffs = input.handoffs.map((draft, index): AgentHandoff => ({
        stateVersion: 1,
        id: draft.id,
        coordinationId: stored.coordination.id,
        sequence: firstSequence + index,
        scope: { ...stored.coordination.scope },
        sourceTaskId: storedTask.id,
        sourceTaskVersion: storedTask.version,
        sourceRuntimeId: transition.runtime.id,
        sourceRuntimeVersion: transition.runtime.version,
        targetTaskId: draft.targetTaskId,
        targetTaskVersion: draft.expectedTargetTaskVersion,
        resultDigest: transition.runtime.lastResultDigest!,
        evidenceDigests: [...input.evidenceDigests],
        contextDigest: graphTask.contextDigest,
        resourceLeaseOutcome: input.resourceLeaseOutcome,
        summary: draft.summary,
        createdAt: transition.runtime.updatedAt,
      }))
      const exactHandoffReplay = replayedHandoffs.every((handoff) => {
        const persisted = stored.handoffs.find((candidate) => candidate.id === handoff.id)
        const targetTask = stored.state.tasks.find((task) => task.id === handoff.targetTaskId)
        return sameJson(persisted, handoff) &&
          targetTask !== undefined &&
          targetTask.version === handoff.targetTaskVersion + 1 &&
          targetTask.acceptedDependencyHandoffIds.includes(handoff.id) &&
          stored.state.acceptedHandoffIds.includes(handoff.id)
      })
      return sameJson(events, transition.events) &&
        sameJson(checkpoint, transition.checkpoint) &&
        exactHandoffReplay
        ? {
            committed: true,
            replayed: true,
            runtime: currentRuntime,
            state: stored.state,
            handoffs: replayedHandoffs,
          }
        : { committed: false, reason: 'stale_state' }
    }
    if (
      stored.state.version !== input.expectedSessionVersion ||
      storedTask === undefined ||
      graphTask === undefined ||
      storedTask.version !== input.expectedTaskVersion ||
      storedTask.status !== 'running' ||
      storedTask.runtimeId !== transition.runtime.id ||
      storedTask.runtimeVersion === null ||
      currentRuntime === null ||
      currentRuntime.id !== storedTask.runtimeId ||
      currentRuntime.version !== input.expectedRuntimeVersion ||
      !isExactAgentRuntimeTransition(currentRuntime, transition)
    ) return { committed: false, reason: 'stale_state' }
    if (
      !await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination) ||
      !await this.isAgentRuntimeContextCurrent(currentRuntime.id, transition.runtime.updatedAt)
    ) return { committed: false, reason: 'authority_mismatch' }

    const expectedRuntimeScope = {
      kind: 'team' as const,
      organizationId: stored.coordination.scope.organizationId,
      projectId: stored.coordination.scope.projectId,
      userId: stored.coordination.scope.userId,
      sessionId: stored.coordination.scope.sessionId,
      localProjectId: stored.coordination.scope.localProjectId,
    }
    const expectedRuntimeAuthority = {
      runId: stored.coordination.authority.runId,
      nodeId: stored.coordination.authority.nodeId,
      runVersion: stored.coordination.authority.runVersion,
      policyVersion: stored.coordination.authority.policyVersion,
    }
    let descriptor
    try {
      descriptor = resolveSpecialistDescriptor(graphTask.roleId)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const expectedCapabilitySetDigest = digestSpecialistCapabilitySet({
      roleId: descriptor.id,
      roleVersion: descriptor.version,
      taskContextDigest: graphTask.contextDigest,
      capabilityIds: graphTask.capabilityIds,
    })
    if (
      !sameJson(currentRuntime.scope, expectedRuntimeScope) ||
      !sameJson(currentRuntime.authority, expectedRuntimeAuthority) ||
      currentRuntime.capabilitySetDigest !== expectedCapabilitySetDigest ||
      transition.runtime.contextDigest !== currentRuntime.contextDigest ||
      transition.runtime.capabilitySetDigest !== currentRuntime.capabilitySetDigest ||
      transition.runtime.updatedAt > transition.runtime.deadline
    ) return { committed: false, reason: 'authority_mismatch' }

    const failure = successfulCompletion
      ? null
      : specialistRuntimeFailure(currentRuntime, transition, storedTask.id)
    if (!successfulCompletion && failure === null) {
      return { committed: false, reason: 'invalid_input' }
    }

    const resultInput: CommitCoordinationTaskResultInput = {
      expectedState: stored.state,
      taskId: storedTask.id,
      runtimeId: currentRuntime.id,
      runtimeVersion: transition.runtime.version,
      result: successfulCompletion
        ? {
            status: 'succeeded',
            resultDigest: transition.runtime.lastResultDigest,
            failure: null,
          }
        : { status: 'failed', resultDigest: null, failure },
      usage: { ...transition.runtime.counters },
      now: transition.runtime.updatedAt,
    }
    let resultState: CoordinationSessionState
    let finalState: CoordinationSessionState
    const acceptedHandoffs: AgentHandoff[] = []
    try {
      resultState = parseCoordinationSessionState(recordCoordinationTaskResult({
        state: stored.state,
        expectedSessionVersion: stored.state.version,
        taskId: storedTask.id,
        expectedTaskVersion: storedTask.version,
        runtimeId: currentRuntime.id,
        expectedRuntimeVersion: storedTask.runtimeVersion,
        runtimeVersion: transition.runtime.version,
        result: resultInput.result,
        usage: resultInput.usage,
        now: resultInput.now,
      }))
      if (
        resultState.status === 'terminal' &&
        stored.state.tasks.some((task) =>
          task.id !== storedTask.id && task.status === 'running')
      ) throw new Error('specialist_runtime_cancellation_required')
      const sourceTask = resultState.tasks.find((task) => task.id === storedTask.id)
      if (
        sourceTask === undefined ||
        sourceTask.runtimeId === null ||
        sourceTask.runtimeVersion === null ||
        (successfulCompletion
          ? sourceTask.status !== 'succeeded' || sourceTask.resultDigest === null
          : sourceTask.status !== 'failed' || sourceTask.failure === null)
      ) throw new Error('invalid_specialist_result')
      finalState = resultState
      if (successfulCompletion) {
        const sourceResult: AcceptedSpecialistResult = {
          taskId: sourceTask.id,
          taskVersion: sourceTask.version,
          runtimeId: sourceTask.runtimeId,
          runtimeVersion: sourceTask.runtimeVersion,
          status: 'succeeded',
          resultDigest: sourceTask.resultDigest!,
          evidenceDigests: [...input.evidenceDigests],
          contextDigest: graphTask.contextDigest,
          resourceLeaseOutcome: input.resourceLeaseOutcome,
        }
        for (const draft of input.handoffs) {
          const targetTask = finalState.tasks.find((task) => task.id === draft.targetTaskId)
          if (targetTask === undefined || targetTask.version !== draft.expectedTargetTaskVersion) {
            throw new Error('invalid_specialist_handoff_target')
          }
          const handoff = acceptAgentHandoff({
            stateVersion: 1,
            id: draft.id,
            coordinationId: stored.coordination.id,
            sequence: finalState.counters.acceptedHandoffs + 1,
            scope: { ...stored.coordination.scope },
            sourceTaskId: sourceResult.taskId,
            sourceTaskVersion: sourceResult.taskVersion,
            sourceRuntimeId: sourceResult.runtimeId,
            sourceRuntimeVersion: sourceResult.runtimeVersion,
            targetTaskId: draft.targetTaskId,
            targetTaskVersion: draft.expectedTargetTaskVersion,
            resultDigest: sourceResult.resultDigest,
            evidenceDigests: [...sourceResult.evidenceDigests],
            contextDigest: sourceResult.contextDigest,
            resourceLeaseOutcome: sourceResult.resourceLeaseOutcome,
            summary: draft.summary,
            createdAt: transition.runtime.updatedAt,
          }, {
            coordination: stored.coordination,
            graph: stored.graph,
            sourceResult,
            targetTaskVersion: targetTask.version,
            expectedSequence: finalState.counters.acceptedHandoffs + 1,
            maxSummaryBytes: stored.coordination.bounds.maxHandoffSummaryBytes,
            existingHandoff: null,
          }).handoff
          finalState = parseCoordinationSessionState(applyCoordinationHandoff({
            state: finalState,
            coordination: stored.coordination,
            graph: stored.graph,
            handoff,
            sourceResult,
            expectedSessionVersion: finalState.version,
            expectedTargetTaskVersion: targetTask.version,
            priorAcceptedHandoffs: acceptedHandoffs,
          }))
          acceptedHandoffs.push(handoff)
        }
      }
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }

    const changedTasks = finalState.tasks.flatMap((nextTask) => {
      const previousTask = stored.state.tasks.find((task) => task.id === nextTask.id)
      return previousTask === undefined || sameJson(previousTask, nextTask)
        ? []
        : [{ previousTask, nextTask }]
    })
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeAgentRuntimeTransition(this.db, transition)
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          finalState.version,
          finalState.status,
          finalState.stopReason,
          JSON.stringify(finalState),
          finalState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      for (const { previousTask, nextTask } of changedTasks) {
        this.db.run(
          `update agent_coordination_tasks
           set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
               state_json = ?, updated_at = ?
           where coordination_id = ? and task_id = ? and graph_id = ?
             and version = ? and state_json = ?`,
          [
            nextTask.version,
            nextTask.status,
            nextTask.agentId,
            nextTask.runtimeId,
            nextTask.runtimeVersion,
            JSON.stringify(nextTask),
            finalState.updatedAt,
            stored.coordination.id,
            nextTask.id,
            stored.graph.id,
            previousTask.version,
            JSON.stringify(previousTask),
          ],
        )
        if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      }
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'task_result', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, resultState.version),
          stored.coordination.id,
          storedTask.id,
          resultState.version,
          JSON.stringify(coordinationTaskResultAuditMetadata(resultInput, resultState)),
          resultState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          resultState.version,
          resultState.version,
          resultState.graphVersion,
          JSON.stringify(resultState),
          resultState.updatedAt,
        ],
      )
      let handoffState = resultState
      for (const handoff of acceptedHandoffs) {
        const nextVersion = handoffState.version + 1
        const checkpoint = nextVersion === finalState.version
          ? finalState
          : applyCoordinationHandoff({
              state: handoffState,
              coordination: stored.coordination,
              graph: stored.graph,
              handoff,
              sourceResult: {
                taskId: handoff.sourceTaskId,
                taskVersion: handoff.sourceTaskVersion,
                runtimeId: handoff.sourceRuntimeId,
                runtimeVersion: handoff.sourceRuntimeVersion,
                status: 'succeeded',
                resultDigest: handoff.resultDigest,
                evidenceDigests: handoff.evidenceDigests,
                contextDigest: handoff.contextDigest,
                resourceLeaseOutcome: handoff.resourceLeaseOutcome,
              },
              expectedSessionVersion: handoffState.version,
              expectedTargetTaskVersion: handoff.targetTaskVersion,
              priorAcceptedHandoffs: acceptedHandoffs.filter(
                (candidate) => candidate.sequence < handoff.sequence,
              ),
            })
        this.db.run(
          `insert into agent_coordination_handoffs (
             id, coordination_id, sequence, source_task_id, target_task_id,
             result_digest, handoff_json, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            handoff.id,
            handoff.coordinationId,
            handoff.sequence,
            handoff.sourceTaskId,
            handoff.targetTaskId,
            handoff.resultDigest,
            JSON.stringify(handoff),
            handoff.createdAt,
          ],
        )
        this.db.run(
          `insert into agent_coordination_audits (
             id, coordination_id, task_id, event_kind, session_version,
             metadata_json, created_at
           ) values (?, ?, ?, 'handoff_accepted', ?, ?, ?)`,
          [
            coordinationTransitionAuditId(stored.coordination.id, checkpoint.version),
            stored.coordination.id,
            handoff.targetTaskId,
            checkpoint.version,
            JSON.stringify(coordinationHandoffAuditMetadata(handoff, checkpoint)),
            checkpoint.updatedAt,
          ],
        )
        this.db.run(
          `insert into agent_coordination_checkpoints (
             coordination_id, checkpoint_version, session_version, graph_version,
             checkpoint_json, created_at
           ) values (?, ?, ?, ?, ?, ?)`,
          [
            stored.coordination.id,
            checkpoint.version,
            checkpoint.version,
            checkpoint.graphVersion,
            JSON.stringify(checkpoint),
            checkpoint.updatedAt,
          ],
        )
        handoffState = checkpoint
      }
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'agent-runtime-summary',
        localProjectId: transition.runtime.scope.localProjectId,
        runId: transition.runtime.authority.runId,
        entityId: transition.runtime.id,
        createdAt: transition.runtime.updatedAt,
      })
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return {
        committed: true,
        replayed: false,
        runtime: transition.runtime,
        state: finalState,
        handoffs: acceptedHandoffs,
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' ||
          error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      throw error
    }
  }

  async commitSpecialistRuntimeRecovery(
    input: CommitSpecialistRuntimeRecoveryInput,
  ): Promise<CommitSpecialistRuntimeRecoveryResult> {
    let failureTransition: AgentRuntimeTransition
    let replacementTransition: AgentRuntimeTransition
    let contextAttachment: AgentRuntimeContextAttachment
    try {
      failureTransition = parseAgentRuntimeTransition(input.failureTransition)
      replacementTransition = parseAgentRuntimeTransition(input.replacementTransition)
      contextAttachment = await parseAgentRuntimeContextAttachment(input.contextAttachment)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    if (
      !isNonEmptyIdentifier(input.recoveryId) ||
      !isNonEmptyIdentifier(input.coordinationId) ||
      !isNonEmptyIdentifier(input.taskId) ||
      !Number.isInteger(input.expectedSessionVersion) ||
      input.expectedSessionVersion < 1 ||
      !Number.isInteger(input.expectedTaskVersion) ||
      input.expectedTaskVersion < 1 ||
      !Number.isInteger(input.expectedRuntimeVersion) ||
      input.expectedRuntimeVersion < 1 ||
      failureTransition.runtime.status !== 'terminal' ||
      failureTransition.runtime.stopReason !== 'failure' ||
      !isExactAgentRuntimeTransition(null, replacementTransition) ||
      contextAttachment.runtimeId !== replacementTransition.runtime.id ||
      contextAttachment.checkpointVersion !== replacementTransition.checkpoint.version ||
      contextAttachment.contextDigest !== replacementTransition.runtime.contextDigest ||
      contextAttachment.attachedAt !== replacementTransition.runtime.requestedAt ||
      contextAttachment.knowledgeCitations.length !== 0 ||
      contextAttachment.memoryRevisions.length !== 0
    ) return { committed: false, reason: 'invalid_input' }

    const stored = selectCoordinationRecoverySnapshot(this.db, input.coordinationId)
    if (stored === null) return { committed: false, reason: 'not_found' }
    const storedTask = stored.state.tasks.find((task) => task.id === input.taskId)
    const graphTask = stored.graph.nodes.find((task) => task.id === input.taskId)
    const failedRuntime = selectAgentRuntime(this.db, failureTransition.runtime.id)
    const failedRuntimeLeases = stored.leases.filter((lease) =>
      lease.taskId === input.taskId && lease.runtimeId === failureTransition.runtime.id
    )
    const replacementRuntime = selectAgentRuntime(this.db, replacementTransition.runtime.id)
    const storedReplacementContext = replacementRuntime === null
      ? null
      : await selectAgentRuntimeContextAttachment(this.db, replacementRuntime.id)
    if (
      failedRuntimeLeases.length === 0 ||
      failedRuntimeLeases.some((lease) => lease.status !== 'released')
    ) return { committed: false, reason: 'invalid_input' }
    if (
      storedTask !== undefined &&
      graphTask !== undefined &&
      failedRuntime !== null &&
      replacementRuntime !== null &&
      sameJson(failedRuntime, failureTransition.runtime) &&
      sameJson(replacementRuntime, replacementTransition.runtime) &&
      sameJson(storedReplacementContext, contextAttachment) &&
      stored.state.version === input.expectedSessionVersion + 1 &&
      storedTask.version === input.expectedTaskVersion + 1 &&
      storedTask.status === 'running' &&
      storedTask.runtimeId === replacementRuntime.id &&
      storedTask.runtimeVersion === replacementRuntime.version &&
      storedTask.attemptFailures.length > 0 &&
      matchesSpecialistRuntimeFailure(
        failedRuntime.stopReason,
        storedTask.attemptFailures.at(-1) ?? null,
      )
    ) {
      const failedEvents = selectAgentRuntimeEvents(
        this.db,
        failedRuntime.id,
        failedRuntime.checkpointVersion,
      )
      const failedCheckpoint = selectAgentRuntimeCheckpoints(this.db, failedRuntime.id)
        .find((candidate) => candidate.version === failureTransition.checkpoint.version)
      return sameJson(failedEvents, failureTransition.events) &&
        sameJson(failedCheckpoint, failureTransition.checkpoint)
        ? {
            committed: true,
            replayed: true,
            failedRuntime,
            runtime: replacementRuntime,
            state: stored.state,
          }
        : { committed: false, reason: 'stale_state' }
    }
    if (
      stored.state.version !== input.expectedSessionVersion ||
      storedTask === undefined ||
      graphTask === undefined ||
      storedTask.version !== input.expectedTaskVersion ||
      storedTask.status !== 'running' ||
      storedTask.runtimeId !== failureTransition.runtime.id ||
      storedTask.runtimeVersion === null ||
      failedRuntime === null ||
      failedRuntime.version !== input.expectedRuntimeVersion ||
      !isExactAgentRuntimeTransition(failedRuntime, failureTransition) ||
      replacementRuntime !== null
    ) return { committed: false, reason: 'stale_state' }
    if (
      !await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination) ||
      !await this.isAgentRuntimeContextCurrent(
        failedRuntime.id,
        failureTransition.runtime.updatedAt,
      ) ||
      !await this.areAgentRuntimeContextSourcesCurrent(
        contextAttachment,
        failureTransition.runtime.updatedAt,
      )
    ) return { committed: false, reason: 'authority_mismatch' }

    let descriptor
    try {
      descriptor = resolveSpecialistDescriptor(graphTask.roleId)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const failure = specialistRuntimeFailure(failedRuntime, failureTransition, storedTask.id)
    const expectedRuntimeScope = {
      kind: 'team' as const,
      organizationId: stored.coordination.scope.organizationId,
      projectId: stored.coordination.scope.projectId,
      userId: stored.coordination.scope.userId,
      sessionId: stored.coordination.scope.sessionId,
      localProjectId: stored.coordination.scope.localProjectId,
    }
    const expectedRuntimeAuthority = {
      runId: stored.coordination.authority.runId,
      nodeId: stored.coordination.authority.nodeId,
      runVersion: stored.coordination.authority.runVersion,
      policyVersion: stored.coordination.authority.policyVersion,
    }
    const expectedCapabilitySetDigest = digestSpecialistCapabilitySet({
      roleId: descriptor.id,
      roleVersion: descriptor.version,
      taskContextDigest: graphTask.contextDigest,
      capabilityIds: graphTask.capabilityIds,
    })
    const expectedBounds = {
      maxSteps: failedRuntime.bounds.maxSteps - failureTransition.runtime.counters.steps,
      maxWallTimeMs: Date.parse(failureTransition.runtime.deadline) -
        Date.parse(failureTransition.runtime.updatedAt),
      maxToolCalls: failedRuntime.bounds.maxToolCalls - failureTransition.runtime.counters.toolCalls,
      maxToolResultBytes: failedRuntime.bounds.maxToolResultBytes,
      maxTrajectoryMetadataBytes: failedRuntime.bounds.maxTrajectoryMetadataBytes,
      maxCheckpointBytes: failedRuntime.bounds.maxCheckpointBytes,
      maxTokens: failedRuntime.bounds.maxTokens - failureTransition.runtime.counters.tokens,
      maxCostUsd: failedRuntime.bounds.maxCostUsd - failureTransition.runtime.counters.costUsd,
    }
    let failedToolLeaseCapabilityId: string
    try {
      failedToolLeaseCapabilityId = resolveSpecialistToolLeasePolicy(
        failedRuntime.activeAction?.capabilityId,
      ).capabilityId
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    if (
      descriptor.resourceMode !== 'read' ||
      failedRuntime.activeAction?.kind !== 'tool' ||
      failedToolLeaseCapabilityId !== 'repository_read' ||
      failure?.category !== 'tool_error' ||
      stored.state.counters.activeSpecialists !== 1 ||
      !sameJson(failedRuntime.scope, expectedRuntimeScope) ||
      !sameJson(failedRuntime.authority, expectedRuntimeAuthority) ||
      failedRuntime.capabilitySetDigest !== expectedCapabilitySetDigest ||
      replacementTransition.runtime.id !== deriveSpecialistRecoveryEntityId(
        'runtime',
        input.recoveryId,
        failedRuntime.id,
      ) ||
      contextAttachment.id !== deriveSpecialistRecoveryEntityId(
        'context',
        input.recoveryId,
        failedRuntime.id,
      ) ||
      stored.state.counters.retries >= stored.coordination.bounds.maxSpecialistRetries ||
      Object.values(expectedBounds).some((value) => value <= 0) ||
      !sameJson(replacementTransition.runtime.scope, failedRuntime.scope) ||
      !sameJson(replacementTransition.runtime.authority, failedRuntime.authority) ||
      replacementTransition.runtime.capabilitySetDigest !== failedRuntime.capabilitySetDigest ||
      replacementTransition.runtime.requestedAt !== failureTransition.runtime.updatedAt ||
      replacementTransition.runtime.deadline !== failureTransition.runtime.deadline ||
      !sameJson(replacementTransition.runtime.bounds, expectedBounds) ||
      !sameJson(contextAttachment.scope, failedRuntime.scope) ||
      !sameJson(contextAttachment.authority, failedRuntime.authority)
    ) return { committed: false, reason: 'invalid_input' }

    let nextState: CoordinationSessionState
    try {
      nextState = parseCoordinationSessionState(retryCoordinationTask({
        state: stored.state,
        expectedSessionVersion: stored.state.version,
        taskId: storedTask.id,
        expectedTaskVersion: storedTask.version,
        runtimeId: failedRuntime.id,
        expectedRuntimeVersion: storedTask.runtimeVersion,
        runtimeVersion: failureTransition.runtime.version,
        failure,
        replacementRuntimeId: replacementTransition.runtime.id,
        replacementRuntimeVersion: replacementTransition.runtime.version,
        usage: { ...failureTransition.runtime.counters },
        now: failureTransition.runtime.updatedAt,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const nextTask = nextState.tasks.find((task) => task.id === storedTask.id)
    if (nextTask === undefined) return { committed: false, reason: 'invalid_input' }
    const auditMetadata = coordinationTaskRetryAuditMetadata({
      recoveryId: input.recoveryId,
      taskId: storedTask.id,
      failedRuntimeId: failedRuntime.id,
      failedRuntimeVersion: failureTransition.runtime.version,
      replacementRuntimeId: replacementTransition.runtime.id,
      replacementRuntimeVersion: replacementTransition.runtime.version,
      failure,
      usage: { ...failureTransition.runtime.counters },
    }, nextState)

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeAgentRuntimeTransition(this.db, failureTransition)
      writeAgentRuntimeTransition(this.db, replacementTransition)
      writeAgentRuntimeContextAttachment(this.db, contextAttachment)
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      this.db.run(
        `update agent_coordination_tasks
         set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
             state_json = ?, updated_at = ?
         where coordination_id = ? and task_id = ? and graph_id = ?
           and version = ? and state_json = ?`,
        [
          nextTask.version,
          nextTask.status,
          nextTask.agentId,
          nextTask.runtimeId,
          nextTask.runtimeVersion,
          JSON.stringify(nextTask),
          nextState.updatedAt,
          stored.coordination.id,
          nextTask.id,
          stored.graph.id,
          storedTask.version,
          JSON.stringify(storedTask),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'task_retried', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          nextTask.id,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      for (const runtime of [failureTransition.runtime, replacementTransition.runtime]) {
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'agent-runtime-summary',
          localProjectId: runtime.scope.localProjectId,
          runId: runtime.authority.runId,
          entityId: runtime.id,
          createdAt: runtime.updatedAt,
        })
      }
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return {
        committed: true,
        replayed: false,
        failedRuntime: failureTransition.runtime,
        runtime: replacementTransition.runtime,
        state: nextState,
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' ||
          error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      if (
        error instanceof Error &&
        (error.message === 'coordination_metadata_too_large' ||
          /unique constraint failed: agent_runtimes\.id/iu.test(error.message))
      ) return { committed: false, reason: 'invalid_input' }
      throw error
    }
  }

  async commitCoordinationSessionCancellation(
    input: CommitCoordinationSessionCancellationInput,
  ): Promise<CommitCoordinationSessionCancellationResult> {
    if (
      !isNonEmptyIdentifier(input.coordinationId) ||
      !Number.isInteger(input.expectedSessionVersion) ||
      input.expectedSessionVersion < 1 ||
      !isCanonicalIsoTimestamp(input.now)
    ) return { committed: false, reason: 'invalid_input' }

    const stored = selectCoordinationRecoverySnapshot(this.db, input.coordinationId)
    if (stored === null) return { committed: false, reason: 'not_found' }
    const cancelledRuntimeIds = [...new Set(stored.state.tasks.flatMap((task) =>
      task.status === 'cancelled' && task.runtimeId !== null ? [task.runtimeId] : []
    ))].sort((left, right) => left.localeCompare(right))
    if (
      stored.state.status === 'terminal' &&
      stored.state.stopReason === 'cancelled' &&
      stored.state.version === input.expectedSessionVersion + 1 &&
      stored.state.updatedAt === input.now
    ) {
      const runtimes = cancelledRuntimeIds.map((runtimeId) => selectAgentRuntime(this.db, runtimeId))
      if (
        runtimes.some((runtime) => runtime === null || runtime.status !== 'terminal') ||
        stored.leases.some((lease) => lease.status === 'active')
      ) return { committed: false, reason: 'stale_state' }
      return {
        committed: true,
        replayed: true,
        state: stored.state,
        runtimes: runtimes as AgentRuntimeState[],
        leases: stored.leases,
      }
    }
    if (stored.state.version !== input.expectedSessionVersion) {
      return { committed: false, reason: 'stale_state' }
    }

    let nextState: CoordinationSessionState
    try {
      nextState = parseCoordinationSessionState(cancelCoordinationSession({
        state: stored.state,
        expectedSessionVersion: input.expectedSessionVersion,
        now: input.now,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const runtimeIds = [...new Set(stored.state.tasks.flatMap((task) =>
      task.status === 'running' && task.runtimeId !== null ? [task.runtimeId] : []
    ))].sort((left, right) => left.localeCompare(right))
    const currentRuntimes = runtimeIds.map((runtimeId) => selectAgentRuntime(this.db, runtimeId))
    if (currentRuntimes.some((runtime) => runtime === null)) {
      return { committed: false, reason: 'invalid_input' }
    }
    const runtimeTransitions: AgentRuntimeTransition[] = []
    const nextRuntimes: AgentRuntimeState[] = []
    try {
      for (const runtime of currentRuntimes as AgentRuntimeState[]) {
        if (runtime.status === 'terminal') {
          nextRuntimes.push(runtime)
          continue
        }
        const transition = cancelAgentRuntime({
          runtime,
          expectedCheckpointVersion: runtime.checkpointVersion,
          now: input.now,
        })
        runtimeTransitions.push(transition)
        nextRuntimes.push(transition.runtime)
      }
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const nextLeases: CoordinationResourceLease[] = []
    try {
      for (const lease of stored.leases) {
        nextLeases.push(lease.status === 'active'
          ? settleCoordinationResourceLease({
              lease,
              expectedVersion: lease.version,
              outcome: Date.parse(input.now) >= Date.parse(lease.expiresAt)
                ? 'expired'
                : 'cancelled',
              now: input.now,
            }, { coordination: stored.coordination, graph: stored.graph })
          : lease)
      }
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const cancelledToolAudits: NativeToolAuditRecord[] = []
    try {
      for (const runtimeId of runtimeIds) {
        const startedAudits = selectJson<unknown>(
          this.db,
          `select started.json
             from agent_runtime_tool_audits started
            where started.runtime_id = ? and started.status = 'started'
              and not exists (
                select 1 from agent_runtime_tool_audits terminal
                 where terminal.grant_id = started.grant_id and terminal.status <> 'started'
              )
            order by started.created_at asc, started.id asc`,
          [runtimeId],
        ).map(parseNativeToolAuditRecord)
        for (const started of startedAudits) {
          if (started.createdAt > input.now) throw new Error('invalid_tool_cancellation_time')
          cancelledToolAudits.push({
            ...started,
            id: `specialist-tool-cancel-${createHash('sha256').update(
              `${stored.coordination.id}:${started.grantId}`,
            ).digest('hex').slice(0, 32)}`,
            status: 'cancelled',
            code: 'cancelled',
            createdAt: input.now,
          })
        }
      }
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const changedTasks = nextState.tasks.flatMap((nextTask) => {
      const storedTask = stored.state.tasks.find((task) => task.id === nextTask.id)
      return storedTask === undefined || sameJson(storedTask, nextTask)
        ? []
        : [{ storedTask, nextTask }]
    })
    const auditMetadata = coordinationSessionCancelledAuditMetadata(stored.state)
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      for (const transition of runtimeTransitions) writeAgentRuntimeTransition(this.db, transition)
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      for (const { storedTask, nextTask } of changedTasks) {
        this.db.run(
          `update agent_coordination_tasks
           set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
               state_json = ?, updated_at = ?
           where coordination_id = ? and task_id = ? and graph_id = ?
             and version = ? and state_json = ?`,
          [
            nextTask.version,
            nextTask.status,
            nextTask.agentId,
            nextTask.runtimeId,
            nextTask.runtimeVersion,
            JSON.stringify(nextTask),
            nextState.updatedAt,
            stored.coordination.id,
            nextTask.id,
            stored.graph.id,
            storedTask.version,
            JSON.stringify(storedTask),
          ],
        )
        if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      }
      for (let index = 0; index < stored.leases.length; index += 1) {
        const previousLease = stored.leases[index]!
        const nextLease = nextLeases[index]!
        if (sameJson(previousLease, nextLease)) continue
        this.db.run(
          `update agent_coordination_leases
           set status = ?, version = ?, lease_json = ?, released_at = ?
           where id = ? and coordination_id = ? and version = ?
             and status = 'active' and lease_json = ? and released_at is null`,
          [
            nextLease.status,
            nextLease.version,
            JSON.stringify(nextLease),
            nextLease.releasedAt,
            previousLease.id,
            previousLease.coordinationId,
            previousLease.version,
            JSON.stringify(previousLease),
          ],
        )
        if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_lease')
      }
      for (const runtimeId of runtimeIds) {
        this.db.run(
          `update agent_runtime_capability_grants
           set status = 'cancelled', settled_at = ?
           where runtime_id = ? and status = 'active' and settled_at is null`,
          [input.now, runtimeId],
        )
      }
      for (const audit of cancelledToolAudits) writeNativeToolAudit(this.db, audit)
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, null, 'session_cancelled', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      for (const transition of runtimeTransitions) {
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'agent-runtime-summary',
          localProjectId: transition.runtime.scope.localProjectId,
          runId: transition.runtime.authority.runId,
          entityId: transition.runtime.id,
          createdAt: transition.runtime.updatedAt,
        })
      }
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return {
        committed: true,
        replayed: false,
        state: nextState,
        runtimes: nextRuntimes,
        leases: nextLeases,
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' ||
          error.message === 'stale_coordination_task' ||
          error.message === 'stale_coordination_lease')
      ) return { committed: false, reason: 'stale_state' }
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      throw error
    }
  }

  async commitCoordinationTaskResult(
    input: CommitCoordinationTaskResultInput,
  ): Promise<CommitCoordinationTaskResultOutcome> {
    let expectedState: CoordinationSessionState
    let nextState: CoordinationSessionState
    try {
      expectedState = parseCoordinationSessionState(input.expectedState)
      const expectedTask = expectedState.tasks.find((candidate) => candidate.id === input.taskId)
      if (expectedTask === undefined) throw new Error('invalid_coordination_task')
      if (input.runtimeVersion !== expectedTask.runtimeVersion) {
        const terminalRuntime = selectAgentRuntime(this.db, input.runtimeId)
        if (
          terminalRuntime === null ||
          terminalRuntime.status !== 'terminal' ||
          terminalRuntime.version !== input.runtimeVersion ||
          (input.result.status === 'succeeded' && (
            terminalRuntime.stopReason !== 'success' ||
            terminalRuntime.lastResultDigest !== input.result.resultDigest
          )) ||
          (input.result.status === 'failed' && terminalRuntime.stopReason === 'success')
        ) throw new Error('invalid_coordination_runtime_result')
      }
      nextState = parseCoordinationSessionState(recordCoordinationTaskResult({
        state: expectedState,
        expectedSessionVersion: expectedState.version,
        taskId: input.taskId,
        expectedTaskVersion: expectedTask.version,
        runtimeId: input.runtimeId,
        expectedRuntimeVersion: expectedTask.runtimeVersion ?? input.runtimeVersion,
        runtimeVersion: input.runtimeVersion,
        result: input.result,
        usage: input.usage,
        now: input.now,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const stored = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (stored === null) return { committed: false, reason: 'not_found' }
    const auditMetadata = coordinationTaskResultAuditMetadata(input, nextState)
    if (sameJson(stored.state, nextState)) {
      const storedAudit = selectJson<unknown>(
        this.db,
        `select metadata_json from agent_coordination_audits
         where id = ? and coordination_id = ? and task_id = ?
           and event_kind = 'task_result' and session_version = ? limit 1`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          input.taskId,
          nextState.version,
        ],
      )[0]
      const storedCheckpoint = selectJson<unknown>(
        this.db,
        `select checkpoint_json from agent_coordination_checkpoints
         where coordination_id = ? and checkpoint_version = ?
           and session_version = ? and graph_version = ? limit 1`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
        ],
      )[0]
      return sameJson(storedAudit, auditMetadata) && sameJson(storedCheckpoint, nextState)
        ? { committed: true, replayed: true, state: stored.state }
        : { committed: false, reason: 'stale_state' }
    }
    if (!sameJson(stored.state, expectedState)) {
      return { committed: false, reason: 'stale_state' }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }

    const changedTasks = nextState.tasks.flatMap((nextTask) => {
      const storedTask = stored.state.tasks.find((candidate) => candidate.id === nextTask.id)
      const graphNode = stored.graph.nodes.find((candidate) => candidate.id === nextTask.id)
      if (storedTask === undefined || graphNode === undefined) return []
      return sameJson(storedTask, nextTask) ? [] : [{ storedTask, nextTask, graphNode }]
    })
    if (changedTasks.length === 0) return { committed: false, reason: 'invalid_input' }

    this.db.run('begin transaction')
    try {
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      for (const { storedTask, nextTask } of changedTasks) {
        this.db.run(
          `update agent_coordination_tasks
           set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
               state_json = ?, updated_at = ?
           where coordination_id = ? and task_id = ? and graph_id = ?
             and version = ? and state_json = ?`,
          [
            nextTask.version,
            nextTask.status,
            nextTask.agentId,
            nextTask.runtimeId,
            nextTask.runtimeVersion,
            JSON.stringify(nextTask),
            nextState.updatedAt,
            stored.coordination.id,
            nextTask.id,
            stored.graph.id,
            storedTask.version,
            JSON.stringify(storedTask),
          ],
        )
        if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      }
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'task_result', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          input.taskId,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' || error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      throw error
    }
    await this.persist()
    return { committed: true, replayed: false, state: nextState }
  }

  async commitCoordinationHandoff(
    input: CommitCoordinationHandoffInput,
  ): Promise<CommitCoordinationHandoffResult> {
    let expectedState: CoordinationSessionState
    try {
      expectedState = parseCoordinationSessionState(input.expectedState)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    const stored = selectCoordinationRecoverySnapshot(this.db, expectedState.id)
    if (stored === null) return { committed: false, reason: 'not_found' }
    const priorAcceptedHandoffs = selectAgentCoordinationHandoffs(
      this.db,
      stored.coordination.id,
    )
    const existingHandoff = priorAcceptedHandoffs.find(
      (candidate) => candidate.id === input.handoff.id,
    )
    if (existingHandoff !== undefined) {
      if (!sameJson(existingHandoff, input.handoff)) {
        return { committed: false, reason: 'conflicting_handoff' }
      }
      return stored.state.acceptedHandoffIds.includes(existingHandoff.id)
        ? { committed: true, replayed: true, state: stored.state }
        : { committed: false, reason: 'stale_state' }
    }
    if (!sameJson(stored.state, expectedState)) {
      return { committed: false, reason: 'stale_state' }
    }

    let nextState: CoordinationSessionState
    const targetTask = expectedState.tasks.find(
      (candidate) => candidate.id === input.handoff.targetTaskId,
    )
    if (targetTask === undefined) return { committed: false, reason: 'invalid_input' }
    try {
      nextState = parseCoordinationSessionState(applyCoordinationHandoff({
        state: expectedState,
        coordination: stored.coordination,
        graph: stored.graph,
        handoff: input.handoff,
        sourceResult: input.sourceResult,
        expectedSessionVersion: expectedState.version,
        expectedTargetTaskVersion: targetTask.version,
        priorAcceptedHandoffs,
      }))
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }
    if (!await this.isCoordinationSupervisorAuthorityCurrent(stored.coordination)) {
      return { committed: false, reason: 'authority_mismatch' }
    }
    const nextTargetTask = nextState.tasks.find(
      (candidate) => candidate.id === input.handoff.targetTaskId,
    )
    if (nextTargetTask === undefined) return { committed: false, reason: 'invalid_input' }
    const auditMetadata = coordinationHandoffAuditMetadata(input.handoff, nextState)

    this.db.run('begin transaction')
    try {
      this.db.run(
        `update agent_coordination_sessions
         set version = ?, status = ?, stop_reason = ?, state_json = ?, updated_at = ?
         where id = ? and version = ? and graph_id = ? and graph_version = ? and state_json = ?`,
        [
          nextState.version,
          nextState.status,
          nextState.stopReason,
          JSON.stringify(nextState),
          nextState.updatedAt,
          stored.coordination.id,
          stored.state.version,
          stored.graph.id,
          stored.graph.version,
          JSON.stringify(stored.state),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_session')
      this.db.run(
        `update agent_coordination_tasks
         set version = ?, status = ?, agent_id = ?, runtime_id = ?, runtime_version = ?,
             state_json = ?, updated_at = ?
         where coordination_id = ? and task_id = ? and graph_id = ?
           and version = ? and state_json = ?`,
        [
          nextTargetTask.version,
          nextTargetTask.status,
          nextTargetTask.agentId,
          nextTargetTask.runtimeId,
          nextTargetTask.runtimeVersion,
          JSON.stringify(nextTargetTask),
          nextState.updatedAt,
          stored.coordination.id,
          nextTargetTask.id,
          stored.graph.id,
          targetTask.version,
          JSON.stringify(targetTask),
        ],
      )
      if (this.db.getRowsModified() !== 1) throw new Error('stale_coordination_task')
      this.db.run(
        `insert into agent_coordination_handoffs (
           id, coordination_id, sequence, source_task_id, target_task_id,
           result_digest, handoff_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.handoff.id,
          stored.coordination.id,
          input.handoff.sequence,
          input.handoff.sourceTaskId,
          input.handoff.targetTaskId,
          input.handoff.resultDigest,
          JSON.stringify(input.handoff),
          input.handoff.createdAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_audits (
           id, coordination_id, task_id, event_kind, session_version,
           metadata_json, created_at
         ) values (?, ?, ?, 'handoff_accepted', ?, ?, ?)`,
        [
          coordinationTransitionAuditId(stored.coordination.id, nextState.version),
          stored.coordination.id,
          input.handoff.targetTaskId,
          nextState.version,
          JSON.stringify(auditMetadata),
          nextState.updatedAt,
        ],
      )
      this.db.run(
        `insert into agent_coordination_checkpoints (
           coordination_id, checkpoint_version, session_version, graph_version,
           checkpoint_json, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          stored.coordination.id,
          nextState.version,
          nextState.version,
          nextState.graphVersion,
          JSON.stringify(nextState),
          nextState.updatedAt,
        ],
      )
      assertCoordinationMetadataBound(this.db, stored.coordination.id)
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      if (error instanceof Error && error.message === 'coordination_metadata_too_large') {
        return { committed: false, reason: 'invalid_input' }
      }
      if (
        error instanceof Error &&
        (error.message === 'stale_coordination_session' || error.message === 'stale_coordination_task')
      ) return { committed: false, reason: 'stale_state' }
      throw error
    }
    await this.persist()
    return { committed: true, replayed: false, state: nextState }
  }

  async commitAgentRuntimeTransition(
    input: CommitAgentRuntimeTransitionInput,
  ): Promise<CommitAgentRuntimeTransitionResult> {
    let transition: AgentRuntimeTransition
    let contextAttachment: AgentRuntimeContextAttachment | null = null
    let memoryCandidate: AgentMemoryCandidate | null = null
    try {
      transition = parseAgentRuntimeTransition(input.transition)
      if (input.expectedRuntime !== null) {
        parseAgentRuntimeState(input.expectedRuntime)
      }
      if (input.contextAttachment !== undefined) {
        contextAttachment = await parseAgentRuntimeContextAttachment(input.contextAttachment)
      }
      if (input.memoryCandidate !== undefined) {
        memoryCandidate = await parseAgentMemoryCandidate(input.memoryCandidate)
      }
    } catch {
      return { committed: false, reason: 'invalid_transition' }
    }

    if (memoryCandidate !== null) {
      if (input.expectedRuntime === null) {
        return { committed: false, reason: 'invalid_transition' }
      }
      try {
        const expectedCandidate = await createAgentMemoryCandidate({
          id: memoryCandidate.id,
          statement: memoryCandidate.statement,
          previousRuntime: input.expectedRuntime,
          acceptedTransition: transition,
          createdAt: memoryCandidate.createdAt,
        })
        if (!sameJson(expectedCandidate, memoryCandidate)) {
          return { committed: false, reason: 'invalid_transition' }
        }
      } catch {
        return { committed: false, reason: 'invalid_transition' }
      }
    }

    if (
      contextAttachment !== null &&
      (
        input.expectedRuntime !== null ||
        contextAttachment.runtimeId !== transition.runtime.id ||
        contextAttachment.checkpointVersion !== transition.checkpoint.version ||
        contextAttachment.contextDigest !== transition.runtime.contextDigest ||
        contextAttachment.attachedAt !== transition.runtime.requestedAt ||
        !sameJson(contextAttachment.scope, transition.runtime.scope) ||
        !sameJson(contextAttachment.authority, transition.runtime.authority)
      )
    ) return { committed: false, reason: 'invalid_transition' }
    const current = selectAgentRuntime(this.db, transition.runtime.id)
    if (current && sameJson(current, transition.runtime)) {
      const events = selectAgentRuntimeEvents(
        this.db,
        transition.runtime.id,
        transition.runtime.checkpointVersion,
      )
      const checkpoint = selectAgentRuntimeCheckpoints(
        this.db,
        transition.runtime.id,
      ).find((candidate) => candidate.version === transition.checkpoint.version)
      const storedAttachment = await selectAgentRuntimeContextAttachment(
        this.db,
        transition.runtime.id,
      )
      const storedCandidate = memoryCandidate === null
        ? undefined
        : selectAgentMemoryCandidate(this.db, memoryCandidate.id)
      return sameJson(events, transition.events) &&
        sameJson(checkpoint, transition.checkpoint) &&
        (contextAttachment === null || sameJson(storedAttachment, contextAttachment)) &&
        (memoryCandidate === null || sameJson(storedCandidate, memoryCandidate))
        ? { committed: true, replayed: true, runtime: current }
        : { committed: false, reason: 'invalid_transition' }
    }
    if (
      contextAttachment !== null &&
      !await this.areAgentRuntimeContextSourcesCurrent(
        contextAttachment,
        contextAttachment.attachedAt,
      )
    ) return { committed: false, reason: 'invalid_transition' }

    if (input.expectedRuntime === null) {
      if (current) return { committed: false, reason: 'runtime_exists' }
      if (!isExactAgentRuntimeTransition(null, transition)) {
        return { committed: false, reason: 'invalid_transition' }
      }
    } else {
      if (!current) return { committed: false, reason: 'runtime_not_found' }
      if (!sameJson(current, input.expectedRuntime)) {
        return { committed: false, reason: 'stale_checkpoint' }
      }
      if (!isExactAgentRuntimeTransition(input.expectedRuntime, transition)) {
        return { committed: false, reason: 'invalid_transition' }
      }
    }

    const currentRun = await this.getRun(transition.runtime.authority.runId)
    const currentProject = (await this.listProjects()).find(
      (candidate) => candidate.id === transition.runtime.scope.localProjectId,
    )
    const currentPolicy = await this.getPolicySnapshot(transition.runtime.scope.localProjectId)
    if (
      !currentRun ||
      !currentProject ||
      currentRun.projectId !== currentProject.id ||
      currentRun.version !== transition.runtime.authority.runVersion ||
      currentRun.currentNodeId !== transition.runtime.authority.nodeId ||
      !currentRun.nodes.some(
        (node) =>
          node.id === transition.runtime.authority.nodeId &&
          canRunAgentRuntimeOnNode(node),
      ) ||
      (currentPolicy
        ? currentPolicy.version !== transition.runtime.authority.policyVersion
        : transition.runtime.authority.policyVersion !== 1)
    ) {
      return { committed: false, reason: 'invalid_transition' }
    }

    if (transition.runtime.scope.kind === 'team') {
      const pairing = await this.getDesktopPairingCredential()
      if (
        !pairing ||
        pairing.organizationId !== transition.runtime.scope.organizationId ||
        pairing.projectId !== transition.runtime.scope.projectId ||
        pairing.userId !== transition.runtime.scope.userId ||
        pairing.tokenId !== transition.runtime.scope.sessionId ||
        pairing.localProjectId !== transition.runtime.scope.localProjectId
      ) {
        return { committed: false, reason: 'invalid_transition' }
      }
    } else if (transition.runtime.scope.userId !== currentRun.creatorId) {
      return { committed: false, reason: 'invalid_transition' }
    }

    if (memoryCandidate !== null) {
      if (
        memoryCandidate.scope.localProjectId !== currentProject.id ||
        !sameJson(memoryCandidate.scope, transition.runtime.scope) ||
        selectAgentMemoryCandidate(this.db, memoryCandidate.id) !== undefined ||
        selectJson<unknown>(
          this.db,
          `select json from agent_memory_candidates
           where local_project_id = ? and provenance_digest = ? and content_digest = ? limit 1`,
          [
            memoryCandidate.scope.localProjectId,
            memoryCandidate.provenanceDigest,
            memoryCandidate.contentDigest,
          ],
        )[0] !== undefined
      ) {
        return { committed: false, reason: 'invalid_transition' }
      }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeAgentRuntimeTransition(this.db, transition)
      if (contextAttachment !== null) {
        writeAgentRuntimeContextAttachment(this.db, contextAttachment)
        for (const memoryId of new Set(
          contextAttachment.memoryRevisions.map((memory) => memory.id),
        )) {
          await this.enqueueCanonicalAgentMemoryProjection(
            memoryId,
            contextAttachment.attachedAt,
          )
        }
      }
      if (memoryCandidate !== null) {
        writeAgentMemoryCandidate(this.db, memoryCandidate)
      }
      if (transition.runtime.scope.kind === 'team') {
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'agent-runtime-summary',
          localProjectId: transition.runtime.scope.localProjectId,
          runId: transition.runtime.authority.runId,
          entityId: transition.runtime.id,
          createdAt: transition.runtime.updatedAt,
        })
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, runtime: transition.runtime }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    const normalizedRun = normalizeWorkflowRunProgress(run)
    this.db.run('begin transaction')
    try {
      writeWorkflowRun(this.db, normalizedRun)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'run-summary', localProjectId: normalizedRun.projectId,
        runId: normalizedRun.id, entityId: normalizedRun.id, createdAt: normalizedRun.updatedAt,
      })
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
  }

  async deleteRun(runId: string): Promise<void> {
    const trimmedRunId = runId.trim()
    if (!trimmedRunId) {
      throw new Error('Invalid runId')
    }
    if (
      selectWorkRequestMaterialization(this.db, 'run_id', trimmedRunId) !== null
    ) {
      throw new Error('Run is bound to a Work Request materialization.')
    }
    if (
      selectStringColumn(
        this.db,
        'select id from github_delivery_intents where run_id = ? limit 1',
        [trimmedRunId],
      ).length > 0
    ) {
      throw new Error('Run is bound to a GitHub Delivery Intent.')
    }
    if (
      selectStringColumn(
        this.db,
        'select id from agent_runtimes where run_id = ? limit 1',
        [trimmedRunId],
      ).length > 0
    ) {
      throw new Error('Run is bound to an Agent Runtime.')
    }

    this.db.run('begin transaction')
    try {
      const codingRunIds = selectStringColumn(
        this.db,
        'select id from coding_agent_runs where run_id = ? order by id asc',
        [trimmedRunId],
      )
      const permissionRequestIds = selectStringColumn(
        this.db,
        'select id from coding_permission_requests where run_id = ? order by id asc',
        [trimmedRunId],
      )

      deleteWhereIn(this.db, 'coding_permission_decisions', 'coding_run_id', codingRunIds)
      deleteWhereIn(this.db, 'coding_permission_decisions', 'request_id', permissionRequestIds)
      this.db.run('delete from coding_permission_requests where run_id = ?', [trimmedRunId])
      this.db.run('delete from dependency_bootstrap_evidence where run_id = ?', [trimmedRunId])
      deleteWhereIn(this.db, 'managed_coding_workspaces', 'coding_run_id', codingRunIds)
      this.db.run('delete from coding_agent_events where run_id = ?', [trimmedRunId])
      this.db.run('delete from coding_diff_artifacts where run_id = ?', [trimmedRunId])
      this.db.run('delete from retry_attempts where run_id = ?', [trimmedRunId])
      this.db.run('delete from gate_overrides where run_id = ?', [trimmedRunId])
      this.db.run('delete from coding_agent_runs where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_traces where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_reviews where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_token_usage where run_id = ?', [trimmedRunId])
      this.db.run('delete from test_evidence where run_id = ?', [trimmedRunId])
      this.db.run('delete from artifacts where run_id = ?', [trimmedRunId])
      this.db.run('delete from agent_events where run_id = ?', [trimmedRunId])
      this.db.run('delete from remote_sync_outbox where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_edges where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_nodes where run_id = ?', [trimmedRunId])
      this.db.run('delete from workflow_runs where id = ?', [trimmedRunId])
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }

    await this.persist()
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return readWorkflowRuns(this.db).find((run) => run.id === runId) ?? null
  }

  async listRuns(): Promise<WorkflowRun[]> {
    return readWorkflowRuns(this.db)
  }

  private enqueueCanonicalRemoteSyncOperation(input: {
    kind: RemoteSyncOperation['kind']
    localProjectId: string
    runId: string
    entityId: string
    createdAt: string
  }): void {
    const [pairing] = selectJson<DesktopPairingCredential>(
      this.db,
      "select json from desktop_pairing_credentials where id = 'default'",
    )
    const bound = pairing?.localProjectId === input.localProjectId
    const metadata = {
      kind: input.kind,
      localProjectId: input.localProjectId,
      runId: input.runId,
      entityId: input.entityId,
      organizationId: bound ? pairing.organizationId : null,
      teamProjectId: bound ? pairing.projectId : null,
    }
    const id = createRemoteSyncIdempotencyKey(metadata)
    const result = this.writeRemoteSyncOperation(
      createRemoteSyncOperation({
        id,
        ...metadata,
        createdAt: input.createdAt,
      }),
      { terminalizeScopeMismatch: true },
    )
    if (!result.enqueued && result.reason !== 'coalesced') {
      throw new Error(`Canonical remote-sync enqueue failed (${result.reason}).`)
    }
  }

  private async enqueueCanonicalAgentMemoryProjection(
    memoryId: string,
    createdAt: string,
  ): Promise<void> {
    const head = await this.getAgentMemoryHead(memoryId)
    if (head === null) {
      throw new Error('Canonical Agent Memory projection source is missing.')
    }
    if (head.scope.kind === 'local') return
    const source = await this.getAgentMemoryTeamProjectionInput(memoryId)
    if (source === null) {
      throw new Error('Canonical Agent Memory projection source is invalid.')
    }
    this.enqueueCanonicalRemoteSyncOperation({
      kind: 'agent-memory-summary',
      localProjectId: head.scope.localProjectId,
      runId: source.runId,
      entityId: memoryId,
      createdAt,
    })
  }

  async enqueueRemoteSyncOperation(
    operation: RemoteSyncOperation,
  ): Promise<EnqueueRemoteSyncOperationResult> {
    const result = this.writeRemoteSyncOperation(operation)
    if (result.enqueued || result.reason === 'coalesced') {
      await this.persist()
    }
    return result
  }

  private writeRemoteSyncOperation(
    operation: RemoteSyncOperation,
    options: { terminalizeScopeMismatch?: boolean } = {},
  ): EnqueueRemoteSyncOperationResult {
    if (!isCanonicalInitialRemoteSyncOperation(operation)) {
      return { enqueued: false, reason: 'invalid_operation' }
    }
    if (operation.idempotencyKey !== createRemoteSyncIdempotencyKey(operation)) {
      return { enqueued: false, reason: 'invalid_idempotency_key' }
    }

    const [existing] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where idempotency_key = ?`,
      [operation.idempotencyKey],
    )
    if (existing) {
      const existingHasScope = existing.organizationId !== null || existing.teamProjectId !== null
      const incomingHasScope = operation.organizationId !== null || operation.teamProjectId !== null
      if (
        existingHasScope &&
        incomingHasScope &&
        (existing.organizationId !== operation.organizationId ||
          existing.teamProjectId !== operation.teamProjectId)
      ) {
        if (options.terminalizeScopeMismatch) {
          const terminal: RemoteSyncOperation = {
            ...existing,
            status: 'terminal',
            generation: existing.generation + 1,
            nextAttemptAt: null,
            leaseExpiresAt: null,
            lastErrorCode: 'scope_mismatch',
            lastErrorMessage:
              'The paired Team Project does not match the remote sync operation.',
            recovery: 'none',
            completedAt: null,
            updatedAt: operation.updatedAt,
          }
          this.db.run(
            `update remote_sync_outbox set
               status = ?, generation = ?, next_attempt_at = null, lease_expires_at = null,
               last_error_code = ?, last_error_message = ?, recovery = ?,
               completed_at = null, updated_at = ?
             where id = ?`,
            [
              terminal.status,
              terminal.generation,
              terminal.lastErrorCode,
              terminal.lastErrorMessage,
              terminal.recovery,
              terminal.updatedAt,
              terminal.id,
            ],
          )
          return { enqueued: false, reason: 'coalesced', operation: terminal }
        }
        return { enqueued: false, reason: 'scope_mismatch' }
      }

      const coalesced: RemoteSyncOperation = {
        ...existing,
        organizationId: existingHasScope
          ? existing.organizationId
          : operation.organizationId,
        teamProjectId: existingHasScope
          ? existing.teamProjectId
          : operation.teamProjectId,
        status: 'pending',
        generation: existing.generation + 1,
        attemptCount: 0,
        nextAttemptAt: operation.nextAttemptAt,
        leaseExpiresAt: null,
        lastAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        recovery: 'none',
        completedAt: null,
        updatedAt: operation.updatedAt,
      }
      this.db.run(
        `update remote_sync_outbox set
           organization_id = ?, team_project_id = ?, status = ?, generation = ?,
           attempt_count = ?, next_attempt_at = ?,
           lease_expires_at = ?, last_attempt_at = ?, last_error_code = ?, last_error_message = ?, recovery = ?,
           completed_at = ?, updated_at = ?
         where id = ?`,
        [
          coalesced.organizationId,
          coalesced.teamProjectId,
          coalesced.status,
          coalesced.generation,
          coalesced.attemptCount,
          coalesced.nextAttemptAt,
          coalesced.leaseExpiresAt,
          coalesced.lastAttemptAt,
          coalesced.lastErrorCode,
          coalesced.lastErrorMessage,
          coalesced.recovery,
          coalesced.completedAt,
          coalesced.updatedAt,
          coalesced.id,
        ],
      )
      return { enqueued: false, reason: 'coalesced', operation: coalesced }
    }

    const lastErrorMessage = operation.lastErrorMessage === null
      ? null
      : sanitizeRemoteSyncErrorMessage(operation.lastErrorMessage)
    this.db.run(
      `
      insert into remote_sync_outbox (
        ${REMOTE_SYNC_OPERATION_COLUMNS}
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        operation.id,
        operation.kind,
        operation.localProjectId,
        operation.organizationId,
        operation.teamProjectId,
        operation.runId,
        operation.entityId,
        operation.idempotencyKey,
        operation.status,
        operation.generation,
        operation.attemptCount,
        operation.nextAttemptAt,
        operation.leaseExpiresAt,
        operation.lastAttemptAt,
        operation.lastErrorCode,
        lastErrorMessage,
        operation.recovery,
        operation.completedAt,
        operation.createdAt,
        operation.updatedAt,
      ],
    )
    return {
      enqueued: true,
      operation: { ...operation, lastErrorMessage },
    }
  }

  async listRemoteSyncOperations(runId?: string): Promise<RemoteSyncOperation[]> {
    const trimmedRunId = runId?.trim()
    const whereClause = trimmedRunId ? 'where run_id = ?' : ''
    return selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox ${whereClause}
       order by created_at asc, id asc`,
      trimmedRunId ? [trimmedRunId] : [],
    )
  }

  async claimNextRemoteSyncOperation(now: string): Promise<RemoteSyncOperation | null> {
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const [candidate] = selectRemoteSyncOperations(
        this.db,
        `select ${REMOTE_SYNC_OPERATION_COLUMNS}
         from remote_sync_outbox
         where status in ('pending', 'retry-scheduled')
           and next_attempt_at is not null
           and next_attempt_at <= ?
         order by next_attempt_at asc,
           case when kind = 'run-summary' then 1 else 0 end asc,
           created_at asc, id asc
         limit 1`,
        [now],
      )
      if (!candidate) {
        this.db.run('commit')
        transactionOpen = false
        return null
      }

      this.db.run(
        `update remote_sync_outbox
         set status = 'sending', attempt_count = attempt_count + 1,
             next_attempt_at = null, lease_expires_at = ?, last_attempt_at = ?, updated_at = ?
         where id = ? and generation = ?
           and status in ('pending', 'retry-scheduled')`,
        [
          new Date(Date.parse(now) + REMOTE_SYNC_CLAIM_LEASE_MS).toISOString(),
          now,
          now,
          candidate.id,
          candidate.generation,
        ],
      )
      const [claimed] = selectRemoteSyncOperations(
        this.db,
        `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
        [candidate.id],
      )
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return claimed ?? null
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async bindRemoteSyncOperationScope(
    input: BindRemoteSyncOperationScopeInput,
  ): Promise<BindRemoteSyncOperationScopeResult> {
    if (
      !isNonEmptyIdentifier(input.id) ||
      !Number.isInteger(input.generation) ||
      input.generation < 1 ||
      !isNonEmptyIdentifier(input.organizationId) ||
      !isNonEmptyIdentifier(input.teamProjectId) ||
      !isCanonicalIsoTimestamp(input.updatedAt)
    ) {
      throw new Error('Invalid remote-sync scope binding input.')
    }
    const [operation] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [input.id],
    )
    if (!operation) {
      return { bound: false, reason: 'not_found' }
    }
    if (operation.generation !== input.generation) {
      return { bound: false, reason: 'stale_generation' }
    }
    if (operation.status !== 'sending') {
      return { bound: false, reason: 'not_sending' }
    }

    if (operation.organizationId !== null || operation.teamProjectId !== null) {
      return operation.organizationId === input.organizationId &&
        operation.teamProjectId === input.teamProjectId
        ? { bound: true, operation }
        : { bound: false, reason: 'scope_mismatch' }
    }

    this.db.run(
      `update remote_sync_outbox
       set organization_id = ?, team_project_id = ?, updated_at = ?
       where id = ? and generation = ?
         and status = 'sending'
         and organization_id is null and team_project_id is null`,
      [
        input.organizationId,
        input.teamProjectId,
        input.updatedAt,
        operation.id,
        operation.generation,
      ],
    )
    const [bound] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [operation.id],
    )
    await this.persist()
    return { bound: true, operation: bound! }
  }

  async settleRemoteSyncOperation(
    input: SettleRemoteSyncOperationInput,
  ): Promise<SettleRemoteSyncOperationResult> {
    const [operation] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [input.id],
    )
    if (!operation) {
      return { settled: false, reason: 'not_found' }
    }
    if (operation.generation !== input.generation) {
      return { settled: false, reason: 'stale_generation' }
    }
    if (operation.status !== 'sending') {
      return { settled: false, reason: 'not_sending' }
    }
    if (!isValidRemoteSyncSettlement(input)) {
      throw new Error('Invalid remote-sync settlement state.')
    }

    const nextAttemptAt = input.status === 'retry-scheduled' ? input.nextAttemptAt! : null
    const completedAt = input.status === 'completed'
      ? input.completedAt ?? input.updatedAt
      : null
    const lastErrorMessage = input.lastErrorMessage === undefined || input.lastErrorMessage === null
      ? null
      : sanitizeRemoteSyncErrorMessage(input.lastErrorMessage)
    this.db.run(
      `update remote_sync_outbox set
         status = ?, next_attempt_at = ?, lease_expires_at = null,
         last_error_code = ?, last_error_message = ?,
         recovery = ?, completed_at = ?, updated_at = ?
       where id = ? and generation = ? and status = 'sending'`,
      [
        input.status,
        nextAttemptAt,
        input.lastErrorCode ?? null,
        lastErrorMessage,
        input.recovery ?? operation.recovery,
        completedAt,
        input.updatedAt,
        operation.id,
        operation.generation,
      ],
    )
    const [settled] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [operation.id],
    )
    await this.persist()
    return { settled: true, operation: settled! }
  }

  async retryRemoteSyncOperation(
    input: RetryRemoteSyncOperationInput,
  ): Promise<RetryRemoteSyncOperationResult> {
    const [operation] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [input.id],
    )
    if (!operation) {
      return { retried: false, reason: 'not_found' }
    }
    if (operation.status !== 'terminal') {
      return { retried: false, reason: 'not_terminal' }
    }

    this.db.run(
      `update remote_sync_outbox set
         status = 'pending', generation = generation + 1, attempt_count = 0,
         next_attempt_at = ?, lease_expires_at = null, last_attempt_at = null, last_error_code = null,
         last_error_message = null, recovery = 'none', completed_at = null, updated_at = ?
       where id = ? and status = 'terminal'`,
      [input.updatedAt, input.updatedAt, operation.id],
    )
    const [retried] = selectRemoteSyncOperations(
      this.db,
      `select ${REMOTE_SYNC_OPERATION_COLUMNS} from remote_sync_outbox where id = ?`,
      [operation.id],
    )
    await this.persist()
    return { retried: true, operation: retried! }
  }

  async recoverInterruptedRemoteSyncOperations(updatedAt: string): Promise<number> {
    this.db.run(
      `update remote_sync_outbox set
         status = 'pending', generation = generation + 1,
         next_attempt_at = ?, lease_expires_at = null, updated_at = ?
       where status = 'sending'
         and (lease_expires_at is null or lease_expires_at <= ?)`,
      [updatedAt, updatedAt, updatedAt],
    )
    const recoveredCount = this.db.getRowsModified()
    if (recoveredCount > 0) {
      await this.persist()
    }
    return recoveredCount
  }

  async createWorkflow(
    creation: WorkflowCreation,
  ): Promise<WorkflowCreationResult> {
    assertWorkflowCreationScope(creation)
    if (readWorkflowRuns(this.db).some((run) => run.id === creation.run.id)) {
      return { created: false, reason: 'run_exists' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const createdRun = normalizeWorkflowRunProgress(creation.run)
      writeWorkflowRun(this.db, createdRun)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'run-summary', localProjectId: createdRun.projectId,
        runId: createdRun.id, entityId: createdRun.id, createdAt: createdRun.updatedAt,
      })
      for (const artifact of creation.artifacts) {
        writeArtifact(this.db, artifact)
      }
      for (const event of creation.events) {
        writeAgentEvent(this.db, event)
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { created: true }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async materializeClaimedWorkRequest(
    input: MaterializeClaimedWorkRequestInput,
  ): Promise<MaterializeClaimedWorkRequestResult> {
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const [currentPairing] = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default'",
      )
      if (!hasExpectedMaterializationPairing(currentPairing, input.expectedPairing)) {
        this.db.run('commit')
        transactionOpen = false
        return { status: 'pairing_scope_mismatch' }
      }

      const validated = validateMaterializationInput(input, currentPairing)
      if (!validated) {
        this.db.run('commit')
        transactionOpen = false
        return { status: 'conflict' }
      }
      const { workRequest, creation } = validated
      const existingByWorkRequest = selectWorkRequestMaterialization(
        this.db,
        'work_request_id',
        workRequest.id,
      )
      if (existingByWorkRequest) {
        const runStillExists = readWorkflowRuns(this.db).some(
          (candidate) => candidate.id === existingByWorkRequest.runId,
        )
        this.db.run('commit')
        transactionOpen = false
        return {
          status:
            runStillExists &&
            bindingMatchesMaterialization(existingByWorkRequest, input, workRequest)
              ? 'replayed'
              : 'conflict',
        }
      }

      const existingByRun = selectWorkRequestMaterialization(
        this.db,
        'run_id',
        creation.run.id,
      )
      const existingByIdempotencyKey = selectWorkRequestMaterialization(
        this.db,
        'materialize_idempotency_key',
        input.materializeIdempotencyKey,
      )
      const runAlreadyExists = readWorkflowRuns(this.db).some(
        (candidate) => candidate.id === creation.run.id,
      )
      const runSyncIdempotencyKey = createRemoteSyncIdempotencyKey({
        kind: 'run-summary',
        localProjectId: creation.run.projectId,
        organizationId: workRequest.organizationId,
        teamProjectId: workRequest.projectId,
        runId: creation.run.id,
        entityId: creation.run.id,
      })
      const [existingRunSync] = selectRemoteSyncOperations(
        this.db,
        `select ${REMOTE_SYNC_OPERATION_COLUMNS}
         from remote_sync_outbox
         where idempotency_key = ?`,
        [runSyncIdempotencyKey],
      )
      if (
        existingByRun ||
        existingByIdempotencyKey ||
        runAlreadyExists ||
        existingRunSync
      ) {
        this.db.run('commit')
        transactionOpen = false
        return { status: 'conflict' }
      }

      writeWorkflowRun(this.db, creation.run)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'run-summary',
        localProjectId: creation.run.projectId,
        runId: creation.run.id,
        entityId: creation.run.id,
        createdAt: creation.run.updatedAt,
      })
      for (const artifact of creation.artifacts) {
        writeArtifact(this.db, artifact)
      }
      for (const event of creation.events) {
        writeAgentEvent(this.db, event)
      }
      this.db.run(
        `
          insert into work_request_materializations (
            work_request_id,
            organization_id,
            team_project_id,
            local_project_id,
            run_id,
            claim_version,
            source_fingerprint,
            materialize_idempotency_key,
            status,
            acknowledged_version,
            created_at,
            updated_at,
            acknowledged_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, 'pending_ack', null, ?, ?, null)
        `,
        [
          workRequest.id,
          workRequest.organizationId,
          workRequest.projectId,
          input.expectedPairing.localProjectId,
          creation.run.id,
          workRequest.version,
          input.sourceFingerprint,
          input.materializeIdempotencyKey,
          workRequest.claim!.claimedAt,
          workRequest.claim!.claimedAt,
        ],
      )
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { status: 'created' }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async markWorkRequestMaterializationAcknowledged(
    input: MarkWorkRequestMaterializationAcknowledgedInput,
  ): Promise<MarkWorkRequestMaterializationAcknowledgedResult> {
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const [currentPairing] = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default'",
      )
      if (!hasExpectedMaterializationPairing(currentPairing, input.expectedPairing)) {
        this.db.run('commit')
        transactionOpen = false
        return { acknowledged: false, reason: 'pairing_scope_mismatch' }
      }
      const binding = selectWorkRequestMaterialization(
        this.db,
        'work_request_id',
        input.workRequestId,
      )
      if (!binding) {
        this.db.run('commit')
        transactionOpen = false
        return { acknowledged: false, reason: 'not_found' }
      }
      if (
        !isNonEmptyUnpadded(input.workRequestId) ||
        !isNonEmptyUnpadded(input.runId) ||
        !isCanonicalTimestamp(input.acknowledgedAt) ||
        !/^[0-9a-f]{64}$/.test(input.sourceFingerprint) ||
        !isNonEmptyUnpadded(input.materializeIdempotencyKey) ||
        input.materializeIdempotencyKey.length > 200 ||
        binding.organizationId !== input.expectedPairing.organizationId ||
        binding.teamProjectId !== input.expectedPairing.projectId ||
        binding.localProjectId !== input.expectedPairing.localProjectId ||
        binding.runId !== input.runId ||
        binding.sourceFingerprint !== input.sourceFingerprint ||
        binding.materializeIdempotencyKey !== input.materializeIdempotencyKey ||
        input.materializedVersion !== binding.claimVersion + 1 ||
        input.acknowledgedAt < binding.createdAt ||
        (binding.status === 'acknowledged' &&
          (binding.acknowledgedVersion !== input.materializedVersion ||
            binding.acknowledgedAt !== input.acknowledgedAt))
      ) {
        this.db.run('commit')
        transactionOpen = false
        return { acknowledged: false, reason: 'conflict' }
      }
      if (binding.status === 'acknowledged') {
        this.db.run('commit')
        transactionOpen = false
        return { acknowledged: true }
      }

      this.db.run(
        `
          update work_request_materializations
          set status = 'acknowledged',
              acknowledged_version = ?,
              updated_at = ?,
              acknowledged_at = ?
          where work_request_id = ?
            and run_id = ?
            and source_fingerprint = ?
            and materialize_idempotency_key = ?
            and status = 'pending_ack'
        `,
        [
          input.materializedVersion,
          input.acknowledgedAt,
          input.acknowledgedAt,
          input.workRequestId,
          input.runId,
          input.sourceFingerprint,
          input.materializeIdempotencyKey,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        throw new Error('Work Request materialization acknowledgement was not atomic.')
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { acknowledged: true }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async getWorkRequestMaterializationByWorkRequestId(
    workRequestId: string,
  ): Promise<WorkRequestMaterializationBinding | null> {
    if (!isNonEmptyUnpadded(workRequestId)) {
      return null
    }
    return selectWorkRequestMaterialization(
      this.db,
      'work_request_id',
      workRequestId,
    )
  }

  async getWorkRequestMaterializationByRunId(
    runId: string,
  ): Promise<WorkRequestMaterializationBinding | null> {
    if (!isNonEmptyUnpadded(runId)) {
      return null
    }
    return selectWorkRequestMaterialization(this.db, 'run_id', runId)
  }

  async recordGateCommandReceiptObservation(
    input: RecordGateCommandReceiptObservationInput,
  ): Promise<RecordGateCommandReceiptObservationResult> {
    let command: GateCommand
    let receipt: GateCommandReceipt
    try {
      command = parseGateCommandRecord(input.command)
      receipt = parseGateCommandReceiptRecord(input.receipt)
    } catch {
      return { recorded: false, reason: 'invalid_input' }
    }

    if (
      command.status !== 'delivering' ||
      command.outcomeCode !== null ||
      receipt.commandId !== command.id ||
      receipt.acknowledgedAt !== null ||
      !isCanonicalIsoTimestamp(input.receivedAt) ||
      Date.parse(input.receivedAt) < Date.parse(receipt.leasedAt) ||
      Date.parse(input.receivedAt) >= Date.parse(receipt.leaseExpiresAt)
    ) {
      return { recorded: false, reason: 'invalid_input' }
    }

    const [currentPairing] = selectJson<DesktopPairingCredential>(
      this.db,
      "select json from desktop_pairing_credentials where id = 'default'",
    )
    if (
      !hasExpectedMaterializationPairing(currentPairing, input.expectedPairing) ||
      command.organizationId !== input.expectedPairing.organizationId ||
      command.projectId !== input.expectedPairing.projectId
    ) {
      return { recorded: false, reason: 'pairing_scope_mismatch' }
    }
    if (command.workRequestId !== null) {
      const materialization = selectWorkRequestMaterialization(
        this.db,
        'work_request_id',
        command.workRequestId,
      )
      if (
        !materialization ||
        materialization.organizationId !== command.organizationId ||
        materialization.teamProjectId !== command.projectId ||
        materialization.localProjectId !== currentPairing.localProjectId ||
        materialization.runId !== command.runId
      ) {
        return { recorded: false, reason: 'pairing_scope_mismatch' }
      }
    }

    const observation: LocalGateCommandReceiptObservation = {
      receiptId: receipt.id,
      commandId: command.id,
      attempt: receipt.attempt,
      leasedAt: receipt.leasedAt,
      leaseExpiresAt: receipt.leaseExpiresAt,
      receivedAt: input.receivedAt,
      organizationId: command.organizationId,
      teamProjectId: command.projectId,
      localProjectId: currentPairing.localProjectId,
      workRequestId: command.workRequestId,
      runId: command.runId,
      nodeId: command.nodeId,
      claimTokenId: input.expectedPairing.tokenId,
      executionFingerprint: gateCommandExecutionFingerprint(command),
      status: 'received',
      outcomeCode: null,
      evaluatedAt: null,
    }
    const existingExecution = selectGateCommandExecution(this.db, command.id)
    if (existingExecution) {
      if (
        existingExecution.organizationId !== observation.organizationId ||
        existingExecution.teamProjectId !== observation.teamProjectId ||
        existingExecution.localProjectId !== observation.localProjectId ||
        existingExecution.claimTokenId !== observation.claimTokenId
      ) {
        return { recorded: false, reason: 'pairing_scope_mismatch' }
      }
      if (existingExecution.executionFingerprint !== observation.executionFingerprint) {
        return { recorded: false, reason: 'fingerprint_conflict' }
      }
    }
    const conflictReason = (
      existing: LocalGateCommandReceiptObservation,
    ):
      | 'pairing_scope_mismatch'
      | 'fingerprint_conflict'
      | 'receipt_conflict'
      | null => {
      if (
        existing.organizationId !== observation.organizationId ||
        existing.teamProjectId !== observation.teamProjectId ||
        existing.localProjectId !== observation.localProjectId ||
        existing.claimTokenId !== observation.claimTokenId
      ) {
        return 'pairing_scope_mismatch'
      }
      if (existing.executionFingerprint !== observation.executionFingerprint) {
        return 'fingerprint_conflict'
      }
      if (
        existing.receiptId !== observation.receiptId ||
        existing.commandId !== observation.commandId ||
        existing.attempt !== observation.attempt ||
        existing.leasedAt !== observation.leasedAt ||
        existing.leaseExpiresAt !== observation.leaseExpiresAt ||
        existing.workRequestId !== observation.workRequestId ||
        existing.runId !== observation.runId ||
        existing.nodeId !== observation.nodeId
      ) {
        return 'receipt_conflict'
      }
      return null
    }

    const existing = selectGateCommandReceiptObservation(this.db, receipt.id)
    if (existing) {
      const reason = conflictReason(existing)
      return reason
        ? { recorded: false, reason }
        : { recorded: true, replayed: true, observation: existing }
    }
    const existingAttempt = selectGateCommandReceiptObservationByAttempt(
      this.db,
      command.id,
      receipt.attempt,
    )
    if (existingAttempt) {
      return {
        recorded: false,
        reason: conflictReason(existingAttempt) ?? 'receipt_conflict',
      }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      insertGateCommandReceiptObservation(this.db, observation)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
    return { recorded: true, replayed: false, observation }
  }

  async getGateCommandReceiptObservation(
    receiptId: string,
  ): Promise<LocalGateCommandReceiptObservation | null> {
    if (!isNonEmptyUnpadded(receiptId)) return null
    return selectGateCommandReceiptObservation(this.db, receiptId)
  }

  async commitGateCommandExecution(
    input: CommitGateCommandExecutionInput,
  ): Promise<CommitGateCommandExecutionResult> {
    let command: GateCommand
    let receipt: GateCommandReceipt
    try {
      command = parseGateCommandRecord(input.command)
      receipt = parseGateCommandReceiptRecord(input.receipt)
    } catch {
      return { committed: false, reason: 'invalid_input' }
    }

    if (!isGateReceiptEvaluationWindowValid({
      command,
      receipt,
      outcomeCode: input.outcomeCode,
      evaluatedAt: input.evaluatedAt,
    })) {
      return { committed: false, reason: 'invalid_input' }
    }

    const [currentPairing] = selectJson<DesktopPairingCredential>(
      this.db,
      "select json from desktop_pairing_credentials where id = 'default'",
    )
    if (!hasExpectedMaterializationPairing(currentPairing, input.expectedPairing)) {
      return { committed: false, reason: 'pairing_scope_mismatch' }
    }
    let commandScopeMismatch =
      command.organizationId !== input.expectedPairing.organizationId ||
      command.projectId !== input.expectedPairing.projectId
    if (command.workRequestId !== null) {
      const materialization = selectWorkRequestMaterialization(
        this.db,
        'work_request_id',
        command.workRequestId,
      )
      if (
        !materialization ||
        materialization.organizationId !== command.organizationId ||
        materialization.teamProjectId !== command.projectId ||
        materialization.localProjectId !== currentPairing.localProjectId ||
        materialization.runId !== command.runId
      ) {
        commandScopeMismatch = true
      }
    }

    const executionFingerprint = gateCommandExecutionFingerprint(command)
    const existingExecution = selectGateCommandExecution(this.db, command.id)
    if (existingExecution) {
      if (
        existingExecution.claimTokenId !== input.expectedPairing.tokenId ||
        existingExecution.organizationId !== input.expectedPairing.organizationId ||
        existingExecution.teamProjectId !== input.expectedPairing.projectId ||
        existingExecution.localProjectId !== input.expectedPairing.localProjectId
      ) {
        return { committed: false, reason: 'pairing_scope_mismatch' }
      }
      if (existingExecution.executionFingerprint !== executionFingerprint) {
        return { committed: false, reason: 'fingerprint_conflict' }
      }
      const acknowledgement = selectGateCommandAcknowledgement(this.db, receipt.id)
      const receiptRow = this.db.exec(
        `select command_id, attempt, leased_at, lease_expires_at, received_at
         from gate_command_receipts where receipt_id = ? limit 1`,
        [receipt.id],
      )[0]?.values[0]
      if (receiptRow) {
        const replayAcknowledgement =
          acknowledgement ??
          selectPendingGateCommandAcknowledgementByCommand(this.db, command.id)
        if (
          String(receiptRow[0]) !== existingExecution.commandId ||
          Number(receiptRow[1]) !== receipt.attempt ||
          String(receiptRow[2]) !== receipt.leasedAt ||
          String(receiptRow[3]) !== receipt.leaseExpiresAt ||
          !replayAcknowledgement ||
          replayAcknowledgement.commandId !== existingExecution.commandId
        ) {
          return { committed: false, reason: 'receipt_conflict' }
        }
        const snapshot = this.db.export()
        let transactionOpen = false
        try {
          this.db.run('begin transaction')
          transactionOpen = true
          const observationConflict = finalizeGateCommandReceiptObservation({
            db: this.db,
            command,
            receipt,
            expectedPairing: input.expectedPairing,
            executionFingerprint,
            outcomeCode: existingExecution.outcomeCode,
            evaluatedAt: String(receiptRow[4]),
            allowEvaluatedReplay: true,
          })
          if (observationConflict) {
            this.db.run('rollback')
            transactionOpen = false
            return { committed: false, reason: observationConflict }
          }
          this.db.run('commit')
          transactionOpen = false
          await this.persist()
        } catch (error) {
          if (transactionOpen) {
            try {
              this.db.run('rollback')
            } catch {
              // The exported snapshot remains authoritative.
            }
          }
          this.restore(snapshot)
          throw error
        }
        return {
          committed: true,
          replayed: true,
          execution: existingExecution,
          acknowledgement: replayAcknowledgement,
        }
      }

      const latestAttempt = Number(
        this.db.exec(
          `select coalesce(max(attempt), 0) from gate_command_receipts
           where command_id = ?`,
          [command.id],
        )[0]?.values[0]?.[0] ?? 0,
      )
      if (receipt.attempt !== latestAttempt + 1) {
        return { committed: false, reason: 'receipt_conflict' }
      }
      const pendingAcknowledgement =
        selectPendingGateCommandAcknowledgementByCommand(this.db, command.id)
      if (!pendingAcknowledgement) {
        return { committed: false, reason: 'receipt_conflict' }
      }

      const snapshot = this.db.export()
      let transactionOpen = false
      try {
        this.db.run('begin transaction')
        transactionOpen = true
        const observationConflict = finalizeGateCommandReceiptObservation({
          db: this.db,
          command,
          receipt,
          expectedPairing: input.expectedPairing,
          executionFingerprint,
          outcomeCode: existingExecution.outcomeCode,
          evaluatedAt: input.evaluatedAt,
          allowEvaluatedReplay: true,
        })
        if (observationConflict) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: observationConflict }
        }
        this.db.run(
          `insert into gate_command_receipts (
             receipt_id, command_id, attempt, leased_at, lease_expires_at,
             acknowledged_at, received_at
           ) values (?, ?, ?, ?, ?, null, ?)`,
          [
            receipt.id,
            command.id,
            receipt.attempt,
            receipt.leasedAt,
            receipt.leaseExpiresAt,
            input.evaluatedAt,
          ],
        )
        this.db.run('commit')
        transactionOpen = false
        await this.persist()
      } catch (error) {
        if (transactionOpen) {
          try {
            this.db.run('rollback')
          } catch {
            // The exported snapshot remains authoritative.
          }
        }
        this.restore(snapshot)
        throw error
      }
      return {
        committed: true,
        replayed: true,
        execution: existingExecution,
        acknowledgement: pendingAcknowledgement,
      }
    }

    const currentRun = readWorkflowRuns(this.db).find(
      (candidate) => candidate.id === command.runId,
    )
    let beforeRunVersion: number
    let afterRunVersion: number
    let terminalOutcomeCode = input.outcomeCode
    let nextRun: WorkflowRun | null = null
    let approvalEvent: AgentEvent | null = null

    if (input.outcomeCode === 'expired') {
      terminalOutcomeCode = 'expired'
      beforeRunVersion = command.expectedRunVersion
      afterRunVersion = command.expectedRunVersion
    } else if (commandScopeMismatch) {
      terminalOutcomeCode = 'scope_mismatch'
      beforeRunVersion = command.expectedRunVersion
      afterRunVersion = command.expectedRunVersion
    } else if (input.outcomeCode === 'applied') {
      if (
        command.action !== 'approve' ||
        command.workflowCommand === null ||
        !input.expectedRun ||
        !input.run ||
        !input.event ||
        !input.evaluationBinding
      ) {
        return { committed: false, reason: 'invalid_input' }
      }
      const expectedRun = normalizeWorkflowRunProgress(input.expectedRun)
      const candidateNextRun = normalizeWorkflowRunProgress(input.run)
      if (
        expectedRun.id !== command.runId ||
        expectedRun.projectId !== currentPairing.localProjectId ||
        expectedRun.currentNodeId !== command.nodeId ||
        expectedRun.version !== command.expectedRunVersion ||
        candidateNextRun.version !== expectedRun.version + 1 ||
        candidateNextRun.updatedAt !== input.evaluatedAt ||
        !gateRunEnvelopeIsImmutable(expectedRun, candidateNextRun) ||
        input.event.runId !== command.runId ||
        input.event.nodeId !== command.nodeId ||
        input.event.kind !== 'approval' ||
        input.event.timestamp !== input.evaluatedAt ||
        !isNonEmptyIdentifier(input.event.id) ||
        input.event.id.length > 200 ||
        !Number.isInteger(input.event.sequence) ||
        input.event.sequence < 1 ||
        input.event.sequence > 2_147_483_647 ||
        typeof input.event.message !== 'string' ||
        input.event.message.trim().length === 0 ||
        input.event.message.length > 2_000
      ) {
        return { committed: false, reason: 'invalid_input' }
      }
      beforeRunVersion = expectedRun.version
      afterRunVersion = expectedRun.version
      if (!currentRun) {
        terminalOutcomeCode = 'run_not_found'
      } else if (JSON.stringify(currentRun) !== JSON.stringify(expectedRun)) {
        terminalOutcomeCode = 'stale_run'
      } else {
        afterRunVersion = candidateNextRun.version
        nextRun = candidateNextRun
        approvalEvent = {
          id: input.event.id,
          runId: input.event.runId,
          nodeId: input.event.nodeId,
          sequence: input.event.sequence,
          kind: 'approval',
          message: redactSensitiveText(input.event.message).value,
          timestamp: input.event.timestamp,
        }
      }
    } else if (input.outcomeCode === 'human_rejected') {
      if (
        command.action !== 'reject' ||
        command.workflowCommand !== null ||
        input.expectedRun !== undefined ||
        input.run !== undefined ||
        input.event !== undefined
      ) {
        return { committed: false, reason: 'invalid_input' }
      }
      beforeRunVersion = command.expectedRunVersion
      afterRunVersion = command.expectedRunVersion
      if (!currentRun) {
        terminalOutcomeCode = 'run_not_found'
      } else if (currentRun.version !== command.expectedRunVersion) {
        terminalOutcomeCode = 'stale_run'
      }
    } else {
      if (
        input.expectedRun !== undefined ||
        input.run !== undefined ||
        input.event !== undefined
      ) {
        return { committed: false, reason: 'invalid_input' }
      }
      beforeRunVersion = command.expectedRunVersion
      afterRunVersion = command.expectedRunVersion
    }

    if (
      terminalOutcomeCode !== 'expired' &&
      terminalOutcomeCode !== 'scope_mismatch' &&
      terminalOutcomeCode !== 'run_not_found'
    ) {
      if (!currentRun) {
        terminalOutcomeCode = 'run_not_found'
        beforeRunVersion = command.expectedRunVersion
        afterRunVersion = command.expectedRunVersion
        nextRun = null
        approvalEvent = null
      } else if (currentRun.version !== command.expectedRunVersion) {
        terminalOutcomeCode = 'stale_run'
        beforeRunVersion = currentRun.version
        afterRunVersion = currentRun.version
        nextRun = null
        approvalEvent = null
      }
    }
    if (terminalOutcomeCode === 'stale_run' && currentRun) {
      beforeRunVersion = currentRun.version
      afterRunVersion = currentRun.version
    }

    const expectedBlockerIdsHash = sha256Canonical(command.expectedBlockerIds)
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const transactionRun = input.outcomeCode === 'applied'
        ? readWorkflowRuns(this.db).find(
            (candidate) => candidate.id === command.runId,
          )
        : currentRun
      if (input.outcomeCode === 'applied' && input.expectedRun) {
        const expectedRun = normalizeWorkflowRunProgress(input.expectedRun)
        if (!transactionRun) {
          terminalOutcomeCode = 'run_not_found'
          beforeRunVersion = command.expectedRunVersion
          afterRunVersion = command.expectedRunVersion
          nextRun = null
          approvalEvent = null
        } else if (
          JSON.stringify(transactionRun) !== JSON.stringify(expectedRun)
        ) {
          terminalOutcomeCode = 'stale_run'
          beforeRunVersion = transactionRun.version
          afterRunVersion = transactionRun.version
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && input.evaluationBinding) {
        const [persistedPolicySnapshot] = selectJson<PolicySnapshot>(
          this.db,
          'select json from policy_snapshots where project_id = ?',
          [command.projectId],
        )
        const binding = input.evaluationBinding
        const policyMatchesEvaluation =
          binding.policySnapshot.projectId === command.projectId &&
          binding.policySnapshot.source === 'remote_cache' &&
          binding.policySnapshot.effectivePolicy !== null &&
          binding.policySnapshot.version === command.expectedPolicyVersion &&
          binding.policySnapshot.effectivePolicy.version === command.expectedPolicyVersion &&
          binding.enforcement.policySource === 'remote_cache' &&
          binding.enforcement.policyVersion === command.expectedPolicyVersion &&
          !binding.enforcement.provisional &&
          persistedPolicySnapshot !== undefined &&
          stableJsonMatches(persistedPolicySnapshot, binding.policySnapshot)
        if (!policyMatchesEvaluation) {
          terminalOutcomeCode = 'stale_policy'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && input.evaluationBinding) {
        const binding = input.evaluationBinding
        const evaluatedBlockerIds = canonicalUniqueStrings(
          binding.enforcement.blockingReasons.map((reason) => reason.id),
        )
        const persistedOverrides = selectJson<GateOverrideDecision>(
          this.db,
          'select json from gate_overrides where run_id = ? order by created_at desc',
          [command.runId],
        )
        const overridesMatchEvaluation = stableJsonMatches(
          canonicalGateOverrides(persistedOverrides),
          canonicalGateOverrides(binding.overrides),
        )
        if (
          evaluatedBlockerIds === null ||
          !stableJsonMatches(evaluatedBlockerIds, command.expectedBlockerIds)
        ) {
          terminalOutcomeCode = 'blockers_changed'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        } else if (!overridesMatchEvaluation) {
          const evaluatedOverride = binding.selectedOverrideId === null
            ? undefined
            : binding.overrides.find(
                (candidate) => candidate.id === binding.selectedOverrideId,
              )
          const persistedOverride = binding.selectedOverrideId === null
            ? undefined
            : persistedOverrides.find(
                (candidate) => candidate.id === binding.selectedOverrideId,
              )
          const evaluatedOverrideBlockers = evaluatedOverride
            ? canonicalUniqueStrings(evaluatedOverride.blockedReasonIds)
            : null
          const persistedOverrideBlockers = persistedOverride
            ? canonicalUniqueStrings(persistedOverride.blockedReasonIds)
            : null
          terminalOutcomeCode =
            evaluatedOverrideBlockers !== null &&
            persistedOverrideBlockers !== null &&
            !stableJsonMatches(
              evaluatedOverrideBlockers,
              persistedOverrideBlockers,
            )
              ? 'blockers_changed'
              : 'evidence_blocked'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && input.evaluationBinding) {
        const binding = input.evaluationBinding
        const selectedOverrides = binding.selectedOverrideId === null
          ? []
          : binding.overrides.filter(
              (candidate) => candidate.id === binding.selectedOverrideId,
            )
        const selectedOverride = selectedOverrides[0]
        const selectedOverrideBlockers = selectedOverride
          ? canonicalUniqueStrings(selectedOverride.blockedReasonIds)
          : null
        const needsOverride =
          binding.enforcement.blocksApproval ||
          binding.enforcement.status === 'overridden'
        const enforcementShapeIsCanonical =
          binding.enforcement.overrideRoleRequired === 'lead' &&
          binding.enforcement.status !== 'blocked_policy_unavailable' &&
          ((binding.enforcement.status === 'pass' ||
            binding.enforcement.status === 'warn')
            ? !binding.enforcement.blocksApproval &&
              binding.enforcement.blockingReasons.length === 0 &&
              !binding.enforcement.canOverride
            : binding.enforcement.status === 'overridden'
              ? !binding.enforcement.blocksApproval &&
                binding.enforcement.blockingReasons.length > 0 &&
                binding.enforcement.canOverride
              : binding.enforcement.status === 'blocked'
                ? binding.enforcement.blocksApproval &&
                  binding.enforcement.blockingReasons.length > 0 &&
                  binding.enforcement.canOverride
                : binding.enforcement.status === 'hard_blocked' &&
                  binding.enforcement.blocksApproval &&
                  binding.enforcement.blockingReasons.length > 0 &&
                  !binding.enforcement.canOverride)
        const selectedOverrideIsExact =
          needsOverride
            ? selectedOverrides.length === 1 &&
              selectedOverride !== undefined &&
              selectedOverride.status === 'accepted' &&
              !selectedOverride.provisional &&
              selectedOverride.runId === command.runId &&
              selectedOverride.nodeId === command.nodeId &&
              selectedOverride.projectId === currentPairing.localProjectId &&
              selectedOverride.projectId === transactionRun?.projectId &&
              selectedOverride.userId === command.requestedByUserId &&
              selectedOverride.role === 'lead' &&
              selectedOverride.policyVersion === command.expectedPolicyVersion &&
              selectedOverride.reason.trim().length > 0 &&
              selectedOverrideBlockers !== null &&
              stableJsonMatches(
                selectedOverrideBlockers,
                command.expectedBlockerIds,
              )
            : binding.selectedOverrideId === null
        const node = transactionRun?.nodes.find(
          (candidate) => candidate.id === command.nodeId,
        )
        const approval =
          enforcementShapeIsCanonical &&
          selectedOverrideIsExact &&
          transactionRun &&
          node
            ? canApproveGateNow({
                userRole: command.requestedRole,
                userId: command.requestedByUserId,
                run: transactionRun,
                node,
                enforcement: binding.enforcement,
                ...(selectedOverride ? { override: selectedOverride } : {}),
              })
            : { allowed: false as const, reason: 'blocked' as const }
        if (!approval.allowed) {
          terminalOutcomeCode =
            approval.reason === 'role_denied'
              ? 'authorization_denied'
              : 'evidence_blocked'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && input.evaluationBinding) {
        const bindingEvidence = input.evaluationBinding.evidence
        const persistedEvidence = readPersistedGateEvidence(
          this.db,
          command.runId,
        )
        if (
          Object.prototype.hasOwnProperty.call(bindingEvidence, 'approval') ||
          !stableJsonMatches(
            canonicalPersistedGateEvidence(persistedEvidence),
            canonicalPersistedGateEvidence(bindingEvidence),
          )
        ) {
          terminalOutcomeCode = 'evidence_blocked'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && input.evaluationBinding) {
        const knowledge = input.evaluationBinding.repositoryKnowledge
        if (
          knowledge.projectId !== currentPairing.localProjectId ||
          !/^sha256:[0-9a-f]{64}$/.test(knowledge.evaluatedFingerprint) ||
          !/^sha256:[0-9a-f]{64}$/.test(knowledge.observedFingerprint) ||
          knowledge.evaluatedFingerprint !== knowledge.observedFingerprint
        ) {
          terminalOutcomeCode = 'evidence_blocked'
          afterRunVersion = beforeRunVersion
          nextRun = null
          approvalEvent = null
        }
      }
      if (nextRun && approvalEvent && transactionRun) {
        const persistedEvidence = readPersistedGateEvidence(
          this.db,
          command.runId,
        )
        const canonicalTransition = replayCanonicalGateTransition({
          run: transactionRun,
          command,
          evaluatedAt: input.evaluatedAt,
          evidence: persistedEvidence,
          approvalAllowed: true,
        })
        const existingEvents = selectJson<AgentEvent>(
          this.db,
          'select json from agent_events where run_id = ? order by sequence asc, timestamp asc',
          [command.runId],
        )
        const nextEventSequence = existingEvents.reduce(
          (maximum, event) => Math.max(maximum, event.sequence),
          0,
        ) + 1
        if (
          !canonicalTransition ||
          JSON.stringify(canonicalTransition) !== JSON.stringify(nextRun) ||
          existingEvents.some((event) => event.id === approvalEvent!.id) ||
          approvalEvent.sequence !== nextEventSequence
        ) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: 'invalid_input' }
        }
      }
      const observationConflict = finalizeGateCommandReceiptObservation({
        db: this.db,
        command,
        receipt,
        expectedPairing: input.expectedPairing,
        executionFingerprint,
        outcomeCode: terminalOutcomeCode,
        evaluatedAt: input.evaluatedAt,
        allowEvaluatedReplay: false,
      })
      if (observationConflict) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: observationConflict }
      }
      this.db.run(
        `insert into gate_command_executions (
           command_id, organization_id, team_project_id, local_project_id,
           claim_token_id,
           work_request_id, run_id, node_id, action, workflow_command,
           requested_by_user_id, requested_role, server_request_fingerprint,
           execution_fingerprint, expected_run_version, expected_policy_version,
           expected_blocker_ids_hash, outcome_code, before_run_version,
           after_run_version, evaluated_at, command_expires_at, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          command.id,
          command.organizationId,
          command.projectId,
          currentPairing.localProjectId,
          input.expectedPairing.tokenId,
          command.workRequestId,
          command.runId,
          command.nodeId,
          command.action,
          command.workflowCommand,
          command.requestedByUserId,
          command.requestedRole,
          command.requestFingerprint,
          executionFingerprint,
          command.expectedRunVersion,
          command.expectedPolicyVersion,
          expectedBlockerIdsHash,
          terminalOutcomeCode,
          beforeRunVersion,
          afterRunVersion,
          input.evaluatedAt,
          command.expiresAt,
          command.createdAt,
        ],
      )
      this.db.run(
        `insert into gate_command_receipts (
           receipt_id, command_id, attempt, leased_at, lease_expires_at,
           acknowledged_at, received_at
         ) values (?, ?, ?, ?, ?, null, ?)`,
        [
          receipt.id,
          command.id,
          receipt.attempt,
          receipt.leasedAt,
          receipt.leaseExpiresAt,
          input.evaluatedAt,
        ],
      )
      this.db.run(
        `insert into gate_command_acknowledgements (
           receipt_id, command_id, outcome_code, before_run_version,
           after_run_version, evaluated_at, status,
           remote_acknowledgement_id, remote_created_at, remote_replayed,
           created_at, acknowledged_at
         ) values (?, ?, ?, ?, ?, ?, 'pending', null, null, null, ?, null)`,
        [
          receipt.id,
          command.id,
          terminalOutcomeCode,
          beforeRunVersion,
          afterRunVersion,
          input.evaluatedAt,
          input.evaluatedAt,
        ],
      )
      if (nextRun && approvalEvent) {
        writeWorkflowRun(this.db, nextRun)
        writeAgentEvent(this.db, approvalEvent)
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'run-summary',
          localProjectId: nextRun.projectId,
          runId: nextRun.id,
          entityId: nextRun.id,
          createdAt: nextRun.updatedAt,
        })
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }

    const execution = selectGateCommandExecution(this.db, command.id)!
    const acknowledgement = selectGateCommandAcknowledgement(this.db, receipt.id)!
    return {
      committed: true,
      replayed: false,
      execution,
      acknowledgement,
    }
  }

  async getGateCommandExecution(
    commandId: string,
  ): Promise<LocalGateCommandExecution | null> {
    if (!isNonEmptyUnpadded(commandId)) return null
    return selectGateCommandExecution(this.db, commandId)
  }

  async getGateCommandAcknowledgement(
    receiptId: string,
  ): Promise<LocalGateCommandAcknowledgement | null> {
    if (!isNonEmptyUnpadded(receiptId)) return null
    return selectGateCommandAcknowledgement(this.db, receiptId)
  }

  async listPendingGateCommandAcknowledgements(): Promise<
    LocalGateCommandAcknowledgement[]
  > {
    return selectStringColumn(
      this.db,
      `select receipt_id from gate_command_acknowledgements
       where status = 'pending' order by created_at asc, receipt_id asc`,
    ).map((receiptId) => selectGateCommandAcknowledgement(this.db, receiptId)!)
  }

  async recordGateCommandAcknowledgement(
    input: RecordGateCommandAcknowledgementInput,
  ): Promise<RecordGateCommandAcknowledgementResult> {
    let remoteAcknowledgement: GateCommandAcknowledgement
    try {
      remoteAcknowledgement = parseGateCommandAcknowledgementRecord(
        input.acknowledgement,
      )
    } catch {
      return { recorded: false, reason: 'invalid_input' }
    }
    if (
      !isNonEmptyUnpadded(input.receiptId) ||
      input.receiptId !== remoteAcknowledgement.receiptId ||
      typeof input.replayed !== 'boolean' ||
      !isCanonicalIsoTimestamp(input.acknowledgedAt) ||
      Date.parse(input.acknowledgedAt) < Date.parse(remoteAcknowledgement.createdAt)
    ) {
      return { recorded: false, reason: 'invalid_input' }
    }

    const local = selectGateCommandAcknowledgement(this.db, input.receiptId)
    if (!local) return { recorded: false, reason: 'not_found' }
    const matchesLocal =
      local.commandId === remoteAcknowledgement.commandId &&
      local.receiptId === remoteAcknowledgement.receiptId &&
      local.outcomeCode === remoteAcknowledgement.outcomeCode &&
      local.beforeRunVersion === remoteAcknowledgement.beforeRunVersion &&
      local.afterRunVersion === remoteAcknowledgement.afterRunVersion &&
      local.evaluatedAt === remoteAcknowledgement.evaluatedAt
    if (!matchesLocal) {
      return { recorded: false, reason: 'acknowledgement_conflict' }
    }

    if (local.status === 'acknowledged') {
      if (
        local.remoteAcknowledgementId !== remoteAcknowledgement.id ||
        local.remoteCreatedAt !== remoteAcknowledgement.createdAt
      ) {
        return { recorded: false, reason: 'acknowledgement_conflict' }
      }
      return { recorded: true, replayed: true, acknowledgement: local }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update gate_command_acknowledgements set
           status = 'acknowledged', remote_acknowledgement_id = ?,
           remote_created_at = ?, remote_replayed = ?, acknowledged_at = ?
         where receipt_id = ? and status = 'pending'`,
        [
          remoteAcknowledgement.id,
          remoteAcknowledgement.createdAt,
          input.replayed ? 1 : 0,
          input.acknowledgedAt,
          input.receiptId,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { recorded: false, reason: 'acknowledgement_conflict' }
      }
      this.db.run(
        `update gate_command_receipts set acknowledged_at = ?
         where receipt_id = ? and command_id = ? and acknowledged_at is null`,
        [
          remoteAcknowledgement.createdAt,
          input.receiptId,
          remoteAcknowledgement.commandId,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { recorded: false, reason: 'acknowledgement_conflict' }
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
    return {
      recorded: true,
      replayed: false,
      acknowledgement: selectGateCommandAcknowledgement(
        this.db,
        input.receiptId,
      )!,
    }
  }

  async terminalizeGateCommandAcknowledgement(
    input: TerminalizeGateCommandAcknowledgementInput,
  ): Promise<TerminalizeGateCommandAcknowledgementResult> {
    if (
      !isNonEmptyUnpadded(input.receiptId) ||
      input.receiptId.length > 200 ||
      !GATE_COMMAND_TERMINAL_ACK_FAILURE_CODES.has(input.failureCode) ||
      !isCanonicalIsoTimestamp(input.failedAt)
    ) {
      return { terminalized: false, reason: 'invalid_input' }
    }

    const local = selectGateCommandAcknowledgement(this.db, input.receiptId)
    if (!local) return { terminalized: false, reason: 'not_found' }
    if (Date.parse(input.failedAt) < Date.parse(local.createdAt)) {
      return { terminalized: false, reason: 'invalid_input' }
    }
    if (local.status === 'terminal') {
      if (
        local.failureCode !== input.failureCode ||
        local.failedAt !== input.failedAt
      ) {
        return { terminalized: false, reason: 'conflict' }
      }
      return { terminalized: true, replayed: true, acknowledgement: local }
    }
    if (local.status !== 'pending') {
      return { terminalized: false, reason: 'conflict' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update gate_command_acknowledgements set
           status = 'terminal', failure_code = ?, failed_at = ?
         where receipt_id = ? and status = 'pending'`,
        [input.failureCode, input.failedAt, input.receiptId],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { terminalized: false, reason: 'conflict' }
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }

    return {
      terminalized: true,
      replayed: false,
      acknowledgement: selectGateCommandAcknowledgement(
        this.db,
        input.receiptId,
      )!,
    }
  }

  async commitWorkflowMutation(
    mutation: WorkflowMutation,
  ): Promise<WorkflowMutationCommitResult> {
    assertWorkflowMutationScope(mutation)
    const expectedRun = normalizeWorkflowRunProgress(mutation.expectedRun)
    const currentRun = readWorkflowRuns(this.db).find(
      (candidate) => candidate.id === expectedRun.id,
    )
    if (!currentRun) {
      return { committed: false, reason: 'run_not_found' }
    }
    if (JSON.stringify(currentRun) !== JSON.stringify(expectedRun)) {
      return { committed: false, reason: 'stale_run' }
    }

    const snapshot = this.db.export()
    const nextRun = normalizeWorkflowRunProgress(mutation.run)
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      writeWorkflowRun(this.db, nextRun)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'run-summary', localProjectId: nextRun.projectId,
        runId: nextRun.id, entityId: nextRun.id, createdAt: nextRun.updatedAt,
      })
      for (const artifact of mutation.artifacts ?? []) {
        writeArtifact(this.db, artifact)
      }
      for (const event of mutation.events ?? []) {
        writeAgentEvent(this.db, event)
      }
      for (const evidence of mutation.testEvidence ?? []) {
        writeTestEvidence(this.db, evidence)
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'test-evidence-summary', localProjectId: evidence.projectId,
          runId: evidence.runId, entityId: evidence.id, createdAt: evidence.createdAt,
        })
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The snapshot below is authoritative even if SQLite already closed the transaction.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitGitHubDeliveryPreparation(
    mutation: GitHubDeliveryPreparationMutation,
  ): Promise<GitHubDeliveryPreparationMutationResult> {
    const expectedRun = normalizeWorkflowRunProgress(mutation.expectedRun)
    if (
      mutation.expectedProject.id !== mutation.intent.localProjectId ||
      mutation.expectedProject.id !== expectedRun.projectId ||
      mutation.expectedWorkspace.sourcePath !== mutation.expectedProject.path
    ) {
      throw new Error('GitHub Delivery Intent does not match the Local Project source')
    }
    if (
      mutation.expectedPairingCredential.organizationId !== mutation.intent.organizationId ||
      mutation.expectedPairingCredential.projectId !== mutation.intent.teamProjectId ||
      mutation.expectedPairingCredential.localProjectId !== mutation.intent.localProjectId
    ) {
      throw new Error('GitHub Delivery Intent does not match the Desktop pairing scope')
    }
    if (
      mutation.expectedRepositoryBinding.id !== mutation.intent.repositoryBindingId ||
      mutation.expectedRepositoryBinding.version !== mutation.intent.repositoryBindingVersion ||
      mutation.expectedRepositoryBinding.installationId !== mutation.intent.installationId ||
      mutation.expectedRepositoryBinding.repositoryId !== mutation.intent.repositoryId ||
      mutation.expectedRepositoryBinding.organizationId !== mutation.intent.organizationId ||
      mutation.expectedRepositoryBinding.teamProjectId !== mutation.intent.teamProjectId
    ) {
      throw new Error('GitHub Delivery Intent does not match the repository binding')
    }
    const expectedTestEvidence = redactTestEvidenceForStorage(
      mutation.testEvidence,
    )
    const testCommandSafety = validateTestCommandSafety(
      mutation.expectedProject.testCommand,
    )
    if (
      testCommandSafety.level === 'blocked' ||
      expectedTestEvidence.command !== testCommandSafety.normalizedCommand
    ) {
      throw new Error('GitHub Delivery Test Evidence does not match the safe Project test command')
    }
    if (!expectedTestEvidence.sourceCommitSha) {
      throw new Error('GitHub Delivery Test Evidence must be commit-bound')
    }
    const canonicalIntent = await createGitHubDeliveryIntent({
      id: mutation.intent.id,
      repositoryBinding: mutation.expectedRepositoryBinding,
      run: expectedRun,
      prNodeId: mutation.intent.nodeId,
      codingRun: mutation.expectedCodingRun,
      workspace: mutation.expectedWorkspace,
      diffArtifact: mutation.expectedDiffArtifact,
      prPackage: mutation.expectedPrPackage,
      testEvidence: expectedTestEvidence as TestEvidence & {
        sourceCommitSha: string
      },
      baseCommitSha: mutation.intent.baseCommitSha,
      expectedCommitSha: mutation.intent.expectedCommitSha,
      deliveryAttempt: mutation.intent.deliveryAttempt,
      now: mutation.intent.createdAt,
    })
    if (JSON.stringify(canonicalIntent) !== JSON.stringify(mutation.intent)) {
      throw new Error('GitHub Delivery Intent is not canonical')
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true

      const existingByDigest = selectGitHubDeliveryIntent(
        this.db,
        'intent_digest',
        mutation.intent.intentDigest,
      )
      if (existingByDigest) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: true, replayed: true, intent: existingByDigest }
      }
      const currentPairing = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default' limit 1",
      )[0]
      const currentRepositoryBinding = selectJson<GitHubRepositoryBinding>(
        this.db,
        'select json from github_repository_bindings where id = ? limit 1',
        [mutation.expectedRepositoryBinding.id],
      )[0]
      const currentProject = selectJson<LocalProject>(
        this.db,
        'select json from local_projects where id = ? limit 1',
        [mutation.expectedProject.id],
      )[0]
      const currentRun = readWorkflowRuns(this.db).find(
        (candidate) => candidate.id === expectedRun.id,
      )
      const currentCodingRun = selectJson<CodingAgentRun>(
        this.db,
        'select json from coding_agent_runs where id = ? limit 1',
        [mutation.expectedCodingRun.id],
      )[0]
      const currentWorkspace = selectJson<ManagedCodingWorkspace>(
        this.db,
        'select json from managed_coding_workspaces where id = ? limit 1',
        [mutation.expectedWorkspace.id],
      )[0]
      const currentDiffArtifact = selectJson<CodingDiffArtifact>(
        this.db,
        'select json from coding_diff_artifacts where id = ? limit 1',
        [mutation.expectedDiffArtifact.id],
      )[0]
      const existingTestEvidence = selectJson<TestEvidence>(
        this.db,
        'select json from test_evidence where id = ? limit 1',
        [expectedTestEvidence.id],
      )[0]
      const currentPrPackage = selectJson<Artifact>(
        this.db,
        'select json from artifacts where id = ? limit 1',
        [mutation.expectedPrPackage.id],
      )[0]
      const sourceIsCurrent =
        JSON.stringify(currentProject) === JSON.stringify(mutation.expectedProject) &&
        JSON.stringify(currentPairing) === JSON.stringify(mutation.expectedPairingCredential) &&
        JSON.stringify(currentRepositoryBinding) === JSON.stringify(mutation.expectedRepositoryBinding) &&
        JSON.stringify(currentRun) === JSON.stringify(expectedRun) &&
        JSON.stringify(currentCodingRun) === JSON.stringify(mutation.expectedCodingRun) &&
        JSON.stringify(currentWorkspace) === JSON.stringify(mutation.expectedWorkspace) &&
        JSON.stringify(currentDiffArtifact) === JSON.stringify(mutation.expectedDiffArtifact) &&
        JSON.stringify(currentPrPackage) === JSON.stringify(mutation.expectedPrPackage)
      if (!sourceIsCurrent) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'source_stale' }
      }
      const activeIntent = selectJson<GitHubDeliveryIntent>(
        this.db,
        `select json from github_delivery_intents
         where run_id = ? and node_id = ? and status in (
           'approval_required', 'approved', 'publishing_branch',
           'branch_published', 'creating_pr', 'recovery_required'
         ) limit 1`,
        [mutation.intent.runId, mutation.intent.nodeId],
      )[0]
      if (activeIntent) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'active_intent_exists' }
      }
      const existingByKey = selectGitHubDeliveryIntent(
        this.db,
        'idempotency_key',
        mutation.intent.idempotencyKey,
      )
      const existingById = selectGitHubDeliveryIntent(
        this.db,
        'id',
        mutation.intent.id,
      )
      if (existingByKey || existingById) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'id_conflict' }
      }
      if (existingTestEvidence) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'id_conflict' }
      }

      writeTestEvidence(this.db, expectedTestEvidence)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'test-evidence-summary',
        localProjectId: expectedTestEvidence.projectId,
        runId: expectedTestEvidence.runId,
        entityId: expectedTestEvidence.id,
        createdAt: expectedTestEvidence.createdAt,
      })
      writeGitHubDeliveryIntent(this.db, mutation.intent)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, intent: mutation.intent }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitGitHubDeliveryReplacement(
    mutation: GitHubDeliveryReplacementMutation,
  ): Promise<GitHubDeliveryReplacementMutationResult> {
    const expectedRun = normalizeWorkflowRunProgress(mutation.expectedRun)
    const expectedTestEvidence = redactTestEvidenceForStorage(
      mutation.testEvidence,
    )
    if (
      mutation.expectedProject.id !== mutation.intent.localProjectId ||
      mutation.expectedProject.id !== expectedRun.projectId ||
      mutation.expectedWorkspace.sourcePath !== mutation.expectedProject.path
    ) {
      throw new Error('GitHub Delivery Intent does not match the Local Project source')
    }
    if (
      mutation.expectedPairingCredential.organizationId !== mutation.intent.organizationId ||
      mutation.expectedPairingCredential.projectId !== mutation.intent.teamProjectId ||
      mutation.expectedPairingCredential.localProjectId !== mutation.intent.localProjectId
    ) {
      throw new Error('GitHub Delivery Intent does not match the Desktop pairing scope')
    }
    if (
      mutation.expectedRepositoryBinding.id !== mutation.intent.repositoryBindingId ||
      mutation.expectedRepositoryBinding.version !== mutation.intent.repositoryBindingVersion ||
      mutation.expectedRepositoryBinding.installationId !== mutation.intent.installationId ||
      mutation.expectedRepositoryBinding.repositoryId !== mutation.intent.repositoryId ||
      mutation.expectedRepositoryBinding.organizationId !== mutation.intent.organizationId ||
      mutation.expectedRepositoryBinding.teamProjectId !== mutation.intent.teamProjectId
    ) {
      throw new Error('GitHub Delivery Intent does not match the repository binding')
    }
    const testCommandSafety = validateTestCommandSafety(
      mutation.expectedProject.testCommand,
    )
    if (
      testCommandSafety.level === 'blocked' ||
      expectedTestEvidence.command !== testCommandSafety.normalizedCommand
    ) {
      throw new Error('GitHub Delivery Test Evidence does not match the safe Project test command')
    }
    if (!expectedTestEvidence.sourceCommitSha) {
      throw new Error('GitHub Delivery Test Evidence must be commit-bound')
    }
    if (
      mutation.intent.id === mutation.expectedIntent.id ||
      mutation.intent.runId !== mutation.expectedIntent.runId ||
      mutation.intent.nodeId !== mutation.expectedIntent.nodeId ||
      Date.parse(mutation.intent.createdAt) <= Date.parse(mutation.expectedIntent.updatedAt)
    ) {
      return { committed: false, reason: 'replacement_invalid' }
    }
    const canonicalIntent = await createGitHubDeliveryIntent({
      id: mutation.intent.id,
      repositoryBinding: mutation.expectedRepositoryBinding,
      run: expectedRun,
      prNodeId: mutation.intent.nodeId,
      codingRun: mutation.expectedCodingRun,
      workspace: mutation.expectedWorkspace,
      diffArtifact: mutation.expectedDiffArtifact,
      prPackage: mutation.expectedPrPackage,
      testEvidence: expectedTestEvidence as TestEvidence & {
        sourceCommitSha: string
      },
      baseCommitSha: mutation.intent.baseCommitSha,
      expectedCommitSha: mutation.intent.expectedCommitSha,
      deliveryAttempt: mutation.intent.deliveryAttempt,
      now: mutation.intent.createdAt,
    })
    if (JSON.stringify(canonicalIntent) !== JSON.stringify(mutation.intent)) {
      throw new Error('GitHub Delivery Intent is not canonical')
    }

    if (mutation.kind === 'revision') {
      if (
        !['approval_required', 'approved'].includes(mutation.expectedIntent.status)
      ) {
        return { committed: false, reason: 'intent_ineligible' }
      }
      if (
        mutation.intent.deliverySeriesKey !== mutation.expectedIntent.deliverySeriesKey ||
        mutation.intent.deliveryAttempt !== mutation.expectedIntent.deliveryAttempt ||
        mutation.intent.idempotencyKey !== mutation.expectedIntent.idempotencyKey ||
        mutation.intent.intentDigest === mutation.expectedIntent.intentDigest
      ) {
        return { committed: false, reason: 'replacement_invalid' }
      }
    } else {
      if (!['failed', 'revoked'].includes(mutation.expectedIntent.status)) {
        return { committed: false, reason: 'intent_ineligible' }
      }
      if (mutation.intent.deliverySeriesKey === mutation.expectedIntent.deliverySeriesKey) {
        if (
          mutation.intent.deliveryAttempt <= mutation.expectedIntent.deliveryAttempt ||
          mutation.intent.idempotencyKey === mutation.expectedIntent.idempotencyKey
        ) {
          return { committed: false, reason: 'replacement_invalid' }
        }
      } else if (mutation.intent.deliveryAttempt !== 1) {
        return { committed: false, reason: 'replacement_invalid' }
      }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true

      const existingByDigest = selectGitHubDeliveryIntent(
        this.db,
        'intent_digest',
        mutation.intent.intentDigest,
      )
      if (existingByDigest) {
        this.db.run('rollback')
        transactionOpen = false
        if (
          existingByDigest.id === mutation.intent.id &&
          JSON.stringify(existingByDigest) === JSON.stringify(mutation.intent)
        ) {
          return { committed: true, replayed: true, intent: existingByDigest }
        }
        return { committed: false, reason: 'id_conflict' }
      }

      const currentExpected = selectGitHubDeliveryIntent(
        this.db,
        'id',
        mutation.expectedIntent.id,
      )
      if (JSON.stringify(currentExpected) !== JSON.stringify(mutation.expectedIntent)) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'intent_stale' }
      }
      const currentPairing = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default' limit 1",
      )[0]
      const currentRepositoryBinding = selectJson<GitHubRepositoryBinding>(
        this.db,
        'select json from github_repository_bindings where id = ? limit 1',
        [mutation.expectedRepositoryBinding.id],
      )[0]
      const currentProject = selectJson<LocalProject>(
        this.db,
        'select json from local_projects where id = ? limit 1',
        [mutation.expectedProject.id],
      )[0]
      const currentRun = readWorkflowRuns(this.db).find(
        (candidate) => candidate.id === expectedRun.id,
      )
      const currentCodingRun = selectJson<CodingAgentRun>(
        this.db,
        'select json from coding_agent_runs where id = ? limit 1',
        [mutation.expectedCodingRun.id],
      )[0]
      const currentWorkspace = selectJson<ManagedCodingWorkspace>(
        this.db,
        'select json from managed_coding_workspaces where id = ? limit 1',
        [mutation.expectedWorkspace.id],
      )[0]
      const currentDiffArtifact = selectJson<CodingDiffArtifact>(
        this.db,
        'select json from coding_diff_artifacts where id = ? limit 1',
        [mutation.expectedDiffArtifact.id],
      )[0]
      const currentPrPackage = selectJson<Artifact>(
        this.db,
        'select json from artifacts where id = ? limit 1',
        [mutation.expectedPrPackage.id],
      )[0]
      if (
        JSON.stringify(currentProject) !== JSON.stringify(mutation.expectedProject) ||
        JSON.stringify(currentPairing) !== JSON.stringify(mutation.expectedPairingCredential) ||
        JSON.stringify(currentRepositoryBinding) !== JSON.stringify(mutation.expectedRepositoryBinding) ||
        JSON.stringify(currentRun) !== JSON.stringify(expectedRun) ||
        JSON.stringify(currentCodingRun) !== JSON.stringify(mutation.expectedCodingRun) ||
        JSON.stringify(currentWorkspace) !== JSON.stringify(mutation.expectedWorkspace) ||
        JSON.stringify(currentDiffArtifact) !== JSON.stringify(mutation.expectedDiffArtifact) ||
        JSON.stringify(currentPrPackage) !== JSON.stringify(mutation.expectedPrPackage)
      ) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'source_stale' }
      }

      const activeIntents = selectJson<GitHubDeliveryIntent>(
        this.db,
        `select json from github_delivery_intents
         where run_id = ? and node_id = ? and status in (
           'approval_required', 'approved', 'publishing_branch',
           'branch_published', 'creating_pr', 'recovery_required'
         ) order by updated_at desc, created_at desc, id desc`,
        [mutation.intent.runId, mutation.intent.nodeId],
      )
      const expectedActiveIds = mutation.kind === 'revision'
        ? [mutation.expectedIntent.id]
        : []
      if (
        activeIntents.length !== expectedActiveIds.length ||
        activeIntents.some((intent, index) => intent.id !== expectedActiveIds[index])
      ) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'active_intent_exists' }
      }

      if (mutation.kind === 'retry' && mutation.intent.deliverySeriesKey === mutation.expectedIntent.deliverySeriesKey) {
        const maximumAttempt = Number(this.db.exec(
          `select max(delivery_attempt) from github_delivery_intents
           where delivery_series_key = ?`,
          [mutation.intent.deliverySeriesKey],
        )[0]?.values[0]?.[0] ?? 0)
        if (mutation.intent.deliveryAttempt !== maximumAttempt + 1) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: 'replacement_invalid' }
        }
      }

      const existingById = selectGitHubDeliveryIntent(this.db, 'id', mutation.intent.id)
      const existingTestEvidence = selectJson<TestEvidence>(
        this.db,
        'select json from test_evidence where id = ? limit 1',
        [expectedTestEvidence.id],
      )[0]
      if (existingById || existingTestEvidence) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'id_conflict' }
      }

      if (mutation.kind === 'revision') {
        const superseded: GitHubDeliveryIntent = {
          ...mutation.expectedIntent,
          status: 'revoked',
          updatedAt: mutation.intent.createdAt,
        }
        this.db.run(
          `update github_delivery_intents
           set status = ?, json = ?, updated_at = ?
           where id = ? and json = ?`,
          [
            superseded.status,
            JSON.stringify(superseded),
            superseded.updatedAt,
            mutation.expectedIntent.id,
            JSON.stringify(mutation.expectedIntent),
          ],
        )
        if (this.db.getRowsModified() !== 1) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: 'intent_stale' }
        }
      }

      writeTestEvidence(this.db, expectedTestEvidence)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'test-evidence-summary',
        localProjectId: expectedTestEvidence.projectId,
        runId: expectedTestEvidence.runId,
        entityId: expectedTestEvidence.id,
        createdAt: expectedTestEvidence.createdAt,
      })
      writeGitHubDeliveryIntent(this.db, mutation.intent)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, intent: mutation.intent }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitGitHubDeliveryIntentStatus(
    mutation: GitHubDeliveryIntentStatusMutation,
  ): Promise<GitHubDeliveryIntentStatusMutationResult> {
    assertGitHubDeliveryIntentStatusMutation(mutation)
    const operatorOutcome = mutation.operatorOutcomeCode === undefined
      ? null
      : createGitHubDeliveryOperatorOutcome(
          mutation.intent,
          mutation.operatorOutcomeCode,
        )
    const current = selectGitHubDeliveryIntent(this.db, 'id', mutation.expectedIntent.id)
    if (!current) {
      return { committed: false, reason: 'intent_not_found' }
    }
    if (JSON.stringify(current) === JSON.stringify(mutation.intent)) {
      return { committed: true, replayed: true, intent: current }
    }
    if (JSON.stringify(current) !== JSON.stringify(mutation.expectedIntent)) {
      return { committed: false, reason: 'source_stale' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update github_delivery_intents
         set status = ?, json = ?, updated_at = ?
         where id = ? and status = ? and updated_at = ?`,
        [
          mutation.intent.status,
          JSON.stringify(mutation.intent),
          mutation.intent.updatedAt,
          mutation.expectedIntent.id,
          mutation.expectedIntent.status,
          mutation.expectedIntent.updatedAt,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'source_stale' }
      }
      if (operatorOutcome) {
        writeGitHubDeliveryOperatorOutcome(this.db, operatorOutcome)
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, intent: mutation.intent }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitGitHubDeliveryIntentCompletion(
    mutation: GitHubDeliveryIntentCompletionMutation,
  ): Promise<GitHubDeliveryIntentCompletionMutationResult> {
    assertGitHubDeliveryIntentCompletionMutation(mutation)
    const current = selectGitHubDeliveryIntent(this.db, 'id', mutation.expectedIntent.id)
    if (!current) {
      return { committed: false, reason: 'intent_not_found' }
    }
    if (JSON.stringify(current) === JSON.stringify(mutation.intent)) {
      return { committed: true, replayed: true, intent: current }
    }
    if (JSON.stringify(current) !== JSON.stringify(mutation.expectedIntent)) {
      return { committed: false, reason: 'source_stale' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update github_delivery_intents
         set status = 'completed', json = ?, updated_at = ?
         where id = ? and status = ? and updated_at = ?`,
        [
          JSON.stringify(mutation.intent),
          mutation.intent.updatedAt,
          mutation.expectedIntent.id,
          mutation.expectedIntent.status,
          mutation.expectedIntent.updatedAt,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'source_stale' }
      }
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, intent: mutation.intent }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async listGitHubDeliveryIntents(runId?: string): Promise<GitHubDeliveryIntent[]> {
    if (runId) {
      return selectJson<GitHubDeliveryIntent>(
        this.db,
        'select json from github_delivery_intents where run_id = ? order by created_at asc, id asc',
        [runId],
      )
    }
    return selectJson<GitHubDeliveryIntent>(
      this.db,
      'select json from github_delivery_intents order by created_at asc, id asc',
    )
  }

  async listGitHubDeliveryOperatorOutcomes(
    intentId?: string,
  ): Promise<GitHubDeliveryOperatorOutcome[]> {
    if (intentId) {
      return selectJson<GitHubDeliveryOperatorOutcome>(
        this.db,
        'select json from github_delivery_operator_outcomes where intent_id = ? limit 1',
        [intentId],
      )
    }
    return selectJson<GitHubDeliveryOperatorOutcome>(
      this.db,
      'select json from github_delivery_operator_outcomes order by recorded_at asc, intent_id asc',
    )
  }

  async listGitHubDeliveryRevocationChecks(
    intentId?: string,
  ): Promise<GitHubDeliveryRevocationCheck[]> {
    if (intentId) {
      return selectJson<GitHubDeliveryRevocationCheck>(
        this.db,
        'select json from github_delivery_revocation_checks where intent_id = ? limit 1',
        [intentId],
      )
    }
    return selectJson<GitHubDeliveryRevocationCheck>(
      this.db,
      'select json from github_delivery_revocation_checks order by checked_at asc, intent_id asc',
    )
  }

  async commitGitHubDeliveryRevocationCheck(
    input: CommitGitHubDeliveryRevocationCheckInput,
  ): Promise<CommitGitHubDeliveryRevocationCheckResult> {
    const { check, expectedIntent, expectedBinding, expectedPairing } = input
    if (
      !isCanonicalGitHubDeliveryRevocationCheck(check) ||
      check.intentId !== expectedIntent.id ||
      check.intentUpdatedAt !== expectedIntent.updatedAt ||
      check.bindingId !== expectedBinding.id ||
      check.bindingVersion !== expectedBinding.version ||
      Date.parse(check.checkedAt) < Date.parse(expectedBinding.updatedAt)
    ) {
      return { committed: false, reason: 'invalid_input' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true

      const currentIntent = selectGitHubDeliveryIntent(this.db, 'id', check.intentId)
      if (!currentIntent) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'intent_not_found' }
      }
      if (JSON.stringify(currentIntent) !== JSON.stringify(expectedIntent)) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'intent_stale' }
      }
      if (currentIntent.status !== 'completed' || !currentIntent.completion) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'intent_ineligible' }
      }

      const currentPairing = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default' limit 1",
      )[0]
      if (!currentPairing) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'pairing_not_found' }
      }
      if (JSON.stringify(currentPairing) !== JSON.stringify(expectedPairing)) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'pairing_stale' }
      }

      const currentBinding = selectJson<GitHubRepositoryBinding>(
        this.db,
        'select json from github_repository_bindings where id = ? limit 1',
        [check.bindingId],
      )[0]
      if (!currentBinding) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'binding_not_found' }
      }
      if (JSON.stringify(currentBinding) !== JSON.stringify(expectedBinding)) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'binding_stale' }
      }
      if (currentBinding.status !== 'revoked') {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'binding_ineligible' }
      }
      if (
        currentBinding.id !== currentIntent.repositoryBindingId ||
        currentBinding.version <= currentIntent.repositoryBindingVersion ||
        currentBinding.organizationId !== currentIntent.organizationId ||
        currentBinding.teamProjectId !== currentIntent.teamProjectId ||
        currentBinding.installationId !== currentIntent.installationId ||
        currentBinding.repositoryId !== currentIntent.repositoryId ||
        currentBinding.repository !== currentIntent.repository ||
        currentBinding.defaultBranch !== currentIntent.baseBranch ||
        currentPairing.organizationId !== currentIntent.organizationId ||
        currentPairing.projectId !== currentIntent.teamProjectId ||
        currentPairing.localProjectId !== currentIntent.localProjectId
      ) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'authority_mismatch' }
      }

      const existing = selectJson<GitHubDeliveryRevocationCheck>(
        this.db,
        'select json from github_delivery_revocation_checks where intent_id = ? limit 1',
        [check.intentId],
      )[0]
      if (existing) {
        this.db.run('rollback')
        transactionOpen = false
        return JSON.stringify(existing) === JSON.stringify(check)
          ? { committed: true, replayed: true, check: existing }
          : { committed: false, reason: 'check_conflict' }
      }

      writeGitHubDeliveryRevocationCheck(this.db, check)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, check }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async stopGitHubDeliveryIntent(
    input: StopGitHubDeliveryIntentInput,
  ): Promise<StopGitHubDeliveryIntentResult> {
    if (
      !isNonEmptyIdentifier(input.intentId) ||
      input.intentId.length > 200 ||
      input.intentId.startsWith('~') ||
      input.intentId.includes('/') ||
      input.intentId.includes('\\') ||
      /[\u0000-\u001f\u007f]/u.test(input.intentId) ||
      !isCanonicalIsoTimestamp(input.expectedUpdatedAt) ||
      !isCanonicalIsoTimestamp(input.updatedAt) ||
      Date.parse(input.updatedAt) <= Date.parse(input.expectedUpdatedAt)
    ) {
      throw new Error('GitHub Delivery Stop CAS input is invalid')
    }

    const current = selectGitHubDeliveryIntent(this.db, 'id', input.intentId)
    if (!current) {
      return { committed: false, reason: 'intent_not_found' }
    }
    const existingOutcome = selectGitHubDeliveryOperatorOutcome(
      this.db,
      current.id,
    )
    if (
      current.status === 'recovery_required' &&
      current.updatedAt === input.updatedAt &&
      existingOutcome?.intentUpdatedAt === current.updatedAt &&
      existingOutcome.recordedAt === current.updatedAt &&
      existingOutcome.outcomeCode === 'operation_cancelled' &&
      existingOutcome.stateVersion === 1 &&
      existingOutcome.redacted === true
    ) {
      return {
        committed: true,
        replayed: true,
        intent: current,
        outcome: existingOutcome,
      }
    }
    if (
      current.status === 'completed' ||
      current.status === 'failed' ||
      current.status === 'revoked' ||
      current.status === 'recovery_required'
    ) {
      return { committed: false, reason: 'intent_terminal' }
    }
    if (current.updatedAt !== input.expectedUpdatedAt) {
      return { committed: false, reason: 'source_stale' }
    }

    const intent: GitHubDeliveryIntent = {
      ...current,
      status: 'recovery_required',
      updatedAt: input.updatedAt,
    }
    const outcome = createGitHubDeliveryOperatorOutcome(
      intent,
      'operation_cancelled',
    )
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      this.db.run(
        `update github_delivery_intents
         set status = 'recovery_required', json = ?, updated_at = ?
         where id = ? and status = ? and updated_at = ?`,
        [
          JSON.stringify(intent),
          intent.updatedAt,
          current.id,
          current.status,
          current.updatedAt,
        ],
      )
      if (this.db.getRowsModified() !== 1) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'source_stale' }
      }
      writeGitHubDeliveryOperatorOutcome(this.db, outcome)
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return { committed: true, replayed: false, intent, outcome }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async commitGitHubRepositoryBindingObservation(
    input: CommitGitHubRepositoryBindingObservationInput,
  ): Promise<CommitGitHubRepositoryBindingObservationResult> {
    if (!isCanonicalBindingObservationInput(input)) {
      return { committed: false, reason: 'invalid_input' }
    }

    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const currentPairing = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default' limit 1",
      )[0]
      if (
        JSON.stringify(currentPairing) !==
        JSON.stringify(input.expectedPairing)
      ) {
        this.db.run('rollback')
        transactionOpen = false
        return { committed: false, reason: 'pairing_scope_mismatch' }
      }

      const existingForProject = selectJson<GitHubRepositoryBinding>(
        this.db,
        'select json from github_repository_bindings where team_project_id = ? order by id asc',
        [input.expectedPairing.projectId],
      )
      let bindingChanged = false
      if (input.binding === null) {
        this.db.run(
          'delete from github_repository_bindings where team_project_id = ?',
          [input.expectedPairing.projectId],
        )
        bindingChanged = existingForProject.length > 0
      } else {
        const existingById = selectJson<GitHubRepositoryBinding>(
          this.db,
          'select json from github_repository_bindings where id = ? limit 1',
          [input.binding.id],
        )[0]
        if (
          existingForProject.length > 1 ||
          existingForProject.some(
            (candidate) =>
              candidate.id !== input.binding!.id ||
              candidate.organizationId !==
                input.expectedPairing.organizationId,
          ) ||
          (existingById !== undefined &&
            (existingById.organizationId !==
              input.expectedPairing.organizationId ||
              existingById.teamProjectId !== input.expectedPairing.projectId))
        ) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: 'binding_conflict' }
        }

        const existing = existingForProject[0]
        if (
          existing &&
          (existing.version > input.binding.version ||
            (existing.version === input.binding.version &&
              JSON.stringify(existing) !== JSON.stringify(input.binding)))
        ) {
          this.db.run('rollback')
          transactionOpen = false
          return { committed: false, reason: 'binding_conflict' }
        }
        bindingChanged =
          !existing || JSON.stringify(existing) !== JSON.stringify(input.binding)
        if (bindingChanged) {
          writeGitHubRepositoryBinding(this.db, input.binding)
        }
      }

      const activeIntents = selectJson<GitHubDeliveryIntent>(
        this.db,
        `select json from github_delivery_intents
         where organization_id = ? and team_project_id = ? and local_project_id = ?
           and status in (
             'approval_required', 'approved', 'publishing_branch',
             'branch_published', 'creating_pr', 'recovery_required'
           )
         order by created_at asc, id asc`,
        [
          input.expectedPairing.organizationId,
          input.expectedPairing.projectId,
          input.expectedPairing.localProjectId!,
        ],
      )
      const intentsToRevoke = activeIntents.filter(
        (intent) =>
          input.binding === null ||
          input.binding.status !== 'active' ||
          intent.repositoryBindingId !== input.binding.id ||
          intent.repositoryBindingVersion !== input.binding.version,
      )
      for (const intent of intentsToRevoke) {
        const authorityObservedAt = input.binding
          ? Date.parse(input.binding.updatedAt)
          : 0
        const revoked: GitHubDeliveryIntent = {
          ...intent,
          status: 'revoked',
          updatedAt: new Date(
            Math.max(
              Date.now(),
              Date.parse(intent.updatedAt) + 1,
              authorityObservedAt,
            ),
          ).toISOString(),
        }
        assertGitHubDeliveryIntentStatusMutation({
          expectedIntent: intent,
          intent: revoked,
        })
        this.db.run(
          `update github_delivery_intents
           set status = 'revoked', json = ?, updated_at = ?
           where id = ? and status = ? and updated_at = ?`,
          [
            JSON.stringify(revoked),
            revoked.updatedAt,
            intent.id,
            intent.status,
            intent.updatedAt,
          ],
        )
        if (this.db.getRowsModified() !== 1) {
          throw new Error('GitHub Delivery authority convergence failed.')
        }
      }

      this.db.run('commit')
      transactionOpen = false
      const replayed = !bindingChanged && intentsToRevoke.length === 0
      if (!replayed) await this.persist()
      return { committed: true, replayed, binding: input.binding }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async saveGitHubRepositoryBinding(
    binding: GitHubRepositoryBinding,
  ): Promise<GitHubRepositoryBinding> {
    const existing = selectJson<GitHubRepositoryBinding>(
      this.db,
      'select json from github_repository_bindings where id = ? limit 1',
      [binding.id],
    )[0]
    if (existing) {
      if (existing.version > binding.version) {
        throw new Error('GitHub repository binding version cannot move backwards')
      }
      if (
        existing.version === binding.version &&
        JSON.stringify(existing) !== JSON.stringify(binding)
      ) {
        throw new Error('GitHub repository binding version conflicts with stored state')
      }
      if (JSON.stringify(existing) === JSON.stringify(binding)) {
        return existing
      }
    }
    writeGitHubRepositoryBinding(this.db, binding)
    await this.persist()
    return binding
  }

  async getGitHubRepositoryBinding(
    teamProjectId: string,
  ): Promise<GitHubRepositoryBinding | null> {
    return selectJson<GitHubRepositoryBinding>(
      this.db,
      `select json from github_repository_bindings
       where team_project_id = ?
       order by case status when 'active' then 0 when 'stale' then 1 else 2 end,
                version desc, updated_at desc
       limit 1`,
      [teamProjectId],
    )[0] ?? null
  }

  async listGitHubRepositoryBindings(): Promise<GitHubRepositoryBinding[]> {
    return selectJson<GitHubRepositoryBinding>(
      this.db,
      'select json from github_repository_bindings order by updated_at asc, id asc',
    )
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    writeArtifact(this.db, artifact)
    await this.persist()
  }

  async listArtifacts(runId?: string): Promise<Artifact[]> {
    if (runId) {
      return selectJson<Artifact>(
        this.db,
        'select json from artifacts where run_id = ? order by updated_at asc',
        [runId],
      )
    }

    return selectJson<Artifact>(this.db, 'select json from artifacts order by updated_at asc')
  }

  async saveEvent(event: AgentEvent): Promise<void> {
    writeAgentEvent(this.db, event)
    await this.persist()
  }

  async listEvents(runId?: string): Promise<AgentEvent[]> {
    if (runId) {
      return selectJson<AgentEvent>(
        this.db,
        'select json from agent_events where run_id = ? order by sequence asc, timestamp asc',
        [runId],
      )
    }

    return selectJson<AgentEvent>(
      this.db,
      'select json from agent_events order by timestamp asc, sequence asc',
    )
  }

  async saveTestEvidence(evidence: TestEvidence): Promise<void> {
    this.db.run('begin transaction')
    try {
      writeTestEvidence(this.db, evidence)
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'test-evidence-summary', localProjectId: evidence.projectId,
        runId: evidence.runId, entityId: evidence.id, createdAt: evidence.createdAt,
      })
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
  }

  async listTestEvidence(runId?: string): Promise<TestEvidence[]> {
    if (runId) {
      return selectJson<TestEvidence>(
        this.db,
        'select json from test_evidence where run_id = ? order by created_at asc',
        [runId],
      )
    }

    return selectJson<TestEvidence>(this.db, 'select json from test_evidence order by created_at asc')
  }

  async saveAgentReview(review: AgentReviewResult): Promise<void> {
    this.db.run('begin transaction')
    try {
      this.db.run(
        `
        insert into agent_reviews (id, run_id, node_id, json, created_at)
        values (?, ?, ?, ?, ?)
        on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
        `,
        [review.id, review.runId, review.nodeId, JSON.stringify(review), review.createdAt],
      )
      this.enqueueCanonicalRemoteSyncOperation({
        kind: 'agent-review-summary', localProjectId: review.projectId,
        runId: review.runId, entityId: review.id, createdAt: review.createdAt,
      })
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
  }

  async listAgentReviews(runId?: string): Promise<AgentReviewResult[]> {
    if (runId) {
      return selectJson<AgentReviewResult>(
        this.db,
        'select json from agent_reviews where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<AgentReviewResult>(
      this.db,
      'select json from agent_reviews order by created_at desc',
    )
  }

  async saveAgentTrace(trace: AgentTrace): Promise<void> {
    this.db.run(
      `
      insert into agent_traces (id, run_id, node_id, review_id, json, created_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [trace.id, trace.runId, trace.nodeId, trace.reviewId, JSON.stringify(trace), trace.createdAt],
    )
    await this.persist()
  }

  async listAgentTraces(runId?: string): Promise<AgentTrace[]> {
    if (runId) {
      return selectJson<AgentTrace>(
        this.db,
        'select json from agent_traces where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<AgentTrace>(
      this.db,
      'select json from agent_traces order by created_at desc',
    )
  }

  async saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void> {
    this.db.run(
      `
      insert into agent_token_usage (id, run_id, node_id, json, timestamp)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, timestamp = excluded.timestamp
      `,
      [usage.id, usage.runId, usage.nodeId, JSON.stringify(usage), usage.timestamp],
    )
    await this.persist()
  }

  async listAgentTokenUsage(runId?: string): Promise<AgentTokenUsage[]> {
    if (runId) {
      return selectJson<AgentTokenUsage>(
        this.db,
        'select json from agent_token_usage where run_id = ? order by timestamp desc',
        [runId],
      )
    }

    return selectJson<AgentTokenUsage>(
      this.db,
      'select json from agent_token_usage order by timestamp desc',
    )
  }

  async saveCodingAgentRun(run: CodingAgentRun): Promise<void> {
    this.db.run('begin transaction')
    try {
      writeCodingAgentRun(this.db, run)
      if (!isActiveCodingAgentRunStatus(run.status)) {
        this.enqueueCanonicalRemoteSyncOperation({
          kind: 'coding-agent-summary', localProjectId: run.projectId,
          runId: run.runId, entityId: run.id,
          createdAt: run.completedAt ?? run.startedAt,
        })
      }
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
  }

  async reserveCodingAgentRun(run: CodingAgentRun): Promise<ReserveCodingAgentRunResult> {
    if (!isActiveCodingAgentRunStatus(run.status)) {
      throw new Error('Coding Agent reservation requires an active run status')
    }
    const existingRuns = selectJson<CodingAgentRun>(
      this.db,
      'select json from coding_agent_runs order by updated_at desc, started_at desc',
    )
    const sameId = existingRuns.find((candidate) => candidate.id === run.id)
    if (sameId) {
      return { reserved: false, reason: 'run_id_exists', run: sameId }
    }
    const active = existingRuns.find(
      (candidate) => candidate.projectId === run.projectId && isActiveCodingAgentRunStatus(candidate.status),
    )
    if (active) {
      return { reserved: false, reason: 'active_run_exists', run: active }
    }
    writeCodingAgentRun(this.db, run)
    await this.persist()
    return { reserved: true, run }
  }

  async commitCodingAgentMutation(
    mutation: CodingAgentMutation,
  ): Promise<CodingAgentMutationResult> {
    const [currentRun] = selectJson<CodingAgentRun>(
      this.db,
      'select json from coding_agent_runs where id = ?',
      [mutation.expectedRun.id],
    )
    if (!currentRun) {
      return { committed: false, reason: 'run_not_found', run: null }
    }
    if (JSON.stringify(currentRun) !== JSON.stringify(mutation.expectedRun)) {
      return { committed: false, reason: 'stale_run', run: currentRun }
    }
    if (mutation.run && mutation.run.id !== currentRun.id) {
      throw new Error('Coding Agent mutation cannot change the run identity')
    }
    if (
      mutation.run &&
      !isActiveCodingAgentRunStatus(currentRun.status) &&
      JSON.stringify(mutation.run) !== JSON.stringify(currentRun)
    ) {
      return { committed: false, reason: 'terminal_run', run: currentRun }
    }
    if (
      mutation.run &&
      (
        mutation.run.runId !== currentRun.runId ||
        mutation.run.nodeId !== currentRun.nodeId ||
        mutation.run.projectId !== currentRun.projectId
      )
    ) {
      throw new Error('Coding Agent mutation cannot change the run authority scope')
    }

    const expectedPendingIds = [...mutation.expectedPendingPermissionRequestIds].sort()
    const currentPendingIds = selectJson<CodingPermissionRequest>(
      this.db,
      'select json from coding_permission_requests where coding_run_id = ?',
      [currentRun.id],
    )
      .filter((request) => request.status === 'pending')
      .map((request) => request.id)
      .sort()
    if (JSON.stringify(currentPendingIds) !== JSON.stringify(expectedPendingIds)) {
      return { committed: false, reason: 'stale_permission_set', run: currentRun }
    }

    const expectedRequestsById = new Map(
      (mutation.expectedPermissionRequests ?? []).map((request) => [request.id, request]),
    )
    for (const expectedRequest of expectedRequestsById.values()) {
      if (expectedRequest.codingRunId !== currentRun.id) {
        throw new Error('Coding Agent mutation permission request belongs to another run')
      }
      const [currentRequest] = selectJson<CodingPermissionRequest>(
        this.db,
        'select json from coding_permission_requests where id = ?',
        [expectedRequest.id],
      )
      if (!currentRequest || JSON.stringify(currentRequest) !== JSON.stringify(expectedRequest)) {
        return { committed: false, reason: 'stale_permission_request', run: currentRun }
      }
    }

    const nextRun = mutation.run ?? currentRun
    const decisionsByRequestId = new Map<string, CodingPermissionDecision>()
    for (const decision of mutation.permissionDecisions ?? []) {
      if (decisionsByRequestId.has(decision.requestId)) {
        throw new Error('Coding Agent mutation cannot record duplicate permission decisions')
      }
      decisionsByRequestId.set(decision.requestId, decision)
    }
    for (const request of mutation.permissionRequests ?? []) {
      if (
        request.codingRunId !== currentRun.id ||
        request.runId !== currentRun.runId ||
        request.nodeId !== currentRun.nodeId
      ) {
        throw new Error('Coding Agent mutation permission request belongs to another run')
      }
      const [existingRequest] = selectJson<CodingPermissionRequest>(
        this.db,
        'select json from coding_permission_requests where id = ?',
        [request.id],
      )
      const expectedRequest = expectedRequestsById.get(request.id)
      if (!expectedRequest) {
        if (existingRequest) {
          return { committed: false, reason: 'stale_permission_request', run: currentRun }
        }
        if (request.status !== 'pending' || decisionsByRequestId.has(request.id)) {
          throw new Error('New Coding Agent permission requests must be pending and undecided')
        }
      } else if (
        !existingRequest ||
        existingRequest.status !== 'pending' ||
        request.status === 'pending' ||
        request.codingRunId !== expectedRequest.codingRunId ||
        request.runId !== expectedRequest.runId ||
        request.nodeId !== expectedRequest.nodeId
      ) {
        return { committed: false, reason: 'stale_permission_request', run: currentRun }
      } else if (decisionsByRequestId.get(request.id)?.decision !== request.status) {
        throw new Error('Settled Coding Agent permission requests require one matching decision')
      }
    }
    const mutatedRequestIds = new Set((mutation.permissionRequests ?? []).map((request) => request.id))
    for (const decision of mutation.permissionDecisions ?? []) {
      if (decision.codingRunId !== currentRun.id || !mutatedRequestIds.has(decision.requestId)) {
        throw new Error('Coding Agent mutation permission decision belongs to another run')
      }
    }
    for (const event of mutation.events ?? []) {
      if (
        event.codingRunId !== currentRun.id ||
        event.runId !== currentRun.runId ||
        event.nodeId !== currentRun.nodeId
      ) {
        throw new Error('Coding Agent mutation event belongs to another run')
      }
    }
    for (const artifact of mutation.diffArtifacts ?? []) {
      if (
        artifact.runId !== currentRun.runId ||
        artifact.nodeId !== currentRun.nodeId ||
        artifact.projectId !== currentRun.projectId
      ) {
        throw new Error('Coding Agent mutation diff belongs to another workflow run or node')
      }
    }

    this.db.run('begin transaction')
    try {
      if (mutation.run) {
        writeCodingAgentRun(this.db, mutation.run)
        if (
          isActiveCodingAgentRunStatus(currentRun.status) &&
          !isActiveCodingAgentRunStatus(mutation.run.status)
        ) {
          this.enqueueCanonicalRemoteSyncOperation({
            kind: 'coding-agent-summary', localProjectId: mutation.run.projectId,
            runId: mutation.run.runId, entityId: mutation.run.id,
            createdAt: mutation.run.completedAt ?? mutation.run.startedAt,
          })
        }
      }
      for (const event of mutation.events ?? []) {
        writeCodingAgentEvent(this.db, event)
      }
      for (const request of mutation.permissionRequests ?? []) {
        writeCodingPermissionRequest(this.db, request)
      }
      for (const decision of mutation.permissionDecisions ?? []) {
        writeCodingPermissionDecision(this.db, decision)
      }
      for (const artifact of mutation.diffArtifacts ?? []) {
        writeCodingDiffArtifact(this.db, artifact)
      }
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    await this.persist()
    return { committed: true, run: nextRun }
  }

  async listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]> {
    if (runId) {
      return selectJson<CodingAgentRun>(
        this.db,
        'select json from coding_agent_runs where run_id = ? order by updated_at desc, started_at desc',
        [runId],
      )
    }

    return selectJson<CodingAgentRun>(
      this.db,
      'select json from coding_agent_runs order by updated_at desc, started_at desc',
    )
  }

  async saveCodingAgentEvent(event: CodingAgentEvent): Promise<void> {
    writeCodingAgentEvent(this.db, event)
    await this.persist()
  }

  async listCodingAgentEvents(codingRunId?: string): Promise<CodingAgentEvent[]> {
    if (codingRunId) {
      return selectJson<CodingAgentEvent>(
        this.db,
        'select json from coding_agent_events where coding_run_id = ? order by sequence asc, timestamp asc',
        [codingRunId],
      )
    }

    return selectJson<CodingAgentEvent>(
      this.db,
      'select json from coding_agent_events order by timestamp asc, sequence asc',
    )
  }

  async saveCodingPermissionRequest(request: CodingPermissionRequest): Promise<void> {
    writeCodingPermissionRequest(this.db, request)
    await this.persist()
  }

  async listCodingPermissionRequests(codingRunId?: string): Promise<CodingPermissionRequest[]> {
    if (codingRunId) {
      return selectJson<CodingPermissionRequest>(
        this.db,
        'select json from coding_permission_requests where coding_run_id = ? order by requested_at asc',
        [codingRunId],
      )
    }

    return selectJson<CodingPermissionRequest>(
      this.db,
      'select json from coding_permission_requests order by requested_at asc',
    )
  }

  async saveCodingPermissionDecision(decision: CodingPermissionDecision): Promise<void> {
    writeCodingPermissionDecision(this.db, decision)
    await this.persist()
  }

  async listCodingPermissionDecisions(codingRunId?: string): Promise<CodingPermissionDecision[]> {
    if (codingRunId) {
      return selectJson<CodingPermissionDecision>(
        this.db,
        'select json from coding_permission_decisions where coding_run_id = ? order by decided_at asc',
        [codingRunId],
      )
    }

    return selectJson<CodingPermissionDecision>(
      this.db,
      'select json from coding_permission_decisions order by decided_at asc',
    )
  }

  async saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace): Promise<void> {
    this.db.run(
      `
      insert into managed_coding_workspaces (id, project_id, coding_run_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json
      `,
      [
        workspace.id,
        workspace.projectId,
        workspace.codingRunId,
        JSON.stringify(workspace),
        workspace.createdAt,
      ],
    )
    await this.persist()
  }

  async commitManagedCodingWorkspaceHead(
    mutation: ManagedCodingWorkspaceHeadMutation,
  ): Promise<ManagedCodingWorkspaceHeadMutationResult> {
    const expected = mutation.expectedWorkspace
    const workspace = mutation.workspace
    const immutableFields = [
      'id',
      'projectId',
      'codingRunId',
      'sourcePath',
      'worktreePath',
      'branchName',
      'baseBranch',
      'createdAt',
      'deletedAt',
      'cleanupStatus',
      'cleanupError',
    ] as const
    if (
      expected.cleanupStatus !== 'active' ||
      expected.deletedAt ||
      workspace.cleanupStatus !== 'active' ||
      workspace.deletedAt ||
      immutableFields.some((field) => expected[field] !== workspace[field])
    ) {
      throw new Error('Only an unchanged active managed workspace can record a delivery commit')
    }
    const baseCommitSha = assertFullGitCommitSha(
      workspace.baseCommitSha ?? '',
      'Managed workspace base commit',
    )
    const headCommitSha = assertFullGitCommitSha(
      workspace.headCommitSha ?? '',
      'Managed workspace head commit',
    )
    if (
      baseCommitSha === headCommitSha ||
      expected.baseCommitSha === undefined ||
      workspace.baseCommitSha !== baseCommitSha ||
      workspace.headCommitSha !== headCommitSha ||
      expected.baseCommitSha !== baseCommitSha ||
      (expected.headCommitSha !== undefined && expected.headCommitSha !== headCommitSha)
    ) {
      throw new Error('Managed workspace delivery commit is not canonical')
    }

    const current = selectJson<ManagedCodingWorkspace>(
      this.db,
      'select json from managed_coding_workspaces where id = ? limit 1',
      [expected.id],
    )[0]
    if (JSON.stringify(current) === JSON.stringify(workspace)) {
      return { committed: true, replayed: true, workspace }
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      return { committed: false, reason: 'source_stale' }
    }

    const snapshot = this.db.export()
    try {
      this.db.run(
        'update managed_coding_workspaces set json = ? where id = ?',
        [JSON.stringify(workspace), workspace.id],
      )
      await this.persist()
      return { committed: true, replayed: false, workspace }
    } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  async commitManagedCodingWorkspaceCleanup(
    mutation: ManagedCodingWorkspaceCleanupMutation,
  ): Promise<ManagedCodingWorkspaceCleanupMutationResult> {
    const expected = mutation.expectedWorkspace
    const workspace = mutation.workspace
    const immutableFields = [
      'id',
      'projectId',
      'codingRunId',
      'sourcePath',
      'worktreePath',
      'branchName',
      'baseBranch',
      'baseCommitSha',
      'headCommitSha',
      'createdAt',
    ] as const
    if (
      expected.cleanupStatus === 'deleted' ||
      workspace.cleanupStatus === 'active' ||
      !workspace.deletedAt ||
      !Number.isFinite(Date.parse(workspace.deletedAt)) ||
      immutableFields.some((field) => expected[field] !== workspace[field]) ||
      (workspace.cleanupStatus === 'deleted' && workspace.cleanupError !== undefined) ||
      (workspace.cleanupStatus === 'cleanup_failed' && !workspace.cleanupError?.trim())
    ) {
      throw new Error('Managed workspace cleanup transition is invalid')
    }

    const current = selectJson<ManagedCodingWorkspace>(
      this.db,
      'select json from managed_coding_workspaces where id = ? limit 1',
      [expected.id],
    )[0]
    if (JSON.stringify(current) === JSON.stringify(workspace)) {
      return { committed: true, replayed: true, workspace }
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      return { committed: false, reason: 'source_stale' }
    }
    const hasDeliveryIntent = selectStringColumn(
      this.db,
      `select id from github_delivery_intents
       where workspace_id = ? and status not in ('completed', 'failed', 'revoked')
       limit 1`,
      [expected.id],
    ).length > 0
    if (hasDeliveryIntent) {
      return { committed: false, reason: 'delivery_intent_exists' }
    }

    const snapshot = this.db.export()
    try {
      this.db.run(
        'update managed_coding_workspaces set json = ? where id = ?',
        [JSON.stringify(workspace), workspace.id],
      )
      await this.persist()
      return { committed: true, replayed: false, workspace }
    } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  async listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]> {
    if (projectId) {
      return selectJson<ManagedCodingWorkspace>(
        this.db,
        'select json from managed_coding_workspaces where project_id = ? order by created_at desc',
        [projectId],
      )
    }

    return selectJson<ManagedCodingWorkspace>(
      this.db,
      'select json from managed_coding_workspaces order by created_at desc',
    )
  }

  async saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence): Promise<void> {
    this.db.run(
      `
      insert into dependency_bootstrap_evidence (id, coding_run_id, run_id, node_id, project_id, json, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [
        evidence.id,
        evidence.codingRunId,
        evidence.runId,
        evidence.nodeId,
        evidence.projectId,
        JSON.stringify(evidence),
        evidence.createdAt,
      ],
    )
    await this.persist()
  }

  async listDependencyBootstrapEvidence(codingRunId?: string): Promise<DependencyBootstrapEvidence[]> {
    if (codingRunId) {
      return selectJson<DependencyBootstrapEvidence>(
        this.db,
        'select json from dependency_bootstrap_evidence where coding_run_id = ? order by created_at asc',
        [codingRunId],
      )
    }

    return selectJson<DependencyBootstrapEvidence>(
      this.db,
      'select json from dependency_bootstrap_evidence order by created_at asc',
    )
  }

  async saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void> {
    writeCodingDiffArtifact(this.db, artifact)
    await this.persist()
  }

  async listCodingDiffArtifacts(runId?: string): Promise<CodingDiffArtifact[]> {
    if (runId) {
      return selectJson<CodingDiffArtifact>(
        this.db,
        'select json from coding_diff_artifacts where run_id = ? order by created_at asc',
        [runId],
      )
    }

    return selectJson<CodingDiffArtifact>(
      this.db,
      'select json from coding_diff_artifacts order by created_at asc',
    )
  }

  async saveProviderCredential(
    metadata: ProviderCredentialMetadata,
    encryptedSecret: string,
  ): Promise<ProviderCredentialMetadata> {
    this.db.run(
      `
      insert into provider_credentials (provider_id, json, encrypted_secret, updated_at)
      values (?, ?, ?, ?)
      on conflict(provider_id) do update set
        json = excluded.json,
        encrypted_secret = excluded.encrypted_secret,
        updated_at = excluded.updated_at
      `,
      [
        metadata.providerId,
        JSON.stringify(metadata),
        encryptedSecret,
        metadata.updatedAt,
      ],
    )
    await this.persist()
    return metadata
  }

  async listProviderCredentials(): Promise<ProviderCredentialMetadata[]> {
    return selectJson<ProviderCredentialMetadata>(
      this.db,
      'select json from provider_credentials order by updated_at desc',
    )
  }

  async getProviderEncryptedSecret(providerId: string): Promise<string | null> {
    const result = this.db.exec(
      'select encrypted_secret from provider_credentials where provider_id = ?',
      [providerId],
    )
    const value = result[0]?.values[0]?.[0]
    return typeof value === 'string' ? value : null
  }

  async saveDesktopPairingCredential(
    credential: DesktopPairingCredential,
    encryptedToken: string,
  ): Promise<DesktopPairingCredential> {
    const snapshot = this.db.export()
    let transactionOpen = false
    try {
      this.db.run('begin transaction')
      transactionOpen = true
      const current = selectJson<DesktopPairingCredential>(
        this.db,
        "select json from desktop_pairing_credentials where id = 'default' limit 1",
      )[0]
      if (current && JSON.stringify(current) !== JSON.stringify(credential)) {
        const activeIntents = selectJson<GitHubDeliveryIntent>(
          this.db,
          `select json from github_delivery_intents
           where status in (
             'approval_required', 'approved', 'publishing_branch',
             'branch_published', 'creating_pr', 'recovery_required'
           )
           order by created_at asc, id asc`,
        )
        for (const intent of activeIntents) {
          const revokedAt = new Date(
            Math.max(
              Date.parse(credential.createdAt),
              Date.parse(intent.updatedAt) + 1,
            ),
          ).toISOString()
          const revoked: GitHubDeliveryIntent = {
            ...intent,
            status: 'revoked',
            updatedAt: revokedAt,
          }
          assertGitHubDeliveryIntentStatusMutation({
            expectedIntent: intent,
            intent: revoked,
          })
          this.db.run(
            `update github_delivery_intents
             set status = 'revoked', json = ?, updated_at = ?
             where id = ? and status = ? and updated_at = ?`,
            [
              JSON.stringify(revoked),
              revoked.updatedAt,
              intent.id,
              intent.status,
              intent.updatedAt,
            ],
          )
          if (this.db.getRowsModified() !== 1) {
            throw new Error('Desktop pairing authority convergence failed.')
          }
        }
      }
      this.db.run(
        `
        insert into desktop_pairing_credentials (id, json, encrypted_token, updated_at)
        values (?, ?, ?, ?)
        on conflict(id) do update set
          json = excluded.json,
          encrypted_token = excluded.encrypted_token,
          updated_at = excluded.updated_at
        `,
        [
          'default',
          JSON.stringify(credential),
          encryptedToken,
          credential.createdAt,
        ],
      )
      this.db.run('commit')
      transactionOpen = false
      await this.persist()
      return credential
    } catch (error) {
      if (transactionOpen) {
        try {
          this.db.run('rollback')
        } catch {
          // The exported snapshot remains authoritative.
        }
      }
      this.restore(snapshot)
      throw error
    }
  }

  async getDesktopPairingCredential(): Promise<DesktopPairingCredential | null> {
    const [credential] = selectJson<DesktopPairingCredential>(
      this.db,
      "select json from desktop_pairing_credentials where id = 'default'",
    )
    return credential ?? null
  }

  async getDesktopPairingEncryptedToken(): Promise<string | null> {
    const result = this.db.exec(
      "select encrypted_token from desktop_pairing_credentials where id = 'default'",
    )
    const value = result[0]?.values[0]?.[0]
    return typeof value === 'string' ? value : null
  }

  async getDesktopPairingCredentialBundle(): Promise<{
    credential: DesktopPairingCredential
    encryptedToken: string
  } | null> {
    const result = this.db.exec(
      "select json, encrypted_token from desktop_pairing_credentials where id = 'default'",
    )
    const row = result[0]?.values[0]
    const json = row?.[0]
    const encryptedToken = row?.[1]
    if (
      typeof json !== 'string' ||
      typeof encryptedToken !== 'string' ||
      encryptedToken.length === 0
    ) {
      return null
    }
    return {
      credential: JSON.parse(json) as DesktopPairingCredential,
      encryptedToken,
    }
  }

  async savePolicySnapshot(snapshot: PolicySnapshot): Promise<PolicySnapshot> {
    this.db.run(
      `
      insert into policy_snapshots (project_id, json, synced_at)
      values (?, ?, ?)
      on conflict(project_id) do update set json = excluded.json, synced_at = excluded.synced_at
      `,
      [snapshot.projectId, JSON.stringify(snapshot), snapshot.syncedAt],
    )
    await this.persist()
    return snapshot
  }

  async getPolicySnapshot(projectId: string): Promise<PolicySnapshot | null> {
    const [snapshot] = selectJson<PolicySnapshot>(
      this.db,
      'select json from policy_snapshots where project_id = ?',
      [projectId],
    )

    return snapshot ?? null
  }

  async saveGateOverride(decision: GateOverrideDecision): Promise<GateOverrideDecision> {
    this.db.run(
      `
      insert into gate_overrides (id, run_id, node_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [decision.id, decision.runId, decision.nodeId, JSON.stringify(decision), decision.createdAt],
    )
    await this.persist()
    return decision
  }

  async listGateOverrides(runId?: string): Promise<GateOverrideDecision[]> {
    if (runId) {
      return selectJson<GateOverrideDecision>(
        this.db,
        'select json from gate_overrides where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<GateOverrideDecision>(
      this.db,
      'select json from gate_overrides order by created_at desc',
    )
  }

  async saveRetryAttempt(attempt: RetryAttempt): Promise<RetryAttempt> {
    this.db.run(
      `
      insert into retry_attempts (id, run_id, node_id, json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(id) do update set json = excluded.json, created_at = excluded.created_at
      `,
      [attempt.id, attempt.runId, attempt.nodeId, JSON.stringify(attempt), attempt.createdAt],
    )
    await this.persist()
    return attempt
  }

  async listRetryAttempts(runId?: string): Promise<RetryAttempt[]> {
    if (runId) {
      return selectJson<RetryAttempt>(
        this.db,
        'select json from retry_attempts where run_id = ? order by created_at desc',
        [runId],
      )
    }

    return selectJson<RetryAttempt>(
      this.db,
      'select json from retry_attempts order by created_at desc',
    )
  }

  async saveSettings(settings: Partial<LocalSettings>): Promise<LocalSettings> {
    const updated: LocalSettings = {
      ...(await this.getSettings()),
      ...settings,
    }
    this.db.run(
      `
      insert into local_settings (key, json, updated_at)
      values ('settings', ?, ?)
      on conflict(key) do update set json = excluded.json, updated_at = excluded.updated_at
      `,
      [JSON.stringify(updated), new Date().toISOString()],
    )
    await this.persist()
    return updated
  }

  async getSettings(): Promise<LocalSettings> {
    const [settings] = selectJson<LocalSettings>(
      this.db,
      "select json from local_settings where key = 'settings'",
    )
    return settings ?? DEFAULT_LOCAL_SETTINGS
  }

  async commitLocalMcpInstallation({
    expectedInstallation,
    installation,
  }: {
    expectedInstallation: LocalMcpInstallation | null
    installation: LocalMcpInstallation
  }): Promise<CommitLocalMcpInstallationResult> {
    let next: LocalMcpInstallation
    let expected: LocalMcpInstallation | null
    try {
      next = parseLocalMcpInstallation(installation)
      expected = expectedInstallation === null
        ? null
        : parseLocalMcpInstallation(expectedInstallation)
    } catch {
      return { committed: false, reason: 'invalid_installation' }
    }

    const serialized = JSON.stringify(next)
    if (expected === null) {
      if (next.version !== 1 || next.createdAt !== next.updatedAt) {
        return { committed: false, reason: 'invalid_installation' }
      }
      this.db.run(
        `
        insert into local_mcp_installations (
          id, version, enabled, transport, executable_sha256,
          state_version, json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do nothing
        `,
        [
          next.id,
          next.version,
          next.enabled ? 1 : 0,
          next.transport,
          next.executableSha256,
          next.stateVersion,
          serialized,
          next.createdAt,
          next.updatedAt,
        ],
      )
    } else {
      if (
        next.id !== expected.id ||
        next.version !== expected.version + 1 ||
        next.createdAt !== expected.createdAt ||
        next.updatedAt <= expected.updatedAt
      ) {
        return { committed: false, reason: 'invalid_installation' }
      }
      this.db.run(
        `
        update local_mcp_installations
        set version = ?, enabled = ?, transport = ?, executable_sha256 = ?,
            state_version = ?, json = ?, updated_at = ?
        where id = ? and version = ? and json = ?
        `,
        [
          next.version,
          next.enabled ? 1 : 0,
          next.transport,
          next.executableSha256,
          next.stateVersion,
          serialized,
          next.updatedAt,
          expected.id,
          expected.version,
          JSON.stringify(expected),
        ],
      )
    }

    if (this.db.getRowsModified() !== 1) {
      return { committed: false, reason: 'version_conflict' }
    }
    await this.persist()
    return { committed: true, installation: next }
  }

  async getLocalMcpInstallation(installationId: string): Promise<LocalMcpInstallation | null> {
    if (!isNonEmptyIdentifier(installationId) || installationId.length > 200) {
      throw new Error('Invalid Local MCP installation id')
    }
    const [value] = selectJson<unknown>(
      this.db,
      'select json from local_mcp_installations where id = ?',
      [installationId],
    )
    return value === undefined ? null : parseLocalMcpInstallation(value)
  }

  async deleteLocalMcpInstallation(
    expectedInstallation: LocalMcpInstallation,
  ): Promise<DeleteLocalMcpInstallationResult> {
    let expected: LocalMcpInstallation
    try {
      expected = parseLocalMcpInstallation(expectedInstallation)
    } catch {
      return { deleted: false, reason: 'invalid_installation' }
    }
    this.db.run(
      'delete from local_mcp_installations where id = ? and version = ? and json = ?',
      [expected.id, expected.version, JSON.stringify(expected)],
    )
    if (this.db.getRowsModified() !== 1) {
      return { deleted: false, reason: 'version_conflict' }
    }
    await this.persist()
    return { deleted: true }
  }

  async listLocalMcpInstallations(): Promise<LocalMcpInstallation[]> {
    return selectJson<unknown>(
      this.db,
      'select json from local_mcp_installations order by id asc',
    ).map(parseLocalMcpInstallation)
  }

  async saveMcpServers(servers: McpServerDefinition[]): Promise<McpServerDefinition[]> {
    this.db.run('delete from mcp_servers')
    const updatedAt = new Date().toISOString()
    for (const server of servers) {
      this.db.run(
        `
        insert into mcp_servers (id, json, updated_at)
        values (?, ?, ?)
        `,
        [server.id, JSON.stringify(server), updatedAt],
      )
    }
    await this.persist()
    return servers
  }

  async listMcpServers(): Promise<McpServerDefinition[]> {
    return selectJson<McpServerDefinition>(
      this.db,
      "select json from mcp_servers order by json_extract(json, '$.name') asc, id asc",
    )
  }

  async getSchemaVersion(): Promise<number> {
    return readSchemaVersion(this.db)
  }

  async loadState(): Promise<LocalExecutionState> {
    const [
      remoteSyncOperations,
      projects,
      runs,
      artifacts,
      events,
      testEvidence,
      agentReviews,
      agentTraces,
      agentTokenUsage,
      codingRuns,
      codingEvents,
      codingPermissionRequests,
      codingPermissionDecisions,
      managedCodingWorkspaces,
      dependencyBootstrapEvidence,
      codingDiffArtifacts,
      githubRepositoryBindings,
      githubDeliveryIntents,
      githubDeliveryOperatorOutcomes,
      githubDeliveryRevocationChecks,
      retryAttempts,
      desktopPairingCredential,
      settings,
      mcpServers,
    ] = await Promise.all([
      this.listRemoteSyncOperations(),
      this.listProjects(),
      this.listRuns(),
      this.listArtifacts(),
      this.listEvents(),
      this.listTestEvidence(),
      this.listAgentReviews(),
      this.listAgentTraces(),
      this.listAgentTokenUsage(),
      this.listCodingAgentRuns(),
      this.listCodingAgentEvents(),
      this.listCodingPermissionRequests(),
      this.listCodingPermissionDecisions(),
      this.listManagedCodingWorkspaces(),
      this.listDependencyBootstrapEvidence(),
      this.listCodingDiffArtifacts(),
      this.listGitHubRepositoryBindings(),
      this.listGitHubDeliveryIntents(),
      this.listGitHubDeliveryOperatorOutcomes(),
      this.listGitHubDeliveryRevocationChecks(),
      this.listRetryAttempts(),
      this.getDesktopPairingCredential(),
      this.getSettings(),
      this.listMcpServers(),
    ])

    return {
      remoteSyncOperations,
      projects,
      runs,
      artifacts,
      events,
      testEvidence,
      agentReviews,
      agentTraces,
      agentTokenUsage,
      codingRuns,
      codingEvents,
      codingPermissionRequests,
      codingPermissionDecisions,
      managedCodingWorkspaces,
      dependencyBootstrapEvidence,
      codingDiffArtifacts,
      githubRepositoryBindings,
      githubDeliveryIntents,
      githubDeliveryOperatorOutcomes,
      githubDeliveryRevocationChecks,
      retryAttempts,
      desktopPairingCredential,
      settings,
      mcpServers,
    }
  }

  close(): void {
    this.db.close()
  }

  async runDurableMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const snapshot = this.db.export()
    try {
      return await mutation()
    } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  private restore(snapshot: Uint8Array): void {
    this.db.close()
    this.db = new this.sql.Database(snapshot)
  }

  private async persist(): Promise<void> {
    const snapshot = this.db.export()
    const persistence = this.persistenceQueue.then(() =>
      persistDatabaseSnapshot(snapshot, this.dbPath),
    )
    this.persistenceQueue = persistence.catch(() => undefined)
    await persistence
  }
}

const MUTATING_LOCAL_STORE_METHODS = new Set<keyof LocalStore>([
  'upsertProject',
  'activateKnowledgeIndexSnapshot',
  'rebuildKnowledgeIndexSnapshot',
  'saveAgentMemoryCandidate',
  'commitAgentMemoryPromotion',
  'commitAgentMemoryRevision',
  'commitAgentMemoryDeletion',
  'purgeAgentMemoryDerivedState',
  'retrieveAgentMemoryRevisions',
  'saveRun',
  'deleteRun',
  'enqueueRemoteSyncOperation',
  'claimNextRemoteSyncOperation',
  'bindRemoteSyncOperationScope',
  'settleRemoteSyncOperation',
  'retryRemoteSyncOperation',
  'recoverInterruptedRemoteSyncOperations',
  'commitAgentRuntimeTransition',
  'createCoordinationSession',
  'commitSpecialistRuntimeStart',
  'commitSpecialistRuntimeCompletion',
  'commitSpecialistRuntimeRecovery',
  'commitCoordinationSessionCancellation',
  'acquireCoordinationResourceLease',
  'settleCoordinationResourceLease',
  'commitCoordinationTaskStart',
  'commitCoordinationTaskResult',
  'commitCoordinationHandoff',
  'reserveAgentRuntimeCapabilityGrant',
  'beginAgentRuntimeToolExecution',
  'appendAgentRuntimeToolAudit',
  'createWorkflow',
  'materializeClaimedWorkRequest',
  'markWorkRequestMaterializationAcknowledged',
  'recordGateCommandReceiptObservation',
  'commitGateCommandExecution',
  'recordGateCommandAcknowledgement',
  'terminalizeGateCommandAcknowledgement',
  'commitWorkflowMutation',
  'commitGitHubDeliveryPreparation',
  'commitGitHubDeliveryReplacement',
  'commitGitHubDeliveryIntentStatus',
  'commitGitHubDeliveryIntentCompletion',
  'commitGitHubDeliveryRevocationCheck',
  'stopGitHubDeliveryIntent',
  'commitGitHubRepositoryBindingObservation',
  'saveGitHubRepositoryBinding',
  'saveArtifact',
  'saveEvent',
  'saveTestEvidence',
  'saveAgentReview',
  'saveAgentTrace',
  'saveAgentTokenUsage',
  'saveCodingAgentRun',
  'reserveCodingAgentRun',
  'commitCodingAgentMutation',
  'saveCodingAgentEvent',
  'saveCodingPermissionRequest',
  'saveCodingPermissionDecision',
  'saveManagedCodingWorkspace',
  'commitManagedCodingWorkspaceHead',
  'commitManagedCodingWorkspaceCleanup',
  'saveDependencyBootstrapEvidence',
  'saveCodingDiffArtifact',
  'saveProviderCredential',
  'saveDesktopPairingCredential',
  'savePolicySnapshot',
  'saveGateOverride',
  'saveRetryAttempt',
  'saveSettings',
  'saveMcpServers',
])

function serializeLocalStoreMutations(store: SqlJsLocalStore): LocalStore {
  let mutationQueue: Promise<void> = Promise.resolve()

  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      if (!MUTATING_LOCAL_STORE_METHODS.has(property as keyof LocalStore)) {
        return value.bind(target)
      }

      return (...args: unknown[]) => {
        const invocation = mutationQueue.then(() =>
          target.runDurableMutation(async () => await Reflect.apply(value, target, args)),
        )
        mutationQueue = invocation.then(
          () => undefined,
          () => undefined,
        )
        return invocation
      }
    },
  }) as unknown as LocalStore
}

export async function createLocalStore(options: LocalStoreOptions): Promise<LocalStore> {
  const SQL = await loadSql()

  try {
    const db = existsSync(options.dbPath)
      ? new SQL.Database(await readFile(options.dbPath))
      : new SQL.Database()

    migrateSchema(db)
    await persistDatabase(db, options.dbPath)

    return serializeLocalStoreMutations(new SqlJsLocalStore(SQL, db, options.dbPath))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `DevFlow local database is unreadable at ${options.dbPath}. Back up or remove this file to rebuild local state. Cause: ${message}`,
    )
  }
}

async function persistDatabase(db: Database, dbPath: string): Promise<void> {
  return persistDatabaseSnapshot(db.export(), dbPath)
}

async function persistDatabaseSnapshot(
  snapshot: Uint8Array,
  dbPath: string,
): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true })
  const temporaryPath = `${dbPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, Buffer.from(snapshot))
    await rename(temporaryPath, dbPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
