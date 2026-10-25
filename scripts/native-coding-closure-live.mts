/** Explicit #239 acceptance. Continues the original sealed RMB 10 budget; never used by the application. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { continueCnyEvaluationRound, openInteractiveRound } from './native-coding-round-budget.ts'
import { digest, saveJson } from './native-coding-live-support.ts'
import { focusedFixtures } from './native-coding-focused-fixtures.ts'
import { judgeFixture, qualifyFixtures } from './native-coding-focused-live.mts'
import { runLiveTrial } from './native-coding-trial-live.mts'
import { createGovernedOpencodeProxy } from '../apps/desktop/electron/governed-opencode-proxy.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const scopes = {
  'closure/legacy': { projectId: 'evaluation-project', providerId: 'deepseek-evaluation', maxCalls: 24 },
  'closure/fixed': { projectId: 'evaluation-project', providerId: 'deepseek-evaluation', maxCalls: 24 },
  'closure/electron': { projectId: 'closure-electron', providerId: 'deepseek-evaluation', maxCalls: 24 },
}
export const closureElectronPrompt = 'Change src/message.js from old to new. Before editing, call request_user_input to confirm the target with the user and wait for the answer. Preserve the existing double quotes and trailing newline. Read the source, edit only that file, run the saved test plan and wait for its actual result, then propose_changeset. No child tasks or network access are needed.'
const fixture = focusedFixtures.find(item => item.id === 'recovery')!
const fixtureHash = () => digest(JSON.stringify(fixture))
async function assertProtocol(root: string) {
  if (git('status', '--porcelain')) throw new Error('Paid acceptance requires the frozen clean implementation')
  const protocol = JSON.parse(await readFile(path.join(root, 'protocol.json'), 'utf8'))
  if (protocol.candidateCommit !== git('rev-parse', 'HEAD') || protocol.fixtureHash !== fixtureHash() || protocol.electronPrompt !== closureElectronPrompt || protocol.maxActiveMilliseconds !== 300000 || protocol.maxOutputTokens !== 8192 || protocol.model !== 'deepseek-flash' || protocol.thinking !== 'high' || JSON.stringify(protocol.scopes) !== JSON.stringify(scopes)) throw new Error('Closure protocol changed')
  process.env.DEVFLOW_NATIVE_EVALUATION_ROUND = path.resolve(root)
  return protocol
}
async function freeze(root: string, parentRoot: string) {
  if (git('status', '--porcelain')) throw new Error('Commit implementation before freezing the closure protocol')
  const round = await continueCnyEvaluationRound(root, { parentRoot, maxCalls: 72, maxOutputTokens: 8192, scopes })
  const qualification = await qualifyFixtures(path.join(root, 'qualification'))
  const protocol = { version: 1, roundId: round.roundId, candidateCommit: git('rev-parse', 'HEAD'), fixtureHash: fixtureHash(), qualification,
    model: 'deepseek-flash', thinking: 'high', maxOutputTokens: 8192, scopes, order: ['legacy', 'fixed', 'electron'],
    electronPrompt: closureElectronPrompt, maxActiveMilliseconds: 300000, electronWatchdogMilliseconds: 480000,
    interpretation: 'One real coding layout comparison plus real Electron coding acceptance; not a whole old release comparison, statistical cache guarantee or Native v3 release gate. Prior failed controls and unknown reservations remain unchanged.',
    continuation: round.cny!.continuation }
  await writeFile(path.join(root, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return protocol
}
async function claimPhase(root: string, phase: string) {
  const directory = path.join(root, phase)
  await mkdir(directory) // No automatic retry or overwrite of a partially billed attempt.
  await saveJson(path.join(directory, 'phase.json'), { state: 'started', at: new Date().toISOString() })
  return directory
}
async function runPairs(root: string, keyFile: string) {
  const protocol = await assertProtocol(root)
  const apiKey = (await readFile(keyFile, 'utf8')).trim()
  for (const layout of ['legacy', 'fixed'] as const) {
    const ledger = await openInteractiveRound(root, `closure/${layout}`)
    try { if (!ledger.summary().canStartCall || ledger.summary().unknownCosts) throw new Error('Remaining authorization cannot admit this phase') } finally { ledger.close() }
    const directory = await claimPhase(root, layout), source = path.join(directory, 'source'), output = path.join(directory, 'run')
    let result: Record<string, unknown> = { passed: false }
    try {
      for (const [file, content] of Object.entries(fixture.files)) { await mkdir(path.dirname(path.join(source, file)), { recursive: true }); await writeFile(path.join(source, file), content) }
      for (const args of [['init', '-b', 'fixture'], ['add', '.'], ['-c', 'user.name=DevFlow Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Frozen synthetic fixture']]) execFileSync('git', args, { cwd: source, stdio: 'ignore' })
      await runLiveTrial({ id: `closure-${layout}`, requestLayout: layout, engine: 'native-v3', repository: source, output, prompt: fixture.prompt,
        testCommand: fixture.testCommand, maxCalls: 24, maxCostUsd: 1.5, maxSteps: 24, maxActiveMilliseconds: protocol.maxActiveMilliseconds, maxOutputTokens: 8192,
        opencodeBinary: '', roundRoot: root, scopeId: `closure/${layout}` }, apiKey)
      const trial = JSON.parse(await readFile(path.join(output, 'trial.json'), 'utf8'))
      const acceptance = trial.workspace ? await judgeFixture(fixture, trial.workspace, path.join(directory, 'independent')) : { passed: false }
      result = { passed: trial.claimedCompleted && acceptance.passed, claimedCompleted: trial.claimedCompleted, status: trial.status, failure: trial.failure, acceptance }
    } catch (error) { result.error = String(error).replaceAll(apiKey, '[redacted]') }
    finally { await saveJson(path.join(directory, 'phase.json'), { state: 'completed', result }) }
    console.log(JSON.stringify({ phase: layout, ...result }))
  }
}
/** Real credentials remain in this external test gateway; Electron receives only a synthetic credential. */
export async function createClosureRelay(root: string, keyFile: string) {
  await assertProtocol(root)
  const directory = await claimPhase(root, 'electron'), ledger = await openInteractiveRound(root, 'closure/electron')
  if (!ledger.summary().canStartCall || ledger.summary().unknownCosts) { ledger.close(); throw new Error('Cannot admit Electron within the remaining authorization') }
  const apiKey = (await readFile(keyFile, 'utf8')).trim()
  let sequence = 0, inFlight = false, finished = false
  const relay = await createGovernedOpencodeProxy({ binding: { providerId: 'deepseek-evaluation', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey, fingerprint: 'closure-electron-deepseek-flash-high' },
    projectId: 'closure-electron', governance: ledger, maxOutputTokens: 8192,
    fetcher: async (url, init) => {
      await writeFile(path.join(directory, `wire-${++sequence}.json`), String(init?.body), { flag: 'wx', mode: 0o600 })
      const response = await fetch(url, { ...init, redirect: 'error' })
      if ([401, 402].includes(response.status)) await ledger.seal()
      return response
    } })
  return { directory,
    async complete(body: unknown) {
      if (inFlight || finished) throw new Error('Closure permits only serial paid requests')
      inFlight = true
      try {
        const response = await fetch(`${relay.binding.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${relay.binding.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' })
        return { status: response.status, type: response.headers.get('content-type') ?? 'application/json', body: await response.text() }
      } finally { inFlight = false }
    },
    async finish(passed: boolean, evidence: unknown) {
      if (finished) return
      finished = true
      try { await relay.close() } finally {
        await saveJson(path.join(directory, 'phase.json'), { state: 'completed', result: { passed, evidence }, usage: ledger.scopeUsage(), rows: ledger.records(), summary: ledger.summary() })
        ledger.close()
      }
    },
  }
}
export async function checkClosure(root: string) {
  const results = await Promise.all(['legacy', 'fixed', 'electron'].map(async phase => ({ phase, ...JSON.parse(await readFile(path.join(root, phase, 'phase.json'), 'utf8')) })))
  const ledger = await openInteractiveRound(root, 'closure/electron')
  try {
    const summary = ledger.summary()
    await saveJson(path.join(root, 'summary.json'), { results, summary })
    if (results.some(item => item.state !== 'completed' || item.result?.passed !== true) || summary.unknownCosts || !summary.authorization || summary.authorization.accountedCny > 10) throw new Error('Closure acceptance failed or incomplete; preserve the billed evidence')
    return summary
  } finally { ledger.close() }
}
async function main() {
  const [command, root, argument] = process.argv.slice(2)
  if (!root) throw new Error('Usage: freeze ROOT PARENT | pair ROOT KEYFILE | check ROOT | seal ROOT')
  if (command === 'freeze' && argument) console.log(JSON.stringify(await freeze(path.resolve(root), path.resolve(argument))))
  else if (command === 'pair' && argument) await runPairs(path.resolve(root), argument)
  else if (command === 'check') console.log(JSON.stringify(await checkClosure(path.resolve(root))))
  else if (command === 'seal') { const ledger = await openInteractiveRound(root, 'closure/electron'); try { await ledger.seal(); console.log(JSON.stringify(ledger.summary())) } finally { ledger.close() } }
  else throw new Error('Unknown closure command')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
