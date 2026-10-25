// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, createFakeAgentProvider, createWorkflowRunFromRequest, resolveRequestPolicy, validateNativeHistory, type AgentProvider, type AutomaticMemoryFact, type KnowledgeRetrievalScope, type NativeToolCall } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { WorkbenchConversationService } from './workbench-conversation-service'
import { buildConversationLearningEvent } from './automatic-memory-capture'
import { automaticMemoryDigest } from './automatic-memory-store'
import { classifyMemoryLearningFact } from './automatic-memory-policy'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions'
import type { WorkbenchConversation } from './workbench-conversation-contract'

let directory: string, store: LocalStore
const projectId = 'native-investigation-project'
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-investigation-'))
  await mkdir(path.join(directory, 'repo'))
  await writeFile(path.join(directory, 'repo', 'app.js'), 'export const evidence = "OLD_SOURCE_CONTENT"')
  store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
  const now = new Date().toISOString()
  await store.upsertProject({ id: projectId, name: 'Todo', path: path.join(directory, 'repo'), packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  const principal = await store.resolveLocalProjectMemoryPrincipal(projectId)
  if (principal.status !== 'resolved') throw new Error('Missing fixture principal')
  const workflow = createWorkflowRunFromRequest({ runId: 'native-investigation-run', title: 'Todo', request: '测试原生只读调查。', projectId, creatorId: principal.userId, branchName: 'test', now })
  await store.saveRun(workflow.run)
  for (const artifact of workflow.artifacts) await store.saveArtifact(artifact)
})
afterEach(async () => { store.close(); vi.restoreAllMocks(); await rm(directory, { force: true, recursive: true }) })

function text(text: string) { return { kind: 'text' as const, text, assistantMessage: { role: 'assistant' as const, content: text }, usage: { inputTokens: 5, outputTokens: 3 } } }
function read(id: string) {
  const toolCalls: NativeToolCall[] = [{ id, type: 'function', function: { name: 'repo_read', arguments: JSON.stringify({ path: 'app.js' }) } }]
  return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls }, usage: { inputTokens: 5, outputTokens: 3 } }
}
function setup(complete: NonNullable<AgentProvider['completeNativeConversation']>, local = store) {
  const completeNativeConversation = vi.fn(complete)
  const completeStructuredJson = vi.fn(async () => ({ value: { text: '已读取来源，仍需完成问题调查。', citationIds: [] }, usage: { inputTokens: 7, outputTokens: 4 } }))
  const provider = { ...createFakeAgentProvider(), supportsNativeTools: true, completeNativeConversation, completeStructuredJson,
    resolveRequestPolicy: (input: Parameters<NonNullable<AgentProvider['resolveRequestPolicy']>>[0]) => resolveRequestPolicy({ ...input, model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }) }
  const service = new WorkbenchConversationService({ store: local, memory: local, nativeConversationsEnabled: true, nativeReadOnlyPilotEnabled: true,
    resolveProvider: async () => provider, changed: () => {}, loadKnowledge: async () => ({ projectId, indexedAt: new Date().toISOString(), contentHash: 'fixture', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [] }) })
  return { service, completeNativeConversation, completeStructuredJson }
}
async function send(service: WorkbenchConversationService, id: string, message: string) {
  await service.command({ type: 'send', projectId, conversationId: id, providerId: 'test', text: message })
  await service.settled(id)
  return (await store.listWorkbenchConversations(projectId)).find(session => session.id === id)!
}

it.each(['investigation', 'summary'])('retains a Native %s provider failure when its diagnostic write fails once (#248)', async stage => {
  let rejected = false
  const local = new Proxy(store, { get(target, key) {
    if (key !== 'saveWorkbenchConversation') return Reflect.get(target, key)
    return async (...args: Parameters<LocalStore['saveWorkbenchConversation']>) => {
      if (!rejected && args[0].messages.some(m => m.failure?.reason === 'invalid_json')) {
        rejected = true
        throw new Error('SQLITE_IOERR PRIVATE_STORAGE_DETAIL')
      }
      return target.saveWorkbenchConversation(...args)
    }
  } })
  const failure = new AgentProviderRequestError({ code: 'invalid_model_output', httpStatus: 200,
    sanitizedCause: 'invalid_json', deliveryState: 'response_received', billingState: 'confirmed', retryable: true,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, responseMetadata: { httpStatus: 200, parserCategory: 'model_json', responseId: 'native-original' } })
  const h = setup(async () => { if (stage === 'summary') return read('native-read'); throw failure }, local)
  if (stage === 'summary') h.completeStructuredJson.mockRejectedValue(failure)
  const id = (await h.service.command({ type: 'create', projectId })).conversationId!
  await h.service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps: 1, maxDurationMs: 30000 })
  const result = await send(h.service, id, '核对当前材料。')
  expect(rejected).toBe(true)
  expect(h.completeNativeConversation).toHaveBeenCalledTimes(1)
  expect(result.failure).toMatchObject({ code: 'invalid_model_output', reason: 'invalid_json', diagnosticPersistenceFailed: true })
  expect(result.status).toBe('failed')
  expect(result.error).toContain('保存失败')
  expect(result.messages.reduce((sum, m) => sum + (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0), 0)).toBe(stage === 'summary' ? 23 : 15)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_DETAIL')
  const report = (await h.service.command({ type: 'export_diagnostics', projectId, conversationId: id })).diagnostics!
  const failed = report.calls.filter(c => c.failure)
  expect(failed).toHaveLength(1)
  expect(failed[0]?.failure).toMatchObject({ reason: 'invalid_json', diagnosticPersistenceFailed: true })
  expect(failed[0]?.response).toMatchObject({ responseId: 'native-original' })
  expect(failed[0]?.attempt?.batchId).toBe(result.investigationProgress?.batch.id)
})

/** Synthetic extraction fixture, committed through the same local evidence and promotion APIs; no remote call. */
async function savePreference() {
  const now = new Date().toISOString()
  const principal = await store.resolveLocalProjectMemoryPrincipal(projectId)
  if (principal.status !== 'resolved') throw new Error('Missing fixture principal')
  const hindsight = await store.configureHindsight({ projectId, ownerUserId: principal.userId, projectPath: path.join(directory, 'repo'), knowledgeRoot: 'docs/knowledge', rootGeneration: 'fixture-root', endpoint: 'http://127.0.0.1:9', encryptedApiKey: null, enabled: true, includeMemories: true, selectedPaths: [], modelDigest: 'fixture-model', model: { version: 'fixture-v1', dimensions: [{ key: 'sem_kind', type: 'text' }] } })
  await store.configureAutomaticMemory({ projectId, ownerUserId: principal.userId, enabled: true, hindsightGeneration: hindsight.generation, maxRetainsPerDay: 10 })
  const scope: KnowledgeRetrievalScope = { kind: 'local', organizationId: null, projectId: null, userId: principal.userId, sessionId: 'memory-source', localProjectId: projectId }
  const source: WorkbenchConversation = { id: 'preference-source', localProjectId: projectId, version: 1, title: 'Fixture', isOpen: false, status: 'idle', inputDraft: '', messages: [{ id: 'preference-user', role: 'user', text: '请用英文回答。', createdAt: now }, { id: 'preference-answer', role: 'assistant', text: '已了解。', createdAt: now }], createdAt: now, updatedAt: now }
  await store.saveWorkbenchConversation(source, 0)
  const event = (await store.enqueueMemoryLearningEvent(buildConversationLearningEvent(source, { status: 'running', messages: source.messages.slice(0, -1) }, scope)!))!
  const claim = (await store.claimMemoryLearningJob(now))!
  const fact: AutomaticMemoryFact = { id: 'preference-fact', eventId: event.id, remoteFactId: 'synthetic-fact', documentId: claim.job.documentId, text: '请用英文回答。', factType: 'experience', sourceDigest: event.sourceDigest, contentDigest: automaticMemoryDigest('请用英文回答。'), extractedAt: now }
  await store.recordMemoryLearningExtraction(claim.job.id, claim.leaseToken, [fact])
  const decision = classifyMemoryLearningFact(event, fact, [], now)
  await store.recordMemoryLearningDecisions(claim.job.id, claim.leaseToken, [decision])
  const saved = await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'automatic' })
  if (saved.status !== 'saved' || !saved.memoryId) throw new Error(`Preference fixture was not saved: ${saved.status}`)
  const revision = (await store.listAgentMemoryRevisions(saved.memoryId)).at(-1)
  if (!revision) throw new Error('Preference fixture has no saved revision')
  return revision
}

describe('native conversation service with durable memory and investigation checkpoints', () => {
  it('refreshes preparation-only material on continuation without deleting original protocol pairs', async () => {
    const run = (await store.listRuns())[0]
    const node = run?.nodes.find(candidate => candidate.stage === 'design' && candidate.kind === 'agent')
    if (!run || !node) throw new Error('Missing fixture workflow')
    const target = { runId: run.id, nodeId: node.id }
    // Raw user requests are immutable; a revised formal design is a supported source change.
    const material = { id: 'prepared-design', ...target, kind: 'design' as const, title: '正式设计', summary: '待核对的来源', redacted: true, content: 'OLD_PREPARED_REQUIREMENT: preserve existing tasks.', updatedAt: new Date().toISOString() }
    await store.saveArtifact(material)
    const prepare = (id: string) => {
      const toolCalls: NativeToolCall[] = [{ id, type: 'function', function: { name: 'prepare_revision', arguments: JSON.stringify(target) } }]
      return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls }, usage: { inputTokens: 5, outputTokens: 3 } }
    }
    const first = setup(async () => prepare('old-prepare'))
    const id = (await first.service.command({ type: 'create', projectId })).conversationId!
    await first.service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps: 1, maxDurationMs: 180000 })
    const paused = await send(first.service, id, '先准备材料，再解释需求。')
    expect(paused.status, paused.error).toBe('paused')
    expect(paused.checkpoint?.observations).toEqual([])
    expect(JSON.stringify(paused.checkpoint?.criticalProposalInput)).toContain('OLD_PREPARED_REQUIREMENT')
    const originalTranscript = paused.nativeTranscript!
    expect(originalTranscript.some(entry => entry.message.role === 'tool' && entry.message.content?.includes('OLD_PREPARED_REQUIREMENT'))).toBe(true)
    await store.saveArtifact({ ...material, content: 'NEW_PREPARED_REQUIREMENT: preserve tasks and add filters.', updatedAt: new Date(Date.now() + 1000).toISOString() })
    let attempts = 0
    const next = setup(async input => {
      expect(JSON.stringify(input.messages)).not.toContain('OLD_PREPARED_REQUIREMENT')
      validateNativeHistory(input.messages)
      return ++attempts === 1 ? prepare('new-prepare') : text('已重新读取当前需求。')
    })
    await next.service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps: 3, maxDurationMs: 180000 })
    await next.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await next.service.settled(id)
    const resumed = (await store.listWorkbenchConversations(projectId)).find(session => session.id === id)!
    expect(resumed.status, resumed.error).toBe('idle')
    expect(resumed.nativeTranscript!.slice(0, originalTranscript.length)).toEqual(originalTranscript)
    expect(JSON.stringify(next.completeNativeConversation.mock.calls[1]![0].messages)).toContain('NEW_PREPARED_REQUIREMENT')
    expect(resumed.investigationProgress).toMatchObject({ batch: { steps: 2 }, totals: { requests: 4, summaryRequests: 1, toolCalls: 0 } })
    expect(resumed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    validateNativeHistory(resumed.nativeTranscript!.map(entry => entry.message))
  })

  it('attaches persisted preferences with audited identity, keeps user priority, and removes deleted memory from later native requests', async () => {
    const revision = await savePreference()
    const h = setup(async () => text('普通说明'))
    const id = (await h.service.command({ type: 'create', projectId })).conversationId!
    const first = await send(h.service, id, '解释一下集成测试。')
    expect(first.status, first.error).toBe('idle')
    expect(first.nativeProtocolVersion).toBe(2)
    const request = h.completeNativeConversation.mock.calls[0]![0]
    const memory = JSON.parse(request.messages.at(-1)!.content!)
    expect(memory).toMatchObject({ backgroundMemory: [{ id: revision.id, statement: revision.statement }], effectiveCommunicationSettings: { language: 'english', memoryIds: [revision.id] } })
    expect(request.systemPrompt).not.toContain(revision.statement)
    expect(request.systemPrompt).toContain('用户本轮明确要求优先')
    expect(JSON.stringify(first.nativeTranscript)).not.toContain(revision.statement)
    expect(first.messages.find(message => message.memoryReceipt)?.memoryReceipt).toMatchObject({ state: 'response_received', memories: [{ id: revision.id, revision: revision.revision, contentDigest: revision.contentDigest }] })

    const second = await send(h.service, id, '这次请用中文回答，简述单元测试。')
    expect(second.status, second.error).toBe('idle')
    const override = h.completeNativeConversation.mock.calls[1]![0]
    expect(JSON.stringify(override.messages)).toContain('这次请用中文回答')
    expect(override.systemPrompt).toContain('用户本轮明确要求优先')

    const head = (await store.getAgentMemoryHead(revision.id))!
    await createAgentMemoryHumanActions({ store }).delete({ localProjectId: projectId, memoryId: revision.id, expectedRevision: revision.revision, expectedHeadVersion: head.version, expectedContentDigest: revision.contentDigest, expectedProvenanceDigest: revision.provenanceDigest })
    const third = await send(h.service, id, '再简述端到端测试。')
    expect(third.status, third.error).toBe('idle')
    const deletedRequest = h.completeNativeConversation.mock.calls[2]![0]
    expect(JSON.stringify(deletedRequest.messages)).not.toContain(revision.statement)
    expect(JSON.stringify(deletedRequest.messages)).not.toContain('effectiveCommunicationSettings')
    expect(third.messages.filter(message => message.memoryReceipt).at(-1)?.memoryReceipt).toMatchObject({ state: 'response_received', memories: [] })
    expect(third.contextReceipt?.memory?.memories).toEqual([])
    validateNativeHistory(third.nativeTranscript!.map(entry => entry.message))
  })

  it('revalidates a changed file on continuation, keeps original protocol pairs, and preserves cumulative usage counters', async () => {
    const first = setup(async () => read('old-read'))
    const id = (await first.service.command({ type: 'create', projectId })).conversationId!
    await first.service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps: 1, maxDurationMs: 180000 })
    const paused = await send(first.service, id, '读取 app.js 后解释它的行为。')
    expect(paused.status, paused.error).toBe('paused')
    expect(paused.checkpoint?.investigation?.totals).toMatchObject({ requests: 2, toolCalls: 1, summaryRequests: 1 })
    const originalTranscript = paused.nativeTranscript!
    expect(JSON.stringify(originalTranscript)).toContain('OLD_SOURCE_CONTENT')
    await writeFile(path.join(directory, 'repo', 'app.js'), 'export const evidence = "NEW_SOURCE_CONTENT"')
    let attempts = 0
    const next = setup(async input => {
      expect(JSON.stringify(input.messages)).not.toContain('OLD_SOURCE_CONTENT')
      validateNativeHistory(input.messages)
      return ++attempts === 1 ? read('new-read') : text('当前文件已重新核实。')
    })
    await next.service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps: 3, maxDurationMs: 180000 })
    await next.service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await next.service.settled(id)
    const resumed = (await store.listWorkbenchConversations(projectId)).find(session => session.id === id)!
    expect(resumed.status, resumed.error).toBe('idle')
    expect(resumed.nativeTranscript!.slice(0, originalTranscript.length)).toEqual(originalTranscript)
    expect(JSON.stringify(next.completeNativeConversation.mock.calls[1]![0].messages)).toContain('NEW_SOURCE_CONTENT')
    expect(resumed.investigationProgress?.totals).toMatchObject({ requests: 4, summaryRequests: 1, toolCalls: 2 })
    expect(resumed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(resumed.messages.filter(message => message.usage)).toHaveLength(4)
    validateNativeHistory(resumed.nativeTranscript!.map(entry => entry.message))
  })
})
