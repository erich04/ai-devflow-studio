import { WORK_REQUEST_ID_MAX_LENGTH } from '@ai-devflow/shared'
import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewExecutionResult,
  Artifact,
  CommandSafetyResult,
  CodingAgentEvent,
  CodingAgentRun,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DesktopPairingCredential,
  GateEnforcementDecision,
  GateOverrideDecision,
  GitHubDeliveryIntent,
  LocalExecutionState,
  LocalSettings,
  LocalProject,
  ManagedCodingWorkspace,
  McpServerDefinition,
  PolicySnapshot,
  ProjectGitStatus,
  ProviderCredentialMetadata,
  RepositoryKnowledgeSnapshot,
  RemoteRunDeleteResult,
  RemoteTeamSnapshot,
  RetryAttempt,
  TestEvidence,
  AgentReviewRuntime,
  WorkRequest,
  WorkflowRun,
} from '@ai-devflow/shared'

export type CreateRunInput = {
  title: string
  request: string
  projectId: string
  creatorId: string
  branchName: string
}

export type DeleteRunInput = {
  runId: string
  deleteRemote: boolean
}

export type DeleteRunResult = {
  state: LocalExecutionState
  remote?: RemoteRunDeleteResult
}

export type RetryRemoteSyncOperationInput = {
  operationId: string
}

export type LoadRepositoryKnowledgeInput = {
  projectId: string
}

export type RefreshRepositoryKnowledgeInput = LoadRepositoryKnowledgeInput

export const ipcChannels = {
  loadState: 'devflow:local-state:load',
  selectProject: 'devflow:local-project:select',
  getProjectGitStatus: 'devflow:local-project:git-status:get',
  watchProjectGitStatus: 'devflow:local-project:git-status:watch',
  unwatchProjectGitStatus: 'devflow:local-project:git-status:unwatch',
  saveProjectTestCommand: 'devflow:local-project:save-test-command',
  validateTestCommand: 'devflow:local-project:validate-test-command',
  runProjectTests: 'devflow:local-tests:run',
  loadEnforcementPolicy: 'devflow:enforcement:policy:load',
  evaluateGateEnforcement: 'devflow:enforcement:gate:evaluate',
  createRun: 'devflow:run:create',
  deleteRun: 'devflow:run:delete',
  completeWorkflowAgentNode: 'devflow:workflow-agent-node:complete',
  createPrDraft: 'devflow:pr-draft:create',
  prepareGitHubDelivery: 'devflow:github-delivery:prepare',
  createAcceptanceBundle: 'devflow:acceptance-bundle:create',
  approveGate: 'devflow:gate:approve',
  saveGateOverride: 'devflow:gate:override:save',
  listGateOverrides: 'devflow:gate:overrides:list',
  saveSettings: 'devflow:settings:save',
  saveMcpServers: 'devflow:mcp-servers:save',
  loadRemoteSnapshot: 'devflow:remote:snapshot:load',
  listWorkRequests: 'devflow:work-requests:list',
  materializeWorkRequest: 'devflow:work-requests:materialize',
  retryRemoteSyncOperation: 'devflow:remote-sync:operation:retry',
  loadRepositoryKnowledge: 'devflow:repository-knowledge:load',
  refreshRepositoryKnowledge: 'devflow:repository-knowledge:refresh',
  loadDesktopPairing: 'devflow:desktop-pairing:load',
  pairDesktop: 'devflow:desktop-pairing:pair',
  listAgentProviders: 'devflow:agent:providers:list',
  saveAgentProviderCredential: 'devflow:agent:provider-credential:save',
  runKnowledgeReview: 'devflow:agent:knowledge-review:run',
  listAgentReviews: 'devflow:agent:reviews:list',
  ensureCodingEngine: 'devflow:coding:engine:ensure',
  runCodingAgent: 'devflow:coding:agent:run',
  startRetryAttempt: 'devflow:remediation:retry:start',
  cancelCodingAgentRun: 'devflow:coding:agent:cancel',
  replyCodingPermission: 'devflow:coding:permission:reply',
  subscribeCodingRun: 'devflow:coding:run:subscribe',
  listCodingAgentRuns: 'devflow:coding:runs:list',
  openManagedWorktree: 'devflow:coding:worktree:open',
  deleteManagedWorktree: 'devflow:coding:worktree:delete',
  codingRunStatusUpdated: 'devflow:coding:push:status',
  codingEventAppended: 'devflow:coding:push:event',
  codingPermissionUpdated: 'devflow:coding:push:permission',
  projectGitStatusUpdated: 'devflow:local-project:git-status:updated',
  localStateUpdated: 'devflow:local-state:updated',
} as const

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

export type PrepareGitHubDeliveryInput = CreatePrDraftInput

export type PrepareGitHubDeliveryResult =
  | {
      status: 'prepared'
      replayed: boolean
      intent: GitHubDeliveryIntent
      testEvidence: TestEvidence
    }
  | {
      status: 'tests_failed'
      testEvidence: TestEvidence
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

export type ListGateOverridesInput = {
  runId?: string
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
  runtime: AgentReviewRuntime
  providerId?: string
  runtimeBudgetApprovalId?: string
}

export type ListAgentReviewsInput = {
  runId?: string
}

export type RunKnowledgeReviewResult = AgentReviewExecutionResult & {
  state: LocalExecutionState
}

export type EnsureCodingEngineInput = {
  projectId: string
}

export type EnsureCodingEngineResult = {
  projectId: string
  engine: 'fake' | 'opencode-http' | 'opencode-acp'
  status: 'ready'
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

export type CancelCodingAgentRunInput = {
  codingRunId: string
}

export type ReplyCodingPermissionInput = {
  requestId: string
  codingRunId: string
  decidedBy: string
  decision: CodingPermissionDecision['decision']
  comment: string
}

export type SubscribeCodingRunInput = {
  codingRunId: string
}

export type ListCodingAgentRunsInput = {
  runId?: string
}

export type OpenManagedWorktreeInput = {
  workspaceId: string
}

export type DeleteManagedWorktreeInput = OpenManagedWorktreeInput

export type LoadRemoteSnapshotInput = {
  organizationId?: string
}

export type ListWorkRequestsInput = {
  localProjectId: string
}

export type MaterializeWorkRequestInput = {
  localProjectId: string
  workRequestId: string
  expectedVersion: number
}

export type MaterializeWorkRequestResult = {
  workRequest: WorkRequest
  run: WorkflowRun
  state: LocalExecutionState
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
  completeWorkflowAgentNode: (input: CompleteWorkflowAgentNodeInput) => Promise<CompleteWorkflowAgentNodeResult>
  createPrDraft: (input: CreatePrDraftInput) => Promise<CreatePrDraftResult>
  prepareGitHubDelivery: (
    input: PrepareGitHubDeliveryInput,
  ) => Promise<PrepareGitHubDeliveryResult>
  createAcceptanceBundle: (
    input: CreateAcceptanceBundleInput,
  ) => Promise<CreateAcceptanceBundleResult>
  approveGate: (input: ApproveGateInput) => Promise<ApproveGateResult>
  saveGateOverride: (input: SaveGateOverrideInput) => Promise<GateOverrideDecision>
  listGateOverrides: (input?: ListGateOverridesInput) => Promise<GateOverrideDecision[]>
  saveSettings: (settings: Partial<LocalSettings>) => Promise<LocalSettings>
  saveMcpServers: (servers: McpServerDefinition[]) => Promise<McpServerDefinition[]>
  listAgentProviders: () => Promise<AgentProviderConfig[]>
  saveAgentProviderCredential: (input: AgentProviderCredentialInput) => Promise<ProviderCredentialMetadata>
  runKnowledgeReview: (input: RunKnowledgeReviewInput) => Promise<RunKnowledgeReviewResult>
  listAgentReviews: (input?: ListAgentReviewsInput) => Promise<AgentReviewExecutionResult['review'][]>
  ensureCodingEngine: (input: EnsureCodingEngineInput) => Promise<EnsureCodingEngineResult>
  runCodingAgent: (input: RunCodingAgentInput) => Promise<RunCodingAgentResult>
  startRetryAttempt: (input: StartRetryAttemptInput) => Promise<StartRetryAttemptResult>
  cancelCodingAgentRun: (input: CancelCodingAgentRunInput) => Promise<CodingAgentRun>
  replyCodingPermission: (input: ReplyCodingPermissionInput) => Promise<CodingPermissionRequest>
  subscribeCodingRun: (input: SubscribeCodingRunInput) => Promise<LocalExecutionState>
  listCodingAgentRuns: (input?: ListCodingAgentRunsInput) => Promise<CodingAgentRun[]>
  openManagedWorktree: (input: OpenManagedWorktreeInput) => Promise<ManagedCodingWorkspace>
  deleteManagedWorktree: (input: DeleteManagedWorktreeInput) => Promise<ManagedCodingWorkspace>
  onCodingRunStatusUpdated: (listener: (run: CodingAgentRun) => void) => () => void
  onCodingEventAppended: (listener: (event: CodingAgentEvent) => void) => () => void
  onCodingPermissionUpdated: (listener: (request: CodingPermissionRequest) => void) => () => void
  onProjectGitStatusUpdated: (listener: (status: ProjectGitStatus) => void) => () => void
  onLocalStateUpdated: (listener: (state: LocalExecutionState) => void) => () => void
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

function readExactRequiredIdentifier(
  value: Record<string, unknown>,
  key: string,
): string {
  const raw = value[key]
  if (
    typeof raw !== 'string' ||
    raw.length > WORK_REQUEST_ID_MAX_LENGTH ||
    raw.length === 0 ||
    raw.trim().length === 0 ||
    raw.trim() !== raw
  ) {
    throw new Error(`Invalid ${key}`)
  }

  return raw
}

function rejectUnexpectedFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  payloadName: string,
): void {
  const allowed = new Set(allowedFields)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) {
    throw new Error(`Invalid ${payloadName}: unexpected field ${unexpected}`)
  }
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

export function parseSaveProjectTestCommandInput(value: unknown): SaveProjectTestCommandInput {
  if (!isRecord(value)) {
    throw new Error('Invalid save project test command payload')
  }

  return {
    projectId: readRequiredString(value, 'projectId'),
    testCommand: readRequiredString(value, 'testCommand'),
  }
}

export function parseProjectGitStatusInput(value: unknown): ProjectGitStatusInput {
  if (!isRecord(value)) {
    throw new Error('Invalid project git status payload')
  }

  return {
    projectId: readRequiredString(value, 'projectId'),
  }
}

export function parseValidateTestCommandInput(value: unknown): ValidateTestCommandInput {
  return parseSaveProjectTestCommandInput(value)
}

export function parseRunProjectTestsInput(value: unknown): RunProjectTestsInput {
  if (!isRecord(value)) {
    throw new Error('Invalid run project tests payload')
  }
  rejectUnexpectedFields(
    value,
    ['projectId', 'runId', 'nodeId'],
    'run project tests payload',
  )

  return {
    projectId: readRequiredString(value, 'projectId'),
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
  }
}

export function parseLoadEnforcementPolicyInput(value: unknown): LoadEnforcementPolicyInput {
  if (!isRecord(value)) {
    throw new Error('Invalid load enforcement policy payload')
  }

  return { projectId: readRequiredString(value, 'projectId') }
}

export function parseEvaluateGateEnforcementInput(value: unknown): EvaluateGateEnforcementInput {
  if (!isRecord(value)) {
    throw new Error('Invalid evaluate gate enforcement payload')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
  }
}

export function parseSaveGateOverrideInput(value: unknown): SaveGateOverrideInput {
  if (!isRecord(value)) {
    throw new Error('Invalid save gate override payload')
  }

  rejectUnexpectedFields(value, ['runId', 'nodeId', 'reason'], 'save gate override payload')

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    reason: readRequiredString(value, 'reason'),
  }
}

export function parseListGateOverridesInput(value: unknown): ListGateOverridesInput {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isRecord(value)) {
    throw new Error('Invalid list gate overrides payload')
  }
  const runId = value['runId']
  return typeof runId === 'string' && runId.trim() ? { runId: runId.trim() } : {}
}

export function parseCreateRunInput(value: unknown): CreateRunInput {
  if (!isRecord(value)) {
    throw new Error('Invalid create run payload')
  }

  return {
    title: readRequiredString(value, 'title'),
    request: readRequiredString(value, 'request'),
    projectId: readRequiredString(value, 'projectId'),
    creatorId: readRequiredString(value, 'creatorId'),
    branchName: readRequiredString(value, 'branchName'),
  }
}

export function parseDeleteRunInput(value: unknown): DeleteRunInput {
  if (!isRecord(value)) {
    throw new Error('Invalid delete run payload')
  }

  const deleteRemote = value['deleteRemote']
  if (deleteRemote !== undefined && typeof deleteRemote !== 'boolean') {
    throw new Error('Invalid deleteRemote')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    deleteRemote: deleteRemote === true,
  }
}

export function parseCompleteWorkflowAgentNodeInput(value: unknown): CompleteWorkflowAgentNodeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid complete workflow agent node payload')
  }
  if ('artifact' in value || 'artifacts' in value || 'event' in value || 'run' in value) {
    throw new Error('Invalid complete workflow agent node payload: artifact/run/event fields are not accepted')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    userId: readRequiredString(value, 'userId'),
    userName: readRequiredString(value, 'userName'),
    ...(typeof value['providerId'] === 'string' && value['providerId'].trim()
      ? { providerId: value['providerId'].trim() }
      : {}),
  }
}

function parseDeliveryArtifactCommandInput(
  value: unknown,
  payloadName: string,
): CreatePrDraftInput {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${payloadName}`)
  }
  rejectUnexpectedFields(value, ['runId', 'nodeId'], payloadName)

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
  }
}

export function parseCreatePrDraftInput(value: unknown): CreatePrDraftInput {
  return parseDeliveryArtifactCommandInput(value, 'create PR draft payload')
}

export function parsePrepareGitHubDeliveryInput(
  value: unknown,
): PrepareGitHubDeliveryInput {
  return parseDeliveryArtifactCommandInput(
    value,
    'prepare GitHub delivery payload',
  )
}

export function parseCreateAcceptanceBundleInput(
  value: unknown,
): CreateAcceptanceBundleInput {
  return parseDeliveryArtifactCommandInput(
    value,
    'create acceptance bundle payload',
  )
}

export function parseApproveGateInput(value: unknown): ApproveGateInput {
  if (!isRecord(value)) {
    throw new Error('Invalid approve gate payload')
  }

  rejectUnexpectedFields(value, ['runId', 'nodeId'], 'approve gate payload')

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
  }
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

export function parseListWorkRequestsInput(value: unknown): ListWorkRequestsInput {
  if (!isRecord(value)) {
    throw new Error('Invalid list Work Requests payload')
  }
  rejectUnexpectedFields(value, ['localProjectId'], 'list Work Requests payload')

  return {
    localProjectId: readExactRequiredIdentifier(value, 'localProjectId'),
  }
}

export function parseMaterializeWorkRequestInput(
  value: unknown,
): MaterializeWorkRequestInput {
  if (!isRecord(value)) {
    throw new Error('Invalid materialize Work Request payload')
  }
  rejectUnexpectedFields(
    value,
    ['localProjectId', 'workRequestId', 'expectedVersion'],
    'materialize Work Request payload',
  )

  const expectedVersion = value['expectedVersion']
  if (
    !Number.isInteger(expectedVersion) ||
    (expectedVersion as number) < 1 ||
    (expectedVersion as number) > 2_147_483_647
  ) {
    throw new Error('Invalid expectedVersion')
  }

  return {
    localProjectId: readExactRequiredIdentifier(value, 'localProjectId'),
    workRequestId: readExactRequiredIdentifier(value, 'workRequestId'),
    expectedVersion: expectedVersion as number,
  }
}

export function parseRetryRemoteSyncOperationInput(
  value: unknown,
): RetryRemoteSyncOperationInput {
  if (!isRecord(value)) {
    throw new Error('Invalid retry remote sync operation payload')
  }
  rejectUnexpectedFields(value, ['operationId'], 'retry remote sync operation payload')

  return { operationId: readRequiredString(value, 'operationId') }
}

export function parseLoadRepositoryKnowledgeInput(
  value: unknown,
): LoadRepositoryKnowledgeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid load repository knowledge payload')
  }
  rejectUnexpectedFields(value, ['projectId'], 'load repository knowledge payload')

  return { projectId: readRequiredString(value, 'projectId') }
}

export function parseRefreshRepositoryKnowledgeInput(
  value: unknown,
): RefreshRepositoryKnowledgeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid refresh repository knowledge payload')
  }
  rejectUnexpectedFields(value, ['projectId'], 'refresh repository knowledge payload')

  return { projectId: readRequiredString(value, 'projectId') }
}

export function parseAgentProviderCredentialInput(value: unknown): AgentProviderCredentialInput {
  if (!isRecord(value)) {
    throw new Error('Invalid agent provider credential payload')
  }

  const providerId = readRequiredString(value, 'providerId')
  const apiKey = readRequiredString(value, 'apiKey')
  const model = readRequiredString(value, 'model')
  const baseUrl = value['baseUrl']

  return {
    providerId,
    apiKey,
    model,
    ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
  }
}

export function parsePairDesktopInput(value: unknown): PairDesktopInput {
  if (!isRecord(value)) {
    throw new Error('Invalid desktop pairing payload')
  }

  return {
    code: readRequiredString(value, 'code'),
    localProjectId: readRequiredString(value, 'localProjectId'),
  }
}

export function parseRunKnowledgeReviewInput(value: unknown): RunKnowledgeReviewInput {
  if (!isRecord(value)) {
    throw new Error('Invalid knowledge review payload')
  }

  const runId = readRequiredString(value, 'runId')
  const nodeId = readRequiredString(value, 'nodeId')
  const projectId = readRequiredString(value, 'projectId')
  const requestedBy = readRequiredString(value, 'requestedBy')
  const runtime = value['runtime']
  if (runtime !== 'electron' && runtime !== 'api') {
    throw new Error('Invalid runtime')
  }
  const providerId = value['providerId']
  const runtimeBudgetApprovalId = value['runtimeBudgetApprovalId']

  return {
    runId,
    nodeId,
    projectId,
    requestedBy,
    runtime,
    ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}),
    ...(typeof runtimeBudgetApprovalId === 'string' && runtimeBudgetApprovalId.trim()
      ? { runtimeBudgetApprovalId: runtimeBudgetApprovalId.trim() }
      : {}),
  }
}

export function parseListAgentReviewsInput(value: unknown): ListAgentReviewsInput {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isRecord(value)) {
    throw new Error('Invalid list agent reviews payload')
  }
  const runId = value['runId']
  return typeof runId === 'string' && runId.trim() ? { runId: runId.trim() } : {}
}

export function parseEnsureCodingEngineInput(value: unknown): EnsureCodingEngineInput {
  if (!isRecord(value)) {
    throw new Error('Invalid ensure coding engine payload')
  }

  return { projectId: readRequiredString(value, 'projectId') }
}

export function parseRunCodingAgentInput(value: unknown): RunCodingAgentInput {
  if (!isRecord(value)) {
    throw new Error('Invalid coding agent run payload')
  }
  if ('prompt' in value) {
    throw new Error('Invalid coding agent run payload: renderer must not send prompt')
  }
  const runtimeBudgetApprovalId = value['runtimeBudgetApprovalId']

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
    requestedBy: readRequiredString(value, 'requestedBy'),
    providerId: readRequiredString(value, 'providerId'),
    userInstruction: readRequiredString(value, 'userInstruction'),
    ...(typeof runtimeBudgetApprovalId === 'string' && runtimeBudgetApprovalId.trim()
      ? { runtimeBudgetApprovalId: runtimeBudgetApprovalId.trim() }
      : {}),
  }
}

export function parseStartRetryAttemptInput(value: unknown): StartRetryAttemptInput {
  if (!isRecord(value)) {
    throw new Error('Invalid retry attempt payload')
  }
  if ('prompt' in value || 'remediationPlan' in value) {
    throw new Error('Invalid retry attempt payload: renderer must not send prompt or remediation plan')
  }
  const candidateIds = value['candidateIds']
  if (
    !Array.isArray(candidateIds) ||
    candidateIds.length === 0 ||
    !candidateIds.every((candidateId) => typeof candidateId === 'string' && candidateId.trim().length > 0)
  ) {
    throw new Error('Invalid candidateIds')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
    requestedBy: readRequiredString(value, 'requestedBy'),
    providerId: readRequiredString(value, 'providerId'),
    candidateIds: candidateIds.map((candidateId) => candidateId.trim()),
    userInstruction: readRequiredString(value, 'userInstruction'),
  }
}

export function parseCancelCodingAgentRunInput(value: unknown): CancelCodingAgentRunInput {
  if (!isRecord(value)) {
    throw new Error('Invalid cancel coding agent payload')
  }

  return { codingRunId: readRequiredString(value, 'codingRunId') }
}

export function parseReplyCodingPermissionInput(value: unknown): ReplyCodingPermissionInput {
  if (!isRecord(value)) {
    throw new Error('Invalid coding permission reply payload')
  }
  const decision = value['decision']
  if (decision !== 'approved' && decision !== 'rejected' && decision !== 'expired') {
    throw new Error('Invalid coding permission decision')
  }

  return {
    requestId: readRequiredString(value, 'requestId'),
    codingRunId: readRequiredString(value, 'codingRunId'),
    decidedBy: readRequiredString(value, 'decidedBy'),
    decision,
    comment: typeof value['comment'] === 'string' ? value['comment'].trim() : '',
  }
}

export function parseSubscribeCodingRunInput(value: unknown): SubscribeCodingRunInput {
  if (!isRecord(value)) {
    throw new Error('Invalid subscribe coding run payload')
  }

  return { codingRunId: readRequiredString(value, 'codingRunId') }
}

export function parseListCodingAgentRunsInput(value: unknown): ListCodingAgentRunsInput {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isRecord(value)) {
    throw new Error('Invalid list coding agent runs payload')
  }
  const runId = value['runId']
  return typeof runId === 'string' && runId.trim() ? { runId: runId.trim() } : {}
}

export function parseOpenManagedWorktreeInput(value: unknown): OpenManagedWorktreeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid managed worktree payload')
  }

  return { workspaceId: readRequiredString(value, 'workspaceId') }
}

export function parseDeleteManagedWorktreeInput(value: unknown): DeleteManagedWorktreeInput {
  return parseOpenManagedWorktreeInput(value)
}
