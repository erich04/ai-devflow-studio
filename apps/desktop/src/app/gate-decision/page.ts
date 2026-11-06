/**
 * Which pages use the gate decision layout and which version and review each mode shows (design
 * §5.1). The first matching row wins; `undefined` keeps today's UI.
 */
import {
  buildClarificationReviewBundle,
  clarificationRevisionNumber,
  listClarificationRevisions,
  listDesignApprovals,
  numberDesignVersions,
  resolveDesignGateMaterial,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { formatLocalTime } from '../desktop-view-model'
import { gateCopy, versionLabel, type GateKind } from './copy'
export type GatePageMode = 'current' | 'revision-pending' | 'finished' | 'sub-step'
export type GateVersion = { artifact: Artifact; number?: number; label: string }
export type GatePage = {
  kind: GateKind
  mode: GatePageMode
  /** Matched row of the §5.1 table. */
  row: number
  agentNode: WorkflowNode
  gateNode: WorkflowNode
  /** The version the bar targets. */
  current: GateVersion
  /** The version shown; differs from `current` in history mode. */
  reading: GateVersion
  /** Every version of the stage, oldest first (for the 「阅读版本」 select). */
  versions: GateVersion[]
  /** The approval object's identity is determinable (bundle or design material `ready`, not legacy). */
  determinable: boolean
  determinableMessage?: string
  /** Gate-node review used for the bar (`current`). */
  currentReview?: AgentReviewResult
  /** Gate-node review used for the cards of `reading`. */
  readingReview?: AgentReviewResult
  /** Design only: generating a new version needs a running design gate. */
  generationAllowed: boolean
}
const stageNodes = (run: WorkflowRun, stage: 'clarify' | 'design') => ({
  agent: run.nodes.find((node) => node.stage === stage && node.kind === 'agent'),
  gate: run.nodes.find((node) => node.stage === stage && node.kind === 'gate'),
})
const gateReviews = (reviews: readonly AgentReviewResult[], run: WorkflowRun, gate: WorkflowNode) =>
  reviews.filter((review) => review.runId === run.id && review.nodeId === gate.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
/** The latest gate-node review whose manifest has a subject with the version's id and recorded time. */
export function reviewForVersion(reviews: readonly AgentReviewResult[], run: WorkflowRun, gate: WorkflowNode, artifact: Artifact): AgentReviewResult | undefined {
  return gateReviews(reviews, run, gate).find((review) => review.contextManifest?.subjectArtifacts.some((subject) =>
    subject.id === artifact.id && subject.updatedAt === artifact.updatedAt))
}
/** Versions of one stage of a run, oldest first, with their display numbers and labels. */
export function stageVersions(kind: GateKind, runId: string, artifacts: readonly Artifact[]): GateVersion[] {
  if (kind === 'requirement') {
    return listClarificationRevisions(runId, artifacts).map((artifact) => {
      const number = clarificationRevisionNumber(artifact)
      return { artifact, number, label: artifact.clarificationRevision ? versionLabel(kind, number) : gateCopy.headerRequirementLegacy }
    })
  }
  const numbers = numberDesignVersions(runId, artifacts)
  return artifacts.filter((artifact) => artifact.runId === runId && artifact.kind === 'design')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    .map((artifact) => {
      const number = numbers.get(artifact.id)
      return { artifact, ...(number === undefined ? {} : { number }), label: versionLabel(kind, number, formatLocalTime(artifact.updatedAt)) }
    })
}
export function resolveGatePage(input: {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: readonly Artifact[]
  reviews: readonly AgentReviewResult[]
  events: readonly AgentEvent[]
  /** The version chosen in 「阅读版本」; empty or unknown means the current version. */
  readingArtifactId?: string | undefined
}): GatePage | undefined {
  const { run, node, artifacts } = input
  if (node.stage !== 'clarify' && node.stage !== 'design') return undefined
  if (node.kind !== 'agent' && node.kind !== 'gate') return undefined
  const kind: GateKind = node.stage === 'clarify' ? 'requirement' : 'design'
  const { agent, gate } = stageNodes(run, node.stage)
  if (!agent || !gate) return undefined
  const versions = stageVersions(kind, run.id, artifacts)
  const versionOf = (artifact: Artifact | undefined) => artifact && versions.find((version) => version.artifact.id === artifact.id)
  const isCurrentGate = run.currentNodeId === gate.id
  let mode: GatePageMode | undefined
  let row = 9
  if (kind === 'requirement') {
    const latest = versions.at(-1)?.artifact
    if (latest?.clarificationRevision?.status === 'revision_requested') { mode = 'revision-pending'; row = 1 }
    else if (gate.status === 'success') { mode = 'finished'; row = 2 }
    else if (node.kind === 'gate' && isCurrentGate && (gate.status === 'running' || gate.status === 'blocked')) { mode = 'current'; row = 3 }
    else if (node.kind === 'agent' && versions.length && isCurrentGate) { mode = 'sub-step'; row = 4 }
    else return undefined                                     // rows 5 and 9: today's UI
  } else {
    if (gate.status === 'success') { mode = 'finished'; row = 6 }
    else if (node.kind === 'gate' && isCurrentGate && (gate.status === 'running' || gate.status === 'blocked')) { mode = 'current'; row = 7 }
    else if (node.kind === 'agent' && versions.length && isCurrentGate) { mode = 'sub-step'; row = 8 }
    else return undefined
  }
  if (!versions.length) return undefined
  let current: GateVersion | undefined
  let determinable = true
  let determinableMessage: string | undefined
  if (mode === 'current' || mode === 'sub-step') {
    if (kind === 'requirement') {
      const bundle = buildClarificationReviewBundle({ run, gateNode: gate, artifacts })
      current = versionOf(bundle.activeRevision) ?? versions.at(-1)
      if (bundle.state !== 'ready') { determinable = false; determinableMessage = bundle.message }
      else if (!current?.artifact.clarificationRevision) { determinable = false; determinableMessage = gateCopy.legacyRequirement }
    } else {
      const material = resolveDesignGateMaterial({ run, gateNode: gate, artifacts })
      current = material.state === 'ready' ? versionOf(material.artifact) : versions.at(-1)
      if (material.state !== 'ready') { determinable = false; determinableMessage = material.message }
    }
  } else if (mode === 'revision-pending') {
    current = versions.at(-1)
  } else if (kind === 'requirement') {
    current = [...versions].reverse().find((version) => version.artifact.clarificationRevision?.status === 'approved') ?? versions.at(-1)
  } else {
    const approvedId = listDesignApprovals(input.events, run.id)[0]?.designAudit?.artifactId
    const material = resolveDesignGateMaterial({ run, gateNode: gate, artifacts })
    current = versions.find((version) => version.artifact.id === approvedId) ??
      (material.state === 'ready' ? versionOf(material.artifact) : undefined) ?? versions.at(-1)
  }
  if (!current) return undefined
  const reading = (input.readingArtifactId && versions.find((version) => version.artifact.id === input.readingArtifactId)) || current
  const latestGateReview = gateReviews(input.reviews, run, gate)[0]
  const currentReview = mode === 'current' || mode === 'sub-step' ? latestGateReview : reviewForVersion(input.reviews, run, gate, current.artifact)
  const readingReview = reading.artifact.id === current.artifact.id ? currentReview : reviewForVersion(input.reviews, run, gate, reading.artifact)
  return {
    kind, mode, row, agentNode: agent, gateNode: gate, current, reading, versions, determinable,
    ...(determinableMessage ? { determinableMessage } : {}),
    ...(currentReview ? { currentReview } : {}), ...(readingReview ? { readingReview } : {}),
    generationAllowed: kind === 'requirement' || gate.status === 'running',
  }
}
