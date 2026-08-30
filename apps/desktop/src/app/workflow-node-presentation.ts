import type { WorkflowNode } from '@ai-devflow/shared'

export type BoardNodeKind = 'Task' | 'Gate' | 'Review' | 'Test' | 'Delivery' | 'Acceptance'

export type WorkflowNodeSourceKind =
  | 'run_template'
  | 'team_policy'
  | 'local_runtime'
  | 'system_derived'

export type WorkflowNodeDisplayMode = 'standard' | 'folded'

export type WorkflowNodePresentation = {
  nodeKind: BoardNodeKind
  nodeKindLabel: string
  sourceKind: WorkflowNodeSourceKind
  sourceLabel: string
  displayMode: WorkflowNodeDisplayMode
  displayModeLabel: string
  status: WorkflowNode['status']
  statusLabel: string
}

export const workflowNodeKindLabels: Record<BoardNodeKind, string> = {
  Task: 'Task',
  Gate: 'Gate',
  Review: 'Review',
  Test: 'Test',
  Delivery: 'Delivery',
  Acceptance: 'Acceptance',
}

export const workflowNodeSourceLabels: Record<WorkflowNodeSourceKind, string> = {
  run_template: 'Run 模板',
  team_policy: 'Team Policy',
  local_runtime: '本地 Runtime',
  system_derived: '系统派生',
}

export const workflowNodeDisplayModeLabels: Record<WorkflowNodeDisplayMode, string> = {
  standard: '标准卡片',
  folded: '折叠输出',
}

export const workflowNodeStatusLabels: Record<WorkflowNode['status'], string> = {
  pending: '等待中',
  running: '当前步骤',
  blocked: '已阻断',
  success: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

function nodeKindFor(node: WorkflowNode): BoardNodeKind {
  switch (node.kind) {
    case 'gate':
      return 'Gate'
    case 'test':
      return 'Test'
    case 'pr':
      return 'Delivery'
    case 'acceptance':
      return 'Acceptance'
    case 'agent':
    case 'task':
      return 'Task'
  }
}

function sourceKindFor(node: WorkflowNode): WorkflowNodeSourceKind {
  switch (node.kind) {
    case 'gate':
      return 'team_policy'
    case 'task':
    case 'test':
      return 'local_runtime'
    case 'pr':
    case 'acceptance':
      return 'system_derived'
    case 'agent':
      return 'run_template'
  }
}

function displayModeFor(node: WorkflowNode): WorkflowNodeDisplayMode {
  return node.kind === 'pr' || node.kind === 'acceptance' ? 'folded' : 'standard'
}

/**
 * Derives display-only workflow semantics from the durable node kind.
 *
 * In particular, an `agent` node in the design stage remains a Task that
 * produces a Design Artifact. Gate Review is a separate Gate capability and
 * must not change the design node's type.
 */
export function buildWorkflowNodePresentation(node: WorkflowNode): WorkflowNodePresentation {
  const nodeKind = nodeKindFor(node)
  const sourceKind = sourceKindFor(node)
  const displayMode = displayModeFor(node)

  return {
    nodeKind,
    nodeKindLabel: workflowNodeKindLabels[nodeKind],
    sourceKind,
    sourceLabel: workflowNodeSourceLabels[sourceKind],
    displayMode,
    displayModeLabel: workflowNodeDisplayModeLabels[displayMode],
    status: node.status,
    statusLabel: workflowNodeStatusLabels[node.status],
  }
}
