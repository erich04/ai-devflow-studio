import { isTerminalGitHubDeliveryStatus, latestConfirmingTestEvidence, testEvidenceFreshnessRule } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import { evaluateTestEvidenceFreshness } from './test-evidence-freshness.js'

export async function assertDeliveryTestEvidenceCurrent(store: LocalStore, input: { runId: string }, freshness = evaluateTestEvidenceFreshness) {
  const run = await store.getRun(input.runId)
  if (!run) throw new Error('[delivery_test_evidence_not_current] 找不到这次任务。')
  const workspaces = await store.listManagedCodingWorkspaces(run.projectId)
  const coding = (await store.listCodingAgentRuns(run.id)).filter(r => r.status === 'completed').sort((a, b) => (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt)).at(-1)
  if ((await store.listGitHubDeliveryIntents(run.id)).some(i => !isTerminalGitHubDeliveryStatus(i.status)) || workspaces.find(w => w.id === coding?.managedWorkspaceId)?.headCommitSha) return
  const evidence = latestConfirmingTestEvidence({ run, testEvidence: await store.listTestEvidence(run.id), artifacts: await store.listArtifacts(run.id) })
  const prefix = '[delivery_test_evidence_not_current] '
  if (!evidence) throw new Error(`${prefix}测试步骤还没有确认测试证据，不能准备交付。`)
  const project = (await store.listProjects()).find(p => p.id === run.projectId)
  const [result] = project ? await freshness({ evidence: [evidence], projectId: project.id, projectPath: project.path, workspaces }) : [{ state: 'unavailable' as const }]
  const rule = testEvidenceFreshnessRule(result?.state ?? 'unavailable')
  if (!rule.blocks) return
  if (rule.code === 'stale') throw new Error(`${prefix}测试证据已过期，不能准备交付。受管工作区在测试之后被改过；DevFlow 只能交付批准过的改动，撤销这些改动后再准备交付。`)
  throw new Error(`${prefix}无法核实测试证据是否对应当前代码，不能准备交付：${rule.cause === 'unrecorded' ? '这份测试结果没有记下当时的代码状态' : '受管工作区已不存在或读不到'}。`)
}
