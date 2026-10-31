/**
 * Binds a review to the exact text it read (design §5.2, FR-3.5). The bound check is today's
 * `ArtifactReviewReader` check; a citation is verified only when it is exact, unique and inside
 * one reading block.
 */
import type { AgentReviewResult, Artifact } from '@ai-devflow/shared'
import { blockKey, gateReadingBlocks, indexReadingBlocks, type BlockIndex, type BlockKey, type Range } from './material'
/** State of an asynchronous digest (`useContentDigest` / `useDesignIdentity`). */
export type DigestState = { state: 'pending' | 'done' | 'failed'; value?: string | undefined; error?: string | undefined }
export type Level = 'important' | 'suggestion'
export type VerifiedCitation = Range & { quote: string; block: BlockKey }
export type GateFinding = {
  /** "意见 N": the finding's position in the review, 1-based. */
  number: number
  index: number
  text: string
  level?: Level
  citations: VerifiedCitation[]
  /** Block holding the first verified citation in reading order. */
  anchor?: BlockKey
}
export type ReviewBindingState = 'none' | 'checking' | 'unverifiable' | 'bound' | 'unbound' | 'legacy'
export type ReviewBinding = {
  state: ReviewBindingState
  review?: AgentReviewResult
  findings: GateFinding[]
  levelsKnown: boolean
}
/** True iff the review has at least one finding and every one has a valid importance. */
export function levelsKnown(review: AgentReviewResult | undefined): boolean {
  if (!review || review.missingEvidence.length === 0) return false
  return review.missingEvidence.every((_, index) => {
    const matches = (review.missingEvidenceDetails ?? []).filter((detail) => detail.index === index)
    return matches.length === 1 && (matches[0]!.importance === 'important' || matches[0]!.importance === 'suggestion')
  })
}
function boundTo(review: AgentReviewResult, artifact: Artifact, digest: string): boolean {
  return review.runId === artifact.runId && Boolean(review.contextManifest?.subjectArtifacts.some((subject) =>
    subject.id === artifact.id && subject.runId === artifact.runId && subject.nodeId === artifact.nodeId &&
    subject.kind === artifact.kind && subject.updatedAt === artifact.updatedAt && subject.contentDigest === digest))
}
export function bindReview(input: {
  review: AgentReviewResult | null | undefined
  artifact: Artifact
  contentDigest: DigestState
  blocks?: BlockIndex
}): ReviewBinding {
  const { review, artifact } = input
  if (!review) return { state: 'none', findings: [], levelsKnown: false }
  const known = levelsKnown(review)
  const detailOf = (index: number) => {
    const matches = (review.missingEvidenceDetails ?? []).filter((detail) => detail.index === index)
    return matches.length === 1 ? matches[0] : undefined
  }
  const plain = (citations: (index: number) => VerifiedCitation[]): GateFinding[] => review.missingEvidence.map((text, index) => {
    const verified = citations(index)
    const first = [...verified].sort((a, b) => a.start - b.start)[0]
    const level = known ? detailOf(index)?.importance : undefined
    return { number: index + 1, index, text, citations: verified, ...(level ? { level } : {}), ...(first ? { anchor: first.block } : {}) }
  })
  const none = () => [] as VerifiedCitation[]
  if (!review.contextManifest) return { state: 'legacy', review, findings: plain(none), levelsKnown: known }
  if (input.contentDigest.state === 'pending') return { state: 'checking', review, findings: plain(none), levelsKnown: known }
  if (input.contentDigest.state === 'failed' || !input.contentDigest.value) return { state: 'unverifiable', review, findings: plain(none), levelsKnown: known }
  const digest = input.contentDigest.value
  if (!boundTo(review, artifact, digest)) return { state: 'unbound', review, findings: plain(none), levelsKnown: known }
  const blocks = input.blocks ?? indexReadingBlocks(gateReadingBlocks(artifact.content))
  const content = artifact.content
  const verify = (index: number): VerifiedCitation[] => {
    if (index < 0 || index >= review.missingEvidence.length) return []
    const detail = detailOf(index)
    return (detail?.citations ?? []).flatMap((citation) => {
      const { start, end, quote } = citation
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > content.length) return []
      if (citation.sourceId !== artifact.id || citation.contentDigest !== digest) return []
      if (citation.updatedAt && citation.updatedAt !== artifact.updatedAt) return []
      if (content.slice(start, end) !== quote || content.indexOf(quote) !== start || content.indexOf(quote, start + 1) !== -1) return []
      const block = blocks.blockAt(start)
      if (!block || end > block.end) return []
      return [{ start, end, quote, block: blockKey(block) }]
    })
  }
  return { state: 'bound', review, findings: plain(verify), levelsKnown: known }
}
/** One fact for the projection (§3.24): no conclusion before the binding and the design identity exist. */
export function reviewCheckOf(input: { binding: ReviewBinding; designIdentity?: DigestState }): 'pending' | 'failed' | 'done' {
  if (input.binding.state === 'unverifiable' || input.designIdentity?.state === 'failed') return 'failed'
  if (input.binding.state === 'checking' || input.designIdentity?.state === 'pending') return 'pending'
  return 'done'
}
