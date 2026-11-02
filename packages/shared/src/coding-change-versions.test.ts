import { expect, it } from 'vitest'
import type { CodingAgentRun, CodingChangeSet, CodingPermissionRequest } from './domain'
import { numberCodingChangeVersions } from './coding-change-versions'
it('numbers acknowledged proposals across attempts and skips orphaned change sets', () => {
  const changes = ['first', 'orphan', 'revision', 'repair'].map((id, i) => ({ id, codingRunId: 'run', phase: id === 'repair' ? 'repair' : 'initial', createdAt: `2026-10-31T00:0${i}:00.000Z` })) as CodingChangeSet[]
  const requests = ['first', 'revision', 'repair'].map(changeSetId => ({ changeSetId, codingRunId: 'run' })) as CodingPermissionRequest[]
  const versions = numberCodingChangeVersions({ codingRuns: [{ id: 'run' }] as CodingAgentRun[], changeSets: changes, acceptanceDiffs: [], permissionRequests: requests })
  expect([...versions.entries()]).toEqual([['first', { number: 1, label: '改动 v1', repair: false }], ['revision', { number: 2, label: '改动 v2', repair: false }], ['repair', { number: 3, label: '改动 v3（修复）', repair: true }]])
})
