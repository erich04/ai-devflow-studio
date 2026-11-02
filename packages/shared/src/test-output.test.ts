import { expect, it } from 'vitest'
import { parseTestOutput } from './test-output'
it('reads runner totals without mistaking zero failures or parent suites for failed tests', () => {
  const tap = '# Subtest: suite\n    not ok 1 - child fails\n      error: wrong\nnot ok 1 - suite\n# tests 2\n# pass 1\n# fail 1\n'
  expect(parseTestOutput(tap, 'failed')).toMatchObject({ counts: { total: 2, passed: 1, failed: 1 }, failures: ['child fails'], lineCount: 7 })
  expect(parseTestOutput('# tests 2\n# pass 2\n# fail 0\n', 'passed').failures).toEqual([])
})
it('reads Vitest and Jest and keeps failure excerpts bounded', () => {
  expect(parseTestOutput('Tests  1 failed | 23 passed (24)\n', 'failed').counts).toEqual({ total: 24, passed: 23, failed: 1 })
  expect(parseTestOutput('Tests: 2 failed, 8 passed, 10 total\n', 'failed').counts).toEqual({ total: 10, passed: 8, failed: 2 })
  const result = parseTestOutput('Error: wrong\n' + 'details\n'.repeat(100), 'failed')
  expect(result.keyLines.length).toBeLessThanOrEqual(12)
  expect(result.keyLines.join('\n').length).toBeLessThanOrEqual(2000)
})
