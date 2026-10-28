/** Explicit, isolated RMB 10 development acceptance. Never imported by the application. */
import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, copyFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { focusedFixtures, type FocusedFixture } from './native-coding-focused-fixtures.ts'
import { createCnyEvaluationRound, openInteractiveRound, type EvaluationScope } from './native-coding-round-budget.ts'
import { digest, saveJson } from './native-coding-live-support.ts'
import { runLiveTrial } from './native-coding-trial-live.mts'
import { runCacheProbe } from './native-coding-cache-probe.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
export const focusedScopes: Record<string, EvaluationScope> = {}
const add = (id: string, projectId: string, providerId: string, maxCalls: number) => { focusedScopes[id] = { projectId, providerId, maxCalls } }
for (const attempt of ['round', 'core', 'fault']) add(`${attempt}/operator`, 'interactive', 'deepseek-interactive', 0)
for (const id of ['legacy_a', 'fixed_a', 'fixed_b', 'legacy_b']) add(`cache/${id}`, 'cache-probe', 'deepseek-evaluation', 4)
for (const id of ['recovery', 'deep']) add(`coding/${id}`, 'evaluation-project', 'deepseek-evaluation', 24)
add('retry/recovery', 'evaluation-project', 'deepseek-evaluation', 24)
for (const [id, calls] of Object.entries({ clarification: 16, steering: 16, application: 16, verification: 12, children: 40, mutation: 8, business: 10, file_success: 16, file_conflict: 16, manual: 8 })) add(`core/${id}`, 'interactive', 'deepseek-interactive', calls)
add('fault/unknown', 'interactive', 'deepseek-interactive', 12)
add('fault/child_cancel', 'interactive', 'deepseek-interactive', 20)
const fixtureHash = () => digest(JSON.stringify(focusedFixtures))
const cacheOrder = ['legacy_a', 'fixed_a', 'fixed_b', 'legacy_b']

/** Offline quality result: completing the driver must not hide a failed/blocked control. */
export async function assertFocusedOutcomes(root: string) {
  const expected = [...cacheOrder.map(id => `cache-${id}`), ...focusedFixtures.map(fixture => `coding-${fixture.id}`), 'interactive-core', 'interactive-fault']
  const failures: string[] = []
  for (const id of expected) {
    const phase = JSON.parse(await readFile(path.join(root, 'phases', `${id}.json`), 'utf8'))
    if (phase.state !== 'completed' || phase.result?.passed !== true) failures.push(id)
  }
  if (failures.length) throw new Error(`Focused validation did not fully pass: ${failures.join(', ')}. Preserve evidence; do not automatically rerun paid phases.`)
}

async function files(root: string, entries: Record<string, string>) {
  for (const [file, text] of Object.entries(entries)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text) }
}
function independent(root: string) {
  try { return { passed: true, output: execFileSync(process.execPath, ['--test', 'independent.test.js'], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }) } }
  catch (error) { const e = error as { stdout?: string; stderr?: string }; return { passed: false, output: String(e.stdout ?? '') + String(e.stderr ?? '') } }
}
export async function qualifyFixtures(root: string) {
  await mkdir(root)
  const results = []
  for (const fixture of focusedFixtures) {
    const before = path.join(root, fixture.id, 'before'), after = path.join(root, fixture.id, 'reference')
    await files(before, { ...fixture.files, 'independent.test.js': fixture.independent })
    await files(after, { ...fixture.files, ...fixture.referenceFiles, 'independent.test.js': fixture.independent })
    const baseline = independent(before), reference = independent(after)
    results.push({ id: fixture.id, fixtureHash: digest(JSON.stringify(fixture)), baseline, reference, passed: !baseline.passed && reference.passed })
  }
  await saveJson(path.join(root, 'qualification.json'), results)
  if (results.some(result => !result.passed)) throw new Error('Fixture qualification failed; no paid calls are permitted')
  return results
}
async function copySource(source: string, target: string) {
  await mkdir(target)
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if ((await lstat(from)).isSymbolicLink()) throw new Error('Independent fixture evaluation refuses symlinks')
    if (entry.isDirectory()) await copySource(from, to)
    else if (entry.isFile()) await copyFile(from, to)
    else throw new Error('Unexpected fixture file type')
  }
}
export async function judgeFixture(fixture: FocusedFixture, workspace: string, target: string) {
  await copySource(workspace, target)
  const protectedFiles = Object.keys(fixture.files).filter(file => file === 'package.json' || file.endsWith('.test.js'))
  const protectedUnchanged = (await Promise.all(protectedFiles.map(async file => (await readFile(path.join(target, file), 'utf8')) === fixture.files[file]))).every(Boolean)
  // Restore evaluator-owned configuration/tests. Model-authored tests never determine acceptance.
  await files(target, Object.fromEntries(protectedFiles.map(file => [file, fixture.files[file]!])))
  await writeFile(path.join(target, 'independent.test.js'), fixture.independent)
  const result = independent(target)
  return { ...result, protectedUnchanged, passed: protectedUnchanged && result.passed }
}
async function coding(root: string, fixture: FocusedFixture, apiKey: string, attempt = 'coding') {
  const parent = path.join(root, `${attempt}-${fixture.id}`), source = path.join(parent, 'source'), output = path.join(parent, 'run')
  await mkdir(parent); await files(source, fixture.files)
  for (const args of [['init', '-b', 'fixture'], ['add', '.'], ['-c', 'user.name=DevFlow Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Frozen synthetic fixture']]) execFileSync('git', args, { cwd: source, stdio: 'ignore' })
  await runLiveTrial({ id: `${attempt}-${fixture.id}`, engine: 'native-v3', repository: source, output, prompt: fixture.prompt, testCommand: fixture.testCommand,
    maxCalls: 24, maxCostUsd: 1.5, maxSteps: 24, maxActiveMilliseconds: 300000, maxOutputTokens: 16384, opencodeBinary: '', roundRoot: root, scopeId: `${attempt}/${fixture.id}` }, apiKey)
  const trial = JSON.parse(await readFile(path.join(output, 'trial.json'), 'utf8'))
  const acceptance = trial.workspace ? await judgeFixture(fixture, trial.workspace, path.join(parent, 'independent')) : { passed: false, failure: 'No delivered workspace' }
  const result = { id: fixture.id, claimedCompleted: trial.claimedCompleted, status: trial.status, acceptance, falseSuccess: trial.claimedCompleted && !acceptance.passed,
    passed: trial.claimedCompleted && acceptance.passed, provenance: fixture.provenance }
  await saveJson(path.join(parent, 'acceptance.json'), result)
  return result
}
async function interactive(root: string, attempt: 'core' | 'fault', keyFile: string) {
  const selection = Object.keys(focusedScopes).filter(id => id.startsWith(`${attempt}/`) && !id.endsWith('/operator')).map(id => id.split('/')[1]).join(',')
  const log = createWriteStream(path.join(root, `${attempt}.log`), { flags: 'wx', mode: 0o600 })
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/native-coding-interactive-live.mjs', 'run', root, attempt, keyFile, selection], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false }); child.stdout.pipe(process.stdout)
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }); log.end()
  const results: Array<{ passed: boolean }> = JSON.parse(await readFile(path.join(root, 'attempts', attempt, 'results.json'), 'utf8'))
  return { passed: exit === 0 && results.length === selection.split(',').length && results.every(row => row.passed), exit, results }
}
async function freeze(root: string) {
  if (git('status', '--porcelain')) throw new Error('Commit implementation before freezing the paid protocol')
  const round = await createCnyEvaluationRound(root, { maxCostCny: 10, maxCalls: 200, maxOutputTokens: 16384, scopes: focusedScopes })
  const qualification = await qualifyFixtures(path.join(root, 'qualification'))
  const protocol = { version: 1, roundId: round.roundId, candidateCommit: git('rev-parse', 'HEAD'), fixtureHash: fixtureHash(), model: 'deepseek-flash', thinking: 'high', maxOutputTokens: 16384,
    maxCalls: 200, scopes: focusedScopes, qualification, cacheOrder,
    softCostTargetsCny: { cache: 1, interactive: 2, coding: 3, retry: 1, reserve: 3 },
    scope: 'Focused Native v3 development acceptance, not the historical 31 tasks x 3 executors quality gate. Unknown calls retain full-context reservations. No automatic rerun of partial phases.' }
  await writeFile(path.join(root, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { roundId: round.roundId, candidateCommit: protocol.candidateCommit, fixtureHash: protocol.fixtureHash }
}
async function run(root: string, keyFile: string) {
  process.env.DEVFLOW_NATIVE_EVALUATION_ROUND = root
  const budget = await openInteractiveRound(root, 'round/operator')
  try {
    const protocol = JSON.parse(await readFile(path.join(root, 'protocol.json'), 'utf8'))
    if (protocol.roundId !== budget.limits.roundId || protocol.candidateCommit !== git('rev-parse', 'HEAD') || git('status', '--porcelain') || protocol.fixtureHash !== fixtureHash() || JSON.stringify(protocol.scopes) !== JSON.stringify(focusedScopes) || JSON.stringify(protocol.cacheOrder) !== JSON.stringify(cacheOrder)) throw new Error('Frozen protocol or source changed; do not start paid calls')
    const apiKey = (await readFile(keyFile, 'utf8')).trim()
    if (!apiKey || !budget.summary().canStartCall) throw new Error('Missing credential or round cannot admit a call')
    const balance = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    const available = balance.ok && (await balance.json() as { is_available?: boolean }).is_available === true
    await saveJson(path.join(root, 'availability.json'), { at: new Date().toISOString(), available, httpStatus: balance.status })
    if (!available) { await budget.seal(); throw new Error('Provider unavailable; round closed before paid calls') }
    await mkdir(path.join(root, 'phases'), { recursive: true })
    async function phase(id: string, action: () => Promise<unknown>) {
      const file = path.join(root, 'phases', `${id}.json`)
      try { const previous = JSON.parse(await readFile(file, 'utf8')); if (previous.state === 'completed' || previous.state === 'blocked') return; throw new Error(`Phase ${id} was interrupted; no automatic paid replay`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (!budget.summary().canStartCall) { await saveJson(file, { state: 'blocked', reason: 'Shared round cannot reserve another bounded call', budget: budget.summary() }); return }
      await writeFile(file, JSON.stringify({ state: 'running', startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
      console.log(JSON.stringify({ event: 'phase_start', id, budget: budget.summary() }))
      try { const result = await action(); await saveJson(file, { state: 'completed', result, budget: budget.summary() }) }
      catch (error) { await saveJson(file, { state: 'failed', failure: String(error).replaceAll(apiKey, '[redacted]'), budget: budget.summary() }); throw error }
      console.log(JSON.stringify({ event: 'phase_end', id, budget: budget.summary() }))
    }
    for (const id of protocol.cacheOrder as string[]) await phase(`cache-${id}`, () => runCacheProbe({ root, output: path.join(root, `cache-${id}`), scope: `cache/${id}`, layout: id.startsWith('legacy') ? 'legacy' : 'fixed', pair: `${budget.limits.roundId}-${id.endsWith('a') ? 'a' : 'b'}` }, apiKey))
    for (const fixture of focusedFixtures) await phase(`coding-${fixture.id}`, () => coding(root, fixture, apiKey))
    await phase('interactive-core', () => interactive(root, 'core', keyFile))
    await phase('interactive-fault', () => interactive(root, 'fault', keyFile))
    await assertFocusedOutcomes(root)
  } finally { await saveJson(path.join(root, 'summary.json'), budget.summary()); budget.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, directory, keyFile] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: focused-live qualify|freeze|run|check|status|close <directory> [private-key-file]')
  const root = path.resolve(directory)
  if (operation === 'qualify') console.log(JSON.stringify(await qualifyFixtures(root)))
  else if (operation === 'freeze') console.log(JSON.stringify(await freeze(root)))
  else if (operation === 'run' && keyFile) await run(root, path.resolve(keyFile))
  else if (operation === 'check') { await assertFocusedOutcomes(root); console.log('All frozen focused phases passed') }
  else if (operation === 'status' || operation === 'close') {
    const budget = await openInteractiveRound(root, 'round/operator')
    try { if (operation === 'close') await budget.seal(); console.log(JSON.stringify(budget.summary())); await saveJson(path.join(root, 'summary.json'), budget.summary()) } finally { budget.close() }
  } else throw new Error('Unknown operation or missing private key file')
}
