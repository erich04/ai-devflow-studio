import { useEffect, useRef, useState } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { CostLineLink, GateButton, NoteLink } from '../../app/gate-decision/projection'
import { useDecisionPage } from './DecisionPageContext'
import { RevisionListPanel } from './RevisionListPanel'

const BUMP_MS = 1_700

/**
 * The decision bar (design §3.2, §5.3): replaces the status row above the tabs, so the
 * conclusion, the confirm button and 「停止」 are visible on every tab.
 */
export function GateDecisionBar() {
  const scope = useDecisionPage()
  const { view, actions } = scope
  const bar = view.bar
  const prose = (text: string, raw?: readonly string[]) => scope.renderText?.(text, raw) ?? text
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bumped, setBumped] = useState(false)
  const lastCount = useRef(bar.list.count)
  useEffect(() => {
    const previous = lastCount.current
    lastCount.current = bar.list.count
    // An item added from anywhere bumps the toggle; nothing expands and nothing scrolls (FR-9.1).
    if (previous === undefined || bar.list.count === undefined || bar.list.count <= previous) return
    setBumped(true)
    const timer = setTimeout(() => setBumped(false), BUMP_MS)
    return () => clearTimeout(timer)
  }, [bar.list.count])
  const [rejecting, setRejecting] = useState<string>()
  const [reason, setReason] = useState('')
  const click = (item: GateButton) => {
    if (item.confirmBefore && scope.armed !== item.id) { scope.setArmed(item.id); return }
    scope.setArmed(undefined)
    if (item.reason) { setRejecting(item.id); setReason(''); return }
    scope.dispatch(item)
  }
  const linkAction = (link: NoteLink | CostLineLink) => {
    if (link.action === 'openStageSettings') setSettingsOpen(open => !open)
    else scope.dispatchLink(link)
  }
  const armedButton = bar.buttons.find((item) => item.id === scope.armed)
  const technical = [...bar.meta.technical, ...bar.notes.filter((note) => note.technical).map((note) => ({ label: note.text, value: note.technical! }))]
  return <section className={`gate-decision-bar gate-decision-bar--${bar.mode}`} data-testid="gate-decision-bar" data-row={bar.row} data-first-layer={scope.renderText ? true : undefined} aria-label="你的决定">
    <div className="gate-bar-head">
      <h2 className="gate-bar-title">{bar.mode === 'running' ? <span className="gate-spinner" aria-hidden="true" /> : null}{prose(bar.title)}</h2>
      {bar.progress ? <p className={`gate-bar-progress${bar.progress.done ? ' is-done' : ''}`}>
        <span>{prose(bar.progress.text)}</span>
        {bar.progress.showNext ? <button type="button" className="text-button" onClick={scope.goNext}>{gateCopy.nextButton}</button> : null}
      </p> : null}
    </div>
    {bar.notes.map((note, index) => <p key={`${index}:${note.text}`} className={`gate-note gate-note--${note.tone}`}>
      <span>{prose(note.text, note.raw)}</span>
      {note.link ? <button type="button" className="text-button" disabled={'busy' in note.link && note.link.busy} onClick={() => linkAction(note.link!)}>{note.link.label}</button> : null}
    </p>)}
    {scope.storageNotes.map((text) => <p key={text} className="gate-note gate-note--warn" role="alert">{text}</p>)}
    {bar.buttons.length || bar.stop || bar.costLines.length ? <div className="gate-bar-actions">
      <div className="gate-bar-buttons">
        {bar.buttons.map((item) => <button key={item.id} type="button" className={`${item.primary ? 'primary-button' : 'ghost-button'}${item.danger ? ' danger-button' : ''}`} disabled={!item.enabled}
          {...(item.disabledReason ? { title: item.disabledReason, 'aria-description': item.disabledReason } : {})}
          {...(item.confirmBefore && scope.armed === item.id ? { 'aria-pressed': true } : {})}
          onClick={() => click(item)}>{item.label}</button>)}
        {bar.stop ? <button type="button" className="ghost-button gate-stop" disabled={bar.stop.busy} onClick={() => scope.stop(bar.stop!.target)}>{bar.stop.busy ? '正在停止…' : gateCopy.stopButton}</button> : null}
      </div>
      {bar.costLines.length ? <div className="gate-bar-costs">
        {bar.costLines.map((line, index) => <p key={`${line.kind}:${line.buttonId ?? index}`} className="meta">
          <span>{line.buttonId && bar.costLines.length > 1 ? <strong>{bar.buttons.find(b => b.id === line.buttonId)?.label.replace(/（\d+ 项）$/u, '')}：</strong> : null}{prose(line.text)}</span>
          {line.link ? <> · <button type="button" className="text-button" aria-expanded={line.link.action === 'openStageSettings' ? settingsOpen : undefined}
            onClick={() => linkAction(line.link!)}>{line.link.label}</button></> : null}
        </p>)}
      </div> : null}
    </div> : null}
    {bar.buttons.filter(b => b.id === rejecting && b.reason).map(item => <form key={item.id} className="gate-reject-reason" onSubmit={event => { event.preventDefault(); if (reason.length <= 1000 && item.enabled) { scope.dispatch(item, { reason }); setRejecting(undefined) } }}>
      <label>{item.reason!.label}<textarea value={reason} placeholder={item.reason!.placeholder} onChange={event => setReason(event.target.value)} /></label>
      {reason.length > 1000 ? <p role="alert">最多 1000 字，现在 {reason.length} 字。</p> : null}
      <button type="submit" className="ghost-button danger-button" disabled={!item.enabled || reason.length > 1000}>{item.reason!.confirmLabel}</button>
      <button type="button" className="text-button" onClick={() => setRejecting(undefined)}>{item.reason!.cancelLabel}</button>
    </form>)}
    {armedButton?.confirmBefore ? <p className="gate-note gate-note--warn gate-confirm-before" role="status">{armedButton.confirmBefore}</p> : null}
    {settingsOpen && actions.renderStageSettings ? <div className="gate-bar-settings">{actions.renderStageSettings()}</div> : null}
    {bar.list.toggleEnabled || bar.list.toggleLabel ? <div className="gate-bar-list">
      <button type="button" className={`text-button gate-list-toggle${bumped ? ' is-bumped' : ''}`} aria-expanded={scope.listExpanded}
        disabled={!bar.list.toggleEnabled} onClick={() => scope.setListExpanded(!scope.listExpanded)}>
        {bar.list.toggleLabel} {scope.listExpanded ? '▴' : '▾'}
      </button>
      {scope.listExpanded && bar.list.toggleEnabled ? <RevisionListPanel /> : null}
    </div> : null}
    <div className="gate-bar-meta meta">
      {bar.meta.role ? <span>{bar.meta.role}</span> : null}
      {bar.meta.review ? <span>{bar.meta.review}</span> : null}
      {bar.meta.rerun ? <button type="button" className="text-button" disabled={!bar.meta.rerun.enabled}
        {...(bar.meta.rerun.disabledReason ? { title: bar.meta.rerun.disabledReason, 'aria-description': bar.meta.rerun.disabledReason } : {})}
        onClick={() => scope.dispatch({ id: 'review', label: '', enabled: true, primary: false })}>{gateCopy.rerunReview}</button> : null}
      {bar.meta.changeReviewModel && !bar.costLines.some((line) => line.kind === 'review') ? <button type="button" className="text-button" onClick={() => scope.dispatchLink({ action: 'openModelSettings', label: '打开模型与执行方式设置' })}>{gateCopy.changeReviewModel}</button> : null}
      {bar.meta.deadline ? <span className={`gate-note--${bar.meta.deadline.tone}`}>{bar.meta.deadline.text}</span> : null}
      {bar.meta.extra?.map(text => <span key={text}>{text}</span>)}
      {bar.meta.freshness ? <span>{bar.meta.freshness}</span> : null}
      {bar.meta.stepNote ? <span>{bar.meta.stepNote}</span> : null}
      <details className="gate-technical" data-technical-details>
        <summary>{gateCopy.technicalDetails} ▸</summary>
        <dl>{technical.map((item, index) => <div key={`${index}:${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      </details>
    </div>
  </section>
}
