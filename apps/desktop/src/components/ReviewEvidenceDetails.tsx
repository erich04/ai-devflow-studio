import { useEffect, useState } from 'react'
import type { AgentReviewResult, RecordAgentReviewFeedbackInput } from '@ai-devflow/shared'
import { MAX_SUGGESTION_FIELD_CHARACTERS, type RevisionSuggestion } from '../app/revision-suggestions'

export type RecordReviewFeedback = (input: RecordAgentReviewFeedbackInput) => Promise<AgentReviewResult>

/**
 * Local revision drafts for the requirement version being reviewed (#247). Saving only writes the
 * draft on this machine; the revision request is submitted separately.
 */
export type ReviewRevisionDrafts = {
  get: (index: number) => RevisionSuggestion | undefined
  /** Returns why the draft was not saved; the typed text is kept for the user to fix. */
  save: (index: number, draft: { finding: string; change: string }) => string | undefined
  remove: (index: number) => void
  /** Opens the revision request, where every saved draft is checked and submitted together. */
  openRequest?: (() => void) | undefined
}

export function ReviewEvidenceDetails({ review, onFeedback, revisionDrafts, onlyIndex, onDiscuss }: {
  onlyIndex?: number | undefined
  onDiscuss?: ((index: number) => void) | undefined
  review: AgentReviewResult
  onFeedback?: RecordReviewFeedback | undefined
  revisionDrafts?: ReviewRevisionDrafts | undefined
}) {
  const [feedback, setFeedback] = useState(review.feedback ?? [])
  const [editing, setEditing] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drafting, setDrafting] = useState<{ index: number; finding: string; change: string; error?: string } | null>(null)
  useEffect(() => { setFeedback(review.feedback ?? []) }, [review.feedback])
  useEffect(() => { setDrafting(null) }, [review.id])
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

  const renderDraft = (index: number) => {
    if (!revisionDrafts) return null
    const saved = revisionDrafts.get(index)
    if (drafting?.index === index) {
      return <form className="revision-suggestion-form" aria-label={`意见 ${index + 1} 的修订建议`} onSubmit={(event) => {
        event.preventDefault()
        const failure = revisionDrafts.save(index, { finding: drafting.finding, change: drafting.change })
        setDrafting(failure ? { ...drafting, error: failure } : null)
      }}>
        <label>核实结论<textarea aria-label={`意见 ${index + 1} 的核实结论`} maxLength={MAX_SUGGESTION_FIELD_CHARACTERS} value={drafting.finding}
          onChange={(event) => setDrafting({ ...drafting, finding: event.target.value })} placeholder="核对原文、代码或讨论后确认的事实（可选）" /></label>
        <label>拟修改内容<textarea aria-label={`意见 ${index + 1} 的拟修改内容`} maxLength={MAX_SUGGESTION_FIELD_CHARACTERS} value={drafting.change}
          onChange={(event) => setDrafting({ ...drafting, change: event.target.value })} placeholder="下一版需求应如何改写这一处" /></label>
        <p className="meta">只保存到本机修订草稿，不修改需求，也不批准 Gate；在「请求修订当前版本」中确认提交后才会生成新版本。</p>
        {drafting.error ? <p role="alert">{drafting.error}</p> : null}
        <button type="submit">保存到修订草稿</button>
        <button type="button" onClick={() => setDrafting(null)}>取消</button>
      </form>
    }
    if (saved) {
      return <div className="revision-suggestion-saved" data-testid={`revision-suggestion-${index}`}>
        <p><strong>已加入修订草稿</strong><span className="meta"> · 尚未提交</span></p>
        <p>核实结论：{saved.finding.trim() || '未填写'}</p>
        <p>拟修改内容：{saved.change.trim() || '未填写'}</p>
        <button type="button" onClick={() => setDrafting({ index, finding: saved.finding, change: saved.change })}>编辑修订建议</button>
        <button type="button" onClick={() => revisionDrafts.remove(index)}>移出修订草稿</button>
        {revisionDrafts.openRequest ? <button type="button" onClick={revisionDrafts.openRequest}>查看并提交修订请求</button> : null}
      </div>
    }
    return <button type="button" onClick={() => setDrafting({ index, finding: '', change: '' })}>整理修订建议</button>
  }

  return <section className="review-evidence-details" aria-label="审查意见与原文依据">
    <p>以下是模型意见，请结合原文核对。反馈只记录你的判断，不会自动批准 Gate 或取消策略限制。</p>
    {review.missingEvidence.map((summary, index) => {
      if (onlyIndex !== undefined && onlyIndex !== index) return null
      const detail = review.missingEvidenceDetails?.find((item) => item.index === index)
      const assessment = detail?.assessment ?? 'unverified'
      const notice = assessment === 'explicit_non_goal' ? '待复核：引用位于非目标章节，请检查原文是否已解决这条意见。'
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
        {renderDraft(index)}
        {onDiscuss && <button type="button" onClick={() => onDiscuss(index)}>讨论此意见</button>}
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
