export const REMOTE_SYNC_OUTBOX_POLL_INTERVAL_MS = 15_000

export type RemoteSyncOutboxSchedulerProcessor = {
  recoverAndDrain(): Promise<void>
}

export type RemoteSyncOutboxSchedulerTimers = {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type RemoteSyncOutboxSchedulerDependencies = {
  processor: RemoteSyncOutboxSchedulerProcessor
  onError(error: unknown): void | Promise<void>
  pollingIntervalMs?: number
  timers?: RemoteSyncOutboxSchedulerTimers
}

export function createRemoteSyncOutboxScheduler(
  deps: RemoteSyncOutboxSchedulerDependencies,
) {
  const pollingIntervalMs =
    deps.pollingIntervalMs ?? REMOTE_SYNC_OUTBOX_POLL_INTERVAL_MS
  const timers = deps.timers ?? {
    setTimeout: (callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  }
  let started = false
  let stopped = false
  let timerHandle: unknown
  let activeRun: Promise<void> | null = null
  let wakePending = false

  function clearScheduledPoll() {
    if (timerHandle === undefined) return
    timers.clearTimeout(timerHandle)
    timerHandle = undefined
  }

  function scheduleNextPoll() {
    if (!started || stopped) return
    clearScheduledPoll()
    timerHandle = timers.setTimeout(() => {
      timerHandle = undefined
      void requestRun(false)
    }, pollingIntervalMs)
  }

  async function reportError(error: unknown) {
    try {
      await deps.onError(error)
    } catch {
      // Scheduler errors stay isolated so future durable-sync cycles can continue.
    }
  }

  async function executeOnce(): Promise<void> {
    try {
      await deps.processor.recoverAndDrain()
    } catch (error) {
      await reportError(error)
    }
  }

  async function executeBatch(): Promise<void> {
    do {
      wakePending = false
      await executeOnce()
    } while (!stopped && wakePending)
  }

  function requestRun(queueFollowUpWhenActive: boolean): Promise<void> {
    if (!started || stopped) return Promise.resolve()
    clearScheduledPoll()
    if (activeRun) {
      if (queueFollowUpWhenActive) wakePending = true
      return activeRun
    }

    const run = executeBatch().finally(() => {
      activeRun = null
      scheduleNextPoll()
    })
    activeRun = run
    return run
  }

  function start(): Promise<void> {
    if (started || stopped) return Promise.resolve()
    started = true
    return requestRun(false)
  }

  function wake(): Promise<void> {
    return requestRun(true)
  }

  function stop(): void {
    stopped = true
    clearScheduledPoll()
  }

  return { start, wake, stop }
}
