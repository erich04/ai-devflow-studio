export type ThemePreference = 'light' | 'dark' | 'system'

export type Role = 'owner' | 'lead' | 'member'

export type RunStatus =
  | 'created'
  | 'clarifying'
  | 'designing'
  | 'building'
  | 'testing'
  | 'paused_at_gate'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type NodeStage = 'clarify' | 'design' | 'build' | 'test' | 'pr' | 'accept'

export type NodeKind = 'agent' | 'gate' | 'task' | 'test' | 'pr' | 'acceptance'

export type NodeStatus = 'pending' | 'running' | 'blocked' | 'success' | 'failed' | 'skipped'

export type ArtifactKind =
  | 'raw_request'
  | 'clarification'
  | 'design'
  | 'diff'
  | 'test_report'
  | 'agent_review'
  | 'log'
  | 'pr'
  | 'acceptance'

export type AgentEventKind =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'test_result'
  | 'agent_review'
  | 'approval'
  | 'error'
  | 'sync'

export type GateDecisionKind = 'approved' | 'rejected' | 'changes_requested'

export type RequiredGateRole = 'member' | 'lead' | 'owner'

export type Project = {
  id: string
  name: string
  repository: string
  defaultBranch: string
  health: 'on_track' | 'at_risk' | 'blocked'
  knowledgeBasePath: string
  testCommand: string
}

export type TeamMember = {
  id: string
  name: string
  role: Role
  avatarInitials: string
  focus: string
}

export type Organization = {
  id: string
  name: string
  slug: string
}

export type AuthProvider = 'github'

export type User = {
  id: string
  organizationId: string
  name: string
  role: Role
  email?: string
  avatarUrl?: string
  avatarInitials: string
  focus?: string
  createdAt: string
  updatedAt: string
}

export type AuthAccount = {
  id: string
  userId: string
  provider: AuthProvider
  providerAccountId: string
  username?: string
  email?: string
  createdAt: string
  updatedAt: string
}

export type ProjectMembership = {
  projectId: string
  userId: string
  role: Role
}

export type TeamSessionSource = 'demo' | 'authenticated'

export type BaseTeamSession = {
  organizationId: string
  userId: string
  role: Role
  projectMemberships: ProjectMembership[]
}

export type DemoSession = BaseTeamSession & {
  source: 'demo'
}

export type AuthenticatedSession = BaseTeamSession & {
  source: 'authenticated'
  authAccountId: string
}

export type TeamSession = DemoSession | AuthenticatedSession

export type WorkflowNode = {
  id: string
  stage: NodeStage
  title: string
  subtitle: string
  kind: NodeKind
  status: NodeStatus
  ownerId: string
  requiredRole?: RequiredGateRole
  retryCount: number
  tokenUsageId?: string
  artifactIds: string[]
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
  kind: 'normal' | 'gate' | 'retry' | 'failure'
}

export type Artifact = {
  id: string
  runId: string
  nodeId: string
  kind: ArtifactKind
  title: string
  summary: string
  content: string
  redacted: boolean
  updatedAt: string
}

export type AgentEvent = {
  id: string
  runId: string
  nodeId?: string
  sequence: number
  kind: AgentEventKind
  message: string
  timestamp: string
}

export type GateDecision = {
  id: string
  runId: string
  nodeId: string
  approverId: string
  decision: GateDecisionKind
  comment: string
  decidedAt: string
}

export type TokenUsage = {
  id: string
  runId: string
  nodeId: string
  userId: string
  projectId: string
  provider: 'openai' | 'anthropic' | 'dashscope' | 'local'
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
  timestamp: string
}

export type TokenUsageSource = 'provider_reported' | 'estimated'

export type AgentTokenUsage = TokenUsage & {
  source: TokenUsageSource
}

export type AgentProviderKind = 'openai-compatible' | 'fake'

export type AgentProviderConfig = {
  id: string
  name: string
  kind: AgentProviderKind
  baseUrl?: string
  model: string
  enabled: boolean
  maskedCredential?: string
  updatedAt: string
}

export type ProviderCredentialMetadata = {
  providerId: string
  model: string
  baseUrl?: string
  maskedCredential: string
  updatedAt: string
}

export type AgentProviderUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
}

export type AgentReviewRuntime = 'electron' | 'api'

export type AgentReviewRequest = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  runtime: AgentReviewRuntime
  providerId?: string
}

export type AgentReviewContext = {
  run: Pick<WorkflowRun, 'id' | 'title' | 'request' | 'projectId' | 'status' | 'branchName'>
  node: Pick<WorkflowNode, 'id' | 'stage' | 'title' | 'subtitle' | 'kind' | 'status'>
  artifacts: Array<Pick<Artifact, 'id' | 'kind' | 'title' | 'summary' | 'content' | 'redacted'>>
  testEvidence: Array<
    Pick<TestEvidence, 'id' | 'command' | 'status' | 'exitCode' | 'durationMs' | 'summary' | 'redacted'>
  >
  knowledgeReferences: KnowledgeReference[]
  knowledgeChunks: Array<
    Pick<KnowledgeChunk, 'id' | 'documentId' | 'sourcePath' | 'headingPath' | 'contentHash' | 'content'>
  >
}

export type GateAdvisory = {
  id: string
  runId: string
  nodeId: string
  level: 'info' | 'warn' | 'block'
  blocksApproval: boolean
  summary: string
  missingEvidence: string[]
  riskCount: number
  createdAt: string
}

export type AgentPolicyFindingCategory =
  | 'missing_evidence'
  | 'test_risk'
  | 'api_contract_risk'
  | 'security_risk'
  | 'review_gap'

export type AgentPolicyFindingSeverity = 'low' | 'medium' | 'high'

export type AgentPolicyFinding = {
  id: string
  reviewId: string
  runId: string
  nodeId: string
  category: AgentPolicyFindingCategory
  severity: AgentPolicyFindingSeverity
  summary: string
  evidenceIds: string[]
  knowledgeReferenceIds: string[]
  createdAt: string
}

export type AgentReviewResult = {
  id: string
  requestId: string
  runId: string
  nodeId: string
  projectId: string
  runtime: AgentReviewRuntime
  providerId: string
  model: string
  conclusion: string
  summary: string
  risks: string[]
  missingEvidence: string[]
  suggestedTests: string[]
  knowledgeReferences: KnowledgeReference[]
  policyFindings: AgentPolicyFinding[]
  confidence: number
  gateAdvisory: GateAdvisory
  createdAt: string
}

export type AgentReviewExecutionResult = {
  review: AgentReviewResult
  trace: AgentTrace
  tokenUsage: AgentTokenUsage
}

export type AgentTraceStep = {
  id: string
  kind: 'context' | 'retrieval' | 'provider_call' | 'artifact'
  label: string
  summary: string
  timestamp: string
}

export type AgentTrace = {
  id: string
  runId: string
  nodeId: string
  reviewId: string
  runtime: AgentReviewRuntime
  steps: AgentTraceStep[]
  createdAt: string
}

export type AgentReviewArtifact = Artifact & {
  kind: 'agent_review'
}

export type WorkflowRun = {
  id: string
  title: string
  request: string
  projectId: string
  creatorId: string
  status: RunStatus
  currentNodeId: string
  branchName: string
  pullRequestUrl?: string
  createdAt: string
  updatedAt: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type SkillDefinition = {
  id: string
  name: string
  stage: NodeStage | 'all'
  description: string
  version: string
  enabled: boolean
  source: 'team' | 'project' | 'local'
}

export type McpServerDefinition = {
  id: string
  name: string
  command: string
  permission: 'read' | 'write' | 'network' | 'shell'
  enabledLocally: boolean
  lastAuditEvent: string
}

export type KnowledgeEntity = {
  id: string
  label: string
  kind: 'system' | 'module' | 'standard' | 'term' | 'decision' | 'template' | 'skill' | 'owner'
  sourcePath: string
}

export type KnowledgeRelation = {
  id: string
  source: string
  target: string
  label: 'depends_on' | 'owned_by' | 'uses' | 'defines' | 'tests' | 'approves'
}

export type KnowledgeDocumentCategory =
  | 'development_standard'
  | 'testing_standard'
  | 'review_checklist'
  | 'adr'
  | 'api_contract'
  | 'onboarding'
  | 'skill_rule'
  | 'mcp_rule'

export type KnowledgeSourceFile = {
  sourcePath: string
  markdown: string
  updatedAt: string
}

export type KnowledgeDocument = {
  id: string
  title: string
  category: KnowledgeDocumentCategory
  sourcePath: string
  summary: string
  tags: string[]
  ownerId?: string
  updatedAt: string
  markdown: string
}

export type KnowledgeRetrievalStrategy = 'heuristic' | 'lexical' | 'vector' | 'hybrid'

export type KnowledgeChunk = {
  id: string
  documentId: string
  sourcePath: string
  headingPath: string[]
  content: string
  contentHash: string
  tokenCount: number
  tags: string[]
  updatedAt: string
}

export type KnowledgeRetrievalQuery = {
  id: string
  runId: string
  targetType: KnowledgeReferenceTargetType
  text: string
  nodeId?: string
  artifactId?: string
  evidenceId?: string
  categories?: KnowledgeDocumentCategory[]
  tags?: string[]
  stage?: NodeStage
  minScore?: number
  topK?: number
}

export type KnowledgeRetrievalHit = {
  documentId: string
  chunkId: string
  sourcePath: string
  headingPath: string[]
  contentHash: string
  score: number
  strategy: KnowledgeRetrievalStrategy
  reason: string
  matchedText?: string
  category: KnowledgeDocumentCategory
}

export type KnowledgeReferenceTargetType =
  | 'run'
  | 'node'
  | 'artifact'
  | 'test_evidence'
  | 'gate_decision'

export type KnowledgeReferenceRelation =
  | 'cites'
  | 'satisfies'
  | 'requires_evidence'
  | 'violates'

export type KnowledgeReference = {
  id: string
  runId: string
  targetType: KnowledgeReferenceTargetType
  documentId: string
  relation: KnowledgeReferenceRelation
  reason: string
  chunkId?: string
  score?: number
  strategy?: KnowledgeRetrievalStrategy
  contentHash?: string
  headingPath?: string[]
  nodeId?: string
  artifactId?: string
  evidenceId?: string
}

export type KnowledgeGovernanceStatus = 'satisfied' | 'needs_evidence' | 'violated'

export type KnowledgeGovernanceCheck = {
  id: string
  runId: string
  nodeId: string
  documentId: string
  title: string
  category: KnowledgeDocumentCategory
  status: KnowledgeGovernanceStatus
  summary: string
  referenceIds: string[]
}

export type TeamOverview = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  tokenUsage: TokenUsage[]
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown'

export type ProjectFileSnapshot = Record<string, string>

export type DetectedTestCommand = {
  command: string
  packageManager: PackageManager
  source: 'package.json'
  reason: string
}

export type LocalProject = {
  id: string
  name: string
  path: string
  packageManager: PackageManager
  detectedTestCommand?: string
  testCommand: string
  createdAt: string
  updatedAt: string
}

export type TestEvidenceStatus = 'running' | 'passed' | 'failed' | 'timed_out'

export type TestEvidence = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  command: string
  cwd: string
  status: TestEvidenceStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  summary: string
  redacted: boolean
  createdAt: string
}

export type CodingAgentEngine = 'fake' | 'opencode-http' | 'opencode-acp'

export type CodingAgentRunStatus =
  | 'queued'
  | 'preparing'
  | 'waiting_permission'
  | 'bootstrapping'
  | 'running'
  | 'testing'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'interrupted'
  | 'cancelled'

export type CodingAgentRun = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  engine: CodingAgentEngine
  status: CodingAgentRunStatus
  managedWorkspaceId: string
  branchName: string
  userInstruction: string
  prompt: string
  summary: string
  changedPaths: string[]
  startedAt: string
  completedAt?: string
  tokenUsageId?: string
  diffArtifactId?: string
  bootstrapEvidenceId?: string
  testEvidenceId?: string
  redacted: boolean
}

export type CodingAgentEventKind =
  | 'status'
  | 'brief'
  | 'workspace'
  | 'permission'
  | 'tool_call'
  | 'tool_result'
  | 'bootstrap'
  | 'diff'
  | 'test'
  | 'cleanup'
  | 'error'

export type CodingAgentEvent = {
  id: string
  codingRunId: string
  runId: string
  nodeId: string
  sequence: number
  kind: CodingAgentEventKind
  message: string
  timestamp: string
  metadata?: Record<string, unknown>
  redacted: boolean
}

export type CodingPermissionRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export type CodingPermissionRequest = {
  id: string
  codingRunId: string
  runId: string
  nodeId: string
  permission: 'bash' | 'edit' | 'write' | 'patch' | 'install' | 'external_directory'
  title: string
  command?: string
  filePath?: string
  diffPreview?: string
  risk: CommandRiskLevel
  reasons: string[]
  status: CodingPermissionRequestStatus
  requestedAt: string
  expiresAt: string
}

export type CodingPermissionDecision = {
  id: string
  requestId: string
  codingRunId: string
  decidedBy: string
  decision: 'approved' | 'rejected' | 'expired'
  comment: string
  decidedAt: string
}

export type ManagedCodingWorkspace = {
  id: string
  projectId: string
  codingRunId: string
  sourcePath: string
  worktreePath: string
  branchName: string
  baseBranch: string
  createdAt: string
  deletedAt?: string
  cleanupStatus?: 'active' | 'deleted' | 'cleanup_failed'
  cleanupError?: string | undefined
}

export type DependencyBootstrapStatus = 'required' | 'skipped' | 'needs_approval' | 'running' | 'passed' | 'failed' | 'timed_out'

export type DependencyBootstrapSnapshot = {
  files: ProjectFileSnapshot
  nodeModulesPresent: boolean
  previousDependencyHash?: string
}

export type DependencyBootstrapDecision = {
  status: Extract<DependencyBootstrapStatus, 'required' | 'skipped' | 'needs_approval'>
  packageManager: PackageManager
  command: string
  dependencyHash: string
  risk: CommandRiskLevel
  reason: string
}

export type DependencyBootstrapEvidence = {
  id: string
  codingRunId: string
  runId: string
  nodeId: string
  projectId: string
  command: string
  status: DependencyBootstrapStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  summary: string
  dependencyHash: string
  redacted: boolean
  createdAt: string
}

export type CodingDiffArtifact = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  changedPaths: string[]
  patch: string
  truncated: boolean
  redacted: boolean
  createdAt: string
}

export type DataOrigin = 'seed' | 'local' | 'remote' | 'adapter'

export type LocalSettings = {
  themePreference: ThemePreference
}

export type LocalExecutionState = {
  projects: LocalProject[]
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  agentReviews: AgentReviewResult[]
  agentTraces: AgentTrace[]
  agentTokenUsage: AgentTokenUsage[]
  codingRuns: CodingAgentRun[]
  codingEvents: CodingAgentEvent[]
  codingPermissionRequests: CodingPermissionRequest[]
  codingPermissionDecisions: CodingPermissionDecision[]
  managedCodingWorkspaces: ManagedCodingWorkspace[]
  dependencyBootstrapEvidence: DependencyBootstrapEvidence[]
  codingDiffArtifacts: CodingDiffArtifact[]
  retryAttempts?: import('./remediation').RetryAttempt[]
  settings: LocalSettings
  mcpServers: McpServerDefinition[]
}

export type RemoteTeamSnapshot = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
  projectCost: import('./cost').TokenUsageRollup[]
  memberCost: import('./cost').TokenUsageRollup[]
  totalCost: string
  enforcementPolicies?: {
    organizationPolicy: import('./enforcement').OrganizationEnforcementPolicy
    projectOverrides: import('./enforcement').ProjectEnforcementPolicyOverride[]
    effectivePolicies: import('./enforcement').EffectiveEnforcementPolicy[]
    gateOverrides: import('./enforcement').GateOverrideDecision[]
  }
  policyAwareDeliverySummaries?: import('./remediation').PolicyAwareDeliverySummary[]
}

export type RemoteRunSummaryKind = 'run' | 'approval' | 'event'

export type RemoteRunSummary = {
  kind: RemoteRunSummaryKind
  runId: string
  projectId: string
  title: string
  status: RunStatus
  currentNodeId: string
  branchName: string
  updatedAt: string
}

export type RemoteTestEvidenceSummary = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  command: string
  status: TestEvidenceStatus
  exitCode: number | null
  durationMs: number
  summary: string
  redacted: boolean
  createdAt: string
}

export type RemoteAgentReviewSummary = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  runtime: AgentReviewRuntime
  providerId: string
  model: string
  conclusion: string
  summary: string
  riskCount: number
  missingEvidenceCount: number
  policyFindingCount?: number
  policyFindingCategories?: AgentPolicyFindingCategory[]
  advisoryLevel: GateAdvisory['level']
  blocksApproval: boolean
  confidence: number
  redacted: boolean
  createdAt: string
}

export type RemoteCodingAgentSummary = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  engine: CodingAgentEngine
  status: CodingAgentRunStatus
  branchName: string
  summary: string
  changedPaths: string[]
  startedAt: string
  completedAt?: string
  redacted: boolean
}

export type RemoteSyncUploadResult = {
  accepted: boolean
  syncedAt: string
  message: string
}

export type CommandRiskLevel = 'safe' | 'warn' | 'blocked'

export type CommandSafetyResult = {
  level: CommandRiskLevel
  reasons: string[]
  normalizedCommand: string
}
