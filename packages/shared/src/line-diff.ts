export type LineHunk = { oldStart: number; oldLines: string[]; newStart: number; newLines: string[] }

export function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  const finalNewline = text.endsWith('\n')
  const lines = text === '' ? [] : text.split('\n')
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}

// Keep terminators on tokens: a hunk alone must preserve CRLF and an absent final newline.
function tokens(text: string): string[] { return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [] }
type Edit = 'equal' | 'delete' | 'insert'

function shortestEdits(a: string[], b: string[]): Edit[] | undefined {
  const limit = Math.min(a.length + b.length, 4000)
  const offset = limit + 1
  const v = new Int32Array(2 * limit + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
        ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x < a.length || y < b.length) continue
      const result: Edit[] = []
      for (let step = d; step >= 0; step--) {
        const row = trace[step]!
        const diagonal = x - y
        const get = (key: number) => row[key + step + 1]!
        const previousDiagonal = diagonal === -step || (diagonal !== step && get(diagonal - 1) < get(diagonal + 1))
          ? diagonal + 1 : diagonal - 1
        const previousX = get(previousDiagonal)
        const previousY = previousX - previousDiagonal
        while (x > previousX && y > previousY) { result.push('equal'); x--; y-- }
        if (step > 0) {
          if (x === previousX) { result.push('insert'); y-- }
          else { result.push('delete'); x-- }
        }
      }
      return result.reverse()
    }
  }
  return undefined
}

/** Exact line edit script; bounded Myers search falls back to replacing the changed middle. */
export function diffTextLines(before: string, after: string): LineHunk[] {
  if (before === after) return []
  const old = tokens(before), next = tokens(after)
  let prefix = 0, suffix = 0
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++
  while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  const a = old.slice(prefix, old.length - suffix), b = next.slice(prefix, next.length - suffix)
  const edits = shortestEdits(a, b)
  if (!edits) return [{ oldStart: prefix + 1, oldLines: a, newStart: prefix + 1, newLines: b }]
  const hunks: LineHunk[] = []
  let x = 0, y = 0, hunk: LineHunk | undefined
  for (const edit of edits) {
    if (edit === 'equal') { hunk = undefined; x++; y++; continue }
    if (!hunk) { hunk = { oldStart: prefix + x + 1, newStart: prefix + y + 1, oldLines: [], newLines: [] }; hunks.push(hunk) }
    if (edit === 'delete') hunk.oldLines.push(a[x++]!)
    else hunk.newLines.push(b[y++]!)
  }
  return hunks
}

export function applyLineHunks(before: string, hunks: readonly LineHunk[]): string {
  const lines = tokens(before), result: string[] = []
  let position = 0
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1
    if (start < position || start > lines.length || hunk.oldLines.some((line, i) => line !== lines[start + i])) throw new Error('Line hunk does not match its source')
    for (const line of lines.slice(position, start)) result.push(line)
    for (const line of hunk.newLines) result.push(line)
    position = start + hunk.oldLines.length
  }
  return result.concat(lines.slice(position)).join('')
}
