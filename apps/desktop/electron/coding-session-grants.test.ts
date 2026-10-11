import { describe, expect, it } from 'vitest'
import type { CodingPermissionRequest } from '@ai-devflow/shared'
import { CodingSessionGrants } from './coding-session-grants.js'

const request: CodingPermissionRequest = {
  id: 'p1', codingRunId: 'coding-1', runId: 'run-1', nodeId: 'build',
  permission: 'patch', filePaths: ['src/a.ts', 'src/b.ts'], origin: 'coding_executor',
  title: 'Patch', risk: 'warn', reasons: [], status: 'pending',
  requestedAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-10T00:10:00Z',
}
const context = { key: 'org/project/user/session/worktree/policy-v1', actorId: 'u1', active: true }

describe('Coding session grants', () => {
  it('matches the explicit paths and tool family only, never another scope or denial', () => {
    const grants = new CodingSessionGrants()
    const grant = grants.create(request, context, request.requestedAt)
    expect(grants.match({ ...request, id: 'p2', filePaths: ['src/b.ts'], permission: 'edit' }, context, request.requestedAt)?.id).toBe(grant.id)
    for (const changed of [
      { filePaths: ['src/other.ts'] }, { filePaths: ['src/b.ts', '../outside'] },
      { risk: 'blocked' as const }, { origin: 'change_acceptance' as const },
      { codingRunId: 'another' }, { status: 'approved' as const },
      { permission: 'bash' as const, command: 'npm test' },
    ]) expect(grants.match({ ...request, ...changed }, context, request.requestedAt)).toBeUndefined()
    expect(grants.match(request, { ...context, key: 'other-project' }, request.requestedAt)).toBeUndefined()
    expect(grants.match(request, { ...context, actorId: 'other-user' }, request.requestedAt)).toBeUndefined()
  })
  it('allows only the exact command, and does not infer shell prefix permissions', () => {
    const grants = new CodingSessionGrants()
    const command = { ...request, permission: 'bash' as const, command: 'npm test' }
    grants.create(command, context, request.requestedAt)
    expect(grants.match({ ...command, id: 'next' }, context, request.requestedAt)).toBeDefined()
    expect(grants.match({ ...command, command: 'npm test && curl example.com' }, context, request.requestedAt)).toBeUndefined()
    expect(() => grants.create({ ...command, origin: 'execution_authorization' }, context, request.requestedAt)).toThrow()
  })
  it('expires, revokes, ends with the run, and cannot survive an application restart', () => {
    const grants = new CodingSessionGrants()
    const grant = grants.create(request, context, request.requestedAt)
    expect(new CodingSessionGrants().list(request.codingRunId)).toEqual([])
    expect(grants.match(request, context, '2026-10-10T02:00:01Z')).toBeUndefined()
    grants.revoke(grant.id, context.actorId, '2026-10-10T00:01:00Z')
    expect(grants.match(request, context, '2026-10-10T00:01:01Z')).toBeUndefined()
    const next = grants.create(request, context, request.requestedAt)
    expect(grants.match(request, { ...context, active: false }, request.requestedAt)).toBeUndefined()
    expect(grants.revoke(next.id, 'another-user', request.requestedAt)).toBe(false)
  })
})
