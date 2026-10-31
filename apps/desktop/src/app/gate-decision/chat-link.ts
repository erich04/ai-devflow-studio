/**
 * The answer panel's 「加入修订清单」 button (design §5.10). Pure: the rows are evaluated in order
 * and the first match wins. The draft type is structural, so this module needs no Electron import.
 */
import { listClarificationRevisions, numberDesignVersions, type Artifact, type WorkflowRun } from '@ai-devflow/shared'
import { gateCopy, nextVersionLabel, versionLabel, type GateKind } from './copy'
import type { GatePageMode } from './page'
import { coveredByUnrecordedGeneration, proposalUsedBy, type NumberedItem, type StoredRevisionList } from './revision-list'
/** The fields of a conversation draft (`ConversationDraft`) this module reads. */
export type ChatDraft = {
  runId: string
  nodeId: string
  inputReceipt?: { documents: ReadonlyArray<{ id: string }> } | undefined
  publishedArtifactId?: string | undefined
  review?: { status: string } | undefined
}
export type ChatMessage = { id: string; createdAt: string }
/** What the page of one run and stage knows (`pageFacts(runId, kind)`). */
export type ChatPageFacts = {
  mode?: GatePageMode | undefined
  current?: { artifactId: string; number?: number | undefined } | undefined
  generationRunning: boolean
  listActionable: boolean
  /** The row's read-only reason when the list is not actionable; default: the review text. */
  listReadOnlyReason?: string | undefined
  listKey?: string | undefined
  /** Numbered items of the current list, derived chat items included. */
  items: readonly NumberedItem[]
  /** The current list and the other lists of the same run and stage. */
  lists: readonly StoredRevisionList[]
}
export type RevisionLink =
  | { state: 'none' }
  | { state: 'written'; text: string }
  | { state: 'submitted'; text: string }
  | { state: 'disabled'; reason: string; label: string }
  | { state: 'added'; text: string; itemId: string; number: number; listKey?: string | undefined }
  | { state: 'readd'; label: string; proposalId: string; listKey?: string | undefined }
  | { state: 'saved'; text: string }
  | { state: 'add'; label: string; preview: string }
const kindOfStage = (stage: string | undefined): GateKind | undefined => (stage === 'clarify' ? 'requirement' : stage === 'design' ? 'design' : undefined)
const stageArtifacts = (kind: GateKind, runId: string, artifacts: readonly Artifact[]) => kind === 'requirement'
  ? listClarificationRevisions(runId, artifacts)
  : artifacts.filter((artifact) => artifact.runId === runId && artifact.kind === 'design').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
function numberOf(kind: GateKind, runId: string, artifacts: readonly Artifact[], artifact: Artifact): number | undefined {
  if (kind === 'requirement') return artifact.clarificationRevision?.revision ?? 1
  return numberDesignVersions(runId, artifacts).get(artifact.id)
}
/** The version a draft was written against: the receipt's formal document, else the newest version not later than the message. */
export function draftMaterialVersion(input: { kind: GateKind; draft: ChatDraft; message: ChatMessage; artifacts: readonly Artifact[] }): Artifact | undefined {
  const versions = stageArtifacts(input.kind, input.draft.runId, input.artifacts)
  const named = input.draft.inputReceipt?.documents.map((document) => versions.find((artifact) => artifact.id === document.id)).find(Boolean)
  if (named) return named
  return [...versions].reverse().find((artifact) => artifact.updatedAt <= input.message.createdAt)
}
export function revisionLinkForDraft(input: {
  draft: ChatDraft
  message: ChatMessage
  runs: readonly WorkflowRun[]
  artifacts: readonly Artifact[]
  pageFacts: (runId: string, kind: GateKind) => ChatPageFacts | undefined
}): RevisionLink {
  const { draft, artifacts } = input
  const run = input.runs.find((item) => item.id === draft.runId)
  const node = run?.nodes.find((item) => item.id === draft.nodeId)
  const kind = kindOfStage(node?.stage)
  if (!run || !kind) return { state: 'none' }
  const versions = stageArtifacts(kind, run.id, artifacts)
  if (!versions.length) return { state: 'none' }
  const label = (artifact: Artifact) => versionLabel(kind, numberOf(kind, run.id, artifacts, artifact))
  const proposal = draft.publishedArtifactId ? artifacts.find((artifact) => artifact.id === draft.publishedArtifactId) : undefined
  // 1–2: provenance first.
  if (proposal) {
    const used = proposalUsedBy(artifacts.filter((artifact) => artifact.runId === run.id), proposal.id)
    const inputs = used.inputs.filter((artifact) => artifact.kind === (kind === 'requirement' ? 'clarification' : 'design'))
    if (inputs.length) {
      const earliest = [...inputs].sort((a, b) => (numberOf(kind, run.id, artifacts, a) ?? Infinity) - (numberOf(kind, run.id, artifacts, b) ?? Infinity) || a.updatedAt.localeCompare(b.updatedAt))[0]!
      return { state: 'written', text: gateCopy.chatWritten(label(earliest)) }
    }
    if (kind === 'requirement' && used.feedback.length) {
      const target = used.feedback[0]!.clarificationFeedback!.targetRevision
      return { state: 'submitted', text: gateCopy.chatSubmitted(versionLabel(kind, target), nextVersionLabel(kind, target)) }
    }
  }
  const facts = input.pageFacts(run.id, kind)
  const currentArtifact = facts?.current ? versions.find((artifact) => artifact.id === facts.current!.artifactId) : versions.at(-1)
  const currentNumber = facts?.current?.number ?? (currentArtifact ? numberOf(kind, run.id, artifacts, currentArtifact) : undefined)
  const current = versionLabel(kind, currentNumber)
  const next = nextVersionLabel(kind, currentNumber)
  const disabled = (reason: string): RevisionLink => ({ state: 'disabled', reason, label: gateCopy.chatAddButton })
  // 3: stage-level states.
  if (facts?.mode === 'finished') return disabled(gateCopy.chatFinished(current))
  if (facts?.generationRunning) return disabled(gateCopy.chatGenerating(next))
  if (facts?.mode === 'revision-pending') return disabled(gateCopy.chatPending(current, next))
  if (draft.review?.status === 'stale') return disabled(gateCopy.chatStale)
  // 4: already in the current list.
  if (proposal) {
    const item = facts?.items.find((entry) => entry.source === 'chat' && entry.chat?.proposal.id === proposal.id)
    if (item) return { state: 'added', text: gateCopy.chatAdded(item.number), itemId: item.id, number: item.number, listKey: facts?.listKey }
  }
  // 5: the list or the draft's version cannot take it.
  if (!facts?.listActionable) return disabled(facts?.listReadOnlyReason ?? gateCopy.chatNeedsReview(current))
  const removed = proposal ? (facts.lists.some((list) => list.chat[proposal.id]?.removed)) : false
  if (!proposal || removed) {
    const version = draftMaterialVersion({ kind, draft, message: input.message, artifacts })
    if (!version) return disabled(gateCopy.chatBeforeV1(kind))
    if (currentArtifact && version.id !== currentArtifact.id) return disabled(gateCopy.chatOlderVersion(label(version), current))
  }
  // 6–8.
  if (proposal && removed) return { state: 'readd', label: gateCopy.chatAddButton, proposalId: proposal.id, listKey: facts.listKey }
  if (proposal) {
    const agentNodeId = run.nodes.find((item) => item.stage === node!.stage && item.kind === 'agent')?.id ?? ''
    if (coveredByUnrecordedGeneration({ kind, runId: run.id, agentNodeId, artifacts, proposal })) return { state: 'saved', text: gateCopy.chatSaved(kind) }
    return { state: 'none' }
  }
  return { state: 'add', label: gateCopy.chatAddButton, preview: gateCopy.chatAddPreview(current) }
}
