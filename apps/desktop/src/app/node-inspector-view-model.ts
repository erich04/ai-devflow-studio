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
  | 'gateImpactSummary'
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
  primaryActionId?: InspectorActionId
  secondaryActionIds: InspectorActionId[]
}

export type InspectorTabPlan = {
  tabId: string
  label: string
  sections: InspectorSectionId[]
}

export type InspectorNodeType =
  | 'clarification'
  | 'designReview'
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

export function getInspectorNodeType(node: WorkflowNode): InspectorNodeType {
  if (node.kind === 'agent' && node.stage === 'clarify') {
    return 'clarification'
  }
  if (node.kind === 'agent' && node.stage === 'design') {
    return 'designReview'
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

export const inspectorTabPlansByNodeType: Record<InspectorNodeType, InspectorTabPlan[]> = {
  clarification: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary'] },
    { tabId: '产物', label: '产物', sections: ['artifacts'] },
    { tabId: 'Trace', label: 'Trace', sections: ['trace'] },
    { tabId: 'Gate影响', label: 'Gate影响', sections: ['gateImpactSummary'] },
  ],
  designReview: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary'] },
    { tabId: 'Knowledge Review', label: 'Knowledge Review', sections: ['agentReview'] },
    { tabId: '引用来源', label: '引用来源', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
  ],
  gate: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'governance', 'agentReview', 'artifacts'] },
    { tabId: 'Gate条件', label: 'Gate条件', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Remediation', label: 'Remediation', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
  ],
  build: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary'] },
    { tabId: '产物', label: '产物', sections: ['artifacts'] },
    { tabId: 'Trace', label: 'Trace', sections: ['trace'] },
    { tabId: 'Gate影响', label: 'Gate影响', sections: ['gateImpactSummary'] },
  ],
  test: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary'] },
    { tabId: 'Test Evidence', label: 'Test Evidence', sections: ['artifacts'] },
    { tabId: 'Trace', label: 'Trace', sections: ['trace'] },
  ],
  pr: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'deliveryHandoff'] },
    { tabId: 'Artifacts', label: 'Artifacts', sections: ['artifacts'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Handoff', label: 'Handoff', sections: ['deliveryHandoff', 'trace'] },
  ],
  acceptance: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary', 'gateEnforcementPanel', 'deliveryHandoff'] },
    { tabId: 'Artifacts', label: 'Artifacts', sections: ['artifacts'] },
    { tabId: 'Evidence', label: 'Evidence', sections: ['governance', 'artifacts', 'agentReview'] },
    { tabId: 'Final Gate', label: 'Final Gate', sections: ['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'] },
  ],
  task: [
    { tabId: '状态', label: '状态', sections: ['statusMatrix', 'nodeSummary'] },
    { tabId: '产物', label: '产物', sections: ['artifacts'] },
    { tabId: 'Trace', label: 'Trace', sections: ['trace'] },
  ],
}

export const inspectorTabPlansByKind: Record<BoardNodeKind, InspectorTabPlan[]> = {
  Task: inspectorTabPlansByNodeType.clarification,
  Gate: inspectorTabPlansByNodeType.gate,
  Review: inspectorTabPlansByNodeType.designReview,
  Delivery: inspectorTabPlansByNodeType.pr,
}

export const inspectorTabsByKind: Record<BoardNodeKind, string[]> = {
  Task: inspectorTabPlansByKind.Task.map((tab) => tab.label),
  Gate: inspectorTabPlansByKind.Gate.map((tab) => tab.label),
  Review: inspectorTabPlansByKind.Review.map((tab) => tab.label),
  Delivery: inspectorTabPlansByKind.Delivery.map((tab) => tab.label),
}

export const inspectorTabsByNodeType: Record<InspectorNodeType, string[]> = {
  clarification: inspectorTabPlansByNodeType.clarification.map((tab) => tab.label),
  designReview: inspectorTabPlansByNodeType.designReview.map((tab) => tab.label),
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
  const tabs = inspectorTabsByNodeType[getInspectorNodeType(node)]
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
  canApprove: boolean
}): StatusDescriptor[] {
  const nodeType = getInspectorNodeType(input.node)
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
    nextAction: input.node.status === 'blocked' ? '查看阻断原因并补齐当前节点需要的输入。' : '按顶部主动作推进当前节点。',
    impact: `${stageLabels[input.node.stage]} · ${input.visualKind}`,
  })
  const traceStatus = (impact = 'Trace'): StatusDescriptor => ({
    id: 'trace',
    label: 'Trace',
    state: hasTrace ? `${input.events.length} events` : 'empty',
    tone: hasTrace ? 'good' : 'soft',
    summary: hasTrace ? `当前节点已有 ${input.events.length} 条执行记录。` : '当前节点还没有执行 Trace。',
    nextAction: hasTrace ? '查看 Trace tab 复核执行过程。' : '执行当前节点动作后会写入 Trace。',
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
  ): StatusDescriptor => {
    const artifact = artifactForKind(kind)
    const ready = Boolean(artifact)
    const provenance = artifactProvenance(artifact)

    return {
      id,
      label,
      state: ready ? 'ready' : 'empty',
      tone: ready ? 'good' : 'soft',
      summary: ready ? `${readySummary}${provenance ? ` ${provenance}。` : ''}` : emptySummary,
      nextAction: ready ? '在产物或 Evidence tab 中核对内容。' : nextAction,
      impact,
    }
  }
  const decision = input.gateEnforcementDecision
  const gateDecisionStatus = (): StatusDescriptor => ({
    id: 'gate-decision',
    label: nodeType === 'acceptance' ? '验收 Gate 结论' : 'Gate 结论',
    state: input.isLoadingGateEnforcement ? 'loading' : (decision?.status ?? 'empty'),
    tone: input.isLoadingGateEnforcement
      ? 'warn'
      : decision?.status === 'blocked' || decision?.status === 'hard_blocked' || decision?.status === 'blocked_policy_unavailable'
        ? 'bad'
        : decision?.status === 'warn' || decision?.status === 'overridden'
          ? 'warn'
          : decision
            ? 'good'
            : 'soft',
    summary: decision
      ? decision.blocksApproval
        ? '当前 Gate 评估会阻止审批。'
        : '当前 Gate 评估允许继续审批。'
      : '当前 Gate 尚未完成策略评估。',
    nextAction: decision?.blocksApproval ? '查看 Gate 条件与 Remediation。' : '确认条件后通过 Gate。',
    impact: 'Gate decision',
  })
  const policyStatus = (): StatusDescriptor => ({
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
  const approvalStatus = (): StatusDescriptor => ({
    id: 'approval-permission',
    label: '审批权限',
    state: input.canApprove ? 'allowed' : 'blocked',
    tone: input.canApprove ? 'good' : 'warn',
    summary: input.canApprove ? '当前用户与 policy 状态允许执行 Gate approval。' : '当前用户或 policy 状态暂不允许通过 Gate。',
    nextAction: input.canApprove ? '可以执行顶部 Gate 主动作。' : '查看角色、policy 或缺失证据。',
    impact: 'Role / policy',
  })
  const reviewStatus = (gateScoped: boolean): StatusDescriptor => {
    const missingReview = decision?.blockingReasons.some((reason) => reason.target === 'missing_agent_review')
    if (gateScoped && missingReview) {
      return {
        id: 'missing-agent-review',
        label: 'Knowledge Review',
        state: 'missing agent review',
        tone: 'bad',
        summary: 'Gate 缺少 Knowledge Review 结果。',
        nextAction: '从 Inspector 跳到 Agents 运行 Knowledge Review。',
        impact: 'Gate Advisory / Review Evidence',
      }
    }

    return {
      id: 'knowledge-review',
      label: 'Knowledge Review',
      state: input.latestAgentReview ? 'success' : 'empty',
      tone: input.latestAgentReview ? 'good' : 'soft',
      summary: input.latestAgentReview ? '已有 Knowledge Review advisory。' : gateScoped ? 'Gate 还没有 Knowledge Review。' : '当前节点还没有 Knowledge Review。',
      nextAction: input.latestAgentReview ? '在 Inspector 中核对 advisory。' : '需要时从 Inspector 进入 Agents。',
      impact: gateScoped ? 'Review input for Gate' : 'Review / references',
    }
  }
  const testEvidenceStatus = (gateScoped: boolean): StatusDescriptor => ({
    id: 'test-evidence',
    label: 'Test Evidence',
    state: hasArtifactKind('test_report') ? 'success' : 'empty',
    tone: hasArtifactKind('test_report') ? 'good' : gateScoped ? 'warn' : 'soft',
    summary: hasArtifactKind('test_report')
      ? '当前节点已有测试报告 Artifact。'
      : gateScoped ? 'Gate 还没有可用 Test Evidence。' : '当前节点尚未归档 Test Evidence。',
    nextAction: '从 Inspector 进入 Tests 执行或查看证据。',
    impact: gateScoped ? 'Testing Gate / Evidence rollup' : 'Test result',
  })
  const budgetStatus = (): StatusDescriptor => ({
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
  const requiredArtifactStatus = (): StatusDescriptor => ({
    id: 'required-artifact',
    label: 'Required Artifact',
    state: input.artifacts.length > 0 ? `${input.artifacts.length} linked` : 'missing',
    tone: input.artifacts.length > 0 ? 'good' : 'soft',
    summary: input.artifacts.length > 0 ? '当前 Gate 已关联上游 Artifact。' : '当前 Gate 还没有关联可交付 Artifact。',
    nextAction: input.artifacts.length > 0 ? '核对 Evidence 与 Gate 条件。' : '先完成上游节点产物。',
    impact: 'Gate evidence',
  })

  if (nodeType === 'clarification') {
    return [
      nodeStatus(),
      artifactStatus('raw-request', '需求输入', 'raw_request', '已创建 Run，但当前节点没有关联原始需求 Artifact。', '原始需求已经记录。', '确认 Run 创建输入是否完整。', 'Run intake'),
      artifactStatus('clarification-artifact', '澄清产物', 'clarification', '还没有生成需求澄清产物。', '需求澄清产物已经生成。', '点击顶部“生成需求澄清”。', 'Clarification output'),
      traceStatus('Agent trace'),
    ]
  }

  if (nodeType === 'designReview') {
    return [
      nodeStatus(),
      artifactStatus('design-artifact', '设计产物', 'design', '还没有生成设计方案。', '设计方案已经生成。', '点击顶部“生成设计方案”。', 'Design output'),
      reviewStatus(false),
      traceStatus('Review trace'),
    ]
  }

  if (nodeType === 'gate') {
    return [
      gateDecisionStatus(),
      policyStatus(),
      approvalStatus(),
      reviewStatus(true),
      testEvidenceStatus(true),
      requiredArtifactStatus(),
    ]
  }

  if (nodeType === 'build') {
    return [
      nodeStatus(),
      artifactStatus('coding-diff', 'Coding diff', 'diff', '还没有实现 diff。', '实现 diff 已归档。', '点击顶部“Coding Agent”。', 'Implementation output'),
      traceStatus('Coding runtime trace'),
      budgetStatus(),
    ]
  }

  if (nodeType === 'test') {
    return [
      nodeStatus(),
      testEvidenceStatus(false),
      artifactStatus('test-report', '测试报告', 'test_report', '还没有测试报告 Artifact。', '测试报告已归档。', '点击顶部“执行本地测试”。', 'Test output'),
      traceStatus('Test trace'),
    ]
  }

  if (nodeType === 'pr') {
    return [
      nodeStatus(),
      artifactStatus('pr-draft', 'PR Draft', 'pr', '还没有 PR Draft。', 'PR Draft 已生成。', '点击顶部“生成 PR Draft”。', 'Delivery draft'),
      testEvidenceStatus(false),
      artifactStatus('handoff-evidence', 'Handoff readiness', 'diff', '还没有实现 diff 可用于交付摘要。', '已有实现 diff 可汇总到 handoff。', '先完成 build/test，再生成 PR Draft。', 'Delivery evidence'),
    ]
  }

  if (nodeType === 'acceptance') {
    return [
      nodeStatus(),
      artifactStatus('acceptance-bundle', 'Acceptance Bundle', 'acceptance', '还没有验收证据包。', '验收证据包已生成。', '点击顶部“生成验收证据包”。', 'Acceptance handoff'),
      testEvidenceStatus(false),
      gateDecisionStatus(),
    ]
  }

  return [nodeStatus(), traceStatus()]
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
      variant: 'ghost',
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

function hasTestArtifact(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'test_report')
}

function hasAcceptanceArtifact(artifacts: Artifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'acceptance')
}

function buildGateSecondaryActionIds(input: {
  artifacts: Artifact[]
  latestAgentReview: AgentReviewResult | undefined
}): InspectorActionId[] {
  const actionIds: InspectorActionId[] = []

  if (!input.latestAgentReview) {
    actionIds.push('openKnowledgeReview')
  }
  if (!hasTestArtifact(input.artifacts)) {
    actionIds.push('openTests')
  }

  return actionIds
}

function buildNextAction(input: {
  node: WorkflowNode
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  latestAgentReview: AgentReviewResult | undefined
  canApprove: boolean
}): InspectorNextAction {
  const { node } = input

  if (node.status === 'success') {
    return {
      title: '查看已完成证据',
      copy: '该节点已经完成，Inspector 会保留产物、证据和 Trace 供核对。',
      secondaryActionIds: [],
    }
  }

  if (!input.isSelectedCurrentNode) {
    return {
      title: '等待上游节点',
      copy: '这个节点还不是当前 Run 的当前步骤。先完成上游节点后，再执行这里的主动作。',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'agent' && node.stage === 'clarify') {
    return {
      title: '生成需求澄清',
      copy: '运行当前澄清 Agent，补齐验收口径、非目标和后续 Gate 所需证据。',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'agent' && node.stage === 'design') {
    return {
      title: '生成设计方案',
      copy: '运行当前设计 Agent，产出方案、测试策略和进入方案评审 Gate 的依据。',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'gate') {
    return {
      title: '通过 Gate',
      copy: input.canApprove
        ? '确认 Gate 条件、Review、Tests 和 Evidence 后，通过当前 Gate 进入下一节点。'
        : '当前 Gate 还不能通过，请查看 Gate 条件拆解并补齐角色、Review、Tests 或 policy 条件。',
      primaryActionId: 'approveGate',
      secondaryActionIds: buildGateSecondaryActionIds(input),
    }
  }

  if (canRunCodingAgentOnNode(node)) {
    return {
      title: '启动 Coding Agent',
      copy: '把当前实现任务交给本地 Coding Agent，生成受控 diff 并回写执行轨迹。',
      primaryActionId: 'runCodingAgent',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'test' || node.stage === 'test') {
    return {
      title: '执行本地测试',
      copy: '进入 Tests 执行项目测试命令，并把结果保存为 Test Evidence。',
      primaryActionId: 'openTests',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'pr') {
    return {
      title: '生成 PR Draft',
      copy: '汇总当前 Run 的产物和证据，生成可检查的 PR 草稿。',
      primaryActionId: 'createPrDraft',
      secondaryActionIds: [],
    }
  }

  if (node.kind === 'acceptance') {
    if (!hasAcceptanceArtifact(input.artifacts)) {
      return {
        title: '生成验收证据包',
        copy: '先汇总最终交付证据，再进入业务验收审批。',
        primaryActionId: 'createAcceptanceBundle',
        secondaryActionIds: [],
      }
    }

    return {
      title: '通过 Gate',
      copy: input.canApprove
        ? '验收证据包已经生成，确认后通过业务验收 Gate。'
        : '验收证据包已经生成，但当前用户还没有通过业务验收 Gate 的权限。',
      primaryActionId: 'approveGate',
      secondaryActionIds: [],
    }
  }

  return {
    title: '查看当前节点状态',
    copy: '该节点当前没有可直接执行的主动作，请查看状态、产物和 Trace。',
    secondaryActionIds: [],
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
  const nodeType = getInspectorNodeType(input.node)
  const tabs = inspectorTabPlansByNodeType[nodeType]
  const activeTab = tabs.find((tab) => tab.tabId === input.requestedTab || tab.label === input.requestedTab) ?? tabs[0]!
  const actionCatalog = buildActionCatalog(input.node)
  const nextAction = buildNextAction(input)
  const actionIds: InspectorActionId[] = []
  const addAction = (actionId: InspectorActionId) => {
    if (actionId === nextAction.primaryActionId || actionIds.includes(actionId)) {
      return
    }
    actionIds.push(actionId)
  }

  if (canRunCodingAgentOnNode(input.node)) {
    addAction('runCodingAgent')
  }
  if (input.node.kind === 'pr') {
    addAction('createPrDraft')
  }
  if (input.node.kind === 'acceptance') {
    addAction('createAcceptanceBundle')
    if (hasAcceptanceArtifact(input.artifacts)) {
      addAction('approveGate')
    }
  }
  const actions = actionIds.map((actionId) => actionCatalog[actionId])

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
    nextAction,
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
      canApprove: input.canApprove,
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
