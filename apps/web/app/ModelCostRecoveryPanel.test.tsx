import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { modelCostRecoveryOverview } from '@ai-devflow/shared'
import { ModelCostRecoveryPanel } from './ModelCostRecoveryPanel'

const view = () => modelCostRecoveryOverview([], [{ id: 'unknown-call', projectId: 'p', userId: 'caller', providerId: 'deepseek', model: 'deepseek-flash',
  createdAt: '2026-10-04T12:00:00Z', inputTokens: 100, maxOutputTokens: 100, billingProvider: 'deepseek', state: 'failed', costUsd: null, projectedCostUsd: 1 }], [], 'p', '2026-10-04T12:01:00Z')
describe('budget recovery controls', () => {
  it('shows uncertainty instead of zero, explains original device boundaries and exposes no lead command to members', () => {
    render(<ModelCostRecoveryPanel initialOverview={view()} userId="caller" canManage={false} readAction={vi.fn()} retryAction={vi.fn()} reconcileAction={vi.fn()} />)
    expect(screen.getByText(/实际费用待确认 1 笔/)).toBeInTheDocument()
    expect(screen.getByText(/原桌面.*未上传/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '核对费用' })).not.toBeInTheDocument()
    expect(screen.getByText('unknown-call')).toBeInTheDocument()
  })
  it('submits a versioned evidence command without caller/actor impersonation and never reruns work', async () => {
    const reconcile = vi.fn(async () => ({ ok: true as const, overview: { ...view(), actualCostUsd: 0.25, actualUnknownCount: 0 } }))
    render(<ModelCostRecoveryPanel initialOverview={view()} userId="lead" canManage readAction={vi.fn()} retryAction={vi.fn()} reconcileAction={reconcile} />)
    fireEvent.click(screen.getByRole('button', { name: '核对费用' }))
    fireEvent.change(screen.getByLabelText('核定金额（USD）'), { target: { value: '0.25' } })
    fireEvent.change(screen.getByLabelText('执行状态依据'), { target: { value: 'ended' } })
    fireEvent.change(screen.getByLabelText('核对原因'), { target: { value: '已核对账单' } })
    fireEvent.change(screen.getByLabelText('非敏感依据'), { target: { value: '提供方账单 INV-123' } })
    fireEvent.submit(screen.getByRole('form', { name: '费用核对' }))
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1))
    expect(reconcile.mock.calls[0]?.[0]).toMatchObject({ sourceId: 'unknown-call', expectedVersion: view().records[0]?.version, costUsd: 0.25, reason: '已核对账单' })
    expect(reconcile.mock.calls[0]?.[0]).not.toHaveProperty('userId')
    expect(screen.getByText(/已更新费用记录.*不会自动重跑/)).toBeInTheDocument()
  })
})
