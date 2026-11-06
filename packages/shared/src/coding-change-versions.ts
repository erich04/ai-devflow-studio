import type { CodingAgentRun, CodingChangeSet, CodingDiffArtifact, CodingPermissionRequest, ManagedCodingWorkspace } from './domain'
import { listTaskTestReports, type TaskTestReportInput } from './test-evidence-rules'
export type CodingChangeVersion = { number: number; label: string; repair: boolean }
export type CodingChangeVersionInput = { codingRuns: readonly CodingAgentRun[]; changeSets: readonly CodingChangeSet[]; acceptanceDiffs: readonly CodingDiffArtifact[]; permissionRequests: readonly CodingPermissionRequest[] }
export function numberCodingChangeVersions(input: CodingChangeVersionInput): Map<string, CodingChangeVersion> {
  const ids = new Set(input.codingRuns.map(r => r.id))
  const requests = input.permissionRequests.filter(p => ids.has(p.codingRunId))
  const items = [
    ...input.changeSets.filter(c => ids.has(c.codingRunId) && requests.some(p => p.codingRunId === c.codingRunId && p.changeSetId === c.id)).map(c => ({ id: c.id, createdAt: c.createdAt, repair: c.phase === 'repair' })),
    ...input.acceptanceDiffs.filter(d => requests.some(p => p.origin === 'change_acceptance' && p.diffArtifactId === d.id)).map(d => ({ id: d.id, createdAt: d.createdAt, repair: false })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return new Map(items.map((item, index) => [item.id, { number: index + 1, label: `改动 v${index + 1}${item.repair ? '（修复）' : ''}`, repair: item.repair }]))
}
export function summarizeRunBuildTestMaterials(input: CodingChangeVersionInput & TaskTestReportInput & { workspaces: readonly ManagedCodingWorkspace[] }) {
  const codingRuns = input.codingRuns.filter(r => r.runId === input.run.id && r.projectId === input.run.projectId)
  const versions = numberCodingChangeVersions({ ...input, codingRuns })
  const [id, version] = [...versions].at(-1) ?? []
  const change = input.changeSets.find(c => c.id === id)
  const request = input.permissionRequests.find(p => p.changeSetId === id || p.diffArtifactId === id)
  const latestCoding = [...codingRuns].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
  const workspace = input.workspaces.find(w => w.id === latestCoding?.managedWorkspaceId)
  const report = listTaskTestReports({ ...input, codingRuns }).at(-1)
  const owner = codingRuns.find(c => c.id === report?.codingRunId)
  const testedEvent = input.codingEvents?.find(e => e.codingRunId === owner?.id && e.metadata?.evidenceId === report?.evidence.id && typeof e.metadata?.changeSetId === 'string')
  let testedId = testedEvent && input.changeSets.some(c => c.id === testedEvent.metadata?.changeSetId && c.codingRunId === owner?.id && c.changeSetDigest === testedEvent.metadata?.changeSetDigest) ? String(testedEvent.metadata!.changeSetId) : undefined
  if (!testedId && report && owner) {
    const approvals = (input.permissionDecisions ?? []).filter(d => d.codingRunId === owner.id && d.decision === 'approved' && d.decidedAt <= report.evidence.createdAt)
      .flatMap(d => { const request = input.permissionRequests.find(p => p.id === d.requestId && p.codingRunId === owner.id && p.changeSetId); return request ? [{ id: request.changeSetId!, at: d.decidedAt }] : [] })
      .sort((a, b) => a.at.localeCompare(b.at))
    const last = approvals.at(-1)
    if (last && approvals.filter(a => a.at === last.at).length === 1) testedId = last.id
    // OpenCode's exact acceptance request identifies the report for its final diff.
    testedId ??= input.permissionRequests.find(p => p.codingRunId === owner.id && p.origin === 'change_acceptance' && p.testEvidenceId === report.evidence.id)?.diffArtifactId
  }
  const forLabel = testedId ? versions.get(testedId)?.label : undefined
  return {
    build: { ...(id && version ? { current: { label: version.label, ...(change ? { changeSetId: change.id, changeSetDigest: change.changeSetDigest } : { diffArtifactId: id }), status: request?.status ?? 'pending' } } : {}), workspace: !workspace ? 'none' as const : workspace.deletedAt || workspace.cleanupStatus === 'deleted' ? 'deleted' as const : 'active' as const },
    ...(report ? { test: { latest: { label: report.label, evidenceId: report.evidence.id, status: report.evidence.status, ...(forLabel ? { forLabel } : {}) } } } : {}),
  }
}
