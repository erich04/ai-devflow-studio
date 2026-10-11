import {
  applyDesignRevision, resolveDesignClarificationInput, resolveDesignRevisionInput,
  type AgentEvent, type DesignRevisionRequest, type RunWorkflowStageAgentResult, type WorkflowRun,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store'

/** Main-owned completion: revalidate, then atomically bind the new review subject and its evidence. */
export async function commitDesignRevision(input: {
  store: LocalStore
  run: WorkflowRun
  gateNodeId: string
  request: DesignRevisionRequest
  generated: RunWorkflowStageAgentResult
  actor: { userId: string; userName: string }
  beforeCommit?: () => void
}) {
  const { store, generated, request, gateNodeId } = input
  const run = await store.getRun(input.run.id)
  if (!run || JSON.stringify(run) !== JSON.stringify(input.run)) throw new Error('任务进度已变化，请重新核对方案。')
  const artifacts = await store.listArtifacts(run.id)
  const resolved = await resolveDesignRevisionInput({ run, gateNodeId, request, artifacts })
  const approved = await resolveDesignClarificationInput(run, artifacts)
  if (JSON.stringify(approved.binding) !== JSON.stringify(generated.artifact.designEvidence?.clarification)) {
    throw new Error('需求审批依据已变化，请重新生成方案设计。')
  }
  const nextRun = await applyDesignRevision({ run, gateNodeId, request, artifacts, artifact: generated.artifact })
  const events = await store.listEvents(run.id)
  const event: AgentEvent = { id: `event-${generated.artifact.id}`, runId: run.id, nodeId: gateNodeId,
    sequence: Math.max(0, ...events.map((item) => item.sequence)) + 1, kind: 'thinking',
    message: `${input.actor.userName} 根据旧方案与 ${resolved.proposals.length} 份已保存提案生成新版方案；仍待方案评审。Source: ${generated.source} · ${generated.providerId} · ${generated.model}.`,
    timestamp: generated.artifact.updatedAt }
  // Cancellation stays effective until this point. Sealing prevents cancellation halfway through a commit.
  input.beforeCommit?.()
  const result = await store.commitWorkflowMutation({ expectedRun: run, run: nextRun,
    expectedArtifacts: [resolved.previous, ...resolved.proposals, approved.artifact],
    artifacts: [generated.artifact], events: [event], agentTraces: [generated.trace],
    ...(generated.tokenUsage ? { agentTokenUsage: [generated.tokenUsage] } : {}) })
  if (!result.committed) throw new Error(`方案或任务已变化，未替换当前方案（${result.reason}）。`)
  return { run: nextRun, artifact: generated.artifact, event }
}
