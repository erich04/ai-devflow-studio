import { Fragment } from 'react'
import type { RefObject } from 'react'
import type { CardView } from '../../app/gate-decision/projection'
import { useDecisionPage } from './DecisionPageContext'

/** The wide-layout card area: cards absolutely positioned at their placed tops (design §5.7, AC7). */
export function MarginColumn({ cards, tops, minHeight, linkedIds, flashing, marginRef, onLink }: {
  cards: readonly CardView[]
  tops: Readonly<Record<string, number>>
  minHeight: number
  linkedIds: ReadonlySet<string>
  /** The card that 「下一条 ↓」 or a source label just revealed. */
  flashing?: string | undefined
  marginRef: RefObject<HTMLDivElement | null>
  onLink(cardId: string | undefined): void
}) {
  const scope = useDecisionPage()
  return <div ref={marginRef} className="gate-margin" style={{ minHeight }}>
    {cards.map(card => <Fragment key={card.id}>{scope.renderCard(card, { linked: linkedIds.has(card.id), flashing: flashing === card.id, onLink, style: { position: 'absolute', top: tops[card.id] ?? 0, insetInline: 0 } })}</Fragment>)}
  </div>
}
