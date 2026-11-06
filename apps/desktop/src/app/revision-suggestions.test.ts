import { describe, expect, it } from 'vitest'
import { parseRevisionSuggestionStore, type RevisionSuggestion } from './revision-suggestions'

const item = (index: number, overrides: Partial<RevisionSuggestion> = {}): RevisionSuggestion => ({
  reviewId: 'review-1', index, issue: `问题 ${index + 1}`, finding: '', change: '', ...overrides,
})

describe('revision suggestions (#247, import only)', () => {
  it('reads stored drafts per version', () => {
    const stored = { v1: [item(0, { change: '验收标准写明上限 200 个码点。' }), item(2)] }
    expect(parseRevisionSuggestionStore(JSON.stringify(stored))).toEqual(stored)
    expect(parseRevisionSuggestionStore(null)).toEqual({})
  })

  it('drops malformed stored drafts instead of failing', () => {
    expect(parseRevisionSuggestionStore('not json')).toEqual({})
    expect(parseRevisionSuggestionStore('[]')).toEqual({})
    expect(parseRevisionSuggestionStore(JSON.stringify({ v1: [item(0), { index: 'x' }, item(-1)], v2: 'old string draft' })))
      .toEqual({ v1: [item(0)] })
  })
})
