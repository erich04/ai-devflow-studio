import { describe, expect, it } from 'vitest'
import type { Artifact, WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import { buildWorkflowGateImpact } from './workflow-gate-impact'

function node(overrides: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'kind' | 'stage'>): WorkflowNode {
  return {
    title: overrides.id,
    subtitle: 'fixture',
    status: 'pending',
    ownerId: 'member-1',
    retryCount: 0,
    artifactIds: [],
    ...overrides,
  }
}

function run(nodes: WorkflowNode[], edges: WorkflowRun['edges'], currentNodeId = nodes[0]?.id ?? ''): WorkflowRun {
  return {
    id: 'run-gate-impact',
    version: 1,
    title: 'Gate impact fixture',
    request: 'Derive downstream Gate context.',
    projectId: 'project-1',
    creatorId: 'member-1',
    status: 'clarifying',
    currentNodeId,
    branchName: 'codex/gate-impact',
    nodes,
    edges,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  }
}

const artifact: Artifact = {
  id: 'artifact-clarify',
  runId: 'run-gate-impact',
  nodeId: 'task',
  kind: 'clarification',
  title: '需求澄清结果',
  summary: 'Clarified request.',
  content: 'Acceptance criteria.',
  redacted: false,
  updatedAt: '2026-08-30T00:01:00.000Z',
}

describe('workflow Gate impact', () => {
  it.each([
    ['pending', false, '等待中'],
    ['running', true, '当前步骤'],
    ['blocked', true, '已阻断'],
    ['success', false, '已完成'],
  ] as const)('projects a %s downstream Gate without write authority', (status, isCurrent, statusLabel) => {
    const task = node({ id: 'task', kind: 'agent', stage: 'clarify', status: 'success', artifactIds: [artifact.id] })
    const gate = node({ id: 'gate', kind: 'gate', stage: 'clarify', status, artifactIds: [artifact.id] })
    const workflow = run(
      [task, gate],
      [{ id: 'edge-task-gate', source: task.id, target: gate.id, kind: 'gate' }],
      isCurrent ? gate.id : task.id,
    )

    expect(buildWorkflowGateImpact({ run: workflow, node: task, artifacts: [artifact] })).toEqual({
      state: 'found',
      gateId: gate.id,
      gateTitle: gate.title,
      gateStatus: status,
      gateStatusLabel: statusLabel,
      isCurrentStep: isCurrent,
      distance: 1,
      relationshipLabel: '直接下游 Gate',
      providedArtifactCount: 1,
      linkedArtifacts: [{ id: artifact.id, title: artifact.title, kind: artifact.kind }],
      unconsumedArtifactCount: 0,
    })
  })

  it('selects the shortest downstream Gate, then the earliest node when distances tie', () => {
    const task = node({ id: 'task', kind: 'task', stage: 'build' })
    const branchA = node({ id: 'branch-a', kind: 'test', stage: 'test' })
    const branchB = node({ id: 'branch-b', kind: 'test', stage: 'test' })
    const firstGate = node({ id: 'gate-first', title: 'First by workflow order', kind: 'gate', stage: 'test' })
    const secondGate = node({ id: 'gate-second', title: 'Second by workflow order', kind: 'gate', stage: 'test' })
    const laterGate = node({ id: 'gate-later', kind: 'acceptance', stage: 'accept' })
    const workflow = run(
      [task, branchA, branchB, firstGate, secondGate, laterGate],
      [
        { id: 'edge-task-a', source: task.id, target: branchA.id, kind: 'normal' },
        { id: 'edge-task-b', source: task.id, target: branchB.id, kind: 'normal' },
        { id: 'edge-a-second', source: branchA.id, target: secondGate.id, kind: 'gate' },
        { id: 'edge-b-first', source: branchB.id, target: firstGate.id, kind: 'gate' },
        { id: 'edge-second-later', source: secondGate.id, target: laterGate.id, kind: 'normal' },
      ],
    )

    expect(buildWorkflowGateImpact({ run: workflow, node: task, artifacts: [] })).toMatchObject({
      state: 'found',
      gateId: firstGate.id,
      distance: 2,
      relationshipLabel: '最近下游 Gate · 2 步',
    })
  })

  it('handles cycles and reports no downstream Gate explicitly', () => {
    const task = node({ id: 'task', kind: 'task', stage: 'build' })
    const test = node({ id: 'test', kind: 'test', stage: 'test' })
    const workflow = run(
      [task, test],
      [
        { id: 'edge-task-test', source: task.id, target: test.id, kind: 'normal' },
        { id: 'edge-test-task', source: test.id, target: task.id, kind: 'retry' },
      ],
    )

    expect(buildWorkflowGateImpact({ run: workflow, node: task, artifacts: [] })).toEqual({
      state: 'none',
      summary: '当前节点不影响后续 Gate。',
    })
  })
})
