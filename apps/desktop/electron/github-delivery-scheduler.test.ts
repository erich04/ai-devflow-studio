import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_DELIVERY_POLL_INTERVAL_MS,
  createGitHubDeliveryScheduler,
} from './github-delivery-scheduler'

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

describe('GitHub Delivery scheduler', () => {
  it('recovers immediately and then uses the bounded default interval', async () => {
    const timers = new ManualTimers()
    const recoverAndAdvance = vi.fn(async () => ({ results: [] }))
    const scheduler = createGitHubDeliveryScheduler({
      recoverAndAdvance,
      onError: vi.fn(),
      timers,
    })

    await scheduler.start()

    expect(recoverAndAdvance).toHaveBeenCalledOnce()
    expect(timers.latestActive()).toMatchObject({
      delayMs: GITHUB_DELIVERY_POLL_INTERVAL_MS,
    })
    scheduler.stop()
  })

  it('coalesces repeated wakes while a recovery cycle is active', async () => {
    const timers = new ManualTimers()
    let release!: () => void
    const first = new Promise<{ results: [] }>((resolve) => {
      release = () => resolve({ results: [] })
    })
    const recoverAndAdvance = vi
      .fn<() => Promise<{ results: [] }>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ results: [] })
    const scheduler = createGitHubDeliveryScheduler({
      recoverAndAdvance,
      onError: vi.fn(),
      timers,
    })

    const starting = scheduler.start()
    await vi.waitFor(() => expect(recoverAndAdvance).toHaveBeenCalledOnce())
    const wakes = [scheduler.wake(), scheduler.wake(), scheduler.wake()]
    release()
    await Promise.all([starting, ...wakes])

    expect(recoverAndAdvance).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('isolates one failed cycle and remains schedulable', async () => {
    const timers = new ManualTimers()
    const failure = new Error('remote detail must remain outside renderer state')
    const onError = vi.fn()
    const scheduler = createGitHubDeliveryScheduler({
      recoverAndAdvance: vi.fn(async () => {
        throw failure
      }),
      onError,
      timers,
    })

    await scheduler.start()

    expect(onError).toHaveBeenCalledWith(failure)
    expect(timers.latestActive()).toBeDefined()
    scheduler.stop()
  })
})
