import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { modelCostRecoveryOverview, type DesktopModelCostRecovery } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import { ModelCostRecovery } from './ModelCostRecovery'

const data: DesktopModelCostRecovery = { overview: modelCostRecoveryOverview([], [], [], 'team-project', '2026-10-04T12:00:00Z'),
  local: [{ id: 'stored-final', state: 'upload_failed', canRetry: true }, { id: 'active', state: 'running', canRetry: false }] }
describe('desktop model costs view', () => {
  it('loads the selected project and retries saved usage through IPC without any executor action', async () => {
    const getModelCostRecovery = vi.fn(async () => data), retryModelCostSettlements = vi.fn(async () => ({ ...data, local: [] }))
    const api = { getModelCostRecovery, retryModelCostSettlements } as unknown as DevFlowDesktopApi
    render(<ModelCostRecovery desktopApi={api} projectId="local-project" />)
    fireEvent.click(screen.getByRole('button', { name: '查看项目费用记录' }))
    await waitFor(() => expect(screen.getByText('stored-final')).toBeInTheDocument())
    expect(getModelCostRecovery).toHaveBeenCalledWith({ projectId: 'local-project' })
    expect(screen.getByText(/执行占位，不能重传/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新同步用量' }))
    await waitFor(() => expect(retryModelCostSettlements).toHaveBeenCalledWith({ projectId: 'local-project' }))
    expect(await screen.findByText(/已有最终用量已重新同步/)).toBeInTheDocument()
    expect(screen.queryByText('stored-final')).not.toBeInTheDocument()
  })
  it('leaves records visible when upload fails and permits a deliberate retry', async () => {
    const api = { getModelCostRecovery: vi.fn(async () => data), retryModelCostSettlements: vi.fn(async () => { throw new Error('同步服务暂时不可用') }) } as unknown as DevFlowDesktopApi
    render(<ModelCostRecovery desktopApi={api} projectId="local-project" />)
    fireEvent.click(screen.getByRole('button', { name: '查看项目费用记录' }))
    await screen.findByText('stored-final')
    fireEvent.click(screen.getByRole('button', { name: '重新同步用量' }))
    await screen.findByText('同步服务暂时不可用')
    expect(screen.getByText('stored-final')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新同步用量' })).toBeEnabled()
  })
  it('discards a previous project response after switching projects', async () => {
    let resolve!: (value: DesktopModelCostRecovery) => void
    const api = { getModelCostRecovery: vi.fn(() => new Promise<DesktopModelCostRecovery>(done => { resolve = done })) } as unknown as DevFlowDesktopApi
    const ui = render(<ModelCostRecovery desktopApi={api} projectId="old" />)
    fireEvent.click(screen.getByRole('button', { name: '查看项目费用记录' }))
    ui.rerender(<ModelCostRecovery desktopApi={api} projectId="new" />)
    await act(async () => resolve(data))
    expect(screen.queryByText('stored-final')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看项目费用记录' })).toBeEnabled()
  })
})
