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
/** A card's place in the margin: `position` is its anchor (block start or block top); undefined when unlocated. */
export type MarginOrderKey = { kind: 'finding' | 'question'; number: number; position?: number | undefined }
/**
 * The one margin order (§5.7), shared by the placement, 「下一条 ↓」 and the finding numbers (#276):
 * unlocated cards first, findings before questions; then located cards by position, a question
 * before a finding at the same position; then number.
 */
export function compareMarginOrder(a: MarginOrderKey, b: MarginOrderKey): number {
  const kindOrder = (key: MarginOrderKey) => (key.kind === 'finding' ? 0 : 1)
  if (a.position === undefined || b.position === undefined) {
    if (a.position !== b.position) return a.position === undefined ? -1 : 1
    return kindOrder(a) - kindOrder(b) || a.number - b.number
  }
  return a.position - b.position || kindOrder(b) - kindOrder(a) || a.number - b.number
}
export function placeMarginCards(cards: readonly PlaceableCard[], gap = 8): PlacedCard[] {
  const ordered = [...cards].sort((a, b) => compareMarginOrder({ ...a, position: a.anchorTop }, { ...b, position: b.anchorTop }))
  const placed: PlacedCard[] = []
  let bottom: number | undefined
  for (const card of ordered) {
    const below = bottom === undefined ? 0 : bottom + gap
    const top = card.anchorTop === undefined ? below : Math.max(card.anchorTop, below)
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
