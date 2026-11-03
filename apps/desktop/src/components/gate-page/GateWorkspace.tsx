import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hasSectionContent, partitionArtifact } from '../../app/artifact-sections'
import { gateCopy } from '../../app/gate-decision/copy'
import { gateGridStyle, isNarrowWidth, type GateLayoutMode } from '../../app/gate-decision/layout'
import { parseBlockKey, type Range } from '../../app/gate-decision/material'
import { useGateScope } from './GateDecisionScope'
import { HistoryList } from './HistoryList'
import { MarginColumn } from './MarginColumn'
import { MarginHeader } from './MarginHeader'
import { MaterialColumn } from './MaterialColumn'
import { useMarginLayout } from './useMarginLayout'

const FLASH_MS = 1_200
const SCROLL_OFFSET = 8
type Linked = { cardId?: string | undefined; block?: Range | undefined }
const intersects = (a: Range, b: Range) => a.start < b.end && a.end > b.start

/**
 * The gate workspace (design §5.7, §5.8): material head, material column and the margin, as a
 * grid whose columns come from `gateGridStyle`. Wide or narrow is decided from the measured width
 * before the first paint, then by a `ResizeObserver`; every view state lives in the scope.
 */
export function GateWorkspace({ referenceLinks, revisionHistory }: {
  /** 原始需求 / 代码调查 / 团队规范 links for 阅读工具 (requirement). */
  referenceLinks?: ReactNode
  /** Content of 「版本与修订意见历史」. */
  revisionHistory?: ReactNode
}) {
  const scope = useGateScope()
  const { view, shown, page, kind, history } = scope
  const prefix = useId()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<HTMLDivElement>(null)
  const marginRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<GateLayoutMode>('wide')
  const [raw, setRaw] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
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
  const cards = useMemo(() => (scope.onlyUnhandled ? view.margin.cards.filter((card) => card.status === 'open') : view.margin.cards), [scope.onlyUnhandled, view.margin.cards])
  const layoutCards = useMemo(() => cards.map((card) => ({ id: card.id, kind: card.kind, number: card.number, status: card.status, ...(card.anchor ? { anchor: card.anchor } : {}) })), [cards])
  const layout = useMarginLayout({ workspace: workspaceRef, material: materialRef, margin: marginRef, cards: layoutCards, content: shown.artifact.content, mode })
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
  const sections = useMemo(() => partitionArtifact(shown.artifact.content)
    .filter((section) => section.group !== 'evidence' && section.group !== 'records' && (section.group !== 'questions' || hasSectionContent(section))), [shown.artifact.content])
  const material = view.material
  const rawRequest = scope.input.rawRequest
  const versionLabel = kind === 'requirement' ? '阅读需求版本' : '阅读方案版本'
  return <div ref={workspaceRef} className="gate-workspace" data-layout={mode} style={gateGridStyle(mode)}>
    <div className="gate-margin-head">
      <MarginHeader narrow={narrow} unlocated={unlocated} />
    </div>
    <div className="gate-material-head">
      {material.readOnlyBanner ? <div className="gate-history-banner" role="status">
        <p><span>{material.readOnlyBanner}</span> <button type="button" className="text-button" onClick={scope.showCurrentVersion}>{gateCopy.returnButton(page.current.label)}</button></p>
        {material.historyList ? <HistoryList list={material.historyList} onCopy={scope.actions.onCopy} /> : null}
      </div> : null}
      <div className="gate-material-header">
        <strong>{material.header}</strong>
        <span className="meta">{material.recordedAt}</span>
        {scope.actions.onDiscuss ? <button type="button" className="text-button" onClick={() => scope.actions.onDiscuss?.({
          materialId: shown.artifact.id, materialTitle: shown.artifact.title, version: shown.label, label: shown.label,
        })}>讨论此材料</button> : null}
      </div>
      {material.rawRequest ? <p className="gate-raw-request">
        <span className="gate-raw-request-line">{material.rawRequest}</span>
        <button type="button" className="text-button" aria-expanded={requestOpen} onClick={() => setRequestOpen(!requestOpen)}>{gateCopy.expand}</button>
      </p> : null}
      {requestOpen && rawRequest ? <div className="message-plain gate-raw-request-full">{rawRequest}</div> : null}
      <details className="artifact-reading-tools" data-testid="artifact-reading-tools">
        <summary>阅读工具</summary>
        {page.versions.length > 1 ? <label>阅读版本<select aria-label={versionLabel} value={page.reading.artifact.id}
          onChange={(event) => (event.target.value === page.current.artifact.id ? scope.showCurrentVersion() : scope.actions.onOpenVersion(event.target.value))}>
          {page.versions.map((version) => <option key={version.artifact.id} value={version.artifact.id}>{version.label}</option>)}
        </select></label> : null}
        {referenceLinks}
        {!raw && sections.length > 4 ? <nav className="artifact-toc" aria-label="内容目录">
          {sections.map((section, index) => section.title ? <a key={index} href={`#${prefix}-section-${index}`}>{section.title}</a> : null)}
        </nav> : null}
        <button type="button" className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>
      </details>
    </div>
    <MaterialColumn kind={kind} artifact={shown.artifact} blocks={shown.blocks} newBlocks={material.newBlocks} mode={mode} markers={markers} bars={material.bars}
      boxes={layout.boxes} raw={raw} materialRef={materialRef} sectionIdPrefix={prefix} onBlockLink={onBlockLink} onCardLink={onCardLink}
      onBarActivate={onBarActivate} revisionHistory={revisionHistory} />
    {narrow ? null : <MarginColumn cards={cards} tops={layout.tops} minHeight={layout.minHeight} linkedIds={linkedIds} flashing={flashing} marginRef={marginRef} onLink={onCardLink} />}
  </div>
}
