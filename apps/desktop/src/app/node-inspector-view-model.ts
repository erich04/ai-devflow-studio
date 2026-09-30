import {
  canRunCodingAgentOnNode,
  isActiveCodingAgentRunStatus,
  deriveWorkflowContextPolicyRequirements,
  projectWorkflowContext,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type GateEnforcementDecision,
  type GateEnforcementReason,
  type GitHubDeliveryIntent,
  type GitHubDeliveryOperatorOutcome,
  type NodeStage,
  type PolicySnapshot,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowContextProjection,
} from '@ai-devflow/shared'
import {
  buildWorkflowNodePresentation,
  type BoardNodeKind,
  type WorkflowNodePresentation,
  workflowNodeStatusLabels,
} from './workflow-node-presentation'
import type { CodingRuntimeActionProjection } from './coding-runtime-action-projection'

export type { BoardNodeKind, WorkflowNodePresentation } from './workflow-node-presentation'

export type InspectorSectionId =
  /** In-task execution for the actual current step: generation, Gate Review, coding, tests (plan W2–W4). */
  | 'workPanel'
  | 'workspaceContent'
  /** Gate Review failure, retry and confirmed re-run, below the material being reviewed (W2). */
  | 'reviewRun'
  | 'artifactRecords'
  | 'statusMatrix'
  | 'gateImpactSummary'
  | 'gateEnforcementPanel'
  | 'governance'
  | 'knowledgeReferences'
  | 'reviewEvidence'
  | 'testEvidence'
  | 'remediationActions'
  | 'artifacts'
  | 'trace'
  | 'codingWorkspace'

/**
 * Execution happens in the task (plan W2–W4): Gate Review, coding decisions and tests run
 * from the status row; only configuration opens another page, and it returns here (W9).
 */
export type InspectorActionId =
  | 'runKnowledgeReview'
  | 'cancelKnowledgeReview'
  | 'runTests'
  | 'openTestStep'
  | 'completeAgent'
  | 'approveGate'
  | 'runCodingAgent'
  | 'reviewCodingChangeSet'
  | 'viewCodingPermission'
  | 'renewCodingPermission'
  | 'retryCodingRun'
  | 'configureCodingRuntime'
  | 'viewCodingRecords'
  | 'createPrDraft'
  | 'prepareGitHubDelivery'
  | 'reviseGitHubDelivery'
  | 'retryGitHubDelivery'
  | 'resumeGitHubDelivery'
  | 'stopGitHubDelivery'
  | 'verifyGitHubDeliveryRevocation'
  | 'createAcceptanceBundle'
  | 'stopCodingRun'
  | 'approveCodingPermission'
  | 'rejectCodingPermission'
  | 'cancelStageAgent'
  | 'syncTeam'

export type PendingInspectorActionId = InspectorActionId | 'saveGateOverride'

export type PendingInspectorAction = {
  actionId: PendingInspectorActionId
  runId: string
  nodeId: string
}

export type InspectorActionDisabledReason =
  | 'running_agent_review'
  | 'running_tests'
  | 'requires_current_node'
  | 'gate_permission_missing'
  | 'starting_coding_agent'
  | 'team_project_binding_missing'
  /** No model selected or the budget policy is not loaded: same rule as settings/models (W2, Y2). */
  | 'review_unavailable'
  /** No saved test command, or the task is not at its test step (W4). */
  | 'tests_unavailable'
  /** The projected retry is not allowed (readiness, active run, not the current step). */
  | 'coding_retry_unavailable'
  | 'replying_coding_permission'

export type InspectorAction = {
  id: InspectorActionId
  label: string
  variant: 'primary' | 'ghost'
  disabledReasons: InspectorActionDisabledReason[]
  testId?: string
}

/**
 * The one conclusion shown in the task status row (plan §6.1). The headline, the
 * qualifier and the buttons all come from this object, so they cannot disagree.
 */
export type InspectorStatusKind =
  | 'history'
  | 'waiting_upstream'
  | 'loading'
  | 'unverified'
  | 'running'
  | 'permission'
  | 'failed'
  | 'blocked'
  | 'awaiting_role'
  | 'approvable'
  | 'ready'
  | 'idle'

export type InspectorStatusTone = 'neutral' | 'progress' | 'warning' | 'blocked' | 'done'

export type InspectorNextAction = {
  title: string
  copy: string
  kind: InspectorStatusKind
  tone: InspectorStatusTone
  /** Short second clause of the headline, e.g. “尚未运行 AI 审查”. */
  qualifier?: string
  primaryActionId?: InspectorActionId
  secondaryActionIds: InspectorActionId[]
  /** Stop, cancel and important rejections: always visible, never folded (plan §3). */
  persistentActionIds: InspectorActionId[]
  /** The first click only arms a reminder; a second click submits (plan §6.1). */
  confirmBefore?: { actionId: InspectorActionId; message: string }
}

/**
 * What a Gate approval would apply to. Requirement Gates carry the exact revision;
 * design Gates only carry a title and time until S4 binds a design version (plan V2).
 */
export type InspectorApprovalTarget = {
  kind: 'requirement' | 'design' | 'other'
  determinable: boolean
  revision?: number
  title?: string
  generatedAt?: string
  reason?: string
}

export type InspectorTabPlan = {
  tabId: string
  label: string
  sections: InspectorSectionId[]
}

export type InspectorNodeType =
  | 'clarification'
  | 'designTask'
  | 'gate'
  | 'build'
  | 'test'
  | 'pr'
  | 'acceptance'
  | 'task'

export type StatusTone = 'good' | 'warn' | 'bad' | 'soft' | 'neutral'

export type StatusDescriptor = {
  id: string
  label: string
  state: string
  tone: StatusTone
  readiness?: GateReadinessState
  summary: string
  nextAction: string
  impact: string
}

export type GateReadinessState = 'passed' | 'warning' | 'missing' | 'blocked'

export type GateReadinessCounts = Record<GateReadinessState, number>

export type GateReadinessSummary = {
  canPass: boolean
  isLoading: boolean
  headline: string
  detail: string
  counts: GateReadinessCounts
}

export type GateReadinessGroup = {
  id: 'policy-permission' | 'review-evidence' | 'test-evidence'
  label: string
  state: GateReadinessState
  defaultOpen: boolean
  counts: GateReadinessCounts
  descriptors: StatusDescriptor[]
}

export function selectGitHubDeliveryIntentForInspector(input: {
  run: WorkflowRun | undefined
  node: WorkflowNode | undefined
  intents: readonly GitHubDeliveryIntent[]
}): GitHubDeliveryIntent | undefined {
  const { run, node } = input
  if (!run || !node || (node.kind !== 'pr' && node.kind !== 'acceptance')) {
    return undefined
  }

  if (node.kind === 'pr') {
    return [...input.intents]
      .filter((intent) => intent.runId === run.id && intent.nodeId === node.id)
      .sort((left, right) =>
        githubDeliveryInspectorPriority(right) - githubDeliveryInspectorPriority(left) ||
        right.deliveryAttempt - left.deliveryAttempt ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
      )[0]
  }

  const prNodes = run.nodes.filter((candidate) => candidate.kind === 'pr' && candidate.stage === 'pr')
  if (prNodes.length !== 1 || !run.pullRequestUrl) {
    return undefined
  }
  const prNode = prNodes[0]!
  const canonicalIntents = input.intents.filter((intent) => (
    intent.runId === run.id &&
    intent.localProjectId === run.projectId &&
    intent.nodeId === prNode.id &&
    intent.status === 'completed' &&
    intent.redacted === true &&
    intent.completion?.draft === true &&
    intent.completion.redacted === true &&
    intent.completion.pullRequestUrl === run.pullRequestUrl &&
    prNode.artifactIds.includes(intent.prPackageArtifactId)
  ))

  return canonicalIntents.length === 1 ? canonicalIntents[0] : undefined
}

function githubDeliveryInspectorPriority(intent: GitHubDeliveryIntent): number {
  if (intent.status === 'completed') return 2
  if (intent.status === 'failed' || intent.status === 'revoked') return 1
  return 3
}

/** Display evidence only. Delivery commands still validate exact sources in main. */
export function hasArchivedUpstreamCodingDiff(input: {
  run: WorkflowRun | undefined
  node: WorkflowNode | undefined
  codingRuns: readonly CodingAgentRun[]
  diffs: readonly CodingDiffArtifact[]
}): boolean {
  const { run, node } = input
  if (!run || !node || node.kind !== 'pr' || !run.nodes.some((item) => item.id === node.id)) return false
  const buildIds = new Set(run.nodes.filter(canRunCodingAgentOnNode).map((item) => item.id))
  const latest = input.codingRuns.filter((item) => item.runId === run.id && item.projectId === run.projectId && buildIds.has(item.nodeId))
    .sort((a, b) => Number(isActiveCodingAgentRunStatus(b.status)) - Number(isActiveCodingAgentRunStatus(a.status)) ||
      b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0]
  if (!latest || latest.status !== 'completed' || !latest.completedAt) return false
  return input.diffs.some((diff) => diff.id === latest.diffArtifactId && diff.runId === run.id &&
    diff.projectId === run.projectId && diff.nodeId === latest.nodeId && !diff.truncated &&
    Boolean(diff.sourceDigest && diff.patch.trim()))
}

export function selectInspectorPrPackage(input: {
  node: WorkflowNode
  artifacts: readonly Artifact[]
  githubDeliveryIntent?: GitHubDeliveryIntent
}): Artifact | undefined {
  const intent = input.githubDeliveryIntent
  return input.artifacts.find((artifact) => {
    if (artifact.kind !== 'pr') return false
    if (input.node.kind === 'pr') return artifact.nodeId === input.node.id
    return input.node.kind === 'acceptance' && intent?.status === 'completed' &&
      artifact.runId === intent.runId && artifact.nodeId === intent.nodeId &&
      artifact.id === intent.prPackageArtifactId && artifact.updatedAt === intent.prPackageUpdatedAt &&
      artifact.redacted === true && artifact.githubDeliverySource?.diffSourceDigest === intent.diffSourceDigest
  })
}

export type NodeInspectorHeader = {
  title: string
  subtitle: string
  stageLabel: string
  visualKind: BoardNodeKind
  statusLabel: string
  statusTone: StatusTone
  presentation: WorkflowNodePresentation
}

export type NodeInspectorViewModel = {
  header: NodeInspectorHeader
  visualKind: BoardNodeKind
  tabs: InspectorTabPlan[]
  activeTab: InspectorTabPlan
  nextAction: InspectorNextAction
  actionCatalog: Record<InspectorActionId, InspectorAction>
  actions: InspectorAction[]
  statusDescriptors: StatusDescriptor[]
  gateReadinessSummary?: GateReadinessSummary
  gateReadinessGroups: GateReadinessGroup[]
  contextProjection: WorkflowContextProjection
}

export const stageLabels: Record<NodeStage, string> = {
  clarify: '需求澄清',
  design: '方案设计',
  build: '开发实现',
  test: '测试证据',
  pr: 'PR 交付',
  accept: '业务验收',
}

const GATE_STAGES_WITHOUT_LOCAL_TEST_CTA: ReadonlySet<NodeStage> = new Set(['clarify', 'design'])

function isEarlyReviewGate(node: WorkflowNode): boolean {
  return node.kind === 'gate' && GATE_STAGES_WITHOUT_LOCAL_TEST_CTA.has(node.stage)
}

function shouldOfferLocalTestCtaForGate(node: WorkflowNode): boolean {
  return node.kind === 'gate' && !isEarlyReviewGate(node)
}

export function getInspectorNodeType(node: WorkflowNode): InspectorNodeType {
  if (node.kind === 'agent' && node.stage === 'clarify') {
    return 'clarification'
  }
  if (node.kind === 'agent' && node.stage === 'design') {
    return 'designTask'
  }
  if (node.kind === 'gate') {
    return 'gate'
  }
  if (canRunCodingAgentOnNode(node)) {
    return 'build'
  }
  if (node.kind === 'test' || node.stage === 'test') {
    return 'test'
  }
  if (node.kind === 'pr') {
    return 'pr'
  }
  if (node.kind === 'acceptance') {
    return 'acceptance'
  }
  return 'task'
}

export const CURRENT_WORK_TAB = '当前工作'
export const MATERIALS_TAB = '材料与版本'
export const RECORDS_TAB = '执行记录'

/**
 * Three tabs (plan §5.2, W1). Each piece of content has exactly one home: the body, test
 * results and the approval checklist in 当前工作; materials, references and evidence history
 * in 材料与版本; traces, logs and generation details in 执行记录.
 */
const workspaceTabs = (type: InspectorNodeType): InspectorTabPlan[] => {
  const gate = type === 'gate' || type === 'acceptance'
  return [
    {
      tabId: CURRENT_WORK_TAB,
      label: CURRENT_WORK_TAB,
      sections: [
        'workPanel',
        // A test step's results are its current work; other steps keep them as history.
        ...(type === 'test' ? ['testEvidence'] as const : []),
        'workspaceContent',
        ...(gate ? ['reviewRun', 'statusMatrix', 'gateEnforcementPanel', 'remediationActions'] as const : ['gateImpactSummary'] as const),
      ],
    },
    {
      tabId: MATERIALS_TAB,
      label: MATERIALS_TAB,
      sections: [
        ...(gate ? [] : ['statusMatrix'] as const),
        'artifacts',
        // A test step shows its results in 当前工作; other steps list evidence history here.
        ...(type === 'test' ? [] : ['testEvidence'] as const),
        'knowledgeReferences',
        'governance',
      ],
    },
    {
      tabId: RECORDS_TAB,
      label: RECORDS_TAB,
      // The managed worktree belongs to the coding records (open/delete moved here, W3).
      sections: ['trace', ...(type === 'build' ? ['codingWorkspace'] as const : []), 'artifactRecords'],
    },
  ]
}
export const inspectorTabPlansByNodeType = Object.fromEntries(
  (['clarification', 'designTask', 'gate', 'build', 'test', 'pr', 'acceptance', 'task'] as const).map((type) => [type, workspaceTabs(type)]),
) as Record<InspectorNodeType, InspectorTabPlan[]>

/** Old tab names still resolve: board chips, search, conversation actions and stored links (plan W1). */
const legacyWorkspaceTabs: Record<string, string> = {
  状态: CURRENT_WORK_TAB, 概览: CURRENT_WORK_TAB, 内容与审查: CURRENT_WORK_TAB,
  产物与证据: MATERIALS_TAB, 产物: MATERIALS_TAB, 测试证据: MATERIALS_TAB, 引用来源: MATERIALS_TAB,
  轨迹: RECORDS_TAB,
  Gate影响: CURRENT_WORK_TAB, Gate条件: CURRENT_WORK_TAB, 'Final Gate': CURRENT_WORK_TAB, FinalGate: CURRENT_WORK_TAB,
  Remediation: CURRENT_WORK_TAB, Handoff: CURRENT_WORK_TAB,
}

export function resolveInspectorTabName(node: WorkflowNode, requested: string): string {
  // On a test step the results are the current work, not history.
  if (requested === '测试证据' && getInspectorNodeType(node) === 'test') return CURRENT_WORK_TAB
  return legacyWorkspaceTabs[requested] ?? requested
}

export const inspectorTabPlansByKind: Record<BoardNodeKind, InspectorTabPlan[]> = {
  Task: inspectorTabPlansByNodeType.clarification,
  Gate: inspectorTabPlansByNodeType.gate,
  Review: inspectorTabPlansByNodeType.designTask,
  Test: inspectorTabPlansByNodeType.test,
  Delivery: inspectorTabPlansByNodeType.pr,
  Acceptance: inspectorTabPlansByNodeType.acceptance,
}

export const inspectorTabsByKind: Record<BoardNodeKind, string[]> = {
  Task: inspectorTabPlansByKind.Task.map((tab) => tab.label),
  Gate: inspectorTabPlansByKind.Gate.map((tab) => tab.label),
  Review: inspectorTabPlansByKind.Review.map((tab) => tab.label),
  Test: inspectorTabPlansByKind.Test.map((tab) => tab.label),
  Delivery: inspectorTabPlansByKind.Delivery.map((tab) => tab.label),
  Acceptance: inspectorTabPlansByKind.Acceptance.map((tab) => tab.label),
}

export const inspectorTabsByNodeType: Record<InspectorNodeType, string[]> = {
  clarification: inspectorTabPlansByNodeType.clarification.map((tab) => tab.label),
  designTask: inspectorTabPlansByNodeType.designTask.map((tab) => tab.label),
  gate: inspectorTabPlansByNodeType.gate.map((tab) => tab.label),
  build: inspectorTabPlansByNodeType.build.map((tab) => tab.label),
  test: inspectorTabPlansByNodeType.test.map((tab) => tab.label),
  pr: inspectorTabPlansByNodeType.pr.map((tab) => tab.label),
  acceptance: inspectorTabPlansByNodeType.acceptance.map((tab) => tab.label),
  task: inspectorTabPlansByNodeType.task.map((tab) => tab.label),
}

const legacyNodeTitleLabels: Record<string, string> = {
  '方案澄清': '需求澄清',
  '澄清 Gate': '需求确认 Gate',
  '架构 Gate': '方案评审 Gate',
  'Clarify request': '需求澄清',
  'Clarification Gate': '需求确认 Gate',
  'Design solution': '方案设计',
  'Design Gate': '方案评审 Gate',
  // Template titles of the later stages (packages/shared/src/workflow.ts); stored values stay unchanged.
  'Implement locally': '开发实现',
  'Run tests': '运行测试',
  'Prepare PR draft': '准备 PR 草稿',
  'Acceptance signoff': '业务验收',
}

const legacyNodeSubtitleLabels: Record<string, string> = {
  'Capture acceptance criteria and non-goals': '补齐验收口径与非目标',
  'Confirm the request is ready for design': '确认需求已准备进入方案设计',
  'Define implementation and test strategy': '定义实现方案与测试策略',
  'Approve architecture before implementation': '审批方案后进入实现',
  'Lead 审批后进入实现': 'Lead 审批方案后进入实现',
  'Run Coding Agent in a managed worktree': '在受管工作树中运行 Coding Agent',
  'Archive local test evidence': '归档本地测试证据',
  'Summarize diff, tests, policy, and review evidence': '汇总代码差异、测试、策略与审查证据',
  'Approve final delivery bundle': '确认最终交付材料',
}

export function displayNodeTitle(node: WorkflowNode): string {
  return legacyNodeTitleLabels[node.title] ?? node.title
}

export function displayNodeSubtitle(node: WorkflowNode): string {
  return legacyNodeSubtitleLabels[node.subtitle] ?? node.subtitle
}

export function getBoardNodeKind(node: WorkflowNode): BoardNodeKind {
  return buildWorkflowNodePresentation(node).nodeKind
}

export function getNodeStatusTone(status: WorkflowNode['status']): StatusTone {
  if (status === 'success') {
    return 'good'
  }
  if (status === 'blocked' || status === 'failed') {
    return 'bad'
  }
  if (status === 'running') {
    return 'warn'
  }
  if (status === 'skipped') {
    return 'soft'
  }
  return 'neutral'
}

export function getNodeStatusLabel(status: WorkflowNode['status']): string {
  return workflowNodeStatusLabels[status]
}

export function resolveInspectorTabForSearchResult(
  _node: WorkflowNode,
  target: 'artifact' | 'event',
): string {
  return target === 'artifact' ? MATERIALS_TAB : RECORDS_TAB
}

export function buildStatusDescriptors(input: {
  node: WorkflowNode
  visualKind: BoardNodeKind
  artifacts: Artifact[]
  events: AgentEvent[]
  latestAgentReview?: Pick<AgentReviewResult, 'gateAdvisory'> | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
  testEvidence?: readonly TestEvidence[]
  codingActionProjection?: CodingRuntimeActionProjection
  upstreamCodingDiffReady?: boolean
  githubDeliveryIntent?: GitHubDeliveryIntent
}): StatusDescriptor[] {
  const nodeType = getInspectorNodeType(input.node)
  const earlyReviewGate = isEarlyReviewGate(input.node)
  const artifactForKind = (kind: Artifact['kind']) => input.artifacts.find((artifact) => artifact.kind === kind)
  const hasArtifactKind = (kind: Artifact['kind']) => Boolean(artifactForKind(kind))
  const artifactProvenance = (artifact: Artifact | undefined) => {
    const match = artifact?.content.match(/^> Source: ([^\n]+)/m)
    return match?.[1] ? `来源：${match[1]}` : undefined
  }
  const hasTrace = input.events.length > 0
  const nodeStatus = (): StatusDescriptor => ({
    id: 'node-status',
    label: '当前步骤',
    state: getNodeStatusLabel(input.node.status),
    tone: getNodeStatusTone(input.node.status),
    summary: `${displayNodeTitle(input.node)} 当前为 ${getNodeStatusLabel(input.node.status)}。`,
    nextAction: input.node.status === 'blocked' ? '查看阻断原因并补齐当前步骤需要的输入。' : '按状态行的操作推进当前步骤。',
    impact: `${stageLabels[input.node.stage]} · ${buildWorkflowNodePresentation(input.node).nodeKindLabel}`,
  })
  // First-layer labels are Chinese (plan §6.3, W6); the raw state value stays in the detail.
  const traceStatus = (impact = '执行记录'): StatusDescriptor => ({
    id: 'trace',
    label: '执行记录',
    state: hasTrace ? `${input.events.length} events` : 'empty',
    tone: hasTrace ? 'good' : 'soft',
    summary: hasTrace ? `当前步骤已有 ${input.events.length} 条执行记录。` : '当前步骤还没有执行记录。',
    nextAction: hasTrace ? '在「执行记录」中复核执行过程。' : '执行当前步骤后会写入执行记录。',
    impact,
  })
  const artifactStatus = (
    id: string,
    label: string,
    kind: Artifact['kind'],
    emptySummary: string,
    readySummary: string,
    nextAction: string,
    impact: string,
    hasRuntimeEvidence = false,
  ): StatusDescriptor => {
    const artifact = artifactForKind(kind)
    const ready = Boolean(artifact) || hasRuntimeEvidence
    const provenance = artifactProvenance(artifact)

    return {
      id,
      label,
      state: ready ? 'ready' : 'empty',
      tone: ready ? 'good' : 'soft',
      summary: ready ? `${readySummary}${provenance ? ` ${provenance}。` : ''}` : emptySummary,
      nextAction: ready ? '在「材料与版本」中核对内容。' : nextAction,
      impact,
    }
  }
  const decision = input.gateEnforcementDecision
  // The status row is the only Gate conclusion (plan W6); the checklist lists conditions only.
  const policyStatus = (): StatusDescriptor => ({
    id: 'policy-snapshot',
    label: '团队策略',
    state: input.isLoadingGateEnforcement
      ? '加载中'
      : decision?.status === 'blocked_policy_unavailable'
        ? '尚未读取'
        : input.policySnapshot
          ? '已加载'
          : '未加载',
    tone: input.isLoadingGateEnforcement
      ? 'warn'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'warn'
        : input.policySnapshot
          ? 'good'
          : 'soft',
    readiness: input.isLoadingGateEnforcement
      ? 'warning'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'missing'
        : input.policySnapshot
          ? 'passed'
          : 'missing',
    // The evaluation, not a cached local snapshot, says whether the team policy is usable.
    summary: decision?.status === 'blocked_policy_unavailable'
      ? '本次启动还没有读取团队策略，当前 Gate 无法按团队规则评估。'
      : input.policySnapshot
        ? '团队策略已加载，可用于解释当前 Gate 条件。'
        : '当前环境尚未加载团队策略。',
    nextAction: decision?.status === 'blocked_policy_unavailable' || !input.policySnapshot
      ? '更新团队数据后重新评估 Gate。'
      : '按团队策略核对 Gate 条件。',
    impact: '团队策略',
  })
  // Without a readable team policy the permission is unverified, not blocked (plan X4): the
  // checklist must not say 已阻断 while the status row says 状态待核实.
  const policyUnverified = input.isLoadingGateEnforcement || decision?.status === 'blocked_policy_unavailable'
  const approvalStatus = (): StatusDescriptor => policyUnverified && !input.canApprove ? {
    id: 'approval-permission',
    label: '审批权限',
    state: '待核实',
    tone: 'warn',
    readiness: 'missing',
    summary: '团队策略尚未读取，暂时无法判断当前身份能否审批这个 Gate。',
    nextAction: '更新团队数据后重新评估。',
    impact: '角色与策略',
  } : {
    id: 'approval-permission',
    label: '审批权限',
    state: input.canApprove ? '允许审批' : '不可审批',
    tone: input.canApprove ? 'good' : 'warn',
    readiness: input.canApprove ? 'passed' : 'blocked',
    summary: input.canApprove ? '当前身份与团队策略允许审批这个 Gate。' : '当前身份或团队策略暂不允许审批这个 Gate。',
    nextAction: input.canApprove ? '可以在状态行确认。' : '核对角色、团队策略或缺失的证据。',
    impact: '角色与策略',
  }
  const reviewStatus = (gateScoped: boolean): StatusDescriptor => {
    const missingReview = [...(decision?.blockingReasons ?? []), ...(decision?.warningReasons ?? [])]
      .find((reason) => reason.target === 'missing_agent_review' && reason.id !== 'policy-unavailable')
    if (gateScoped && missingReview) {
      return {
        id: 'missing-agent-review',
        label: '门禁审查',
        state: '缺少门禁审查',
        tone: missingReview.action === 'block' ? 'bad' : 'warn',
        readiness: 'missing',
        summary: missingReview.action === 'block'
          ? 'Gate 缺少基于知识的门禁审查结果，因此当前不能审批。'
          : 'Gate 缺少基于知识的门禁审查结果；当前策略仅警告，不阻断审批。',
        nextAction: '在状态行运行门禁审查。',
        impact: '审查意见',
      }
    }

    return {
      id: 'knowledge-review',
      label: '门禁审查',
      state: input.latestAgentReview ? 'success' : 'empty',
      tone: input.latestAgentReview ? 'good' : 'soft',
      ...(gateScoped ? { readiness: input.latestAgentReview ? 'passed' as const : 'missing' as const } : {}),
      summary: input.latestAgentReview
        ? '基于知识的门禁审查已生成审查意见。'
        : gateScoped
          ? '当前 Gate 尚未运行门禁审查。知识库是依据，Gate 条件和阶段材料是审查对象。'
          : '当前步骤尚未运行基于知识的门禁审查。',
      nextAction: input.latestAgentReview ? '在「当前工作」中核对审查意见。' : gateScoped ? '在状态行运行门禁审查。' : '需要时在 Gate 步骤运行门禁审查。',
      impact: gateScoped ? '审批依据' : '审查与引用',
    }
  }
  const testEvidenceStatus = (gateScoped: boolean): StatusDescriptor => {
    const intent = input.githubDeliveryIntent
    const candidates = intent
      ? input.testEvidence?.filter((evidence) => evidence.id === intent.testEvidenceId && evidence.runId === intent.runId)
      : input.testEvidence?.filter((evidence) => evidence.nodeId === input.node.id)
    const latest = [...(candidates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (latest) {
      const passed = latest.status === 'passed'
      return {
        id: 'test-evidence', label: '测试证据', state: latest.status,
        tone: passed ? 'good' : latest.status === 'running' ? 'warn' : 'bad',
        ...(gateScoped ? { readiness: passed ? 'passed' as const : 'warning' as const } : {}),
        summary: `${intent ? '交付版本测试' : '当前步骤测试'}：${latest.summary}`,
        nextAction: '在测试步骤查看命令与执行结果。',
        impact: '测试结果',
      }
    }
    return {
      id: 'test-evidence',
      label: '测试证据',
      state: hasArtifactKind('test_report') ? 'success' : 'empty',
      tone: hasArtifactKind('test_report') ? 'good' : gateScoped ? 'warn' : 'soft',
      ...(gateScoped ? { readiness: hasArtifactKind('test_report') ? 'passed' as const : 'missing' as const } : {}),
      summary: hasArtifactKind('test_report')
        ? '当前步骤已有测试报告。'
        : gateScoped ? 'Gate 还没有可用的测试证据。' : '当前步骤还没有测试证据。',
      nextAction: '在测试步骤运行检查或查看证据。',
      impact: gateScoped ? '测试证据汇总' : '测试结果',
    }
  }
  const budgetStatus = (): StatusDescriptor => ({
    id: 'budget',
    label: '预算检查',
    state: input.node.stage === 'build' ? 'preflight required' : 'default',
    tone: input.node.stage === 'build' ? 'warn' : 'soft',
    summary: input.node.stage === 'build'
      ? '真实执行会在启动前完成预算与授权检查。'
      : '当前步骤没有进行中的预算请求。',
    nextAction: input.node.stage === 'build' ? '启动前在状态行查看预算检查结果，并按实际阻断原因处理。' : '无需预算动作。',
    impact: '开发执行',
  })
  const requiredArtifactStatus = (): StatusDescriptor => ({
    id: 'required-artifact',
    label: '所需材料',
    state: input.artifacts.length > 0 ? `${input.artifacts.length} linked` : 'missing',
    tone: input.artifacts.length > 0 ? 'good' : 'soft',
    readiness: input.artifacts.length > 0 ? 'passed' : 'missing',
    summary: input.artifacts.length > 0 ? '当前 Gate 已关联上游材料。' : '当前 Gate 还没有关联可交付的材料。',
    nextAction: input.artifacts.length > 0 ? '核对证据与 Gate 条件。' : '先完成上游步骤的材料。',
    impact: 'Gate 证据',
  })

  if (nodeType === 'clarification') {
    return [
      nodeStatus(),
      artifactStatus('raw-request', '需求输入', 'raw_request', '已创建任务，但当前步骤没有关联原始需求。', '原始需求已经记录。', '确认新建任务时的输入是否完整。', '任务输入'),
      artifactStatus('clarification-artifact', '澄清产物', 'clarification', '还没有生成需求澄清产物。', '需求澄清产物已经生成。', '在状态行生成需求草稿。', '需求澄清'),
      traceStatus('生成记录'),
    ]
  }

  if (nodeType === 'designTask') {
    return [
      nodeStatus(),
      artifactStatus('design-artifact', '设计产物', 'design', '还没有生成设计方案。', '设计方案已经生成。', '在状态行生成方案。', '方案设计'),
      traceStatus('方案生成记录'),
    ]
  }

  if (nodeType === 'gate') {
    const descriptors = [
      policyStatus(),
      approvalStatus(),
      reviewStatus(true),
    ]
    if (!earlyReviewGate) {
      descriptors.push(testEvidenceStatus(true))
    }
    descriptors.push(requiredArtifactStatus())
    return descriptors
  }

  if (nodeType === 'build') {
    return [
      nodeStatus(),
      artifactStatus('coding-diff', '代码改动', 'diff', '还没有代码改动。', '代码改动已记录。', '在状态行开始开发实现。', '开发实现', Boolean(input.codingActionProjection?.terminal?.diffPatch)),
      traceStatus('开发执行记录'),
      budgetStatus(),
    ]
  }

  if (nodeType === 'test') {
    return [
      nodeStatus(),
      testEvidenceStatus(false),
      artifactStatus('test-report', '测试报告', 'test_report', '还没有测试报告。', '测试报告已记录。', '在状态行运行检查。', '测试结果'),
      traceStatus('测试执行记录'),
    ]
  }

  if (nodeType === 'pr') {
    return [
      nodeStatus(),
      artifactStatus('pr-draft', '交付包', 'pr', '还没有交付包。', '交付包已生成。', '在状态行生成交付包。', '交付'),
      testEvidenceStatus(false),
      artifactStatus('handoff-evidence', '实现改动', 'diff', '还没有可用的实现改动。', '实现改动已记录，可用于生成交付摘要。', '先完成开发和测试，再生成交付包。', '交付依据', Boolean(input.githubDeliveryIntent?.diffSourceDigest || input.upstreamCodingDiffReady)),
    ]
  }

  if (nodeType === 'acceptance') {
    return [
      nodeStatus(),
      artifactStatus('acceptance-bundle', '验收证据包', 'acceptance', '还没有验收证据包。', '验收证据包已生成。', '在状态行生成验收证据包。', '业务验收'),
      testEvidenceStatus(false),
    ]
  }

  return [nodeStatus(), traceStatus()]
}

const readinessPriority: Record<GateReadinessState, number> = {
  passed: 0,
  warning: 1,
  missing: 2,
  blocked: 3,
}

function emptyGateReadinessCounts(): GateReadinessCounts {
  return { passed: 0, warning: 0, missing: 0, blocked: 0 }
}

function countGateReadiness(descriptors: readonly StatusDescriptor[]): GateReadinessCounts {
  return descriptors.reduce<GateReadinessCounts>((counts, descriptor) => {
    const readiness = descriptor.readiness ?? (
      descriptor.tone === 'good'
        ? 'passed'
        : descriptor.tone === 'bad'
          ? 'blocked'
          : 'warning'
    )
    counts[readiness] += 1
    return counts
  }, emptyGateReadinessCounts())
}

function groupReadiness(counts: GateReadinessCounts): GateReadinessState {
  return (Object.keys(readinessPriority) as GateReadinessState[]).reduce((current, candidate) => (
    counts[candidate] > 0 && readinessPriority[candidate] > readinessPriority[current]
      ? candidate
      : current
  ), 'passed')
}

export function buildGateReadinessPresentation(input: {
  descriptors: StatusDescriptor[]
  decision: GateEnforcementDecision | null
  isLoading: boolean
  canApprove: boolean
  /** A Gate that is not the actual current step can never “pass” (plan D5). */
  isCurrentNode?: boolean
}): { summary: GateReadinessSummary; groups: GateReadinessGroup[] } {
  const counts = countGateReadiness(input.descriptors)
  const isCurrentNode = input.isCurrentNode ?? true
  const canPass = Boolean(isCurrentNode && input.decision && !input.decision.blocksApproval && input.canApprove)
  const summary: GateReadinessSummary = {
    canPass,
    isLoading: input.isLoading,
    headline: !isCurrentNode
      ? '尚未轮到这个 Gate'
      : input.isLoading
      ? '正在评估 Gate'
      : canPass
        ? counts.warning > 0 || counts.missing > 0
          ? 'Gate 可以通过，但仍有待处理项'
          : 'Gate 已准备好，可以通过'
        : counts.blocked > 0
          ? 'Gate 暂时不能通过'
          : 'Gate 尚未准备完成',
    detail: !isCurrentNode
      ? '上游步骤完成后才会评估和审批这个 Gate。'
      : input.isLoading
      ? '策略与证据正在加载，完成后会自动更新结论。'
      : canPass
        ? counts.warning > 0 || counts.missing > 0
          ? '当前策略允许审批；建议先处理警告或补齐缺失项。'
          : '策略、权限与所需证据均已满足。'
        : counts.blocked > 0
          ? '存在阻断项；请展开对应分组查看下一步。'
          : '仍有缺失项；请展开对应分组补齐。',
    counts,
  }
  const plans: Array<{
    id: GateReadinessGroup['id']
    label: string
    descriptorIds: string[]
  }> = [
    { id: 'policy-permission', label: '策略与权限', descriptorIds: ['policy-snapshot', 'approval-permission'] },
    { id: 'review-evidence', label: '审查与交付证据', descriptorIds: ['knowledge-review', 'missing-agent-review', 'required-artifact'] },
    { id: 'test-evidence', label: '测试证据', descriptorIds: ['test-evidence'] },
  ]
  const groups = plans.flatMap<GateReadinessGroup>((plan) => {
    const descriptors = input.descriptors.filter((descriptor) => plan.descriptorIds.includes(descriptor.id))
    if (descriptors.length === 0) {
      return []
    }
    const groupCounts = countGateReadiness(descriptors)
    const state = groupReadiness(groupCounts)
    return [{
      id: plan.id,
      label: plan.label,
      state,
      defaultOpen: state !== 'passed',
      counts: groupCounts,
      descriptors,
    }]
  })

  return { summary, groups }
}

/** “需求 v2”, “方案” or the Gate’s own title: the object a confirmation applies to. */
export function gateApprovalSubject(node: WorkflowNode, target: InspectorApprovalTarget | undefined): string {
  if (node.stage === 'clarify' || target?.kind === 'requirement') {
    return target?.revision ? `需求 v${target.revision}` : '需求'
  }
  if (node.stage === 'design' || target?.kind === 'design') return '方案'
  return displayNodeTitle(node)
}

function approveGateLabel(node: WorkflowNode, target: InspectorApprovalTarget | undefined): string {
  if (node.kind === 'gate' && (node.stage === 'clarify' || node.stage === 'design')) {
    return `确认${gateApprovalSubject(node, target)}`
  }
  return '通过 Gate'
}

/**
 * Reading something other than the approval target (a history version, the raw request) never
 * moves the target and never confirms it silently: the first click only names both (plan S4, Z6).
 */
function withReadingReminder(
  nextAction: InspectorNextAction,
  input: { node: WorkflowNode; approvalTarget?: InspectorApprovalTarget | undefined; readingElsewhere?: string | undefined },
): InspectorNextAction {
  const offersApproval = nextAction.primaryActionId === 'approveGate' || nextAction.secondaryActionIds.includes('approveGate')
  if (!input.readingElsewhere || !offersApproval || input.approvalTarget?.determinable === false) return nextAction
  const label = approveGateLabel(input.node, input.approvalTarget)
  const existing = nextAction.confirmBefore?.actionId === 'approveGate' ? `${nextAction.confirmBefore.message.replace(/再次点击「[^」]+」提交。$/u, '')}` : ''
  return {
    ...nextAction,
    confirmBefore: {
      actionId: 'approveGate',
      message: `你正在阅读${input.readingElsewhere}，本次确认针对${gateApprovalSubject(input.node, input.approvalTarget)}。${existing}再次点击「${label}」提交。`,
    },
  }
}

function hasPriorClarification(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'clarification')
}

function buildActionCatalog(
  node: WorkflowNode,
  hasTeamProjectBinding: boolean,
  codingActionProjection?: CodingRuntimeActionProjection,
  approvalTarget?: InspectorApprovalTarget,
  artifacts: Artifact[] = [],
): Record<InspectorActionId, InspectorAction> {
  const codingLabel = codingActionProjection?.action.label
  return {
    runKnowledgeReview: {
      id: 'runKnowledgeReview',
      label: '运行门禁审查',
      variant: 'ghost',
      disabledReasons: ['running_agent_review', 'review_unavailable'],
    },
    cancelKnowledgeReview: {
      id: 'cancelKnowledgeReview',
      label: '停止门禁审查',
      variant: 'ghost',
      disabledReasons: [],
    },
    runTests: {
      id: 'runTests',
      label: '运行检查',
      variant: 'ghost',
      disabledReasons: ['running_tests', 'tests_unavailable'],
    },
    // A Gate cannot run tests itself; the checks run at the task's test step.
    openTestStep: {
      id: 'openTestStep',
      label: '查看测试步骤',
      variant: 'ghost',
      disabledReasons: [],
    },
    completeAgent: {
      id: 'completeAgent',
      label: node.stage === 'design'
        ? '生成方案'
        : hasPriorClarification(artifacts) ? '生成修订' : '生成需求草稿',
      variant: 'primary',
      disabledReasons: ['requires_current_node'],
      testId: node.stage === 'design' ? 'complete-design-agent' : 'complete-clarify-agent',
    },
    approveGate: {
      id: 'approveGate',
      label: approveGateLabel(node, approvalTarget),
      variant: 'primary',
      disabledReasons: ['gate_permission_missing'],
    },
    stopCodingRun: {
      id: 'stopCodingRun',
      label: '停止执行',
      variant: 'ghost',
      disabledReasons: [],
    },
    approveCodingPermission: {
      id: 'approveCodingPermission',
      label: '批准本次',
      variant: 'primary',
      disabledReasons: ['replying_coding_permission'],
    },
    rejectCodingPermission: {
      id: 'rejectCodingPermission',
      label: '拒绝',
      variant: 'ghost',
      disabledReasons: ['replying_coding_permission'],
    },
    cancelStageAgent: {
      id: 'cancelStageAgent',
      label: '取消生成',
      variant: 'ghost',
      disabledReasons: [],
    },
    syncTeam: {
      id: 'syncTeam',
      label: '更新团队数据',
      variant: 'primary',
      disabledReasons: [],
    },
    runCodingAgent: {
      id: 'runCodingAgent',
      label: codingActionProjection?.action.id === 'start'
        ? codingActionProjection.action.label
        : '启动 Coding Agent',
      variant: 'ghost',
      disabledReasons: ['starting_coding_agent'],
    },
    // Opens the exact diff in 当前工作; approval is only possible there, after the diff (W3).
    reviewCodingChangeSet: {
      id: 'reviewCodingChangeSet',
      label: codingActionProjection?.action.id === 'review-permission' ? codingLabel ?? '审查并批准修改' : '审查并批准修改',
      variant: 'primary',
      disabledReasons: [],
    },
    viewCodingPermission: {
      id: 'viewCodingPermission',
      label: '查看权限详情',
      variant: 'ghost',
      disabledReasons: [],
    },
    renewCodingPermission: {
      id: 'renewCodingPermission',
      label: codingActionProjection?.action.id === 'renew-permission' ? codingLabel ?? '重新核验并请求审批' : '重新核验并请求审批',
      variant: 'primary',
      disabledReasons: ['replying_coding_permission'],
    },
    // Opens the existing retry confirmation (new Run, cost, extra attempt) in the task.
    retryCodingRun: {
      id: 'retryCodingRun',
      label: codingActionProjection?.action.id === 'retry' ? codingLabel ?? '重新运行' : '重新运行',
      variant: 'primary',
      disabledReasons: ['starting_coding_agent', 'coding_retry_unavailable'],
    },
    configureCodingRuntime: {
      id: 'configureCodingRuntime',
      label: '去设置执行工具',
      variant: 'primary',
      disabledReasons: [],
    },
    viewCodingRecords: {
      id: 'viewCodingRecords',
      label: '查看执行记录',
      variant: 'ghost',
      disabledReasons: [],
    },
    createPrDraft: {
      id: 'createPrDraft',
      label: '生成 PR 交付包',
      variant: 'ghost',
      disabledReasons: hasTeamProjectBinding ? [] : ['team_project_binding_missing'],
    },
    prepareGitHubDelivery: {
      id: 'prepareGitHubDelivery',
      label: '准备 GitHub 交付',
      variant: 'primary',
      disabledReasons: hasTeamProjectBinding ? [] : ['team_project_binding_missing'],
    },
    reviseGitHubDelivery: {
      id: 'reviseGitHubDelivery',
      label: 'Revise GitHub Delivery',
      variant: 'primary',
      disabledReasons: hasTeamProjectBinding ? [] : ['team_project_binding_missing'],
    },
    retryGitHubDelivery: {
      id: 'retryGitHubDelivery',
      label: 'Retry GitHub Delivery',
      variant: 'primary',
      disabledReasons: hasTeamProjectBinding ? [] : ['team_project_binding_missing'],
    },
    resumeGitHubDelivery: {
      id: 'resumeGitHubDelivery',
      label: 'Resume GitHub Delivery',
      variant: 'primary',
      disabledReasons: hasTeamProjectBinding ? [] : ['team_project_binding_missing'],
    },
    stopGitHubDelivery: {
      id: 'stopGitHubDelivery',
      label: 'Stop GitHub Delivery',
      variant: 'ghost',
      disabledReasons: [],
    },
    verifyGitHubDeliveryRevocation: {
      id: 'verifyGitHubDeliveryRevocation',
      label: 'Verify credential revocation',
      variant: 'ghost',
      disabledReasons: [],
    },
    createAcceptanceBundle: {
      id: 'createAcceptanceBundle',
      label: '生成验收证据包',
      variant: 'ghost',
      disabledReasons: [],
    },
  }
}

function hasTestArtifact(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'test_report')
}

function hasAcceptanceArtifact(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'acceptance')
}

function hasExactPrDeliveryPackage(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => (
    artifact.kind === 'pr' &&
    artifact.redacted === true &&
    artifact.githubDeliverySource?.stateVersion === 1
  ))
}

const automaticallyAdvancingDeliveryStatuses: ReadonlySet<GitHubDeliveryIntent['status']> = new Set([
  'approved',
  'publishing_branch',
  'branch_published',
  'creating_pr',
])

function statusOf(
  kind: InspectorStatusKind,
  tone: InspectorStatusTone,
  title: string,
  copy: string,
  extra: Partial<Omit<InspectorNextAction, 'kind' | 'tone' | 'title' | 'copy'>> = {},
): InspectorNextAction {
  return { kind, tone, title, copy, secondaryActionIds: [], persistentActionIds: [], ...extra }
}

function hasMissingReviewReason(decision: GateEnforcementDecision | null): boolean {
  return [
    ...(decision?.blockingReasons ?? []),
    ...(decision?.warningReasons ?? []),
  ].some((reason) => reason.target === 'missing_agent_review' && reason.id !== 'policy-unavailable')
}

/** Non-blocking review findings (plan X5): risks, missing evidence and suggested tests. */
export function countGateSuggestions(
  review: AgentReviewResult | undefined,
  decision: GateEnforcementDecision | null,
): number {
  const fromReview = review
    ? review.risks.length + review.missingEvidence.length + review.suggestedTests.length
    : 0
  if (fromReview > 0) return fromReview
  return (decision?.warningReasons ?? []).filter((reason) => reason.target !== 'missing_agent_review').length
}

const blockingTargetLabels: Record<GateEnforcementReason['target'], string> = {
  governance_check: '规范检查未满足',
  agent_finding: 'AI 审查发现需要处理的问题',
  missing_agent_review: '缺少本阶段要求的 AI 审查',
}

const codingPhaseLabels: Partial<Record<CodingRuntimeActionProjection['phase'], string>> = {
  starting: '正在启动',
  queued: '排队中',
  preparing: '正在准备工作区',
  bootstrapping: '正在安装依赖',
  running: '正在编码',
  applying: '正在应用改动',
  testing: '正在运行检查',
  failed: '失败',
  timed_out: '超时',
  interrupted: '已中断',
  cancelled: '已取消',
}

const statusStateCopy: Record<string, string> = {
  ready: '已记录',
  empty: '尚未生成',
  success: '已完成',
  missing: '缺失',
  pending: '等待中',
  saved: '已保存',
  allowed: '可以审批',
  'lead required': '需要 Lead 审批',
  default: '默认',
  'preflight required': '执行前需预检',
  'approval guarded': '需要审批',
  'not active': '未启用',
  'not loaded': '未加载',
  unavailable: '不可用',
  loading: '加载中',
  passed: '已通过',
  failed: '未通过',
  running: '运行中',
  timed_out: '已超时',
}

/** First-layer wording for status values (plan §6.3, T1); the raw value stays available as detail. */
export function formatStatusState(state: string): string {
  const counted = /^(\d+) (events|linked)$/u.exec(state)
  if (counted) return counted[2] === 'events' ? `有 ${counted[1]} 条执行记录` : `已关联 ${counted[1]} 份材料`
  return statusStateCopy[state] ?? state
}

function permissionNeedsExactReview(permission: NonNullable<CodingRuntimeActionProjection['permission']>): boolean {
  return permission.kind === 'change-set' || permission.kind === 'change-acceptance'
}

function buildCodingStatus(projection: CodingRuntimeActionProjection): InspectorNextAction {
  const projected = projection.action
  const phaseLabel = codingPhaseLabels[projection.phase]
  if (projected.id === 'start') {
    return statusOf('ready', 'neutral', '可以开始开发实现', projected.summary, {
      primaryActionId: 'runCodingAgent',
    })
  }
  if (projected.id === 'review-permission' && projection.permission) {
    const permission = projection.permission
    const remaining = permission.expired
      ? '已过期'
      : `剩余 ${Math.max(0, Math.ceil(permission.remainingMs / 1_000))} 秒`
    // Code changes are approved only in the exact Change Set review shown in 当前工作, after the
    // diff; the status row opens it. Other requests can be approved in place (plan X2, W3).
    const needsExactReview = permissionNeedsExactReview(permission)
    return statusOf('permission', 'warning', '等待你处理权限请求', `${permission.request.title} · ${permission.changedPaths.length} 个文件`, {
      qualifier: remaining,
      ...(needsExactReview
        ? { primaryActionId: 'reviewCodingChangeSet' as const }
        : {
            ...(permission.canApprove && !permission.expired ? { primaryActionId: 'approveCodingPermission' as const } : {}),
            secondaryActionIds: ['viewCodingPermission'] as InspectorActionId[],
          }),
      persistentActionIds: ['rejectCodingPermission', 'stopCodingRun'],
    })
  }
  if (projected.id === 'renew-permission') {
    return statusOf('permission', 'warning', '权限请求已过期', projected.summary, {
      primaryActionId: 'renewCodingPermission',
      persistentActionIds: projection.activeRun ? ['stopCodingRun'] : [],
    })
  }
  if (projected.id === 'view-progress') {
    // Task page copy (plan T1): no raw runtime status values on the first layer.
    return statusOf('running', 'progress', '正在开发实现', '执行进度显示在「当前工作」，完整过程在「执行记录」；需要中止时可以直接停止。', {
      ...(phaseLabel ? { qualifier: phaseLabel } : {}),
      secondaryActionIds: ['viewCodingRecords'],
      persistentActionIds: projection.activeRun ? ['stopCodingRun'] : [],
    })
  }
  if (projected.id === 'retry') {
    return statusOf('failed', 'blocked', `开发执行${phaseLabel ?? '未完成'}`, projection.terminal?.reason ?? projected.summary, {
      primaryActionId: 'retryCodingRun',
      secondaryActionIds: ['viewCodingRecords'],
    })
  }
  if (projected.id === 'configure') {
    return statusOf('blocked', 'warning', '开发前需要完成配置', projected.disabledReason ?? projected.summary, {
      primaryActionId: 'configureCodingRuntime',
    })
  }
  return statusOf('idle', 'neutral', projected.id === 'view-result' ? '开发实现已完成' : projected.label, projected.disabledReason ?? projected.summary, {
    ...(projected.id !== 'none' ? { secondaryActionIds: ['viewCodingRecords'] as InspectorActionId[] } : {}),
  })
}

function buildNextAction(input: {
  node: WorkflowNode
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  githubDeliveryIntent?: GitHubDeliveryIntent
  githubDeliveryOperatorOutcome?: GitHubDeliveryOperatorOutcome
  latestAgentReview: AgentReviewResult | undefined
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
  hasTeamProjectBinding: boolean
  canVerifyGitHubDeliveryRevocation: boolean
  codingActionProjection?: CodingRuntimeActionProjection
  approvalTarget?: InspectorApprovalTarget
  isGeneratingStageAgent?: boolean
  stageProviderLabel?: string
  isRunningKnowledgeReview?: boolean
  reviewProviderLabel?: string
  isRunningTests?: boolean
  testEvidence?: readonly TestEvidence[]
}): InspectorNextAction {
  const { node } = input
  // Before a paid call the status row names the model and says it may cost money (plan W2).
  const reviewCost = input.reviewProviderLabel
    ? `审查使用 ${input.reviewProviderLabel}，可能产生费用。`
    : '运行门禁审查前需要先选择模型。'
  const reviewRunning = (): InspectorNextAction => statusOf('running', 'progress', '正在运行门禁审查', `${input.reviewProviderLabel ? `使用 ${input.reviewProviderLabel}。` : ''}审查只提供建议，完成后会重新评估，不会确认 Gate。`, {
    persistentActionIds: ['cancelKnowledgeReview'],
  })

  if (node.status === 'success') {
    return statusOf('history', 'done', '此步骤已完成', '可以阅读材料、审查意见和执行记录；这里的操作不会改变实际进度。')
  }

  if (!input.isSelectedCurrentNode) {
    return node.status === 'pending'
      ? statusOf('waiting_upstream', 'neutral', '等待上游完成', '这个步骤还没开始。完成当前步骤后才能在这里操作。')
      : statusOf('history', 'neutral', '历史记录', '这是之前的执行结果；这里的操作不会改变实际进度。')
  }

  if (node.kind === 'agent' && (node.stage === 'clarify' || node.stage === 'design')) {
    const noun = node.stage === 'design' ? '方案' : hasPriorClarification(input.artifacts) ? '需求修订' : '需求草稿'
    if (input.isGeneratingStageAgent) {
      return statusOf('running', 'progress', `正在生成${noun}`, '完成后会显示正式材料和执行记录；尚未确认任何 Gate。', {
        persistentActionIds: ['cancelStageAgent'],
      })
    }
    const model = input.stageProviderLabel ? `将使用 ${input.stageProviderLabel} 生成。` : '生成前请在下方选择模型。'
    return statusOf('ready', 'neutral', `可以生成${noun}`, `${model}模型调用可能产生费用。`, {
      primaryActionId: 'completeAgent',
    })
  }

  if (node.kind === 'gate') {
    const decision = input.gateEnforcementDecision
    const target = input.approvalTarget
    const subject = gateApprovalSubject(node, target)
    const approveLabel = approveGateLabel(node, target)
    const missingReview = hasMissingReviewReason(decision)
    if (input.isRunningKnowledgeReview) return reviewRunning()
    if (input.isLoadingGateEnforcement) {
      return statusOf('loading', 'neutral', '正在读取审批条件', '策略、权限和证据正在加载；读取完成前不显示可以确认的结论。')
    }
    if (decision?.status === 'blocked_policy_unavailable') {
      return statusOf('unverified', 'warning', '状态待核实', input.hasTeamProjectBinding
        ? '尚未读取团队策略，暂时无法判断能否确认。更新团队数据后会重新评估。'
        : '当前无法读取适用的策略，暂时无法判断能否确认。', {
        qualifier: '团队策略尚未读取',
        ...(input.hasTeamProjectBinding ? { primaryActionId: 'syncTeam' as const } : {}),
      })
    }
    if (target && !target.determinable) {
      return statusOf('unverified', 'warning', '状态待核实', target.reason ?? '无法确定这次要确认的版本，请先核对材料。', {
        qualifier: '待确认的版本无法确定',
      })
    }
    if (decision?.blocksApproval) {
      if (missingReview) {
        return statusOf('blocked', 'blocked', `暂不能确认${subject}`, `${reviewCost}团队策略要求先完成本阶段的 AI 审查，完成后会重新评估。`, {
          qualifier: '缺少 AI 审查',
          primaryActionId: 'runKnowledgeReview',
        })
      }
      const reason = decision.blockingReasons[0]
      const needsTests = decision.blockingReasons.some((item) => item.target === 'governance_check' && item.ruleKey.includes('testing_standard'))
      return statusOf('blocked', 'blocked', `暂不能确认${subject}`, decision.requiredActions[0] ?? reason?.remediation ?? reason?.summary ?? '展开审批核对清单查看原因。', {
        qualifier: reason ? blockingTargetLabels[reason.target] : '条件未满足',
        ...(needsTests && shouldOfferLocalTestCtaForGate(node) ? { primaryActionId: 'openTestStep' as const } : {}),
      })
    }
    if (!input.canApprove) {
      return statusOf('awaiting_role', 'neutral', `等待有权限的成员确认${subject}`, '当前身份没有审批权限；可以阅读材料和审查意见。', {
        ...(missingReview || !input.latestAgentReview ? { secondaryActionIds: ['runKnowledgeReview'] as InspectorActionId[] } : {}),
      })
    }
    const title = `等待你确认${subject}`
    if (missingReview) {
      return statusOf('approvable', 'warning', title, `${reviewCost}策略不阻断，也可直接确认。`, {
        qualifier: '尚未运行 AI 审查',
        primaryActionId: 'runKnowledgeReview',
        secondaryActionIds: ['approveGate'],
        confirmBefore: {
          actionId: 'approveGate',
          message: `尚未运行 AI 审查，本次确认针对${subject}。再次点击「${approveLabel}」提交。`,
        },
      })
    }
    const suggestions = countGateSuggestions(input.latestAgentReview, decision)
    const testAction: InspectorActionId[] = [
      ...(input.latestAgentReview ? [] : ['runKnowledgeReview' as const]),
      ...(shouldOfferLocalTestCtaForGate(node) && !hasTestArtifact(input.artifacts) ? ['openTestStep' as const] : []),
    ]
    if (suggestions > 0) {
      return statusOf('approvable', 'neutral', title, '审查意见不阻断确认，逐条列在「当前工作」中。', {
        qualifier: `有 ${suggestions} 条建议`,
        primaryActionId: 'approveGate',
        secondaryActionIds: testAction,
      })
    }
    return statusOf('approvable', 'neutral', title, '策略、权限与所需证据均已满足。', {
      primaryActionId: 'approveGate',
      secondaryActionIds: testAction,
    })
  }

  if (canRunCodingAgentOnNode(node)) {
    if (input.codingActionProjection) return buildCodingStatus(input.codingActionProjection)
    return statusOf('ready', 'neutral', '可以开始开发实现', '把当前实现任务交给本地 Coding Agent，生成受控 diff 并回写执行轨迹。', {
      primaryActionId: 'runCodingAgent',
    })
  }

  if (node.kind === 'test' || node.stage === 'test') {
    if (input.isRunningTests) {
      return statusOf('running', 'progress', '正在运行检查', '项目测试命令正在本机执行；结果会显示在「当前工作」，日志在「执行记录」。')
    }
    const latest = [...(input.testEvidence ?? [])]
      .filter((evidence) => evidence.nodeId === node.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (latest && (latest.status === 'failed' || latest.status === 'timed_out')) {
      return statusOf('failed', 'blocked', latest.status === 'timed_out' ? '上次检查超时' : '上次检查未通过', `${latest.summary} 修复后可以重新运行；日志在「执行记录」。`, {
        primaryActionId: 'runTests',
      })
    }
    return statusOf('ready', 'neutral', '可以运行检查', '在本机运行项目的测试命令，结果显示在「当前工作」并保存为测试证据。不调用模型。', {
      primaryActionId: 'runTests',
    })
  }

  if (node.kind === 'pr') {
    const intent = input.githubDeliveryIntent
    if (intent?.status === 'failed') {
      return statusOf('failed', 'blocked', '交付已安全停止', '交付已安全停止且不会自动重试。请核对远端记录；只有当前 pairing claimant 能证明精确远端终态时，显式 Retry 才会创建新 attempt，否则请重新认领新的 Work Request/Run。', {
        primaryActionId: 'retryGitHubDelivery',
      })
    }
    if (intent?.status === 'revoked') {
      if (input.hasTeamProjectBinding) {
        return statusOf('failed', 'warning', '交付授权已撤销', '显式 Retry 只会在当前 pairing claimant 证明精确远端终态后，由 Desktop main 创建新 attempt 或 binding series；否则请重新认领新的 Work Request/Run。', {
          primaryActionId: 'retryGitHubDelivery',
        })
      }
      return statusOf('blocked', 'warning', 'GitHub 授权已撤销', 'Desktop 不会继续远端写入。由 owner 在 Web 重新绑定 GitHub App 后，再开始新的受控交付。')
    }
    if (intent?.status === 'completed') {
      return statusOf('idle', 'done', 'Draft PR 已创建', '精确 commit 的 Draft PR 已记录为交付证据；后台处理器会确保 Workflow 推进到 Acceptance。', {
        secondaryActionIds: input.canVerifyGitHubDeliveryRevocation ? ['verifyGitHubDeliveryRevocation'] : [],
      })
    }
    if (intent?.status === 'approved') {
      return statusOf('awaiting_role', 'neutral', '交付已获批准，等待发布', '发布尚未开始；如材料改变，显式 Revise 会重新提交并复验不可变 revision，使旧审批失效。否则后台处理器会继续推进。', {
        primaryActionId: 'reviseGitHubDelivery',
        persistentActionIds: ['stopGitHubDelivery'],
      })
    }
    if (intent && automaticallyAdvancingDeliveryStatuses.has(intent.status)) {
      return statusOf('running', 'progress', '正在发布交付', '审批已经生效，受限后台处理器会继续发布精确 commit 并创建 Draft PR；无需再次点击。', {
        persistentActionIds: ['stopGitHubDelivery'],
      })
    }
    if (intent?.status === 'recovery_required') {
      if (
        input.githubDeliveryOperatorOutcome?.intentId === intent.id &&
        input.githubDeliveryOperatorOutcome.intentUpdatedAt === intent.updatedAt &&
        input.githubDeliveryOperatorOutcome.outcomeCode === 'content_scan_blocked'
      ) {
        return statusOf('blocked', 'blocked', '发布内容已安全阻断', '这个交付意图的 Git 内容或 PR 文本含有凭据材料，不能 Resume 或绕过扫描。请在 Web 创建新的 Work Request/Run，并由 Coding Agent 从干净来源重建实现、重新测试和准备交付；旧意图不会继续执行远端写入。')
      }
      return statusOf('failed', 'warning', '交付需要恢复', '自动恢复已安全停止；只有显式 Resume 才会按当前 intent 版本继续，并且不会隐式批准。', {
        primaryActionId: 'resumeGitHubDelivery',
      })
    }
    if (intent?.status === 'approval_required') {
      return statusOf('awaiting_role', 'neutral', '等待 Web 审批', 'GitHub Delivery 已准备完成，正在等待 Web Team Console 的 lead/owner 显式批准；如材料改变，显式 Revise 会创建新 intent revision 并使旧审批失效。', {
        primaryActionId: 'reviseGitHubDelivery',
        persistentActionIds: ['stopGitHubDelivery'],
      })
    }
    if (hasExactPrDeliveryPackage(input.artifacts)) {
      return statusOf('ready', 'neutral', '可以准备交付', '交付包已对应本次开发的代码改动。准备交付会提交并复核该提交，仍需在 Web 端审批。', {
        primaryActionId: 'prepareGitHubDelivery',
      })
    }
    return statusOf(input.hasTeamProjectBinding ? 'ready' : 'blocked', input.hasTeamProjectBinding ? 'neutral' : 'warning', '可以生成交付包', input.hasTeamProjectBinding
      ? '汇总本任务的材料和证据，生成对应本次代码改动的已脱敏交付包。'
      : '先把当前本地项目连接到团队项目，再生成带有正确仓库归属的交付包。', {
      primaryActionId: 'createPrDraft',
    })
  }

  if (node.kind === 'acceptance') {
    if (input.isRunningKnowledgeReview) return reviewRunning()
    if (hasMissingReviewReason(input.gateEnforcementDecision)) {
      return statusOf('blocked', 'warning', '验收缺少 AI 审查', `${reviewCost}最终验收缺少基于知识的门禁审查；完成后会重新评估验收 Gate。`, {
        primaryActionId: 'runKnowledgeReview',
      })
    }
    if (!hasAcceptanceArtifact(input.artifacts)) {
      return statusOf('ready', 'neutral', '可以整理验收材料', '先汇总最终交付证据，再进入业务验收审批。', {
        primaryActionId: 'createAcceptanceBundle',
      })
    }
    return statusOf(input.canApprove ? 'approvable' : 'awaiting_role', 'neutral', input.canApprove ? '等待你确认验收' : '等待有权限的成员确认验收', input.canApprove
      ? '验收证据包已经生成，确认后通过业务验收 Gate。'
      : '验收证据包已经生成，但当前用户还没有通过业务验收 Gate 的权限。', {
      primaryActionId: 'approveGate',
    })
  }

  return statusOf('idle', 'neutral', '查看当前节点状态', '该节点当前没有可直接执行的主动作，请查看状态、产物和 Trace。')
}

export function buildNodeInspectorViewModel(input: {
  node: WorkflowNode
  requestedTab: string
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  githubDeliveryIntent?: GitHubDeliveryIntent
  githubDeliveryOperatorOutcome?: GitHubDeliveryOperatorOutcome
  events: AgentEvent[]
  latestAgentReview: AgentReviewResult | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
  hasTeamProjectBinding: boolean
  canVerifyGitHubDeliveryRevocation: boolean
  knowledgeReferenceCount?: number
  testEvidenceCount?: number
  testEvidence?: readonly TestEvidence[]
  codingActionProjection?: CodingRuntimeActionProjection
  upstreamCodingDiffReady?: boolean
  approvalTarget?: InspectorApprovalTarget
  isGeneratingStageAgent?: boolean
  stageProviderLabel?: string
  /** True only while a Gate Review runs for this node (plan W2). */
  isRunningKnowledgeReview?: boolean
  reviewProviderLabel?: string
  isRunningTests?: boolean
  /** What the user reads when it is not the approval target, e.g. “历史版本 v1” (plan S4, Z6). */
  readingElsewhere?: string
}): NodeInspectorViewModel {
  const presentation = buildWorkflowNodePresentation(input.node)
  const visualKind = presentation.nodeKind
  const nodeType = getInspectorNodeType(input.node)
  const tabs = inspectorTabPlansByNodeType[nodeType]
  const requestedTab = resolveInspectorTabName(input.node, input.requestedTab)
  const activeTab = tabs.find((tab) => tab.tabId === requestedTab || tab.label === requestedTab) ?? tabs[0]!
  const actionCatalog = buildActionCatalog(input.node, input.hasTeamProjectBinding, input.codingActionProjection, input.approvalTarget, input.artifacts)
  const baseNextAction = buildNextAction(input)
  // After a GitHub App binding is revoked, verifying that the old delivery credential no longer
  // works is the follow-up on a finished delivery; keep it on the first layer, not in “⋯”.
  const canOfferRevocationCheck = input.githubDeliveryIntent?.status === 'completed' &&
    input.canVerifyGitHubDeliveryRevocation &&
    ((input.node.kind === 'pr' && input.node.status === 'success') || input.node.kind === 'acceptance')
  const revocationNextAction: InspectorNextAction = canOfferRevocationCheck &&
    baseNextAction.primaryActionId !== 'verifyGitHubDeliveryRevocation' &&
    !baseNextAction.secondaryActionIds.includes('verifyGitHubDeliveryRevocation') &&
    baseNextAction.secondaryActionIds.length < 2
    ? { ...baseNextAction, secondaryActionIds: [...baseNextAction.secondaryActionIds, 'verifyGitHubDeliveryRevocation'] }
    : baseNextAction
  const nextAction = withReadingReminder(revocationNextAction, input)
  const actionIds: InspectorActionId[] = []
  const addAction = (actionId: InspectorActionId) => {
    if (
      actionId === nextAction.primaryActionId ||
      nextAction.secondaryActionIds.includes(actionId) ||
      nextAction.persistentActionIds.includes(actionId) ||
      actionIds.includes(actionId)
    ) {
      return
    }
    actionIds.push(actionId)
  }

  if (
    canRunCodingAgentOnNode(input.node) &&
    (!input.codingActionProjection || input.codingActionProjection.action.id === 'start')
  ) {
    addAction('runCodingAgent')
  }
  if (input.node.kind === 'pr') {
    if (
      input.githubDeliveryIntent?.status === 'completed' &&
      input.canVerifyGitHubDeliveryRevocation &&
      input.node.status === 'success'
    ) {
      addAction('verifyGitHubDeliveryRevocation')
    } else if (
      input.githubDeliveryIntent?.status === 'recovery_required' &&
      input.githubDeliveryOperatorOutcome?.outcomeCode !== 'content_scan_blocked'
    ) {
      addAction('resumeGitHubDelivery')
    } else if (!input.githubDeliveryIntent) {
      addAction(hasExactPrDeliveryPackage(input.artifacts) ? 'prepareGitHubDelivery' : 'createPrDraft')
    }
  }
  if (input.node.kind === 'acceptance') {
    if (input.node.status !== 'success') {
      addAction('createAcceptanceBundle')
      if (hasAcceptanceArtifact(input.artifacts)) {
        addAction('approveGate')
      }
    }
    if (
      input.githubDeliveryIntent?.status === 'completed' &&
      input.canVerifyGitHubDeliveryRevocation
    ) {
      addAction('verifyGitHubDeliveryRevocation')
    }
  }
  const actions = actionIds.map((actionId) => actionCatalog[actionId])
  const statusDescriptors = buildStatusDescriptors({
    node: input.node,
    visualKind,
    artifacts: input.artifacts,
    events: input.events,
    latestAgentReview: input.latestAgentReview,
    policySnapshot: input.policySnapshot,
    gateEnforcementDecision: input.gateEnforcementDecision,
    isLoadingGateEnforcement: input.isLoadingGateEnforcement,
    canApprove: input.canApprove,
    upstreamCodingDiffReady: input.upstreamCodingDiffReady ?? false,
    ...(input.testEvidence ? { testEvidence: input.testEvidence } : {}),
    ...(input.codingActionProjection ? { codingActionProjection: input.codingActionProjection } : {}),
    ...(input.githubDeliveryIntent ? { githubDeliveryIntent: input.githubDeliveryIntent } : {}),
  })
  const gateReadiness = nodeType === 'gate'
    ? buildGateReadinessPresentation({
        descriptors: statusDescriptors,
        decision: input.gateEnforcementDecision,
        isLoading: input.isLoadingGateEnforcement,
        canApprove: input.canApprove,
        isCurrentNode: input.isSelectedCurrentNode,
      })
    : undefined
  const contextProjection = projectWorkflowContext({
    node: input.node,
    availability: {
      raw_request: true,
      artifacts: input.artifacts.length,
      knowledge_references: input.knowledgeReferenceCount ?? 0,
      agent_review: Boolean(input.latestAgentReview),
      test_evidence: input.testEvidenceCount ?? 0,
      trace: input.events.length,
      coding_result: input.artifacts.some((artifact) => artifact.kind === 'diff') ||
        Boolean(input.codingActionProjection?.terminal?.diffPatch || input.githubDeliveryIntent?.diffSourceDigest),
      budget: Boolean(input.latestAgentReview),
      policy: Boolean(input.policySnapshot?.effectivePolicy),
      github_delivery: Boolean(input.githubDeliveryIntent),
      acceptance_evidence: input.artifacts.filter((artifact) => artifact.kind === 'acceptance').length,
    },
    requiredByPolicy: deriveWorkflowContextPolicyRequirements(
      input.policySnapshot?.effectivePolicy,
      input.node,
    ),
  })

  return {
    header: {
      title: displayNodeTitle(input.node),
      subtitle: displayNodeSubtitle(input.node),
      stageLabel: stageLabels[input.node.stage],
      visualKind,
      statusLabel: getNodeStatusLabel(input.node.status),
      statusTone: getNodeStatusTone(input.node.status),
      presentation,
    },
    visualKind,
    tabs,
    activeTab,
    nextAction,
    actionCatalog,
    actions,
    statusDescriptors,
    ...(gateReadiness ? { gateReadinessSummary: gateReadiness.summary } : {}),
    gateReadinessGroups: gateReadiness?.groups ?? [],
    contextProjection,
  }
}
