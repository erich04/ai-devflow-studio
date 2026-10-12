/** Prepare blinded inputs, invoke the production live trial, then run private acceptance. */
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, cp, access, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreNativeCodingEvaluation } from './native-coding-evaluation.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const digest = value => createHash('sha256').update(value).digest('hex')
const environment = () => ({ ...Object.fromEntries(['PATH', 'LANG', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'HOME', 'PNPM_HOME', 'COREPACK_HOME'].filter(key => process.env[key]).map(key => [key, process.env[key]])), CI: '1', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', ELECTRON_SKIP_BINARY_DOWNLOAD: '1' })
export function protectedEvaluationPath(file) {
  return /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|pnpm-workspace\.yaml|\.npmrc|vitest[^/]*|vite\.config\.[^/]+|tsconfig[^/]*)$/u.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)
}
async function json(file, value, exclusive = false) { await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w', mode: 0o600 }) }
async function removeDisposableDependencies(root) {
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name === '.git') continue
    const directory = path.join(root, item.name)
    if (item.name === 'node_modules') await rm(directory, { recursive: true, force: true })
    else await removeDisposableDependencies(directory)
  }
}
export function runProcess(command, args, cwd, log, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(log, { flags: 'wx', mode: 0o600 })
    const child = spawn(command, args, { cwd, env: environment(), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && command.endsWith('.cmd') })
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false }); let timedOut = false
    const timer = setTimeout(() => { timedOut = true; if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); output.end(); reject(error) })
    child.once('close', code => { clearTimeout(timer); output.end(() => resolve({ code, timedOut })) })
  })
}
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const git = (args, cwd = repository) => execFileSync('git', args, { cwd, env: environment(), maxBuffer: 64 * 1024 * 1024 })

async function prepare(task, directory) {
  await mkdir(directory)
  const baseline = path.join(directory, 'baseline'), archive = path.join(directory, 'baseline.tar')
  await mkdir(baseline); git(['archive', '--format=tar', `--output=${archive}`, task.baseSha])
  execFileSync('tar', ['-xf', archive, '-C', baseline])
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Evaluation'], ['config', 'user.email', 'evaluation@example.invalid'], ['add', '.'], ['commit', '-m', 'Blinded isolated baseline']]) git(args, baseline)
  return baseline
}
async function independentCheck(task, baseline, worktree, directory) {
  const destination = path.join(directory, 'independent'); await mkdir(destination)
  const ignore = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'coverage', '.cache'])
  await cp(worktree || baseline, destination, { recursive: true, filter: source => !path.relative(worktree || baseline, source).split(path.sep).some(part => ignore.has(part)) })
  // Restore evaluator configuration and original tests regardless of candidate modifications.
  const files = git(['ls-tree', '-r', '--name-only', 'HEAD'], baseline).toString().trim().split('\n')
  for (const file of files.filter(protectedEvaluationPath)) { await mkdir(path.dirname(path.join(destination, file)), { recursive: true }); await writeFile(path.join(destination, file), git(['show', `HEAD:${file}`], baseline)) }
  for (const file of task.acceptanceTests) { await mkdir(path.dirname(path.join(destination, file)), { recursive: true }); await writeFile(path.join(destination, file), git(['show', `${task.referenceSha}:${file}`])) }
  const install = await runProcess(corepack, ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], destination, path.join(directory, 'independent-install.log'))
  if (install.code !== 0 || install.timedOut) return { passed: false, install, failure: 'independent_install' }
  const reportFile = path.join(directory, 'independent-tests.json')
  const process = await runProcess(corepack, ['pnpm', 'exec', 'vitest', 'run', ...task.acceptanceTests, '--reporter=json', '--outputFile', reportFile], destination, path.join(directory, 'independent-tests.log'))
  let report; try { report = JSON.parse(await readFile(reportFile, 'utf8')) } catch {}
  const passed = process.code === 0 && !process.timedOut && report?.numTotalTests > 0 && report.numPassedTests === report.numTotalTests && !report.numFailedTests && !report.numUnhandledErrors
  return { passed, process, total: report?.numTotalTests ?? null, passedAssertions: report?.numPassedTests ?? null, failedAssertions: report?.numFailedTests ?? null, reportDigest: report ? digest(JSON.stringify(report)) : null }
}

async function freeze(output) {
  await mkdir(output)
  const sources = Object.fromEntries(await Promise.all(['native-coding-v3-tasks.json', 'native-coding-v3-task-briefs.json', 'native-coding-v3-qualification-20261011.json'].map(async name => [name, await readFile(path.join(repository, 'docs/evaluation', name))])))
  const manifest = JSON.parse(sources['native-coding-v3-tasks.json']), briefs = JSON.parse(sources['native-coding-v3-task-briefs.json']), qualification = JSON.parse(sources['native-coding-v3-qualification-20261011.json'])
  if (qualification.manifestDigest !== digest(sources['native-coding-v3-tasks.json'])) throw new Error('Qualification does not match task input')
  const tasks = manifest.tasks.filter(task => qualification.results.some(row => row.taskId === task.id && row.qualified && row.baseSha === task.baseSha && row.referenceSha === task.referenceSha)).map(task => {
    const brief = briefs.tasks.find(brief => brief.taskId === task.id); if (!brief?.qualifiedFixture) throw new Error('Brief/qualification mismatch'); return { ...task, prompt: brief.prompt, category: brief.category }
  })
  const runnerDigests = Object.fromEntries(await Promise.all(['native-coding-batch-live.mjs', 'native-coding-trial-live.mts', 'native-coding-live-support.ts'].map(async file => [file, digest(await readFile(path.join(repository, 'scripts', file)))])))
  const plan = { schemaVersion: 1, id: path.basename(output), frozenAt: new Date().toISOString(), candidateCommit: git(['rev-parse', 'HEAD']).toString().trim(), sourceDigests: Object.fromEntries(Object.entries(sources).map(([name, bytes]) => [name, digest(bytes)])), runnerDigests,
    provider: { id: 'deepseek', model: 'deepseek-flash', displayName: 'DeepSeek-V4.1-Flash', baseUrl: 'https://api.deepseek.com', thinking: 'enabled', effort: 'high', pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/', userMonetaryCeiling: null, authorization: 'User explicitly authorized this model, supplied its credential, and set no cost ceiling.' },
    node: process.version, platform: process.platform, opencodeVersion: execFileSync('/opt/homebrew/bin/opencode', ['--version']).toString().trim(), opencodeBinary: '/opt/homebrew/bin/opencode',
    engines: ['native-v2', 'native-v3', 'opencode'], trials: 1, concurrency: 2,
    limits: { maxCalls: 192, maxCostUsd: 100, maxSteps: 80, maxActiveMilliseconds: 900000, maxOutputTokens: 65536 },
    limitsNote: 'Operational bounds per trial, not a new user spending ceiling. Use the production high-thinking default 65536 output cap instead of the initial exploratory 16384 cap. Native v2 retains its production 4096 output and fixed proposal/repair limits. Native v3 keeps its production 80-step loop. A separate 15-minute operator wall deadline aborts model I/O and stops owned commands/executors, then preserves cleanup and a durable result; do not confuse it with the product cumulative active-time or authorization expiry. No post-hoc extensions/retries. After a trial and independent checking have both ended, discard only reproducible node_modules directories inside that trial; preserve source, exact patches, lockfiles, sessions, ledgers and all logs.',
    operatorPolicy: 'Authorize isolated trusted_local execution and frozen dependency preparation. Approve exact proposed changes only to permit production verification; no hidden-test feedback to the agent. Questions end historical trials without invented answers. Reject external/network grants. OpenCode shell grants are limited to single read commands and saved tests; no task/question integration changes. No automatic retry of unknown calls.',
    testing: 'Agents run the unchanged baseline test suite. Private evaluator restores baseline test/config files then overlays exact reference acceptance tests. Candidate/source and reviewer tests are separate; evaluate managed delivery even on failed runs. Full reference patch never enters an agent workspace.',
    gates: { mandatoryInteractiveScenarios: 8, minimumQualifiedTasks: 30, falseSuccessMaximum: 0, complexCategories: ['cross_module', 'recovery', 'concurrency'], complexV3AbsolutePassRateGainOverV2: 0.10, maxMedianV3DurationMs: 900000, maxMeanV3CostPerIndependentlyPassedTaskUsd: 10, releaseRequiresHumanEvidenceReview: true },
    tasks, excluded: qualification.results.filter(row => !row.qualified).map(row => row.taskId) }
  if (tasks.length < 30) throw new Error('At least 30 qualified tasks required')
  await json(path.join(output, 'experiment.json'), plan, true)
  await json(path.join(output, 'qualified-tasks.json'), { ...manifest, taskCount: tasks.length, tasks }, true)
  await json(path.join(output, 'qualification.json'), qualification, true)
  console.log(JSON.stringify({ experiment: plan.id, qualified: tasks.length, frozenDigest: digest(JSON.stringify(plan)), plannedRuns: tasks.length * plan.engines.length }))
}

async function runBatch(output, keyFile, only) {
  const plan = JSON.parse(await readFile(path.join(output, 'experiment.json'), 'utf8'))
  if (git(['rev-parse', 'HEAD']).toString().trim() !== plan.candidateCommit) throw new Error('Candidate commit differs from frozen experiment')
  for (const [file, hash] of Object.entries(plan.runnerDigests)) if (digest(await readFile(path.join(repository, 'scripts', file))) !== hash) throw new Error('Runner changed; start a new experiment')
  const rows = [], work = []
  for (const task of plan.tasks) for (const engine of plan.engines) work.push({ task, engine })
  const save = async () => { await json(path.join(output, 'runs.json'), rows); await json(path.join(output, 'score.json'), scoreNativeCodingEvaluation(plan.tasks, rows, JSON.parse(await readFile(path.join(output, 'qualification.json'), 'utf8')).results)) }
  for (const item of work) { try { rows.push(JSON.parse(await readFile(path.join(output, `${item.task.id}-${item.engine}`, 'row.json'), 'utf8'))) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  let index = 0, queue = Promise.resolve(), stopDispatch = false
  const stop = () => { stopDispatch = true; console.log(JSON.stringify({ event: 'dispatch_stopping', activeTrialsWillFinish: true })) }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const selected = work.filter(item => (!only.length || only.includes(item.task.id)) && !rows.some(row => row.taskId === item.task.id && row.engine === item.engine))
  await Promise.all(Array.from({ length: plan.concurrency }, async () => {
    while (index < selected.length && !stopDispatch) {
      const { task, engine } = selected[index++], directory = path.join(output, `${task.id}-${engine}`), trialOutput = path.join(directory, 'execution'), started = Date.now()
      try {
        const baseline = await prepare(task, directory)
        const input = { id: task.id, engine, repository: baseline, output: trialOutput, prompt: task.prompt, testCommand: 'corepack pnpm exec vitest run', ...plan.limits, opencodeBinary: plan.opencodeBinary }
        const inputFile = path.join(directory, 'input.json'); await json(inputFile, input, true)
        console.log(JSON.stringify({ event: 'start', task: task.id, engine }))
        const execution = await runProcess(corepack, ['pnpm', 'exec', 'tsx', 'scripts/native-coding-trial-live.mts', inputFile, keyFile], repository, path.join(directory, 'execution.log'), plan.limits.maxActiveMilliseconds + 600000)
        let trial; try { trial = JSON.parse(await readFile(path.join(trialOutput, 'trial.json'), 'utf8')) } catch {}
        if (!trial) throw new Error(`Trial process produced no report (exit ${execution.code}, timeout ${execution.timedOut}); inspect ledger and execution.log before any retry`)
        let deliveredWorkspace = trial.workspace
        if (deliveredWorkspace) { try { await access(path.join(deliveredWorkspace, '.git')) } catch { deliveredWorkspace = undefined } }
        if (deliveredWorkspace) await writeFile(path.join(directory, 'candidate.patch'), git(['diff', '--binary', 'HEAD'], deliveredWorkspace))
        // Failed engines may deliberately delete their managed worktree. There is
        // then no delivered patch: independently test the untouched baseline and
        // keep that reason visible, rather than losing the observation to ENOENT.
        const independent = { ...await independentCheck(task, baseline, deliveredWorkspace, directory), deliveredWorkspaceAvailable: !!deliveredWorkspace }
        await json(path.join(directory, 'independent.json'), independent, true)
        const row = { taskId: task.id, engine, trial: 1, provider: trial.provider, model: trial.model, claimedCompleted: trial.claimedCompleted, independentPassed: independent.passed, costUsd: trial.costUsd, durationMs: trial.durationMs, metrics: trial.metrics, category: task.category, split: task.split, trialStatus: trial.status, failure: trial.failure ?? null, execution, independent, artifacts: path.relative(repository, directory) }
        await json(path.join(directory, 'row.json'), row, true)
        await removeDisposableDependencies(directory)
        const update = queue.then(async () => { rows.push(row); await save() }); queue = update.catch(() => {}); await update
        console.log(JSON.stringify({ event: 'result', task: task.id, engine, status: trial.status, independentPassed: independent.passed, costUsd: trial.costUsd, elapsedMs: Date.now() - started }))
      } catch (error) {
        await mkdir(directory, { recursive: true }); await json(path.join(directory, 'runner-failure.json'), { message: error.message, at: new Date().toISOString() })
        console.log(JSON.stringify({ event: 'runner_failure', task: task.id, engine, message: error.message }))
      }
    }
  }))
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  await save()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, outputPath, keyFile, ...only] = process.argv.slice(2)
  if (!outputPath || !['freeze', 'run'].includes(command) || command === 'run' && !keyFile) throw new Error('Usage: batch-live freeze <new-output> | run <frozen-output> <private-key-file> [task-id ...]')
  const output = path.resolve(outputPath)
  if (command === 'freeze') await freeze(output); else await runBatch(output, path.resolve(keyFile), only)
}
