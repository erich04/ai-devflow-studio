import { useState, type CSSProperties } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { CardView } from '../../app/gate-decision/projection'
import { FindingEvidence } from './FindingEvidence'
import { useGateScope } from './GateDecisionScope'

export type CardLinkProps = {
  linked?: boolean | undefined
  flashing?: boolean | undefined
  style?: CSSProperties | undefined
  /** Hover and focus link the card with its blocks (§5.7); never on scroll. */
  onLink?: ((cardId: string | undefined) => void) | undefined
}
export const cardClass = (card: CardView, linked: boolean | undefined, flashing?: boolean) => [
  'gate-card', `gate-card--${card.kind}`, card.level ? `gate-card--${card.level}` : '', `is-${card.status}`, linked ? 'is-linked' : '', flashing ? 'is-flashing' : '',
].filter(Boolean).join(' ')

/** A review finding in the margin or a marker popover (design §5.4). */
export function FindingCard({ card, linked, flashing, style, onLink }: { card: CardView } & CardLinkProps) {
  const scope = useGateScope()
  const [error, setError] = useState<string>()
  const finding = card.finding!
  const review = scope.shown.binding.review
  const artifact = scope.shown.artifact
  const run = (result: { ok: true } | { ok: false; message: string }) => setError(result.ok ? undefined : result.message)
  const discuss = () => scope.actions.onDiscuss?.({
    materialId: `${artifact.id}#review-${finding.reviewId}-${finding.index}`,
    materialTitle: `${artifact.title} · ${gateCopy.findingTitle(card.number, card.level)}`,
    version: scope.shown.label,
    label: `${scope.shown.label} · ${gateCopy.findingTitle(card.number, card.level)}`,
    excerpt: `意见：${card.text}\n${(review?.missingEvidenceDetails?.find((item) => item.index === finding.index)?.citations ?? []).map((item) => `原文：${item.quote}`).join('\n')}`,
  })
  return <article className={cardClass(card, linked, flashing)} data-card-id={card.id} tabIndex={-1} style={style} aria-label={card.title}
    onMouseEnter={() => onLink?.(card.id)} onMouseLeave={() => onLink?.(undefined)} onFocus={() => onLink?.(card.id)} onBlur={() => onLink?.(undefined)}>
    <strong className="gate-card-title" title={card.title}>{card.title}</strong>
    <p className="gate-card-text">{card.text}</p>
    {card.status === 'adopted' ? <>
      {card.statusText ? <p className="gate-card-status">{card.statusText}</p> : null}
      <p className="gate-card-status">
        {card.itemRef ? <button type="button" className="text-button" onClick={() => scope.showItem(card.itemRef!.itemId)}>{gateCopy.inListStatus(card.itemRef.number)}</button> : null}
        {card.actionable ? <> · <button type="button" className="text-button" onClick={() => run(scope.apply({ type: 'unadopt', reviewId: finding.reviewId, index: finding.index }))}>{gateCopy.undoAdopt}</button></> : null}
      </p>
    </> : null}
    {card.status === 'declined' ? <p className="gate-card-status">{gateCopy.declinedStatus}
      {card.actionable ? <> · <button type="button" className="text-button" onClick={() => run(scope.apply({ type: 'undecline', reviewId: finding.reviewId, index: finding.index }))}>{gateCopy.undoAdopt}</button></> : null}
    </p> : null}
    {card.status === 'open' && card.actionable ? <div className="gate-card-actions">
      <button type="button" className="ghost-button" onClick={() => run(scope.apply({ type: 'adopt', finding: { reviewId: finding.reviewId, index: finding.index, text: finding.text, ...(finding.level ? { level: finding.level } : {}) } }))}>{gateCopy.adoptButton}</button>
      <button type="button" className="ghost-button" onClick={() => run(scope.apply({ type: 'decline', reviewId: finding.reviewId, index: finding.index }))}>{gateCopy.declineButton}</button>
      {scope.actions.onDiscuss ? <button type="button" className="text-button" onClick={discuss}>{gateCopy.discussButton}</button> : null}
    </div> : null}
    {card.readOnlyReason ? <p className="meta">{card.readOnlyReason}</p> : null}
    {error ? <p role="alert" className="gate-note gate-note--warn">{error}</p> : null}
    {review ? <details className="gate-card-evidence">
      <summary>{gateCopy.evidenceDisclosure}</summary>
      <FindingEvidence review={review} index={finding.index} onFeedback={scope.actions.onFeedback} />
    </details> : null}
  </article>
}
