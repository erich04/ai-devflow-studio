/**
 * Per-opinion revision drafts for a requirement version (#247). A draft keeps the review's original
 * opinion apart from what the user verified and what they want changed. Drafts stay on this machine
 * until the user submits the revision request; saving one never changes the requirement or the Gate.
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
/** Same limit the clarification revision path enforces on the submitted text. */
export const MAX_REVISION_REQUEST_CHARACTERS = 4_000
export const MAX_SUGGESTION_FIELD_CHARACTERS = 1_000

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

const sameOpinion = (item: RevisionSuggestion, reviewId: string, index: number) => item.reviewId === reviewId && item.index === index

export function findSuggestion(list: readonly RevisionSuggestion[], reviewId: string, index: number): RevisionSuggestion | undefined {
  return list.find((item) => sameOpinion(item, reviewId, index))
}

/** Adds or replaces the draft for one opinion; drafts stay in opinion order. */
export function upsertSuggestion(list: readonly RevisionSuggestion[], suggestion: RevisionSuggestion): RevisionSuggestion[] {
  const next = list.filter((item) => !sameOpinion(item, suggestion.reviewId, suggestion.index))
  return [...next, {
    ...suggestion,
    finding: suggestion.finding.slice(0, MAX_SUGGESTION_FIELD_CHARACTERS),
    change: suggestion.change.slice(0, MAX_SUGGESTION_FIELD_CHARACTERS),
  }].sort((left, right) => left.reviewId === right.reviewId ? left.index - right.index : left.reviewId.localeCompare(right.reviewId))
}

export function removeSuggestion(list: readonly RevisionSuggestion[], reviewId: string, index: number): RevisionSuggestion[] {
  return list.filter((item) => !sameOpinion(item, reviewId, index))
}

/**
 * The exact text a revision request submits. Without opinion drafts it is the free text unchanged;
 * with drafts each opinion lists the original problem, the verified finding and the proposed change.
 */
export function composeRevisionRequest(suggestions: readonly RevisionSuggestion[], general: string): string {
  const blocks = suggestions.map((item) => [
    `审查意见 ${item.index + 1}（${item.reviewId}）：${item.issue}`,
    ...(item.finding.trim() ? [`核实结论：${item.finding.trim()}`] : []),
    ...(item.change.trim() ? [`拟修改内容：${item.change.trim()}`] : []),
  ].join('\n'))
  const other = general.trim()
  if (!blocks.length) return general
  return [...blocks, ...(other ? [`其他修订说明：\n${other}`] : [])].join('\n\n')
}
