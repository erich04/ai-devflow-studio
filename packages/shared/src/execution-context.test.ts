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

  it('makes best-effort room for an optional section before upgrading narrative to full text', () => {
    const input = {
      pinned: 'Current request: keep the task ordering.',
      sources: [
        { id: 'approved', title: 'Approved design', content: 'Complete approved body.', summary: '', priority: 100, required: true },
        { id: 'memory', title: 'Memory', content: 'Recorded user preference.', summary: '', priority: 95, required: true },
        { id: 'history', title: 'Background', content: `${'Background observation.\n'.repeat(50)}Constraint: retain task identifiers.`, summary: 'Earlier observations.', priority: 60 },
      ],
      maxBytes: 1600,
    }
    const baseline = compactExecutionContext(input)
    expect(baseline.receipt.compacted).toBe(false)
    const reserved = compactExecutionContext({ ...input, reserveBytes: 800 })
    expect(contextBytes(reserved.prompt)).toBeLessThanOrEqual(800)
    expect(reserved.prompt).toContain(input.pinned)
    expect(reserved.prompt).toContain('Complete approved body.')
    expect(reserved.prompt).toContain('Recorded user preference.')
    expect(reserved.prompt).toContain('Constraint: retain task identifiers.')
    expect(reserved.receipt.sources.find(source => source.id === 'history')?.representation).toBe('summary')
    expect(compactExecutionContext({ ...input, reserveBytes: 0 })).toEqual(baseline)
  })

  it('lets protected content consume the optional reservation and does not expand short sources into longer summaries', () => {
    const input = {
      pinned: 'Current request',
      sources: [
        { id: 'approved', title: 'Approved design', content: 'Approved detail. '.repeat(40), summary: '', priority: 100, required: true },
        { id: 'rule', title: 'Rule', content: 'Must retain all identifiers.', summary: 'Required identifiers.', priority: 60 },
      ],
    }
    const baseline = compactExecutionContext(input)
    const reserved = compactExecutionContext({
      ...input, maxBytes: contextBytes(baseline.prompt), reserveBytes: 800,
    })
    expect(reserved.prompt).toBe(baseline.prompt)
    expect(reserved.receipt.outputBytes).toBe(reserved.receipt.budgetBytes)
  })

  it.each([400, 1600])('does not downgrade a protected source below its unreserved representation at %i bytes', (maxBytes) => {
    const input = {
      pinned: 'Current request',
      sources: [
        { id: 'instructions', title: 'Project Instructions', content: `${'Project background.\n'.repeat(45)}Use corepack pnpm.`,
          summary: 'Read AGENTS.md.', priority: 75, preserveForReservation: true },
        { id: 'history', title: 'History', content: 'Older observation.\n'.repeat(25), summary: 'Earlier observations.', priority: 60 },
      ],
      maxBytes,
    }
    const baseline = compactExecutionContext(input)
    const reserved = compactExecutionContext({ ...input, reserveBytes: 1000 })
    expect(reserved.receipt.sources.find(source => source.id === 'instructions'))
      .toEqual(baseline.receipt.sources.find(source => source.id === 'instructions'))
    expect(reserved.receipt.outputBytes).toBeLessThanOrEqual(maxBytes)
  })

  it('keeps explicit multiline constraint blocks when a reservation compresses ordinary background', () => {
    const block = 'Constraints:\n- Retain task IDs.\n- Keep chronological order.'
    const input = {
      pinned: 'Current request',
      sources: [{ id: 'background', title: 'Background', priority: 60, summary: 'Earlier observations.',
        content: `${'Earlier observation.\n'.repeat(70)}${block}\n\n# History\nOptional historical detail.` }],
      maxBytes: 1600,
    }
    expect(compactExecutionContext(input).receipt.compacted).toBe(false)
    const reserved = compactExecutionContext({ ...input, reserveBytes: 800 })
    expect(reserved.prompt).toContain(block)
    expect(reserved.prompt).not.toContain('Optional historical detail.')
    expect(reserved.receipt.outputBytes).toBeLessThanOrEqual(800)
  })
})
