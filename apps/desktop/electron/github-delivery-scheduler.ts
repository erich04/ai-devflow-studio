import {
  createRemoteSyncOutboxScheduler,
  type RemoteSyncOutboxSchedulerTimers,
} from './remote-sync-outbox-scheduler.js'

export const GITHUB_DELIVERY_POLL_INTERVAL_MS = 15_000

export type GitHubDeliverySchedulerDependencies = {
  recoverAndAdvance(): Promise<unknown>
  onError(error: unknown): void | Promise<void>
  pollingIntervalMs?: number
  timers?: RemoteSyncOutboxSchedulerTimers
}

export function createGitHubDeliveryScheduler(
  dependencies: GitHubDeliverySchedulerDependencies,
) {
  return createRemoteSyncOutboxScheduler({
    processor: {
      recoverAndDrain: async () => {
        await dependencies.recoverAndAdvance()
      },
    },
    onError: dependencies.onError,
    pollingIntervalMs:
      dependencies.pollingIntervalMs ?? GITHUB_DELIVERY_POLL_INTERVAL_MS,
    ...(dependencies.timers ? { timers: dependencies.timers } : {}),
  })
}
