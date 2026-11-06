import { runs } from './fixtures'
import type { TestEvidence } from './domain'
import { expect, it } from 'vitest'
import type { CodingAgentRun, CodingChangeSet, CodingPermissionRequest } from './domain'
import { numberCodingChangeVersions, summarizeRunBuildTestMaterials } from './coding-change-versions'
it('numbers acknowledged proposals across attempts and skips orphaned change sets', () => {
  const changes = ['first', 'orphan', 'revision', 'repair'].map((id, i) => ({ id, codingRunId: 'run', phase: id === 'repair' ? 'repair' : 'initial', createdAt: `2026-10-31T00:0${i}:00.000Z` })) as CodingChangeSet[]
  const requests = ['first', 'revision', 'repair'].map(changeSetId => ({ changeSetId, codingRunId: 'run' })) as CodingPermissionRequest[]
  const versions = numberCodingChangeVersions({ codingRuns: [{ id: 'run' }] as CodingAgentRun[], changeSets: changes, acceptanceDiffs: [], permissionRequests: requests })
  expect([...versions.entries()]).toEqual([['first', { number: 1, label: '改动 v1', repair: false }], ['revision', { number: 2, label: '改动 v2', repair: false }], ['repair', { number: 3, label: '改动 v3（修复）', repair: true }]])
})

it('keeps the first failed report attached to the approved initial version while repair waits', () => {
  const run = runs[0]!
  const coding = { id: 'coding', runId: run.id, projectId: run.projectId, nodeId: 'n-build', status: 'waiting_permission', changeSetId: 'repair', startedAt: '2026-10-31T00:00:00.000Z' } as CodingAgentRun
  const changes = [{ id: 'initial', codingRunId: coding.id, phase: 'initial', createdAt: coding.startedAt }, { id: 'repair', codingRunId: coding.id, phase: 'repair', createdAt: '2026-10-31T00:05:00.000Z' }] as CodingChangeSet[]
  const requests = changes.map((c, i) => ({ id: `p${i}`, codingRunId: coding.id, changeSetId: c.id, status: i ? 'pending' : 'approved' })) as CodingPermissionRequest[]
  const failed = { id: 'failed', runId: run.id, projectId: run.projectId, nodeId: 'n-build', status: 'failed', createdAt: '2026-10-31T00:03:00.000Z' } as TestEvidence
  const input = { run, codingRuns: [coding], changeSets: changes, acceptanceDiffs: [], permissionRequests: requests, testEvidence: [failed], workspaces: [], codingEvents: [] }
  expect(summarizeRunBuildTestMaterials(input).test?.latest).not.toHaveProperty('forLabel')
  expect(summarizeRunBuildTestMaterials({ ...input, permissionDecisions: [{ id: 'd', requestId: 'p0', codingRunId: coding.id, decision: 'approved', decidedBy: 'u', comment: '', decidedAt: '2026-10-31T00:01:00.000Z' }] }).test?.latest.forLabel).toBe('改动 v1')
})
