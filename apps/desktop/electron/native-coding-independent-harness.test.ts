// @vitest-environment node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, type NativeConversationRequest, type NativeConversationResponse } from '@ai-devflow/shared'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { mutateNativeCodingSession } from './native-coding-session'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import { inspectCodingInput } from './coding-input'

const fixtures: Awaited<ReturnType<typeof codingHarnessFixture>>[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) } })
const privateBody = "const fs = await import('node:fs/promises'); check((await fs.readFile('value.ts', 'utf8')).trim() === 'export const value = 2');"
const planReply = () => codingToolReply('private-plan', 'submit_independent_checks', { checks: [{ criterionId: 'objective', body: privateBody }] })
it('keeps the saved test target and its full source ahead of unrelated alphabetically earlier suites', async () => {
  let observed: { files: Array<{ path: string; content: string; truncated: boolean }> } | undefined
  const fixture = await codingHarnessFixture(async () => codingToolReply('propose-focused', 'propose_changeset', { summary: 'Review' }), 'corepack pnpm exec vitest run z-target/service.test.ts', {}, async request => {
    observed = JSON.parse(request.messages[0]!.content!); return planReply()
  }); fixtures.push(fixture)
  await mkdir(path.join(fixture.delivery, 'a-unrelated')); await mkdir(path.join(fixture.delivery, 'z-target'))
  for (let i = 0; i < 24; i++) await writeFile(path.join(fixture.delivery, 'a-unrelated', `${i}.test.ts`), '// irrelevant\n'.repeat(1500))
  const source = '// legitimate source\n'.repeat(4000) + 'export const targetBehavior = 2\n'
  await writeFile(path.join(fixture.delivery, 'z-target/service.ts'), source)
  await writeFile(path.join(fixture.delivery, 'z-target/service.test.ts'), '// existing fixture examples\n')
  const input = await inspectCodingInput(fixture.delivery, fixture.context.workspace.baseCommitSha)
  await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.binding!.input = input })
  await fixture.authorize(); await fixture.executor.settled('coding')
  expect((await fixture.get()).snapshot.status).toBe('review')
  expect(observed!.files.find(file => file.path === 'z-target/service.ts')).toMatchObject({ content: source, truncated: false })
  expect(observed!.files.findIndex(file => file.path === 'z-target/service.test.ts')).toBeLessThan(observed!.files.findIndex(file => file.path.startsWith('a-unrelated/')))
}, 15000)
async function approve(fixture: Awaited<ReturnType<typeof codingHarnessFixture>>, index: number) {
  const view = (await fixture.get()).snapshot
  return fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: `approval-${index}`, expectedVersion: view.version,
    objectiveVersion: view.objectiveVersion, revisionDigest: view.revision!.digest, confirmedCriteria: view.acceptance?.map(item => item.id) ?? [] }, async () => {})
}

it('freezes checks before implementation, hides them, and stops after two automatic repair rounds despite public tests passing', async () => {
  let proposals = 0
  const model = vi.fn(async (request: NativeConversationRequest) => request.nativeOperation?.purpose === 'coding-acceptance-plan' ? planReply()
    : codingToolReply(`proposal-${++proposals}`, 'propose_changeset', { summary: 'Public tests pass' }))
  const fixture = await codingHarnessFixture(model, undefined, {}, model); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  expect(model.mock.calls[0]![0].nativeOperation?.purpose).toBe('coding-acceptance-plan')
  expect((await fixture.get()).snapshot.status).toBe('review')
  const privateSession = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(privateSession.independentVerification?.plans).toHaveLength(1)
  expect(JSON.stringify((await fixture.get()).snapshot)).not.toContain(privateBody)
  for (let index = 1; index <= 3; index++) {
    await approve(fixture, index); await fixture.executor.settled('coding')
    expect((await fixture.get()).snapshot.status).toBe(index < 3 ? 'review' : 'paused')
    expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 1\n')
  }
  const stopped = await fixture.get()
  expect(stopped.snapshot.pauseReason).toBe('independent_verification_repair_limit')
  expect(stopped.completion).toBeUndefined()
  expect(proposals).toBe(3)
  expect(model.mock.calls.filter(([request]) => request.nativeOperation?.purpose === 'coding-acceptance-plan')).toHaveLength(1)
  expect(model.mock.calls.filter(([request]) => request.nativeOperation?.purpose !== 'coding-acceptance-plan').every(([request]) => !JSON.stringify(request).includes(privateBody))).toBe(true)
  await expect(mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.independentVerification!.plans[0]!.checks[0]!.body = 'check(true)' })).rejects.toThrow()
}, 15000)

it('uses the same frozen checks after a real repair and emits completion only for the passing exact revision', async () => {
  let turn = 0
  const model = vi.fn(async (request: NativeConversationRequest) => {
    if (request.nativeOperation?.purpose === 'coding-acceptance-plan') return planReply()
    turn++
    if (turn === 2) return codingToolReply('read-value', 'read_file', { path: 'value.ts' })
    if (turn === 3) {
      const output = JSON.parse(request.messages.filter(item => item.role === 'tool').at(-1)!.content) as { hash: string }
      return codingToolReply('edit-value', 'write_file', { path: 'value.ts', content: 'export const value = 2\n', expectedHash: output.hash })
    }
    return codingToolReply(`proposal-${turn}`, 'propose_changeset', { summary: 'Ready for actual verification' })
  })
  const fixture = await codingHarnessFixture(model, undefined, {}, model); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 1); await fixture.executor.settled('coding')
  expect((await fixture.get()).snapshot.status).toBe('review')
  const result = await approve(fixture, 2)
  expect(result.snapshot.status).toBe('completed')
  expect(result.completion?.testEvidence?.status).toBe('passed')
  expect(await readFile(path.join(fixture.delivery, 'value.ts'), 'utf8')).toBe('export const value = 2\n')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.independentVerification?.plans).toHaveLength(1)
  expect(session.deliveryEvidence.at(-1)?.result?.independentVerification?.status).toBe('passed')
})

it('cancels an acceptance request without exposing or applying its late response, while preserving usage', async () => {
  let release: ((response: NativeConversationResponse) => void) | undefined
  const author = vi.fn(async () => new Promise<NativeConversationResponse>(resolve => { release = resolve }))
  const coder = vi.fn(async () => codingToolReply('unexpected', 'propose_changeset', { summary: 'Must not run' }))
  const fixture = await codingHarnessFixture(coder, undefined, {}, author); fixtures.push(fixture)
  await fixture.authorize(); await expect.poll(() => Boolean(release)).toBe(true)
  const view = (await fixture.get()).snapshot
  const cancelling = fixture.executor.harness!.command({ protocolVersion: 2, type: 'cancel', codingRunId: 'coding', commandId: 'cancel-planner', expectedVersion: view.version }, async () => {})
  await expect.poll(async () => (await fixture.get()).snapshot.status).toBe('paused')
  release!(planReply()); await cancelling; await fixture.executor.settled('coding')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.status).toBe('cancelled'); expect(session.independentVerification?.plans).toEqual([])
  expect(session.attempts[0]).toMatchObject({ status: 'completed', usage: { inputTokens: 10, outputTokens: 5 } })
  expect(coder).not.toHaveBeenCalled(); expect(JSON.stringify(session.transcript)).not.toContain(privateBody)
})

it('keeps an unknown acceptance request stopped across restart until a human authorizes a new attempt', async () => {
  let calls = 0
  const author = vi.fn(async () => {
    if (++calls === 1) throw new AgentProviderRequestError({ code: 'connection_reset', deliveryState: 'possibly_delivered', billingState: 'unknown', retryable: false, sanitizedCause: 'socket_lost' })
    return planReply()
  })
  const coder = vi.fn(async () => codingToolReply('review-after-retry', 'propose_changeset', { summary: 'Review' }))
  const fixture = await codingHarnessFixture(coder, undefined, {}, author); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  expect((await fixture.get()).snapshot.status).toBe('reconciling'); expect(coder).not.toHaveBeenCalled()
  await fixture.executor.shutdown(); await fixture.store.close()
  const store = await createLocalStore({ dbPath: path.join(fixture.root, 'local.sqlite') })
  const executor = createNativeCodingExecutorV3({ store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
  fixture.store = store; fixture.executor = executor
  const get = () => executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})
  const restored = (await get()).snapshot
  expect(restored.status).toBe('reconciling'); expect(author).toHaveBeenCalledTimes(1)
  await executor.harness!.command({ protocolVersion: 2, type: 'retry_unknown', codingRunId: 'coding', commandId: 'retry-planner', expectedVersion: restored.version }, async () => {})
  await executor.settled('coding')
  expect((await get()).snapshot.status).toBe('review'); expect(author).toHaveBeenCalledTimes(2)
  const session = (await store.getNativeCodingSession('native-coding'))!
  expect(session.attempts[0]).toMatchObject({ status: 'unknown', acknowledgedBy: 'retry-planner' })
  expect(session.independentVerification?.plans).toHaveLength(1)
})

it('persists the frozen checks through restart without another author call', async () => {
  const author = vi.fn(async () => planReply())
  const fixture = await codingHarnessFixture(async () => codingToolReply('review-persisted', 'propose_changeset', { summary: 'Review' }), undefined, {}, author); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const before = (await fixture.store.getNativeCodingSession('native-coding'))!.independentVerification
  await fixture.executor.shutdown(); await fixture.store.close()
  const store = await createLocalStore({ dbPath: path.join(fixture.root, 'local.sqlite') })
  const executor = createNativeCodingExecutorV3({ store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
  fixture.store = store; fixture.executor = executor
  const restored = await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})
  expect(restored.snapshot.status).toBe('review'); expect(author).toHaveBeenCalledTimes(1)
  expect((await store.getNativeCodingSession('native-coding'))!.independentVerification).toEqual(before)
  expect(JSON.stringify(restored)).not.toContain(privateBody)
})

it('pauses an invalid check plan without losing its charge or accepting a completion claim', async () => {
  const coder = vi.fn(async () => codingToolReply('unexpected', 'propose_changeset', { summary: 'Must not run' }))
  const fixture = await codingHarnessFixture(coder, undefined, {}, async () => codingToolReply('invalid-plan', 'submit_independent_checks', { checks: [] })); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.status).toBe('paused'); expect(session.pauseReason).toBe('independent_verification_plan_invalid')
  expect(session.independentVerification?.plans).toEqual([])
  expect(session.attempts[0]).toMatchObject({ status: 'completed', usage: { inputTokens: 10, outputTokens: 5 } })
  expect(coder).not.toHaveBeenCalled()
})

it('prevents the implementer from reading private acceptance command output after failure', async () => {
  let turn = 0
  const fixture = await codingHarnessFixture(async request => {
    if (++turn === 2) return codingToolReply('read-private', 'read_command', { id: 'native-coding:independent:approval-1' })
    if (turn === 3) {
      const output = request.messages.filter(item => item.role === 'tool').at(-1)!.content
      expect(output).toContain('private'); expect(output).not.toContain('PRIVATE-OUTPUT-8392')
    }
    return codingToolReply(`proposal-${turn}`, 'propose_changeset', { summary: 'Review' })
  }, undefined, {}, async () => codingToolReply('private-output', 'submit_independent_checks', { checks: [{ criterionId: 'objective', body: "console.log('PRIVATE-OUTPUT-8392'); check(false);" }] })); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  await approve(fixture, 1); await fixture.executor.settled('coding')
  expect(turn).toBe(3)
  expect(JSON.stringify((await fixture.get()).snapshot)).not.toContain('PRIVATE-OUTPUT-8392')
})

it('rebuilds checks from the original baseline and human clarification, not the edited candidate', async () => {
  let turn = 0
  const author = vi.fn(async (request: NativeConversationRequest) => {
    const input = JSON.parse(request.messages[0]!.content!) as { source: { criteria: Array<{ id: string }> }; files: Array<{ path: string; content: string }> }
    expect(input.files.find(file => file.path === 'value.ts')?.content).toBe('export const value = 1\n')
    return codingToolReply(`plan-${author.mock.calls.length}`, 'submit_independent_checks', { checks: input.source.criteria.map(item => ({ criterionId: item.id, body: privateBody })) })
  })
  const fixture = await codingHarnessFixture(async request => {
    turn++
    if (turn === 1) return codingToolReply('read', 'read_file', { path: 'value.ts' })
    if (turn === 2) return codingToolReply('edit', 'write_file', { path: 'value.ts', expectedHash: JSON.parse(request.messages.filter(item => item.role === 'tool').at(-1)!.content).hash, content: 'export const value = 2\n' })
    if (turn === 3) return codingToolReply('clarify', 'request_user_input', { text: 'Which value should be exported?' })
    return codingToolReply('after-clarification', 'propose_changeset', { summary: 'Set the clarified value' })
  }, undefined, {}, author); fixtures.push(fixture)
  await fixture.authorize(); await fixture.executor.settled('coding')
  const waiting = (await fixture.get()).snapshot
  await fixture.executor.harness!.command({ protocolVersion: 2, type: 'reply', codingRunId: 'coding', commandId: 'answer-value', expectedVersion: waiting.version, objectiveVersion: waiting.objectiveVersion, questionId: waiting.question!.id, text: 'Export the value 2.' }, async () => {})
  await fixture.executor.settled('coding')
  const session = (await fixture.store.getNativeCodingSession('native-coding'))!
  expect(session.status).toBe('review'); expect(session.objectiveVersion).toBe(waiting.objectiveVersion)
  expect(session.independentVerification?.plans).toHaveLength(2)
  expect(session.independentVerification!.plans[0]!.sourceDigest).not.toBe(session.independentVerification!.plans[1]!.sourceDigest)
  expect(author.mock.calls[1]![0].messages[0]!.content).toContain('Export the value 2.')
  expect(session.binding?.executionGranted).toBe(true)
})

it('excludes baseline credentials from the independent author request', async () => {
  const author = vi.fn(async (request: NativeConversationRequest) => {
    const input = JSON.parse(request.messages[0]!.content!) as { files: Array<{ path: string; content: string }> }
    expect(input.files.map(file => file.path)).not.toContain('.env')
    expect(input.files.map(file => file.path)).not.toContain('service.key')
    expect(JSON.stringify(request)).not.toContain('SYNTHETIC-PRIVATE-ENV-98271')
    expect(JSON.stringify(request)).not.toContain('SYNTHETIC-PRIVATE-KEY-98271')
    return planReply()
  })
  const fixture = await codingHarnessFixture(async () => codingToolReply('after-safe-author', 'propose_changeset', { summary: 'Review' }), undefined, {}, author); fixtures.push(fixture)
  await writeFile(path.join(fixture.delivery, '.env'), 'API_KEY=SYNTHETIC-PRIVATE-ENV-98271')
  await writeFile(path.join(fixture.delivery, 'service.key'), 'SYNTHETIC-PRIVATE-KEY-98271')
  const input = await inspectCodingInput(fixture.delivery, fixture.context.workspace.baseCommitSha)
  await mutateNativeCodingSession(fixture.store, 'native-coding', draft => { draft.binding!.input = input })
  await fixture.authorize(); await fixture.executor.settled('coding')
  expect(author).toHaveBeenCalledTimes(1)
  expect((await fixture.get()).snapshot.status).toBe('review')
})
