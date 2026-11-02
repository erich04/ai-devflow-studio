import { buildGitPatchDiffView, type ChangeSetDiffView, type CodingPermissionRequest } from '@ai-devflow/shared'
import type { CodingChangeSetRecord } from '../../../electron/build-test-contract'
import { effectiveCodingRun, taskCodingRuns, type BuildTestFacts } from './facts'
export type ChangeVersion = { id: string; number: number; label: string; repair: boolean; codingRunId: string; request: CodingPermissionRequest; record?: CodingChangeSetRecord; view?: ChangeSetDiffView; createdAt: string; status: string }
export function buildChangeVersions(f: BuildTestFacts): ChangeVersion[] {
  const runs = taskCodingRuns(f)
  const versions = f.codingPermissionRequests.filter(p => runs.some(r => r.id === p.codingRunId) && (p.changeSetId || p.origin === 'change_acceptance')).flatMap(p => {
    const record = f.history?.changeSets.find(c => c.id === p.changeSetId && c.digest === p.changeSetDigest), diff = f.codingDiffArtifacts.find(d => d.id === p.diffArtifactId && d.sourceDigest === p.diffSourceDigest)
    if (!record && !diff) return []
    return [{ id: record?.id ?? diff!.id, number: 0, label: '', repair: record?.phase === 'repair', codingRunId: p.codingRunId, request: p, ...(record ? { record } : {}), ...(record?.view ? { view: record.view } : diff ? { view: buildGitPatchDiffView(diff.patch) } : {}), createdAt: record?.createdAt ?? diff!.createdAt,
      status: p.status === 'approved' ? '已批准' : p.status === 'rejected' ? '已拒绝' : p.status === 'expired' ? '已过期' : p.status === 'superseded' ? '没有批准，按清单生成了下一版' : '待批准' }]
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return versions.map((v, index) => ({ ...v, number: index + 1, label: `改动 v${index + 1}${v.repair ? '（修复）' : ''}` }))
}

/** A completed build page keeps its approved implementation while test shows the repair. */
export function shownChangeVersion(f: BuildTestFacts, stage: 'build' | 'test', reading?: string): ChangeVersion | undefined {
  const versions = buildChangeVersions(f)
  if (reading) return versions.find(v => v.id === reading)
  const run = effectiveCodingRun(f)
  return versions.filter(v => v.codingRunId === run?.id && (stage !== 'build' || !v.repair)).at(-1)
}
