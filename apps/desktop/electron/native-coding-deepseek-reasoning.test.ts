// @vitest-environment node
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createOpenAiCompatibleAgentProvider, type AgentProvider, type ProviderThinkingConfiguration } from '@ai-devflow/shared'
import { codingHarnessFixture } from './native-coding-test-fixture'
import { createNativeCodingExecutorV3 } from './native-coding-harness'
import { createLocalStore } from './local-store'

type WireMessage = { role: string; content: string | null; reasoning_content?: unknown; tool_calls?: unknown[] }
type WireBody = { thinking?: { type: string }; messages: WireMessage[]; tools?: Array<{ function: { name: string } }> }
/** reasoning null: the provider sends no reasoning_content at all. */
type Turn = { reasoning: string | null; content?: string; call?: [name: string, args: unknown]; json?: boolean }

/**
 * Only the HTTP endpoint is fake. It applies DeepSeek's thinking-mode rule: a request with tools must
 * send back reasoning_content on every earlier assistant message, including turns without tool calls,
 * or the API answers 400. Thinking is on unless the request disables it.
 */
function fakeDeepSeek(script: (body: WireBody) => Turn) {
  const requests: WireBody[] = [], rejected: WireBody[] = []
  let replies = 0
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as WireBody
    requests.push(body)
    if (body.thinking?.type !== 'disabled' && body.tools?.length && body.messages.some(message => message.role === 'assistant' && typeof message.reasoning_content !== 'string')) {
      rejected.push(body)
      return Response.json({ error: { message: 'The reasoning_content in the thinking mode must be passed back to the API.', type: 'invalid_request_error', param: null, code: 'invalid_request_error' } }, { status: 400 })
    }
    const turn = script(body), id = `chatcmpl-${++replies}`, finish = turn.call ? 'tool_calls' : 'stop'
    const call = turn.call && { index: 0, id: `call_${replies}`, type: 'function', function: { name: turn.call[0], arguments: JSON.stringify(turn.call[1]) } }
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 }
    const reasoning = turn.reasoning === null ? {} : { reasoning_content: turn.reasoning }
    if (turn.json) {
      const { index: _index, ...message } = call ?? { index: 0 }
      return Response.json({ id, object: 'chat.completion', usage, choices: [{ index: 0, finish_reason: finish,
        message: { role: 'assistant', content: turn.content ?? null, ...reasoning, ...(call ? { tool_calls: [message] } : {}) } }] })
    }
    const deltas = [{ role: 'assistant', content: null, ...reasoning }, ...(turn.content ? [{ content: turn.content, reasoning_content: null }] : []), ...(call ? [{ tool_calls: [call] }] : [])]
    const frames = [...deltas.map(delta => ({ choices: [{ index: 0, delta }] })), { choices: [{ index: 0, delta: {}, finish_reason: finish }] }, { choices: [], usage }]
    return new Response(`${frames.map(frame => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', ...frame })}\n\n`).join('')}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetcher, requests, rejected }
}
const deepseek = (fetcher: typeof fetch, thinking: ProviderThinkingConfiguration = { mode: 'enabled', effort: 'high' }) =>
  createOpenAiCompatibleAgentProvider({ id: 'deepseek', model: 'deepseek-flash', apiKey: 'fixture-only', baseUrl: 'https://api.deepseek.com', thinking, fetcher })
const assistants = (body: WireBody) => body.messages.filter(message => message.role === 'assistant')
const toolResults = (body: WireBody) => body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content!) as Record<string, unknown>)
const isChild = (body: WireBody) => body.messages[1]?.content?.includes('rootObjective') === true
const compaction = (body: WireBody) => body.tools?.length === 1 && body.tools[0]!.function.name === 'compact_context'
const harness = (provider: AgentProvider) => codingHarnessFixture(provider.completeNativeConversation!, undefined, provider)
const tools = [{ type: 'function' as const, function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: {} } } }]

it('the fake endpoint answers 400 when an earlier assistant turn lacks reasoning_content, including a turn without tool calls', async () => {
  const fake = fakeDeepSeek(() => ({ reasoning: 'ok', content: 'Done.' }))
  const provider = deepseek(fake.fetcher)
  const request = (assistant: object) => ({ systemPrompt: 'coding', tools, messages: [
    { role: 'user' as const, content: 'Inspect value.ts' }, { role: 'assistant' as const, content: 'Plain progress without a tool call.', ...assistant }, { role: 'user' as const, content: 'Continue' }] })
  await expect(provider.completeNativeConversation!(request({}))).rejects.toMatchObject({ httpStatus: 400, deliveryState: 'response_received' })
  await expect(provider.completeNativeConversation!(request({ reasoning_content: '' }))).resolves.toMatchObject({ kind: 'text', text: 'Done.' })
  expect(fake.rejected).toHaveLength(1)
})

it('sends back every earlier reasoning_content across tool turns, a turn without tool calls, an empty reasoning and a restart from storage', async () => {
  // Longer than 16 KB, so the stored session keeps it in a separate content file.
  const long = 'Read value.ts before deciding anything. '.repeat(500)
  const fake = fakeDeepSeek(body => {
    const turn = assistants(body).length
    if (turn === 0) return { reasoning: long, call: ['read_file', { path: 'value.ts' }] }
    if (turn === 1) return { reasoning: '', content: 'value.ts exports 1; asking before proposing anything.' }
    if (turn === 2) return { reasoning: 'Ask whether the value must stay.', call: ['request_user_input', { text: 'Keep value as 1?' }] }
    return { reasoning: 'The human confirmed; nothing to change.', call: ['propose_changeset', { summary: 'No change needed' }] }
  })
  const fixture = await harness(deepseek(fake.fetcher))
  let store = fixture.store, executor = fixture.executor
  const get = async () => (await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})).snapshot
  try {
    await fixture.authorize(); await executor.settled('coding')
    expect((await get()).status).toBe('waiting_input')
    await executor.shutdown(); await store.close()
    store = await createLocalStore({ dbPath: path.join(fixture.root, 'local.sqlite') })
    executor = createNativeCodingExecutorV3({ store, root: path.join(fixture.root, 'harness'), configVersion: 1, provider: fixture.provider })
    const waiting = await get()
    await executor.harness!.command({ protocolVersion: 2, type: 'reply', codingRunId: 'coding', commandId: 'answer', expectedVersion: waiting.version, objectiveVersion: waiting.objectiveVersion, questionId: waiting.question!.id, text: 'Yes, keep it.' }, async () => {})
    await executor.settled('coding')
    const review = await get()
    expect(review.status, JSON.stringify(review)).toBe('review')
    expect(fake.rejected).toEqual([])
    expect(fake.requests).toHaveLength(4)
    const afterRestart = assistants(fake.requests[3]!)
    expect(afterRestart.map(message => message.reasoning_content)).toEqual([long, '', 'Ask whether the value must stay.'])
    expect(afterRestart[1]).toMatchObject({ content: 'value.ts exports 1; asking before proposing anything.' })
    expect(afterRestart[1]).not.toHaveProperty('tool_calls')
    const saved = (await store.getNativeCodingSession('native-coding'))!.transcript.filter(message => message.role === 'assistant')
    expect(saved.map(message => message.reasoning_content)).toEqual([long, '', 'Ask whether the value must stay.', 'The human confirmed; nothing to change.'])
  } finally { await executor.shutdown(); await store.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 20000)

it('keeps reasoning_content on the assistant turns that survive compaction', async () => {
  let steps = 0, summaries = 0
  const fake = fakeDeepSeek(body => {
    if (compaction(body)) return { reasoning: `Summary ${++summaries}.`, call: ['compact_context', { summary: 'Earlier steps read value.ts; it exports 1.' }] }
    steps++
    // Finish only once a request after compaction carries kept assistant turns.
    if (summaries && assistants(body).length >= 2) return { reasoning: 'Enough evidence.', call: ['propose_changeset', { summary: 'No change needed' }] }
    return { reasoning: `Step ${steps}: ${'weighing the next read. '.repeat(160)}`, call: ['read_file', { path: 'value.ts', limit: steps }] }
  })
  const wire = deepseek(fake.fetcher)
  // A small input capacity makes the real loop compact after a few steps; the wire request itself is unchanged.
  const fixture = await harness({ ...wire, resolveRequestPolicy: input => ({ ...wire.resolveRequestPolicy!(input), maxInputBytes: 48_000 }) })
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    expect(review.status, JSON.stringify(review)).toBe('review')
    expect(fake.rejected).toEqual([])
    const session = (await fixture.store.getNativeCodingSession('native-coding'))!
    expect(session.compactions.length).toBeGreaterThan(0)
    const after = fake.requests.filter(body => !compaction(body)).at(-1)!
    const kept = session.transcript.slice(session.compactions.at(-1)!.through).filter(message => message.role === 'assistant')
    // The last kept assistant turn is the proposal itself, which is not in the request that produced it.
    expect(assistants(after).length).toBeGreaterThanOrEqual(2)
    expect(assistants(after).map(message => message.reasoning_content)).toEqual(kept.slice(0, -1).map(message => message.reasoning_content))
    expect(assistants(after).length).toBeLessThan(session.transcript.filter(message => message.role === 'assistant').length - 1)
    expect(assistants(after).every(message => typeof message.reasoning_content === 'string' && message.reasoning_content.startsWith('Step '))).toBe(true)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 20000)

it('sends back reasoning_content in a delegated child’s own history and in the parent after collecting it', async () => {
  const fake = fakeDeepSeek(body => {
    const results = toolResults(body)
    if (isChild(body)) {
      const turn = assistants(body).length
      if (turn === 0) return { reasoning: 'Child: read the file.', call: ['read_file', { path: 'value.ts' }] }
      if (turn === 1) return { reasoning: 'Child: note without a tool call.', content: 'value.ts exports 1.' }
      return { reasoning: 'Child: report.', call: ['report_findings', { summary: 'value.ts exports 1', sources: ['value.ts'] }] }
    }
    if (!results.length) return { reasoning: 'Parent: delegate the inspection.', call: ['delegate_task', { title: 'Inspect value', prompt: 'Read value.ts and report its value', mode: 'read_only', paths: [], maxTokens: 1000, maxCostUsd: 0.1 }] }
    if (!results.some(result => result.findings)) return { reasoning: 'Parent: wait for the child.', call: ['await_task', { codingRunId: results[0]!.codingRunId }] }
    return { reasoning: 'Parent: findings reviewed.', call: ['propose_changeset', { summary: 'Child confirmed value is 1; no change needed' }] }
  })
  const fixture = await harness(deepseek(fake.fetcher))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    for (const child of (await fixture.get()).snapshot.children) await fixture.executor.settled(child.id)
    await fixture.executor.settled('coding')
    const review = (await fixture.get()).snapshot
    expect(review.status, JSON.stringify(review)).toBe('review')
    expect(fake.rejected).toEqual([])
    const child = fake.requests.filter(isChild), parent = fake.requests.filter(body => !isChild(body))
    expect(child).toHaveLength(3)
    expect(assistants(child.at(-1)!).map(message => message.reasoning_content)).toEqual(['Child: read the file.', 'Child: note without a tool call.'])
    const parentTurns = assistants(parent.at(-1)!).map(message => message.reasoning_content)
    expect(parentTurns[0]).toBe('Parent: delegate the inspection.')
    expect(parentTurns.slice(1).every(reasoning => reasoning === 'Parent: wait for the child.')).toBe(true)
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 20000)

it('keeps an empty reasoning string as returned and never adds the field when the provider sends none', async () => {
  const replies: Turn[] = [{ reasoning: '', content: 'streamed' }, { reasoning: '', content: 'json', json: true }, { reasoning: null, content: 'json without reasoning', json: true }]
  const fake = fakeDeepSeek(() => replies.shift()!)
  const provider = deepseek(fake.fetcher)
  const ask = async () => (await provider.completeNativeConversation!({ systemPrompt: 'coding', tools: [], messages: [{ role: 'user', content: 'Inspect value.ts' }] })).assistantMessage
  expect(await ask()).toEqual({ role: 'assistant', content: 'streamed', reasoning_content: '' })
  expect(await ask()).toEqual({ role: 'assistant', content: 'json', reasoning_content: '' })
  expect(await ask()).toEqual({ role: 'assistant', content: 'json without reasoning' })
  // Thinking off: DeepSeek sends no reasoning, so neither the session nor any later request carries the field.
  const plain = fakeDeepSeek(body => assistants(body).length
    ? { reasoning: null, call: ['propose_changeset', { summary: 'No change needed' }] }
    : { reasoning: null, call: ['read_file', { path: 'value.ts' }] })
  const fixture = await harness(deepseek(plain.fetcher, { mode: 'disabled' }))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    expect((await fixture.get()).snapshot.status).toBe('review')
    expect(plain.requests.map(body => body.thinking)).toEqual([{ type: 'disabled' }, { type: 'disabled' }])
    expect(assistants(plain.requests[1]!)).toHaveLength(1)
    expect(assistants(plain.requests[1]!)[0]).not.toHaveProperty('reasoning_content')
    const saved = (await fixture.store.getNativeCodingSession('native-coding'))!.transcript.filter(message => message.role === 'assistant')
    expect(saved).toHaveLength(2)
    for (const message of saved) expect(message).not.toHaveProperty('reasoning_content')
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
}, 20000)
