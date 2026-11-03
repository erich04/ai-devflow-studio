import { describe, expect, it } from 'vitest'
import { applyLineHunks, diffTextLines } from './line-diff'
import { buildChangeSetDiffView, buildGitPatchDiffView, markNewRows, reconstructWholeFileDiff } from './coding-change-view'

describe('approved change display', () => {
  it.each([
    ['', ''], ['', 'one\n'], ['one\n', ''], ['one\n', 'one'], ['one', 'one\n'],
    ['a\r\nb\r\n', 'a\r\nc\r\n'], ['a\nb\nc\nd\n', 'a\nB\nc\nD\n'],
    ['a\na\nb\na', 'a\nb\nb\na\n'], ['\n', '\n\n'],
  ])('round trips exact bytes, including line endings: %j to %j', (before, after) => {
    expect(applyLineHunks(before, diffTextLines(before, after))).toBe(after)
  })

  it('round trips repeated and mixed line endings over deterministic generated inputs', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647)
    const source = () => Array.from({ length: random() % 18 }, () => ['a\n', 'b\r\n', '\n', 'c'][random() % 4]).join('')
    for (let i = 0; i < 300; i++) {
      const before = source(), after = source()
      expect(applyLineHunks(before, diffTextLines(before, after))).toBe(after)
    }
  })

  it('shows only changed lines, with unchanged ranges in new-file coordinates', () => {
    const view = buildChangeSetDiffView([{ path: 'a.ts', before: 'a\nb\nc\nd\n', after: 'a\nB\nc\nd\n' }])
    expect(view).toEqual({ additions: 1, deletions: 1, files: [{ path: 'a.ts', additions: 1, deletions: 1, rows: [
      { kind: 'gap', from: 1, to: 1 }, { kind: 'del', oldLine: 2, text: 'b' },
      { kind: 'add', newLine: 2, text: 'B' }, { kind: 'gap', from: 3, to: 4 },
    ] }] })
  })

  it('marks changes introduced since the previous proposal, not all old edits', () => {
    const previous = [{ path: 'a', before: 'a\nb\nc\n', after: 'a\nB\nc\n' }]
    const current = [{ path: 'a', before: 'a\nb\nc\n', after: 'a\nB\nC\n' }]
    const marked = markNewRows(buildChangeSetDiffView(current), { previous, current })
    expect(marked.files[0]!.rows.filter(r => (r.kind === 'add' || r.kind === 'del') && r.isNew).map(r => 'text' in r && r.text)).toEqual(['c', 'C'])
  })

  it('reconstructs only the complete approved file representation', () => {
    const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-a\r\n-b\n\\ No newline at end of file\n+a\r\n+B\n'
    expect(reconstructWholeFileDiff(patch)).toEqual([{ path: 'a.ts', before: 'a\r\nb', after: 'a\r\nB\n' }])
    expect(() => reconstructWholeFileDiff(patch.replace('-1,2', '-2,2'))).toThrow()
    expect(() => reconstructWholeFileDiff(patch.replace('-1,2', '-1,3'))).toThrow()
  })

  it('parses bounded Git context without claiming an unknown trailing file length', () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,3 +3,3 @@\n c\n-d\n+D\n e\n'
    expect(buildGitPatchDiffView(patch).files[0]!.rows).toEqual([
      { kind: 'gap', from: 1, to: 3 }, { kind: 'del', oldLine: 4, text: 'd' },
      { kind: 'add', newLine: 4, text: 'D' }, { kind: 'gap', from: 5, to: 5 },
    ])
  })
})

it('preserves gaps between separate patch hunks', () => {
  const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -2 +2 @@\n-b\n+B\n@@ -10 +10 @@\n-j\n+J\n'
  expect(buildGitPatchDiffView(patch).files[0]!.rows).toContainEqual({ kind: 'gap', from: 3, to: 9 })
})
