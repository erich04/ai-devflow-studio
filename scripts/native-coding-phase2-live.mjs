/** One bounded Native v3 rerun of the exact ten r8 observations, not the 31-task release gate. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepare, independentCheck, runProcess, removeDisposableDependencies, removeTrialCommandCaches, checkDeepSeekAvailability, trialLedgerAccountedUsd, nextTrialBudget, providerStopReason } from './native-coding-batch-live.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const digest = data => createHash('sha256').update(data).digest('hex')
const git = args => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().trim()
const runners = ['native-coding-phase2-live.mjs', 'native-coding-batch-live.mjs', 'native-coding-trial-live.mts', 'native-coding-live-support.ts', 'native-coding-live-operator.ts']
const json = (file, value, exclusive = false) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w', mode: 0o600 })
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const exists = async file => { try { await access(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

export function selectR8Tasks(plan, observations) {
  const expected = Array.from({ length: 10 }, (_, i) => `devflow-history-${String(i + 2).padStart(2, '0')}`)
  const observed = observations.filter(row => row.engine === 'native-v3').map(row => row.taskId)
  if (plan.id !== 'comparison-20261027-r8' || JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error('Expected exactly the original ten ordered r8 Native v3 observations')
  return expected.map(id => {
    const matches = plan.tasks.filter(task => task.id === id)
    if (matches.length !== 1 || !matches[0].testCommand || !matches[0].acceptanceTests?.length) throw new Error('Missing original task or acceptance plan')
    return structuredClone(matches[0])
  })
}
export function phase2Score(tasks, rows) {
  if (new Set(rows.map(row => row.taskId)).size !== rows.length || rows.some(row => !tasks.some(task => task.id === row.taskId))) throw new Error('Duplicate or foreign phase2 observation')
  const independentPassed = rows.filter(row => row.independentPassed === true).length
  const falseCompleted = rows.filter(row => row.claimedCompleted === true && row.independentPassed !== true).length
  const invalidObservations = rows.filter(row => row.qualityObservationValid === false).length
  return { planned: tasks.length, observed: rows.length, independentPassed, falseCompleted,
    invalidObservations, qualityGatePassed: rows.length === tasks.length && invalidObservations === 0 && independentPassed >= 1 && falseCompleted === 0,
    releaseGatePassed: false, interpretation: 'Only the original r8 ten-task phase2 gate. OS platform checks and PR CI are separate evidence; this does not complete the 31-task release evaluation.' }
}
export function validIndependentObservation(result) {
  return !result.failure && !result.process?.timedOut && typeof result.total === 'number' && result.total > 0 &&
    (result.passed === true || result.failedAssertions > 0)
}
/** The host copies the report out only after the sandboxed process has stopped. */
export async function sandboxOracleCommand(root, executable, args, cwd, log, timeoutMs = 300000) {
  const { CodingCommandRunner } = await import('../apps/desktop/electron/coding-command-runner.ts')
  const oracle = new CodingCommandRunner(root), outputIndex = args.indexOf('--outputFile'), rewritten = [...args]
  const report = path.join(cwd, '.devflow-reference-result.json'), id = path.basename(log)
  if (outputIndex >= 0) rewritten[outputIndex + 1] = report
  try {
    await oracle.start(id, { executable, args: rewritten, timeoutMs, profile: { kind: 'os_sandbox', network: 'enabled' } }, cwd)
    const receipt = await oracle.wait(id)
    let offset = 0, text = ''
    do {
      const page = await oracle.read(id, offset, 64000); text += page.output
      if (page.nextOffset === null) break
      offset = page.nextOffset
    } while (offset < receipt.outputBytes)
    await writeFile(log, text, { flag: 'wx', mode: 0o600 })
    if (outputIndex >= 0 && await exists(report)) await writeFile(args[outputIndex + 1], await readFile(report), { flag: 'wx', mode: 0o600 })
    return { code: receipt.exitCode, timedOut: receipt.status === 'timed_out', status: receipt.status, sandbox: receipt.sandbox, receiptId: receipt.id }
  } finally { await oracle.cancelAll() }
}
async function assertCandidate(plan) {
  if (git(['status', '--porcelain']) || git(['rev-parse', 'HEAD']) !== plan.candidateCommit) throw new Error('Candidate differs from the frozen clean commit')
  for (const [name, hash] of Object.entries(plan.runnerDigests)) if (digest(await readFile(path.join(repository, 'scripts', name))) !== hash) throw new Error('Frozen runner changed')
}
export async function freezePhase2(output, source, maxCostUsd = 3) {
  if (git(['status', '--porcelain'])) throw new Error('Commit implementation and evaluation runner before freezing')
  const relative = path.relative(repository, output)
  if (!relative || !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Use an output directory outside the source repository so sandboxed tooling cannot discover its parent workspace')
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 3) throw new Error('This phase2 round has a maximum $3 operational ceiling')
  const original = await readJson(path.join(source, 'experiment.json')), observations = await readJson(path.join(source, 'runs.json'))
  const tasks = selectR8Tasks(original, observations)
  const plan = { version: 1, id: path.basename(output), frozenAt: new Date().toISOString(), candidateCommit: git(['rev-parse', 'HEAD']),
    source: { id: original.id, experimentDigest: digest(await readFile(path.join(source, 'experiment.json'))), observationsDigest: digest(await readFile(path.join(source, 'runs.json'))) },
    runnerDigests: Object.fromEntries(await Promise.all(runners.map(async name => [name, digest(await readFile(path.join(repository, 'scripts', name)))]))),
    provider: { id: 'deepseek', model: 'deepseek-flash', thinking: 'enabled', effort: 'high', baseUrl: 'https://api.deepseek.com', pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/' },
    authorization: 'User authorized phase2 and all necessary permissions in this chat. Reuse the saved project development DeepSeek provider. This $3 ceiling is an agent-selected operational bound, not a claim that the user specified a new dollar amount.',
    totalBudget: { maxCostUsd, minimumTrialHeadroomUsd: 0.1 }, concurrency: 1,
    limits: { maxCalls: 192, maxCostUsd, maxSteps: 80, maxActiveMilliseconds: 900000, maxOutputTokens: 65536 },
    execution: { profile: 'os_sandbox', network: 'enabled', permissionMode: 'sandbox_rules', commandRules: [
      ...[['git', 'status'], ['git', 'diff'], ['git', 'log'], ['git', 'show'], ['git', 'ls-files'], ['rg'], ['ls'], ['cat'], ['head'], ['tail'], ['wc'], ['node', '--version'], ['corepack', 'pnpm', 'exec', 'vitest']].map(prefix => ({ prefix, decision: 'allow' })),
      { prefix: ['git', 'push'], decision: 'deny' },
    ] },
    operatorPolicy: 'System sandbox only; explicitly enable IP network for frozen dependency preparation. Initial saved test/install plans are preapproved. Only the frozen direct-argv allow rules can run additional commands automatically. Reject other root/child permission cards; record each. Do not invent answers. Approve exact revisions only to permit product verification. Unknown requests retain full reservation and are not replayed. Stop on provider refusal or runner failure. No implicit retries or extensions.',
    evaluation: 'Keep original prompts, baselines, public plans and reference acceptance tests unchanged. Independent author sees only B and approved objective; reference tests remain outside all model/agent workspaces. External oracle restores protected baseline config/tests before overlaying exact reference tests, runs in its own OS sandbox, and never feeds failures to the implementer.',
    tasks }
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output)
  await json(path.join(output, 'experiment.json'), plan, true)
  await json(path.join(output, 'historical-comparison.json'), observations.filter(row => row.engine === 'native-v3'), true)
  console.log(JSON.stringify({ event: 'frozen', candidate: plan.candidateCommit, tasks: tasks.length, maxCostUsd, paidRequests: 0 }))
}
async function runPhase2(output, keyFile) {
  if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND) throw new Error('Do not mix a phase2 USD run with another guarded budget round')
  const plan = await readJson(path.join(output, 'experiment.json'))
  await assertCandidate(plan)
  if (plan.concurrency !== 1 || plan.totalBudget.maxCostUsd > 3 || plan.tasks.length !== 10) throw new Error('Invalid frozen phase2 envelope')
  const lock = path.join(output, '.run-lock'); await mkdir(lock)
  await json(path.join(lock, 'owner.json'), { pid: process.pid, at: new Date().toISOString() }, true)
  const rows = [], accounted = async () => {
    let total = 0
    for (const task of plan.tasks) {
      const file = path.join(output, task.id, 'execution', 'ledger.json')
      if (await exists(file)) total += trialLedgerAccountedUsd(await readJson(file))
    }
    return total
  }
  let stopping = false
  const stop = () => { stopping = true }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    for (const task of plan.tasks) {
      const row = path.join(output, task.id, 'row.json')
      if (await exists(row)) rows.push(await readJson(row))
      else if (await exists(path.join(output, task.id))) throw new Error('An interrupted trial exists; inspect its receipts before any new paid dispatch')
    }
    const availability = await checkDeepSeekAvailability((await readFile(keyFile, 'utf8')).trim())
    await json(path.join(output, `provider-preflight-${Date.now()}.json`), availability, true)
    if (!availability.available) throw new Error(`Provider unavailable: ${availability.reason}`)
    for (const task of plan.tasks) {
      if (stopping) break
      if (rows.some(row => row.taskId === task.id)) continue
      await assertCandidate(plan)
      const cap = nextTrialBudget(plan.totalBudget, await accounted(), plan.limits.maxCostUsd)
      if (cap === null) { await json(path.join(output, 'dispatch-stop.json'), { reason: 'budget', nextTask: task.id, accountedUsd: await accounted() }, true); break }
      const directory = path.join(output, task.id), executionOutput = path.join(directory, 'execution')
      const baseline = await prepare(task, directory)
      const input = { ...plan.limits, id: task.id, engine: 'native-v3', repository: baseline, output: executionOutput, prompt: task.prompt, testCommand: task.testCommand, maxCostUsd: cap, execution: plan.execution, opencodeBinary: '' }
      const inputFile = path.join(directory, 'input.json'); await json(inputFile, input, true)
      console.log(JSON.stringify({ event: 'start', task: task.id, maxCostUsd: cap }))
      const execution = await runProcess(corepack, ['pnpm', 'exec', 'tsx', 'scripts/native-coding-trial-live.mts', inputFile, keyFile], repository, path.join(directory, 'execution.log'), plan.limits.maxActiveMilliseconds + 600000)
      if (!await exists(path.join(executionOutput, 'trial.json'))) throw new Error(`Trial ${task.id} produced no report; do not retry an uncertain paid attempt`)
      const trial = await readJson(path.join(executionOutput, 'trial.json'))
      const workspace = trial.workspace && await exists(path.join(trial.workspace, '.git')) ? trial.workspace : undefined
      if (workspace) await writeFile(path.join(directory, 'candidate.patch'), execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: workspace, maxBuffer: 64 * 1024 * 1024 }), { mode: 0o600 })
      const independent = await independentCheck(task, baseline, workspace, directory, (...args) => sandboxOracleCommand(path.join(directory, 'oracle-commands'), ...args))
      await json(path.join(directory, 'independent.json'), independent, true)
      const qualityObservationValid = validIndependentObservation(independent)
      const row = { taskId: task.id, engine: 'native-v3', claimedCompleted: trial.claimedCompleted, independentPassed: independent.passed, qualityObservationValid, costUsd: trial.costUsd, durationMs: trial.durationMs, metrics: trial.metrics, status: trial.status, failure: trial.failure ?? null, execution, independent }
      await json(path.join(directory, 'row.json'), row, true); rows.push(row)
      await json(path.join(output, 'runs.json'), rows); await json(path.join(output, 'score.json'), phase2Score(plan.tasks, rows))
      console.log(JSON.stringify({ event: 'result', task: task.id, status: trial.status, independentPassed: independent.passed, claimedCompleted: trial.claimedCompleted, costUsd: trial.costUsd }))
      await removeDisposableDependencies(directory); await removeTrialCommandCaches(executionOutput)
      if (!qualityObservationValid) { await json(path.join(output, 'dispatch-stop.json'), { reason: 'invalid_external_oracle', task: task.id, independent }, true); break }
      const providerReason = providerStopReason(trial.providerUnavailable)
      if (providerReason) { await json(path.join(output, 'dispatch-stop.json'), { reason: providerReason, task: task.id }, true); break }
    }
  } catch (error) {
    await json(path.join(output, 'runner-failure.json'), { at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
    await json(path.join(output, 'runs.json'), rows)
    await json(path.join(output, 'score.json'), phase2Score(plan.tasks, rows))
    await json(path.join(output, 'budget-summary.json'), { at: new Date().toISOString(), maxCostUsd: plan.totalBudget.maxCostUsd, accountedUsd: await accounted(), observations: rows.length })
    await rm(lock, { recursive: true })
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, output, sourceOrKey] = process.argv.slice(2)
  if (!output || !sourceOrKey || !['freeze', 'run'].includes(command)) throw new Error('Usage: tsx scripts/native-coding-phase2-live.mjs freeze <new-output> <original-r8-output> | run <frozen-output> <private-key-file>')
  if (command === 'freeze') await freezePhase2(path.resolve(output), path.resolve(sourceOrKey))
  else await runPhase2(path.resolve(output), path.resolve(sourceOrKey))
}
