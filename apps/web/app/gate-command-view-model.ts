import type { WorkflowNode, WorkflowRun } from '@ai-devflow/shared'

export type GateCommandApprovalAction = 'approve_gate' | 'approve_acceptance'

export type GateCommandTarget = {
  node: WorkflowNode
  commandNodeId: string
  action: GateCommandApprovalAction
}

export function selectGateCommandTarget(
  activeRun: Pick<WorkflowRun, 'id' | 'currentNodeId' | 'nodes'>,
): GateCommandTarget | null {
  const currentNode = activeRun.nodes.find((node) => node.id === activeRun.currentNodeId)
  if (currentNode?.kind !== 'gate' && currentNode?.kind !== 'acceptance') return null
  const storagePrefix = `${activeRun.id}:`
  const commandNodeId = currentNode.id.startsWith(storagePrefix)
    ? currentNode.id.slice(storagePrefix.length)
    : currentNode.id
  if (!commandNodeId) return null

  return {
    node: currentNode,
    commandNodeId,
    action: currentNode.kind === 'gate' ? 'approve_gate' : 'approve_acceptance',
  }
}
