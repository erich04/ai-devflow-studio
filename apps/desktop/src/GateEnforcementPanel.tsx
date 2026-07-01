import { useState } from 'react'
import type {
  GateEnforcementDecision,
  GateOverrideDecision,
  PolicySnapshot,
  RemediationPlan,
} from '@ai-devflow/shared'

const policySourceLabels: Record<GateEnforcementDecision['policySource'], string> = {
  remote_cache: 'remote_cache',
  built_in_default: 'built_in_default',
  unavailable: 'unavailable',
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
  remediationPlan,
  isLoading,
  canSaveOverride,
  isStartingRetry = false,
  onSaveOverride,
  onStartRetry,
  pairingState = 'unpaired',
  onSyncTeam,
  onRunKnowledgeReview,
  isCurrentNodeAgent = false,
  isSavingOverride = false,
  isInspectorWriteBlocked = false,
}: {
  policySnapshot: PolicySnapshot | null
  decision: GateEnforcementDecision | null
  overrides: GateOverrideDecision[]
  remediationPlan: RemediationPlan | null
  isLoading: boolean
  canSaveOverride: boolean
  isStartingRetry?: boolean
  onSaveOverride: (reason: string, provisional: boolean) => void
  onStartRetry?: (candidateId: string) => void
  pairingState?: 'unpaired' | 'paired' | 'sync_failed'
  onSyncTeam?: () => void
  onRunKnowledgeReview?: () => void
  isCurrentNodeAgent?: boolean
  isSavingOverride?: boolean
  isInspectorWriteBlocked?: boolean
}) {
  const [overrideReason, setOverrideReason] = useState('Reviewed blocking reason and approved a temporary exception.')
  const activeOverride = overrides.find((override) =>
    override.status === 'accepted' || override.status === 'provisional' || override.status === 'rejected',
  )
  const canShowOverrideForm =
    decision?.status === 'blocked' &&
    decision.canOverride &&
    canSaveOverride
  const isOverrideSaveDisabled = !overrideReason.trim() || isSavingOverride || isInspectorWriteBlocked
  const hasMissingAgentReview = Boolean(
    decision?.blockingReasons.some((reason) => reason.target === 'missing_agent_review') ||
      decision?.warningReasons.some((reason) => reason.target === 'missing_agent_review'),
  )

  return (
    <div className="agent-advisory-list">
      <span className="panel-label">Gate Enforcement</span>
      {isLoading ? (
        <p className="empty-note">正在加载 Gate Enforcement...</p>
      ) : decision ? (
        <article className={`agent-advisory agent-advisory--${gateEnforcementTone(decision.status)}`}>
          <div className="compact-row">
            <strong>{decision.status}</strong>
            <span>{decision.blocksApproval ? 'blocks approval' : 'approval allowed'}</span>
          </div>
          <div className="knowledge-reference-meta">
            <span>{policySourceLabels[decision.policySource]}</span>
            <span>policy v{decision.policyVersion}</span>
            {policySnapshot?.syncedAt ? <span>synced {policySnapshot.syncedAt}</span> : null}
          </div>
          {decision.status === 'blocked_policy_unavailable' ? (
            <div className="enforcement-cta" data-testid="policy-unavailable-cta">
              <p>
                {pairingState === 'unpaired'
                  ? 'Team enforcement policy is unavailable. Pair this Desktop with the team project, then sync policy before approving this Gate.'
                  : 'Team enforcement policy is unavailable. Sync team policy before approving this Gate.'}
              </p>
              {pairingState === 'paired' && onSyncTeam ? (
                <button className="ghost-button" onClick={onSyncTeam}>
                  同步团队
                </button>
              ) : null}
            </div>
          ) : null}
          {hasMissingAgentReview ? (
            <div className="enforcement-cta" data-testid="missing-agent-review-cta">
              <p>Gate 前置证据不足。先运行 Agent Review，再重新评估 Gate。</p>
              {onRunKnowledgeReview ? (
                <button className="ghost-button" onClick={onRunKnowledgeReview}>
                  运行 Agent Review
                </button>
              ) : null}
            </div>
          ) : null}
          {isCurrentNodeAgent ? (
            <div className="enforcement-cta" data-testid="agent-node-not-completed-cta">
              <p>流程还没到 Gate。先生成当前 Agent 阶段产物，再进入对应 Gate。</p>
            </div>
          ) : null}
          {[...decision.blockingReasons, ...decision.warningReasons].map((reason) => (
            <div className="enforcement-reason" key={reason.id}>
              <div className="compact-row">
                <strong>{reason.action}</strong>
                <code>{reason.ruleKey}</code>
              </div>
              <p>{reason.summary}</p>
              {reason.remediation ? <small>{reason.remediation}</small> : null}
            </div>
          ))}
          {activeOverride ? (
            <div className={`override-state override-state--${activeOverride.status}`}>
              <strong>{overrideLabel(activeOverride)}</strong>
              <p>{activeOverride.reason}</p>
            </div>
          ) : null}
          {remediationPlan && remediationPlan.candidates.length > 0 ? (
            <div className="remediation-plan" data-testid="remediation-plan">
              <div className="compact-row">
                <strong>Remediation Plan</strong>
                <span>{remediationPlan.candidates.length} candidates</span>
              </div>
              {remediationPlan.remainingEvidenceGaps.length > 0 ? (
                <p>
                  Remaining evidence gaps:{' '}
                  {remediationPlan.remainingEvidenceGaps.join(', ')}
                </p>
              ) : null}
              {remediationPlan.candidates.map((candidate) => (
                <div className="remediation-candidate" key={candidate.id}>
                  <div className="compact-row">
                    <strong>{candidate.title}</strong>
                    <span>{candidate.priority}</span>
                  </div>
                  <p>{candidate.summary}</p>
                  <small>{candidate.kind}</small>
                  {candidate.eligibleForCodingRetry && onStartRetry ? (
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
                </div>
              ))}
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
                onClick={() => onSaveOverride(overrideReason, false)}
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
