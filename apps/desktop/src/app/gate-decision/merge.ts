/**
 * A finding about an open question joins that question (FR-5, #276). Wording similarity is never
 * enough: only a verified citation inside exactly one question's item paragraph joins.
 */
import type { GateKind } from './copy'
import { parseBlockKey, type LocatedQuestion, type Range } from './material'
import { compareMarginOrder, type MarginOrderKey } from './placement'
import type { GateFinding, Level, ReviewBindingState } from './review-binding'
export type GateQuestion = LocatedQuestion & { merged: GateFinding[]; level?: Level }
export type MergeNote = { finding: number; question: number }
/** "意见 N" of every finding of the review, keyed by its index in the review. */
export type FindingNumbers = ReadonlyMap<number, number>
export type MergeResult = { findingCards: GateFinding[]; questions: GateQuestion[]; mergeNotes: MergeNote[]; numbers: FindingNumbers }
const inside = (citation: Range, range: Range) => citation.start >= range.start && citation.end <= range.end
/**
 * The one numbering of "意见 N" (#276; user decision 2026-10-31, as in the 03–06 prototype): the
 * order in which the margin shows the findings, top to bottom. Unlocated finding cards come first,
 * in review order; then cards by position in the text (`compareMarginOrder`), a merged finding at
 * its question's position; at one position, review order. Display only: lists and records keep
 * the review's own index.
 */
function numberFindings(findingCards: readonly GateFinding[], questions: readonly GateQuestion[]): Map<number, number> {
  const entries: Array<MarginOrderKey & { indexes: number[] }> = [
    ...findingCards.map((finding) => ({ kind: 'finding' as const, number: finding.index + 1,
      position: finding.anchor ? parseBlockKey(finding.anchor).start : undefined, indexes: [finding.index] })),
    ...questions.filter((question) => question.merged.length).map((question) => ({ kind: 'question' as const, number: question.number,
      position: question.range?.start, indexes: question.merged.map((finding) => finding.index).sort((a, b) => a - b) })),
  ]
  const numbers = new Map<number, number>()
  for (const entry of entries.sort(compareMarginOrder)) for (const index of entry.indexes) numbers.set(index, numbers.size + 1)
  return numbers
}
export function mergeFindings(input: { kind: GateKind; binding: ReviewBindingState; findings: readonly GateFinding[]; questions: readonly LocatedQuestion[] }): MergeResult {
  const questions: GateQuestion[] = input.questions.map((question) => ({ ...question, merged: [] }))
  const findingCards: GateFinding[] = []
  const merges: Array<{ finding: GateFinding; question: number }> = []
  for (const finding of input.findings) {
    const hit = input.kind === 'design' || input.binding !== 'bound' ? []
      : questions.filter((question) => question.range && finding.citations.some((citation) => inside(citation, question.range!)))
    if (hit.length !== 1) {
      findingCards.push(finding)
      continue
    }
    hit[0]!.merged.push(finding)
    merges.push({ finding, question: hit[0]!.number })
  }
  for (const question of questions) {
    const levels = question.merged.map((finding) => finding.level)
    if (levels.includes('important')) question.level = 'important'
    else if (levels.includes('suggestion')) question.level = 'suggestion'
  }
  const numbers = numberFindings(findingCards, questions)
  const numbered = (finding: GateFinding): GateFinding => ({ ...finding, number: numbers.get(finding.index) ?? finding.number })
  return {
    findingCards: findingCards.map(numbered).sort((a, b) => a.number - b.number),
    questions: questions.map((question) => ({ ...question, merged: question.merged.map(numbered) })),
    mergeNotes: merges.map(({ finding, question }) => ({ finding: numbered(finding).number, question })).sort((a, b) => a.finding - b.finding),
    numbers,
  }
}
