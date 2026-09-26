import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Read-only details anchored to a toolbar or citation, outside clipped scroll panes. */
export function DetailPopover({ label, children, title, className = '', hoverPreview = false }: {
  label: ReactNode; title: string; children: ReactNode; className?: string; hoverPreview?: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [mode, setMode] = useState<'closed' | 'preview' | 'pinned'>('closed')
  const open = mode !== 'closed'
  const [position, setPosition] = useState({ top: 0, left: 0, width: 420, maxHeight: window.innerHeight - 24 })
  const clearTimer = () => { clearTimeout(timer.current) }
  const close = () => { clearTimer(); setMode('closed'); trigger.current?.focus({ preventScroll: true }) }
  const leave = () => { clearTimer(); if (mode === 'preview') timer.current = setTimeout(() => setMode('closed'), 180) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const reader = trigger.current?.closest('.inspector-document-scroll')?.getBoundingClientRect()
      const minLeft = Math.max(12, (reader?.left ?? 0) + 8)
      const maxRight = Math.min(window.innerWidth - 12, (reader?.right ?? window.innerWidth) - 8)
      const minTop = Math.max(12, reader?.top ?? 12)
      const maxBottom = Math.min(window.innerHeight - 12, reader?.bottom ?? window.innerHeight - 12)
      const width = Math.min(420, maxRight - minLeft)
      const maxHeight = Math.max(96, maxBottom - minTop)
      const height = panel.current?.getBoundingClientRect().height ?? 0
      setPosition({ width, maxHeight, left: Math.max(minLeft, Math.min(anchor.left, maxRight - width)),
        top: Math.max(minTop, Math.min(anchor.bottom + 6, maxBottom - Math.min(height, maxHeight))) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, children])
  useEffect(() => {
    if (mode === 'pinned') panel.current?.focus({ preventScroll: true })
  }, [mode])
  useEffect(() => {
    if (!open) return
    document.dispatchEvent(new CustomEvent('devflow:detail-open', { detail: id }))
    const anotherOpened = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setMode('closed') }
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMode('closed')
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('devflow:detail-open', anotherOpened)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); document.removeEventListener('devflow:detail-open', anotherOpened) }
  }, [open, id])
  return <>
    <button type="button" ref={trigger} className={className} aria-label={title} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onMouseEnter={() => { clearTimer(); if (hoverPreview && mode === 'closed') timer.current = setTimeout(() => setMode('preview'), 200) }} onMouseLeave={leave}
      onClick={() => { clearTimer(); setMode(mode === 'pinned' ? 'closed' : 'pinned') }}>{label}</button>
    {open && createPortal(<div id={id} ref={panel} className="detail-popover" role="dialog" aria-label={title} tabIndex={-1} style={position}
      onMouseEnter={clearTimer} onMouseLeave={leave} onFocusCapture={() => setMode('pinned')}>
      <header><strong>{title}</strong><button type="button" className="text-button" aria-label={`关闭${title}`} onClick={close}><X size={16} /></button></header>
      {hoverPreview && <p className="meta">{mode === 'preview' ? '悬停预览，点击意见标记可固定。' : '已固定，可按 Escape 关闭。'}</p>}
      {children}
    </div>, document.body)}
  </>
}
