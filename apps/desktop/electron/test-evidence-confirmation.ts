import { randomUUID } from 'node:crypto'
import { createTestEvidenceArtifact, createTestEvidenceEvent, listTaskTestReports, selectGoverningTestEvidence, testEvidenceFreshnessRule, type TestEvidence } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { ConfirmTestEvidenceInput } from './build-test-contract.js'
import { evaluateTestEvidenceFreshness } from './test-evidence-freshness.js'
import { createWorkflowRuntime } from './workflow-runtime.js'
import type { WorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'

export async function confirmTestEvidence(input: ConfirmTestEvidenceInput, ports: {
  store: LocalStore; coordinator: WorkspaceOperationCoordinator; now?: () => string
  freshness?: typeof evaluateTestEvidenceFreshness
}) {
  const { store } = ports
  const inspect = async () => {
    const run = await store.getRun(input.runId)
    if (!run || run.updatedAt !== input.expectedRunUpdatedAt) throw new Error('[workflow_changed] 流程已经变化，请重新查看。')
    const node = run.nodes.find(n => n.id === input.nodeId)
    if (!node || node.stage !== 'test' || run.currentNodeId !== node.id || !['running', 'failed'].includes(node.status)) throw new Error('[test_node_not_current] 当前还不能确认测试证据。')
    const codingRuns = (await store.listCodingAgentRuns(run.id)).filter(r => r.projectId === run.projectId)
    const material = { run, codingRuns, testEvidence: await store.listTestEvidence(run.id), codingEvents: (await Promise.all(codingRuns.map(r => store.listCodingAgentEvents(r.id)))).flat(), workspaces: await store.listManagedCodingWorkspaces(run.projectId) }
    const evidence = selectGoverningTestEvidence(material)
    if (!evidence || evidence.id !== input.evidenceId) throw new Error('[test_evidence_not_latest] 请确认最新一次通过的测试报告。')
    return { run, evidence, material }
  }
  const initial = await inspect()
  const commit = async () => {
    // The lock may have waited behind a test or cleanup. Read everything again inside it.
    const { run, evidence, material } = await inspect()
    if (evidence.sourceTree?.workspaceId !== initial.evidence.sourceTree?.workspaceId) throw new Error('[workflow_changed] 测试记录已经变化。')
    const project = (await store.listProjects()).find(p => p.id === run.projectId)
    if (!project) throw new Error('[test_evidence_unverifiable] 项目已经不可用。')
    const [freshness] = await (ports.freshness ?? evaluateTestEvidenceFreshness)({ evidence: [evidence], projectId: project.id, projectPath: project.path, workspaces: material.workspaces })
    const rule = testEvidenceFreshnessRule(freshness?.state ?? 'unavailable')
    if (rule.blocks) throw new Error(rule.code === 'stale' ? '[test_evidence_stale] 测试之后代码已变化，请重新测试。' : '[test_evidence_unverifiable] 无法核实测试报告对应的代码，请重新测试。')
    const now = (ports.now ?? (() => new Date().toISOString()))()
    let confirmed: TestEvidence = evidence
    if (evidence.nodeId !== input.nodeId) {
      const owner = listTaskTestReports(material).find(r => r.evidence.id === evidence.id)?.codingRunId
      if (!owner) throw new Error('[test_evidence_not_latest] 无法核实这份报告的开发记录。')
      confirmed = { ...evidence, id: `evidence-${randomUUID()}`, nodeId: input.nodeId, createdAt: now, summary: 'Reused passing Build test evidence; source fingerprint verified.', reusedFrom: { evidenceId: evidence.id, codingRunId: owner, verifiedAt: now } }
    }
    const artifact = createTestEvidenceArtifact(confirmed)
    const event = createTestEvidenceEvent(confirmed, (await store.listEvents(run.id)).length + 1)
    const pairing = await store.getDesktopPairingCredential()
    if (pairing?.localProjectId === run.projectId) event.metadata = { ...event.metadata, confirmedBy: pairing.userId }
    const result = await createWorkflowRuntime(store).execute({ runId: run.id, expectedRunUpdatedAt: input.expectedRunUpdatedAt, command: { type: 'record_test_result', nodeId: input.nodeId, evidenceId: confirmed.id, artifactId: artifact.id }, candidates: { artifacts: [artifact], events: [event], testEvidence: [confirmed] }, now })
    if (!result.applied) throw new Error('[workflow_changed] 流程已经变化，测试证据没有确认。')
    return { run: result.run, evidence: confirmed, state: await store.loadState() }
  }
  return initial.evidence.sourceTree?.workspaceId ? ports.coordinator.runExclusive(initial.evidence.sourceTree.workspaceId, commit) : commit()
}
