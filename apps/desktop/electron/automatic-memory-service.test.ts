// @vitest-environment node
import initSqlJs, { type Database } from 'sql.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutomaticMemoryEventInput, AutomaticMemoryEvent, AutomaticMemoryDecision } from '@ai-devflow/shared'
import type { HindsightClient } from './hindsight-client'
import * as memory from './automatic-memory-store'
import { AutomaticMemoryService, type AutomaticMemoryServiceStore } from './automatic-memory-service'

const databases: Database[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()) })
const start = '2026-10-22T10:00:00.000Z'
const configuration = { projectId: 'p1', ownerUserId: 'u1', enabled: true, hindsightGeneration: 'hs1', maxRetainsPerDay: 10 }
const source = (id = 'm1'): AutomaticMemoryEventInput => ({ sourceKind: 'conversation_turn', sourceId: id, sourceRevision: 'r1',
  scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: 'p1', userId: 'u1', sessionId: 'c1' },
  outcome: 'completed', createdAt: start, materials: [{ id, role: 'user', text: '以后请用中文解释改动',
    evidence: { kind: 'user_statement', sourceId: id, sourceRevision: 'r1' } }] })
async function fixture() {
  const SQL = await initSqlJs(); const db = new SQL.Database(); databases.push(db)
  memory.createMemoryLearningTables(db); memory.configureAutomaticMemory(db, configuration, start)
  const store: AutomaticMemoryServiceStore = {
    getAutomaticMemoryConfiguration: async (id) => memory.getAutomaticMemoryConfiguration(db, id),
    getMemoryLearningEvent: async (id) => memory.getMemoryLearningEvent(db, id),
    claimMemoryLearningJob: async (now) => memory.claimMemoryLearningJob(db, now),
    settleMemoryLearningJob: async (...args) => memory.settleMemoryLearningJob(db, ...args),
    listMemoryLearningFacts: async (eventId) => memory.listMemoryLearningFacts(db, eventId),
    listMemoryLearningDecisions: async (projectId) => memory.listMemoryLearningDecisions(db, projectId),
    recordMemoryLearningExtraction: async (...args) => memory.recordMemoryLearningExtraction(db, ...args),
    recordMemoryLearningDecisions: async (...args) => memory.recordMemoryLearningDecisions(db, ...args),
    revokeMemoryLearningEvent: async (...args) => memory.revokeMemoryLearningEvent(db, ...args),
    recoverMemoryLearningJobs: async () => memory.recoverMemoryLearningJobs(db),
  }
  const remote = new Map<string, Parameters<HindsightClient['retain']>[1]>()
  let operation: Awaited<ReturnType<HindsightClient['operation']>> = 'completed'
  const client: HindsightClient = {
    configureBank: vi.fn(async () => {}),
    configureMemoryBank: vi.fn(async () => {}),
    retainDocument: vi.fn(async () => {}),
    retain: vi.fn(async (_bank, item) => { remote.set(item.documentId, item) }),
    operation: vi.fn(async () => operation),
    deleteDocument: vi.fn(async (_bank, id) => { remote.delete(id) }),
    getDocument: vi.fn(async (bank, id) => {
      const item = remote.get(id)!
      return { id, bankId: bank, originalText: item.content, contentHash: memory.automaticMemoryDigest(item.content),
        memoryUnitCount: 1, updatedAt: start, metadata: item.metadata }
    }),
    listDocumentFacts: vi.fn<HindsightClient['listDocumentFacts']>(async (_bank, id) => {
      const item = remote.get(id)!
      return [{ id: 'remote-fact', documentId: id, text: '以后请用中文解释改动', factType: 'world', updatedAt: start, metadata: item.metadata }]
    }),
    recall: vi.fn(async () => { throw new Error('Staging bank must not enter production recall') }),
  }
  const current = vi.fn(async () => true)
  const commit = vi.fn(async (_event: AutomaticMemoryEvent, decisions: AutomaticMemoryDecision[]) => {
    for (const decision of decisions) if (decision.disposition === 'auto_save') memory.resolveMemoryLearningDecision(db, decision.id, 'saved', `memory-${decision.id}`)
  })
  let clock = Date.parse(start)
  const makeService = () => new AutomaticMemoryService({ store, client: async () => client, isSourceCurrent: current,
    existingMemories: async () => [], commit, now: () => new Date(clock).toISOString() })
  const service = makeService()
  return { db, client, remote, current, commit, service, makeService,
    tick: (milliseconds = 60_000) => { clock += milliseconds }, setOperation: (value: typeof operation) => { operation = value } }
}
it('automatically retains, exports and commits a supported episode without manual interaction or semantic recall', async () => {
  const f = await fixture(); const event = memory.enqueueMemoryLearningEvent(f.db, source())!
  await f.service.process(); f.tick(); await f.service.process()
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect(f.client.getDocument).toHaveBeenCalledTimes(2)
  expect(f.client.recall).not.toHaveBeenCalled()
  expect(f.commit).toHaveBeenCalledTimes(1)
  expect(memory.listMemoryLearningDecisions(f.db)).toEqual([expect.objectContaining({ eventId: event.id, disposition: 'auto_save' })])
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('committed')
})

it('keeps one review candidate for multiple remote paraphrases of the same original business rule', async () => {
  const f = await fixture(); const input = source(); input.materials[0]!.text = 'Todo 删除必须可撤销。'
  memory.enqueueMemoryLearningEvent(f.db, input)
  const getDocument = f.client.getDocument
  f.client.getDocument = vi.fn<HindsightClient['getDocument']>(async (bank, id) => ({ ...await getDocument(bank, id), memoryUnitCount: 2 }))
  vi.mocked(f.client.listDocumentFacts).mockImplementation(async (_bank, id) => {
    const item = f.remote.get(id)!
    return [
      '用户提出需求：Todo 的删除操作必须支持撤销。 | Involving: user',
      '用户要求 Todo 删除操作支持撤销。 | Involving: user',
    ].map((text, index) => ({ id: `rule-${index}`, documentId: id, text, factType: 'world' as const, updatedAt: start, metadata: item.metadata }))
  })
  await f.service.process(); f.tick(); await f.service.process()
  const decisions = memory.listMemoryLearningDecisions(f.db)
  expect(decisions.filter(decision => decision.disposition === 'rule_candidate')).toEqual([
    expect.objectContaining({ statement: 'Todo 删除必须可撤销。', evidenceMaterialIds: ['m1'] }),
  ])
  expect(decisions.filter(decision => decision.disposition === 'ignored')).toEqual([
    expect.objectContaining({ reason: 'duplicate_in_event' }),
  ])
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('needs_confirmation')
})
it('reconciles an unknown retain after restart, without submitting a second model operation', async () => {
  const f = await fixture(); memory.enqueueMemoryLearningEvent(f.db, source())
  vi.mocked(f.client.retain).mockImplementationOnce(async (_bank, item) => {
    f.remote.set(item.documentId, item)
    throw new Error('response lost')
  })
  await f.service.process()
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('retryable_failure')
  const restarted = f.makeService(); await restarted.recover(); f.tick(); await restarted.process()
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect(f.commit).toHaveBeenCalledTimes(1)
})
it('reuses extracted facts after a failed local commit instead of extracting them again', async () => {
  const f = await fixture(); memory.enqueueMemoryLearningEvent(f.db, source())
  f.commit.mockRejectedValueOnce(new Error('disk full'))
  await f.service.process(); f.tick(); await f.service.process(); f.tick(); await f.service.process()
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect(f.client.listDocumentFacts).toHaveBeenCalledTimes(1)
  expect(f.commit).toHaveBeenCalledTimes(2)
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('committed')
})
it('keeps cleaning an in-flight operation after disable and never imports its late response', async () => {
  const f = await fixture(); memory.enqueueMemoryLearningEvent(f.db, source())
  await f.service.process()
  memory.configureAutomaticMemory(f.db, { ...configuration, enabled: false }, start)
  f.setOperation('processing'); f.tick(); await f.service.process()
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('cleanup_pending')
  f.setOperation('completed'); f.tick(); await f.service.process()
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('cleaned')
  expect(f.client.deleteDocument).toHaveBeenCalledTimes(2)
  expect(f.commit).not.toHaveBeenCalled()
  expect(f.client.retain).toHaveBeenCalledTimes(1)
})
it('rejects a remote document from another source and a source deleted during extraction', async () => {
  const f = await fixture(); memory.enqueueMemoryLearningEvent(f.db, source())
  await f.service.process()
  const item = [...f.remote.values()][0]!
  item.metadata = { ...item.metadata, df_source: 'foreign-source' }
  f.tick(); await f.service.process()
  expect(f.commit).not.toHaveBeenCalled()
  expect(memory.listMemoryLearningFacts(f.db, memory.listMemoryLearningJobs(f.db)[0]!.eventId)).toHaveLength(0)
  item.metadata = memory.listMemoryLearningJobs(f.db)[0]!.metadata
  vi.mocked(f.client.listDocumentFacts).mockImplementationOnce(async (_bank, id) => {
    f.current.mockResolvedValue(false)
    return [{ id: 'remote-fact', documentId: id, text: '以后请用中文解释改动', factType: 'world', updatedAt: start, metadata: item.metadata }]
  })
  f.tick(); await f.service.process()
  expect(f.commit).not.toHaveBeenCalled()
  expect(memory.listMemoryLearningJobs(f.db)[0]).toMatchObject({ revoked: true, status: 'cleanup_pending' })
})

it('deletes expired staging without revoking the saved local event, facts or decisions', async () => {
  const f = await fixture(); const event = memory.enqueueMemoryLearningEvent(f.db, source())!
  await f.service.process(); f.tick(); await f.service.process()
  const facts = memory.listMemoryLearningFacts(f.db, event.id)
  const decisions = memory.listMemoryLearningDecisions(f.db)
  const job = memory.listMemoryLearningJobs(f.db)[0]!
  memory.configureAutomaticMemory(f.db, { ...configuration, hindsightGeneration: 'replacement-service' }, start)
  f.tick(90 * 86_400_000); await f.service.process()
  expect(f.client.deleteDocument).toHaveBeenCalledWith(job.bankId, job.documentId)
  expect(f.remote.size).toBe(0)
  expect(memory.listMemoryLearningJobs(f.db)[0]).toMatchObject({ status: 'cleaned', payload: '', revoked: true })
  expect(memory.getMemoryLearningEvent(f.db, event.id)).toEqual(event)
  expect(memory.listMemoryLearningFacts(f.db, event.id)).toEqual(facts)
  expect(memory.listMemoryLearningDecisions(f.db)).toEqual(decisions)
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect(f.commit).toHaveBeenCalledTimes(1)
})

it('reconciles an operation still running at remote TTL and never imports a late result', async () => {
  const f = await fixture(); const event = memory.enqueueMemoryLearningEvent(f.db, source())!
  await f.service.process()
  f.setOperation('processing'); f.tick(90 * 86_400_000); await f.service.process()
  expect(memory.listMemoryLearningJobs(f.db)[0]).toMatchObject({ status: 'cleanup_pending', revoked: true, payload: '' })
  f.setOperation('completed'); f.tick(); await f.service.process()
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('cleaned')
  expect(f.client.deleteDocument).toHaveBeenCalledTimes(2)
  expect(f.client.retain).toHaveBeenCalledTimes(1)
  expect(f.client.listDocumentFacts).not.toHaveBeenCalled()
  expect(f.commit).not.toHaveBeenCalled()
  expect(memory.getMemoryLearningEvent(f.db, event.id)).toEqual(event)
})

it('drains the current remote submission on shutdown and leaves subsequent durable work for restart', async () => {
  const f = await fixture(); memory.enqueueMemoryLearningEvent(f.db, source())
  let release!: () => void; let started!: () => void
  const submitted = new Promise<void>((resolve) => { started = resolve })
  const completed = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(f.client.retain).mockImplementationOnce(async (_bank, item) => {
    started(); await completed; f.remote.set(item.documentId, item)
  })
  const running = f.service.process()
  await submitted
  let stopped = false
  const shutdown = f.service.shutdown().then(() => { stopped = true })
  await Promise.resolve(); expect(stopped).toBe(false)
  expect(await f.service.process()).toBe(0)
  release(); await running; await shutdown
  expect(memory.listMemoryLearningJobs(f.db)[0]?.status).toBe('remote_processing')
  expect(f.commit).not.toHaveBeenCalled()
  const restarted = f.makeService(); await restarted.recover(); f.tick(); await restarted.process()
  expect(f.commit).toHaveBeenCalledOnce()
  expect(f.client.retain).toHaveBeenCalledOnce()
})
