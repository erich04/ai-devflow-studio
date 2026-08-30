export type ThemePreference = 'light' | 'dark' | 'system'

export const TEAM_ROLES = ['owner', 'lead', 'member'] as const
export type Role = (typeof TEAM_ROLES)[number]

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

export const WORKFLOW_CONTEXT_FIELD_IDS = [
  'raw_request',
  'artifacts',
  'knowledge_references',
  'generation_references',
  'agent_review',
  'test_evidence',
  'trace',
  'coding_result',
  'budget',
  'policy',
  'github_delivery',
  'acceptance_evidence',
] as const

export type WorkflowContextFieldId = (typeof WORKFLOW_CONTEXT_FIELD_IDS)[number]

export type WorkflowContextApplicability =
  | 'not_applicable'
  | 'not_yet_expected'
  | 'optional'
  | 'required'

export type WorkflowContextFieldState =
  | WorkflowContextApplicability
  | 'available'
  | 'missing_required'

export type WorkflowContextFieldProjection = {
  field: WorkflowContextFieldId
  applicability: WorkflowContextApplicability
  state: WorkflowContextFieldState
  visible: boolean
  includeInProviderPrompt: boolean
  role: 'primary' | 'supplemental' | 'historical'
  reason: string
  expectedStage?: NodeStage
}

export type WorkflowContextProjection = {
  version: 1
  stage: NodeStage
  nodeKind: NodeKind
  fields: WorkflowContextFieldProjection[]
}

export type ArtifactKind =
  | 'raw_request'
  | 'clarification'
  | 'clarification_feedback'
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
  slug: string
  description: string
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

export type AuthProvider = 'github' | 'local-development'

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

export type AuthenticatedIdentity = {
  user: User
  authAccount: AuthAccount
  projectMemberships: ProjectMembership[]
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

export type DesktopPairingCode = {
  id: string
  organizationId: string
  projectId: string
  createdByUserId: string
  issuedRole: Role
  code: string
  expiresAt: string
  createdAt: string
  attemptsRemaining: number
}

export type DesktopPairingExchangeResult = {
  token: string
  tokenId: string
  organizationId: string
  projectId: string
  userId: string
  role: Role
  /**
   * The immutable maximum role captured when the code was issued. Older local
   * credentials may omit this field and are treated as lead-capability tokens.
   */
  issuedRole?: Role
  /** Absolute server-side token expiry. Older local credentials may omit it. */
  expiresAt?: string
  userName?: string
  projectName?: string
  authAccountId: string
  projectMemberships: ProjectMembership[]
  createdAt: string
}

export type DesktopPairingCredential = Omit<DesktopPairingExchangeResult, 'token'> & {
  localProjectId?: string
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

export type StageAgentExecutorKind = 'direct-provider' | 'local-agent'

export type StageAgentTerminalReason =
  | 'success'
  | 'cancelled'
  | 'timeout'
  | 'cli_unavailable'
  | 'schema_invalid'
  | 'evidence_invalid'
  | 'permission_denied'
  | 'input_limit'
  | 'output_limit'
  | 'tool_limit'
  | 'repository_unavailable'
  | 'repository_changed'
  | 'failed'

export type StageAgentReadTool = 'read' | 'glob' | 'grep' | 'list'

export type StageAgentCapabilityGrant = {
  version: 1
  profile: 'repository-read-only-v1'
  repositoryRead: true
  repositoryWrite: false
  shell: false
  network: false
  workflowMutation: false
  allowedTools: StageAgentReadTool[]
}

export type StageAgentExecutionBounds = {
  timeoutMs: number
  maxInputBytes: number
  maxOutputBytes: number
  maxToolCalls: number
  maxCitations: number
}

export type RepositoryCitation = {
  id: string
  path: string
  contentDigest: string
  lineStart?: number
  lineEnd?: number
}

export type RepositoryVerifiedFact = {
  id: string
  statement: string
  citationIds: string[]
}

export type ClarificationRepositoryFindings = {
  version: 1
  repositoryDigest: string
  verifiedFacts: RepositoryVerifiedFact[]
  citations: RepositoryCitation[]
  assumptions: string[]
  openQuestions: string[]
  uncheckedScopes: string[]
}

export type StageAgentExecutorProvenance = {
  version: 1
  kind: StageAgentExecutorKind
  executorId: string
  executorVersion: string
  capabilityProfile: StageAgentCapabilityGrant['profile']
  providerId?: string
  model: string
  startedAt: string
  completedAt: string
  durationMs: number
  terminalReason: StageAgentTerminalReason
  contextDigest: string
}

export type ClarificationRevisionStatus =
  | 'draft'
  | 'review_requested'
  | 'revision_requested'
  | 'approved'
  | 'superseded'

export type ClarificationRevisionMetadata = {
  version: 1
  revision: number
  status: ClarificationRevisionStatus
  revisionDigest: string
  rawRequestArtifactId: string
  previousRevisionArtifactId?: string
  feedbackArtifactIds: string[]
  goals: string[]
  acceptanceCriteria: string[]
  nonGoals: string[]
  assumptions: string[]
  risks: string[]
  openQuestions: string[]
  repositoryFindings?: ClarificationRepositoryFindings
  executor: StageAgentExecutorProvenance
  generatedAt: string
}

export type ClarificationFeedbackMetadata = {
  version: 1
  targetArtifactId: string
  targetRevision: number
  targetRevisionDigest: string
  actorId: string
  actorName: string
  reasonDigest: string
  createdAt: string
}

export type ClarificationAuditRecord = {
  version: 1
  action: 'revision_generated' | 'changes_requested' | 'approved'
  artifactId: string
  revision: number
  revisionDigest: string
  actorId: string
  feedbackArtifactId?: string
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
  clarificationRevision?: ClarificationRevisionMetadata
  clarificationFeedback?: ClarificationFeedbackMetadata
  githubDeliverySource?: GitHubDeliveryPackageSource
}

export type GitHubDeliveryPackageSource = {
  stateVersion: 1
  codingRunId: string
  workspaceId: string
  diffArtifactId: string
  diffSourceDigest: string
  testEvidenceId: string
  headBranch: string
}

export type AgentEvent = {
  id: string
  runId: string
  nodeId?: string
  sequence: number
  kind: AgentEventKind
  message: string
  timestamp: string
  clarificationAudit?: ClarificationAuditRecord
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

export type RuntimeUsageStatus = 'estimated' | 'complete' | 'incomplete' | 'legacy_unknown'

export type RuntimeCostStatus = 'estimated' | 'settled' | 'unknown' | 'legacy_unverified'

export type RuntimePricingTier = 'peak' | 'off_peak' | 'legacy_estimate'

export type RuntimePricingSnapshot = {
  providerId: string
  model: string
  tier: RuntimePricingTier
  effectiveAt: string
  source: string
  sourceVersion: string
  currency: 'USD'
  unit: 'per_1m_tokens'
  cacheHitInputUsdPerMillion: number
  cacheMissInputUsdPerMillion: number
  outputUsdPerMillion: number
}

export type RuntimeCostBreakdown = {
  cacheHitInputUsd: number
  cacheMissInputUsd: number
  outputUsd: number
  totalUsd: number
}

export type RuntimeProviderRequestPhase = 'analysis' | 'initial' | 'repair'

export type RuntimeProviderCallSettlement = {
  requestPhase: RuntimeProviderRequestPhase
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheMissTokens: number | null
  totalTokens: number
  cacheHitRate: number | null
  usageStatus: RuntimeUsageStatus
  costStatus: RuntimeCostStatus
  costUsd: number | null
  pricingSnapshot: RuntimePricingSnapshot | null
  breakdown: RuntimeCostBreakdown | null
  timestamp: string
  source: TokenUsageSource
  redacted: true
}

/**
 * A coding cost record is intentionally separate from the generic TokenUsage row.
 * Provider settlements may have an unknown cache split or price, represented by
 * null instead of inventing a zero-value cache hit or exact cost.
 */
export type CodingRuntimeCostSummary = Omit<TokenUsage, 'cacheReadTokens' | 'costUsd'> & {
  providerId: string
  source: TokenUsageSource
  redacted: true
  cacheReadTokens: number | null
  cacheMissTokens?: number | null
  totalTokens?: number
  cacheHitRate?: number | null
  usageStatus?: RuntimeUsageStatus
  costStatus?: RuntimeCostStatus
  phase?: 'preflight_estimate' | 'provider_settlement'
  costUsd: number | null
  pricingSnapshot?: RuntimePricingSnapshot | null
  breakdown?: RuntimeCostBreakdown | null
  providerCallSettlements?: RuntimeProviderCallSettlement[]
}

export type CodingRuntimeCostEstimate = CodingRuntimeCostSummary & {
  cacheReadTokens: number
  cacheMissTokens: number
  costUsd: number
  usageStatus: 'estimated'
  costStatus: 'estimated'
  phase: 'preflight_estimate'
  pricingSnapshot: RuntimePricingSnapshot | null
  breakdown: RuntimeCostBreakdown
}

export type RuntimeBudgetPolicy = {
  projectId: string
  enabled: boolean
  monthlyLimitUsd: number
  warningThresholdUsd: number
  currency: 'USD'
  updatedAt: string
}

export type RuntimeBudgetApproval = {
  id: string
  projectId: string
  requestedBy: string
  approvedBy: string
  role: Role
  providerId: string
  maxAdditionalCostUsd: number
  reason: string
  status: 'approved' | 'rejected' | 'expired'
  createdAt: string
  expiresAt: string
}

export type BudgetGuardDecision = {
  status: 'allowed' | 'warning' | 'requires_lead_approval' | 'approved_over_budget' | 'disabled' | 'unavailable'
  blocksRun: boolean
  currentSpendUsd: number
  projectedCostUsd: number
  limitUsd?: number
  approvalRequiredRole?: 'lead'
  approvalId?: string
  reason: string
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
  /** User-facing label. Legacy records may omit it and fall back to providerId. */
  name?: string
  model: string
  baseUrl?: string
  maskedCredential: string
  updatedAt: string
}

export type AgentProviderUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheMissTokens?: number
  totalTokens?: number
  cacheStatus?: 'complete' | 'unknown'
  billingProvider?: 'deepseek' | 'openai_compatible'
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

export type AgentReviewCoverageState =
  | 'complete'
  | 'deterministically_chunked'
  | 'incomplete'

export type AgentReviewSubjectChunk = {
  index: number
  start: number
  end: number
  contentDigest: string
  content: string
}

export type AgentReviewSubjectArtifact = {
  id: string
  runId: string
  nodeId: string
  kind: ArtifactKind
  title: string
  summary: string
  content: string
  updatedAt: string
  contentDigest: string
  sanitizerVersion: string
  coverage: AgentReviewCoverageState
  chunks: AgentReviewSubjectChunk[]
  redacted: boolean
}

export type AgentReviewContextManifest = {
  version: 1
  stage: NodeStage
  coverage: AgentReviewCoverageState
  runRequest: {
    contentDigest: string
    sanitizerVersion: string
    coverage: AgentReviewCoverageState
  }
  subjectArtifacts: Array<{
    id: string
    runId: string
    nodeId: string
    kind: ArtifactKind
    updatedAt: string
    contentDigest: string
    sanitizerVersion: string
    coverage: AgentReviewCoverageState
    chunks: Array<Omit<AgentReviewSubjectChunk, 'content'>>
  }>
  knowledgeCriteria: Array<{
    referenceId: string
    documentId: string
    chunkId?: string
    contentHash?: string
    strategy?: KnowledgeRetrievalStrategy
    lexicalMatch?: KnowledgeLexicalMatch
    semanticRelevance?: KnowledgeSemanticRelevance
    gateEvidence?: KnowledgeGateEvidence
    /** @deprecated Legacy untyped retrieval score. */
    score?: number
  }>
  criteriaCoverage: 'available' | 'unavailable' | 'empty'
  /** Optional for persisted v1 Reviews created before workflow-aware projection. */
  fieldProjection?: WorkflowContextProjection
}

export type AgentReviewContext = {
  run: Pick<WorkflowRun, 'id' | 'title' | 'request' | 'projectId' | 'status' | 'branchName'>
  node: Pick<WorkflowNode, 'id' | 'stage' | 'title' | 'subtitle' | 'kind' | 'status' | 'requiredRole'>
  artifacts: Array<Pick<Artifact, 'id' | 'kind' | 'title' | 'summary' | 'content' | 'redacted'>>
  subjectArtifacts: AgentReviewSubjectArtifact[]
  testEvidence: Array<
    Pick<TestEvidence, 'id' | 'command' | 'status' | 'exitCode' | 'durationMs' | 'summary' | 'redacted'>
  >
  knowledgeReferences: KnowledgeReference[]
  knowledgeChunks: Array<
    Pick<KnowledgeChunk, 'id' | 'documentId' | 'sourcePath' | 'headingPath' | 'contentHash' | 'content'>
  >
  fieldProjection?: WorkflowContextProjection
  manifest: AgentReviewContextManifest
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
  contextManifest?: AgentReviewContextManifest
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
  executorProvenance?: StageAgentExecutorProvenance
  terminalReason?: StageAgentTerminalReason
}

export type AgentReviewArtifact = Artifact & {
  kind: 'agent_review'
}

export type WorkflowRun = {
  id: string
  version: number
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

export type KnowledgeLexicalMatch = {
  /** Raw additive keyword score. It is not normalized and has no fixed maximum. */
  rawScore: number
  matchedTerms: string[]
  normalized: false
  crossQueryComparable: false
  source: 'retriever' | 'legacy_score'
}

export type KnowledgeSemanticRelevance = {
  /** Provider-defined semantic relevance, kept separate from lexical matching. */
  score: number
  provider?: string
  model?: string
  source: 'retriever' | 'legacy_score'
}

export type KnowledgeGateEvidenceStatus =
  | 'retrieval_candidate'
  | 'reviewed_reference'
  | 'supports_finding'
  | 'rejected'

export type KnowledgeGateEvidence = {
  status: KnowledgeGateEvidenceStatus
  reviewId?: string
  findingIds?: string[]
}

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

export type RepositoryKnowledgeWarning =
  | 'unsafe_path_skipped'
  | 'path_limit_exceeded'
  | 'depth_limit_exceeded'
  | 'file_count_limit_exceeded'
  | 'file_size_limit_exceeded'
  | 'total_size_limit_exceeded'
  | 'character_limit_exceeded'
  | 'chunk_limit_exceeded'
  | 'metadata_limit_exceeded'

export type RepositoryKnowledgeSnapshot = {
  projectId: string
  contentHash: string
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
  indexedAt: string
  truncated: boolean
  warnings: RepositoryKnowledgeWarning[]
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
  lexicalMatch?: KnowledgeLexicalMatch
  semanticRelevance?: KnowledgeSemanticRelevance
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
  sourcePath?: string
  chunkId?: string
  category?: KnowledgeDocumentCategory
  lexicalMatch?: KnowledgeLexicalMatch
  semanticRelevance?: KnowledgeSemanticRelevance
  gateEvidence?: KnowledgeGateEvidence
  /** @deprecated Read only for historical records; inspect typed score fields first. */
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

export type ProjectGitStatus =
  | {
      projectId: string
      status: 'branch'
      branch: string
      refreshedAt: string
      headPath?: string
    }
  | {
      projectId: string
      status: 'detached'
      shortSha: string
      refreshedAt: string
      headPath?: string
    }
  | {
      projectId: string
      status: 'not_git'
      message: string
      refreshedAt: string
    }
  | {
      projectId: string
      status: 'unavailable'
      message: string
      refreshedAt: string
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
  sourceCommitSha?: string
  createdAt: string
}

export type CodingAgentEngine = 'fake' | 'native' | 'opencode-http' | 'opencode-acp'

type CodingRuntimeConfigurationBase = {
  projectId: string
  providerId: string
  version: number
  updatedAt: string
}

export type CodingRuntimeConfiguration =
  | (CodingRuntimeConfigurationBase & {
      executor: 'native-model'
    })
  | (CodingRuntimeConfigurationBase & {
      executor: 'opencode-http'
      binaryPath: string
      modelId: string
      detectedVersion: string
    })

export type CodingRuntimeEngineCandidate = {
  engine: 'opencode-http'
  executor: 'opencode-http'
  status: 'available' | 'unavailable'
  binaryPath?: string
  version?: string
  requiresConfirmation: true
  reason: string
}

export type CodingRuntimeDiscovery = {
  projectId: string
  candidates: CodingRuntimeEngineCandidate[]
  detectedAt: string
}

export type CodingRuntimeReadinessCode =
  | 'wrong_workflow_node'
  | 'git_unavailable'
  | 'test_command_missing'
  | 'executor_unconfigured'
  | 'engine_unavailable'
  | 'capability_unavailable'
  | 'provider_unavailable'
  | 'team_project_unpaired'
  | 'budget_policy_missing'
  | 'budget_blocked'
  | 'active_run'
  | 'permission_pending'

export type CodingRuntimeReadinessCheck = {
  code: CodingRuntimeReadinessCode
  status: 'ready' | 'blocked'
  message: string
}

export type CodingRuntimeReadiness = {
  projectId: string
  runId?: string
  nodeId?: string
  status: 'ready' | 'blocked'
  engine: CodingAgentEngine | 'unconfigured'
  executor: 'compatibility' | 'native-deterministic' | 'native-model' | 'opencode-http' | 'unconfigured'
  availability: 'available' | 'unavailable'
  capabilities: import('./coding-executor').CodingExecutorCapability[]
  providerRequirement: 'none' | 'saved-provider' | 'opencode-provider'
  providerId?: string
  configVersion?: number
  budgetPolicy?: RuntimeBudgetPolicy | null
  budgetDecision?: BudgetGuardDecision
  checks: CodingRuntimeReadinessCheck[]
  evaluatedAt: string
}

export type CodingChangeSetReplacement = {
  oldText: string
  newText: string
}

export type CodingChangeSetChange = {
  path: string
  expectedFileDigest: string
  replacements: CodingChangeSetReplacement[]
}

export type CodingChangeSet = {
  id: string
  stateVersion: 2
  codingRunId: string
  projectId: string
  workspaceId: string
  phase: 'initial' | 'repair'
  executorVersion: 2
  configVersion: number
  providerId: string
  createdAt: string
  expiresAt: string
  changes: CodingChangeSetChange[]
  unifiedDiff: string
  changeSetDigest: string
}

export type CodingChangeSetPreview = {
  stateVersion: 2
  id: string
  codingRunId: string
  phase: CodingChangeSet['phase']
  changedPaths: string[]
  unifiedDiff: string
  changeSetDigest: string
  createdAt: string
  expiresAt: string
}

export type CodingAgentRunStatus =
  | 'queued'
  | 'preparing'
  | 'waiting_permission'
  | 'bootstrapping'
  | 'running'
  | 'applying'
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
  configVersion?: number
  changeSetId?: string
  status: CodingAgentRunStatus
  managedWorkspaceId?: string
  branchName: string
  userInstruction: string
  prompt: string
  summary: string
  changedPaths: string[]
  startedAt: string
  completedAt?: string
  tokenUsageId?: string
  runtimeCostSummary?: CodingRuntimeCostSummary
  budgetDecision?: BudgetGuardDecision
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
  origin?: 'coding_executor' | 'dependency_bootstrap'
  permission: 'bash' | 'edit' | 'write' | 'patch' | 'install' | 'external_directory'
  title: string
  command?: string
  filePath?: string
  diffPreview?: string
  changeSetId?: string
  changeSetDigest?: string
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
  baseCommitSha?: string
  headCommitSha?: string
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
  sourceDigest?: string
  truncated: boolean
  redacted: boolean
  sanitizerVersion?: number
  sanitizedAt?: string
  secretReplacementCount?: number
  createdAt: string
}

export type DataOrigin = 'seed' | 'local' | 'remote' | 'adapter'

export type LocalSettings = {
  themePreference: ThemePreference
}

export type LocalExecutionState = {
  remoteSyncOperations: import('./remote-sync-outbox').RemoteSyncOperation[]
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
  githubDeliveryIntents?: import('./github-delivery').GitHubDeliveryIntent[]
  githubDeliveryContentScans?: import('./github-delivery').GitHubDeliveryContentScanRecord[]
  githubDeliveryOperatorOutcomes?: import('./github-delivery').GitHubDeliveryOperatorOutcome[]
  githubDeliveryRevocationChecks?: import('./github-delivery').GitHubDeliveryRevocationCheck[]
  githubRepositoryBindings?: import('./github-delivery').GitHubRepositoryBinding[]
  retryAttempts?: import('./remediation').RetryAttempt[]
  desktopPairingCredential?: DesktopPairingCredential | null
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

export type RemoteRunNodeSummary = Pick<
  WorkflowNode,
  'id' | 'stage' | 'kind' | 'status' | 'requiredRole'
>

export type RemoteRunSummary = {
  kind: RemoteRunSummaryKind
  runId: string
  version: number
  projectId: string
  title: string
  status: RunStatus
  currentNodeId: string
  currentNode: RemoteRunNodeSummary
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

export type RemoteAgentPolicyFindingSummary = Pick<
  AgentPolicyFinding,
  'id' | 'reviewId' | 'runId' | 'nodeId' | 'category' | 'severity' | 'summary' | 'createdAt'
>

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
  policyFindings?: RemoteAgentPolicyFindingSummary[]
  /** Redacted identities/digests only; subject and Knowledge content never leave the local review record. */
  contextManifest?: AgentReviewContextManifest
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
  costSummary?: CodingRuntimeCostSummary
  budgetDecision?: BudgetGuardDecision
  redacted: boolean
}

export type RemoteSyncUploadResult = {
  accepted: boolean
  syncedAt: string
  message: string
}

export type RemoteRunDeleteResult = {
  deleted: boolean
  deletedAt: string
  message: string
}

export type CommandRiskLevel = 'safe' | 'warn' | 'blocked'

export type CommandSafetyResult = {
  level: CommandRiskLevel
  reasons: string[]
  normalizedCommand: string
}
