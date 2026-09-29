import { sha256Text } from './clarification'
import type { AgentEvent, Artifact, DesignRevisionIdentity, WorkflowNode, WorkflowRun } from './domain'

/**
 * Design material identity for the design-review Gate (plan S4, Z1). Designs have no revision
 * number and none is invented: a version is the material id, its recorded time and a digest of
 * what the reviewer reads (title, summary and body). Renderer and main process share this code.
 */

export async function createDesignRevisionDigest(artifact: Pick<Artifact, 'title' | 'summary' | 'content'>): Promise<string> {
  return sha256Text(JSON.stringify({ title: artifact.title, summary: artifact.summary, content: artifact.content }))
}

export type DesignGateMaterial =
  | { state: 'ready'; artifact: Artifact; message: string }
  | { state: 'missing_design' | 'ambiguous_design' | 'wrong_source'; message: string }

/**
 * The design a design-review Gate asks to approve: exactly one design artifact linked to the
 * Gate and produced by a node that leads into it. Never picked by array order or latest time.
 */
export function resolveDesignGateMaterial(input: {
  run: WorkflowRun
  gateNode: WorkflowNode
  artifacts: readonly Artifact[]
}): DesignGateMaterial {
  const linked = new Set(input.gateNode.artifactIds)
  const designs = input.artifacts.filter((artifact) =>
    artifact.runId === input.run.id && artifact.kind === 'design' && linked.has(artifact.id),
  )
  if (designs.length === 0) {
    return { state: 'missing_design', message: '方案评审 Gate 尚未关联方案产物，不能确认。' }
  }
  if (designs.length > 1) {
    return { state: 'ambiguous_design', message: '方案评审 Gate 关联了多份方案产物，无法确定审批对象，已阻断确认。' }
  }
  const artifact = designs[0]!
  const inbound = new Set(input.run.edges.filter((edge) => edge.target === input.gateNode.id).map((edge) => edge.source))
  if (!inbound.has(artifact.nodeId) && artifact.nodeId !== input.gateNode.id) {
    return { state: 'wrong_source', message: '方案产物不属于这个 Gate 的上游步骤，已阻断确认。' }
  }
  return { state: 'ready', artifact, message: '方案评审 Gate 关联了一份待评审的方案。' }
}

export async function buildDesignRevisionIdentity(artifact: Artifact): Promise<DesignRevisionIdentity> {
  return {
    artifactId: artifact.id,
    updatedAt: artifact.updatedAt,
    contentDigest: await createDesignRevisionDigest(artifact),
  }
}

export function sameDesignRevision(left: DesignRevisionIdentity, right: DesignRevisionIdentity): boolean {
  return left.artifactId === right.artifactId && left.updatedAt === right.updatedAt && left.contentDigest === right.contentDigest
}

/** The approval events that confirmed a design, newest first (plan Z5: completed stages read the approved one). */
export function listDesignApprovals(events: readonly AgentEvent[], runId: string): AgentEvent[] {
  return events
    .filter((event) => event.runId === runId && event.kind === 'approval' && event.designAudit?.action === 'approved')
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.sequence - left.sequence)
}
