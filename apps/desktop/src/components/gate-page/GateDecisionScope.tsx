import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { numberDesignVersions, type AgentReviewResult, type Artifact, type DesignRevisionIdentity, type WorkflowRun } from '@ai-devflow/shared'
import type { DiscussionMaterial } from '../../app/discussion-reference'
import { versionLabel, type GateKind } from '../../app/gate-decision/copy'
import { gateReadingBlocks, indexReadingBlocks, locateOpenQuestions, newBlocks, type BlockIndex, type BlockKey, type LocatedQuestion } from '../../app/gate-decision/material'
import type { GatePage } from '../../app/gate-decision/page'
import { nextCardTarget } from '../../app/gate-decision/placement'
import { deriveReviewTarget, projectGateDecision, type GateDecisionView, type GateProjectionInput, type GateVersionFacts } from '../../app/gate-decision/projection'
import { bindReview, reviewCheckOf } from '../../app/gate-decision/review-binding'
import {
  deriveChatItems, findStoredList, listKey, otherListsOf,
  type ListTarget, type RevisionListOp, type RevisionListOpResult,
} from '../../app/gate-decision/revision-list'
import { useContentDigest, useDesignIdentity } from '../../app/useContentDigest'
import type { RevisionListsApi } from '../../app/useRevisionLists'
import type { RecordReviewFeedback } from './FindingEvidence'

/** The version the page shows and the identity a write must still match (main re-checks it). */
export type GateWriteContext = { current: Artifact; target?: ListTarget | undefined; designIdentity?: DesignRevisionIdentity | undefined }
/** Writes and navigation the Inspector wires in; the page itself never calls IPC. */
export type GateActions = {
  /** Every review button and the meta 「重新审查」 (→ `requestKnowledgeReview`, §3.21). */
  onRequestReview(): void
  onStop(target: 'review' | 'generation'): void
  /** 「提交修订，生成 vN+1」 / 「生成方案 vN+1」 with the composed text and the 来自答疑 proposals in list order. */
  onSubmit(input: GateWriteContext & { text: string; proposals: Artifact[]; itemCount: number }): void
  /** 「确认…」 and 「不修订，直接确认…」; `unsubmittedCount` is K of the current list. */
  onConfirm(input: GateWriteContext & { unsubmittedCount: number }): void
  onRegenerate(): void
  onSyncTeam(): void
  onReloadPolicy(): void
  /** The Inspector's `openSettings('models')`. */
  onOpenModelSettings(): void
  /** Opens a version in history mode (the 「阅读版本」 choice). */
  onOpenVersion(artifactId: string): void
  /** 「完整报告」: opens 材料与版本. */
  onOpenReport(): void
  onDiscuss?: ((material: DiscussionMaterial) => void) | undefined
  onFeedback?: RecordReviewFeedback | undefined
  /** A 来自答疑 source label targets the answer panel. */
  onFocusChatItem?: ((proposalId: string) => void) | undefined
  /** Today's executor and model selects, expanded by 「更改」. */
  renderStageSettings?: (() => ReactNode) | undefined
  /** Clipboard write for 「复制全部」; defaults to `navigator.clipboard.writeText`. */
  onCopy?: ((text: string) => Promise<void>) | undefined
}
/** Projection input that App and the Inspector know; the scope adds versions, digests and lists. */
export type GateScopeFacts = Pick<GateProjectionInput, 'policy' | 'permission' | 'runFacts' | 'generation'> &
  Partial<Pick<GateProjectionInput, 'stageFailure' | 'reviewFailure' | 'writeResult' | 'finished' | 'reviewProviderLabel' |
    'reviewRunBlockedReason' | 'reviewModelMissing' | 'evaluatedAt' | 'submittedText' | 'technical' | 'rawRequest'>>
type StaticFacts = { blocks: BlockIndex; questions: LocatedQuestion[]; newBlocks: BlockKey[] }
export type GateScopeValue = {
  page: GatePage
  kind: GateKind
  view: GateDecisionView
  input: GateProjectionInput
  /** The version shown (reading, else current). */
  shown: GateVersionFacts
  history: boolean
  listTarget?: ListTarget | undefined
  designIdentity?: DesignRevisionIdentity | undefined
  actions: GateActions
  /** Applies a list operation to the current version's list. */
  apply(op: RevisionListOp): RevisionListOpResult
  storageNotes: string[]
  armed?: string | undefined
  setArmed(id: string | undefined): void
  pendingFocus?: { serial: number; cardId: string } | undefined
  /** Bar controls that target a card (3.26): switch to 当前工作 and the current version first. */
  focusCard(cardId: string): void
  clearPendingFocus(serial: number): void
  lastVisitedCardId?: string | undefined
  setLastVisitedCardId(id: string): void
  goNext(): void
  onlyUnhandled: boolean
  setOnlyUnhandled(value: boolean): void
  drafts: Record<string, string>
  setDraft(key: string, value: string | undefined): void
  listExpanded: boolean
  setListExpanded(value: boolean): void
  flashItem?: { itemId: string; serial: number } | undefined
  /** 「第 K 项」: expands the list and flashes the item; works on every tab. */
  showItem(itemId: string): void
  retry(): void
  showCurrentVersion(): void
}
const GateScopeContext = createContext<GateScopeValue | null>(null)
export function useGateScope(): GateScopeValue {
  const value = useContext(GateScopeContext)
  if (!value) throw new Error('useGateScope outside GateDecisionScope')
  return value
}
function staticFactsOf(kind: GateKind, artifact: Artifact, previousContent: string | undefined): StaticFacts {
  return {
    blocks: indexReadingBlocks(gateReadingBlocks(artifact.content)),
    questions: kind === 'requirement' ? locateOpenQuestions(artifact.content, artifact.clarificationRevision?.openQuestions ?? []) : [],
    newBlocks: newBlocks(artifact.content, previousContent),
  }
}
const previousIdOf = (artifact: Artifact | undefined) => artifact?.clarificationRevision?.previousRevisionArtifactId ?? artifact?.designRevision?.previous.artifactId
/**
 * Owns everything the gate page shares across the bar and the workspace (design §5.11): the
 * digest hooks in a fixed order, the projection, the armed confirm and the view state that must
 * survive tab and layout switches (3.26).
 */
export function GateDecisionScope({ page, run, artifacts, reviews, revisionLists, facts, actions, currentWorkVisible, showCurrentWork, showCurrentVersion, children }: {
  page: GatePage
  run: WorkflowRun
  artifacts: readonly Artifact[]
  /** All reviews of the run (`runAgentReviews`). */
  reviews: readonly AgentReviewResult[]
  revisionLists: RevisionListsApi
  facts: GateScopeFacts
  actions: GateActions
  /** Whether 当前工作 is the active tab. */
  currentWorkVisible: boolean
  showCurrentWork(): void
  showCurrentVersion(): void
  children: ReactNode
}) {
  const kind = page.kind
  const current = page.current.artifact
  const readingArtifact = page.reading.artifact.id === current.id ? undefined : page.reading.artifact
  // Digest hooks, always in this order (§5.11).
  const currentDigest = useContentDigest(current.content)
  const readingDigest = useContentDigest(readingArtifact?.content)
  const designDigest = useDesignIdentity(kind === 'design' ? current : undefined)
  const contentOf = (id: string | undefined) => (id ? artifacts.find((artifact) => artifact.id === id)?.content : undefined)
  const currentPrevious = contentOf(previousIdOf(current))
  const readingPrevious = contentOf(previousIdOf(readingArtifact))
  const currentQuestions = (current.clarificationRevision?.openQuestions ?? []).join('\n')
  // Keyed by content, so a new `artifacts` array with the same versions keeps every block and section.
  const currentStatic = useMemo(() => staticFactsOf(kind, current, currentPrevious), [kind, current.id, current.content, currentQuestions, currentPrevious])
  const readingStatic = useMemo(() => (readingArtifact ? staticFactsOf(kind, readingArtifact, readingPrevious) : undefined),
    [kind, readingArtifact?.id, readingArtifact?.content, readingPrevious])
  const currentBinding = useMemo(() => bindReview({ review: page.currentReview, artifact: current, blocks: currentStatic.blocks,
    contentDigest: { state: currentDigest.state, value: currentDigest.value, error: currentDigest.error } }),
  [page.currentReview, current, currentStatic.blocks, currentDigest.state, currentDigest.value, currentDigest.error])
  const readingBinding = useMemo(() => (readingArtifact && readingStatic ? bindReview({ review: page.readingReview, artifact: readingArtifact, blocks: readingStatic.blocks,
    contentDigest: { state: readingDigest.state, value: readingDigest.value, error: readingDigest.error } }) : undefined),
  [page.readingReview, readingArtifact, readingStatic, readingDigest.state, readingDigest.value, readingDigest.error])
  const designIdentity = designDigest.identity
  const listTarget = useMemo((): ListTarget | undefined => {
    if (kind === 'requirement') {
      const metadata = current.clarificationRevision
      return metadata ? { kind, runId: run.id, artifactId: current.id, revision: metadata.revision, revisionDigest: metadata.revisionDigest } : undefined
    }
    return designIdentity ? { kind, runId: run.id, artifactId: current.id, updatedAt: designIdentity.updatedAt, contentDigest: designIdentity.contentDigest } : undefined
  }, [kind, run.id, current.id, current.clarificationRevision, designIdentity])
  const designNumbers = useMemo(() => numberDesignVersions(run.id, [...artifacts]), [run.id, artifacts])
  const input = useMemo((): GateProjectionInput => {
    const store = revisionLists.store
    const list = listTarget ? revisionLists.listFor(listTarget) : undefined
    const others = otherListsOf(store, { kind, runId: run.id, ...(listTarget ? { exceptKey: listKey(listTarget) } : {}) })
    const labelOf = (artifactId: string) => page.versions.find((version) => version.artifact.id === artifactId)?.label ?? versionLabel(kind, undefined)
    const chatItems = page.mode === 'current' && listTarget
      ? deriveChatItems({ kind, runId: run.id, agentNodeId: page.agentNode.id, gateNodeId: page.gateNode.id, artifacts, list, otherLists: others })
      : []
    const readingList = readingArtifact ? findStoredList(store, { kind, runId: run.id, reading: readingArtifact,
      ...(readingArtifact.clarificationRevision ? { revision: readingArtifact.clarificationRevision.revision } : {}) }) : undefined
    const feedbackText = artifacts.filter((artifact) => artifact.kind === 'clarification_feedback' && artifact.clarificationFeedback?.targetArtifactId === current.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.content
    const submittedText = page.mode === 'revision-pending' ? facts.submittedText ?? list?.submitted?.text ?? feedbackText : facts.submittedText
    const check = reviewCheckOf({ binding: currentBinding, ...(kind === 'design' ? { designIdentity: designDigest } : {}) })
    const identityOpen = kind === 'design' && designDigest.state !== 'done' && currentBinding.state !== 'checking' && currentBinding.state !== 'unverifiable'
    const technical = designDigest.error ?? currentDigest.error
    const { rawRequest, ...rest } = facts
    return {
      ...rest,
      kind, mode: page.mode,
      current: { artifact: current, ...(page.current.number === undefined ? {} : { number: page.current.number }), label: page.current.label,
        binding: currentBinding, ...currentStatic, determinable: page.determinable, ...(page.determinableMessage ? { determinableMessage: page.determinableMessage } : {}) },
      ...(readingArtifact && readingStatic && readingBinding ? { reading: { artifact: readingArtifact, ...(page.reading.number === undefined ? {} : { number: page.reading.number }),
        label: page.reading.label, binding: readingBinding, ...readingStatic } } : {}),
      artifacts, designNumbers, ...(rawRequest !== undefined ? { rawRequest } : {}),
      reviewTarget: deriveReviewTarget({ kind, run, gateNode: page.gateNode, reviews, current, artifacts, designNumbers }),
      ...(list ? { list } : {}), chatItems, ...(readingList ? { readingList } : {}),
      otherLists: others.map((other) => ({ list: other, label: labelOf(other.target.artifactId) })),
      reviewCheck: { state: check, ...(identityOpen ? { designIdentity: true } : {}), ...(check === 'failed' && technical ? { technical } : {}) },
      ...(submittedText !== undefined ? { submittedText } : {}),
      generationAllowed: page.generationAllowed,
    }
  }, [facts, kind, page, run, reviews, artifacts, current, readingArtifact, currentStatic, readingStatic, currentBinding, readingBinding,
    listTarget, designNumbers, revisionLists, designDigest, currentDigest.error])
  const view = useMemo(() => projectGateDecision(input), [input])
  // View state that survives tab and layout switches (3.26).
  const [armed, setArmed] = useState<string>()
  const [pendingFocus, setPendingFocus] = useState<{ serial: number; cardId: string }>()
  const [lastVisitedCardId, setLastVisitedCardId] = useState<string>()
  const [onlyUnhandled, setOnlyUnhandled] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [listExpanded, setListExpanded] = useState(false)
  const [flashItem, setFlashItem] = useState<{ itemId: string; serial: number }>()
  useEffect(() => { setArmed(undefined) }, [view.bar.row, view.bar.title])
  useEffect(() => { setDrafts({}); setLastVisitedCardId(undefined) }, [current.id])
  const history = Boolean(readingArtifact)
  const apply = useCallback((op: RevisionListOp): RevisionListOpResult => (listTarget ? revisionLists.apply(listTarget, op)
    : { ok: false, message: '这个版本的修订清单还不可用。' }), [listTarget, revisionLists])
  const focusCard = useCallback((cardId: string) => {
    if (!currentWorkVisible) showCurrentWork()
    if (history) showCurrentVersion()
    setPendingFocus((previous) => ({ serial: (previous?.serial ?? 0) + 1, cardId }))
  }, [currentWorkVisible, history, showCurrentWork, showCurrentVersion])
  const clearPendingFocus = useCallback((serial: number) => setPendingFocus((previous) => (previous?.serial === serial ? undefined : previous)), [])
  const goNext = useCallback(() => {
    // Always a card of the current version; while history is read, project it without the reading.
    const margin = history ? projectGateDecision({ ...input, reading: undefined }).margin : view.margin
    const handled = (id: string) => margin.cards.find((card) => card.id === id)?.status !== 'open'
    const target = nextCardTarget(margin.navigationOrder, lastVisitedCardId, handled)
    if (target) focusCard(target)
  }, [history, input, view.margin, lastVisitedCardId, focusCard])
  const setDraft = useCallback((key: string, value: string | undefined) => setDrafts((previous) => {
    if (value === undefined) { const { [key]: _removed, ...rest } = previous; return rest }
    return { ...previous, [key]: value }
  }), [])
  const showItem = useCallback((itemId: string) => {
    setListExpanded(true)
    setFlashItem((previous) => ({ itemId, serial: (previous?.serial ?? 0) + 1 }))
  }, [])
  const retry = useCallback(() => {
    if (currentDigest.state === 'failed') currentDigest.retry()
    if (readingDigest.state === 'failed') readingDigest.retry()
    if (designDigest.state === 'failed') designDigest.retry()
  }, [currentDigest, readingDigest, designDigest])
  const storageNotes = [revisionLists.droppedNotice, revisionLists.saveError].filter((text): text is string => Boolean(text))
  const shown = input.reading ?? input.current
  const value: GateScopeValue = {
    page, kind, view, input, shown, history, ...(listTarget ? { listTarget } : {}), ...(designIdentity ? { designIdentity } : {}), actions, apply, storageNotes,
    armed, setArmed, pendingFocus, focusCard, clearPendingFocus, lastVisitedCardId, setLastVisitedCardId, goNext,
    onlyUnhandled, setOnlyUnhandled, drafts, setDraft, listExpanded, setListExpanded, flashItem, showItem, retry, showCurrentVersion,
  }
  return <GateScopeContext.Provider value={value}>{children}</GateScopeContext.Provider>
}
