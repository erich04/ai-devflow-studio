// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
// @ts-expect-error Standalone evaluation CLI uses native modules, not a declaration package.
import { selectR8Tasks, phase2Score, sandboxOracleCommand } from './native-coding-phase2-live.mjs'

const tasks = Array.from({ length: 10 }, (_, i) => ({ id: `devflow-history-${String(i + 2).padStart(2, '0')}`, testCommand: 'saved baseline suite', acceptanceTests: ['unchanged-private.test.ts'] }))
it('keeps exactly the original ten observations, refusing cherry-picked or missing tasks', () => {
  const plan = { id: 'comparison-20261027-r8', tasks }, rows = tasks.map(task => ({ taskId: task.id, engine: 'native-v3' }))
  expect(selectR8Tasks(plan, rows)).toEqual(tasks)
  expect(() => selectR8Tasks(plan, rows.slice(1))).toThrow(/original ten/)
  expect(() => selectR8Tasks(plan, [...rows].reverse())).toThrow(/original ten/)
  expect(() => selectR8Tasks({ ...plan, tasks: tasks.slice(1) }, rows)).toThrow(/Missing original/)
})
it.runIf(process.platform !== 'win32')('runs the external oracle under the OS policy and preserves a multi-page log plus the host-owned report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'df-phase2-oracle-')), cwd = path.join(root, 'candidate')
  await mkdir(cwd)
  try {
    const report = path.join(root, 'report.json'), log = path.join(root, 'command.log')
    const result = await sandboxOracleCommand(path.join(root, 'commands'), process.execPath, ['-e', 'require("fs").writeFileSync(process.argv.at(-1), JSON.stringify({ passed: true })); process.stdout.write("x".repeat(65001))', '--', '--outputFile', report], cwd, log, 5000)
    expect(result).toMatchObject({ code: 0, status: 'passed', sandbox: { backend: expect.stringMatching(/seatbelt|bubblewrap|landlock/) } })
    expect(JSON.parse(await readFile(report, 'utf8'))).toEqual({ passed: true })
    expect(await readFile(log, 'utf8')).toHaveLength(65001)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('does not turn zero completions, a partial sample or false completion into a quality pass', () => {
  const rows = tasks.map(task => ({ taskId: task.id, claimedCompleted: false, independentPassed: false }))
  expect(phase2Score(tasks, rows).qualityGatePassed).toBe(false)
  rows[0] = { ...rows[0]!, claimedCompleted: true, independentPassed: true }
  expect(phase2Score(tasks, rows)).toMatchObject({ qualityGatePassed: true, releaseGatePassed: false })
  expect(phase2Score(tasks, rows.slice(0, 1)).qualityGatePassed).toBe(false)
  rows[1] = { ...rows[1]!, claimedCompleted: true, independentPassed: false }
  expect(phase2Score(tasks, rows)).toMatchObject({ qualityGatePassed: false, falseCompleted: 1 })
  expect(() => phase2Score(tasks, [rows[0], rows[0]])).toThrow(/Duplicate/)
})
