import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  LocalProject,
  TestEvidence,
  TestEvidenceStatus,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import { TestsView } from './SupportViews'

const project: LocalProject = {
  id: 'local-project-1',
  name: 'fixture-project',
  path: '/tmp/fixture-project',
  packageManager: 'pnpm',
  detectedTestCommand: 'pnpm test',
  testCommand: 'pnpm test',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const testNode: WorkflowNode = {
  id: 'node-test',
  stage: 'test',
  title: 'Run tests',
  subtitle: 'Archive local evidence',
  kind: 'test',
  status: 'running',
  ownerId: 'user-1',
  retryCount: 0,
  artifactIds: [],
}

const run: WorkflowRun = {
  id: 'run-1',
  version: 1,
  title: 'Fixture run',
  request: 'Validate the release.',
  projectId: 'team-project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: testNode.id,
  branchName: 'devflow/run-1',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  nodes: [testNode],
  edges: [],
}

const defaultProps = {
  evidence: [] as TestEvidence[],
  onHandleInTask: vi.fn(),
  isRunningTests: false,
  commandDraft: 'pnpm test',
  onCommandDraftChange: vi.fn(),
  onSaveCommand: vi.fn(),
  project,
  commandSafety: null,
  isCommandDirty: false,
  isSavingCommand: false,
  supportContext: null,
  selectedRun: run,
  selectedNode: testNode,
  onReturnToInspector: vi.fn(),
}

function evidenceWithStatus(status: TestEvidenceStatus): TestEvidence {
  return {
    id: `evidence-${status}`,
    runId: run.id,
    nodeId: testNode.id,
    projectId: project.id,
    command: project.testCommand,
    cwd: project.path,
    status,
    exitCode: status === 'passed' ? 0 : status === 'timed_out' ? null : 1,
    durationMs: 900,
    stdout: '',
    stderr: '',
    summary: `Result: ${status}`,
    redacted: true,
    createdAt: '2026-08-01T12:01:00.000Z',
  }
}

describe('TestsView status model', () => {
  it('separates saved command, pending execution, and current workflow state without fake progress', () => {
    const { container } = render(<TestsView {...defaultProps} />)

    expect(screen.getByTestId('test-command-status')).toHaveTextContent('已保存')
    expect(screen.getByTestId('test-command-status')).toHaveTextContent('不代表测试已经完成')
    expect(screen.getByTestId('test-execution-status')).toHaveTextContent('待执行')
    expect(screen.getByTestId('test-workflow-status')).toHaveTextContent('当前测试节点')
    expect(container.querySelector('.test-bars')).not.toBeInTheDocument()
    expect(container.querySelector('[style*="88%"]')).not.toBeInTheDocument()
  })

  it('shows command edits, command persistence, and active test execution as different states', () => {
    const { rerender } = render(<TestsView {...defaultProps} isCommandDirty />)

    expect(screen.getByTestId('test-command-status')).toHaveTextContent('有未保存修改')

    rerender(<TestsView {...defaultProps} isCommandDirty isSavingCommand />)
    expect(screen.getByTestId('test-command-status')).toHaveTextContent('保存中')

    rerender(<TestsView {...defaultProps} isRunningTests />)
    expect(screen.getByTestId('test-execution-status')).toHaveTextContent('执行中')
  })

  it.each([
    ['passed', '已通过'],
    ['failed', '失败'],
    ['timed_out', '已超时'],
  ] as const)('shows the %s evidence result explicitly', (status, label) => {
    render(<TestsView {...defaultProps} evidence={[evidenceWithStatus(status)]} />)

    expect(screen.getByTestId('test-execution-status')).toHaveTextContent(label)
    expect(screen.getByTestId('test-execution-status')).toHaveTextContent(`Result: ${status}`)
  })

  it('reports a completed workflow test node separately from its latest result', () => {
    const completedNode = { ...testNode, status: 'success' as const }
    const completedRun = {
      ...run,
      status: 'paused_at_gate' as const,
      currentNodeId: 'node-pr',
      nodes: [completedNode],
    }
    render(
      <TestsView
        {...defaultProps}
        evidence={[evidenceWithStatus('passed')]}
        selectedRun={completedRun}
        selectedNode={completedNode}
      />,
    )

    expect(screen.getByTestId('test-execution-status')).toHaveTextContent('已通过')
    expect(screen.getByTestId('test-workflow-status')).toHaveTextContent('测试节点已完成')
  })
})

describe('TestsView empty states and run preconditions (plan D4, X6)', () => {
  it.each([
    ['no local project', { project: undefined, commandDraft: '' }, '选择本地仓库后再配置或执行测试。', '先选择本地仓库，再配置或执行测试。'],
    ['no saved command', { project: { ...project, testCommand: '' }, commandDraft: '' }, '配置当前项目的测试命令后，才能产生测试证据。', '先保存当前项目的测试命令。'],
  ] as const)('explains %s instead of offering a run', (_label, overrides, emptyCopy, blockedReason) => {
    render(<TestsView {...defaultProps} {...overrides} />)

    expect(screen.getByTestId('tests-empty-state')).toHaveTextContent(emptyCopy)
    // The page only hands back to the task (W5); the reason why a run would be refused stays visible.
    const handBack = screen.getByRole('button', { name: '在任务中处理' })
    expect(handBack).toHaveAccessibleDescription(blockedReason)
    expect(screen.queryByRole('button', { name: /执行本地测试|执行测试/ })).not.toBeInTheDocument()
  })

  it('does not treat a saved command as a finished test', () => {
    const onHandleInTask = vi.fn()
    render(<TestsView {...defaultProps} onHandleInTask={onHandleInTask} />)

    expect(screen.getByTestId('tests-empty-state')).toHaveTextContent('当前任务尚未运行测试，可以在任务的测试步骤点击「运行检查」。')
    fireEvent.click(screen.getByRole('button', { name: '在任务中处理' }))
    expect(onHandleInTask).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('tests-run-blocked-reason')).not.toBeInTheDocument()
  })

  it('offers the way back after the command is saved from a task (W9)', () => {
    const supportContext = { runId: run.id, nodeId: testNode.id, sourceView: 'workbench' as const, returnView: 'workbench' as const, focusTarget: 'local-tests' as const, label: '设置测试命令', inspectorTab: '当前工作', createdAt: '2026-09-28T00:00:00.000Z' }
    const { rerender } = render(<TestsView {...defaultProps} supportContext={supportContext} />)
    expect(screen.getByTestId('support-context-banner')).toHaveTextContent('保存测试命令后可以返回任务；返回后不会自动运行检查。')
    rerender(<TestsView {...defaultProps} supportContext={{ ...supportContext, savedAt: '2026-09-28T00:01:00.000Z' }} />)
    expect(screen.getByTestId('support-context-banner')).toHaveTextContent('已保存。可以返回任务')
    fireEvent.click(screen.getByRole('button', { name: '返回任务' }))
    expect(defaultProps.onReturnToInspector).toHaveBeenCalled()
  })

  it('names the actual step when the task has not reached testing', () => {
    const designNode: WorkflowNode = { ...testNode, id: 'node-design', stage: 'design', kind: 'agent', title: '方案设计', status: 'running' }
    const pendingTest = { ...testNode, status: 'pending' as const }
    const earlyRun = { ...run, currentNodeId: designNode.id, nodes: [designNode, pendingTest] }
    render(<TestsView {...defaultProps} selectedRun={earlyRun} selectedNode={pendingTest} />)

    expect(screen.getByTestId('tests-run-blocked-reason')).toHaveTextContent('任务进入测试步骤后才能执行；当前实际步骤：方案设计。')
    expect(screen.getByTestId('tests-empty-state')).toHaveTextContent('命令已保存不代表测试已完成。')
  })

  it('shows when a passed result ran and that its applicability cannot be verified', () => {
    render(<TestsView {...defaultProps} evidence={[evidenceWithStatus('passed')]} />)

    const status = screen.getByTestId('test-execution-status')
    expect(status).toHaveTextContent('执行于')
    expect(status).toHaveTextContent('证据没有记录所测代码的提交，适用性无法核实')
    expect(status).not.toHaveTextContent(/仍然有效|已过期/)
  })
})
