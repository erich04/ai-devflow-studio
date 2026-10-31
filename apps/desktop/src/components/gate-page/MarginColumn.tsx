import type { RefObject } from 'react'
import type { CardView } from '../../app/gate-decision/projection'
import { GateCard } from './GateMarker'

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
  return <div ref={marginRef} className="gate-margin" style={{ minHeight }}>
    {cards.map((card) => <GateCard key={card.id} card={card} linked={linkedIds.has(card.id)} flashing={flashing === card.id} onLink={onLink}
      style={{ position: 'absolute', top: tops[card.id] ?? 0, insetInline: 0 }} />)}
  </div>
}
