export type ParsedTestOutput = { counts?: { total: number; passed: number; failed: number }; failures: string[]; keyLines: string[]; lineCount: number; lines: string[] }
export function parseTestOutput(output: string, status: string): ParsedTestOutput {
  const lines = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  const result: ParsedTestOutput = { failures: [], keyLines: [], lineCount: lines.length, lines }
  const clean = lines.join('\n')
  const tapTotal = /^# tests (\d+)$/mu.exec(clean), tapPassed = /^# pass (\d+)$/mu.exec(clean), tapFailed = /^# fail (\d+)$/mu.exec(clean)
  let total: number | undefined, passed: number | undefined, failed: number | undefined
  if (tapTotal && tapPassed && tapFailed) { total = Number(tapTotal[1]); passed = Number(tapPassed[1]); failed = Number(tapFailed[1]) }
  else {
    const totals = [...lines].reverse().find(l => /^\s*Tests\s*:?[\s]+/u.test(l))
    if (totals) {
      const count = (name: string) => new RegExp(`(\\d+) ${name}`, 'u').exec(totals)?.[1]
      total = Number(count('total') ?? /\((\d+)\)/u.exec(totals)?.[1]); passed = Number(count('passed') ?? 0); failed = Number(count('failed') ?? 0)
    }
  }
  if (total !== undefined && passed !== undefined && failed !== undefined && Number.isSafeInteger(total) && total >= passed + failed && passed >= 0 && failed >= 0) result.counts = { total, passed, failed }
  const tapFailures = lines.flatMap((line, i) => { const m = /^(\s*)not ok \d+ - (.+)$/u.exec(line); return m ? [{ name: m[2]!, indent: m[1]!.length, i }] : [] })
  // TAP prints a parent failure after its children; retain leaf failures, not duplicate suites.
  result.failures = tapFailures.filter((item, i) => !tapFailures.slice(0, i).some(child => child.indent > item.indent && !lines.slice(child.i + 1, item.i).some(l => /^\s*# Subtest:/u.test(l) && (l.match(/^\s*/u)?.[0].length ?? 0) <= item.indent)))
    .map(item => item.name).slice(0, 5)
  if (!result.failures.length) result.failures = lines.filter(l => /^\s*(?:×|✕|FAIL\s)/u.test(l)).map(l => l.trim().replace(/^[×✕]\s*/u, '')).slice(0, 5)
  if (status === 'passed') result.keyLines = lines.filter(Boolean).slice(-6)
  else {
    const chosen = new Set<number>()
    lines.forEach((line, index) => {
      if (/not ok\s|\bError\b|\bexpected\b|\bFAIL\b|[1-9]\d* failed/iu.test(line) && !/^\s*at\s/u.test(line)) for (let j = index; j < Math.min(lines.length, index + 3); j++) if (!/^\s*at\s/u.test(lines[j]!)) chosen.add(j)
    })
    result.keyLines = (chosen.size ? [...chosen].sort((a, b) => a - b).map(i => lines[i]!) : lines.filter(Boolean).slice(-12)).slice(0, 12)
  }
  result.keyLines = result.keyLines.join('\n').slice(0, 2000).split('\n')
  return result
}
