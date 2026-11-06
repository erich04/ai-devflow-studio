// @vitest-environment node
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { CodingHarnessCommand } from '@ai-devflow/shared'
import { codingDigest, CodingCandidateWorkspace } from './coding-candidate-workspace'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import { assertCodingTestInputAuthority, codingTestInputUpdate, isCodingTestInput } from './coding-test-inputs'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'

const original = "exports.read = value => value.text\n"
const broken = "exports.read = value => { if (!Object.hasOwn(value, 'sourceMemory')) throw new Error('invalid legacy input'); return value.text }\n"
const baselineTest = "const assert = require('node:assert/strict'); assert.equal(require('./contract.cjs').read({text: 'kept'}), 'kept')\n"
const revisedTest = baselineTest.replace("{text: 'kept'}", "{text: 'kept', sourceMemory: null}")

it('recognizes shared test setup, mocks and snapshots as existing acceptance inputs', () => {
  for (const file of ['vitest.setup.ts', 'vite.config.ts', 'jest.setup.js', 'src/__mocks__/clock.ts', 'src/__snapshots__/view.snap']) expect(isCodingTestInput(file), file).toBe(true)
  for (const file of ['src/AgentMemoryPanel.tsx', 'src/latest.ts', 'src/fixture-service.ts']) expect(isCodingTestInput(file), file).toBe(false)
})

it('does not let a candidate hide a compatibility regression by updating the existing test fixture', async () => {
  let calls = 0
  const fixture = await codingHarnessFixture(async () => {
    calls += 1
    if (calls === 1) return codingToolReply('change-code', 'write_file', { path: 'contract.cjs', content: broken, expectedHash: codingDigest(original) })
    if (calls === 2) return codingToolReply('change-test', 'write_file', { path: 'contract.test.cjs', content: revisedTest, expectedHash: codingDigest(baselineTest) })
    return codingToolReply('freeze', 'propose_changeset', { summary: 'The revised public test passes' })
  }, 'node contract.test.cjs', {}, undefined, { baselineFiles: { 'contract.cjs': original, 'contract.test.cjs': baselineTest } })
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const session = (await fixture.store.getNativeCodingSession('native-coding'))!
    const candidate = path.join(session.binding!.workspaceRoot, 'candidate')
    // Reproduce the real failure pattern with actual JavaScript execution:
    // edited tests pass, while the original supported input now fails.
    await promisify(execFile)(process.execPath, ['contract.test.cjs'], { cwd: candidate })
    await expect(promisify(execFile)(process.execPath, ['-e', baselineTest], { cwd: candidate })).rejects.toThrow('invalid legacy input')
    expect(await readFile(path.join(fixture.delivery, 'contract.cjs'), 'utf8')).toBe(original)
    expect(session.status).toBe('waiting_permission')
    expect(session.permissions.at(-1)).toMatchObject({ kind: 'test_inputs', decision: 'pending' })
    expect(session.revisions).toHaveLength(0)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

const fixtures: Awaited<ReturnType<typeof codingHarnessFixture>>[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0)) { await f.executor.shutdown(); await f.store.close(); await rm(f.root, { recursive: true, force: true }) }
})
async function inputFixture(file = 'contract.test.cjs', content = `${baselineTest}// additional documentation\n`, existing = true) {
  let calls = 0
  const f = await codingHarnessFixture(async () => {
    if (++calls === 1) return codingToolReply('edit-test', 'write_file', { path: file, content, expectedHash: existing ? codingDigest(baselineTest) : '' })
    if (calls === 2) return codingToolReply('freeze-test', 'propose_changeset', { summary: 'Review the test input update' })
    return codingToolReply('stop', 'report_blocked', { reason: 'Permission was rejected; preserve delivery' })
  }, undefined, {}, undefined, { baselineFiles: { 'contract.cjs': original, ...(existing ? { [file]: baselineTest } : {}) } })
  fixtures.push(f)
  return f
}
async function send(f: Awaited<ReturnType<typeof inputFixture>>, value: object, assertAuthority = async () => {}) {
  const view = (await f.executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})).snapshot
  return f.executor.harness!.command({ protocolVersion: 2, codingRunId: 'coding', commandId: `human-${view.version}`, expectedVersion: view.version, ...value } as CodingHarnessCommand, assertAuthority)
}
async function grantAndFreeze(f: Awaited<ReturnType<typeof inputFixture>>) {
  await f.authorize(); await f.executor.settled('coding')
  const waiting = (await f.get()).snapshot
  expect(waiting.status).toBe('waiting_permission')
  await send(f, { type: 'permission', permissionId: waiting.permission!.id, decision: 'approved' })
  await f.executor.settled('coding')
  const frozen = (await f.get()).snapshot
  expect(frozen.status).toBe('review')
  return { type: 'approve', objectiveVersion: frozen.objectiveVersion, revisionDigest: frozen.revision!.digest }
}

it('persists an exact test-input grant through restart and still requires final revision approval', async () => {
  const f = await inputFixture()
  const approval = await grantAndFreeze(f)
  expect(await readFile(path.join(f.delivery, 'contract.test.cjs'), 'utf8')).toBe(baselineTest)
  await f.executor.shutdown(); await f.store.close()
  f.store = await createLocalStore({ dbPath: path.join(f.root, 'local.sqlite') })
  f.executor = createNativeCodingExecutorV3({ store: f.store, root: path.join(f.root, 'harness'), configVersion: 1, provider: f.provider })
  const result = await send(f, approval)
  expect(result.snapshot.status).toBe('completed')
  expect(await readFile(path.join(f.delivery, 'contract.test.cjs'), 'utf8')).toContain('additional documentation')
})

it('rejecting the separate test-input card leaves delivery and revision history unchanged', async () => {
  const f = await inputFixture()
  await f.authorize(); await f.executor.settled('coding')
  await send(f, { type: 'permission', permissionId: (await f.get()).snapshot.permission!.id, decision: 'rejected' })
  await f.executor.settled('coding')
  const state = (await f.store.getNativeCodingSession('native-coding'))!
  expect(state.status).toBe('paused'); expect(state.revisions).toHaveLength(0)
  expect(await readFile(path.join(f.delivery, 'contract.test.cjs'), 'utf8')).toBe(baselineTest)
})

it('allows an additional test file but requires a grant for new runner configuration', async () => {
  for (const [file, status] of [['extra.test.cjs', 'review'], ['vitest.config.ts', 'waiting_permission']] as const) {
    const f = await inputFixture(file, 'export default {}\n', false)
    await f.authorize(); await f.executor.settled('coding')
    expect((await f.get()).snapshot.status, file).toBe(status)
  }
})

it('protects deleted and renamed baseline fixtures and test programs', async () => {
  const f = await inputFixture('fixtures/old-input.json')
  await f.authorize(); await f.executor.settled('coding')
  const session = (await f.store.getNativeCodingSession('native-coding'))!
  const workspace = await CodingCandidateWorkspace.open(session.binding!.workspaceRoot)
  const target = structuredClone(workspace.identity.base)
  const originalEntry = target.files.find(file => file.path === 'fixtures/old-input.json')!
  originalEntry.path = 'new-name.json'
  expect(codingTestInputUpdate(workspace.identity.base, target)?.changes).toEqual([
    { path: 'fixtures/old-input.json', before: workspace.identity.base.files.find(file => file.path === 'fixtures/old-input.json'), after: null },
  ])
})

it('invalidates an exact grant when its contents, objective, policy, operation or expiry change', async () => {
  const f = await inputFixture()
  await grantAndFreeze(f)
  const session = (await f.store.getNativeCodingSession('native-coding'))!, revision = session.revisions.at(-1)!
  expect(() => assertCodingTestInputAuthority(session, revision)).not.toThrow()
  for (const change of ['contents', 'objective', 'policy', 'operation', 'expiry'] as const) {
    const state = structuredClone(session), proposed = structuredClone(revision)
    if (change === 'contents') proposed.target.files.find(file => file.path === 'contract.test.cjs')!.hash = codingDigest('different test')
    if (change === 'objective') state.objectiveVersion++
    if (change === 'policy') state.binding!.permissionPolicy!.mode = 'unattended'
    if (change === 'operation') proposed.id = 'other-changeset'
    if (change === 'expiry') state.permissions.at(-1)!.expiresAt = new Date(0).toISOString()
    expect(() => assertCodingTestInputAuthority(state, proposed), change).toThrow(/test inputs changed/)
  }
  await expect(mutateNativeCodingSession(f.store, session.id, draft => { delete draft.binding!.testInputPolicyVersion })).rejects.toThrow(/cannot change/)
  const legacy = structuredClone(session); delete legacy.binding!.testInputPolicyVersion; legacy.permissions = []
  expect(() => assertCodingTestInputAuthority(legacy, revision)).not.toThrow()
})

it('restores delivery if the test-input grant expires while final verification runs', async () => {
  const f = await inputFixture()
  const approval = await grantAndFreeze(f)
  let expired = false
  const result = await send(f, approval, async () => {
    if (!expired && (await f.store.getNativeCodingSession('native-coding'))!.status === 'verifying') {
      expired = true
      await mutateNativeCodingSession(f.store, 'native-coding', state => { state.permissions.at(-1)!.expiresAt = new Date(0).toISOString() })
    }
  })
  expect(expired).toBe(true)
  expect(result.snapshot.status).toBe('paused')
  expect(result.completion).toBeUndefined()
  expect(await readFile(path.join(f.delivery, 'contract.test.cjs'), 'utf8')).toBe(baselineTest)
})
