import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit' | 'close', listener: () => void): unknown
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
  createRuntimeRoot?: () => Promise<string>
  removeRuntimeRoot?: (runtimeRoot: string) => Promise<void>
  stopTimeoutMs?: number
  forceStopTimeoutMs?: number
  platform?: NodeJS.Platform
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => boolean
}

export function createOpencodeProcessManager(deps: OpencodeProcessManagerDeps = {}) {
  type InternalManagedOpencodeServer = ManagedOpencodeServer & {
    ready: boolean
    runtimeRoot: string
    runtimeRootCleanup?: Promise<void>
    shutdown?: Promise<void>
  }

  const servers = new Map<string, InternalManagedOpencodeServer>()
  const pendingServers = new Map<string, Promise<InternalManagedOpencodeServer>>()
  const startupCancellations = new Set<() => void>()
  const runtimeRootCleanups = new Set<Promise<void>>()
  const failedRuntimeRootServers = new Set<InternalManagedOpencodeServer>()
  const runtimeRootCleanupFailures = new Map<InternalManagedOpencodeServer, unknown>()
  const processTeardownFailures = new Map<InternalManagedOpencodeServer, unknown>()
  const spawnProcess = deps.spawnProcess ?? spawn
  const findPort = deps.findPort ?? randomLocalPort
  const waitUntilReady = deps.waitUntilReady ?? waitForOpencodeReady
  const createRuntimeRoot = deps.createRuntimeRoot ?? createOpencodeRuntimeRoot
  const removeRuntimeRoot = deps.removeRuntimeRoot ?? removeOpencodeRuntimeRoot
  const stopTimeoutMs = deps.stopTimeoutMs ?? 5_000
  const forceStopTimeoutMs = deps.forceStopTimeoutMs ?? 1_000
  const platform = deps.platform ?? process.platform
  const killProcess = deps.killProcess ?? process.kill
  const stoppingError = new Error('opencode process manager is stopping')
  let activeStop: Promise<void> | undefined
  let stopping = false

  function cleanupRuntimeRoot(server: InternalManagedOpencodeServer): Promise<void> {
    if (!server.runtimeRootCleanup) {
      const cleanup = removeRuntimeRoot(server.runtimeRoot)
      server.runtimeRootCleanup = cleanup
      runtimeRootCleanups.add(cleanup)
      void cleanup.then(
        () => {
          runtimeRootCleanups.delete(cleanup)
          failedRuntimeRootServers.delete(server)
          runtimeRootCleanupFailures.delete(server)
        },
        (error) => {
          runtimeRootCleanups.delete(cleanup)
          if (server.runtimeRootCleanup === cleanup) {
            delete server.runtimeRootCleanup
          }
          failedRuntimeRootServers.add(server)
          runtimeRootCleanupFailures.set(server, error)
        },
      )
    }
    return server.runtimeRootCleanup
  }

  async function awaitRuntimeRootCleanup(server: InternalManagedOpencodeServer): Promise<void> {
    try {
      await cleanupRuntimeRoot(server)
    } catch (error) {
      if (runtimeRootCleanupFailures.get(server) === error) {
        runtimeRootCleanupFailures.delete(server)
      }
      throw error
    }
  }

  async function ensure(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
  }): Promise<ManagedOpencodeServer> {
    if (stopping) {
      throw stoppingError
    }
    const pending = pendingServers.get(input.projectId)
    if (pending) {
      return pending
    }

    const existing = servers.get(input.projectId)
    if (existing) {
      if (existing.ready && existing.child.exitCode === null) {
        return existing
      }
      throw new Error('opencode process is not ready and could not be replaced')
    }

    const startup = startServer(input)
    pendingServers.set(input.projectId, startup)
    try {
      return await startup
    } finally {
      if (pendingServers.get(input.projectId) === startup) {
        pendingServers.delete(input.projectId)
      }
    }
  }

  async function startServer(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
  }): Promise<InternalManagedOpencodeServer> {
    const port = await findPort()
    if (stopping) {
      throw stoppingError
    }
    const baseUrl = `http://127.0.0.1:${port}`
    const runtimeRoot = await createRuntimeRoot()
    if (stopping) {
      await removeRuntimeRoot(runtimeRoot)
      throw stoppingError
    }
    let child: ManagedOpencodeChild
    try {
      child = spawnProcess(
        input.binaryPath,
        buildOpencodeServeArgs({ hostname: '127.0.0.1', port }),
        {
          cwd: runtimeRoot,
          env: input.env,
          detached: platform !== 'win32',
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      )
    } catch (error) {
      try {
        await removeRuntimeRoot(runtimeRoot)
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'opencode serve failed to spawn and its runtime root could not be removed',
        )
      }
      throw error
    }
    const server: InternalManagedOpencodeServer = {
      projectId: input.projectId,
      baseUrl,
      child,
      ready: false,
      runtimeRoot,
    }

    servers.set(input.projectId, server)
    let startupComplete = false
    let terminal = false
    let startupError: Error | undefined
    let rejectStartup!: (error: Error) => void
    const startupFailure = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject
    })
    const cancelStartup = () => rejectStartup(stoppingError)
    startupCancellations.add(cancelStartup)
    const handleTerminal = () => {
      if (terminal) {
        return
      }
      terminal = true
      if (!startupComplete) {
        rejectStartup(startupError ?? new Error('opencode serve exited before becoming ready'))
        return
      }
      void shutdownServer(server).catch(() => undefined)
    }
    child.once('error', (error) => {
      if (!startupComplete) {
        startupError = error
        rejectStartup(error)
      }
    })
    child.once('exit', handleTerminal)
    child.once('close', handleTerminal)
    try {
      if (stopping) {
        throw stoppingError
      }
      await Promise.race([waitUntilReady(baseUrl), startupFailure])
      if (stopping) {
        throw stoppingError
      }
      if (terminal || child.exitCode !== null || child.killed) {
        throw startupError ?? new Error('opencode serve exited before becoming ready')
      }
      startupComplete = true
      server.ready = true
    } catch (error) {
      startupComplete = true
      const spawnFailedBeforePid = Boolean(startupError && child.pid === undefined)
      const teardownErrors: unknown[] = []
      if (spawnFailedBeforePid) {
        if (servers.get(input.projectId) === server) {
          servers.delete(input.projectId)
        }
        try {
          await awaitRuntimeRootCleanup(server)
        } catch (cleanupError) {
          teardownErrors.push(cleanupError)
        }
      } else {
        try {
          await shutdownServer(server)
        } catch (teardownError) {
          teardownErrors.push(teardownError)
        }
      }
      if (teardownErrors.length) {
        throw new AggregateError(
          [error, ...teardownErrors],
          'opencode serve startup failed with additional teardown errors',
        )
      }
      throw error
    } finally {
      startupCancellations.delete(cancelStartup)
    }
    return server
  }

  function shutdownServer(server: InternalManagedOpencodeServer): Promise<void> {
    if (server.shutdown) {
      return server.shutdown
    }
    server.ready = false
    processTeardownFailures.delete(server)
    const shutdown = Promise.resolve().then(async () => {
      try {
        await terminateProcessTree(server.child, {
          timeoutMs: stopTimeoutMs,
          forceTimeoutMs: forceStopTimeoutMs,
          platform,
          killProcess,
        })
      } catch (error) {
        processTeardownFailures.set(server, error)
        throw error
      }
      processTeardownFailures.delete(server)
      if (servers.get(server.projectId) === server) {
        servers.delete(server.projectId)
      }
      await awaitRuntimeRootCleanup(server)
    })
    const trackedShutdown = shutdown.finally(() => {
      if (server.shutdown === trackedShutdown) {
        delete server.shutdown
      }
    })
    server.shutdown = trackedShutdown
    return trackedShutdown
  }

  async function runStopAll(): Promise<void> {
    const pendingEntries = Array.from(pendingServers.entries())
    const cleanupRetryServers = Array.from(failedRuntimeRootServers)
    const pendingProjectIds = new Set(pendingEntries.map(([projectId]) => projectId))
    const attemptedServers = new Set<InternalManagedOpencodeServer>()
    const initialShutdowns: Promise<void>[] = []

    const launchShutdown = (server: InternalManagedOpencodeServer, tasks: Promise<void>[]) => {
      attemptedServers.add(server)
      tasks.push(shutdownServer(server))
    }

    for (const server of servers.values()) {
      if (!pendingProjectIds.has(server.projectId)) {
        launchShutdown(server, initialShutdowns)
      }
    }
    for (const cancelStartup of startupCancellations) {
      cancelStartup()
    }

    const [pendingShutdowns, initialShutdownResults, cleanupRetryResults] = await Promise.all([
      Promise.allSettled(pendingEntries.map(([, startup]) => startup)),
      Promise.allSettled(initialShutdowns),
      Promise.allSettled(cleanupRetryServers.map((server) => awaitRuntimeRootCleanup(server))),
    ])
    const failedPendingProjects = new Set(
      pendingShutdowns.flatMap((result, index) =>
        result.status === 'rejected' && result.reason !== stoppingError
          ? [pendingEntries[index]![0]]
          : []),
    )
    const trailingShutdowns: Promise<void>[] = []
    for (const server of servers.values()) {
      if (!attemptedServers.has(server) && !failedPendingProjects.has(server.projectId)) {
        launchShutdown(server, trailingShutdowns)
      }
    }
    const trailingShutdownResults = await Promise.allSettled(trailingShutdowns)
    await Promise.allSettled(Array.from(runtimeRootCleanups))
    const failures = [
      ...pendingShutdowns.flatMap((result) =>
        result.status === 'rejected' && result.reason !== stoppingError ? [result.reason] : []),
      ...[...initialShutdownResults, ...trailingShutdownResults].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []),
      ...cleanupRetryResults.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []),
      ...runtimeRootCleanupFailures.values(),
      ...processTeardownFailures.values(),
    ]
    runtimeRootCleanupFailures.clear()
    processTeardownFailures.clear()
    if (failures.length) {
      throw new AggregateError(failures, 'opencode process cleanup failed')
    }
  }

  function stopAll(): Promise<void> {
    if (activeStop) {
      return activeStop
    }
    stopping = true
    const stop = runStopAll()
    const trackedStop = stop.finally(() => {
      if (activeStop === trackedStop) {
        activeStop = undefined
        stopping = false
      }
    })
    activeStop = trackedStop
    return trackedStop
  }

  return { ensure, stopAll }
}

async function createOpencodeRuntimeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'devflow-opencode-serve-'))
}

async function removeOpencodeRuntimeRoot(runtimeRoot: string): Promise<void> {
  await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
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
  const platform = options.platform ?? process.platform
  const killProcess = options.killProcess ?? process.kill
  const canKillProcessGroup = platform !== 'win32' && typeof child.pid === 'number'

  if (canKillProcessGroup) {
    const groupId = child.pid!
    if (!isProcessGroupAlive(killProcess, groupId)) {
      return
    }
    try {
      killProcess(-groupId, 'SIGTERM')
    } catch {
      if (!isProcessGroupAlive(killProcess, groupId)) {
        return
      }
      throw new Error('opencode process group could not be terminated')
    }
    if (await waitForProcessGroupExit(killProcess, groupId, options.timeoutMs)) {
      return
    }
    try {
      killProcess(-groupId, 'SIGKILL')
    } catch {
      if (!isProcessGroupAlive(killProcess, groupId)) {
        return
      }
      throw new Error('opencode process group could not be force terminated')
    }
    if (!(await waitForProcessGroupExit(killProcess, groupId, options.forceTimeoutMs ?? 1_000))) {
      throw new Error('opencode process group did not exit after forced termination')
    }
    return
  }

  if (child.exitCode !== null) {
    return
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  child.kill()
  const gracefulExit = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), options.timeoutMs)),
  ])
  if (!gracefulExit && child.exitCode === null) {
    child.kill('SIGKILL')
    const forcedExit = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), options.forceTimeoutMs ?? 1_000)),
    ])
    if (!forcedExit && child.exitCode === null) {
      throw new Error('opencode process did not exit after forced termination')
    }
  }
}

function isProcessGroupAlive(
  killProcess: NonNullable<TerminateProcessTreeOptions['killProcess']>,
  groupId: number,
): boolean {
  try {
    return killProcess(-groupId, 0)
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

async function waitForProcessGroupExit(
  killProcess: NonNullable<TerminateProcessTreeOptions['killProcess']>,
  groupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (isProcessGroupAlive(killProcess, groupId)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining)))
  }
  return true
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
