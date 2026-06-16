import type { RequiredGateRole, Role, WorkflowNode } from './domain'

const roleRank: Record<Role, number> = {
  member: 1,
  lead: 2,
  owner: 3,
}

const requiredRank: Record<RequiredGateRole, number> = {
  member: 1,
  lead: 2,
  owner: 3,
}

export function canApproveGate(userRole: Role, node: WorkflowNode): boolean {
  if (node.kind !== 'gate' && node.kind !== 'acceptance') {
    return false
  }

  const required = node.requiredRole ?? 'member'
  return roleRank[userRole] >= requiredRank[required]
}

export function nextStatusAfterApproval(node: WorkflowNode): WorkflowNode {
  if (node.kind !== 'gate' && node.kind !== 'acceptance') {
    return node
  }

  return {
    ...node,
    status: 'success',
  }
}
