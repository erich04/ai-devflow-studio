export type ParsedTestOutput = { counts?: { total: number; passed: number; failed: number }; failures: string[]; keyLines: string[]; lineCount: number; lines: string[] }
export function parseTestOutput(output: string, status: string): ParsedTestOutput {
  const lines = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  const result: ParsedTestOutput = { failures: [], keyLines: [], lineCount: lines.length, lines }
    let total: number | undefined, passed: number | undefined, failed: number | undefined
  // Each runner summary replaces the previous one; never combine fields from different runs.
  let group: { total?: number; passed?: number; failed?: number } = {}
  for (const line of lines) {
    const tap = /^(?:#|ℹ) (tests|pass|fail) (\d+)$/u.exec(line.trim())
    if (tap) {
      if (tap[1] === 'tests') group = { total: Number(tap[2]) }
      else if (tap[1] === 'pass') group.passed = Number(tap[2])
      else group.failed = Number(tap[2])
      if (group.total !== undefined && group.passed !== undefined && group.failed !== undefined) ({ total, passed, failed } = group)
    }
    if (/^\s*Tests\s*:?[\s]+/u.test(line)) {
      const count = (name: string) => new RegExp(`(\\d+) ${name}`, 'u').exec(line)?.[1]
      total = Number(count('total') ?? /\((\d+)\)/u.exec(line)?.[1]); passed = Number(count('passed') ?? 0); failed = Number(count('failed') ?? 0)
    }
  }
  if (total !== undefined && passed !== undefined && failed !== undefined && Number.isSafeInteger(total) && total >= passed + failed && passed >= 0 && failed >= 0) result.counts = { total, passed, failed }
  const tapFailures = lines.flatMap((line, i) => { const m = /^(\s*)not ok \d+ - (.+)$/u.exec(line); return m ? [{ name: m[2]!, indent: m[1]!.length, i }] : [] })
  // TAP prints a parent failure after its children; retain leaf failures, not duplicate suites.
  result.failures = tapFailures.filter((item, i) => !tapFailures.slice(0, i).some(child => child.indent > item.indent && !lines.slice(child.i + 1, item.i).some(l => /^\s*# Subtest:/u.test(l) && (l.match(/^\s*/u)?.[0].length ?? 0) <= item.indent)))
    .map(item => item.name).slice(0, 5)
  if (!result.failures.length) result.failures = lines.filter(l => /^\s*(?:×|✕|✖|FAIL\s)/u.test(l)).map(l => l.trim().replace(/^[×✕✖]\s*/u, '').replace(/\s+\(?[\d.]+\s*ms\)?$/u, '')).slice(0, 5)
  if (status === 'passed') result.keyLines = lines.filter(Boolean).slice(-6)
  else {
    const chosen = new Set<number>()
    lines.forEach((line, index) => {
      if (/not ok\s|\b(?:Assertion)?Error\b|\bexpected\b|\bFAIL\b|✖|[1-9]\d* failed/iu.test(line) && !/^\s*at\s/u.test(line)) for (let j = index; j < Math.min(lines.length, index + 3); j++) if (!/^\s*at\s/u.test(lines[j]!)) chosen.add(j)
    })
    result.keyLines = (chosen.size ? [...chosen].sort((a, b) => a - b).map(i => lines[i]!) : lines.filter(Boolean).slice(-12)).slice(0, 12)
  }
  result.keyLines = result.keyLines.join('\n').slice(0, 2000).split('\n')
  return result
}
