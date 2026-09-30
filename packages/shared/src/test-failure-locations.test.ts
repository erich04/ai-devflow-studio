import { describe, expect, it } from 'vitest'
import { parseTestFailureLocations } from './test-failure-locations'

const workspaceRoots = ['/tmp/work/tree']

describe('test failure locations', () => {
  it('reads runner, stack-frame, compiler and Python locations in output order', () => {
    const output = [
      ' FAIL  src/filter.test.ts > filters done tasks',
      'AssertionError: expected [ 1 ] to deeply equal [ 2 ]',
      ' ❯ src/filter.test.ts:12:17',
      '    at check (/tmp/work/tree/src/message.ts:3:9)',
      'src/types.ts(4,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      '  File "app/main.py", line 42, in handler',
    ].join('\n')
    expect(parseTestFailureLocations(output, { workspaceRoots })).toEqual([
      { path: 'src/filter.test.ts', line: 12, column: 17 },
      { path: 'src/message.ts', line: 3, column: 9 },
      { path: 'src/types.ts', line: 4, column: 7 },
      { path: 'app/main.py', line: 42 },
    ])
  })

  it('keeps only canonical paths inside the workspace', () => {
    const output = [
      'at file:///usr/lib/node/internal.js:10:3',
      'at node_modules/vitest/dist/runner.js:5:1',
      'at ../outside.ts:2:1',
      'at C:\\work\\src\\a.ts:3:1',
      'at /private/tmp/work/tree/src/b.ts:8:2',
      'at file:///tmp/work/tree/src/c.ts:9:1',
      'at ./src/d.ts:1',
    ].join('\n')
    expect(parseTestFailureLocations(output, { workspaceRoots })).toEqual([
      { path: 'src/b.ts', line: 8, column: 2 },
      { path: 'src/c.ts', line: 9, column: 1 },
      { path: 'src/d.ts', line: 1 },
    ])
  })

  it('strips ANSI colours, removes duplicates and honours the limit', () => {
    const output = '\u001b[31msrc/a.ts:5:1\u001b[39m\nsrc/a.ts:5:1\nsrc/b.ts:6\nsrc/c.ts:7'
    expect(parseTestFailureLocations(output, { workspaceRoots, limit: 2 })).toEqual([
      { path: 'src/a.ts', line: 5, column: 1 },
      { path: 'src/b.ts', line: 6 },
    ])
  })
})

describe('parseTestFailureLocations on Windows output and long lines', () => {
  it('maps Windows absolute and file URL frames inside the worktree to relative paths', () => {
    const output = [
      ' ❯ C:\\Work\\Tree\\src\\filter.test.ts:12:5',
      '    at file:///c:/work/tree/src/filter.ts:3:9',
      ' ❯ C:\\Other\\src\\outside.ts:1:1',
      ' ❯ src\\relative.ts:7',
    ].join('\r\n')
    expect(parseTestFailureLocations(output, { workspaceRoots: ['C:\\Work\\Tree'] })).toEqual([
      { path: 'src/filter.test.ts', line: 12, column: 5 },
      { path: 'src/filter.ts', line: 3, column: 9 },
      { path: 'src/relative.ts', line: 7 },
    ])
  })

  it('stays fast on long unbroken tokens', () => {
    const output = `${'ab.ts'.repeat(8_000)}\n${'A'.repeat(40_000)}\nsrc/a.ts:5:1`
    const startedAt = performance.now()
    expect(parseTestFailureLocations(output, { workspaceRoots })).toEqual([{ path: 'src/a.ts', line: 5, column: 1 }])
    expect(performance.now() - startedAt).toBeLessThan(500)
  })
})
