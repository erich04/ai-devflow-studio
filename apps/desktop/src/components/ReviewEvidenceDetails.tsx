import { useEffect, useState } from 'react'
import type { AgentReviewResult, RecordAgentReviewFeedbackInput } from '@ai-devflow/shared'

export type RecordReviewFeedback = (input: RecordAgentReviewFeedbackInput) => Promise<AgentReviewResult>

export function ReviewEvidenceDetails({ review, onFeedback }: {
  review: AgentReviewResult
  onFeedback?: RecordReviewFeedback | undefined
}) {
  const [feedback, setFeedback] = useState(review.feedback ?? [])
  const [editing, setEditing] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setFeedback(review.feedback ?? []) }, [review.feedback])
  if (!review.missingEvidence.length) return null

  async function save(index: number) {
    if (!onFeedback || busy) return
    setBusy(true); setError('')
    try {
      const updated = await onFeedback({ projectId: review.projectId, runId: review.runId,
        reviewId: review.id, missingEvidenceIndex: index, reason: reason.trim() })
      setFeedback(updated.feedback ?? [])
      setEditing(null); setReason('')
    } catch { setError('反馈未保存，请重试。原审查与流程进度仍保留。') }
    finally { setBusy(false) }
  }

  return <section className="review-evidence-details" aria-label="审查意见与原文依据">
    <p>以下是模型意见，请结合原文核对。反馈只记录你的判断，不会自动批准 Gate 或取消策略限制。</p>
    {review.missingEvidence.map((summary, index) => {
      const detail = review.missingEvidenceDetails?.find((item) => item.index === index)
      const assessment = detail?.assessment ?? 'unverified'
      const notice = assessment === 'explicit_non_goal' ? '待复核：原文已有明确的非目标，请检查这条意见是否误报。'
        : assessment === 'conflicting_decision' ? '待复核：模型发现决定之间可能矛盾，需要人工核对。'
          : assessment === 'unverified' ? '待复核：这条意见没有可验证的完整原文引用。'
            : '已定位原文；是否构成缺口仍需人工判断。'
      return <article className="mini-card" key={index}>
        <strong>{summary}</strong><p className="meta">{notice}</p>
        {detail?.citations.map((citation, citationIndex) => <details key={`${citation.sourceId}:${citation.start}:${citationIndex}`}>
          <summary>原文依据：{citation.title}</summary>
          <blockquote>{citation.quote}</blockquote>
          <p className="meta">审查时保存的原文片段{citation.updatedAt ? ` · ${citation.updatedAt}` : ''}</p>
          <code>{citation.sourceId} · {citation.contentDigest} · {citation.start}–{citation.end}</code>
        </details>)}
        {feedback.filter((item) => item.missingEvidenceIndex === index).map((item) => <p key={item.id}>
          已记录人工反馈：{item.reason}<small> · {item.createdAt}</small>
        </p>)}
        {onFeedback && editing !== index ? <button type="button" disabled={busy} onClick={() => { setEditing(index); setReason(''); setError('') }}>反馈误报</button> : null}
        {editing === index ? <form onSubmit={(event) => { event.preventDefault(); void save(index) }}>
          <label>误报说明<textarea aria-label="误报说明" maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：哪条已确认决定与这条意见不符？" /></label>
          <button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? '保存中…' : '保存反馈'}</button>
          <button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
          {error ? <p role="alert">{error}</p> : null}
        </form> : null}
      </article>
    })}
  </section>
}
