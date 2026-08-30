'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { formatUsd } from '@ai-devflow/shared'
import type {
  AgentProviderConfig,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
} from '@ai-devflow/shared'
import type { RuntimeBudgetPolicySaveResult } from './runtime-budget-actions'

type RuntimeBudgetPanelProps = {
  projectId: string
  initialPolicy: RuntimeBudgetPolicy | null
  approvals: RuntimeBudgetApproval[]
  spendUsd: number
  providers: AgentProviderConfig[]
  sessionUser: { id: string; name: string } | null
  savePolicyAction: (formData: FormData) => Promise<RuntimeBudgetPolicySaveResult>
  createApprovalAction: (formData: FormData) => Promise<void>
}

type SaveFeedback =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return '尚未保存'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '更新时间不可用'
  return `更新于 ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function RuntimeBudgetPanel({
  projectId,
  initialPolicy,
  approvals,
  spendUsd,
  providers,
  sessionUser,
  savePolicyAction,
  createApprovalAction,
}: RuntimeBudgetPanelProps) {
  const router = useRouter()
  const [policy, setPolicy] = useState(initialPolicy)
  const [enabled, setEnabled] = useState(initialPolicy?.enabled ?? false)
  const [monthlyLimitUsd, setMonthlyLimitUsd] = useState(
    initialPolicy ? String(initialPolicy.monthlyLimitUsd) : '',
  )
  const [warningThresholdUsd, setWarningThresholdUsd] = useState(
    initialPolicy ? String(initialPolicy.warningThresholdUsd) : '',
  )
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const submissionInFlight = useRef(false)
  const availableProviders = providers.filter((provider) => provider.enabled)
  const selectedProvider = availableProviders[0]
  const dirty =
    enabled !== (policy?.enabled ?? false) ||
    monthlyLimitUsd !== (policy ? String(policy.monthlyLimitUsd) : '') ||
    warningThresholdUsd !== (policy ? String(policy.warningThresholdUsd) : '')

  function clearSaveFeedback() {
    setFeedback({ kind: 'idle' })
  }

  function handlePolicySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInFlight.current) return

    submissionInFlight.current = true
    setFeedback({ kind: 'idle' })
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      try {
        const result = await savePolicyAction(formData)
        if (!result.ok) {
          setFeedback({ kind: 'error', message: result.error })
          return
        }

        setPolicy(result.policy)
        setEnabled(result.policy.enabled)
        setMonthlyLimitUsd(String(result.policy.monthlyLimitUsd))
        setWarningThresholdUsd(String(result.policy.warningThresholdUsd))
        setFeedback({ kind: 'success' })
        router.refresh()
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : '预算策略保存失败，请重试。',
        })
      } finally {
        submissionInFlight.current = false
      }
    })
  }

  const feedbackMessage = feedback.kind === 'error'
    ? feedback.message
    : isPending
      ? '正在保存到 Team…'
      : feedback.kind === 'success'
        ? 'Team 已保存。Electron 是否已同步无法从 Web 确认；请在 Electron 中执行“同步团队”。'
        : dirty
          ? '有尚未保存到 Team 的修改。'
          : policy
            ? 'Team 已保存。Electron 是否已同步无法从 Web 确认；请在 Electron 中执行“同步团队”。'
            : 'Team 尚未配置预算策略；Electron 当前没有可同步的预算策略。'
  const saveButtonLabel = isPending
    ? '保存中…'
    : feedback.kind === 'error'
      ? '保存失败，重试'
      : dirty
        ? '保存预算策略'
        : policy
          ? '已保存'
          : '填写后保存'

  return (
    <div className="runtime-budget-layout" data-testid="runtime-budget-layout">
      <article className="runtime-budget-group runtime-budget-summary">
        <div className="runtime-budget-group-heading">
          <div>
            <span>Team Policy</span>
            <strong>
              {policy ? (policy.enabled ? 'Budget enabled' : 'Budget disabled') : 'Budget not configured'}
            </strong>
          </div>
          <time dateTime={policy?.updatedAt}>{formatUpdatedAt(policy?.updatedAt)}</time>
        </div>
        <div className="runtime-budget-metrics" aria-label="Runtime budget summary">
          <span>monthly {policy ? formatUsd(policy.monthlyLimitUsd) : '未配置'}</span>
          <span>warning {policy ? formatUsd(policy.warningThresholdUsd) : '未配置'}</span>
          <span>spend {formatUsd(spendUsd)}</span>
        </div>
        <p>此处显示 Team 服务端保存的策略，不代表 Electron 已经完成同步。</p>
      </article>

      <form
        className="runtime-budget-group runtime-budget-policy-form"
        data-testid="runtime-budget-policy-form"
        onSubmit={handlePolicySubmit}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <div className="runtime-budget-group-heading runtime-budget-policy-heading">
          <div>
            <span>Budget Policy</span>
            <strong>Team 配置</strong>
          </div>
        </div>
        <div className="runtime-budget-policy-fields">
          <label>
            Enabled
            <input
              aria-label="Enable runtime budget"
              checked={enabled}
              name="enabled"
              onChange={(event) => {
                setEnabled(event.target.checked)
                clearSaveFeedback()
              }}
              type="checkbox"
            />
          </label>
          <label>
            Monthly limit USD
            <input
              aria-label="Monthly limit USD"
              min="0"
              name="monthlyLimitUsd"
              onChange={(event) => {
                setMonthlyLimitUsd(event.target.value)
                clearSaveFeedback()
              }}
              placeholder="尚未配置"
              required
              step="0.001"
              type="number"
              value={monthlyLimitUsd}
            />
          </label>
          <label>
            Warning threshold USD
            <input
              aria-label="Warning threshold USD"
              min="0"
              name="warningThresholdUsd"
              onChange={(event) => {
                setWarningThresholdUsd(event.target.value)
                clearSaveFeedback()
              }}
              placeholder="尚未配置"
              required
              step="0.001"
              type="number"
              value={warningThresholdUsd}
            />
          </label>
        </div>
        <button disabled={isPending || !dirty} type="submit">{saveButtonLabel}</button>
        <p
          aria-live="polite"
          className={`runtime-budget-feedback runtime-budget-feedback--${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedbackMessage}
        </p>
      </form>

      <section className="runtime-budget-group runtime-budget-approval-list runtime-budget-full-row">
        <div className="runtime-budget-group-heading">
          <div>
            <span>Approval History</span>
            <strong>Budget Approvals</strong>
          </div>
          <span>{approvals.length} 条</span>
        </div>
        {approvals.length > 0 ? (
          approvals.map((approval) => (
            <article className="runtime-budget-approval" key={approval.id}>
              <strong className="runtime-budget-approval-id">{approval.id}</strong>
              <p>{approval.reason}</p>
              <span>{approval.status} · {formatUsd(approval.maxAdditionalCostUsd)}</span>
            </article>
          ))
        ) : (
          <div className="runtime-budget-empty">
            <strong>暂无预算批准</strong>
            <p>Lead 创建 approval 后可用于 Desktop 重试真实 runtime。</p>
          </div>
        )}
      </section>

      <form
        action={createApprovalAction}
        className="runtime-budget-group runtime-budget-approval-form runtime-budget-full-row"
        data-testid="runtime-budget-approval-form"
      >
        <div className="runtime-budget-group-heading runtime-budget-approval-heading">
          <div>
            <span>New Approval</span>
            <strong>创建预算批准</strong>
          </div>
        </div>
        <input type="hidden" name="projectId" value={projectId} />
        <label>
          Requested by
          <input
            aria-label="Requested by"
            name="requestedBy"
            placeholder="当前会话不可用"
            readOnly
            required
            title={sessionUser ? `${sessionUser.name}（当前会话）` : '当前会话不可用'}
            value={sessionUser?.id ?? ''}
          />
        </label>
        <label>
          Provider
          <select
            aria-label="Provider"
            defaultValue={selectedProvider?.id ?? ''}
            disabled={!selectedProvider}
            name="providerId"
            required
          >
            {!selectedProvider ? <option value="">没有可用 Provider</option> : null}
            {availableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max additional cost USD
          <input min="0.001" name="maxAdditionalCostUsd" step="0.001" type="number" required />
        </label>
        <label>
          Expires at
          <input
            aria-label="Expires at"
            aria-describedby="runtime-budget-expiry-help"
            name="expiresAt"
            placeholder="留空则默认 24 小时"
          />
          <small id="runtime-budget-expiry-help">填写 ISO 时间，或留空使用 24 小时有效期。</small>
        </label>
        <label className="runtime-budget-approval-reason">
          Reason
          <textarea name="reason" placeholder="说明本次额外预算的用途" required />
        </label>
        <button
          className="runtime-budget-approval-submit"
          disabled={!sessionUser || !selectedProvider}
          type="submit"
        >
          Create approval
        </button>
      </form>
    </div>
  )
}
