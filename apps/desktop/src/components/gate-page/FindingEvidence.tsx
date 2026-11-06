import { useEffect, useState, type ReactNode } from 'react'
import type { AgentReviewResult, RecordAgentReviewFeedbackInput } from '@ai-devflow/shared'

export type RecordReviewFeedback = (input: RecordAgentReviewFeedbackInput) => Promise<AgentReviewResult>

/**
 * The per-finding part of the review evidence (design §5.4): assessment notice, citations,
 * recorded feedback and 「反馈误报」. `children` sit between the recorded feedback and the
 * feedback button, as in the full report.
 */
export function FindingEvidence({ review, index, onFeedback, children }: {
  review: AgentReviewResult
  index: number
  onFeedback?: RecordReviewFeedback | undefined
  children?: ReactNode
}) {
  const [feedback, setFeedback] = useState(review.feedback ?? [])
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setFeedback(review.feedback ?? []) }, [review.feedback])
  const detail = review.missingEvidenceDetails?.find((item) => item.index === index)
  const assessment = detail?.assessment ?? 'unverified'
  const notice = assessment === 'explicit_non_goal' ? '待复核：引用位于非目标章节，请检查原文是否已解决这条意见。'
    : assessment === 'conflicting_decision' ? '待复核：模型发现决定之间可能矛盾，需要人工核对。'
      : assessment === 'unverified' ? '待复核：这条意见没有可验证的完整原文引用。'
        : '已定位原文；是否构成缺口仍需人工判断。'
  async function save() {
    if (!onFeedback || busy) return
    setBusy(true); setError('')
    try {
      const updated = await onFeedback({ projectId: review.projectId, runId: review.runId,
        reviewId: review.id, missingEvidenceIndex: index, reason: reason.trim() })
      setFeedback(updated.feedback ?? [])
      setEditing(false); setReason('')
    } catch { setError('反馈未保存，请重试。原审查与流程进度仍保留。') }
    finally { setBusy(false) }
  }
  return <>
    <p className="meta">{notice}</p>
    {detail?.citations.map((citation, citationIndex) => <details key={`${citation.sourceId}:${citation.start}:${citationIndex}`}>
      <summary>原文依据：{citation.title}</summary>
      <blockquote>{citation.quote}</blockquote>
      <p className="meta">审查时保存的原文片段{citation.updatedAt ? ` · ${citation.updatedAt}` : ''}</p>
      <code>{citation.sourceId} · {citation.contentDigest} · {citation.start}–{citation.end}</code>
    </details>)}
    {feedback.filter((item) => item.missingEvidenceIndex === index).map((item) => <p key={item.id}>
      已记录人工反馈：{item.reason}<small> · {item.createdAt}</small>
    </p>)}
    {children}
    {onFeedback && !editing ? <button type="button" disabled={busy} onClick={() => { setEditing(true); setReason(''); setError('') }}>反馈误报</button> : null}
    {editing ? <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>误报说明<textarea aria-label="误报说明" maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：哪条已确认决定与这条意见不符？" /></label>
      <button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? '保存中…' : '保存反馈'}</button>
      <button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
      {error ? <p role="alert">{error}</p> : null}
    </form> : null}
  </>
}
