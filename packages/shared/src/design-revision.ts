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

export type DesignRevisionRequest = {
  expectedRunVersion: number
  previous: DesignRevisionIdentity
  proposals: DesignRevisionIdentity[]
}

export function isSavedDesignProposal(artifact: Artifact): boolean {
  return artifact.kind === 'log' && artifact.id.startsWith('conversation-proposal-')
}

/** Used both before a model call and before committing it. Never reopens a completed step. */
export async function resolveDesignRevisionInput(input: {
  run: WorkflowRun; gateNodeId: string; artifacts: readonly Artifact[]; request: DesignRevisionRequest
}): Promise<{ node: WorkflowNode; gate: WorkflowNode; previous: Artifact; proposals: Artifact[] }> {
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
  if (!request.proposals.length || request.proposals.length > 20 ||
    new Set(request.proposals.map((item) => item.artifactId)).size !== request.proposals.length) {
    throw new Error('请选择 1 至 20 份不同的已保存方案提案。')
  }
  const proposals: Artifact[] = []
  for (const identity of request.proposals) {
    const proposal = artifacts.find((item) => item.id === identity.artifactId)
    if (!proposal || proposal.runId !== run.id || proposal.nodeId !== node.id ||
      !isSavedDesignProposal(proposal) || !proposal.content.trim() ||
      !sameDesignRevision(await buildDesignRevisionIdentity(proposal), identity)) {
      throw new Error('所选提案已变化或不属于当前方案设计步骤，请重新选择。')
    }
    proposals.push(proposal)
  }
  return { node, gate, previous, proposals }
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
    lineage.proposals.some((item, index) => !sameDesignRevision(item, request.proposals[index]!))) {
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
