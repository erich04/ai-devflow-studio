import { useEffect, useState, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { sha256Text, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactBody, partitionArtifact } from './ArtifactBody'
import { DetailPopover } from './DetailPopover'
import { ReviewEvidenceDetails, type RecordReviewFeedback, type ReviewRevisionDrafts } from './ReviewEvidenceDetails'
import type { DiscussionMaterial } from '../app/discussion-reference'
import { formatLocalTime } from '../app/desktop-view-model'

/** Match only blocks the Markdown renderer can annotate. Cross-block quotes stay in the full report. */
function readingBlocks(content: string) {
  const blocks: Array<{ start: number; end: number }> = []
  for (const section of partitionArtifact(content).filter((item) => !['evidence', 'records'].includes(item.group))) {
    const visit = (node: ReturnType<typeof fromMarkdown>['children'][number]) => {
      if (node.type === 'paragraph' && node.position) blocks.push({ start: section.start + node.position.start.offset!, end: section.start + node.position.end.offset! })
      if ('children' in node) for (const child of node.children) visit(child as typeof node)
    }
    for (const node of fromMarkdown(section.markdown).children) visit(node)
  }
  return blocks
}

/**
 * Reads a step's body with its review opinions beside the text they cite (#246, #252). The full
 * report is not repeated here; it lives in 材料与版本, and opinions without a verifiable location
 * stay reachable from the one-line summary below the body.
 */
export function ArtifactReviewReader({ artifact, review, onFeedback, revisionDrafts, onDiscuss, onOpenReport, requirement = false, readingTools }: {
  /** Passed to the body's 阅读工具 disclosure (plan Y6). */
  readingTools?: ReactNode
  artifact: Artifact
  review?: AgentReviewResult | null | undefined
  onFeedback?: RecordReviewFeedback | undefined
  /** Per-opinion revision drafts; only for the requirement version that can be revised (#247). */
  revisionDrafts?: ReviewRevisionDrafts | undefined
  onDiscuss?: ((material: DiscussionMaterial) => void) | undefined
  /** Opens the full report in 材料与版本. */
  onOpenReport?: (() => void) | undefined
  requirement?: boolean
}) {
  const [digest, setDigest] = useState<{ id: string; content: string; value: string } | null>(null)
  useEffect(() => {
    let disposed = false
    void sha256Text(artifact.content).then((value) => { if (!disposed) setDigest({ id: artifact.id, content: artifact.content, value }) }).catch(() => { if (!disposed) setDigest(null) })
    return () => { disposed = true }
  }, [artifact.id, artifact.content])
  const currentDigest = digest?.id === artifact.id && digest.content === artifact.content ? digest.value : undefined
  const bound = Boolean(currentDigest && review?.runId === artifact.runId && review.contextManifest?.subjectArtifacts.some((subject) =>
    subject.id === artifact.id && subject.runId === artifact.runId && subject.nodeId === artifact.nodeId &&
    subject.kind === artifact.kind && subject.updatedAt === artifact.updatedAt && subject.contentDigest === currentDigest))
  const blocks = readingBlocks(artifact.content)
  const valid = (review?.missingEvidenceDetails ?? []).flatMap((detail) => detail.citations.flatMap((citation) =>
    bound && detail.index >= 0 && detail.index < (review?.missingEvidence.length ?? 0) && Number.isInteger(citation.start) && Number.isInteger(citation.end) && citation.start >= 0 && citation.end > citation.start && citation.end <= artifact.content.length &&
    citation.sourceId === artifact.id && citation.contentDigest === currentDigest && (!citation.updatedAt || citation.updatedAt === artifact.updatedAt) && artifact.content.slice(citation.start, citation.end) === citation.quote &&
    blocks.some((block) => citation.start >= block.start && citation.end <= block.end) ? [{ index: detail.index, citation }] : []))
  // Drafts belong to the version the review is bound to; a stale review offers none.
  const drafts = bound ? revisionDrafts : undefined
  // A review opinion becomes a reference card in the discussion; nothing is sent yet (plan W7).
  const discuss = onDiscuss && review ? (index: number) => {
    const quotes = review.missingEvidenceDetails?.find((item) => item.index === index)?.citations ?? []
    onDiscuss({
      materialId: `${artifact.id}#review-${review.id}-${index}`,
      materialTitle: `${artifact.title} · 审查意见 ${index + 1}`,
      version: `记录于 ${formatLocalTime(artifact.updatedAt)}`,
      excerpt: `意见：${review.missingEvidence[index]}\n审查时间：${review.createdAt}\n${quotes.map((item) => `原文：${item.quote}`).join('\n')}\n${bound ? '这份报告与当前正文绑定一致。' : '这份报告尚不能证明当前正文已审查，请先核对版本。'}`,
    })
  } : undefined
  const reviewedAt = review ? `${artifact.title} · ${formatLocalTime(artifact.updatedAt)} · 审查于 ${formatLocalTime(review.createdAt)}` : ''
  const annotate = (start: number, end: number) => {
    const items = valid.filter((item) => item.citation.start >= start && item.citation.end <= end).filter((item, index, all) => all.findIndex((other) => other.index === item.index) === index)
    if (!items.length || !review) return null
    return <span className="review-inline-markers">{items.map((item) => <DetailPopover hoverPreview key={item.index} title={`审查意见 ${item.index + 1}`} className="review-inline-marker" label={<span>意见 {item.index + 1}</span>}>
      <p className="meta">{reviewedAt}</p>
      <strong>原文</strong><blockquote>{item.citation.quote}</blockquote>
      <ReviewEvidenceDetails review={review} onlyIndex={item.index} onFeedback={onFeedback} revisionDrafts={drafts} onDiscuss={discuss} />
    </DetailPopover>)}</span>
  }
  const count = review?.missingEvidence.length ?? 0
  const located = new Set(valid.map((item) => item.index))
  const unlocated = bound ? Array.from({ length: count }, (_, index) => index).filter((index) => !located.has(index)) : []
  const reportLink = review && onOpenReport
    ? <button type="button" className="text-button" onClick={onOpenReport}>在「材料与版本」查看完整报告</button>
    : null
  // One line, not a list: the count is of opinions, never of cited places (#246).
  const summary = !review ? '尚未保存 AI 审查报告。'
    : !currentDigest ? '正在核对审查与当前正文的对应关系…'
      : !bound ? '这份审查报告不能证明当前正文已审查：它可能针对其他版本，或没有记录可核验的审查对象。'
        : count === 0 ? '本次审查没有提出意见。'
          : unlocated.length === 0 ? `审查意见 ${count} 条，均已在正文旁标出。`
            : `审查意见 ${count} 条，正文旁标出 ${located.size} 条；另有 ${unlocated.length} 条没有可核验的原文位置：`
  return <>
    <ArtifactBody key={artifact.id} content={artifact.content} kind={requirement ? 'clarification' : artifact.kind} section="content" annotateBlock={annotate} annotations={valid.map((item) => ({ index: item.index, start: item.citation.start, end: item.citation.end }))} readingTools={readingTools} />
    <p className="meta review-reference-summary" data-testid="review-reference-summary">
      {summary}
      {review ? unlocated.map((index) => <DetailPopover hoverPreview key={index} title={`审查意见 ${index + 1}`} triggerLabel={`审查意见 ${index + 1}（未定位）`} className="review-inline-marker" label={<span>意见 {index + 1}</span>}>
        <p className="meta">{reviewedAt}</p>
        <p className="meta">这条意见没有可核验的原文位置，因此没有在正文中标注。</p>
        <ReviewEvidenceDetails review={review} onlyIndex={index} onFeedback={onFeedback} revisionDrafts={drafts} onDiscuss={discuss} />
      </DetailPopover>) : null}
      {reportLink}
    </p>
    <details className="material-source"><summary>来源与版本</summary><p>{artifact.id}</p><p>版本更新时间：{artifact.updatedAt}</p><p>正文摘要：{currentDigest ?? '正在核验'}</p></details>
  </>
}
