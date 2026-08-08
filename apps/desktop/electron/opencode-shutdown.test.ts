import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createOpencodeProcessManager } from './opencode-process'
import { stopOpencodeWithRetry } from './opencode-shutdown'

describe('opencode shutdown', () => {
  it('retries one failed process cleanup before succeeding', async () => {
    const stopAll = vi.fn()
      .mockRejectedValueOnce(new Error('first stop failed'))
      .mockResolvedValueOnce(undefined)

    await expect(stopOpencodeWithRetry({ stopAll })).resolves.toBeUndefined()
    expect(stopAll).toHaveBeenCalledTimes(2)
  })

  it('fails with a generic message after the bounded retry is exhausted', async () => {
    const stopAll = vi.fn()
      .mockRejectedValueOnce(new Error('/private/tmp/runtime-root is busy'))
      .mockRejectedValueOnce(new Error('provider-key-value'))

    await expect(stopOpencodeWithRetry({ stopAll })).rejects.toThrow(
      'opencode process cleanup failed after retry',
    )
    expect(stopAll).toHaveBeenCalledTimes(2)
  })

  it('actually retries a failed runtime-root removal through the real process manager', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      killed: false,
      pid: undefined,
      kill: vi.fn(() => {
        child.killed = true
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit'))
        return true
      }),
    })
    const removeRuntimeRoot = vi.fn()
      .mockRejectedValueOnce(new Error('/private/tmp/runtime-root is busy'))
      .mockResolvedValueOnce(undefined)
    const processManager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/private/tmp/runtime-root',
      removeRuntimeRoot,
    })
    await processManager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    await expect(stopOpencodeWithRetry(processManager)).resolves.toBeUndefined()
    expect(removeRuntimeRoot).toHaveBeenCalledTimes(2)
  })
})
