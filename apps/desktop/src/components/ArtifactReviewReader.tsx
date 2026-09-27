import { useEffect, useState } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { sha256Text, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactBody, partitionArtifact } from './ArtifactBody'
import { DetailPopover } from './DetailPopover'
import { ReviewEvidenceDetails, type RecordReviewFeedback } from './ReviewEvidenceDetails'

/** Match only blocks the Markdown renderer can annotate. Cross-block quotes use the report fallback. */
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

export function ArtifactReviewReader({ artifact, review, reports = [], onFeedback, onToggleRevision, revisionSelected = [], onDiscuss, requirement = false }: {
  artifact: Artifact
  review?: AgentReviewResult | null | undefined
  reports?: Artifact[]
  onFeedback?: RecordReviewFeedback | undefined
  onToggleRevision?: ((index: number) => void) | undefined
  revisionSelected?: number[] | undefined
  onDiscuss?: ((prompt: string) => void) | undefined
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
  const toggle = bound ? onToggleRevision : undefined
  const discuss = onDiscuss && review ? (index: number) => {
    const quotes = review.missingEvidenceDetails?.find((item) => item.index === index)?.citations ?? []
    onDiscuss(`请帮我核对这条审查意见。\n产物：${artifact.title}\n产物 ID：${artifact.id}\n版本时间：${artifact.updatedAt}\n审查 ID：${review.id}\n审查时间：${review.createdAt}\n意见：${review.missingEvidence[index]}\n${quotes.map((item) => `原文快照（${item.sourceId}，${item.contentDigest}，${item.start}–${item.end}）：\n${item.quote}`).join('\n')}\n${bound ? '这份报告与当前正文绑定一致。' : '这份报告尚不能证明当前正文已审查，请先核对版本。'}`)
  } : undefined
  const report = review ? <section className="requirement-review-list" data-testid="review-evidence-results"><h3>{bound ? '本版本审查意见' : '历史或尚未核验绑定的审查'}</h3>
    <p>{review.conclusion}</p><p className="meta">共 {review.missingEvidence.length} 条待核对意见 · {review.createdAt}。{bound ? '已绑定当前正文。' : '不能将这份报告当作当前版本已审查或问题已解决的证明。'}</p>
    {review.missingEvidence.length === 0 && <p>本次审查未提出缺失项；人工审批与实际测试仍需分别核对。</p>}
    {review.missingEvidence.map((_, index) => !valid.some((item) => item.index === index) && <p className="meta" key={index}>意见 {index + 1}：当前正文没有可核验的位置，保留在此处供核对。</p>)}
    <p>{review.summary}</p>
    {review.policyFindings.map((finding) => <p key={finding.id}>{finding.severity} · {finding.category} · {finding.summary}</p>)}
    <details><summary>审查来源与版本快照</summary><p>{review.id} · {review.gateAdvisory.blocksApproval ? '审查提出阻断' : '建议性审查'} · 置信度 {Math.round(review.confidence * 100)}%</p>{review.contextManifest?.subjectArtifacts.map((subject) => <p key={subject.id}>{subject.id} · {subject.updatedAt} · {subject.contentDigest} · {subject.coverage}</p>)}</details>
    <ReviewEvidenceDetails key={review.id} review={review} onFeedback={onFeedback} onToggleRevision={toggle} revisionSelected={revisionSelected} onDiscuss={discuss} />
    {reports.length > 0 && <details><summary>历史报告原文 · {reports.length}</summary>{reports.map((item) => <article key={item.id}><h4>{item.title}</h4><ArtifactBody content={item.content} /></article>)}</details>}
  </section> : <p>尚未保存 AI 审查报告。</p>
  const annotate = (start: number, end: number) => {
    const items = valid.filter((item) => item.citation.start >= start && item.citation.end <= end).filter((item, index, all) => all.findIndex((other) => other.index === item.index) === index)
    if (!items.length || !review) return null
    return <span className="review-inline-markers">{items.map((item) => <DetailPopover hoverPreview key={item.index} title={`审查意见 ${item.index + 1}`} className="review-inline-marker" label={<span>意见 {item.index + 1}</span>}>
      <p>{artifact.title} · {artifact.updatedAt} · 审查 {review.createdAt}</p>
      <strong>原文</strong><blockquote>{item.citation.quote}</blockquote>
      <ReviewEvidenceDetails review={review} onlyIndex={item.index} onFeedback={onFeedback} onToggleRevision={toggle} revisionSelected={revisionSelected} onDiscuss={discuss} />
    </DetailPopover>)}</span>
  }
  return <>
    <ArtifactBody key={artifact.id} content={artifact.content} kind={requirement ? 'clarification' : artifact.kind} section="content" annotateBlock={annotate} annotations={valid.map((item) => ({ index: item.index, start: item.citation.start, end: item.citation.end }))} pendingContent={requirement ? report : undefined} />
    <details className="material-source"><summary>来源与版本</summary><p>{artifact.id}</p><p>版本更新时间：{artifact.updatedAt}</p><p>正文摘要：{currentDigest ?? '正在核验'}</p></details>
    <p className="meta">审查意见 {review?.missingEvidence.length ?? 0} 条 · 可在当前正文定位 {new Set(valid.map((item) => item.index)).size} 条。{requirement ? '待确认事项中保留全部意见。' : '下方保留完整审查报告。'}</p>
    {!requirement && report}
  </>
}
