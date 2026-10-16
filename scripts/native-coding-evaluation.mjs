import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const engines = ['native-v2', 'native-v3', 'opencode']
const metrics = ['humanInterventions', 'inputTokens', 'outputTokens', 'peakContextTokens', 'effectiveInvestigationSteps', 'repairAttempts', 'recoveryAttempts', 'recoverySuccesses']
const digest = value => createHash('sha256').update(value).digest('hex')
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null }
function wilson(passed, count) {
  if (!count) return null
  const z = 1.96, p = passed / count, denominator = 1 + z * z / count
  const center = (p + z * z / (2 * count)) / denominator
  const margin = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

/** Scores all planned trials, including missing, failed and unpriced runs. No model calls. */
export function scoreNativeCodingEvaluation(tasks, rows, qualification = []) {
  if (!Array.isArray(tasks) || !tasks.length || new Set(tasks.map(task => task.id)).size !== tasks.length || tasks.some(task => typeof task.id !== 'string' || !task.id)) throw new Error('Invalid task set')
  const ids = new Set(tasks.map(task => task.id)), keys = new Set()
  for (const row of rows) {
    const key = `${row.taskId}/${row.engine}/${row.trial ?? 1}`
    if (!ids.has(row.taskId) || !engines.includes(row.engine) || keys.has(key) || !Number.isInteger(row.trial ?? 1) || (row.trial ?? 1) < 1 || typeof row.claimedCompleted !== 'boolean' || typeof row.independentPassed !== 'boolean' || !Number.isFinite(row.durationMs) || row.durationMs < 0 || (row.costUsd !== null && (!Number.isFinite(row.costUsd) || row.costUsd < 0)) || typeof row.model !== 'string' || !row.model || typeof row.provider !== 'string' || !row.provider) throw new Error('Invalid, duplicate or foreign evaluation row')
    if (row.metrics && metrics.some(key => row.metrics[key] !== undefined && row.metrics[key] !== null && (!Number.isSafeInteger(row.metrics[key]) || row.metrics[key] < 0))) throw new Error('Invalid evaluation metric')
    keys.add(key)
  }
  const trials = Math.max(1, ...rows.map(row => row.trial ?? 1)), expected = tasks.length * trials
  const byEngine = Object.fromEntries(engines.map(engine => {
    const selected = rows.filter(row => row.engine === engine), passed = selected.filter(row => row.independentPassed).length
    return [engine, {
      expected, observed: selected.length, missing: expected - selected.length,
      independentlyPassed: passed, passRate: selected.length === expected ? passed / expected : null, observedPassRate: selected.length ? passed / selected.length : null, observedPassRate95: wilson(passed, selected.length),
      falseSuccess: selected.filter(row => row.claimedCompleted && !row.independentPassed).length,
      unknownCosts: selected.filter(row => row.costUsd === null).length,
      knownCostSubtotalUsd: selected.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
      totalCostUsd: selected.length === expected && selected.every(row => row.costUsd !== null) ? selected.reduce((sum, row) => sum + row.costUsd, 0) : null,
      medianDurationMs: median(selected.map(row => row.durationMs)),
      modelCombinations: [...new Set(selected.map(row => `${row.provider}/${row.model}`))],
      metrics: Object.fromEntries(metrics.map(key => { const values = selected.map(row => row.metrics?.[key]).filter(Number.isSafeInteger); return [key, { observed: values.length, missing: expected - values.length, total: values.length === expected ? values.reduce((sum, value) => sum + value, 0) : null, median: median(values) }] })),
    }]
  }))
  const paired = { v3OnlyPassed: 0, v2OnlyPassed: 0, bothPassed: 0, neitherPassed: 0, missingPairs: 0, incompatibleModels: 0 }
  for (const task of tasks) for (let trial = 1; trial <= trials; trial += 1) {
    const select = engine => rows.find(row => row.taskId === task.id && row.engine === engine && (row.trial ?? 1) === trial)
    const a = select('native-v2'), b = select('native-v3')
    if (!a || !b) { paired.missingPairs++; continue }
    if (a.model !== b.model || a.provider !== b.provider) { paired.incompatibleModels++; continue }
    if (a.independentPassed && b.independentPassed) paired.bothPassed++
    else if (b.independentPassed) paired.v3OnlyPassed++
    else if (a.independentPassed) paired.v2OnlyPassed++
    else paired.neitherPassed++
  }
  const qualified = tasks.filter(task => qualification.some(row => row.taskId === task.id && row.baseSha === task.baseSha && row.referenceSha === task.referenceSha && row.qualified === true)).length
  return {
    schemaVersion: 1, taskCount: tasks.length, trials, qualifiedTasks: qualified,
    complete: engines.every(engine => byEngine[engine].missing === 0), engines: byEngine, paired,
    // This report cannot establish authorization, platform/endpoint compatibility,
    // or provenance of independently supplied rows; never promote it to a release.
    releaseReady: false,
    releaseReviewRequired: ['verified run artifacts and approved budget', 'predeclared quality/cost/time gates', 'real endpoint and cross-platform evidence', 'coverage and statistical review'],
  }
}

function taskManifest(value) {
  if (value.schemaVersion !== 1 || !Array.isArray(value.tasks) || value.taskCount !== value.tasks.length || new Set(value.tasks.map(task => task.id)).size !== value.tasks.length) throw new Error('Invalid manifest')
  for (const task of value.tasks) {
    if (!/^[a-z0-9-]+$/u.test(task.id) || ![task.baseSha, task.referenceSha].every(sha => /^[a-f0-9]{40}$/u.test(sha)) || !Array.isArray(task.acceptanceTests) || !task.acceptanceTests.length || task.acceptanceTests.some(file => !/^(apps|packages|scripts|tests)\/[a-zA-Z0-9._/-]+\.(test|spec)\.tsx?$/u.test(file) || file.split('/').includes('..'))) throw new Error('Invalid task or acceptance path')
  }
  return value
}
// Do not pass API keys or other ambient credentials to historical test code.
const testEnvironment = () => ({ ...Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'PNPM_HOME', 'COREPACK_HOME'].filter(key => process.env[key]).map(key => [key, process.env[key]])), CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', ELECTRON_SKIP_BINARY_DOWNLOAD: '1' })
function run(command, args, cwd, log, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(log, { flags: 'wx' })
    const child = spawn(command, args, { cwd, env: testEnvironment(), shell: process.platform === 'win32' && command.endsWith('.cmd'), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already stopped */ } }
    }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); output.end(); reject(error) })
    child.once('close', code => { clearTimeout(timer); output.end(() => resolve({ code, timedOut })) })
  })
}
async function checked(command, args, cwd, log) {
  const result = await run(command, args, cwd, log)
  if (result.code !== 0 || result.timedOut) throw new Error(`Preparation failed; see ${log}`)
}
async function qualifyTask(repository, task, output, manifestDigest) {
  const directory = path.join(output, task.id)
  try {
    const previous = JSON.parse(await readFile(path.join(directory, 'qualification.json'), 'utf8'))
    if (previous.manifestDigest !== manifestDigest || previous.baseSha !== task.baseSha || previous.referenceSha !== task.referenceSha) throw new Error('Existing qualification belongs to a different manifest')
    return previous
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(directory, { recursive: true })
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'native-v3-qualification-')), corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const observations = {}
  try {
    if (task.acceptanceTests.some(file => file.endsWith('.spec.ts'))) throw new Error('This task also requires Playwright acceptance; Vitest alone cannot qualify it')
    for (const [name, sha] of [['baseline', task.baseSha], ['reference', task.referenceSha]]) {
      const checkout = path.join(scratch, name), archive = path.join(scratch, `${name}.tar`)
      await mkdir(checkout)
      await checked('git', ['archive', '--format=tar', `--output=${archive}`, sha], repository, path.join(directory, `${name}-archive.log`))
      await checked('tar', ['-xf', archive, '-C', checkout], repository, path.join(directory, `${name}-extract.log`))
      // Exact reference tests live in the private evaluator, never in the agent input.
      for (const [index, file] of task.acceptanceTests.entries()) {
        const source = path.join(directory, `${name}-acceptance-${index}.source`)
        await checked('git', ['show', `${task.referenceSha}:${file}`], repository, source)
        await mkdir(path.dirname(path.join(checkout, file)), { recursive: true })
        await writeFile(path.join(checkout, file), await readFile(source))
      }
      await checked(corepack, ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], checkout, path.join(directory, `${name}-install.log`))
      const resultFile = path.join(directory, `${name}-tests.json`)
      const result = await run(corepack, ['pnpm', 'exec', 'vitest', 'run', ...task.acceptanceTests, '--reporter=json', '--outputFile', resultFile], checkout, path.join(directory, `${name}-tests.log`))
      let report
      try { report = JSON.parse(await readFile(resultFile, 'utf8')) } catch { report = null }
      observations[name] = { ...result, reportDigest: report ? digest(JSON.stringify(report)) : null, passed: report?.numPassedTests ?? 0, failed: report?.numFailedTests ?? 0, total: report?.numTotalTests ?? 0, unhandledErrors: report?.numUnhandledErrors ?? 0 }
    }
  } catch (error) { observations.error = error.message }
  finally { await rm(scratch, { recursive: true, force: true }) }
  const { baseline: b, reference: r } = observations
  const qualified = !!(b && r && !b.timedOut && b.code !== 0 && b.failed > 0 && !b.unhandledErrors && !r.timedOut && r.code === 0 && r.total > 0 && r.passed === r.total && !r.failed && !r.unhandledErrors)
  const result = { taskId: task.id, baseSha: task.baseSha, referenceSha: task.referenceSha, manifestDigest, qualified, observations, createdAt: new Date().toISOString(), platform: process.platform }
  await writeFile(path.join(directory, 'qualification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  return result
}

async function cli() {
  const [command, manifestPath, ...args] = process.argv.slice(2)
  if (!['qualify', 'score'].includes(command) || !manifestPath) throw new Error('Usage: node scripts/native-coding-evaluation.mjs qualify <manifest.json> <new-output-dir> [task-id ...] | score <manifest.json> <runs.json> <qualification.json> <new-report.json>')
  const raw = await readFile(manifestPath), manifest = taskManifest(JSON.parse(raw)), manifestDigest = digest(raw)
  if (command === 'qualify') {
    const [outputPath, ...only] = args
    if (!outputPath || only.some(id => !manifest.tasks.some(task => task.id === id))) throw new Error('Invalid output or task selection')
    const output = path.resolve(outputPath), repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), results = []
    await mkdir(output, { recursive: true })
    for (const task of manifest.tasks.filter(task => !only.length || only.includes(task.id))) {
      const result = await qualifyTask(repository, task, output, manifestDigest)
      results.push(result)
      process.stdout.write(`${task.id}: ${result.qualified ? 'qualified' : 'unqualified'}\n`)
      await writeFile(path.join(output, 'qualification.json'), JSON.stringify({ schemaVersion: 1, manifestDigest, taskCount: manifest.tasks.length, selected: results.length, qualified: results.filter(row => row.qualified).length, results }, null, 2) + '\n')
    }
  } else {
    const [rowsPath, qualificationPath, reportPath] = args
    if (!rowsPath || !qualificationPath || !reportPath) throw new Error('Score requires rows, qualification and a new report path')
    const rows = JSON.parse(await readFile(rowsPath, 'utf8')), qualification = JSON.parse(await readFile(qualificationPath, 'utf8'))
    if (qualification.manifestDigest !== manifestDigest) throw new Error('Qualification manifest mismatch')
    const report = { manifestDigest, ...scoreNativeCodingEvaluation(manifest.tasks, rows, qualification.results) }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write(`${rows.length} observations; complete=${report.complete}; releaseReady=false\n`)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
