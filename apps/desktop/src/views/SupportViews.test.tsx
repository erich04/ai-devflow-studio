import { render, screen } from '@testing-library/react'
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
  onRunTests: vi.fn(),
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
