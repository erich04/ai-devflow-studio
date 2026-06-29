import type {
  AgentEvent,
  Artifact,
  BudgetGuardDecision,
  CodingDiffArtifact,
  RunStatus,
  TestEvidence,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import type { GateEnforcementDecision } from './enforcement'
import { nextStatusAfterApproval } from './gates'

export type CreateWorkflowRunFromRequestInput = {
  runId: string
  title: string
  request: string
  projectId: string
  creatorId: string
  branchName: string
  now: string
}

export type CreateWorkflowRunFromRequestResult = {
  run: WorkflowRun
  artifacts: Artifact[]
  events: AgentEvent[]
}

export type AdvanceWorkflowAfterGateApprovalInput = {
  run: WorkflowRun
  approvedNodeId: string
  now: string
}

export type WorkflowAdvanceResult = {
  run: WorkflowRun
  advanced: boolean
  nextNode?: WorkflowNode
}

export type WorkflowAgentStageCompletionInput = {
  run: WorkflowRun
  nodeId: string
  artifacts: Artifact[]
  generatedArtifact?: Artifact
  existingEvents: AgentEvent[]
  actorName: string
  now: string
}

export type WorkflowAgentStageCompletionResult = {
  run: WorkflowRun
  artifact: Artifact
  artifacts: Artifact[]
  event: AgentEvent
  nextNode: WorkflowNode
}

export type DeliveryProjectReference = {
  repository: string
  defaultBranch: string
}

export type CreatePrDraftArtifactInput = {
  run: WorkflowRun
  project: DeliveryProjectReference
  artifacts: Artifact[]
  codingDiffs: CodingDiffArtifact[]
  testEvidence: TestEvidence[]
  enforcement?: GateEnforcementDecision
  budgetDecision?: BudgetGuardDecision
  agentReviewSummaries?: string[]
  now: string
}

export type CreateAcceptanceEvidenceBundleArtifactInput = {
  run: WorkflowRun
  artifacts: Artifact[]
  codingDiffs: CodingDiffArtifact[]
  testEvidence: TestEvidence[]
  enforcement?: GateEnforcementDecision
  budgetDecision?: BudgetGuardDecision
  agentReviewSummaries?: string[]
  now: string
}

export function createWorkflowRunFromRequest(input: CreateWorkflowRunFromRequestInput): CreateWorkflowRunFromRequestResult {
  const nodeIds = {
    clarify: `${input.runId}-clarify`,
    clarifyGate: `${input.runId}-clarify-gate`,
    design: `${input.runId}-design`,
    designGate: `${input.runId}-design-gate`,
    build: `${input.runId}-build`,
    test: `${input.runId}-test`,
    pr: `${input.runId}-pr`,
    accept: `${input.runId}-accept`,
  }
  const rawRequestArtifactId = `artifact-${input.runId}-raw-request`

  const nodes: WorkflowNode[] = [
    {
      id: nodeIds.clarify,
      stage: 'clarify',
      title: '需求澄清',
      subtitle: '补齐验收口径与非目标',
      kind: 'agent',
      status: 'running',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [rawRequestArtifactId],
    },
    {
      id: nodeIds.clarifyGate,
      stage: 'clarify',
      title: '需求确认 Gate',
      subtitle: '确认需求已准备进入方案设计',
      kind: 'gate',
      status: 'pending',
      ownerId: input.creatorId,
      requiredRole: 'member',
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.design,
      stage: 'design',
      title: '方案设计',
      subtitle: '定义实现方案与测试策略',
      kind: 'agent',
      status: 'pending',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.designGate,
      stage: 'design',
      title: '方案评审 Gate',
      subtitle: '审批方案后进入实现',
      kind: 'gate',
      status: 'pending',
      ownerId: input.creatorId,
      requiredRole: 'lead',
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.build,
      stage: 'build',
      title: 'Implement locally',
      subtitle: 'Run Coding Agent in a managed worktree',
      kind: 'task',
      status: 'pending',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.test,
      stage: 'test',
      title: 'Run tests',
      subtitle: 'Archive local test evidence',
      kind: 'test',
      status: 'pending',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.pr,
      stage: 'pr',
      title: 'Prepare PR draft',
      subtitle: 'Summarize diff, tests, policy, and review evidence',
      kind: 'pr',
      status: 'pending',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [],
    },
    {
      id: nodeIds.accept,
      stage: 'accept',
      title: 'Acceptance signoff',
      subtitle: 'Approve final delivery bundle',
      kind: 'acceptance',
      status: 'pending',
      ownerId: input.creatorId,
      requiredRole: 'lead',
      retryCount: 0,
      artifactIds: [],
    },
  ]

  const edges: WorkflowEdge[] = [
    { id: `${input.runId}-edge-clarify-gate`, source: nodeIds.clarify, target: nodeIds.clarifyGate, kind: 'gate' },
    { id: `${input.runId}-edge-design`, source: nodeIds.clarifyGate, target: nodeIds.design, kind: 'normal' },
    { id: `${input.runId}-edge-design-gate`, source: nodeIds.design, target: nodeIds.designGate, kind: 'gate' },
    { id: `${input.runId}-edge-build`, source: nodeIds.designGate, target: nodeIds.build, kind: 'normal' },
    { id: `${input.runId}-edge-test`, source: nodeIds.build, target: nodeIds.test, kind: 'normal' },
    { id: `${input.runId}-edge-pr`, source: nodeIds.test, target: nodeIds.pr, kind: 'normal' },
    { id: `${input.runId}-edge-accept`, source: nodeIds.pr, target: nodeIds.accept, kind: 'gate' },
  ]

  const run: WorkflowRun = {
    id: input.runId,
    title: input.title,
    request: input.request,
    projectId: input.projectId,
    creatorId: input.creatorId,
    status: 'clarifying',
    currentNodeId: nodeIds.clarify,
    branchName: input.branchName,
    createdAt: input.now,
    updatedAt: input.now,
    nodes,
    edges,
  }

  const artifacts: Artifact[] = [
    {
      id: rawRequestArtifactId,
      runId: input.runId,
      nodeId: nodeIds.clarify,
      kind: 'raw_request',
      title: 'Raw request',
      summary: input.title,
      content: input.request,
      redacted: false,
      updatedAt: input.now,
    },
  ]

  const events: AgentEvent[] = [
    {
      id: `event-${input.runId}-created`,
      runId: input.runId,
      nodeId: nodeIds.clarify,
      sequence: 1,
      kind: 'thinking',
      message: 'Workflow run created from raw request.',
      timestamp: input.now,
    },
  ]

  return { run, artifacts, events }
}

export function advanceWorkflowAfterGateApproval(input: AdvanceWorkflowAfterGateApprovalInput): WorkflowAdvanceResult {
  const approvedNode = input.run.nodes.find((node) => node.id === input.approvedNodeId)
  if (!approvedNode || (approvedNode.kind !== 'gate' && approvedNode.kind !== 'acceptance')) {
    return { run: input.run, advanced: false }
  }

  const advanced = advanceWorkflowAlongEdge({
    run: input.run,
    fromNodeId: approvedNode.id,
    fromStatus: nextStatusAfterApproval(approvedNode).status,
    now: input.now,
    terminalStatus: runStatusAfterTerminalApproval(approvedNode),
  })

  return {
    run: advanced.run,
    advanced: Boolean(advanced.nextNode),
    ...(advanced.nextNode ? { nextNode: advanced.nextNode } : {}),
  }
}

export function completeWorkflowAgentNode(input: WorkflowAgentStageCompletionInput): WorkflowAgentStageCompletionResult {
  if (input.run.currentNodeId !== input.nodeId) {
    throw new Error('Only the current workflow node can be completed')
  }

  const node = input.run.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node) {
    throw new Error(`Run node not found: ${input.nodeId}`)
  }
  if (node.kind !== 'agent') {
    throw new Error('Only workflow agent nodes can be completed')
  }
  if (node.status === 'success') {
    throw new Error('Workflow agent node is already completed')
  }
  if (node.stage !== 'clarify' && node.stage !== 'design') {
    throw new Error(`Workflow agent stage is not supported: ${node.stage}`)
  }

  const advanced = advanceWorkflowAlongEdge({
    run: input.run,
    fromNodeId: node.id,
    fromStatus: 'success',
    now: input.now,
    nextStatusOverride: 'paused_at_gate',
  })
  if (!advanced.nextNode || (advanced.nextNode.kind !== 'gate' && advanced.nextNode.kind !== 'acceptance')) {
    throw new Error('Workflow agent node does not lead to a Gate')
  }

  const artifact = input.generatedArtifact ?? buildAgentStageArtifact({
    run: input.run,
    node,
    artifacts: input.artifacts,
    now: input.now,
  })
  if (artifact.runId !== input.run.id || artifact.nodeId !== node.id) {
    throw new Error('Generated workflow artifact does not belong to the completed node')
  }
  if (
    (node.stage === 'clarify' && artifact.kind !== 'clarification') ||
    (node.stage === 'design' && artifact.kind !== 'design')
  ) {
    throw new Error(`Generated workflow artifact kind does not match node stage: ${artifact.kind}`)
  }
  const run = linkArtifactToNodes(advanced.run, artifact.id, [node.id, advanced.nextNode.id])
  const nextNode = run.nodes.find((candidate) => candidate.id === advanced.nextNode!.id) ?? advanced.nextNode
  const artifacts = upsertArtifact(input.artifacts, artifact)
  const event: AgentEvent = {
    id: `event-${artifact.id}`,
    runId: input.run.id,
    nodeId: node.id,
    sequence: nextEventSequence(input.existingEvents, input.run.id),
    kind: 'thinking',
    message: `${input.actorName} generated ${artifact.title} and advanced to ${advanced.nextNode.title}.`,
    timestamp: input.now,
  }

  return {
    run,
    artifact,
    artifacts,
    event,
    nextNode,
  }
}

export function normalizeWorkflowRunProgress(run: WorkflowRun): WorkflowRun {
  const currentRunningNode = run.nodes.find((node) => node.id === run.currentNodeId && node.status === 'running')
  const activeNode = currentRunningNode ?? run.nodes.find((node) => node.status === 'running')
  if (!activeNode) {
    return run
  }

  const activeIndex = run.nodes.findIndex((node) => node.id === activeNode.id)
  const status = runStatusForNode(activeNode)
  let changed = run.currentNodeId !== activeNode.id || run.status !== status
  const nodes = run.nodes.map((node, index) => {
    if (node.id === activeNode.id) {
      if (node.status === 'running') {
        return node
      }
      changed = true
      return { ...node, status: 'running' as const }
    }

    if (activeIndex >= 0 && index > activeIndex && node.status !== 'pending') {
      changed = true
      return { ...node, status: 'pending' as const }
    }

    return node
  })

  if (!changed) {
    return run
  }

  return {
    ...run,
    status,
    currentNodeId: activeNode.id,
    nodes,
  }
}

type AdvanceWorkflowAlongEdgeInput = {
  run: WorkflowRun
  fromNodeId: string
  fromStatus: WorkflowNode['status']
  now: string
  terminalStatus?: RunStatus
  nextStatusOverride?: RunStatus
}

function advanceWorkflowAlongEdge(input: AdvanceWorkflowAlongEdgeInput): WorkflowAdvanceResult {
  const fromNode = input.run.nodes.find((node) => node.id === input.fromNodeId)
  if (!fromNode) {
    return { run: input.run, advanced: false }
  }

  const outgoingEdge = input.run.edges.find((edge) =>
    edge.source === fromNode.id && (edge.kind === 'normal' || edge.kind === 'gate')
  )
  const nextNode = outgoingEdge
    ? input.run.nodes.find((node) => node.id === outgoingEdge.target)
    : undefined

  const updatedNodes = input.run.nodes.map((node) => {
    if (node.id === fromNode.id) {
      return { ...node, status: input.fromStatus }
    }
    if (nextNode && node.id === nextNode.id && node.status === 'pending') {
      return { ...node, status: 'running' as const }
    }
    return node
  })

  const run: WorkflowRun = {
    ...input.run,
    currentNodeId: nextNode?.id ?? input.run.currentNodeId,
    status: nextNode ? (input.nextStatusOverride ?? runStatusForNode(nextNode)) : (input.terminalStatus ?? input.run.status),
    nodes: updatedNodes,
    updatedAt: input.now,
  }

  return {
    run,
    advanced: Boolean(nextNode),
    ...(nextNode ? { nextNode: { ...nextNode, status: 'running' } } : {}),
  }
}

function buildAgentStageArtifact(input: {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
  now: string
}): Artifact {
  if (input.node.stage === 'clarify') {
    const rawRequest = input.artifacts.find((artifact) => artifact.kind === 'raw_request')
    const request = rawRequest?.content || input.run.request
    return {
      id: `artifact-${input.run.id}-clarification`,
      runId: input.run.id,
      nodeId: input.node.id,
      kind: 'clarification',
      title: '需求澄清结果',
      summary: `Clarified scope for ${input.run.title}`,
      content: [
        `# 需求澄清结果: ${input.run.title}`,
        '',
        '## Raw Request',
        request,
        '',
        '## Goals',
        `- Deliver the requested change for ${input.run.title}.`,
        '- Keep the implementation auditable through DevFlow artifacts and events.',
        '',
        '## Acceptance Criteria',
        '- The requested behavior is represented by design, implementation, test, PR, and acceptance evidence.',
        '- Any Gate blockers are resolved through Agent Review, policy sync, or lead override as applicable.',
        '',
        '## Non-goals',
        '- Do not bypass Gate Enforcement or team policy.',
        '- Do not change unrelated project behavior.',
        '',
        '## Open Questions',
        '- 如果需求仍有歧义，在方案评审 Gate 前确认边界场景。',
      ].join('\n'),
      redacted: false,
      updatedAt: input.now,
    }
  }

  const clarification = input.artifacts.find((artifact) => artifact.kind === 'clarification')
  return {
    id: `artifact-${input.run.id}-design`,
    runId: input.run.id,
    nodeId: input.node.id,
    kind: 'design',
    title: '方案设计',
    summary: `Implementation and test strategy for ${input.run.title}`,
    content: [
      `# 方案设计: ${input.run.title}`,
      '',
      '## Inputs',
      `Request: ${input.run.request}`,
      `Clarification: ${clarification?.summary ?? 'No clarification artifact linked.'}`,
      '',
      '## Implementation Approach',
      '- Make the smallest scoped change that satisfies the request.',
      '- Preserve existing DevFlow safety boundaries, including Gate Enforcement and redacted evidence.',
      '',
      '## Testing Strategy',
      '- Add or update focused unit tests for deterministic behavior.',
      '- Run the configured project test command and archive Test Evidence.',
      '',
      '## Delivery Checklist',
      '- Coding diff captured.',
      '- Test evidence archived.',
      '- PR draft generated from diff, policy, review, and budget evidence.',
    ].join('\n'),
    redacted: true,
    updatedAt: input.now,
  }
}

function linkArtifactToNodes(run: WorkflowRun, artifactId: string, nodeIds: string[]): WorkflowRun {
  const targetNodeIds = new Set(nodeIds)
  return {
    ...run,
    nodes: run.nodes.map((node) =>
      targetNodeIds.has(node.id) && !node.artifactIds.includes(artifactId)
        ? { ...node, artifactIds: [...node.artifactIds, artifactId] }
        : node,
    ),
  }
}

function upsertArtifact(artifacts: Artifact[], artifact: Artifact): Artifact[] {
  return artifacts.some((candidate) => candidate.id === artifact.id)
    ? artifacts.map((candidate) => candidate.id === artifact.id ? artifact : candidate)
    : [...artifacts, artifact]
}

function nextEventSequence(events: AgentEvent[], runId: string): number {
  return events.filter((event) => event.runId === runId).length + 1
}

export function createPrDraftArtifact(input: CreatePrDraftArtifactInput): Artifact {
  const prNode = input.run.nodes.find((node) => node.stage === 'pr' && node.kind === 'pr')
  const rawRequest = input.artifacts.find((artifact) => artifact.kind === 'raw_request')
  const design = input.artifacts.find((artifact) => artifact.kind === 'design')
  const changedPaths = unique(input.codingDiffs.flatMap((diff) => diff.changedPaths))
  const latestTest = latestByTimestamp(input.testEvidence, (evidence) => evidence.createdAt)
  const compareUrl = safeCompareUrl(input.project.repository, input.project.defaultBranch, input.run.branchName)
  const reviewSummary = input.agentReviewSummaries?.join(' | ') || 'No Agent Review summary provided.'

  const content = [
    `# ${input.run.title}`,
    '',
    `Request: ${rawRequest?.summary ?? input.run.request}`,
    `Design: ${design?.summary ?? 'No design artifact linked.'}`,
    `Compare: ${compareUrl ?? 'unavailable'}`,
    ...(compareUrl ? [] : ['Repository mapping could not be converted into a safe compare URL.']),
    '',
    '## Changed Paths',
    ...(changedPaths.length ? changedPaths.map((path) => `- ${path}`) : ['- No changed paths captured.']),
    '',
    '## Evidence',
    `Test Evidence: ${latestTest ? `${latestTest.status} - ${latestTest.summary}` : 'missing'}`,
    `Policy: ${input.enforcement?.status ?? 'not_evaluated'}`,
    `Budget: ${input.budgetDecision ? `${input.budgetDecision.status} - projected $${input.budgetDecision.projectedCostUsd.toFixed(6)}` : 'not_evaluated'}`,
    `Agent Review: ${reviewSummary}`,
    '',
    '## Checklist',
    '- [ ] Diff reviewed',
    '- [ ] Tests reviewed',
    '- [ ] Policy evidence reviewed',
    '- [ ] Budget/cost reviewed',
  ].join('\n')

  return {
    id: `artifact-${input.run.id}-pr-draft`,
    runId: input.run.id,
    nodeId: prNode?.id ?? input.run.currentNodeId,
    kind: 'pr',
    title: `PR Draft: ${input.run.title}`,
    summary: `PR draft for ${input.run.title}`,
    content,
    redacted: true,
    updatedAt: input.now,
  }
}

export function createAcceptanceEvidenceBundleArtifact(input: CreateAcceptanceEvidenceBundleArtifactInput): Artifact {
  const acceptanceNode = input.run.nodes.find((node) => node.stage === 'accept' && node.kind === 'acceptance')
  const rawRequest = input.artifacts.find((artifact) => artifact.kind === 'raw_request')
  const design = input.artifacts.find((artifact) => artifact.kind === 'design')
  const prDraft = latestByTimestamp(
    input.artifacts.filter((artifact) => artifact.kind === 'pr'),
    (artifact) => artifact.updatedAt,
  )
  const changedPaths = unique(input.codingDiffs.flatMap((diff) => diff.changedPaths))
  const latestTest = latestByTimestamp(input.testEvidence, (evidence) => evidence.createdAt)
  const reviewSummary = input.agentReviewSummaries?.join(' | ') || 'No Agent Review summary provided.'

  const content = [
    `# Acceptance Evidence Bundle: ${input.run.title}`,
    '',
    `Raw Request: ${rawRequest?.content ?? input.run.request}`,
    `Design: ${design?.summary ?? 'No design artifact linked.'}`,
    `PR Draft: ${prDraft?.id ?? 'missing'}`,
    `Changed Paths: ${changedPaths.length ? changedPaths.join(', ') : 'none'}`,
    `Tests: ${latestTest ? `${latestTest.status} - ${latestTest.summary}` : 'missing'}`,
    `Policy: ${input.enforcement?.status ?? 'not_evaluated'}`,
    `Budget: ${input.budgetDecision?.status ?? 'not_evaluated'}`,
    `Agent Review: ${reviewSummary}`,
  ].join('\n')

  return {
    id: `artifact-${input.run.id}-acceptance-bundle`,
    runId: input.run.id,
    nodeId: acceptanceNode?.id ?? input.run.currentNodeId,
    kind: 'acceptance',
    title: `Acceptance Bundle: ${input.run.title}`,
    summary: `Acceptance evidence bundle for ${input.run.title}`,
    content,
    redacted: true,
    updatedAt: input.now,
  }
}

function runStatusForNode(node: WorkflowNode): RunStatus {
  if (node.stage === 'clarify') return 'clarifying'
  if (node.stage === 'design') return 'designing'
  if (node.stage === 'build') return 'building'
  if (node.stage === 'test') return 'testing'
  return 'paused_at_gate'
}

function runStatusAfterTerminalApproval(node: WorkflowNode): RunStatus {
  if (node.kind === 'acceptance') {
    return 'completed'
  }
  return 'paused_at_gate'
}

function safeCompareUrl(repository: string, defaultBranch: string, branchName: string): string | null {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return null
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(defaultBranch) || !/^[A-Za-z0-9._/-]+$/.test(branchName)) {
    return null
  }
  return `https://github.com/${repository}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function latestByTimestamp<T>(items: T[], getTimestamp: (item: T) => string): T | undefined {
  return [...items].sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)))[0]
}
