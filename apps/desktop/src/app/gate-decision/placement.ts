/**
 * Margin card placement (design §5.7, AC7): unlocated cards first, stacked from the top; then
 * located cards in anchor order, each at its block's top unless the card above pushes it down.
 */
export type PlaceableCard = {
  id: string
  kind: 'finding' | 'question'
  number: number
  /** Top of the anchor block relative to `.gate-margin`; undefined for an unlocated card. */
  anchorTop?: number | undefined
  height: number
}
export type PlacedCard = { id: string; top: number }
export function placeMarginCards(cards: readonly PlaceableCard[], gap = 8): PlacedCard[] {
  const kindOrder = (card: PlaceableCard) => (card.kind === 'finding' ? 0 : 1)
  const unlocated = cards.filter((card) => card.anchorTop === undefined)
    .sort((a, b) => kindOrder(a) - kindOrder(b) || a.number - b.number)
  // Ties: question before finding, then number.
  const located = cards.filter((card) => card.anchorTop !== undefined)
    .sort((a, b) => a.anchorTop! - b.anchorTop! || kindOrder(b) - kindOrder(a) || a.number - b.number)
  const placed: PlacedCard[] = []
  let bottom: number | undefined
  for (const card of unlocated) {
    const top = bottom === undefined ? 0 : bottom + gap
    placed.push({ id: card.id, top })
    bottom = top + card.height
  }
  for (const card of located) {
    const top = Math.max(card.anchorTop!, bottom === undefined ? 0 : bottom + gap)
    placed.push({ id: card.id, top })
    bottom = top + card.height
  }
  return placed
}
/** The first unhandled card after the last visited one, wrapping (FR-7.5, AC13). */
export function nextCardTarget(order: readonly string[], lastId: string | undefined, handled: (id: string) => boolean): string | undefined {
  if (!order.length) return undefined
  const from = lastId === undefined ? -1 : order.indexOf(lastId)
  for (let step = 1; step <= order.length; step++) {
    const id = order[(from + step + order.length) % order.length]!
    if (!handled(id)) return id
  }
  return undefined
}
