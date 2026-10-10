import { randomUUID } from 'node:crypto'
import { codingSessionPermissionRule, type CodingPermissionRequest, type CodingSessionGrant } from '@ai-devflow/shared'

export type CodingGrantContext = { key: string; actorId: string; active: boolean }

/** Main-process lifetime only. Persisted audit records are deliberately not reusable authority. */
export class CodingSessionGrants {
  private readonly grants = new Map<string, CodingSessionGrant>()
  list(codingRunId: string): CodingSessionGrant[] {
    return [...this.grants.values()].filter((grant) => grant.codingRunId === codingRunId).map((grant) => structuredClone(grant))
  }
  create(request: CodingPermissionRequest, context: CodingGrantContext, now: string): CodingSessionGrant {
    const rule = codingSessionPermissionRule(request)
    if (!rule || !context.active || !context.actorId || !context.key || !Number.isFinite(Date.parse(now))) {
      throw new Error('This permission cannot be reused for the session.')
    }
    const grant: CodingSessionGrant = {
      id: `session-grant-${randomUUID()}`, codingRunId: request.codingRunId,
      actorId: context.actorId, scopeKey: context.key, rule, createdAt: now,
      expiresAt: new Date(Date.parse(now) + 2 * 60 * 60 * 1_000).toISOString(),
    }
    this.grants.set(grant.id, grant)
    return structuredClone(grant)
  }
  match(request: CodingPermissionRequest, context: CodingGrantContext, now: string): CodingSessionGrant | undefined {
    const rule = codingSessionPermissionRule(request)
    if (!rule || !context.active || !Number.isFinite(Date.parse(now)) || Date.parse(request.expiresAt) <= Date.parse(now)) return undefined
    return this.list(request.codingRunId).find((grant) => !grant.revokedAt &&
      grant.actorId === context.actorId && grant.scopeKey === context.key && Date.parse(grant.expiresAt) > Date.parse(now) &&
      (rule.kind === 'command'
        ? grant.rule.kind === 'command' && grant.rule.command === rule.command
        : grant.rule.kind === 'files' && rule.paths.every((path) => grant.rule.kind === 'files' && grant.rule.paths.includes(path))))
  }
  revoke(id: string, actorId: string, now: string): boolean {
    const grant = this.grants.get(id)
    if (!grant || grant.actorId !== actorId || grant.revokedAt) return false
    this.grants.set(id, { ...grant, revokedAt: now })
    return true
  }
}

const registries = new WeakMap<object, CodingSessionGrants>()
export function codingSessionGrantsForStore(store: object): CodingSessionGrants {
  let grants = registries.get(store)
  if (!grants) { grants = new CodingSessionGrants(); registries.set(store, grants) }
  return grants
}
