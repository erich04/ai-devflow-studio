import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewResult,
  AgentReviewExecutionResult,
  Artifact,
  CommandSafetyResult,
  CodingAgentRun,
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
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  RetryAttempt,
  Role,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { CreateRunInput, DeleteRunInput, DeleteRunResult } from '../electron/ipc-contract'

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
  run: WorkflowRun
}

export type RunProjectTestsResult = {
  evidence: TestEvidence
  state: LocalExecutionState
}

export type ApproveGateInput = {
  runId: string
  nodeId: string
  userId: string
  userName: string
  role: Role
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
  projectId: string
  userId: string
  role: Role
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
  provisional?: boolean
}

export type AgentProviderCredentialInput = {
  providerId: string
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
}

export type RunKnowledgeReviewResult = AgentReviewExecutionResult & {
  state: LocalExecutionState
}

export type RunCodingAgentInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
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
  providerId: string
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
  uploadRunSummary: (summary: RemoteRunSummary) => Promise<RemoteSyncUploadResult>
  uploadTestEvidenceSummary: (
    summary: RemoteTestEvidenceSummary,
  ) => Promise<RemoteSyncUploadResult>
  uploadCodingAgentSummary: (summary: RemoteCodingAgentSummary) => Promise<RemoteSyncUploadResult>
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
  completeWorkflowAgentNode: (input: CompleteWorkflowAgentNodeInput) => Promise<CompleteWorkflowAgentNodeResult>
  saveRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveArtifact: (artifact: Artifact) => Promise<Artifact>
  approveGate: (input: ApproveGateInput) => Promise<ApproveGateResult>
  saveGateOverride: (input: SaveGateOverrideInput) => Promise<GateOverrideDecision>
  listGateOverrides: (input?: { runId?: string }) => Promise<GateOverrideDecision[]>
  saveEvent: (event: AgentEvent) => Promise<AgentEvent>
  saveSettings: (settings: Partial<LocalSettings>) => Promise<LocalSettings>
  saveMcpServers: (servers: McpServerDefinition[]) => Promise<McpServerDefinition[]>
  listAgentProviders: () => Promise<AgentProviderConfig[]>
  saveAgentProviderCredential: (input: AgentProviderCredentialInput) => Promise<ProviderCredentialMetadata>
  runKnowledgeReview: (input: RunKnowledgeReviewInput) => Promise<RunKnowledgeReviewResult>
  listAgentReviews: (input?: { runId?: string }) => Promise<AgentReviewResult[]>
  ensureCodingEngine: (input: { projectId: string }) => Promise<{ projectId: string; engine: CodingAgentRun['engine']; status: 'ready' }>
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
  onProjectGitStatusUpdated: (listener: (status: ProjectGitStatus) => void) => () => void
}

declare global {
  interface Window {
    aiDevFlowDesktop?: DevFlowDesktopApi
  }
}

export function getDesktopApi(): DevFlowDesktopApi | null {
  return window.aiDevFlowDesktop ?? null
}
