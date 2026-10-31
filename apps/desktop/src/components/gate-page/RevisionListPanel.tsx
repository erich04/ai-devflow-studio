import { useEffect, useRef, useState } from 'react'
import { gateCopy } from '../../app/gate-decision/copy'
import type { ListItemView } from '../../app/gate-decision/projection'
import { checkItemText, MAX_REVISION_ITEM_CHARACTERS } from '../../app/gate-decision/revision-list'
import { useGateScope } from './GateDecisionScope'

const FLASH_MS = 1_200
const OWN_DRAFT = 'list:own'
const editKey = (itemId: string) => `list:edit:${itemId}`

/** The revision list inside the bar (design §5.5, FR-9). Every change goes through the list reducer. */
export function RevisionListPanel({ settingsOpen, onToggleSettings }: { settingsOpen: boolean; onToggleSettings(): void }) {
  const scope = useGateScope()
  const { view, drafts, setDraft, apply, actions } = scope
  const list = view.bar.list
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<string>()
  const [flashing, setFlashing] = useState<string>()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const flash = scope.flashItem
    if (!flash) return
    setFlashing(flash.itemId)
    panel.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(flash.itemId)}"]`)?.scrollIntoView?.({ block: 'nearest' })
    const timer = setTimeout(() => setFlashing(undefined), FLASH_MS)
    return () => clearTimeout(timer)
  }, [scope.flashItem])
  const fail = (key: string, message: string | undefined) => setErrors((previous) => {
    if (!message) { const { [key]: _removed, ...rest } = previous; return rest }
    return { ...previous, [key]: message }
  })
  const addOwn = () => {
    const checked = checkItemText(drafts[OWN_DRAFT] ?? '')
    if (!checked.ok) return fail(OWN_DRAFT, checked.message)
    const result = apply({ type: 'addOwn', text: checked.text })
    fail(OWN_DRAFT, result.ok ? undefined : result.message)
    if (result.ok) setDraft(OWN_DRAFT, undefined)
  }
  const saveEdit = (item: ListItemView) => {
    const key = editKey(item.id)
    const text = drafts[key] ?? ''
    let result
    if (item.source === 'chat') {
      if (text.trim().length > MAX_REVISION_ITEM_CHARACTERS) return fail(key, gateCopy.noteTooLong(text.trim().length))
      result = apply({ type: 'chatNote', proposalId: item.proposalId!, note: text })
    } else {
      const checked = checkItemText(text)
      if (!checked.ok) return fail(key, checked.message)
      result = apply({ type: 'edit', itemId: item.id, text: checked.text })
    }
    fail(key, result.ok ? undefined : result.message)
    if (result.ok) setDraft(key, undefined)
  }
  const remove = (item: ListItemView) => {
    const result = item.source === 'chat' ? apply({ type: 'chatRemove', proposalId: item.proposalId! }) : apply({ type: 'remove', itemId: item.id })
    fail(item.id, result.ok ? undefined : result.message)
  }
  const openSource = (item: ListItemView) => {
    if (item.source === 'chat' && item.proposalId) actions.onFocusChatItem?.(item.proposalId)
    else if (item.cardId) scope.focusCard(item.cardId)
  }
  const ownText = drafts[OWN_DRAFT]
  return <div className="gate-list-panel" ref={panel} role="region" aria-label={list.header}>
    <header className="gate-list-header">
      <strong>{list.header}</strong>
      {list.actionable && ownText === undefined ? <button type="button" className="text-button" onClick={() => setDraft(OWN_DRAFT, '')}>{list.addLabel}</button> : null}
    </header>
    {list.readOnlyReason ? <p className="meta">{list.readOnlyReason}</p> : null}
    {list.actionable && ownText !== undefined ? <form className="gate-list-own" onSubmit={(event) => { event.preventDefault(); addOwn() }}>
      <textarea aria-label="其他修改" placeholder={list.addPlaceholder} value={ownText} onChange={(event) => setDraft(OWN_DRAFT, event.target.value)} />
      {errors[OWN_DRAFT] ? <p role="alert" className="gate-note gate-note--warn">{errors[OWN_DRAFT]}</p> : null}
      <button type="submit" className="ghost-button">加入修订清单</button>
      <button type="button" className="text-button" onClick={() => { setDraft(OWN_DRAFT, undefined); fail(OWN_DRAFT, undefined) }}>取消</button>
    </form> : null}
    {list.submittedText !== undefined ? <pre className="gate-list-submitted">{list.submittedText}</pre>
      : list.items.length === 0 ? <p className="meta gate-list-empty">{list.emptyText}</p>
        : <ol className="gate-list-items">
          {list.items.map((item) => {
            const key = editKey(item.id)
            const editing = drafts[key] !== undefined
            const sourceButton = item.source === 'own'
              ? <span className="gate-list-source" title={item.detail} aria-description={item.detail}>{item.label}</span>
              : <button type="button" className="text-button gate-list-source" title={item.detail} aria-description={item.detail} onClick={() => openSource(item)}>{item.label}</button>
            return <li key={item.id} data-item-id={item.id} className={flashing === item.id ? 'is-flashing' : undefined}>
              <span className="gate-list-number">{item.number}.</span>
              {sourceButton}
              {item.tag ? <span className="gate-list-tag">{item.tag}</span> : null}
              {editing ? <form className="gate-list-edit" onSubmit={(event) => { event.preventDefault(); saveEdit(item) }}>
                <textarea aria-label={`第 ${item.number} 项`} value={drafts[key]} onChange={(event) => setDraft(key, event.target.value)} />
                {errors[key] ? <p role="alert" className="gate-note gate-note--warn">{errors[key]}</p> : null}
                <button type="submit" className="ghost-button">保存</button>
                <button type="button" className="text-button" onClick={() => { setDraft(key, undefined); fail(key, undefined) }}>取消</button>
              </form> : <span className="gate-list-text">{item.source === 'chat' ? item.proposalTitle : item.text}{item.source === 'chat' && item.text ? `（补充说明：${item.text}）` : ''}</span>}
              {item.source === 'chat' ? <button type="button" className="text-button" aria-expanded={viewing === item.id} onClick={() => setViewing(viewing === item.id ? undefined : item.id)}>{gateCopy.viewButton}</button> : null}
              {list.actionable && !editing ? <>
                <button type="button" className="text-button" onClick={() => setDraft(key, item.text)}>{gateCopy.editButton}</button>
                <button type="button" className="text-button" onClick={() => remove(item)}>{gateCopy.removeButton}</button>
              </> : null}
              {errors[item.id] ? <p role="alert" className="gate-note gate-note--warn">{errors[item.id]}</p> : null}
              {viewing === item.id ? <pre className="gate-list-proposal">{item.proposalBody}</pre> : null}
            </li>
          })}
        </ol>}
    {list.overflowReason ? <p className="gate-note gate-note--warn">{list.overflowReason}</p> : null}
    {list.actionable && list.generationLine ? <p className="meta gate-list-generation">
      <span>{list.generationLine}</span> · <button type="button" className="text-button" aria-expanded={settingsOpen} onClick={onToggleSettings}>{gateCopy.changeStageSettings}</button>
    </p> : null}
  </div>
}
