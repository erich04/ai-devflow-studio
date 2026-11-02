import { codingDigest } from './coding-candidate-workspace'
import { mutateNativeCodingSession, type NativeCodingSession } from './native-coding-session'
import type { LocalStore } from './local-store'
import { decideCodingCommand } from '@ai-devflow/shared'

export type CodingOperationPermission = { id: string; operationId: string; objectiveVersion: number; kind: 'command' | 'dependencies' | 'network' | 'mcp'; digest: string; details: string; decision: 'pending' | 'approved' | 'rejected'; expiresAt: string; scope?: 'once' | 'task'; policyDigest?: string; source?: 'human' | 'rule' }
export class CodingPermissionWait extends Error { constructor() { super('Waiting for human authorization') } }
/** Durable task-scoped grants, separate from clarification and final ChangeSet approval. */
export async function requireCodingPermission(store: Pick<LocalStore, 'getNativeCodingSession' | 'saveNativeCodingSession'>, sessionId: string, operation: { id: string; kind: CodingOperationPermission['kind']; value: unknown; details: string; preapproved?: boolean }): Promise<void> {
  const digest = codingDigest(JSON.stringify({ kind: operation.kind, value: operation.value }))
  const session = await store.getNativeCodingSession(sessionId)
  if (!session) throw new Error('Coding session not found')
  if (session.status !== 'running') throw new Error('Coding permission is not active')
  const policy = session.binding?.permissionPolicy, policyDigest = policy ? codingDigest(JSON.stringify(policy)) : undefined
  const command = (operation.kind === 'command' ? operation.value : operation.kind === 'dependencies' ? (operation.value as { plan?: unknown })?.plan : undefined) as { executable?: unknown; args?: unknown } | undefined
  const isCommand = typeof command?.executable === 'string' && Array.isArray(command.args) && command.args.every(arg => typeof arg === 'string')
  const decision = policy && isCommand ? decideCodingCommand({ rules: policy.rules, mode: operation.preapproved ? 'ask' : policy.mode, sandboxed: session.binding!.profile.kind !== 'trusted_local', executable: command.executable as string, args: command.args as string[] }) : policy?.mode === 'unattended' ? 'deny' : 'ask'
  // Previously displayed test/install plans retain their exact initial grant;
  // explicit deny rules still take precedence over that grant.
  if (operation.preapproved && decision !== 'deny') return
  const existing = session.permissions.filter(permission => permission.digest === digest && permission.objectiveVersion === session.objectiveVersion && permission.policyDigest === policyDigest && Date.parse(permission.expiresAt) > Date.now() &&
    (permission.decision === 'rejected' || permission.operationId === operation.id || permission.scope === 'task' || (!policy && permission.scope === undefined))).at(-1)
  if (policy && decision !== 'ask') {
    if (decision === 'allow' && existing?.decision === 'rejected' && existing.source !== 'rule') throw new Error('Human rejected this operation; choose another approach')
    await mutateNativeCodingSession(store, sessionId, draft => {
      if (draft.objectiveVersion !== session.objectiveVersion || draft.status !== 'running' || codingDigest(JSON.stringify(draft.binding?.permissionPolicy)) !== policyDigest) throw new Error('Permission policy was superseded')
      if (!draft.permissions.some(p => p.operationId === operation.id && p.digest === digest && p.policyDigest === policyDigest)) draft.permissions.push({ id: `permission-${codingDigest(`${sessionId}:${operation.id}:${digest}:${draft.permissions.length}`)}`, operationId: operation.id, objectiveVersion: draft.objectiveVersion, kind: operation.kind, digest, details: operation.details, decision: decision === 'allow' ? 'approved' : 'rejected', expiresAt: draft.binding?.authorizationExpiresAt ?? new Date(Date.now() + 60 * 60_000).toISOString(), scope: 'once', source: 'rule', policyDigest: policyDigest! })
    })
    if (decision === 'deny') throw new Error('Permission rule denied this operation; choose another approach')
    return
  }
  if (existing?.decision === 'approved') return
  if (existing?.decision === 'rejected') throw new Error('Human rejected this operation; choose another approach')
  await mutateNativeCodingSession(store, sessionId, draft => {
    if (draft.objectiveVersion !== session.objectiveVersion || draft.status !== 'running' || (policy && codingDigest(JSON.stringify(draft.binding?.permissionPolicy)) !== policyDigest)) throw new Error('Permission request was superseded')
    if (!draft.permissions.some(permission => permission.id === existing?.id)) draft.permissions.push({ id: `permission-${codingDigest(`${sessionId}:${operation.id}:${digest}:${draft.permissions.length}`)}`, operationId: operation.id, objectiveVersion: draft.objectiveVersion, kind: operation.kind, digest, details: operation.details, decision: 'pending', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), ...(policy ? { scope: 'once', source: 'human', policyDigest: policyDigest! } : {}) })
    draft.status = 'waiting_permission'
  })
  throw new CodingPermissionWait()
}
export function pendingCodingPermission(session: NativeCodingSession) { return session.permissions.filter(permission => permission.decision === 'pending' && permission.objectiveVersion === session.objectiveVersion).at(-1) }
