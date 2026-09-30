'use client'

import { useRef, useState, type FormEvent } from 'react'
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

const SAVED_MESSAGE = '已保存到团队。桌面端是否已同步无法从 Web 确认；请在桌面端执行“更新团队数据”。'

/** Display only; the stored approval status stays unchanged. */
const approvalStatusLabels: Record<RuntimeBudgetApproval['status'], string> = {
  approved: '已批准',
  rejected: '已驳回',
  expired: '已过期',
}

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
  const [policy, setPolicy] = useState(initialPolicy)
  const [enabled, setEnabled] = useState(initialPolicy?.enabled ?? false)
  const [monthlyLimitUsd, setMonthlyLimitUsd] = useState(
    initialPolicy ? String(initialPolicy.monthlyLimitUsd) : '',
  )
  const [warningThresholdUsd, setWarningThresholdUsd] = useState(
    initialPolicy ? String(initialPolicy.warningThresholdUsd) : '',
  )
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' })
  const [isPending, setIsPending] = useState(false)
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

  async function handlePolicySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInFlight.current) return

    submissionInFlight.current = true
    setIsPending(true)
    setFeedback({ kind: 'idle' })
    const formData = new FormData(event.currentTarget)
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
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : '预算规则保存失败，请重试。',
      })
    } finally {
      submissionInFlight.current = false
      setIsPending(false)
    }
  }

  const feedbackMessage = feedback.kind === 'error'
    ? feedback.message
    : isPending
      ? '正在保存到团队…'
      : feedback.kind === 'success'
        ? SAVED_MESSAGE
        : dirty
          ? '有尚未保存到团队的修改。'
          : policy
            ? SAVED_MESSAGE
            : '团队尚未配置预算规则；桌面端当前没有可同步的预算规则。'
  const saveButtonLabel = isPending
    ? '保存中…'
    : feedback.kind === 'error'
      ? '保存失败，重试'
      : dirty
        ? '保存预算规则'
        : policy
          ? '已保存'
          : '填写后保存'

  return (
    <div className="runtime-budget-layout" data-testid="runtime-budget-layout">
      <article className="runtime-budget-group runtime-budget-summary">
        <div className="runtime-budget-group-heading">
          <div>
            <span>当前规则</span>
            <strong>
              {policy ? (policy.enabled ? '预算已启用' : '预算未启用') : '尚未配置预算规则'}
            </strong>
          </div>
          <time dateTime={policy?.updatedAt}>{formatUpdatedAt(policy?.updatedAt)}</time>
        </div>
        <div className="runtime-budget-metrics" aria-label="预算摘要">
          <span>月上限 {policy ? formatUsd(policy.monthlyLimitUsd) : '未配置'}</span>
          <span>预警阈值 {policy ? formatUsd(policy.warningThresholdUsd) : '未配置'}</span>
          <span>已用 {formatUsd(spendUsd)}</span>
        </div>
        <p>此处显示团队服务端保存的规则，不代表桌面端已经完成同步。</p>
      </article>

      <form
        className="runtime-budget-group runtime-budget-policy-form"
        data-testid="runtime-budget-policy-form"
        onSubmit={handlePolicySubmit}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <div className="runtime-budget-group-heading runtime-budget-policy-heading">
          <div>
            <span>预算规则</span>
            <strong>团队配置</strong>
          </div>
        </div>
        <div className="runtime-budget-policy-fields">
          <label>
            启用预算
            <input
              aria-label="启用预算"
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
            月上限（USD）
            <input
              aria-label="月上限（USD）"
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
            预警阈值（USD）
            <input
              aria-label="预警阈值（USD）"
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
            <span>批准记录</span>
            <strong>一次性预算批准</strong>
          </div>
          <span>{approvals.length} 条</span>
        </div>
        {approvals.length > 0 ? (
          approvals.map((approval) => (
            <article className="runtime-budget-approval" key={approval.id}>
              <strong className="runtime-budget-approval-id">{approval.id}</strong>
              <p>{approval.reason}</p>
              <span>{approvalStatusLabels[approval.status] ?? approval.status} · {formatUsd(approval.maxAdditionalCostUsd)}</span>
            </article>
          ))
        ) : (
          <div className="runtime-budget-empty">
            <strong>暂无一次性预算批准</strong>
            <p>Lead 创建批准后，桌面端可用它重试真实模型运行。</p>
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
            <span>新建批准</span>
            <strong>创建一次性预算批准</strong>
          </div>
        </div>
        <input type="hidden" name="projectId" value={projectId} />
        <label>
          申请人
          <input
            aria-label="申请人"
            name="requestedBy"
            placeholder="当前会话不可用"
            readOnly
            required
            title={sessionUser ? `${sessionUser.name}（当前会话）` : '当前会话不可用'}
            value={sessionUser?.id ?? ''}
          />
        </label>
        <label>
          模型提供方
          <select
            aria-label="模型提供方"
            defaultValue={selectedProvider?.id ?? ''}
            disabled={!selectedProvider}
            name="providerId"
            required
          >
            {!selectedProvider ? <option value="">没有可用的模型提供方</option> : null}
            {availableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </option>
            ))}
          </select>
        </label>
        <label>
          额外费用上限（USD）
          <input min="0.001" name="maxAdditionalCostUsd" step="0.001" type="number" required />
        </label>
        <label>
          过期时间
          <input
            aria-label="过期时间"
            aria-describedby="runtime-budget-expiry-help"
            name="expiresAt"
            placeholder="留空则默认 24 小时"
          />
          <small id="runtime-budget-expiry-help">填写 ISO 时间，或留空使用 24 小时有效期。</small>
        </label>
        <label className="runtime-budget-approval-reason">
          原因
          <textarea name="reason" placeholder="说明本次额外预算的用途" required />
        </label>
        <button
          className="runtime-budget-approval-submit"
          disabled={!sessionUser || !selectedProvider}
          type="submit"
        >
          创建批准
        </button>
      </form>
    </div>
  )
}
