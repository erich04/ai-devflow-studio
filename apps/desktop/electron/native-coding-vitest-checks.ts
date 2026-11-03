import { randomUUID } from 'node:crypto'
import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingFilePath } from './coding-candidate-workspace'
import type { CodingCommandRunner, CodingExecutionProfile } from './coding-command-runner'
import type { FrozenIndependentChecks, IndependentCheckResult } from './native-coding-independent-verification'

type CheckRow = { id: string; status: 'passed' | 'failed' | 'invalid'; tests: number; failedTitles?: unknown[] }

/** Only host-produced classifications leave the private verifier. No test names,
 * assertion values, stack traces or generated source enter the coder transcript. */
export function vitestIndependentResult(plan: FrozenIndependentChecks, nonce: string, receipt: { status: string; exitCode: number | null }, value: unknown): IndependentCheckResult {
  const invalid: IndependentCheckResult = { planDigest: plan.digest, status: receipt.status === 'cancelled' ? 'cancelled' : receipt.status === 'timed_out' ? 'timed_out' : 'invalid',
    checkedCriteria: [], failedCriteria: [], invalidCriteria: plan.criteria.map(item => item.id) }
  if (!value || typeof value !== 'object' || ['cancelled', 'timed_out'].includes(receipt.status)) return invalid
  const report = value as { nonce?: unknown; rows?: CheckRow[] }
  if (report.nonce !== nonce || !Array.isArray(report.rows) || report.rows.length !== plan.criteria.length || new Set(report.rows.map(row => row.id)).size !== report.rows.length ||
      report.rows.some(row => !plan.criteria.some(item => item.id === row.id) || !['passed', 'failed', 'invalid'].includes(row.status) || !Number.isSafeInteger(row.tests) || row.tests < 0)) return invalid
  const invalidCriteria = report.rows.filter(row => row.status === 'invalid' || row.tests === 0).map(row => row.id)
  const failedCriteria = report.rows.filter(row => row.status === 'failed' && !invalidCriteria.includes(row.id)).map(row => row.id)
  const failedRequirements = report.rows.filter(row => failedCriteria.includes(row.id)).flatMap(row => {
    const source = plan.criteria.find(item => item.id === row.id)!
    return (Array.isArray(row.failedTitles) ? row.failedTitles : []).filter((title): title is string => typeof title === 'string' && title.length >= 6 && title.length <= 1600 && source.text.includes(title))
      .slice(0, 20).map(text => ({ id: row.id, text, sourceRef: source.sourceRef }))
  })
  if (!invalidCriteria.length && !failedCriteria.length && (receipt.status !== 'passed' || receipt.exitCode !== 0)) return invalid
  return { planDigest: plan.digest, status: invalidCriteria.length ? 'invalid' : failedCriteria.length ? 'failed' : 'passed',
    checkedCriteria: report.rows.filter(row => row.tests > 0 && !invalidCriteria.includes(row.id)).map(row => row.id), failedCriteria, invalidCriteria, failedRequirements }
}

/** The model supplies ordinary test modules; the host owns filenames, invocation,
 * assertion-presence guards and result transport. There are no path placeholders. */
export async function runVitestIndependentChecks(input: { plan: FrozenIndependentChecks; runner: CodingCommandRunner; directory: string; profile: CodingExecutionProfile; operationId: string; signal?: AbortSignal; onDiagnostics?(value: string): void }): Promise<IndependentCheckResult> {
  const { plan, directory, runner } = input
  if (!plan.adapter) throw new Error('Missing independent test adapter')
  const nonce = randomUUID(), stem = `devflow-acceptance-${nonce}`
  const reportName = `.${stem}.json`, reporterName = `.${stem}.reporter.mjs`
  const tests = plan.checks.map((check, index) => ({ id: check.criterionId, file: path.posix.join(plan.adapter!.directory, `${stem}-${index}.test.${plan.adapter!.extension ?? 'ts'}`), body: check.body }))
  const reporter = `import { writeFileSync } from 'node:fs';
import path from 'node:path';
export default class AcceptanceReporter {
  onFinished(files = [], unhandled = []) {
    const diagnostics = [];
    const rows = ${JSON.stringify(tests.map(({ id, file }) => ({ id, file })))}.map(({id, file}) => {
      const found = files.filter(item => path.resolve(item.filepath) === path.resolve(file));
      if (found.length !== 1) return { id, status: 'invalid', tests: 0 };
      const tests = [], suiteErrors = [];
      const visit = task => { if (task.type === 'test') tests.push(task); else { suiteErrors.push(...(task.result?.errors ?? [])); for (const child of task.tasks ?? []) visit(child); } };
      visit(found[0]);
      const errors = tests.flatMap(task => task.result?.errors ?? []);
      for (const error of [...suiteErrors, ...errors].slice(0, 4)) {
        const kind = ['AssertionError','SyntaxError','TypeError','ReferenceError'].includes(error.name) ? error.name : 'TestSetupError';
        diagnostics.push({id, kind});
      }
      const broken = unhandled.length || suiteErrors.length || !tests.length || tests.some(task => !['pass','fail'].includes(task.result?.state) || ['skip','todo'].includes(task.mode)) || errors.some(error => error.name !== 'AssertionError' || /any number of assertion|number of assertions to be called/i.test(error.message ?? ''));
      return { id, status: broken ? 'invalid' : tests.some(task => task.result?.state === 'fail') ? 'failed' : 'passed', tests: tests.length, failedTitles: tests.filter(task => task.result?.state === 'fail').slice(0, 20).map(task => task.name) };
    });
    writeFileSync(${JSON.stringify(reportName)}, JSON.stringify({nonce: ${JSON.stringify(nonce)}, rows, diagnostics}), {flag: 'wx', mode: 0o600});
  }
}
`
  const created: Array<{ file: string; content: string }> = []
  let reportOwned = false
  try {
    // Pre-existing files, including symlinks, must never be replaced or removed.
    const reportFile = await codingFilePath(directory, reportName)
    try { await lstat(reportFile); throw new Error('Acceptance report already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    reportOwned = true
    for (const item of [...tests.map(test => ({ file: test.file, content: `import { beforeEach as __devflowBeforeEach, expect as __devflowExpect } from 'vitest';\n__devflowBeforeEach(() => __devflowExpect.hasAssertions());\n${test.body}\n` })), { file: reporterName, content: reporter }]) {
      const file = await codingFilePath(directory, item.file)
      await writeFile(file, item.content, { flag: 'wx', mode: 0o400 }); created.push({ file, content: item.content })
    }
    await runner.start(input.operationId, { executable: 'node', args: ['node_modules/vitest/vitest.mjs', 'run', ...tests.map(test => test.file), '--maxWorkers=2', '--reporter', `./${reporterName}`], timeoutMs: 120000, profile: input.profile }, directory, input.signal)
    const receipt = await runner.wait(input.operationId)
    for (const item of created) if (await readFile(item.file, 'utf8') !== item.content) throw new Error('Independent test program changed during execution')
    let report: unknown
    try {
      const stat = await lstat(reportFile)
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128000) report = JSON.parse(await readFile(reportFile, 'utf8'))
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    const result = vitestIndependentResult(plan, nonce, receipt, report)
    if (input.onDiagnostics && report && typeof report === 'object') {
      const diagnostics = (report as { diagnostics?: Array<{ id: string; kind: string }> }).diagnostics
      if (Array.isArray(diagnostics)) input.onDiagnostics(JSON.stringify(diagnostics.filter(item => plan.criteria.some(criterion => criterion.id === item.id) && ['AssertionError', 'SyntaxError', 'TypeError', 'ReferenceError', 'TestSetupError'].includes(item.kind)).map(({ id, kind }) => ({ id, kind }))).slice(0, 4000))
    }
    return result
  } finally {
    for (const item of created) await rm(item.file, { force: true })
    if (reportOwned) await rm(path.join(directory, reportName), { force: true })
  }
}
