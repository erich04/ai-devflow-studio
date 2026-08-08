import { describe, expect, it, vi } from 'vitest'
import {
  REMOTE_SYNC_OUTBOX_POLL_INTERVAL_MS,
  createRemoteSyncOutboxScheduler,
} from './remote-sync-outbox-scheduler'

class ManualTimers {
  readonly scheduled: Array<{
    handle: number
    callback: () => void
    delayMs: number
    cleared: boolean
  }> = []
  private nextHandle = 1

  setTimeout(callback: () => void, delayMs: number) {
    const task = {
      handle: this.nextHandle++,
      callback,
      delayMs,
      cleared: false,
    }
    this.scheduled.push(task)
    return task.handle
  }

  clearTimeout(handle: unknown) {
    const task = this.scheduled.find((candidate) => candidate.handle === handle)
    if (task) task.cleared = true
  }

  run(handle: number) {
    const task = this.scheduled.find((candidate) => candidate.handle === handle)
    if (!task || task.cleared) return
    task.cleared = true
    task.callback()
  }

  latestActive() {
    return [...this.scheduled].reverse().find((task) => !task.cleared)
  }
}

describe('remote sync outbox scheduler', () => {
  it('starts with an immediate recovery drain and schedules the default polling interval', async () => {
    const timers = new ManualTimers()
    const recoverAndDrain = vi.fn(async () => undefined)
    const scheduler = createRemoteSyncOutboxScheduler({
      processor: { recoverAndDrain },
      timers,
      onError: vi.fn(),
    })

    await scheduler.start()

    expect(recoverAndDrain).toHaveBeenCalledOnce()
    expect(timers.latestActive()).toMatchObject({
      delayMs: REMOTE_SYNC_OUTBOX_POLL_INTERVAL_MS,
    })
    scheduler.stop()
  })

  it('coalesces wakes during an active drain into exactly one immediate follow-up drain', async () => {
    const timers = new ManualTimers()
    let releaseFirst!: () => void
    const firstDrain = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const recoverAndDrain = vi.fn()
      .mockImplementationOnce(() => firstDrain)
      .mockResolvedValue(undefined)
    const scheduler = createRemoteSyncOutboxScheduler({
      processor: { recoverAndDrain },
      timers,
      onError: vi.fn(),
    })

    const starting = scheduler.start()
    await vi.waitFor(() => expect(recoverAndDrain).toHaveBeenCalledOnce())
    const wakes = [scheduler.wake(), scheduler.wake(), scheduler.wake()]

    expect(recoverAndDrain).toHaveBeenCalledOnce()
    releaseFirst()
    await Promise.all([starting, ...wakes])

    expect(recoverAndDrain).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('reports a cycle error safely and continues the next lease-aware polling cycle', async () => {
    const timers = new ManualTimers()
    const failure = new Error('outbox unavailable')
    const recoverAndDrain = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const onError = vi.fn(async () => {
      throw new Error('observer failure must remain isolated')
    })
    const scheduler = createRemoteSyncOutboxScheduler({
      processor: { recoverAndDrain },
      timers,
      pollingIntervalMs: 2_500,
      onError,
    })

    await scheduler.start()

    expect(onError).toHaveBeenCalledWith(failure)
    const scheduled = timers.latestActive()
    expect(scheduled).toMatchObject({ delayMs: 2_500 })
    timers.run(scheduled!.handle)
    await vi.waitFor(() => {
      expect(recoverAndDrain).toHaveBeenCalledTimes(2)
      expect(timers.latestActive()).toMatchObject({ delayMs: 2_500 })
    })
    scheduler.stop()
  })

  it('wakes immediately from an idle poll and replaces the previous timer', async () => {
    const timers = new ManualTimers()
    const recoverAndDrain = vi.fn(async () => undefined)
    const scheduler = createRemoteSyncOutboxScheduler({
      processor: { recoverAndDrain },
      timers,
      onError: vi.fn(),
    })

    await scheduler.start()
    const stalePoll = timers.latestActive()!
    await scheduler.wake()

    expect(recoverAndDrain).toHaveBeenCalledTimes(2)
    expect(stalePoll.cleared).toBe(true)
    expect(timers.latestActive()?.handle).not.toBe(stalePoll.handle)
    scheduler.stop()
  })

  it('stops scheduled and explicit future work without cancelling an active processor call', async () => {
    const timers = new ManualTimers()
    let release!: () => void
    const activeCall = new Promise<void>((resolve) => {
      release = resolve
    })
    const recoverAndDrain = vi.fn(() => activeCall)
    const scheduler = createRemoteSyncOutboxScheduler({
      processor: { recoverAndDrain },
      timers,
      onError: vi.fn(),
    })

    const starting = scheduler.start()
    await vi.waitFor(() => expect(recoverAndDrain).toHaveBeenCalledOnce())
    scheduler.stop()
    await scheduler.wake()
    await scheduler.start()
    release()
    await starting

    expect(recoverAndDrain).toHaveBeenCalledOnce()
    expect(timers.latestActive()).toBeUndefined()
  })
})
