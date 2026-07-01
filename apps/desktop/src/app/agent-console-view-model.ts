import {
  formatUsd,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
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
  codingRuntimeLabel,
  codingTerminalLabel,
  codingTraceMetadataString,
  codingTraceSourceLabel,
  displayNodeTitle,
  stageLabels,
  type FieldDataSource,
} from './desktop-view-model'
import type { PendingInspectorAction } from './node-inspector-view-model'

export type AgentConsoleTone = 'good' | 'warn' | 'bad' | 'soft' | 'accent' | 'neutral'

export type AgentConsolePrimaryActionId =
  | 'complete-agent-node'
  | 'run-review'
  | 'run-coding'
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
  })
  const advisory = buildAdvisorySummary(input.latestReview, input.selectedNode, input.pendingCodingPermission)

  return {
    title: 'Agent 执行台',
    currentTarget,
    primaryAction,
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
      summary: selectedProvider ? `Agent provider: ${selectedProvider.id}` : 'No Agent Provider selected',
      providerDataSource,
      selectedProvider,
      providerMode: buildProviderModeLabel(selectedProvider, providerDataSource),
      fields: [
        { label: 'Selected provider', value: selectedProvider?.id ?? 'none' },
        { label: 'Total reviews', value: String(input.reviews.length) },
        { label: 'Coding runs', value: String(input.codingRuns.length) },
        { label: 'Permission requests', value: String(input.permissionRequests.length) },
      ],
    },
  }
}

function buildCurrentTarget(run: WorkflowRun | undefined, node: WorkflowNode | undefined): AgentConsoleViewModel['currentTarget'] {
  return {
    runTitle: run?.title ?? 'No selected Run',
    nodeTitle: node ? displayNodeTitle(node) : 'No selected node',
    stageLabel: node ? stageLabels[node.stage] : 'No stage',
    nodeKind: node?.kind ?? 'none',
    nodeStatus: node?.status ?? 'not selected',
  }
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
}): AgentConsoleAction {
  if (input.pendingCodingPermission) {
    return {
      id: 'resolve-permission',
      label: 'Resolve Permission',
      summary: 'Coding Agent is paused until this permission request is approved or rejected.',
      tone: 'warn',
      disabled: false,
    }
  }

  if (!input.selectedRun || !input.selectedNode) {
    return {
      id: 'return-workbench',
      label: 'Return to Workbench',
      summary: '先从 Workbench 选择一个 Run 节点，再回到 Agent 执行台。',
      tone: 'soft',
      disabled: false,
    }
  }

  if (input.selectedNode.kind === 'test' || input.selectedNode.stage === 'test') {
    return {
      id: 'go-tests',
      label: 'Go to Tests',
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
      label: input.isStartingCodingAgent ? 'Starting Coding Agent' : 'Run Coding Agent',
      summary: '通过 managed worktree 执行代码修改、权限转发、diff 和测试证据归档。',
      tone: 'accent',
      disabled: input.isStartingCodingAgent || isBlockedByWriteLock,
      ...(input.isStartingCodingAgent
        ? { disabledReason: 'Coding Agent is starting.' }
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
      ? '请先配置真实 Agent Provider：Provider ID、Base URL、Model 和 API Key。'
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

  if (input.selectedNode.kind === 'pr' || input.selectedNode.kind === 'acceptance') {
    return {
      id: 'return-workbench',
      label: 'Return to Workbench',
      summary: 'PR 交付和业务验收动作请回到 Workbench 当前 Inspector 执行。',
      tone: 'soft',
      disabled: false,
    }
  }

  return {
    id: 'run-review',
    label: input.isRunningReview ? 'Review running' : 'Run Knowledge Review',
    summary: '生成当前节点的 Review Evidence、Gate Advisory、引用和 trace。',
    tone: providerMissing ? 'warn' : 'accent',
    disabled: providerMissing || input.isRunningReview || Boolean(input.pendingInspectorAction),
    ...(providerMissing
      ? { disabledReason: '请先配置真实 Agent Provider：Provider ID、Base URL、Model 和 API Key。' }
      : input.isRunningReview
        ? { disabledReason: 'Knowledge Review is already running.' }
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
      label: 'Permission required',
      summary: pendingPermission.title,
      tone: 'warn',
      detail: pendingPermission.reasons.join(' '),
    }
  }

  if (latestReview) {
    const advisory = latestReview.gateAdvisory
    return {
      label: advisory.blocksApproval ? 'Blocks approval' : advisory.level === 'info' ? 'No blocking issue' : 'Advisory warning',
      summary: advisory.summary,
      tone: advisory.blocksApproval ? 'bad' : advisory.level === 'warn' ? 'warn' : 'good',
      detail: advisory.blocksApproval ? 'blocking' : 'warning-only',
    }
  }

  if (selectedNode?.kind === 'gate' || selectedNode?.kind === 'acceptance') {
    return {
      label: 'Needs Knowledge Review',
      summary: '当前 Gate 还没有 Knowledge Review 结论。',
      tone: 'warn',
      detail: 'Run review before approval.',
    }
  }

  return {
    label: 'No review yet',
    summary: '当前节点还没有 Review advisory。',
    tone: 'soft',
    detail: 'No advisory',
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
  const codingDisabledReason = input.selectedNode && !isBuildTask(input.selectedNode)
    ? 'Coding Agent 只能从开发实现任务启动。'
    : undefined

  return [
    {
      id: 'review',
      label: 'Review',
      title: 'Knowledge Review Agent',
      summary: input.latestReview?.summary ?? '生成 Gate Advisory、风险、缺失证据和知识引用。',
      tone: input.latestReview ? (input.latestReview.gateAdvisory.blocksApproval ? 'bad' : 'good') : 'soft',
      emphasis: input.primaryAction.id === 'run-review' ? 'primary' : 'secondary',
      facts: [
        { label: 'Provider', value: input.selectedProvider?.id ?? 'none' },
        { label: 'Current node reviews', value: String(input.selectedReviews.length) },
      ],
      ...(!input.selectedProvider ? { disabledReason: '请先配置真实 Agent Provider：Provider ID、Base URL、Model 和 API Key。' } : {}),
    },
    {
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
      emphasis: input.primaryAction.id === 'run-coding' || input.primaryAction.id === 'resolve-permission' ? 'primary' : 'secondary',
      facts: [
        { label: 'Runs', value: String(input.codingRuns.length) },
        { label: 'Latest status', value: input.latestCodingRun?.status ?? 'none' },
        { label: 'Retries', value: String(input.retryAttempts.length) },
      ],
      ...(codingDisabledReason ? { disabledReason: codingDisabledReason } : {}),
    },
  ]
}

function buildEvidenceGroups(input: BuildAgentConsoleViewModelInput): AgentConsoleEvidenceGroup[] {
  const groups: AgentConsoleEvidenceGroup[] = []

  if (input.latestTrace?.steps.length) {
    groups.push({
      id: 'review-trace',
      title: 'Review Trace',
      summary: 'Knowledge Review context, retrieval, provider call, and artifact creation.',
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
      title: 'Review History',
      summary: '当前 Run / Node 的 Knowledge Review 记录。',
      tone: 'soft',
      items: input.selectedReviews.map((review) => ({
        id: review.id,
        eyebrow: review.runtime,
        title: review.conclusion,
        body: review.summary,
        meta: [
          review.providerId,
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
      title: 'Permission Timeline',
      summary: 'Permission relay requests and decisions for the latest Coding Agent run.',
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

  const toolTraceEvents = input.codingEvents.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result')
  if (toolTraceEvents.length > 0) {
    groups.push({
      id: 'tool-skill',
      title: 'Tool / Skill Timeline',
      summary: 'Tool calls and results surfaced from the Coding Agent runtime.',
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
      title: 'Coding Trace',
      summary: 'Brief, permission, diff, bootstrap, test, cleanup, and terminal runtime events.',
      tone: 'soft',
      items: input.codingEvents.map((event) => ({
        id: event.id,
        eyebrow: event.kind,
        title: event.message,
        body: event.timestamp,
        meta: event.redacted ? ['redacted'] : [],
      })),
    })
  }

  if (input.diff) {
    groups.push({
      id: 'diff',
      title: 'Diff Preview',
      summary: `${input.diff.changedPaths.length} changed paths archived as Coding Diff Artifact.`,
      tone: 'accent',
      items: [{
        id: input.diff.id,
        eyebrow: input.diff.redacted ? 'redacted diff' : 'diff',
        title: input.diff.changedPaths.join(', ') || 'Coding Diff Artifact',
        body: input.diff.patch.slice(0, 1800),
        meta: [input.diff.truncated ? 'truncated' : 'full patch'],
      }],
    })
  }

  if (input.bootstrapEvidence) {
    groups.push({
      id: 'bootstrap',
      title: 'Bootstrap Evidence',
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
      title: 'Test Evidence',
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
      title: 'Policy Retry Attempts',
      summary: 'Human-approved remediation retries launched from Gate policy candidates.',
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

  if (input.latestUsage) {
    groups.push({
      id: 'cost',
      title: 'Cost / Token',
      summary: `${formatUsd(input.latestUsage.costUsd)} · ${input.latestUsage.source}`,
      tone: 'soft',
      items: [{
        id: input.latestUsage.id,
        eyebrow: input.latestUsage.source,
        title: `${input.latestUsage.provider} · ${input.latestUsage.model}`,
        body: `${input.latestUsage.inputTokens} input · ${input.latestUsage.outputTokens} output · ${input.latestUsage.cacheReadTokens} cache read`,
        meta: [input.latestUsage.timestamp],
      }],
    })
  }

  return groups
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

function buildProviderModeLabel(provider: AgentProviderConfig | undefined, dataSource: FieldDataSource): string {
  if (!provider) {
    return `${dataSource.label} · add Provider ID, Base URL, Model, and API Key before running review`
  }
  if (provider.kind === 'fake') {
    return `${dataSource.label} · deterministic dev adapter · no model cost`
  }
  return `${dataSource.label} · live OpenAI-compatible · may spend provider tokens`
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
