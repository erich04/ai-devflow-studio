import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewResult,
  AgentReviewExecutionResult,
  CommandSafetyResult,
  CodingAgentRun,
  CodingAgentEvent,
  CodingPermissionDecision,
  CodingPermissionRequest,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  ManagedCodingWorkspace,
  McpServerDefinition,
  ProviderCredentialMetadata,
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'

export type SaveProjectTestCommandInput = {
  projectId: string
  testCommand: string
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
}

export type RunCodingAgentResult = {
  codingRun: CodingAgentRun
  state: LocalExecutionState
}

export type LoadRemoteSnapshotInput = {
  organizationId?: string
}

export type DevFlowDesktopApi = {
  platform: string
  loadState: () => Promise<LocalExecutionState>
  loadRemoteSnapshot: (input?: LoadRemoteSnapshotInput) => Promise<RemoteTeamSnapshot>
  uploadRunSummary: (summary: RemoteRunSummary) => Promise<RemoteSyncUploadResult>
  uploadTestEvidenceSummary: (
    summary: RemoteTestEvidenceSummary,
  ) => Promise<RemoteSyncUploadResult>
  uploadCodingAgentSummary: (summary: RemoteCodingAgentSummary) => Promise<RemoteSyncUploadResult>
  selectLocalProject: () => Promise<LocalProject | null>
  saveProjectTestCommand: (input: SaveProjectTestCommandInput) => Promise<LocalProject>
  validateTestCommand: (input: ValidateTestCommandInput) => Promise<CommandSafetyResult>
  runProjectTests: (input: RunProjectTestsInput) => Promise<RunProjectTestsResult>
  createRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveEvent: (event: AgentEvent) => Promise<AgentEvent>
  saveSettings: (settings: Partial<LocalSettings>) => Promise<LocalSettings>
  saveMcpServers: (servers: McpServerDefinition[]) => Promise<McpServerDefinition[]>
  listAgentProviders: () => Promise<AgentProviderConfig[]>
  saveAgentProviderCredential: (input: AgentProviderCredentialInput) => Promise<ProviderCredentialMetadata>
  runKnowledgeReview: (input: RunKnowledgeReviewInput) => Promise<RunKnowledgeReviewResult>
  listAgentReviews: (input?: { runId?: string }) => Promise<AgentReviewResult[]>
  ensureCodingEngine: (input: { projectId: string }) => Promise<{ projectId: string; engine: CodingAgentRun['engine']; status: 'ready' }>
  runCodingAgent: (input: RunCodingAgentInput) => Promise<RunCodingAgentResult>
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
}

declare global {
  interface Window {
    aiDevFlowDesktop?: DevFlowDesktopApi
  }
}

export function getDesktopApi(): DevFlowDesktopApi | null {
  return window.aiDevFlowDesktop ?? null
}
