/**
 * The gate decision page as one pure projection (design §5.3, §5.4, §5.9; amendments 33, 35, 37).
 * Components render only from its result. Policy facts are derived first; then run facts; then
 * the bar rows in evaluation order (1, 3, 5, 2, 4, 6, 7, 7a, 7b, 8, 8a, 9, 10–15); then the
 * modifiers; then progress, margin, cards and bars.
 */
import {
  agentReviewCoversCurrentSubjects,
  assessClarificationReviewTarget,
  clarificationRevisionNumber,
  describeStageAgentFailure,
  type AgentReviewResult,
  type Artifact,
  type GateEnforcementDecision,
  type RequiredGateRole,
  type StageAgentFailureDetails,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { formatLocalTime } from '../desktop-view-model'
import type { PendingInspectorAction } from '../node-inspector-view-model'
import { gateCopy, nextVersionLabel, policyTargetLabel, roleLabel, versionLabel, type GateKind } from './copy'
import { mergeFindings, type GateQuestion, type MergeResult } from './merge'
import { blockKey, materialHeader, rawRequestLine, recordedAtLine, type BlockIndex, type BlockKey, type LocatedQuestion, type Range } from './material'
import type { GatePageMode } from './page'
import { derivePolicyFacts } from './policy'
import type { Level, ReviewBinding } from './review-binding'
import {
  composeRevisionText,
  isListSubmitted,
  MAX_REVISION_ITEM_CHARACTERS,
  MAX_REVISION_PROPOSALS,
  measureRevisionText,
  numberItems,
  parseRevisionTextHeader,
  type ChatItem,
  type NumberedItem,
  type StoredRevisionList,
} from './revision-list'
// ---- View types (design §5.2, amendment 33) ----
export type GateBarRow = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '7a' | '7b' | '8' | '8a' | '9' | '10' | '11' | '12' | '13' | '14' | '15'
export type GateButtonId = 'review' | 'submit' | 'confirmWithout' | 'confirm' | 'regenerate' | 'syncTeam'
  | 'reloadPolicy' /* → gateEnforcement.refresh() */ | 'recheck' /* → retry() of the failed digest hooks */
  | 'returnToCurrent' /* → showCurrentVersion(), view only */
export type NoteLink = { label: string; action: 'openVersion'; artifactId: string }
  | { label: '打开模型与执行方式设置'; action: 'openModelSettings' }
export type CostLineLink = NoteLink | { label: '更换审查模型'; action: 'openModelSettings' } | { label: '更改'; action: 'openStageSettings' }
export type GateNote = { tone: 'block' | 'neutral' | 'warn' | 'error' | 'ok'; text: string; technical?: string; link?: NoteLink }
export type GateButton = { id: GateButtonId; label: string; primary: boolean; enabled: boolean; disabledReason?: string; confirmBefore?: string }
export type CostLine = { kind: 'review' | 'generation'; text: string; link?: CostLineLink }
export type ListItemView = {
  id: string
  number: number
  source: NumberedItem['source']
  label: string
  tag?: string
  text: string
  /** `title` / `aria-description` of the source label. */
  detail: string
  /** Chat items: the proposal artifact, its title and its body for 「查看」. */
  proposalId?: string
  proposalTitle?: string
  proposalBody?: string
  /** The card a finding or question item came from. */
  cardId?: string
}
export type ListView = {
  toggleLabel: string
  toggleEnabled: boolean
  count?: number
  header: string
  emptyText: string
  items: ListItemView[]
  actionable: boolean
  readOnlyReason?: string
  /** Revision-pending: exactly what was submitted, read-only. */
  submittedText?: string
  addLabel: string
  addPlaceholder: string
  generationLine?: string
  composedText: string
  composedLength: number
  overflowReason?: string
  /** 来自答疑 identities in list order, for the submit call. */
  proposalIds: string[]
}
export type MetaView = {
  role?: string
  review?: string
  rerun?: { enabled: boolean; disabledReason?: string }
  changeReviewModel: boolean
  freshness?: string
  stepNote?: string
  technical: Array<{ label: string; value: string }>
}
export type MarginHeaderView = {
  text: string
  merges: Array<{ text: string; cardId: string }>
  /** Joins after the second go into the disclosure "另有 N 条意见并入了问题". */
  moreText?: string
  adoptAll: { enabled: boolean; disabledReason?: string; findingIndexes: number[] }
}
export type CardView = {
  id: string
  kind: 'finding' | 'question'
  number: number
  title: string
  text: string
  level?: Level
  anchor?: BlockKey
  ranges: Range[]
  blocks: BlockKey[]
  status: 'open' | 'adopted' | 'declined' | 'answered'
  statusText?: string
  /** `static`: plain text, not a link (history mode, where the bar's list is another version's). */
  itemRef?: { itemId: string; number: number; static?: true }
  actionable: boolean
  readOnlyReason?: string
  mergedLines: string[]
  answer?: string
  /** Finding cards: the finding's review id and index (list operations, 「讨论」 ids). */
  finding?: { reviewId: string; index: number; text: string; level?: Level }
  /** Question cards: the merged findings, for the answer operation. */
  merged?: Array<{ reviewId: string; index: number; text: string; number: number }>
}
export type BarView = { cardIds: string[]; block: BlockKey; slot: 0 | 1 | 2; tone: 'question' | 'important' | 'suggestion'; label: string }
export type HistoryListView = { title: string; text: string; count: number }
export type GateBarMode = 'decide' | 'running' | 'pending-generation' | 'finished' | 'read-only' | 'checking' | 'unverified'
export type GateDecisionView = {
  bar: {
    row: GateBarRow
    mode: GateBarMode
    title: string
    progress?: { text: string; done: boolean; showNext: boolean }
    notes: GateNote[]
    buttons: GateButton[]
    costLines: CostLine[]
    stop?: { target: 'review' | 'generation' }
    list: ListView
    meta: MetaView
  }
  margin: { header?: MarginHeaderView; note?: string; cards: CardView[]; navigationOrder: string[] }
  material: { header: string; recordedAt: string; rawRequest?: string; bars: BarView[]; newBlocks: BlockKey[]; readOnlyBanner?: string; historyList?: HistoryListView }
  listActionable: boolean
}
// ---- Input ----
export type GateVersionFacts = {
  artifact: Artifact
  number?: number | undefined
  label: string
  binding: ReviewBinding
  /** Located open questions of this version (requirement only). */
  questions: readonly LocatedQuestion[]
  blocks: BlockIndex
  newBlocks: readonly BlockKey[]
}
export type GateRunFacts = {
  reviewRunning: boolean
  generationRunning: boolean
  writeInFlight?: 'request' | 'approve' | undefined
  /** Any other write of this window (`hasInspectorWriteLock`). */
  writeLock: boolean
}
export type GateReviewTarget = { state: 'none' | 'legacy' | 'current' | 'stale'; reviewedLabel?: string | undefined }
export type GateProjectionInput = {
  kind: GateKind
  mode: GatePageMode
  current: GateVersionFacts & { determinable: boolean; determinableMessage?: string | undefined }
  /** The version read; history mode when it differs from `current`. */
  reading?: GateVersionFacts | undefined
  artifacts: readonly Artifact[]
  designNumbers?: ReadonlyMap<string, number> | undefined
  rawRequest?: string | undefined
  reviewTarget: GateReviewTarget
  /** The current version's stored list. */
  list?: StoredRevisionList | undefined
  /** Derived 来自答疑 items of the current list (current mode). */
  chatItems?: readonly ChatItem[] | undefined
  /** History mode: the read version's stored list (`findStoredList`). */
  readingList?: StoredRevisionList | undefined
  /** Other lists of the same run and stage, with their version labels. */
  otherLists?: ReadonlyArray<{ list: StoredRevisionList; label: string }> | undefined
  policy: { decision: GateEnforcementDecision | null | undefined; isLoading: boolean; loadError?: string | null | undefined; enabled: boolean; teamBinding: boolean }
  /** `reviewCheckOf`; `designIdentity` says which hook is pending or failed. */
  reviewCheck: { state: 'pending' | 'failed' | 'done'; designIdentity?: boolean | undefined; technical?: string | undefined }
  permission: { roleCanApprove: boolean; role?: string | undefined; requiredRole?: RequiredGateRole | undefined }
  runFacts: GateRunFacts
  /** The latest failure trace on the clarify agent node newer than the feedback (revision-pending). */
  stageFailure?: StageAgentFailureDetails | undefined
  reviewFailure?: string | undefined
  writeResult?: { tone: GateNote['tone']; text: string; technical?: string | undefined } | undefined
  finished?: { at: string; confirmer?: { name: string; role: string } | undefined; actorId?: string | undefined } | undefined
  generation: { executorLabel: string; modelLabel?: string | undefined; modelSelected: boolean; modelReadinessError?: string | undefined }
  reviewProviderLabel?: string | undefined
  reviewRunBlockedReason?: string | undefined
  /** The review button is disabled because no review model is selected. */
  reviewModelMissing?: boolean | undefined
  evaluatedAt?: string | undefined
  /** Revision-pending: `list.submitted.text`, else the feedback content that targets vN. */
  submittedText?: string | undefined
  /** Design: generating needs a running design gate. */
  generationAllowed?: boolean | undefined
  technical?: ReadonlyArray<{ label: string; value: string }> | undefined
}
// ---- Facts helpers for the caller ----
/** Run facts from the run's ids, never from the selected node (§5.3). */
export function deriveRunFacts(input: {
  kind: GateKind
  runId: string
  agentNodeId: string
  gateNodeId: string
  pending?: PendingInspectorAction | null | undefined
  knowledgeReviewTarget?: { runId: string; nodeId: string } | null | undefined
  isRunningAgentReview: boolean
  /** Other busy states of the window (coding agent start, tests). */
  otherBusy?: boolean | undefined
}): GateRunFacts {
  const pending = input.pending ?? undefined
  const onRun = (nodeId: string) => pending?.runId === input.runId && pending.nodeId === nodeId
  const generationRunning = input.kind === 'requirement'
    ? pending?.actionId === 'completeAgent' && onRun(input.agentNodeId)
    : pending?.actionId === 'generateDesignRevision' && onRun(input.gateNodeId)
  const writeInFlight = pending?.actionId === 'requestClarificationRevision' && onRun(input.gateNodeId) ? 'request' as const
    : pending?.actionId === 'approveGate' && onRun(input.gateNodeId) ? 'approve' as const : undefined
  const reviewRunning = input.isRunningAgentReview && input.knowledgeReviewTarget?.runId === input.runId && input.knowledgeReviewTarget.nodeId === input.gateNodeId
  const writeLock = (Boolean(pending) && !generationRunning && !writeInFlight) || (input.isRunningAgentReview && !reviewRunning) || Boolean(input.otherBusy)
  return { reviewRunning, generationRunning, ...(writeInFlight ? { writeInFlight } : {}), writeLock }
}
/** Requirement: the runtime's rule; design: the subject check plus the reviewed version number (§5.2 input). */
export function deriveReviewTarget(input: {
  kind: GateKind
  run: WorkflowRun
  gateNode: WorkflowNode
  reviews: readonly AgentReviewResult[]
  current: Artifact
  artifacts: readonly Artifact[]
  designNumbers?: ReadonlyMap<string, number> | undefined
}): GateReviewTarget {
  if (input.kind === 'requirement') {
    const target = assessClarificationReviewTarget({ runId: input.run.id, gateNodeId: input.gateNode.id, reviews: input.reviews, activeRevision: input.current })
    if (target.state !== 'stale') return { state: target.state }
    const reviewed = target.reviewedArtifactId ? input.artifacts.find((artifact) => artifact.id === target.reviewedArtifactId && artifact.kind === 'clarification') : undefined
    return { state: 'stale', reviewedLabel: reviewed ? versionLabel('requirement', clarificationRevisionNumber(reviewed)) : gateCopy.olderReviewLabel('requirement') }
  }
  const review = input.reviews.filter((item) => item.runId === input.run.id && item.nodeId === input.gateNode.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!review) return { state: 'none' }
  if (!review.contextManifest) return { state: 'legacy' }
  if (agentReviewCoversCurrentSubjects({ review, run: input.run, node: input.gateNode, artifacts: [...input.artifacts] })) return { state: 'current' }
  const subject = review.contextManifest.subjectArtifacts.find((item) => item.kind === 'design')
  const number = subject ? input.designNumbers?.get(subject.id) : undefined
  return { state: 'stale', reviewedLabel: number === undefined ? gateCopy.olderReviewLabel('design') : versionLabel('design', number) }
}
// ---- Projection ----
type RowResult = { row: GateBarRow; mode: GateBarMode; title: string; notes: GateNote[]; buttons: GateButton[]; stop?: { target: 'review' | 'generation' }; marginNote?: string }
const WRITE_BUTTONS: ReadonlySet<GateButtonId> = new Set(['review', 'submit', 'confirmWithout', 'confirm', 'regenerate', 'syncTeam'])
const button = (id: GateButtonId, label: string, primary = false, extra: Partial<GateButton> = {}): GateButton => ({ id, label, primary, enabled: true, ...extra })
const findingCardId = (index: number) => `finding-${index}`
const questionCardId = (number: number) => `question-${number}`
function statusOf(list: StoredRevisionList | undefined, reviewId: string | undefined, index: number): 'open' | 'adopted' | 'declined' {
  if (!list || !reviewId) return 'open'
  if (list.items.some((item) => item.source === 'finding' && item.finding?.reviewId === reviewId && item.finding.index === index)) return 'adopted'
  if (list.declined.some((entry) => entry.reviewId === reviewId && entry.index === index)) return 'declined'
  return 'open'
}
const answerOf = (list: StoredRevisionList | undefined, number: number) =>
  list?.items.find((item) => item.source === 'question' && item.question?.index === number - 1)
export function projectGateDecision(input: GateProjectionInput): GateDecisionView {
  const { kind, mode } = input
  const policy = derivePolicyFacts(input.policy)
  const run = input.runFacts
  const current = input.current
  const reading = input.reading && input.reading.artifact.id !== current.artifact.id ? input.reading : undefined
  const history = Boolean(reading)
  const N = current.label
  const next = nextVersionLabel(kind, current.number)
  const binding = current.binding
  const checkDone = input.reviewCheck.state === 'done'
  const ownReview = checkDone && binding.state === 'bound'
  const workflowRequiresReview = kind === 'requirement' && input.reviewTarget.state === 'stale'
  const reviewedLabel = input.reviewTarget.reviewedLabel ?? gateCopy.olderReviewLabel(kind)
  const listActionable = mode === 'current' && !history && current.determinable && checkDone &&
    !run.reviewRunning && !run.generationRunning && !run.writeInFlight &&
    (binding.state === 'bound' || (!workflowRequiresReview && !policy.missingReviewBlock))
  // The current version's merge, list and numbering.
  const currentMerge = mergeFindings({ kind, binding: binding.state, findings: binding.findings, questions: current.questions })
  const boundReviewId = binding.state === 'bound' ? binding.review?.id : undefined
  const chatItems = mode === 'current' ? input.chatItems ?? [] : []
  const items = numberItems(input.list?.items ?? [], chatItems, boundReviewId)
  const K = items.length
  const composedText = composeRevisionText(items, { kind, version: N })
  const measured = measureRevisionText(composedText)
  const submitAllowed = listActionable && K > 0
  const submittedCount = input.submittedText ? parseRevisionTextHeader(input.submittedText)?.count : undefined
  const reviewButton = (primary = false) => button('review', gateCopy.reviewButton(N), primary)
  const submitButton = (primary = false) => button('submit', kind === 'requirement' ? gateCopy.submitButton(next, K) : gateCopy.generateButton(next, K), primary)
  const confirmButton = (primary = false, extra: Partial<GateButton> = {}) => button('confirm', gateCopy.confirmButton(N), primary, extra)
  const confirmWithoutButton = (extra: Partial<GateButton> = {}) => button('confirmWithout', gateCopy.confirmWithoutButton(kind, N), false, extra)
  const ruleR = !ownReview && !run.reviewRunning && mode === 'current'
  const workflowNote: GateNote = { tone: 'block', text: gateCopy.workflowRequiresReview(N, reviewedLabel) }
  /** Rows 13–15: confirm (and submit) buttons; `confirmBefore` only in row 14. */
  const decideButtons = (confirmBefore?: (label: string) => string): GateButton[] => {
    const before = (label: string) => (confirmBefore ? { confirmBefore: confirmBefore(label) } : {})
    if (submitAllowed) {
      const withoutLabel = gateCopy.confirmWithoutButton(kind, N)
      return [submitButton(true), confirmWithoutButton(before(withoutLabel))]
    }
    return [confirmButton(true, before(gateCopy.confirmButton(N)))]
  }
  const withRuleR = (buttons: GateButton[]) => (ruleR && !buttons.some((item) => item.id === 'review') ? [...buttons, reviewButton(false)] : buttons)
  const choosePrimary = (buttons: GateButton[], order: GateButtonId[]) => {
    const pick = order.find((id) => buttons.some((item) => item.id === id))
    return buttons.map((item) => ({ ...item, primary: item.id === pick }))
  }
  const rowOf = (): RowResult => {
    const decideTitle = gateCopy.decideTitle(N)
    // 1, then 3 and 5 before 2 (amendment 35), 4, 6, 7, 7a, 7b.
    if (mode === 'finished') {
      const notes: GateNote[] = [{ tone: 'ok', text: input.finished?.confirmer
        ? gateCopy.finishedBy(input.finished.confirmer.name, roleLabel(input.finished.confirmer.role), formatLocalTime(input.finished.at))
        : gateCopy.finishedAt(formatLocalTime(input.finished?.at ?? current.artifact.updatedAt)), ...(input.finished?.actorId && !input.finished.confirmer ? { technical: input.finished.actorId } : {}) }]
      const unsubmitted = input.list?.confirmedWithout?.count
      if (unsubmitted) notes.push({ tone: 'neutral', text: gateCopy.finishedUnsubmitted(unsubmitted) })
      return { row: '1', mode: 'finished', title: gateCopy.finishedTitle(N), notes, buttons: [], marginNote: gateCopy.marginFinished(N) }
    }
    if (run.generationRunning) {
      const count = kind === 'requirement' ? submittedCount ?? input.list?.submitted?.itemCount : input.list?.submitted?.itemCount ?? K
      return { row: '3', mode: 'running', title: gateCopy.generatingTitle(next), notes: [{ tone: 'neutral', text: gateCopy.generatingDetail(kind, N, count) }],
        buttons: [], stop: { target: 'generation' } }
    }
    if (run.reviewRunning) {
      return { row: '5', mode: 'running', title: gateCopy.reviewingTitle(N), notes: [{ tone: 'neutral', text: gateCopy.reviewingDetail(kind, input.reviewProviderLabel) }],
        buttons: [], stop: { target: 'review' }, marginNote: gateCopy.marginReviewing(N) }
    }
    if (mode === 'sub-step') {
      return { row: '2', mode: 'read-only', title: gateCopy.subStepTitle(N), notes: [{ tone: 'neutral', text: kind === 'requirement' ? gateCopy.subStepNote : gateCopy.subStepNoteDesign }], buttons: [] }
    }
    if (mode === 'revision-pending') {
      const notes: GateNote[] = [{ tone: 'neutral', text: gateCopy.pendingNotGenerated(next) }]
      const inputChanged = input.stageFailure?.code === 'revision_input_changed'
      if (inputChanged) notes.push({ tone: 'error', text: gateCopy.pendingInputChanged })
      else if (input.stageFailure) notes.push({ tone: 'error', text: gateCopy.pendingLastFailure(describeStageAgentFailure(input.stageFailure)) })
      return { row: '4', mode: 'pending-generation', title: gateCopy.pendingTitle(N), notes,
        buttons: inputChanged ? [] : [button('regenerate', gateCopy.regenerateButton(next), true)], marginNote: gateCopy.marginPending(N) }
    }
    if (run.writeInFlight) {
      return { row: '6', mode: 'running', title: run.writeInFlight === 'request' ? gateCopy.submittingTitle(N) : gateCopy.approvingTitle(N), notes: [], buttons: [] }
    }
    if (!current.determinable) {
      return { row: '7', mode: 'unverified', title: gateCopy.unverifiedTitle, notes: [{ tone: 'warn', text: current.determinableMessage ?? gateCopy.legacyRequirement }], buttons: [] }
    }
    if (input.reviewCheck.state === 'pending') {
      return { row: '7a', mode: 'checking', title: decideTitle, notes: [{ tone: 'neutral', text: input.reviewCheck.designIdentity ? gateCopy.checkingDesign(N) : gateCopy.checkingBinding }],
        buttons: [], marginNote: gateCopy.checkingBinding }
    }
    if (input.reviewCheck.state === 'failed') {
      return { row: '7b', mode: 'unverified', title: gateCopy.unverifiedTitle,
        notes: [{ tone: 'warn', text: input.reviewCheck.designIdentity ? gateCopy.checkFailedDesign(N) : gateCopy.checkFailedBinding, ...(input.reviewCheck.technical ? { technical: input.reviewCheck.technical } : {}) }],
        buttons: [button('recheck', gateCopy.recheckButton, true)], marginNote: gateCopy.checkFailedBinding }
    }
    // 8, 8a, 9: policy states come first; they keep the workflow rule's red note.
    if (policy.loading || policy.failed || policy.preview || policy.unavailable) {
      const notes: GateNote[] = []
      const buttons: GateButton[] = []
      let row: GateBarRow
      if (policy.loading) {
        row = '8'
        notes.push({ tone: 'neutral', text: gateCopy.policyLoading })
      } else if (policy.failed || policy.preview) {
        row = '8a'
        if (policy.failed) {
          notes.push({ tone: 'warn', text: gateCopy.policyFailed, ...(input.policy.loadError ? { technical: input.policy.loadError } : {}) })
          buttons.push(button('reloadPolicy', gateCopy.reloadPolicyButton))
        } else notes.push({ tone: 'neutral', text: gateCopy.policyPreview })
      } else {
        row = '9'
        notes.push({ tone: 'warn', text: input.policy.teamBinding ? gateCopy.policyUnavailableTeam : gateCopy.policyUnavailableLocal })
        if (input.policy.teamBinding) buttons.push(button('syncTeam', gateCopy.syncTeamButton))
      }
      if (workflowRequiresReview) notes.push(workflowNote)
      if (submitAllowed) buttons.push(submitButton())
      if (ruleR || workflowRequiresReview) buttons.push(reviewButton())
      const order: GateButtonId[] = workflowRequiresReview ? ['review'] : ['reloadPolicy', 'syncTeam', 'submit', 'review']
      return { row, mode: 'decide', title: decideTitle, notes, buttons: choosePrimary(buttons, order), ...(workflowRequiresReview ? { marginNote: gateCopy.marginNoReview(N) } : {}) }
    }
    if (workflowRequiresReview) {
      return { row: '10', mode: 'decide', title: decideTitle, notes: [workflowNote], marginNote: gateCopy.marginNoReview(N),
        buttons: [reviewButton(true), confirmButton(false, { enabled: false, disabledReason: gateCopy.confirmNeedsReview(N) })] }
    }
    if (policy.missingReviewBlock && !policy.otherBlock) {
      return { row: '11', mode: 'decide', title: decideTitle, notes: [{ tone: 'block', text: gateCopy.policyRequiresReview(N) }],
        buttons: [reviewButton(true), confirmButton(false, { enabled: false, disabledReason: gateCopy.confirmNeedsReview(N) })] }
    }
    if (policy.otherBlock) {
      const other = policy.reasons.filter((reason) => reason.target !== 'missing_agent_review')
      const notes: GateNote[] = other.slice(0, 2).map((reason) => ({ tone: 'block' as const, text: gateCopy.policyBlock(N, policyTargetLabel(reason.target), reason.remediation ?? reason.summary) }))
      if (other.length > 2) notes.push({ tone: 'block', text: gateCopy.policyBlockMore(other.length - 2) })
      if (policy.missingReviewBlock) notes.push({ tone: 'block', text: gateCopy.policyBlockAlsoReview })
      if (policy.canOverride) notes.push({ tone: 'neutral', text: gateCopy.policyCanOverride })
      const disabled = { enabled: false, disabledReason: gateCopy.confirmBlocked(policyTargetLabel(other[0]!.target)) }
      const buttons = withRuleR(submitAllowed ? [submitButton(), confirmWithoutButton(disabled)] : [confirmButton(false, disabled)])
      return { row: '12', mode: 'decide', title: decideTitle, notes, buttons: choosePrimary(buttons, ['submit', 'review']) }
    }
    if (kind === 'design' && (current.number ?? 0) >= 2 && input.reviewTarget.state === 'stale') {
      return { row: '13', mode: 'decide', title: decideTitle, notes: [{ tone: 'neutral', text: gateCopy.designOptionalReview(reviewedLabel) }],
        marginNote: gateCopy.marginDesignOptional(N), buttons: [...decideButtons(), reviewButton(false)] }
    }
    if (!ownReview && policy.missingReviewWarning) {
      const secondary = decideButtons((label) => gateCopy.confirmBeforeNoReview(N, label)).map((item) => ({ ...item, primary: false }))
      return { row: '14', mode: 'decide', title: decideTitle, notes: [{ tone: 'neutral', text: gateCopy.noReviewWarnOnly(N) }], buttons: [reviewButton(true), ...secondary] }
    }
    return { row: '15', mode: 'decide', title: decideTitle, notes: [], buttons: withRuleR(decideButtons()) }
  }
  const result = rowOf()
  let buttons = result.buttons
  const notes = [...result.notes]
  const rowNumber = result.row
  const withModifiers = rowNumber === '4' || ['8', '8a', '9', '10', '11', '12', '13', '14', '15'].includes(rowNumber)
  let rerunAllowed = Boolean(binding.review) && (rowNumber === '7b' || ['8', '8a', '9', '10', '11', '12', '13', '14', '15'].includes(rowNumber))
  if (withModifiers) {
    // History: only 「返回…」 is primary; every write control goes (amendment 37).
    if (reading) {
      buttons = buttons.filter((item) => !WRITE_BUTTONS.has(item.id)).map((item) => ({ ...item, primary: false }))
      buttons.unshift(button('returnToCurrent', gateCopy.returnButton(N), true))
      notes.push({ tone: 'neutral', text: gateCopy.historyNote(reading.label, N) })
      rerunAllowed = false
    }
    if (!input.permission.roleCanApprove && rowNumber !== '4') {
      buttons = buttons.filter((item) => item.id !== 'confirm' && item.id !== 'confirmWithout')
      const role = roleLabel(input.permission.requiredRole)
      notes.push({ tone: 'neutral', text: kind === 'requirement' ? gateCopy.noPermission(role, N) : gateCopy.noPermissionDesign(role, N) })
    }
    if (run.writeLock) {
      buttons = buttons.map((item) => WRITE_BUTTONS.has(item.id) && item.enabled ? { ...item, enabled: false, disabledReason: gateCopy.writeLock } : item)
    }
    const overItem = items.find((item) => item.source !== 'chat' && item.text.length > MAX_REVISION_ITEM_CHARACTERS)
    const proposalCount = items.filter((item) => item.source === 'chat').length
    buttons = buttons.map((item) => {
      if (!item.enabled) return item
      if (item.id === 'submit' || item.id === 'regenerate') {
        const reason = !input.generation.modelSelected ? gateCopy.noGenerationModel
          : input.generation.modelReadinessError ? input.generation.modelReadinessError
            : item.id !== 'submit' ? undefined
              : measured.reason ?? (overItem ? gateCopy.itemTooLong(overItem.number) : undefined) ??
                (proposalCount > MAX_REVISION_PROPOSALS ? gateCopy.tooManyProposals(proposalCount) : undefined) ??
                (kind === 'design' && input.generationAllowed === false ? gateCopy.designGateBlocked : undefined)
        return reason ? { ...item, enabled: false, disabledReason: reason } : item
      }
      if (item.id === 'review' && input.reviewRunBlockedReason) return { ...item, enabled: false, disabledReason: input.reviewRunBlockedReason }
      return item
    })
    // Reasons on the first layer (generation, write lock and — amendment 33 — review).
    const seen = new Set(notes.map((note) => note.text))
    const settingsLink: NoteLink = { label: gateCopy.openModelSettings, action: 'openModelSettings' }
    for (const item of buttons) {
      if (item.enabled || !item.disabledReason || seen.has(item.disabledReason)) continue
      const generation = item.id === 'submit' || item.id === 'regenerate'
      const lock = item.disabledReason === gateCopy.writeLock
      if (!generation && !lock && item.id !== 'review') continue
      const needsSettings = generation
        ? item.disabledReason === gateCopy.noGenerationModel || item.disabledReason === input.generation.modelReadinessError
        : item.id === 'review' && !lock && (Boolean(input.reviewModelMissing) || item.disabledReason === input.generation.modelReadinessError)
      seen.add(item.disabledReason)
      notes.push({ tone: 'warn', text: item.disabledReason, ...(needsSettings ? { link: settingsLink } : {}) })
    }
    if (input.reviewFailure) notes.push({ tone: 'warn', text: gateCopy.reviewFailed, technical: input.reviewFailure })
    if (!buttons.some((item) => item.primary)) {
      const promote = buttons.find((item) => item.id === 'submit') ?? buttons.find((item) => item.id === 'review')
      if (promote) buttons = buttons.map((item) => (item === promote ? { ...item, primary: true } : item))
    }
  }
  if (mode === 'current' && !history) {
    for (const other of input.otherLists ?? []) {
      const count = other.list.items.length
      if (!count || other.list.confirmedWithout || isListSubmitted(other.list, input.artifacts) || other.list.target.artifactId === current.artifact.id) continue
      notes.push({ tone: 'neutral', text: gateCopy.oldListNotice(kind, N, other.label, count), link: { label: gateCopy.oldListLink(other.label), action: 'openVersion', artifactId: other.list.target.artifactId } })
    }
  }
  if (input.writeResult) notes.push({ tone: input.writeResult.tone, text: input.writeResult.text, ...(input.writeResult.technical ? { technical: input.writeResult.technical } : {}) })
  buttons = [...buttons.filter((item) => item.primary), ...buttons.filter((item) => !item.primary)]
  // Cost lines (amendment 33): one per paid button kind present.
  const costLines: CostLine[] = []
  if (buttons.some((item) => item.id === 'review')) {
    costLines.push(input.reviewProviderLabel
      ? { kind: 'review', text: gateCopy.reviewCost(input.reviewProviderLabel, N), link: { label: gateCopy.changeReviewModel, action: 'openModelSettings' } }
      : { kind: 'review', text: gateCopy.reviewNoModel, link: { label: gateCopy.openModelSettings, action: 'openModelSettings' } })
  }
  const generationLine = gateCopy.generationCost(input.generation.executorLabel, input.generation.modelLabel)
  if (buttons.some((item) => item.id === 'submit' || item.id === 'regenerate')) {
    costLines.push({ kind: 'generation', text: generationLine, link: { label: gateCopy.changeStageSettings, action: 'openStageSettings' } })
  }
  // Progress line (FR-7.4): the current version, also while an older one is read.
  const progressRows: GateBarRow[] = ['8', '8a', '9', '12', '14', '15']
  let progress: GateDecisionView['bar']['progress']
  const hasQuestions = current.questions.length > 0
  if (progressRows.includes(rowNumber) && (binding.state === 'bound' || (hasQuestions && !workflowRequiresReview && !policy.missingReviewBlock))) {
    const bound = binding.state === 'bound'
    const open = bound ? currentMerge.findingCards.filter((finding) => statusOf(input.list, boundReviewId, finding.index) === 'open') : []
    const X = open.length
    const Y = open.filter((finding) => finding.level === 'important').length
    const unanswered = currentMerge.questions.filter((question) => !answerOf(input.list, question.number))
    const Z = unanswered.length
    const W = unanswered.filter((question) => question.merged.some((finding) => finding.level === 'important')).length
    const known = binding.levelsKnown
    const parts: string[] = []
    if (X > 0) parts.push(gateCopy.progressFindings(X) + (known ? (Y > 0 ? gateCopy.progressImportant(Y) : policy.findingsMayBeLeft ? gateCopy.progressAllSuggestions : '') : ''))
    if (Z > 0) parts.push(gateCopy.progressQuestions(Z) + (known && W > 0 ? gateCopy.progressQuestionsImportant(W) : ''))
    const findingsExist = bound && binding.findings.length > 0
    if (parts.length) {
      progress = { text: gateCopy.progressPrefix + parts.reduce((s, p) => s + (s.endsWith('）') ? '· ' : ' · ') + p), done: false, showNext: true }
    } else if (findingsExist && hasQuestions) progress = { text: gateCopy.progressAllDone, done: true, showNext: false }
    else if (findingsExist) progress = { text: gateCopy.progressFindingsDone, done: true, showNext: false }
    else if (hasQuestions) progress = { text: gateCopy.progressQuestionsDone, done: true, showNext: false }
    else if (bound) progress = { text: gateCopy.progressNoFindings, done: true, showNext: false }
  }
  // Read-only reason of cards and list.
  const readOnlyReason = history ? gateCopy.readOnlyHistory
    : mode === 'revision-pending' ? gateCopy.readOnlySubmitted
      : mode === 'finished' ? gateCopy.readOnlyFinished(N)
        : mode === 'sub-step' ? gateCopy.readOnlySubStep
          : run.generationRunning ? gateCopy.readOnlyGenerating
            : run.reviewRunning ? gateCopy.readOnlyReviewing
              : run.writeInFlight ? gateCopy.readOnlyWriting
                : !current.determinable ? gateCopy.readOnlyUnverified
                  : input.reviewCheck.state === 'pending' ? gateCopy.checkingBinding
                    : input.reviewCheck.state === 'failed' ? gateCopy.readOnlyCheckFailed
                      : !listActionable ? gateCopy.readOnlyNeedsReview(N) : undefined
  // Margin: the shown version's cards (§5.4, §5.9).
  const shown = reading ?? current
  const shownList = reading ? input.readingList : input.list
  const shownMerge: MergeResult = reading ? mergeFindings({ kind, binding: reading.binding.state, findings: reading.binding.findings, questions: reading.questions }) : currentMerge
  const shownBinding = shown.binding
  const shownReviewId = shownBinding.state === 'bound' ? shownBinding.review?.id : undefined
  const shownItems = reading ? numberItems(input.readingList?.items ?? []) : items
  // An older version's adopted cards name the version that follows it, not the one after the current version.
  const shownNext = reading ? nextVersionLabel(kind, reading.number) : next
  const itemNumber = (id: string | undefined) => shownItems.find((item) => item.id === id)
  // History mode: the read version's list is submitted or was never submitted; nothing waits in it (FR-6.1).
  const readingSubmitted = reading && input.readingList ? isListSubmitted(input.readingList, input.artifacts) : false
  const adoptedText = (text: string) => !reading ? gateCopy.adoptedStatus(shownNext, text)
    : readingSubmitted ? gateCopy.adoptedSubmittedStatus(text) : gateCopy.adoptedNotSubmittedStatus
  const refOf = (numbered: { id: string; number: number } | undefined) => numbered
    ? { itemRef: { itemId: numbered.id, number: numbered.number, ...(reading ? { static: true as const } : {}) } } : {}
  const findingCardsVisible = shownBinding.state === 'bound'
  let marginNote: string | undefined
  if (reading) {
    marginNote = shownBinding.review ? gateCopy.marginHistoryReview(shown.label) : gateCopy.marginHistoryNoReview(shown.label)
  } else if (mode === 'finished') marginNote = gateCopy.marginFinished(N)
  else if (mode === 'revision-pending') marginNote = gateCopy.marginPending(N)
  else if (run.reviewRunning) marginNote = gateCopy.marginReviewing(N)
  else if (kind === 'requirement' && !current.artifact.clarificationRevision) marginNote = gateCopy.marginLegacyRequirement
  else if (shownBinding.state === 'checking' || input.reviewCheck.state === 'pending') marginNote = gateCopy.checkingBinding
  else if (shownBinding.state === 'unverifiable' || input.reviewCheck.state === 'failed') marginNote = gateCopy.checkFailedBinding
  else if (shownBinding.state === 'legacy') marginNote = gateCopy.marginLegacyReview
  else if (shownBinding.state === 'none' || shownBinding.state === 'unbound') marginNote = result.marginNote ?? (kind === 'design' && (current.number ?? 0) >= 2 && input.reviewTarget.state === 'stale' ? gateCopy.marginDesignOptional(N) : gateCopy.marginNoReview(N))
  else if (shownBinding.findings.length === 0 && shown.questions.length === 0) marginNote = gateCopy.marginNoFindings(N)
  const showCards = mode !== 'finished' && !(!reading && run.reviewRunning) && !(!reading && input.reviewCheck.state !== 'done') &&
    !(kind === 'requirement' && !shown.artifact.clarificationRevision)
  const cardActionable = (isFinding: boolean) => !reading && listActionable && (!isFinding || binding.state === 'bound')
  const blocksOf = (ranges: readonly Range[]) => Array.from(new Set(ranges.flatMap((range) => shown.blocks.intersecting(range).map(blockKey))))
  const cards: CardView[] = []
  if (showCards && findingCardsVisible) {
    for (const finding of shownMerge.findingCards) {
      const status = statusOf(shownList, shownReviewId, finding.index)
      const item = shownList?.items.find((entry) => entry.source === 'finding' && entry.finding?.reviewId === shownReviewId && entry.finding?.index === finding.index)
      const numbered = itemNumber(item?.id)
      const actionable = cardActionable(true)
      cards.push({
        id: findingCardId(finding.index), kind: 'finding', number: finding.number, title: gateCopy.findingTitle(finding.number, finding.level), text: finding.text,
        ...(finding.level ? { level: finding.level } : {}), ...(finding.anchor ? { anchor: finding.anchor } : {}),
        ranges: finding.citations.map(({ start, end }) => ({ start, end })), blocks: blocksOf(finding.citations),
        status, ...(status === 'adopted' && item ? { statusText: adoptedText(item.text) } : status === 'declined' ? { statusText: gateCopy.declinedStatus } : {}),
        ...refOf(numbered),
        actionable, ...(!actionable && readOnlyReason ? { readOnlyReason } : {}), mergedLines: [],
        finding: { reviewId: shownBinding.review!.id, index: finding.index, text: finding.text, ...(finding.level ? { level: finding.level } : {}) },
      })
    }
  }
  if (showCards) {
    for (const question of shownMerge.questions as GateQuestion[]) {
      const answered = answerOf(shownList, question.number)
      const numbered = itemNumber(answered?.id)
      const actionable = cardActionable(false)
      const important = shownBinding.levelsKnown && question.level === 'important'
      const ranges = [...(question.range ? [question.range] : []), ...question.merged.flatMap((finding) => finding.citations.map(({ start, end }) => ({ start, end })))]
      const anchorBlock = question.range ? shown.blocks.blockAt(question.range.start) : undefined
      cards.push({
        id: questionCardId(question.number), kind: 'question', number: question.number,
        title: answered ? gateCopy.questionAnsweredTitle(question.number, answered.text) : gateCopy.questionOpenTitle(question.number, important),
        text: question.text, ...(important ? { level: 'important' as const } : {}), ...(anchorBlock ? { anchor: blockKey(anchorBlock) } : {}),
        ranges, blocks: blocksOf(ranges), status: answered ? 'answered' : 'open',
        ...refOf(numbered),
        actionable, ...(!actionable && readOnlyReason ? { readOnlyReason } : {}),
        mergedLines: question.merged.map((finding) => answered ? gateCopy.questionMergedHandled(finding.number) : gateCopy.questionMergedLine(finding.number, finding.text)),
        ...(answered ? { answer: answered.text } : {}),
        merged: question.merged.map((finding) => ({ reviewId: shownBinding.review?.id ?? '', index: finding.index, text: finding.text, number: finding.number })),
      })
    }
  }
  const startOf = (card: CardView) => (card.anchor ? Number(card.anchor.split(':')[0]) : undefined)
  const kindOrder = (card: CardView) => (card.kind === 'finding' ? 0 : 1)
  const navigationOrder = [
    ...cards.filter((card) => !card.anchor).sort((a, b) => kindOrder(a) - kindOrder(b) || a.number - b.number),
    ...cards.filter((card) => card.anchor).sort((a, b) => startOf(a)! - startOf(b)! || kindOrder(b) - kindOrder(a) || a.number - b.number),
  ].map((card) => card.id)
  let header: MarginHeaderView | undefined
  if (showCards && findingCardsVisible && (shownMerge.findingCards.length > 0 || shownMerge.mergeNotes.length > 0)) {
    const findingCards = cards.filter((card) => card.kind === 'finding')
    const important = findingCards.filter((card) => card.level === 'important').length
    const suggestions = findingCards.filter((card) => card.level === 'suggestion' && card.status === 'open')
    const adoptReason = !shownBinding.levelsKnown ? gateCopy.adoptAllLevelsUnknown
      : !suggestions.length ? gateCopy.adoptAllNoneLeft
        : !cardActionable(true) ? readOnlyReason ?? gateCopy.readOnlyNeedsReview(N) : undefined
    header = {
      text: gateCopy.marginHeader(findingCards.length, shownBinding.levelsKnown ? important : undefined),
      merges: shownMerge.mergeNotes.map((note) => ({ text: gateCopy.mergeLink(note.finding, note.question), cardId: questionCardId(note.question) })),
      ...(shownMerge.mergeNotes.length > 2 ? { moreText: gateCopy.mergeMore(shownMerge.mergeNotes.length - 2) } : {}),
      adoptAll: { enabled: !adoptReason, ...(adoptReason ? { disabledReason: adoptReason } : {}), findingIndexes: suggestions.map((card) => card.finding!.index) },
    }
  }
  // Thin bars: one per adopted or answered card and block; slots 0–2 in card-number order.
  const bars: BarView[] = []
  const perBlock = new Map<BlockKey, CardView[]>()
  for (const card of cards) {
    if (card.status !== 'adopted' && card.status !== 'answered') continue
    for (const key of card.blocks) perBlock.set(key, [...(perBlock.get(key) ?? []), card])
  }
  const toneOf = (card: CardView): BarView['tone'] => (card.kind === 'question' ? 'question' : card.level === 'important' ? 'important' : 'suggestion')
  const cardName = (card: CardView) => (card.kind === 'finding' ? `意见 ${card.number}` : `问题 ${card.number}`)
  const barLabel = (card: CardView) => (reading ? gateCopy.historyBarLabel : gateCopy.barLabel)(cardName(card), card.itemRef?.number ?? 0)
  for (const [key, list] of perBlock) {
    const sorted = [...list].sort((a, b) => a.number - b.number || kindOrder(a) - kindOrder(b))
    sorted.slice(0, 2).forEach((card, slot) => bars.push({ cardIds: [card.id], block: key, slot: slot as 0 | 1, tone: toneOf(card), label: barLabel(card) }))
    const rest = sorted.slice(2)
    if (rest.length) bars.push({ cardIds: rest.map((card) => card.id), block: key, slot: 2, tone: toneOf(rest[0]!), label: rest.map(barLabel).join('；') })
  }
  // List panel.
  const proposalIds = items.filter((item) => item.source === 'chat').map((item) => item.chat!.proposal.id)
  const listItems: ListItemView[] = (mode === 'revision-pending' ? [] : items).map((item) => {
    const detail = item.source === 'finding' && item.item?.finding ? gateCopy.sourceDetailFinding(item.item.finding.text, item.item.finding.level)
      : item.source === 'question' && item.item?.question ? [gateCopy.sourceDetailQuestion(item.item.question.text, item.text),
        ...item.item.question.merged.map((merged) => gateCopy.sourceDetailMerged(merged.index + 1, merged.text))].join('\n')
        : item.source === 'chat' && item.chat ? item.chat.proposal.title : item.text
    const cardId = item.source === 'finding' && item.item?.finding ? findingCardId(item.item.finding.index)
      : item.source === 'question' && item.item?.question ? questionCardId(item.item.question.index + 1) : undefined
    return { id: item.id, number: item.number, source: item.source, label: item.label, ...(item.tag ? { tag: item.tag } : {}), text: item.text, detail,
      ...(item.chat ? { proposalId: item.chat.proposal.id, proposalTitle: item.chat.proposal.title, proposalBody: item.chat.proposal.content } : {}),
      ...(cardId ? { cardId } : {}) }
  })
  const listCount = mode === 'revision-pending' ? submittedCount : rowNumber === '7a' ? undefined : K
  const listReadOnly = reading ? gateCopy.listReadOnlyHistory(reading.label, N) : listActionable ? undefined : readOnlyReason
  const list: ListView = {
    toggleLabel: gateCopy.listToggle(listCount), toggleEnabled: rowNumber !== '7a', ...(listCount === undefined ? {} : { count: listCount }),
    header: gateCopy.listHeader(N, next),
    emptyText: listActionable ? (kind === 'requirement' ? gateCopy.listEmptyRequirement : gateCopy.listEmptyDesign)
      : reading || mode === 'finished' || mode === 'sub-step' ? gateCopy.listEmptyNoList : gateCopy.listEmptyReadOnly,
    items: listItems, actionable: listActionable, ...(listReadOnly ? { readOnlyReason: listReadOnly } : {}),
    ...(mode === 'revision-pending' && input.submittedText ? { submittedText: input.submittedText } : {}),
    addLabel: gateCopy.addOwnButton, addPlaceholder: gateCopy.addOwnPlaceholder, generationLine,
    composedText, composedLength: measured.length, ...(measured.reason ? { overflowReason: measured.reason } : {}), proposalIds,
  }
  // Meta line.
  const review = binding.review
  const technical: Array<{ label: string; value: string }> = [
    { label: 'run', value: `${current.artifact.runId}` },
    { label: 'artifact', value: current.artifact.id },
    { label: 'updatedAt', value: current.artifact.updatedAt },
    ...(current.artifact.clarificationRevision ? [{ label: 'revision', value: `${current.artifact.clarificationRevision.revision} · ${current.artifact.clarificationRevision.revisionDigest}` }] : []),
    ...(review ? [{ label: 'review', value: `${review.id} · ${review.executorKind ?? 'direct-provider'}` }] : []),
    ...(input.finished?.actorId ? [{ label: 'actor', value: input.finished.actorId }] : []),
    ...(input.policy.loadError ? [{ label: 'policy', value: input.policy.loadError }] : []),
    ...(input.reviewCheck.technical ? [{ label: 'check', value: input.reviewCheck.technical }] : []),
    ...(input.writeResult?.technical ? [{ label: 'write', value: input.writeResult.technical }] : []),
    ...(input.technical ?? []),
  ]
  const rerunLocked = run.writeLock ? gateCopy.writeLock : input.reviewRunBlockedReason
  const meta: MetaView = {
    ...(input.permission.role || input.permission.requiredRole ? { role: input.permission.roleCanApprove
      ? gateCopy.roleCanApprove(roleLabel(input.permission.role ?? input.permission.requiredRole))
      : gateCopy.roleCannotApprove(roleLabel(input.permission.requiredRole)) } : {}),
    ...(review ? { review: gateCopy.reviewedAt(formatLocalTime(review.createdAt), review.model) } : {}),
    ...(rerunAllowed && !run.reviewRunning && !buttons.some((item) => item.id === 'review') ? { rerun: { enabled: !rerunLocked, ...(rerunLocked ? { disabledReason: rerunLocked } : {}) } } : {}),
    changeReviewModel: true,
    ...(input.evaluatedAt ? { freshness: gateCopy.dataUpdatedAt(formatLocalTime(input.evaluatedAt)) } : {}),
    ...(mode === 'finished' ? { stepNote: gateCopy.finishedMeta } : {}),
    technical,
  }
  // Material.
  let historyList: HistoryListView | undefined
  if (reading && input.readingList && (input.readingList.items.length || input.readingList.submitted)) {
    const readingItems = numberItems(input.readingList.items)
    const count = input.readingList.submitted?.itemCount ?? readingItems.length
    const title = isListSubmitted(input.readingList, input.artifacts) ? gateCopy.historyListSubmitted(count)
      : input.readingList.confirmedWithout ? gateCopy.historyListConfirmedWithout(reading.label, count) : gateCopy.historyListUnsubmitted(reading.label, count)
    historyList = { title, text: input.readingList.submitted?.text ?? composeRevisionText(readingItems, { kind, version: reading.label }), count }
  }
  const material: GateDecisionView['material'] = {
    header: materialHeader({ kind, artifact: shown.artifact, artifacts: input.artifacts, ...(shown.number === undefined ? {} : { number: shown.number }), ...(input.designNumbers ? { designNumbers: input.designNumbers } : {}) }),
    recordedAt: recordedAtLine(shown.artifact),
    ...(input.rawRequest !== undefined ? { rawRequest: rawRequestLine(input.rawRequest) } : {}),
    bars, newBlocks: [...shown.newBlocks],
    ...(reading ? { readOnlyBanner: gateCopy.historyBanner(reading.label, N) } : {}),
    ...(historyList ? { historyList } : {}),
  }
  return {
    bar: { row: rowNumber, mode: result.mode, title: result.title, ...(progress ? { progress } : {}), notes, buttons, costLines,
      ...(result.stop ? { stop: result.stop } : {}), list, meta },
    margin: { ...(header ? { header } : {}), ...(marginNote ? { note: marginNote } : {}), cards, navigationOrder },
    material,
    listActionable,
  }
}
