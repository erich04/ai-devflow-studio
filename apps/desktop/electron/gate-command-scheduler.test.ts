import { describe, expect, it, vi } from 'vitest'
import {
  GATE_COMMAND_POLL_INTERVAL_MS,
  createGateCommandScheduler,
} from './gate-command-scheduler'

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

  latestActive() {
    return [...this.scheduled].reverse().find((task) => !task.cleared)
  }
}

describe('Gate Command scheduler', () => {
  it('polls immediately, then uses the bounded default interval', async () => {
    const timers = new ManualTimers()
    const processAvailable = vi.fn(async () => undefined)
    const scheduler = createGateCommandScheduler({
      processAvailable,
      onError: vi.fn(),
      timers,
    })

    await scheduler.start()

    expect(processAvailable).toHaveBeenCalledOnce()
    expect(timers.latestActive()).toMatchObject({
      delayMs: GATE_COMMAND_POLL_INTERVAL_MS,
    })
    scheduler.stop()
  })

  it('coalesces repeated wakes while a poll is active', async () => {
    const timers = new ManualTimers()
    let release!: () => void
    const first = new Promise<void>((resolve) => {
      release = resolve
    })
    const processAvailable = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined)
    const scheduler = createGateCommandScheduler({
      processAvailable,
      onError: vi.fn(),
      timers,
    })

    const starting = scheduler.start()
    await vi.waitFor(() => expect(processAvailable).toHaveBeenCalledOnce())
    const wakes = [scheduler.wake(), scheduler.wake(), scheduler.wake()]
    release()
    await Promise.all([starting, ...wakes])

    expect(processAvailable).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('isolates a failed poll and remains schedulable', async () => {
    const timers = new ManualTimers()
    const failure = new Error('remote detail must not stop future polls')
    const processAvailable = vi.fn(async () => {
      throw failure
    })
    const onError = vi.fn()
    const scheduler = createGateCommandScheduler({
      processAvailable,
      onError,
      timers,
    })

    await scheduler.start()

    expect(onError).toHaveBeenCalledWith(failure)
    expect(timers.latestActive()).toBeDefined()
    scheduler.stop()
  })
})
