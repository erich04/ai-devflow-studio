import { describe, expect, it } from 'vitest'
import { sha256Text, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { buildF1, buildF2, buildF4, F1_QUESTIONS, reviewOf } from '../../testing/gate-fixtures'
import { locateOpenQuestions } from './material'
import { mergeFindings } from './merge'
import { bindReview } from './review-binding'
async function merged(artifact: Artifact, review: AgentReviewResult | undefined, questions: readonly string[] = F1_QUESTIONS, digest?: string) {
  const binding = bindReview({ review, artifact, contentDigest: { state: 'done', value: digest ?? await sha256Text(artifact.content) } })
  return mergeFindings({ kind: artifact.kind === 'design' ? 'design' : 'requirement', binding: binding.state, findings: binding.findings, questions: locateOpenQuestions(artifact.content, questions) })
}
describe('mergeFindings', () => {
  it('joins the first finding into 问题 1 on F1 and numbers every finding in margin order (#276)', async () => {
    const f1 = await buildF1()
    const result = await merged(f1.current, f1.review)
    // Review order 1–5; the margin shows the unlocated 5th first, then goals (3rd), criteria (2nd), non-goals (4th), 问题 1 (1st).
    expect(result.findingCards.map((finding) => [finding.index, finding.number])).toEqual([[4, 1], [2, 2], [1, 3], [3, 4]])
    expect(result.questions.map((question) => [question.number, question.merged.map((finding) => finding.number), question.level])).toEqual([[1, [5], 'important'], [2, [], undefined]])
    expect(result.mergeNotes).toEqual([{ finding: 5, question: 1 }])
    expect([...result.numbers.entries()].sort((a, b) => a[0] - b[0])).toEqual([[0, 5], [1, 3], [2, 2], [3, 4], [4, 1]])
  })
  it('numbers ties at one position in review order, and a question\'s findings before a finding card at its block (#276)', async () => {
    const f1 = await buildF1()
    const goal = '用户可以按关键词搜索任务。'
    const sameBlock = await reviewOf({ id: 'r', artifact: f1.current, gateNodeId: f1.gateNode.id, findings: ['a', 'b', 'c'], createdAt: f1.review!.createdAt, details: [
      { quotes: [goal], importance: 'suggestion' }, { quotes: [goal], importance: 'suggestion' }, { quotes: [], importance: 'suggestion' }] })
    expect((await merged(f1.current, sameBlock)).findingCards.map((finding) => [finding.index, finding.number])).toEqual([[2, 1], [0, 2], [1, 3]])
    // 'a' cites both questions, so it stays a card at 问题 1's block; 'b' joins 问题 1, which the margin places first.
    const atQuestion = await reviewOf({ id: 'r', artifact: f1.current, gateNodeId: f1.gateNode.id, findings: ['a', 'b'], createdAt: f1.review!.createdAt, details: [
      { quotes: [F1_QUESTIONS[0], F1_QUESTIONS[1]], importance: 'important' }, { quotes: [F1_QUESTIONS[0]], importance: 'important' }] })
    const result = await merged(f1.current, atQuestion)
    expect(result.questions[0]!.merged.map((finding) => [finding.index, finding.number])).toEqual([[1, 1]])
    expect(result.findingCards.map((finding) => [finding.index, finding.number])).toEqual([[0, 2]])
  })
  it('takes the highest level of several joins, and none when levels are unknown', async () => {
    const f1 = await buildF1()
    const review = await reviewOf({ id: 'r', artifact: f1.current, gateNodeId: f1.gateNode.id, findings: ['a', 'b'], createdAt: f1.review!.createdAt, details: [
      { quotes: ['搜索是否区分大小写？'], importance: 'suggestion' }, { quotes: ['搜索是否区分大小写？'], importance: 'important' }] })
    const result = await merged(f1.current, review)
    expect(result.questions[0]!.merged.map((finding) => finding.number)).toEqual([1, 2])
    expect(result.questions[0]!.level).toBe('important')
    const f2 = await buildF2()
    expect((await merged(f2.current, f2.review)).questions[0]!.level).toBeUndefined()
  })
  it('never joins outside 待确认问题, across two questions, when unbound, on a non-unique quote, or on a design (AC9)', async () => {
    const f1 = await buildF1()
    const make = (quotes: string[]) => reviewOf({ id: 'r', artifact: f1.current, gateNodeId: f1.gateNode.id, findings: ['只有一条'], createdAt: f1.review!.createdAt, details: [{ quotes, importance: 'important' }] })
    const outside = await merged(f1.current, await make(['用户可以按关键词搜索任务。']))
    expect(outside.findingCards.map((finding) => finding.text)).toEqual(['只有一条'])
    const both = await merged(f1.current, await make([F1_QUESTIONS[0], F1_QUESTIONS[1]]))
    expect(both.findingCards).toHaveLength(1)
    const unbound = await merged(f1.current, await make([F1_QUESTIONS[0]]), F1_QUESTIONS, 'f'.repeat(64))
    expect(unbound.findingCards).toHaveLength(1)
    expect(unbound.mergeNotes).toEqual([])
    // A question line that appears twice gives a non-unique quote: the citation is dropped.
    const twice: Artifact = { ...f1.current, content: `${f1.current.content}\n## Repository Open Questions\n- 搜索是否区分大小写？\n` }
    const review = await reviewOf({ id: 'r', artifact: twice, gateNodeId: f1.gateNode.id, findings: ['x'], createdAt: f1.review!.createdAt, details: [{ quotes: [] }] })
    review.missingEvidenceDetails![0]!.citations = [{ sourceId: twice.id, title: 't', quote: F1_QUESTIONS[0], contentDigest: await sha256Text(twice.content),
      start: twice.content.indexOf(F1_QUESTIONS[0]), end: twice.content.indexOf(F1_QUESTIONS[0]) + F1_QUESTIONS[0].length, updatedAt: twice.updatedAt }]
    const nonUnique = await merged(twice, review)
    expect(nonUnique.findingCards).toHaveLength(1)
    const f4 = await buildF4()
    const design = await merged(f4.current, f4.review, [])
    expect(design.findingCards).toHaveLength(3)
    expect(design.mergeNotes).toEqual([])
  })
})
