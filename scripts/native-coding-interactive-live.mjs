import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { createInteractiveRound, openInteractiveRound } from './native-coding-round-budget.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const [operation, roundPath, attemptOrCost, keyOrCalls, scenarioList] = args
const usage = 'Usage: node --import tsx scripts/native-coding-interactive-live.mjs init <new-round-directory> <max-cost-usd> <max-calls> | run <round-directory> <new-attempt-name> <private-key-file> [scenario,scenario]'
if (operation === 'init') {
  if (args.length !== 4 || !roundPath || !attemptOrCost || !keyOrCalls) throw new Error(usage)
  console.log(JSON.stringify(await createInteractiveRound(path.resolve(roundPath), { maxCostUsd: Number(attemptOrCost), maxCalls: Number(keyOrCalls) })))
  process.exit(0)
}
if (operation !== 'run' || args.length < 4 || args.length > 5 || !roundPath || !keyOrCalls) throw new Error(usage)
const attempt = attemptOrCost
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(attempt ?? '')) throw new Error('Invalid attempt name')
const roundRoot = path.resolve(roundPath), keyFile = path.resolve(keyOrCalls)
const output = path.join(roundRoot, 'attempts', attempt)
// Opening an existing round is mandatory; no worker or credential access precedes this gate.
const budget = await openInteractiveRound(roundRoot, `${attempt}/operator`)
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = value => createHash('sha256').update(value).digest('hex')
const baseFiles = { 'package.json': '{"type":"module","private":true}\n', 'value.js': 'export const value = 1;\n', 'value.test.js': "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.js'; test('positive integer',()=>assert.ok(Number.isInteger(value)&&value>0));\n" }
const base = { files: baseFiles, prompt: 'Change only the exported value in value.js to 7. Keep its public name. Submit the resulting change for review.', testCommand: 'node --test value.test.js' }
const configs = {
  clarification: { files: { 'package.json': baseFiles['package.json'], 'batch.js': 'export function applyBatch(state, operations) { for (const operation of operations) { if (operation.fail) throw new Error("failed"); state[operation.key] = operation.value; } return state; }\n', 'batch.test.js': "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {applyBatch} from './batch.js'; test('single valid operation',()=>assert.equal(applyBatch({},[{key:'a',value:2}]).a,2));\n" }, prompt: 'Improve applyBatch so failed operations are handled consistently. It is not decided whether one failure should roll back the entire batch or retain successful operations. Ask the user to clarify that business decision before implementing; do not guess.', testCommand: 'node --test batch.test.js' },
  steering: base,
  unknown: { ...base, holdFirstResponse: true },
  application: { ...base, holdApplication: true },
  verification: { ...base, prompt: base.prompt + ' Do not run tests in the candidate; the host runs the saved verification after approval.', testCommand: 'node -e "setTimeout(()=>process.exit(0),20000)"' },
  children: { ...base, prompt: 'You must delegate two sequential tasks. First create a read_only child to inspect value.js; tell that child to ask the user whether the desired value is 7 and report findings after receiving the answer. Wait for it. Next create an isolated_coding child restricted to value.js to implement that confirmed value, run the saved test, and submit its revision. Inspect and explicitly merge the child revision into your candidate. Submit the final change for human review. Do not implement the change yourself.' },
  child_cancel: { ...base, testCommand: 'node -e "setTimeout(()=>process.exit(0),60000)"', prompt: 'Delegate an isolated_coding child restricted to value.js. Tell it to change the value to 7, then run the saved test plan and wait for that test before submitting its revision. Await the child. Do not implement or run the test yourself.' },
  file_conflict: { files: { 'package.json': baseFiles['package.json'], 'old.js': 'export const value = 1;\n', 'app.js': "export {value} from './old.js';\n", 'obsolete.js': 'export const obsolete = true;\n', 'asset.bin': { base64: Buffer.from([0, 1, 2, 255]).toString('base64') }, 'notes.txt': 'Original notes\n', 'app.test.js': "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './app.js'; test('value positive',()=>assert.ok(value>0));\n" }, testCommand: 'node --test app.test.js', prompt: 'Migrate old.js to lib/value.js and change its exported value to 7; update app.js to use it. Delete obsolete.js. Add README.md documenting the entrypoint. Replace asset.bin with these exact binary bytes expressed as base64: AAQD/w==. Preserve notes.txt and tests. Submit all changes together.' },
  mutation: { ...base, prompt: base.prompt + ' Do not edit or run the test script in the candidate; host verification follows approval.', testCommand: 'node -e "require(\'fs\').writeFileSync(\'value.js\',\'export const value = 999;\\n\')"' },
  business: { ...base, criteria: ['The support owner must review the result in person before acceptance.'] },
  manual: { ...base, testCommand: '', prompt: 'Inspect value.js and keep value equal to 1; propose a no-change revision. This task uses an explicit manual validation plan; do not run tests.' },
}
configs.file_success = { ...configs.file_conflict }
try {
const selected = scenarioList === undefined ? new Set(Object.keys(configs)) : new Set(scenarioList.split(','))
if (!selected.size || [...selected].some(id => !Object.hasOwn(configs, id))) throw new Error('Unknown or empty interactive scenario selection')
await mkdir(path.dirname(output), { recursive: true }); await mkdir(output)
for (const [id, config] of Object.entries(configs)) {
  config.root = path.join(output, id); config.roundRoot = roundRoot; config.budgetScope = `${attempt}/${id}`
  await save(path.join(output, `${id}.json`), config)
}
await save(path.join(output, 'protocol.json'), { frozenAt: new Date().toISOString(), candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(), model: 'deepseek-flash', thinking: 'high', configDigests: Object.fromEntries(Object.entries(configs).map(([id, value]) => [id, sha(JSON.stringify(value))])),
  roundBudget: budget.limits, roundRoot, selectedScenarios: [...selected],
  operatorAnswers: { clarification: 'Use atomic rollback: if any operation fails, leave the entire state exactly as it was before this batch and throw an error.', child: 'Yes. The confirmed desired value is 7.' },
  unknownRetryAuthorization: 'One operator-authorized additional attempt after verifying no automatic replay; original unknown cost retained.', scope: 'Real model, production executor/tools/store/approval/command ownership. Direct approved fixture context, not a Team UI test. Fault injection occurs only in the isolated worker at actual response/journal/command events.' })

let commandNumber = 0
const results = [], clients = new Set()
function start(id, mode = 'new') {
  const events = [], pending = new Map(), actions = [], log = createWriteStream(path.join(output, `${id}-${mode}.log`), { flags: 'wx', mode: 0o600 })
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/native-coding-interactive-worker.mts', path.join(output, `${id}.json`), path.resolve(keyFile), mode], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  let exited = false
  const closed = new Promise(resolve => child.once('close', (code, signal) => { exited = true; for (const callback of pending.values()) callback.reject(new Error(`Worker exited (${code}/${signal})`)); pending.clear(); log.end(); resolve({ code, signal }) }))
  child.on('message', message => { if (message.event) events.push({ ...message, at: new Date().toISOString() }); else { const callback = pending.get(message.id); if (!callback) return; pending.delete(message.id); message.error ? callback.reject(new Error(message.error)) : callback.resolve(message.result) } })
  const client = { id, events, actions, child,
    async request(command) { if (exited) throw new Error('Worker already exited'); actions.push({ at: new Date().toISOString(), command }); const index = ++commandNumber; return new Promise((resolve, reject) => { pending.set(index, { resolve, reject }); child.send({ id: index, command }) }) },
    async event(name, timeout = 180000) { const end = Date.now() + timeout; while (!events.some(event => event.event === name)) { if (exited) throw new Error(`Worker exited before ${name}`); if (Date.now() > end) throw new Error(`Event timeout: ${name}`); await wait(50) }; return events.find(event => event.event === name) },
    async get(codingRunId = 'coding') { return (await client.request({ protocolVersion: 2, type: 'get', codingRunId })).snapshot },
    async command(body, codingRunId = 'coding') {
      // Refresh a racing stop request, never refresh an approval or paid retry.
      for (let attempt = 0; ; attempt++) {
        const snapshot = await client.get(codingRunId)
        try { return await client.request({ protocolVersion: 2, codingRunId, expectedVersion: snapshot.version, commandId: `operator-${++commandNumber}`, ...body }) }
        catch (error) { if (!['pause', 'cancel'].includes(body.type) || attempt >= 4 || !error.message.includes('任务已更新')) throw error }
      }
    },
    async stop(kill = false) { if (!exited) { if (kill) child.kill('SIGKILL'); else await client.request({ type: 'close' }) }; const exit = await closed; await save(path.join(output, `${id}-${mode}-operator.json`), { events, actions, exit }); clients.delete(client); return exit },
  }; clients.add(client); return client
}
async function fixture(id, mode = 'new', manualValidationPlan) {
  const client = start(id, mode); await client.event('ready')
  if (mode === 'new') await client.command({ type: 'authorize', profile: 'trusted_local', ...(manualValidationPlan ? { manualValidationPlan } : {}) })
  return client
}
async function settledView(client) { await client.request({ type: 'settled' }); return client.get() }
async function review(client, timeout = 480000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const snapshot = await settledView(client)
    // The real UI renders each child's own permission panel. Apply the same
    // frozen rejection policy there rather than leaving its parent waiting.
    for (const child of snapshot.children ?? []) {
      if (child.status !== 'waiting_permission') continue
      const view = await client.get(child.id)
      if (view.status === 'waiting_permission' && view.permission) await client.command({ type: 'permission', permissionId: view.permission.id, decision: 'rejected' }, child.id)
    }
    if (snapshot.status === 'review') return snapshot
    if (['ready', 'running', 'waiting_task'].includes(snapshot.status)) { await wait(100); continue }
    if (snapshot.status === 'waiting_permission' && snapshot.permission) { await client.command({ type: 'permission', permissionId: snapshot.permission.id, decision: 'rejected' }); continue }
    throw new Error(`Expected review; got ${snapshot.status}/${snapshot.pauseReason ?? snapshot.question?.text ?? ''}`)
  }
  throw new Error('Review timeout')
}
async function approve(client, snapshot = null, extra = {}) { const view = snapshot ?? await review(client); return client.command({ type: 'approve', revisionDigest: view.revision.digest, objectiveVersion: view.objectiveVersion, ...extra }) }
const deliveredValue = id => readFile(path.join(configs[id].root, 'delivery/value.js'), 'utf8')
async function run(id, action) {
  if (!selected.has(id)) return
  const started = Date.now(), record = { id, passed: false }; results.push(record)
  console.log(JSON.stringify({ event: 'scenario_start', id }))
  try {
    if (!budget.summary().canStartCall) {
      record.blocked = 'round_budget_exhausted'
      record.failure = 'The shared round cannot reserve another bounded request; no worker was started.'
    } else { record.evidence = await action(); record.passed = true }
  }
  catch (error) { record.failure = error.message }
  finally {
    for (const client of [...clients]) await client.stop().catch(() => client.stop(true).catch(() => {}))
    record.durationMs = Date.now() - started
    record.usage = budget.scopeUsage(configs[id].budgetScope)
    await save(path.join(output, 'results.json'), results)
    await save(path.join(output, 'round-budget.json'), { ...budget.summary(), observedAt: new Date().toISOString() })
    console.log(JSON.stringify(record))
  }
}

await run('clarification', async () => {
  const client = await fixture('clarification'), view = await settledView(client)
  assert.equal(view.status, 'waiting_input'); assert.match(view.question.text, /roll.?back|回滚|失败|failure|atomic/i)
  await client.command({ type: 'reply', questionId: view.question.id, objectiveVersion: view.objectiveVersion, text: 'Use atomic rollback: if any operation fails, leave the entire state exactly as it was before this batch and throw an error.' })
  const completed = await approve(client); assert.equal(completed.snapshot.status, 'completed')
  const check = "import assert from 'node:assert/strict';import {applyBatch} from './batch.js';const state={a:1};assert.throws(()=>applyBatch(state,[{key:'a',value:9},{fail:true}]));assert.deepEqual(state,{a:1});"
  execFileSync(process.execPath, ['--input-type=module', '-e', check], { cwd: path.join(configs.clarification.root, 'delivery') })
  return { question: view.question.text, final: completed.snapshot.status, independentAtomicRollback: true }
})
await run('steering', async () => {
  const client = await fixture('steering'); await client.event('after_tools')
  await client.command({ type: 'steer', text: 'Updated requirement: set value to 11, replacing the earlier value 7.' })
  const first = await review(client)
  await client.command({ type: 'steer', text: 'Final requirement: set value to 17 instead of 11. Submit a new revision.' })
  await assert.rejects(() => client.request({ protocolVersion: 2, codingRunId: 'coding', commandId: 'old-stale-approval', expectedVersion: first.version, type: 'approve', revisionDigest: first.revision.digest, objectiveVersion: first.objectiveVersion }))
  const final = await review(client); assert.ok(final.objectiveVersion > first.objectiveVersion)
  const approved = await approve(client, final); assert.equal(approved.snapshot.status, 'completed'); assert.match(await deliveredValue('steering'), /value\s*=\s*17/)
  return { staleApprovalRejected: true, firstObjective: first.objectiveVersion, finalObjective: final.objectiveVersion }
})
await run('unknown', async () => {
  let client = await fixture('unknown'); await client.event('model_headers'); await client.stop(true)
  const before = budget.records(configs.unknown.budgetScope).length
  client = await fixture('unknown', 'recovered')
  const view = await settledView(client); assert.equal(view.status, 'reconciling'); assert.equal(view.pauseReason, 'model_delivery_unknown')
  const after = budget.records(configs.unknown.budgetScope).length; assert.equal(after, before)
  await client.command({ type: 'retry_unknown' }); const final = await approve(client); assert.equal(final.snapshot.status, 'completed'); assert.match(await deliveredValue('unknown'), /value\s*=\s*7/)
  return { noAutomaticReplay: true, originalCalls: before, unknownAttemptsRetained: (await client.request({ type: 'dump' }))[0].attempts.some(attempt => attempt.status === 'unknown'), final: final.snapshot.status }
})
await run('application', async () => {
  let client = await fixture('application'), view = await review(client)
  const applying = approve(client, view).catch(error => ({ stopped: error.message }))
  await client.event('applying'); await client.stop(true); await applying
  client = await fixture('application', 'recovered'); const restored = await client.get(); assert.equal(restored.status, 'paused'); assert.equal(restored.pauseReason, 'delivery_restored_after_restart'); assert.match(await deliveredValue('application'), /value\s*=\s*1/)
  await client.command({ type: 'resume' }); const final = await approve(client); assert.equal(final.snapshot.status, 'completed')
  const before = await deliveredValue('application'); await client.stop(); client = await fixture('application', 'completed-restart'); assert.equal((await client.get()).status, 'completed'); assert.equal(await deliveredValue('application'), before)
  return { incompleteApplicationRestored: true, completedRestartDidNotReplay: true }
})
async function runningCommand(client, required) {
  const end = Date.now() + 180000
  while (Date.now() < end) {
    const sessions = await client.request({ type: 'dump' })
    for (const session of sessions) {
      if (!required(session)) continue
      const folder = path.join(session.binding.workspaceRoot, 'commands')
      let files = []; try { files = await readdir(folder) } catch {}
      for (const file of files.filter(file => file.endsWith('.json'))) {
        const receipt = JSON.parse(await readFile(path.join(folder, file), 'utf8'))
        if (receipt.status === 'running' && receipt.pid && (required.name !== 'verificationCommand' || receipt.cwd.includes('verify-'))) return { session, receipt }
      }
    }
    await wait(100)
  }
  throw new Error('Real command did not start')
}
await run('verification', async () => {
  let client = await fixture('verification'), view = await review(client)
  const approving = approve(client, view).catch(error => ({ stopped: error.message }))
  const active = await runningCommand(client, function verificationCommand(session) { return !session.parent })
  await client.stop(true); await approving
  const end = Date.now() + 10000
  let stopped = false
  while (Date.now() < end) { try { process.kill(active.receipt.pid, 0) } catch (error) { if (error.code === 'ESRCH') { stopped = true; break } }; await wait(100) }
  assert.equal(stopped, true)
  client = await fixture('verification', 'recovered'); const restored = await client.get(); assert.equal(restored.status, 'paused'); assert.equal(restored.pauseReason, 'delivery_restored_after_restart'); assert.match(await deliveredValue('verification'), /value\s*=\s*1/)
  return { verificationProcessPid: active.receipt.pid, oldWorkerStopped: true, deliveryRestored: true }
})
await run('children', async () => {
  let client = await fixture('children'), childQuestion
  const end = Date.now() + 240000
  while (Date.now() < end) { const sessions = await client.request({ type: 'dump' }); childQuestion = sessions.find(session => session.parent && session.question); if (childQuestion) break; await wait(200) }
  assert.ok(childQuestion, 'Delegated child did not ask its required question'); assert.match(await deliveredValue('children'), /value\s*=\s*1/)
  await client.stop(); client = await fixture('children', 'recovered')
  const parent = await client.get()
  if (parent.status === 'paused' && parent.pauseReason === 'application_shutdown') await client.command({ type: 'resume' })
  const child = await client.get(childQuestion.codingRunId); assert.equal(child.status, 'waiting_input')
  await client.command({ type: 'reply', questionId: child.question.id, objectiveVersion: child.objectiveVersion, text: 'Yes. The confirmed desired value is 7.' }, child.codingRunId)
  const final = await review(client); assert.match(await deliveredValue('children'), /value\s*=\s*1/)
  const sessions = await client.request({ type: 'dump' }); assert.ok(sessions.some(session => session.parent?.mode === 'read_only')); assert.ok(sessions.some(session => session.parent?.mode === 'isolated_coding'))
  assert.ok(sessions.find(session => !session.parent).toolReceipts.some(receipt => receipt.name === 'merge_task' && receipt.status === 'completed'))
  const approved = await approve(client, final); assert.equal(approved.snapshot.status, 'completed'); assert.match(await deliveredValue('children'), /value\s*=\s*7/)
  const quotes = budget.records(configs.children.budgetScope).map(row => row.quote)
  assert.ok(quotes.some(quote => quote.task?.parentTaskId)); assert.equal(new Set(quotes.filter(quote => quote.task).map(quote => quote.task.rootId)).size, 1)
  return { childQuestionSurvivedRestart: true, deliveryUntouchedUntilApproval: true, explicitMerge: true, sharedRootBudget: true }
})
await run('child_cancel', async () => {
  const client = await fixture('child_cancel'), active = await runningCommand(client, session => !!session.parent)
  await client.command({ type: 'cancel' }); assert.equal((await client.get()).status, 'cancelled')
  assert.throws(() => process.kill(active.receipt.pid, 0), { code: 'ESRCH' }); assert.match(await deliveredValue('child_cancel'), /value\s*=\s*1/)
  return { realChildCommandStopped: true, childWorkerPid: active.receipt.pid, rootCancelled: true }
})
await run('file_conflict', async () => {
  const client = await fixture('file_conflict'), view = await review(client)
  assert.ok(view.revision.files.some(file => file.binary)); assert.ok(view.revision.files.some(file => file.path === 'lib/value.js')); assert.ok(view.revision.files.some(file => file.path === 'obsolete.js'))
  const notes = path.join(configs.file_conflict.root, 'delivery/notes.txt'); await writeFile(notes, 'External edit must survive\n')
  await assert.rejects(() => approve(client, view)); assert.equal(await readFile(notes, 'utf8'), 'External edit must survive\n'); assert.notEqual((await client.get()).status, 'completed')
  return { binaryAndFileChangesPresented: true, externalDeliveryWritePreserved: true, oldRevisionNotDelivered: true }
})
await run('file_success', async () => {
  const client = await fixture('file_success'), final = await approve(client); assert.equal(final.snapshot.status, 'completed')
  const root = path.join(configs.file_success.root, 'delivery')
  assert.deepEqual(await readFile(path.join(root, 'asset.bin')), Buffer.from([0, 4, 3, 255])); await assert.rejects(() => readFile(path.join(root, 'old.js')), { code: 'ENOENT' }); await assert.rejects(() => readFile(path.join(root, 'obsolete.js')), { code: 'ENOENT' }); assert.match(await readFile(path.join(root, 'lib/value.js'), 'utf8'), /value\s*=\s*7/); assert.ok((await readFile(path.join(root, 'README.md'), 'utf8')).length)
  return { independentNewRenameDeleteBinaryChecks: true }
})
await run('mutation', async () => {
  const client = await fixture('mutation'), view = await review(client), approved = await approve(client, view)
  assert.notEqual(approved.snapshot.status, 'completed'); assert.ok(approved.snapshot.evidence.some(item => item.status === 'evidence_invalid')); assert.match(await deliveredValue('mutation'), /value\s*=\s*1/)
  await client.command({ type: 'cancel' })
  return { zeroExitMutationInvalidatedEvidence: true, deliveryRestored: true }
})
await run('business', async () => {
  const client = await fixture('business'), view = await review(client)
  assert.ok(view.acceptance.length > 0)
  const sessions = await client.request({ type: 'dump' }), session = sessions.find(session => !session.parent)
  const candidate = path.join(session.binding.workspaceRoot, 'candidate')
  execFileSync(process.execPath, ['--test', 'value.test.js'], { cwd: candidate })
  await assert.rejects(() => approve(client, view), /criterion|验收/i); assert.notEqual((await client.get()).status, 'completed'); assert.match(await deliveredValue('business'), /value\s*=\s*1/)
  return { candidateTestPassed: true, unconfirmedHumanCriterionBlockedApproval: true }
})
await run('manual', async () => {
  const client = await fixture('manual', 'new', 'Inspect the frozen value.js and confirm value is exactly 1. No automated test is planned.'), view = await review(client)
  await assert.rejects(() => approve(client, view), /人工|manual/i)
  assert.match(await deliveredValue('manual'), /value\s*=\s*1/)
  const final = await approve(client, view, { manualValidationEvidence: 'Operator inspected the actual value.js bytes: export const value = 1. No automated test ran.' })
  assert.equal(final.snapshot.status, 'completed'); assert.equal(final.completion.manualEvidence.status, 'manual_accepted'); assert.equal(final.completion.testEvidence, undefined)
  return { preselectedPlan: true, explicitEvidenceRequired: true, noFabricatedPassedTest: true }
})
if (results.some(result => !result.passed)) process.exitCode = 1
} finally { budget.close() }
