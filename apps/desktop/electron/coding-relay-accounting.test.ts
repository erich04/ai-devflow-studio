// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { modelBudgetUsageWithRuntime, modelCostRecoveryOverview, type CodingAgentRun, type ModelCallAttempt, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { createGovernedOpencodeProxy } from './governed-opencode-proxy'
import { createCodingRelayCallContext } from './coding-relay-accounting'
import { buildRunUsageSummary } from '../src/app/run-usage-summary'
import { createCodingRuntime } from './coding-runtime'
import type { CodingEngineAdapter } from './coding-engine'

const binding = { providerId: 'deepseek', modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'fixture-key', fingerprint: 'fixture' }
const active: CodingAgentRun = {
  id: 'coding-parent', runId: 'workflow', nodeId: 'build', projectId: 'project', requestedBy: 'user',
  providerId: binding.providerId, engine: 'opencode-http', status: 'running', configVersion: 1,
  managedWorkspaceId: 'workspace', branchName: 'devflow/todo', userInstruction: 'Add a Todo', prompt: '', summary: 'Coding',
  startedAt: '2026-10-23T10:00:00.000Z', changedPaths: [], redacted: true,
}
const session = { codingRunId: active.id, workspaceId: active.managedWorkspaceId!, rootSessionId: 'root-session', sessionId: 'root-session' }
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop() })

async function fixture(fetcher: typeof fetch = async () => Response.json({ choices: [], usage }), assertContextCurrent?: () => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'devflow-coding-relay-test-'))
  const dbPath = path.join(directory, 'state.sqlite')
  const store = await createLocalStore({ dbPath })
  cleanup.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }) })
  await store.saveCodingAgentRun(active)
  const pending = new Map<string, ModelCallSettlement>()
  const governance = {
    reserve: vi.fn(async (_quote: ModelCallQuote) => ({ accepted: true, decision: { status: 'allowed' as const, blocksRun: false, currentSpendUsd: 0, projectedCostUsd: 1, reason: 'fixture' } })),
    settle: vi.fn(async (s: ModelCallSettlement) => { pending.delete(s.id) }),
    persist: async (s: ModelCallSettlement, metadata?: { final: boolean }) => {
      await store.saveModelCallSettlement(s, { final: metadata?.final ?? false, scope: {
        organizationId: 'organization', userId: active.requestedBy, teamProjectId: active.projectId, localProjectId: active.projectId,
      } })
      pending.set(s.id, s)
    }, pending: async () => [...pending.values()],
  } satisfies ModelCallGovernance
  const published = vi.fn()
  const publishedEvent = vi.fn()
  const upstream = vi.fn(fetcher)
  const scope = { store, projectId: active.projectId, providerId: binding.providerId, model: binding.modelId, configVersion: 1, session, publishRun: published, publishEvent: publishedEvent }
  const proxy = await createGovernedOpencodeProxy({ binding, projectId: active.projectId, governance, fetcher: upstream,
    ...(assertContextCurrent ? { assertContextCurrent } : {}),
    resolveCodingCall: (identity) => createCodingRelayCallContext({ ...scope, session: identity }),
  })
  cleanup.push(proxy.close)
  const send = (headers: Record<string, string> = {}) => fetch(`${proxy.binding.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${proxy.binding.apiKey}`, 'content-type': 'application/json', 'x-devflow-coding-run': active.id, 'x-devflow-workspace': active.managedWorkspaceId!, 'x-devflow-root-session': 'root-session', 'x-devflow-session': 'root-session', ...headers },
    body: JSON.stringify({ model: binding.modelId, messages: [{ role: 'user', content: 'PRIVATE_PROMPT_ONLY' }] }),
  })
  const run = async (source: LocalStore = store) => (await source.listCodingAgentRuns(active.runId)).find((r) => r.id === active.id)!
  return { store, dbPath, governance, published, publishedEvent, upstream, proxy, send, run, scope }
}

describe('OpenCode relay → Coding Run → header accounting', () => {
  it('rejects stale knowledge before reserving or recording a coding expense', async () => {
    const f = await fixture(undefined, async () => { throw new Error('knowledge changed') })
    const response = await f.send()
    expect(response.status).toBe(400)
    expect(f.proxy.failureForRequest(response.headers.get('x-devflow-relay-request')!, 0)?.code).toBe('evidence_invalid')
    expect(f.governance.reserve).not.toHaveBeenCalled()
    expect(f.upstream).not.toHaveBeenCalled()
    expect(await f.store.listCodingAgentEvents(active.id)).toEqual([])
    expect((await f.run()).runtimeCostSummary).toBeUndefined()
  })

  it('keeps a context invalidation after reservation non-billable and bound to the original attempt', async () => {
    let current = true
    const f = await fixture(undefined, async () => { if (!current) throw new Error('knowledge changed') })
    const reserve = f.governance.reserve.getMockImplementation()!
    f.governance.reserve.mockImplementationOnce(async (quote) => { current = false; return reserve(quote) })
    const response = await f.send()
    expect(response.status).toBe(400)
    expect(f.proxy.failureForRequest(response.headers.get('x-devflow-relay-request')!, 0)?.code).toBe('evidence_invalid')
    expect(f.upstream).not.toHaveBeenCalled()
    expect((await f.run()).runtimeCostSummary).toBeUndefined()
    const quote = f.governance.reserve.mock.calls[0]![0]
    const traces = (await f.store.listCodingAgentEvents(active.id)).map(event => event.metadata?.providerCall)
    expect(traces).toEqual([
      expect.objectContaining({ status: 'started', usage: expect.objectContaining({ budgetAttemptIds: [quote.id] }) }),
      expect.objectContaining({ status: 'failed', billingState: 'not_incurred', deliveryState: 'not_sent',
        usage: expect.objectContaining({ inputTokens: 0, outputTokens: 0, budgetAttemptIds: [quote.id] }) }),
    ])
  })

  it('retains a paid coding response exactly once when its knowledge context becomes stale', async () => {
    let current = true
    const f = await fixture(async () => { current = false; return Response.json({ choices: [], usage }) },
      async () => { if (!current) throw new Error('knowledge changed') })
    const response = await f.send()
    expect(response.status).toBe(400)
    expect(f.proxy.failureForRequest(response.headers.get('x-devflow-relay-request')!, 0)?.code).toBe('evidence_invalid')
    expect((await f.run()).runtimeCostSummary).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120, costStatus: 'settled' })
    expect(buildRunUsageSummary(active.runId, [], [await f.run()], []).tokenLabel).toBe('120')
    const events = await f.store.listCodingAgentEvents(active.id)
    expect(events.map(event => event.metadata?.providerCall)).toEqual([
      expect.objectContaining({ status: 'started' }),
      expect.objectContaining({ status: 'succeeded', billingState: 'confirmed' }),
    ])
    expect((await f.send()).status).toBe(400)
    expect(f.upstream).toHaveBeenCalledOnce()
    expect(f.governance.settle).toHaveBeenCalledOnce()
    expect(await f.store.listCodingAgentEvents(active.id)).toEqual(events)
    expect((await f.run()).runtimeCostSummary!.providerCallIds).toHaveLength(1)
  })

  it('records parent and child rounds under one operation, exactly once, and retains them through stale snapshots and reopen', async () => {
    const f = await fixture()
    expect((await f.send()).status).toBe(200)
    expect((await f.send({ 'x-devflow-session': 'child-session' })).status).toBe(200)
    const current = await f.run()
    expect(current.runtimeCostSummary).toMatchObject({ inputTokens: 200, outputTokens: 40, totalTokens: 240, source: 'provider_reported', costStatus: 'settled' })
    expect(current.runtimeCostSummary!.providerCallIds).toHaveLength(2)
    expect(new Set(current.runtimeCostSummary!.providerCallIds).size).toBe(2)
    expect(current.runtimeCostSummary!.budgetAttemptIds).toHaveLength(2)
    expect(f.governance.reserve.mock.calls.map(([quote]) => quote.operation?.id)).toEqual(['coding-coding-parent', 'coding-coding-parent'])
    const events = await f.store.listCodingAgentEvents(active.id)
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    await f.store.saveCodingAgentEvent({ ...events.at(-1)!, id: 'duplicate' })
    await f.store.saveCodingAgentRun({ ...active, status: 'completed' })
    expect((await f.run()).runtimeCostSummary).toEqual(current.runtimeCostSummary)
    expect(buildRunUsageSummary(active.runId, [], [await f.run()], []).tokenLabel).toBe('240')
    expect(f.published).toHaveBeenCalledWith(expect.objectContaining({ runtimeCostSummary: expect.objectContaining({ totalTokens: 240 }) }))
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_PROMPT_ONLY|fixture-key/)
    f.store.close()
    const reopened = await createLocalStore({ dbPath: f.dbPath })
    expect((await f.run(reopened)).runtimeCostSummary).toEqual(current.runtimeCostSummary)
    reopened.close()
    expect((await readFile(f.dbPath)).toString()).not.toContain('PRIVATE_PROMPT_ONLY')
  })

  it('keeps a cancelled in-flight round unknown, and assigns late expenses only to its captured run', async () => {
    let calls = 0
    const f = await fixture(async (_url, init) => {
      if (++calls === 1) return Response.json({ choices: [], usage })
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('cancelled'))))
    })
    await f.send()
    const running = f.send().catch(() => undefined)
    await vi.waitFor(() => expect(calls).toBe(2))
    await f.store.saveCodingAgentRun({ ...await f.run(), status: 'cancelled' })
    await f.store.saveCodingAgentRun({ ...active, id: 'next-coding-run', runId: 'next-workflow', managedWorkspaceId: 'next-workspace' })
    await f.proxy.close()
    await running
    const current = await f.run()
    expect(current.status).toBe('cancelled')
    expect(current.runtimeCostSummary).toMatchObject({ inputTokens: 100, outputTokens: 20, costStatus: 'unknown', usageStatus: 'incomplete', costUsd: null })
    expect(current.runtimeCostSummary!.budgetAttemptIds).toHaveLength(2)
    expect(buildRunUsageSummary(active.runId, [], [current], [])).toMatchObject({ tokenLabel: '120 + 1 项用量不完整', unknownCostCount: 1 })
    expect((await f.store.listCodingAgentRuns('next-workflow'))[0]!.runtimeCostSummary).toBeUndefined()
  })

  it('shows a response without usage as incomplete instead of a free operation', async () => {
    const f = await fixture(async () => Response.json({ choices: [] }))
    expect((await f.send()).status).toBe(200)
    const current = await f.run()
    expect(current.runtimeCostSummary).toMatchObject({ costStatus: 'unknown', usageStatus: 'incomplete', costUsd: null })
    expect(buildRunUsageSummary(active.runId, [], [current], [])).toMatchObject({ tokenLabel: '0 + 1 项用量不完整', costLabel: '1 项金额待确认' })
  })

  it('preserves observed partial SSE usage as unknown when the stream ends without its completion marker', async () => {
    const body = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }], usage })}\n\n`
    const f = await fixture(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    expect((await f.send()).status).toBe(400)
    expect((await f.run()).runtimeCostSummary).toMatchObject({ inputTokens: 100, outputTokens: 20, usageStatus: 'incomplete', costStatus: 'unknown', costUsd: null })
    expect(f.governance.settle).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed', usage: expect.objectContaining({ inputTokens: 100, usageCompleteness: 'partial' }) }))
  })

  it.each([false, true])('recovers an interrupted persisted start after SQLite reopen without replaying or duplicating unknown cost (partial usage: %s)', async (hasPartialUsage) => {
    let crashedState: Buffer | undefined
    const f = await fixture(async (_url, init) => {
      if (hasPartialUsage) return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }], usage })}\n\n`))
        init!.signal!.addEventListener('abort', () => controller.error(new Error('test cleanup')))
      } }), { headers: { 'content-type': 'text/event-stream' } })
      // Capture the durable bytes at the real dispatch seam, before any response or cleanup.
      crashedState = await readFile(f.dbPath)
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('test cleanup'))))
    })
    const sending = f.send().catch(() => undefined)
    if (hasPartialUsage) {
      // In-memory reads can see a mutation before its atomic file replacement finishes.
      // Publication happens after the awaited durable write, which is the crash boundary here.
      await vi.waitFor(() => expect(f.publishedEvent).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ providerCall: expect.objectContaining({
          status: 'started', usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20, usageCompleteness: 'partial' }),
        }) }),
      })))
      crashedState = await readFile(f.dbPath)
    }
    await vi.waitFor(() => expect(crashedState).toBeDefined())
    await f.proxy.close()
    await sending
    f.store.close()
    const crashPath = path.join(path.dirname(f.dbPath), 'interrupted-state.sqlite')
    await writeFile(crashPath, crashedState!)
    const reopened = await createLocalStore({ dbPath: crashPath })
    cleanup.push(async () => reopened.close())
    const quote = f.governance.reserve.mock.calls[0]![0]
    expect(await reopened.listModelCallSettlementRecords(active.projectId)).toEqual([
      expect.objectContaining({ final: false,
        scope: { organizationId: 'organization', userId: active.requestedBy, teamProjectId: active.projectId, localProjectId: active.projectId },
        settlement: expect.objectContaining({ id: quote.id, projectId: active.projectId, state: 'failed',
          ...(hasPartialUsage ? { usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20, usageCompleteness: 'partial' }) } : {}) }),
      }),
    ])
    const start = (await reopened.listCodingAgentEvents(active.id)).find(event => event.metadata?.providerCall)!
    const requestId = (start.metadata!.providerCall as { requestId: string }).requestId
    expect(start.metadata!.providerCall).toMatchObject({ status: 'started', usage: { budgetAttemptIds: [quote.id],
      ...(hasPartialUsage ? { inputTokens: 100, outputTokens: 20, usageCompleteness: 'partial' } : {}) } })
    const dispatch = vi.fn(async () => { throw new Error('Recovery must not dispatch to OpenCode') })
    const engine: CodingEngineAdapter = { engine: 'opencode-http', providerId: binding.providerId,
      modelId: binding.modelId, ensure: dispatch, start: dispatch, approvePermission: dispatch, cancel: dispatch }
    const recoveredAt = new Date(Date.parse(quote.createdAt) + 60_000).toISOString()
    const runtime = createCodingRuntime({ store: reopened, engine, now: () => recoveredAt })
    expect(await runtime.recoverCodingAgentRuns()).toEqual([expect.objectContaining({ id: active.id, status: 'failed' })])
    const recovered = await f.run(reopened)
    expect(buildRunUsageSummary(active.runId, [], [recovered], [])).toMatchObject({ tokenLabel: `${hasPartialUsage ? 120 : 0} + 1 项用量不完整`, unknownCostCount: 1 })
    expect(recovered.runtimeCostSummary).toMatchObject({ totalTokens: hasPartialUsage ? 120 : 0, usageStatus: 'incomplete', costStatus: 'unknown', costUsd: null })
    expect(recovered.runtimeCostSummary!.providerCallIds).toEqual([requestId])
    expect(recovered.runtimeCostSummary!.budgetAttemptIds).toEqual([quote.id])
    expect((await reopened.listCodingAgentEvents(active.id)).filter(event => event.metadata?.providerCall).map(event => event.metadata!.providerCall)).toEqual([
      expect.objectContaining({ requestId, status: 'started' }),
      expect.objectContaining({ requestId, status: 'failed', deliveryState: 'possibly_delivered',
        billingState: 'unknown', sanitizedCause: 'runtime_restarted_before_terminal_observation' }),
    ])
    const attempt: ModelCallAttempt = { ...quote, userId: active.requestedBy, state: 'failed', projectedCostUsd: 1, costUsd: null }
    const accountingRows = modelBudgetUsageWithRuntime([], [recovered.runtimeCostSummary!])
    const recovery = modelCostRecoveryOverview(accountingRows, [attempt], [], active.projectId, recoveredAt)
    expect(recovery.records).toEqual([expect.objectContaining({ sourceKind: 'model_call', sourceId: quote.id })])
    expect(recovery.actualUnknownCount).toBe(1)
    await runtime.recoverCodingAgentRuns()
    expect((await f.run(reopened)).runtimeCostSummary).toEqual(recovered.runtimeCostSummary)
    expect(dispatch).not.toHaveBeenCalled()
    expect(f.upstream).toHaveBeenCalledOnce()
  })

  it('rejects mismatched provider/config/identity scope before dispatch and cannot use a terminal run to start', async () => {
    const f = await fixture()
    const captured = await createCodingRelayCallContext(f.scope)
    expect((await f.send({ 'x-devflow-coding-run': 'old-run' })).status).toBe(400)
    expect((await f.send({ 'x-devflow-root-session': '' })).status).toBe(400)
    await f.store.saveCodingAgentRun({ ...active, providerId: 'different' })
    expect((await f.send()).status).toBe(400)
    await f.store.saveCodingAgentRun({ ...active, configVersion: 2 })
    expect((await f.send()).status).toBe(400)
    await f.store.saveCodingAgentRun({ ...active, status: 'cancelled' })
    expect((await f.send()).status).toBe(400)
    expect(f.upstream).not.toHaveBeenCalled()
    await f.store.saveCodingAgentRun({ ...active, requestedBy: 'another-user' })
    await expect(captured.report({ stateVersion: 1, requestId: 'invalid', phase: 'initial', attempt: 1,
      providerId: binding.providerId, model: binding.modelId, status: 'failed', startedAt: active.startedAt,
      completedAt: active.startedAt, timeoutMs: 1000, promptChars: 0, promptBytes: 0, promptDigest: '',
      manifestPathCount: 0, excerptCount: 0, maxOutputTokens: 1, deliveryState: 'response_received',
      billingState: 'confirmed', retryable: false, redacted: true,
    })).rejects.toThrow('scope mismatch')
  })
})
