// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AgentProviderRequestError, createFakeAgentProvider, createOpenAiCompatibleAgentProvider, governAgentProvider, type AgentProvider, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement, type NativeConversationRequest, type NativeToolCall, type NativeToolMessage } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { createNativeCodingSession } from './native-coding-session'
import { NativeCodingLoop, type CodingLoopTools } from './native-coding-loop'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function sessionStore(objective = 'Fix the value') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-model-retry-')); directories.push(directory)
  const dbPath = path.join(directory, 'local.sqlite'), store = await createLocalStore({ dbPath }), now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: directory, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
  await store.saveNativeCodingSession(createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'run', workflowRunId: 'workflow', nodeId: 'build', objective, providerId: 'deepseek', model: 'deepseek-flash', now }), 0)
  return { store, dbPath }
}

// The DeepSeek wire protocol is real; only the network is scripted.
type Reply = Response | Error | 'hang'
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const httpError = (status: number, headers: Record<string, string> = {}) => json(status, { error: { message: 'PRIVATE_PROVIDER_DETAIL' } }, headers)
let replyId = 0
const blocked = () => json(200, { id: `response-${++replyId}`, choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
  tool_calls: [{ id: `call-${replyId}`, type: 'function', function: { name: 'report_blocked', arguments: JSON.stringify({ reason: 'scripted stop' }) } }] } }] })
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) })
function scripted(replies: Reply[]) {
  const sent: number[] = []
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const reply = replies.shift(); sent.push(Date.now())
    if (!reply) throw new Error('Unexpected model request')
    if (reply === 'hang') return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
    if (reply instanceof Error) throw reply
    return reply
  }) as typeof fetch
  return { fetcher, sent }
}
function ledger() {
  const reservations: ModelCallQuote[] = [], settlements: ModelCallSettlement[] = []
  const governance: ModelCallGovernance = {
    reserve: async quote => { reservations.push(quote); return { accepted: true, decision: { status: 'allowed', blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 0, reason: 'fixture' } } },
    settle: async settlement => { settlements.push(settlement) }, persist: async () => {}, pending: async () => [],
  }
  return { governance, reservations, settlements }
}
const noTools: CodingLoopTools = { definitions: [], effects: {}, execute: async () => { throw new Error('No tool expected') } }
function deepSeek(fetcher: typeof fetch, timeoutMs?: number) {
  const accounts = ledger()
  const raw = createOpenAiCompatibleAgentProvider({ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', apiKey: 'fixture-key', baseUrl: 'https://api.deepseek.com', fetcher, ...(timeoutMs ? { structuredRequestTimeoutMs: timeoutMs } : {}) })
  return { provider: governAgentProvider(raw, 'project', accounts.governance), ...accounts }
}
async function runWith(replies: Reply[], timeoutMs?: number) {
  const { store } = await sessionStore(), network = scripted(replies), model = deepSeek(network.fetcher, timeoutMs), waits: number[] = []
  const loop = new NativeCodingLoop({ store, provider: model.provider, tools: noTools, sleep: async milliseconds => { waits.push(milliseconds) } })
  try {
    await loop.runBatch('session')
    return { session: (await store.getNativeCodingSession('session'))!, waits, sent: network.sent.length, ...model }
  } finally { await store.close() }
}
const within = (value: number, nominal: number) => value >= nominal * 0.9 && value <= nominal * 1.1

it('honours Retry-After on a 429 and re-sends the same step under a new reservation', async () => {
  const result = await runWith([httpError(429, { 'retry-after': '7' }), blocked()])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'scripted stop', steps: 1 })
  // The wait runs to the saved notBefore, so time spent recording the failure is part of it.
  expect(result.waits).toHaveLength(1); expect(result.waits[0]).toBeGreaterThan(6000); expect(result.waits[0]).toBeLessThanOrEqual(7000)
  const [first, second] = result.session.attempts
  expect(first).toMatchObject({ status: 'completed', step: 1, retry: { reason: 'rate_limited', number: 1, limit: 5, delayMs: 7000, retryAfterMs: 7000 } })
  expect(second).toMatchObject({ status: 'completed', step: 1, retryOf: first!.id })
  expect(second!.operationKey).toBe(first!.operationKey)
  expect(result.reservations.map(quote => quote.id)).toEqual([first!.id, second!.id])
  expect(result.settlements.map(item => [item.id, item.state])).toEqual([[first!.id, 'not_sent'], [second!.id, 'completed']])
})

it('backs off a 429 without Retry-After five times, then pauses with its own reason', async () => {
  const result = await runWith(Array.from({ length: 6 }, () => httpError(429)))
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'provider_unavailable', steps: 1 })
  expect(result.sent).toBe(6)
  expect(result.waits).toHaveLength(5)
  const delays = result.session.attempts.flatMap(attempt => attempt.retry ? [attempt.retry.delayMs] : [])
  delays.forEach((delay, index) => expect(within(delay, 1000 * 2 ** index), `delay ${index + 1}: ${delay}`).toBe(true))
  result.waits.forEach((wait, index) => expect(wait).toBeLessThanOrEqual(delays[index]!))
  expect(result.session.attempts.map(attempt => attempt.retry?.number ?? null)).toEqual([1, 2, 3, 4, 5, null])
  expect(result.session.attempts.slice(1).map(attempt => attempt.retryOf)).toEqual(result.session.attempts.slice(0, -1).map(attempt => attempt.id))
  expect(result.reservations.map(quote => quote.id)).toEqual(result.session.attempts.map(attempt => attempt.id))
  expect(new Set(result.session.attempts.map(attempt => attempt.step))).toEqual(new Set([1]))
})

it('leaves a Retry-After longer than one bounded wait to a human instead of re-sending early', async () => {
  const result = await runWith([httpError(429, { 'retry-after': '120' })])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'provider_unavailable' })
  expect(result.waits).toEqual([]); expect(result.sent).toBe(1)
})

it('treats a DeepSeek 503 as an unbilled overload and re-sends it', async () => {
  const result = await runWith([httpError(503), httpError(503), blocked()])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'scripted stop', steps: 1 })
  expect(result.session.attempts.map(attempt => attempt.retry?.reason ?? null)).toEqual(['overloaded', 'overloaded', null])
  expect(result.settlements.map(item => item.state)).toEqual(['not_sent', 'not_sent', 'completed'])
  expect(result.reservations).toHaveLength(3)
})

it('re-sends other 5xx at most twice, each with its own reservation', async () => {
  const result = await runWith([httpError(500), httpError(500), httpError(500)])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'provider_unavailable', steps: 1 })
  expect(result.session.attempts.map(attempt => attempt.retry ? [attempt.retry.reason, attempt.retry.number, attempt.retry.limit] : null)).toEqual([['server_error', 1, 2], ['server_error', 2, 2], null])
  expect(within(result.session.attempts[0]!.retry!.delayMs, 1000) && within(result.session.attempts[1]!.retry!.delayMs, 2000)).toBe(true)
  expect(result.waits).toHaveLength(2)
  // Billing for these failures is unknown, so every reservation stays held as a failed call.
  expect(result.settlements.map(item => item.state)).toEqual(['failed', 'failed', 'failed'])
  expect(result.reservations.map(quote => quote.id)).toEqual(result.session.attempts.map(attempt => attempt.id))
})

it.each([
  [402, 'provider_insufficient_balance'],
  [401, 'provider_authentication_failed'],
] as const)('pauses an HTTP %i with its own reason and never re-sends it', async (status, reason) => {
  const result = await runWith([httpError(status)])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: reason })
  expect(result.session.attempts).toHaveLength(1); expect(result.session.attempts[0]!.retry).toBeUndefined()
  expect(result.sent).toBe(1); expect(result.waits).toEqual([])
})

it('re-sends a request whose connection was refused before anything was sent', async () => {
  const result = await runWith([refused(), blocked()])
  expect(result.session).toMatchObject({ status: 'paused', pauseReason: 'scripted stop', steps: 1 })
  expect(result.session.attempts.map(attempt => attempt.status)).toEqual(['not_sent', 'completed'])
  expect(result.session.attempts[0]!.retry).toMatchObject({ reason: 'connection_not_sent', number: 1, limit: 5 })
  expect(result.settlements.map(item => item.state)).toEqual(['not_sent', 'completed'])
})

it('keeps a timeout after sending in reconciliation and never re-sends it automatically', async () => {
  const result = await runWith(['hang', blocked()], 50)
  expect(result.session).toMatchObject({ status: 'reconciling', pauseReason: 'model_delivery_unknown' })
  expect(result.session.attempts.map(attempt => attempt.status)).toEqual(['unknown'])
  expect(result.session.attempts[0]!.retry).toBeUndefined()
  expect(result.sent).toBe(1); expect(result.waits).toEqual([])
})

it('resumes a backoff after a restart without sending the failed step twice', async () => {
  const { store, dbPath } = await sessionStore(), network = scripted([httpError(429, { 'retry-after': '30' }), blocked()]), model = deepSeek(network.fetcher)
  let slept = false
  // The first writer stops for good inside its backoff, as a killed process would.
  const crashed = new NativeCodingLoop({ store, provider: model.provider, tools: noTools, sleep: () => { slept = true; return new Promise<void>(() => {}) } })
  void crashed.runBatch('session').catch(() => undefined)
  await expect.poll(() => slept).toBe(true)
  const scheduled = (await store.getNativeCodingSession('session'))!
  expect(scheduled.status).toBe('running'); expect(scheduled.attempts.at(-1)!.retry).toMatchObject({ reason: 'rate_limited', delayMs: 30000 })
  await store.close()
  const reopened = await createLocalStore({ dbPath }), waits: number[] = []
  try {
    const restarted = new NativeCodingLoop({ store: reopened, provider: model.provider, tools: noTools, stopPreviousWorker: async () => true, sleep: async milliseconds => { waits.push(milliseconds) } })
    expect(await restarted.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'scripted stop', steps: 1 })
    // Only the remainder of the saved wait is repeated, and the step is sent exactly once more.
    expect(waits).toHaveLength(1); expect(waits[0]).toBeGreaterThan(0); expect(waits[0]).toBeLessThanOrEqual(30000)
    expect(network.sent).toHaveLength(2)
    const saved = (await reopened.getNativeCodingSession('session'))!
    expect(saved.attempts.map(attempt => [attempt.status, attempt.retryOf ?? null])).toEqual([['completed', null], ['completed', saved.attempts[0]!.id]])
    expect(model.reservations.map(quote => quote.id)).toEqual(saved.attempts.map(attempt => attempt.id))
  } finally { await reopened.close() }
})

it('does not re-send a retry whose delivery became unknown when the process stopped', async () => {
  // The re-send hangs until the provider deadline; by then this writer's store is closed.
  const { store, dbPath } = await sessionStore(), network = scripted([httpError(503), 'hang']), model = deepSeek(network.fetcher, 3000)
  const crashed = new NativeCodingLoop({ store, provider: model.provider, tools: noTools, sleep: async () => {} })
  void crashed.runBatch('session').catch(() => undefined)
  // The loop sends only after the started attempt reached disk; stop once the re-send is in flight.
  await expect.poll(() => network.sent.length).toBe(2)
  await store.close()
  const reopened = await createLocalStore({ dbPath })
  try {
    expect((await reopened.getNativeCodingSession('session'))!.attempts.map(attempt => attempt.status)).toEqual(['completed', 'started'])
    const restarted = new NativeCodingLoop({ store: reopened, provider: model.provider, tools: noTools, stopPreviousWorker: async () => true, sleep: async () => {} })
    expect(await restarted.runBatch('session')).toMatchObject({ status: 'reconciling', pauseReason: 'model_delivery_unknown' })
    expect(network.sent).toHaveLength(2)
  } finally { await reopened.close() }
})

it('shows each automatic re-send in the harness snapshot without counting it as a step', async () => {
  let calls = 0
  const fixture = await codingHarnessFixture(async () => {
    if (++calls === 1) throw new AgentProviderRequestError({ code: 'http_429', httpStatus: 429, deliveryState: 'response_received', billingState: 'not_incurred', retryable: true, sanitizedCause: 'provider_rate_limited', responseMetadata: { httpStatus: 429, retryAfterMs: 20 } })
    return codingToolReply('freeze', 'propose_changeset', { summary: 'No change needed' })
  })
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    expect(view.status, JSON.stringify(view)).toBe('review'); expect(view.steps).toBe(2); expect(calls).toBe(2) // One acceptance-author step plus one retried coding step.
    expect(view.modelRetries).toEqual({ total: 1, recent: [expect.objectContaining({ reason: 'rate_limited', number: 1, limit: 5, delayMs: 20, retryAfterMs: 20, pending: false })] })
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

// Model replies are scripted here; batch rejection and nudges are host decisions.
function scriptedModel(replies: Array<(request: NativeConversationRequest) => Awaited<ReturnType<NonNullable<AgentProvider['completeNativeConversation']>>>>) {
  const requests: Array<{ messages: NativeToolMessage[] }> = []
  const provider: AgentProvider = { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input), completeNativeConversation: async request => {
    requests.push({ messages: structuredClone(request.messages) })
    const reply = replies.shift()
    if (!reply) throw new Error('Unexpected model request')
    return reply(request)
  } }
  return { provider, requests }
}
const call = (id: string, name: string, args: unknown) => {
  const toolCalls: NativeToolCall[] = [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls }, usage: { inputTokens: 40, outputTokens: 4 } }
}
const discover: CodingLoopTools = { definitions: [{ type: 'function', function: { name: 'discover', description: '', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }], effects: { discover: 'read' }, execute: async () => ({ unchanged: true }) }
const notice = '[DevFlow 宿主状态通知，并非用户的新指令]'

it.each(['placeholder', ' PLACEHOLDER. ', 'TODO', '占位符', '   '])('corrects the non-substantive blocker %j and preserves received-call accounting', async reason => {
  const { store } = await sessionStore()
  const model = scriptedModel([
    () => call('invalid-blocker', 'report_blocked', { reason }),
    () => call('inspect', 'discover', {}),
    () => call('real-blocker', 'report_blocked', { reason: 'API key missing' }),
  ])
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools: discover })
    const saved = await loop.runBatch('session')
    expect(saved).toMatchObject({ status: 'paused', pauseReason: 'API key missing', steps: 3 })
    expect(model.requests[1]!.messages.at(-1)!.content).toContain('concrete obstacle')
    expect(saved.attempts).toHaveLength(3)
    expect(saved.attempts.every(attempt => attempt.status === 'completed' && attempt.usage?.inputTokens === 40)).toBe(true)
    expect(saved.invalidToolBatches).toBeUndefined()
    expect(saved.transcript.find(message => message.role === 'tool' && message.tool_call_id === 'invalid-blocker')?.content).toContain('"executed":false')
  } finally { await store.close() }
})

it('pauses after two consecutive placeholder blockers instead of correcting them without a bound', async () => {
  const { store } = await sessionStore()
  const model = scriptedModel([
    () => call('placeholder-1', 'report_blocked', { reason: 'placeholder' }),
    () => call('placeholder-2', 'report_blocked', { reason: 'placeholder' }),
  ])
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools: discover })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'invalid_tool_batch', steps: 2, invalidToolBatches: 2 })
    expect(model.requests).toHaveLength(2)
  } finally { await store.close() }
})

it('continues the normal executor after a placeholder blocker and still requires actual revision approval', async () => {
  let calls = 0
  const fixture = await codingHarnessFixture(async () => ++calls === 1
    ? codingToolReply('placeholder', 'report_blocked', { reason: 'placeholder' })
    : codingToolReply('submit', 'propose_changeset', { summary: 'Submit the real workspace' }))
  try {
    await fixture.authorize(); await fixture.executor.settled('coding')
    const view = (await fixture.get()).snapshot
    expect(view.status).toBe('review')
    expect(calls).toBe(2)
    const approved = await fixture.executor.harness!.command({ protocolVersion: 2, type: 'approve', codingRunId: 'coding', commandId: 'review',
      expectedVersion: view.version, objectiveVersion: view.objectiveVersion, revisionDigest: view.revision!.digest, confirmedCriteria: [] }, async () => {})
    expect(approved.snapshot.status).toBe('completed')
  } finally { await fixture.executor.shutdown(); await fixture.store.close(); await rm(fixture.root, { recursive: true, force: true }) }
})

it('explains an invalid tool batch once and continues when the next batch is valid', async () => {
  const { store } = await sessionStore()
  const model = scriptedModel([
    () => { throw new AgentProviderRequestError({ code: 'invalid_model_output', httpStatus: 200, deliveryState: 'response_received', billingState: 'confirmed', retryable: true, sanitizedCause: 'invalid_tool_batch', usage: { inputTokens: 50, outputTokens: 5 }, cause: new Error('Invalid native call identity') }) },
    () => call('stop', 'report_blocked', { reason: 'scripted stop' }),
  ])
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools: discover })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'scripted stop', steps: 2 })
    const explanation = String(model.requests[1]!.messages.at(-1)!.content)
    expect(explanation.startsWith(notice)).toBe(true); expect(explanation).toContain('工具必须是已声明的工具')
    const saved = (await store.getNativeCodingSession('session'))!
    expect(saved.transcript.filter(message => message.role === 'user' && message.content.startsWith(notice))).toHaveLength(1)
    expect(saved.attempts[0]).toMatchObject({ status: 'completed', usage: { inputTokens: 50, outputTokens: 5 } })
    expect(saved.invalidToolBatches).toBeUndefined()
  } finally { await store.close() }
})

it('pauses when the batch after the explanation is invalid too', async () => {
  const { store } = await sessionStore()
  const model = scriptedModel([
    () => call('shell', 'bash', { command: 'ls' }),
    () => call('stop', 'report_blocked', {}),
  ])
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools: discover })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'invalid_tool_batch' })
    expect(model.requests).toHaveLength(2)
    const saved = (await store.getNativeCodingSession('session'))!
    // The undeclared call never entered the history; the schema-invalid one is closed without running.
    expect(JSON.stringify(saved.transcript)).not.toContain('"bash"')
    expect(saved.transcript.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'stop' })
    expect(JSON.parse(String(saved.transcript.at(-1)!.content))).toMatchObject({ executed: false })
  } finally { await store.close() }
})

it.each([
  ['search_text', 'contextLines', 5, 10],
  ['read_command', 'waitMs', 30000, 120000],
] as const)('repairs the observed %s bound violation without running any call in the invalid batch', async (name, field, maximum, invalid) => {
  const { store } = await sessionStore(), executed: Array<{ name: string; args: Record<string, unknown> }> = []
  const tools: CodingLoopTools = { ...discover, definitions: [...discover.definitions, { type: 'function', function: { name, description: '', parameters: { type: 'object', properties: { [field]: { type: 'integer', minimum: 0, maximum } }, required: [field], additionalProperties: false } } }],
    effects: { ...discover.effects, [name]: 'read' }, execute: async (tool, args) => { executed.push({ name: tool, args }); return { passed: true } } }
  const model = scriptedModel([
    () => {
      const first = call('safe', 'discover', {}), second = call('invalid', name, { [field]: invalid })
      const toolCalls = [...first.toolCalls, ...second.toolCalls]
      return { ...first, toolCalls, assistantMessage: { ...first.assistantMessage, tool_calls: toolCalls } }
    },
    request => {
      expect(executed).toEqual([])
      const errors = request.messages.filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)))
      expect(errors).toHaveLength(2)
      errors.forEach(error => expect(error).toMatchObject({ executed: false, error: `Invalid tool batch: ${name} $.${field} must be <= ${maximum}` }))
      return call('corrected', name, { [field]: maximum })
    },
    () => call('stop', 'report_blocked', { reason: 'scripted stop' }),
  ])
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'scripted stop' })
    expect(executed).toEqual([{ name, args: { [field]: maximum } }])
    expect((await store.getNativeCodingSession('session'))!.invalidToolBatches).toBeUndefined()
  } finally { await store.close() }
})

it('nudges once after repeated identical steps and pauses only when the step repeats again', async () => {
  const { store } = await sessionStore()
  let sequence = 0
  const model = scriptedModel(Array.from({ length: 12 }, () => () => call(`read-${++sequence}`, 'discover', {})))
  try {
    const loop = new NativeCodingLoop({ store, provider: model.provider, tools: discover })
    expect(await loop.runBatch('session')).toMatchObject({ status: 'paused', pauseReason: 'no_progress' })
    // Eight identical results make the fingerprint stable; the third repeat warns and the fourth pauses.
    expect(model.requests).toHaveLength(12)
    const saved = (await store.getNativeCodingSession('session'))!
    const nudges = saved.transcript.flatMap((message, index) => message.role === 'user' && message.content.startsWith(notice) ? [index] : [])
    expect(nudges).toHaveLength(1)
    expect(saved.transcript[nudges[0]! - 1]).toMatchObject({ role: 'tool', tool_call_id: 'read-11' })
    expect(String(model.requests[11]!.messages.at(-1)!.content).startsWith(notice)).toBe(true)
    expect(saved.progressNudge).toMatchObject({ delivered: true })
  } finally { await store.close() }
})
