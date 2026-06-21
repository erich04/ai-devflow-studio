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
  const clarificationArtifactId = `artifact-${input.runId}-clarification-placeholder`
  const designArtifactId = `artifact-${input.runId}-design-placeholder`
  const diffArtifactId = `artifact-${input.runId}-diff-placeholder`
  const testArtifactId = `artifact-${input.runId}-test-placeholder`
  const prArtifactId = `artifact-${input.runId}-pr-placeholder`
  const acceptanceArtifactId = `artifact-${input.runId}-acceptance-placeholder`

  const nodes: WorkflowNode[] = [
    {
      id: nodeIds.clarify,
      stage: 'clarify',
      title: 'Clarify request',
      subtitle: 'Capture acceptance criteria and non-goals',
      kind: 'agent',
      status: 'running',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [rawRequestArtifactId, clarificationArtifactId],
    },
    {
      id: nodeIds.clarifyGate,
      stage: 'clarify',
      title: 'Clarification Gate',
      subtitle: 'Confirm the request is ready for design',
      kind: 'gate',
      status: 'pending',
      ownerId: input.creatorId,
      requiredRole: 'member',
      retryCount: 0,
      artifactIds: [clarificationArtifactId],
    },
    {
      id: nodeIds.design,
      stage: 'design',
      title: 'Design solution',
      subtitle: 'Define implementation and test strategy',
      kind: 'agent',
      status: 'pending',
      ownerId: input.creatorId,
      retryCount: 0,
      artifactIds: [designArtifactId],
    },
    {
      id: nodeIds.designGate,
      stage: 'design',
      title: 'Design Gate',
      subtitle: 'Approve architecture before implementation',
      kind: 'gate',
      status: 'pending',
      ownerId: input.creatorId,
      requiredRole: 'lead',
      retryCount: 0,
      artifactIds: [designArtifactId],
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
      artifactIds: [diffArtifactId],
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
      artifactIds: [testArtifactId],
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
      artifactIds: [prArtifactId],
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
      artifactIds: [acceptanceArtifactId],
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
    {
      id: clarificationArtifactId,
      runId: input.runId,
      nodeId: nodeIds.clarify,
      kind: 'clarification',
      title: 'Clarification placeholder',
      summary: 'Pending clarification output.',
      content: 'Pending clarification output.',
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

  const outgoingEdge = input.run.edges.find((edge) =>
    edge.source === approvedNode.id && (edge.kind === 'normal' || edge.kind === 'gate')
  )
  const nextNode = outgoingEdge
    ? input.run.nodes.find((node) => node.id === outgoingEdge.target)
    : undefined

  const updatedNodes = input.run.nodes.map((node) => {
    if (node.id === approvedNode.id) {
      return nextStatusAfterApproval(node)
    }
    if (nextNode && node.id === nextNode.id && node.status === 'pending') {
      return { ...node, status: 'running' as const }
    }
    return node
  })

  const run: WorkflowRun = {
    ...input.run,
    currentNodeId: nextNode?.id ?? input.run.currentNodeId,
    status: nextNode ? runStatusForNode(nextNode) : runStatusAfterTerminalApproval(approvedNode),
    nodes: updatedNodes,
    updatedAt: input.now,
  }

  return {
    run,
    advanced: Boolean(nextNode),
    ...(nextNode ? { nextNode: { ...nextNode, status: 'running' } } : {}),
  }
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
