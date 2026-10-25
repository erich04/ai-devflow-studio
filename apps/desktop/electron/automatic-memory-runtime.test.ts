// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { LocalStore } from './local-store'
import { createLocalStore } from './local-store'
import type { HindsightClient } from './hindsight-client'
import type { HindsightConfiguration } from './hindsight-store'
import { createAutomaticMemoryRuntime } from './automatic-memory-runtime'
import type { WorkbenchConversation } from './workbench-conversation-contract'
import { automaticMemoryDigest } from './automatic-memory-store'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions'
import { recallScopedMemory } from './coding-context'
import { CONVERSATION_MEMORY_RECALL_BUDGET } from '@ai-devflow/shared'

const directories: string[] = []; const stores: LocalStore[] = []
afterEach(async () => {
  vi.useRealTimers()
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(withHindsight = true) {
  vi.useFakeTimers({ toFake: ['Date'] })
  const root = await mkdtemp(path.join(os.tmpdir(), 'automatic-memory-runtime-')); directories.push(root)
  const store = await createLocalStore({ dbPath: path.join(root, 'state.db') }); stores.push(store)
  const timestamp = new Date().toISOString()
  const project = { id: 'runtime-memory-project', name: 'Fixture', path: root, packageManager: 'pnpm' as const,
    testCommand: 'corepack pnpm test', createdAt: timestamp, updatedAt: timestamp }
  await store.upsertProject(project)
  const principal = await store.resolveLocalProjectMemoryPrincipal(project.id)
  if (principal.status !== 'resolved') throw new Error('Missing fixture principal')
  const hsInput = { projectId: project.id, ownerUserId: principal.userId, projectPath: root,
    knowledgeRoot: 'docs/knowledge', rootGeneration: 'fixture-root', endpoint: 'http://127.0.0.1:8888', encryptedApiKey: null,
    enabled: true, includeMemories: false, selectedPaths: [], model: { version: 'fixture', dimensions: [{ key: 'sem_kind', type: 'text' as const }] }, modelDigest: 'fixture-model' }
  const hConfig = withHindsight ? await store.configureHindsight(hsInput) : null
  const documents = new Map<string, Parameters<HindsightClient['retain']>[1]>()
  const client: HindsightClient = {
    configureBank: vi.fn(async () => {}),
    retain: vi.fn(async (_bank, item) => { documents.set(item.documentId, item) }),
    operation: vi.fn(async () => 'completed' as const),
    deleteDocument: vi.fn(async (_bank, id) => { documents.delete(id) }),
    getDocument: vi.fn(async (bank, id) => {
      const item = documents.get(id)!
      return { id, bankId: bank, originalText: item.content, contentHash: automaticMemoryDigest(item.content),
        memoryUnitCount: 1, updatedAt: timestamp, metadata: item.metadata }
    }),
    listDocumentFacts: vi.fn<HindsightClient['listDocumentFacts']>(async (_bank, id) => {
      const item = documents.get(id)!
      const parsed = JSON.parse(item.content) as { materials: { text: string }[] }
      return [{ id: 'fact', documentId: id, text: parsed.materials[0]!.text, factType: 'world', metadata: item.metadata, updatedAt: timestamp }]
    }),
    recall: vi.fn(async () => []),
  }
  const connect = vi.fn(async (_config: HindsightConfiguration) => client)
  let time = Date.parse(timestamp)
  const runtime = await createAutomaticMemoryRuntime({ store, transportAvailable: withHindsight, client: connect,
    now: () => new Date(time).toISOString() })
  async function conversation(id: string, text: string, executor: 'direct-provider' | 'opencode' = 'direct-provider') {
    const initial: WorkbenchConversation = { id, localProjectId: project.id, executor, version: 1, title: 'Memory fixture',
      isOpen: true, inputDraft: '', status: 'running', messages: [{ id: `${id}-user`, role: 'user', text, createdAt: timestamp }],
      createdAt: timestamp, updatedAt: timestamp }
    await store.saveWorkbenchConversation(initial, 0)
    const complete: WorkbenchConversation = { ...initial, version: 2, status: 'idle', messages: [...initial.messages,
      { id: `${id}-reply`, role: 'assistant', text: '好的。', createdAt: timestamp }] }
    await store.saveWorkbenchConversation(complete, 1)
    return complete
  }
  return { store, project, principal, runtime, client, connect, hConfig, hsInput, conversation, tick: (milliseconds = 60_000) => { time += milliseconds; vi.setSystemTime(time) } }
}

it('needs one explicit consent, then saves completed Direct/OpenCode chat experience under the stable no-Run identity', async () => {
  const f = await fixture()
  expect(await f.store.listRuns()).toHaveLength(0)
  await expect(f.runtime.configure({ projectId: f.project.id, enabled: true, consent: false, maxRetainsPerDay: 10 })).rejects.toThrow('consent')
  await f.runtime.configure({ projectId: f.project.id, enabled: true, consent: true, maxRetainsPerDay: 10 })
  await f.conversation('direct', '以后请用中文解释改动')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  const first = await f.runtime.status(f.project.id)
  expect(first.decisions).toEqual([expect.objectContaining({ resolution: 'saved', statementKind: 'communication_preference' })])
  expect((await f.store.listAgentMemoryHeads(f.project.id))[0]?.scope.userId).toBe(f.principal.userId)
  await f.conversation('opencode', '本项目使用 Node.js 24', 'opencode')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  expect(await f.store.listAgentMemoryHeads(f.project.id)).toHaveLength(2)
  const status = await f.runtime.status(f.project.id)
  expect(status.jobs.every((job) => job.status === 'committed')).toBe(true)
  expect(status.jobs.every((job) => !('payload' in job) && !('metadata' in job) && !('operationId' in job))).toBe(true)
  expect(f.client.recall).not.toHaveBeenCalled()
})

it('manually saves edited source-backed experience and pinning without Hindsight setup or automatic collection', async () => {
  const f = await fixture(false)
  const conversation = await f.conversation('manual', '请分析一个部署失败案例')
  const status = await f.runtime.remember({ projectId: f.project.id, conversationId: conversation.id,
    messageId: 'manual-reply', statement: '排查历史问题时先核对该版本的构建日志', pin: true })
  expect(status.decisions).toEqual([expect.objectContaining({ manual: true, pin: true, resolution: 'saved' })])
  expect(status.jobs).toEqual([])
  expect(f.connect).not.toHaveBeenCalled()
  const head = (await f.store.listAgentMemoryHeads(f.project.id))[0]!
  const revision = (await f.store.listAgentMemoryRevisions(head.memoryId))[0]!
  expect(revision).toMatchObject({ retentionClass: 'until_deleted', expiresAt: null })
})

it('shows rules as proposals and requires the displayed revision before replacing a conflicting experience', async () => {
  const f = await fixture()
  await f.runtime.configure({ projectId: f.project.id, enabled: true, consent: true, maxRetainsPerDay: 10 })
  await f.conversation('first', '请用中文回答')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  await f.conversation('second', '请用英文回答')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  const conflict = (await f.runtime.status(f.project.id)).decisions.find((decision) => decision.disposition === 'conflict')!
  expect(conflict.conflictsWith).toHaveLength(1)
  await expect(f.runtime.resolve({ projectId: f.project.id, decisionId: conflict.id, action: 'approve' })).rejects.toThrow('版本')
  const prior = conflict.conflictsWith![0]!
  await f.runtime.resolve({ projectId: f.project.id, decisionId: conflict.id, action: 'approve', targetMemoryId: prior.memoryId, expectedRevision: prior.revision })
  expect((await f.runtime.status(f.project.id)).decisions.find((decision) => decision.id === conflict.id)?.resolution).toBe('saved')
  await f.conversation('rule', 'Todo 删除必须可撤销')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  const rule = (await f.runtime.status(f.project.id)).decisions.find((decision) => decision.disposition === 'rule_candidate')!
  await expect(f.runtime.resolve({ projectId: f.project.id, decisionId: rule.id, action: 'approve' })).rejects.toThrow('正式')
  expect((await f.runtime.resolve({ projectId: f.project.id, decisionId: rule.id, action: 'ignore' })).decisions.find((decision) => decision.id === rule.id)?.resolution).toBe('dismissed')
})

it('cleans the historical bank after a service-address rotation and stops new automatic collection', async () => {
  const f = await fixture()
  await f.runtime.configure({ projectId: f.project.id, enabled: true, consent: true, maxRetainsPerDay: 10 })
  await f.conversation('pending', '请用中文回答')
  await f.runtime.cycle()
  await f.store.configureHindsight({ ...f.hsInput, endpoint: 'http://127.0.0.1:9999' })
  f.tick(); await f.runtime.cycle()
  expect((await f.store.getAutomaticMemoryConfiguration(f.project.id))?.enabled).toBe(false)
  expect(f.connect.mock.calls.at(-1)?.[0].generation).toBe(f.hConfig!.generation)
  expect(f.connect.mock.calls.at(-1)?.[0].endpoint).toBe('http://127.0.0.1:8888')
  expect((await f.store.listMemoryLearningJobs(f.project.id))[0]?.status).toBe('cleaned')
  expect(await f.store.listAgentMemoryHeads(f.project.id)).toHaveLength(0)
})

it('expires the remote event after 90 days while a user-pinned formal memory remains recallable', async () => {
  const f = await fixture()
  await f.runtime.configure({ projectId: f.project.id, enabled: true, consent: true, maxRetainsPerDay: 10 })
  await f.conversation('ttl-pinned', '请用中文回答')
  await f.runtime.cycle(); f.tick(); await f.runtime.cycle()
  const decision = (await f.runtime.status(f.project.id)).decisions.find((item) => item.resolution === 'saved')!
  const event = (await f.store.getMemoryLearningEvent(decision.eventId))!
  const head = (await f.store.getAgentMemoryHead(decision.memoryId!))!
  const revision = (await f.store.listAgentMemoryRevisions(head.memoryId)).find((item) => item.revision === head.currentRevision)!
  f.tick()
  const pinned = await createAgentMemoryHumanActions({ store: f.store }).revise({
    localProjectId: f.project.id, memoryId: head.memoryId, expectedRevision: revision.revision,
    expectedHeadVersion: head.version, expectedContentDigest: revision.contentDigest,
    expectedProvenanceDigest: revision.provenanceDigest, statement: revision.statement, pin: true,
  })
  expect(pinned).toMatchObject({ retentionClass: 'until_deleted', expiresAt: null })
  f.tick(90 * 86_400_000); await f.runtime.cycle()
  expect(f.client.deleteDocument).toHaveBeenCalledTimes(1)
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect((await f.runtime.status(f.project.id)).jobs).toEqual([expect.objectContaining({ status: 'cleaned' })])
  expect(await f.store.getMemoryLearningEvent(event.id)).toEqual(event)
  const recalled = await recallScopedMemory({ store: f.store, projectId: f.project.id, userId: f.principal.userId,
    runtimeId: 'ttl-pinned-recall', requestId: 'ttl-pinned-request', query: '中文回答', now: new Date().toISOString(),
    budget: CONVERSATION_MEMORY_RECALL_BUDGET })
  expect(recalled.revisions).toEqual([pinned])
  expect((await f.store.getAgentMemoryHead(head.memoryId))?.status).toBe('active')
})
