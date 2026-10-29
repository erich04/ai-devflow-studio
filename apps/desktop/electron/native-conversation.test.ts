// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, createFakeAgentProvider, createWorkflowRunFromRequest, resolveRequestPolicy, type AgentProvider, type NativeConversationRequest, type NativeToolCall } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { WorkbenchConversationService } from './workbench-conversation-service'
import { runNativeConversation } from './native-conversation'
import { beginInvestigationBatch } from './investigation-policy'
import type { ConversationCheckpoint, WorkbenchConversation } from './workbench-conversation-contract'

let directory: string, store: LocalStore
const projectId = 'native-project'
const fixture = createWorkflowRunFromRequest({ runId: 'native-run', title: '搜索任务', request: '保留任务管理。增加关键词搜索。', projectId, creatorId: 'test', branchName: 'test', now: '2026-10-10T00:00:00.000Z' })
const target = { runId: fixture.run.id, nodeId: fixture.run.nodes[0]!.id }
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-'))
  await mkdir(path.join(directory, 'repo')); await writeFile(path.join(directory, 'repo', 'app.js'), 'export const tasks = []')
  store = await createLocalStore({ dbPath: path.join(directory, 'test.sqlite') })
  await store.upsertProject({ id: projectId, name: 'native', path: path.join(directory, 'repo'), packageManager: 'npm', testCommand: 'npm test', createdAt: fixture.run.createdAt, updatedAt: fixture.run.updatedAt })
  await store.saveRun(fixture.run)
  for (const artifact of fixture.artifacts) await store.saveArtifact(artifact)
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })
function call(id: string, name: string, args: unknown) {
  const toolCalls: NativeToolCall[] = [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, reasoning_content: 'thinking:' + id, tool_calls: toolCalls }, usage: { inputTokens: 10, outputTokens: 10 } }
}
function answer(text: string) { return { kind: 'text' as const, text, assistantMessage: { role: 'assistant' as const, content: text, reasoning_content: 'final thinking' }, usage: { inputTokens: 10, outputTokens: 10 } } }
function setup(complete: NonNullable<AgentProvider['completeNativeConversation']>, local = store, nativeConversationsEnabled = false) {
  const fn = vi.fn(complete)
  const provider = { ...createFakeAgentProvider(), supportsNativeTools: true, resolveRequestPolicy: (input: Parameters<NonNullable<AgentProvider['resolveRequestPolicy']>>[0]) => resolveRequestPolicy({ ...input, model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }), completeNativeConversation: fn }
  const service = new WorkbenchConversationService({ store: local, nativeReadOnlyPilotEnabled: true, nativeConversationsEnabled, resolveProvider: async () => provider, changed: () => {}, loadKnowledge: async () => ({ projectId, indexedAt: 'now', contentHash: 'hash', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [] }) })
  return { service, fn, provider }
}
async function create(service: WorkbenchConversationService) { return (await service.command({ type: 'create', projectId, executor: 'native-tools' })).conversationId! }
async function send(service: WorkbenchConversationService, id: string, text = '生成讨论提案') {
  await service.command({ type: 'send', projectId, conversationId: id, providerId: 'deepseek', text }); await service.settled(id)
  return (await store.listWorkbenchConversations(projectId)).find(s => s.id === id)!
}

function isolatedNative(complete: NonNullable<AgentProvider['completeNativeConversation']>, options: { maxSteps?: number; memory?: unknown; maxInputBytes?: number } = {}) {
  const checkpoint: ConversationCheckpoint = { version: 1, turnId: 'user', step: 1, cycle: 1, recoveries: 0, group: 'group', providerId: 'fixture', observations: [], citations: [], requirementRunIds: [], investigation: beginInvestigationBatch(undefined, { maxSteps: options.maxSteps ?? 12 }) }
  let session: WorkbenchConversation = { id: 'isolated', localProjectId: projectId, version: 1, title: 'fixture', isOpen: true, status: 'running', inputDraft: '', createdAt: fixture.run.createdAt, updatedAt: fixture.run.createdAt, messages: [{ id: 'user', role: 'user', text: '只读调查', createdAt: fixture.run.createdAt }], checkpoint }
  const completeNativeConversation = vi.fn(complete)
  const host = {
    provider: { ...createFakeAgentProvider(), supportsNativeTools: true, completeNativeConversation, ...(options.maxInputBytes ? { resolveRequestPolicy: () => ({ ...resolveRequestPolicy({ model: 'fixture' }), maxInputBytes: options.maxInputBytes! }) } : {}) },
    checkpoint, signal: new AbortController().signal,
    read: async () => session,
    update: async (transform: (current: WorkbenchConversation) => WorkbenchConversation) => (session = transform(session)),
    context: async () => ({}), memory: async () => options.memory,
    critical: vi.fn(async () => { throw new Error('Unexpected critical read') }), validateReads: vi.fn(async () => {}),
    query: vi.fn(async () => ({ result: { content: 'verified file' }, sourceId: 'source-1' })), append: vi.fn(async () => {}),
    pauseInvestigation: vi.fn(async () => { session = { ...session, status: 'paused', checkpoint: structuredClone(checkpoint) } }),
    beforeModelRequest: vi.fn(async () => {}), recordModelDelivery: vi.fn(async () => {}),
  }
  return { host, completeNativeConversation, read: () => session }
}

it('does not dispatch when cancellation arrives while the request counter is being saved', async () => {
  const h = isolatedNative(async () => answer('不应调用'))
  const controller = new AbortController()
  h.host.signal = controller.signal
  const update = h.host.update
  h.host.update = async transform => {
    const saved = await update(transform)
    if (saved.checkpoint?.investigation?.totals.requests === 1) controller.abort(new Error('cancelled'))
    return saved
  }
  await runNativeConversation(h.host)
  expect(h.completeNativeConversation).not.toHaveBeenCalled()
  expect(h.host.pauseInvestigation).not.toHaveBeenCalled()
  expect(h.host.recordModelDelivery).toHaveBeenCalledWith(expect.any(String), 'not_sent')
  expect(h.read().status).toBe('cancelled')
})

it('hands the native step boundary to the shared summary host instead of starting another request', async () => {
  const h = isolatedNative(async () => call('read', 'repo_read', { path: 'app.js' }), { maxSteps: 1 })
  await runNativeConversation(h.host)
  expect(h.completeNativeConversation).toHaveBeenCalledTimes(1)
  expect(h.host.query).toHaveBeenCalledTimes(1)
  expect(h.host.pauseInvestigation).toHaveBeenCalledTimes(1)
  expect(h.read().checkpoint?.investigation).toMatchObject({ batch: { steps: 1, requests: 1 }, stopReason: 'step_limit' })
})

it('keeps changing Memory out of the native system prefix and durable protocol while auditing delivery', async () => {
  const memory = { backgroundMemory: [{ id: 'm1', statement: 'A private useful memory' }] }
  const h = isolatedNative(async input => {
    expect(input.systemPrompt).not.toContain('A private useful memory')
    expect(input.systemPrompt).toContain('用户本轮明确要求优先')
    expect(JSON.parse(input.messages.at(-1)!.content!)).toEqual(memory)
    return answer('Completed')
  }, { memory })
  await runNativeConversation(h.host)
  expect(h.read().status).toBe('idle')
  expect(JSON.stringify(h.read().nativeTranscript)).not.toContain('A private useful memory')
  expect(h.host.beforeModelRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(String), true)
  expect(h.host.recordModelDelivery).toHaveBeenCalledWith(expect.any(String), 'response_received')
})

it('drops optional Memory as a whole before compacting native history when the wire payload overflows', async () => {
  const h = isolatedNative(async input => {
    expect(JSON.stringify(input.messages)).not.toContain('MEMORY_OVERFLOW')
    expect(input.messages[0]?.content).toContain('只读调查')
    return answer('完成')
  }, { memory: { backgroundMemory: [{ statement: 'MEMORY_OVERFLOW'.repeat(4000) }] }, maxInputBytes: 14000 })
  await runNativeConversation(h.host)
  expect(h.read().status).toBe('idle')
  expect(h.host.beforeModelRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(String), false)
  expect(h.read().nativeContextStart).toBeUndefined()
})

it('does not start another native recovery when the whole-question recovery allowance is exhausted', async () => {
  const h = isolatedNative(async () => { throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'invalid_json', retryable: true, deliveryState: 'response_received', billingState: 'unknown' }) })
  h.host.checkpoint.investigation!.totals.recoveries = 24
  await runNativeConversation(h.host)
  expect(h.completeNativeConversation).toHaveBeenCalledTimes(1)
  expect(h.host.pauseInvestigation).toHaveBeenCalledTimes(1)
  expect(h.read().checkpoint?.investigation?.stopReason).toBe('recovery_limit')
})

it('keeps Memory omitted in the receipt when history compaction is also needed after dropping it', async () => {
  const h = isolatedNative(async input => {
    expect(JSON.stringify(input.messages)).not.toContain('MEMORY_OVERFLOW')
    return answer('完成')
  }, { memory: { backgroundMemory: [{ statement: 'MEMORY_OVERFLOW'.repeat(4000) }] }, maxInputBytes: 14000 })
  await h.host.update(current => ({ ...current, nativeTranscript: [{ turnId: 'old', message: { role: 'user', content: 'OLD_RAW_TEXT'.repeat(5000) } }] }))
  await runNativeConversation(h.host)
  expect(h.read().status).toBe('idle')
  expect(h.read().nativeContextStart).toBeGreaterThan(0)
  expect(h.host.beforeModelRequest).toHaveBeenCalledWith(expect.any(Object), expect.any(String), false)
})

it('bounds native argument repairs and counts them as cumulative recovery attempts', async () => {
  let attempt = 0
  const h = isolatedNative(async () => call(`bad-${++attempt}`, 'repo_read', { wrong: 'app.js' }))
  await runNativeConversation(h.host)
  expect(h.completeNativeConversation).toHaveBeenCalledTimes(3)
  expect(h.host.query).not.toHaveBeenCalled()
  expect(h.host.pauseInvestigation).not.toHaveBeenCalled()
  expect(h.read().status).toBe('failed')
  expect(h.read().checkpoint?.investigation?.totals).toMatchObject({ requests: 3, recoveries: 2 })
})

it('does not summarize or retry after budget refusal, permission refusal, or pre-dispatch cancellation', async () => {
  for (const reason of ['budget_exceeded', 'permission_denied']) {
    const h = isolatedNative(async () => { throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: reason, retryable: false, deliveryState: 'not_sent', billingState: 'not_incurred' }) })
    await runNativeConversation(h.host)
    expect(h.completeNativeConversation).toHaveBeenCalledTimes(1)
    expect(h.host.pauseInvestigation).not.toHaveBeenCalled()
    expect(h.host.recordModelDelivery).toHaveBeenCalledWith(expect.any(String), 'not_sent')
  }
  const h = isolatedNative(async () => answer('不应调用'))
  const controller = new AbortController()
  h.host.signal = controller.signal
  h.host.beforeModelRequest.mockImplementation(async () => { controller.abort(new Error('cancelled')) })
  await runNativeConversation(h.host)
  expect(h.completeNativeConversation).not.toHaveBeenCalled()
  expect(h.host.pauseInvestigation).not.toHaveBeenCalled()
  expect(h.read().status).toBe('cancelled')
  expect(h.host.recordModelDelivery).toHaveBeenCalledWith(expect.any(String), 'not_sent')
})

it('pauses between native tools without running the remainder or losing completed pairs', async () => {
  const first = call('read-a', 'repo_read', { path: 'app.js' })
  first.toolCalls.push(...call('read-b', 'repo_read', { path: 'README.md' }).toolCalls)
  const h = isolatedNative(async () => first)
  h.host.query.mockImplementation(async () => {
    h.host.checkpoint.investigation!.batch.noProgress = 4
    return { result: { content: 'verified file' }, sourceId: 'source-1' }
  })
  await runNativeConversation(h.host)
  expect(h.host.query).toHaveBeenCalledTimes(1)
  expect(h.host.pauseInvestigation).toHaveBeenCalledTimes(1)
  expect(h.read().nativeTranscript?.filter(entry => entry.message.role === 'tool')).toHaveLength(1)
  expect(h.read().checkpoint?.nativePendingCalls?.map(entry => entry.id)).toEqual(['read-a', 'read-b'])
})
it('binds new supported Direct Provider conversations once and keeps them readable when rolled back', async () => {
  const h = setup(async () => answer('原生普通回答'), store, true)
  const id = (await h.service.command({ type: 'create', projectId })).conversationId!
  const result = await send(h.service, id, '说明项目')
  expect(result).toMatchObject({ executor: 'direct-provider', nativeProtocolSelection: 'selected', nativeProtocolVersion: 2, status: 'idle' })
  expect(result.investigationProgress?.batch.steps).toBe(1)
  const disabled = setup(async () => answer('不应调用'))
  const paused = await send(disabled.service, id, '继续')
  expect(paused.status).toBe('failed')
  expect(paused.error).toContain('暂时停用')
  expect(paused.messages.some(m => m.text === '原生普通回答')).toBe(true)
  expect(disabled.fn).not.toHaveBeenCalled()
})
it('retains native pairs and final reasoning across two turns and SQLite restart', async () => {
  let index = 0
  const h = setup(async () => ++index === 1 ? call('read-1', 'repo_read', { path: 'app.js' }) : answer('普通回答，包含 {JSON 示例}'))
  const id = await create(h.service), first = await send(h.service, id, '读取 app.js')
  expect(first.status, first.error).toBe('idle')
  expect(first.messages.at(-1)?.text).toContain('{JSON 示例}')
  const reopened = await createLocalStore({ dbPath: path.join(directory, 'test.sqlite') })
  const second = setup(async input => {
    expect(input.messages.filter(m => m.role === 'assistant')).toEqual(expect.arrayContaining([expect.objectContaining({ content: '普通回答，包含 {JSON 示例}', reasoning_content: 'final thinking' })]))
    expect(input.messages.filter(m => m.role === 'tool')).toHaveLength(1)
    expect(input.messages.filter(m => m.role === 'user')).toHaveLength(2)
    return answer('继续完成')
  }, reopened)
  await second.service.command({ type: 'send', projectId, conversationId: id, providerId: 'deepseek', text: '继续解释' }); await second.service.settled(id)
  expect((await reopened.listWorkbenchConversations(projectId))[0]?.status).toBe('idle')
  const preview = await second.service.command({ type: 'list', projectId })
  expect(preview.conversations[0]?.nativeTranscript).toBeUndefined()
})
it('persists a long candidate before review failure and permits explicit human continuation without re-generating or spending at save', async () => {
  vi.stubEnv('DEVFLOW_STEP_RECOVERY_ENABLED', '0')
  let index = 0
  const content = '保留任务管理和关键词搜索。'.repeat(6000)
  const h = setup(async input => {
    if (++index === 1) return call('prepare', 'prepare_revision', target)
    if (index === 2) return call('proposal', 'propose_revision', { ...target, title: '搜索设计提案', content })
    expect(input.tools.map(t => t.function.name)).toEqual(['report_proposal_review'])
    throw new AgentProviderRequestError({ code: 'provider_timeout', sanitizedCause: 'fixture_timeout', deliveryState: 'possibly_delivered', billingState: 'unknown', retryable: true })
  })
  const id = await create(h.service), result = await send(h.service, id)
  const candidate = result.messages.find(m => m.draft)!
  expect(candidate?.draft).toMatchObject({ content, review: { status: 'unavailable' } })
  await expect(h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id })).rejects.toThrow('明确确认')
  await h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id, acknowledgeUnverified: true })
  expect(h.fn).toHaveBeenCalledTimes(3)
  const saved = (await store.listArtifacts(target.runId)).find(a => a.id === `conversation-proposal-${candidate.id}`)!
  expect(saved.content).toContain('AI 核对未完成')
  expect(saved.content).toContain(content)
  expect((await store.listRuns())[0]).toEqual(fixture.run)
})
it('saves a reviewed candidate without another model request and prevents stale-source publication', async () => {
  let index = 0
  const h = setup(async (input: NativeConversationRequest) => {
    if (++index === 1) return call('prepare', 'prepare_revision', target)
    if (index === 2) return call('proposal', 'propose_revision', { ...target, title: '搜索设计', content: '保留任务管理。增加关键词搜索。' })
    const payload = JSON.parse(input.messages[0]!.content!)
    return call('review', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'covered', reason: '已保留' })) })
  })
  const id = await create(h.service), result = await send(h.service, id)
  const candidate = result.messages.find(m => m.draft)!
  expect(candidate?.draft?.review?.status).toBe('passed')
  expect(result.investigationProgress?.batch.steps).toBe(3)
  await store.saveRun({ ...fixture.run, request: '需求已经改变', updatedAt: '2026-10-11T00:00:00.000Z', version: fixture.run.version + 1 })
  await store.saveArtifact({ id: 'conversation-proposal-new-source', ...target, kind: 'log', title: '新约定', summary: '变更', content: '新增已确认约定', redacted: true, updatedAt: '2026-10-11T00:00:00.000Z' })
  await expect(h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id, acknowledgeUnverified: true })).rejects.toThrow('已更新')
  expect(h.fn).toHaveBeenCalledTimes(3)
})

it('counts a completed user question as one native work step', async () => {
  const h = isolatedNative(async () => call('ask', 'request_user_input', { prompt: '请选择调查范围。', options: ['需求', '代码'] }))
  await runNativeConversation(h.host)
  expect(h.read().status).toBe('awaiting_answer')
  expect(h.host.checkpoint.investigation?.batch.steps).toBe(1)
})

it('reviews the same persisted candidate after restart and keeps the original user request', async () => {
  vi.stubEnv('DEVFLOW_STEP_RECOVERY_ENABLED', '0')
  let index = 0
  const first = setup(async () => {
    if (++index === 1) return call('prepare-retry', 'prepare_revision', target)
    if (index === 2) return call('proposal-retry', 'propose_revision', { ...target, title: '候选', content: '保留任务管理。增加关键词搜索。' })
    throw new AgentProviderRequestError({ code: 'provider_timeout', sanitizedCause: 'fixture', deliveryState: 'possibly_delivered', billingState: 'unknown', retryable: true })
  })
  const id = await create(first.service), failed = await send(first.service, id, '增加摘要')
  const candidate = failed.messages.find(m => m.draft)!
  const reopened = await createLocalStore({ dbPath: path.join(directory, 'test.sqlite') })
  const next = setup(async input => {
    if (input.tools.some(t => t.function.name === 'report_proposal_review')) {
      const payload = JSON.parse(input.messages[0]!.content!)
      expect(payload.userRequest).toBe('增加摘要')
      return call('review-after-restart', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'covered', reason: '已保留' })) })
    }
    return answer('下一件事')
  }, reopened)
  await next.service.command({ type: 'send', projectId, conversationId: id, providerId: 'deepseek', text: '另一件事' }); await next.service.settled(id)
  await next.service.command({ type: 'retry_review', projectId, conversationId: id, providerId: 'deepseek', messageId: candidate.id }); await next.service.settled(id)
  const final = (await reopened.listWorkbenchConversations(projectId))[0]!
  expect(final.status, final.error).toBe('idle')
  expect(final.messages.filter(m => m.draft)).toHaveLength(1)
  expect(final.messages.find(m => m.id === candidate.id)?.draft).toMatchObject({ content: candidate.draft!.content, review: { status: 'passed' } })
  await next.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id })
  await next.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id })
  expect(next.fn).toHaveBeenCalledTimes(2)
  expect((await reopened.listArtifacts(target.runId)).filter(a => a.id.startsWith('conversation-proposal-'))).toHaveLength(1)
})

it('refreshes two recovery opportunities after a successful step', async () => {
  let index = 0
  const h = setup(async () => {
    index++
    if ([1, 2, 4, 5].includes(index)) throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'incomplete_response', deliveryState: 'response_received', billingState: 'confirmed', usage: { inputTokens: 5, outputTokens: 5 }, retryable: true })
    return index === 3 ? call('recovered-read', 'repo_read', { path: 'app.js' }) : answer('完成')
  })
  const result = await send(h.service, await create(h.service))
  expect(result.status, result.error).toBe('idle')
  expect(index).toBe(6)
  expect(result.messages.filter(m => m.attempt).map(m => m.attempt!.recovery)).toEqual([0, 1, 2, 0, 1, 2])
})

it('rejects a whole batch before reading any file if one target escapes the scope', async () => {
  await symlink('app.js', path.join(directory, 'repo', 'alias.js'))
  const h = setup(async () => {
    const toolCalls: NativeToolCall[] = ['app.js', 'alias.js'].map((file, index) => ({ id: `read-${index}`, type: 'function', function: { name: 'repo_read', arguments: JSON.stringify({ path: file }) } }))
    return { kind: 'tools', toolCalls, assistantMessage: { role: 'assistant', content: null, tool_calls: toolCalls } }
  })
  const result = await send(h.service, await create(h.service))
  expect(result.status).toBe('failed')
  expect(result.failure?.reason).toBe('native_tool_scope_denied')
  expect(result.toolEvents ?? []).toHaveLength(0)
  expect(result.nativeTranscript?.filter(e => e.message.role === 'tool')).toHaveLength(2)
})

it.each(['workflow', 'conversation_read'])('allows the model to repair an unknown %s target without reading outside its scope', async name => {
  let index = 0
  const h = setup(async input => {
    if (++index === 1) return call('unknown-target', name, name === 'workflow' ? { runId: 'missing-run' } : { messageId: 'missing-message' })
    if (index === 2) {
      expect(input.messages.at(-1)?.content).toContain('invalid_target')
      return call('corrected-target', name, name === 'workflow' ? { runId: target.runId } : {})
    }
    return answer('已找到目标')
  })
  const result = await send(h.service, await create(h.service))
  expect(result.status, result.error).toBe('idle')
  expect(h.fn).toHaveBeenCalledTimes(3)
  expect(result.toolEvents?.filter(event => event.kind === 'tool_request')).toHaveLength(1)
})

it('does not start a review queued behind the publication of the same candidate', async () => {
  let publicationStarted!: () => void, releasePublication!: () => void
  const started = new Promise<void>(resolve => { publicationStarted = resolve })
  const release = new Promise<void>(resolve => { releasePublication = resolve })
  const local = new Proxy(store, { get(target, key) {
    if (key !== 'saveWorkbenchConversation') return Reflect.get(target, key)
    return async (...args: Parameters<LocalStore['saveWorkbenchConversation']>) => {
      if (args[2]) { publicationStarted(); await release }
      return target.saveWorkbenchConversation(...args)
    }
  } })
  let index = 0
  const h = setup(async input => {
    if (++index === 1) return call('prepare-queued', 'prepare_revision', target)
    if (index === 2) return call('proposal-queued', 'propose_revision', { ...target, title: '待保存', content: '保留任务管理。增加关键词搜索。' })
    const payload = JSON.parse(input.messages[0]!.content!)
    return call('review-queued', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'covered', reason: '保留' })) })
  }, local)
  const id = await create(h.service), result = await send(h.service, id)
  const candidate = result.messages.find(message => message.draft)!
  const publication = h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id })
  await started
  const review = h.service.command({ type: 'retry_review', projectId, conversationId: id, providerId: 'deepseek', messageId: candidate.id }).then(() => null, error => error)
  await new Promise<void>(resolve => setImmediate(resolve))
  releasePublication()
  await publication
  expect(await review).toMatchObject({ message: expect.stringContaining('已经保存') })
  expect(h.fn).toHaveBeenCalledTimes(3)
  expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('idle')
})

it('shows real semantic findings and records manual continuation without claiming AI passed', async () => {
  let index = 0
  const h = setup(async input => {
    if (++index === 1) return call('prepare-conflict', 'prepare_revision', target)
    if (index === 2) return call('proposal-conflict', 'propose_revision', { ...target, title: '候选', content: '需要人工核对的内容' })
    const payload = JSON.parse(input.messages[0]!.content!)
    return call('review-conflict', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'contradiction', reason: '未保留任务管理约定' })) })
  })
  const id = await create(h.service), result = await send(h.service, id)
  const candidate = result.messages.find(m => m.draft)!
  expect(candidate.draft?.review?.status).toBe('needs_revision')
  await h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id, acknowledgeUnverified: true })
  const saved = (await store.listArtifacts(target.runId)).find(a => a.id === `conversation-proposal-${candidate.id}`)!
  expect(saved.content).toContain('未保留任务管理约定')
  expect(saved.content).toContain('用户明确选择')
  expect(saved.content).not.toContain('AI 核对通过')
})

it('compacts a completed native segment without deleting original provider history', async () => {
  let index = 0
  const h = setup(async input => {
    if (++index === 1) return answer('很长的旧回答'.repeat(8000))
    expect(input.messages).toHaveLength(1)
    expect(input.messages[0]!.content).toContain('rollingSummary')
    return answer('新的回答')
  })
  const policy = h.provider.resolveRequestPolicy
  h.provider.resolveRequestPolicy = input => ({ ...policy(input), maxInputBytes: 30000 })
  const id = await create(h.service)
  await send(h.service, id, '第一次提问')
  const second = await send(h.service, id, '继续讨论')
  expect(second.status, second.error).toBe('idle')
  expect(second.compactions).toHaveLength(1)
  expect(second.nativeTranscript?.some(e => e.message.content?.includes('很长的旧回答'.repeat(8000)))).toBe(true)
  expect(second.contextReceipt?.budget?.overflow).toBe(false)
})

it('reuses a durable tool result after a crash between result persistence and protocol pairing', async () => {
  const h = setup(async input => {
    const tool = input.messages.find(m => m.role === 'tool')!
    expect(tool.content).toContain('original observation')
    return answer('恢复完成')
  })
  const id = await create(h.service), original = (await store.listWorkbenchConversations(projectId))[0]!
  const decision = call('crash-read', 'repo_read', { path: 'app.js' })
  const date = fixture.run.createdAt
  await store.saveWorkbenchConversation({ ...original, version: original.version + 1, status: 'running', messages: [{ id: 'user-crash', role: 'user', text: '读取代码', createdAt: date }],
    nativeTranscript: [{ turnId: 'user-crash', message: { role: 'user', content: '读取代码' } }, { turnId: 'user-crash', message: decision.assistantMessage }],
    checkpoint: { version: 1, turnId: 'user-crash', step: 0, cycle: 0, recoveries: 0, group: 'crash-group', providerId: 'deepseek', requirementRunIds: [], observations: [], citations: [], nativePendingCalls: decision.toolCalls },
    toolEvents: [
      { kind: 'tool_request', id: 'native:crash-read', turnId: 'user-crash', name: 'repo_read', args: { path: 'app.js' }, createdAt: date },
      { kind: 'tool_result', id: 'native:crash-read:result', turnId: 'user-crash', requestId: 'native:crash-read', value: { content: 'original observation' }, outcome: 'completed', createdAt: date },
    ],
  }, original.version)
  await writeFile(path.join(directory, 'repo', 'app.js'), 'changed after original observation')
  await h.service.recoverInterrupted()
  await h.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'deepseek' }); await h.service.settled(id)
  const result = (await store.listWorkbenchConversations(projectId))[0]!
  expect(result.status, result.error).toBe('idle')
  expect(result.toolEvents).toHaveLength(2)
  expect(result.messages.filter(m => m.role === 'tool')).toHaveLength(1)
})

it('recovers streamed partial text as incomplete after process interruption', async () => {
  const h = setup(async () => answer('unused'))
  const id = await create(h.service), original = (await store.listWorkbenchConversations(projectId))[0]!
  const date = fixture.run.createdAt
  await store.saveWorkbenchConversation({ ...original, version: original.version + 1, status: 'running', messages: [
    { id: 'partial-user', role: 'user', text: '解释方案', createdAt: date },
    { id: 'partial-call', role: 'notice', text: '模型调用', createdAt: date, attempt: { turnId: 'partial-user', step: 0, cycle: 0, recovery: 0, group: 'partial-group', startedAt: date, status: 'running' } },
  ] }, original.version)
  await store.appendWorkbenchResponseChunk!(id, 'partial-call', 'content', '已经收到的正文')
  await h.service.recoverInterrupted()
  await h.service.recoverInterrupted()
  const result = (await store.listWorkbenchConversations(projectId))[0]!
  expect(result.status).toBe('interrupted')
  expect(result.messages.filter(m => m.role === 'assistant')).toEqual([expect.objectContaining({ text: '本次回答未完成，以下内容仅供参考：\n\n已经收到的正文' })])
  expect(h.fn).not.toHaveBeenCalled()
})

it.each(['invalid_arguments', 'scope_denied'])('does not duplicate a durable %s result when an older checkpoint still marks it pending', async error => {
  const h = setup(async input => {
    expect(input.messages.filter(m => m.role === 'tool')).toHaveLength(1)
    return answer('恢复后可继续')
  })
  const id = await create(h.service), original = (await store.listWorkbenchConversations(projectId))[0]!
  const decision = call('old-error', 'repo_read', { path: 'missing.js' }), date = fixture.run.createdAt
  await store.saveWorkbenchConversation({ ...original, version: original.version + 1, status: 'running', messages: [{ id: 'error-user', role: 'user', text: '读取', createdAt: date }],
    nativeTranscript: [{ turnId: 'error-user', message: { role: 'user', content: '读取' } }, { turnId: 'error-user', message: decision.assistantMessage }, { turnId: 'error-user', message: { role: 'tool', tool_call_id: 'old-error', content: JSON.stringify({ error }) } }],
    checkpoint: { version: 1, turnId: 'error-user', step: 1, cycle: 1, recoveries: 0, group: 'old-error', providerId: 'old-provider', requirementRunIds: [], observations: [], citations: [], nativePendingCalls: decision.toolCalls },
  }, original.version)
  await h.service.recoverInterrupted()
  await h.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'new-provider' }); await h.service.settled(id)
  const recovered = (await store.listWorkbenchConversations(projectId))[0]!
  expect(recovered.status, recovered.error).toBe('idle')
  expect(recovered.nativeTranscript?.filter(e => e.message.role === 'tool')).toHaveLength(1)
  expect(recovered.toolEvents ?? []).toHaveLength(0)
})

it('reconstructs a pending business call after a failed atomic candidate save without regenerating it', async () => {
  let index = 0, failedSave = false
  const proxy = new Proxy(store, { get(target, key) {
    if (key !== 'saveWorkbenchConversation') return Reflect.get(target, key)
    return async (...args: Parameters<LocalStore['saveWorkbenchConversation']>) => {
      if (!failedSave && args[0].messages.some(m => m.draft)) { failedSave = true; throw new Error('fixture persistence failure') }
      return target.saveWorkbenchConversation(...args)
    }
  } })
  const h = setup(async input => {
    if (++index === 1) return call('pending-prepare', 'prepare_revision', target)
    if (index === 2) return call('pending-proposal', 'propose_revision', { ...target, title: '保留候选', content: '保留任务管理。增加关键词搜索。' })
    expect(input.tools.map(t => t.function.name)).toEqual(['report_proposal_review'])
    const payload = JSON.parse(input.messages[0]!.content!)
    return call('pending-review', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'covered', reason: '已保留' })) })
  }, proxy)
  const id = await create(h.service), first = await send(h.service, id)
  expect(first.status).toBe('failed')
  expect(first.checkpoint?.nativePendingCalls?.[0]?.id).toBe('pending-proposal')
  await h.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'another-provider' }); await h.service.settled(id)
  const final = (await store.listWorkbenchConversations(projectId))[0]!
  expect(final.status, final.error).toBe('idle')
  expect(final.messages.filter(m => m.draft)).toHaveLength(1)
  expect(index).toBe(3)
})

it('rejects a source change at the database publication boundary even after host approval', async () => {
  let index = 0, race = false
  const proxy = new Proxy(store, { get(target, key) {
    if (key !== 'saveWorkbenchConversation') return Reflect.get(target, key)
    return async (...args: Parameters<LocalStore['saveWorkbenchConversation']>) => {
      if (race && args[2]) {
        race = false
        await target.saveArtifact({ id: 'conversation-proposal-concurrent', runId: fixture.run.id, nodeId: fixture.run.nodes[0]!.id, kind: 'log', title: '并发保存的新约定', summary: '变更', content: '并发新增的讨论提案', redacted: true, updatedAt: '2026-10-11T00:00:00.000Z' })
      }
      return target.saveWorkbenchConversation(...args)
    }
  } })
  const h = setup(async input => {
    if (++index === 1) return call('race-prepare', 'prepare_revision', target)
    if (index === 2) return call('race-proposal', 'propose_revision', { ...target, title: '旧来源候选', content: '保留任务管理。增加关键词搜索。' })
    const payload = JSON.parse(input.messages[0]!.content!)
    return call('race-review', 'report_proposal_review', { coverageReview: payload.criticalProposalInput.criteria.map((c: { id: string }) => ({ criterionId: c.id, status: 'covered', reason: '已保留' })) })
  }, proxy)
  const id = await create(h.service), result = await send(h.service, id), candidate = result.messages.find(m => m.draft)!
  race = true
  await expect(h.service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id, acknowledgeUnverified: true })).rejects.toThrow('已更新')
  expect((await store.listArtifacts(target.runId)).some(a => a.id === `conversation-proposal-${candidate.id}`)).toBe(false)
  expect((await store.listWorkbenchConversations(projectId))[0]!.messages.find(m => m.id === candidate.id)?.draft?.publishedArtifactId).toBeUndefined()
})
