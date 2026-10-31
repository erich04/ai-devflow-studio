/**
 * A finding about an open question joins that question (FR-5, #276). Wording similarity is never
 * enough: only a verified citation inside exactly one question's item paragraph joins.
 */
import type { GateKind } from './copy'
import type { LocatedQuestion, Range } from './material'
import type { GateFinding, Level, ReviewBindingState } from './review-binding'
export type GateQuestion = LocatedQuestion & { merged: GateFinding[]; level?: Level }
export type MergeNote = { finding: number; question: number }
export type MergeResult = { findingCards: GateFinding[]; questions: GateQuestion[]; mergeNotes: MergeNote[] }
const inside = (citation: Range, range: Range) => citation.start >= range.start && citation.end <= range.end
export function mergeFindings(input: { kind: GateKind; binding: ReviewBindingState; findings: readonly GateFinding[]; questions: readonly LocatedQuestion[] }): MergeResult {
  const questions: GateQuestion[] = input.questions.map((question) => ({ ...question, merged: [] }))
  if (input.kind === 'design' || input.binding !== 'bound') return { findingCards: [...input.findings], questions, mergeNotes: [] }
  const findingCards: GateFinding[] = []
  const mergeNotes: MergeNote[] = []
  for (const finding of input.findings) {
    const hit = questions.filter((question) => question.range && finding.citations.some((citation) => inside(citation, question.range!)))
    if (hit.length !== 1) {
      findingCards.push(finding)
      continue
    }
    hit[0]!.merged.push(finding)
    mergeNotes.push({ finding: finding.number, question: hit[0]!.number })
  }
  for (const question of questions) {
    const levels = question.merged.map((finding) => finding.level)
    if (levels.includes('important')) question.level = 'important'
    else if (levels.includes('suggestion')) question.level = 'suggestion'
  }
  return { findingCards, questions, mergeNotes }
}
