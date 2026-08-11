import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import {
  applyWorkflowCommand,
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  canApproveGateNow,
  createGitHubDeliveryCompletion,
  createGitHubDeliveryIntent,
  createRemoteSyncIdempotencyKey,
  createRemoteSyncOperation,
  createWorkflowRunFromRequest,
  isActiveCodingAgentRunStatus,
  normalizeGitHubRepository,
  REMOTE_SYNC_CLAIM_LEASE_MS,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  normalizeWorkflowRunProgress,
  parseWorkRequestRecord,
  redactCodingAgentEventForStorage,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  validateTestCommandSafety,
  sanitizeRemoteSyncErrorMessage,
  parseGateCommandRecord,
  parseGateCommandAcknowledgementRecord,
  parseGateCommandReceiptRecord,
  type AgentEvent,
  type AgentReviewResult,
  type AgentTrace,
  type AgentTokenUsage,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type DesktopPairingCredential,
  type LocalExecutionState,
  type LocalProject,
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
} from '@ai-devflow/shared'
export const CURRENT_SCHEMA_VERSION = 15
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

export type LocalStore = {
  upsertProject(project: LocalProject): Promise<void>
  listProjects(): Promise<LocalProject[]>
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
      check (kind in ('run-summary', 'test-evidence-summary', 'agent-review-summary', 'coding-agent-summary')),
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

  constructor(
    private readonly sql: SqlJsStatic,
    private db: Database,
    private readonly dbPath: string,
  ) {}

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
  'saveRun',
  'deleteRun',
  'enqueueRemoteSyncOperation',
  'claimNextRemoteSyncOperation',
  'bindRemoteSyncOperationScope',
  'settleRemoteSyncOperation',
  'retryRemoteSyncOperation',
  'recoverInterruptedRemoteSyncOperations',
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
