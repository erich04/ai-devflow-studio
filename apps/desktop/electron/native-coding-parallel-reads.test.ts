// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createFakeAgentProvider, type AgentProvider, type NativeToolCall } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { createNativeCodingSession } from './native-coding-session'
import { NativeCodingLoop, type CodingLoopTools } from './native-coding-loop'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { codingHarnessFixture } from './native-coding-test-fixture'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function sessionStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-parallel-reads-')); directories.push(directory)
  const dbPath = path.join(directory, 'local.sqlite'), store = await createLocalStore({ dbPath }), now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
  await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective: 'Survey the module', providerId: 'fake', model: 'test', now }), 0)
  return { store, dbPath }
}
const batch = (calls: Array<[id: string, name: string, args: unknown]>) => {
  const toolCalls: NativeToolCall[] = calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
  return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls } }
}
// The first reply is the batch under test; the next one stops the task so the batch is the only work.
function model(first: ReturnType<typeof batch>) {
  let calls = 0
  const provider: AgentProvider = { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input),
    completeNativeConversation: async () => ++calls === 1 ? first : batch([['stop', 'report_blocked', { reason: 'scripted stop' }]]) }
  return { provider, calls: () => calls }
}
const schema = { type: 'object', properties: { delay: { type: 'integer', minimum: 0, maximum: 60000 } }, required: [], additionalProperties: false }
// Fake reads and writes that log when each one is authorized, starts and ends.
function scriptedTools(store: LocalStore, behaviour: { read?: (id: string, delay: number) => Promise<void> } = {}) {
  const events: string[] = [], receiptsAtFirstStart: Array<[string, string]> = []
  let running = 0, peak = 0, capturedReceipts = false
  const perform = async (id: string, delay: number) => {
    if (!capturedReceipts) {
      capturedReceipts = true
      receiptsAtFirstStart.push(...(await store.getNativeCodingSession('session'))!.toolReceipts.map(receipt => [receipt.id, receipt.status] as [string, string]))
    }
    running++; peak = Math.max(peak, running); events.push(`start:${id}`)
    try { await (behaviour.read ?? ((_id, ms) => new Promise<void>(resolve => setTimeout(resolve, ms))))(id, delay) }
    finally { running--; events.push(`end:${id}`) }
    return { id }
  }
  const tools: CodingLoopTools = {
    definitions: ['slow_read', 'write_note'].map(name => ({ type: 'function' as const, function: { name, description: '', parameters: schema } })),
    effects: { slow_read: 'read', write_note: 'write' }, parallel: ['slow_read'],
    authorize: async (_name, input, context) => { events.push(`authorized:${context.operationId}`); return () => perform(context.operationId, Number(input.delay ?? 0)) },
    execute: async (_name, input, context) => { events.push(`serial:${context.operationId}`); return perform(context.operationId, Number(input.delay ?? 0)) },
    reconcile: async () => ({ state: 'not_executed' }),
  }
  return { tools, events, receiptsAtFirstStart, peak: () => peak }
}
const toolResults = (session: NonNullable<Awaited<ReturnType<LocalStore['getNativeCodingSession']>>>) => session.transcript.flatMap(message => message.role === 'tool' ? [message.tool_call_id] : [])

it('runs at most four reads at once and returns their results in call order', async () => {
  const { store } = await sessionStore()
  const ids = Array.from({ length: 7 }, (_, index) => `read-${index + 1}`)
  // Later calls finish first.
  const scripted = scriptedTools(store), fake = model(batch(ids.map((id, index) => [id, 'slow_read', { delay: 80 - index * 10 }])))
  try {
    expect(await new NativeCodingLoop({ store, provider: fake.provider, tools: scripted.tools }).runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'scripted stop' })
    expect(scripted.peak()).toBe(4)
    // Every started receipt and authorization precedes the first execution, in call order.
    expect(scripted.receiptsAtFirstStart).toEqual(ids.map(id => [id, 'started']))
    expect(scripted.events.slice(0, ids.length)).toEqual(ids.map(id => `authorized:${id}`))
    const ends = scripted.events.filter(event => event.startsWith('end:'))
    expect(ends.indexOf('end:read-4')).toBeLessThan(ends.indexOf('end:read-1'))
    const saved = (await store.getNativeCodingSession('session'))!
    expect(toolResults(saved)).toEqual([...ids, 'stop'])
    expect(saved.transcript.filter(message => message.role === 'tool' && ids.includes(message.tool_call_id)).map(message => JSON.parse(String(message.content)).id)).toEqual(ids)
    expect(saved.toolReceipts.map(receipt => [receipt.id, receipt.status])).toEqual(ids.map(id => [id, 'completed']))
  } finally { await store.close() }
})

it('runs a write between reads alone, splitting the reads into two groups', async () => {
  const { store } = await sessionStore()
  const scripted = scriptedTools(store), fake = model(batch([['r1', 'slow_read', { delay: 40 }], ['r2', 'slow_read', { delay: 40 }], ['w', 'write_note', {}], ['r3', 'slow_read', { delay: 40 }], ['r4', 'slow_read', { delay: 40 }]]))
  try {
    await new NativeCodingLoop({ store, provider: fake.provider, tools: scripted.tools }).runBatch('session')
    const at = (event: string) => scripted.events.indexOf(event)
    expect(scripted.events.filter(event => !event.startsWith('start:') && !event.startsWith('end:'))).toEqual(['authorized:r1', 'authorized:r2', 'serial:w', 'authorized:r3', 'authorized:r4'])
    expect(at('start:r2')).toBeLessThan(at('end:r1'))
    expect(at('start:w')).toBeGreaterThan(Math.max(at('end:r1'), at('end:r2')))
    expect(Math.min(at('authorized:r3'), at('start:r3'), at('start:r4'))).toBeGreaterThan(at('end:w'))
    expect(at('start:r4')).toBeLessThan(at('end:r3'))
    expect(toolResults((await store.getNativeCodingSession('session'))!)).toEqual(['r1', 'r2', 'w', 'r3', 'r4', 'stop'])
  } finally { await store.close() }
})

it('leaves a started receipt for every call when the process stops inside a group, then recovers in call order', async () => {
  const { store, dbPath } = await sessionStore()
  const ids = ['read-1', 'read-2', 'read-3', 'read-4', 'read-5']
  const fake = model(batch(ids.map(id => [id, 'slow_read', {}])))
  // The first writer's reads never finish, as if the process were killed while they ran.
  const stopped = scriptedTools(store, { read: () => new Promise<void>(() => {}) })
  void new NativeCodingLoop({ store, provider: fake.provider, tools: stopped.tools }).runBatch('session').catch(() => undefined)
  await expect.poll(() => stopped.events.filter(event => event.startsWith('start:')).length).toBe(4)
  await store.close()
  const reopened = await createLocalStore({ dbPath })
  try {
    const left = (await reopened.getNativeCodingSession('session'))!
    expect(left.toolReceipts.map(receipt => [receipt.id, receipt.effect, receipt.status])).toEqual(ids.map(id => [id, 'read', 'started']))
    expect(toolResults(left)).toEqual([])
    const recovered = scriptedTools(reopened)
    const loop = new NativeCodingLoop({ store: reopened, provider: fake.provider, tools: recovered.tools, stopPreviousWorker: async () => true })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'scripted stop' })
    // Started read receipts are re-run, never assumed done; the model is not asked again for them.
    expect(recovered.events.filter(event => event.startsWith('authorized:'))).toEqual(ids.map(id => `authorized:${id}`))
    expect(fake.calls()).toBe(2)
    const saved = (await reopened.getNativeCodingSession('session'))!
    expect(toolResults(saved)).toEqual([...ids, 'stop'])
    expect(saved.toolReceipts.map(receipt => [receipt.id, receipt.status])).toEqual(ids.map(id => [id, 'completed']))
  } finally { await reopened.close() }
})

it('runs the real read tools together with their authorizations and receipts in call order', async () => {
  const calls: Array<[string, string, unknown]> = [
    ['file-value', 'read_file', { path: 'value.ts' }], ['file-package', 'read_file', { path: 'package.json' }],
    ['directory', 'list_directory', {}], ['typescript', 'glob_files', { pattern: '*.ts' }], ['status', 'repo_status', {}],
  ]
  let replies = 0
  const fixture = await codingHarnessFixture(async () => ++replies === 1 ? batch(calls.map(([id, name, args]) => [id, name, args])) : batch([['freeze', 'propose_changeset', { summary: 'Surveyed; no change needed' }]]))
  const inspect = CodingCandidateWorkspace.prototype.inspectCached
  let inspecting = 0, peak = 0
  let release!: () => void
  const readersReady = new Promise<void>(resolve => { release = resolve })
  const spy = vi.spyOn(CodingCandidateWorkspace.prototype, 'inspectCached').mockImplementation(async function (this: CodingCandidateWorkspace, ...args: Parameters<typeof inspect>) {
    inspecting++; peak = Math.max(peak, inspecting)
    try { await readersReady; return await inspect.apply(this, args) } finally { inspecting-- }
  })
  try {
    await fixture.authorize()
    await expect.poll(() => inspecting, { timeout: 5000 }).toBe(4)
    release()
    await fixture.executor.settled('coding')
    expect((await fixture.get()).snapshot.status).toBe('review')
    expect(peak).toBe(4)
    const saved = (await fixture.store.getNativeCodingSession('native-coding'))!
    const ids = calls.map(([id]) => id)
    expect(saved.toolReceipts.slice(0, ids.length).map(receipt => [receipt.id, receipt.status])).toEqual(ids.map(id => [id, 'completed']))
    expect(saved.toolAuthorities.slice(0, ids.length).map(record => [record.runtime.activeAction?.id, record.consumed])).toEqual(ids.map(id => [id, true]))
    const results = Object.fromEntries(saved.transcript.flatMap(message => message.role === 'tool' && ids.includes(message.tool_call_id) ? [[message.tool_call_id, JSON.parse(String(message.content))]] : []))
    expect(saved.transcript.flatMap(message => message.role === 'tool' ? [message.tool_call_id] : []).slice(0, ids.length)).toEqual(ids)
    expect(results['file-value']).toMatchObject({ path: 'value.ts', content: 'export const value = 1\n' })
    expect(results['file-package']).toMatchObject({ path: 'package.json', content: '{"private":true}' })
    expect(results.directory.entries).toEqual(['package.json', 'value.ts'])
    expect(results.typescript.files.map((file: { path: string }) => file.path)).toEqual(['value.ts'])
    expect(results.status).toMatchObject({ changed: [], removed: [] })
  } finally { release(); spy.mockRestore(); await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it.each(['steer', 'cancel'] as const)('does not dispatch queued reads after human %s', async action => {
  const { store } = await sessionStore()
  const ids = Array.from({ length: 6 }, (_, index) => `r${index}`)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const scripted = scriptedTools(store, { read: () => gate })
  const fake = model(batch(ids.map(id => [id, 'slow_read', {}])))
  const loop = new NativeCodingLoop({ store, provider: fake.provider, tools: scripted.tools })
  const running = loop.runBatch('session')
  try {
    await expect.poll(() => scripted.events.filter(event => event.startsWith('start:')).length).toBe(4)
    if (action === 'steer') await loop.steer('session', { id: 'steer', text: 'Stop surveying and reconsider' })
    else await loop.cancel('session')
    release()
    await running
    expect(scripted.events.filter(event => event.startsWith('start:'))).toHaveLength(4)
    const saved = (await store.getNativeCodingSession('session'))!
    if (action === 'steer') {
      expect(toolResults(saved)).toEqual([...ids, 'stop'])
      for (const id of ids.slice(4)) {
        expect(saved.toolReceipts.find(receipt => receipt.id === id)?.result).toEqual({ supersededByHumanSteering: true, executed: false })
      }
      expect(saved.transcript).toContainEqual({ role: 'user', content: 'Stop surveying and reconsider' })
    } else {
      expect(saved.status).toBe('cancelled')
      expect(toolResults(saved)).toEqual([])
      expect(saved.toolReceipts.every(receipt => receipt.status === 'started')).toBe(true)
    }
  } finally { release(); await running; await store.close() }
})

it.each(['authorize', 'execute'] as const)('records a read %s failure in order and prevents the following write', async stage => {
  const { store } = await sessionStore()
  const scripted = scriptedTools(store, { read: async id => { if (stage === 'execute' && id === 'r1') throw new Error('Read failed') } })
  const authorize = scripted.tools.authorize!
  scripted.tools.authorize = async (...args) => {
    if (stage === 'authorize' && args[2].operationId === 'r1') throw new Error('Authority revoked')
    return authorize(...args)
  }
  const fake = model(batch([['r1', 'slow_read', {}], ['r2', 'slow_read', {}], ['write', 'write_note', {}]]))
  try {
    await new NativeCodingLoop({ store, provider: fake.provider, tools: scripted.tools }).runBatch('session')
    expect(scripted.events).not.toContain('serial:write')
    if (stage === 'authorize') expect(scripted.events).not.toContain('start:r1')
    const saved = (await store.getNativeCodingSession('session'))!
    expect(toolResults(saved)).toEqual(['r1', 'r2', 'write', 'stop'])
    expect(saved.toolReceipts[0]?.result).toEqual({ error: stage === 'authorize' ? 'Authority revoked' : 'Read failed' })
    const skipped = saved.transcript.find(message => message.role === 'tool' && message.tool_call_id === 'write')!
    expect(JSON.parse(String(skipped.content))).toMatchObject({ executed: false })
  } finally { await store.close() }
})

it('keeps undeclared reads and hosts without separate authorization serial', async () => {
  for (const fallback of ['undeclared', 'no-authorize']) {
    const { store } = await sessionStore(), scripted = scriptedTools(store)
    if (fallback === 'undeclared') scripted.tools.parallel = []
    else delete scripted.tools.authorize
    const fake = model(batch([['r1', 'slow_read', { delay: 10 }], ['r2', 'slow_read', { delay: 10 }]]))
    try {
      await new NativeCodingLoop({ store, provider: fake.provider, tools: scripted.tools }).runBatch('session')
      expect(scripted.peak()).toBe(1)
      expect(toolResults((await store.getNativeCodingSession('session'))!)).toEqual(['r1', 'r2', 'stop'])
    } finally { await store.close() }
  }
})
