import { describe, expect, it } from 'vitest'
import { sanitizeCodingDiffArtifact, type CodingAgentRun, type LocalProject, type TestEvidence } from '@ai-devflow/shared'
import { runs } from '@ai-devflow/shared/fixtures'
import { evaluateCurrentWorkflowEvidence } from './workflow-evaluation'

function fixture() {
  const run = runs[0]!
  const node = run.nodes.find((candidate) => candidate.stage === 'build' && candidate.kind === 'task')!
  const time = '2026-09-15T20:00:00.000Z'
  const project: LocalProject = {
    id: run.projectId, name: 'Evidence fixture', path: '/tmp/evidence-fixture',
    packageManager: 'npm', detectedTestCommand: 'npm test', testCommand: 'npm test',
    createdAt: time, updatedAt: time,
  }
  const coding: CodingAgentRun = {
    id: 'coding-evaluation', runId: run.id, nodeId: node.id, projectId: project.id,
    requestedBy: run.creatorId, providerId: 'deepseek', engine: 'native', status: 'completed',
    branchName: 'devflow/evaluation', userInstruction: run.request, prompt: 'Current task',
    summary: 'Completed implementation', changedPaths: ['src/message.ts'], startedAt: time,
    completedAt: time, diffArtifactId: 'diff-evaluation', testEvidenceId: 'test-evaluation', redacted: true,
  }
  const diff = sanitizeCodingDiffArtifact({
    id: coding.diffArtifactId!, runId: run.id, nodeId: node.id, projectId: project.id,
    changedPaths: ['src/message.ts'],
    patch: 'diff --git a/src/message.ts b/src/message.ts\n--- a/src/message.ts\n+++ b/src/message.ts\n@@ -1 +1 @@\n-old\n+new\n',
    createdAt: time,
  })
  const test: TestEvidence = {
    id: coding.testEvidenceId!, runId: run.id, nodeId: node.id, projectId: project.id,
    command: 'npm test', cwd: '<workspace>', status: 'passed', exitCode: 0, durationMs: 1,
    stdout: 'One test passed', stderr: '', summary: 'Passed', redacted: true, createdAt: time,
  }
  const tests = [test]
  const store: Parameters<typeof evaluateCurrentWorkflowEvidence>[0] = {
    getRun: async () => run,
    listProjects: async () => [project],
    listArtifacts: async () => [],
    listCodingAgentRuns: async () => [coding],
    listCodingDiffArtifacts: async () => [diff],
    listTestEvidence: async () => tests,
  }
  return { store, tests, coding, target: { runId: run.id, nodeId: node.id, localProjectId: project.id, runVersion: run.version } }
}

describe('current workflow evidence evaluation', () => {
  it('requires the exact recorded Coding test, even if a later unrelated saved test passed', async () => {
    const { store, tests, target } = fixture()
    tests.push({ ...tests[0]!, id: 'unrelated-later-test', createdAt: '2026-09-15T20:00:01.000Z' })
    tests[0] = { ...tests[0]!, status: 'failed', exitCode: 1 }
    expect(await evaluateCurrentWorkflowEvidence(store, target)).toMatchObject({
      passed: false, failures: expect.arrayContaining(['test_failed:coding_test']),
    })
  })

  it('rejects a later failed test and changes the evidence fingerprint', async () => {
    const { store, tests, target } = fixture()
    const before = await evaluateCurrentWorkflowEvidence(store, target)
    expect(before.passed).toBe(true)
    tests.push({ ...tests[0]!, id: 'later-failure', status: 'failed', exitCode: 1, createdAt: '2026-09-15T20:00:01.000Z' })
    const after = await evaluateCurrentWorkflowEvidence(store, target)
    expect(after).toMatchObject({ passed: false, failures: ['test_failed:latest_saved_test'] })
    expect(after.evidenceDigest).not.toBe(before.evidenceDigest)
  })

  it('does not accept matching test IDs from another node or a different Coding attempt', async () => {
    const { store, tests, target } = fixture()
    tests[0] = { ...tests[0]!, nodeId: 'another-node' }
    expect(await evaluateCurrentWorkflowEvidence(store, target)).toMatchObject({
      passed: false, failures: expect.arrayContaining(['insufficient_evidence:coding_test_provenance']),
    })
    expect(await evaluateCurrentWorkflowEvidence(store, { ...target, codingRunId: 'another-attempt' }))
      .toMatchObject({ passed: false, failures: expect.arrayContaining(['insufficient_evidence:completed_real_coding_run']) })
  })
})
