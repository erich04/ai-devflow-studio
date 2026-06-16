import type {
  AgentEvent,
  CommandSafetyResult,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  McpServerDefinition,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'

export const ipcChannels = {
  loadState: 'devflow:local-state:load',
  selectProject: 'devflow:local-project:select',
  saveProjectTestCommand: 'devflow:local-project:save-test-command',
  validateTestCommand: 'devflow:local-project:validate-test-command',
  runProjectTests: 'devflow:local-tests:run',
  createRun: 'devflow:run:create',
  saveRun: 'devflow:run:save',
  saveEvent: 'devflow:event:save',
  saveSettings: 'devflow:settings:save',
  saveMcpServers: 'devflow:mcp-servers:save',
  loadRemoteSnapshot: 'devflow:remote:snapshot:load',
  uploadRunSummary: 'devflow:remote:run-summary:upload',
  uploadTestEvidenceSummary: 'devflow:remote:test-evidence-summary:upload',
} as const

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const raw = value[key]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Invalid ${key}`)
  }

  return raw.trim()
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['title'] === 'string' &&
    Array.isArray(value['nodes']) &&
    Array.isArray(value['edges'])
  )
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['sequence'] === 'number' &&
    typeof value['kind'] === 'string' &&
    typeof value['message'] === 'string' &&
    typeof value['timestamp'] === 'string'
  )
}

function isThemePreference(value: unknown): value is LocalSettings['themePreference'] {
  return value === 'light' || value === 'dark' || value === 'system'
}

function isMcpServer(value: unknown): value is McpServerDefinition {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['command'] === 'string' &&
    (value['permission'] === 'read' ||
      value['permission'] === 'write' ||
      value['permission'] === 'network' ||
      value['permission'] === 'shell') &&
    typeof value['enabledLocally'] === 'boolean' &&
    typeof value['lastAuditEvent'] === 'string'
  )
}

function hasLocalOnlyEvidenceField(value: Record<string, unknown>): boolean {
  return 'cwd' in value || 'stdout' in value || 'stderr' in value
}

function isRemoteRunSummary(value: unknown): value is RemoteRunSummary {
  return (
    isRecord(value) &&
    (value['kind'] === 'run' || value['kind'] === 'approval' || value['kind'] === 'event') &&
    typeof value['runId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['status'] === 'string' &&
    typeof value['currentNodeId'] === 'string' &&
    typeof value['branchName'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  )
}

function isRemoteTestEvidenceStatus(value: unknown): value is RemoteTestEvidenceSummary['status'] {
  return value === 'running' || value === 'passed' || value === 'failed' || value === 'timed_out'
}

function isRemoteTestEvidenceSummary(value: unknown): value is RemoteTestEvidenceSummary {
  return (
    isRecord(value) &&
    !hasLocalOnlyEvidenceField(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['command'] === 'string' &&
    isRemoteTestEvidenceStatus(value['status']) &&
    (typeof value['exitCode'] === 'number' || value['exitCode'] === null) &&
    typeof value['durationMs'] === 'number' &&
    typeof value['summary'] === 'string' &&
    typeof value['redacted'] === 'boolean' &&
    typeof value['createdAt'] === 'string'
  )
}

export function parseSaveProjectTestCommandInput(value: unknown): SaveProjectTestCommandInput {
  if (!isRecord(value)) {
    throw new Error('Invalid save project test command payload')
  }

  return {
    projectId: readRequiredString(value, 'projectId'),
    testCommand: readRequiredString(value, 'testCommand'),
  }
}

export function parseValidateTestCommandInput(value: unknown): ValidateTestCommandInput {
  return parseSaveProjectTestCommandInput(value)
}

export function parseRunProjectTestsInput(value: unknown): RunProjectTestsInput {
  if (!isRecord(value)) {
    throw new Error('Invalid run project tests payload')
  }

  const projectId = readRequiredString(value, 'projectId')
  const runId = readRequiredString(value, 'runId')
  const nodeId = readRequiredString(value, 'nodeId')
  const run = value['run']

  if (!isWorkflowRun(run)) {
    throw new Error('Invalid run')
  }

  if (run.id !== runId) {
    throw new Error('Invalid runId: payload does not match run snapshot')
  }

  return { projectId, runId, nodeId, run }
}

export function parseSaveRunInput(value: unknown): WorkflowRun {
  if (!isWorkflowRun(value)) {
    throw new Error('Invalid run')
  }

  return value
}

export function parseAgentEventInput(value: unknown): AgentEvent {
  if (!isAgentEvent(value)) {
    throw new Error('Invalid event')
  }

  return value
}

export function parseSettingsInput(value: unknown): Partial<LocalSettings> {
  if (!isRecord(value)) {
    throw new Error('Invalid settings payload')
  }

  const themePreference = value['themePreference']
  if (themePreference !== undefined && !isThemePreference(themePreference)) {
    throw new Error('Invalid themePreference')
  }

  return {
    ...(themePreference ? { themePreference } : {}),
  }
}

export function parseMcpServersInput(value: unknown): McpServerDefinition[] {
  if (!Array.isArray(value) || !value.every(isMcpServer)) {
    throw new Error('Invalid MCP servers payload')
  }

  return value
}

export function parseRemoteSnapshotInput(value: unknown): LoadRemoteSnapshotInput {
  if (value === undefined || value === null) {
    return {}
  }

  if (!isRecord(value)) {
    throw new Error('Invalid remote snapshot payload')
  }

  const organizationId = value['organizationId']
  if (organizationId !== undefined && (typeof organizationId !== 'string' || !organizationId.trim())) {
    throw new Error('Invalid organizationId')
  }

  return organizationId ? { organizationId: organizationId.trim() } : {}
}

export function parseRemoteRunSummaryInput(value: unknown): RemoteRunSummary {
  if (!isRemoteRunSummary(value)) {
    throw new Error('Invalid remote run summary payload')
  }

  return value
}

export function parseRemoteTestEvidenceSummaryInput(value: unknown): RemoteTestEvidenceSummary {
  if (isRecord(value) && hasLocalOnlyEvidenceField(value)) {
    throw new Error('Remote test evidence summary contains local-only fields')
  }

  if (!isRemoteTestEvidenceSummary(value)) {
    throw new Error('Invalid remote test evidence summary payload')
  }

  return value
}
