import { useState } from 'react'
import type {
  GateEnforcementDecision,
  GateEnforcementReason,
  GateOverrideDecision,
  PolicySnapshot,
  RemediationPlan,
} from '@ai-devflow/shared'

const policySourceLabels: Record<GateEnforcementDecision['policySource'], string> = {
  remote_cache: '团队远端缓存',
  built_in_default: '内置默认策略',
  unavailable: '不可用',
}

function gateEnforcementTone(status: GateEnforcementDecision['status']) {
  if (status === 'blocked' || status === 'hard_blocked' || status === 'blocked_policy_unavailable') {
    return 'block'
  }
  if (status === 'warn' || status === 'overridden') {
    return 'warn'
  }
  return 'info'
}

function enforcementHeadline(decision: GateEnforcementDecision): string {
  if (decision.status === 'blocked_policy_unavailable') return '团队策略不可用'
  if (decision.status === 'hard_blocked') return `存在 ${decision.blockingReasons.length} 项强制阻断`
  if (decision.status === 'blocked') return `存在 ${decision.blockingReasons.length} 项阻断`
  if (decision.status === 'overridden') return '阻断已由 Lead 例外放行'
  if (decision.status === 'warn') return `存在 ${decision.warningReasons.length} 项警告`
  return 'Gate Enforcement 已通过'
}

function enforcementIcon(decision: GateEnforcementDecision): string {
  if (decision.blocksApproval) return '⛔'
  if (decision.status === 'warn' || decision.status === 'overridden') return '⚠'
  return '✓'
}

function reasonTitle(reason: GateEnforcementReason): string {
  if (reason.id === 'policy-unavailable' || reason.ruleKey === 'policy-unavailable') {
    return '团队策略尚未同步'
  }
  if (reason.target === 'missing_agent_review') {
    return '尚未运行门禁审查'
  }
  if (reason.target === 'governance_check') {
    return '知识治理条件未满足'
  }
  return '门禁审查发现风险'
}

function nextStepForDecision(decision: GateEnforcementDecision): string {
  const primaryReason = decision.blockingReasons[0] ?? decision.warningReasons[0]
  if (decision.status === 'blocked_policy_unavailable') {
    return '同步团队策略后重新评估 Gate。'
  }
  if (primaryReason?.target === 'missing_agent_review') {
    return '运行基于知识的门禁审查，然后重新评估 Gate。'
  }
  if (decision.requiredActions[0]) {
    return decision.requiredActions[0]
  }
  if (primaryReason?.remediation) {
    return primaryReason.remediation
  }
  if (decision.blocksApproval) {
    return '在 Remediation 中处理首要阻断项，然后重新评估 Gate。'
  }
  if (decision.status === 'warn') {
    return '确认警告影响；当前策略允许继续审批。'
  }
  return '确认条件和证据后通过 Gate。'
}

function overrideLabel(override: GateOverrideDecision): string {
  if (override.status === 'rejected') {
    return 'Rejected override'
  }
  return override.provisional ? 'Provisional override' : 'Confirmed override'
}

export function GateEnforcementPanel({
  policySnapshot,
  decision,
  overrides,
  isLoading,
  canSaveOverride,
  onSaveOverride,
  isSavingOverride = false,
  isInspectorWriteBlocked = false,
}: {
  policySnapshot: PolicySnapshot | null
  decision: GateEnforcementDecision | null
  overrides: GateOverrideDecision[]
  isLoading: boolean
  canSaveOverride: boolean
  onSaveOverride: (reason: string) => void
  isSavingOverride?: boolean
  isInspectorWriteBlocked?: boolean
}) {
  const [overrideReason, setOverrideReason] = useState('Reviewed blocking reason and approved a temporary exception.')
  const activeOverride = overrides.find((override) =>
    override.status === 'accepted' || override.status === 'provisional' || override.status === 'rejected',
  )
  const canShowOverrideForm = decision?.status === 'blocked' && decision.canOverride && canSaveOverride
  const isOverrideSaveDisabled = !overrideReason.trim() || isSavingOverride || isInspectorWriteBlocked
  const reasons = decision ? [...decision.blockingReasons, ...decision.warningReasons] : []
  const primaryReason = reasons[0]

  return (
    <div className="agent-advisory-list" data-testid="gate-enforcement-details">
      <span className="panel-label">Gate Enforcement · 详细结论</span>
      {isLoading ? (
        <p className="empty-note">正在加载 Gate Enforcement...</p>
      ) : decision ? (
        <article className={`agent-advisory agent-advisory--${gateEnforcementTone(decision.status)}`}>
          <section className="gate-enforcement-summary" aria-live="polite" data-testid="gate-enforcement-summary">
            <div className="compact-row">
              <strong><span aria-hidden="true">{enforcementIcon(decision)}</span> {enforcementHeadline(decision)}</strong>
              <span className={`pill ${decision.blocksApproval ? 'bad' : decision.status === 'pass' ? 'good' : 'warn'}`}>
                {decision.blocksApproval ? '阻断审批' : '可继续审批'}
              </span>
            </div>
            <dl className="gate-enforcement-facts">
              <div>
                <dt>主要原因</dt>
                <dd>{primaryReason ? `${reasonTitle(primaryReason)}：${primaryReason.summary}` : '所有 Enforcement 条件已满足。'}</dd>
              </div>
              <div>
                <dt>主要下一步</dt>
                <dd>{nextStepForDecision(decision)}</dd>
              </div>
            </dl>
          </section>

          {reasons.length > 0 ? (
            <section className="enforcement-findings" aria-label="Gate Enforcement 详细原因">
              {reasons.map((reason) => (
                <article className="enforcement-reason" key={reason.id} data-testid="enforcement-finding">
                  <div className="compact-row">
                    <strong>{reasonTitle(reason)}</strong>
                    <span className={`pill ${reason.action === 'block' ? 'bad' : 'warn'}`}>
                      {reason.action === 'block' ? '阻断' : '警告'}
                    </span>
                  </div>
                  <p>{reason.summary}</p>
                  {reason.remediation ? <small>处理方法：{reason.remediation}</small> : null}
                </article>
              ))}
            </section>
          ) : (
            <p className="empty-note">没有 Enforcement 警告或阻断项。</p>
          )}

          <details className="gate-technical-details" data-testid="gate-technical-details">
            <summary>查看技术详情</summary>
            <div className="knowledge-reference-meta">
              <span>{policySourceLabels[decision.policySource]}</span>
              <span>policy v{decision.policyVersion}</span>
              {policySnapshot?.syncedAt ? <span>synced {policySnapshot.syncedAt}</span> : null}
            </div>
            {reasons.map((reason) => (
              <div className="gate-technical-rule" key={reason.id}>
                <code>{reason.ruleKey}</code>
                {reason.sourceId ? <span>source {reason.sourceId}</span> : null}
              </div>
            ))}
          </details>

          {activeOverride ? (
            <div className={`override-state override-state--${activeOverride.status}`}>
              <strong>{overrideLabel(activeOverride)}</strong>
              <p>{activeOverride.reason}</p>
            </div>
          ) : null}
          {canShowOverrideForm ? (
            <div className="override-form">
              <label>
                Lead override reason
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                />
              </label>
              <button
                className="ghost-button"
                aria-busy={isSavingOverride || undefined}
                disabled={isOverrideSaveDisabled}
                title={isInspectorWriteBlocked && !isSavingOverride ? '其他 Inspector 操作正在进行中' : undefined}
                onClick={() => onSaveOverride(overrideReason)}
              >
                {isSavingOverride ? '保存中' : 'Save lead override'}
              </button>
            </div>
          ) : null}
        </article>
      ) : (
        <p className="empty-note">当前环境尚未加载 Gate Enforcement。</p>
      )}
    </div>
  )
}

export function GateRemediationPanel({
  decision,
  remediationPlan,
  isLoading,
  pairingState,
  isStartingRetry,
  isInspectorWriteBlocked,
  onSyncTeam,
  onRunKnowledgeReview,
  onStartRetry,
}: {
  decision: GateEnforcementDecision | null
  remediationPlan: RemediationPlan | null
  isLoading: boolean
  pairingState: 'unpaired' | 'paired' | 'sync_failed'
  isStartingRetry: boolean
  isInspectorWriteBlocked: boolean
  onSyncTeam: () => void
  onRunKnowledgeReview: () => void
  onStartRetry: (candidateId: string) => void
}) {
  if (isLoading) {
    return <p className="empty-note">正在整理处理动作...</p>
  }

  const candidates = remediationPlan?.candidates ?? []
  const fallbackActions = candidates.length === 0 ? (decision?.requiredActions ?? []) : []

  return (
    <div className="remediation-plan" data-testid="remediation-actions">
      <span className="panel-label">Remediation · 处理动作</span>
      {candidates.length === 0 && fallbackActions.length === 0 ? (
        <p className="empty-note">当前没有需要执行的处理动作。</p>
      ) : null}
      {candidates.map((candidate, index) => {
        const canRunReview = candidate.kind === 'run_agent_review'
        const canSyncPolicy = candidate.kind === 'sync_policy' && pairingState === 'paired'
        const canRetryCoding = candidate.eligibleForCodingRetry

        return (
          <article className="remediation-candidate" key={candidate.id}>
            <div className="compact-row">
              <strong>{candidate.title}</strong>
              <span>{index === 0 ? '主要下一步' : candidate.priority}</span>
            </div>
            <p>{candidate.summary}</p>
            {candidate.kind === 'sync_policy' && pairingState === 'unpaired' ? (
              <small>先绑定 Team Project，再同步团队策略。</small>
            ) : null}
            {canRunReview ? (
              <button className="ghost-button" disabled={isInspectorWriteBlocked} onClick={onRunKnowledgeReview}>
                运行门禁审查
              </button>
            ) : null}
            {canSyncPolicy ? (
              <button className="ghost-button" disabled={isInspectorWriteBlocked} onClick={onSyncTeam}>
                同步团队策略
              </button>
            ) : null}
            {canRetryCoding ? (
              <button
                className="ghost-button"
                data-testid={`retry-coding-${candidate.id}`}
                disabled={isStartingRetry || isInspectorWriteBlocked}
                title={isInspectorWriteBlocked && !isStartingRetry ? '其他 Inspector 操作正在进行中' : undefined}
                onClick={() => onStartRetry(candidate.id)}
              >
                {isStartingRetry ? 'Starting retry...' : 'Retry Coding'}
              </button>
            ) : null}
          </article>
        )
      })}
      {fallbackActions.map((action) => (
        <article className="remediation-candidate" key={action}>
          <strong>待处理</strong>
          <p>{action}</p>
        </article>
      ))}
    </div>
  )
}
