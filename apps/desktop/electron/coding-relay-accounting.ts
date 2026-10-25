import { createHash } from 'node:crypto'
import { isActiveCodingAgentRunStatus, redactCodingAgentEventForStorage, type CodingAgentEvent, type CodingAgentRun } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { CodingRelayCallContext, CodingRelaySession } from './governed-opencode-proxy.js'
import { providerCallTraceMessage } from './provider-call-trace-message.js'

type AccountingStore = Pick<LocalStore, 'listCodingAgentRuns' | 'listCodingAgentEvents' | 'saveCodingAgentEvent'>

function operationVersion(run: CodingAgentRun): string {
  return createHash('sha256').update(JSON.stringify([
    run.id, run.runId, run.nodeId, run.projectId, run.requestedBy, run.providerId, run.engine,
    run.configVersion, run.managedWorkspaceId, run.userInstruction,
  ])).digest('hex')
}

/** Main-owned call scope. It persists expenses, never grants execution or revives a stopped run. */
export async function createCodingRelayCallContext(input: {
  store: AccountingStore
  projectId: string
  providerId: string
  model: string
  configVersion: number
  session: CodingRelaySession
  publishEvent?: (event: CodingAgentEvent) => void
  publishRun?: (run: CodingAgentRun) => void
}): Promise<CodingRelayCallContext> {
  const runs = (await input.store.listCodingAgentRuns()).filter((run) =>
    run.projectId === input.projectId && isActiveCodingAgentRunStatus(run.status))
  const run = runs[0]
  if (runs.length !== 1 || !run || run.engine !== 'opencode-http' || run.providerId !== input.providerId ||
      run.configVersion !== input.configVersion || !run.managedWorkspaceId ||
      run.id !== input.session.codingRunId || run.managedWorkspaceId !== input.session.workspaceId) {
    throw new Error('开发操作已结束或模型调用归属不一致，尚未发出模型请求。')
  }
  const version = operationVersion(run)
  return {
    operation: { id: `coding-${run.id}`, purpose: 'native-tool', version },
    async report(value) {
      const current = (await input.store.listCodingAgentRuns(run.runId)).find((item) => item.id === run.id)
      if (!current || operationVersion(current) !== version || value.providerId !== input.providerId || value.model !== input.model ||
          (value.status === 'started' && !isActiveCodingAgentRunStatus(current.status))) {
        throw new Error('Provider call accounting scope mismatch')
      }
      const timestamp = value.status === 'started' ? value.startedAt : value.completedAt
      if (!timestamp) throw new Error('Provider call completion timestamp missing')
      const trace = { ...value, codingRunId: run.id }
      const eventId = `coding-relay-${value.requestId}-${value.status}`
      const events = await input.store.listCodingAgentEvents(run.id)
      // Partial observations update the durable start; they must not move it after its result.
      const sequence = events.find((event) => event.id === eventId)?.sequence ??
        events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1
      const event = redactCodingAgentEventForStorage({
        id: eventId, codingRunId: run.id, runId: run.runId, nodeId: run.nodeId,
        sequence,
        kind: value.status === 'started' ? 'tool_call' : value.status === 'succeeded' ? 'tool_result' : 'error',
        message: providerCallTraceMessage(trace), timestamp, metadata: { providerCall: trace,
          executorSessionId: input.session.sessionId, parentSessionId: input.session.rootSessionId }, redacted: true,
      })
      await input.store.saveCodingAgentEvent(event)
      const settled = (await input.store.listCodingAgentRuns(run.runId)).find((item) => item.id === run.id)
      try {
        input.publishEvent?.(event)
        if (settled) input.publishRun?.(settled)
      } catch { /* Notification failure must not erase durable usage or repeat a model request. */ }
    },
  }
}
