import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isNarrowWidth, type GateLayoutMode } from '../../app/gate-decision/layout'
import { parseBlockKey, type Range } from '../../app/gate-decision/material'
import { useDecisionPage } from './DecisionPageContext'
import { useMarginLayout } from './useMarginLayout'
const FLASH_MS = 1_200
const SCROLL_OFFSET = 8
type Linked = { cardId?: string | undefined; block?: Range | undefined }
const intersects = (a: Range, b: Range) => a.start < b.end && a.end > b.start
export function useDecisionWorkspace(content: string, history: boolean) {
  const scope = useDecisionPage(), view = scope.view
  const workspaceRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<HTMLDivElement>(null)
  const marginRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<GateLayoutMode>('wide')
  const [linked, setLinkedState] = useState<Linked>({})
  const [flashing, setFlashing] = useState<string>()
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  useLayoutEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    setMode(isNarrowWidth(element.getBoundingClientRect().width) ? 'narrow' : 'wide')
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setMode(isNarrowWidth(width) ? 'narrow' : 'wide')
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const narrow = mode === 'narrow'
  const cards = useMemo(() => (scope.onlyUnhandled ? view.margin.cards.filter((card) => ['open', 'fixing', 'retesting'].includes(card.status)) : view.margin.cards), [scope.onlyUnhandled, view.margin.cards])
  const layoutCards = useMemo(() => cards.map((card) => ({ id: card.id, kind: card.kind, number: card.number, status: card.status, ...(card.anchor ? { anchor: card.anchor } : {}) })), [cards])
  const layout = useMarginLayout({ workspace: workspaceRef, material: materialRef, margin: marginRef, cards: layoutCards, content, mode, order: scope.marginOrder })
  // Narrow markers: located cards at their anchor block, unlocated ones in the overview row.
  const markerSignature = narrow ? JSON.stringify(view.margin.navigationOrder.filter((id) => cards.some((card) => card.id === id))
    .map((id) => cards.find((card) => card.id === id)!).filter((card) => card.anchor).map((card) => [card.anchor, card.id])) : '[]'
  const markers = useMemo(() => {
    const byBlock: Record<string, string[]> = {}
    for (const [anchor, id] of JSON.parse(markerSignature) as Array<[string, string]>) (byBlock[anchor] ??= []).push(id)
    return byBlock
  }, [markerSignature])
  const unlocated = narrow ? view.margin.navigationOrder.filter((id) => cards.some((card) => card.id === id && !card.anchor)) : []
  // Hover link (§5.7): state here, so the material never re-renders for it.
  const setLinked = useCallback((next: Linked) => setLinkedState((previous) =>
    previous.cardId === next.cardId && previous.block?.start === next.block?.start && previous.block?.end === next.block?.end ? previous : next), [])
  const onCardLink = useCallback((cardId: string | undefined) => setLinked(cardId ? { cardId } : {}), [setLinked])
  const onBlockLink = useCallback((block: Range | undefined) => setLinked(block ? { block } : {}), [setLinked])
  const linkedIds = useMemo(() => new Set(linked.cardId ? [linked.cardId]
    : linked.block ? view.margin.cards.filter((card) => card.ranges.some((range) => intersects(range, linked.block!))).map((card) => card.id) : []),
  [linked, view.margin.cards])
  const marked = useRef<Element[]>([])
  useLayoutEffect(() => {
    for (const element of marked.current) element.classList.remove('is-linked')
    marked.current = []
    const column = materialRef.current
    if (!column) return
    const keys = new Set(view.margin.cards.filter((card) => linkedIds.has(card.id)).flatMap((card) => card.blocks))
    for (const key of keys) {
      const { start, end } = parseBlockKey(key)
      for (const element of Array.from(column.querySelectorAll(`[data-block-start="${start}"][data-block-end="${end}"]`))) {
        element.classList.add('is-linked')
        marked.current.push(element)
      }
    }
  }, [linkedIds, view.margin.cards])
  const targetOf = useCallback((cardId: string) => (narrow
    ? workspaceRef.current?.querySelector<HTMLElement>(`.gate-marker[data-card-id="${CSS.escape(cardId)}"]`)
    : marginRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)) ?? undefined, [narrow])
  const reveal = useCallback((element: HTMLElement, cardId: string) => {
    const container = element.closest('.inspector-document-scroll')
    if (container) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - SCROLL_OFFSET
    clearTimeout(flashTimer.current)
    // Cards re-render on focus (hover link), so their flash is state; a marker's class is stable.
    if (narrow) {
      element.classList.add('is-flashing')
      flashTimer.current = setTimeout(() => element.classList.remove('is-flashing'), FLASH_MS)
    } else {
      setFlashing(cardId)
      flashTimer.current = setTimeout(() => setFlashing(undefined), FLASH_MS)
    }
    element.focus({ preventScroll: true })
  }, [narrow])
  // Bar controls store `pendingFocus`; it is consumed after the first placement pass (3.26).
  const { pendingFocus, clearPendingFocus, setLastVisitedCardId } = scope
  useEffect(() => {
    if (!pendingFocus || layout.pass === 0 || history) return
    const element = targetOf(pendingFocus.cardId)
    if (element) {
      reveal(element, pendingFocus.cardId)
      setLastVisitedCardId(pendingFocus.cardId)
    }
    clearPendingFocus(pendingFocus.serial)
  }, [pendingFocus, layout.pass, history, targetOf, reveal, clearPendingFocus, setLastVisitedCardId])
  const onBarActivate = useCallback((cardIds: readonly string[]) => {
    const element = cardIds[0] ? targetOf(cardIds[0]) : undefined
    if (!element) return
    if (narrow) element.click()
    else element.focus({ preventScroll: true })
  }, [narrow, targetOf])
  return { workspaceRef, materialRef, marginRef, mode, narrow, cards, layout, markers, unlocated, onCardLink, onBlockLink, linkedIds, flashing, onBarActivate }
}
