import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createOpencodeProcessManager, terminateProcessTree } from './opencode-process'

describe('opencode process manager', () => {
  it('spawns opencode serve on localhost without unsafe flags', async () => {
    const spawned: Array<{ command: string; args: string[]; options: unknown }> = []
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, options })
        return fakeChild({ exitOnKill: true })
      },
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-test',
      removeRuntimeRoot,
    })

    const server = await manager.ensure({
      projectId: 'local-1',
      binaryPath: 'opencode',
      env: { OPENAI_API_KEY: 'secret' },
    })

    expect(server.baseUrl).toBe('http://127.0.0.1:4097')
    expect(spawned[0]).toEqual({
      command: 'opencode',
      args: ['serve', '--hostname', '127.0.0.1', '--port', '4097'],
      options: expect.objectContaining({
        cwd: '/tmp/devflow-opencode-serve-test',
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore'],
      }),
    })
    expect(spawned[0]?.args.join(' ')).not.toContain('dangerously-skip-permissions')

    await manager.stopAll()
    expect(removeRuntimeRoot).toHaveBeenCalledWith('/tmp/devflow-opencode-serve-test')
  })

  it('reuses a live process for the same project and stops it on shutdown', async () => {
    const child = fakeChild({ exitOnKill: true })
    const kill = vi.spyOn(child, 'kill')
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
    })

    const first = await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })
    const second = await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    expect(second).toBe(first)

    await manager.stopAll()
    expect(kill).toHaveBeenCalled()
  })

  it('terminates the child and removes its isolated runtime root when readiness fails', async () => {
    const child = fakeChild({ exitOnKill: true })
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => {
        throw new Error('not ready')
      },
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-failed',
      removeRuntimeRoot,
    })

    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} }),
    ).rejects.toThrow('not ready')

    expect(child.kill).toHaveBeenCalled()
    expect(removeRuntimeRoot).toHaveBeenCalledTimes(1)
    expect(removeRuntimeRoot).toHaveBeenCalledWith('/tmp/devflow-opencode-serve-failed')
  })

  it('handles an asynchronous spawn error without leaking the runtime root', async () => {
    const child = fakeChild()
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.emit('error', new Error('spawn ENOENT'))
          child.emit('close')
        })
        return child
      },
      findPort: async () => 4097,
      waitUntilReady: async () => new Promise<void>(() => undefined),
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-missing',
      removeRuntimeRoot,
    })

    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'missing-opencode', env: {} }),
    ).rejects.toThrow('spawn ENOENT')

    expect(removeRuntimeRoot).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent startup for the same project', async () => {
    const child = fakeChild({ exitOnKill: true })
    const spawnProcess = vi.fn(() => child)
    let markReady!: () => void
    const manager = createOpencodeProcessManager({
      spawnProcess,
      findPort: async () => 4097,
      waitUntilReady: async () => new Promise<void>((resolve) => {
        markReady = resolve
      }),
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-shared',
      removeRuntimeRoot: async () => undefined,
    })

    const first = manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))
    const second = manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })
    let secondResolved = false
    void second.then(() => {
      secondResolved = true
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    markReady()

    const [firstServer, secondServer] = await Promise.all([first, second])
    expect(secondServer).toBe(firstServer)
    await manager.stopAll()
  })

  it('prevents a pending startup from escaping a concurrent stop', async () => {
    const spawnProcess = vi.fn(() => fakeChild())
    let providePort!: () => void
    const manager = createOpencodeProcessManager({
      spawnProcess,
      findPort: async () => new Promise<number>((resolve) => {
        providePort = () => resolve(4097)
      }),
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-stopping',
      removeRuntimeRoot: async () => undefined,
    })

    const startup = manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })
    await vi.waitFor(() => expect(providePort).toBeTypeOf('function'))
    const stopped = manager.stopAll()
    providePort()

    await expect(startup).rejects.toThrow('opencode process manager is stopping')
    await stopped
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('cancels a spawned startup without waiting for readiness during shutdown', async () => {
    const child = fakeChild({ exitOnKill: true })
    const spawnProcess = vi.fn(() => child)
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess,
      findPort: async () => 4097,
      waitUntilReady: async () => new Promise<void>(() => undefined),
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-cancelled',
      removeRuntimeRoot,
    })

    const startup = manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

    const stopped = manager.stopAll()

    await expect(startup).rejects.toThrow('opencode process manager is stopping')
    await stopped
    expect(child.kill).toHaveBeenCalled()
    expect(removeRuntimeRoot).toHaveBeenCalledWith('/tmp/devflow-opencode-serve-cancelled')
  })

  it('rejects startup and cleans the runtime root when the child exits before readiness', async () => {
    const child = fakeChild()
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.exitCode = 1
          child.emit('exit')
          child.emit('close')
        })
        return child
      },
      findPort: async () => 4097,
      waitUntilReady: async () => new Promise<void>(() => undefined),
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-exited',
      removeRuntimeRoot,
    })

    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} }),
    ).rejects.toThrow('opencode serve exited before becoming ready')
    expect(removeRuntimeRoot).toHaveBeenCalledTimes(1)
  })

  it('cleans the runtime root after an unexpected post-readiness exit', async () => {
    const child = fakeChild()
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-exited-late',
      removeRuntimeRoot,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    child.exitCode = 1
    child.emit('exit')
    child.emit('close')
    await vi.waitFor(() => expect(removeRuntimeRoot).toHaveBeenCalledTimes(1))
  })

  it('terminates surviving POSIX descendants before cleaning an unexpectedly exited server', async () => {
    const child = fakeChild({ pid: 1234 })
    let groupAlive = true
    const killProcess = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 'SIGKILL') {
        groupAlive = false
      }
      if (signal === 0 && !groupAlive) {
        throw processNotFoundError()
      }
      return true
    })
    const removeRuntimeRoot = vi.fn(async () => {
      expect(groupAlive).toBe(false)
    })
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-descendants',
      removeRuntimeRoot,
      platform: 'darwin',
      killProcess,
      stopTimeoutMs: 1,
      forceStopTimeoutMs: 10,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    child.exitCode = 1
    child.emit('exit')

    await vi.waitFor(() => expect(removeRuntimeRoot).toHaveBeenCalledTimes(1))
    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGKILL')
    await expect(manager.stopAll()).resolves.toBeUndefined()
  })

  it('does not replace an unexpectedly exited server while its process group is still stopping', async () => {
    const child = fakeChild({ pid: 1234 })
    const spawnProcess = vi.fn(() => child)
    let groupAlive = true
    const killProcess = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 && !groupAlive) {
        throw processNotFoundError()
      }
      return true
    })
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-no-replacement',
      removeRuntimeRoot,
      platform: 'darwin',
      killProcess,
      stopTimeoutMs: 100,
      forceStopTimeoutMs: 10,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    child.exitCode = 1
    child.emit('exit')
    await vi.waitFor(() => expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGTERM'))

    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} }),
    ).rejects.toThrow('opencode process is not ready and could not be replaced')
    expect(spawnProcess).toHaveBeenCalledTimes(1)

    groupAlive = false
    await manager.stopAll()
    expect(removeRuntimeRoot).toHaveBeenCalledTimes(1)
  })

  it('reports surviving descendants from unexpected exit during shutdown', async () => {
    const child = fakeChild({ pid: 1234 })
    const killProcess = vi.fn(() => true)
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-descendants-stuck',
      removeRuntimeRoot,
      platform: 'darwin',
      killProcess,
      stopTimeoutMs: 1,
      forceStopTimeoutMs: 1,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    child.exitCode = 1
    child.emit('exit')

    await expect(manager.stopAll()).rejects.toThrow('opencode process cleanup failed')
    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGKILL')
    expect(removeRuntimeRoot).not.toHaveBeenCalled()
  })

  it('reports an unexpected-exit runtime root cleanup failure during shutdown', async () => {
    const child = fakeChild()
    const removeRuntimeRoot = vi.fn(async () => {
      throw new Error('runtime root busy')
    })
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-cleanup-failed',
      removeRuntimeRoot,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    child.exitCode = 1
    child.emit('exit')
    child.emit('close')
    await vi.waitFor(() => expect(removeRuntimeRoot).toHaveBeenCalledTimes(1))

    await expect(manager.stopAll()).rejects.toThrow('opencode process cleanup failed')
  })

  it('removes the runtime root when spawn throws synchronously', async () => {
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => {
        throw new Error('synchronous spawn failure')
      },
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-sync-failure',
      removeRuntimeRoot,
    })

    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} }),
    ).rejects.toThrow('synchronous spawn failure')
    expect(removeRuntimeRoot).toHaveBeenCalledTimes(1)
  })

  it('waits for the opencode child process to exit during shutdown', async () => {
    const child = fakeChild()
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    let stopped = false
    const stopPromise = manager.stopAll().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(stopped).toBe(false)
    child.exitCode = 0
    child.emit('exit')
    await stopPromise
    expect(stopped).toBe(true)
  })

  it('force kills the opencode child when graceful shutdown times out', async () => {
    const child = fakeChild({ exitOnForceKill: true })
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      stopTimeoutMs: 1,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    await manager.stopAll()

    expect(child.kill).toHaveBeenCalledWith()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('retains a live child after a failed forced stop so shutdown can be retried', async () => {
    const child = fakeChild({ forceKillExitAttempt: 2 })
    const removeRuntimeRoot = vi.fn(async () => undefined)
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
      createRuntimeRoot: async () => '/tmp/devflow-opencode-serve-retry-stop',
      removeRuntimeRoot,
      stopTimeoutMs: 1,
      forceStopTimeoutMs: 1,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    await expect(manager.stopAll()).rejects.toThrow('opencode process cleanup failed')
    expect(removeRuntimeRoot).not.toHaveBeenCalled()
    await expect(
      manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} }),
    ).rejects.toThrow('opencode process is not ready and could not be replaced')

    await manager.stopAll()
    expect(child.kill).toHaveBeenCalledTimes(4)
    expect(removeRuntimeRoot).toHaveBeenCalledWith('/tmp/devflow-opencode-serve-retry-stop')
  })

  it('deduplicates concurrent shutdown calls', async () => {
    const child = fakeChild()
    const manager = createOpencodeProcessManager({
      spawnProcess: () => child,
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
    })
    await manager.ensure({ projectId: 'local-1', binaryPath: 'opencode', env: {} })

    const first = manager.stopAll()
    const second = manager.stopAll()

    expect(second).toBe(first)
    child.exitCode = 0
    child.emit('exit')
    await first
  })

  it('fails when the opencode child remains alive after forced termination', async () => {
    const child = fakeChild()

    await expect(
      terminateProcessTree(child, {
        platform: 'win32',
        timeoutMs: 1,
        forceTimeoutMs: 1,
      }),
    ).rejects.toThrow('opencode process did not exit after forced termination')
  })

  it('terminates the opencode process group when a pid is available on POSIX', async () => {
    const child = fakeChild({ pid: 1234 })
    let groupAlive = true
    const killProcess = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 && !groupAlive) {
        throw processNotFoundError()
      }
      return true
    })

    const stopPromise = terminateProcessTree(child, {
      platform: 'darwin',
      timeoutMs: 10,
      killProcess,
    })
    await Promise.resolve()
    groupAlive = false
    child.exitCode = 0
    child.emit('exit')
    await stopPromise

    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('force kills a POSIX process group when its leader exits but descendants remain', async () => {
    const child = fakeChild({ pid: 1234 })
    let groupAlive = true
    const killProcess = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 'SIGTERM') {
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit'))
      }
      if (signal === 'SIGKILL') {
        groupAlive = false
      }
      if (signal === 0 && !groupAlive) {
        throw processNotFoundError()
      }
      return true
    })

    await terminateProcessTree(child, {
      platform: 'darwin',
      timeoutMs: 1,
      forceTimeoutMs: 10,
      killProcess,
    })

    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('fails when POSIX process-group descendants survive forced termination', async () => {
    const child = fakeChild({ pid: 1234 })
    const killProcess = vi.fn((_pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 'SIGTERM') {
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit'))
      }
      return true
    })

    await expect(terminateProcessTree(child, {
      platform: 'darwin',
      timeoutMs: 1,
      forceTimeoutMs: 1,
      killProcess,
    })).rejects.toThrow('opencode process group did not exit after forced termination')

    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGKILL')
  })

  it('falls back to child.kill when no pid is available', async () => {
    const child = fakeChild({ pid: undefined, exitOnKill: true })
    const killProcess = vi.fn(() => true)

    await terminateProcessTree(child, {
      platform: 'darwin',
      timeoutMs: 10,
      killProcess,
    })

    expect(killProcess).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledWith()
  })
})

function fakeChild(options: {
  exitOnForceKill?: boolean
  exitOnKill?: boolean
  forceKillExitAttempt?: number
  pid?: number | undefined
} = {}) {
  let forceKillAttempts = 0
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn((signal?: NodeJS.Signals | number) => {
      child.killed = true
      if (signal === 'SIGKILL') {
        forceKillAttempts += 1
      }
      if (
        options.exitOnKill ||
        (options.exitOnForceKill && signal === 'SIGKILL') ||
        (options.forceKillExitAttempt === forceKillAttempts && signal === 'SIGKILL')
      ) {
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit'))
      }
      return true
    }),
    ...(options.pid === undefined ? {} : { pid: options.pid }),
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  })
  return child
}

function processNotFoundError() {
  return Object.assign(new Error('process group not found'), { code: 'ESRCH' })
}
