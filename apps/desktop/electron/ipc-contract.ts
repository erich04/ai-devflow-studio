import type {
  AgentEvent,
  AgentProviderConfig,
  AgentReviewExecutionResult,
  CommandSafetyResult,
  CodingAgentEvent,
  CodingAgentRun,
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
  ProviderCredentialMetadata,
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteSyncUploadResult,
  RemoteTeamSnapshot,
  RemoteTestEvidenceSummary,
  RetryAttempt,
  TestEvidence,
  AgentReviewRuntime,
  Role,
  WorkflowRun,
} from '@ai-devflow/shared'

export const ipcChannels = {
  loadState: 'devflow:local-state:load',
  selectProject: 'devflow:local-project:select',
  saveProjectTestCommand: 'devflow:local-project:save-test-command',
  validateTestCommand: 'devflow:local-project:validate-test-command',
  runProjectTests: 'devflow:local-tests:run',
  loadEnforcementPolicy: 'devflow:enforcement:policy:load',
  evaluateGateEnforcement: 'devflow:enforcement:gate:evaluate',
  createRun: 'devflow:run:create',
  saveRun: 'devflow:run:save',
  approveGate: 'devflow:gate:approve',
  saveGateOverride: 'devflow:gate:override:save',
  listGateOverrides: 'devflow:gate:overrides:list',
  saveEvent: 'devflow:event:save',
  saveSettings: 'devflow:settings:save',
  saveMcpServers: 'devflow:mcp-servers:save',
  loadRemoteSnapshot: 'devflow:remote:snapshot:load',
  loadDesktopPairing: 'devflow:desktop-pairing:load',
  pairDesktop: 'devflow:desktop-pairing:pair',
  uploadRunSummary: 'devflow:remote:run-summary:upload',
  uploadTestEvidenceSummary: 'devflow:remote:test-evidence-summary:upload',
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
  uploadCodingAgentSummary: 'devflow:remote:coding-agent-summary:upload',
  codingRunStatusUpdated: 'devflow:coding:push:status',
  codingEventAppended: 'devflow:coding:push:event',
  codingPermissionUpdated: 'devflow:coding:push:permission',
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
  selectLocalProject: () => Promise<LocalProject | null>
  saveProjectTestCommand: (input: SaveProjectTestCommandInput) => Promise<LocalProject>
  validateTestCommand: (input: ValidateTestCommandInput) => Promise<CommandSafetyResult>
  runProjectTests: (input: RunProjectTestsInput) => Promise<RunProjectTestsResult>
  loadEnforcementPolicy: (input: LoadEnforcementPolicyInput) => Promise<PolicySnapshot>
  evaluateGateEnforcement: (input: EvaluateGateEnforcementInput) => Promise<GateEnforcementDecision>
  createRun: (run: WorkflowRun) => Promise<WorkflowRun>
  saveRun: (run: WorkflowRun) => Promise<WorkflowRun>
  approveGate: (input: ApproveGateInput) => Promise<ApproveGateResult>
  saveGateOverride: (input: SaveGateOverrideInput) => Promise<GateOverrideDecision>
  listGateOverrides: (input?: ListGateOverridesInput) => Promise<GateOverrideDecision[]>
  saveEvent: (event: AgentEvent) => Promise<AgentEvent>
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
  uploadCodingAgentSummary: (summary: RemoteCodingAgentSummary) => Promise<RemoteSyncUploadResult>
  onCodingRunStatusUpdated: (listener: (run: CodingAgentRun) => void) => () => void
  onCodingEventAppended: (listener: (event: CodingAgentEvent) => void) => () => void
  onCodingPermissionUpdated: (listener: (request: CodingPermissionRequest) => void) => () => void
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

function hasLocalOnlyCodingField(value: Record<string, unknown>): boolean {
  return (
    'cwd' in value ||
    'stdout' in value ||
    'stderr' in value ||
    'prompt' in value ||
    'patch' in value ||
    'rawTrace' in value ||
    'providerSecret' in value ||
    'secret' in value
  )
}

function isRepoRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.replace(/\\/g, '/').trim()
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.startsWith('../') &&
    !normalized.includes('/../') &&
    !/^[A-Za-z]:\//.test(normalized)
  )
}

function isRemoteCodingAgentSummary(value: unknown): value is RemoteCodingAgentSummary {
  return (
    isRecord(value) &&
    !hasLocalOnlyCodingField(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['requestedBy'] === 'string' &&
    typeof value['providerId'] === 'string' &&
    (value['engine'] === 'fake' || value['engine'] === 'opencode-http' || value['engine'] === 'opencode-acp') &&
    typeof value['status'] === 'string' &&
    typeof value['branchName'] === 'string' &&
    typeof value['summary'] === 'string' &&
    Array.isArray(value['changedPaths']) &&
    value['changedPaths'].length <= 50 &&
    value['changedPaths'].every(isRepoRelativePath) &&
    typeof value['startedAt'] === 'string' &&
    (value['completedAt'] === undefined || typeof value['completedAt'] === 'string') &&
    value['redacted'] === true
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
  const role = value['role']
  if (role !== 'member' && role !== 'lead' && role !== 'owner') {
    throw new Error('Invalid role')
  }
  const blockedReasonIds = value['blockedReasonIds']
  if (!Array.isArray(blockedReasonIds) || !blockedReasonIds.every((item) => typeof item === 'string')) {
    throw new Error('Invalid blockedReasonIds')
  }
  const policyVersion = value['policyVersion']
  if (typeof policyVersion !== 'number' || !Number.isInteger(policyVersion)) {
    throw new Error('Invalid policyVersion')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    projectId: readRequiredString(value, 'projectId'),
    userId: readRequiredString(value, 'userId'),
    role,
    reason: readRequiredString(value, 'reason'),
    blockedReasonIds,
    policyVersion,
    provisional: value['provisional'] === true,
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

export function parseSaveRunInput(value: unknown): WorkflowRun {
  if (!isWorkflowRun(value)) {
    throw new Error('Invalid run')
  }

  return value
}

export function parseApproveGateInput(value: unknown): ApproveGateInput {
  if (!isRecord(value)) {
    throw new Error('Invalid approve gate payload')
  }

  const role = value['role']
  if (role !== 'member' && role !== 'lead' && role !== 'owner') {
    throw new Error('Invalid role')
  }

  return {
    runId: readRequiredString(value, 'runId'),
    nodeId: readRequiredString(value, 'nodeId'),
    userId: readRequiredString(value, 'userId'),
    userName: readRequiredString(value, 'userName'),
    role,
  }
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

export function parseRemoteCodingAgentSummaryInput(value: unknown): RemoteCodingAgentSummary {
  if (isRecord(value) && hasLocalOnlyCodingField(value)) {
    throw new Error('Remote coding agent summary contains local-only fields')
  }

  if (!isRemoteCodingAgentSummary(value)) {
    throw new Error('Invalid remote coding agent summary payload')
  }

  return value
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

  return {
    runId,
    nodeId,
    projectId,
    requestedBy,
    runtime,
    ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}),
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
