import { describe, expect, it } from 'vitest'
import {
  AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES,
  CODING_MEMORY_RECALL_BUDGET,
  CONVERSATION_MEMORY_RECALL_BUDGET,
  STAGE_AGENT_MEMORY_RECALL_BUDGET,
  AGENT_MEMORY_RECALL_LABEL_BYTES,
  rankMemoryByRelevance,
  selectMemoryWithinBudget,
  tokenizeMemoryText,
} from './memory-relevance'

type Memory = { id: string; statement: string }
const statementOf = (memory: Memory) => memory.statement

describe('Memory relevance tokens', () => {
  it('splits camelCase and paths, folds plurals and drops stop words', () => {
    expect(tokenizeMemoryText('Update codingContext.ts tests')).toEqual(['update', 'coding', 'context', 'test'])
    expect(tokenizeMemoryText('For message changes, preserve the existing export name and double quotes.'))
      .toEqual(['message', 'change', 'preserve', 'existing', 'export', 'name', 'double', 'quote'])
  })

  it('uses overlapping Han bigrams without function-character pairs', () => {
    expect(tokenizeMemoryText('清理已完成的任务')).toEqual(['清理', '理已', '已完', '完成', '任务'])
  })
})

describe('Memory relevance ranking', () => {
  it('matches exact tokens, so a query term inside a longer word is not a hit', () => {
    expect(rankMemoryByRelevance([{ id: 'm1', statement: 'Keep the latest release notes.' }], 'test', statementOf)).toEqual([])
  })

  it('drops memories without a shared term and orders the rest by BM25', () => {
    const memories: Memory[] = [
      { id: 'a', statement: 'Run npm test before committing message changes.' },
      { id: 'b', statement: 'Deploy docs to the wiki.' },
      { id: 'c', statement: 'Message format uses double quotes.' },
    ]
    const ranked = rankMemoryByRelevance(memories, 'Change the message quotes', statementOf)
    expect(ranked.map((entry) => entry.item.id)).toEqual(['c', 'a'])
    expect(ranked.map((entry) => entry.matchedTerms)).toEqual([2, 2])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    expect(rankMemoryByRelevance(memories, 'Change the message quotes', statementOf, { minMatchedTerms: 3 })).toEqual([])
  })

  it('keeps the caller order for equal scores and is deterministic', () => {
    const memories: Memory[] = [
      { id: 'newer', statement: 'Greeting copy lives in src/greeting.js.' },
      { id: 'older', statement: 'Greeting copy lives in src/greeting.js.' },
    ]
    const first = rankMemoryByRelevance(memories, 'update the greeting', statementOf)
    expect(first.map((entry) => entry.item.id)).toEqual(['newer', 'older'])
    expect(rankMemoryByRelevance(memories, 'update the greeting', statementOf)).toEqual(first)
  })

  it('matches Chinese requests against Chinese memories', () => {
    const ranked = rankMemoryByRelevance(
      [{ id: 'zh', statement: '清理操作只删除已完成项，保留未完成项。' }, { id: 'other', statement: '发布前需要人工验收。' }],
      '清理已完成任务',
      statementOf,
    )
    expect(ranked.map((entry) => entry.item.id)).toEqual(['zh'])
  })

  it('returns nothing for an empty or stop-word-only query', () => {
    const memories: Memory[] = [{ id: 'm1', statement: 'Use pnpm verify.' }]
    expect(rankMemoryByRelevance(memories, '', statementOf)).toEqual([])
    expect(rankMemoryByRelevance(memories, 'the and for with', statementOf)).toEqual([])
  })
})

describe('Memory recall budget', () => {
  it('lets the coding brief hold one maximum-size recallable statement', () => {
    expect(AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES + AGENT_MEMORY_RECALL_LABEL_BYTES)
      .toBeLessThanOrEqual(CODING_MEMORY_RECALL_BUDGET.maxBytes)
    // Stage Agent and discussion budgets are deliberately smaller; oversize items are skipped there.
    expect(STAGE_AGENT_MEMORY_RECALL_BUDGET.maxBytes).toBeLessThan(CODING_MEMORY_RECALL_BUDGET.maxBytes)
    expect(CONVERSATION_MEMORY_RECALL_BUDGET.maxBytes).toBeLessThan(STAGE_AGENT_MEMORY_RECALL_BUDGET.maxBytes)
  })

  it('skips oversized statements and items that no longer fit, in rank order', () => {
    const ranked: Memory[] = [
      { id: 'too-large', statement: 'x'.repeat(AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES + 1) },
      { id: 'a', statement: 'a'.repeat(1_700) },
      { id: 'b', statement: 'b'.repeat(1_700) },
      { id: 'c', statement: 'c'.repeat(10) },
    ]
    expect(selectMemoryWithinBudget(ranked, statementOf, { maxItems: 8, maxBytes: 4_000 }).map((entry) => entry.id))
      .toEqual(['a', 'b'])
    expect(selectMemoryWithinBudget(ranked, statementOf, { maxItems: 1, maxBytes: 4_000 }).map((entry) => entry.id))
      .toEqual(['a'])
  })
})

describe('Memory relevance floor on realistic queries (ADR 0024 §2)', () => {
  it('does not treat generic Chinese words or path segments as a shared topic', () => {
    const memories: Memory[] = [
      { id: 'release', statement: '发布说明需要使用英文书写。' },
      { id: 'cards', statement: '桌面卡片可以使用句首大写。' },
      { id: 'change-map', statement: 'Change map: "Filter tasks" was implemented by changing src/tasks/filter.ts.' },
      { id: 'export', statement: '导出报表时保留月份列的原始顺序。' },
    ]
    const query = '需要支持导出月度报表，可以使用现有的 src/export/report.ts。'
    expect(rankMemoryByRelevance(memories, query, statementOf).map(({ item }) => item.id)).toEqual(['export'])
  })
})
