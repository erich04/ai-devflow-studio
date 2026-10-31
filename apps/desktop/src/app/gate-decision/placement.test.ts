import { describe, expect, it } from 'vitest'
import { nextCardTarget, placeMarginCards, type PlaceableCard } from './placement'
const card = (id: string, kind: PlaceableCard['kind'], number: number, anchorTop: number | undefined, height = 40): PlaceableCard => ({ id, kind, number, anchorTop, height })
describe('placeMarginCards', () => {
  it('puts unlocated cards first, then located ones at their block or pushed below the card above (AC7)', () => {
    const cards = [card('f3', 'finding', 3, 100), card('f5', 'finding', 5, undefined), card('q1', 'question', 1, 100), card('f2', 'finding', 2, 120), card('q9', 'question', 9, undefined), card('f4', 'finding', 4, 400)]
    const placed = placeMarginCards(cards, 8)
    expect(placed).toEqual([
      { id: 'f5', top: 0 }, { id: 'q9', top: 48 },          // findings by number, then questions
      { id: 'q1', top: 100 }, { id: 'f3', top: 148 },        // tie: question before finding
      { id: 'f2', top: 196 }, { id: 'f4', top: 400 },
    ])
    const tops = new Map(placed.map((item) => [item.id, item.top]))
    for (const item of cards.filter((entry) => entry.anchorTop !== undefined)) expect(tops.get(item.id)!).toBeGreaterThanOrEqual(item.anchorTop! - 2)
    const sorted = [...placed].sort((a, b) => a.top - b.top)
    for (let index = 1; index < sorted.length; index++) expect(sorted[index]!.top).toBeGreaterThanOrEqual(sorted[index - 1]!.top + 40)
  })
  it('places a first located card at anchor 0 exactly at 0 when no unlocated card exists', () => {
    expect(placeMarginCards([card('a', 'finding', 1, 0)])).toEqual([{ id: 'a', top: 0 }])
    expect(placeMarginCards([card('a', 'finding', 1, 37)])).toEqual([{ id: 'a', top: 37 }])
  })
})
describe('nextCardTarget', () => {
  const order = ['a', 'b', 'c', 'd']
  it('visits unhandled cards in order, skips handled ones and wraps (AC13)', () => {
    const handled = new Set(['b'])
    const isHandled = (id: string) => handled.has(id)
    expect(nextCardTarget(order, undefined, isHandled)).toBe('a')
    expect(nextCardTarget(order, 'a', isHandled)).toBe('c')
    expect(nextCardTarget(order, 'c', isHandled)).toBe('d')
    expect(nextCardTarget(order, 'd', isHandled)).toBe('a')
    expect(nextCardTarget(order, 'missing', isHandled)).toBe('a')
  })
  it('returns the last card again when it is the only one left, and nothing when all are handled', () => {
    expect(nextCardTarget(order, 'c', (id) => id !== 'c')).toBe('c')
    expect(nextCardTarget(order, 'a', () => true)).toBeUndefined()
    expect(nextCardTarget([], undefined, () => false)).toBeUndefined()
  })
})
