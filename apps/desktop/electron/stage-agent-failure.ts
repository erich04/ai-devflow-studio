import { randomUUID } from 'node:crypto'
import {
  StageAgentExecutionError,
  type AgentEvent,
  type AgentTrace,
  type StageAgentExecutorKind,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

export async function recordStageAgentFailure(input: {
  store: Pick<LocalStore, 'commitWorkflowMutation'>
  run: WorkflowRun
  nodeId: string
  executorKind: StageAgentExecutorKind
  completedAt: string
  sequence: number
  error: unknown
}): Promise<never> {
  const { store, run, error } = input
  const node = run.nodes.find((candidate) => candidate.id === input.nodeId)!
  const diagnostic = error instanceof StageAgentExecutionError
    ? error.message
    : 'The executor failed before a validated response was available.'
  const terminalReason = error instanceof StageAgentExecutionError
    ? error.terminalReason
    : 'failed'
  const failureId = `stage-agent-failure-${randomUUID()}`
  const failureTrace: AgentTrace = {
    id: `agent-trace-${failureId}`,
    runId: run.id,
    nodeId: node.id,
    reviewId: failureId,
    runtime: 'electron',
    terminalReason,
    createdAt: input.completedAt,
    steps: [{
      id: `agent-trace-${failureId}-terminal`,
      kind: 'provider_call',
      label: `Run ${input.executorKind}`,
      summary: `Stage Agent failed closed; terminal=${terminalReason}. ${diagnostic} No artifact was created and Workflow did not advance.`,
      timestamp: input.completedAt,
    }],
  }
  const failureEvent: AgentEvent = {
    id: `event-${failureId}`,
    runId: run.id,
    nodeId: node.id,
    sequence: input.sequence,
    kind: 'tool_result',
    message: `Stage Agent failed closed (${terminalReason}); ${diagnostic} Workflow remains on ${node.title}.`,
    timestamp: input.completedAt,
  }
  let failureAudit
  try {
    failureAudit = await store.commitWorkflowMutation({
      expectedRun: run,
      run,
      events: [failureEvent],
      agentTraces: [failureTrace],
      ...(error instanceof StageAgentExecutionError && error.tokenUsage ? {
        agentTokenUsage: [{ ...error.tokenUsage, id: `agent-token-usage-${failureId}` }],
      } : {}),
    })
  } catch {
    throw new Error(
      `Stage Agent failed closed: ${terminalReason}; failure audit could not be persisted`,
    )
  }
  if (!failureAudit.committed) {
    throw new Error(
      `Stage Agent failed closed: ${terminalReason}; failure audit was rejected (${failureAudit.reason})`,
    )
  }
  throw new Error(`Stage Agent failed closed: ${terminalReason}; ${diagnostic}`)
}
