import { useState } from 'react'
import type {
  GateEnforcementDecision,
  GateOverrideDecision,
  PolicySnapshot,
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
  isLoading,
  canSaveOverride,
  onSaveOverride,
}: {
  policySnapshot: PolicySnapshot | null
  decision: GateEnforcementDecision | null
  overrides: GateOverrideDecision[]
  isLoading: boolean
  canSaveOverride: boolean
  onSaveOverride: (reason: string, provisional: boolean) => void
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
