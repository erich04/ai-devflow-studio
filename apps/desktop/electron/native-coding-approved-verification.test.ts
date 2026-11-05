// @vitest-environment node
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { codingDigest, CodingCandidateWorkspace } from './coding-candidate-workspace'
import { freezeApprovedCodingTests, runApprovedCodingVerification, validateApprovedCodingTests } from './native-coding-approved-verification'
import { mutateNativeCodingSession } from './native-coding-session'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import { CodingCommandRunner } from './coding-command-runner'
import * as dependencies from './coding-dependency-preparation'

const fixtures: Awaited<ReturnType<typeof codingHarnessFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})
const original = 'export const value = 1\n'
const fixed = 'export const value = 2\n'
const publicTest = "import { it, expect } from 'vitest'; import { value } from './value'; it('public positive value', () => expect(value).toBeGreaterThan(0))"
const approvedTest = "import { it, expect } from 'vitest'; import { value } from './value'; it('approved value must be two', () => expect(value).toBe(2))"
const approvedTests = () => freezeApprovedCodingTests({ sourceRef: 'user-approved:value-2', expectedTests: 1, files: [{ path: 'value.test.ts', content: approvedTest }] })
const baselineFiles = {
  'package.json': '{"private":true,"type":"module","packageManager":"pnpm@9.15.0","devDependencies":{"vitest":"3.2.6"}}',
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'vitest.config.mjs': "export default {test:{environment:'node',include:['*.test.ts']}}",
  'value.test.ts': publicTest,
}
function provisionFramework() {
  return vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async input => {
    await symlink(path.resolve('node_modules'), path.join(input.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    return { inputDigest: input.plan.inputDigest }
  })
}
async function approve(fixture: Awaited<ReturnType<typeof codingHarnessFixture>>, commandId: string) {
  const view = await fixture.get()
  expect(view.snapshot.status).toBe('review')
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId,
    expectedVersion: view.snapshot.version, objectiveVersion: view.snapshot.objectiveVersion, revisionDigest: view.snapshot.revision!.digest, confirmedCriteria: [] }, async () => {})
  await fixture.executor.settled('coding')
}

it('repairs after more than three fixed failures and verifies the same contract after restart before delivery', async () => {
  provisionFramework()
  let turn = 0
  const author = vi.fn(async () => { throw new Error('A fixed contract needs no generated author') })
  const fixture = await codingHarnessFixture(async request => {
    turn++
    if (turn === 1) expect(request.messages.some(message => String(message.content).includes(approvedTest))).toBe(false)
    if (turn === 5) {
      expect(JSON.stringify(request.messages)).toContain('approved value must be two')
      expect(JSON.stringify(request.messages)).toContain('expected 1 to be 2')
      expect(JSON.stringify(request.messages)).toContain('expect(value).toBe(2)')
      expect(JSON.stringify(request.messages)).toContain('sourceExcerpt')
      return codingToolReply('repair', 'write_file', { path: 'value.ts', content: fixed, expectedHash: codingDigest(original) })
    }
    return codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Submit for fixed acceptance' })
  }, 'node node_modules/vitest/vitest.mjs run value.test.ts', {}, author, { baselineFiles, userInstruction: 'Export value 2.', approvedTests: approvedTests() })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  expect((await fixture.get()).snapshot.independentVerification).toMatchObject({ status: 'frozen', criteriaCount: 1 })
  for (let attempt = 1; attempt <= 4; attempt++) {
    await approve(fixture, `failed-${attempt}`)
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
  }
  const repaired = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(repaired.deliveryEvidence).toHaveLength(4)
  expect(repaired.deliveryEvidence[0]).toMatchObject({ status: 'test_failed', result: { independentVerification: { approvedTests: { passedTests: 0, totalTests: 1 } } } })
  expect(repaired.acceptanceWorkers ?? []).toHaveLength(0)
  await fixture.executor.shutdown(); await fixture.store.close()
  fixture.store = await createLocalStore({ dbPath: path.join(fixture.root, 'local.sqlite') })
  fixture.executor = createNativeCodingExecutorV3({ store: fixture.store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
  fixture.get = (codingRunId = 'coding') => fixture.executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId }, async () => {})
  await approve(fixture, 'repaired-after-restart')
  const completed = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect((await fixture.get()).snapshot.status, JSON.stringify(completed.deliveryEvidence.at(-1)?.result?.independentVerification)).toBe('completed')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(fixed)
  expect(await readFile(path.join(fixture.delivery, 'value.test.ts'), 'utf8')).toBe(publicTest)
  expect(author).not.toHaveBeenCalled()
}, 30000)

it('recognizes the exact test file when its report uses a filesystem alias', async () => {
  provisionFramework()
  let turn = 0
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('fix', 'write_file', { path: 'value.ts', content: fixed, expectedHash: codingDigest(original) })
    : codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
  undefined, {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const originalStart = CodingCommandRunner.prototype.start
  const originalWait = CodingCommandRunner.prototype.wait
  let directory = ''
  vi.spyOn(CodingCommandRunner.prototype, 'start').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    if (args[0].endsWith(':approved-tests')) directory = args[2]
    return originalStart.apply(this, args)
  })
  vi.spyOn(CodingCommandRunner.prototype, 'wait').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    const receipt = await originalWait.apply(this, args)
    if (args[0].endsWith(':approved-tests')) {
      const alias = path.join(fixture.root, 'report-alias')
      await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const reportPath = path.join(directory, '.devflow-approved-result.json')
      const report = JSON.parse(await readFile(reportPath, 'utf8'))
      report.testResults[0].name = path.join(alias, 'value.test.ts')
      await writeFile(reportPath, JSON.stringify(report))
    }
    return receipt
  })
  await approve(fixture, 'alias-report')
  expect((await fixture.get()).snapshot.status).toBe('completed')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(fixed)
}, 30000)

it('returns the public failure separately from passing fixed checks and gates the exact test update before delivery', async () => {
  provisionFramework()
  const staleTest = `const assert = require('node:assert/strict'); const fs = require('node:fs');
console.log('Authorization: Bearer public-feedback-secret-example-1234567890');
console.log('setup output '.repeat(5000));
assert.equal(fs.readFileSync('value.ts', 'utf8'), 'export const value = 1\\n', 'PUBLIC_EXPECTATION_STALE');\n`
  const updatedTest = staleTest.replace('value = 1', 'value = 2')
  let turn = 0, feedback: unknown
  const fixture = await codingHarnessFixture(async request => {
    turn++
    if (turn === 1) return codingToolReply('implement', 'write_file', { path: 'value.ts', content: fixed, expectedHash: codingDigest(original) })
    if (turn === 3) {
      feedback = request.messages.filter(message => message.role === 'user' && String(message.content).includes('finalVerification')).at(-1)?.content
      return codingToolReply('update-obsolete-public-test', 'write_file', { path: 'public-check.test.cjs', content: updatedTest, expectedHash: codingDigest(staleTest) })
    }
    return codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Review the requested behavior and exact public test update' })
  }, 'node public-check.test.cjs', {}, undefined, {
    baselineFiles: { ...baselineFiles, 'public-check.test.cjs': staleTest },
    userInstruction: 'Change the exported value from 1 to 2; retain the original fixed acceptance.', approvedTests: approvedTests(),
  })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 'stale-public-expectation')
  const message = JSON.parse(String(feedback))
  expect(message.finalVerification.result.independentVerification.approvedTests).toMatchObject({ passedTests: 1, totalTests: 1 })
  expect(message.finalVerification.result.publicVerification).toMatchObject({ status: 'failed', exitCode: 1, logId: 'native-coding:verify:stale-public-expectation' })
  expect(JSON.stringify(message.finalVerification.result.publicVerification)).toContain('PUBLIC_EXPECTATION_STALE')
  expect(JSON.stringify(message.finalVerification.result.publicVerification)).not.toContain('public-feedback-secret-example-1234567890')
  expect(JSON.stringify(message.finalVerification.result.publicVerification).length).toBeLessThan(20000)
  const waiting = (await fixture.get()).snapshot
  expect(waiting.status).toBe('waiting_permission')
  expect((await fixture.store.getNativeCodingSession('native-coding'))!.permissions.at(-1)).toMatchObject({ kind: 'test_inputs', decision: 'pending' })
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
  expect(await readFile(path.join(fixture.delivery, 'public-check.test.cjs'), 'utf8')).toBe(staleTest)
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'permission', codingRunId: 'coding', commandId: 'authorize-exact-test',
    expectedVersion: waiting.version, permissionId: waiting.permission!.id, decision: 'approved' }, async () => {})
  await fixture.executor.settled('coding')
  await approve(fixture, 'updated-public-expectation')
  expect((await fixture.get()).snapshot.status).toBe('completed')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(fixed)
  expect(await readFile(path.join(fixture.delivery, 'public-check.test.cjs'), 'utf8')).toBe(updatedTest)
  const completed = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(completed.deliveryEvidence.at(-1)?.result?.independentVerification?.approvedTests).toMatchObject({ passedTests: 1, totalTests: 1 })
}, 30000)

it('includes the failing counter setup and assertion from the approved source in repair feedback', async () => {
  provisionFramework()
  const source = [
    "import {it,expect} from 'vitest'",
    "it('unrelated passed check', () => {",
    "  expect('unrelated-passing-marker').toBeTruthy()",
    '})',
    "it('finishes structured recovery', () => {",
    "  const executor = 'structured'",
    '  const calls = 2',
    '  expect(calls).toBe(4)',
    '})',
  ].join('\n')
  const bundle = freezeApprovedCodingTests({ sourceRef: 'user-approved:counter', expectedTests: 2, files: [{ path: 'value.test.ts', content: source }] })
  let turn = 0
  const fixture = await codingHarnessFixture(async request => {
    if (++turn === 1) return codingToolReply('submit', 'propose_changeset', { summary: 'Review' })
    const feedback = JSON.stringify(request.messages)
    expect(feedback).toContain("const executor = 'structured'")
    expect(feedback).toContain('expect(calls).toBe(4)')
    expect(feedback).not.toContain('unrelated-passing-marker')
    return codingToolReply('stop', 'report_blocked', { reason: 'The authorized failure context was received.' })
  }, undefined, {}, undefined, { baselineFiles, approvedTests: bundle })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 'counter-feedback')
  expect((await fixture.get()).snapshot).toMatchObject({ status: 'paused', pauseReason: 'The authorized failure context was received.' })
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.deliveryEvidence[0]?.result?.independentVerification?.approvedTests).toMatchObject({ passedTests: 1, totalTests: 2,
    failures: [{ sourceExcerpt: expect.stringContaining('const calls = 2') }] })
})

it.each([0, 1])('runs fixed acceptance alongside a public exit %i and requires both checks for delivery', async publicExit => {
  provisionFramework()
  const publicScript = [
    "const fs = require('node:fs')",
    "const file = '.cache/release-public'",
    `const timer = setInterval(() => { if (fs.existsSync(file)) { fs.unlinkSync(file); clearInterval(timer); process.exit(${publicExit}) } }, 50)`,
    'setTimeout(() => process.exit(99), 5000).unref()',
  ].join('\n')
  let turn = 0
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('fix', 'write_file', { path: 'value.ts', content: fixed, expectedHash: codingDigest(original) })
    : codingToolReply(`submit-${turn}`, 'propose_changeset', { summary: 'Review' }),
  'node public-check.cjs', {}, undefined, { baselineFiles: { ...baselineFiles, 'public-check.cjs': publicScript }, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const publicId = 'native-coding:verify:parallel'
  let publicDirectory = ''
  const originalStart = CodingCommandRunner.prototype.start
  const originalWait = CodingCommandRunner.prototype.wait
  vi.spyOn(CodingCommandRunner.prototype, 'start').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    if (args[0] === publicId) {
      publicDirectory = args[2]
      await mkdir(path.join(publicDirectory, '.cache'), { recursive: true })
    }
    return originalStart.apply(this, args)
  })
  vi.spyOn(CodingCommandRunner.prototype, 'wait').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    const receipt = await originalWait.apply(this, args)
    if (args[0].endsWith(':approved-tests')) {
      expect(this.isActive(publicId)).toBe(true)
      await writeFile(path.join(publicDirectory, '.cache/release-public'), '')
    }
    return receipt
  })
  await approve(fixture, 'parallel')
  expect((await fixture.get()).snapshot.status).toBe(publicExit === 0 ? 'completed' : 'review')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.deliveryEvidence[0]?.result?.independentVerification?.approvedTests).toMatchObject({ totalTests: 1, passedTests: 1, status: 'passed' })
  expect(session.deliveryEvidence[0]?.result?.exitCode).toBe(publicExit)
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(publicExit === 0 ? fixed : original)
}, 20000)

it('drains the fixed check before returning a concurrent public preparation error', async () => {
  const prepare = provisionFramework()
  let turn = 0
  const fixture = await codingHarnessFixture(async () => ++turn === 1
    ? codingToolReply('fix', 'write_file', { path: 'value.ts', content: fixed, expectedHash: codingDigest(original) })
    : codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
  undefined, {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  prepare.mockImplementation(async input => {
    if (path.basename(input.directory).startsWith('verify-')) throw new Error('Public dependency preparation failed')
    await symlink(path.resolve('node_modules'), path.join(input.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    return { inputDigest: input.plan.inputDigest }
  })
  await approve(fixture, 'preparation-error')
  expect((await fixture.get()).snapshot.status).toBe('paused')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.deliveryEvidence[0]).toMatchObject({ status: 'evidence_invalid', error: 'Public dependency preparation failed' })
  const reports = path.join(session.binding!.workspaceRoot, 'approved-results')
  const files = await readdir(reports)
  expect(files).toHaveLength(1)
  expect(JSON.parse(await readFile(path.join(reports, files[0]!), 'utf8'))).toMatchObject({ status: 'passed', totalTests: 1 })
  expect((await readdir(session.binding!.workspaceRoot)).filter(file => file.startsWith('approved-check-'))).toHaveLength(0)
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
})

it.each([
  ['skipped test', approvedTest.replace("it('", "it.skip('"), 1, 'Test status skipped'],
  ['wrong count', publicTest, 2, 'expected 2'],
  ['source mutation', "import {it} from 'vitest'; import {writeFileSync} from 'node:fs'; it('changes code',()=>writeFileSync('value.ts','changed'))", 1, 'changed its frozen source'],
  ['module load failure', "import './missing-module'; import {it} from 'vitest'; it('unreachable',()=>{})", 1, 'missing-module'],
] as const)('rejects %s even when a public command succeeds', async (_name, content, expectedTests, diagnostic) => {
  provisionFramework()
  const bundle = freezeApprovedCodingTests({ sourceRef: 'user-approved', expectedTests, files: [{ path: 'value.test.ts', content }] })
  const fixture = await codingHarnessFixture(async () => codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
    undefined, {}, undefined, { baselineFiles, approvedTests: bundle })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 'fixed-failure')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.deliveryEvidence[0]?.status).toBe('test_failed')
  expect(JSON.stringify(session.deliveryEvidence[0]?.result?.independentVerification?.failedRequirements)).toContain(diagnostic)
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
}, 15000)

it('restores baseline configuration and exact approved tests over candidate edits', async () => {
  provisionFramework()
  const fixture = await codingHarnessFixture(async () => codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
    undefined, {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  const workspace = await CodingCandidateWorkspace.open(session.binding!.workspaceRoot)
  await workspace.write('value.test.ts', publicTest, codingDigest(publicTest))
  await workspace.write('vitest.config.mjs', 'export default {test:{include:[],passWithNoTests:true}}', codingDigest(baselineFiles['vitest.config.mjs']))
  const previous = session.revisions[0]!
  const revision = await workspace.freeze({ sessionId: session.id, codingRunId: session.codingRunId, objectiveVersion: session.objectiveVersion,
    policyVersion: previous.policyVersion, testPlanDigest: previous.testPlanDigest, summary: 'Changed test inputs', now: new Date().toISOString() })
  const runner = new CodingCommandRunner(path.join(fixture.root, 'fixed-commands'))
  await runner.start('unrelated-public', { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 10000, profile: { kind: 'trusted_local' } }, fixture.delivery)
  const result = await runApprovedCodingVerification({ approved: session.binding!.approvedVerification!, workspace, revision, runner,
    profile: { kind: 'trusted_local' }, operationId: 'candidate-config', signal: new AbortController().signal })
    .finally(async () => {
      const stillRunning = runner.isActive('unrelated-public')
      await runner.cancelAll()
      expect(stillRunning).toBe(true)
    })
  expect(result).toMatchObject({ status: 'failed', independentVerification: { approvedTests: { totalTests: 1, passedTests: 0 } } })
  expect(JSON.stringify(result.independentVerification?.failedRequirements)).toContain('expected 1 to be 2')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
})

it('still enforces the original shared step limit in fixed-feedback mode', async () => {
  provisionFramework()
  const fixture = await codingHarnessFixture(async () => codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
    undefined, {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await mutateNativeCodingSession(fixture.store, 'native-coding', session => { session.limits.maxSteps = 1 })
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 'failed-at-limit')
  expect((await fixture.get()).snapshot).toMatchObject({ status: 'paused', pauseReason: 'task_limit' })
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
})

it('charges baseline preparation to active time and stops it before any model dispatch when the limit expires', async () => {
  const model = vi.fn(async () => codingToolReply('unexpected', 'propose_changeset', { summary: 'Must not run' }))
  let commandRunner: CodingCommandRunner | undefined
  vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async input => {
    commandRunner = input.runner
    const id = `${input.operationId}:bounded-bootstrap`
    await input.runner.start(id, { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 10000, profile: input.profile }, input.directory, input.signal)
    const receipt = await input.runner.wait(id)
    throw new Error(`Bootstrap ${receipt.status}`)
  })
  const fixture = await codingHarnessFixture(model, undefined, {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await mutateNativeCodingSession(fixture.store, 'native-coding', session => { session.limits.maxActiveMilliseconds = 150 })
  await expect(fixture.authorize()).rejects.toThrow(/Bootstrap cancelled/)
  await vi.waitFor(async () => expect((await fixture.get()).snapshot.status).toBe('paused'))
  expect(commandRunner?.hasActiveCommands).toBe(false)
  expect(model).not.toHaveBeenCalled()
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
})

it('cancels a running fixed test before removing its copy and preserves delivery', async () => {
  provisionFramework()
  const bundle = freezeApprovedCodingTests({ sourceRef: 'user-approved:slow', expectedTests: 1, files: [{ path: 'value.test.ts',
    content: "import {it} from 'vitest'; it('slow approved test', async()=>{await new Promise(r=>setTimeout(r,30000))},60000)" }] })
  const fixture = await codingHarnessFixture(async () => codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
    undefined, {}, undefined, { baselineFiles, approvedTests: bundle })
  fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  let fixedStarted = false
  const originalStart = CodingCommandRunner.prototype.start
  vi.spyOn(CodingCommandRunner.prototype, 'start').mockImplementation(async function (this: CodingCommandRunner, ...args) {
    const result = await originalStart.apply(this, args)
    if (args[0].endsWith(':approved-tests')) fixedStarted = true
    return result
  })
  const approving = approve(fixture, 'cancel-running-test')
  await vi.waitFor(() => expect(fixedStarted).toBe(true), { timeout: 5000 })
  const view = (await fixture.get()).snapshot
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'cancel', codingRunId: 'coding', commandId: 'cancel', expectedVersion: view.version }, async () => {})
  await approving
  expect((await fixture.get()).snapshot.status).toBe('cancelled')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.deliveryEvidence[0]?.status).toBe('evidence_invalid')
  expect(session.deliveryEvidence[0]?.result?.status).toBe('cancelled')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
}, 15000)

it('keeps the approved test bundle immutable and blocks a superseded objective', async () => {
  provisionFramework()
  const fixture = await codingHarnessFixture(async () => codingToolReply('submit', 'propose_changeset', { summary: 'Review' }),
    'node node_modules/vitest/vitest.mjs run value.test.ts', {}, undefined, { baselineFiles, approvedTests: approvedTests() })
  fixtures.push(fixture)
  await expect(mutateNativeCodingSession(fixture.store, 'native-coding', session => { delete session.binding!.approvedVerification })).rejects.toThrow(/immutable/)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const view = await fixture.get()
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'steer', codingRunId: 'coding', commandId: 'new-objective', expectedVersion: view.snapshot.version, text: 'Change the required value to three.' }, async () => {})
  await fixture.executor.settled('coding')
  expect((await fixture.get()).snapshot).toMatchObject({ status: 'paused', pauseReason: 'approved_acceptance_source_changed' })
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe(original)
})

it('validates fixed source paths, test counts and immutable contents', () => {
  const bundle = approvedTests()
  expect(validateApprovedCodingTests(bundle)).toEqual(bundle)
  expect(() => freezeApprovedCodingTests({ sourceRef: 'user', expectedTests: 0, files: bundle.files })).toThrow(/Invalid approved/)
  expect(() => freezeApprovedCodingTests({ sourceRef: 'user', expectedTests: 1, files: [{ path: '../outside.test.ts', content: approvedTest }] })).toThrow()
  expect(() => freezeApprovedCodingTests({ sourceRef: 'user', expectedTests: 1, files: [{ path: 'value.ts', content: approvedTest }] })).toThrow(/Invalid approved/)
  expect(() => validateApprovedCodingTests({ ...bundle, files: [{ ...bundle.files[0]!, content: publicTest }] })).toThrow(/Invalid approved/)
})
