import type { Artifact, CodingAgentEvent, CodingAgentRun, ManagedCodingWorkspace, TestEvidence, TestEvidenceFreshness, WorkflowRun } from './domain'
export type TaskTestReportInput = { run: WorkflowRun; testEvidence: readonly TestEvidence[]; codingRuns: readonly CodingAgentRun[]; codingEvents?: readonly CodingAgentEvent[]; workspaces?: readonly ManagedCodingWorkspace[] }
export type TaskTestReport = { evidence: TestEvidence; number: number; label: string; codingRunId?: string }
export function isDeliveryTestEvidence(evidence: TestEvidence): boolean { return evidence.sourceCommitSha !== undefined }
export function listTaskTestReports(input: TaskTestReportInput): TaskTestReport[] {
  const nodeIds = new Set(input.run.nodes.filter(n => n.stage === 'build' || n.stage === 'test').map(n => n.id))
  const coding = input.codingRuns.filter(c => c.runId === input.run.id && c.projectId === input.run.projectId).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  return input.testEvidence.filter(e => e.runId === input.run.id && e.projectId === input.run.projectId && nodeIds.has(e.nodeId) && !isDeliveryTestEvidence(e) && !e.reusedFrom)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((evidence, index) => {
      let owner: CodingAgentRun | undefined
      if (input.run.nodes.find(n => n.id === evidence.nodeId)?.stage === 'build') {
        const event = input.codingEvents?.find(e => e.runId === input.run.id && e.metadata?.evidenceId === evidence.id)
        owner = coding.find(c => c.id === event?.codingRunId) ?? coding.find(c => c.testEvidenceId === evidence.id)
        if (!owner && evidence.sourceTree?.workspaceId) owner = coding.find(c => c.id === input.workspaces?.find(w => w.id === evidence.sourceTree?.workspaceId && w.projectId === evidence.projectId)?.codingRunId)
        owner ??= coding.filter(c => c.startedAt <= evidence.createdAt && (!c.completedAt || evidence.createdAt <= c.completedAt)).at(-1)
      }
      return { evidence, number: index + 1, label: `第 ${index + 1} 次测试报告`, ...(owner ? { codingRunId: owner.id } : {}) }
    })
}
export function selectGoverningTestEvidence(input: TaskTestReportInput): TestEvidence | undefined {
  const latest = listTaskTestReports(input).at(-1)
  if (!latest || latest.evidence.status !== 'passed') return undefined
  const fromBuild = input.run.nodes.find(n => n.id === latest.evidence.nodeId)?.stage === 'build'
  if (fromBuild) {
    const completed = input.codingRuns.filter(c => c.runId === input.run.id && c.projectId === input.run.projectId && c.status === 'completed')
      .sort((a, b) => (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt) || a.id.localeCompare(b.id)).at(-1)
    if (!completed || completed.id !== latest.codingRunId || completed.testEvidenceId !== latest.evidence.id) return undefined
  }
  return latest.evidence
}
export function testEvidenceFreshnessRule(state: TestEvidenceFreshness['state']): { blocks: false } | { blocks: true; code: 'stale' | 'unverifiable'; cause?: 'unavailable' | 'unrecorded' } {
  if (state === 'current') return { blocks: false }
  return state === 'stale' ? { blocks: true, code: 'stale' } : { blocks: true, code: 'unverifiable', cause: state }
}
export function latestConfirmingTestEvidence(input: { run: WorkflowRun; testEvidence: readonly TestEvidence[]; artifacts: readonly Artifact[] }): TestEvidence | undefined {
  const test = input.run.nodes.find(n => n.stage === 'test')
  if (test?.status !== 'success') return undefined
  return input.testEvidence.filter(e => e.runId === input.run.id && e.projectId === input.run.projectId && e.nodeId === test.id && e.status === 'passed' && !isDeliveryTestEvidence(e) && test.artifactIds.includes(`artifact-${e.id}`) && input.artifacts.some(a => a.id === `artifact-${e.id}` && a.runId === input.run.id && a.nodeId === test.id && a.kind === 'test_report'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1)
}
