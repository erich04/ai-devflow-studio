import {
  canRunCodingAgentOnNode,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type GateEnforcementDecision,
  type NodeStage,
  type PolicySnapshot,
  type WorkflowNode,
} from '@ai-devflow/shared'

export type BoardNodeKind = 'Task' | 'Gate' | 'Review' | 'Delivery'

export type InspectorSectionId =
  | 'statusMatrix'
  | 'nodeSummary'
  | 'gateRequirementMatrix'
  | 'gateEnforcementPanel'
  | 'governance'
  | 'agentReview'
  | 'artifacts'
  | 'trace'
  | 'deliveryHandoff'

export type InspectorActionId =
  | 'openKnowledgeReview'
  | 'openTests'
  | 'completeAgent'
  | 'approveGate'
  | 'runCodingAgent'
  | 'createPrDraft'
  | 'createAcceptanceBundle'

export type InspectorActionDisabledReason =
  | 'running_agent_review'
  | 'running_tests'
  | 'requires_current_node'
  | 'gate_permission_missing'
  | 'starting_coding_agent'

export type InspectorAction = {
  id: InspectorActionId
  label: string
  variant: 'primary' | 'ghost'
  disabledReasons: InspectorActionDisabledReason[]
  testId?: string
}

export type InspectorNextAction = {
  title: string
  copy: string
  recommendedActionIds: InspectorActionId[]
}

export type InspectorTabPlan = {
  tabId: string
  label: string
  sections: InspectorSectionId[]
}

export type StatusTone = 'good' | 'warn' | 'bad' | 'soft' | 'neutral'

export type StatusDescriptor = {
  id: string
  label: string
  state:
    | 'default'
    | 'loading'
    | 'empty'
    | 'blocked'
    | 'failed'
    | 'success'
    | 'policy unavailable'
    | 'missing agent review'
    | 'over budget approval'
  tone: StatusTone
  summary: string
  nextAction: string
  impact: string
}

export type GateRequirementRow = {
  label: string
  state: string
  tone: Exclude<StatusTone, 'neutral'>
  summary: string
}

export type NodeInspectorHeader = {
  title: string
  subtitle: string
  stageLabel: string
  visualKind: BoardNodeKind
  statusLabel: string
  statusTone: StatusTone
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
  gateRequirementRows: GateRequirementRow[]
}

export const stageLabels: Record<NodeStage, string> = {
  clarify: '需求澄清',
  design: '方案设计',
  build: '开发实现',
  test: '测试证据',
  pr: 'PR 交付',
  accept: '业务验收',
}

export const inspectorTabPlansByKind: Record<BoardNodeKind, InspectorTabPlan[]> = {
  Task: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'governance', 'agentReview', 'artifacts'] },
    { tabId: '产物', label: '产物', sections: ['artifacts'] },
    { tabId: 'Trace', label: 'Trace', sections: ['trace'] },
    { tabId: 'Gate影响', label: 'Gate影响', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
  ],
  Gate: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'governance', 'agentReview', 'artifacts'] },
    { tabId: 'Gate条件', label: 'Gate条件', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Remediation', label: 'Remediation', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
  ],
  Review: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'governance', 'agentReview', 'artifacts'] },
    { tabId: 'Knowledge Review', label: 'Knowledge Review', sections: ['agentReview'] },
    { tabId: '引用来源', label: '引用来源', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
  ],
  Delivery: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'governance', 'agentReview', 'artifacts'] },
    { tabId: 'Artifacts', label: 'Artifacts', sections: ['artifacts'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Handoff', label: 'Handoff', sections: ['deliveryHandoff', 'trace'] },
  ],
}

export const inspectorTabsByKind: Record<BoardNodeKind, string[]> = {
  Task: inspectorTabPlansByKind.Task.map((tab) => tab.label),
  Gate: inspectorTabPlansByKind.Gate.map((tab) => tab.label),
  Review: inspectorTabPlansByKind.Review.map((tab) => tab.label),
  Delivery: inspectorTabPlansByKind.Delivery.map((tab) => tab.label),
}

const legacyNodeTitleLabels: Record<string, string> = {
  '方案澄清': '需求澄清',
  '澄清 Gate': '需求确认 Gate',
  '架构 Gate': '方案评审 Gate',
  'Clarify request': '需求澄清',
  'Clarification Gate': '需求确认 Gate',
  'Design solution': '方案设计',
  'Design Gate': '方案评审 Gate',
}

const legacyNodeSubtitleLabels: Record<string, string> = {
  'Capture acceptance criteria and non-goals': '补齐验收口径与非目标',
  'Confirm the request is ready for design': '确认需求已准备进入方案设计',
  'Define implementation and test strategy': '定义实现方案与测试策略',
  'Approve architecture before implementation': '审批方案后进入实现',
  'Lead 审批后进入实现': 'Lead 审批方案后进入实现',
}

export function displayNodeTitle(node: WorkflowNode): string {
  return legacyNodeTitleLabels[node.title] ?? node.title
}

export function displayNodeSubtitle(node: WorkflowNode): string {
  return legacyNodeSubtitleLabels[node.subtitle] ?? node.subtitle
}

export function getBoardNodeKind(node: WorkflowNode): BoardNodeKind {
  if (node.kind === 'gate') {
    return 'Gate'
  }
  if (node.kind === 'pr' || node.kind === 'acceptance') {
    return 'Delivery'
  }
  if (node.kind === 'agent' && node.stage === 'design') {
    return 'Review'
  }
  return 'Task'
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
  return {
    pending: '等待中',
    running: '当前步骤',
    blocked: '已阻断',
    success: '已完成',
    failed: '失败',
    skipped: '已跳过',
  }[status]
}

export function resolveInspectorTabForSearchResult(
  node: WorkflowNode,
  target: 'artifact' | 'event',
): string {
  const tabs = inspectorTabsByKind[getBoardNodeKind(node)]
  if (target === 'artifact') {
    return tabs.find((tab) => tab === '产物' || tab === 'Artifacts' || tab === 'Evidence') ?? tabs[0] ?? '状态'
  }
  return tabs.find((tab) => tab === 'Trace' || tab === 'Handoff') ?? tabs[0] ?? '状态'
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
}): StatusDescriptor[] {
  const descriptors: StatusDescriptor[] = []
  const decision = input.gateEnforcementDecision

  descriptors.push({
    id: 'node-status',
    label: 'Node status',
    state: input.node.status === 'success' ? 'success' : input.node.status === 'failed' ? 'failed' : input.node.status === 'blocked' ? 'blocked' : 'default',
    tone: getNodeStatusTone(input.node.status),
    summary: `${displayNodeTitle(input.node)} 当前为 ${getNodeStatusLabel(input.node.status)}。`,
    nextAction: input.node.status === 'blocked' ? '查看阻断条件并补齐 Evidence。' : '按当前节点类型推进下一步。',
    impact: `${stageLabels[input.node.stage]} · ${input.visualKind}`,
  })

  descriptors.push({
    id: 'policy-snapshot',
    label: 'Policy snapshot',
    state: input.isLoadingGateEnforcement
      ? 'loading'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'policy unavailable'
        : input.policySnapshot
          ? 'success'
          : 'empty',
    tone: input.isLoadingGateEnforcement
      ? 'warn'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'bad'
        : input.policySnapshot
          ? 'good'
          : 'soft',
    summary: input.policySnapshot
      ? `${input.policySnapshot.source} v${input.policySnapshot.version} · synced ${input.policySnapshot.syncedAt}`
      : '当前环境尚未加载 Team policy snapshot。',
    nextAction: input.policySnapshot ? '使用该 snapshot 解释 Gate 条件。' : '先同步团队策略，再重新评估 Gate。',
    impact: 'Team policy / Gate enforcement',
  })

  if (decision?.blockingReasons.some((reason) => reason.target === 'missing_agent_review')) {
    descriptors.push({
      id: 'missing-agent-review',
      label: 'Knowledge Review',
      state: 'missing agent review',
      tone: 'bad',
      summary: 'Gate 缺少 Knowledge Review 结果。',
      nextAction: '从 Inspector 跳到 Agents 运行 Knowledge Review。',
      impact: 'Gate Advisory / Review Evidence',
    })
  } else {
    descriptors.push({
      id: 'knowledge-review',
      label: 'Knowledge Review',
      state: input.latestAgentReview ? 'success' : 'empty',
      tone: input.latestAgentReview ? 'good' : 'soft',
      summary: input.latestAgentReview ? '已有 Knowledge Review advisory。' : '还没有当前节点的 Knowledge Review。',
      nextAction: input.latestAgentReview ? '在 Inspector 中核对 advisory。' : '需要时从 Inspector 进入 Agents。',
      impact: 'Review input for Gate',
    })
  }

  descriptors.push({
    id: 'test-evidence',
    label: 'Test Evidence',
    state: input.artifacts.some((artifact) => artifact.kind === 'test_report') ? 'success' : 'empty',
    tone: input.artifacts.some((artifact) => artifact.kind === 'test_report') ? 'good' : 'soft',
    summary: input.artifacts.some((artifact) => artifact.kind === 'test_report')
      ? '当前节点已有测试报告 Artifact。'
      : '当前节点尚未归档 Test Evidence。',
    nextAction: '从 Inspector 进入 Tests 执行或查看证据。',
    impact: 'Testing Gate / Evidence rollup',
  })

  descriptors.push({
    id: 'budget',
    label: 'Budget guard',
    state: input.node.stage === 'build' ? 'over budget approval' : 'default',
    tone: input.node.stage === 'build' ? 'warn' : 'soft',
    summary: input.node.stage === 'build'
      ? '真实 runtime 可能需要 lead approval 后才能继续。'
      : '当前节点没有活跃 runtime budget 请求。',
    nextAction: input.node.stage === 'build' ? '在 Agents 中填写 approval id 后重试。' : '无需预算动作。',
    impact: 'Coding Agent runtime',
  })

  return descriptors
}

export function buildGateRequirementMatrix(input: {
  node: WorkflowNode
  artifacts: Artifact[]
  latestAgentReview: Pick<AgentReviewResult, 'gateAdvisory'> | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
}): GateRequirementRow[] {
  const hasTestArtifact = input.artifacts.some((artifact) => artifact.kind === 'test_report')

  return [
    {
      label: 'Policy snapshot',
      state: input.isLoadingGateEnforcement
        ? 'loading'
        : input.policySnapshot
          ? `v${input.policySnapshot.version}`
          : input.gateEnforcementDecision?.status === 'blocked_policy_unavailable'
            ? 'unavailable'
            : 'not loaded',
      tone: input.policySnapshot ? 'good' : input.isLoadingGateEnforcement ? 'warn' : 'bad',
      summary: input.policySnapshot
        ? `${input.policySnapshot.source} · synced ${input.policySnapshot.syncedAt}`
        : 'Team policy snapshot 未加载时，Gate 写路径保持 hard-block。',
    },
    {
      label: 'Role permission',
      state: input.canApprove ? 'allowed' : 'lead required',
      tone: input.canApprove ? 'good' : 'warn',
      summary: input.canApprove ? '当前用户可执行 Gate approval。' : '当前用户无法直接 approve，需要 lead/reviewer 权限。',
    },
    {
      label: 'Knowledge Review',
      state: input.latestAgentReview ? 'ready' : 'missing',
      tone: input.latestAgentReview ? 'good' : 'bad',
      summary: input.latestAgentReview
        ? input.latestAgentReview.gateAdvisory.summary
        : '需要从 Agents 运行 review，生成 Gate Advisory 与引用来源。',
    },
    {
      label: 'Test Evidence',
      state: hasTestArtifact ? 'saved' : 'missing',
      tone: hasTestArtifact ? 'good' : 'warn',
      summary: hasTestArtifact ? '测试报告已归档为 Artifact。' : '需要从 Tests 保存 command/status/exit/duration 摘要。',
    },
    {
      label: 'Budget',
      state: input.node.stage === 'build' ? 'approval guarded' : 'not active',
      tone: input.node.stage === 'build' ? 'warn' : 'soft',
      summary: input.node.stage === 'build'
        ? '真实 runtime 超预算时必须等 lead approval id。'
        : '当前节点没有活跃 runtime budget 请求。',
    },
    {
      label: 'Required Artifact',
      state: input.artifacts.length > 0 ? `${input.artifacts.length} linked` : 'missing',
      tone: input.artifacts.length > 0 ? 'good' : 'soft',
      summary: input.artifacts.length > 0
        ? 'Artifact 作为 Gate / Delivery 的证据附件展示。'
        : '当前节点还没有可交付 Artifact。',
    },
  ]
}

function buildActionCatalog(node: WorkflowNode): Record<InspectorActionId, InspectorAction> {
  return {
    openKnowledgeReview: {
      id: 'openKnowledgeReview',
      label: '去 Agents 运行 Review',
      variant: 'primary',
      disabledReasons: ['running_agent_review'],
    },
    openTests: {
      id: 'openTests',
      label: '去 Tests 执行本地测试',
      variant: 'ghost',
      disabledReasons: ['running_tests'],
    },
    completeAgent: {
      id: 'completeAgent',
      label: node.stage === 'design' ? '生成设计方案' : '生成需求澄清',
      variant: 'primary',
      disabledReasons: ['requires_current_node'],
      testId: node.stage === 'design' ? 'complete-design-agent' : 'complete-clarify-agent',
    },
    approveGate: {
      id: 'approveGate',
      label: '通过 Gate',
      variant: 'primary',
      disabledReasons: ['gate_permission_missing'],
    },
    runCodingAgent: {
      id: 'runCodingAgent',
      label: 'Coding Agent',
      variant: 'ghost',
      disabledReasons: ['starting_coding_agent'],
    },
    createPrDraft: {
      id: 'createPrDraft',
      label: '生成 PR Draft',
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

function buildNextAction(node: WorkflowNode): InspectorNextAction {
  return {
    title: node.status === 'blocked'
      ? node.kind === 'gate'
        ? '补齐设计假设、同步团队策略并运行 Knowledge Review'
        : '补齐当前节点阻断证据'
      : node.kind === 'pr'
        ? '生成 PR Draft 并核对 Evidence chain'
        : node.kind === 'acceptance'
          ? '汇总 Acceptance Bundle'
          : '推进当前 Run 的下一步',
    copy: node.kind === 'gate'
      ? 'Gate 会根据 Team policy、review、evidence、role、budget 写路径重新计算，不能只靠 UI 状态通过。'
      : '当前节点的 Artifact、Evidence 与 Trace 会在完成后回写到 Workbench Inspector。',
    recommendedActionIds: ['openKnowledgeReview', 'openTests'],
  }
}

export function buildNodeInspectorViewModel(input: {
  node: WorkflowNode
  requestedTab: string
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  events: AgentEvent[]
  latestAgentReview: AgentReviewResult | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
}): NodeInspectorViewModel {
  const visualKind = getBoardNodeKind(input.node)
  const tabs = inspectorTabPlansByKind[visualKind]
  const activeTab = tabs.find((tab) => tab.tabId === input.requestedTab || tab.label === input.requestedTab) ?? tabs[0]!
  const actionCatalog = buildActionCatalog(input.node)
  const actions: InspectorAction[] = []

  if (input.node.kind === 'agent' && (input.node.stage === 'clarify' || input.node.stage === 'design') && input.isSelectedCurrentNode) {
    actions.push(actionCatalog.completeAgent)
  }
  actions.push(actionCatalog.approveGate)
  if (canRunCodingAgentOnNode(input.node)) {
    actions.push(actionCatalog.runCodingAgent)
  }
  if (input.node.kind === 'pr') {
    actions.push(actionCatalog.createPrDraft)
  }
  if (input.node.kind === 'acceptance') {
    actions.push(actionCatalog.createAcceptanceBundle)
  }

  return {
    header: {
      title: displayNodeTitle(input.node),
      subtitle: displayNodeSubtitle(input.node),
      stageLabel: stageLabels[input.node.stage],
      visualKind,
      statusLabel: getNodeStatusLabel(input.node.status),
      statusTone: getNodeStatusTone(input.node.status),
    },
    visualKind,
    tabs,
    activeTab,
    nextAction: buildNextAction(input.node),
    actionCatalog,
    actions,
    statusDescriptors: buildStatusDescriptors({
      node: input.node,
      visualKind,
      artifacts: input.artifacts,
      events: input.events,
      latestAgentReview: input.latestAgentReview,
      policySnapshot: input.policySnapshot,
      gateEnforcementDecision: input.gateEnforcementDecision,
      isLoadingGateEnforcement: input.isLoadingGateEnforcement,
    }),
    gateRequirementRows: buildGateRequirementMatrix({
      node: input.node,
      artifacts: input.artifacts,
      latestAgentReview: input.latestAgentReview,
      policySnapshot: input.policySnapshot,
      gateEnforcementDecision: input.gateEnforcementDecision,
      isLoadingGateEnforcement: input.isLoadingGateEnforcement,
      canApprove: input.canApprove,
    }),
  }
}
