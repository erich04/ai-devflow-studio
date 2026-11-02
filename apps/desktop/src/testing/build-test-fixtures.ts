import { createWorkflowRunFromRequest, type CodingAgentRun, type CodingPermissionRequest, type TestEvidence } from '@ai-devflow/shared'
import type { BuildTestFacts } from '../app/build-test/facts'
export const NOW = '2026-11-02T12:00:00.000Z'
export const DIGEST = 'a'.repeat(64)
export function buildTestFacts(): BuildTestFacts {
  const { run } = createWorkflowRunFromRequest({ runId: 'task', title: '搜索任务', request: '按标题搜索任务', projectId: 'project', creatorId: 'user', branchName: 'test/search', now: NOW })
  const buildNode = run.nodes.find(n => n.stage === 'build')!, testNode = run.nodes.find(n => n.stage === 'test')!
  run.currentNodeId = buildNode.id; buildNode.status = 'running'
  return { run, buildNode, testNode, codingRuns: [], codingEvents: [], codingPermissionRequests: [], codingPermissionDecisions: [], managedCodingWorkspaces: [], codingDiffArtifacts: [], testEvidence: [], freshness: { status: 'loaded', states: {} }, readiness: { projectId: run.projectId, runId: run.id, nodeId: buildNode.id, engine: 'native', executor: 'native-model', status: 'ready', availability: 'available', providerRequirement: 'saved-provider', capabilities: [], checks: [], evaluatedAt: NOW }, canDecide: true, designLabel: '方案 v2', now: NOW, observedAt: NOW, writes: [], budgetContinuations: [], costs: { executor: 'native', executorLabel: 'DevFlow Native', modelLabel: 'deepseek-v4-flash', billing: 'metered', start: .04, revise: .02, selfCheck: .01, repair: .01, repairRevise: .01, budget: { revise: null, selfCheck: null, repairRevise: null } }, history: { runId: run.id, observedAt: NOW, changeSets: [], reviews: [] } }
}
export function addCoding(f: BuildTestFacts, overrides: Partial<CodingAgentRun> = {}) {
  const run: CodingAgentRun = { id: `coding-${f.codingRuns.length + 1}`, runId: f.run.id, nodeId: f.buildNode.id, projectId: f.run.projectId, requestedBy: 'user', providerId: 'provider', engine: 'native', status: 'running', branchName: 'coding/search', userInstruction: 'Implement', prompt: 'Implement', summary: '', changedPaths: [], startedAt: NOW, redacted: true, ...overrides }
  f.codingRuns.push(run); return run
}
export function addChange(f: BuildTestFacts, run: CodingAgentRun, phase: 'initial' | 'repair' = 'initial') {
  const number = f.codingPermissionRequests.length + 1, id = `change-${number}`, createdAt = new Date(Date.parse(NOW) + number).toISOString()
  const request: CodingPermissionRequest = { id: `request-${number}`, codingRunId: run.id, runId: f.run.id, nodeId: f.buildNode.id, origin: 'coding_executor', permission: 'patch', title: 'Apply change', changeSetId: id, changeSetDigest: DIGEST, status: 'pending', risk: 'warn', reasons: [], requestedAt: createdAt, expiresAt: '2026-11-02T12:15:00.000Z' }
  f.codingPermissionRequests.push(request); run.status = 'waiting_permission'; run.changeSetId = id
  f.history!.changeSets.push({ id, codingRunId: run.id, phase, digest: DIGEST, verified: true, createdAt, expiresAt: request.expiresAt, changedPaths: ['src/search.ts'], view: { files: [{ path: 'src/search.ts', additions: 1, deletions: 1, rows: [{ kind: 'del', oldLine: 1, text: 'const search = false' }, { kind: 'add', newLine: 1, text: 'const search = true' }] }], additions: 1, deletions: 1 } })
  return request
}
export function approve(f: BuildTestFacts, request: CodingPermissionRequest) { request.status = 'approved'; f.codingPermissionDecisions.push({ id: `decision-${request.id}`, codingRunId: request.codingRunId, requestId: request.id, decision: 'approved', decidedBy: 'user', comment: '', decidedAt: NOW }) }
export function addReport(f: BuildTestFacts, run: CodingAgentRun | undefined, status: TestEvidence['status'] = 'passed') {
  const id = `evidence-${f.testEvidence.length + 1}`, evidence: TestEvidence = { id, runId: f.run.id, nodeId: run ? f.buildNode.id : f.testNode.id, projectId: f.run.projectId, command: 'node --test', cwd: '/workspace', status, exitCode: status === 'passed' ? 0 : 1, durationMs: 1000, stdout: status === 'passed' ? '# tests 22\n# pass 22\n# fail 0' : '✖ 搜索保留筛选\n# tests 22\n# pass 21\n# fail 1', stderr: '', summary: '', createdAt: new Date(Date.parse(NOW) + 100 + f.testEvidence.length).toISOString(), redacted: true, sourceTree: { digest: DIGEST } }
  f.testEvidence.push(evidence)
  if (run) { run.testEvidenceId = id; f.codingEvents.push({ id: `event-${id}`, runId: f.run.id, nodeId: f.buildNode.id, codingRunId: run.id, kind: 'test', sequence: f.codingEvents.length, timestamp: evidence.createdAt, message: 'Test result', metadata: { evidenceId: id, changeSetId: run.changeSetId, changeSetDigest: DIGEST }, redacted: true }) }
  return evidence
}
