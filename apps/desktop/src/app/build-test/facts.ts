import { isActiveCodingAgentRunStatus, type AgentEvent, type TeamMember, type CodingAgentRun, type CodingRuntimeReadiness, type LocalExecutionState, type WorkflowNode, type WorkflowRun } from '@ai-devflow/shared'
import type { CodingActionCosts, CodingChangeHistory } from '../../../electron/build-test-contract'
import type { StoredRevisionList } from '../gate-decision/revision-list'
export type BuildTestWrite = { id: string; action: string; target: string; startedAt: string; claim?: { kind: 'start'; existing: string[] } | { kind: 'permission'; requestId: string } | { kind: 'revision'; codingRunId: string; requestId: string } | { kind: 'question'; codingRunId: string; requestId: string } }
export type BuildTestFacts = Pick<LocalExecutionState, 'codingRuns' | 'codingEvents' | 'codingPermissionRequests' | 'codingPermissionDecisions' | 'managedCodingWorkspaces' | 'codingDiffArtifacts' | 'testEvidence'> & {
  events?: readonly AgentEvent[] | undefined; members?: readonly TeamMember[] | undefined
  run: WorkflowRun; buildNode: WorkflowNode; testNode: WorkflowNode
  history?: CodingChangeHistory | undefined; historyError?: string | undefined
  freshness: { status: 'loading' | 'loaded' | 'failed'; states: Readonly<Record<string, 'current' | 'stale' | 'unavailable' | 'unrecorded'>> }
  testCommand?: string | undefined
  testBlockedReason?: string | undefined
  costs?: CodingActionCosts | undefined; costsError?: string | undefined
  readiness?: CodingRuntimeReadiness | null | undefined; readinessError?: string | undefined
  canDecide: boolean; designLabel: string; now: string; observedAt: string
  writes: readonly BuildTestWrite[]; stopping?: boolean | undefined
  budgetContinuations: readonly { operation: { id: string } }[]
  writeResult?: { tone: 'error' | 'neutral' | 'warn'; text: string; technical?: string } | undefined
  list?: StoredRevisionList | undefined
}
export function taskCodingRuns(f: BuildTestFacts) { return f.codingRuns.filter(r => r.runId === f.run.id && r.nodeId === f.buildNode.id && r.projectId === f.run.projectId).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)) }
export function effectiveCodingRun(f: BuildTestFacts): CodingAgentRun | undefined {
  const runs = taskCodingRuns(f)
  let latest = runs.at(-1)
  const visited = new Set<string>()
  while (latest?.status === 'cancelled' && latest.retryOf && !visited.has(latest.id) && visited.size < runs.length) {
    visited.add(latest.id)
    if (f.codingPermissionRequests.some(p => p.codingRunId === latest!.id && (p.changeSetId || p.origin === 'change_acceptance'))) break
    const previous = runs.find(r => r.id === latest!.retryOf!.codingRunId)
    if (!previous || visited.has(previous.id)) break
    latest = previous
  }
  return latest
}
export function claimed(write: BuildTestWrite, f: BuildTestFacts): boolean {
  const claim = write.claim
  if (!claim) return false
  if (claim.kind === 'start') return taskCodingRuns(f).some(r => !claim.existing.includes(r.id))
  if (claim.kind === 'permission') return f.codingPermissionRequests.some(p => p.id === claim.requestId && p.status !== 'pending')
  const run = f.codingRuns.find(r => r.id === claim.codingRunId)
  if (claim.kind === 'revision') return Boolean(run?.revisionInFlight) || f.codingPermissionRequests.some(p => p.id === claim.requestId && p.status !== 'pending')
  return Boolean(run && (run.question?.id !== claim.requestId || run.question.status !== 'pending'))
}
export const isActive = (run: CodingAgentRun | undefined) => Boolean(run && isActiveCodingAgentRunStatus(run.status))
export function displayCurrentStage(f: BuildTestFacts): string {
  const actual = f.run.nodes.find(n => n.id === f.run.currentNodeId)?.stage ?? 'build'
  if (actual !== 'build') return actual
  const run = effectiveCodingRun(f)
  if (run?.engine === 'native' && f.codingPermissionRequests.some(p => p.codingRunId === run.id && p.changeSetId && p.status === 'approved')) return 'test'
  return 'build'
}
export function resolveBuildTestPage(f: BuildTestFacts, stage: 'build' | 'test', reading?: string) {
  if (reading) return 'history' as const
  const order = ['clarify', 'design', 'build', 'test', 'pr', 'accept'], current = displayCurrentStage(f)
  if (order.indexOf(current) < order.indexOf(stage)) return 'notReached' as const
  if (order.indexOf(current) > order.indexOf(stage) || (stage === 'test' && f.testNode.status === 'success')) return 'finished' as const
  return 'current' as const
}
export function nextSelectedStage(input: { before: string; after: string; selected: string; reading?: string | undefined }) {
  return !input.reading && input.selected === input.before && ['build', 'test'].includes(input.before) && ['build', 'test'].includes(input.after) ? input.after : input.selected
}
