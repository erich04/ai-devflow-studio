/**
 * "意见 N" outside the shown version's margin (#276): list items of an earlier review, the full
 * report in 材料与版本. Every number comes from `mergeFindings`, so it is the number the margin of
 * the reviewed version shows. Nothing stored is renumbered.
 */
import type { AgentReviewResult, Artifact } from '@ai-devflow/shared'
import { locateOpenQuestions } from './material'
import { mergeFindings, type FindingNumbers } from './merge'
import { bindReview } from './review-binding'
export type { FindingNumbers } from './merge'
/** "意见 N" of finding `index` of review `reviewId`. */
export type FindingNumberOf = (reviewId: string, index: number) => number
/** The number of finding `index`; review order when the numbering does not know the review. */
export const findingNumber = (numbers: FindingNumbers | undefined, index: number) => numbers?.get(index) ?? index + 1
const cache = new WeakMap<AgentReviewResult, { artifact: Artifact; numbers: FindingNumbers }>()
/**
 * The numbering of a gate review as the margin of the version it reviewed shows it: bound to that
 * version with the digest the review recorded, merged with that version's open questions.
 * `undefined` (review order) when the review recorded no subject or the version is not loaded.
 */
export function reviewFindingNumbers(review: AgentReviewResult | undefined, artifacts: readonly Artifact[]): FindingNumbers | undefined {
  const manifest = review?.contextManifest
  const kind = manifest?.stage === 'clarify' ? 'clarification' : manifest?.stage === 'design' ? 'design' : undefined
  if (!review || !manifest || !kind) return undefined
  const subject = manifest.subjectArtifacts.find((item) => item.kind === kind && artifacts.some((artifact) => artifact.id === item.id && artifact.updatedAt === item.updatedAt))
  const artifact = subject && artifacts.find((item) => item.id === subject.id && item.updatedAt === subject.updatedAt)
  if (!subject || !artifact) return undefined
  const cached = cache.get(review)
  if (cached?.artifact === artifact) return cached.numbers
  const binding = bindReview({ review, artifact, contentDigest: { state: 'done', value: subject.contentDigest } })
  const questions = kind === 'clarification' ? locateOpenQuestions(artifact.content, artifact.clarificationRevision?.openQuestions ?? []) : []
  const { numbers } = mergeFindings({ kind: kind === 'clarification' ? 'requirement' : 'design', binding: binding.state, findings: binding.findings, questions })
  cache.set(review, { artifact, numbers })
  return numbers
}
