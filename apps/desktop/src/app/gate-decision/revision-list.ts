/**
 * Versioned local revision lists (design §3.3, §5.5, §5.6). A list belongs to one exact version
 * and stays on this machine; submission reuses the existing write paths, which re-check it.
 */
import { isSavedDiscussionProposal, type Artifact, type DesignRevisionIdentity, type StageAgentExecutorKind } from '@ai-devflow/shared'
import type { RevisionSuggestion } from '../revision-suggestions'
import { gateCopy, type GateKind } from './copy'
export const REVISION_LISTS_STORAGE_KEY = 'devflow-revision-lists'
export const MAX_REVISION_ITEM_CHARACTERS = 1_000
export const MAX_REVISION_TEXT_CHARACTERS = 4_000
export const MAX_REVISION_PROPOSALS = 20
export type ListTarget =
  | { kind: 'requirement'; runId: string; artifactId: string; revision: number; revisionDigest: string }
  | { kind: 'design'; runId: string; artifactId: string; updatedAt: string; contentDigest: string }
export type FindingRef = { reviewId: string; index: number; text: string; level?: 'important' | 'suggestion' }
export type StoredRevisionItem = {
  id: string
  source: 'finding' | 'question' | 'own'
  addedAt: string
  text: string
  finding?: FindingRef
  question?: { index: number; text: string; merged: Array<{ reviewId: string; index: number; text: string }> }
  imported?: 'revision-suggestion' | 'revision-draft'
}
export type ChatOverride = { removed?: true; addedAt?: string; note?: string }
export type StoredRevisionList = {
  version: 1
  target: ListTarget
  items: StoredRevisionItem[]
  declined: Array<{ reviewId: string; index: number }>
  chat: Record<string, ChatOverride>
  submitted?: {
    at: string
    feedbackArtifactId?: string
    text: string
    proposals: DesignRevisionIdentity[]
    itemCount: number
    /** The choice used for vN+1; the default for 「重新生成」. */
    generation?: { executor: StageAgentExecutorKind; providerId: string }
  }
  confirmedWithout?: { at: string; count: number }
  updatedAt: string
}
export type RevisionListStore = { version: 1; lists: Record<string, StoredRevisionList> }
export function listKey(target: ListTarget): string {
  return target.kind === 'requirement'
    ? `requirement:${target.runId}:${target.artifactId}:${target.revision}:${target.revisionDigest}`
    : `design:${target.runId}:${target.artifactId}:${target.updatedAt}:${target.contentDigest}`
}
export function emptyRevisionList(target: ListTarget, now: string): StoredRevisionList {
  return { version: 1, target, items: [], declined: [], chat: {}, updatedAt: now }
}
// ---- Parsing (every field checked; invalid entries and items are dropped and counted) ----
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isDigest = (value: unknown): value is string => isString(value) && /^[a-f0-9]{64}$/u.test(value)
const isLevel = (value: unknown) => value === undefined || value === 'important' || value === 'suggestion'
function isIdentity(value: unknown): value is DesignRevisionIdentity {
  return isRecord(value) && isString(value.artifactId) && isString(value.updatedAt) && isDigest(value.contentDigest)
}
function isTarget(value: unknown): value is ListTarget {
  if (!isRecord(value) || !isString(value.runId) || !isString(value.artifactId)) return false
  if (value.kind === 'requirement') return Number.isInteger(value.revision) && (value.revision as number) >= 1 && isDigest(value.revisionDigest)
  if (value.kind === 'design') return isString(value.updatedAt) && isDigest(value.contentDigest)
  return false
}
function isFindingRef(value: unknown): value is FindingRef {
  return isRecord(value) && isString(value.reviewId) && isIndex(value.index) && isString(value.text) && isLevel(value.level)
}
function isItem(value: unknown): value is StoredRevisionItem {
  if (!isRecord(value) || !isString(value.id) || !isString(value.addedAt) || !isString(value.text)) return false
  if (value.imported !== undefined && value.imported !== 'revision-suggestion' && value.imported !== 'revision-draft') return false
  if (value.source === 'finding') return isFindingRef(value.finding)
  if (value.source === 'question') {
    const question = value.question
    return isRecord(question) && isIndex(question.index) && isString(question.text) && Array.isArray(question.merged) &&
      question.merged.every((item) => isRecord(item) && isString(item.reviewId) && isIndex(item.index) && isString(item.text))
  }
  return value.source === 'own'
}
function isChat(value: unknown): value is Record<string, ChatOverride> {
  return isRecord(value) && Object.values(value).every((entry) => isRecord(entry) &&
    (entry.removed === undefined || entry.removed === true) && (entry.addedAt === undefined || isString(entry.addedAt)) && (entry.note === undefined || isString(entry.note)))
}
function isSubmitted(value: unknown): value is NonNullable<StoredRevisionList['submitted']> {
  if (!isRecord(value) || !isString(value.at) || !isString(value.text) || !Number.isInteger(value.itemCount)) return false
  if (value.feedbackArtifactId !== undefined && !isString(value.feedbackArtifactId)) return false
  if (!Array.isArray(value.proposals) || !value.proposals.every(isIdentity)) return false
  const generation = value.generation
  return generation === undefined || (isRecord(generation) && isString(generation.providerId) &&
    (generation.executor === 'direct-provider' || generation.executor === 'local-agent' || generation.executor === 'native-agent'))
}
/** Reads the store; a malformed list is dropped, a malformed item inside a list is dropped (each counted). */
export function parseRevisionListStore(raw: string | null): { store: RevisionListStore; dropped: number } {
  const empty: RevisionListStore = { version: 1, lists: {} }
  if (raw === null) return { store: empty, dropped: 0 }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { store: empty, dropped: 1 } }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.lists)) return { store: empty, dropped: 1 }
  let dropped = 0
  const lists: Record<string, StoredRevisionList> = {}
  for (const [key, value] of Object.entries(parsed.lists)) {
    if (!isRecord(value) || value.version !== 1 || !isTarget(value.target) || listKey(value.target) !== key || !isString(value.updatedAt) ||
      !Array.isArray(value.items) || !Array.isArray(value.declined) || !isChat(value.chat) ||
      (value.submitted !== undefined && !isSubmitted(value.submitted)) ||
      (value.confirmedWithout !== undefined && !(isRecord(value.confirmedWithout) && isString(value.confirmedWithout.at) && Number.isInteger(value.confirmedWithout.count)))) {
      dropped++
      continue
    }
    const items = value.items.filter(isItem)
    const declined = value.declined.filter((entry): entry is { reviewId: string; index: number } => isRecord(entry) && isString(entry.reviewId) && isIndex(entry.index))
    dropped += value.items.length - items.length + value.declined.length - declined.length
    lists[key] = {
      version: 1, target: value.target, items, declined: declined.map(({ reviewId, index }) => ({ reviewId, index })), chat: value.chat, updatedAt: value.updatedAt,
      ...(value.submitted ? { submitted: value.submitted as NonNullable<StoredRevisionList['submitted']> } : {}),
      ...(value.confirmedWithout ? { confirmedWithout: value.confirmedWithout as NonNullable<StoredRevisionList['confirmedWithout']> } : {}),
    }
  }
  return { store: { version: 1, lists }, dropped }
}
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
/** #247 drafts of one requirement version become list items (design §5.5 field mapping). */
export function importLegacyDrafts(artifactId: string, suggestions: readonly RevisionSuggestion[], draft: string | undefined, now: string): StoredRevisionItem[] {
  const items: StoredRevisionItem[] = suggestions.map((suggestion, position) => ({
    id: `imported-s-${suggestion.reviewId}-${suggestion.index}`,
    source: 'finding',
    finding: { reviewId: suggestion.reviewId, index: suggestion.index, text: suggestion.issue },
    text: [suggestion.change.trim(), suggestion.finding.trim() ? `核实结论：${suggestion.finding.trim()}` : ''].filter(Boolean).join('\n') || suggestion.issue,
    addedAt: plusMs(now, position),
    imported: 'revision-suggestion',
  }))
  if (draft?.trim()) {
    items.push({ id: `imported-d-${artifactId}`, source: 'own', text: draft.trim(), addedAt: plusMs(now, suggestions.length), imported: 'revision-draft' })
  }
  return items
}
// ---- Operations ----
export type RevisionListOp =
  | { type: 'adopt'; finding: FindingRef; text?: string }
  | { type: 'unadopt'; reviewId: string; index: number }
  | { type: 'decline'; reviewId: string; index: number }
  | { type: 'undecline'; reviewId: string; index: number }
  | { type: 'adoptAllSuggestions'; findings: FindingRef[] }
  | { type: 'answer'; question: NonNullable<StoredRevisionItem['question']>; answer: string }
  | { type: 'clearAnswer'; index: number }
  | { type: 'addOwn'; text: string }
  | { type: 'edit'; itemId: string; text: string }
  | { type: 'remove'; itemId: string }
  | { type: 'chatRemove'; proposalId: string }
  | { type: 'chatReAdd'; proposalId: string }
  | { type: 'chatNote'; proposalId: string; note: string }
  | { type: 'markSubmitted'; text: string; proposals: DesignRevisionIdentity[]; itemCount: number; feedbackArtifactId?: string
      generation?: { executor: StageAgentExecutorKind; providerId: string } }
  | { type: 'markConfirmedWithout'; count: number }
/** `applied`: the change is in memory although saving it failed (design §6), so a retry must not repeat it. */
export type RevisionListOpResult = { ok: true; list: StoredRevisionList } | { ok: false; message: string; applied?: true }
/** Own items, answers and edits: 1–1,000 characters after trim. */
export function checkItemText(text: string): { ok: true; text: string } | { ok: false; message: string } {
  const value = text.trim()
  if (!value) return { ok: false, message: gateCopy.textRequired }
  if (value.length > MAX_REVISION_ITEM_CHARACTERS) return { ok: false, message: gateCopy.textTooLong(value.length) }
  return { ok: true, text: value }
}
const findingItemId = (reviewId: string, index: number) => `f-${reviewId}-${index}`
const sameFinding = (item: StoredRevisionItem, reviewId: string, index: number) =>
  item.source === 'finding' && item.finding?.reviewId === reviewId && item.finding.index === index
export function applyRevisionListOp(list: StoredRevisionList, op: RevisionListOp, now: string): RevisionListOpResult {
  const done = (next: Omit<StoredRevisionList, 'updatedAt'>): RevisionListOpResult => ({ ok: true, list: { ...next, updatedAt: now } })
  const withoutFinding = (reviewId: string, index: number) => list.items.filter((item) => !sameFinding(item, reviewId, index))
  const undeclined = (reviewId: string, index: number) => list.declined.filter((entry) => !(entry.reviewId === reviewId && entry.index === index))
  switch (op.type) {
    case 'adopt': {
      const checked = checkItemText(op.text ?? op.finding.text)
      if (!checked.ok) return checked
      const item: StoredRevisionItem = { id: findingItemId(op.finding.reviewId, op.finding.index), source: 'finding', addedAt: now, text: checked.text, finding: { ...op.finding } }
      return done({ ...list, items: [...withoutFinding(op.finding.reviewId, op.finding.index), item], declined: undeclined(op.finding.reviewId, op.finding.index) })
    }
    case 'unadopt':
      return done({ ...list, items: withoutFinding(op.reviewId, op.index) })
    case 'decline':
      return done({ ...list, items: withoutFinding(op.reviewId, op.index), declined: [...undeclined(op.reviewId, op.index), { reviewId: op.reviewId, index: op.index }] })
    case 'undecline':
      return done({ ...list, declined: undeclined(op.reviewId, op.index) })
    case 'adoptAllSuggestions': {
      let next = list
      for (const [position, finding] of op.findings.entries()) {
        const result = applyRevisionListOp(next, { type: 'adopt', finding }, plusMs(now, position))
        if (!result.ok) return result
        next = result.list
      }
      return done(next)
    }
    case 'answer': {
      const checked = checkItemText(op.answer)
      if (!checked.ok) return checked
      const existing = list.items.find((item) => item.source === 'question' && item.question?.index === op.question.index)
      if (existing) {
        return done({ ...list, items: list.items.map((item) => item === existing ? { ...item, text: checked.text, question: op.question } : item) })
      }
      return done({ ...list, items: [...list.items, { id: `q-${op.question.index}`, source: 'question', addedAt: now, text: checked.text, question: op.question }] })
    }
    case 'clearAnswer':
      return done({ ...list, items: list.items.filter((item) => !(item.source === 'question' && item.question?.index === op.index)) })
    case 'addOwn': {
      const checked = checkItemText(op.text)
      if (!checked.ok) return checked
      let id = `o-${Date.parse(now)}`
      for (let suffix = 1; list.items.some((item) => item.id === id); suffix++) id = `o-${Date.parse(now)}-${suffix}`
      return done({ ...list, items: [...list.items, { id, source: 'own', addedAt: now, text: checked.text }] })
    }
    case 'edit': {
      if (!list.items.some((item) => item.id === op.itemId)) return { ok: false, message: gateCopy.itemMissing }
      const checked = checkItemText(op.text)
      if (!checked.ok) return checked
      return done({ ...list, items: list.items.map((item) => item.id === op.itemId ? { ...item, text: checked.text } : item) })
    }
    case 'remove':
      if (!list.items.some((item) => item.id === op.itemId)) return { ok: false, message: gateCopy.itemMissing }
      return done({ ...list, items: list.items.filter((item) => item.id !== op.itemId) })
    case 'chatRemove':
      return done({ ...list, chat: { ...list.chat, [op.proposalId]: { removed: true } } })
    case 'chatReAdd': {
      const { removed: _removed, ...rest } = list.chat[op.proposalId] ?? {}
      return done({ ...list, chat: { ...list.chat, [op.proposalId]: { ...rest, addedAt: now } } })
    }
    case 'chatNote': {
      const note = op.note.trim()
      if (note.length > MAX_REVISION_ITEM_CHARACTERS) return { ok: false, message: gateCopy.noteTooLong(note.length) }
      const { note: _note, ...rest } = list.chat[op.proposalId] ?? {}
      return done({ ...list, chat: { ...list.chat, [op.proposalId]: note ? { ...rest, note } : rest } })
    }
    case 'markSubmitted':
      return done({ ...list, submitted: { at: now, text: op.text, proposals: op.proposals, itemCount: op.itemCount,
        ...(op.feedbackArtifactId ? { feedbackArtifactId: op.feedbackArtifactId } : {}), ...(op.generation ? { generation: op.generation } : {}) } })
    case 'markConfirmedWithout':
      return done({ ...list, confirmedWithout: { at: now, count: op.count } })
  }
}
// ---- Derived chat items (§5.5) ----
export type ChatItem = { proposal: Artifact; addedAt: string; note?: string }
function generationStart(artifact: Artifact): string {
  return artifact.clarificationRevision?.executor.startedAt ?? artifact.designEvidence?.executor.startedAt ?? artifact.updatedAt
}
/** Saved proposals of this run and stage that no generation used, considered or that the user removed. */
export function deriveChatItems(input: {
  kind: GateKind
  runId: string
  agentNodeId: string
  gateNodeId: string
  artifacts: readonly Artifact[]
  list: StoredRevisionList | undefined
  /** Other lists of the same run and stage (a removal carries forward). */
  otherLists: readonly StoredRevisionList[]
}): ChatItem[] {
  const runArtifacts = input.artifacts.filter((artifact) => artifact.runId === input.runId)
  const used = new Set<string>()
  for (const artifact of runArtifacts) {
    artifact.clarificationRevision?.inputProposals?.forEach((identity) => used.add(identity.artifactId))
    artifact.clarificationFeedback?.proposals?.forEach((identity) => used.add(identity.artifactId))
    artifact.designRevision?.proposals.forEach((identity) => used.add(identity.artifactId))
  }
  // Generations that kept no record read every proposal on their agent node.
  const unrecorded = runArtifacts.filter((artifact) => input.kind === 'requirement'
    ? artifact.kind === 'clarification' && !artifact.clarificationRevision?.inputProposals
    : artifact.kind === 'design' && !artifact.designRevision)
  const starts = unrecorded.map(generationStart)
  return runArtifacts
    .filter((artifact) => isSavedDiscussionProposal(artifact) && (artifact.nodeId === input.agentNodeId || artifact.nodeId === input.gateNodeId))
    .filter((proposal) => !used.has(proposal.id))
    .filter((proposal) => !(proposal.nodeId === input.agentNodeId && starts.some((start) => proposal.updatedAt <= start)))
    .filter((proposal) => {
      const own = input.list?.chat[proposal.id]
      if (own) return !own.removed
      return !input.otherLists.some((other) => other.chat[proposal.id]?.removed)
    })
    .map((proposal) => {
      const own = input.list?.chat[proposal.id]
      return { proposal, addedAt: own?.addedAt ?? proposal.updatedAt, ...(own?.note ? { note: own.note } : {}) }
    })
}
/** Whether a saved proposal was used by any generation or submitted request of the run. */
export function proposalUsedBy(artifacts: readonly Artifact[], proposalId: string): { inputs: Artifact[]; feedback: Artifact[] } {
  return {
    inputs: artifacts.filter((artifact) => artifact.clarificationRevision?.inputProposals?.some((item) => item.artifactId === proposalId) ||
      artifact.designRevision?.proposals.some((item) => item.artifactId === proposalId)),
    feedback: artifacts.filter((artifact) => artifact.clarificationFeedback?.proposals?.some((item) => item.artifactId === proposalId)),
  }
}
/** A saved proposal counts as considered by a generation that kept no input record (§5.5 condition 2). */
export function coveredByUnrecordedGeneration(input: { kind: GateKind; runId: string; agentNodeId: string; artifacts: readonly Artifact[]; proposal: Artifact }): boolean {
  if (input.proposal.nodeId !== input.agentNodeId) return false
  return input.artifacts.some((artifact) => artifact.runId === input.runId && (input.kind === 'requirement'
    ? artifact.kind === 'clarification' && !artifact.clarificationRevision?.inputProposals
    : artifact.kind === 'design' && !artifact.designRevision) && input.proposal.updatedAt <= generationStart(artifact))
}
// ---- Numbering and composition ----
export type NumberedItem = {
  id: string
  number: number
  source: 'finding' | 'question' | 'own' | 'chat'
  label: string
  text: string
  addedAt: string
  /** "较早的审查" when a finding item comes from another review than the bound one. */
  tag?: string
  item?: StoredRevisionItem
  chat?: ChatItem
}
/** The one numbering of "第 K 项": items sorted by `addedAt`, then id (AC23). */
export function numberItems(items: readonly StoredRevisionItem[], chatItems: readonly ChatItem[] = [], boundReviewId?: string): NumberedItem[] {
  const all = [
    ...items.map((item) => ({ id: item.id, addedAt: item.addedAt, item })),
    ...chatItems.map((chat) => ({ id: `chat-${chat.proposal.id}`, addedAt: chat.addedAt, chat })),
  ].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
  return all.map((entry, position): NumberedItem => {
    const number = position + 1
    if ('chat' in entry && entry.chat) {
      return { id: entry.id, number, source: 'chat', label: gateCopy.sourceChat, text: entry.chat.note ?? '', addedAt: entry.addedAt, chat: entry.chat }
    }
    const item = (entry as { item: StoredRevisionItem }).item
    const label = item.source === 'finding' ? gateCopy.sourceFinding(item.finding!.index + 1)
      : item.source === 'question' ? gateCopy.sourceQuestion(item.question!.index + 1) : gateCopy.sourceOwn
    const earlier = item.source === 'finding' && boundReviewId !== undefined && item.finding!.reviewId !== boundReviewId
    return { id: item.id, number, source: item.source, label, text: item.text, addedAt: item.addedAt, item, ...(earlier ? { tag: gateCopy.earlierReviewTag } : {}) }
  })
}
const indent = (text: string) => text.split('\n').join('\n   ')
/** The submitted text, shared by both gates (§5.6). Review and artifact ids never appear. */
export function composeRevisionText(items: readonly NumberedItem[], target: { kind: GateKind; version: string }): string {
  const lines = [gateCopy.composeHeader(items.length, target.version)]
  for (const entry of items) {
    const prefix = `${entry.number}. `
    if (entry.source === 'chat' && entry.chat) {
      lines.push(prefix + indent(gateCopy.composeChat(entry.chat.proposal.title, entry.chat.note)))
    } else if (entry.source === 'finding' && entry.item?.finding) {
      lines.push(prefix + indent(gateCopy.composeFinding(entry.item.finding.index + 1, entry.item.text)))
      if (entry.item.text !== entry.item.finding.text) lines.push(`   ${indent(gateCopy.composeFindingOriginal(entry.item.finding.text))}`)
    } else if (entry.source === 'question' && entry.item?.question) {
      const question = entry.item.question
      lines.push(prefix + indent(gateCopy.composeQuestion(question.index + 1, question.text, entry.item.text)))
      for (const merged of question.merged) lines.push(`   ${indent(gateCopy.composeQuestionMerged(merged.index + 1, merged.text))}`)
    } else {
      lines.push(prefix + indent(gateCopy.composeOwn(entry.text)))
    }
  }
  return lines.join('\n')
}
const headerPattern = /^修订清单（共 (\d+) 项，针对(需求|方案) v(\d+)）：/u
export function parseRevisionTextHeader(text: string): { count: number; kind: GateKind; version: number } | undefined {
  const match = headerPattern.exec(text)
  if (!match) return undefined
  return { count: Number(match[1]), kind: match[2] === '需求' ? 'requirement' : 'design', version: Number(match[3]) }
}
/** Length against the 4,000-character limit; nothing is ever truncated (AC27). */
export function measureRevisionText(text: string): { length: number; limit: number; over: number; reason?: string } {
  const length = text.length
  const over = Math.max(0, length - MAX_REVISION_TEXT_CHARACTERS)
  return { length, limit: MAX_REVISION_TEXT_CHARACTERS, over, ...(over > 0 ? { reason: gateCopy.revisionTooLong(length, over) } : {}) }
}
/** Submitted from the local flag or from the records (§3.22). */
export function isListSubmitted(list: StoredRevisionList, artifacts: readonly Artifact[]): boolean {
  if (list.submitted) return true
  const target = list.target
  if (target.kind === 'requirement') {
    return artifacts.some((artifact) => artifact.kind === 'clarification_feedback' && artifact.clarificationFeedback?.targetArtifactId === target.artifactId)
  }
  return artifacts.some((artifact) => artifact.kind === 'design' && artifact.designRevision?.previous.artifactId === target.artifactId &&
    artifact.designRevision.previous.updatedAt === target.updatedAt && artifact.designRevision.previous.contentDigest === target.contentDigest)
}
/** History mode reads a list without a digest: same kind, run and artifact (and revision or recorded time). */
export function findStoredList(store: RevisionListStore, input: { kind: GateKind; runId: string; reading: Pick<Artifact, 'id' | 'updatedAt'>; revision?: number }): StoredRevisionList | undefined {
  return Object.values(store.lists)
    .filter((list) => list.target.kind === input.kind && list.target.runId === input.runId && list.target.artifactId === input.reading.id &&
      (list.target.kind === 'design' ? list.target.updatedAt === input.reading.updatedAt : list.target.revision === input.revision))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}
/** Other lists of the same run and stage, excluding the one under `key`. */
export function otherListsOf(store: RevisionListStore, input: { kind: GateKind; runId: string; exceptKey?: string }): StoredRevisionList[] {
  return Object.entries(store.lists)
    .filter(([key, list]) => key !== input.exceptKey && list.target.kind === input.kind && list.target.runId === input.runId)
    .map(([, list]) => list)
}
