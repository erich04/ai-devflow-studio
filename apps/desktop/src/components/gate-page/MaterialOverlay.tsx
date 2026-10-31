import { memo } from 'react'
import type { BlockKey } from '../../app/gate-decision/material'
import type { BarView } from '../../app/gate-decision/projection'
import type { GateLayoutMode } from '../../app/gate-decision/layout'

export type BlockBoxes = Readonly<Record<string, { top: number; height: number }>>
const SLOT_OFFSETS = [1, 5, 9] as const

/**
 * Tags and thin bars outside the text flow (design §3.23, §5.7): positioned from the measured
 * block boxes, no text nodes, so the material's text stays exactly the generated text.
 */
export const MaterialOverlay = memo(function MaterialOverlay({ mode, boxes, newBlocks, bars, onActivate, onLink }: {
  mode: GateLayoutMode
  boxes: BlockBoxes
  newBlocks: readonly BlockKey[]
  bars: readonly BarView[]
  onActivate(cardIds: readonly string[]): void
  onLink(cardId: string | undefined): void
}) {
  // The bar strip is the column gap (wide) or the material's 12 px end padding (narrow).
  const left = (slot: 0 | 1 | 2) => (mode === 'wide' ? `calc(100% + ${SLOT_OFFSETS[slot]}px)` : `calc(100% - 12px + ${SLOT_OFFSETS[slot]}px)`)
  return <div className="gate-overlay">
    {newBlocks.map((key) => {
      const box = boxes[key]
      return box ? <span key={key} className="gate-new-tag" aria-hidden="true" data-block={key} style={{ top: box.top }} /> : null
    })}
    {bars.map((bar) => {
      const box = boxes[bar.block]
      return box ? <button key={`${bar.block}:${bar.slot}`} type="button" className={`gate-change-bar gate-change-bar--${bar.tone}`} data-block={bar.block} data-slot={bar.slot}
        aria-label={bar.label} style={{ top: box.top, height: box.height, left: left(bar.slot) }}
        onClick={() => onActivate(bar.cardIds)} onMouseEnter={() => onLink(bar.cardIds[0])} onMouseLeave={() => onLink(undefined)}
        onFocus={() => onLink(bar.cardIds[0])} onBlur={() => onLink(undefined)} /> : null
    })}
  </div>
})
