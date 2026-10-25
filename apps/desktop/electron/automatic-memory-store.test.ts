// @vitest-environment node
import initSqlJs, { type Database } from 'sql.js'
import { afterEach, expect, it } from 'vitest'
import type { AutomaticMemoryEventInput } from '@ai-devflow/shared'
import * as memory from './automatic-memory-store'

const databases: Database[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()) })
const now = '2026-10-22T10:00:00.000Z'
const config = { projectId: 'p1', ownerUserId: 'u1', enabled: true, hindsightGeneration: 'hs1', maxRetainsPerDay: 2 }
const source = (id = 'm1'): AutomaticMemoryEventInput => ({ sourceKind: 'conversation_turn', sourceId: id, sourceRevision: 'r1',
  scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: 'p1', userId: 'u1', sessionId: 'conversation1' },
  outcome: 'completed', createdAt: now, materials: [{ id, role: 'user', text: '以后请用中文解释改动',
    evidence: { kind: 'user_statement', sourceId: id, sourceRevision: 'r1' } }] })
async function fixture() {
  const SQL = await initSqlJs(); const db = new SQL.Database(); databases.push(db)
  memory.createMemoryLearningTables(db); memory.configureAutomaticMemory(db, config, now)
  return { db, SQL }
}
it('enqueues once only under explicit consent, redacts material, and never revives a forgotten source', async () => {
  const { db } = await fixture()
  const event = memory.enqueueMemoryLearningEvent(db, source())!
  expect(memory.enqueueMemoryLearningEvent(db, source())?.id).toBe(event.id)
  expect(memory.listMemoryLearningJobs(db)).toHaveLength(1)
  memory.revokeMemoryLearningEvent(db, event.id, 'forgotten')
  expect(memory.enqueueMemoryLearningEvent(db, source())?.revoked).toBe(true)
  expect(memory.getMemoryLearningEvent(db, event.id)?.materials).toEqual([])
  memory.configureAutomaticMemory(db, { ...config, enabled: false }, now)
  expect(memory.enqueueMemoryLearningEvent(db, source('m2'))).toBeNull()
  const incompatible = source('m3'); incompatible.scope.userId = 'another-user'
  expect(memory.enqueueMemoryLearningEvent(db, incompatible)).toBeNull()
})
it('keeps operation identity across a crash and charges every retry against a durable daily cap', async () => {
  const { db, SQL } = await fixture()
  memory.enqueueMemoryLearningEvent(db, source())
  const first = memory.claimMemoryLearningJob(db, now)!
  const reopened = new SQL.Database(db.export()); databases.push(reopened)
  memory.recoverMemoryLearningJobs(reopened)
  const replay = memory.claimMemoryLearningJob(reopened, now)!
  expect(replay.canSubmit).toBe(false)
  expect(replay.job.operationId).toBe(first.job.operationId)
  memory.settleMemoryLearningJob(reopened, replay.job.id, replay.leaseToken, 'retry', now)
  const retry = memory.claimMemoryLearningJob(reopened, '2026-10-22T10:01:00.000Z')!
  expect(retry.canSubmit).toBe(true)
  expect(retry.job.operationId).toBe(first.job.operationId)
  expect(retry.job.retainAttempts).toBe(2)
  memory.settleMemoryLearningJob(reopened, retry.job.id, retry.leaseToken, 'pending', now)
  memory.enqueueMemoryLearningEvent(reopened, source('m2'))
  const pending = memory.claimMemoryLearningJob(reopened, '2026-10-22T10:02:00.000Z')!
  expect(pending.canSubmit).toBe(false)
  memory.settleMemoryLearningJob(reopened, pending.job.id, pending.leaseToken, 'committed', now)
  expect(memory.claimMemoryLearningJob(reopened, '2026-10-22T10:03:00.000Z')).toBeNull()
  expect(memory.claimMemoryLearningJob(reopened, '2026-10-23T10:03:00.000Z')?.canSubmit).toBe(true)
})
it('disabling invalidates an in-flight import while retaining its cleanup work under the old configuration', async () => {
  const { db } = await fixture()
  const event = memory.enqueueMemoryLearningEvent(db, source())!
  const claim = memory.claimMemoryLearningJob(db, now)!
  memory.configureAutomaticMemory(db, { ...config, enabled: false }, now)
  const text = '以后请用中文解释改动'
  expect(memory.recordMemoryLearningExtraction(db, claim.job.id, claim.leaseToken, [{ id: 'f1', eventId: event.id,
    remoteFactId: 'remote1', documentId: claim.job.documentId, sourceDigest: event.sourceDigest,
    contentDigest: memory.automaticMemoryDigest(text), text, factType: 'world', extractedAt: now }])).toBe(false)
  memory.settleMemoryLearningJob(db, claim.job.id, claim.leaseToken, 'committed', now)
  expect(memory.listMemoryLearningJobs(db)[0]).toMatchObject({ revoked: true, status: 'cleanup_pending', payload: '' })
  const cleanup = memory.claimMemoryLearningJob(db, '2026-10-22T10:01:00.000Z')!
  expect(cleanup.config.enabled).toBe(false)
  expect(cleanup.canSubmit).toBe(false)
  expect(cleanup.job.operationId).toBe(claim.job.operationId)
})
it('binds paired events to the explicitly configured pairing session and rejects local scope reuse', async () => {
  const { db } = await fixture()
  memory.configureAutomaticMemory(db, { ...config, pairingSessionId: 'pair-token' }, now)
  const input = source()
  expect(memory.enqueueMemoryLearningEvent(db, input)).toBeNull()
  input.scope = { kind: 'team', organizationId: 'org1', projectId: 'team-p1', localProjectId: 'p1', userId: 'u1', sessionId: 'other' }
  expect(memory.enqueueMemoryLearningEvent(db, input)).toBeNull()
  input.scope.sessionId = 'pair-token'
  expect(memory.enqueueMemoryLearningEvent(db, input)?.scope.kind).toBe('team')
})

it('persists explicit manual requests while automatic memory is off, without jobs or remote calls', async () => {
  const { db } = await fixture()
  memory.configureAutomaticMemory(db, { ...config, enabled: false }, now)
  const input = { ...source(), sourceKind: 'manual_remember' as const }
  const decision = memory.recordManualMemoryLearningEvent(db, input, '故障排查时先检查旧的锁文件', true)
  expect(decision).toMatchObject({ manual: true, pin: true, disposition: 'auto_save' })
  expect(memory.listMemoryLearningJobs(db)).toEqual([])
  const event = memory.getMemoryLearningEvent(db, decision.eventId)!
  expect(event.generation).toBe('manual-local')
  expect(event.manualRequest).toEqual({ statement: decision.statement, pin: true })
  expect(event.sourceDigest).toBe(memory.memoryLearningSourceDigest(event))
  expect(memory.recordManualMemoryLearningEvent(db, input, decision.statement, true).id).toBe(decision.id)
  expect(memory.recordManualMemoryLearningEvent(db, input, '另一条明确保存的经验', true).id).not.toBe(decision.id)
  expect(memory.recordManualMemoryLearningEvent(db, input, 'Todo 删除必须可撤销', false).disposition).toBe('rule_candidate')
})

it('forgets derived plaintext and keeps a source tombstone so replays cannot resurrect it', async () => {
  const { db } = await fixture()
  const input = { ...source(), sourceKind: 'manual_remember' as const }
  const decision = memory.recordManualMemoryLearningEvent(db, input, '请用英文回答', true)
  memory.resolveMemoryLearningDecision(db, decision.id, 'saved', 'formal1')
  memory.revokeMemoryLearningEvent(db, decision.eventId, 'user_forgot_memory')
  expect(memory.getMemoryLearningDecision(db, decision.id)).toMatchObject({ statement: '', resolution: 'dismissed', reason: 'user_forgot_memory' })
  expect(memory.getMemoryLearningFact(db, decision.eventId, decision.factId)?.text).toBe('')
  expect(memory.getMemoryLearningEvent(db, decision.eventId)).toMatchObject({ materials: [], revoked: true,
    manualRequest: { statement: '' } })
  const replay = memory.recordManualMemoryLearningEvent(db, input, '请用英文回答', true)
  expect(replay.id).toBe(decision.id)
  expect(replay.resolution).toBe('dismissed')
})

it('cancels an unsubmitted event at the 90-day remote TTL without deleting local evidence or permitting replay', async () => {
  const { db } = await fixture()
  const event = memory.enqueueMemoryLearningEvent(db, source())!
  const expiry = new Date(Date.parse(now) + 90 * 86_400_000).toISOString()
  expect(memory.claimMemoryLearningJob(db, expiry)).toBeNull()
  expect(memory.listMemoryLearningJobs(db)).toEqual([expect.objectContaining({ status: 'revoked', revoked: true,
    payload: '', retainAttempts: 0, lastError: 'remote_retention_expired' })])
  expect(memory.getMemoryLearningEvent(db, event.id)).toEqual(event)
  expect(memory.enqueueMemoryLearningEvent(db, source())?.id).toBe(event.id)
  expect(memory.claimMemoryLearningJob(db, expiry)).toBeNull()
  expect(memory.listMemoryLearningJobs(db)).toHaveLength(1)
})

it.each(['committed', 'needs_confirmation', 'skipped'] as const)('cleans a %s remote document at its exact TTL using its historical bank', async (state) => {
  const { db } = await fixture()
  const event = memory.enqueueMemoryLearningEvent(db, source())!
  const initial = memory.claimMemoryLearningJob(db, now)!
  memory.settleMemoryLearningJob(db, initial.job.id, initial.leaseToken, state, now)
  memory.configureAutomaticMemory(db, { ...config, enabled: false, hindsightGeneration: 'new-service' }, now)
  const expiry = Date.parse(now) + 90 * 86_400_000
  expect(memory.claimMemoryLearningJob(db, new Date(expiry - 1).toISOString())).toBeNull()
  const cleanup = memory.claimMemoryLearningJob(db, new Date(expiry).toISOString())!
  expect(cleanup.canSubmit).toBe(false)
  expect(cleanup.config.generation).toBe(initial.config.generation)
  expect(cleanup.job).toMatchObject({ bankId: initial.job.bankId, operationId: initial.job.operationId,
    documentId: initial.job.documentId, status: 'cleanup_pending', revoked: true, payload: '', retainAttempts: 1 })
  expect(memory.getMemoryLearningEvent(db, event.id)).toEqual(event)
})
