/**
 * Deterministic `file:line` extraction from saved test output (ADR 0024).
 *
 * Only canonical repository-relative paths inside one of the given workspace roots are
 * returned; absolute paths outside the workspace, dependency folders and traversal are
 * dropped. Callers still verify that a returned path exists before reading it.
 */

export type TestFailureLocation = { path: string; line: number; column?: number }

export const TEST_FAILURE_LOCATIONS_MAX = 8

const MAX_PATH_LENGTH = 500
const MAX_LINE = 10_000_000
const pathCharacters = String.raw`[^\s:()'"\x60,;<>\[\]{}|*?]`
const extension = String.raw`\.[A-Za-z][A-Za-z0-9]{0,5}`
const patterns: Array<{ regex: RegExp; path: number; line: number; column: number | null }> = [
  // TypeScript compiler: src/a.ts(12,5): error TS2322
  { regex: new RegExp(String.raw`((?:file://)?${pathCharacters}+${extension})\((\d+),(\d+)\)`, 'gu'), path: 1, line: 2, column: 3 },
  // Stack frames and most runners: /abs/src/a.test.ts:12:5, src/a.ts:12
  { regex: new RegExp(String.raw`((?:file://)?${pathCharacters}+${extension}):(\d+)(?::(\d+))?`, 'gu'), path: 1, line: 2, column: 3 },
  // Python tracebacks: File "src/a.py", line 12
  { regex: /File "([^"\n]+)", line (\d+)/gu, path: 1, line: 2, column: null },
]

function isCanonicalRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('//')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    !segments.includes('node_modules') && !segments.includes('.git')
}

function toWorkspaceRelative(rawPath: string, workspaceRoots: readonly string[]): string | null {
  let candidate = rawPath.startsWith('file://') ? rawPath.slice('file://'.length) : rawPath
  if (candidate.startsWith('/')) {
    const roots = workspaceRoots
      .map((root) => root.replace(/\/+$/u, ''))
      .filter((root) => root.startsWith('/'))
      // macOS temporary directories are reported through the /private symlink.
      .flatMap((root) => root.startsWith('/private/') ? [root] : [root, `/private${root}`])
      .sort((left, right) => right.length - left.length)
    const root = roots.find((entry) => candidate.startsWith(`${entry}/`))
    if (!root) return null
    candidate = candidate.slice(root.length + 1)
  }
  while (candidate.startsWith('./')) candidate = candidate.slice(2)
  return isCanonicalRelativePath(candidate) ? candidate : null
}

export function parseTestFailureLocations(
  output: string,
  options: { workspaceRoots: readonly string[]; limit?: number },
): TestFailureLocation[] {
  const limit = Math.max(0, Math.min(options.limit ?? TEST_FAILURE_LOCATIONS_MAX, TEST_FAILURE_LOCATIONS_MAX))
  const withoutAnsi = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
  const found: Array<TestFailureLocation & { offset: number }> = []
  const seen = new Set<string>()
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0
    for (const match of withoutAnsi.matchAll(pattern.regex)) {
      const rawPath = match[pattern.path]
      const line = Number(match[pattern.line])
      const column = pattern.column === null ? undefined : Number(match[pattern.column])
      if (!rawPath || !Number.isInteger(line) || line < 1 || line > MAX_LINE) continue
      const relativePath = toWorkspaceRelative(rawPath, options.workspaceRoots)
      if (!relativePath) continue
      const key = `${relativePath}:${line}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        path: relativePath,
        line,
        ...(column !== undefined && Number.isInteger(column) && column >= 1 ? { column } : {}),
        offset: match.index ?? 0,
      })
    }
  }
  return found
    .sort((left, right) => left.offset - right.offset)
    .slice(0, limit)
    .map(({ offset: _offset, ...location }) => location)
}
