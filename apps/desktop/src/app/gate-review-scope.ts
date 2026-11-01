import {
  agentReviewCoversCurrentSubjects,
  type AgentReviewResult,
  type Artifact,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

/** What the latest saved review on a step covered, and whether that is still the current version (#251). */
export type GateReviewScope = {
  appliesToCurrent: boolean
  /** “需求 v1”, “方案（记录于 …）”; undefined when the review recorded no subject of that kind. */
  reviewedLabel: string | undefined
}

/**
 * Names the version a saved review covered from its subject manifest. The main process stays the
 * authority on freshness; this only keeps an older version's result from reading as the current one.
 */
export function describeGateReviewScope(input: {
  review: AgentReviewResult
  run: WorkflowRun | undefined
  node: WorkflowNode
  artifacts: Artifact[]
  formatTime: (iso: string) => string
}): GateReviewScope {
  const appliesToCurrent = input.run
    ? agentReviewCoversCurrentSubjects({ review: input.review, run: input.run, node: input.node, artifacts: input.artifacts })
    : true
  return { appliesToCurrent, reviewedLabel: reviewedLabel(input) }
}

function reviewedLabel(input: {
  review: AgentReviewResult
  node: WorkflowNode
  artifacts: Artifact[]
  formatTime: (iso: string) => string
}): string | undefined {
  const subjects = input.review.contextManifest?.subjectArtifacts ?? []
  if (input.node.stage === 'clarify') {
    const subject = subjects.find((artifact) => artifact.kind === 'clarification')
    if (!subject) return undefined
    const revision = input.artifacts.find((artifact) => artifact.id === subject.id)?.clarificationRevision?.revision
    return revision ? `需求 v${revision}` : `需求（记录于 ${input.formatTime(subject.updatedAt)}）`
  }
  if (input.node.stage === 'design') {
    const subject = subjects.find((artifact) => artifact.kind === 'design')
    return subject ? `方案（记录于 ${input.formatTime(subject.updatedAt)}）` : undefined
  }
  return undefined
}
