import type { CardView } from '../../app/gate-decision/projection'
import { DetailPopover } from '../DetailPopover'
import { FindingCard } from './FindingCard'
import { useGateScope } from './GateDecisionScope'
import { QuestionCard } from './QuestionCard'

/** Visible label and accessible name of a card's narrow-mode marker (§5.7). */
export function markerLabels(card: CardView): { label: string; ariaLabel: string } {
  const label = `${card.kind === 'finding' ? '意见' : '问题'} ${card.number}`
  const level = card.level === 'important' ? ' · 重要' : card.level === 'suggestion' && card.kind === 'finding' ? ' · 建议' : ''
  return { label, ariaLabel: `${label}${level}` }
}
export const markerTone = (card: Pick<CardView, 'kind' | 'level'>) => (card.kind === 'question' ? 'question' : card.level === 'important' ? 'important' : 'suggestion')

/** The card component for a card view. */
export function GateCard(props: Parameters<typeof FindingCard>[0]) {
  return props.card.kind === 'finding' ? <FindingCard {...props} /> : <QuestionCard {...props} />
}

/**
 * A narrow-mode marker: `button.gate-marker` without a text node (the label is drawn by CSS from
 * `data-label`), opening the same card in a popover (AC38).
 */
export function GateMarker({ cardId }: { cardId: string }) {
  const scope = useGateScope()
  const card = scope.view.margin.cards.find((item) => item.id === cardId)
  if (!card) return null
  const { label, ariaLabel } = markerLabels(card)
  return <DetailPopover className={`gate-marker gate-marker--${markerTone(card)} is-${card.status}`} label={null} title={ariaLabel} triggerLabel={ariaLabel}
    restoreFocusOnOutside hideTitle triggerAttributes={{ 'data-label': label, 'data-card-id': card.id }}>
    <GateCard card={card} />
  </DetailPopover>
}
