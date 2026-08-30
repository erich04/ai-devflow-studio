import {
  canRunCodingAgentOnNode,
  isActiveCodingAgentRunStatus,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingChangeSetPreview,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type CodingRuntimeReadiness,
  type RuntimePricingSnapshot,
  type RuntimeProviderCallSettlement,
  type ManagedCodingWorkspace,
  type TestEvidence,
  type WorkflowNode,
} from '@ai-devflow/shared'

export type CodingRuntimeActionId =
  | 'start'
  | 'view-progress'
  | 'review-permission'
  | 'view-result'
  | 'retry'
  | 'configure'
  | 'none'

export type CodingRuntimeActionTarget =
  | 'agents-progress'
  | 'agents-permission'
  | 'agents-evidence'
  | 'runtime-settings'
  | 'none'

export type CodingRuntimeAction = {
  id: CodingRuntimeActionId
  target: CodingRuntimeActionTarget
  label: string
  summary: string
  disabled: boolean
  disabledReason?: string
  createsNewRun: boolean
  mayInvokeProvider: boolean
  requiresConfirmation: boolean
}

export type CodingPermissionProjection = {
  request: CodingPermissionRequest
  kind: 'change-set' | 'dependency-bootstrap' | 'legacy'
  remainingMs: number
  expired: boolean
  staleReason?: string
  canApprove: boolean
  previewVerified: boolean
  changedPaths: string[]
  changeSetDigest?: string
  preview?: CodingChangeSetPreview
}

export type CodingRuntimeTerminalSummary = {
  providerId: string
  engine: CodingAgentRun['engine']
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number | null
  cacheMissTokens?: number | null
  totalTokens?: number
  cacheHitRate?: number | null
  usageStatus?: NonNullable<CodingAgentRun['runtimeCostSummary']>['usageStatus']
  costStatus?: NonNullable<CodingAgentRun['runtimeCostSummary']>['costStatus']
  costPhase?: NonNullable<CodingAgentRun['runtimeCostSummary']>['phase']
  costUsd?: number | null
  pricingTier?: NonNullable<NonNullable<CodingAgentRun['runtimeCostSummary']>['pricingSnapshot']>['tier']
  pricingSourceVersion?: string
  pricingSnapshot?: RuntimePricingSnapshot | null
  costBreakdown?: NonNullable<CodingAgentRun['runtimeCostSummary']>['breakdown']
  providerCallSettlements?: RuntimeProviderCallSettlement[]
  reason: string
  changedPaths: string[]
  testStatus?: TestEvidence['status']
  testCommand?: string
  testSummary?: string
  diffPatch?: string
  trace: CodingAgentEvent[]
  workspacePath?: string
  workspaceCleanupStatus: 'active' | 'deleted' | 'cleanup_failed' | 'none'
  workspaceCleanupError?: string
  canOpenWorkspace: boolean
}

export type CodingRuntimeActionProjection = {
  scope: { runId: string; nodeId: string; projectId: string }
  phase: 'unavailable' | 'idle' | 'starting' | CodingAgentRun['status']
  action: CodingRuntimeAction
  history: CodingAgentRun[]
  latestRun?: CodingAgentRun
  activeRun?: CodingAgentRun
  conflictingActiveRun?: CodingAgentRun
  permission?: CodingPermissionProjection
  terminal?: CodingRuntimeTerminalSummary
}

export type BuildCodingRuntimeActionProjectionInput = {
  runId: string
  nodeId: string
  projectId: string
  node: WorkflowNode
  isSelectedCurrentNode: boolean
  codingRuns: readonly CodingAgentRun[]
  permissionRequests: readonly CodingPermissionRequest[]
  workspaces: readonly ManagedCodingWorkspace[]
  diffArtifacts: readonly CodingDiffArtifact[]
  testEvidence: readonly TestEvidence[]
  events: readonly CodingAgentEvent[]
  readiness: CodingRuntimeReadiness | null
  isStartingCodingAgent: boolean
  changeSetPreview?: CodingChangeSetPreview | null
  now: string
}

const terminalStatuses = new Set<CodingAgentRun['status']>([
  'completed',
  'failed',
  'timed_out',
  'interrupted',
  'cancelled',
])

function sortRuns(runs: readonly CodingAgentRun[]): CodingAgentRun[] {
  return [...runs].sort((left, right) => {
    const byStartedAt = right.startedAt.localeCompare(left.startedAt)
    return byStartedAt || right.id.localeCompare(left.id)
  })
}

function disabledAction(
  id: CodingRuntimeActionId,
  target: CodingRuntimeActionTarget,
  label: string,
  summary: string,
  disabledReason: string,
): CodingRuntimeAction {
  return {
    id,
    target,
    label,
    summary,
    disabled: true,
    disabledReason,
    createsNewRun: false,
    mayInvokeProvider: false,
    requiresConfirmation: false,
  }
}

function buildPermissionProjection(input: {
  request: CodingPermissionRequest
  run: CodingAgentRun
  preview?: CodingChangeSetPreview | null
  nowMs: number
}): CodingPermissionProjection {
  const { request, run, preview, nowMs } = input
  const requestExpiryMs = Date.parse(request.expiresAt)
  const remainingMs = Number.isFinite(requestExpiryMs) && Number.isFinite(nowMs)
    ? Math.max(0, requestExpiryMs - nowMs)
    : 0
  const expired = remainingMs <= 0
  const kind = request.origin === 'dependency_bootstrap'
    ? 'dependency-bootstrap'
    : request.changeSetId
      ? 'change-set'
      : 'legacy'
  let staleReason: string | undefined
  const previewVerified = kind === 'change-set' && Boolean(
    preview &&
    preview.id === request.changeSetId &&
    preview.codingRunId === request.codingRunId &&
    request.changeSetDigest &&
    preview.changeSetDigest === request.changeSetDigest,
  )

  if (request.codingRunId !== run.id || request.runId !== run.runId || request.nodeId !== run.nodeId) {
    staleReason = 'Permission 不属于当前 Coding Run / Workflow 节点。'
  } else if (run.status !== 'waiting_permission') {
    staleReason = 'Coding Run 已不在等待权限的状态。'
  } else if (request.status !== 'pending') {
    staleReason = 'Permission 已经处理，不能再次审批。'
  } else if (expired) {
    staleReason = 'Permission 已过期，不能审批。'
  } else if (kind === 'change-set') {
    if (!preview) {
      staleReason = '精确 Change Set 尚未完成校验。'
    } else if (
      preview.id !== request.changeSetId ||
      preview.codingRunId !== request.codingRunId ||
      !request.changeSetDigest ||
      preview.changeSetDigest !== request.changeSetDigest
    ) {
      staleReason = 'Change Set 的 Run、ID 或 digest 已不匹配。'
    } else if (Date.parse(preview.expiresAt) <= nowMs) {
      staleReason = 'Change Set 已过期，不能审批。'
    }
  }

  const changedPaths = previewVerified
    ? preview!.changedPaths
    : request.filePath
      ? [request.filePath]
      : []
  return {
    request,
    kind,
    remainingMs,
    expired,
    ...(staleReason ? { staleReason } : {}),
    canApprove: !staleReason,
    previewVerified,
    changedPaths,
    ...(request.changeSetDigest ? { changeSetDigest: request.changeSetDigest } : {}),
    ...(preview ? { preview } : {}),
  }
}

function buildTerminalSummary(input: BuildCodingRuntimeActionProjectionInput, run: CodingAgentRun): CodingRuntimeTerminalSummary {
  const workspace = input.workspaces.find((candidate) => candidate.id === run.managedWorkspaceId)
  const diff = input.diffArtifacts.find((candidate) => candidate.id === run.diffArtifactId)
  const evidence = input.testEvidence.find((candidate) => candidate.id === run.testEvidenceId)
  const errorEvent = [...input.events]
    .filter((event) => event.codingRunId === run.id && event.kind === 'error')
    .sort((left, right) => right.sequence - left.sequence)[0]
  const trace = input.events
    .filter((event) => event.codingRunId === run.id)
    .sort((left, right) => left.sequence - right.sequence)
  const cleanupStatus = workspace?.cleanupStatus ?? (workspace?.deletedAt ? 'deleted' : workspace ? 'active' : 'none')
  const changedPaths = run.changedPaths.length > 0 ? run.changedPaths : (diff?.changedPaths ?? [])
  const legacyRuntimeCost = Boolean(run.runtimeCostSummary && !run.runtimeCostSummary.usageStatus)

  return {
    providerId: run.providerId,
    engine: run.engine,
    ...(run.runtimeCostSummary ? {
      inputTokens: run.runtimeCostSummary.inputTokens,
      outputTokens: run.runtimeCostSummary.outputTokens,
      cacheReadTokens: legacyRuntimeCost ? null : run.runtimeCostSummary.cacheReadTokens,
      ...(run.runtimeCostSummary.cacheMissTokens !== undefined
        ? { cacheMissTokens: run.runtimeCostSummary.cacheMissTokens }
        : {}),
      ...(run.runtimeCostSummary.totalTokens !== undefined
        ? { totalTokens: run.runtimeCostSummary.totalTokens }
        : {}),
      ...(run.runtimeCostSummary.cacheHitRate !== undefined
        ? { cacheHitRate: run.runtimeCostSummary.cacheHitRate }
        : {}),
      ...(run.runtimeCostSummary.usageStatus !== undefined
        ? { usageStatus: run.runtimeCostSummary.usageStatus }
        : { usageStatus: 'legacy_unknown' as const }),
      ...(run.runtimeCostSummary.costStatus !== undefined
        ? { costStatus: run.runtimeCostSummary.costStatus }
        : { costStatus: 'legacy_unverified' as const }),
      ...(run.runtimeCostSummary.phase !== undefined
        ? { costPhase: run.runtimeCostSummary.phase }
        : {}),
      costUsd: legacyRuntimeCost ? null : run.runtimeCostSummary.costUsd,
      ...(run.runtimeCostSummary.pricingSnapshot
        ? {
            pricingTier: run.runtimeCostSummary.pricingSnapshot.tier,
            pricingSourceVersion: run.runtimeCostSummary.pricingSnapshot.sourceVersion,
          }
        : {}),
      ...(run.runtimeCostSummary.pricingSnapshot !== undefined
        ? { pricingSnapshot: run.runtimeCostSummary.pricingSnapshot }
        : {}),
      ...(run.runtimeCostSummary.breakdown !== undefined
        ? { costBreakdown: run.runtimeCostSummary.breakdown }
        : {}),
      ...(run.runtimeCostSummary.providerCallSettlements !== undefined
        ? { providerCallSettlements: run.runtimeCostSummary.providerCallSettlements }
        : {}),
    } : {}),
    reason: errorEvent?.message ?? run.summary,
    changedPaths,
    ...(evidence ? {
      testStatus: evidence.status,
      testCommand: evidence.command,
      testSummary: evidence.summary,
    } : {}),
    ...(diff ? { diffPatch: diff.patch } : {}),
    trace,
    ...(workspace ? { workspacePath: workspace.worktreePath } : {}),
    workspaceCleanupStatus: cleanupStatus,
    ...(workspace?.cleanupError ? { workspaceCleanupError: workspace.cleanupError } : {}),
    canOpenWorkspace: cleanupStatus === 'active' && !workspace?.deletedAt,
  }
}

export function buildCodingRuntimeActionProjection(
  input: BuildCodingRuntimeActionProjectionInput,
): CodingRuntimeActionProjection {
  const scope = { runId: input.runId, nodeId: input.nodeId, projectId: input.projectId }
  const history = sortRuns(input.codingRuns.filter((run) => (
    run.runId === scope.runId && run.nodeId === scope.nodeId && run.projectId === scope.projectId
  )))
  const activeRun = history.find((run) => isActiveCodingAgentRunStatus(run.status))
  const conflictingActiveRun = sortRuns(input.codingRuns.filter((run) => (
    run.projectId === scope.projectId &&
    isActiveCodingAgentRunStatus(run.status) &&
    (run.runId !== scope.runId || run.nodeId !== scope.nodeId)
  )))[0]
  const latestRun = activeRun ?? history[0]
  const base = {
    scope,
    history,
    ...(latestRun ? { latestRun } : {}),
    ...(activeRun ? { activeRun } : {}),
    ...(conflictingActiveRun ? { conflictingActiveRun } : {}),
  }

  if (!canRunCodingAgentOnNode(input.node)) {
    return {
      ...base,
      phase: 'unavailable',
      action: disabledAction('none', 'none', '当前节点不可执行 Coding Agent', 'Coding Agent 仅用于开发实现 Task。', '当前节点不是开发实现 Task。'),
    }
  }

  if (activeRun) {
    const pendingRequest = [...input.permissionRequests]
      .filter((request) => request.codingRunId === activeRun.id && request.status === 'pending')
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt) || right.id.localeCompare(left.id))[0]
    if (activeRun.status === 'waiting_permission' && pendingRequest) {
      const permission = buildPermissionProjection({
        request: pendingRequest,
        run: activeRun,
        nowMs: Date.parse(input.now),
        ...(input.changeSetPreview !== undefined ? { preview: input.changeSetPreview } : {}),
      })
      return {
        ...base,
        phase: activeRun.status,
        permission,
        action: {
          id: 'review-permission',
          target: 'agents-permission',
          label: permission.kind === 'change-set' ? '审查并批准修改' : '处理 Coding Permission',
          summary: permission.staleReason ?? `${pendingRequest.title}；审批只作用于当前 Coding Run。`,
          disabled: false,
          createsNewRun: false,
          mayInvokeProvider: false,
          requiresConfirmation: false,
        },
      }
    }
    return {
      ...base,
      phase: activeRun.status,
      action: {
        id: 'view-progress',
        target: 'agents-progress',
        label:
          activeRun.status === 'waiting_permission'
            ? '查看权限状态'
            : activeRun.status === 'applying'
              ? '查看应用进度'
              : activeRun.status === 'testing'
                ? '查看测试进度'
                : '查看运行进度',
        summary: activeRun.status === 'waiting_permission'
          ? 'Runtime 正在等待权限，但没有可审批的当前请求；请刷新状态。'
          : `Coding Run 正在 ${activeRun.status}，不能重复启动。`,
        disabled: false,
        createsNewRun: false,
        mayInvokeProvider: false,
        requiresConfirmation: false,
      },
    }
  }

  if (input.isStartingCodingAgent) {
    return {
      ...base,
      phase: 'starting',
      action: disabledAction('view-progress', 'agents-progress', '正在创建 Coding Run', '正在创建新的受控 Coding Run。', '启动请求尚未完成。'),
    }
  }

  if (latestRun && terminalStatuses.has(latestRun.status)) {
    const terminal = buildTerminalSummary(input, latestRun)
    if (latestRun.status === 'completed') {
      return {
        ...base,
        phase: latestRun.status,
        terminal,
        action: {
          id: 'view-result',
          target: 'agents-evidence',
          label: '查看 Coding Run 结果',
          summary: '该实现已完成；保留证据与运行历史，不再显示启动或重试。',
          disabled: false,
          createsNewRun: false,
          mayInvokeProvider: false,
          requiresConfirmation: false,
        },
      }
    }
    const canRetry = input.isSelectedCurrentNode && input.readiness?.status === 'ready' && !conflictingActiveRun
    const blockedReason = !input.isSelectedCurrentNode
      ? '当前 Workflow 已不在这个开发实现节点。'
      : conflictingActiveRun
        ? `项目已有活动 Coding Run：${conflictingActiveRun.id}`
        : input.readiness?.checks.find((check) => check.status === 'blocked')?.message ?? 'Coding Runtime 尚未就绪。'
    return {
      ...base,
      phase: latestRun.status,
      terminal,
      action: {
        id: 'retry',
        target: 'agents-evidence',
        label:
          latestRun.status === 'timed_out'
            ? '上次运行超时 · 重新运行 Coding Agent'
            : latestRun.status === 'failed'
              ? '上次运行失败 · 重新运行 Coding Agent'
              : '上次运行已取消 · 重新运行 Coding Agent',
        summary: '重试会新建 Coding Run，并可能再次调用 Provider、产生新的 token 与费用。',
        disabled: !canRetry,
        ...(!canRetry ? { disabledReason: blockedReason } : {}),
        createsNewRun: true,
        mayInvokeProvider: true,
        requiresConfirmation: true,
      },
    }
  }

  if (conflictingActiveRun) {
    return {
      ...base,
      phase: 'idle',
      action: disabledAction(
        'view-progress',
        'agents-progress',
        '项目已有活动 Coding Run',
        `活动 Run ${conflictingActiveRun.id} 必须先完成或取消。`,
        '同一个本地项目不能并发启动第二个 Coding Run。',
      ),
    }
  }

  if (!input.isSelectedCurrentNode) {
    return {
      ...base,
      phase: 'idle',
      action: disabledAction('none', 'none', '等待 Workflow 到达当前节点', '只能从当前开发实现节点启动。', '当前节点不是 Workflow 的当前步骤。'),
    }
  }

  if (input.readiness?.status !== 'ready') {
    const reason = input.readiness?.checks.find((check) => check.status === 'blocked')?.message ?? '正在读取 Coding Runtime Readiness。'
    return {
      ...base,
      phase: 'idle',
      action: {
        id: 'configure',
        target: 'runtime-settings',
        label: '完成 Coding Runtime 配置',
        summary: reason,
        disabled: false,
        createsNewRun: false,
        mayInvokeProvider: false,
        requiresConfirmation: false,
      },
    }
  }

  return {
    ...base,
    phase: 'idle',
    action: {
      id: 'start',
      target: 'agents-progress',
      label: '启动 Coding Agent',
      summary: '新建受控 Coding Run，在 managed worktree 中生成 diff、测试与执行证据。',
      disabled: false,
      createsNewRun: true,
      mayInvokeProvider: true,
      requiresConfirmation: false,
    },
  }
}
