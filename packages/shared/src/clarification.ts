import type {
  AgentEvent,
  Artifact,
  ClarificationFeedbackMetadata,
  ClarificationRepositoryFindings,
  ClarificationRevisionMetadata,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import { redactSensitiveText } from './redaction'

const digestPattern = /^[a-f0-9]{64}$/u
const maxFeedbackCharacters = 4_000

export type ClarificationReviewBundleState =
  | 'ready'
  | 'missing_raw_request'
  | 'missing_revision'
  | 'ambiguous_revision'
  | 'stale_revision'

export type ClarificationReviewBundle = {
  state: ClarificationReviewBundleState
  rawRequest?: Artifact
  activeRevision?: Artifact
  revisions: Artifact[]
  feedback: Artifact[]
  repositoryFindings?: ClarificationRepositoryFindings
  message: string
}

export type RequestClarificationChangesInput = {
  run: WorkflowRun
  gateNodeId: string
  artifacts: Artifact[]
  existingEvents: AgentEvent[]
  actor: { id: string; name: string }
  reason: string
  expectedArtifactId: string
  expectedRevision: number
  expectedRevisionDigest: string
  now: string
}

export type RequestClarificationChangesResult = {
  run: WorkflowRun
  updatedRevision: Artifact
  feedbackArtifact: Artifact
  event: AgentEvent
  clarificationNode: WorkflowNode
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function createClarificationRevisionDigest(input: {
  title: string
  summary: string
  goals: string[]
  acceptanceCriteria: string[]
  nonGoals: string[]
  assumptions: string[]
  risks: string[]
  openQuestions: string[]
  repositoryFindings?: ClarificationRepositoryFindings
}): Promise<string> {
  return sha256Text(JSON.stringify(input))
}

export function clarificationRevisionNumber(artifact: Artifact): number {
  if (artifact.kind !== 'clarification') return 0
  return artifact.clarificationRevision?.revision ?? 1
}

export function clarificationRevisionDigest(artifact: Artifact): string | undefined {
  return artifact.kind === 'clarification'
    ? artifact.clarificationRevision?.revisionDigest
    : undefined
}

export function listClarificationRevisions(
  runId: string,
  artifacts: readonly Artifact[],
): Artifact[] {
  return artifacts
    .filter((artifact) => artifact.runId === runId && artifact.kind === 'clarification')
    .sort((left, right) =>
      clarificationRevisionNumber(left) - clarificationRevisionNumber(right) ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.id.localeCompare(right.id),
    )
}

export function buildClarificationReviewBundle(input: {
  run: WorkflowRun
  gateNode: WorkflowNode
  artifacts: readonly Artifact[]
}): ClarificationReviewBundle {
  const rawRequests = input.artifacts.filter(
    (artifact) => artifact.runId === input.run.id && artifact.kind === 'raw_request',
  )
  const revisions = listClarificationRevisions(input.run.id, input.artifacts)
  const linkedRevisionIds = new Set(input.gateNode.artifactIds)
  const linkedRevisions = revisions.filter((artifact) => linkedRevisionIds.has(artifact.id))
  const feedback = input.artifacts
    .filter((artifact) => artifact.runId === input.run.id && artifact.kind === 'clarification_feedback')
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))

  if (rawRequests.length !== 1) {
    return {
      state: 'missing_raw_request',
      revisions,
      feedback,
      message: 'Raw Request 不可用；当前 Gate 不能建立可信澄清审查上下文。',
    }
  }
  if (linkedRevisions.length === 0) {
    return {
      state: 'missing_revision',
      rawRequest: rawRequests[0]!,
      revisions,
      feedback,
      message: '当前 Gate 尚未关联有效的 Clarification Revision。',
    }
  }
  if (linkedRevisions.length !== 1) {
    return {
      state: 'ambiguous_revision',
      rawRequest: rawRequests[0]!,
      revisions,
      feedback,
      message: '当前 Gate 关联了多个 Clarification Revision，已安全阻断审批。',
    }
  }

  const activeRevision = linkedRevisions[0]!
  const metadata = activeRevision.clarificationRevision
  const latestRevision = revisions.at(-1)
  const isCurrent =
    (!metadata || metadata.status === 'review_requested' || metadata.status === 'approved') &&
    latestRevision?.id === activeRevision.id
  if (!isCurrent) {
    return {
      state: 'stale_revision',
      rawRequest: rawRequests[0]!,
      activeRevision,
      revisions,
      feedback,
      ...(metadata?.repositoryFindings
        ? { repositoryFindings: metadata.repositoryFindings }
        : {}),
      message: 'Gate 关联的澄清版本已过期或正在修订，已安全阻断审批。',
    }
  }

  return {
    state: 'ready',
    rawRequest: rawRequests[0]!,
    activeRevision,
    revisions,
    feedback,
    ...(metadata?.repositoryFindings
      ? { repositoryFindings: metadata.repositoryFindings }
      : {}),
    message: metadata?.repositoryFindings
      ? 'Raw Request、Repository Findings 与当前 Clarification Revision 已绑定。'
      : '当前版本可供审查，但尚未进行代码核验。',
  }
}

export function requireCurrentClarificationRevision(input: {
  run: WorkflowRun
  gateNode: WorkflowNode
  artifacts: readonly Artifact[]
}): Artifact {
  const bundle = buildClarificationReviewBundle(input)
  if (bundle.state !== 'ready' || !bundle.activeRevision) {
    throw new Error(bundle.message)
  }
  return bundle.activeRevision
}

export async function requestClarificationChanges(
  input: RequestClarificationChangesInput,
): Promise<RequestClarificationChangesResult> {
  const gateNode = input.run.nodes.find((node) => node.id === input.gateNodeId)
  if (
    !gateNode ||
    gateNode.kind !== 'gate' ||
    gateNode.stage !== 'clarify' ||
    input.run.currentNodeId !== gateNode.id ||
    (gateNode.status !== 'running' && gateNode.status !== 'blocked')
  ) {
    throw new Error('Request changes is only available on the current requirement Gate')
  }
  const current = requireCurrentClarificationRevision({
    run: input.run,
    gateNode,
    artifacts: input.artifacts,
  })
  const metadata = current.clarificationRevision
  if (!metadata) {
    throw new Error('Legacy clarification must be regenerated before requesting a tracked revision')
  }
  if (
    current.id !== input.expectedArtifactId ||
    metadata.revision !== input.expectedRevision ||
    metadata.revisionDigest !== input.expectedRevisionDigest ||
    !digestPattern.test(input.expectedRevisionDigest)
  ) {
    throw new Error('Clarification revision changed after the review was prepared')
  }

  const reason = redactSensitiveText(input.reason.trim()).value
  if (!reason || reason.length > maxFeedbackCharacters) {
    throw new Error('Clarification revision feedback must be between 1 and 4000 characters')
  }
  const reasonDigest = await sha256Text(reason)
  const feedbackArtifactId =
    `artifact-${input.run.id}-clarification-feedback-r${metadata.revision}-${reasonDigest.slice(0, 16)}`
  if (input.artifacts.some((artifact) => artifact.id === feedbackArtifactId)) {
    throw new Error('Clarification revision feedback was already submitted')
  }

  const feedbackMetadata: ClarificationFeedbackMetadata = {
    version: 1,
    targetArtifactId: current.id,
    targetRevision: metadata.revision,
    targetRevisionDigest: metadata.revisionDigest,
    actorId: input.actor.id,
    actorName: redactSensitiveText(input.actor.name).value,
    reasonDigest,
    createdAt: input.now,
  }
  const feedbackArtifact: Artifact = {
    id: feedbackArtifactId,
    runId: input.run.id,
    nodeId: gateNode.id,
    kind: 'clarification_feedback',
    title: `Clarification revision ${metadata.revision} feedback`,
    summary: `Changes requested for clarification revision ${metadata.revision}.`,
    content: reason,
    redacted: true,
    updatedAt: input.now,
    clarificationFeedback: feedbackMetadata,
  }
  const updatedRevision: Artifact = {
    ...current,
    clarificationRevision: {
      ...metadata,
      status: 'revision_requested',
      feedbackArtifactIds: [...metadata.feedbackArtifactIds, feedbackArtifact.id],
    },
  }
  const clarificationNode = input.run.nodes.find(
    (node) => node.kind === 'agent' && node.stage === 'clarify',
  )
  if (!clarificationNode) {
    throw new Error('Requirement clarification node is missing')
  }

  const run: WorkflowRun = {
    ...input.run,
    version: input.run.version + 1,
    status: 'clarifying',
    currentNodeId: clarificationNode.id,
    updatedAt: input.now,
    nodes: input.run.nodes.map((node) => {
      if (node.id === clarificationNode.id) {
        return { ...node, status: 'running' as const }
      }
      if (node.id === gateNode.id) {
        return { ...node, status: 'pending' as const, artifactIds: [] }
      }
      const nodeIndex = input.run.nodes.findIndex((candidate) => candidate.id === node.id)
      const gateIndex = input.run.nodes.findIndex((candidate) => candidate.id === gateNode.id)
      return nodeIndex > gateIndex ? { ...node, status: 'pending' as const } : node
    }),
  }
  const event: AgentEvent = {
    id: `event-${feedbackArtifact.id}`,
    runId: input.run.id,
    nodeId: gateNode.id,
    sequence: input.existingEvents.filter((event) => event.runId === input.run.id).length + 1,
    kind: 'approval',
    message: `${feedbackMetadata.actorName} requested changes to clarification revision ${metadata.revision}.`,
    timestamp: input.now,
    clarificationAudit: {
      version: 1,
      action: 'changes_requested',
      artifactId: current.id,
      revision: metadata.revision,
      revisionDigest: metadata.revisionDigest,
      actorId: input.actor.id,
      feedbackArtifactId: feedbackArtifact.id,
    },
  }

  return { run, updatedRevision, feedbackArtifact, event, clarificationNode: { ...clarificationNode, status: 'running' } }
}

export function approveClarificationRevision(input: {
  artifact: Artifact
  actorId: string
  now: string
  sequence: number
  gateNodeId: string
}): { artifact: Artifact; event: AgentEvent } {
  const metadata = input.artifact.clarificationRevision
  if (input.artifact.kind !== 'clarification' || !metadata || metadata.status !== 'review_requested') {
    throw new Error('Only the current review-requested clarification revision can be approved')
  }
  const artifact: Artifact = {
    ...input.artifact,
    clarificationRevision: { ...metadata, status: 'approved' },
  }
  return {
    artifact,
    event: {
      id: `event-clarification-approved-${input.artifact.id}-${input.now}`,
      runId: input.artifact.runId,
      nodeId: input.gateNodeId,
      sequence: input.sequence,
      kind: 'approval',
      message: `Clarification revision ${metadata.revision} approved.`,
      timestamp: input.now,
      clarificationAudit: {
        version: 1,
        action: 'approved',
        artifactId: input.artifact.id,
        revision: metadata.revision,
        revisionDigest: metadata.revisionDigest,
        actorId: input.actorId,
      },
    },
  }
}

export function markClarificationRevisionsSuperseded(
  artifacts: readonly Artifact[],
  activeRevisionId: string,
): Artifact[] {
  return artifacts.map((artifact) => {
    const metadata = artifact.clarificationRevision
    if (
      artifact.kind !== 'clarification' ||
      artifact.id === activeRevisionId ||
      !metadata ||
      metadata.status === 'approved' ||
      metadata.status === 'superseded'
    ) {
      return artifact
    }
    return {
      ...artifact,
      clarificationRevision: { ...metadata, status: 'superseded' as const },
    }
  })
}
