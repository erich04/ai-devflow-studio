import type { AgentReviewResult } from '@ai-devflow/shared'
import { formatLocalTime } from '../app/desktop-view-model'
import type { GateReviewScope } from '../app/gate-review-scope'
import { gateCopy } from '../app/gate-decision/copy'
import { levelsKnown } from '../app/gate-decision/review-binding'
import { ReviewEvidenceDetails, type RecordReviewFeedback } from './ReviewEvidenceDetails'

const importanceOf = (review: AgentReviewResult, index: number) =>
  review.missingEvidenceDetails?.find((detail) => detail.index === index)?.importance

/**
 * The archived Gate Review report in 材料与版本 (#246, #252). 当前工作 marks opinions beside the
 * text they cite; this is the one place that lists every opinion, including those that cannot be
 * located in the current text.
 */
export function ReviewReport({ review, scope, onFeedback }: {
  review: AgentReviewResult
  scope?: GateReviewScope | undefined
  onFeedback?: RecordReviewFeedback | undefined
}) {
  const covered = scope
    ? scope.appliesToCurrent
      ? `针对${scope.reviewedLabel ?? '当前版本'}`
      : `针对${scope.reviewedLabel ?? '之前的版本'}，当前版本已更新`
    : ''
  const count = review.missingEvidence.length
  return <section className="requirement-review-list" aria-label="已归档的审查报告" data-testid="review-report">
    <h3>审查报告</h3>
    <p className="meta">{[formatLocalTime(review.createdAt), review.model, covered].filter(Boolean).join(' · ')}</p>
    <p>{review.conclusion}</p>
    <p className="meta">{count
      ? `共 ${count} 条意见。能在正文中定位的意见，也在「当前工作」的对应段落旁标出；这里保留全部意见。`
      : '本次审查未提出缺失项；人工审批与实际测试仍需分别核对。'}</p>
    <p>{review.summary}</p>
    {review.policyFindings.map((finding) => <p key={finding.id}>{finding.severity} · {finding.category} · {finding.summary}</p>)}
    <details><summary>审查来源与版本快照</summary>
      <p>{review.id} · {review.gateAdvisory.blocksApproval ? '审查提出阻断' : '建议性审查'} · 置信度 {Math.round(review.confidence * 100)}%</p>
      {review.contextManifest?.subjectArtifacts.map((subject) => <p key={subject.id}>{subject.id} · {subject.updatedAt} · {subject.contentDigest} · {subject.coverage}</p>)}
    </details>
    <ReviewEvidenceDetails key={review.id} review={review} onFeedback={onFeedback}
      {...(levelsKnown(review) ? { titleOf: (index: number) => gateCopy.findingTitle(index + 1, importanceOf(review, index)) } : {})} />
  </section>
}
