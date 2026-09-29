import {
  approveClarificationRevision,
  buildClarificationReviewBundle,
  buildDesignRevisionIdentity,
  resolveDesignGateMaterial,
  type Artifact,
  type ClarificationAuditRecord,
  type DesignAuditRecord,
  type GateReviewSubjectSnapshot,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

/**
 * Requirement and design Gates approve one specific material version, so a remote approval of
 * either must carry the server-bound review subject (plan S5, Q8). Other Gates keep their rules.
 */
export function requiresApprovalMaterialSnapshot(node: Pick<WorkflowNode, 'kind' | 'stage'>): boolean {
  return node.kind === 'gate' && (node.stage === 'clarify' || node.stage === 'design')
}

export type RemoteApprovalMaterial =
  | { status: 'not_required' }
  | { status: 'blocked' }
  | { status: 'clarification'; artifact: Artifact; audit: ClarificationAuditRecord }
  | { status: 'design'; audit: DesignAuditRecord }

function subjectNames(subject: GateReviewSubjectSnapshot, artifact: Artifact): boolean {
  return subject.artifacts.some((entry) =>
    entry.id === artifact.id && entry.kind === artifact.kind && entry.updatedAt === artifact.updatedAt,
  )
}

/**
 * Resolves what a remote approval confirms, from the locally persisted material and the subject
 * the Web approver saw. The subject must name the same local approval object the desktop would
 * approve (the review-requested clarification revision, or the Gate's single design); otherwise
 * the approval is blocked. The same derivation runs again when the approval is committed.
 */
export async function resolveRemoteApprovalMaterial(input: {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: readonly Artifact[]
  subject: GateReviewSubjectSnapshot | undefined
  actorId: string
  now: string
  sequence: number
}): Promise<RemoteApprovalMaterial> {
  if (!requiresApprovalMaterialSnapshot(input.node)) return { status: 'not_required' }
  const subject = input.subject
  if (!subject || subject.runId !== input.run.id || subject.nodeId !== input.node.id || subject.runVersion !== input.run.version) {
    return { status: 'blocked' }
  }
  if (input.node.stage === 'clarify') {
    const bundle = buildClarificationReviewBundle({ run: input.run, gateNode: input.node, artifacts: input.artifacts })
    const active = bundle.activeRevision
    if (bundle.state !== 'ready' || !active || active.clarificationRevision?.status !== 'review_requested' || !subjectNames(subject, active)) {
      return { status: 'blocked' }
    }
    const approved = approveClarificationRevision({
      artifact: active,
      actorId: input.actorId,
      now: input.now,
      sequence: input.sequence,
      gateNodeId: input.node.id,
    })
    return { status: 'clarification', artifact: approved.artifact, audit: approved.event.clarificationAudit! }
  }
  const material = resolveDesignGateMaterial({ run: input.run, gateNode: input.node, artifacts: input.artifacts })
  if (material.state !== 'ready' || !subjectNames(subject, material.artifact)) return { status: 'blocked' }
  const identity = await buildDesignRevisionIdentity(material.artifact)
  return { status: 'design', audit: { version: 1, action: 'approved', ...identity, actorId: input.actorId } }
}
