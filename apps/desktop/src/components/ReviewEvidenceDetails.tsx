import { useEffect, useState } from 'react'
import type { AgentReviewResult } from '@ai-devflow/shared'
import { MAX_SUGGESTION_FIELD_CHARACTERS, type RevisionSuggestion } from '../app/revision-suggestions'
import { FindingEvidence, type RecordReviewFeedback } from './gate-page/FindingEvidence'

export type { RecordReviewFeedback } from './gate-page/FindingEvidence'

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
  const [drafting, setDrafting] = useState<{ index: number; finding: string; change: string; error?: string } | null>(null)
  useEffect(() => { setDrafting(null) }, [review.id])
  if (!review.missingEvidence.length) return null

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
      return <article className="mini-card" key={index}>
        <strong>{summary}</strong>
        <FindingEvidence review={review} index={index} onFeedback={onFeedback}>
          {renderDraft(index)}
          {onDiscuss && <button type="button" onClick={() => onDiscuss(index)}>讨论此意见</button>}
        </FindingEvidence>
      </article>
    })}
  </section>
}
