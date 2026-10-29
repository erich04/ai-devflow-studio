import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectTestEvidence } from './devflow-b-test-evidence.mjs'

function fixture() {
  const ready = { runId: 'workflow', projectId: 'project', repo: '/isolated/todo' }
  const workspace = { id: 'workspace', codingRunId: 'coding', projectId: ready.projectId, sourcePath: ready.repo, worktreePath: '/isolated/worktree' }
  const coding = { id: 'coding', managedWorkspaceId: workspace.id, projectId: ready.projectId, runId: ready.runId, nodeId: 'build', testEvidenceId: 'host-test' }
  const evidence = { id: 'host-test', runId: ready.runId, projectId: ready.projectId, nodeId: 'build', cwd: '<workspace>', status: 'passed',
    sourceTree: { workspaceId: workspace.id, digest: 'actual-disk-digest' } }
  const input = { ready, state: { run: { nodes: [{ id: 'build', kind: 'task' }, { id: 'test', kind: 'test' }] }, workspaces: [workspace], codingRuns: [coding] },
    worktrees: [{ id: workspace.id, codingRunId: coding.id, path: workspace.worktreePath, sourceTreeDigest: 'actual-disk-digest' }], source: { path: ready.repo, sourceTreeDigest: 'source-digest' } }
  return { evidence, input }
}

test('redacted cwd has no literal path assertion; owned matching disk digest establishes binding', () => {
  const { evidence, input } = fixture(), result = inspectTestEvidence(evidence, input)
  assert.equal(result.cwdMatchesDisk, null)
  assert.equal(result.cwdRepresentation, 'redacted_workspace')
  assert.equal(result.workspaceBindingVerified, true)
  assert.equal(result.codingHostStandardTest, true)
  assert.equal(result.canonicalWorkflowTest, false)
  evidence.id = 'workflow-test'; evidence.nodeId = 'test'
  const workflow = inspectTestEvidence(evidence, input)
  assert.equal(workflow.canonicalWorkflowTest, true)
  assert.equal(workflow.codingHostStandardTest, false)
  assert.equal(workflow.workspaceBindingVerified, true)
})

test('foreign run/project/workspace or changed source never verifies binding', () => {
  const mutations = [
    ({ evidence }) => { evidence.runId = 'foreign' },
    ({ evidence }) => { evidence.projectId = 'foreign' },
    ({ input }) => { input.state.workspaces[0].sourcePath = '/foreign/repo' },
    ({ input }) => { input.state.codingRuns[0].managedWorkspaceId = 'foreign' },
    ({ input }) => { input.worktrees[0].codingRunId = 'foreign' },
    ({ evidence }) => { evidence.sourceTree.digest = 'stale-digest' },
  ]
  for (const mutate of mutations) {
    const data = fixture(); mutate(data)
    assert.equal(inspectTestEvidence(data.evidence, data.input).workspaceBindingVerified, false)
  }
})

test('missing digest or workspace remains unknown instead of turning redaction into proof', () => {
  const { evidence, input } = fixture(); delete evidence.sourceTree.digest
  assert.equal(inspectTestEvidence(evidence, input).workspaceBindingVerified, null)
  assert.equal(inspectTestEvidence(evidence, input).sourceDigestMatchesDisk, null)
  delete evidence.sourceTree.workspaceId
  assert.equal(inspectTestEvidence(evidence, input).workspaceOwnershipMatches, null)
  assert.equal(inspectTestEvidence(evidence, input).workspaceBindingVerified, null)
})

test('literal paths are compared independently and a wrong path invalidates the binding', () => {
  const { evidence, input } = fixture(); evidence.cwd = '/isolated/worktree'
  assert.equal(inspectTestEvidence(evidence, input).cwdMatchesDisk, true)
  evidence.cwd = '/other/worktree'
  const result = inspectTestEvidence(evidence, input)
  assert.equal(result.cwdMatchesDisk, false)
  assert.equal(result.workspaceBindingVerified, false)
})
