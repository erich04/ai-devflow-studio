import { describe, expect, it } from 'vitest'
import type { WorkflowNode } from '@ai-devflow/shared'
import { selectGateCommandTarget } from './gate-command-view-model'

function node(input: Pick<WorkflowNode, 'id' | 'kind'>): WorkflowNode {
  return {
    id: input.id,
    stage: input.kind === 'acceptance' ? 'accept' : 'design',
    title: input.id,
    subtitle: 'Approval target',
    kind: input.kind,
    status: 'blocked',
    ownerId: 'user-lead',
    retryCount: 0,
    artifactIds: [],
  }
}

describe('selectGateCommandTarget', () => {
  it('selects the active Run current gate and derives approve_gate', () => {
    const currentGate = node({ id: 'node-current-gate', kind: 'gate' })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: currentGate.id,
        nodes: [currentGate],
      }),
    ).toEqual({
      node: currentGate,
      commandNodeId: currentGate.id,
      action: 'approve_gate',
    })
  })

  it('selects the active Run current acceptance and derives approve_acceptance', () => {
    const currentAcceptance = node({ id: 'node-current-acceptance', kind: 'acceptance' })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: currentAcceptance.id,
        nodes: [currentAcceptance],
      }),
    ).toEqual({
      node: currentAcceptance,
      commandNodeId: currentAcceptance.id,
      action: 'approve_acceptance',
    })
  })

  it('does not select a current node that is not a gate or acceptance', () => {
    const currentTask = node({ id: 'node-current-task', kind: 'task' })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: currentTask.id,
        nodes: [currentTask],
      }),
    ).toBeNull()
  })

  it('never falls back to a historical gate when the current node is not approvable', () => {
    const historicalGate = node({ id: 'node-historical-gate', kind: 'gate' })
    const currentTask = node({ id: 'node-current-task', kind: 'task' })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: currentTask.id,
        nodes: [historicalGate, currentTask],
      }),
    ).toBeNull()
  })

  it('returns null when currentNodeId does not resolve to a node', () => {
    const historicalGate = node({ id: 'node-historical-gate', kind: 'gate' })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: 'node-missing',
        nodes: [historicalGate],
      }),
    ).toBeNull()
  })

  it('projects a Postgres storage node ID back to the canonical Desktop node ID', () => {
    const currentGate = node({
      id: 'run-current:node-current-gate',
      kind: 'gate',
    })

    expect(
      selectGateCommandTarget({
        id: 'run-current',
        currentNodeId: currentGate.id,
        nodes: [currentGate],
      }),
    ).toEqual({
      node: currentGate,
      commandNodeId: 'node-current-gate',
      action: 'approve_gate',
    })
  })
})
