import { useEffect, useRef, useState } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { CostLineLink, GateButton, NoteLink } from '../../app/gate-decision/projection'
import { useGateScope } from './GateDecisionScope'
import { RevisionListPanel } from './RevisionListPanel'

const BUMP_MS = 1_700

/**
 * The decision bar (design §3.2, §5.3): replaces the status row above the tabs, so the
 * conclusion, the confirm button and 「停止」 are visible on every tab.
 */
export function GateDecisionBar() {
  const scope = useGateScope()
  const { view, actions, input } = scope
  const bar = view.bar
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
  const writeContext = { current: input.current.artifact, ...(scope.listTarget ? { target: scope.listTarget } : {}), ...(scope.designIdentity ? { designIdentity: scope.designIdentity } : {}) }
  const run = (item: GateButton) => {
    switch (item.id) {
      case 'review': return actions.onRequestReview()
      case 'submit': return actions.onSubmit({ ...writeContext, text: bar.list.composedText, itemCount: bar.list.count ?? 0,
        proposals: bar.list.proposalIds.map((id) => input.chatItems?.find((chat) => chat.proposal.id === id)?.proposal).filter((proposal) => proposal !== undefined) })
      case 'confirm':
      case 'confirmWithout': return actions.onConfirm({ ...writeContext, unsubmittedCount: bar.list.count ?? 0 })
      case 'regenerate': return actions.onRegenerate()
      case 'syncTeam': return actions.onSyncTeam()
      case 'reloadPolicy': return actions.onReloadPolicy()
      case 'recheck': return scope.retry()
      case 'returnToCurrent': return scope.showCurrentVersion()
    }
  }
  const click = (item: GateButton) => {
    if (item.confirmBefore && scope.armed !== item.id) { scope.setArmed(item.id); return }
    scope.setArmed(undefined)
    run(item)
  }
  const linkAction = (link: NoteLink | CostLineLink) => {
    if (link.action === 'openModelSettings') actions.onOpenModelSettings()
    else if (link.action === 'openStageSettings') setSettingsOpen((open) => !open)
    else actions.onOpenVersion(link.artifactId)
  }
  const armedButton = bar.buttons.find((item) => item.id === scope.armed)
  const technical = [...bar.meta.technical, ...bar.notes.filter((note) => note.technical).map((note) => ({ label: note.text, value: note.technical! }))]
  return <section className={`gate-decision-bar gate-decision-bar--${bar.mode}`} data-testid="gate-decision-bar" data-row={bar.row} aria-label="你的决定">
    <div className="gate-bar-head">
      <h2 className="gate-bar-title">{bar.mode === 'running' ? <span className="gate-spinner" aria-hidden="true" /> : null}{bar.title}</h2>
      {bar.progress ? <p className={`gate-bar-progress${bar.progress.done ? ' is-done' : ''}`}>
        <span>{bar.progress.text}</span>
        {bar.progress.showNext ? <button type="button" className="text-button" onClick={scope.goNext}>{gateCopy.nextButton}</button> : null}
      </p> : null}
    </div>
    {bar.notes.map((note, index) => <p key={`${index}:${note.text}`} className={`gate-note gate-note--${note.tone}`}>
      <span>{note.text}</span>
      {note.link ? <button type="button" className="text-button" onClick={() => linkAction(note.link!)}>{note.link.label}</button> : null}
    </p>)}
    {scope.storageNotes.map((text) => <p key={text} className="gate-note gate-note--warn" role="alert">{text}</p>)}
    {bar.buttons.length || bar.stop || bar.costLines.length ? <div className="gate-bar-actions">
      <div className="gate-bar-buttons">
        {bar.buttons.map((item) => <button key={item.id} type="button" className={item.primary ? 'primary-button' : 'ghost-button'} disabled={!item.enabled}
          {...(item.disabledReason ? { title: item.disabledReason, 'aria-description': item.disabledReason } : {})}
          {...(item.confirmBefore && scope.armed === item.id ? { 'aria-pressed': true } : {})}
          onClick={() => click(item)}>{item.label}</button>)}
        {bar.stop ? <button type="button" className="ghost-button gate-stop" onClick={() => actions.onStop(bar.stop!.target)}>{gateCopy.stopButton}</button> : null}
      </div>
      {bar.costLines.length ? <div className="gate-bar-costs">
        {bar.costLines.map((line) => <p key={line.kind} className="meta">
          <span>{line.text}</span>
          {line.link ? <> · <button type="button" className="text-button" aria-expanded={line.link.action === 'openStageSettings' ? settingsOpen : undefined}
            onClick={() => linkAction(line.link!)}>{line.link.label}</button></> : null}
        </p>)}
      </div> : null}
    </div> : null}
    {armedButton?.confirmBefore ? <p className="gate-note gate-note--warn gate-confirm-before" role="status">{armedButton.confirmBefore}</p> : null}
    {settingsOpen && actions.renderStageSettings ? <div className="gate-bar-settings">{actions.renderStageSettings()}</div> : null}
    <div className="gate-bar-list">
      <button type="button" className={`text-button gate-list-toggle${bumped ? ' is-bumped' : ''}`} aria-expanded={scope.listExpanded}
        disabled={!bar.list.toggleEnabled} onClick={() => scope.setListExpanded(!scope.listExpanded)}>
        {bar.list.toggleLabel} {scope.listExpanded ? '▴' : '▾'}
      </button>
      {scope.listExpanded && bar.list.toggleEnabled ? <RevisionListPanel settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} /> : null}
    </div>
    <div className="gate-bar-meta meta">
      {bar.meta.role ? <span>{bar.meta.role}</span> : null}
      {bar.meta.review ? <span>{bar.meta.review}</span> : null}
      {bar.meta.rerun ? <button type="button" className="text-button" disabled={!bar.meta.rerun.enabled}
        {...(bar.meta.rerun.disabledReason ? { title: bar.meta.rerun.disabledReason, 'aria-description': bar.meta.rerun.disabledReason } : {})}
        onClick={actions.onRequestReview}>{gateCopy.rerunReview}</button> : null}
      {bar.meta.changeReviewModel && !bar.costLines.some((line) => line.kind === 'review') ? <button type="button" className="text-button" onClick={actions.onOpenModelSettings}>{gateCopy.changeReviewModel}</button> : null}
      {bar.meta.freshness ? <span>{bar.meta.freshness}</span> : null}
      {bar.meta.stepNote ? <span>{bar.meta.stepNote}</span> : null}
      <details className="gate-technical">
        <summary>{gateCopy.technicalDetails} ▸</summary>
        <dl>{technical.map((item, index) => <div key={`${index}:${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      </details>
    </div>
  </section>
}
