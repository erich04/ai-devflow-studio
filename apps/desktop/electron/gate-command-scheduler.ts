import {
  createRemoteSyncOutboxScheduler,
  type RemoteSyncOutboxSchedulerTimers,
} from './remote-sync-outbox-scheduler.js'

export const GATE_COMMAND_POLL_INTERVAL_MS = 15_000

export type GateCommandSchedulerDependencies = {
  processAvailable(): Promise<void>
  onError(error: unknown): void | Promise<void>
  pollingIntervalMs?: number
  timers?: RemoteSyncOutboxSchedulerTimers
}

export function createGateCommandScheduler(
  dependencies: GateCommandSchedulerDependencies,
) {
  return createRemoteSyncOutboxScheduler({
    processor: {
      recoverAndDrain: dependencies.processAvailable,
    },
    onError: dependencies.onError,
    pollingIntervalMs:
      dependencies.pollingIntervalMs ?? GATE_COMMAND_POLL_INTERVAL_MS,
    ...(dependencies.timers ? { timers: dependencies.timers } : {}),
  })
}
