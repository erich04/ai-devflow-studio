import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'sql.js'
import { redactSensitiveText } from '@ai-devflow/shared'
import {
  AUTOMATIC_MEMORY_MAX_EVENT_BYTES, AUTOMATIC_MEMORY_MAX_FACTS, AUTOMATIC_MEMORY_POLICY_VERSION,
  type AutomaticMemoryConfiguration, type AutomaticMemoryConfigurationInput, type AutomaticMemoryDecision,
  type AutomaticMemoryEvent, type AutomaticMemoryEventInput, type AutomaticMemoryFact, type AutomaticMemoryJob,
} from '@ai-devflow/shared'
import { isMemoryBusinessRule } from './automatic-memory-policy'

export const automaticMemoryDigest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
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
  db.run('INSERT INTO memory_learning_jobs(id,project_id,event_id,json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
    [job.id, job.projectId, job.eventId, JSON.stringify(job)])
}
function writeEvent(db: Database, event: AutomaticMemoryEvent): void {
  db.run('UPDATE memory_learning_events SET json=? WHERE id=?', [JSON.stringify(event), event.id])
}
export function listAutomaticMemoryConfigurations(db: Database): AutomaticMemoryConfiguration[] {
  return rows(db, 'automatic_memory_configurations', 'ORDER BY rowid')
}
export function getAutomaticMemoryConfiguration(db: Database, projectId: string): AutomaticMemoryConfiguration | null {
  return rows<AutomaticMemoryConfiguration>(db, 'automatic_memory_configurations', 'WHERE project_id=? ORDER BY rowid DESC LIMIT 1', [projectId])[0] ?? null
}
export function listMemoryLearningJobs(db: Database, projectId?: string): AutomaticMemoryJob[] {
  return rows(db, 'memory_learning_jobs', projectId ? 'WHERE project_id=? ORDER BY rowid' : 'ORDER BY rowid', projectId ? [projectId] : [])
}
export function getMemoryLearningEvent(db: Database, eventId: string): AutomaticMemoryEvent | null {
  return rows<AutomaticMemoryEvent>(db, 'memory_learning_events', 'WHERE id=?', [eventId])[0] ?? null
}
export function listMemoryLearningFacts(db: Database, eventId: string): AutomaticMemoryFact[] {
  return rows(db, 'memory_learning_facts', 'WHERE event_id=? ORDER BY id', [eventId])
}
export function getMemoryLearningFact(db: Database, eventId: string, factId: string): AutomaticMemoryFact | null {
  return rows<AutomaticMemoryFact>(db, 'memory_learning_facts', 'WHERE event_id=? AND id=?', [eventId, factId])[0] ?? null
}
export function listMemoryLearningDecisions(db: Database, projectId?: string): AutomaticMemoryDecision[] {
  const all = rows<AutomaticMemoryDecision>(db, 'memory_learning_decisions', 'ORDER BY rowid')
  return projectId ? all.filter((decision) => decision.projectId === projectId) : all
}
export function getMemoryLearningDecision(db: Database, decisionId: string): AutomaticMemoryDecision | null {
  return rows<AutomaticMemoryDecision>(db, 'memory_learning_decisions', 'WHERE id=?', [decisionId])[0] ?? null
}
export function configureAutomaticMemory(db: Database, input: AutomaticMemoryConfigurationInput, now = new Date().toISOString()): AutomaticMemoryConfiguration {
  if (!input.projectId || !input.ownerUserId || !input.hindsightGeneration || !Number.isSafeInteger(input.maxRetainsPerDay) ||
      input.maxRetainsPerDay < 1 || input.maxRetainsPerDay > 100) throw new Error('Invalid automatic memory configuration')
  const old = getAutomaticMemoryConfiguration(db, input.projectId)
  if (old && old.pairingSessionId === input.pairingSessionId && Object.entries(input).every(([key, value]) => old[key as keyof AutomaticMemoryConfiguration] === value)) return old
  if (old) {
    db.run('UPDATE automatic_memory_configurations SET json=? WHERE generation=?', [JSON.stringify({ ...old, enabled: false }), old.generation])
    // Disabling preserves committed memories. Unfinished work must not be imported under old consent.
    for (const job of listMemoryLearningJobs(db, input.projectId)) {
      if (!['committed', 'needs_confirmation', 'skipped', 'cleaned', 'revoked'].includes(job.status)) revokeMemoryLearningEvent(db, job.eventId, 'configuration_changed')
    }
  }
  const generation = randomUUID()
  const config: AutomaticMemoryConfiguration = { ...input, generation, bankId: `df-experience-${generation}`, createdAt: now }
  db.run('INSERT INTO automatic_memory_configurations(generation,project_id,json) VALUES(?,?,?)', [generation, input.projectId, JSON.stringify(config)])
  return config
}
export function normalizeMemoryLearningInput(input: AutomaticMemoryEventInput): AutomaticMemoryEventInput {
  if (!input.scope.localProjectId || !input.scope.userId || !input.sourceId || !input.sourceRevision ||
      !Number.isFinite(Date.parse(input.createdAt)) || !input.materials.length || input.materials.length > 32 ||
      new Set(input.materials.map((item) => item.id)).size !== input.materials.length) throw new Error('Invalid automatic memory event')
  const materials = input.materials.map((material) => {
    if (!material.id || !material.text.trim() || Buffer.byteLength(material.text) > AUTOMATIC_MEMORY_MAX_EVENT_BYTES) throw new Error('Invalid automatic memory material')
    return { ...material, text: redactSensitiveText(material.text).value }
  })
  const result = { ...input, materials }
  if (Buffer.byteLength(JSON.stringify(result)) > AUTOMATIC_MEMORY_MAX_EVENT_BYTES) throw new Error('Automatic memory event exceeds limit')
  return result
}
export function memoryLearningSourceDigest(input: AutomaticMemoryEventInput & { manualRequest?: AutomaticMemoryEvent['manualRequest'] }): string {
  const normalized = normalizeMemoryLearningInput(input)
  return automaticMemoryDigest(JSON.stringify({ sourceKind: normalized.sourceKind, sourceId: normalized.sourceId,
    sourceRevision: normalized.sourceRevision, scope: normalized.scope, outcome: normalized.outcome, materials: normalized.materials,
    ...(input.manualRequest ? { manualRequest: input.manualRequest } : {}) }))
}
/** A local, explicit human request; never consumes remote budget or grants automatic-policy authority. */
export function recordManualMemoryLearningEvent(db: Database, input: AutomaticMemoryEventInput, statement: string, pin: boolean): AutomaticMemoryDecision {
  if (input.sourceKind !== 'manual_remember' || !statement.trim() || Buffer.byteLength(statement) > 1_800 ||
      typeof pin !== 'boolean' || redactSensitiveText(statement).value !== statement) throw new Error('Invalid manual memory request')
  const source = normalizeMemoryLearningInput(input)
  const manualRequest = { statement: statement.trim(), pin }
  const sourceDigest = memoryLearningSourceDigest({ ...source, manualRequest })
  const sourceKey = automaticMemoryDigest(JSON.stringify([source.scope.localProjectId, source.scope.userId,
    'manual_remember', source.sourceId, source.sourceRevision, sourceDigest]))
  const existing = rows<AutomaticMemoryEvent>(db, 'memory_learning_events', 'WHERE source_key=?', [sourceKey])[0]
  if (existing) {
    const decision = listMemoryLearningDecisions(db, source.scope.localProjectId).find((item) => item.eventId === existing.id)
    if (!decision) throw new Error('Manual memory request is incomplete')
    return decision
  }
  const event: AutomaticMemoryEvent = { ...source, id: randomUUID(), generation: 'manual-local', sourceDigest,
    policyVersion: AUTOMATIC_MEMORY_POLICY_VERSION, revoked: false, manualRequest }
  const fact: AutomaticMemoryFact = { id: randomUUID(), eventId: event.id, remoteFactId: `manual:${source.sourceId}`,
    documentId: `manual:${event.id}`, text: manualRequest.statement, factType: 'experience', sourceDigest,
    contentDigest: automaticMemoryDigest(manualRequest.statement), extractedAt: input.createdAt }
  const business = isMemoryBusinessRule(manualRequest.statement)
  const decision: AutomaticMemoryDecision = { id: randomUUID(), eventId: event.id, factId: fact.id,
    projectId: source.scope.localProjectId, statement: manualRequest.statement,
    statementKind: business ? 'business_rule' : 'unclassified', disposition: business ? 'rule_candidate' : 'auto_save',
    evidenceMaterialIds: source.materials.map((material) => material.id), reason: business ? 'requires_workflow_approval' : 'explicit_manual_request',
    createdAt: input.createdAt, manual: true, pin, ...(!pin ? { retentionDays: 30 } : {}) }
  db.run('INSERT INTO memory_learning_events(id,project_id,source_key,json) VALUES(?,?,?,?)', [event.id, source.scope.localProjectId, sourceKey, JSON.stringify(event)])
  db.run('INSERT INTO memory_learning_facts(id,event_id,json) VALUES(?,?,?)', [fact.id, event.id, JSON.stringify(fact)])
  db.run('INSERT INTO memory_learning_decisions(id,event_id,json) VALUES(?,?,?)', [decision.id, event.id, JSON.stringify(decision)])
  return decision
}
export function enqueueMemoryLearningEvent(db: Database, input: AutomaticMemoryEventInput): AutomaticMemoryEvent | null {
  const config = getAutomaticMemoryConfiguration(db, input.scope.localProjectId)
  if (!config?.enabled || config.ownerUserId !== input.scope.userId ||
      (input.scope.kind === 'team' ? !config.pairingSessionId || input.scope.sessionId !== config.pairingSessionId : !!config.pairingSessionId)) return null
  const source = normalizeMemoryLearningInput(input)
  const sourceDigest = memoryLearningSourceDigest(source)
  // Source identity survives generations, restarts and a user dismissing an event.
  const sourceKey = automaticMemoryDigest(JSON.stringify([source.scope.localProjectId, source.scope.userId, source.sourceKind, source.sourceId, source.sourceRevision]))
  const existing = rows<AutomaticMemoryEvent>(db, 'memory_learning_events', 'WHERE source_key=?', [sourceKey])[0]
  if (existing) {
    if (existing.sourceDigest !== sourceDigest) throw new Error('Automatic memory source revision changed')
    return existing
  }
  const id = randomUUID()
  const event: AutomaticMemoryEvent = { ...source, id, generation: config.generation, sourceDigest,
    policyVersion: AUTOMATIC_MEMORY_POLICY_VERSION, revoked: false }
  const payload = JSON.stringify({ sourceKind: source.sourceKind, outcome: source.outcome, materials: source.materials })
  const payloadDigest = automaticMemoryDigest(payload)
  const job: AutomaticMemoryJob = { id: randomUUID(), eventId: id, projectId: config.projectId, generation: config.generation,
    bankId: config.bankId, documentId: `df-event-${id}`, operationId: randomUUID(), payload, payloadDigest,
    metadata: { df_event: id, df_source: sourceDigest, df_generation: config.generation, df_payload: payloadDigest, df_policy: event.policyVersion },
    status: 'queued', retainAttempts: 0, revoked: false, nextAttemptAt: '', createdAt: input.createdAt }
  db.run('INSERT INTO memory_learning_events(id,project_id,source_key,json) VALUES(?,?,?,?)', [id, config.projectId, sourceKey, JSON.stringify(event)])
  writeJob(db, job)
  return event
}
export type MemoryLearningClaim = { job: AutomaticMemoryJob; config: AutomaticMemoryConfiguration; leaseToken: string; canSubmit: boolean }
const REMOTE_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
/** Remote staging has its own TTL. Local source evidence and formal/pinned Memory survive it. */
function expireRemoteMemoryLearningJobs(db: Database, now: string): void {
  const cutoff = Date.parse(now) - REMOTE_EVENT_RETENTION_MS
  for (const job of listMemoryLearningJobs(db)) {
    if (job.revoked || job.status === 'cleaned' || Date.parse(job.createdAt) > cutoff) continue
    // Preserve the historical bank/operation identity so a late remote result can
    // still be reconciled and deleted. Never revoke the local event for remote TTL.
    writeJob(db, { ...job, revoked: true, payload: '',
      status: job.retainAttempts ? 'cleanup_pending' : 'revoked',
      lastError: 'remote_retention_expired', nextAttemptAt: '' })
  }
}
export function claimMemoryLearningJob(db: Database, now: string): MemoryLearningClaim | null {
  expireRemoteMemoryLearningJobs(db, now)
  const configs = listAutomaticMemoryConfigurations(db)
  for (const job of listMemoryLearningJobs(db).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))) {
    if (['committed', 'needs_confirmation', 'skipped', 'cleaned', 'revoked'].includes(job.status) ||
        job.nextAttemptAt > now || (job.leaseUntil && job.leaseUntil > now)) continue
    const config = configs.find((item) => item.generation === job.generation)
    if (!config) continue
    if (!job.revoked && (!config.enabled || getAutomaticMemoryConfiguration(db, job.projectId)?.generation !== job.generation)) {
      revokeMemoryLearningEvent(db, job.eventId, 'configuration_changed'); continue
    }
    const canSubmit = !job.revoked && job.status === 'queued'
    if (canSubmit) {
      const attempts = Number(db.exec('SELECT COUNT(*) FROM memory_learning_attempts WHERE project_id=? AND created_at>=? AND created_at<?',
        [job.projectId, `${now.slice(0, 10)}T00:00:00.000Z`, `${now.slice(0, 10)}T23:59:59.999Z`])[0]?.values[0]?.[0] ?? 0)
      if (attempts >= config.maxRetainsPerDay || job.retainAttempts >= 3) continue
    }
    const leaseToken = randomUUID()
    const claimed: AutomaticMemoryJob = { ...job, leaseToken, leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      status: canSubmit ? 'submitted' : job.status, retainAttempts: job.retainAttempts + (canSubmit ? 1 : 0),
      ...(canSubmit ? { submittedAt: now } : {}) }
    if (canSubmit) db.run('INSERT INTO memory_learning_attempts(job_id,attempt,project_id,created_at) VALUES(?,?,?,?)',
      [job.id, claimed.retainAttempts, job.projectId, now])
    writeJob(db, claimed)
    return { job: claimed, config, leaseToken, canSubmit }
  }
  return null
}
function liveLease(db: Database, id: string, leaseToken: string): AutomaticMemoryJob | null {
  const job = rows<AutomaticMemoryJob>(db, 'memory_learning_jobs', 'WHERE id=?', [id])[0]
  return job?.leaseToken === leaseToken ? job : null
}
export type MemoryLearningSettlement = 'pending' | 'retry' | 'extracted' | 'committed' | 'needs_confirmation' | 'skipped' | 'cleaned' | 'unknown'
export function settleMemoryLearningJob(db: Database, id: string, leaseToken: string, result: MemoryLearningSettlement, now: string, error?: string): void {
  const job = liveLease(db, id, leaseToken)
  if (!job) return
  const { leaseToken: _lease, leaseUntil: _until, ...next } = job
  next.nextAttemptAt = new Date(Date.parse(now) + (result === 'unknown' ? 30_000 : 2_000)).toISOString()
  if (error) next.lastError = error.slice(0, 200)
  else delete next.lastError
  next.status = job.revoked ? result === 'cleaned' ? 'cleaned' : 'cleanup_pending'
    : result === 'pending' ? 'remote_processing' : result === 'retry' && job.retainAttempts < 3 ? 'queued'
      : result === 'unknown' || result === 'retry' ? 'retryable_failure' : result
  writeJob(db, next)
}
export function recordMemoryLearningExtraction(db: Database, id: string, leaseToken: string, facts: AutomaticMemoryFact[]): boolean {
  const job = liveLease(db, id, leaseToken)
  if (!job || job.revoked || getAutomaticMemoryConfiguration(db, job.projectId)?.generation !== job.generation ||
      !getAutomaticMemoryConfiguration(db, job.projectId)?.enabled) return false
  const event = getMemoryLearningEvent(db, job.eventId)
  if (!event || event.revoked || facts.length > AUTOMATIC_MEMORY_MAX_FACTS || new Set(facts.map((fact) => fact.id)).size !== facts.length ||
      facts.some((fact) => fact.eventId !== event.id || fact.documentId !== job.documentId || fact.sourceDigest !== event.sourceDigest ||
        fact.contentDigest !== automaticMemoryDigest(fact.text))) throw new Error('Invalid memory extraction')
  const existing = listMemoryLearningFacts(db, job.eventId)
  if (existing.length) {
    if (JSON.stringify([...existing].sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify([...facts].sort((a, b) => a.id.localeCompare(b.id)))) throw new Error('Memory extraction changed')
    return true
  }
  for (const fact of facts) db.run('INSERT INTO memory_learning_facts(id,event_id,json) VALUES(?,?,?)', [fact.id, event.id, JSON.stringify(fact)])
  writeJob(db, { ...job, status: 'extracted' })
  return true
}
export function recordMemoryLearningDecisions(db: Database, id: string, leaseToken: string, decisions: AutomaticMemoryDecision[]): boolean {
  const job = liveLease(db, id, leaseToken)
  if (!job || job.revoked || !getAutomaticMemoryConfiguration(db, job.projectId)?.enabled ||
      getAutomaticMemoryConfiguration(db, job.projectId)?.generation !== job.generation) return false
  for (const decision of decisions) {
    if (decision.eventId !== job.eventId || decision.projectId !== job.projectId || !getMemoryLearningFact(db, job.eventId, decision.factId)) throw new Error('Invalid memory decision')
    const existing = getMemoryLearningDecision(db, decision.id)
    if (existing) continue
    db.run('INSERT INTO memory_learning_decisions(id,event_id,json) VALUES(?,?,?)', [decision.id, job.eventId, JSON.stringify(decision)])
  }
  return true
}
export function resolveMemoryLearningDecision(db: Database, decisionId: string, resolution: 'saved' | 'dismissed', memoryId?: string): void {
  const decision = getMemoryLearningDecision(db, decisionId)
  if (!decision || decision.resolution) return
  db.run('UPDATE memory_learning_decisions SET json=? WHERE id=?', [JSON.stringify({ ...decision, resolution, ...(memoryId ? { memoryId } : {}) }), decisionId])
}
/** The host may reclassify an unresolved decision against newer active memories. */
export function refreshMemoryLearningDecision(db: Database, decision: AutomaticMemoryDecision): boolean {
  const stored = getMemoryLearningDecision(db, decision.id)
  if (!stored || stored.resolution || stored.manual !== decision.manual || decision.resolution ||
      (stored.manual && (stored.statement !== decision.statement || stored.pin !== decision.pin ||
        JSON.stringify(stored.evidenceMaterialIds) !== JSON.stringify(decision.evidenceMaterialIds))) ||
      stored.eventId !== decision.eventId || stored.factId !== decision.factId || stored.projectId !== decision.projectId ||
      stored.createdAt !== decision.createdAt || getMemoryLearningEvent(db, decision.eventId)?.revoked) {
    throw new Error('Memory decision cannot be refreshed')
  }
  db.run('UPDATE memory_learning_decisions SET json=? WHERE id=?', [JSON.stringify(decision), decision.id])
  return true
}
export function revokeMemoryLearningEvent(db: Database, eventId: string, reason: string): void {
  const event = getMemoryLearningEvent(db, eventId)
  if (event && !event.revoked) writeEvent(db, { ...event, revoked: true, materials: [] })
  for (const job of listMemoryLearningJobs(db).filter((item) => item.eventId === eventId && !item.revoked)) {
    writeJob(db, { ...job, revoked: true, payload: '', status: job.retainAttempts ? 'cleanup_pending' : 'revoked', lastError: reason, nextAttemptAt: '' })
  }
  for (const decision of listMemoryLearningDecisions(db).filter((item) => item.eventId === eventId && !item.resolution)) resolveMemoryLearningDecision(db, decision.id, 'dismissed')
  if (reason === 'user_forgot_memory') {
    for (const fact of listMemoryLearningFacts(db, eventId)) {
      db.run('UPDATE memory_learning_facts SET json=? WHERE id=?', [JSON.stringify({ ...fact, text: '' }), fact.id])
    }
    for (const decision of listMemoryLearningDecisions(db).filter((item) => item.eventId === eventId)) {
      db.run('UPDATE memory_learning_decisions SET json=? WHERE id=?', [JSON.stringify({ ...decision, statement: '',
        resolution: 'dismissed', reason, ...(decision.conflictsWith ? { conflictsWith: decision.conflictsWith.map((conflict) => ({ ...conflict, statement: '' })) } : {}) }), decision.id])
    }
    if (event?.manualRequest) writeEvent(db, { ...event, revoked: true, materials: [], manualRequest: { ...event.manualRequest, statement: '' } })
  }
}
export function recoverMemoryLearningJobs(db: Database): void {
  for (const job of listMemoryLearningJobs(db).filter((item) => item.leaseToken)) {
    const { leaseToken: _lease, leaseUntil: _until, ...rest } = job
    writeJob(db, { ...rest, nextAttemptAt: '' })
  }
}
