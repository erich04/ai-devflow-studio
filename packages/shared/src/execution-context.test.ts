import { describe, expect, it } from 'vitest'
import { compactExecutionContext, contextBytes } from './execution-context'

describe('budgeted execution Context', () => {
  it('retains indivisible Memory and tail constraints while compacting redundant history', () => {
    const result = compactExecutionContext({
      pinned: 'Current request: update the greeting. Do not change tests.',
      sources: [
        { id: 'memory:1:2', title: 'Recalled Memory (background only)', content: '欢迎使用 Agent 工作台', summary: '', priority: 100, required: true },
        { id: 'design:1', title: 'Design', content: `${'A historical observation.\n'.repeat(1000)}Acceptance: retain keyboard navigation.`, summary: 'Change visible greeting only.', priority: 80 },
      ], maxBytes: 1000,
    })
    expect(contextBytes(result.prompt)).toBeLessThanOrEqual(1000)
    expect(result.prompt).toContain('欢迎使用 Agent 工作台')
    expect(result.prompt).toContain('Acceptance: retain keyboard navigation.')
    expect(result.prompt).toContain('Do not change tests.')
    expect(result.receipt.compacted).toBe(true)
    expect(result.receipt.sources).toMatchObject([{ representation: 'full' }, { representation: 'summary' }])
    expect(JSON.stringify(result.receipt)).not.toContain('欢迎')
  })

  it('refuses to silently shorten oversized requests or explicit constraints', () => {
    expect(() => compactExecutionContext({ pinned: 'x'.repeat(2000), sources: [], maxBytes: 500 })).toThrow('Context budget')
    expect(() => compactExecutionContext({ pinned: 'Task', maxBytes: 500, sources: [{
      id: 'design', title: 'Design', summary: 'Long requirements', priority: 1,
      content: `必须保留：${'关键字段'.repeat(500)}`,
    }] })).toThrow('Context budget')
  })

  it('uses UTF-8 size and yields the same source order regardless of retrieval order', () => {
    const sources = ['b', 'a'].map((id) => ({ id, title: id, summary: 'Summary', content: '中文来源', priority: 1 }))
    const first = compactExecutionContext({ pinned: '要求', sources, maxBytes: 100 })
    const second = compactExecutionContext({ pinned: '要求', sources: [...sources].reverse(), maxBytes: 100 })
    expect(first).toEqual(second)
    expect(first.receipt.outputBytes).toBe(contextBytes(first.prompt))
    expect(first.receipt.outputBytes).toBeGreaterThan(first.prompt.length)
    expect(first.receipt.compacted).toBe(false)
  })
})
