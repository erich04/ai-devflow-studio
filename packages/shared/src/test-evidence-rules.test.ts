import { expect, it } from 'vitest'
import { runs } from './fixtures'
import type { CodingAgentRun, TestEvidence } from './domain'
import { latestConfirmingTestEvidence, listTaskTestReports, selectGoverningTestEvidence, testEvidenceFreshnessRule } from './test-evidence-rules'
import { createTestEvidenceArtifact } from './local-execution'
const run = runs[0]!
const evidence = (id: string, overrides: Partial<TestEvidence> = {}): TestEvidence => ({ id, runId: run.id, nodeId: 'n-test', projectId: run.projectId, command: 'node --test', cwd: '', status: 'passed', exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '', summary: 'passed', redacted: true, createdAt: '2026-10-31T00:00:00.000Z', ...overrides })
const coding: CodingAgentRun = { id: 'coding', runId: run.id, nodeId: 'n-build', projectId: run.projectId, requestedBy: 'u', providerId: 'p', engine: 'native', status: 'completed', branchName: 'task', userInstruction: '', prompt: '', summary: '', changedPaths: [], startedAt: '2026-10-30T00:00:00.000Z', completedAt: '2026-11-01T00:00:00.000Z', redacted: true, testEvidenceId: 'build' }
it('numbers genuine test executions only and associates the coding evidence', () => {
  const testEvidence = [evidence('build', { nodeId: 'n-build' }), evidence('reuse', { reusedFrom: { evidenceId: 'build', codingRunId: 'coding', verifiedAt: 'now' } }), evidence('delivery', { sourceCommitSha: 'sha' })]
  const reports = listTaskTestReports({ run, testEvidence, codingRuns: [coding] })
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({ evidence: { id: 'build' }, codingRunId: 'coding', label: '第 1 次测试报告' })
  expect(selectGoverningTestEvidence({ run, testEvidence, codingRuns: [coding] })?.id).toBe('build')
})
it('does not confirm a passing earlier attempt after a newer completed attempt', () => {
  const testEvidence = [evidence('build', { nodeId: 'n-build' })]
  expect(selectGoverningTestEvidence({ run, testEvidence, codingRuns: [coding, { ...coding, id: 'newer', startedAt: '2026-11-01T01:00:00.000Z', completedAt: '2026-11-01T02:00:00.000Z', testEvidenceId: 'missing' }] })).toBeUndefined()
})
it('only a passed report attached to the finished test node governs delivery', () => {
  const confirmed = evidence('confirmed'), unconfirmed = evidence('newer', { createdAt: '2026-11-01T00:00:00.000Z' })
  const finished = { ...run, nodes: run.nodes.map(n => n.id === 'n-test' ? { ...n, status: 'success' as const, artifactIds: ['artifact-confirmed'] } : n) }
  expect(latestConfirmingTestEvidence({ run: finished, testEvidence: [confirmed, unconfirmed], artifacts: [createTestEvidenceArtifact(confirmed)] })?.id).toBe('confirmed')
  expect(latestConfirmingTestEvidence({ run, testEvidence: [confirmed], artifacts: [createTestEvidenceArtifact(confirmed)] })).toBeUndefined()
})
it('fails closed for every freshness result other than current', () => {
  expect(testEvidenceFreshnessRule('current')).toEqual({ blocks: false })
  for (const state of ['stale', 'unavailable', 'unrecorded'] as const) expect(testEvidenceFreshnessRule(state).blocks).toBe(true)
})
it('identifies reused results as reused in the artifact and its summary', () => {
  const artifact = createTestEvidenceArtifact(evidence('reused', { reusedFrom: { evidenceId: 'build', codingRunId: 'coding', verifiedAt: '2026-11-01T00:00:00.000Z' } }))
  expect(artifact.summary).toMatch(/^Reused:/u)
  expect(artifact.content).toMatch(/^Reused: passing build test evidence build;/u)
})
