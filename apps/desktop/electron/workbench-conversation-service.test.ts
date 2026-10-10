// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, createFakeAgentProvider, createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest, measurePromptSections, runWorkflowStageAgent, type AgentProvider, type DesktopPairingCredential, type DurableAgentMemoryRevision, type GitHubDeliveryIntent, type KnowledgeRetrievalScope, type LocalProject } from '@ai-devflow/shared'
import type { CodingMemoryStore } from './coding-context'
import { createLocalStore, type LocalStore } from './local-store'
import { degradeOlderObservations, WorkbenchConversationService } from './workbench-conversation-service'
import { parseConversationCommand } from './workbench-conversation-contract'
import { readWorkbenchRepository } from './workbench-repository'
import { ConversationExecutorError } from './conversation-executor'
import { indexKnowledgeSources } from '@ai-devflow/shared'

const projectId = 'local-conversations'
const created = createWorkflowRunFromRequest({ runId: 'conversation-flow', title: '清除已完成任务', request: '清理已完成任务并持久化结果', projectId, creatorId: 'u-test', branchName: 'ai/test', now: '2026-09-16T10:00:00.000Z' })
let directory: string
let store: LocalStore
let project: LocalProject
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-conversations-'))
  store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
  project = { id: projectId, name: '任务清单', path: path.join(directory, 'project'), packageManager: 'npm', testCommand: 'npm test', createdAt: created.run.createdAt, updatedAt: created.run.updatedAt }
  await mkdir(project.path)
  await writeFile(path.join(project.path, 'tasks.ts'), 'export const clearDone = (tasks) => tasks.filter(task => !task.done)\n')
  await store.upsertProject(project)
  await store.saveRun(created.run)
  for (const artifact of created.artifacts) await store.saveArtifact(artifact)
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { force: true, recursive: true }) })

type ServiceDependencies = ConstructorParameters<typeof WorkbenchConversationService>[0]
function harness(complete: NonNullable<AgentProvider['completeStructuredJson']>, criticalReplies = true, extra: Partial<ServiceDependencies> = {}) {
  const calls: string[] = []
  const provider = { ...createFakeAgentProvider(), supportsNativeTools: false, completeStructuredJson: vi.fn(async (input: Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0]) => { calls.push(input.userPrompt)
    const context=JSON.parse(input.userPrompt)
    // Existing interaction fixtures explicitly simulate a cooperative verifier.
    // Adversarial coverage tests below disable this fixture behavior.
    if (criticalReplies && context.proposalVerification) return {value:{coverageReview:context.criticalProposalInput.criteria.map((c:{id:string})=>({criterionId:c.id,status:'covered',reason:'fixture condition retained'}))}}
    const result=await complete(input)
    if (criticalReplies && context.criticalProposalInput && result.value.draft) {
      const draft=result.value.draft as {content:string}
      return {...result,value:{...result.value,draft:{...draft,coverage:context.criticalProposalInput.criteria.map((c:{id:string;text:string})=>({criterionId:c.id,sourceQuote:c.text,proposalQuote:draft.content}))}}}
    }
    return result }) }
  const inspectGate = vi.fn(async () => ({ canApprove: false, source: 'test policy', blockers: ['upstream'] }))
  const service = new WorkbenchConversationService({ nativeReadOnlyPilotEnabled: true, store, resolveProvider: async () => provider,
    loadKnowledge: async (id) => ({ projectId: id, contentHash: 'knowledge-hash', indexedAt: '2026-09-16T10:00:00.000Z', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [{ id: 'chunk1', documentId: 'doc1', sourcePath: 'docs/product.md', headingPath: ['清理规则'], content: '清理操作只删除已完成项，保留未完成项。', contentHash: 'chunk-hash', tokenCount: 20, tags: [], updatedAt: '2026-09-16T10:00:00.000Z' }] }),
    changed: vi.fn(), inspectGate, ...extra,
  })
  return { service, calls, provider, inspectGate }
}
async function create(service: WorkbenchConversationService, id = projectId) {
  return (await service.command({ type: 'create', projectId: id })).conversationId!
}
async function send(service: WorkbenchConversationService, id: string, text = '现在进行到哪里？', extra = {}) {
  await service.command({ type: 'send', projectId, conversationId: id, providerId: 'test', text, ...extra })
  await service.settled(id)
  return (await store.listWorkbenchConversations(projectId)).find((session) => session.id === id)!
}

describe('unified conversation execution and boundaries', () => {
  it('finishes bounded recovery at the batch time boundary before pausing new steps', async () => {
    const wallClock = Date.now()
    let elapsed = 0, calls = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => wallClock + elapsed)
    try {
      const h = harness(async () => {
        if (++calls === 1) return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
        if (calls <= 3) {
          elapsed = 181000
          throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'unknown', retryable: true })
        }
        return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
      })
      const result = await send(h.service, await create(h.service))
      expect(calls).toBe(4)
      expect(result.status).toBe('paused')
      expect(result.checkpoint).toMatchObject({ step: 3, recoveries: 0 })
      expect(result.messages.filter(message => message.attempt).map(message => message.attempt?.status)).toEqual(['completed', 'failed', 'failed', 'completed'])
    } finally { clock.mockRestore() }
  })

  it('can stop automatic recovery without losing evidence or preventing explicit manual continuation', async () => {
    vi.stubEnv('DEVFLOW_STEP_RECOVERY_ENABLED', '0')
    let calls = 0
    const first = harness(async () => {
      if (++calls === 1) return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
      throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'unknown', retryable: true })
    })
    const id = await create(first.service), failed = await send(first.service, id)
    expect(calls).toBe(2)
    expect(failed.checkpoint).toMatchObject({ step: 2, recoveries: 0 })
    const resumed = harness(async input => {
      expect(JSON.parse(input.userPrompt).toolObservations).toHaveLength(1)
      return { value: { text: '按用户指示继续。' } }
    })
    await resumed.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await resumed.service.settled(id)
    expect(resumed.calls).toHaveLength(1)
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('idle')
  })
  it('keeps the native pilot disabled unless explicitly enabled and preserves old records when disabled', async () => {
    const disabled = harness(async () => ({value:{text:'unused'}}), true, {nativeReadOnlyPilotEnabled:false})
    expect((await disabled.service.command({type:'list',projectId})).nativeReadOnlyPilotEnabled).toBe(false)
    await expect(disabled.service.command({type:'create',projectId,executor:'native-tools'})).rejects.toThrow('尚未启用')
    const enabled = harness(async () => ({value:{text:'unused'}})); enabled.provider.supportsNativeTools=true
    const id=(await enabled.service.command({type:'create',projectId,executor:'native-tools'})).conversationId!
    disabled.provider.supportsNativeTools=true
    const stopped=await send(disabled.service,id)
    expect(stopped.status).toBe('failed'); expect(stopped.executor).toBe('native-tools'); expect(disabled.calls).toHaveLength(0)
  })

  it('resumes a persisted failed step with its evidence and a fresh manual recovery cycle', async () => {
    let calls = 0
    const first = harness(async () => {
      if (++calls === 1) return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
      throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'unknown', retryable: true })
    })
    const id = await create(first.service)
    const failed = await send(first.service, id)
    expect(calls).toBe(4)
    expect(failed.checkpoint).toMatchObject({ step: 2, cycle: 1, recoveries: 2 })
    const reopened = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const resumed = harness(async input => {
      const context = JSON.parse(input.userPrompt)
      expect(context.toolObservations).toHaveLength(1)
      expect(context.toolObservations[0]).toMatchObject({ name: 'repo_read', args: { path: 'tasks.ts' } })
      return { value: { text: '继续完成。' } }
    }, true, { store: reopened })
    await resumed.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await resumed.service.settled(id)
    const final = (await reopened.listWorkbenchConversations(projectId))[0]!
    expect(final.status).toBe('idle')
    expect(final.checkpoint).toBeUndefined()
    expect(final.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(final.messages.filter(message => message.role === 'tool')).toHaveLength(1)
    expect(final.messages.filter(message => message.attempt).at(-1)?.attempt).toMatchObject({ step: 2, cycle: 2, recovery: 0 })
  })

  it('invalidates repository observations changed between failure and manual recovery', async () => {
    let calls = 0
    const first = harness(async () => {
      if (++calls === 1) return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
      throw new AgentProviderRequestError({ code: 'invalid_model_output', sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'unknown', retryable: true })
    })
    const id = await create(first.service); await send(first.service, id)
    await writeFile(path.join(project.path, 'tasks.ts'), 'export const changed = true')
    const resumed = harness(async input => {
      expect(JSON.parse(input.userPrompt).toolObservations).toEqual([])
      return { value: { text: '仓库已变化，需要重新查询。' } }
    })
    await resumed.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' }); await resumed.service.settled(id)
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('idle')
  })

  it('executes a validated native batch once and preserves tool history through the final cited answer', async () => {
    let calls = 0
    const result = harness(async input => {
      if (++calls === 1) {
        const toolCalls = [{ id: 'native-read-1', type: 'function' as const, function: { name: 'repo_read', arguments: '{"path":"tasks.ts"}' } }]
        return { value: {}, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, reasoning_content: 'private reasoning', tool_calls: toolCalls } }
      }
      expect(input.nativeTools?.messages.some(message => message.role === 'tool' && message.tool_call_id === 'native-read-1')).toBe(true)
      expect(input.nativeTools?.messages.some(message => message.role === 'assistant' && message.reasoning_content === 'private reasoning')).toBe(true)
      return { value: { text: '清理保留未完成任务。', citationIds: ['source-1'] }, assistantMessage: { role: 'assistant' as const, content: '{"text":"清理保留未完成任务。"}' } }
    })
    result.provider.supportsNativeTools = true
    const id = (await result.service.command({ type: 'create', projectId, executor: 'native-tools' })).conversationId!
    const session = await send(result.service, id)
    expect(session.status, session.error).toBe('idle'); expect(calls).toBe(2)
    expect(session.toolEvents?.filter(event => event.kind === 'tool_request')).toHaveLength(1)
    expect(session.messages.at(-1)?.citations?.[0]?.id).toBe('source-1')
  })

  it('rejects the entire native batch before any read if a later path is a symlink', async () => {
    await symlink('tasks.ts', path.join(project.path, 'alias.ts'))
    let calls = 0
    const result = harness(async input => {
      calls++
      expect(input.nativeTools?.messages ?? []).toEqual([])
      const toolCalls = ['tasks.ts', 'alias.ts'].map((path, index) => ({ id: `call-${index}`, type: 'function' as const, function: { name: 'repo_read', arguments: JSON.stringify({ path }) } }))
      return { value: {}, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls } }
    })
    result.provider.supportsNativeTools = true
    const id = (await result.service.command({ type: 'create', projectId, executor: 'native-tools' })).conversationId!
    const session = await send(result.service, id)
    expect(session.status).toBe('failed')
    expect(calls).toBe(1)
    expect(session.checkpoint?.nativeMessages ?? []).toEqual([])
    await result.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await result.service.settled(id)
    expect(calls).toBe(2)
    expect(session.toolEvents?.filter(event => event.kind === 'tool_request') ?? []).toEqual([])
  })

  it('saves long answers across SQLite restart and pages them through scoped IPC without truncating the original', async () => {
    const text = '中文长文 😀\\n'.repeat(120_000)
    const { service } = harness(async () => ({ value: { text } }))
    const id = await create(service)
    expect((await send(service, id)).messages.at(-1)?.text).toBe(text)
    const view = await service.command({ type: 'list', projectId })
    const message = view.conversations[0]!.messages.at(-1)!
    expect(message.text.length).toBeLessThan(20_000)
    expect(message.contentLengths?.text).toBe(text.length)
    const result = await service.command({ type: 'read_content', projectId, conversationId: id, messageId: message.id, field: 'text', offset: 20_000 })
    expect(result.contentPage?.text).toBe(text.slice(20_000, 20_000 + result.contentPage!.text.length))
    const reopened = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    expect((await reopened.listWorkbenchConversations(projectId))[0]!.messages.at(-1)?.text).toBe(text)
    await expect(service.command({ type: 'read_content', projectId, conversationId: id, messageId: 'other-session', field: 'text', offset: 0 })).rejects.toThrow('本会话')
  })

  it('gives each successfully advanced step two recoveries and preserves earlier failure diagnostics', async () => {
    let calls = 0
    const { service } = harness(async () => {
      calls++
      if ([1, 2, 4, 5].includes(calls)) throw new AgentProviderRequestError({ code: 'invalid_model_output',
        sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'confirmed', retryable: true,
        usage: { inputTokens: 2, outputTokens: 3 } })
      if (calls === 3) return { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } }
      return { value: { text: '读取完成。' } }
    })
    const result = await send(service, await create(service))
    expect(result.status).toBe('idle')
    expect(calls).toBe(6)
    expect(result.messages.filter(message => message.failure)).toHaveLength(4)
    expect(result.messages.filter(message => message.role === 'user')).toHaveLength(1)
  })

  it('finishes a thinking conversation beyond the old output allowance without changing workflow state', async () => {
    const bodies: Record<string, unknown>[] = []
    const provider = createOpenAiCompatibleAgentProvider({
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: 'fixture-only',
      thinking: { mode: 'enabled', effort: 'high' },
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        bodies.push(body)
        const complete = Number(body.max_tokens) >= 8_192
        return Response.json({ choices: [{
          message: { content: complete ? JSON.stringify({ text: '方案仍待评审，继续当前讨论。' }) : '', reasoning_content: 'fixture reasoning' },
          finish_reason: complete ? 'stop' : 'length',
        }] })
      },
    })
    const { service } = harness(async () => ({ value: { text: 'unused fixture' } }), true, { resolveProvider: async () => provider })
    const beforeRuns = await store.listRuns()
    const beforeArtifacts = await store.listArtifacts(created.run.id)
    const id = await create(service)
    const session = await send(service, id, '保留已有进度，继续核对当前方案。')
    expect(session.status, session.error).toBe('idle')
    expect(session.messages.at(-1)?.text).toBe('方案仍待评审，继续当前讨论。')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ max_tokens: 65_536, thinking: { type: 'enabled' }, reasoning_effort: 'high' })
    expect(await store.listRuns()).toEqual(beforeRuns)
    expect(await store.listArtifacts(created.run.id)).toEqual(beforeArtifacts)
  })

  it.each(['running', 'cancelled'] as const)('records missing tool results after restarting a %s turn without replaying or duplicating the user message', async (status) => {
    const { service, provider } = harness(async () => ({ value: { text: '重新读取当前上下文。' } }))
    const id = await create(service)
    const original = (await store.listWorkbenchConversations(projectId))[0]!
    await store.saveWorkbenchConversation({ ...original, version: 2, status, messages: [{ id: 'interrupted-user', role: 'user', text: '调查仓库', createdAt: created.run.createdAt }],
      toolEvents: [{ kind: 'tool_request', id: 'missing-query', turnId: 'interrupted-user', name: 'repo_read', args: { path: 'tasks.ts' }, createdAt: created.run.createdAt }] }, 1)
    await service.recoverInterrupted()
    await service.recoverInterrupted()
    expect(provider.completeStructuredJson).not.toHaveBeenCalled()
    const recovered = (await store.listWorkbenchConversations(projectId))[0]!
    expect(recovered.status).toBe(status === 'running' ? 'interrupted' : 'cancelled')
    expect(recovered.toolEvents).toHaveLength(2)
    expect(recovered.toolEvents![1]).toMatchObject({ kind: 'tool_result', outcome: 'interrupted', requestId: 'missing-query' })
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await service.settled(id)
    const after = (await store.listWorkbenchConversations(projectId))[0]!
    expect(after.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(after.toolEvents).toEqual(recovered.toolEvents)
  })

  it('preserves originals and skips billing when a compaction cannot be saved, then retries deterministically', async () => {
    let failCompaction = true
    const guarded = new Proxy(store, { get(target, property) {
      if (property === 'saveWorkbenchConversation') return async (next: Parameters<LocalStore['saveWorkbenchConversation']>[0], version: number, artifact?: Parameters<LocalStore['saveWorkbenchConversation']>[2]) => {
        if (failCompaction && next.compactions?.length) throw new Error('fixture disk failure')
        return target.saveWorkbenchConversation(next, version, artifact)
      }
      return Reflect.get(target, property)
    } })
    const { service, provider } = harness(async () => ({ value: { text: '上下文恢复完成。' } }), true, { store: guarded })
    const id = await create(service)
    const original = (await store.listWorkbenchConversations(projectId))[0]!
    const history = Array.from({ length: 8 }, (_, i) => ({ id: `large-${i}`, role: 'user' as const, text: '历史中文'.repeat(1600), createdAt: created.run.createdAt }))
    await store.saveWorkbenchConversation({ ...original, version: 2, messages: history }, 1)
    const failed = await send(service, id, '继续')
    expect(failed.status).toBe('failed')
    expect(failed.messages.slice(0, 8)).toEqual(history)
    expect(provider.completeStructuredJson).not.toHaveBeenCalled()
    failCompaction = false
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await service.settled(id)
    const after = (await store.listWorkbenchConversations(projectId))[0]!
    expect(after.status, after.error).toBe('idle')
    expect(after.compactions).toHaveLength(1)
    expect(after.messages.filter((message) => message.role === 'user')).toHaveLength(9)
  })

  it('recovers across two persisted compaction boundaries with original messages and paired tools intact', async () => {
    let step = 0
    const { service } = harness(async () => ++step === 1 ? { value: { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } } } : { value: { text: '已读取事实。' } })
    const id = await create(service)
    const original = (await store.listWorkbenchConversations(projectId))[0]!
    const old = Array.from({ length: 8 }, (_, i) => ({ id: `long-${i}`, role: 'user' as const, text: `约束 ${i}：保留数据。` + '中文历史'.repeat(1300), createdAt: created.run.createdAt }))
    await store.saveWorkbenchConversation({ ...original, version: 2, messages: old }, 1)
    const first = await send(service, id, '先读取任务模块')
    expect(first.status, first.error).toBe('idle')
    expect(first.compactions!.length).toBeGreaterThanOrEqual(1)
    expect(first.toolEvents).toEqual([
      expect.objectContaining({ kind: 'tool_request', name: 'repo_read' }),
      expect.objectContaining({ kind: 'tool_result', outcome: 'completed', requestId: first.toolEvents![0]!.id }),
    ])
    expect(first.messages.find((message) => message.role === 'tool')?.toolRequestId).toBe(first.toolEvents![0]!.id)
    expect(first.messages.slice(0, 8)).toEqual(old)
    store.close()
    store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const resumed = harness(async () => ({ value: { text: '继续当前需求。' } }))
    await resumed.service.recoverInterrupted()
    for (let i = 0; i < 3; i++) await send(resumed.service, id, '新增长历史'.repeat(1800))
    const after = (await store.listWorkbenchConversations(projectId)).find((entry) => entry.id === id)!
    expect(after.status, after.error).toBe('idle')
    expect(after.compactions!.length).toBeGreaterThan(first.compactions!.length)
    expect(after.compactions!.at(-1)!.previousBoundaryId).not.toBeNull()
    expect(after.messages.slice(0, 8)).toEqual(old)
    expect(after.toolEvents).toEqual(first.toolEvents)
    expect(after.contextReceipt!.budget!.overflow).toBe(false)
    expect(JSON.parse(resumed.calls.at(-1)!).rollingSummary.trust).toBe('historical_context_only')
    expect(JSON.parse(resumed.calls.at(-1)!).originalRequirements[0].content).toBe(created.run.request)
  })

  it.each(['direct-provider', 'opencode'] as const)('reloads L0 for each %s step without trusting it as authority', async (executor) => {
    let revision = 1
    const loadKnowledge = vi.fn(async () => ({ projectId, contentHash: 'k', indexedAt: created.run.createdAt, truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [],
      projectInstructions: { sourcePath: 'AGENTS.md' as const, content: `Project rule v${revision}`, contentDigest: `sha256:${revision.toString().repeat(64)}`, bytes: 15, truncated: false } }))
    const complete = async () => ++revision === 2 ? { value: { tool: { name: 'workflow', args: {} } } } : { value: { text: '已读当前说明。' } }
    const { service, calls } = harness(complete, true, { loadKnowledge, ...(executor === 'opencode' ? { openHarness: async ({ query }) => ({ id: 'fixture', model: 'test', completeStructuredJson: async (input) => {
      calls.push(input.userPrompt)
      if (revision++ === 1) { await query('workflow', {}); return { value: { question: { prompt: '当前说明是什么？', options: [] }, text: '说明已读。' } } }
      return { value: { text: '已读当前说明。' } }
    } }) } : {}) })
    const id = (await service.command({ type: 'create', projectId, executor })).conversationId!
    expect((await send(service, id)).status).toMatch(/idle|awaiting_answer/)
    expect(JSON.parse(calls[0]!).projectInstructions).toMatchObject({ sourcePath: 'AGENTS.md', content: 'Project rule v1' })
    if (executor === 'direct-provider') expect(JSON.parse(calls[1]!).projectInstructions.content).toBe('Project rule v2')
  })

  it('includes the complete original requirement before a first clarification question (#153)', async () => {
    const requirement = created.run.request
    const { service, calls } = harness(async () => ({ value: { text: '可以按已有要求生成澄清。' } }))
    const result = await send(service, await create(service))
    expect(calls[0]).toContain(requirement)
    expect(result.status, result.error).toBe('idle')
  })

  it('keeps every step prompt an exact-prefix extension of the previous one for provider caching', async () => {
    // Everything before the open toolObservations array must be byte-identical at the next
    // step, so the provider can serve requirements, history and prior observations from cache.
    const cacheablePrefix = (prompt: string) => {
      const context = JSON.parse(prompt)
      return JSON.stringify({ originalRequirements: context.originalRequirements, history: context.history, toolObservations: context.toolObservations }).slice(0, -2)
    }
    let step = 0
    const { service, calls } = harness(async () => {
      step += 1
      if (step === 1) return { value: { tool: { name: 'node', args: { runId: created.run.id, nodeId: created.run.currentNodeId } } } }
      if (step === 2) return { value: { tool: { name: 'requirement', args: { runId: created.run.id } } } }
      if (step === 3) return { value: { tool: { name: 'knowledge', args: { query: '清理' } } } }
      return { value: { text: '已查到当前进展和清理规则。' } }
    })
    const id = await create(service)
    expect((await send(service, id, '先看当前进展和清理规则。')).status).toBe('idle')
    expect(calls).toHaveLength(4)
    for (const [index, prompt] of calls.entries()) {
      const keys = Object.keys(JSON.parse(prompt))
      expect(keys.slice(0, 3)).toEqual(['originalRequirements', 'history', 'toolObservations'])
      expect(keys.at(-1)).toBe('remainingSteps')
      expect(prompt.startsWith(cacheablePrefix(prompt))).toBe(true)
      if (index > 0) expect(prompt.startsWith(cacheablePrefix(calls[index - 1]!))).toBe(true)
    }

    // A new turn keeps the requirement body and the earlier history entries as its prefix.
    step = 3
    const firstTurn = JSON.parse(calls[0]!)
    expect((await send(service, id, '继续。')).status).toBe('idle')
    const nextTurn = calls.at(-1)!
    const sharedAcrossTurns = JSON.stringify({ originalRequirements: firstTurn.originalRequirements, history: firstTurn.history }).slice(0, -2)
    expect(nextTurn.startsWith(sharedAcrossTurns)).toBe(true)
    expect(JSON.parse(nextTurn).history.length).toBeGreaterThan(firstTurn.history.length)
  })

  it('recovers once from invalid model output without losing input, billed usage or workflow state (#154)', async () => {
    let attempts = 0
    const sentSystemTokens: Array<{ estimated: number; sent: number }> = []
    const { service, provider } = harness(async (input) => {
      const receipt = (await store.listWorkbenchConversations(projectId))[0]!.contextReceipt!.budget!
      sentSystemTokens.push({ estimated: receipt.sections.find((section) => section.id === 'system')!.tokens,
        sent: measurePromptSections([{ id: 'system', kind: 'system', required: true, content: input.systemPrompt }], { provider: provider.id, model: provider.model }).tokens })
      if (++attempts === 1) throw new AgentProviderRequestError({ code: 'invalid_model_output', httpStatus: 200,
        deliveryState: 'response_received', billingState: 'confirmed', retryable: true, sanitizedCause: 'invalid_json',
        usage: { inputTokens: 31, outputTokens: 9, totalTokens: 40 } })
      return { value: { text: '更新后的讨论提案已准备好。' }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
    })
    const before = await store.listRuns()
    const result = await send(service, await create(service), '请结合完整原始需求更新讨论提案。')
    expect(result.status, result.error).toBe('idle')
    expect(attempts).toBe(2)
    for (const call of sentSystemTokens) expect(call.estimated).toBe(call.sent)
    expect(result.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(result.messages.at(-1)?.text).toBe('更新后的讨论提案已准备好。')
    expect(result.messages.reduce((sum, m) => sum + (m.usage?.totalTokens ?? 0), 0)).toBe(55)
    expect(await store.listRuns()).toEqual(before)
  })

  it('provides the full six-condition request at any node and supports long-body continuation (#153)', async () => {
    const body = '全部/未完成/已完成；默认全部并高亮；切换不改任务；勾选立即更新；无结果中文提示；刷新筛选恢复全部，任务数据保留；保留新增、删除、清除已完成、保存。'
    const flow = createWorkflowRunFromRequest({ runId: 'filter-run', title: '筛选', request: body, projectId, creatorId: 'u-test', branchName: 'ai/filter', now: created.run.createdAt })
    await store.saveRun(flow.run)
    for (const artifact of flow.artifacts) await store.saveArtifact(artifact)
    const long = { ...flow.artifacts[0]!, id: 'long-artifact', kind: 'log' as const, content: '长正文'.repeat(8000) + '最后的验收条件' }
    await store.saveArtifact(long)
    let step = 0
    const { service, calls } = harness(async (input) => {
      const context = JSON.parse(input.userPrompt)
      if (step++ === 0) return { value: { tool: { name: 'node', args: { runId: flow.run.id, nodeId: `${flow.run.id}-design` } } } }
      if (step === 2) {
        expect(context.originalRequirements).toEqual([expect.objectContaining({ runId: flow.run.id, content: body, truncated: false, source: 'raw_request' })])
        expect(context.toolObservations.at(-1).result.rawRequest.content).toBe(body)
        return { value: { tool: { name: 'artifact', args: { runId: flow.run.id, artifactId: long.id, offset: 23000, limit: 18000 } } } }
      }
      const page = context.toolObservations.at(-1).result
      expect(page.content).toContain('最后的验收条件')
      expect(page).toMatchObject({ offset: 23000, endOffset: long.content.length, nextOffset: null, truncated: true })
      return { value: { text: '未明确的具体空状态文案仍可确认。', question: { prompt: '中文提示用什么文案？', options: [] } } }
    })
    const result = await send(service, await create(service))
    expect(result.status, result.error).toBe('awaiting_answer')
    expect(calls[1]).not.toContain(created.run.request)
    expect((await store.listArtifacts(flow.run.id))).toHaveLength(2)
  })

  it('loads a targeted requirement before accepting a draft even when the model skipped tools (#153)', async () => {
    const flow = createWorkflowRunFromRequest({ runId: 'other-run', title: '另一任务', request: 'OTHER_RUN_REQUIREMENTS', projectId, creatorId: 'u-test', branchName: 'ai/other', now: created.run.createdAt })
    await store.saveRun(flow.run)
    for (const artifact of flow.artifacts) await store.saveArtifact(artifact)
    let step = 0
    const { service } = harness(async (input) => {
      if (step++ > 0) expect(JSON.parse(input.userPrompt).originalRequirements).toEqual([expect.objectContaining({ runId: flow.run.id, content: flow.run.request })])
      return { value: { text: '草稿待保存。', draft: { runId: flow.run.id, nodeId: flow.run.currentNodeId, title: '草稿', content: '待确认内容' } } }
    })
    const result = await send(service, await create(service), '帮另一任务整理草稿')
    expect(step).toBe(3)
    expect(result.messages.filter((m) => m.draft)).toHaveLength(1)
    expect((await store.listArtifacts(flow.run.id))).toHaveLength(1)
  })

  it('marks long original requirements as partial and returns the final page through the scoped requirement tool (#153)', async () => {
    const body = '原始需求正文'.repeat(2000) + '最后一条验收条件'
    const flow = createWorkflowRunFromRequest({ runId: 'long-request-run', title: '长需求', request: body, projectId, creatorId: 'u-test', branchName: 'ai/long', now: created.run.createdAt })
    await store.saveRun(flow.run)
    for (const artifact of flow.artifacts) await store.saveArtifact(artifact)
    let step = 0
    const { service } = harness(async (input) => {
      const context = JSON.parse(input.userPrompt)
      if (step++ === 0) return { value: { tool: { name: 'node', args: { runId: flow.run.id, nodeId: flow.run.currentNodeId } } } }
      if (step === 2) {
        const first = context.originalRequirements[0]
        expect(first).toMatchObject({ runId: flow.run.id, truncated: true, offset: 0, nextOffset: 6000, totalCharacters: body.length })
        expect(context.toolObservations.at(-1).result.artifacts[0]).toMatchObject({ bodyIncluded: false })
        return { value: { tool: { name: 'requirement', args: { runId: flow.run.id, offset: first.nextOffset, limit: 18000 } } } }
      }
      const last = context.toolObservations.at(-1).result
      expect(last).toMatchObject({ runId: flow.run.id, offset: 6000, endOffset: body.length, nextOffset: null })
      expect(last.content).toContain('最后一条验收条件')
      return { value: { text: '已读到原始需求的最后一条。' } }
    })
    expect((await send(service, await create(service))).status).toBe('idle')
  })

  it('asks which Run to discuss instead of inventing missing business requirements without a scoped source (#153)', async () => {
    const flow = createWorkflowRunFromRequest({ runId: 'unrelated', title: '另一任务', request: '另一需求', projectId, creatorId: 'u-test', branchName: 'ai/other', now: created.run.createdAt })
    await store.saveRun(flow.run)
    const { service } = harness(async () => ({ value: { text: '没有提供需求', question: { prompt: '有哪些筛选项？', options: [] } } }))
    const result = await send(service, await create(service))
    expect(result.messages.at(-1)?.question?.prompt).toContain('哪个 Run')
    expect(result.messages.at(-1)?.text).not.toContain('没有提供需求')
  })

  it('keeps original requirements and the current question when older context is trimmed (#153)', async () => {
    let step = 0
    const { service } = harness(async (input) => {
      const context = JSON.parse(input.userPrompt)
      expect(context.originalRequirements[0].content).toBe(created.run.request)
      expect(context.history.at(-1).text).toContain('当前问题')
      expect(input.userPrompt.length).toBeLessThanOrEqual(32000)
      if (step++ === 0) return { value: { tool: { name: 'repo_read', args: { path: 'long.md' } } } }
      return { value: { text: '依据原始需求继续。' } }
    })
    await writeFile(path.join(project.path, 'long.md'), '工具返回内容'.repeat(3000))
    const id = await create(service)
    const original = (await store.listWorkbenchConversations(projectId))[0]!
    await store.saveWorkbenchConversation({ ...original, version: original.version + 1, messages: Array.from({ length: 8 }, (_, i) => ({ id: `history-${i}`, role: 'assistant', createdAt: created.run.createdAt, text: '旧内容'.repeat(1800) })) }, original.version)
    const result = await send(service, id, '当前问题：根据原始需求回答')
    expect(result.status, result.error).toBe('idle')
    expect(result.contextReceipt!.omittedMessages).toBeGreaterThan(0)
  })

  it('falls back to Run.request when artifact reading fails and suppresses unfounded clarification if neither is available (#153)', async () => {
    const read = vi.spyOn(store, 'listArtifacts').mockRejectedValue(new Error('unavailable'))
    const { service, calls } = harness(async () => ({ value: { text: '没有需求，请重新填写', question: { prompt: '要做什么？', options: [] } } }))
    const id = await create(service)
    const first = await send(service, id)
    expect(JSON.parse(calls[0]!).originalRequirements[0]).toMatchObject({ source: 'run_request', content: created.run.request })
    expect(first.status, first.error).toBe('awaiting_answer')
    vi.spyOn(store, 'listRuns').mockResolvedValue([{ ...created.run, request: '' }])
    const failedRead = await send(service, id)
    expect(failedRead.messages.at(-1)?.text).toContain('原始需求正文暂时无法读取')
    expect(failedRead.messages.at(-1)?.question).toBeUndefined()
    read.mockRestore()
  })

  it.each(['{broken JSON PRIVATE_RESPONSE', '', '[]'])('bounds real parser recovery and persists actionable diagnostics across restart: %s (#154)', async (raw) => {
    let requests = 0
    const provider = createOpenAiCompatibleAgentProvider({ id: 'fixture', model: 'fixture', apiKey: 'test-only', baseUrl: 'https://example.test/v1',
      fetcher: async () => { requests++; return Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 31, completion_tokens: 9, total_tokens: 40 } }) } })
    const service = new WorkbenchConversationService({ store, resolveProvider: async () => provider, loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    const id = await create(service)
    const result = await send(service, id)
    expect(requests).toBe(3)
    expect(result.status, result.error).toBe('failed')
    expect(result.failure).toMatchObject({ code: 'invalid_model_output', httpStatus: 200, reason: raw === '' ? 'empty_content' : raw === '[]' ? 'not_json_object' : 'invalid_json' })
    expect(result.error).not.toMatch(/配置|网络/)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RESPONSE')
    expect(result.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(result.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(result.messages.reduce((sum, m) => sum + (m.usage?.totalTokens ?? 0), 0)).toBe(120)
    const reopened = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    expect((await reopened.listWorkbenchConversations(projectId))[0]).toEqual(result)
  })

  it('retries transient network errors but never credentials, filtered responses or cancellation (#154)', async () => {
    for (const [code, retryable, reason] of [['http_4xx', false, 'unauthorized'], ['connection_reset', true, 'reset'], ['invalid_model_output', false, 'content_filter'], ['cancelled_by_user', false, 'cancelled']] as const) {
      const { service, provider } = harness(async () => { throw new AgentProviderRequestError({ code, retryable, sanitizedCause: reason, deliveryState: 'response_received', billingState: 'unknown' }) })
      await send(service, await create(service))
      expect(provider.completeStructuredJson).toHaveBeenCalledTimes(retryable ? 3 : 1)
    }
  })

  it('retains billed OpenCode usage on a failed response without inventing an answer or falling back', async () => {
    const direct = vi.fn(async () => { throw new Error('must not fall back') })
    const close = vi.fn(async () => {})
    const service = new WorkbenchConversationService({ store, resolveProvider: direct,
      openHarness: async () => ({ id: 'saved-provider', model: 'harness-model', close,
        completeStructuredJson: async () => { throw new ConversationExecutorError('会话执行器未返回有效答复，请重试。', { inputTokens: 42, outputTokens: 8, totalTokens: 50 }) } }),
      loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    const id = (await service.command({ type: 'create', projectId, executor: 'opencode' })).conversationId!
    const result = await send(service, id)
    expect(result.status, result.error).toBe('failed')
    expect(result.messages.find((message) => message.provider)).toMatchObject({ usage: { totalTokens: 50 }, provider: { executor: 'opencode' } })
    expect(result.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
    expect(direct).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('retains already reported usage when a provider fails after returning billed output', async () => {
    const { service } = harness(async () => { throw new AgentProviderRequestError({ code: 'invalid_model_output',
      deliveryState: 'response_received', billingState: 'confirmed', retryable: true, sanitizedCause: 'invalid_json',
      usage: { inputTokens: 31, outputTokens: 9, totalTokens: 40 } }) })
    const id = await create(service)
    const saved = await send(service, id)
    expect(saved.status).toBe('failed')
    expect(saved.messages.find((message) => message.provider)?.usage?.totalTokens).toBe(40)
    expect(saved.messages.filter((message) => message.role === 'assistant')).toHaveLength(0)
  })
  it('uses the selected external harness with scoped live queries and preserves that selection across restart', async () => {
    const direct = vi.fn(async () => { throw new Error('must not fall back') })
    const close = vi.fn(async () => {})
    const openHarness = vi.fn(async (input: Parameters<import('./conversation-executor').OpenConversationHarness>[0]) => ({
      id: 'saved-provider', model: 'harness-model', close,
      completeStructuredJson: async () => {
        const own = await input.query('node', { runId: created.run.id, nodeId: created.run.currentNodeId })
        expect(JSON.stringify(own)).toContain(created.run.currentNodeId)
        const denied = await input.query('node', { runId: 'foreign-run', nodeId: 'foreign-node' })
        expect(JSON.stringify(denied)).toContain('不属于当前项目')
        return { value: { text: '当前是需求澄清。', format: 'markdown' } }
      },
    }))
    const service = new WorkbenchConversationService({ store, resolveProvider: direct, openHarness,
      loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    const response = await service.command({ type: 'create', projectId, executor: 'opencode' })
    const id = response.conversationId!
    await service.command({ type: 'send', projectId, conversationId: id, providerId: 'saved-provider', text: '进展如何' })
    await service.settled(id)
    const saved = (await store.listWorkbenchConversations(projectId))[0]!
    expect(saved.executor).toBe('opencode')
    expect(saved.status).toBe('idle')
    expect(saved.messages.filter((message) => message.role === 'tool')).toHaveLength(2)
    expect(saved.messages.at(-1)?.text).toBe('当前是需求澄清。')
    expect(direct).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    expect(() => parseConversationCommand({ type: 'update', projectId, conversationId: id, executor: 'direct-provider' })).toThrow()
    const restarted = new WorkbenchConversationService({ store, resolveProvider: direct,
      openHarness: async () => { throw new Error('OpenCode 未安装，请安装后重试。') }, loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    await restarted.recoverInterrupted()
    await restarted.command({ type: 'send', projectId, conversationId: id, providerId: 'saved-provider', text: '再查一次' })
    await restarted.settled(id)
    const failed = (await store.listWorkbenchConversations(projectId))[0]!
    expect(failed.executor).toBe('opencode')
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('OpenCode')
    expect(failed.messages.some((message) => message.text === '当前是需求澄清。')).toBe(true)
    expect(direct).not.toHaveBeenCalled()
  })
  it.each([
    ['markdown', 'markdown'], ['plain_text', 'plain_text'], ['future-format', 'unsupported'],
    [undefined, 'plain_text'], [{ wrong: true }, 'unsupported'],
  ])('persists the declared body format with a readable fallback: %s', async (format, expected) => {
    const { service } = harness(async () => ({ value: { text: '**完整原文**', format } }))
    const result = await send(service, await create(service))
    expect(result.messages.at(-1)).toMatchObject({ text: '**完整原文**', format: expected })
    expect(result.status, result.error).toBe('idle')
  })

  it('preserves legacy notes for inspection but never sends them to the model or accepts new manual notes', async () => {
    const { service, calls } = harness(async () => ({ value: { text: '继续当前讨论。' } }))
    const id = await create(service)
    const original = (await service.command({ type: 'list', projectId })).conversations[0]!
    await store.saveWorkbenchConversation({ ...original, version: original.version + 1, memory: 'LEGACY_HIDDEN_INSTRUCTION', inputDraft: '未发送草稿' }, original.version)
    store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const restarted = harness(async () => ({ value: { text: '继续当前讨论。' } }))
    const restored = (await restarted.service.command({ type: 'list', projectId })).conversations[0]!
    expect(restored).toMatchObject({ memory: 'LEGACY_HIDDEN_INSTRUCTION', inputDraft: '未发送草稿' })
    const result = await send(restarted.service, id, '请按正常聊天继续')
    expect(restarted.calls[0]).not.toContain('LEGACY_HIDDEN_INSTRUCTION')
    expect(JSON.parse(restarted.calls[0]!)).not.toHaveProperty('conversationMemory')
    expect(result.messages.at(-1)?.text).toBe('继续当前讨论。')
    await expect(restarted.service.command({ type: 'update', projectId, conversationId: id, memory: '新的隐藏要求' })).rejects.toThrow('无效的会话操作')
    expect(calls).toHaveLength(0)
  })

  it('redacts a credential split across reasoning chunks before exposing conversation records', async () => {
    let id = ''
    const { service, provider } = harness(async (input) => {
      await input.reasoning!.onDelta!('检查凭据 sk-abc')
      const first = (await service.command({ type: 'list', projectId })).conversations.find((item) => item.id === id)!
      expect(JSON.stringify(first)).not.toContain('sk-abc')
      await input.reasoning!.onDelta!('def1234567890。')
      return { value: { text: '已完成检查。' }, reasoningContent: '检查凭据 sk-abcdef1234567890。' }
    })
    provider.billingProvider = 'deepseek'
    provider.effectiveThinking = { mode: 'enabled', effort: 'low', source: 'application_default' }
    id = await create(service)
    const result = await send(service, id)
    expect(result.status, result.error).toBe('idle')
    expect(result.messages.find((message) => message.reasoning)?.reasoning?.text).toContain('[REDACTED:openai_api_key]')
    expect(JSON.stringify(result)).not.toContain('abcdef1234567890')
  })

  it('retains interrupted reasoning, retries without duplicating the question, and excludes reasoning from later prompts', async () => {
    const encoder = new TextEncoder()
    const requests: string[] = []
    const provider = createOpenAiCompatibleAgentProvider({ id: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'test-only',
      fetcher: async (_url, init) => {
        requests.push(String(init?.body))
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING 已查到初步结果。' }, finish_reason: null }] })}\n\n`))
          if (requests.length > 1) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"text":"重试完成。"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 } })}\n\ndata: [DONE]\n\n`))
            controller.close()
          }
        } }), { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    const service = new WorkbenchConversationService({ store, resolveProvider: async () => provider, loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    const id = await create(service)
    await service.command({ type: 'send', projectId, conversationId: id, providerId: provider.id, text: '检查需求。' })
    await vi.waitFor(async () => expect((await service.command({ type: 'list', projectId })).conversations[0]!.messages.some((message) => message.reasoning?.text.includes('初步结果'))).toBe(true))
    await service.command({ type: 'cancel', projectId, conversationId: id })
    await service.settled(id)
    const cancelled = (await service.command({ type: 'list', projectId })).conversations[0]!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.messages.find((message) => message.reasoning)?.reasoning).toMatchObject({ text: 'PRIVATE_REASONING 已查到初步结果。', status: 'interrupted' })
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: provider.id })
    await service.settled(id)
    const retried = (await service.command({ type: 'list', projectId })).conversations[0]!
    expect(retried.status).toBe('idle')
    expect(retried.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(retried.messages.filter((message) => message.reasoning).map((message) => message.reasoning!.status)).toEqual(['interrupted', 'completed'])
    expect(retried.messages.at(-1)?.text).toBe('重试完成。')
    expect(requests[1]).not.toContain('PRIVATE_REASONING')
  })

  it('publishes live reasoning only to its own conversation and restores it separately from the answer', async () => {
    const encoder = new TextEncoder()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const provider = createOpenAiCompatibleAgentProvider({ id: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'test-only',
      fetcher: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING 先核对项目状态。' }, finish_reason: null }] })}\n\n`))
      } }), { headers: { 'content-type': 'text/event-stream' } }),
    })
    const service = new WorkbenchConversationService({ store, resolveProvider: async () => provider, loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
    const first = await create(service)
    const second = await create(service)
    try {
      await service.command({ type: 'send', projectId, conversationId: first, providerId: provider.id, text: '目前进展？' })
      await vi.waitFor(async () => {
        const current = (await service.command({ type: 'list', projectId })).conversations.find((session) => session.id === first)!
        expect(current.status).toBe('running')
        expect(current.messages.find((message) => message.reasoning)?.reasoning).toMatchObject({ text: 'PRIVATE_REASONING 先核对项目状态。', status: 'streaming', effort: 'low' })
        expect(current.messages.some((message) => message.role === 'assistant')).toBe(false)
      })
      expect((await service.command({ type: 'list', projectId })).conversations.find((session) => session.id === second)!.messages).toEqual([])
      expect(JSON.stringify(await store.loadState())).not.toContain('PRIVATE_REASONING')
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"text":"当前在需求澄清阶段。"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } })}\n\ndata: [DONE]\n\n`))
      stream.close()
      await service.settled(first)
      store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
      const restarted = new WorkbenchConversationService({ store, resolveProvider: async () => provider, loadKnowledge: async () => { throw new Error('unused') }, changed: vi.fn() })
      const saved = (await restarted.command({ type: 'list', projectId })).conversations.find((session) => session.id === first)!
      expect(saved.status).toBe('idle')
      expect(saved.messages.find((message) => message.reasoning)).toMatchObject({ reasoning: { status: 'completed', text: 'PRIVATE_REASONING 先核对项目状态。' }, usage: { totalTokens: 50 } })
      expect(saved.messages.at(-1)?.text).toBe('当前在需求澄清阶段。')
    } finally { try { stream.close() } catch { /* already closed */ } await service.settled(first) }
  })

  it.each(['completed', 'approval_required'] as const)('exposes actual publication facts for a %s delivery without leaking unrelated records or internal metadata', async (status) => {
    const node = created.run.nodes.find((item) => item.kind === 'pr')!
    const stamp = created.run.updatedAt
    const intent: GitHubDeliveryIntent = {
      stateVersion: 1, id: 'delivery-current', organizationId: 'org-test', teamProjectId: 'team-test',
      localProjectId: projectId, runId: created.run.id, runVersion: created.run.version, nodeId: node.id,
      repositoryBindingId: 'internal-binding', repositoryBindingVersion: 1, installationId: 'internal-installation', repositoryId: 'repository-1',
      codingRunId: 'coding-1', codingRunCompletedAt: stamp, workspaceId: 'internal-workspace',
      deliverySeriesKey: 'internal-series', deliveryAttempt: 1, repository: 'example/task-list', baseBranch: 'main', headBranch: 'devflow/task-list',
      baseCommitSha: 'a'.repeat(40), expectedCommitSha: 'b'.repeat(40), diffArtifactId: 'diff-1', diffSourceDigest: 'c'.repeat(64),
      testEvidenceId: 'test-1', testEvidenceCreatedAt: stamp, testEvidenceDigest: 'd'.repeat(64),
      prPackageArtifactId: 'pr-1', prPackageUpdatedAt: stamp, prPackageDigest: 'e'.repeat(64), changedPaths: ['tasks.ts'],
      intentDigest: 'f'.repeat(64), idempotencyKey: 'internal-idempotency-key', status, createdAt: stamp, updatedAt: stamp, redacted: true,
      ...(status === 'completed' ? { completion: {
        stateVersion: 1, remoteRequestId: 'internal-request', publicationId: 'internal-publication', pullRequestOutcomeId: 'internal-outcome',
        pullRequestId: '123', pullRequestNumber: 3, pullRequestUrl: 'https://github.com/example/task-list/pull/3',
        providerCreatedAt: stamp, recordedAt: stamp, draft: true, redacted: true,
      } } : {}),
    }
    const state = await store.loadState()
    vi.spyOn(store, 'loadState').mockResolvedValue({ ...state, githubDeliveryIntents: [
      intent,
      { ...intent, id: 'foreign-run-delivery', runId: 'foreign-run' },
      { ...intent, id: 'foreign-project-delivery', localProjectId: 'foreign-project' },
    ] })
    let step = 0
    const { service, calls } = harness(async () => ({ value: step++ === 0
      ? { tool: { name: 'node', args: { runId: created.run.id, nodeId: node.id } } }
      : { text: '已读取真实发布记录。' } }))
    await send(service, await create(service), '请查询这个项目的实际 PR 链接和交付 commit。')
    const delivery = JSON.parse(calls[1]!).toolObservations[0].result.execution.delivery
    expect(delivery).toEqual([{
      id: intent.id, nodeId: node.id, status, repository: intent.repository, baseBranch: intent.baseBranch, headBranch: intent.headBranch,
      expectedCommitSha: intent.expectedCommitSha, updatedAt: stamp,
      ...(status === 'completed' ? { completion: {
        pullRequestNumber: 3, pullRequestUrl: 'https://github.com/example/task-list/pull/3', draft: true, providerCreatedAt: stamp, recordedAt: stamp,
      } } : {}),
    }])
    expect(calls[1]).not.toMatch(/internal-|foreign-run-delivery|foreign-project-delivery/)
  })

  it.each(created.run.nodes.map((node) => [node.id, node] as const))('reads the real %s node, including every stage and node type', async (_id, node) => {
    let step = 0
    const { service, calls, inspectGate } = harness(async () => ({ value: step++ === 0 ? { tool: { name: 'node', args: { runId: created.run.id, nodeId: node.id } } } : { text: `已查询 ${node.title}`, actions: [{ label: '定位到节点', runId: created.run.id, nodeId: node.id, section: node.kind === 'test' ? '测试证据' : '状态' }] } }))
    const result = await send(service, await create(service))
    expect(result.status, result.error).toBe('idle')
    const context = JSON.parse(calls[1]!)
    expect(context.latestWorkflow.runs[0].nodes).toHaveLength(created.run.nodes.length)
    expect(context.toolObservations[0].result.node).toMatchObject({ id: node.id, kind: node.kind, status: node.status })
    expect(result.messages.at(-1)?.actions?.[0]).toMatchObject({ runId: created.run.id, nodeId: node.id })
    expect(inspectGate).toHaveBeenCalledTimes(['gate', 'acceptance'].includes(node.kind) ? 1 : 0)
  })

  it('investigates actual code and knowledge, then persists a question and resumes it', async () => {
    let step = 0
    const outputs = [
      { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } },
      { tool: { name: 'knowledge', args: { query: '清理' } } },
      { text: '代码用 filter 保留未完成项，知识要求相同。需要确定撤销行为。', question: { prompt: '需要撤销吗？', options: ['需要', '不需要'] }, citationIds: ['source-1', 'source-2'] },
      { text: '已记录，本次不提供撤销。' },
    ]
    const { service, calls } = harness(async () => ({ value: outputs[step++]! }))
    const id = await create(service)
    const first = await send(service, id, '结合代码和知识澄清清理功能。')
    expect(first.status, first.error).toBe('awaiting_answer')
    expect(calls[2]).toContain('tasks.filter')
    expect(calls[2]).toContain('清理操作只删除已完成项')
    const question = first.messages.at(-1)!
    expect(question.citations).toHaveLength(2)
    const resumed = await send(service, id, '不需要', { answerToMessageId: question.id })
    expect(resumed.status).toBe('idle')
    expect(resumed.messages.find((item) => item.id === question.id)?.question?.answeredAt).toBeTruthy()
    expect(calls[3]).toContain('需要撤销吗')
  })
  it('lists and reads the knowledge directory with knowledge_list and knowledge_read (knowledge-context K3)', async () => {
    let step = 0
    const outputs = [
      { tool: { name: 'knowledge_list', args: { stage: 'build' } } },
      { tool: { name: 'knowledge_read', args: { path: 'docs/knowledge/build.md' } } },
      { tool: { name: 'knowledge_read', args: { path: 'tasks.ts' } } },
      { text: '构建规范要求保留任务顺序。', citationIds: ['source-2'] },
    ]
    const calls: string[] = []
    const systems: string[] = []
    const provider = { ...createFakeAgentProvider(), supportsNativeTools: false, completeStructuredJson: vi.fn(async (input: Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0]) => {
      calls.push(input.userPrompt)
      systems.push(input.systemPrompt)
      return { value: outputs[step++]! }
    }) }
    const index = indexKnowledgeSources([
      { sourcePath: 'docs/knowledge/build.md', markdown: '---\ntitle: Build rule\nstages: [build]\ngate: [build]\n---\n# Build rule\nBUILD_RULE_BODY keep task order.', updatedAt: '2026-09-30T00:00:00.000Z' },
      { sourcePath: 'docs/knowledge/pr.md', markdown: '---\ntitle: PR rule\nstages: [pr]\n---\n# PR rule\nPR_RULE_BODY', updatedAt: '2026-09-30T00:00:00.000Z' },
    ])
    const service = new WorkbenchConversationService({
      store, resolveProvider: async () => provider, changed: vi.fn(),
      loadKnowledge: async (id) => ({ projectId: id, contentHash: 'knowledge-hash', indexedAt: '2026-09-30T00:00:00.000Z', truncated: false, warnings: [],
        documents: index.documents, chunks: index.chunks, entities: [], relations: [], knowledgeRoot: 'docs/knowledge', projectInstructions: null }),
    })
    const result = await send(service, await create(service), '构建阶段有什么规范？')

    expect(systems[0]).toContain('knowledge_list({stage?,offset?})')
    expect(systems[0]).toContain('knowledge_read({path,offset?,limit?})')
    expect(systems[0]).not.toContain('knowledge({query})')
    const listed = JSON.parse(calls[1]!).toolObservations.at(-1)
    expect(listed).toMatchObject({ name: 'knowledge_list', result: { stage: 'build', totalDocuments: 1, documents: [expect.objectContaining({ path: 'docs/knowledge/build.md', gateStages: ['build'] })] } })
    expect(calls[1]).not.toContain('PR_RULE_BODY')
    expect(calls[2]).toContain('BUILD_RULE_BODY keep task order.')
    // Paths outside the directory are refused with a pointer to repo_read.
    expect(JSON.parse(calls[3]!).toolObservations.at(-1).result.error).toContain('repo_read')
    expect(result.status, result.error).toBe('idle')
  })

  it.each([
    { prompt: '草案是否按此保存？', purpose: undefined, resolved: true },
    { prompt: '将这份方案存到节点吗？', purpose: 'save_proposal', resolved: true },
    { prompt: '保存前需要增加撤销功能吗？', purpose: 'clarification', resolved: false },
  ])('resolves only the corresponding proposal confirmation after successful save: $prompt', async ({ prompt, purpose, resolved }) => {
    let value: Record<string, unknown> = { text: '还有一项业务问题。', question: { prompt: '空列表文案是什么？', options: [] } }
    const { service } = harness(async () => ({ value }))
    const id = await create(service)
    const first = await send(service, id)
    const firstQuestionId = first.messages.at(-1)!.id
    value = { text: '请核对草稿。', question: { prompt, purpose, options: [] }, draft: { runId: created.run.id, nodeId: created.run.currentNodeId, title: '候选需求', content: '仅删除已完成任务。' } }
    const draft = await send(service, id, '先起草')
    const messageId = draft.messages.at(-1)!.id
    const save = { type: 'publish', projectId, conversationId: id, messageId }
    vi.spyOn(store, 'saveWorkbenchConversation').mockResolvedValueOnce(false)
    await expect(service.command(save)).rejects.toThrow('会话已经更新')
    expect((await service.command({ type: 'list', projectId })).conversations[0]!.messages.find((message) => message.id === messageId)!.question?.answeredAt).toBeUndefined()
    await service.command(save)
    store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const restarted = harness(async () => ({ value: { text: '已收到业务回答。' } }))
    const restored = (await restarted.service.command({ type: 'list', projectId })).conversations[0]!
    expect(restored.status).toBe('awaiting_answer')
    expect(restored.messages.find((message) => message.id === firstQuestionId)!.question?.answeredAt).toBeUndefined()
    const saved = restored.messages.find((message) => message.id === messageId)!
    expect(Boolean(saved.question?.answeredAt)).toBe(resolved)
    expect(saved.draft?.publishedArtifactId).toBeTruthy()
    const answered = await send(restarted.service, id, '显示暂无任务', { answerToMessageId: firstQuestionId })
    expect(answered.status).toBe(resolved ? 'idle' : 'awaiting_answer')
  })

  it('keeps unanswered questions while the same chat asks about another node', async () => {
    let step = 0
    const { service } = harness(async () => ({ value: step++ === 0 ? { text: '请补充。', question: { prompt: '是否撤销？', options: [] } } : { text: '测试尚未执行。' } }))
    const id = await create(service)
    await send(service, id)
    const result = await send(service, id, '先告诉我测试节点的进度')
    expect(result.status, result.error).toBe('awaiting_answer')
    expect(result.messages.find((message) => message.question)?.question?.answeredAt).toBeUndefined()
  })

  it('isolates histories, memory and private drafts while querying fresh common workflow and published proposals', async () => {
    const node = created.run.nodes[0]!
    let value: Record<string, unknown> = { text: 'PRIVATE_A_REPLY', draft: { runId: created.run.id, nodeId: node.id, title: '共同提案', content: '仅删除已完成的任务。' } }
    const { service, calls } = harness(async () => ({ value }))
    const a = await create(service); const b = await create(service)
    const legacy = (await service.command({ type: 'list', projectId })).conversations.find((session) => session.id === a)!
    await store.saveWorkbenchConversation({ ...legacy, version: legacy.version + 1, memory: 'PRIVATE_A_MEMORY' }, legacy.version)
    const draft = await send(service, a, 'PRIVATE_A_MESSAGE')
    value = { text: '项目目前仍在需求澄清。' }
    await send(service, b, 'PRIVATE_B_MESSAGE')
    expect(calls.at(-1)).not.toMatch(/PRIVATE_A|共同提案|仅删除已完成的任务/)
    expect((await store.listArtifacts()).some((artifact) => artifact.title.includes('共同提案'))).toBe(false)
    await service.command({ type: 'publish', projectId, conversationId: a, messageId: draft.messages.at(-1)!.id })
    const artifact = (await store.listArtifacts()).find((item) => item.title.includes('共同提案'))!
    expect(artifact.kind).toBe('log')
    expect((await store.getRun(created.run.id))?.version).toBe(created.run.version)
    expect((await store.getRun(created.run.id))?.currentNodeId).toBe(created.run.currentNodeId)
    let round = 0
    const shared = harness(async () => ({ value: round++ === 0 ? { tool: { name: 'artifact', args: { runId: created.run.id, artifactId: artifact.id } } } : { text: '已查到待确认的共同提案。' } }))
    await send(shared.service, b, '查看新的共同提案。')
    expect(shared.calls[1]).toContain('仅删除已完成的任务')
    expect(shared.calls.join('')).not.toMatch(/PRIVATE_A/)
    await store.saveRun({ ...created.run, title: 'UPDATED_SHARED_TITLE', version: created.run.version + 1 })
    await send(service, b, '现在呢？')
    expect(calls.at(-1)).toContain('UPDATED_SHARED_TITLE')
    expect(JSON.stringify(await store.loadState())).not.toMatch(/PRIVATE_A|PRIVATE_B/)
  })

  it('passes only explicitly published proposals into the real stage artifact generator', async () => {
    const node = created.run.nodes[0]!
    const { service } = harness(async () => ({ value: { text: '请核对提案。', draft: { runId: created.run.id, nodeId: node.id, title: '验收补充', content: '本次不增加撤销；空列表不执行删除。' } } }))
    const id = await create(service)
    const conversation = await send(service, id, 'PRIVATE_INPUT_NOT_SHARED')
    await service.command({ type: 'publish', projectId, conversationId: id, messageId: conversation.messages.at(-1)!.id })
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    const contexts: string[] = []
    provider.generateWorkflowArtifact = async (input) => {
      contexts.push(JSON.stringify(input.context))
      return generate(input)
    }
    const result = await runWorkflowStageAgent({ run: created.run, node, artifacts: await store.listArtifacts(created.run.id), provider, requestedBy: 'u-test', runtime: 'electron' })
    expect(result.artifact.kind).toBe('clarification')
    expect(contexts[0]).toContain('本次不增加撤销；空列表不执行删除。')
    expect(contexts[0]).toContain('待确认')
    expect(contexts[0]).not.toContain('PRIVATE_INPUT_NOT_SHARED')
  })

  it('keeps two concurrently running conversations independent', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const hold = new Promise<void>((resolve) => { release = resolve })
    const { service } = harness(async (input) => {
      if (input.userPrompt.includes('PRIVATE_SLOW')) { entered(); await hold }
      return { value: { text: input.userPrompt.includes('PRIVATE_SLOW') ? '慢会话完成' : '快会话完成' } }
    })
    const a = await create(service); const b = await create(service)
    await service.command({ type: 'send', projectId, conversationId: a, providerId: 'test', text: 'PRIVATE_SLOW' })
    await started
    const second = await send(service, b, 'PRIVATE_FAST')
    expect(second.messages.at(-1)?.text).toBe('快会话完成')
    expect((await store.listWorkbenchConversations(projectId)).find((item) => item.id === a)?.status).toBe('running')
    release(); await service.settled(a)
    expect((await store.listWorkbenchConversations(projectId)).find((item) => item.id === a)?.messages.at(-1)?.text).toBe('慢会话完成')
    expect(second.messages.some((message) => message.role === 'notice' && message.provider && !message.usage)).toBe(true)
  })

  it('fits large history and tool observations inside the real structured Provider limit', async () => {
    const artifact = { ...created.artifacts[0]!, id: 'large-artifact', kind: 'log' as const, content: '调查记录'.repeat(5000) }
    await store.saveArtifact(artifact)
    let step = 0
    const { service, calls } = harness(async (input) => {
      expect(input.userPrompt.length).toBeLessThanOrEqual(32000)
      return { value: step++ === 0 ? { tool: { name: 'artifact', args: { runId: created.run.id, artifactId: artifact.id } } } : { text: '已读取部分依据，可以继续分段查询。' } }
    })
    const id = await create(service)
    const current = (await store.listWorkbenchConversations(projectId))[0]!
    await store.saveWorkbenchConversation({ ...current, version: 2, memory: '会话记忆'.repeat(1500), messages: Array.from({ length: 6 }, (_, index) => ({ id: `history-${index}`, role: 'user' as const, text: '历史讨论'.repeat(1300), createdAt: created.run.createdAt })) }, 1)
    const result = await send(service, id, '最新问题'.repeat(2500))
    expect(result.status, result.error).toBe('idle')
    expect(calls[1]).toContain('上下文受长度限制')
    expect(result.contextReceipt?.limited).toBe(true)
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(7)
  })

  it('queries runs beyond the first overview page without changing project scope', async () => {
    for (let index = 0; index < 35; index++) {
      const other = createWorkflowRunFromRequest({ runId: `history-run-${index}`, title: `历史任务 ${index}`, request: '另一条真实流程', projectId, creatorId: 'u-test', branchName: `ai/history-${index}`, now: created.run.createdAt })
      await store.saveRun(other.run)
    }
    let step = 0
    const { service, calls } = harness(async () => ({ value: step++ === 0 ? { tool: { name: 'workflow', args: { offset: 30 } } } : { text: '已查询剩余流程。' } }))
    const result = await send(service, await create(service))
    expect(result.status, result.error).toBe('idle')
    const observed = JSON.parse(calls[1]!).toolObservations[0].result
    expect(observed).toMatchObject({ totalRuns: 36, offset: 30, nextOffset: null })
    expect(observed.runs).toHaveLength(6)
    expect(result.contextReceipt?.limited).toBe(true)
  })

  it('keeps credential failure actionable before any Provider request', async () => {
    const service = new WorkbenchConversationService({ store, resolveProvider: async () => { throw new Error('safeStorage decryption failed') }, loadKnowledge: async () => { throw new Error('must not run') }, changed: vi.fn() })
    const result = await send(service, await create(service))
    expect(result.status, result.error).toBe('failed')
    expect(result.error).toContain('重新保存 API Key')
    expect(result.failure).toMatchObject({ phase: 'resolve_provider', code: 'Error' })
    expect(result.messages.some((message) => message.provider)).toBe(false)
  })

  it('rejects another project’s conversation, node targets and actions', async () => {
    const { service } = harness(async () => ({ value: { text: '错误引用', actions: [{ label: '打开', runId: 'foreign', nodeId: 'secret', section: '状态' }] } }))
    await store.upsertProject({ ...project, id: 'other' })
    const id = await create(service)
    await expect(service.command({ type: 'update', projectId: 'other', conversationId: id, inputDraft: 'leak' })).rejects.toThrow('当前项目中没有')
    const result = await send(service, id)
    expect(result.status, result.error).toBe('failed')
    expect(result.messages.some((message) => message.actions?.length)).toBe(false)
    expect(() => parseConversationCommand({ type: 'send', projectId, conversationId: id, text: 'x', providerId: 'x', localPath: '/etc' })).toThrow()
  })

  it('recovers tabs, input and unanswered questions across SQLite restarts', async () => {
    const { service } = harness(async () => ({ value: { text: '需要回答。', question: { prompt: '要支持撤销吗？', options: [] } } }))
    const id = await create(service)
    await send(service, id)
    await service.command({ type: 'update', projectId, conversationId: id, isOpen: false, inputDraft: '还没发出的答案' })
    store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const restarted = harness(async () => { throw new Error('must not call') })
    await restarted.service.recoverInterrupted()
    const session = (await restarted.service.command({ type: 'list', projectId })).conversations[0]!
    expect(session).toMatchObject({ id, isOpen: false, inputDraft: '还没发出的答案', status: 'awaiting_answer' })
    expect(session.messages.at(-1)?.question?.prompt).toBe('要支持撤销吗？')
    expect(restarted.calls).toHaveLength(0)
    await store.saveWorkbenchConversation({ ...session, version: session.version + 1, status: 'running' }, session.version)
    await restarted.service.recoverInterrupted()
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('interrupted')
    expect(restarted.calls).toHaveLength(0)
  })

  it('cancels a provider call, retains usage and retries without duplicating the user message', async () => {
    let started!: () => void
    const beginning = new Promise<void>((resolve) => { started = resolve })
    let retry = false
    const { service } = harness(async ({ signal }) => {
      if (retry) return { value: { text: '重试完成。' }, usage: { inputTokens: 12, outputTokens: 3 } }
      started()
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return { value: {} }
    })
    const id = await create(service)
    await service.command({ type: 'send', projectId, conversationId: id, text: '请调查', providerId: 'test' })
    await beginning
    await expect(service.command({ type: 'send', projectId, conversationId: id, text: '重复', providerId: 'test' })).rejects.toThrow('正在调查')
    await service.command({ type: 'cancel', projectId, conversationId: id })
    await service.settled(id)
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('cancelled')
    retry = true
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await service.settled(id)
    const result = (await store.listWorkbenchConversations(projectId))[0]!
    expect(result.status, result.error).toBe('idle')
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(result.messages.find((message) => message.usage)?.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 })
  })

  it('bounds tool loops and reports malformed output without fabricating success', async () => {
    const loop = harness(async () => ({ value: { tool: { name: 'shell', args: { command: 'touch compromised' } } } }))
    const result = await send(loop.service, await create(loop.service))
    expect(loop.calls).toHaveLength(12)
    expect(result.status, result.error).toBe('paused')
    expect(result.error).toContain('12 次')
    const malformed = harness(async () => ({ value: { question: { options: 'bad' } } }))
    expect((await send(malformed.service, await create(malformed.service))).status).toBe('failed')
  })
})

describe('conversation read-only repository tools', () => {
  it('reads/searches real files and blocks traversal, symlinks and credential files', async () => {
    const signal = new AbortController().signal
    expect(await readWorkbenchRepository(project.path, { operation: 'search', query: 'clearDone' }, signal)).toMatchObject({ matches: [{ path: 'tasks.ts', line: 1 }] })
    for (const file of ['../local.sqlite', '.env', '/etc/passwd', 'C:\\secrets', '.git/config']) {
      await expect(readWorkbenchRepository(project.path, { operation: 'read', path: file }, signal)).rejects.toThrow()
    }
    await writeFile(path.join(project.path, 'large.md'), '中文需求'.repeat(5000))
    expect(await readWorkbenchRepository(project.path, { operation: 'read', path: 'large.md' }, signal)).toMatchObject({ truncated: true, content: expect.stringContaining('中文需求') })
    const outside = path.join(directory, 'outside.txt')
    await writeFile(outside, 'secret')
    await symlink(outside, path.join(project.path, 'link.txt'))
    await expect(readWorkbenchRepository(project.path, { operation: 'read', path: 'link.txt' }, signal)).rejects.toThrow('符号链接')
    expect(JSON.stringify(await readWorkbenchRepository(project.path, { operation: 'list' }, signal))).not.toContain('link.txt')
  })
})

describe('host controlled critical input coverage (#164)',()=>{
 const draft={runId:created.run.id,nodeId:created.run.currentNodeId,title:'完整澄清',content:'清理已完成任务并持久化结果'}
 it('bounds a model that repeatedly returns an unmapped premature complete proposal',async()=>{const {service,calls}=harness(async()=>({value:{text:'完成',draft}}),false);const result=await send(service,await create(service),'生成完整提案');expect(result.status, result.error).toBe('failed');expect(calls.length).toBeLessThanOrEqual(4);expect(JSON.parse(calls[1]!).criticalProposalInput.documents[0].content).toBe(created.run.request);expect(result.messages.some(m=>m.draft)).toBe(false);expect(await store.listArtifacts()).toHaveLength(created.artifacts.length)})
 it('rejects semantic contradiction even when every source quote and destination quote exists',async()=>{const {service}=harness(async(input)=>{const ctx=JSON.parse(input.userPrompt);if(ctx.proposalVerification)return {value:{coverageReview:ctx.criticalProposalInput.criteria.map((c:{id:string})=>({criterionId:c.id,status:'contradiction',reason:'提案修改了持久化约定'}))}};return {value:{text:'草稿',draft:{...draft,...(ctx.criticalProposalInput?{coverage:ctx.criticalProposalInput.criteria.map((c:{id:string;text:string})=>({criterionId:c.id,sourceQuote:c.text,proposalQuote:draft.content}))}:{})}}}},false);const result=await send(service,await create(service),'生成完整提案');expect(result.status, result.error).toBe('failed');expect(result.error).toContain('语义核对');expect(result.messages.some(m=>m.draft)).toBe(false)})
 it('rechecks the source version at explicit save time',async()=>{const {service}=harness(async()=>({value:{text:'待保存',draft}}));const id=await create(service);const result=await send(service,id,'生成完整提案');const message=result.messages.find(m=>m.draft)!;expect(message.draft?.inputReceipt).toBeDefined();await store.saveArtifact({...created.artifacts[0]!,id:'conversation-proposal-new-input',kind:'log',nodeId:created.run.currentNodeId,content:'新增已确认条件',updatedAt:'2026-09-23T00:00:00Z'});await expect(service.command({type:'publish',projectId,conversationId:id,messageId:message.id})).rejects.toThrow();expect(await store.listArtifacts()).toHaveLength(created.artifacts.length+1)})
 it('fails explicitly when protected original body exceeds the final request capacity',async()=>{await store.saveArtifact({...created.artifacts[0]!,id:'conversation-proposal-large-input',kind:'log',nodeId:created.run.currentNodeId,content:'完整正文。'.repeat(9000)});const {service,calls}=harness(async()=>({value:{text:'草稿',draft}}),false);const result=await send(service,await create(service),'生成完整提案');expect(result.status, result.error).toBe('failed');expect(result.error).toContain('容量');expect(calls.length).toBeLessThanOrEqual(2);expect(result.messages.some(m=>m.draft)).toBe(false)})
})

describe('recalled Memory in the discussion bar (ADR 0024)', () => {
  const recordedAt = '2026-09-16T09:00:00.000Z'
  const scope: KnowledgeRetrievalScope = { kind: 'local', organizationId: null, projectId: null, userId: 'u-test', sessionId: 'conversation-session-test', localProjectId: projectId }
  function memory(id: string, statement: string): DurableAgentMemoryRevision {
    return {
      stateVersion: 1, id, revision: 1, status: 'active', scope, visibility: 'user_project', statement,
      contentDigest: 'a'.repeat(64), provenanceDigest: 'b'.repeat(64), sourceCandidateId: `candidate-${id}`, supersedesRevision: null,
      sensitivity: 'private', retentionClass: 'until_deleted', expiresAt: null, promotionDecisionId: `decision-${id}`,
      promotionActorKind: 'human', promotionActorId: 'u-test', promotionPolicyId: 'test-memory-policy', promotionPolicyVersion: 1,
      promotionAuthorityDigest: 'c'.repeat(64), createdAt: recordedAt,
    }
  }
  function memoryStore(available: () => Promise<DurableAgentMemoryRevision[]>, pairing: DesktopPairingCredential | null = null) {
    const retrieve = vi.fn(available)
    const memoryDependency: CodingMemoryStore = {
      getDesktopPairingCredential: async () => pairing,
      retrieveAgentMemoryRevisions: retrieve,
      getAgentMemoryHead: async (memoryId) => ({ memoryId, currentRevision: 1, scope, status: 'active', version: 1, updatedAt: recordedAt }),
    }
    return { memoryDependency, retrieve }
  }
  const answer = async () => ({ value: { text: '已按需求回答。' } })

  it('refreshes relevant Memory per model step with a stable prefix when unchanged', async () => {
    const { memoryDependency, retrieve } = memoryStore(async () => [
      memory('m-clear', '清理已完成任务时保留未完成项的原有顺序。TOKEN=sk-supersecret123456789'),
      memory('m-release', 'Release notes are written in English.'),
    ])
    let step = 0
    const { service, calls } = harness(async () => {
      step += 1
      if (step === 1) return { value: { tool: { name: 'knowledge', args: { query: '清理' } } } }
      return { value: { text: '按需求和记忆回答。' } }
    }, true, { memory: memoryDependency })
    expect((await send(service, await create(service), '清理已完成任务要注意什么？')).status).toBe('idle')
    expect(calls).toHaveLength(2)
    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ kind: 'local', userId: 'u-test', localProjectId: projectId }),
    }))
    for (const prompt of calls) {
      const context = JSON.parse(prompt)
      expect(Object.keys(context).slice(0, 4)).toEqual(['originalRequirements', 'history', 'backgroundMemory', 'toolObservations'])
      expect(context.backgroundMemory.map((item: { id: string }) => item.id)).toEqual(['m-clear'])
    }
    expect(calls[0]).not.toContain('sk-supersecret123456789')
    // Memory sits in the cacheable prefix and does not change between steps of a turn.
    expect(calls[1]!.startsWith(calls[0]!.slice(0, calls[0]!.indexOf('"toolObservations"')))).toBe(true)
  })

  it.each(['deleted', 'expired'])('omits %s memory before the next provider step in the same turn', async (state) => {
    let step = 0
    const revision = memory('m-clear', '清理已完成任务时保留未完成项的原有顺序。')
    const { memoryDependency } = memoryStore(async () => step === 0 ? [revision] : state === 'deleted' ? [] : [{ ...revision, expiresAt: '2020-01-01T00:00:00.000Z' }])
    const { service, calls } = harness(async () => ++step === 1
      ? { value: { tool: { name: 'workflow', args: {} } } }
      : { value: { text: '使用当前需求。' } }, true, { memory: memoryDependency })
    expect((await send(service, await create(service), '清理已完成任务')).status).toBe('idle')
    expect(JSON.parse(calls[0]!).backgroundMemory).toHaveLength(1)
    expect(JSON.parse(calls[1]!)).not.toHaveProperty('backgroundMemory')
  })

  it('uses the paired user when this local project is paired', async () => {
    const pairing: DesktopPairingCredential = {
      tokenId: 'pairing-session', organizationId: 'org-1', projectId: 'team-project-1', localProjectId: projectId,
      userId: 'u-paired', role: 'member', authAccountId: 'account-1', projectMemberships: [], createdAt: recordedAt,
    }
    const { memoryDependency, retrieve } = memoryStore(async () => [], pairing)
    const { service } = harness(answer, true, { memory: memoryDependency })
    expect((await send(service, await create(service), '清理规则是什么？')).status).toBe('idle')
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ kind: 'team', userId: 'u-paired', organizationId: 'org-1', localProjectId: projectId }),
    }))
  })

  it('continues without Memory when recall fails', async () => {
    const { memoryDependency, retrieve } = memoryStore(async () => { throw new Error('Memory store unavailable') })
    const { service, calls } = harness(answer, true, { memory: memoryDependency })
    expect((await send(service, await create(service), '清理规则是什么？')).status).toBe('idle')
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(JSON.parse(calls[0]!)).not.toHaveProperty('backgroundMemory')
  })

  it('does not recall when neither a pairing nor an attached requirement names the user', async () => {
    const second = createWorkflowRunFromRequest({ runId: 'conversation-flow-second', title: '导出报表', request: '导出月度报表', projectId, creatorId: 'u-other', branchName: 'ai/second', now: '2026-09-16T10:00:00.000Z' })
    await store.saveRun(second.run)
    for (const artifact of second.artifacts) await store.saveArtifact(artifact)
    const { memoryDependency, retrieve } = memoryStore(async () => [memory('m-clear', '清理已完成任务时保留未完成项的原有顺序。')])
    const { service, calls } = harness(answer, true, { memory: memoryDependency })
    expect((await send(service, await create(service), '清理规则是什么？')).status).toBe('idle')
    expect(retrieve).not.toHaveBeenCalled()
    expect(JSON.parse(calls[0]!)).not.toHaveProperty('backgroundMemory')
  })
})

describe('tool observation degradation in the discussion bar (ADR 0024 §6)', () => {
  it('degrades older tool results to re-queryable placeholders before dropping chat history, and keeps them degraded', async () => {
    for (const name of ['a', 'b', 'c', 'd']) await writeFile(path.join(project.path, `${name}.ts`), `const ${name} = 1\n`.repeat(750))
    let step = 0
    const { service, calls } = harness(async () => {
      step += 1
      if (step <= 4) return { value: { tool: { name: 'repo_read', args: { path: `${'abcd'[step - 1]}.ts` } } } }
      return { value: { text: '已读完四个文件。' } }
    })
    const id = await create(service)
    // Earlier chat history must survive: tool results are degraded before any history is dropped.
    const original = (await store.listWorkbenchConversations(projectId)).find((session) => session.id === id)!
    await store.saveWorkbenchConversation({ ...original, version: original.version + 1, messages: Array.from({ length: 3 }, (_, index) => ({
      id: `earlier-${index}`, role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `之前讨论第 ${index + 1} 轮：${'清理规则'.repeat(60)}`, createdAt: created.run.createdAt,
    })) }, original.version)
    const result = await send(service, id, '逐个读取 a、b、c、d 四个文件。')
    expect(result.status, result.error).toBe('idle')
    expect(calls).toHaveLength(5)
    const contexts = calls.map((prompt) => JSON.parse(prompt))
    for (const prompt of calls) expect(prompt.length).toBeLessThanOrEqual(32000)

    // Step 4 no longer fits all three results: the oldest becomes a placeholder, the rest stay complete.
    expect(contexts[3].toolObservations).toHaveLength(3)
    expect(contexts[3].toolObservations[0]).toEqual({ sourceId: 'source-1', requestId: expect.any(String), name: 'repo_read', args: { path: 'a.ts' }, observedAt: expect.any(String), degraded: true })
    expect(contexts[3].toolObservations.slice(1).every((observation: { result?: unknown }) => observation.result)).toBe(true)
    expect(contexts[3].history.map((entry: { id: string }) => entry.id).slice(0, 3)).toEqual(['earlier-0', 'earlier-1', 'earlier-2'])
    expect(contexts[3].history).toHaveLength(4)
    expect(contexts[3].contextNotice).toContain('上下文受长度限制')

    // The placeholder is written back: the next step keeps it and extends the same prefix.
    const throughFirstObservation = (context: Record<string, unknown> & { toolObservations: unknown[] }) =>
      JSON.stringify({ originalRequirements: context.originalRequirements, history: context.history, toolObservations: [context.toolObservations[0]] }).slice(0, -2)
    expect(calls[4]!.startsWith(`${throughFirstObservation(contexts[3])},`)).toBe(true)
    expect(contexts[4].toolObservations.at(-1)).toMatchObject({ sourceId: 'source-4', result: expect.any(Object) })
    expect(contexts[4].history).toHaveLength(4)
    expect(result.contextReceipt?.omittedMessages).toBe(0)
  })

  it('keeps the newest tool result complete when older results must be degraded', async () => {
    for (const name of ['a', 'b', 'c']) await writeFile(path.join(project.path, `${name}.ts`), `const ${name} = 1\n`.repeat(1_050))
    let step = 0
    const { service, calls } = harness(async () => {
      step += 1
      if (step <= 3) return { value: { tool: { name: 'repo_read', args: { path: `${'abc'[step - 1]}.ts` } } } }
      return { value: { text: '已读完三个文件。' } }
    })
    expect((await send(service, await create(service), '逐个读取 a、b、c 三个文件。')).status).toBe('idle')
    const last = JSON.parse(calls.at(-1)!) as { toolObservations: Array<{ sourceId?: string; degraded?: boolean; result?: unknown }> }
    const newest = last.toolObservations.filter((observation) => observation.sourceId).at(-1)!
    expect(newest).toMatchObject({ sourceId: 'source-3', result: expect.any(Object) })
    expect(newest.degraded).toBeUndefined()
    expect(last.toolObservations.some((observation) => observation.degraded)).toBe(true)
  })
})

describe('degradeOlderObservations', () => {
  it('protects the newest real tool result even when a recovery instruction was appended after it', () => {
    const observation = (index: number) => ({ sourceId: `source-${index}`, name: 'repo_read', args: { path: `${index}.ts` }, result: { content: 'x'.repeat(100) }, observedAt: '2026-09-16T10:00:00.000Z' })
    const observations: unknown[] = [observation(1), observation(2), { instruction: '上一份提案未通过完整性校验。' }]
    expect(degradeOlderObservations(observations, () => true)).toBe(true)
    expect(observations[0]).toMatchObject({ sourceId: 'source-1', degraded: true })
    expect(observations[1]).toEqual(observation(2))
    expect(observations[2]).toEqual({ instruction: '上一份提案未通过完整性校验。' })
  })
})
