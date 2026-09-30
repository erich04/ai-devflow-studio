import { describe, expect, it } from 'vitest'
import {
  deriveCodingRunMemoryStatements,
  findDuplicateMemory,
  memoryStatementSimilarity,
  normalizeMemoryStatement,
} from './memory-learning'
import { AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES, memoryStatementBytes } from './memory-relevance'

type Memory = { id: string; statement: string }
const statementOf = (memory: Memory) => memory.statement

describe('Memory duplicate detection', () => {
  it('normalizes case, width, whitespace and trailing punctuation', () => {
    expect(normalizeMemoryStatement('  Use  NPM test.  ')).toBe('use npm test')
    expect(normalizeMemoryStatement('使用 ｐｎｐｍ verify。')).toBe('使用 pnpm verify')
  })

  it('reports an exact duplicate after normalization', () => {
    const existing: Memory[] = [{ id: 'm1', statement: 'Use npm test.' }]
    expect(findDuplicateMemory('use NPM   test', existing, statementOf)).toEqual({
      kind: 'exact', item: existing[0], similarity: 1,
    })
  })

  it('suggests revising the most similar memory at or above the threshold', () => {
    const existing: Memory[] = [
      { id: 'unrelated', statement: 'Deploy docs to the wiki.' },
      { id: 'close', statement: 'Run pnpm verify before opening a pull request.' },
    ]
    const match = findDuplicateMemory('Run pnpm verify before opening a draft pull request.', existing, statementOf)
    expect(match).toMatchObject({ kind: 'similar', item: { id: 'close' } })
    expect(match!.similarity).toBeCloseTo(6 / 7)
    expect(findDuplicateMemory('Release notes are written in Chinese.', existing, statementOf)).toBeNull()
    expect(memoryStatementSimilarity('Deploy docs to the wiki.', 'Release notes are written in Chinese.')).toBe(0)
  })
})

describe('Coding Run Memory statements', () => {
  const facts = {
    runTitle: 'Filter tasks',
    nodeTitle: 'Implement filter',
    testCommand: 'npm test',
    testPassed: true,
    changedPaths: ['src/filter.ts', 'src/filter.test.ts', '/etc/passwd', '../outside.ts', 'src/filter.ts'],
  }

  it('derives fixed-template statements from observable facts only', () => {
    expect(deriveCodingRunMemoryStatements(facts)).toEqual([
      {
        kind: 'test_command',
        statement: 'Verified test command for this project: npm test.',
      },
      {
        kind: 'change_map',
        statement: 'Change map: "Filter tasks" (Implement filter) was implemented by changing src/filter.ts, src/filter.test.ts.',
      },
    ])
  })

  it('records a repair pattern with parsed failure locations', () => {
    const statements = deriveCodingRunMemoryStatements({
      ...facts,
      repair: {
        failureSummary: 'Tests failed with exit code 1',
        failureLocations: [{ path: 'src/filter.test.ts', line: 12, column: 3 }],
        repairedPaths: ['src/filter.ts'],
      },
    })
    expect(statements.at(-1)).toEqual({
      kind: 'repair_pattern',
      statement: 'Repair pattern: in "Filter tasks", the first attempt failed the saved test (Tests failed with exit code 1), first reported at src/filter.test.ts:12; the accepted repair changed src/filter.ts.',
    })
  })

  it('learns nothing from a failing run and never emits secrets or oversized text', () => {
    expect(deriveCodingRunMemoryStatements({ ...facts, testPassed: false })).toEqual([])
    const secretCommand = deriveCodingRunMemoryStatements({ ...facts, testCommand: 'OPENAI_API_KEY=abc123 npm test' })
    expect(secretCommand.map((entry) => entry.kind)).toEqual(['change_map'])
    const many = deriveCodingRunMemoryStatements({
      ...facts,
      runTitle: '标题'.repeat(500),
      changedPaths: Array.from({ length: 40 }, (_, index) => `src/module-${index}/${'deep/'.repeat(20)}file.ts`),
    })
    expect(many.find((entry) => entry.kind === 'change_map')?.statement).toContain('and 28 more')
    for (const entry of many) {
      expect(memoryStatementBytes(entry.statement)).toBeLessThanOrEqual(AGENT_MEMORY_RECALLABLE_STATEMENT_MAX_BYTES)
    }
  })
})
