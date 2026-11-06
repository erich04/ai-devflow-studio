/**
 * Per-opinion revision drafts of #247, kept only so `useRevisionLists` can import them into the
 * versioned revision lists once (design §3.3, §5.5). Nothing writes this format any more.
 */
export type RevisionSuggestion = {
  reviewId: string
  /** Index of the opinion in that review's missingEvidence. */
  index: number
  /** The review's opinion as it was when the draft started. */
  issue: string
  /** What the user verified, e.g. a conclusion reached in the discussion. */
  finding: string
  /** The concrete change the user wants in the next version. */
  change: string
}

/** Drafts keyed by the requirement version (artifact id) they revise. */
export type RevisionSuggestionStore = Record<string, RevisionSuggestion[]>

export const REVISION_SUGGESTIONS_STORAGE_KEY = 'devflow-revision-suggestions'

function isSuggestion(value: unknown): value is RevisionSuggestion {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.reviewId === 'string' && Number.isInteger(item.index) && (item.index as number) >= 0 &&
    typeof item.issue === 'string' && typeof item.finding === 'string' && typeof item.change === 'string'
}

/** Reads stored drafts, dropping anything malformed instead of failing the page. */
export function parseRevisionSuggestionStore(raw: string | null): RevisionSuggestionStore {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([revisionId, list]) =>
      Array.isArray(list) ? [[revisionId, list.filter(isSuggestion)]] : []))
  } catch {
    return {}
  }
}
