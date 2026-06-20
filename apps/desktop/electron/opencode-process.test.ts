import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createOpencodeProcessManager, terminateProcessTree } from './opencode-process'

describe('opencode process manager', () => {
  it('spawns opencode serve on localhost without unsafe flags', async () => {
    const spawned: Array<{ command: string; args: string[]; options: unknown }> = []
    const manager = createOpencodeProcessManager({
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, options })
        return fakeChild()
      },
      findPort: async () => 4097,
      waitUntilReady: async () => undefined,
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
        detached: process.platform !== 'win32',
      }),
    })
    expect(spawned[0]?.args.join(' ')).not.toContain('dangerously-skip-permissions')
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
    const child = fakeChild()
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

  it('terminates the opencode process group when a pid is available on POSIX', async () => {
    const child = fakeChild({ pid: 1234 })
    const killProcess = vi.fn(() => true)

    const stopPromise = terminateProcessTree(child, {
      platform: 'darwin',
      timeoutMs: 10,
      killProcess,
    })
    await Promise.resolve()
    child.exitCode = 0
    child.emit('exit')
    await stopPromise

    expect(killProcess).toHaveBeenCalledWith(-1234, 'SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
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

function fakeChild(options: { exitOnKill?: boolean; pid?: number | undefined } = {}) {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      if (options.exitOnKill) {
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
