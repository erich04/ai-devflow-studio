import { vitestAssertion } from './native-coding-vitest-assertions'
import { replyDeliveryBody } from './native-coding-lost-reply'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingDigest, codingFilePath, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { privateAcceptancePath } from './native-coding-acceptance-context'
import { preflightFrameReader, privatePreflightDiagnostics } from './native-coding-preflight-diagnostics'
import { fixtureTemplate, witnessedBaselineBody, type FixtureTemplate } from './native-coding-fixture-cases'
import type { CodingCommandRunner, CodingExecutionProfile } from './coding-command-runner'
import type { FrozenIndependentChecks, IndependentCheckResult } from './native-coding-independent-verification'

type CheckRow = { id: string; status: 'passed' | 'failed' | 'invalid'; tests: number; failedTitles?: unknown[] }

function contrastedBody(value: string, body: string, boundCall?: true, field?: string) {
  const declaration = `const __devflowInput = ${JSON.stringify(value)};\n`
  if (!boundCall) return declaration + body
  // Verify the addressed subject before calling the product. A fixture that
  // silently dispatches to its old default cannot supply behavioral evidence.
  return declaration + `
let __devflowObserved = 0;
function __devflowOperationRefused(error) {
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) throw error;
  __devflowAssert.fail('The required positive operation refused the arranged input');
}
function __devflowInvoke(action, args, modeOf) {
  const subject = modeOf(...args);
  if (${field ? `subject?.[${JSON.stringify(field)}]` : 'subject'} !== __devflowInput) throw new Error('DevFlowFixtureInputMismatch');
  __devflowObserved++;
  let result;
  try { result = action(...args); } catch (error) { return __devflowOperationRefused(error); }
  return result && typeof result.then === 'function' ? Promise.resolve(result).catch(__devflowOperationRefused) : result;
}
await (async () => {
${body}
})();
if (!__devflowObserved) throw new Error('DevFlowFixtureInputMismatch');
`
}

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
export async function runVitestIndependentChecks(input: { plan: FrozenIndependentChecks; baseline?: CodingCandidateWorkspace; runner: CodingCommandRunner; directory: string; profile: CodingExecutionProfile; operationId: string; signal?: AbortSignal; baselinePreflight?: true; onDiagnostics?(value: string): void }): Promise<IndependentCheckResult> {
  const { plan, directory, runner } = input
  if (!plan.adapter) throw new Error('Missing independent test adapter')
  const nonce = randomUUID(), stem = `devflow-acceptance-${nonce}`
  const reportName = `.${stem}.json`, reporterName = `.${stem}.reporter.mjs`
  const templates = new Map<string, FixtureTemplate>()
  const tests: Array<{id: string; file: string; body: string; title: string | undefined; matched: {file: string; body: string} | undefined}> = []
  for (const [index, check] of plan.checks.entries()) {
    const binding = check.fixture
    let {directory: targetDirectory, extension = 'ts'} = plan.adapter
    let body = check.body, title: string | undefined, matched: {file: string; body: string} | undefined
    if (binding) {
      const base = input.baseline?.identity.base
      if (base?.digest !== plan.baselineDigest || !base.files.some(file=>file.path===binding.path && file.hash===binding.hash)) throw new Error('Independent fixture baseline changed')
      let template = templates.get(binding.path)
      if (!template) {
        const bytes = await input.baseline!.blob(binding.hash)
        if (codingDigest(bytes)!==binding.hash) throw new Error('Independent fixture bytes changed')
        template = fixtureTemplate(binding.path, bytes.toString('utf8')); templates.set(binding.path, template)
      }
      title = plan.criteria.find(c=>c.id===check.criterionId)!.text.slice(0,1600)
      targetDirectory = path.posix.dirname(binding.path); extension = binding.path.endsWith('x') ? 'tsx' : 'ts'
      if (binding.contrast) {
        const withInput = (value: string) => contrastedBody(value, check.body, binding.contrast!.boundCall, binding.contrast!.field)
        matched = {
          file: path.posix.join(targetDirectory, `${stem}-control-${index}.test.${extension}`),
          body: template.render(binding.anchor, 'devflow:matched-control', withInput(binding.contrast.control), true),
        }
        body = withInput(binding.contrast.requested)
      }
      if (binding.witnessed && input.baselinePreflight) body = witnessedBaselineBody(binding.path, body)
      if (binding.lostReply) {
        matched = {
          file: path.posix.join(targetDirectory, `${stem}-acknowledged-${index}.test.${extension}`),
          body: template.render(binding.anchor, 'devflow:matched-control', replyDeliveryBody(check.body, false), true),
        }
        body = replyDeliveryBody(body, true)
      }
      body = template.render(binding.anchor, title, body, true)
    }
    tests.push({id:check.criterionId, file:path.posix.join(targetDirectory, `${stem}-${index}.test.${extension}`), body, title, matched})
  }
  const framePaths = input.onDiagnostics ? (input.baseline?.identity.base.files ?? [])
    .filter(f => !privateAcceptancePath.test(f.path) && /\.[cm]?[jt]sx?$/u.test(f.path) && !/\.(test|spec)\.[^.]+$/u.test(f.path) && f.path.length<=300).map(f=>f.path).slice(0,6000) : []
  const reporter = `import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
export default class AcceptanceReporter {
  onFinished(files = [], unhandled = []) {
    const isAssertion = ${vitestAssertion};
    const diagnostics = [];
    const getFrames = ${framePaths.length ? preflightFrameReader(framePaths) : '() => []'};
    const rows = ${JSON.stringify(tests.map(({ id, file, title, matched }) => ({ id, file, title, controlFile: matched?.file })))}.map(({id, file, title, controlFile}) => {
      const found = files.filter(item => path.resolve(item.filepath) === path.resolve(file));
      if (found.length !== 1) return { id, status: 'invalid', tests: 0 };
      const tests = [], suiteErrors = [];
      const visit = task => { if (task.type === 'test') tests.push(task); else { suiteErrors.push(...(task.result?.errors ?? [])); for (const child of task.tasks ?? []) visit(child); } };
      if (controlFile) {
        const control = files.filter(item => path.resolve(item.filepath) === path.resolve(controlFile));
        if (control.length === 1) visit(control[0]);
        if (suiteErrors.length || tests.length !== 2 || !['devflow:original-control','devflow:matched-control'].every(name => tests.some(t => t.name === name && t.result?.state === 'pass'))) {
          diagnostics.push({id, kind:'MatchedControlFailed'});
          return {id, status:'invalid', tests:0};
        }
        tests.length = 0;
      }
      visit(found[0]);
      const errors = tests.flatMap(task => task.result?.errors ?? []);
      for (const error of [...suiteErrors, ...errors].slice(0, 4)) {
        const kind = error.message === 'DevFlowCommittedEffectNotReached' ? 'CommittedEffectNotReached' : error.message === 'DevFlowFixtureWitnessNotReached' ? 'WitnessNotReached' : error.message === 'DevFlowFixtureInputMismatch' ? 'MismatchedInput' : isAssertion(error) ? 'AssertionError' : ['SyntaxError','TypeError','ReferenceError'].includes(error.name) ? error.name : 'TestSetupError';
        diagnostics.push({id, kind, ...(kind === 'TestSetupError' ? {messageDigest:createHash('sha256').update(String(error.message || '')).digest('hex'), frames:getFrames(error)}:{})});
      }
      const broken = (title !== undefined && (tests.length !== 2 || !tests.some(t => t.name === title) || !tests.some(t => t.name === 'devflow:original-control' && t.result?.state === 'pass'))) || unhandled.length || suiteErrors.length || !tests.length || tests.some(task => !['pass','fail'].includes(task.result?.state) || ['skip','todo'].includes(task.mode)) || errors.some(error => !isAssertion(error) || /any number of assertion|number of assertions to be called/i.test(error.message ?? ''));
      return { id, status: broken ? 'invalid' : tests.some(task => task.result?.state === 'fail') ? 'failed' : 'passed', tests: tests.length, failedTitles: tests.filter(task => task.result?.state === 'fail').slice(0, 20).map(task => task.name) };
    });
    writeFileSync(${JSON.stringify(reportName)}, JSON.stringify({nonce: ${JSON.stringify(nonce)}, rows, diagnostics}), {flag: 'wx', mode: 0o600});
  }
}
`
  const created: Array<{ file: string; content: string }> = []
  const modules = tests.flatMap(test => test.matched ? [test, test.matched] : [test])
  let reportOwned = false
  try {
    // Pre-existing files, including symlinks, must never be replaced or removed.
    const reportFile = await codingFilePath(directory, reportName)
    try { await lstat(reportFile); throw new Error('Acceptance report already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    reportOwned = true
    for (const item of [...modules.map(test => ({ file: test.file, content: `import { beforeEach as __devflowBeforeEach, expect as __devflowExpect } from 'vitest';\n__devflowBeforeEach(() => __devflowExpect.hasAssertions());\n${test.body}\n` })), { file: reporterName, content: reporter }]) {
      const file = await codingFilePath(directory, item.file)
      await writeFile(file, item.content, { flag: 'wx', mode: 0o400 }); created.push({ file, content: item.content })
    }
    await runner.start(input.operationId, { executable: 'node', args: ['node_modules/vitest/vitest.mjs', 'run', ...modules.map(test => test.file), ...(tests.some(t=>t.matched) ? ['--isolate'] : []), '--maxWorkers=2', '--reporter', `./${reporterName}`], timeoutMs: 120000, profile: input.profile }, directory, input.signal)
    const receipt = await runner.wait(input.operationId)
    for (const item of created) if (await readFile(item.file, 'utf8') !== item.content) throw new Error('Independent test program changed during execution')
    let report: unknown
    try {
      const stat = await lstat(reportFile)
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128000) report = JSON.parse(await readFile(reportFile, 'utf8'))
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    const result = vitestIndependentResult(plan, nonce, receipt, report)
    if (input.onDiagnostics && report && typeof report === 'object') {
      const diagnostics = (report as {diagnostics?:unknown}).diagnostics
      input.onDiagnostics(await privatePreflightDiagnostics(diagnostics, plan.criteria.map(c=>c.id), input.baseline))
    }
    return result
  } finally {
    for (const item of created) await rm(item.file, { force: true })
    if (reportOwned) await rm(path.join(directory, reportName), { force: true })
  }
}
