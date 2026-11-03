import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import type { BlockKey } from '../../app/gate-decision/material'
import { placeMarginCards } from '../../app/gate-decision/placement'
import type { BlockBoxes } from './MaterialOverlay'

/** `status` is part of the signature: a status change changes a card's height. */
export type LayoutCard = { id: string; kind: 'finding' | 'question'; number: number; anchor?: BlockKey | undefined; status?: string }
export type MarginLayout = {
  /** Box of every `[data-block-start]` element relative to `.gate-material`. */
  boxes: BlockBoxes
  /** Card tops relative to `.gate-margin` (wide layout). */
  tops: Readonly<Record<string, number>>
  minHeight: number
  /** Increments after every pass that changed something; 0 before the first pass. */
  pass: number
}
const CARD_GAP = 8
const sameRecord = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Measures block boxes once per pass and places the margin cards from them (design §5.7). A pass
 * runs before paint when the content, cards or layout change, from `ResizeObserver` on the
 * material, the workspace and every card, and after `document.fonts.ready`; never on scroll or hover.
 */
export function useMarginLayout({ workspace, material, margin, cards, content, mode }: {
  workspace: RefObject<HTMLElement | null>
  material: RefObject<HTMLElement | null>
  margin: RefObject<HTMLElement | null>
  cards: readonly LayoutCard[]
  /** The shown content; a new version is a new pass. */
  content: string
  mode: string
}): MarginLayout {
  const [layout, setLayout] = useState<MarginLayout>({ boxes: {}, tops: {}, minHeight: 0, pass: 0 })
  const signature = JSON.stringify(cards)
  const measure = useCallback(() => {
    const column = material.current
    if (!column) return
    const base = column.getBoundingClientRect()
    const boxes: Record<string, { top: number; height: number }> = {}
    for (const element of Array.from(column.querySelectorAll<HTMLElement>('[data-block-start]'))) {
      const box = element.getBoundingClientRect()
      boxes[`${element.dataset.blockStart}:${element.dataset.blockEnd}`] = { top: box.top - base.top, height: box.height }
    }
    const tops: Record<string, number> = {}
    let minHeight = base.height
    const area = margin.current
    if (area) {
      const parsed = JSON.parse(signature) as LayoutCard[]
      const heights = new Map(Array.from(area.querySelectorAll<HTMLElement>(':scope > [data-card-id]')).map((element) => [element.dataset.cardId!, element.getBoundingClientRect().height]))
      const placed = placeMarginCards(parsed.filter((card) => heights.has(card.id)).map((card) => ({
        id: card.id, kind: card.kind, number: card.number, height: heights.get(card.id)!,
        ...(card.anchor && boxes[card.anchor] ? { anchorTop: boxes[card.anchor]!.top } : {}),
      })), CARD_GAP)
      for (const item of placed) {
        tops[item.id] = item.top
        minHeight = Math.max(minHeight, item.top + (heights.get(item.id) ?? 0))
      }
    }
    setLayout((previous) => (previous.pass > 0 && previous.minHeight === minHeight && sameRecord(previous.boxes, boxes) && sameRecord(previous.tops, tops)
      ? previous : { boxes, tops, minHeight, pass: previous.pass + 1 }))
  }, [material, margin, signature])
  useLayoutEffect(measure, [measure, content, mode])
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    for (const element of [workspace.current, material.current]) if (element) observer.observe(element)
    for (const card of Array.from(margin.current?.querySelectorAll(':scope > [data-card-id]') ?? [])) observer.observe(card)
    return () => observer.disconnect()
  }, [measure, workspace, material, margin, mode])
  useEffect(() => {
    let disposed = false
    void document.fonts?.ready.then(() => { if (!disposed) measure() })
    return () => { disposed = true }
  }, [measure])
  return layout
}
