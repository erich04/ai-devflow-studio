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
  | 'log'
  | 'pr'
  | 'acceptance'

export type AgentEventKind =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'test_result'
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

export type ProjectMembership = {
  projectId: string
  userId: string
  role: Role
}

export type TeamSession = {
  organizationId: string
  userId: string
  role: Role
  projectMemberships: ProjectMembership[]
}

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
