import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewResult,
  AgentReviewExecutionResult,
  CommandSafetyResult,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  McpServerDefinition,
  ProviderCredentialMetadata,
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
}

declare global {
  interface Window {
    aiDevFlowDesktop?: DevFlowDesktopApi
  }
}

export function getDesktopApi(): DevFlowDesktopApi | null {
  return window.aiDevFlowDesktop ?? null
}
