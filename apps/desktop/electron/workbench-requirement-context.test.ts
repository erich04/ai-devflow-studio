import { describe, expect, it } from 'vitest'
import { conversationContentPage } from './workbench-requirement-context'

describe('bounded conversation body pages', () => {
  it('reads every character with explicit ranges, including escape-heavy bodies', () => {
    const body = '正文\n\t"\\'.repeat(9000)
    let offset = 0
    let collected = ''
    while (offset < body.length) {
      const page = conversationContentPage(body, offset, 18000)
      expect(JSON.stringify(page.content).length).toBeLessThanOrEqual(10000)
      expect(page.offset).toBe(offset)
      expect(page.endOffset).toBeGreaterThan(offset)
      collected += page.content
      offset = page.nextOffset ?? body.length
    }
    expect(collected).toBe(body)
  })
  it.each([-1, 1.5, '0', NaN, Infinity, 99])('rejects invalid offsets without silently reading another range: %s', (offset) => {
    expect(() => conversationContentPage('正文', offset)).toThrow('分页范围无效')
  })
  it.each([0, -1, 18001, '10'])('rejects invalid page lengths: %s', (limit) => {
    expect(() => conversationContentPage('正文', 0, limit)).toThrow('分页范围无效')
  })
})
