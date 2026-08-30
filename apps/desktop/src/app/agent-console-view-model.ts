import {
  canRunKnowledgeReviewOnNode,
  formatUsd,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingRuntimeCostSummary,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type ManagedCodingWorkspace,
  type RetryAttempt,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  buildAgentProviderDataSource,
  buildWorkflowNodePresentation,
  codingRuntimeLabel,
  codingTerminalLabel,
  codingTraceMetadataString,
  codingTraceSourceLabel,
  displayNodeTitle,
  stageLabels,
  type FieldDataSource,
} from './desktop-view-model'
import type { PendingInspectorAction } from './node-inspector-view-model'
import type { CodingRuntimeActionProjection } from './coding-runtime-action-projection'

export type AgentConsoleTone = 'good' | 'warn' | 'bad' | 'soft' | 'accent' | 'neutral'

export type AgentConsolePrimaryActionId =
  | 'complete-agent-node'
  | 'run-review'
  | 'run-coding'
  | 'view-coding'
  | 'configure-coding'
  | 'go-tests'
  | 'return-workbench'
  | 'resolve-permission'

export type AgentConsoleAction = {
  id: AgentConsolePrimaryActionId
  label: string
  summary: string
  tone: AgentConsoleTone
  disabled: boolean
  disabledReason?: string
}

export type AgentConsoleAdvisorySummary = {
  label: string
  summary: string
  tone: AgentConsoleTone
  detail: string
}

export type AgentConsolePrimaryActionImpact = {
  object: string
  result: string
  providerAndCost: string
  repository: string
  workflow: string
}

export type AgentConsolePathStatus = {
  id: 'review' | 'coding'
  label: string
  title: string
  summary: string
  tone: AgentConsoleTone
  emphasis: 'primary' | 'secondary'
  facts: Array<{ label: string; value: string }>
  disabledReason?: string
}

export type AgentConsoleEvidenceItem = {
  id: string
  eyebrow: string
  title: string
  body: string
  meta: string[]
}

export type AgentConsoleEvidenceGroup = {
  id: string
  title: string
  summary: string
  tone: AgentConsoleTone
  items: AgentConsoleEvidenceItem[]
}

export type AgentConsoleRuntimeSettings = {
  summary: string
  providerDataSource: FieldDataSource
  selectedProvider: AgentProviderConfig | undefined
  providerMode: string
  fields: Array<{ label: string; value: string }>
}

export type AgentConsoleViewModel = {
  title: string
  currentTarget: {
    runTitle: string
    nodeTitle: string
    stageLabel: string
    nodeKind: string
    nodeStatus: string
  }
  primaryAction: AgentConsoleAction
  primaryActionImpact: AgentConsolePrimaryActionImpact
  advisory: AgentConsoleAdvisorySummary
  pendingPermission: CodingPermissionRequest | undefined
  pathStatuses: AgentConsolePathStatus[]
  evidenceGroups: AgentConsoleEvidenceGroup[]
  reviewHistoryCount: number
  runtimeSettings: AgentConsoleRuntimeSettings
}

export type BuildAgentConsoleViewModelInput = {
  providers: AgentProviderConfig[]
  selectedProviderId: string
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  reviews: AgentReviewResult[]
  selectedReviews: AgentReviewResult[]
  latestReview: AgentReviewResult | undefined
  latestTrace: AgentTrace | undefined
  latestUsage: AgentTokenUsage | undefined
  isRunningReview: boolean
  isStartingCodingAgent: boolean
  isRunningTests: boolean
  pendingInspectorAction: PendingInspectorAction | null
  codingRuns: CodingAgentRun[]
  retryAttempts: RetryAttempt[]
  latestCodingRun: CodingAgentRun | undefined
  codingEvents: CodingAgentEvent[]
  pendingCodingPermission: CodingPermissionRequest | undefined
  permissionRequests: CodingPermissionRequest[]
  workspace: ManagedCodingWorkspace | undefined
  diff: CodingDiffArtifact | undefined
  bootstrapEvidence: DependencyBootstrapEvidence | undefined
  testEvidence: TestEvidence | undefined
  codingActionProjection?: CodingRuntimeActionProjection
}

export function buildAgentConsoleViewModel(input: BuildAgentConsoleViewModelInput): AgentConsoleViewModel {
  const selectedProvider = input.providers.find((provider) => provider.id === input.selectedProviderId) ?? input.providers[0]
  const providerDataSource = buildAgentProviderDataSource(selectedProvider)
  const currentTarget = buildCurrentTarget(input.selectedRun, input.selectedNode)
  const primaryAction = buildPrimaryAction({
    selectedProvider,
    selectedRun: input.selectedRun,
    selectedNode: input.selectedNode,
    isRunningReview: input.isRunningReview,
    isStartingCodingAgent: input.isStartingCodingAgent,
    isRunningTests: input.isRunningTests,
    pendingInspectorAction: input.pendingInspectorAction,
    pendingCodingPermission: input.pendingCodingPermission,
    ...(input.codingActionProjection ? { codingActionProjection: input.codingActionProjection } : {}),
  })
  const advisory = buildAdvisorySummary(input.latestReview, input.selectedNode, input.pendingCodingPermission)
  const primaryActionImpact = buildPrimaryActionImpact({
    action: primaryAction,
    run: input.selectedRun,
    node: input.selectedNode,
    provider: selectedProvider,
  })

  return {
    title: 'Agent 执行台',
    currentTarget,
    primaryAction,
    primaryActionImpact,
    advisory,
    pendingPermission: input.pendingCodingPermission,
    pathStatuses: buildPathStatuses({
      primaryAction,
      latestReview: input.latestReview,
      latestCodingRun: input.latestCodingRun,
      selectedProvider,
      selectedReviews: input.selectedReviews,
      codingRuns: input.codingRuns,
      retryAttempts: input.retryAttempts,
      latestUsage: input.latestUsage,
      selectedNode: input.selectedNode,
    }),
    evidenceGroups: buildEvidenceGroups(input),
    reviewHistoryCount: input.selectedReviews.length,
    runtimeSettings: {
      summary: selectedProvider ? `当前 Agent Provider：${selectedProvider.name}` : '尚未选择 Agent Provider',
      providerDataSource,
      selectedProvider,
      providerMode: buildProviderModeLabel(selectedProvider),
      fields: [
        { label: '当前 Provider', value: selectedProvider?.name ?? '未选择' },
        { label: '审查总数', value: String(input.reviews.length) },
        { label: 'Coding Run 数', value: String(input.codingRuns.length) },
        { label: '权限请求数', value: String(input.permissionRequests.length) },
      ],
    },
  }
}

function buildPrimaryActionImpact(input: {
  action: AgentConsoleAction
  run: WorkflowRun | undefined
  node: WorkflowNode | undefined
  provider: AgentProviderConfig | undefined
}): AgentConsolePrimaryActionImpact {
  const object = `${input.run?.title ?? '未选择 Run'} · ${input.node ? displayNodeTitle(input.node) : '未选择节点'}`
  const provider = input.provider
    ? `${input.provider.name} / ${input.provider.model}`
    : '尚未配置 Provider'

  if (input.action.id === 'complete-agent-node') {
    const isDesign = input.node?.stage === 'design'
    return {
      object,
      result: isDesign
        ? '生成设计方案 Artifact（阶段产物）和测试策略。'
        : '生成需求澄清 Artifact（阶段产物）和验收边界。',
      providerAndCost: `调用 ${provider}；会记录 token，并可能产生 Provider 费用。`,
      repository: '只读检查仓库上下文，不修改仓库文件。',
      workflow: isDesign
        ? '成功后完成当前设计节点，并推进到方案评审 Gate；不会自动批准 Gate。'
        : '成功后完成当前澄清节点，并推进到需求确认 Gate；不会自动批准 Gate。',
    }
  }

  if (input.action.id === 'run-review') {
    return {
      object,
      result: '生成基于知识的门禁审查结论、引用和 Trace（执行轨迹）。',
      providerAndCost: `调用 ${provider}；会记录 token，并可能产生 Provider 费用。`,
      repository: '只读使用已索引 Knowledge（知识）与阶段证据，不修改仓库文件。',
      workflow: '只提供 Gate 建议，不会批准 Gate，也不会推进 Workflow（工作流）。',
    }
  }

  if (input.action.id === 'run-coding') {
    return {
      object,
      result: '新建受控 Coding Run，归档执行轨迹、修改差异和测试证据。',
      providerAndCost: '调用项目级 Coding Executor / Provider；按每次模型调用记录 token 和费用。',
      repository: '仅在受管 worktree（工作树）中读写；不会直接修改用户当前 checkout。',
      workflow: '成功后完成开发实现节点所需证据；不会自动批准后续 Gate。',
    }
  }

  if (input.action.id === 'resolve-permission') {
    return {
      object,
      result: '仅对当前 Coding Run 的精确权限请求作出批准或拒绝决定。',
      providerAndCost: '决定本身不调用 Provider；批准后恢复的 Run 可能继续消耗 token 和费用。',
      repository: '拒绝不会写入；批准只允许请求中列明的受管工作区副作用。',
      workflow: '仅恢复或终止当前 Coding Run；等待其终态后才会影响开发实现进度。',
    }
  }

  if (input.action.id === 'go-tests') {
    return {
      object,
      result: '进入 Tests（测试）模块，运行本地命令并归档 Test Evidence（测试证据）。',
      providerAndCost: '不调用模型 Provider，不产生模型 token 费用。',
      repository: '不主动修改源文件；测试工具可能生成其自身缓存或临时文件。',
      workflow: '通过可信测试路径回写证据，并按现有规则推进测试节点；不会审批 Gate。',
    }
  }

  if (input.action.id === 'view-coding') {
    return {
      object,
      result: '查看已有 Coding Run 的状态、终态原因、差异、测试与费用证据。',
      providerAndCost: '只读取已结算证据，不发起新的 Provider 调用或费用。',
      repository: '只查看受管工作区和归档证据，不新增仓库修改。',
      workflow: '不改变 Workflow（工作流）状态。',
    }
  }

  if (input.action.id === 'configure-coding') {
    return {
      object,
      result: '打开当前项目的 Coding Executor、Provider 与预算配置。',
      providerAndCost: '保存配置不调用 Provider；未来 Coding Run 才可能产生 token 和费用。',
      repository: '不读写仓库内容，只保存项目级运行配置。',
      workflow: '不改变 Workflow（工作流）状态；配置完成后才可启动 Coding Run。',
    }
  }

  if (input.action.id === 'return-workbench') {
    return {
      object,
      result: '返回 Workbench（工作台）检查当前节点或选择其他 Run。',
      providerAndCost: '不调用 Provider，不产生费用。',
      repository: '不访问或修改仓库。',
      workflow: '仅导航，不改变 Workflow（工作流）状态。',
    }
  }

  return {
    object,
    result: input.action.summary,
    providerAndCost: '是否调用 Provider 及产生费用取决于当前操作和项目配置。',
    repository: '执行前请核对当前操作的仓库边界。',
    workflow: '执行前请核对当前操作对 Workflow（工作流）的影响。',
  }
}

function buildCurrentTarget(run: WorkflowRun | undefined, node: WorkflowNode | undefined): AgentConsoleViewModel['currentTarget'] {
  const presentation = node ? buildWorkflowNodePresentation(node) : undefined
  return {
    runTitle: run?.title ?? '尚未选择 Run',
    nodeTitle: node ? displayNodeTitle(node) : '尚未选择节点',
    stageLabel: node ? stageLabels[node.stage] : '尚未选择阶段',
    nodeKind: presentation ? `${presentation.nodeKindLabel}（${nodeKindChinese(presentation.nodeKindLabel)}）` : '尚未选择类型',
    nodeStatus: presentation?.statusLabel ?? '尚未选择状态',
  }
}

function nodeKindChinese(kind: string): string {
  return {
    Task: '任务',
    Gate: '门禁',
    Review: '审查',
    Test: '测试',
    Delivery: '交付',
    Acceptance: '验收',
  }[kind] ?? '节点'
}

function buildPrimaryAction(input: {
  selectedProvider: AgentProviderConfig | undefined
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  isRunningReview: boolean
  isStartingCodingAgent: boolean
  isRunningTests: boolean
  pendingInspectorAction: PendingInspectorAction | null
  pendingCodingPermission: CodingPermissionRequest | undefined
  codingActionProjection?: CodingRuntimeActionProjection
}): AgentConsoleAction {
  if (input.codingActionProjection && input.selectedNode && isBuildTask(input.selectedNode)) {
    const projected = input.codingActionProjection.action
    if (projected.id === 'review-permission') {
      return {
        id: 'resolve-permission',
        label: projected.label,
        summary: projected.summary,
        tone: 'warn',
        disabled: false,
      }
    }
    if (projected.id === 'start' || projected.id === 'retry') {
      return {
        id: 'run-coding',
        label: projected.label,
        summary: projected.disabledReason ?? projected.summary,
        tone: projected.id === 'retry' ? 'warn' : 'accent',
        disabled: projected.disabled,
        ...(projected.disabledReason ? { disabledReason: projected.disabledReason } : {}),
      }
    }
    if (projected.id === 'configure') {
      return {
        id: 'configure-coding',
        label: projected.label,
        summary: projected.summary,
        tone: 'warn',
        disabled: false,
      }
    }
    if (projected.id === 'view-progress' || projected.id === 'view-result') {
      return {
        id: 'view-coding',
        label: projected.label,
        summary: projected.disabledReason ?? projected.summary,
        tone: projected.id === 'view-result' ? 'good' : 'warn',
        disabled: projected.disabled,
        ...(projected.disabledReason ? { disabledReason: projected.disabledReason } : {}),
      }
    }
  }

  if (input.pendingCodingPermission) {
    return {
      id: 'resolve-permission',
      label: '处理 Coding 权限',
      summary: 'Coding Agent 已暂停，等待批准或拒绝当前精确权限请求。',
      tone: 'warn',
      disabled: false,
    }
  }

  if (!input.selectedRun || !input.selectedNode) {
    return {
      id: 'return-workbench',
      label: '返回工作台',
      summary: '先从 Workbench 选择一个 Run 节点，再回到 Agent 执行台。',
      tone: 'soft',
      disabled: false,
    }
  }

  if (input.selectedNode.kind === 'test' || input.selectedNode.stage === 'test') {
    return {
      id: 'go-tests',
      label: '前往测试',
      summary: '测试证据在 Tests 模块执行并回写当前节点。',
      tone: 'accent',
      disabled: false,
    }
  }

  const pendingMatchesSelectedNode = Boolean(
    input.pendingInspectorAction &&
      input.selectedRun &&
      input.pendingInspectorAction.runId === input.selectedRun.id &&
      input.pendingInspectorAction.nodeId === input.selectedNode.id,
  )
  const hasInspectorWriteLock =
    Boolean(input.pendingInspectorAction) ||
    input.isRunningReview ||
    input.isStartingCodingAgent ||
    input.isRunningTests
  const writeLockReason = pendingMatchesSelectedNode
    ? '当前节点操作正在进行中。'
    : '其他 Inspector 操作正在进行中。'

  if (isBuildTask(input.selectedNode)) {
    const isBlockedByWriteLock = hasInspectorWriteLock && !input.isStartingCodingAgent
    return {
      id: 'run-coding',
      label: input.isStartingCodingAgent ? '正在启动 Coding Agent' : '启动 Coding Agent',
      summary: '通过 managed worktree 执行代码修改、权限转发、diff 和测试证据归档。',
      tone: 'accent',
      disabled: input.isStartingCodingAgent || isBlockedByWriteLock,
      ...(input.isStartingCodingAgent
        ? { disabledReason: 'Coding Agent 正在启动。' }
        : isBlockedByWriteLock
          ? { disabledReason: writeLockReason }
          : {}),
    }
  }

  const providerMissing = !input.selectedProvider
  if (isWorkflowAgentTask(input.selectedNode)) {
    const isCompletingCurrentAgent =
      pendingMatchesSelectedNode && input.pendingInspectorAction?.actionId === 'completeAgent'
    const isBlockedByWriteLock = hasInspectorWriteLock && !isCompletingCurrentAgent
    const disabledReason = providerMissing
      ? '请先配置真实 Agent Provider：Provider Name、Base URL、Model 和 API Key。'
      : isCompletingCurrentAgent
        ? '阶段产物正在生成。'
        : isBlockedByWriteLock
          ? writeLockReason
          : undefined

    return {
      id: 'complete-agent-node',
      label: isCompletingCurrentAgent
        ? '生成中'
        : input.selectedNode.stage === 'design'
          ? '生成设计方案'
          : '生成需求澄清',
      summary: input.selectedNode.stage === 'design'
        ? '运行当前设计 Agent，产出方案、测试策略和进入方案评审 Gate 的依据。'
        : '运行当前澄清 Agent，补齐验收口径、非目标和后续 Gate 所需证据。',
      tone: providerMissing ? 'warn' : 'accent',
      disabled: providerMissing || isCompletingCurrentAgent || isBlockedByWriteLock,
      ...(disabledReason ? { disabledReason } : {}),
    }
  }

  if (input.selectedNode.kind === 'pr') {
    return {
      id: 'return-workbench',
      label: '返回工作台',
      summary: 'PR 交付动作请回到 Workbench 当前 Inspector 执行。',
      tone: 'soft',
      disabled: false,
    }
  }

  if (!canRunKnowledgeReviewOnNode(input.selectedNode)) {
    return {
      id: 'return-workbench',
      label: '返回工作台',
      summary: '当前节点没有可在 Agent 执行台运行的门禁审查或 Coding 动作。',
      tone: 'soft',
      disabled: false,
    }
  }

  return {
    id: 'run-review',
    label: input.isRunningReview ? '门禁审查中' : '运行门禁审查',
    summary: '以检索到的 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物，生成 Gate Advisory、引用与 trace。',
    tone: providerMissing ? 'soft' : 'accent',
    disabled: providerMissing || input.isRunningReview || Boolean(input.pendingInspectorAction),
    ...(providerMissing
      ? { disabledReason: '请先配置真实 Agent Provider：Provider Name、Base URL、Model 和 API Key。' }
      : input.isRunningReview
        ? { disabledReason: '基于知识的门禁审查正在运行。' }
        : input.pendingInspectorAction
          ? { disabledReason: writeLockReason }
        : {}),
  }
}

function isBuildTask(node: WorkflowNode): boolean {
  return node.stage === 'build' && node.kind === 'task'
}

function isWorkflowAgentTask(node: WorkflowNode): boolean {
  return node.kind === 'agent' && (node.stage === 'clarify' || node.stage === 'design')
}

function buildAdvisorySummary(
  latestReview: AgentReviewResult | undefined,
  selectedNode: WorkflowNode | undefined,
  pendingPermission: CodingPermissionRequest | undefined,
): AgentConsoleAdvisorySummary {
  if (pendingPermission) {
    return {
      label: '需要权限',
      summary: pendingPermission.title,
      tone: 'warn',
      detail: pendingPermission.reasons.join(' '),
    }
  }

  if (latestReview) {
    const advisory = latestReview.gateAdvisory
    return {
      label: advisory.blocksApproval ? '阻止审批' : advisory.level === 'info' ? '无阻断问题' : '审查警告',
      summary: advisory.summary,
      tone: advisory.blocksApproval ? 'bad' : advisory.level === 'warn' ? 'warn' : 'good',
      detail: advisory.blocksApproval ? '阻断' : '仅警告',
    }
  }

  if (selectedNode?.kind === 'gate' || selectedNode?.kind === 'acceptance') {
    return {
      label: '尚未运行门禁审查',
      summary: '当前 Gate 尚未运行基于知识的门禁审查。Knowledge 是审查依据，Gate 条件和阶段产物是审查对象。',
      tone: 'soft',
      detail: '待审查',
    }
  }

  return {
    label: '暂无 Gate Advisory',
    summary: '当前节点还没有门禁审查结论。',
    tone: 'soft',
    detail: '无审查结论',
  }
}

function buildPathStatuses(input: {
  primaryAction: AgentConsoleAction
  latestReview: AgentReviewResult | undefined
  latestCodingRun: CodingAgentRun | undefined
  selectedProvider: AgentProviderConfig | undefined
  selectedReviews: AgentReviewResult[]
  codingRuns: CodingAgentRun[]
  retryAttempts: RetryAttempt[]
  latestUsage: AgentTokenUsage | undefined
  selectedNode: WorkflowNode | undefined
}): AgentConsolePathStatus[] {
  const paths: AgentConsolePathStatus[] = []
  const codingDisabledReason = input.selectedNode && !isBuildTask(input.selectedNode)
    ? 'Coding Agent 只能从开发实现任务启动。'
    : undefined

  if (input.selectedNode && canRunKnowledgeReviewOnNode(input.selectedNode)) {
    paths.push({
      id: 'review',
      label: '门禁审查',
      title: '基于知识的门禁审查',
      summary: input.latestReview?.summary ?? '以 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物。',
      tone: input.latestReview ? (input.latestReview.gateAdvisory.blocksApproval ? 'bad' : 'good') : 'soft',
      emphasis: 'secondary',
      facts: [
        { label: 'Provider', value: input.selectedProvider?.name ?? 'none' },
        { label: '当前节点审查', value: String(input.selectedReviews.length) },
      ],
      ...(!input.selectedProvider ? { disabledReason: '请先配置真实 Agent Provider：Provider Name、Base URL、Model 和 API Key。' } : {}),
    })
  }

  if (input.selectedNode && (isBuildTask(input.selectedNode) || input.codingRuns.length > 0)) {
    paths.push({
      id: 'coding',
      label: 'Coding',
      title: 'Coding Agent',
      summary: input.latestCodingRun?.summary ?? '创建 managed worktree，处理权限，归档 diff、bootstrap 和 test evidence。',
      tone: input.latestCodingRun
        ? input.latestCodingRun.status === 'completed'
          ? 'good'
          : input.latestCodingRun.status === 'failed' || input.latestCodingRun.status === 'timed_out'
            ? 'bad'
            : 'warn'
        : 'soft',
      emphasis: 'secondary',
      facts: [
        { label: 'Run 数', value: String(input.codingRuns.length) },
        { label: '最近状态', value: input.latestCodingRun?.status ?? '无' },
        { label: '重试数', value: String(input.retryAttempts.length) },
      ],
      ...(codingDisabledReason ? { disabledReason: codingDisabledReason } : {}),
    })
  }

  return paths
}

function buildEvidenceGroups(input: BuildAgentConsoleViewModelInput): AgentConsoleEvidenceGroup[] {
  const groups: AgentConsoleEvidenceGroup[] = []

  if (input.latestTrace?.steps.length) {
    groups.push({
      id: 'review-trace',
      title: '门禁审查 Trace',
      summary: '记录 Knowledge 检索、Gate 与阶段产物上下文、Provider 调用和审查产物创建。',
      tone: 'accent',
      items: input.latestTrace.steps.map((step) => ({
        id: step.id,
        eyebrow: step.kind,
        title: step.label,
        body: step.summary,
        meta: [step.timestamp],
      })),
    })
  }

  if (input.selectedReviews.length > 0) {
    groups.push({
      id: 'review-history',
      title: '门禁审查记录',
      summary: '当前 Run / Node 的基于知识的门禁审查记录。',
      tone: 'soft',
      items: input.selectedReviews.map((review) => ({
        id: review.id,
        eyebrow: review.runtime,
        title: review.conclusion,
        body: review.summary,
        meta: [
          input.providers.find((provider) => provider.id === review.providerId)?.name ?? '旧版 Provider',
          review.model,
          review.gateAdvisory.level,
          `${Math.round(review.confidence * 100)}%`,
        ],
      })),
    })
  }

  if (input.permissionRequests.length > 0) {
    groups.push({
      id: 'permission',
      title: '权限时间线',
      summary: '最近一次 Coding Agent Run 的权限转发请求与决定。',
      tone: input.pendingCodingPermission ? 'warn' : 'soft',
      items: input.permissionRequests.map((request) => ({
        id: request.id,
        eyebrow: request.status,
        title: request.title,
        body: request.reasons.join(' ') || [request.permission, request.command, request.filePath].filter(Boolean).join(' · '),
        meta: [request.permission, request.risk, request.command, request.filePath].filter(isPresent),
      })),
    })
  }

  const providerCallEvents = input.codingEvents.flatMap((event) => {
    const trace = recordValue(event.metadata?.providerCall)
    return trace ? [{ event, trace }] : []
  })
  if (providerCallEvents.length > 0) {
    groups.push({
      id: 'provider-call',
      title: 'Provider 调用时间线',
      summary: '按模型阶段展示持久化的请求耗时、交付状态、计费状态与安全错误分类。',
      tone: providerCallEvents.some(({ trace }) => trace.status === 'failed') ? 'warn' : 'accent',
      items: providerCallEvents.map(({ event, trace }) => providerCallEvidenceItem(event, trace)),
    })
  }

  const toolTraceEvents = input.codingEvents.filter(
    (event) =>
      (event.kind === 'tool_call' || event.kind === 'tool_result') &&
      !recordValue(event.metadata?.providerCall),
  )
  if (toolTraceEvents.length > 0) {
    groups.push({
      id: 'tool-skill',
      title: '工具 / Skill 时间线',
      summary: 'Coding Agent Runtime（运行时）公开的工具调用与结果。',
      tone: 'accent',
      items: toolTraceEvents.map((event) => {
        const toolName = codingTraceMetadataString(event.metadata, 'toolName') ?? event.kind
        const skillName = codingTraceMetadataString(event.metadata, 'skillName') ?? 'Unknown skill'
        const source = codingTraceSourceLabel(codingTraceMetadataString(event.metadata, 'source'))
        const body =
          codingTraceMetadataString(event.metadata, 'outputSummary') ??
          codingTraceMetadataString(event.metadata, 'inputSummary') ??
          event.message
        const commandSummary = codingTraceMetadataString(event.metadata, 'commandSummary')
        const filePath = codingTraceMetadataString(event.metadata, 'filePath')
        const redactionApplied = event.metadata?.redactionApplied === true

        return {
          id: event.id,
          eyebrow: source,
          title: toolName,
          body,
          meta: [skillName, commandSummary, filePath, redactionApplied ? 'Redacted' : undefined].filter(isPresent),
        }
      }),
    })
  }

  if (input.codingEvents.length > 0) {
    groups.push({
      id: 'coding-trace',
      title: 'Coding 执行轨迹',
      summary: '需求简报、权限、差异、依赖准备、测试、清理与终态事件。',
      tone: 'soft',
      items: input.codingEvents.map((event) => {
        const runtimeCost = recordValue(event.metadata?.runtimeCost)
        const runtimeCostDetails = runtimeCost ? runtimeCostTraceDetails(runtimeCost) : null
        return {
          id: event.id,
          eyebrow: event.kind,
          title: event.message,
          body: runtimeCostDetails?.body ?? event.timestamp,
          meta: [
            event.timestamp,
            ...(runtimeCostDetails?.meta ?? []),
            event.redacted ? 'redacted' : undefined,
          ].filter(isPresent),
        }
      }),
    })
  }

  if (input.diff) {
    groups.push({
      id: 'diff',
      title: '修改差异预览',
      summary: `${input.diff.changedPaths.length} 个变更路径已归档为 Coding Diff Artifact（差异产物）。`,
      tone: 'accent',
      items: [{
        id: input.diff.id,
        eyebrow: typeof input.diff.secretReplacementCount === 'number'
          ? input.diff.secretReplacementCount > 0
            ? `${input.diff.secretReplacementCount} secret replacement${input.diff.secretReplacementCount === 1 ? '' : 's'}`
            : `sanitized v${input.diff.sanitizerVersion ?? 'unknown'}`
          : input.diff.redacted
            ? 'legacy redacted diff'
            : 'unsanitized diff',
        title: input.diff.changedPaths.join(', ') || 'Coding Diff Artifact',
        body: input.diff.patch.slice(0, 1800),
        meta: [input.diff.truncated ? 'truncated' : 'full patch'],
      }],
    })
  }

  if (input.bootstrapEvidence) {
    groups.push({
      id: 'bootstrap',
      title: '依赖准备证据',
      summary: input.bootstrapEvidence.summary,
      tone: evidenceTone(input.bootstrapEvidence.status),
      items: [{
        id: input.bootstrapEvidence.id,
        eyebrow: input.bootstrapEvidence.status,
        title: input.bootstrapEvidence.command,
        body: input.bootstrapEvidence.summary,
        meta: [
          `exit ${input.bootstrapEvidence.exitCode ?? 'none'}`,
          `${input.bootstrapEvidence.durationMs}ms`,
          input.bootstrapEvidence.redacted ? 'redacted' : undefined,
        ].filter(isPresent),
      }],
    })
  }

  if (input.testEvidence) {
    groups.push({
      id: 'test-evidence',
      title: '测试证据',
      summary: input.testEvidence.summary,
      tone: evidenceTone(input.testEvidence.status),
      items: [{
        id: input.testEvidence.id,
        eyebrow: input.testEvidence.status,
        title: input.testEvidence.command,
        body: input.testEvidence.summary,
        meta: [
          `exit ${input.testEvidence.exitCode ?? 'none'}`,
          `${input.testEvidence.durationMs}ms`,
          input.testEvidence.redacted ? 'redacted' : undefined,
        ].filter(isPresent),
      }],
    })
  }

  if (input.retryAttempts.length > 0) {
    groups.push({
      id: 'retry',
      title: 'Policy 重试记录',
      summary: '由人工批准、从 Gate Policy 修复候选启动的重试。',
      tone: 'warn',
      items: input.retryAttempts.map((attempt) => ({
        id: attempt.id,
        eyebrow: attempt.status,
        title: attempt.userInstruction,
        body: attempt.candidateIds.join(', ') || attempt.remediationPlanId,
        meta: [attempt.codingRunId, attempt.completedAt ?? attempt.createdAt].filter(isPresent),
      })),
    })
  }

  const runtimeCost = input.latestCodingRun?.runtimeCostSummary
  if (runtimeCost || input.latestUsage) {
    const runtimeCostUnknown = runtimeCost ? isLegacyRuntimeCost(runtimeCost) : false
    const runtimeItems = runtimeCost ? runtimeCostEvidenceItems(runtimeCost) : []
    const legacyUsageItems: AgentConsoleEvidenceItem[] = input.latestUsage
      ? [{
          id: input.latestUsage.id,
          eyebrow: input.latestUsage.source,
          title: `${input.latestUsage.provider} · ${input.latestUsage.model}`,
          body: `${input.latestUsage.inputTokens} input · ${input.latestUsage.outputTokens} output · ${input.latestUsage.cacheReadTokens} cache read`,
          meta: [input.latestUsage.timestamp],
        }]
      : []
    groups.push({
      id: 'cost',
      title: '费用 / Token',
      summary: runtimeCost
        ? `${runtimeCost.phase === 'preflight_estimate' ? 'Preflight worst-case estimate' : runtimeCostUnknown ? 'Legacy unverified cost' : 'Actual provider settlement'} · ${runtimeCost.costStatus ?? 'legacy_unverified'} · ${runtimeCostUnknown || runtimeCost.costUsd === null ? 'unknown cost' : formatRuntimeUsd(runtimeCost.costUsd)}`
        : `${formatUsd(input.latestUsage!.costUsd)} · ${input.latestUsage!.source}`,
      tone: 'soft',
      items: [...runtimeItems, ...legacyUsageItems],
    })
  }

  return groups
}

function runtimeCostEvidenceItems(summary: CodingRuntimeCostSummary): AgentConsoleEvidenceItem[] {
  const phase = summary.phase === 'preflight_estimate'
    ? 'Preflight estimate'
    : summary.phase === 'provider_settlement'
      ? 'Actual settlement'
      : 'Legacy cost'
  const aggregate: AgentConsoleEvidenceItem = {
    id: summary.id,
    eyebrow: `${phase} · ${summary.costStatus ?? 'legacy_unverified'}`,
    title: `${summary.providerId} · ${summary.model}`,
    body: runtimeUsageText(summary),
    meta: runtimeCostMeta(summary),
  }
  const calls = (summary.providerCallSettlements ?? []).map((settlement, index) => ({
    id: `${summary.id}-provider-call-${index + 1}`,
    eyebrow: `${settlement.requestPhase} · ${settlement.costStatus}`,
    title: `${settlement.providerId} · ${settlement.model}`,
    body: runtimeUsageText(settlement),
    meta: runtimeCostMeta(settlement),
  }))
  return [aggregate, ...calls]
}

function runtimeUsageText(input: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheMissTokens?: number | null
  totalTokens?: number
}): string {
  return [
    `${input.inputTokens} input`,
    `${input.cacheReadTokens ?? 'unknown'} cache hit`,
    `${input.cacheMissTokens ?? 'unknown'} cache miss`,
    `${input.outputTokens} output`,
    `${input.totalTokens ?? input.inputTokens + input.outputTokens} total`,
  ].join(' · ')
}

function runtimeCostMeta(input: {
  cacheHitRate?: number | null
  usageStatus?: CodingRuntimeCostSummary['usageStatus']
  costStatus?: CodingRuntimeCostSummary['costStatus']
  costUsd: number | null
  pricingSnapshot?: CodingRuntimeCostSummary['pricingSnapshot']
  breakdown?: CodingRuntimeCostSummary['breakdown']
  timestamp: string
}): string[] {
  const legacy = !input.usageStatus || input.usageStatus === 'legacy_unknown' ||
    !input.costStatus || input.costStatus === 'legacy_unverified'
  const snapshot = legacy ? null : input.pricingSnapshot
  const breakdown = legacy ? null : input.breakdown
  return [
    typeof input.cacheHitRate === 'number'
      ? `cache hit rate ${(input.cacheHitRate * 100).toFixed(1)}%`
      : 'cache hit rate unknown',
    snapshot
      ? `hit ${formatRuntimeUsd(snapshot.cacheHitInputUsdPerMillion)} / 1M · miss ${formatRuntimeUsd(snapshot.cacheMissInputUsdPerMillion)} / 1M · output ${formatRuntimeUsd(snapshot.outputUsdPerMillion)} / 1M`
      : 'unit prices unknown',
    breakdown
      ? `hit ${formatRuntimeUsd(breakdown.cacheHitInputUsd)} · miss ${formatRuntimeUsd(breakdown.cacheMissInputUsd)} · output ${formatRuntimeUsd(breakdown.outputUsd)} · total ${formatRuntimeUsd(breakdown.totalUsd)}`
      : 'cost breakdown unknown',
    snapshot ? `${snapshot.tier} · ${snapshot.sourceVersion}` : undefined,
    legacy || input.costUsd === null ? 'total cost unknown' : `total ${formatRuntimeUsd(input.costUsd)}`,
    input.timestamp,
  ].filter(isPresent)
}

function isLegacyRuntimeCost(summary: CodingRuntimeCostSummary): boolean {
  return !summary.usageStatus || summary.usageStatus === 'legacy_unknown' ||
    !summary.costStatus || summary.costStatus === 'legacy_unverified'
}

function runtimeCostTraceDetails(cost: Record<string, unknown>): { body: string; meta: string[] } {
  const inputTokens = finiteNumber(cost.inputTokens)
  const outputTokens = finiteNumber(cost.outputTokens)
  const cacheReadTokens = finiteNumber(cost.cacheReadTokens)
  const cacheMissTokens = finiteNumber(cost.cacheMissTokens)
  const totalTokens = finiteNumber(cost.totalTokens)
  const hitRate = finiteNumber(cost.cacheHitRate)
  const costUsd = finiteNumber(cost.costUsd)
  const unitPrices = recordValue(cost.unitPrices)
  const breakdown = recordValue(cost.breakdown)
  const providerCallMeta = Array.isArray(cost.providerCallSettlements)
    ? cost.providerCallSettlements.slice(0, 32).flatMap(runtimeProviderCallTraceMeta)
    : []
  return {
    body: [
      `${inputTokens ?? 'unknown'} input`,
      `${cacheReadTokens ?? 'unknown'} hit`,
      `${cacheMissTokens ?? 'unknown'} miss`,
      `${outputTokens ?? 'unknown'} output`,
      `${totalTokens ?? 'unknown'} total`,
    ].join(' · '),
    meta: [
      hitRate === undefined ? 'cache hit rate unknown' : `cache hit rate ${(hitRate * 100).toFixed(1)}%`,
      unitPrices
        ? `hit ${formatRuntimeUsd(finiteNumber(unitPrices.cacheHitInputUsdPerMillion))} / 1M · miss ${formatRuntimeUsd(finiteNumber(unitPrices.cacheMissInputUsdPerMillion))} / 1M · output ${formatRuntimeUsd(finiteNumber(unitPrices.outputUsdPerMillion))} / 1M`
        : undefined,
      breakdown
        ? `hit ${formatRuntimeUsd(finiteNumber(breakdown.cacheHitInputUsd))} · miss ${formatRuntimeUsd(finiteNumber(breakdown.cacheMissInputUsd))} · output ${formatRuntimeUsd(finiteNumber(breakdown.outputUsd))} · total ${formatRuntimeUsd(finiteNumber(breakdown.totalUsd))}`
        : undefined,
      typeof cost.pricingTier === 'string' ? cost.pricingTier : undefined,
      costUsd === undefined ? 'total cost unknown' : `total ${formatRuntimeUsd(costUsd)}`,
      ...providerCallMeta,
    ].filter(isPresent),
  }
}

function runtimeProviderCallTraceMeta(value: unknown): string[] {
  const call = recordValue(value)
  if (!call) return []
  const phase = typeof call.requestPhase === 'string' ? call.requestPhase : 'provider call'
  const inputTokens = finiteNumber(call.inputTokens)
  const outputTokens = finiteNumber(call.outputTokens)
  const cacheReadTokens = finiteNumber(call.cacheReadTokens)
  const cacheMissTokens = finiteNumber(call.cacheMissTokens)
  const totalTokens = finiteNumber(call.totalTokens)
  const hitRate = finiteNumber(call.cacheHitRate)
  const snapshot = recordValue(call.pricingSnapshot)
  const breakdown = recordValue(call.breakdown)
  return [
    `${phase} · ${inputTokens ?? 'unknown'} input · ${cacheReadTokens ?? 'unknown'} hit · ${cacheMissTokens ?? 'unknown'} miss · ${outputTokens ?? 'unknown'} output · ${totalTokens ?? 'unknown'} total · hit rate ${hitRate === undefined ? 'unknown' : `${(hitRate * 100).toFixed(1)}%`}`,
    snapshot
      ? `${phase} rates · hit ${formatRuntimeUsd(finiteNumber(snapshot.cacheHitInputUsdPerMillion))} / 1M · miss ${formatRuntimeUsd(finiteNumber(snapshot.cacheMissInputUsdPerMillion))} / 1M · output ${formatRuntimeUsd(finiteNumber(snapshot.outputUsdPerMillion))} / 1M`
      : undefined,
    breakdown
      ? `${phase} cost · hit ${formatRuntimeUsd(finiteNumber(breakdown.cacheHitInputUsd))} · miss ${formatRuntimeUsd(finiteNumber(breakdown.cacheMissInputUsd))} · output ${formatRuntimeUsd(finiteNumber(breakdown.outputUsd))} · total ${formatRuntimeUsd(finiteNumber(breakdown.totalUsd))}`
      : undefined,
  ].filter(isPresent)
}

function providerCallEvidenceItem(
  event: CodingAgentEvent,
  call: Record<string, unknown>,
): AgentConsoleEvidenceItem {
  const phase = typeof call.phase === 'string' ? call.phase : 'unknown phase'
  const status = typeof call.status === 'string' ? call.status : event.kind
  const providerId = typeof call.providerId === 'string' ? call.providerId : 'unknown provider'
  const model = typeof call.model === 'string' ? call.model : 'unknown model'
  const durationMs = finiteNumber(call.durationMs)
  const timeoutMs = finiteNumber(call.timeoutMs)
  const manifestPathCount = finiteNumber(call.manifestPathCount)
  const excerptCount = finiteNumber(call.excerptCount)
  const promptChars = finiteNumber(call.promptChars)
  const promptBytes = finiteNumber(call.promptBytes)
  const maxOutputTokens = finiteNumber(call.maxOutputTokens)
  const errorCode = typeof call.errorCode === 'string' ? call.errorCode : undefined
  const sanitizedCause = typeof call.sanitizedCause === 'string' ? call.sanitizedCause : undefined
  const deliveryState = typeof call.deliveryState === 'string' ? call.deliveryState : 'unknown'
  const billingState = typeof call.billingState === 'string' ? call.billingState : 'unknown'
  const retryable = call.retryable === true
  const targetHost = typeof call.targetHost === 'string' ? call.targetHost : undefined
  const httpStatus = finiteNumber(call.httpStatus)
  const providerResponseId = typeof call.providerResponseId === 'string'
    ? call.providerResponseId
    : undefined
  const systemFingerprint = typeof call.systemFingerprint === 'string'
    ? call.systemFingerprint
    : undefined
  const usage = recordValue(call.usage)
  const inputTokens = finiteNumber(usage?.inputTokens)
  const outputTokens = finiteNumber(usage?.outputTokens)
  const cacheReadTokens = finiteNumber(usage?.cacheReadTokens)
  const cacheMissTokens = finiteNumber(usage?.cacheMissTokens)
  const totalTokens = finiteNumber(usage?.totalTokens)

  return {
    id: event.id,
    eyebrow: `${phase} · ${status}`,
    title: `${providerId} · ${model}`,
    body: event.message,
    meta: [
      durationMs === undefined
        ? `duration pending · timeout ${timeoutMs ?? 'unknown'}ms`
        : `duration ${durationMs}ms · timeout ${timeoutMs ?? 'unknown'}ms`,
      errorCode
        ? `${errorCode}${sanitizedCause ? ` · ${sanitizedCause}` : ''}`
        : undefined,
      `delivery ${deliveryState} · billing ${billingState}`,
      status === 'failed'
        ? retryable
          ? 'manual retry available'
          : 'manual retry not recommended'
        : undefined,
      manifestPathCount !== undefined && excerptCount !== undefined
        ? `${manifestPathCount} manifest paths · ${excerptCount} excerpts`
        : undefined,
      promptChars !== undefined && promptBytes !== undefined
        ? `${promptChars} chars · ${promptBytes} bytes · max output ${maxOutputTokens ?? 'unknown'}`
        : undefined,
      inputTokens !== undefined || outputTokens !== undefined
        ? `${inputTokens ?? 'unknown'} input · ${cacheReadTokens ?? 'unknown'} cache hit · ${cacheMissTokens ?? 'unknown'} cache miss · ${outputTokens ?? 'unknown'} output · ${totalTokens ?? 'unknown'} total`
        : undefined,
      targetHost,
      httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
      providerResponseId ? `response ${providerResponseId}` : undefined,
      systemFingerprint ? `fingerprint ${systemFingerprint}` : undefined,
      event.timestamp,
      event.redacted ? 'redacted' : undefined,
    ].filter(isPresent),
  }
}

function formatRuntimeUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown'
  const exact = value.toFixed(9).replace(/\.?0+$/u, '')
  return `$${exact}`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function evidenceTone(status: string): AgentConsoleTone {
  if (status === 'passed' || status === 'skipped') {
    return 'good'
  }
  if (status === 'failed' || status === 'timed_out') {
    return 'bad'
  }
  return 'warn'
}

function buildProviderModeLabel(provider: AgentProviderConfig | undefined): string {
  if (!provider) {
    return '请先添加 Provider Name、Base URL、模型和 API Key'
  }
  if (provider.kind === 'fake') {
    return '确定性开发适配器 · 不产生模型费用'
  }
  return '实时 OpenAI 兼容服务 · 可能消耗模型 Token'
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
