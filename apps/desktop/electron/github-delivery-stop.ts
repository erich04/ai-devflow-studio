import type {
  StopGitHubDeliveryInput,
  StopGitHubDeliveryResult,
} from './ipc-contract.js'

type StopIntentResult =
  | { committed: true }
  | {
      committed: false
      reason: 'intent_not_found' | 'source_stale' | 'intent_terminal'
    }

export type ActiveGitHubDeliveryOperation = {
  intentId: string
  expectedUpdatedAt: string
  abort: () => void
}

export type StopGitHubDeliveryDeps = {
  input: StopGitHubDeliveryInput
  updatedAt: string
  stopIntent: (input: {
    intentId: string
    expectedUpdatedAt: string
    updatedAt: string
  }) => Promise<StopIntentResult>
  getActiveOperation: () => ActiveGitHubDeliveryOperation | null
}

export async function stopGitHubDelivery(
  deps: StopGitHubDeliveryDeps,
): Promise<StopGitHubDeliveryResult> {
  let stopped: StopIntentResult
  try {
    stopped = await deps.stopIntent({
      intentId: deps.input.intentId,
      expectedUpdatedAt: deps.input.expectedUpdatedAt,
      updatedAt: deps.updatedAt,
    })
  } catch {
    return {
      intentId: deps.input.intentId,
      disposition: 'local_conflict',
      outcomeCode: 'stop_unavailable',
    }
  }
  if (!stopped.committed) {
    if (stopped.reason === 'intent_terminal') {
      return {
        intentId: deps.input.intentId,
        disposition: 'already_terminal',
        outcomeCode: 'intent_terminal',
      }
    }
    return {
      intentId: deps.input.intentId,
      disposition: 'local_conflict',
      outcomeCode:
        stopped.reason === 'intent_not_found'
          ? 'intent_not_found'
          : 'stale_intent',
    }
  }

  const activeOperation = deps.getActiveOperation()
  if (
    activeOperation?.intentId === deps.input.intentId &&
    activeOperation.expectedUpdatedAt === deps.input.expectedUpdatedAt
  ) {
    activeOperation.abort()
  }
  return {
    intentId: deps.input.intentId,
    disposition: 'stopped',
    outcomeCode: 'operation_cancelled',
  }
}
