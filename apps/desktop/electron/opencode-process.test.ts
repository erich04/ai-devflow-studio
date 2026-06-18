import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createOpencodeProcessManager } from './opencode-process'

describe('opencode process manager', () => {
  it('spawns opencode serve on localhost without unsafe flags', async () => {
    const spawned: Array<{ command: string; args: string[] }> = []
    const manager = createOpencodeProcessManager({
      spawnProcess: (command, args) => {
        spawned.push({ command, args })
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
})

function fakeChild(options: { exitOnKill?: boolean } = {}) {
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
    pid: 123,
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  })
  return child
}
