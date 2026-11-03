import { useState } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { CardView } from '../../app/gate-decision/projection'
import { checkItemText, MAX_REVISION_ITEM_CHARACTERS } from '../../app/gate-decision/revision-list'
import { cardClass, ItemRef, type CardLinkProps } from './FindingCard'
import { useGateScope } from './GateDecisionScope'

/** An open question that needs the user's decision (design §5.4). Answers stay in the scope across layout switches. */
export function QuestionCard({ card, linked, flashing, style, onLink }: { card: CardView } & CardLinkProps) {
  const scope = useGateScope()
  const [error, setError] = useState<string>()
  const key = `answer:${card.id}`
  const draft = scope.drafts[key]
  const editing = card.actionable && (card.status === 'open' || draft !== undefined)
  const artifact = scope.shown.artifact
  const save = () => {
    const checked = checkItemText(draft ?? '')
    if (!checked.ok) { setError(checked.message); return }
    const result = scope.apply({ type: 'answer', answer: checked.text,
      question: { index: card.number - 1, text: card.text, merged: (card.merged ?? []).map(({ reviewId, index, text }) => ({ reviewId, index, text })) } })
    if (!result.ok) { setError(result.message); return }
    setError(undefined)
    scope.setDraft(key, undefined)
  }
  const discuss = () => scope.actions.onDiscuss?.({
    materialId: `${artifact.id}#question-${card.number}`,
    materialTitle: `${artifact.title} · 问题 ${card.number}`,
    version: scope.shown.label,
    label: `${scope.shown.label} · 问题 ${card.number}`,
    excerpt: [`问题：${card.text}`, ...(card.merged ?? []).map((item) => `AI 审查也指出（意见 ${item.number}）：${item.text}`)].join('\n'),
  })
  return <article className={cardClass(card, linked, flashing)} data-card-id={card.id} tabIndex={-1} style={style} aria-label={card.title}
    onMouseEnter={() => onLink?.(card.id)} onMouseLeave={() => onLink?.(undefined)} onFocus={() => onLink?.(card.id)} onBlur={() => onLink?.(undefined)}>
    <strong className="gate-card-title" title={card.status === 'answered' && card.answer ? gateCopy.questionAnsweredTitle(card.number, card.answer) : card.title}>{card.title}</strong>
    <p className="gate-card-text">{card.text}</p>
    {card.mergedLines.map((line) => <p key={line} className="gate-card-merged" title={line}>{line}</p>)}
    {card.status === 'answered' && card.itemRef ? <p className="gate-card-status">
      <ItemRef card={card} />
      {card.actionable && draft === undefined ? <> · <button type="button" className="text-button" onClick={() => scope.setDraft(key, card.answer ?? '')}>{gateCopy.changeAnswer}</button></> : null}
    </p> : null}
    {editing ? <form className="gate-card-answer" onSubmit={(event) => { event.preventDefault(); save() }}>
      <textarea aria-label={`问题 ${card.number} 的回答`} placeholder={gateCopy.answerPlaceholder} maxLength={MAX_REVISION_ITEM_CHARACTERS} value={draft ?? ''}
        onChange={(event) => scope.setDraft(key, event.target.value)} />
      {error ? <p role="alert" className="gate-note gate-note--warn">{error}</p> : null}
      <div className="gate-card-actions">
        <button type="submit" className="ghost-button">{gateCopy.saveAnswerButton}</button>
        {card.status === 'answered' ? <button type="button" className="text-button" onClick={() => { scope.setDraft(key, undefined); setError(undefined) }}>取消</button> : null}
        {scope.actions.onDiscuss ? <button type="button" className="text-button" onClick={discuss}>{gateCopy.discussButton}</button> : null}
      </div>
    </form> : null}
    {card.readOnlyReason ? <p className="meta">{card.readOnlyReason}</p> : null}
  </article>
}
