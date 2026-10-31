import {
  buildDesignRevisionIdentity,
  resolveSavedProposals,
  sameDesignRevision,
  SavedProposalSelectionError,
} from './artifact-identity'
import type { AgentEvent, Artifact, DesignRevisionIdentity, WorkflowNode, WorkflowRun } from './domain'
import { redactSensitiveText } from './redaction'

/**
 * Design material identity for the design-review Gate (plan S4, Z1). Designs have no revision
 * number and none is invented: a version is the material id, its recorded time and a digest of
 * what the reviewer reads (title, summary and body). Renderer and main process share this code.
 */

export {
  buildDesignRevisionIdentity,
  createDesignRevisionDigest,
  isSavedDesignProposal,
  sameDesignRevision,
} from './artifact-identity'

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

export type DesignRevisionRequest = {
  expectedRunVersion: number
  previous: DesignRevisionIdentity
  proposals: DesignRevisionIdentity[]
  /** The user's revision list (UX batch 1). With it, proposals may be empty. */
  changeRequest?: string
}

export const MAX_REVISION_CHANGE_CHARACTERS = 4000
const MAX_REVISION_PROPOSALS = 20

/** Used both before a model call and before committing it. Never reopens a completed step. */
export async function resolveDesignRevisionInput(input: {
  run: WorkflowRun; gateNodeId: string; artifacts: readonly Artifact[]; request: DesignRevisionRequest
}): Promise<{ node: WorkflowNode; gate: WorkflowNode; previous: Artifact; proposals: Artifact[]; changeRequest?: string }> {
  const { run, artifacts, request } = input
  const gate = run.nodes.find((node) => node.id === input.gateNodeId)
  if (run.version !== request.expectedRunVersion || run.status !== 'paused_at_gate' ||
    run.currentNodeId !== gate?.id || gate.kind !== 'gate' || gate.stage !== 'design' || gate.status !== 'running') {
    throw new Error('任务进度已变化；只能在当前待评审的方案 Gate 生成新版，请刷新后重试。')
  }
  const material = resolveDesignGateMaterial({ run, gateNode: gate, artifacts })
  if (material.state !== 'ready') throw new Error(material.message)
  const previous = material.artifact
  if (!sameDesignRevision(await buildDesignRevisionIdentity(previous), request.previous)) {
    throw new Error('原方案已变化，请重新核对后生成新版。')
  }
  const node = run.nodes.find((item) => item.id === previous.nodeId)
  if (!node || node.kind !== 'agent' || node.stage !== 'design' || node.status !== 'success' || !previous.content.trim()) {
    throw new Error('缺少已完成设计步骤的正式方案，不能生成修订版。')
  }
  let changeRequest: string | undefined
  if (request.changeRequest !== undefined) {
    changeRequest = redactSensitiveText(request.changeRequest.trim()).value
    if (!changeRequest || changeRequest.length > MAX_REVISION_CHANGE_CHARACTERS) {
      throw new Error('修订清单为空或超过 4000 字，请精简后重试。')
    }
  }
  if (!changeRequest && !request.proposals.length) {
    throw new Error('请至少提供一项修订内容或一份已保存提案。')
  }
  if (!changeRequest && (request.proposals.length > MAX_REVISION_PROPOSALS ||
    new Set(request.proposals.map((item) => item.artifactId)).size !== request.proposals.length)) {
    throw new Error('请选择 1 至 20 份不同的已保存方案提案。')
  }
  let proposals: Artifact[]
  try {
    proposals = await resolveSavedProposals({ run, artifacts, identities: request.proposals,
      allowedNodeIds: [node.id, gate.id], max: MAX_REVISION_PROPOSALS })
  } catch (error) {
    if (error instanceof SavedProposalSelectionError) throw new Error('所选提案已变化或不属于当前方案设计步骤，请重新选择。')
    throw error
  }
  return { node, gate, previous, proposals, ...(changeRequest === undefined ? {} : { changeRequest }) }
}

/** Replace only the Gate's review subject. Keep all prior versions and pending downstream steps. */
export async function applyDesignRevision(input: {
  run: WorkflowRun; gateNodeId: string; artifacts: readonly Artifact[]; request: DesignRevisionRequest; artifact: Artifact
}): Promise<WorkflowRun> {
  const resolved = await resolveDesignRevisionInput(input)
  const { artifact, request } = input
  const lineage = artifact.designRevision
  if (artifact.kind !== 'design' || artifact.runId !== input.run.id || artifact.nodeId !== resolved.node.id ||
    !artifact.content.trim() || input.artifacts.some((item) => item.id === artifact.id) ||
    !lineage || lineage.version !== 1 || !sameDesignRevision(lineage.previous, request.previous) ||
    lineage.proposals.length !== request.proposals.length ||
    lineage.proposals.some((item, index) => !sameDesignRevision(item, request.proposals[index]!)) ||
    lineage.changeRequest !== resolved.changeRequest) {
    throw new Error('新版方案与本次修订输入不一致，原方案保持不变。')
  }
  const outdatedReviews = new Set(input.artifacts.filter((item) => item.kind === 'agent_review').map((item) => item.id))
  return { ...input.run, version: input.run.version + 1, updatedAt: artifact.updatedAt,
    nodes: input.run.nodes.map((node) => node.id === resolved.gate.id
      ? { ...node, artifactIds: [...node.artifactIds.filter((id) => id !== resolved.previous.id && !outdatedReviews.has(id)), artifact.id] }
      : node.id === resolved.node.id ? { ...node, artifactIds: [...node.artifactIds, artifact.id] } : node) }
}

/** The approval events that confirmed a design, newest first (plan Z5: completed stages read the approved one). */
export function listDesignApprovals(events: readonly AgentEvent[], runId: string): AgentEvent[] {
  return events
    .filter((event) => event.runId === runId && event.kind === 'approval' && event.designAudit?.action === 'approved')
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.sequence - left.sequence)
}
