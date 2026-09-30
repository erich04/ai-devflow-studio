import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentProviderConfig,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
} from '@ai-devflow/shared'
import { RuntimeBudgetPanel } from './RuntimeBudgetPanel'

const initialPolicy: RuntimeBudgetPolicy = {
  projectId: 'project-1',
  enabled: false,
  monthlyLimitUsd: 0.2,
  warningThresholdUsd: 0.1,
  currency: 'USD',
  updatedAt: '2026-08-30T12:00:00.000Z',
}

const providers: AgentProviderConfig[] = [
  {
    id: 'provider-current',
    name: 'Current Team Provider',
    kind: 'openai-compatible',
    model: 'current-model',
    enabled: true,
    updatedAt: '2026-08-30T12:00:00.000Z',
  },
]

const approvals: RuntimeBudgetApproval[] = [
  {
    id: 'approval-current-1',
    projectId: 'project-1',
    requestedBy: 'user-current',
    approvedBy: 'lead-current',
    role: 'lead',
    providerId: 'provider-current',
    maxAdditionalCostUsd: 0.05,
    reason: 'Release verification',
    status: 'approved',
    createdAt: '2026-08-30T12:00:00.000Z',
    expiresAt: '2026-08-31T12:00:00.000Z',
  },
]

function renderPanel(
  options: {
    policy?: RuntimeBudgetPolicy | null
    providers?: AgentProviderConfig[]
    savePolicyAction?: (formData: FormData) => Promise<
      | { ok: true; policy: RuntimeBudgetPolicy }
      | { ok: false; error: string }
    >
    sessionUser?: { id: string; name: string } | null
  } = {},
) {
  const savePolicyAction = options.savePolicyAction ?? vi.fn(async () => ({
    ok: true as const,
    policy: initialPolicy,
  }))
  const createApprovalAction = vi.fn(async (_formData: FormData) => undefined)
  const result = render(
    <RuntimeBudgetPanel
      approvals={approvals}
      createApprovalAction={createApprovalAction}
      initialPolicy={options.policy === undefined ? initialPolicy : options.policy}
      projectId="project-1"
      providers={options.providers ?? providers}
      savePolicyAction={savePolicyAction}
      sessionUser={options.sessionUser === undefined
        ? { id: 'user-current', name: 'Current User' }
        : options.sessionUser}
      spendUsd={0.04}
    />,
  )
  return { ...result, createApprovalAction, savePolicyAction }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RuntimeBudgetPanel', () => {
  it('uses a dedicated responsive structure and current session/provider defaults', () => {
    const { container } = renderPanel()

    expect(screen.getByTestId('runtime-budget-layout')).toHaveClass('runtime-budget-layout')
    expect(screen.getByTestId('runtime-budget-approval-form')).toHaveClass(
      'runtime-budget-approval-form',
      'runtime-budget-full-row',
    )
    expect(screen.getByText('approval-current-1')).toHaveClass('runtime-budget-approval-id')

    expect(screen.getByLabelText('申请人')).toHaveValue('user-current')
    expect(screen.getByLabelText('申请人')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('模型提供方')).toHaveValue('provider-current')
    expect(screen.getByRole('option', { name: /Current Team Provider/ })).toBeInTheDocument()
    expect(screen.getByText('已批准 · $0.05')).toBeInTheDocument()
    expect(screen.getByLabelText('额外费用上限（USD）')).toHaveAttribute('name', 'maxAdditionalCostUsd')
    expect(screen.getByLabelText('过期时间')).toHaveAttribute(
      'placeholder',
      '留空则默认 24 小时',
    )
    expect(container).not.toHaveTextContent('u-erich')
    expect(container).not.toHaveTextContent('double')
    expect(container).not.toHaveTextContent('2026-06-22')
  })

  it('shows understandable empty values when session or Provider context is unavailable', () => {
    renderPanel({ policy: null, providers: [], sessionUser: null })

    expect(screen.getByLabelText('申请人')).toHaveValue('')
    expect(screen.getByLabelText('申请人')).toHaveAttribute(
      'placeholder',
      '当前会话不可用',
    )
    expect(screen.getByLabelText('模型提供方')).toBeDisabled()
    expect(screen.getByRole('option', { name: '没有可用的模型提供方' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建批准' })).toBeDisabled()
    expect(screen.getByText('尚未配置预算规则')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('团队尚未配置预算规则；桌面端当前没有可同步的预算规则。')
  })

  it('immediately refreshes the summary from the API policy and distinguishes the team save from desktop sync', async () => {
    const savedPolicy: RuntimeBudgetPolicy = {
      ...initialPolicy,
      enabled: true,
      monthlyLimitUsd: 0.4,
      warningThresholdUsd: 0.2,
      updatedAt: '2026-08-30T12:34:56.000Z',
    }
    const savePolicyAction = vi.fn(async () => ({ ok: true as const, policy: savedPolicy }))
    renderPanel({ savePolicyAction })

    fireEvent.click(screen.getByLabelText('启用预算'))
    fireEvent.change(screen.getByLabelText('月上限（USD）'), { target: { value: '0.35' } })
    expect(screen.getByRole('status')).toHaveTextContent('有尚未保存到团队的修改。')
    expect(screen.getByRole('button', { name: '保存预算规则' })).toBeEnabled()
    fireEvent.submit(screen.getByTestId('runtime-budget-policy-form'))

    expect(await screen.findByText('预算已启用')).toBeInTheDocument()
    expect(screen.getByText('月上限 $0.40')).toBeInTheDocument()
    expect(screen.getByText('预警阈值 $0.20')).toBeInTheDocument()
    expect(screen.getByText('已用 $0.04')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存到团队'))
    expect(screen.getByRole('status')).toHaveTextContent('桌面端是否已同步无法从 Web 确认；请在桌面端执行“更新团队数据”。')
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
    expect(screen.getByLabelText('月上限（USD）')).toHaveValue(0.4)
  })

  it('keeps the previous summary visible and exposes a retry state when saving fails', async () => {
    const savePolicyAction = vi.fn(async () => ({
      ok: false as const,
      error: '预算服务暂时不可用',
    }))
    renderPanel({ savePolicyAction })

    fireEvent.change(screen.getByLabelText('预警阈值（USD）'), {
      target: { value: '0.15' },
    })
    fireEvent.submit(screen.getByTestId('runtime-budget-policy-form'))

    expect(await screen.findByRole('alert')).toHaveTextContent('预算服务暂时不可用')
    expect(screen.getByText('预算未启用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存失败，重试' })).toBeEnabled()
  })

  it('ignores a repeated submit while the first save is pending', async () => {
    let resolveSave: ((value: { ok: true; policy: RuntimeBudgetPolicy }) => void) | undefined
    const savePolicyAction = vi.fn(() => new Promise<{ ok: true; policy: RuntimeBudgetPolicy }>((resolve) => {
      resolveSave = resolve
    }))
    renderPanel({ savePolicyAction })

    fireEvent.change(screen.getByLabelText('月上限（USD）'), { target: { value: '0.3' } })
    const form = screen.getByTestId('runtime-budget-policy-form')
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(savePolicyAction).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: '保存中…' })).toBeDisabled()

    await act(async () => {
      resolveSave?.({ ok: true, policy: { ...initialPolicy, monthlyLimitUsd: 0.3 } })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
  })
})
