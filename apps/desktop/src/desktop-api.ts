import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewResult,
  AgentReviewExecutionResult,
  Artifact,
  CommandSafetyResult,
  CodingAgentRun,
  CodingChangeSetPreview,
  CodingRuntimeConfiguration,
  CodingRuntimeReadiness,
  CodingAgentEvent,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DesktopPairingCredential,
  GateEnforcementDecision,
  GateOverrideDecision,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  ManagedCodingWorkspace,
  McpServerDefinition,
  PolicySnapshot,
  ProjectGitStatus,
  ProviderCredentialMetadata,
  RepositoryKnowledgeSnapshot,
  RemoteTeamSnapshot,
  RetryAttempt,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
  TestEvidence,
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'
import type {
  AgentRuntimeCommandInput,
  AgentRuntimeListItem,
  AgentRuntimeSnapshot,
  AgentMemoryLifecycleSnapshot,
  GetAgentRuntimeInput,
  GetCoordinationSessionInput,
  CoordinationSessionSnapshot,
  ResumeCoordinationSessionInput,
  StartCoordinationTaskInput,
  CancelCoordinationSessionInput,
  DeleteAgentMemoryInput,
  ListAgentMemoryLifecycleInput,
  PromoteAgentMemoryCandidateInput,
  ReviseAgentMemoryInput,
  ListAgentRuntimesInput,
  ListCoordinationSessionsInput,
  CreateRunInput,
  DeleteRunInput,
  DeleteRunResult,
  ListWorkRequestsInput,
  LoadRepositoryKnowledgeInput,
  MaterializeWorkRequestInput,
  MaterializeWorkRequestResult,
  PrepareGitHubDeliveryInput,
  PrepareGitHubDeliveryResult,
  RefreshRepositoryKnowledgeInput,
  ReviseGitHubDeliveryInput,
  ReviseGitHubDeliveryResult,
  ResumeGitHubDeliveryInput,
  ResumeGitHubDeliveryResult,
  RetryGitHubDeliveryInput,
  RetryGitHubDeliveryResult,
  StopGitHubDeliveryInput,
  StopGitHubDeliveryResult,
  StartAgentRuntimeInput,
  StartCoordinationPlanInput,
  VerifyGitHubDeliveryRevocationInput,
  VerifyGitHubDeliveryRevocationResult,
  RetryRemoteSyncOperationInput,
} from '../electron/ipc-contract'

export type SaveProjectTestCommandInput = {
  projectId: string
  testCommand: string
}

export type ProjectGitStatusInput = {
  projectId: string
}

export type ValidateTestCommandInput = SaveProjectTestCommandInput

export type RunProjectTestsInput = {
  projectId: string
  runId: string
  nodeId: string
}

export type RunProjectTestsResult = {
  evidence: TestEvidence
  state: LocalExecutionState
}

export type ApproveGateInput = {
  runId: string
  nodeId: string
}

export type ApproveGateResult = {
  run: WorkflowRun
  event: AgentEvent
  state: LocalExecutionState
}

export type CompleteWorkflowAgentNodeInput = {
  runId: string
  nodeId: string
  userId: string
  userName: string
  providerId?: string
}

export type CompleteWorkflowAgentNodeResult = {
  run: WorkflowRun
  artifact: Artifact
  event: AgentEvent
  state: LocalExecutionState
}

export type CreatePrDraftInput = {
  runId: string
  nodeId: string
}

export type CreatePrDraftResult = {
  run: WorkflowRun
  artifact: Artifact
  event: AgentEvent
  state: LocalExecutionState
}

export type CreateAcceptanceBundleInput = {
  runId: string
  nodeId: string
}

export type CreateAcceptanceBundleResult = CreatePrDraftResult

export type LoadEnforcementPolicyInput = {
  projectId: string
}

export type EvaluateGateEnforcementInput = {
  runId: string
  nodeId: string
  projectId: string
}

export type SaveGateOverrideInput = {
  runId: string
  nodeId: string
  reason: string
}

export type AgentProviderCredentialInput = {
  name?: string
  /** @deprecated Compatibility only. New providers receive a generated ID in Electron main. */
  providerId?: string
  apiKey: string
  model: string
  baseUrl?: string
}

export type RunKnowledgeReviewInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  runtime: 'electron' | 'api'
  providerId?: string
  runtimeBudgetApprovalId?: string
}

export type RunKnowledgeReviewResult = AgentReviewExecutionResult & {
  state: LocalExecutionState
}

export type RunCodingAgentInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  userInstruction: string
  runtimeBudgetApprovalId?: string
}

export type RunCodingAgentResult = {
  codingRun: CodingAgentRun
  state: LocalExecutionState
}

export type StartRetryAttemptInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  candidateIds: string[]
  userInstruction: string
}

export type StartRetryAttemptResult = RunCodingAgentResult & {
  retryAttempt: RetryAttempt
}

export type LoadRemoteSnapshotInput = {
  organizationId?: string
}

export type PairDesktopInput = {
  code: string
  localProjectId: string
}

export type PairDesktopResult = {
  credential: DesktopPairingCredential
}

export type DevFlowDesktopApi = {
  platform: string
  loadState: () => Promise<LocalExecutionState>
  loadDesktopPairing: () => Promise<DesktopPairingCredential | null>
  pairDesktop: (input: PairDesktopInput) => Promise<PairDesktopResult>
  loadRemoteSnapshot: (input?: LoadRemoteSnapshotInput) => Promise<RemoteTeamSnapshot>
  listWorkRequests: (input: ListWorkRequestsInput) => Promise<WorkRequest[]>
  materializeWorkRequest: (
    input: MaterializeWorkRequestInput,
  ) => Promise<MaterializeWorkRequestResult>
  loadRepositoryKnowledge: (
    input: LoadRepositoryKnowledgeInput,
  ) => Promise<RepositoryKnowledgeSnapshot>
  refreshRepositoryKnowledge: (
    input: RefreshRepositoryKnowledgeInput,
  ) => Promise<RepositoryKnowledgeSnapshot>
  retryRemoteSyncOperation: (
    input: RetryRemoteSyncOperationInput,
  ) => Promise<LocalExecutionState>
  selectLocalProject: () => Promise<LocalProject | null>
  getProjectGitStatus: (input: ProjectGitStatusInput) => Promise<ProjectGitStatus>
  watchProjectGitStatus: (input: ProjectGitStatusInput) => Promise<ProjectGitStatus>
  unwatchProjectGitStatus: (input: ProjectGitStatusInput) => Promise<void>
  saveProjectTestCommand: (input: SaveProjectTestCommandInput) => Promise<LocalProject>
  validateTestCommand: (input: ValidateTestCommandInput) => Promise<CommandSafetyResult>
  runProjectTests: (input: RunProjectTestsInput) => Promise<RunProjectTestsResult>
  loadEnforcementPolicy: (input: LoadEnforcementPolicyInput) => Promise<PolicySnapshot>
  evaluateGateEnforcement: (input: EvaluateGateEnforcementInput) => Promise<GateEnforcementDecision>
  createRun: (input: CreateRunInput) => Promise<WorkflowRun>
  deleteRun: (input: DeleteRunInput) => Promise<DeleteRunResult>
  startAgentRuntime: (input: StartAgentRuntimeInput) => Promise<AgentRuntimeSnapshot>
  advanceAgentRuntime: (input: AgentRuntimeCommandInput) => Promise<AgentRuntimeSnapshot>
  cancelAgentRuntime: (input: AgentRuntimeCommandInput) => Promise<AgentRuntimeSnapshot>
  listAgentRuntimes: (input: ListAgentRuntimesInput) => Promise<AgentRuntimeListItem[]>
  getAgentRuntime: (input: GetAgentRuntimeInput) => Promise<AgentRuntimeSnapshot>
  listCoordinationSessions: (
    input: ListCoordinationSessionsInput,
  ) => Promise<CoordinationSessionSnapshot[]>
  getCoordinationSession: (
    input: GetCoordinationSessionInput,
  ) => Promise<CoordinationSessionSnapshot>
  startCoordinationPlan: (
    input: StartCoordinationPlanInput,
  ) => Promise<CoordinationSessionSnapshot>
  resumeCoordinationSession: (
    input: ResumeCoordinationSessionInput,
  ) => Promise<CoordinationSessionSnapshot>
  startCoordinationTask: (
    input: StartCoordinationTaskInput,
  ) => Promise<CoordinationSessionSnapshot>
  cancelCoordinationSession: (
    input: CancelCoordinationSessionInput,
  ) => Promise<CoordinationSessionSnapshot>
  listAgentMemoryLifecycle: (
    input: ListAgentMemoryLifecycleInput,
  ) => Promise<AgentMemoryLifecycleSnapshot>
  promoteAgentMemoryCandidate: (
    input: PromoteAgentMemoryCandidateInput,
  ) => Promise<AgentMemoryLifecycleSnapshot>
  reviseAgentMemory: (
    input: ReviseAgentMemoryInput,
  ) => Promise<AgentMemoryLifecycleSnapshot>
  deleteAgentMemory: (
    input: DeleteAgentMemoryInput,
  ) => Promise<AgentMemoryLifecycleSnapshot>
  completeWorkflowAgentNode: (input: CompleteWorkflowAgentNodeInput) => Promise<CompleteWorkflowAgentNodeResult>
  createPrDraft: (input: CreatePrDraftInput) => Promise<CreatePrDraftResult>
  prepareGitHubDelivery: (
    input: PrepareGitHubDeliveryInput,
  ) => Promise<PrepareGitHubDeliveryResult>
  reviseGitHubDelivery: (
    input: ReviseGitHubDeliveryInput,
  ) => Promise<ReviseGitHubDeliveryResult>
  retryGitHubDelivery: (
    input: RetryGitHubDeliveryInput,
  ) => Promise<RetryGitHubDeliveryResult>
  resumeGitHubDelivery: (
    input: ResumeGitHubDeliveryInput,
  ) => Promise<ResumeGitHubDeliveryResult>
  stopGitHubDelivery: (
    input: StopGitHubDeliveryInput,
  ) => Promise<StopGitHubDeliveryResult>
  verifyGitHubDeliveryRevocation: (
    input: VerifyGitHubDeliveryRevocationInput,
  ) => Promise<VerifyGitHubDeliveryRevocationResult>
  createAcceptanceBundle: (
    input: CreateAcceptanceBundleInput,
  ) => Promise<CreateAcceptanceBundleResult>
  approveGate: (input: ApproveGateInput) => Promise<ApproveGateResult>
  saveGateOverride: (input: SaveGateOverrideInput) => Promise<GateOverrideDecision>
  listGateOverrides: (input?: { runId?: string }) => Promise<GateOverrideDecision[]>
  saveSettings: (settings: Partial<LocalSettings>) => Promise<LocalSettings>
  saveMcpServers: (servers: McpServerDefinition[]) => Promise<McpServerDefinition[]>
  listAgentProviders: () => Promise<AgentProviderConfig[]>
  saveAgentProviderCredential: (input: AgentProviderCredentialInput) => Promise<ProviderCredentialMetadata>
  runKnowledgeReview: (input: RunKnowledgeReviewInput) => Promise<RunKnowledgeReviewResult>
  listAgentReviews: (input?: { runId?: string }) => Promise<AgentReviewResult[]>
  ensureCodingEngine: (input: { projectId: string }) => Promise<{ projectId: string; engine: CodingAgentRun['engine']; status: 'ready' }>
  getCodingRuntimeConfiguration: (input: {
    projectId: string
  }) => Promise<CodingRuntimeConfiguration | null>
  saveCodingRuntimeConfiguration: (input: {
    projectId: string
    executor: 'native-model'
    providerId: string
  }) => Promise<CodingRuntimeConfiguration>
  getCodingRuntimeReadiness: (input: {
    runId: string
    nodeId: string
    projectId: string
    requestedBy: string
    runtimeBudgetApprovalId?: string
  }) => Promise<CodingRuntimeReadiness>
  getCodingChangeSetPreview: (input: {
    changeSetId: string
    codingRunId: string
  }) => Promise<CodingChangeSetPreview>
  getCodingRuntimeBudgetPolicy: (input: {
    projectId: string
  }) => Promise<RuntimeBudgetPolicy | null>
  saveCodingRuntimeBudgetPolicy: (input: {
    projectId: string
    enabled: boolean
    monthlyLimitUsd: number
    warningThresholdUsd: number
  }) => Promise<RuntimeBudgetPolicy>
  createCodingRuntimeBudgetApproval: (input: {
    projectId: string
    requestedBy: string
    maxAdditionalCostUsd: number
    reason: string
  }) => Promise<RuntimeBudgetApproval>
  runCodingAgent: (input: RunCodingAgentInput) => Promise<RunCodingAgentResult>
  startRetryAttempt: (input: StartRetryAttemptInput) => Promise<StartRetryAttemptResult>
  cancelCodingAgentRun: (input: { codingRunId: string }) => Promise<CodingAgentRun>
  replyCodingPermission: (input: {
    requestId: string
    codingRunId: string
    decidedBy: string
    decision: CodingPermissionDecision['decision']
    comment: string
  }) => Promise<CodingPermissionRequest>
  subscribeCodingRun: (input: { codingRunId: string }) => Promise<LocalExecutionState>
  listCodingAgentRuns: (input?: { runId?: string }) => Promise<CodingAgentRun[]>
  openManagedWorktree: (input: { workspaceId: string }) => Promise<ManagedCodingWorkspace>
  deleteManagedWorktree: (input: { workspaceId: string }) => Promise<ManagedCodingWorkspace>
  onCodingRunStatusUpdated: (listener: (run: CodingAgentRun) => void) => () => void
  onCodingEventAppended: (listener: (event: CodingAgentEvent) => void) => () => void
  onCodingPermissionUpdated: (listener: (request: CodingPermissionRequest) => void) => () => void
  onAgentRuntimeUpdated: (listener: (snapshot: AgentRuntimeSnapshot) => void) => () => void
  onProjectGitStatusUpdated: (listener: (status: ProjectGitStatus) => void) => () => void
  onLocalStateUpdated: (listener: (state: LocalExecutionState) => void) => () => void
}

declare global {
  interface Window {
    aiDevFlowDesktop?: DevFlowDesktopApi
  }
}

export function getDesktopApi(): DevFlowDesktopApi | null {
  return window.aiDevFlowDesktop ?? null
}
