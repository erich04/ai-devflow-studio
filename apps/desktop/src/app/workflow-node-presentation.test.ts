import { describe, expect, it } from 'vitest'
import type { NodeKind, NodeStage, WorkflowNode } from '@ai-devflow/shared'
import {
  buildWorkflowNodePresentation,
  workflowNodeKindLabels,
  workflowNodeSourceLabels,
} from './workflow-node-presentation'

function node(kind: NodeKind, stage: NodeStage, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: `node-${kind}-${stage}`,
    stage,
    title: `${kind} node`,
    subtitle: 'fixture node',
    kind,
    status: 'pending',
    ownerId: 'member-1',
    retryCount: 0,
    artifactIds: [],
    ...overrides,
  }
}

describe('workflow node presentation', () => {
  it.each([
    [node('agent', 'clarify'), 'Task', 'run_template', 'standard'],
    [node('agent', 'design'), 'Task', 'run_template', 'standard'],
    [node('gate', 'design'), 'Gate', 'team_policy', 'standard'],
    [node('task', 'build'), 'Task', 'local_runtime', 'standard'],
    [node('test', 'test'), 'Test', 'local_runtime', 'standard'],
    [node('pr', 'pr'), 'Delivery', 'system_derived', 'folded'],
    [node('acceptance', 'accept'), 'Acceptance', 'system_derived', 'folded'],
  ] as const)('derives orthogonal semantics for %s', (workflowNode, nodeKind, sourceKind, displayMode) => {
    expect(buildWorkflowNodePresentation(workflowNode)).toMatchObject({
      nodeKind,
      sourceKind,
      displayMode,
      status: 'pending',
      statusLabel: '等待中',
    })
  })

  it('keeps persisted legacy design agents as Tasks without rewriting their title or kind', () => {
    const legacyDesignNode = node('agent', 'design', {
      title: 'Design solution',
      subtitle: 'Define implementation and test strategy',
      status: 'success',
    })

    expect(buildWorkflowNodePresentation(legacyDesignNode)).toMatchObject({
      nodeKind: 'Task',
      sourceKind: 'run_template',
      displayMode: 'standard',
      status: 'success',
      statusLabel: '已完成',
    })
    expect(legacyDesignNode).toMatchObject({ kind: 'agent', title: 'Design solution' })
  })

  it('keeps every supported type and source label in one localizable mapping', () => {
    expect(workflowNodeKindLabels).toEqual({
      Task: 'Task',
      Gate: 'Gate',
      Review: 'Review',
      Test: 'Test',
      Delivery: 'Delivery',
      Acceptance: 'Acceptance',
    })
    expect(workflowNodeSourceLabels).toEqual({
      run_template: 'Run 模板',
      team_policy: 'Team Policy',
      local_runtime: '本地 Runtime',
      system_derived: '系统派生',
    })
  })
})
