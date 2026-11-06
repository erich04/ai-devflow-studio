import { memo, type ReactNode, type RefObject } from 'react'
import type { GateLayoutMode } from '../../app/gate-decision/layout'
import { parseBlockKey, type BlockKey, type Range } from '../../app/gate-decision/material'
import type { BarView } from '../../app/gate-decision/projection'
import { MaterialOverlay, type BlockBoxes } from './MaterialOverlay'

export const MaterialFrame = memo(function MaterialFrame({ materialRef, testId, mode, boxes, newBlocks, bars, onBlockLink, onCardLink, onBarActivate, children }: {
  materialRef: RefObject<HTMLDivElement | null>; testId: string; mode: GateLayoutMode; boxes: BlockBoxes; newBlocks: readonly BlockKey[]; bars: readonly BarView[]
  onBlockLink(block: Range | undefined): void; onCardLink(id: string | undefined): void; onBarActivate(ids: readonly string[]): void; children: ReactNode
}) {
  const linkFrom = (target: EventTarget | null) => {
    const element = (target as Element | null)?.closest?.('[data-block-start]')
    onBlockLink(element && materialRef.current?.contains(element) ? parseBlockKey(`${element.getAttribute('data-block-start')}:${element.getAttribute('data-block-end')}` as BlockKey) : undefined)
  }
  return <div ref={materialRef} className="gate-material material-document" data-testid={testId} onMouseOver={e => linkFrom(e.target)} onMouseLeave={() => onBlockLink(undefined)} onFocus={e => linkFrom(e.target)}>
    {children}
    <MaterialOverlay mode={mode} boxes={boxes} newBlocks={newBlocks} bars={bars} onActivate={onBarActivate} onLink={onCardLink} />
  </div>
})
