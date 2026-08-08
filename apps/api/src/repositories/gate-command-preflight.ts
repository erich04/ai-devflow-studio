import {
  canApproveGate,
  canApproveGateNow,
  type CreateGateCommandInput,
  type GateCommandWorkflowCommand,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type Role,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

export type GateCommandPreflightRejectionCode =
  | 'stale_run'
  | 'stale_policy'
  | 'blockers_changed'
  | 'node_not_current'
  | 'role_forbidden'
  | 'separation_of_duties'
  | 'preflight_blocked'

export type GateCommandPreflightInput = {
  command: CreateGateCommandInput
  run: WorkflowRun
  currentNode: WorkflowNode
  requester: {
    userId: string
    role: Role
  }
  enforcement: GateEnforcementDecision
  override?: GateOverrideDecision
}

export type GateCommandPreflightResult =
  | {
      allowed: true
      workflowCommand: GateCommandWorkflowCommand | null
      evaluationStatus: 'allowed'
      evaluationBlockerIds: string[]
    }
  | {
      allowed: false
      code: GateCommandPreflightRejectionCode
    }

function rejection(
  code: GateCommandPreflightRejectionCode,
): GateCommandPreflightResult {
  return { allowed: false, code }
}

function hasSameNodeSnapshot(
  first: WorkflowNode,
  second: WorkflowNode,
): boolean {
  return (
    first.id === second.id &&
    first.stage === second.stage &&
    first.title === second.title &&
    first.subtitle === second.subtitle &&
    first.kind === second.kind &&
    first.status === second.status &&
    first.ownerId === second.ownerId &&
    first.requiredRole === second.requiredRole &&
    first.retryCount === second.retryCount &&
    first.tokenUsageId === second.tokenUsageId &&
    first.artifactIds.length === second.artifactIds.length &&
    first.artifactIds.every(
      (artifactId, index) => artifactId === second.artifactIds[index],
    )
  )
}

function hasExactAcceptedOverride(input: {
  override: GateOverrideDecision
  run: WorkflowRun
  node: WorkflowNode
  requester: GateCommandPreflightInput['requester']
  policyVersion: number
  blockerIds: readonly string[]
}): boolean {
  const overrideBlockerIds = [...new Set(input.override.blockedReasonIds)].sort()
  return (
    input.override.status === 'accepted' &&
    input.override.projectId === input.run.projectId &&
    input.override.runId === input.run.id &&
    input.override.nodeId === input.node.id &&
    input.override.userId === input.requester.userId &&
    input.override.role === input.requester.role &&
    input.override.role === 'lead' &&
    input.override.policyVersion === input.policyVersion &&
    !input.override.provisional &&
    input.override.reason.trim().length > 0 &&
    overrideBlockerIds.length === input.override.blockedReasonIds.length &&
    overrideBlockerIds.every(
      (blockerId, index) =>
        blockerId === input.override.blockedReasonIds[index] &&
        blockerId === input.blockerIds[index],
    ) &&
    overrideBlockerIds.length === input.blockerIds.length
  )
}

export function preflightGateCommand(
  input: GateCommandPreflightInput,
): GateCommandPreflightResult {
  if (
    input.command.projectId !== input.run.projectId ||
    input.command.runId !== input.run.id
  ) {
    return rejection('stale_run')
  }

  if (
    input.run.currentNodeId !== input.command.nodeId ||
    input.currentNode.id !== input.command.nodeId
  ) {
    return rejection('node_not_current')
  }
  const canonicalNode = input.run.nodes.find(
    (node) => node.id === input.run.currentNodeId,
  )
  if (
    !canonicalNode ||
    !hasSameNodeSnapshot(canonicalNode, input.currentNode)
  ) {
    return rejection('node_not_current')
  }
  if (
    input.run.status !== 'paused_at_gate' ||
    (input.currentNode.status !== 'running' &&
      input.currentNode.status !== 'blocked')
  ) {
    return rejection('node_not_current')
  }
  if (input.command.expectedRunVersion !== input.run.version) {
    return rejection('stale_run')
  }
  if (
    input.command.expectedPolicyVersion !== input.enforcement.policyVersion
  ) {
    return rejection('stale_policy')
  }
  const rawBlockerIds = input.enforcement.blockingReasons.map(
    (reason) => reason.id,
  )
  const currentBlockerIds = [...new Set(rawBlockerIds)].sort()
  const canonicalExpectedBlockerIds = [
    ...new Set(input.command.expectedBlockerIds),
  ].sort()
  if (
    currentBlockerIds.length !== rawBlockerIds.length ||
    canonicalExpectedBlockerIds.length !==
      input.command.expectedBlockerIds.length ||
    canonicalExpectedBlockerIds.some(
      (blockerId, index) =>
        blockerId !== input.command.expectedBlockerIds[index],
    ) ||
    currentBlockerIds.length !== canonicalExpectedBlockerIds.length ||
    currentBlockerIds.some(
      (blockerId, index) => blockerId !== canonicalExpectedBlockerIds[index],
    )
  ) {
    return rejection('blockers_changed')
  }

  if (!canApproveGate('owner', input.currentNode)) {
    return rejection('node_not_current')
  }
  if (input.command.action === 'reject') {
    if (
      input.requester.role !== 'lead' &&
      input.requester.role !== 'owner'
    ) {
      return rejection('role_forbidden')
    }
    return {
      allowed: true,
      workflowCommand: null,
      evaluationStatus: 'allowed',
      evaluationBlockerIds: currentBlockerIds,
    }
  }
  if (!canApproveGate(input.requester.role, input.currentNode)) {
    return rejection('role_forbidden')
  }
  if (
    input.override &&
    !hasExactAcceptedOverride({
      override: input.override,
      run: input.run,
      node: input.currentNode,
      requester: input.requester,
      policyVersion: input.enforcement.policyVersion,
      blockerIds: currentBlockerIds,
    })
  ) {
    return rejection('preflight_blocked')
  }
  if (
    input.override &&
    (input.requester.userId === input.run.creatorId ||
      input.requester.userId === input.currentNode.ownerId)
  ) {
    return rejection('separation_of_duties')
  }

  const approval = canApproveGateNow({
    userRole: input.requester.role,
    userId: input.requester.userId,
    run: input.run,
    node: input.currentNode,
    enforcement: input.enforcement,
    ...(input.override ? { override: input.override } : {}),
  })
  if (!approval.allowed) {
    return rejection('preflight_blocked')
  }

  return {
    allowed: true,
    workflowCommand:
      input.currentNode.kind === 'acceptance'
        ? 'approve_acceptance'
        : 'approve_gate',
    evaluationStatus: 'allowed',
    evaluationBlockerIds: currentBlockerIds,
  }
}
