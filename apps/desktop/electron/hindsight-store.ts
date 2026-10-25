import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'sql.js'
import { parseKnowledgeModel, redactSensitiveText, type DesktopPairingCredential, type KnowledgeModelDefinition } from '@ai-devflow/shared'
import { normalizeHindsightEndpoint } from './hindsight-client'

export const hindsightDigest = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`
export type HindsightConfigurationInput = {
  projectId: string; ownerUserId: string; projectPath: string; knowledgeRoot: string; rootGeneration: string
  endpoint: string; encryptedApiKey: string | null; enabled: boolean; includeMemories: boolean
  selectedPaths: string[]; model: KnowledgeModelDefinition; modelDigest: string
  pairingBinding?: HindsightPairingBinding
}
export type HindsightPairingBinding = Pick<DesktopPairingCredential,
  'organizationId' | 'projectId' | 'userId' | 'authAccountId'> & { localProjectId: string }
export function hindsightPairingBinding(pairing: DesktopPairingCredential): HindsightPairingBinding {
  if (!pairing.localProjectId) throw new Error('Hindsight paired project is missing')
  return { organizationId: pairing.organizationId, projectId: pairing.projectId,
    localProjectId: pairing.localProjectId, userId: pairing.userId, authAccountId: pairing.authAccountId }
}
export function hindsightPairingMatches(config: HindsightConfigurationInput, pairing: DesktopPairingCredential | null): boolean {
  if (pairing?.localProjectId !== config.projectId) return !config.pairingBinding
  if (!config.pairingBinding || config.includeMemories || pairing.userId !== config.ownerUserId) return false
  if (pairing.expiresAt && (!Number.isFinite(Date.parse(pairing.expiresAt)) || Date.parse(pairing.expiresAt) <= Date.now())) return false
  const current = hindsightPairingBinding(pairing)
  return Object.entries(current).every(([key, value]) => config.pairingBinding?.[key as keyof HindsightPairingBinding] === value)
}
export type HindsightConfiguration = HindsightConfigurationInput & {
  generation: string; knowledgeBank: string; memoryBank: string
}
export type HindsightSourceInput = {
  kind: 'knowledge' | 'memory'; sourceKey: string; sourceId: string; sourceRevision: string; contentDigest: string
  sourcePath?: string; memoryId?: string; memoryRevision?: number; expiresAt?: string | null; payload: string
}
export type HindsightProjection = HindsightSourceInput & {
  id: string; projectId: string; ownerUserId: string; configGeneration: string; bankId: string
  documentId: string; operationId: string; payloadDigest: string; metadata: Record<string, string>
  status: 'queued' | 'submitted' | 'ready' | 'unknown' | 'cleanup_pending' | 'cancelled'
  revoked: boolean; cleanupReason?: string; attempts: number; leaseToken?: string; leaseUntil?: string
  nextAttemptAt: string; lastError?: string
}
export type HindsightClaim = { record: HindsightProjection; config: HindsightConfiguration; leaseToken: string; canSubmit: boolean }
export type HindsightSettlement = 'ready' | 'pending' | 'unknown' | 'removed' | 'retry' | 'not_sent'

function rows<T>(db: Database, table: string, where = '', values: string[] = []): T[] {
  return (db.exec(`select json from ${table} ${where}`, values)[0]?.values ?? []).map((r) => JSON.parse(String(r[0])) as T)
}
function writeProjection(db: Database, row: HindsightProjection) {
  db.run('insert into hindsight_projections(id, project_id, json) values(?,?,?) on conflict(id) do update set json=excluded.json',
    [row.id, row.projectId, JSON.stringify(row)])
}
export function listHindsightConfigurations(db: Database) {
  return rows<HindsightConfiguration>(db, 'hindsight_configurations', 'order by rowid')
}
export function getHindsightConfiguration(db: Database, projectId: string) {
  return rows<HindsightConfiguration>(db, 'hindsight_configurations', 'where project_id = ? order by rowid desc limit 1', [projectId])[0] ?? null
}
export function listHindsightProjections(db: Database, projectId?: string) {
  return rows<HindsightProjection>(db, 'hindsight_projections', projectId ? 'where project_id = ? order by rowid' : 'order by rowid', projectId ? [projectId] : [])
}
function revoke(db: Database, record: HindsightProjection, reason: string) {
  if (record.revoked) return
  writeProjection(db, { ...record, revoked: true, cleanupReason: reason, payload: '',
    status: record.attempts > 0 ? 'cleanup_pending' : 'cancelled', nextAttemptAt: '' })
}
export function revokeHindsightSource(db: Database, generation: string, sourceKey: string, reason: string) {
  for (const row of listHindsightProjections(db).filter((r) => r.configGeneration === generation && r.sourceKey === sourceKey)) revoke(db, row, reason)
}
export function disableHindsightProject(db: Database, projectId: string, reason: string) {
  for (const config of listHindsightConfigurations(db).filter((c) => c.projectId === projectId && c.enabled)) {
    db.run('update hindsight_configurations set json=? where generation=?', [JSON.stringify({ ...config, enabled: false }), config.generation])
  }
  for (const row of listHindsightProjections(db, projectId)) revoke(db, row, reason)
}
export function configureHindsight(db: Database, input: HindsightConfigurationInput): HindsightConfiguration {
  if (!input.ownerUserId || input.selectedPaths.length > 20 || new Set(input.selectedPaths).size !== input.selectedPaths.length) throw new Error('Invalid Hindsight scope')
  if (!db.exec('select id from local_projects where id=?', [input.projectId])[0]?.values.length) throw new Error('Hindsight project is missing')
  const pairingJson = db.exec("select json from desktop_pairing_credentials where id='default'")[0]?.values[0]?.[0]
  const pairing = pairingJson ? JSON.parse(String(pairingJson)) as DesktopPairingCredential : null
  if (input.enabled && !hindsightPairingMatches(input, pairing)) throw new Error('Hindsight requires an unpaired local project or fresh paired private knowledge consent')
  const endpoint = normalizeHindsightEndpoint(input.endpoint)
  const model = parseKnowledgeModel(input.model)
  disableHindsightProject(db, input.projectId, input.enabled ? 'configuration_changed' : 'disabled')
  const generation = randomUUID()
  const config = { ...input, endpoint, model, generation, knowledgeBank: `df-k-${generation}`, memoryBank: `df-m-${generation}` }
  db.run('insert into hindsight_configurations(generation,project_id,json) values(?,?,?)', [generation, input.projectId, JSON.stringify(config)])
  return config
}
export function reconcileHindsightSource(db: Database, generation: string, source: HindsightSourceInput) {
  const config = listHindsightConfigurations(db).find((c) => c.generation === generation)
  if (!config?.enabled) return
  if (source.kind === 'knowledge' ? !source.sourcePath || !config.selectedPaths.includes(source.sourcePath) : !config.includeMemories) throw new Error('Hindsight source is outside selection')
  if (Buffer.byteLength(source.payload) > 256 * 1024) throw new Error('Hindsight source exceeds limit')
  const payload = redactSensitiveText(source.payload).value
  const payloadDigest = hindsightDigest(payload)
  const existing = listHindsightProjections(db, config.projectId)
  const same = existing.find((r) => !r.revoked && r.configGeneration === generation && r.sourceKey === source.sourceKey &&
    r.sourceRevision === source.sourceRevision && r.contentDigest === source.contentDigest && r.payloadDigest === payloadDigest)
  if (same) return
  for (const row of existing.filter((r) => !r.revoked && r.sourceKey === source.sourceKey)) revoke(db, row, 'source_changed')
  const id = randomUUID()
  const metadata = { df_source: source.sourceId, df_revision: source.sourceRevision, df_digest: source.contentDigest,
    df_kind: source.kind, df_generation: generation, df_model: config.modelDigest, df_redaction: '1', df_payload: payloadDigest }
  writeProjection(db, { ...source, payload, id, projectId: config.projectId, ownerUserId: config.ownerUserId,
    configGeneration: generation, bankId: source.kind === 'knowledge' ? config.knowledgeBank : config.memoryBank,
    documentId: `df-${id}`, operationId: randomUUID(), metadata, payloadDigest,
    status: 'queued', revoked: false, attempts: 0, nextAttemptAt: '' })
}
export function claimHindsightProjection(db: Database, now: string): HindsightClaim | null {
  const all = listHindsightProjections(db)
  const configs = listHindsightConfigurations(db)
  // Old pending cleanup must not starve unrelated sources.
  for (const row of [...all].sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))) {
    const config = configs.find((c) => c.generation === row.configGeneration)
    if (!config || row.status === 'ready' || row.status === 'cancelled' || (row.leaseUntil && row.leaseUntil > now) || row.nextAttemptAt > now) continue
    if (!row.revoked && (!config.enabled || all.some((other) => other.id !== row.id && other.projectId === row.projectId &&
        other.sourceKey === row.sourceKey && other.status === 'cleanup_pending'))) continue
    const leaseToken = randomUUID()
    const claimed = { ...row, leaseToken, leaseUntil: new Date(Date.parse(now) + 30_000).toISOString(),
      status: row.revoked ? 'cleanup_pending' as const : 'submitted' as const,
      // A persisted first claim precedes any network call; after a crash it must be reconciled.
      attempts: row.status === 'queued' ? row.attempts + 1 : row.attempts }
    writeProjection(db, claimed)
    return { record: claimed, config, leaseToken, canSubmit: row.status === 'queued' }
  }
  return null
}
export function settleHindsightProjection(db: Database, id: string, leaseToken: string, result: HindsightSettlement, now: string, error?: string) {
  const row = listHindsightProjections(db).find((r) => r.id === id)
  if (!row || row.leaseToken !== leaseToken) return
  const { leaseToken: _token, leaseUntil: _until, ...next } = row
  next.nextAttemptAt = new Date(Date.parse(now) + (result === 'unknown' ? 30_000 : 1_000)).toISOString()
  if (error) next.lastError = error
  else delete next.lastError
  if (result === 'not_sent' && row.attempts === 1) {
    next.attempts = 0
    next.status = row.revoked ? 'cancelled' : 'queued'
    next.nextAttemptAt = new Date(Date.parse(now) + 30_000).toISOString()
  }
  else if (row.revoked) next.status = result === 'removed' ? 'cancelled' : 'cleanup_pending'
  else if (result === 'ready') next.status = 'ready'
  else if (result === 'retry' && row.attempts < 3) next.status = 'queued'
  else next.status = result === 'pending' ? 'submitted' : 'unknown'
  writeProjection(db, next)
}
export function recoverHindsightProjections(db: Database) {
  for (const row of listHindsightProjections(db)) {
    if (!row.leaseToken) continue
    const { leaseToken: _token, leaseUntil: _until, ...rest } = row
    writeProjection(db, { ...rest, status: row.revoked ? 'cleanup_pending' : 'unknown', nextAttemptAt: '' })
  }
}
