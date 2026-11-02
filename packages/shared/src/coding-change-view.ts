import { diffTextLines, splitLines } from './line-diff'

export type DiffRow =
  | { kind: 'del'; oldLine: number; text: string; isNew?: true }
  | { kind: 'add'; newLine: number; text: string; isNew?: true }
  | { kind: 'gap'; from: number; to: number }
  | { kind: 'note'; text: 'eof' }
export type DiffFileView = { path: string; additions: number; deletions: number; rows: DiffRow[]; tooLarge?: true; unparsed?: true }
export type ChangeSetDiffView = { files: DiffFileView[]; additions: number; deletions: number }
export type ChangeFileTexts = { path: string; before: string; after: string }
const textOf = (line: string) => line.endsWith('\n') ? line.slice(0, -1) : line
const summarize = (files: DiffFileView[]): ChangeSetDiffView => ({ files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) })
function gap(rows: DiffRow[], from: number, to: number) {
  if (to < from) return
  const last = rows.at(-1)
  if (last?.kind === 'gap' && from <= last.to + 1) last.to = Math.max(last.to, to)
  else rows.push({ kind: 'gap', from, to })
}

export function buildChangeSetDiffView(files: ChangeFileTexts[]): ChangeSetDiffView {
  return summarize([...files].sort((a, b) => a.path.localeCompare(b.path)).map(file => {
    const view: DiffFileView = { path: file.path, additions: 0, deletions: 0, rows: [] }
    if (new TextEncoder().encode(file.before).length > 512 * 1024 || new TextEncoder().encode(file.after).length > 512 * 1024) return { ...view, tooLarge: true }
    let nextLine = 1
    for (const hunk of diffTextLines(file.before, file.after)) {
      gap(view.rows, nextLine, hunk.newStart - 1)
      const eofOnly = hunk.oldLines.length === hunk.newLines.length && hunk.oldLines.every((line, i) => textOf(line) === textOf(hunk.newLines[i]!))
      if (eofOnly) gap(view.rows, hunk.newStart, hunk.newStart + hunk.newLines.length - 1)
      else {
        hunk.oldLines.forEach((line, i) => view.rows.push({ kind: 'del', oldLine: hunk.oldStart + i, text: textOf(line) }))
        hunk.newLines.forEach((line, i) => view.rows.push({ kind: 'add', newLine: hunk.newStart + i, text: textOf(line) }))
        view.deletions += hunk.oldLines.length; view.additions += hunk.newLines.length
      }
      nextLine = hunk.newStart + hunk.newLines.length
    }
    gap(view.rows, nextLine, splitLines(file.after).lines.length)
    if (file.before.endsWith('\n') !== file.after.endsWith('\n')) view.rows.push({ kind: 'note', text: 'eof' })
    return view
  }))
}

export function reconstructWholeFileDiff(unifiedDiff: string): ChangeFileTexts[] {
  const sections = unifiedDiff.split(/(?=^diff --git )/mu).filter(Boolean)
  if (!sections.length) throw new Error('Missing whole-file diff')
  const seen = new Set<string>()
  return sections.map(section => {
    const lines = section.split('\n')
    if (lines.pop() !== '') throw new Error('Truncated whole-file diff')
    const header = /^diff --git a\/(.+) b\/\1$/u.exec(lines[0] ?? '')
    const filePath = header?.[1]
    if (!filePath || seen.has(filePath) || lines[1] !== `--- a/${filePath}` || lines[2] !== `+++ b/${filePath}`) throw new Error('Invalid whole-file identity')
    seen.add(filePath)
    const counts = /^@@ -1,(\d+) \+1,(\d+) @@$/u.exec(lines[3] ?? '')
    if (!counts) throw new Error('Not a complete whole-file diff')
    let cursor = 4
    const read = (prefix: string, count: number): string => {
      const text: string[] = []
      for (let i = 0; i < count; i++) {
        const line = lines[cursor++]
        if (line === undefined || !line.startsWith(prefix)) throw new Error('Invalid whole-file line count')
        text.push(line.slice(1))
      }
      const noNewline = lines[cursor] === '\\ No newline at end of file'
      if (noNewline) cursor++
      return text.join('\n') + (count && !noNewline ? '\n' : '')
    }
    const before = read('-', Number(counts[1])), after = read('+', Number(counts[2]))
    if (cursor !== lines.length) throw new Error('Unexpected whole-file content')
    return { path: filePath, before, after }
  })
}

export function buildGitPatchDiffView(patch: string): ChangeSetDiffView {
  const files = patch.split(/(?=^diff --git )/mu).filter(Boolean).map(section => {
    const lines = section.split('\n')
    const header = /^diff --git a\/(.+) b\/(.+)$/u.exec(lines[0] ?? '')
    const file: DiffFileView = { path: header?.[2] ?? '改动', additions: 0, deletions: 0, rows: [] }
    let oldLine = 0, newLine = 0, remainingOld = 0, remainingNew = 0, found = false
    for (const line of lines.slice(1)) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line)
      if (hunk) {
        if (remainingOld || remainingNew) { file.unparsed = true; break }
        if (found) gap(file.rows, newLine, Number(hunk[3]) - 1)
        oldLine = Number(hunk[1]); newLine = Number(hunk[3]); remainingOld = Number(hunk[2] ?? 1); remainingNew = Number(hunk[4] ?? 1)
        if (!found) gap(file.rows, 1, newLine - 1)
        found = true; continue
      }
      if (!found || (!remainingOld && !remainingNew && line !== '\\ No newline at end of file')) continue
      if (line.startsWith('-')) { remainingOld--; file.deletions++; file.rows.push({ kind: 'del', oldLine: oldLine++, text: line.slice(1) }) }
      else if (line.startsWith('+')) { remainingNew--; file.additions++; file.rows.push({ kind: 'add', newLine: newLine++, text: line.slice(1) }) }
      else if (line.startsWith(' ')) { remainingOld--; remainingNew--; oldLine++; gap(file.rows, newLine, newLine); newLine++ }
      else if (line === '\\ No newline at end of file') file.rows.push({ kind: 'note', text: 'eof' })
      else { file.unparsed = true; break }
      if (remainingOld < 0 || remainingNew < 0) { file.unparsed = true; break }
    }
    if (!found || remainingOld || remainingNew || !header) file.unparsed = true
    if (file.unparsed) { file.rows = []; file.additions = 0; file.deletions = 0 }
    return file
  })
  return summarize(files)
}

export function markNewRows(view: ChangeSetDiffView, input: { previous?: ChangeFileTexts[]; current: ChangeFileTexts[]; all?: boolean }): ChangeSetDiffView {
  return { ...view, files: view.files.map(file => {
    const previous = input.previous?.find(f => f.path === file.path), current = input.current.find(f => f.path === file.path)
    const newLines = new Set(previous && current ? diffTextLines(previous.after, current.after).flatMap(h => h.newLines.map((_, i) => h.newStart + i)) : [])
    const priorDeleted = new Set(previous ? diffTextLines(previous.before, previous.after).flatMap(h => h.oldLines.map((_, i) => h.oldStart + i)) : [])
    return { ...file, rows: file.rows.map(row => {
      if (row.kind !== 'add' && row.kind !== 'del') return row
      const { isNew: _, ...clean } = row
      return input.all || !previous || (row.kind === 'add' ? newLines.has(row.newLine) : !priorDeleted.has(row.oldLine)) ? { ...clean, isNew: true as const } : clean
    }) }
  }) }
}
