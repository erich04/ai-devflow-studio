// @vitest-environment node
import initSqlJs, { type Database } from 'sql.js'
import { afterEach, expect, it } from 'vitest'
import type { AutomaticMemoryDecision, AutomaticMemoryEvent, AutomaticMemoryFact, AutomaticMemoryJob } from '@ai-devflow/shared'
import { createMemoryLearningTables, revokeMemoryLearningEvent } from './automatic-memory-store'

const databases: Database[] = []
afterEach(() => { databases.splice(0).forEach((db) => db.close()) })
const now = '2026-10-22T10:00:00.000Z'
const statement = '请用英文回答'

/** Rows the removed learning pipeline (ADR 0030) left behind for one remembered request. */
async function leftover() {
  const SQL = await initSqlJs(); const db = new SQL.Database(); databases.push(db)
  createMemoryLearningTables(db)
  const event: AutomaticMemoryEvent = { id: 'e1', sourceKind: 'manual_remember', sourceId: 'm1', sourceRevision: 'r1',
    scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: 'p1', userId: 'u1', sessionId: 'conversation1' },
    outcome: 'completed', createdAt: now, materials: [{ id: 'm1', role: 'user', text: statement }], sourceDigest: 'sha256:source',
    generation: 'manual-local', policyVersion: 'automatic-memory-v1', revoked: false, manualRequest: { statement, pin: true } }
  const job: AutomaticMemoryJob = { id: 'j1', eventId: 'e1', projectId: 'p1', generation: 'g1', bankId: 'df-experience-g1', documentId: 'df-event-e1',
    operationId: 'op1', payload: statement, payloadDigest: 'sha256:payload', metadata: {}, status: 'committed', retainAttempts: 1,
    revoked: false, nextAttemptAt: '', createdAt: now }
  const fact: AutomaticMemoryFact = { id: 'f1', eventId: 'e1', remoteFactId: 'remote1', documentId: 'df-event-e1', text: statement,
    factType: 'experience', sourceDigest: 'sha256:source', contentDigest: 'sha256:fact', extractedAt: now }
  const decision: AutomaticMemoryDecision = { id: 'd1', eventId: 'e1', factId: 'f1', projectId: 'p1', statement, statementKind: 'communication_preference',
    disposition: 'auto_save', evidenceMaterialIds: ['m1'], reason: 'explicit_manual_request', createdAt: now, resolution: 'saved', memoryId: 'formal1' }
  db.run('INSERT INTO memory_learning_events(id,project_id,source_key,json) VALUES(?,?,?,?)', ['e1', 'p1', 'key1', JSON.stringify(event)])
  db.run('INSERT INTO memory_learning_jobs(id,project_id,event_id,json) VALUES(?,?,?,?)', ['j1', 'p1', 'e1', JSON.stringify(job)])
  db.run('INSERT INTO memory_learning_facts(id,event_id,json) VALUES(?,?,?)', ['f1', 'e1', JSON.stringify(fact)])
  db.run('INSERT INTO memory_learning_decisions(id,event_id,json) VALUES(?,?,?)', ['d1', 'e1', JSON.stringify(decision)])
  const read = <T>(table: string) => JSON.parse(String(db.exec(`SELECT json FROM ${table}`)[0]!.values[0]![0])) as T
  return { db, read }
}

it('scrubs the local text behind a forgotten Memory so nothing can resurrect it', async () => {
  const { db, read } = await leftover()
  revokeMemoryLearningEvent(db, 'e1', 'user_forgot_memory')
  expect(read<AutomaticMemoryEvent>('memory_learning_events')).toMatchObject({ revoked: true, materials: [], manualRequest: { statement: '' } })
  expect(read<AutomaticMemoryJob>('memory_learning_jobs')).toMatchObject({ revoked: true, payload: '', status: 'cleanup_pending' })
  expect(read<AutomaticMemoryFact>('memory_learning_facts').text).toBe('')
  expect(read<AutomaticMemoryDecision>('memory_learning_decisions')).toMatchObject({ statement: '', resolution: 'dismissed', reason: 'user_forgot_memory' })
  expect(JSON.stringify(db.exec('SELECT json FROM memory_learning_events UNION ALL SELECT json FROM memory_learning_facts UNION ALL SELECT json FROM memory_learning_decisions UNION ALL SELECT json FROM memory_learning_jobs')))
    .not.toContain(statement)
})

it('revokes the event without touching resolved decisions for other reasons', async () => {
  const { db, read } = await leftover()
  revokeMemoryLearningEvent(db, 'e1', 'configuration_changed')
  expect(read<AutomaticMemoryEvent>('memory_learning_events')).toMatchObject({ revoked: true, materials: [] })
  expect(read<AutomaticMemoryDecision>('memory_learning_decisions')).toMatchObject({ statement, resolution: 'saved' })
  expect(read<AutomaticMemoryFact>('memory_learning_facts').text).toBe(statement)
})
