import { describe, expect, it } from 'vitest'
import { buildChangeReviewPayload, parseChangeReviewOutput, splitBacktickSegments } from './coding-change-review'
import { buildChangeSetDiffView } from './coding-change-view'
const view = buildChangeSetDiffView([{ path: 'a.ts', before: 'old\nshared\n', after: 'new\nother\n' }])
const finding = { path: 'a.ts', line: 99, lineText: 'new', importance: 'important', consequence: '会重复提交', reason: '没有检查', item: '补充检查' }
describe('change review boundary', () => {
  it('grounds unique changed text even if the model guessed the wrong line', () => {
    expect(parseChangeReviewOutput({ stateVersion: 2, findings: [finding], summary: '一条意见' }, view)).toMatchObject({ levelsKnown: true, findings: [{ index: 0, anchor: { path: 'a.ts', side: 'new', line: 1 } }] })
  })
  it('retains ungrounded findings and hides all levels if any are missing', () => {
    const { importance: _, ...without } = finding
    const result = parseChangeReviewOutput({ stateVersion: 2, findings: [finding, { ...without, lineText: 'absent' }] }, view)
    expect(result.levelsKnown).toBe(false)
    expect(result.findings[1]!.anchor).toBeUndefined()
    expect(result.findings[1]!.item).toBe('补充检查')
  })
  it.each([
    { ...finding, path: 'secret.ts' }, { ...finding, anchor: { line: 1 } }, { ...finding, importance: 'high' },
    { ...finding, lineText: 'a\nb' }, { ...finding, line: 0 }, { ...finding, item: 'x'.repeat(301) },
  ])('rejects the entire invalid response', bad => {
    expect(() => parseChangeReviewOutput({ stateVersion: 2, findings: [finding, bad] }, view)).toThrow('invalid_model_output')
  })
  it('does not guess between identical added and removed text', () => {
    const repeated = { files: [{ path: 'a.ts', additions: 1, deletions: 1, rows: [{ kind: 'add' as const, newLine: 2, text: 'same ' }, { kind: 'del' as const, oldLine: 1, text: 'same' }] }], additions: 1, deletions: 1 }
    expect(parseChangeReviewOutput({ stateVersion: 2, findings: [{ ...finding, lineText: 'same' }] }, repeated).findings[0]!.anchor).toBeUndefined()
  })
  it('bounds and redacts payload while preserving the shared brief prefix', () => {
    const large = buildChangeSetDiffView([{ path: 'a.ts', before: '', after: Array.from({ length: 2000 }, (_, i) => `const x${i} = '/Users/example/private'`).join('\n') }])
    const payload = buildChangeReviewPayload({ brief: { purpose: 'fix' }, view: large })
    expect(Object.keys(payload).slice(0, 3)).toEqual(['stateVersion', 'brief', 'phase'])
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(30000)
    expect(JSON.stringify(payload)).not.toContain('/Users/example')
    expect(payload.changeSet.files[0]!.truncated).toBe(true)
  })
  it('treats paired backticks as quoted source only', () => {
    expect(splitBacktickSegments('检查 `run()` 的返回值')).toEqual([{ text: '检查 ' }, { text: 'run()', raw: true }, { text: ' 的返回值' }])
    expect(splitBacktickSegments('检查 `run()')).toEqual([{ text: '检查 `run()' }])
  })
})
