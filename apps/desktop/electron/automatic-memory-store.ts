import type { Database } from 'sql.js'
import type { AutomaticMemoryDecision, AutomaticMemoryEvent, AutomaticMemoryFact, AutomaticMemoryJob } from '@ai-devflow/shared'

/**
 * Tables of the automatic learning pipeline that ADR 0030 removed. Schema migrations still create
 * them and their rows are kept; only deleting a Memory learned through them touches them now.
 */
export function createMemoryLearningTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS automatic_memory_configurations (generation TEXT PRIMARY KEY, project_id TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_learning_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_learning_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_learning_facts (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_learning_decisions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_learning_attempts (job_id TEXT NOT NULL, attempt INTEGER NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(job_id, attempt));
    CREATE INDEX IF NOT EXISTS memory_learning_jobs_project ON memory_learning_jobs(project_id);
    CREATE INDEX IF NOT EXISTS memory_learning_facts_event ON memory_learning_facts(event_id);
    CREATE INDEX IF NOT EXISTS memory_learning_decisions_event ON memory_learning_decisions(event_id);`)
}
function rows<T>(db: Database, table: string, where = '', values: string[] = []): T[] {
  return (db.exec(`SELECT json FROM ${table} ${where}`, values)[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as T)
}
function writeJob(db: Database, job: AutomaticMemoryJob): void {
  db.run('UPDATE memory_learning_jobs SET json=? WHERE id=?', [JSON.stringify(job), job.id])
}
function writeEvent(db: Database, event: AutomaticMemoryEvent): void {
  db.run('UPDATE memory_learning_events SET json=? WHERE id=?', [JSON.stringify(event), event.id])
}
function resolveDecision(db: Database, decision: AutomaticMemoryDecision): void {
  if (!decision.resolution) db.run('UPDATE memory_learning_decisions SET json=? WHERE id=?', [JSON.stringify({ ...decision, resolution: 'dismissed' }), decision.id])
}
/** When a person forgets a Memory learned from an event, scrub the event's local text so nothing can resurrect it. */
export function revokeMemoryLearningEvent(db: Database, eventId: string, reason: string): void {
  const event = rows<AutomaticMemoryEvent>(db, 'memory_learning_events', 'WHERE id=?', [eventId])[0]
  if (event && !event.revoked) writeEvent(db, { ...event, revoked: true, materials: [] })
  for (const job of rows<AutomaticMemoryJob>(db, 'memory_learning_jobs', 'WHERE event_id=?', [eventId]).filter((item) => !item.revoked)) {
    writeJob(db, { ...job, revoked: true, payload: '', status: job.retainAttempts ? 'cleanup_pending' : 'revoked', lastError: reason, nextAttemptAt: '' })
  }
  const decisions = () => rows<AutomaticMemoryDecision>(db, 'memory_learning_decisions', 'WHERE event_id=? ORDER BY rowid', [eventId])
  for (const decision of decisions()) resolveDecision(db, decision)
  if (reason !== 'user_forgot_memory') return
  for (const fact of rows<AutomaticMemoryFact>(db, 'memory_learning_facts', 'WHERE event_id=? ORDER BY id', [eventId])) {
    db.run('UPDATE memory_learning_facts SET json=? WHERE id=?', [JSON.stringify({ ...fact, text: '' }), fact.id])
  }
  for (const decision of decisions()) {
    db.run('UPDATE memory_learning_decisions SET json=? WHERE id=?', [JSON.stringify({ ...decision, statement: '',
      resolution: 'dismissed', reason, ...(decision.conflictsWith ? { conflictsWith: decision.conflictsWith.map((conflict) => ({ ...conflict, statement: '' })) } : {}) }), decision.id])
  }
  if (event?.manualRequest) writeEvent(db, { ...event, revoked: true, materials: [], manualRequest: { ...event.manualRequest, statement: '' } })
}
