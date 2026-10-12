// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createLocalStore } from './local-store'
import { createNativeCodingSession, updateNativeCodingSession } from './native-coding-session'
import { NativeCodingLoop } from './native-coding-loop'
import { createFakeAgentProvider, type NativeToolCall } from '@ai-devflow/shared'

const directories: string[] = []
it('keeps a coding question and history through restart, accepting only one competing checkpoint', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-coding-session-'))
  directories.push(directory)
  const dbPath = path.join(directory, 'local.sqlite')
  const store = await createLocalStore({ dbPath })
  const now = '2026-10-11T12:00:00.000Z'
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  const session = createNativeCodingSession({ id: 'coding-session', localProjectId: 'project', codingRunId: 'coding-run', workflowRunId: 'run', nodeId: 'build', objective: 'Fix cancellation', providerId: 'deepseek', model: 'deepseek-flash', now })
  expect(await store.saveNativeCodingSession(session, 0)).toBe(true)
  const waiting = updateNativeCodingSession(session, now, draft => {
    draft.status = 'waiting_input'
    draft.question = { id: 'question-1', toolCallId: 'ask-1', text: 'Should cancellation preserve staged changes?', options: ['Preserve', 'Discard'], objectiveVersion: 1 }
    draft.transcript.push({ role: 'assistant', content: null, reasoning_content: 'private'.repeat(5000), tool_calls: [{ id: 'ask-1', type: 'function', function: { name: 'request_user_input', arguments: '{"text":"Should cancellation preserve staged changes?"}' } }] })
  })
  const competing = updateNativeCodingSession(session, now, draft => { draft.status = 'paused'; draft.pauseReason = 'user' })
  expect(await Promise.all([store.saveNativeCodingSession(waiting, 1), store.saveNativeCodingSession(competing, 1)])).toEqual([true, false])
  await store.close()
  const reopened = await createLocalStore({ dbPath })
  expect(await reopened.getNativeCodingSession(session.id)).toEqual(waiting)
  expect((await reopened.listNativeCodingSessions('project')).map(item => item.id)).toEqual(['coding-session'])
  await reopened.close()
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

it('rejects a batched child wait before executing anything and closes both tool pairs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-child-wait-batch-')); directories.push(directory)
  const store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') }), now = new Date().toISOString()
  try {
    await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective: 'Wait for child', providerId: 'fake', model: 'test', now }), 0)
    let calls = 0
    const execute = vi.fn(async () => ({ pendingChild: 'child' }))
    const loop = new NativeCodingLoop({ store, provider: { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input), completeNativeConversation: async () => {
      const toolCalls: NativeToolCall[] = ++calls === 1 ? [
        { id: 'wait', type: 'function', function: { name: 'await_task', arguments: '{}' } },
        { id: 'read', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ] : [{ id: 'stop', type: 'function', function: { name: 'report_blocked', arguments: '{"reason":"Need to call await_task alone"}' } }]
      return { kind: 'tools', toolCalls, assistantMessage: { role: 'assistant', content: null, tool_calls: toolCalls } }
    } }, tools: { definitions: ['await_task', 'read_file'].map(name => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } })), effects: { await_task: 'read', read_file: 'read' }, execute } })
    const result = await loop.runBatch('session')
    expect(result.status).toBe('paused'); expect(execute).not.toHaveBeenCalled()
    const pairs = result.transcript.filter(message => message.role === 'tool' && ['wait', 'read'].includes(message.tool_call_id))
    expect(pairs).toHaveLength(2); expect(pairs.every(message => JSON.parse(message.content!).executed === false)).toBe(true)
  } finally { await store.close() }
})

it.each(['pause', 'cancel'] as const)('does not execute a late provider tool call after %s, while retaining usage', async action => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-late-response-')); directories.push(directory)
  const store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') }), now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective: 'Fix value', providerId: 'fake', model: 'test', now }), 0)
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const execute = vi.fn(async () => ({}))
  const toolCalls: NativeToolCall[] = [{ id: 'late', type: 'function', function: { name: 'write', arguments: '{}' } }]
  const loop = new NativeCodingLoop({ store, provider: { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input), completeNativeConversation: async () => { entered(); await blocked; return { kind: 'tools', toolCalls, assistantMessage: { role: 'assistant', content: null, tool_calls: toolCalls }, usage: { inputTokens: 13, outputTokens: 7 } } } }, tools: { definitions: [{ type: 'function', function: { name: 'write', description: '', parameters: { type: 'object' } } }], effects: { write: 'write' }, execute } })
  const running = loop.runBatch('session'); await started; await loop[action]('session'); release(); await running
  const result = (await store.getNativeCodingSession('session'))!
  expect(result.status).toBe(action === 'pause' ? 'paused' : 'cancelled'); expect(result.transcript).toHaveLength(1)
  expect(result.attempts[0]).toMatchObject({ status: 'completed', usage: { inputTokens: 13, outputTokens: 7 } }); expect(execute).not.toHaveBeenCalled()
  await store.close()
})

it('invalidates a frozen answer when steering arrived during its last tool', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-steer-review-')); directories.push(directory)
  const store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') }), now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective: 'Fix value', providerId: 'fake', model: 'test', now }), 0)
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const toolCalls: NativeToolCall[] = [{ id: 'freeze', type: 'function', function: { name: 'propose_changeset', arguments: '{}' } }]
  const loop = new NativeCodingLoop({ store, provider: { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input), completeNativeConversation: async () => ({ kind: 'tools', toolCalls, assistantMessage: { role: 'assistant', content: null, tool_calls: toolCalls } }) }, tools: { definitions: [{ type: 'function', function: { name: 'propose_changeset', description: '', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }], effects: { propose_changeset: 'write' }, execute: async () => { entered(); await blocked; return { revisionId: 'obsolete' } } } })
  const running = loop.runBatch('session'); await started; await loop.steer('session', { id: 'human-correction', text: 'Preserve the existing API' }); release(); await running
  expect(await store.getNativeCodingSession('session')).toMatchObject({ status: 'ready', objectiveVersion: 2, pendingInput: [] })
  await store.close()
})

it('continues native tool feedback past the initial investigation and resumes a question in the same run after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-coding-loop-')); directories.push(directory)
  const dbPath = path.join(directory, 'local.sqlite'), store = await createLocalStore({ dbPath })
  const now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective: 'Trace a dependency', providerId: 'fake', model: 'test', now }), 0)
  let turn = 0
  const call = (name: string, args: unknown) => {
    const toolCalls: NativeToolCall[] = [{ id: `call-${++turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
    return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls }, usage: { inputTokens: 10, outputTokens: 5 } }
  }
  const provider = { ...createFakeAgentProvider(), model: 'test', supportsNativeTools: true,
    serializeNativeRequest: (input: unknown) => JSON.stringify(input),
    completeNativeConversation: async (input: { messages: Array<{ role: string; content: string | null }> }) => {
      const results = input.messages.filter(message => message.role === 'tool')
      if (results.length < 4) return call('discover', { depth: results.length })
      if (results.length === 4) return call('request_user_input', { text: 'Which behavior is correct?', options: ['Preserve', 'Discard'] })
      expect(results.at(-1)?.content).toContain('Preserve')
      return call('report_blocked', { reason: 'Need an integration fixture' })
    } }
  const tools = { definitions: [{ type: 'function' as const, function: { name: 'discover', description: 'Find dependency', parameters: { type: 'object', properties: { depth: { type: 'integer', minimum: 0, maximum: 10 } }, required: ['depth'], additionalProperties: false } } }],
    execute: async (_name: string, args: Record<string, unknown>) => ({ nextPath: `level-${args.depth}/dependency.ts` }),
    effects: { discover: 'read' as const } }
  const first = new NativeCodingLoop({ store, provider, tools })
  const waiting = await first.runBatch('session')
  expect(waiting.status).toBe('waiting_input')
  expect(waiting.attempts).toHaveLength(5)
  await store.close()
  const reopened = await createLocalStore({ dbPath }), second = new NativeCodingLoop({ store: reopened, provider, tools })
  await second.replyInput('session', { id: 'answer-1', questionId: waiting.question!.id, objectiveVersion: 1, text: 'Preserve' })
  await second.replyInput('session', { id: 'answer-1', questionId: waiting.question!.id, objectiveVersion: 1, text: 'Preserve' })
  const paused = await second.runBatch('session')
  expect(paused).toMatchObject({ codingRunId: 'run', status: 'paused', pauseReason: 'Need an integration fixture' })
  expect(paused.transcript.filter(message => message.role === 'tool' && message.tool_call_id === waiting.question!.toolCallId)).toHaveLength(1)
  await reopened.close()
})
