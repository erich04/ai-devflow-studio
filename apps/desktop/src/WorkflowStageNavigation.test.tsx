import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { buildWorkflowBoard } from './app/desktop-view-model'
import { WorkflowBoard } from './views/DesktopViews'

function gateRun() {
  const { run } = createWorkflowRunFromRequest({ runId: 'navigation', title: '任务筛选', request: '添加筛选', projectId: 'project', creatorId: 'owner', branchName: 'ai/filter', now: '2026-09-24T00:00:00Z' })
  run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'agent')!.status = 'success'
  run.currentNodeId = run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')!.id
  return run
}

describe('workflow viewing and actual progress', () => {
  it('connects the selected stage to its nodes without moving actual Gate progress', () => {
    const run = gateRun()
    const before = structuredClone(run)
    function Workbench() {
      const [selectedNodeId, select] = useState(run.currentNodeId)
      return <WorkflowBoard run={run} artifacts={[]} events={[]} testEvidence={[]} selectedNodeId={selectedNodeId} onSelectNode={select} onSelectAttachment={vi.fn()} />
    }
    render(<Workbench />)
    const navigation = screen.getByRole('navigation', { name: '六阶段导航' })
    const clarify = within(navigation).getByRole('button', { name: /01 需求澄清/ })
    const design = within(navigation).getByRole('button', { name: /02 方案设计/ })
    // Sub-steps are folded into the stage item (plan L2): the actual stage shows its count.
    expect(clarify).toHaveTextContent('1/2')
    expect(screen.queryByRole('region', { name: '当前查看阶段的节点' })).not.toBeInTheDocument()
    fireEvent.click(design)
    expect(design).toHaveAttribute('aria-pressed', 'true')
    expect(design).toHaveAttribute('aria-controls', 'workflow-stage-nodes workbench-node-reader')
    expect(clarify).toHaveAttribute('aria-current', 'step')
    expect(clarify).toHaveAttribute('aria-pressed', 'false')
    // No separate 子步骤 button (plan Y6): the browsed stage item itself toggles its sub-steps.
    expect(screen.queryByRole('button', { name: '子步骤' })).not.toBeInTheDocument()
    expect(clarify).not.toHaveAttribute('aria-expanded')
    expect(design).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(design)
    expect(design).toHaveAttribute('aria-expanded', 'true')
    expect(design).toHaveAttribute('aria-pressed', 'true')
    expect(design).toHaveAttribute('title', expect.stringContaining('点击收起子步骤'))
    const nodes = screen.getByRole('region', { name: '当前查看阶段的节点' })
    expect(nodes).toHaveTextContent('02 · 方案设计')
    expect(within(nodes).getByRole('button', { name: /方案设计 等待中/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('progressbar', { name: '需求澄清阶段进度' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('progressbar', { name: '方案设计阶段进度' })).toHaveAttribute('aria-valuenow', '0')
    // Returning to the actual stage selects the actual current node again; the list stays open.
    fireEvent.click(clarify)
    expect(clarify).toHaveAttribute('aria-pressed', 'true')
    expect(clarify).toHaveAttribute('aria-expanded', 'true')
    expect(within(nodes).getByRole('button', { name: /需求确认 Gate/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(clarify)
    expect(clarify).toHaveAttribute('aria-expanded', 'false')
    expect(nodes).not.toBeVisible()
    expect(run).toEqual(before)
  })

  it('fills the connecting line only from completed nodes and keeps it partial at a blocked Gate', () => {
    const run = gateRun()
    const gate = run.nodes.find((node) => node.id === run.currentNodeId)!
    gate.status = 'blocked'
    expect(buildWorkflowBoard(run)[0]).toMatchObject({ progressPercent: 50, completedNodeCount: 1, completionState: 'blocked' })
    gate.status = 'success'
    run.currentNodeId = run.nodes.find((node) => node.stage === 'design')!.id
    expect(buildWorkflowBoard(run).map((stage) => stage.progressPercent)).toEqual([100, 0, 0, 0, 0, 0])
    run.nodes.filter((node) => node.stage === 'test').forEach((node) => { node.status = 'success' })
    expect(buildWorkflowBoard(run).find((stage) => stage.stage === 'test')?.progressPercent).toBe(0)
    run.nodes = run.nodes.filter((node) => node.stage !== 'pr')
    expect(buildWorkflowBoard(run).find((stage) => stage.stage === 'pr')?.progressPercent).toBe(0)
  })
})
