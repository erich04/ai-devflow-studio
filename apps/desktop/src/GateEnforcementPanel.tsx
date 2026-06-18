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
}) {
  const [overrideReason, setOverrideReason] = useState('Reviewed blocking reason and approved a temporary exception.')
  const activeOverride = overrides.find((override) =>
    override.status === 'accepted' || override.status === 'provisional' || override.status === 'rejected',
  )
  const canShowOverrideForm =
    decision?.status === 'blocked' &&
    decision.canOverride &&
    canSaveOverride

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
            <p>Team enforcement policy is unavailable. Sync policy before approving this Gate.</p>
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
                      disabled={isStartingRetry}
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
                disabled={!overrideReason.trim()}
                onClick={() => onSaveOverride(overrideReason, false)}
              >
                Save lead override
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
