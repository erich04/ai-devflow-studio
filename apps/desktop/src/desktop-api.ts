import type {
  AgentEvent,
  CommandSafetyResult,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  McpServerDefinition,
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

export type DevFlowDesktopApi = {
  platform: string
  loadState: () => Promise<LocalExecutionState>
  selectLocalProject: () => Promise<LocalProject | null>
  saveProjectTestCommand: (input: SaveProjectTestCommandInput) => Promise<LocalProject>
  validateTestCommand: (input: ValidateTestCommandInput) => Promise<CommandSafetyResult>
  runProjectTests: (input: RunProjectTestsInput) => Promise<RunProjectTestsResult>
  createRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveEvent: (event: AgentEvent) => Promise<AgentEvent>
  saveSettings: (settings: Partial<LocalSettings>) => Promise<LocalSettings>
  saveMcpServers: (servers: McpServerDefinition[]) => Promise<McpServerDefinition[]>
}

declare global {
  interface Window {
    aiDevFlowDesktop?: DevFlowDesktopApi
  }
}

export function getDesktopApi(): DevFlowDesktopApi | null {
  return window.aiDevFlowDesktop ?? null
}
