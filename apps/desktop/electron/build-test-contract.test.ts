import { expect, it } from 'vitest'
import { parseConfirmTestEvidence, parsePermissionExpected, parseReviseCodingChangeSet } from './build-test-contract'
import { parseReplyCodingPermissionInput, parseRunProjectTestsInput } from './ipc-contract'
const identity = { runId: 'run', nodeId: 'build', changeSetId: 'cs', changeSetDigest: 'a'.repeat(64), expiresAt: '2026-10-31T00:15:00.000Z' }
it('binds a new page reply to exactly one bounded version and expiry', () => {
  expect(parsePermissionExpected(identity)).toEqual(identity)
  for (const bad of [{ ...identity, runId: ' run' }, { ...identity, changeSetDigest: 'A'.repeat(64) }, { ...identity, expiresAt: '2026-10-31' }, { ...identity, diffArtifactId: 'diff', diffSourceDigest: 'b'.repeat(64) }, { ...identity, unexpected: true }]) expect(() => parsePermissionExpected(bad)).toThrow('[invalid_input]')
  expect(() => parseReplyCodingPermissionInput({ codingRunId: 'c', requestId: 'p', decidedBy: 'u', decision: 'approved', expected: identity, comment: 'x'.repeat(1001) })).toThrow()
  expect(() => parseReplyCodingPermissionInput({ codingRunId: 'c', requestId: 'p', decidedBy: 'u', decision: 'superseded' })).toThrow()
})
it('bounds revision inputs before any runtime work', () => {
  const value = { codingRunId: 'c', requestId: 'p', changeSetId: 'cs', changeSetDigest: 'a'.repeat(64), requestedBy: 'u', changeRequest: '补充检查', itemCount: 1 }
  expect(parseReviseCodingChangeSet(value)).toEqual(value)
  for (const bad of [{ ...value, itemCount: 0 }, { ...value, changeRequest: 'x'.repeat(4001) }, { ...value, changeRequest: '\0' }, { ...value, scope: 'session' }]) expect(() => parseReviseCodingChangeSet(bad)).toThrow()
})
it('requires exact run timestamp when confirming evidence and preserves legacy test behavior', () => {
  expect(parseConfirmTestEvidence({ runId: 'r', nodeId: 'n', evidenceId: 'e', expectedRunUpdatedAt: '2026-10-31T00:00:00.000Z' })).toMatchObject({ evidenceId: 'e' })
  expect(parseRunProjectTestsInput({ projectId: 'p', runId: 'r', nodeId: 'n', completeOnPass: false })).toMatchObject({ completeOnPass: false })
  expect(parseRunProjectTestsInput({ projectId: 'p', runId: 'r', nodeId: 'n' })).not.toHaveProperty('completeOnPass')
  expect(() => parseRunProjectTestsInput({ projectId: 'p', runId: 'r', nodeId: 'n', completeOnPass: 'false' })).toThrow()
})
