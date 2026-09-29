import {
  buildDesignRevisionIdentity,
  resolveDesignGateMaterial,
  sameDesignRevision,
  type AgentEvent,
  type Artifact,
  type DesignRevisionIdentity,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

export const staleDesignRevisionMessage =
  'Gate approval rejected: design material is missing, changed, or no longer current'

export const unexpectedDesignRevisionMessage =
  'Gate approval rejected: a design revision was sent for a Gate that does not review a design'

/** Only the design-review Gate carries a design version (plan S4, Z2). */
export function isDesignReviewGate(node: WorkflowNode): boolean {
  return node.kind === 'gate' && node.stage === 'design'
}

/**
 * The trusted approval check for the design-review Gate: the approver must name the exact
 * design (artifact, recorded time and content digest) that the Gate still links to. Returns
 * that design or throws before anything is written (plan S4, Z2).
 */
export async function requireCurrentDesignRevision(input: {
  run: WorkflowRun
  gateNode: WorkflowNode
  artifacts: readonly Artifact[]
  expected: DesignRevisionIdentity | undefined
}): Promise<{ artifact: Artifact; identity: DesignRevisionIdentity }> {
  const material = resolveDesignGateMaterial({ run: input.run, gateNode: input.gateNode, artifacts: input.artifacts })
  if (material.state !== 'ready' || !input.expected) throw new Error(staleDesignRevisionMessage)
  const identity = await buildDesignRevisionIdentity(material.artifact)
  if (!sameDesignRevision(identity, input.expected)) throw new Error(staleDesignRevisionMessage)
  return { artifact: material.artifact, identity }
}

/** The approval event records which design version was confirmed (plan S4, Z2). */
export function designApprovalEvent(input: {
  base: AgentEvent
  identity: DesignRevisionIdentity
  actorId: string
}): AgentEvent {
  return {
    ...input.base,
    designAudit: { version: 1, action: 'approved', ...input.identity, actorId: input.actorId },
  }
}
