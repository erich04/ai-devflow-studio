import { useCallback, useMemo, useRef, useState } from 'react'
import { gateCopy } from './gate-decision/copy'
import {
  applyRevisionListOp,
  emptyRevisionList,
  importLegacyDrafts,
  listKey,
  parseRevisionListStore,
  REVISION_LISTS_STORAGE_KEY,
  type ListTarget,
  type RevisionListOp,
  type RevisionListOpResult,
  type RevisionListStore,
  type StoredRevisionList,
} from './gate-decision/revision-list'
import { parseRevisionSuggestionStore, REVISION_SUGGESTIONS_STORAGE_KEY, type RevisionSuggestionStore } from './revision-suggestions'
/** The #247 free-text drafts, keyed by requirement artifact id. */
export const REVISION_DRAFTS_STORAGE_KEY = 'devflow-revision-drafts'
function readDrafts(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REVISION_DRAFTS_STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      : {}
  } catch {
    return {}
  }
}
function readStorage(): { store: RevisionListStore; dropped: number; suggestions: RevisionSuggestionStore; drafts: Record<string, string> } {
  let raw: string | null = null
  let suggestions: RevisionSuggestionStore = {}
  let unreadable = 0
  try {
    raw = localStorage.getItem(REVISION_LISTS_STORAGE_KEY)
    suggestions = parseRevisionSuggestionStore(localStorage.getItem(REVISION_SUGGESTIONS_STORAGE_KEY))
  } catch {
    unreadable = 1
  }
  const parsed = parseRevisionListStore(raw)
  return { store: parsed.store, dropped: parsed.dropped + unreadable, suggestions, drafts: readDrafts() }
}
export type RevisionListsApi = {
  store: RevisionListStore
  /** The stored list of `target`, or the in-memory import of its #247 drafts. */
  listFor(target: ListTarget): StoredRevisionList | undefined
  /** Applies one operation; a failed save keeps the change in memory and returns the alert. */
  apply(target: ListTarget, op: RevisionListOp): RevisionListOpResult
  /** "本机修订清单中有 N 条记录无法读取，已忽略。" when entries were dropped. */
  droppedNotice?: string
  saveError?: string
}
/**
 * Versioned local revision lists (design §3.3, §5.5). Imported #247 drafts stay in memory until
 * the first save of that artifact's list, which deletes them from the two old keys so they can
 * never be imported twice.
 */
export function useRevisionLists(): RevisionListsApi {
  const [initial] = useState(readStorage)
  const [importedAt] = useState(() => new Date().toISOString())
  const [store, setStore] = useState(initial.store)
  const [legacy, setLegacy] = useState({ suggestions: initial.suggestions, drafts: initial.drafts })
  const [saveError, setSaveError] = useState<string>()
  const storeRef = useRef(store)
  storeRef.current = store
  const legacyRef = useRef(legacy)
  legacyRef.current = legacy
  const imported = useCallback((target: ListTarget, source = legacyRef.current): StoredRevisionList | undefined => {
    if (target.kind !== 'requirement') return undefined
    const suggestions = source.suggestions[target.artifactId] ?? []
    const draft = source.drafts[target.artifactId]
    if (!suggestions.length && !draft?.trim()) return undefined
    return { ...emptyRevisionList(target, importedAt), items: importLegacyDrafts(target.artifactId, suggestions, draft, importedAt) }
  }, [importedAt])
  const listFor = useCallback((target: ListTarget) => store.lists[listKey(target)] ?? imported(target, legacy), [store, legacy, imported])
  const apply = useCallback((target: ListTarget, op: RevisionListOp): RevisionListOpResult => {
    const key = listKey(target)
    const now = new Date().toISOString()
    const fromLegacy = !storeRef.current.lists[key] ? imported(target) : undefined
    const current = storeRef.current.lists[key] ?? fromLegacy ?? emptyRevisionList(target, now)
    const result = applyRevisionListOp(current, op, now)
    if (!result.ok) return result
    const next: RevisionListStore = { version: 1, lists: { ...storeRef.current.lists, [key]: result.list } }
    storeRef.current = next
    setStore(next)
    try {
      localStorage.setItem(REVISION_LISTS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      setSaveError(gateCopy.storageSaveFailed)
      return { ok: false, message: gateCopy.storageSaveFailed }
    }
    setSaveError(undefined)
    const source = legacyRef.current
    if (target.kind === 'requirement' && (source.suggestions[target.artifactId] || target.artifactId in source.drafts)) {
      const { [target.artifactId]: _suggestion, ...suggestions } = source.suggestions
      const { [target.artifactId]: _draft, ...drafts } = source.drafts
      const cleared = { suggestions, drafts }
      legacyRef.current = cleared
      setLegacy(cleared)
      try {
        // Re-read the old keys so entries written meanwhile by the old form are kept.
        const storedSuggestions = parseRevisionSuggestionStore(localStorage.getItem(REVISION_SUGGESTIONS_STORAGE_KEY))
        delete storedSuggestions[target.artifactId]
        localStorage.setItem(REVISION_SUGGESTIONS_STORAGE_KEY, JSON.stringify(storedSuggestions))
        const storedDrafts = readDrafts()
        delete storedDrafts[target.artifactId]
        localStorage.setItem(REVISION_DRAFTS_STORAGE_KEY, JSON.stringify(storedDrafts))
      } catch { /* The new list is saved; a stale old entry is only re-imported into memory, never twice into storage. */ }
    }
    return result
  }, [imported])
  return useMemo(() => ({
    store, listFor, apply,
    ...(initial.dropped ? { droppedNotice: gateCopy.storageDropped(initial.dropped) } : {}),
    ...(saveError ? { saveError } : {}),
  }), [store, listFor, apply, initial.dropped, saveError])
}
