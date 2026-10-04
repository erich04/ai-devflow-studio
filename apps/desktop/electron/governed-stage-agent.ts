import { StageAgentExecutionError, type StageAgentExecutor } from '@ai-devflow/shared'
import type { GovernedOpencodeProxy } from './governed-opencode-proxy.js'
import { classifyOpencodeFailure, withOpencodeCleanup } from './opencode-failure.js'

/** The Main-process boundary: preserve diagnostics and all completed rounds, including on failure. */
export function withGovernedStageAgent(executor: StageAgentExecutor, relay: GovernedOpencodeProxy): StageAgentExecutor {
  let checkpoint = relay.checkpoint()
  return { ...executor, reportedUsageOnAbort: () => relay.usageAfter(checkpoint), async execute(execution) {
    checkpoint = relay.checkpoint()
    try {
      const result = await withOpencodeCleanup(() => executor.execute(execution), () => relay.close(), 'relay_close', (result) => result.value.usage)
      return { ...result, value: { ...result.value, usage: { ...result.value.usage, ...relay.usageAfter(checkpoint) } } }
    } catch (error) {
      const relayed = relay.usageAfter(checkpoint)
      const reported = error instanceof StageAgentExecutionError ? error.reportedUsage : undefined
      throw classifyOpencodeFailure(error, {
        ...(relayed ? { reportedUsage: { ...reported, ...relayed } } : reported !== undefined ? { reportedUsage: reported } : {}),
        relayFailure: (requestId) => relay.failureForRequest(requestId, checkpoint),
      })
    }
  } }
}
