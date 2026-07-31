import type {
  AgentReviewResult,
  Artifact,
  BudgetGuardDecision,
  CodingAgentRun,
  CodingDiffArtifact,
  RunStatus,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import type { GateEnforcementDecision } from './enforcement'

export type WorkflowCommand =
  | { type: 'complete_agent'; nodeId: string; artifactId: string }
  | { type: 'approve_gate'; nodeId: string }
  | { type: 'complete_build'; nodeId: string; codingRunId: string; diffId: string }
  | { type: 'record_test_result'; nodeId: string; evidenceId: string; artifactId: string }
  | { type: 'complete_pr'; nodeId: string; artifactId: string }
  | { type: 'attach_acceptance_bundle'; nodeId: string; artifactId: string }
  | { type: 'approve_acceptance'; nodeId: string }

export type WorkflowApprovalEvidence = {
  roleAllowed: boolean
  policy: Pick<GateEnforcementDecision, 'blocksApproval'>
  review: 'required' | 'not_required'
  budget: 'required' | 'not_required'
}

export type WorkflowEvidenceSnapshot = {
  artifacts: readonly Artifact[]
  codingRuns: readonly CodingAgentRun[]
  codingDiffs: readonly CodingDiffArtifact[]
  testEvidence: readonly TestEvidence[]
  agentReviews: readonly AgentReviewResult[]
  approval?: WorkflowApprovalEvidence
  budgetDecision?: BudgetGuardDecision
}

export type WorkflowBlockerCode =
  | 'run_terminal'
  | 'node_not_found'
  | 'not_current_node'
  | 'workflow_invariant_violation'
  | 'invalid_node_kind'
  | 'invalid_node_status'
  | 'next_node_missing'
  | 'next_node_not_pending'
  | 'approval_evidence_missing'
  | 'authorization_denied'
  | 'policy_blocked'
  | 'review_missing'
  | 'review_blocked'
  | 'budget_decision_missing'
  | 'budget_blocked'
  | 'clarification_artifact_missing'
  | 'design_artifact_missing'
  | 'coding_run_missing'
  | 'coding_run_not_completed'
  | 'coding_diff_missing'
  | 'test_evidence_missing'
  | 'test_report_missing'
  | 'test_result_not_terminal'
  | 'latest_test_not_passed'
  | 'pr_artifact_missing'
  | 'acceptance_artifact_missing'
  | 'evidence_scope_mismatch'

export type WorkflowBlocker = {
  code: WorkflowBlockerCode
  message: string
}

export type WorkflowCommandDecision =
  | { allowed: true; blockers: [] }
  | { allowed: false; blockers: WorkflowBlocker[] }

export type EvaluateWorkflowCommandInput = {
  run: WorkflowRun
  command: WorkflowCommand
  evidence: WorkflowEvidenceSnapshot
}

export type ApplyWorkflowCommandInput = EvaluateWorkflowCommandInput & {
  now: string
}

export type WorkflowCommandResult =
  | { applied: true; run: WorkflowRun; blockers: []; nextNode?: WorkflowNode }
  | { applied: false; run: WorkflowRun; blockers: WorkflowBlocker[] }

export function evaluateWorkflowCommand(input: EvaluateWorkflowCommandInput): WorkflowCommandDecision {
  const command = input.command
  const blockers = baseBlockers(input.run, command)
  if (blockers.length > 0) {
    return { allowed: false, blockers }
  }

  const node = input.run.nodes.find((candidate) => candidate.id === command.nodeId)!
  const invariantBlocker = evaluateCurrentNodeInvariant(input.run, node)
  if (invariantBlocker) {
    return { allowed: false, blockers: [invariantBlocker] }
  }
  if (command.type === 'complete_agent') {
    if (
      node.kind !== 'agent' ||
      (node.stage !== 'clarify' && node.stage !== 'design')
    ) {
      return blocked(
        'invalid_node_kind',
        'complete_agent requires a clarification or design agent node',
      )
    }
    if (node.status !== 'running') {
      return blocked(
        'invalid_node_status',
        'An agent node must be running before completion',
      )
    }
    const requiredArtifactKind =
      node.stage === 'clarify' ? 'clarification' : 'design'
    const artifact = input.evidence.artifacts.find(
      (candidate) => candidate.id === command.artifactId,
    )
    if (!artifact) {
      return blocked(
        requiredArtifactKind === 'clarification'
          ? 'clarification_artifact_missing'
          : 'design_artifact_missing',
        `Generated ${requiredArtifactKind} artifact not found: ${command.artifactId}`,
      )
    }
    if (
      artifact.runId !== input.run.id ||
      artifact.nodeId !== node.id ||
      artifact.kind !== requiredArtifactKind
    ) {
      return blocked(
        'evidence_scope_mismatch',
        'Generated artifact does not belong to the current agent node',
      )
    }
    const nextBlocker = evaluateNextNode(input.run, node)
    return nextBlocker
      ? { allowed: false, blockers: [nextBlocker] }
      : { allowed: true, blockers: [] }
  }
  if (command.type === 'complete_build') {
    if (node.kind !== 'task' || node.stage !== 'build') {
      return blocked('invalid_node_kind', 'complete_build requires a build task node')
    }
    if (node.status !== 'running' && node.status !== 'failed') {
      return blocked('invalid_node_status', 'A build node must be running or failed before completion')
    }

    const codingRun = input.evidence.codingRuns.find((candidate) => candidate.id === command.codingRunId)
    if (!codingRun) {
      return blocked('coding_run_missing', `Coding run not found: ${command.codingRunId}`)
    }
    if (
      codingRun.runId !== input.run.id ||
      codingRun.projectId !== input.run.projectId ||
      codingRun.nodeId !== node.id
    ) {
      return blocked('evidence_scope_mismatch', 'Coding run does not belong to the current workflow node')
    }
    if (codingRun.status !== 'completed') {
      return blocked('coding_run_not_completed', 'Coding run must be completed before the build can advance')
    }

    const diff = input.evidence.codingDiffs.find((candidate) => candidate.id === command.diffId)
    if (!diff) {
      return blocked('coding_diff_missing', `Coding diff not found: ${command.diffId}`)
    }
    if (
      diff.runId !== input.run.id ||
      diff.projectId !== input.run.projectId ||
      diff.nodeId !== node.id ||
      codingRun.diffArtifactId !== diff.id
    ) {
      return blocked('evidence_scope_mismatch', 'Coding diff does not belong to the completed coding run')
    }

    const nextBlocker = evaluateNextNode(input.run, node)
    return nextBlocker ? { allowed: false, blockers: [nextBlocker] } : { allowed: true, blockers: [] }
  }

  if (command.type === 'record_test_result') {
    if (node.kind !== 'test' || node.stage !== 'test') {
      return blocked('invalid_node_kind', 'record_test_result requires a test node')
    }
    if (node.status !== 'running' && node.status !== 'failed') {
      return blocked('invalid_node_status', 'A test node must be running or failed before recording a result')
    }
    const testEvidence = input.evidence.testEvidence.find(
      (candidate) => candidate.id === command.evidenceId,
    )
    if (!testEvidence) {
      return blocked('test_evidence_missing', `Test evidence not found: ${command.evidenceId}`)
    }
    if (
      testEvidence.runId !== input.run.id ||
      testEvidence.projectId !== input.run.projectId ||
      testEvidence.nodeId !== node.id
    ) {
      return blocked('evidence_scope_mismatch', 'Test evidence does not belong to the current test node')
    }
    if (testEvidence.status === 'running') {
      return blocked('test_result_not_terminal', 'A running test cannot complete a workflow transition')
    }
    const artifact = input.evidence.artifacts.find(
      (candidate) => candidate.id === command.artifactId,
    )
    if (!artifact) {
      return blocked('test_report_missing', `Test report artifact not found: ${command.artifactId}`)
    }
    if (
      artifact.runId !== input.run.id ||
      artifact.nodeId !== node.id ||
      artifact.kind !== 'test_report' ||
      artifact.id !== `artifact-${testEvidence.id}`
    ) {
      return blocked(
        'evidence_scope_mismatch',
        'Test report does not belong to the selected evidence and current test node',
      )
    }
    if (testEvidence.status !== 'passed') {
      return { allowed: true, blockers: [] }
    }
    const nextBlocker = evaluateNextNode(input.run, node)
    return nextBlocker ? { allowed: false, blockers: [nextBlocker] } : { allowed: true, blockers: [] }
  }

  if (command.type === 'complete_pr') {
    if (node.kind !== 'pr' || node.stage !== 'pr') {
      return blocked('invalid_node_kind', 'complete_pr requires a PR node')
    }
    if (node.status !== 'running') {
      return blocked('invalid_node_status', 'A PR node must be running before completion')
    }
    const artifact = input.evidence.artifacts.find(
      (candidate) => candidate.id === command.artifactId,
    )
    if (!artifact) {
      return blocked('pr_artifact_missing', `PR artifact not found: ${command.artifactId}`)
    }
    if (artifact.runId !== input.run.id || artifact.nodeId !== node.id || artifact.kind !== 'pr') {
      return blocked('evidence_scope_mismatch', 'PR artifact does not belong to the current PR node')
    }
    const deliveryBlockers = evaluateDeliveryEvidence(input)
    if (deliveryBlockers.length > 0) {
      return { allowed: false, blockers: deliveryBlockers }
    }
    const nextBlocker = evaluateNextNode(input.run, node)
    return nextBlocker ? { allowed: false, blockers: [nextBlocker] } : { allowed: true, blockers: [] }
  }

  if (command.type === 'attach_acceptance_bundle') {
    if (node.kind !== 'acceptance' || node.stage !== 'accept') {
      return blocked('invalid_node_kind', 'attach_acceptance_bundle requires an acceptance node')
    }
    if (node.status !== 'running' && node.status !== 'blocked') {
      return blocked('invalid_node_status', 'An acceptance node must be running or blocked before attaching evidence')
    }
    const artifact = input.evidence.artifacts.find(
      (candidate) => candidate.id === command.artifactId,
    )
    if (!artifact) {
      return blocked(
        'acceptance_artifact_missing',
        `Acceptance artifact not found: ${command.artifactId}`,
      )
    }
    if (
      artifact.runId !== input.run.id ||
      artifact.nodeId !== node.id ||
      artifact.kind !== 'acceptance'
    ) {
      return blocked('evidence_scope_mismatch', 'Acceptance artifact does not belong to the current node')
    }
    const deliveryBlockers = evaluateDeliveryEvidence(input)
    return deliveryBlockers.length > 0
      ? { allowed: false, blockers: deliveryBlockers }
      : { allowed: true, blockers: [] }
  }

  if (command.type === 'approve_acceptance') {
    if (node.kind !== 'acceptance' || node.stage !== 'accept') {
      return blocked('invalid_node_kind', 'approve_acceptance requires an acceptance node')
    }
    if (node.status !== 'running' && node.status !== 'blocked') {
      return blocked('invalid_node_status', 'An acceptance node must be running or blocked before approval')
    }
    const deliveryBlockers = evaluateDeliveryEvidence(input)
    if (deliveryBlockers.length > 0) {
      return { allowed: false, blockers: deliveryBlockers }
    }
    const hasAttachedBundle = input.evidence.artifacts.some(
      (artifact) =>
        artifact.runId === input.run.id &&
        artifact.nodeId === node.id &&
        artifact.kind === 'acceptance' &&
        node.artifactIds.includes(artifact.id),
    )
    if (!hasAttachedBundle) {
      return blocked('acceptance_artifact_missing', 'An attached acceptance bundle is required')
    }
    const approvalBlockers = evaluateApprovalEvidence(input, node)
    return approvalBlockers.length > 0
      ? { allowed: false, blockers: approvalBlockers }
      : { allowed: true, blockers: [] }
  }

  if (node.kind !== 'gate') {
    return blocked('invalid_node_kind', 'approve_gate requires a gate node')
  }
  if (node.status !== 'running' && node.status !== 'blocked') {
    return blocked('invalid_node_status', 'A gate must be running or blocked before approval')
  }

  const approvalBlockers = evaluateApprovalEvidence(input, node)
  if (approvalBlockers.length > 0) {
    return { allowed: false, blockers: approvalBlockers }
  }

  const requiredArtifactKind =
    node.stage === 'clarify' ? 'clarification' : node.stage === 'design' ? 'design' : null
  const predecessorNodeIds = input.run.edges
    .filter(
      (edge) =>
        edge.target === node.id && (edge.kind === 'normal' || edge.kind === 'gate'),
    )
    .map((edge) => edge.source)
  if (
    requiredArtifactKind &&
    !input.evidence.artifacts.some(
      (artifact) =>
        artifact.runId === input.run.id &&
        predecessorNodeIds.includes(artifact.nodeId) &&
        artifact.kind === requiredArtifactKind &&
        node.artifactIds.includes(artifact.id),
    )
  ) {
    return blocked(
      requiredArtifactKind === 'clarification'
        ? 'clarification_artifact_missing'
        : 'design_artifact_missing',
      `The ${requiredArtifactKind} artifact required by this gate is missing`,
    )
  }

  const nextBlocker = evaluateNextNode(input.run, node)
  return nextBlocker ? { allowed: false, blockers: [nextBlocker] } : { allowed: true, blockers: [] }
}

function evaluateCurrentNodeInvariant(run: WorkflowRun, currentNode: WorkflowNode): WorkflowBlocker | null {
  const expectedRunStatus =
    currentNode.status === 'failed' ? 'failed' : runStatusForCurrentNode(currentNode)
  if (run.status !== expectedRunStatus) {
    return blocker(
      'workflow_invariant_violation',
      `Run status ${run.status} does not match current node ${currentNode.id}`,
    )
  }

  const anotherRunningNode = run.nodes.find(
    (node) => node.id !== currentNode.id && node.status === 'running',
  )
  if (anotherRunningNode) {
    return blocker(
      'workflow_invariant_violation',
      `Another workflow node is running: ${anotherRunningNode.id}`,
    )
  }

  const pending = [...run.edges]
    .filter((edge) => (edge.kind === 'normal' || edge.kind === 'gate') && edge.target === currentNode.id)
    .map((edge) => edge.source)
  const visited = new Set<string>()
  while (pending.length > 0) {
    const ancestorId = pending.pop()!
    if (visited.has(ancestorId)) {
      continue
    }
    visited.add(ancestorId)
    const ancestor = run.nodes.find((node) => node.id === ancestorId)
    if (!ancestor || ancestor.status !== 'success') {
      return blocker(
        'workflow_invariant_violation',
        `Workflow ancestor must be successful before the current node: ${ancestorId}`,
      )
    }
    for (const edge of run.edges) {
      if ((edge.kind === 'normal' || edge.kind === 'gate') && edge.target === ancestorId) {
        pending.push(edge.source)
      }
    }
  }

  const directTargets = [...run.edges]
    .filter((edge) => (edge.kind === 'normal' || edge.kind === 'gate') && edge.source === currentNode.id)
    .map((edge) => edge.target)
  const downstream = run.edges
    .filter(
      (edge) =>
        (edge.kind === 'normal' || edge.kind === 'gate') &&
        directTargets.includes(edge.source),
    )
    .map((edge) => edge.target)
  const visitedDownstream = new Set<string>()
  while (downstream.length > 0) {
    const descendantId = downstream.pop()!
    if (visitedDownstream.has(descendantId)) {
      continue
    }
    visitedDownstream.add(descendantId)
    const descendant = run.nodes.find((node) => node.id === descendantId)
    if (!descendant || descendant.status !== 'pending') {
      return blocker(
        'workflow_invariant_violation',
        `Workflow descendant must be pending after the current node: ${descendantId}`,
      )
    }
    for (const edge of run.edges) {
      if ((edge.kind === 'normal' || edge.kind === 'gate') && edge.source === descendantId) {
        downstream.push(edge.target)
      }
    }
  }
  return null
}

export function applyWorkflowCommand(input: ApplyWorkflowCommandInput): WorkflowCommandResult {
  const decision = evaluateWorkflowCommand(input)
  if (!decision.allowed) {
    return { applied: false, run: input.run, blockers: decision.blockers }
  }

  const command = input.command
  const currentNode = input.run.nodes.find((node) => node.id === command.nodeId)!
  if (command.type === 'approve_acceptance') {
    return {
      applied: true,
      blockers: [],
      run: {
        ...input.run,
        status: 'completed',
        updatedAt: input.now,
        nodes: input.run.nodes.map((node) =>
          node.id === currentNode.id ? { ...node, status: 'success' as const } : node,
        ),
      },
    }
  }
  if (command.type === 'attach_acceptance_bundle') {
    return {
      applied: true,
      blockers: [],
      run: {
        ...input.run,
        updatedAt: input.now,
        nodes: input.run.nodes.map((node) =>
          node.id === currentNode.id
            ? {
                ...node,
                artifactIds: unique([...node.artifactIds, command.artifactId]),
              }
            : node,
        ),
      },
    }
  }
  if (command.type === 'record_test_result') {
    const testEvidence = input.evidence.testEvidence.find(
      (candidate) => candidate.id === command.evidenceId,
    )!
    if (testEvidence.status !== 'passed') {
      return {
        applied: true,
        blockers: [],
        run: {
          ...input.run,
          status: 'failed',
          updatedAt: input.now,
          nodes: input.run.nodes.map((node) =>
            node.id === currentNode.id
              ? {
                  ...node,
                  status: 'failed' as const,
                  artifactIds: unique([...node.artifactIds, command.artifactId]),
                }
              : node,
          ),
        },
      }
    }
  }
  const outgoingEdge = input.run.edges.find(
    (edge) => edge.source === currentNode.id && (edge.kind === 'normal' || edge.kind === 'gate'),
  )!
  const nextNode = input.run.nodes.find((node) => node.id === outgoingEdge.target)!
  const run: WorkflowRun = {
    ...input.run,
    currentNodeId: nextNode.id,
    status: runStatusForCurrentNode(nextNode),
    updatedAt: input.now,
    nodes: input.run.nodes.map((node) => {
      if (node.id === currentNode.id) {
        return {
          ...node,
          status: 'success' as const,
          artifactIds:
            command.type === 'complete_agent' ||
            command.type === 'record_test_result' ||
            command.type === 'complete_pr'
              ? unique([...node.artifactIds, command.artifactId])
              : node.artifactIds,
        }
      }
      if (node.id === nextNode.id) {
        return {
          ...node,
          status: 'running' as const,
          artifactIds:
            command.type === 'complete_agent'
              ? unique([...node.artifactIds, command.artifactId])
              : node.artifactIds,
        }
      }
      return node
    }),
  }

  return {
    applied: true,
    run,
    blockers: [],
    nextNode: { ...nextNode, status: 'running' },
  }
}

function evaluateDeliveryEvidence(input: EvaluateWorkflowCommandInput): WorkflowBlocker[] {
  const buildNode = input.run.nodes.find((node) => node.kind === 'task' && node.stage === 'build')
  const completedCodingRuns = input.evidence.codingRuns.filter(
    (codingRun) =>
      buildNode &&
      codingRun.runId === input.run.id &&
      codingRun.projectId === input.run.projectId &&
      codingRun.nodeId === buildNode.id &&
      codingRun.status === 'completed',
  )
  if (completedCodingRuns.length === 0) {
    return [blocker('coding_run_not_completed', 'A matching completed coding run is required')]
  }
  const hasMatchingDiff = completedCodingRuns.some((codingRun) =>
    input.evidence.codingDiffs.some(
      (diff) =>
        diff.id === codingRun.diffArtifactId &&
        diff.runId === input.run.id &&
        diff.projectId === input.run.projectId &&
        diff.nodeId === buildNode?.id,
    ),
  )
  if (!hasMatchingDiff) {
    return [blocker('coding_diff_missing', 'A matching coding diff is required')]
  }

  const testNode = input.run.nodes.find((node) => node.kind === 'test' && node.stage === 'test')
  const latestTest = latestByTimestamp(
    input.evidence.testEvidence.filter(
      (testEvidence) =>
        testNode &&
        testEvidence.runId === input.run.id &&
        testEvidence.projectId === input.run.projectId &&
        testEvidence.nodeId === testNode.id,
    ),
    (testEvidence) => testEvidence.createdAt,
  )
  if (!latestTest) {
    return [blocker('test_evidence_missing', 'Test evidence for the workflow test node is required')]
  }
  if (latestTest.status !== 'passed') {
    return [blocker('latest_test_not_passed', 'The latest matching test evidence must be passing')]
  }
  const hasMatchingTestReport = input.evidence.artifacts.some(
    (artifact) =>
      artifact.id === `artifact-${latestTest.id}` &&
      artifact.runId === input.run.id &&
      artifact.nodeId === testNode?.id &&
      artifact.kind === 'test_report' &&
      testNode?.artifactIds.includes(artifact.id),
  )
  if (!hasMatchingTestReport) {
    return [blocker('test_report_missing', 'The latest passing test report must be attached')]
  }

  if (input.command.type !== 'complete_pr') {
    const prNode = input.run.nodes.find((node) => node.kind === 'pr' && node.stage === 'pr')
    const hasAttachedPrArtifact = input.evidence.artifacts.some(
      (artifact) =>
        prNode &&
        artifact.runId === input.run.id &&
        artifact.nodeId === prNode.id &&
        artifact.kind === 'pr' &&
        prNode.artifactIds.includes(artifact.id),
    )
    if (!hasAttachedPrArtifact) {
      return [blocker('pr_artifact_missing', 'An attached PR artifact is required')]
    }
  }
  return []
}

function baseBlockers(run: WorkflowRun, command: WorkflowCommand): WorkflowBlocker[] {
  if (run.status === 'completed' || run.status === 'cancelled') {
    return [blocker('run_terminal', 'Terminal workflow runs cannot accept commands')]
  }
  const node = run.nodes.find((candidate) => candidate.id === command.nodeId)
  if (!node) {
    return [blocker('node_not_found', `Workflow node not found: ${command.nodeId}`)]
  }
  if (run.currentNodeId !== node.id) {
    return [blocker('not_current_node', 'Only the current workflow node can accept commands')]
  }
  return []
}

function evaluateApprovalEvidence(
  input: EvaluateWorkflowCommandInput,
  node: WorkflowNode,
): WorkflowBlocker[] {
  const approval = input.evidence.approval
  if (!approval) {
    return [blocker('approval_evidence_missing', 'Approval evidence is required')]
  }

  const blockers: WorkflowBlocker[] = []
  if (!approval.roleAllowed) {
    blockers.push(blocker('authorization_denied', 'The actor is not authorized to approve this node'))
  }
  if (approval.policy.blocksApproval) {
    blockers.push(blocker('policy_blocked', 'Gate enforcement policy blocks this approval'))
  }
  if (approval.review === 'required') {
    const latestReview = latestByTimestamp(
      input.evidence.agentReviews.filter(
        (review) =>
          review.runId === input.run.id &&
          review.projectId === input.run.projectId &&
          review.nodeId === node.id,
      ),
      (review) => review.createdAt,
    )
    if (!latestReview) {
      blockers.push(blocker('review_missing', 'A matching Agent Review is required'))
    } else if (latestReview.gateAdvisory.blocksApproval) {
      blockers.push(blocker('review_blocked', 'The latest matching Agent Review blocks approval'))
    }
  }
  if (approval.budget === 'required') {
    if (!input.evidence.budgetDecision) {
      blockers.push(blocker('budget_decision_missing', 'A budget decision is required'))
    } else if (input.evidence.budgetDecision.blocksRun) {
      blockers.push(blocker('budget_blocked', 'The budget decision blocks this workflow command'))
    }
  }
  return blockers
}

function evaluateNextNode(run: WorkflowRun, node: WorkflowNode): WorkflowBlocker | null {
  const outgoingEdge = run.edges.find(
    (edge) => edge.source === node.id && (edge.kind === 'normal' || edge.kind === 'gate'),
  )
  if (!outgoingEdge) {
    return blocker('next_node_missing', 'The current node has no workflow edge to a next node')
  }
  const nextNode = run.nodes.find((candidate) => candidate.id === outgoingEdge.target)
  if (!nextNode) {
    return blocker('next_node_missing', `Workflow edge target not found: ${outgoingEdge.target}`)
  }
  if (nextNode.status !== 'pending') {
    return blocker('next_node_not_pending', 'The next workflow node must be pending before transition')
  }
  return null
}

function blocked(code: WorkflowBlockerCode, message: string): WorkflowCommandDecision {
  return { allowed: false, blockers: [blocker(code, message)] }
}

function blocker(code: WorkflowBlockerCode, message: string): WorkflowBlocker {
  return { code, message }
}

function runStatusForNode(node: WorkflowNode): RunStatus {
  if (node.stage === 'clarify') return 'clarifying'
  if (node.stage === 'design') return 'designing'
  if (node.stage === 'build') return 'building'
  if (node.stage === 'test') return 'testing'
  return 'paused_at_gate'
}

function runStatusForCurrentNode(node: WorkflowNode): RunStatus {
  if (node.kind === 'gate' || node.kind === 'acceptance' || node.kind === 'pr') {
    return 'paused_at_gate'
  }
  return runStatusForNode(node)
}

function latestByTimestamp<T>(items: readonly T[], getTimestamp: (item: T) => string): T | undefined {
  return [...items].sort((left, right) => getTimestamp(right).localeCompare(getTimestamp(left)))[0]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
