import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  runFixedProcess,
  runLinuxPackagedSmoke,
} from './run-v15-packaged-smoke-linux.mjs'

describe('Linux packaged GitHub Delivery smoke credential boundary', () => {
  it('unlocks Secret Service before launching the packaged smoke', async () => {
    const runProcess = vi.fn(async () => undefined)

    await runLinuxPackagedSmoke({
      platform: 'linux',
      sessionBusAddress: 'unix:path=/tmp/devflow-test-bus',
      runProcess,
    })

    expect(runProcess).toHaveBeenCalledTimes(2)
    expect(runProcess.mock.calls[0]?.[0]).toBe('gnome-keyring-daemon')
    expect(runProcess.mock.calls[0]?.[1]).toEqual([
      '--unlock',
      '--components=secrets',
    ])
    expect(runProcess.mock.calls[0]?.[2]).toMatchObject({
      inheritOutput: false,
      timeoutMs: 15_000,
    })
    expect(runProcess.mock.calls[0]?.[2]?.input).toMatch(/^[A-Za-z0-9_-]{40,}\n$/u)
    expect(runProcess.mock.calls[1]).toEqual([
      'xvfb-run',
      ['-a', 'corepack', 'pnpm', 'test:v15-github-delivery-packaged-smoke'],
      { inheritOutput: true, timeoutMs: 900_000 },
    ])
  })

  it('fails before spawning when Linux or its isolated D-Bus session is absent', async () => {
    const runProcess = vi.fn(async () => undefined)

    await expect(
      runLinuxPackagedSmoke({
        platform: 'darwin',
        sessionBusAddress: 'unix:path=/tmp/devflow-test-bus',
        runProcess,
      }),
    ).rejects.toThrow('linux_packaged_smoke_requires_linux')
    await expect(
      runLinuxPackagedSmoke({
        platform: 'linux',
        sessionBusAddress: '',
        runProcess,
      }),
    ).rejects.toThrow('linux_packaged_smoke_requires_dbus_session')
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('terminates the whole process group and waits for exit after a timeout', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    })
    const signals: string[] = []

    const result = runFixedProcess('bounded-command', [], {
      timeoutMs: 2,
      terminationGraceMs: 2,
      finalWaitMs: 6,
      spawnProcess: vi.fn(() => child),
      sendSignal: vi.fn((_child, signal) => signals.push(signal)),
    })

    await expect(result).rejects.toThrow('linux_packaged_smoke_process_timeout')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL'])
  })

  it('still kills the process group when its leader exits after TERM', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4243,
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    })
    const signals: string[] = []
    let settled = false

    const result = runFixedProcess('bounded-command', [], {
      timeoutMs: 2,
      terminationGraceMs: 4,
      finalWaitMs: 8,
      spawnProcess: vi.fn(() => child),
      sendSignal: vi.fn((_child, signal) => {
        signals.push(signal)
        if (signal === 'SIGTERM') {
          queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
        }
      }),
    }).finally(() => {
      settled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(settled).toBe(false)
    await expect(result).rejects.toThrow('linux_packaged_smoke_process_timeout')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL'])
  })
})
