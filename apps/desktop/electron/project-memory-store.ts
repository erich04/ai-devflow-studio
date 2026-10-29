import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'sql.js'
import {
  isValidProjectMemoryDocumentInput, PROJECT_MEMORY_MAX_RETAIN_ATTEMPTS, redactSensitiveText,
  type ProjectMemoryConfiguration, type ProjectMemoryDocument, type ProjectMemoryDocumentInput,
} from '@ai-devflow/shared'
import { normalizeHindsightEndpoint } from './hindsight-client'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
/**
 * One bank per project and owner, so a pairing change never mixes two people's memory. Each
 * "clear" starts a new generation with a new, empty bank.
 */
export function projectMemoryBankId(projectId: string, ownerUserId: string, generation = 0): string {
  return `df-memory-${digest(JSON.stringify(generation ? [projectId, ownerUserId, generation] : [projectId, ownerUserId])).slice(0, 32)}`
}
function writeConfiguration(db: Database, config: ProjectMemoryConfiguration): void {
  db.run(`insert into project_memory_configurations(project_id, json) values (?, ?)
    on conflict(project_id) do update set json = excluded.json`, [config.projectId, JSON.stringify(config)])
}
function rows<T>(db: Database, sql: string, values: (string | number)[] = []): T[] {
  return (db.exec(sql, values)[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as T)
}
function writeDocument(db: Database, row: ProjectMemoryDocument): void {
  db.run(`insert into project_memory_documents(id, project_id, bank_id, document_id, json) values (?, ?, ?, ?, ?)
    on conflict(id) do update set json = excluded.json`, [row.id, row.projectId, row.bankId, row.documentId, JSON.stringify(row)])
}
export function getProjectMemoryConfiguration(db: Database, projectId: string): ProjectMemoryConfiguration | null {
  return rows<ProjectMemoryConfiguration>(db, 'select json from project_memory_configurations where project_id = ?', [projectId])[0] ?? null
}
export function listProjectMemoryConfigurations(db: Database): ProjectMemoryConfiguration[] {
  return rows(db, 'select json from project_memory_configurations order by rowid')
}
export function listProjectMemoryDocuments(db: Database, projectId?: string): ProjectMemoryDocument[] {
  return projectId
    ? rows(db, 'select json from project_memory_documents where project_id = ? order by rowid', [projectId])
    : rows(db, 'select json from project_memory_documents order by rowid')
}
export type ProjectMemoryConfigurationInput = Omit<ProjectMemoryConfiguration, 'bankId' | 'createdAt' | 'updatedAt'>
export function configureProjectMemory(db: Database, input: ProjectMemoryConfigurationInput, now: string): ProjectMemoryConfiguration {
  if (!input.projectId || !input.ownerUserId || !input.providerId || input.providerId.length > 200 ||
      (input.encryptedApiKey !== null && (typeof input.encryptedApiKey !== 'string' || !input.encryptedApiKey))) {
    throw new Error('Invalid project memory configuration')
  }
  if (!db.exec('select id from local_projects where id = ?', [input.projectId])[0]?.values.length) throw new Error('Project memory project is missing')
  const previous = getProjectMemoryConfiguration(db, input.projectId)
  // The same owner keeps their generation and change records; banks awaiting deletion stay queued.
  const sameOwner = previous?.ownerUserId === input.ownerUserId
  const generation = input.generation ?? (sameOwner ? previous?.generation : undefined)
  const clearedAt = input.clearedAt ?? (sameOwner ? previous?.clearedAt : undefined)
  const changedMemories = input.changedMemories ?? (sameOwner ? previous?.changedMemories : undefined)
  const pendingBankDeletions = input.pendingBankDeletions ?? previous?.pendingBankDeletions
  const bankId = projectMemoryBankId(input.projectId, input.ownerUserId, generation)
  const { generation: _generation, clearedAt: _cleared, changedMemories: _changed, pendingBankDeletions: _pending, ...base } = input
  const config: ProjectMemoryConfiguration = { ...base, endpoint: normalizeHindsightEndpoint(input.endpoint), bankId,
    ...(generation ? { generation } : {}), ...(clearedAt ? { clearedAt } : {}),
    ...(changedMemories && Object.keys(changedMemories).length ? { changedMemories } : {}),
    ...(pendingBankDeletions?.length ? { pendingBankDeletions } : {}),
    createdAt: previous?.bankId === bankId ? previous.createdAt : now, updatedAt: now }
  writeConfiguration(db, config)
  return config
}
const contentDigest = (input: ProjectMemoryDocumentInput) =>
  digest(JSON.stringify([input.title, input.payload, input.context, input.tags, input.occurredAt]))

/**
 * Record the latest revision of a source for the worker. Called inside the store's durable
 * mutation, so the source and its memory document commit together. A document the user
 * deleted stays deleted: a later revision of the same source cannot bring it back.
 */
export function upsertProjectMemoryDocument(db: Database, config: ProjectMemoryConfiguration, value: ProjectMemoryDocumentInput, now: string): ProjectMemoryDocument | null {
  if (!config.enabled) return null
  const input = { ...value, payload: redactSensitiveText(value.payload).value, title: redactSensitiveText(value.title).value }
  // A source that does not fit is left out of memory; it must never fail the user's own save.
  if (!isValidProjectMemoryDocumentInput(input)) return null
  const existing = rows<ProjectMemoryDocument>(db, 'select json from project_memory_documents where bank_id = ? and document_id = ?',
    [config.bankId, input.documentId])[0]
  if (existing && ['delete_pending', 'deleted'].includes(existing.status)) return existing
  const nextDigest = contentDigest(input)
  if (existing?.contentDigest === nextDigest) return existing
  const row: ProjectMemoryDocument = {
    id: existing?.id ?? randomUUID(), projectId: config.projectId, ownerUserId: config.ownerUserId, bankId: config.bankId,
    documentId: input.documentId, sourceKind: input.sourceKind, sourceId: input.sourceId, title: input.title,
    contentDigest: nextDigest, payload: input.payload, context: input.context, tags: [...input.tags], occurredAt: input.occurredAt,
    status: 'queued', operationId: randomUUID(), attempts: 0, notBefore: input.notBefore ?? now,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
    ...(existing?.retainedAt ? { retainedAt: existing.retainedAt } : {}),
  }
  writeDocument(db, row)
  return row
}
export type ProjectMemoryClaim = {
  document: ProjectMemoryDocument; config: ProjectMemoryConfiguration; leaseToken: string
  action: 'submit' | 'poll' | 'delete'
}
/**
 * One unit of remote work. Deletion is honoured even after the project's memory is turned off.
 * `submit: false` holds new retains (their model calls could not be paid now) but still polls
 * and deletes.
 */
export function claimProjectMemoryDocument(db: Database, now: string, options: { submit?: boolean } = {}): ProjectMemoryClaim | null {
  const configs = new Map(listProjectMemoryConfigurations(db).map((config) => [config.projectId, config]))
  const due = listProjectMemoryDocuments(db)
    .filter((row) => ['queued', 'submitted', 'delete_pending'].includes(row.status) && row.notBefore <= now && !(row.leaseUntil && row.leaseUntil > now))
    .filter((row) => options.submit !== false || row.status !== 'queued')
    .sort((left, right) => left.notBefore.localeCompare(right.notBefore))
  for (const row of due) {
    const config = configs.get(row.projectId)
    if (!config) continue
    if (row.status !== 'delete_pending' && (!config.enabled || config.bankId !== row.bankId)) continue
    const action = row.status === 'delete_pending' ? 'delete' : row.status === 'queued' ? 'submit' : 'poll'
    const leaseToken = randomUUID()
    const claimed: ProjectMemoryDocument = { ...row, leaseToken, leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      ...(action === 'submit' ? { status: 'submitted' as const, attempts: row.attempts + 1 } : {}) }
    writeDocument(db, claimed)
    return { document: claimed, config, leaseToken, action }
  }
  return null
}
export type ProjectMemorySettlement = 'pending' | 'retained' | 'retry' | 'resend' | 'deleted' | 'unknown'
export function settleProjectMemoryDocument(db: Database, id: string, leaseToken: string, result: ProjectMemorySettlement, now: string, error?: string): void {
  const row = rows<ProjectMemoryDocument>(db, 'select json from project_memory_documents where id = ?', [id])[0]
  if (!row || row.leaseToken !== leaseToken) return
  const { leaseToken: _lease, leaseUntil: _until, ...next } = row
  next.updatedAt = now
  if (error) next.lastError = error.slice(0, 200)
  else delete next.lastError
  const later = (ms: number) => new Date(Date.parse(now) + ms).toISOString()
  if (row.status === 'delete_pending') {
    // Cleanup keeps its status until the remote document is gone.
    if (result === 'deleted') next.status = 'deleted'
    next.notBefore = later(result === 'deleted' ? 0 : 60_000)
  } else if (result === 'retained') {
    next.status = 'retained'; next.retainedAt = now
  } else if (result === 'pending') {
    next.notBefore = later(5_000)
  } else if (result === 'resend') {
    // Hindsight never received this operation: send the same operation id again, uncounted.
    next.status = 'queued'; next.attempts = Math.max(0, row.attempts - 1); next.notBefore = later(5_000)
  } else if (result === 'retry') {
    // The previous operation ended; a new operation id is required to send it again.
    if (row.attempts >= PROJECT_MEMORY_MAX_RETAIN_ATTEMPTS) next.status = 'failed'
    else { next.status = 'queued'; next.operationId = randomUUID(); next.notBefore = later(60_000 * row.attempts) }
  } else {
    // An unknown outcome is polled again; it is never resent blindly.
    next.notBefore = later(30_000)
  }
  writeDocument(db, next)
}
/** The user forgot a document: stop using it locally now and remove it from Hindsight next. */
export function forgetProjectMemoryDocument(db: Database, projectId: string, id: string, now: string): ProjectMemoryDocument {
  const row = rows<ProjectMemoryDocument>(db, 'select json from project_memory_documents where id = ? and project_id = ?', [id, projectId])[0]
  if (!row) throw new Error('Memory document not found')
  if (row.status === 'deleted' || row.status === 'delete_pending') return row
  const { leaseToken: _lease, leaseUntil: _until, ...rest } = row
  const next: ProjectMemoryDocument = { ...rest, status: 'delete_pending', payload: '', notBefore: now, updatedAt: now }
  writeDocument(db, next)
  return next
}
const MAX_CHANGED_MEMORIES = 2_000
/**
 * The user edited or deleted one memory in Hindsight. Receipts that sent it earlier become stale.
 * Past the bound, everything recalled so far is treated as stale instead. This is not a
 * configuration change, so in-flight captures stay valid.
 */
export function markProjectMemoryChanged(db: Database, projectId: string, memoryId: string, now: string): ProjectMemoryConfiguration {
  const config = getProjectMemoryConfiguration(db, projectId)
  if (!config) throw new Error('Project memory is not configured')
  const changed = { ...(config.changedMemories ?? {}), [memoryId]: now }
  const next: ProjectMemoryConfiguration = Object.keys(changed).length > MAX_CHANGED_MEMORIES
    ? { ...config, changedMemories: {}, clearedAt: now } : { ...config, changedMemories: changed }
  writeConfiguration(db, next)
  return next
}
/**
 * Forget everything learned so far: later memory goes to a new, empty bank and the old bank is
 * queued for deletion. Every source sent so far stays forgotten in the new bank too, so
 * continuing an old conversation does not bring its history back.
 */
export function clearProjectMemory(db: Database, projectId: string, now: string): ProjectMemoryConfiguration {
  const config = getProjectMemoryConfiguration(db, projectId)
  if (!config) throw new Error('Project memory is not configured')
  const generation = (config.generation ?? 0) + 1
  const bankId = projectMemoryBankId(projectId, config.ownerUserId, generation)
  for (const row of listProjectMemoryDocuments(db, projectId).filter((item) => item.bankId === config.bankId)) {
    const { leaseToken: _lease, leaseUntil: _until, lastError: _error, retainedAt: _retained, ...rest } = row
    writeDocument(db, { ...rest, status: 'deleted', payload: '', updatedAt: now })
    writeDocument(db, { ...rest, id: randomUUID(), bankId, status: 'deleted', payload: '', operationId: randomUUID(),
      attempts: 0, notBefore: now, createdAt: now, updatedAt: now })
  }
  const next: ProjectMemoryConfiguration = { ...config, generation, bankId, clearedAt: now,
    pendingBankDeletions: [...new Set([...(config.pendingBankDeletions ?? []), config.bankId])], updatedAt: now }
  delete next.changedMemories
  writeConfiguration(db, next)
  return next
}
export function completeProjectMemoryBankDeletion(db: Database, projectId: string, bankId: string): void {
  const config = getProjectMemoryConfiguration(db, projectId)
  if (!config?.pendingBankDeletions?.includes(bankId)) return
  const pending = config.pendingBankDeletions.filter((item) => item !== bankId)
  const next: ProjectMemoryConfiguration = { ...config }
  if (pending.length) next.pendingBankDeletions = pending
  else delete next.pendingBankDeletions
  writeConfiguration(db, next)
}
export function recoverProjectMemoryDocuments(db: Database): void {
  for (const row of listProjectMemoryDocuments(db).filter((item) => item.leaseToken)) {
    const { leaseToken: _lease, leaseUntil: _until, ...rest } = row
    // A crash after claiming may have sent the retain; poll it instead of sending it again.
    writeDocument(db, { ...rest, notBefore: '' })
  }
}
