import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createWorkflowRunFromRequest, type CodingAgentRun, type TestEvidence } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { confirmTestEvidence } from './test-evidence-confirmation'
import { createWorkspaceOperationCoordinator } from './workspace-operation-coordinator'
import { assertDeliveryTestEvidenceCurrent } from './delivery-test-freshness'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'evidence-confirm-')); dirs.push(dir)
  const store = await createLocalStore({ dbPath: path.join(dir, 'state.db') })
  const now = '2026-11-02T10:00:00.000Z'
  await store.upsertProject({ id: 'p', name: 'p', path: dir, packageManager: 'npm', testCommand: 'node --test', createdAt: now, updatedAt: now })
  const created = createWorkflowRunFromRequest({ runId: 'r', title: 'test', request: 'test', projectId: 'p', creatorId: 'u', branchName: 'ai/test', now })
  const build = created.run.nodes.find(n => n.stage === 'build')!, test = created.run.nodes.find(n => n.stage === 'test')!
  const run = { ...created.run, status: 'testing' as const, currentNodeId: test.id, nodes: created.run.nodes.map(n => ({ ...n, status: n.stage === 'test' ? 'running' as const : ['clarify', 'design', 'build'].includes(n.stage) ? 'success' as const : n.status })) }
  await store.saveRun(run)
  const coding: CodingAgentRun = { id: 'coding', runId: run.id, nodeId: build.id, projectId: 'p', requestedBy: 'u', providerId: 'fake', engine: 'native', status: 'completed', branchName: 'ai/test', userInstruction: 'test', prompt: 'test', summary: 'done', changedPaths: [], startedAt: now, completedAt: now, testEvidenceId: 'e', redacted: true }
  await store.saveCodingAgentRun(coding)
  const evidence: TestEvidence = { id: 'e', runId: 'r', nodeId: build.id, projectId: 'p', command: 'node --test', cwd: dir, status: 'passed', exitCode: 0, durationMs: 100, stdout: '# tests 1\n# pass 1\n# fail 0', stderr: '', summary: 'passed', redacted: true, createdAt: now, sourceTree: { digest: 'a'.repeat(64) } }
  await store.saveTestEvidence(evidence)
  return { store, run, evidence, input: { runId: run.id, nodeId: test.id, evidenceId: evidence.id, expectedRunUpdatedAt: now }, coordinator: createWorkspaceOperationCoordinator() }
}
it('confirms a build result atomically as explicit reuse without executing the command again', async () => {
  const f = await fixture()
  const result = await confirmTestEvidence(f.input, { ...f, now: () => '2026-11-02T10:01:00.000Z', freshness: async () => [{ evidenceId: 'e', state: 'current' }] })
  expect(result.run.nodes.find(n => n.id === f.input.nodeId)?.status).toBe('success')
  expect(result.evidence.reusedFrom).toMatchObject({ evidenceId: 'e', codingRunId: 'coding' })
  expect(result.evidence.stdout).toBe(f.evidence.stdout)
  expect((await f.store.listTestEvidence('r'))).toHaveLength(2)
  expect((await f.store.listArtifacts('r'))[0]?.content).toContain('Reused:')
  await expect(confirmTestEvidence(f.input, { ...f })).rejects.toThrow('workflow_changed')
  await expect(assertDeliveryTestEvidenceCurrent(f.store, { runId: 'r' }, async () => [{ evidenceId: result.evidence.id, state: 'stale' }])).rejects.toThrow('撤销这些改动')
})
it.each(['stale', 'unavailable', 'unrecorded'] as const)('refuses %s evidence without storing a report or advancing', async state => {
  const f = await fixture()
  await expect(confirmTestEvidence(f.input, { ...f, freshness: async () => [{ evidenceId: 'e', state }] })).rejects.toThrow(state === 'stale' ? 'test_evidence_stale' : 'test_evidence_unverifiable')
  expect(await f.store.getRun('r')).toEqual(f.run)
  expect(await f.store.listTestEvidence('r')).toHaveLength(1)
  expect(await f.store.listArtifacts('r')).toHaveLength(0)
})
it('rejects a newer failed report instead of confirming the earlier pass', async () => {
  const f = await fixture()
  await f.store.saveTestEvidence({ ...f.evidence, id: 'failed', nodeId: f.input.nodeId, createdAt: '2026-11-02T10:00:01.000Z', status: 'failed', exitCode: 1 })
  await expect(confirmTestEvidence(f.input, { ...f })).rejects.toThrow('test_evidence_not_latest')
})
