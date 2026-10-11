import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest, type WorkRequest } from '@ai-devflow/shared'
import { TaskCenter } from './TaskCenter'
const run = createWorkflowRunFromRequest({ runId: 'run', projectId: 'local', creatorId: 'u', title: '本地任务', request: '继续开发', branchName: 'task', now: '2026-10-10T00:00:00Z' }).run
const request: WorkRequest = { id: 'request', projectId: 'team', organizationId: 'org', title: '团队请求', request: '新增搜索', version: 1, status: 'open', claim: null, createdByUserId: 'u', expiresAt: null, createdAt: run.createdAt, updatedAt: run.updatedAt }
const props = () => ({ projectId: 'local', runs: [run], requests: [request], role: 'owner' as const, paired: true, loading: false, error: null, materializingId: null, onRefresh: vi.fn(), onOpen: vi.fn(), onClaim: vi.fn() })
afterEach(() => { cleanup(); sessionStorage.clear() })
it('previews without claiming, then claims only through the row action', () => {
  const input = props(); render(<TaskCenter {...input} />)
  fireEvent.click(screen.getByRole('button', { name: '团队请求' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('新增搜索')
  expect(input.onClaim).not.toHaveBeenCalled(); expect(input.onOpen).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '领取任务：团队请求' }))
  expect(input.onClaim).toHaveBeenCalledExactlyOnceWith(request)
})
it('keeps search and filter on return and distinguishes unknown counts from empty results', () => {
  const input = props(); const first = render(<TaskCenter {...input} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '团队' } })
  fireEvent.click(screen.getByRole('tab', { name: /待领取/ }))
  first.unmount(); render(<TaskCenter {...input} loading />)
  expect(screen.getByRole('searchbox')).toHaveValue('团队')
  expect(screen.getByRole('tab', { name: /待领取/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: /待领取/ })).toHaveTextContent('未知')
  expect(screen.getByRole('button', { name: '领取任务：团队请求' })).toBeDisabled()
  expect(screen.queryByText('当前项目还没有任务。')).not.toBeInTheDocument()
})
it('returns to the selected row and opens completed delivery without claiming a request', () => {
  const input = props()
  const completed = { ...run, status: 'completed' as const, nodes: run.nodes.map(node => ({ ...node, status: 'success' as const })) }
  const first = render(<TaskCenter {...input} runs={[completed]} />)
  fireEvent.click(screen.getByRole('button', { name: '查看任务：本地任务' }))
  expect(input.onOpen).toHaveBeenCalledWith(completed)
  expect(input.onClaim).not.toHaveBeenCalled()
  first.unmount()
  render(<TaskCenter {...input} runs={[completed]} />)
  expect(screen.getByRole('article', { name: '本地任务' })).toHaveAttribute('data-selected', 'true')
})
