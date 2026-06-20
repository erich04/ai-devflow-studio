import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  buildOpencodeServeArgs,
  listOpencodePermissions,
} from './opencode-http-adapter.js'

export type ManagedOpencodeServer = {
  projectId: string
  baseUrl: string
  child: ManagedOpencodeChild
}

export type ManagedOpencodeChild = {
  exitCode: number | null
  kill(signal?: NodeJS.Signals | number): boolean
  killed: boolean
  pid?: number | undefined
  once(event: 'exit', listener: () => void): unknown
}

export type SpawnOpencodeProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ManagedOpencodeChild

export type OpencodeProcessManagerDeps = {
  spawnProcess?: SpawnOpencodeProcess
  findPort?: () => Promise<number>
  waitUntilReady?: (baseUrl: string) => Promise<void>
  stopTimeoutMs?: number
}

export function createOpencodeProcessManager(deps: OpencodeProcessManagerDeps = {}) {
  const servers = new Map<string, ManagedOpencodeServer>()
  const spawnProcess = deps.spawnProcess ?? spawn
  const findPort = deps.findPort ?? randomLocalPort
  const waitUntilReady = deps.waitUntilReady ?? waitForOpencodeReady
  const stopTimeoutMs = deps.stopTimeoutMs ?? 5_000

  async function ensure(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
  }): Promise<ManagedOpencodeServer> {
    const existing = servers.get(input.projectId)
    if (existing && existing.child.exitCode === null && !existing.child.killed) {
      return existing
    }

    const port = await findPort()
    const baseUrl = `http://127.0.0.1:${port}`
    const child = spawnProcess(
      input.binaryPath,
      buildOpencodeServeArgs({ hostname: '127.0.0.1', port }),
      {
        env: input.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const server: ManagedOpencodeServer = {
      projectId: input.projectId,
      baseUrl,
      child,
    }

    servers.set(input.projectId, server)
    child.once('exit', () => {
      if (servers.get(input.projectId) === server) {
        servers.delete(input.projectId)
      }
    })
    await waitUntilReady(baseUrl)
    return server
  }

  async function stopAll() {
    const shutdowns = Array.from(servers.values()).map((server) =>
      terminateProcessTree(server.child, { timeoutMs: stopTimeoutMs }),
    )
    await Promise.all(shutdowns)
    servers.clear()
  }

  return { ensure, stopAll }
}

export type TerminateProcessTreeOptions = {
  timeoutMs: number
  forceTimeoutMs?: number
  platform?: NodeJS.Platform
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => boolean
}

export async function terminateProcessTree(
  child: ManagedOpencodeChild,
  options: TerminateProcessTreeOptions,
): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })

  const platform = options.platform ?? process.platform
  const killProcess = options.killProcess ?? process.kill
  const canKillProcessGroup = platform !== 'win32' && typeof child.pid === 'number'
  let usedProcessGroup = false

  if (canKillProcessGroup) {
    try {
      killProcess(-child.pid!, 'SIGTERM')
      usedProcessGroup = true
    } catch {
      child.kill()
    }
  } else {
    child.kill()
  }

  const gracefulExit = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), options.timeoutMs)),
  ])
  if (!gracefulExit && child.exitCode === null) {
    if (usedProcessGroup && typeof child.pid === 'number') {
      try {
        killProcess(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGKILL')
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, options.forceTimeoutMs ?? 1_000)),
    ])
  }
}

async function randomLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('Unable to allocate local opencode port'))
      })
    })
  })
}

async function waitForOpencodeReady(baseUrl: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await listOpencodePermissions({ baseUrl })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Timed out waiting for opencode serve at ${baseUrl}`)
}
