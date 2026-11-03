import { expect, it } from 'vitest'
import type { CodingPermissionRequest } from './domain'
import { codingSessionPermissionRule } from './coding-session-permissions'
it('never turns approval of an exact change set into a reusable path grant', () => {
  const request: CodingPermissionRequest = { id: 'p', codingRunId: 'c', runId: 'r', nodeId: 'n', origin: 'coding_executor', permission: 'patch', title: '改动', risk: 'warn', reasons: [], status: 'pending', requestedAt: '2026-10-31T00:00:00.000Z', expiresAt: '2026-10-31T00:15:00.000Z', filePaths: ['a.ts'], changeSetId: 'cs', changeSetDigest: 'a'.repeat(64) }
  expect(codingSessionPermissionRule(request)).toBeUndefined()
  const { changeSetId: _, changeSetDigest: __, ...tool } = request
  expect(codingSessionPermissionRule(tool)).toEqual({ kind: 'files', paths: ['a.ts'] })
})
