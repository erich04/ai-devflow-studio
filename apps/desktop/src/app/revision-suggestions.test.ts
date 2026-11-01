import { describe, expect, it } from 'vitest'
import {
  MAX_SUGGESTION_FIELD_CHARACTERS,
  composeRevisionRequest,
  findSuggestion,
  parseRevisionSuggestionStore,
  removeSuggestion,
  upsertSuggestion,
  type RevisionSuggestion,
} from './revision-suggestions'

const item = (index: number, overrides: Partial<RevisionSuggestion> = {}): RevisionSuggestion => ({
  reviewId: 'review-1', index, issue: `问题 ${index + 1}`, finding: '', change: '', ...overrides,
})

describe('revision suggestions (#247)', () => {
  it('submits the free text unchanged when no opinion has a draft', () => {
    expect(composeRevisionRequest([], '  原样提交  ')).toBe('  原样提交  ')
  })

  it('lists each opinion as original problem, verified finding and proposed change, then the free text', () => {
    const text = composeRevisionRequest([
      item(0, { finding: 'trim() 后判空；按 Unicode 码点计数。', change: '验收标准写明上限 200 个码点。' }),
      item(2),
    ], '补充撤销范围。')
    expect(text).toBe([
      '审查意见 1（review-1）：问题 1\n核实结论：trim() 后判空；按 Unicode 码点计数。\n拟修改内容：验收标准写明上限 200 个码点。',
      '审查意见 3（review-1）：问题 3',
      '其他修订说明：\n补充撤销范围。',
    ].join('\n\n'))
  })

  it('keeps one draft per opinion in opinion order and removes only that opinion', () => {
    let list = upsertSuggestion([], item(3, { change: 'b' }))
    list = upsertSuggestion(list, item(1, { change: 'a' }))
    list = upsertSuggestion(list, item(3, { change: 'c' }))
    expect(list.map((entry) => [entry.index, entry.change])).toEqual([[1, 'a'], [3, 'c']])
    expect(findSuggestion(list, 'review-1', 3)?.change).toBe('c')
    expect(findSuggestion(list, 'review-2', 3)).toBeUndefined()
    expect(removeSuggestion(list, 'review-1', 1).map((entry) => entry.index)).toEqual([3])
  })

  it('caps each field and drops malformed stored drafts instead of failing', () => {
    const long = upsertSuggestion([], item(0, { change: 'x'.repeat(MAX_SUGGESTION_FIELD_CHARACTERS + 5) }))
    expect(long[0]!.change).toHaveLength(MAX_SUGGESTION_FIELD_CHARACTERS)
    expect(parseRevisionSuggestionStore('not json')).toEqual({})
    expect(parseRevisionSuggestionStore(JSON.stringify({ v1: [item(0), { index: 'x' }], v2: 'old string draft' })))
      .toEqual({ v1: [item(0)] })
  })
})
