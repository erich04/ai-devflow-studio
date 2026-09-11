import type { AgentReviewResult, ArtifactKind, NodeStage, WorkflowNode, WorkflowRun } from './domain'
import { redactSensitiveText } from './redaction'
import { assertCanonicalLocalNodeId } from './remote-node-identity'

export const KNOWLEDGE_REVIEW_SANITIZER_VERSION = 'sensitive-text-v1'

/** Independently derived from Main's persisted subjects, never from a Review or Renderer payload. */
export type GateReviewSubjectSnapshot = {
  version: 1
  runId: string
  runVersion: number
  nodeId: string
  stage: NodeStage
  sanitizerVersion: string
  requestDigest: string
  artifacts: Array<{
    id: string
    nodeId: string
    kind: ArtifactKind
    updatedAt: string
    contentDigest: string
  }>
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.sort().join(',')
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value) &&
    redactSensitiveText(value).value === value
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

export function parseGateReviewSubjectSnapshot(value: unknown): GateReviewSubjectSnapshot {
  const invalid = () => { throw new Error('Invalid Gate Review subject snapshot.') }
  if (!exact(value, ['version', 'runId', 'runVersion', 'nodeId', 'stage', 'sanitizerVersion', 'requestDigest', 'artifacts']) ||
    value.version !== 1 || !identifier(value.runId) || !identifier(value.nodeId) ||
    !Number.isSafeInteger(value.runVersion) || (value.runVersion as number) < 1 ||
    !['clarify', 'design', 'build', 'test', 'pr', 'accept'].includes(value.stage as string) ||
    !identifier(value.sanitizerVersion) || !digest(value.requestDigest) ||
    !Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 100) return invalid()
  const runId = value.runId
  assertCanonicalLocalNodeId(runId, value.nodeId)
  let previousId = ''
  const artifacts = value.artifacts.map((artifact: unknown) => {
    if (!exact(artifact, ['id', 'nodeId', 'kind', 'updatedAt', 'contentDigest']) ||
      !identifier(artifact.id) || artifact.id <= previousId || !identifier(artifact.nodeId) ||
      !['raw_request', 'clarification', 'clarification_feedback', 'design', 'diff', 'test_report', 'agent_review', 'log', 'pr', 'accept'].includes(artifact.kind as string) ||
      typeof artifact.updatedAt !== 'string' || !Number.isFinite(Date.parse(artifact.updatedAt)) ||
      new Date(artifact.updatedAt).toISOString() !== artifact.updatedAt || !digest(artifact.contentDigest)) return invalid()
    assertCanonicalLocalNodeId(runId, artifact.nodeId)
    previousId = artifact.id
    return { id: artifact.id, nodeId: artifact.nodeId, kind: artifact.kind as ArtifactKind,
      updatedAt: artifact.updatedAt, contentDigest: artifact.contentDigest }
  })
  return { version: 1, runId, runVersion: value.runVersion as number, nodeId: value.nodeId,
    stage: value.stage as NodeStage, sanitizerVersion: value.sanitizerVersion,
    requestDigest: value.requestDigest, artifacts }
}

export function hasSameGateReviewSubject(left: GateReviewSubjectSnapshot, right: GateReviewSubjectSnapshot): boolean {
  return JSON.stringify(parseGateReviewSubjectSnapshot(left)) === JSON.stringify(parseGateReviewSubjectSnapshot(right))
}

export function assessProjectedAgentReviewFreshness(input: {
  review: AgentReviewResult
  run: WorkflowRun
  node: WorkflowNode
  subject: GateReviewSubjectSnapshot
}): { status: 'current' | 'stale'; reasons: string[] } {
  const stale = () => ({ status: 'stale' as const, reasons: ['Review does not match the current Desktop subject snapshot.'] })
  try {
    const subject = parseGateReviewSubjectSnapshot(input.subject)
    const recorded = input.review.contextManifest
    if (!recorded || recorded.version !== 1 || recorded.coverage === 'incomplete' ||
      subject.runId !== input.run.id || subject.runVersion !== input.run.version ||
      subject.nodeId !== input.node.id || subject.nodeId !== input.run.currentNodeId ||
      subject.stage !== input.node.stage || recorded.stage !== subject.stage ||
      input.review.runId !== subject.runId || input.review.nodeId !== subject.nodeId ||
      subject.sanitizerVersion !== KNOWLEDGE_REVIEW_SANITIZER_VERSION ||
      recorded.runRequest.sanitizerVersion !== subject.sanitizerVersion ||
      recorded.runRequest.coverage === 'incomplete' || recorded.runRequest.contentDigest !== subject.requestDigest ||
      recorded.subjectArtifacts.length !== subject.artifacts.length) return stale()
    const recordedIds = new Set(recorded.subjectArtifacts.map((artifact) => artifact.id))
    if (recordedIds.size !== subject.artifacts.length) return stale()
    for (const current of subject.artifacts) {
      const previous = recorded.subjectArtifacts.find((artifact) => artifact.id === current.id)
      if (!previous || previous.runId !== subject.runId || previous.nodeId !== current.nodeId ||
        previous.kind !== current.kind || previous.updatedAt !== current.updatedAt ||
        previous.contentDigest !== current.contentDigest || previous.coverage === 'incomplete' ||
        previous.sanitizerVersion !== subject.sanitizerVersion) return stale()
    }
    return { status: 'current', reasons: [] }
  } catch { return stale() }
}
