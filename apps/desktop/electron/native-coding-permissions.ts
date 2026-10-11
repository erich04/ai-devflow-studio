import { codingDigest } from './coding-candidate-workspace'
import { mutateNativeCodingSession, type NativeCodingSession } from './native-coding-session'
import type { LocalStore } from './local-store'

export type CodingOperationPermission = { id: string; operationId: string; objectiveVersion: number; kind: 'command' | 'dependencies' | 'network' | 'mcp'; digest: string; details: string; decision: 'pending' | 'approved' | 'rejected'; expiresAt: string }
export class CodingPermissionWait extends Error { constructor() { super('Waiting for human authorization') } }
/** Durable task-scoped grants, separate from clarification and final ChangeSet approval. */
export async function requireCodingPermission(store: Pick<LocalStore, 'getNativeCodingSession' | 'saveNativeCodingSession'>, sessionId: string, operation: { id: string; kind: CodingOperationPermission['kind']; value: unknown; details: string }): Promise<void> {
  const digest = codingDigest(JSON.stringify({ kind: operation.kind, value: operation.value }))
  const session = await store.getNativeCodingSession(sessionId)
  if (!session) throw new Error('Coding session not found')
  const existing = session.permissions.filter(permission => permission.digest === digest && permission.objectiveVersion === session.objectiveVersion && Date.parse(permission.expiresAt) > Date.now()).at(-1)
  if (existing?.decision === 'approved') return
  if (existing?.decision === 'rejected') throw new Error('Human rejected this operation; choose another approach')
  await mutateNativeCodingSession(store, sessionId, draft => {
    if (draft.objectiveVersion !== session.objectiveVersion || draft.status !== 'running') throw new Error('Permission request was superseded')
    if (!draft.permissions.some(permission => permission.id === existing?.id)) draft.permissions.push({ id: `permission-${codingDigest(`${sessionId}:${operation.id}:${digest}:${draft.permissions.length}`)}`, operationId: operation.id, objectiveVersion: draft.objectiveVersion, kind: operation.kind, digest, details: operation.details, decision: 'pending', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })
    draft.status = 'waiting_permission'
  })
  throw new CodingPermissionWait()
}
export function pendingCodingPermission(session: NativeCodingSession) { return session.permissions.filter(permission => permission.decision === 'pending' && permission.objectiveVersion === session.objectiveVersion).at(-1) }
