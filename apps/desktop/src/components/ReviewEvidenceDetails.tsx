import type { AgentReviewResult } from '@ai-devflow/shared'
import { FindingEvidence, type RecordReviewFeedback } from './gate-page/FindingEvidence'

export type { RecordReviewFeedback } from './gate-page/FindingEvidence'

export function ReviewEvidenceDetails({ review, onFeedback, onlyIndex, onDiscuss, titleOf }: {
  onlyIndex?: number | undefined
  onDiscuss?: ((index: number) => void) | undefined
  review: AgentReviewResult
  onFeedback?: RecordReviewFeedback | undefined
  /** A heading above a finding, e.g. "意见 2 · 重要" when the review gave every level. */
  titleOf?: ((index: number) => string) | undefined
}) {
  if (!review.missingEvidence.length) return null

  return <section className="review-evidence-details" aria-label="审查意见与原文依据">
    <p>以下是模型意见，请结合原文核对。反馈只记录你的判断，不会自动批准 Gate 或取消策略限制。</p>
    {review.missingEvidence.map((summary, index) => {
      if (onlyIndex !== undefined && onlyIndex !== index) return null
      return <article className="mini-card" key={index}>
        {titleOf ? <p className="meta">{titleOf(index)}</p> : null}
        <strong>{summary}</strong>
        <FindingEvidence review={review} index={index} onFeedback={onFeedback}>
          {onDiscuss && <button type="button" onClick={() => onDiscuss(index)}>讨论此意见</button>}
        </FindingEvidence>
      </article>
    })}
  </section>
}
