import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentReviewResult, CodingAgentRun, ManagedCodingWorkspace } from '@ai-devflow/shared'
import { CodingRetryDialog, CodingWorkspaceRecords, GateReviewRunPanel, TestRunPanel } from './TaskWorkPanel'

const review = { id: 'review-1', model: 'model-a', createdAt: '2026-09-28T01:00:00.000Z' } as AgentReviewResult
const workspace = {
  id: 'workspace-1', worktreePath: '/tmp/devflow-worktrees/run-1', cleanupStatus: 'active',
} as ManagedCodingWorkspace

describe('GateReviewRunPanel (plan W2)', () => {
  it('re-runs only after the existing confirmation and passes the previous review', () => {
    const onRun = vi.fn()
    render(<GateReviewRunPanel latestReview={review} failure={undefined} isRunning={false} providerLabel="Review · model-a" blockedReason={undefined} isWriteLocked={false} target="清理任务 · 需求确认 Gate" onRun={onRun} />)
    expect(screen.getByTestId('task-review-run')).toHaveTextContent('将使用 Review · model-a，可能产生费用。')
    fireEvent.click(screen.getByRole('button', { name: '重新审查' }))
    expect(onRun).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '确认重新审查' })
    expect(dialog).toHaveTextContent('本次 Provider：Review · model-a')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续并重新审查' }))
    expect(onRun).toHaveBeenCalledWith('review-1')
  })

  it('explains a failed review and retries without a previous review', () => {
    const onRun = vi.fn()
    render(<GateReviewRunPanel latestReview={undefined} failure={'门禁审查失败：Provider 超时 {"code":"timeout"}'} isRunning={false} providerLabel="Review · model-a" blockedReason={undefined} isWriteLocked={false} target="t" onRun={onRun} />)
    expect(screen.getByRole('alert')).toHaveTextContent('上次门禁审查未完成：门禁审查失败：Provider 超时')
    fireEvent.click(screen.getByRole('button', { name: '重试门禁审查' }))
    expect(onRun).toHaveBeenCalledWith()
  })

  it('cannot run while the budget or model is unavailable, and says why', () => {
    render(<GateReviewRunPanel latestReview={review} failure={undefined} isRunning={false} providerLabel={undefined} blockedReason="尚未配置当前项目的云端预算" isWriteLocked={false} target="t" onRun={vi.fn()} />)
    expect(screen.getByRole('button', { name: '重新审查' })).toBeDisabled()
    expect(screen.getByTestId('task-review-run')).toHaveTextContent('尚未配置当前项目的云端预算')
  })

  it.each(['local-agent', 'native-agent'] as const)('says how %s review was produced and keeps repository facts collapsed', (executorKind) => {
    const props = { failure: undefined, isRunning: false, providerLabel: 'p', blockedReason: undefined, isWriteLocked: false, target: 't', onRun: vi.fn() }
    const first = render(<GateReviewRunPanel {...props} latestReview={review} />)
    expect(screen.getByTestId('review-method')).toHaveTextContent('只依据材料与知识目录，未读取仓库')
    first.unmount()

    const local = { ...review, executorKind } as AgentReviewResult
    const second = render(<GateReviewRunPanel {...props} latestReview={local} />)
    expect(screen.getByTestId('review-method')).toHaveTextContent(`${executorKind === 'native-agent' ? '内置审查' : 'OpenCode '}读取仓库核对，本次没有引用仓库文件`)
    second.unmount()

    const withFindings = {
      ...local,
      repositoryFindings: {
        version: 1, repositoryDigest: 'd'.repeat(64),
        verifiedFacts: [{ id: 'fact-1', statement: '健康路由已存在。', citationIds: ['c-1', 'c-2'] }],
        citations: [
          { id: 'c-1', path: 'src/routes/health.ts', contentDigest: 'a'.repeat(64), lineStart: 3, lineEnd: 9 },
          { id: 'c-2', path: 'src/routes/health.ts', contentDigest: 'a'.repeat(64) },
        ],
        assumptions: [], openQuestions: [], uncheckedScopes: ['部署脚本'],
      },
    } as AgentReviewResult
    render(<GateReviewRunPanel {...props} latestReview={withFindings} />)
    const details = screen.getByTestId('review-repository-findings')
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText(/核对 1 项事实，引用 1 个文件/)).toBeInTheDocument()
    expect(details).toHaveTextContent('不作为 Gate 依据')
    expect(within(details).getByText('src/routes/health.ts:3–9')).toBeInTheDocument()
    expect(within(details).getByText('src/routes/health.ts')).toBeInTheDocument()
    expect(details).toHaveTextContent('未核对：部署脚本')
  })

  it('renders nothing before any review, failure or run', () => {
    const { container } = render(<GateReviewRunPanel latestReview={undefined} failure={undefined} isRunning={false} providerLabel="p" blockedReason={undefined} isWriteLocked={false} target="t" onRun={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CodingRetryDialog (plan W3)', () => {
  it('states the new Run, the extra attempt, the previous cost and the budget approval in use', () => {
    const onConfirm = vi.fn()
    render(<CodingRetryDialog additionalAttemptAfterCount={3} providerName="Native" lastRun={{ runtimeCostSummary: undefined } as unknown as CodingAgentRun} runtimeBudgetApprovalId="runtime-budget-approval-1" disabled={false} onConfirm={onConfirm} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog', { name: '授权追加一次尝试？' })
    expect(dialog).toHaveTextContent('已尝试 3 次')
    expect(dialog).toHaveTextContent('第 4 次')
    expect(dialog).toHaveTextContent('runtime-budget-approval-1')
    expect(dialog).toHaveTextContent('上次费用未知')
    fireEvent.click(within(dialog).getByRole('button', { name: '授权追加一次尝试' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels with Escape', () => {
    const onCancel = vi.fn()
    render(<CodingRetryDialog additionalAttemptAfterCount={undefined} providerName={undefined} lastRun={undefined} runtimeBudgetApprovalId="" disabled onConfirm={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: '新建 Run 并重试' })).toBeDisabled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('未使用一次性预算批准')
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('CodingWorkspaceRecords (plan W3)', () => {
  it('deletes the managed worktree only after an explicit confirmation', () => {
    const onDelete = vi.fn()
    const onOpen = vi.fn()
    render(<CodingWorkspaceRecords workspace={workspace} canOpen onOpen={onOpen} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: '打开受管工作树' }))
    expect(onOpen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '删除受管工作树' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('执行记录与代码差异保留')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除受管工作树' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('keeps a deleted worktree read-only', () => {
    render(<CodingWorkspaceRecords workspace={{ ...workspace, cleanupStatus: 'deleted', deletedAt: '2026-09-28T00:00:00.000Z' }} canOpen={false} onOpen={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: '删除受管工作树' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '打开受管工作树' })).not.toBeInTheDocument()
  })
})

describe('TestRunPanel (plan W4)', () => {
  it('offers the test command setting when none is saved', () => {
    const onOpenTestSettings = vi.fn()
    render(<TestRunPanel readiness={{ blockedReason: '先保存当前项目的测试命令。', needsCommand: true, savedCommand: '' }} isRunning={false} onOpenTestSettings={onOpenTestSettings} />)
    fireEvent.click(screen.getByRole('button', { name: '设置测试命令' }))
    expect(onOpenTestSettings).toHaveBeenCalledOnce()
  })

  it('names the saved command that will run and that no model is called', () => {
    render(<TestRunPanel readiness={{ blockedReason: '', needsCommand: false, savedCommand: 'pnpm test' }} isRunning={false} onOpenTestSettings={vi.fn()} />)
    expect(screen.getByTestId('task-test-run')).toHaveTextContent('将在本机运行 pnpm test，不调用模型')
  })
})
