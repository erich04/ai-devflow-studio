import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isolatedOpencodeProfileEnv } from './opencode-profile-isolation.js'
import { opencodeTaskPluginSource, type OpencodeTaskPolicy } from './opencode-task-guard.js'
import { buildOpenCodeManagedPrompt } from './opencode-permission-policy.js'
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

export type EnsureManagedOpencodeServerInput = {
  /** Coding owns a separate process slot with the question tool enabled. */
  profile?: 'coding'
  projectId: string
  binaryPath: string
  env: NodeJS.ProcessEnv
  taskPolicy?: OpencodeTaskPolicy
  /**
   * A non-secret digest or version that represents the saved project-level
   * OpenCode configuration. The manager combines it with the binary and
   * environment before caching a process.
   */
  configurationFingerprint?: string
}

export function createOpencodeProcessManager(deps: OpencodeProcessManagerDeps = {}) {
  type InternalManagedOpencodeServer = ManagedOpencodeServer & {
    fingerprint: string
    key: string
    ready: boolean
    runtimeRoot: string
    runtimeRootCleanup?: Promise<void>
    shutdown?: Promise<void>
  }

  const servers = new Map<string, InternalManagedOpencodeServer>()
  const pendingServers = new Map<string, {
    fingerprint: string
    promise: Promise<InternalManagedOpencodeServer>
  }>()
  const startupCancellations = new Map<string, Set<() => void>>()
  const runtimeRootCleanups = new Set<Promise<void>>()
  const failedRuntimeRootServers = new Set<InternalManagedOpencodeServer>()
  const runtimeRootCleanupFailures = new Map<InternalManagedOpencodeServer, unknown>()
  const processTeardownFailures = new Map<InternalManagedOpencodeServer, unknown>()
  const spawnProcess = deps.spawnProcess ?? spawn
  const findPort = deps.findPort ?? randomLocalPort
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

  async function ensure(input: EnsureManagedOpencodeServerInput): Promise<ManagedOpencodeServer> {
    if (stopping) {
      throw stoppingError
    }
    const key = processKey(input)
    const fingerprint = createOpencodeProcessFingerprint(input)
    const pending = pendingServers.get(key)
    if (pending) {
      if (pending.fingerprint === fingerprint) {
        return pending.promise
      }
      try {
        await pending.promise
      } catch {
        // Startup owns its own teardown. Re-evaluate the requested configuration
        // after it reaches a terminal state rather than reusing its failure.
      }
      return ensure(input)
    }

    const existing = servers.get(processKey(input))
    if (existing) {
      if (existing.ready && existing.child.exitCode === null) {
        if (existing.fingerprint === fingerprint) {
          return existing
        }
        await shutdownServer(existing)
        return ensure(input)
      }
      throw new Error('opencode process is not ready and could not be replaced')
    }

    const startup = startServer(input, fingerprint)
    pendingServers.set(key, { fingerprint, promise: startup })
    try {
      return await startup
    } finally {
      if (pendingServers.get(key)?.promise === startup) {
        pendingServers.delete(key)
      }
    }
  }

  async function startServer(
    input: EnsureManagedOpencodeServerInput,
    fingerprint: string,
  ): Promise<InternalManagedOpencodeServer> {
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
      const env = input.taskPolicy
        ? await taskEnvironment(input, runtimeRoot, baseUrl)
        : effectiveEnvironment(input)
      child = spawnProcess(
        input.binaryPath,
        buildOpencodeServeArgs({ hostname: '127.0.0.1', port }),
        {
          cwd: runtimeRoot,
          env,
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
      key: processKey(input),
      baseUrl,
      child,
      fingerprint,
      ready: false,
      runtimeRoot,
    }

    servers.set(processKey(input), server)
    let startupComplete = false
    let terminal = false
    let startupError: Error | undefined
    let rejectStartup!: (error: Error) => void
    const startupFailure = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject
    })
    const cancelStartup = () => rejectStartup(stoppingError)
    const projectCancellations = startupCancellations.get(processKey(input)) ?? new Set()
    projectCancellations.add(cancelStartup)
    startupCancellations.set(processKey(input), projectCancellations)
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
      // OpenCode 1.18.15 waits for its plugin SDK installation when a local
      // plugin is configured. A fresh private task profile needs a bounded
      // initialization window; other profiles keep their existing 30 seconds.
      await Promise.race([
        deps.waitUntilReady ? deps.waitUntilReady(baseUrl) : waitForOpencodeReady(baseUrl, input.taskPolicy ? 60_000 : 30_000),
        startupFailure,
      ])
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
        if (servers.get(processKey(input)) === server) {
          servers.delete(processKey(input))
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
      projectCancellations.delete(cancelStartup)
      if (projectCancellations.size === 0) {
        startupCancellations.delete(processKey(input))
      }
    }
    return server
  }

  async function stopProject(projectId: string): Promise<void> {
    const failures: unknown[] = []
    const projectServers = new Set<InternalManagedOpencodeServer>()
    for (const profile of [undefined, 'coding'] as const) {
      const key = processKey({ projectId, ...(profile ? { profile } : {}) })
      for (const cancelStartup of startupCancellations.get(key) ?? []) cancelStartup()
      const pending = pendingServers.get(key)
      if (pending) await pending.promise.catch(() => undefined)
      const server = servers.get(key)
      if (server) {
        projectServers.add(server)
        try { await shutdownServer(server) } catch (error) { failures.push(error) }
      }
    }
    for (const failedServer of failedRuntimeRootServers) {
      if (failedServer.projectId !== projectId || projectServers.has(failedServer)) continue
      try {
        await awaitRuntimeRootCleanup(failedServer)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `opencode process cleanup failed for project ${projectId}`)
    }
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
      if (servers.get(server.key) === server) {
        servers.delete(server.key)
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
      if (!pendingProjectIds.has(server.key)) {
        launchShutdown(server, initialShutdowns)
      }
    }
    for (const projectCancellations of startupCancellations.values()) {
      for (const cancelStartup of projectCancellations) {
        cancelStartup()
      }
    }

    const [pendingShutdowns, initialShutdownResults, cleanupRetryResults] = await Promise.all([
      Promise.allSettled(pendingEntries.map(([, startup]) => startup.promise)),
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
      if (!attemptedServers.has(server) && !failedPendingProjects.has(server.key)) {
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

  return { ensure, stopAll, stopProject }
}

function processKey(input: Pick<EnsureManagedOpencodeServerInput, 'projectId' | 'profile'>): string {
  return JSON.stringify([input.projectId, input.profile ?? 'default'])
}

function effectiveEnvironment(input: EnsureManagedOpencodeServerInput): NodeJS.ProcessEnv {
  return { ...input.env, OPENCODE_CLIENT: 'server', OPENCODE_ENABLE_QUESTION_TOOL: input.profile === 'coding' ? 'true' : 'false' }
}

function createOpencodeProcessFingerprint(input: EnsureManagedOpencodeServerInput): string {
  const environment = Object.entries(effectiveEnvironment(input))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
  return createHash('sha256')
    .update(JSON.stringify({
      binaryPath: input.binaryPath,
      configurationFingerprint: input.configurationFingerprint ?? '',
      taskPolicy: input.taskPolicy,
      environment,
    }))
    .digest('hex')
}

async function taskEnvironment(input: EnsureManagedOpencodeServerInput, runtimeRoot: string, baseUrl: string): Promise<NodeJS.ProcessEnv> {
  const policy = input.taskPolicy!
  if (input.profile !== 'coding') throw new Error('Bounded tasks require the coding process profile')
  const config = JSON.parse(input.env.OPENCODE_CONFIG_CONTENT ?? '{}') as Record<string, unknown>
  if (!config.provider || typeof config.provider !== 'object' || !(policy.providerID in config.provider)) {
    throw new Error('Bounded tasks require a saved, governed Provider binding')
  }
  // OpenCode installs its matched plugin SDK in this private config directory.
  // Keeping the file alongside node_modules makes resolution independent of user/repo packages.
  const pluginDirectory = join(runtimeRoot, 'config', 'opencode')
  await mkdir(pluginDirectory, { recursive: true, mode: 0o700 })
  const pluginPath = join(pluginDirectory, 'devflow-task-guard.mjs')
  await writeFile(pluginPath, opencodeTaskPluginSource(policy, baseUrl), { mode: 0o600, flag: 'wx' })
  const model = `${policy.providerID}/${policy.modelID}`
  const toolDiscipline = [
    'Each assistant response may contain at most one tool_call. Never call tools in parallel, including read-only tools; wait for its result before choosing the next call.',
    `The parent and all children share ${policy.maxToolTurns} tool attempts for this entire run. Rejected attempts also consume this budget; delegation does not reset it.`,
    'Read each relevant file once unless it changes or the earlier result was incomplete. Reuse the known contents and delegate narrowly without duplicating the parent\'s inspection.',
    'Plan the necessary calls before acting and reserve tool attempts for the required edits and checks. Combine related changes to the same file into one edit where practical; avoid repeated status checks and unchanged file reads.',
    'DevFlow independently runs the configured final test after your edits. Report the changes and any uncompleted work accurately; do not claim tests passed without evidence or spend the remaining budget repeating the same check.',
  ].join('\n')
  const env: NodeJS.ProcessEnv = { ...effectiveEnvironment(input), ...isolatedOpencodeProfileEnv(runtimeRoot, { isolateHome: true }),
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, plugin: [pathToFileURL(pluginPath).href],
      model, small_model: model, default_agent: 'devflow-coding', subagent_depth: 1,
      agent: {
        'devflow-coding': { mode: 'primary', model, steps: policy.maxModelCalls, description: 'DevFlow managed coding',
          prompt: `Work only inside the managed repository. Delegate only to devflow-worker, one foreground task at a time; wait for it to finish before other tools. Task prompts must be plain text, with no @ file or agent mentions; ask the child to use read tools instead. Task and tool limits apply across the whole run. A child question or permission is handled by DevFlow. Never bypass a denied operation.\n${toolDiscipline}` },
        'devflow-worker': { mode: 'subagent', model, steps: policy.maxModelCalls, description: 'One bounded coding subtask in the same managed worktree',
          prompt: buildOpenCodeManagedPrompt(`Complete this bounded subtask in the managed repository. Use the native read, edit and question tools and request approval for commands. Do not delegate further or run in the background.\n${toolDiscipline}`) },
      },
    }) }
  delete env.OPENCODE_CONFIG
  delete env.OPENCODE_CONFIG_DIR
  await mkdir(env.HOME!, { recursive: true, mode: 0o700 })
  return env
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

async function waitForOpencodeReady(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // A connected request may initialize OpenCode's isolated profile/plugins.
      // Give it the remaining startup window; a one-second per-poll timeout
      // repeatedly cancels that initialization and can prevent readiness forever.
      await listOpencodePermissions({ baseUrl, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(500, deadline - Date.now()))))
    }
  }

  throw new Error(`Timed out waiting for opencode serve at ${baseUrl}`)
}
