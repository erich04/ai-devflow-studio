import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AutomaticMemoryDecision, AutomaticMemoryStatus } from '@ai-devflow/shared'
import { AutomaticMemoryPanel } from './AutomaticMemoryPanel'

const status: AutomaticMemoryStatus = {
  projectId: 'project-1', configuration: null, endpoint: 'http://127.0.0.1:8888', jobs: [], decisions: [],
}
const decision: AutomaticMemoryDecision = {
  id: 'decision-1', eventId: 'event-1', factId: 'fact-1', projectId: 'project-1', statement: '删除任务必须可撤销。',
  statementKind: 'business_rule', disposition: 'rule_candidate', evidenceMaterialIds: ['message-1'],
  reason: '这条内容改变业务行为。', createdAt: '2026-10-22T12:00:00.000Z',
}
function createApi(initial = status) {
  return {
    getAutomaticMemoryStatus: vi.fn().mockResolvedValue(initial),
    configureAutomaticMemory: vi.fn().mockResolvedValue(initial),
    processAutomaticMemory: vi.fn().mockResolvedValue(initial),
    resolveAutomaticMemoryDecision: vi.fn().mockResolvedValue(initial),
  }
}

describe('AutomaticMemoryPanel', () => {
  it('requires project-level source consent once, and explains the invocation limit', async () => {
    const api = createApi()
    render(<AutomaticMemoryPanel projectId="project-1" api={api} />)
    await screen.findByText(/服务：http/)
    fireEvent.click(screen.getByText('项目自动记忆设置'))
    const enable = screen.getByRole('button', { name: '启用自动积累' })
    expect(enable).toBeDisabled()
    expect(screen.getByText(/这是调用次数上限，不是金额保证/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /允许此项目/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    fireEvent.click(enable)
    await waitFor(() => expect(api.configureAutomaticMemory).toHaveBeenCalledWith({ projectId: 'project-1', enabled: true, consent: true, maxRetainsPerDay: 12 }))
    expect(api.resolveAutomaticMemoryDecision).not.toHaveBeenCalled()
  })

  it('does not offer memory approval for business rules and only ignores the exact suggestion', async () => {
    const api = createApi({ ...status, decisions: [decision] })
    render(<AutomaticMemoryPanel projectId="project-1" api={api} />)
    const card = await screen.findByRole('article', { name: '业务规则候选' })
    expect(within(card).getByText(/此处不能把业务规则批准为长期经验/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '确认采用新内容' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '忽略此建议' }))
    await waitFor(() => expect(api.resolveAutomaticMemoryDecision).toHaveBeenCalledWith({ projectId: 'project-1', decisionId: 'decision-1', action: 'ignore' }))
  })

  it('shows both sides of a conflict and confirms the displayed target revision', async () => {
    const conflict: AutomaticMemoryDecision = {
      ...decision, statementKind: 'environment_fact', disposition: 'conflict', statement: '项目使用 npm。',
      conflictsWith: [{ memoryId: 'memory-old', revision: 4, statement: '项目使用 pnpm。' }],
    }
    const api = createApi({ ...status, decisions: [conflict] })
    render(<AutomaticMemoryPanel projectId="project-1" api={api} />)
    const card = await screen.findByRole('article', { name: '记忆冲突' })
    expect(within(card).getByText('项目使用 pnpm。')).toBeInTheDocument()
    expect(within(card).getByText('项目使用 npm。')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '确认采用新内容' }))
    await waitFor(() => expect(api.resolveAutomaticMemoryDecision).toHaveBeenCalledWith({
      projectId: 'project-1', decisionId: 'decision-1', action: 'approve', targetMemoryId: 'memory-old', expectedRevision: 4,
    }))
  })

  it('does not replace a set of conflicting memories with a single ambiguous confirmation', async () => {
    const api = createApi({ ...status, decisions: [{ ...decision, disposition: 'conflict', conflictsWith: [
      { memoryId: 'a', revision: 1, statement: 'A' }, { memoryId: 'b', revision: 1, statement: 'B' },
    ] }] })
    render(<AutomaticMemoryPanel projectId="project-1" api={api} />)
    await screen.findByText('涉及多个或已变化的版本，请在生命周期中逐条核实和纠正。')
    expect(screen.queryByRole('button', { name: '确认采用新内容' })).not.toBeInTheDocument()
  })

  it('discards a pending response after switching projects', async () => {
    let finish!: (value: AutomaticMemoryStatus) => void
    const api = createApi()
    api.getAutomaticMemoryStatus.mockImplementation(({ projectId }: { projectId: string }) => projectId === 'project-1'
      ? new Promise<AutomaticMemoryStatus>((resolve) => { finish = resolve })
      : Promise.resolve({ ...status, projectId, endpoint: 'http://localhost:9999' }))
    const { rerender } = render(<AutomaticMemoryPanel projectId="project-1" api={api} />)
    rerender(<AutomaticMemoryPanel projectId="project-2" api={api} />)
    await screen.findByText(/服务：http:\/\/localhost:9999/)
    finish({ ...status, decisions: [decision] })
    await waitFor(() => expect(screen.queryByText('删除任务必须可撤销。')).not.toBeInTheDocument())
  })
})
