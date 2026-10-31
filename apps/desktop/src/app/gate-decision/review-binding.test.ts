import { describe, expect, it } from 'vitest'
import { sha256Text, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { buildF1, buildF2, buildF6, citationOf, reviewOf } from '../../testing/gate-fixtures'
import { blockKey, gateReadingBlocks } from './material'
import { bindReview, levelsKnown, reviewCheckOf, type DigestState, type ReviewBindingState } from './review-binding'
const done = async (artifact: Artifact): Promise<DigestState> => ({ state: 'done', value: await sha256Text(artifact.content) })
describe('bindReview', () => {
  it('reports none, checking, unverifiable and legacy before any citation is checked', async () => {
    const f1 = await buildF1()
    expect(bindReview({ review: undefined, artifact: f1.current, contentDigest: await done(f1.current) })).toEqual({ state: 'none', findings: [], levelsKnown: false })
    expect(bindReview({ review: f1.review, artifact: f1.current, contentDigest: { state: 'pending' } }).state).toBe('checking')
    expect(bindReview({ review: f1.review, artifact: f1.current, contentDigest: { state: 'failed', error: 'crypto' } }).state).toBe('unverifiable')
    const { requirement } = await buildF6()
    const legacy = bindReview({ review: requirement.review, artifact: requirement.current, contentDigest: await done(requirement.current) })
    expect(legacy.state).toBe('legacy')
    expect(legacy.findings.every((finding) => finding.citations.length === 0)).toBe(true)
  })
  it('binds F1 and verifies every citation, anchoring each finding at its first cited block', async () => {
    const f1 = await buildF1()
    const binding = bindReview({ review: f1.review, artifact: f1.current, contentDigest: await done(f1.current) })
    expect(binding.state).toBe('bound')
    expect(binding.levelsKnown).toBe(true)
    expect(binding.findings.map((finding) => [finding.number, finding.level, finding.citations.length])).toEqual([
      [1, 'important', 2], [2, 'important', 2], [3, 'suggestion', 1], [4, 'suggestion', 1], [5, 'suggestion', 0],
    ])
    const first = binding.findings[0]!
    const goal = f1.current.content.indexOf('用户可以按关键词搜索任务。')
    expect(first.anchor).toBe(blockKey({ start: goal, end: goal + '用户可以按关键词搜索任务。'.length }))
    expect(binding.findings[4]!.anchor).toBeUndefined()
  })
  it('is unbound when any identity field of the manifest subject differs', async () => {
    const f1 = await buildF1()
    const digest = await done(f1.current)
    const subject = f1.review!.contextManifest!.subjectArtifacts[0]!
    for (const change of [{ id: 'other' }, { runId: 'other' }, { nodeId: 'other' }, { kind: 'design' as const }, { updatedAt: '2020-01-01T00:00:00.000Z' }, { contentDigest: 'f'.repeat(64) }]) {
      const review: AgentReviewResult = { ...f1.review!, contextManifest: { ...f1.review!.contextManifest!, subjectArtifacts: [{ ...subject, ...change }] } }
      const binding = bindReview({ review, artifact: f1.current, contentDigest: digest })
      expect(binding.state).toBe('unbound')
      expect(binding.findings.every((finding) => finding.citations.length === 0)).toBe(true)
    }
    expect(bindReview({ review: { ...f1.review!, runId: 'other' }, artifact: f1.current, contentDigest: digest }).state).toBe('unbound')
  })
  it('drops citations that are not exact, unique and inside one block', async () => {
    const f1 = await buildF1()
    const valid = await citationOf(f1.current, '不做全文检索。')
    const bad = [
      { ...valid, sourceId: 'other' },
      { ...valid, contentDigest: 'f'.repeat(64) },
      { ...valid, updatedAt: '2020-01-01T00:00:00.000Z' },
      { ...valid, quote: '不做全文' },
      { ...valid, start: valid.start + 0.5 },
      { ...valid, end: f1.current.content.length + 1 },
      await citationOf(f1.current, '任务'),                         // not unique
      await citationOf(f1.current, '不做全文检索。\n\n## Assumptions'), // crosses blocks
    ]
    const review: AgentReviewResult = { ...f1.review!, missingEvidence: ['x', 'y'], missingEvidenceDetails: [
      { index: 0, assessment: 'gap', requiresReview: true, citations: bad },
      { index: 7, assessment: 'gap', requiresReview: true, citations: [valid] },
    ] }
    const binding = bindReview({ review, artifact: f1.current, contentDigest: await done(f1.current) })
    expect(binding.findings.map((finding) => finding.citations.length)).toEqual([0, 0])
    const kept = bindReview({ review: { ...review, missingEvidenceDetails: [{ index: 0, assessment: 'gap', requiresReview: true, citations: [...bad, { ...valid, updatedAt: undefined } as never] }] },
      artifact: f1.current, contentDigest: await done(f1.current) })
    expect(kept.findings[0]!.citations).toHaveLength(1)
  })
  it('anchors a citation inside a table cell to the table block', async () => {
    const f1 = await buildF1()
    const content = `${f1.current.content}\n## Implementation\n说明\n\n| 字段 | 规则 |\n| --- | --- |\n| 标题 | 不区分大小写匹配 |\n`
    const artifact: Artifact = { ...f1.current, content }
    const review = await reviewOf({ id: 'table-review', artifact, gateNodeId: f1.gateNode.id, findings: ['表格'], createdAt: f1.review!.createdAt, details: [{ quotes: ['不区分大小写匹配'] }] })
    const binding = bindReview({ review, artifact, contentDigest: await done(artifact) })
    const table = gateReadingBlocks(content).find((block) => block.kind === 'table')!
    expect(binding.findings[0]!.anchor).toBe(blockKey(table))
  })
})
describe('levelsKnown and reviewCheckOf', () => {
  it('is true only when every finding has a valid importance', async () => {
    const f1 = await buildF1()
    expect(levelsKnown(f1.review)).toBe(true)
    expect(levelsKnown((await buildF2()).review)).toBe(false)
    const mixed = { ...f1.review!, missingEvidenceDetails: f1.review!.missingEvidenceDetails!.map((detail, index) => index === 2 ? { ...detail, importance: undefined } : detail) }
    expect(levelsKnown(mixed as AgentReviewResult)).toBe(false)
    const invalid = { ...f1.review!, missingEvidenceDetails: f1.review!.missingEvidenceDetails!.map((detail) => ({ ...detail, importance: 'major' })) }
    expect(levelsKnown(invalid as unknown as AgentReviewResult)).toBe(false)
    expect(levelsKnown({ ...f1.review!, missingEvidence: [], missingEvidenceDetails: [] })).toBe(false)
    const f2 = bindReview({ review: (await buildF2()).review, artifact: f1.current, contentDigest: await done(f1.current) })
    expect(f2.findings.some((finding) => finding.level)).toBe(false)
  })
  it('combines the binding and the design identity', () => {
    const binding = (state: ReviewBindingState) => ({ state, findings: [], levelsKnown: false })
    expect(reviewCheckOf({ binding: binding('bound') })).toBe('done')
    expect(reviewCheckOf({ binding: binding('none') })).toBe('done')
    expect(reviewCheckOf({ binding: binding('checking') })).toBe('pending')
    expect(reviewCheckOf({ binding: binding('unverifiable') })).toBe('failed')
    expect(reviewCheckOf({ binding: binding('bound'), designIdentity: { state: 'pending' } })).toBe('pending')
    expect(reviewCheckOf({ binding: binding('checking'), designIdentity: { state: 'failed' } })).toBe('failed')
    expect(reviewCheckOf({ binding: binding('unbound'), designIdentity: { state: 'done', value: 'x' } })).toBe('done')
  })
})
