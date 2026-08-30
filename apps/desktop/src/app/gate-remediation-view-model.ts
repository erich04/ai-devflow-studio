import type {
  GateEnforcementDecision,
  GateEnforcementReason,
  GateOverrideDecision,
  RemediationCandidate,
  RemediationCandidateKind,
  RemediationPlan,
} from '@ai-devflow/shared'

export type GateRemediationSeverity = 'hard_block' | 'block' | 'warning'
export type GateRemediationItemStatus = 'open' | 'in_progress' | 'resolved' | 'stale'
export type GateRemediationCtaKind = 'knowledge_review' | 'tests' | 'sync_policy' | 'retry_coding'

export type GateRemediationItem = {
  id: string
  title: string
  source: string
  ruleKey: string
  severity: GateRemediationSeverity
  mandatory: boolean
  why: string
  action: string
  requiredRole: string
  requiredEvidence: string
  completion: string
  status: GateRemediationItemStatus
  statusLabel: string
  cta?: {
    kind: GateRemediationCtaKind
    label: string
  }
  manualGuidance?: string
  candidateId?: string
}

export type GateRemediationViewModel = {
  activeItems: GateRemediationItem[]
  resolvedItems: GateRemediationItem[]
  emptyMessage: string
  override: {
    active: GateOverrideDecision | undefined
    canOpen: boolean
    requiredRole: 'lead'
  }
}

const statusLabels: Record<GateRemediationItemStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  stale: '已过期',
}

function severityFor(decision: GateEnforcementDecision, reason: GateEnforcementReason): GateRemediationSeverity {
  if (decision.status === 'hard_blocked' && reason.action === 'block') {
    return 'hard_block'
  }
  return reason.action === 'block' ? 'block' : 'warning'
}

function inferCandidateKind(
  decision: GateEnforcementDecision,
  reason: GateEnforcementReason,
): RemediationCandidateKind | undefined {
  if (
    decision.status === 'blocked_policy_unavailable' ||
    reason.id === 'policy-unavailable' ||
    reason.ruleKey === 'policy-unavailable'
  ) {
    return 'sync_policy'
  }
  if (reason.target === 'missing_agent_review') {
    return 'run_agent_review'
  }
  if (reason.target === 'governance_check' && /test|evidence/i.test(reason.ruleKey)) {
    return 'add_test_evidence'
  }
  return undefined
}

function candidateDetails(kind: RemediationCandidateKind | undefined, eligibleForCodingRetry: boolean) {
  if (eligibleForCodingRetry) {
    return {
      requiredRole: '开发者执行，人工批准 Retry',
      requiredEvidence: '新的受控 Coding Diff 与通过的 Test Evidence',
      completion: 'Retry 产生新结果，相关规则重新评估后不再命中。',
      cta: { kind: 'retry_coding' as const, label: 'Retry Coding' },
    }
  }

  switch (kind) {
    case 'run_agent_review':
      return {
        requiredRole: '当前 Run 的执行成员',
        requiredEvidence: '当前 Run/Node 的 Review advisory 与 Knowledge 引用',
        completion: '最新门禁审查已持久化，Gate 重新评估后不再缺少 Review。',
        cta: { kind: 'knowledge_review' as const, label: '运行门禁审查' },
      }
    case 'add_test_evidence':
    case 'fix_test_failure':
      return {
        requiredRole: '开发者或 QA',
        requiredEvidence: '由受控测试入口保存的通过 Test Evidence',
        completion: '测试证据已保存，相关测试规则重新评估为满足。',
        cta: { kind: 'tests' as const, label: '去 Tests 处理' },
      }
    case 'sync_policy':
      return {
        requiredRole: '已配对的 Team 成员',
        requiredEvidence: '可用且版本明确的 Team Policy snapshot',
        completion: '团队策略同步成功，并使用新 policy version 重新评估 Gate。',
        cta: { kind: 'sync_policy' as const, label: '同步团队策略' },
      }
    case 'resolve_hard_block':
      return {
        requiredRole: '规则责任人；不可 Override',
        requiredEvidence: '规则要求的修复产物与可验证 Evidence',
        completion: '强制规则不再命中后重新评估 Gate。',
        manualGuidance: '该强制规则没有自动修复入口，请按规则说明人工修复并补齐证据。',
      }
    case 'collect_evidence':
      return {
        requiredRole: '证据责任人',
        requiredEvidence: '规则要求的 Artifact 或 Evidence',
        completion: '所需证据关联到当前 Gate，并完成重新评估。',
        manualGuidance: '请从对应产物来源补齐证据；此页面不会伪造或直接写入 Evidence。',
      }
    case 'address_agent_finding':
    case 'fix_api_contract':
    case undefined:
      return {
        requiredRole: '对应实现或规则责任人',
        requiredEvidence: '修复后的 Artifact、Diff 或 Evidence',
        completion: '事实问题修复，相关规则重新评估后不再命中。',
        manualGuidance: '当前没有安全的自动动作，请在受控工作流中完成修复并重新评估。',
      }
  }
}

function titleForReason(reason: GateEnforcementReason): string {
  if (reason.id === 'policy-unavailable' || reason.ruleKey === 'policy-unavailable') return '团队策略尚未同步'
  if (reason.target === 'missing_agent_review') return '缺少门禁审查'
  if (reason.target === 'governance_check') return '治理条件需要处理'
  return '门禁审查 finding 需要处理'
}

function buildItem(input: {
  decision: GateEnforcementDecision
  reason: GateEnforcementReason | undefined
  candidate: RemediationCandidate | undefined
  planIsStale: boolean
  isStartingRetry: boolean
}): GateRemediationItem {
  const { candidate, reason } = input
  const inferredKind = reason ? inferCandidateKind(input.decision, reason) : undefined
  const details = candidateDetails(candidate?.kind ?? inferredKind, candidate?.eligibleForCodingRetry ?? false)
  let status: GateRemediationItemStatus = 'open'
  if (input.planIsStale) {
    status = 'stale'
  } else if (!reason) {
    status = input.decision.status === 'pass' || input.decision.status === 'overridden' ? 'resolved' : 'stale'
  } else if (input.isStartingRetry && candidate?.eligibleForCodingRetry) {
    status = 'in_progress'
  }
  const action = candidate?.summary ?? reason?.remediation ?? reason?.summary ?? '重新获取当前 Gate 诊断。'
  const severity = reason
    ? severityFor(input.decision, reason)
    : candidate?.priority === 'high'
      ? 'block'
      : 'warning'

  return {
    id: candidate?.id ?? `remediation-reason-${reason!.id}`,
    title: candidate?.title ?? titleForReason(reason!),
    source: reason
      ? reason.sourceId
        ? `${reason.target} · ${reason.sourceId}`
        : reason.target
      : '旧 Remediation Plan',
    ruleKey: reason?.ruleKey ?? candidate?.sourceReasonIds[0] ?? 'unknown-rule',
    severity,
    mandatory: Boolean(reason?.action === 'block' && input.decision.status !== 'overridden'),
    why: reason?.summary ?? '该事项来自旧诊断，当前规则集合已变化。',
    action,
    requiredRole: details.requiredRole,
    requiredEvidence: details.requiredEvidence,
    completion: details.completion,
    status,
    statusLabel: statusLabels[status],
    ...(details.cta && status !== 'resolved' && status !== 'stale' ? { cta: details.cta } : {}),
    ...(details.manualGuidance ? { manualGuidance: details.manualGuidance } : {}),
    ...(candidate ? { candidateId: candidate.id } : {}),
  }
}

export function buildGateRemediationViewModel(input: {
  decision: GateEnforcementDecision | null
  remediationPlan: RemediationPlan | null
  overrides: GateOverrideDecision[]
  canSaveOverride: boolean
  isStartingRetry: boolean
}): GateRemediationViewModel {
  const activeOverride = input.overrides.find((override) =>
    override.status === 'accepted' || override.status === 'provisional' || override.status === 'rejected',
  )
  if (!input.decision) {
    return {
      activeItems: [],
      resolvedItems: [],
      emptyMessage: '当前没有可用的 Gate 诊断，暂时无法生成恢复计划。',
      override: { active: activeOverride, canOpen: false, requiredRole: 'lead' },
    }
  }

  const reasons = [...input.decision.blockingReasons, ...input.decision.warningReasons]
  const reasonsById = new Map(reasons.map((reason) => [reason.id, reason]))
  const candidates = input.remediationPlan?.candidates ?? []
  const planIsStale = Boolean(
    input.remediationPlan && input.remediationPlan.policyVersion !== input.decision.policyVersion,
  )
  const candidateReasonIds = new Set(
    planIsStale ? [] : candidates.flatMap((candidate) => candidate.sourceReasonIds),
  )
  const items = [
    ...candidates.map((candidate) => buildItem({
      decision: input.decision!,
      reason: candidate.sourceReasonIds.map((id) => reasonsById.get(id)).find(Boolean),
      candidate,
      planIsStale,
      isStartingRetry: input.isStartingRetry,
    })),
    ...reasons
      .filter((reason) => !candidateReasonIds.has(reason.id))
      .map((reason) => buildItem({
        decision: input.decision!,
        reason,
        candidate: undefined,
        planIsStale: false,
        isStartingRetry: false,
      })),
  ]
  const activeItems = items
    .filter((item) => item.status !== 'resolved')
    .sort((left, right) => Number(left.status === 'stale') - Number(right.status === 'stale'))
  const resolvedItems = items.filter((item) => item.status === 'resolved')

  return {
    activeItems,
    resolvedItems,
    emptyMessage: activeItems.length === 0
      ? '当前没有需要整改的事项；Gate 可按现有条件继续。'
      : '',
    override: {
      active: activeOverride,
      canOpen: input.decision.status === 'blocked' && input.decision.canOverride && input.canSaveOverride,
      requiredRole: input.decision.overrideRoleRequired,
    },
  }
}
