import { sha256Text } from './digest'
import type { Artifact, DesignRevisionIdentity, WorkflowRun } from './domain'

/**
 * Exact material identity shared by the design-review Gate and revision requests (plan S4, Z1).
 * A version is the material id, its recorded time and a digest of what the reader sees
 * (title, summary and body). Renderer and main process share this code.
 */

export async function createDesignRevisionDigest(artifact: Pick<Artifact, 'title' | 'summary' | 'content'>): Promise<string> {
  return sha256Text(JSON.stringify({ title: artifact.title, summary: artifact.summary, content: artifact.content }))
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

/** A proposal saved from a 答疑 conversation (ADR 0022). */
export function isSavedDiscussionProposal(artifact: Pick<Artifact, 'id' | 'kind'>): boolean {
  return artifact.kind === 'log' && artifact.id.startsWith('conversation-proposal-')
}

export const isSavedDesignProposal = isSavedDiscussionProposal

export class SavedProposalSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SavedProposalSelectionError'
  }
}

/**
 * Resolve the exact saved proposals a revision names. Returns them in the order of `identities`
 * and rejects any selection that is too large, repeated, missing, foreign or changed.
 */
export async function resolveSavedProposals(input: {
  run: WorkflowRun
  artifacts: readonly Artifact[]
  identities: readonly DesignRevisionIdentity[]
  allowedNodeIds: readonly string[]
  max: number
}): Promise<Artifact[]> {
  if (input.identities.length > input.max) {
    throw new SavedProposalSelectionError(`最多只能选择 ${input.max} 份已保存提案。`)
  }
  if (new Set(input.identities.map((identity) => identity.artifactId)).size !== input.identities.length) {
    throw new SavedProposalSelectionError('同一份提案不能重复选择。')
  }
  const allowedNodeIds = new Set(input.allowedNodeIds)
  const proposals: Artifact[] = []
  for (const identity of input.identities) {
    const proposal = input.artifacts.find((artifact) => artifact.id === identity.artifactId)
    if (!proposal) throw new SavedProposalSelectionError('所选提案已不存在，请刷新后重新选择。')
    if (proposal.runId !== input.run.id) throw new SavedProposalSelectionError('所选提案不属于当前任务。')
    if (!allowedNodeIds.has(proposal.nodeId)) throw new SavedProposalSelectionError('所选提案不属于当前步骤。')
    if (!isSavedDiscussionProposal(proposal)) throw new SavedProposalSelectionError('所选材料不是已保存的答疑提案。')
    if (!proposal.content.trim()) throw new SavedProposalSelectionError('所选提案内容为空。')
    if (!sameDesignRevision(await buildDesignRevisionIdentity(proposal), identity)) {
      throw new SavedProposalSelectionError('所选提案已变化，请刷新后重新选择。')
    }
    proposals.push(proposal)
  }
  return proposals
}
