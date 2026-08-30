import { useState } from 'react'
import type {
  GateEnforcementDecision,
  GateEnforcementReason,
  GateOverrideDecision,
  PolicySnapshot,
  RemediationPlan,
} from '@ai-devflow/shared'
import {
  buildGateRemediationViewModel,
  type GateRemediationItem,
} from './app/gate-remediation-view-model'

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

const remediationSeverityLabels: Record<GateRemediationItem['severity'], string> = {
  hard_block: '强制阻断',
  block: '阻断',
  warning: '警告',
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
  overrides,
  isLoading,
  canSaveOverride,
  pairingState,
  isStartingRetry,
  isInspectorWriteBlocked,
  onSyncTeam,
  onOpenTests,
  onOpenOverride,
  onRunKnowledgeReview,
  onStartRetry,
}: {
  decision: GateEnforcementDecision | null
  remediationPlan: RemediationPlan | null
  overrides: GateOverrideDecision[]
  isLoading: boolean
  canSaveOverride: boolean
  pairingState: 'unpaired' | 'paired' | 'sync_failed'
  isStartingRetry: boolean
  isInspectorWriteBlocked: boolean
  onSyncTeam: () => void
  onOpenTests: () => void
  onOpenOverride: () => void
  onRunKnowledgeReview: () => void
  onStartRetry: (candidateId: string) => void
}) {
  const viewModel = buildGateRemediationViewModel({
    decision,
    remediationPlan,
    overrides,
    canSaveOverride,
    isStartingRetry,
  })

  if (isLoading) {
    return <p className="empty-note">正在整理处理动作...</p>
  }

  const renderAction = (item: GateRemediationItem) => {
    if (!item.cta) return null
    if (item.cta.kind === 'knowledge_review') {
      return (
        <button className="ghost-button" disabled={isInspectorWriteBlocked} onClick={onRunKnowledgeReview}>
          {item.cta.label}
        </button>
      )
    }
    if (item.cta.kind === 'tests') {
      return <button className="ghost-button" onClick={onOpenTests}>{item.cta.label}</button>
    }
    if (item.cta.kind === 'sync_policy') {
      return pairingState === 'paired' ? (
        <button className="ghost-button" disabled={isInspectorWriteBlocked} onClick={onSyncTeam}>
          {item.cta.label}
        </button>
      ) : (
        <small>先绑定 Team Project，再同步团队策略。</small>
      )
    }
    if (!item.candidateId) {
      return <small>当前 Retry 缺少受控 candidate，请重新评估 Gate。</small>
    }
    return (
      <button
        className="ghost-button"
        data-testid={`retry-coding-${item.candidateId}`}
        disabled={isStartingRetry || isInspectorWriteBlocked}
        title={isInspectorWriteBlocked && !isStartingRetry ? '其他 Inspector 操作正在进行中' : undefined}
        onClick={() => onStartRetry(item.candidateId!)}
      >
        {isStartingRetry ? 'Starting retry...' : item.cta.label}
      </button>
    )
  }

  return (
    <div className="remediation-plan" data-testid="remediation-actions">
      <span className="panel-label">Remediation · 恢复计划</span>
      {viewModel.emptyMessage ? (
        <p className="empty-note">{viewModel.emptyMessage}</p>
      ) : null}
      {viewModel.activeItems.map((item) => (
        <article className={`remediation-candidate remediation-candidate--${item.severity}`} key={item.id}>
          <div className="compact-row">
            <strong>{item.title}</strong>
            <div className="row">
              <span className={`pill ${item.severity === 'warning' ? 'warn' : 'bad'}`}>
                {remediationSeverityLabels[item.severity]}
              </span>
              <span className={`pill ${item.status === 'stale' ? 'soft' : item.severity === 'warning' ? 'warn' : 'bad'}`}>
                {item.statusLabel}
              </span>
              <span className={`pill ${item.mandatory ? 'bad' : 'soft'}`}>
                {item.mandatory ? '必做' : '可选'}
              </span>
            </div>
          </div>
          <div className="knowledge-reference-meta">
            <span>来源：{item.source}</span>
            <code>{item.ruleKey}</code>
          </div>
          <p><strong>为什么：</strong>{item.why}</p>
          <p><strong>怎么做：</strong>{item.action}</p>
          <dl className="remediation-facts">
            <div><dt>负责角色</dt><dd>{item.requiredRole}</dd></div>
            <div><dt>所需证据</dt><dd>{item.requiredEvidence}</dd></div>
            <div><dt>完成标准</dt><dd>{item.completion}</dd></div>
          </dl>
          {item.manualGuidance ? <small>{item.manualGuidance}</small> : null}
          {renderAction(item)}
        </article>
      ))}
      {viewModel.resolvedItems.length > 0 ? (
        <details className="gate-technical-details" data-testid="resolved-remediation-items">
          <summary>已解决 {viewModel.resolvedItems.length} 项</summary>
          {viewModel.resolvedItems.map((item) => <p key={item.id}>{item.title} · {item.statusLabel}</p>)}
        </details>
      ) : null}
      {viewModel.override.active || viewModel.override.canOpen ? (
        <section className="remediation-override" data-testid="remediation-override">
          <span className="panel-label">治理例外（非整改）</span>
          {viewModel.override.active ? (
            <div className={`override-state override-state--${viewModel.override.active.status}`}>
              <strong>{overrideLabel(viewModel.override.active)}</strong>
              <p>{viewModel.override.active.reason}</p>
            </div>
          ) : null}
          {viewModel.override.canOpen ? (
            <button className="ghost-button" onClick={onOpenOverride}>前往独立 Lead Override</button>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
