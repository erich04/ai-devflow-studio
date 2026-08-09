import {
  redactSecrets,
  sanitizeCodingDiffArtifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
} from '@ai-devflow/shared'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { CodingEngineAdapter, CodingEngineStartInput } from './coding-engine.js'
import {
  CodingEngineContinuationCleanupError,
  CodingEnginePermissionDiscoveryError,
  CodingEngineStartupCleanupError,
} from './coding-engine-lifecycle.js'
import {
  createOpencodeSession,
  createDefaultOpencodePermissionRules,
  abortOpencodeSession,
  listOpencodeDiff,
  listOpencodePermissions,
  replyOpencodePermission,
  sendOpencodeMessage,
  OpencodeMessageResponseError,
  type Fetcher,
  type OpencodePermission,
} from './opencode-http-adapter.js'
import { captureWorktreeDiff, type CapturedWorktreeDiff } from './coding-runner.js'
import { createOpencodeProcessManager, type ManagedOpencodeServer } from './opencode-process.js'

export type OpencodeHttpProcessManager = {
  ensure(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
  }): Promise<Pick<ManagedOpencodeServer, 'baseUrl' | 'child' | 'projectId'>>
}

export type OpencodeHttpCodingEngineConfig = {
  binaryPath: string
  providerID: string
  modelID: string
  apiKeyEnvName?: string
  processManager?: OpencodeHttpProcessManager
  fetcher?: Fetcher
  runtimeEnv?: NodeJS.ProcessEnv
  permissionPollMs?: number
  permissionDiscoveryTimeoutMs?: number
  startupCleanupTimeoutMs?: number
  resolveManagedDirectory?: (directory: string) => string
  captureWorktreeDiff?: (input: { worktreePath: string }) => Promise<CapturedWorktreeDiff>
}

type OpencodeMessagePromise = Promise<
  | { ok: true }
  | { ok: false; error: unknown }
>

type OpencodeRuntimeSession = {
  baseUrl: string
  cleanupPromise?: Promise<void>
  directory: string
  handledPermissionIds: Set<string>
  messagePromise: OpencodeMessagePromise
  nextEventSequence: number
  projectPath: string
  sessionId: string
}

type PendingOpencodeSession = {
  cancelRequested: boolean
  promise: Promise<OpencodeRuntimeSession>
}

export function createOpencodeHttpCodingEngineAdapter(
  config: OpencodeHttpCodingEngineConfig,
): CodingEngineAdapter {
  const processManager = config.processManager ?? createOpencodeProcessManager()
  const sessions = new Map<string, OpencodeRuntimeSession>()
  const pendingSessions = new Map<string, PendingOpencodeSession>()

  function cleanupRegisteredSession(
    codingRunId: string,
    session: OpencodeRuntimeSession,
    phase: 'startup' | 'continuation' | 'cancellation',
  ): Promise<void> {
    if (!session.cleanupPromise) {
      const cleanupPromise = cleanupOpencodeSession({
        baseUrl: session.baseUrl,
        sessionId: session.sessionId,
        directory: session.directory,
        messagePromise: session.messagePromise,
        phase,
        settlementTimeoutMs: config.startupCleanupTimeoutMs ?? 5_000,
        ...fetcherOption(config.fetcher),
      }).then(
        () => {
          if (sessions.get(codingRunId) === session) {
            sessions.delete(codingRunId)
          }
        },
        (error: unknown) => {
          if (session.cleanupPromise === cleanupPromise) {
            delete session.cleanupPromise
          }
          throw error
        },
      )
      session.cleanupPromise = cleanupPromise
    }
    return session.cleanupPromise
  }

  async function failForSessionCleanup(cleanupPromise: Promise<void>): Promise<never> {
    try {
      await cleanupPromise
    } catch (cleanupError) {
      throw new CodingEngineContinuationCleanupError([
        new Error('opencode session cancellation interrupted permission continuation'),
        cleanupError,
      ])
    }
    throw new Error('opencode session was cancelled during permission continuation')
  }

  return {
    engine: 'opencode-http',
    providerId: config.providerID,
    modelId: config.modelID,

    async ensure(input) {
      await processManager.ensure({
        projectId: input.project.id,
        binaryPath: config.binaryPath,
        env: config.runtimeEnv ?? process.env,
      })
      return {
        projectId: input.project.id,
        engine: 'opencode-http',
        status: 'ready',
      }
    },

    async start(input) {
      const resolveManagedDirectory = config.resolveManagedDirectory ?? resolveManagedOpencodeDirectory
      const directory = resolveManagedDirectory(input.workspace.worktreePath)
      if (sessions.has(input.id) || pendingSessions.has(input.id)) {
        throw new Error('opencode session already exists for this coding run')
      }
      let resolvePendingSession: ((session: OpencodeRuntimeSession) => void) | undefined
      let rejectPendingSession: ((error: unknown) => void) | undefined
      const pendingSession = new Promise<OpencodeRuntimeSession>((resolve, reject) => {
        resolvePendingSession = resolve
        rejectPendingSession = reject
      })
      void pendingSession.catch(() => undefined)
      const pendingSessionState: PendingOpencodeSession = {
        cancelRequested: false,
        promise: pendingSession,
      }
      pendingSessions.set(input.id, pendingSessionState)
      let runtimeSession: OpencodeRuntimeSession | undefined
      try {
        const server = await processManager.ensure({
          projectId: input.project.id,
          binaryPath: config.binaryPath,
          env: config.runtimeEnv ?? process.env,
        })
        if (pendingSessionState.cancelRequested) {
          throw new Error('opencode startup was cancelled before session creation')
        }
        const brief = input.brief
        const session = await createOpencodeSession({
          baseUrl: server.baseUrl,
          directory,
          title: `DevFlow ${input.run.title}`,
          model: { providerID: config.providerID, id: config.modelID },
          ...fetcherOption(config.fetcher),
        })
        runtimeSession = {
          baseUrl: server.baseUrl,
          directory,
          handledPermissionIds: new Set(),
          messagePromise: Promise.resolve({ ok: true as const }),
          nextEventSequence: 1,
          projectPath: input.project.path,
          sessionId: session.id,
        }
        sessions.set(input.id, runtimeSession)
        resolvePendingSession?.(runtimeSession)
        await Promise.resolve()
        try {
          const preMessageCleanup = runtimeSession.cleanupPromise
          if (preMessageCleanup) {
            await failForSessionCleanup(preMessageCleanup)
          }
          if (sessions.get(input.id) !== runtimeSession) {
            throw new Error('opencode session ownership changed during startup')
          }
          assertManagedOpencodeSession(session, directory, resolveManagedDirectory)
          const messagePromise = sendOpencodeMessage({
            baseUrl: server.baseUrl,
            sessionId: session.id,
            directory,
            model: { providerID: config.providerID, modelID: config.modelID },
            text: brief.prompt,
            ...fetcherOption(config.fetcher),
          }).then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          )
          runtimeSession.messagePromise = messagePromise
          const permission = await waitForPermission({
            baseUrl: server.baseUrl,
            directory,
            messagePromise,
            pollMs: config.permissionPollMs ?? 1_000,
            sessionId: session.id,
            timeoutMs: config.permissionDiscoveryTimeoutMs ?? 60_000,
            ...fetcherOption(config.fetcher),
          })
          const result = createStartResult(input, brief.prompt, session.id, permission, directory)
          const cleanupPromise = runtimeSession.cleanupPromise
          if (cleanupPromise) {
            await failForSessionCleanup(cleanupPromise)
          }
          if (sessions.get(input.id) !== runtimeSession) {
            throw new Error('opencode session ownership changed during startup')
          }
          runtimeSession.handledPermissionIds.add(permission.id)
          runtimeSession.nextEventSequence = 4
          return result
        } catch (error) {
          try {
            await cleanupRegisteredSession(input.id, runtimeSession, 'startup')
          } catch (cleanupError) {
            throw new CodingEngineStartupCleanupError([error, cleanupError])
          }
          throw error
        }
      } catch (error) {
        if (!runtimeSession) {
          rejectPendingSession?.(error)
        }
        throw error
      } finally {
        if (pendingSessions.get(input.id) === pendingSessionState) {
          pendingSessions.delete(input.id)
        }
      }
    },

    async approvePermission(input) {
      const session = findSession(sessions, input.codingRun.id)
      const replied = await replyOpencodePermission({
        baseUrl: session.baseUrl,
        requestId: input.request.id,
        directory: session.directory,
        reply: 'once',
        message: 'Approved by DevFlow.',
        ...fetcherOption(config.fetcher),
      })
      if (replied !== true) {
        throw new Error('opencode permission reply was not acknowledged')
      }
      session.handledPermissionIds.add(input.request.id)
      try {
        const continuation = await waitForNextPermissionOrMessage({
          baseUrl: session.baseUrl,
          directory: session.directory,
          handledPermissionIds: session.handledPermissionIds,
          messagePromise: session.messagePromise,
          pollMs: config.permissionPollMs ?? 1_000,
          sessionId: session.sessionId,
          ...fetcherOption(config.fetcher),
        })
        if (continuation.kind === 'permission') {
          const eventSequence = session.nextEventSequence
          const result = createContinuationResult(
            input.codingRun,
            input.request,
            input.now,
            continuation.permission,
            eventSequence,
            session.directory,
            session.projectPath,
          )
          const cleanupPromise = session.cleanupPromise
          if (cleanupPromise) {
            await failForSessionCleanup(cleanupPromise)
          }
          session.handledPermissionIds.add(continuation.permission.id)
          session.nextEventSequence += 3
          return result
        }
        const messageResult = continuation.result
        if (!messageResult.ok && messageResult.error instanceof OpencodeMessageResponseError) {
          throw messageResult.error
        }
        const diffSource = await readOpencodeDiffSource({
          baseUrl: session.baseUrl,
          sessionId: session.sessionId,
          worktreePath: session.directory,
          captureDiff: config.captureWorktreeDiff ?? captureWorktreeDiff,
          ...fetcherOption(config.fetcher),
        })
        if (!messageResult.ok) {
          const hasNoCapturedDiff =
            diffSource.changedPaths.length === 0 && diffSource.patch.trim().length === 0
          if (hasNoCapturedDiff) {
            throw messageResult.error
          }
        }
        const diff = sanitizeCodingDiffArtifact({
          id: `coding-diff-${input.codingRun.id}`,
          runId: input.codingRun.runId,
          nodeId: input.codingRun.nodeId,
          projectId: input.project.id,
          changedPaths: diffSource.changedPaths,
          patch: diffSource.patch,
          createdAt: input.now,
        })
        const codingRun: CodingAgentRun = {
          ...input.codingRun,
          status: 'completed',
          summary: 'opencode completed the managed coding run and produced a redacted diff artifact.',
          changedPaths: diff.changedPaths,
          completedAt: input.now,
          diffArtifactId: diff.id,
          redacted: true,
        }
        const events: CodingAgentEvent[] = [
          createToolResultEvent({
            codingRun: input.codingRun,
            request: input.request,
            now: input.now,
            sequence: session.nextEventSequence,
            status: 'completed',
            outputSummary: `DevFlow relay approved ${input.request.permission} permission; opencode completed after the tool action.`,
          }),
          {
            id: `coding-event-${input.codingRun.id}-diff`,
            codingRunId: codingRun.id,
            runId: codingRun.runId,
            nodeId: codingRun.nodeId,
            sequence: session.nextEventSequence + 1,
            kind: 'diff',
            message: 'opencode completed and DevFlow captured a redacted worktree diff.',
            timestamp: input.now,
            metadata: { diffArtifactId: diff.id },
            redacted: true,
          },
        ]
        const result = {
          codingRun,
          events,
          diff,
        }
        const cleanupPromise = session.cleanupPromise
        if (cleanupPromise) {
          await failForSessionCleanup(cleanupPromise)
        }
        if (sessions.get(input.codingRun.id) !== session) {
          throw new Error('opencode session ownership changed during permission continuation')
        }
        sessions.delete(input.codingRun.id)
        return result
      } catch (error) {
        if (error instanceof CodingEngineContinuationCleanupError) {
          throw error
        }
        try {
          await cleanupRegisteredSession(input.codingRun.id, session, 'continuation')
        } catch (cleanupError) {
          throw new CodingEngineContinuationCleanupError([error, cleanupError])
        }
        throw error
      }
    },

    async cancel(input) {
      let session = sessions.get(input.codingRun.id)
      if (!session) {
        const pendingSessionState = pendingSessions.get(input.codingRun.id)
        if (!pendingSessionState) {
          return
        }
        pendingSessionState.cancelRequested = true
        try {
          session = await pendingSessionState.promise
        } catch {
          return
        }
      }
      if (!session) {
        return
      }
      await cleanupRegisteredSession(input.codingRun.id, session, 'cancellation')
    },
  }
}

async function cleanupOpencodeSession(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  messagePromise?: OpencodeMessagePromise
  phase: 'startup' | 'continuation' | 'cancellation'
  sessionId: string
  settlementTimeoutMs: number
}): Promise<void> {
  const aborted = await abortOpencodeSession({
    baseUrl: input.baseUrl,
    sessionId: input.sessionId,
    directory: input.directory,
    ...fetcherOption(input.fetcher),
  })
  if (aborted !== true) {
    throw new Error('opencode session abort was not acknowledged')
  }

  await rejectSessionPermissions(input)
  if (input.messagePromise) {
    await waitForSessionMessageCleanup(input.messagePromise, input.settlementTimeoutMs, input.phase)
    await rejectSessionPermissions(input)
  }

  const remainingPermissions = await listOpencodePermissions({
    baseUrl: input.baseUrl,
    directory: input.directory,
    ...fetcherOption(input.fetcher),
  })
  if (remainingPermissions.some((candidate) => candidate.sessionID === input.sessionId)) {
    throw new Error(`opencode ${input.phase} permission cleanup did not complete`)
  }
}

async function rejectSessionPermissions(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  sessionId: string
}): Promise<void> {
  const permissions = await listOpencodePermissions({
    baseUrl: input.baseUrl,
    directory: input.directory,
    ...fetcherOption(input.fetcher),
  })
  for (const permission of permissions.filter((candidate) => candidate.sessionID === input.sessionId)) {
    const rejected = await replyOpencodePermission({
      baseUrl: input.baseUrl,
      requestId: permission.id,
      directory: input.directory,
      reply: 'reject',
      message: 'Rejected during DevFlow session cleanup.',
      ...fetcherOption(input.fetcher),
    })
    if (rejected !== true) {
      throw new Error('opencode session permission rejection was not acknowledged')
    }
  }
}

async function waitForSessionMessageCleanup(
  messagePromise: OpencodeMessagePromise,
  timeoutMs: number,
  phase: 'startup' | 'continuation' | 'cancellation',
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`opencode ${phase} message cleanup did not complete`))
    }, timeoutMs)
    void messagePromise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

function assertManagedOpencodeSession(
  session: Awaited<ReturnType<typeof createOpencodeSession>>,
  directory: string,
  resolveManagedDirectory: (directory: string) => string,
): void {
  let sessionDirectory: string
  try {
    sessionDirectory = resolveManagedDirectory(session.directory)
  } catch {
    throw new Error('opencode session directory did not match the managed worktree')
  }
  if (sessionDirectory !== directory) {
    throw new Error('opencode session directory did not match the managed worktree')
  }

  const actualRules = session.permission ?? []
  const expectedRules = createDefaultOpencodePermissionRules()
  const preservedRelayRules =
    actualRules.length === expectedRules.length &&
    actualRules.every((actual, index) => {
      const expected = expectedRules[index]
      return Boolean(
        expected &&
        actual.permission === expected.permission &&
        actual.pattern === expected.pattern &&
        actual.action === expected.action,
      )
    })
  if (!preservedRelayRules) {
    throw new Error('opencode session did not preserve DevFlow permission relay rules')
  }
}

export function resolveManagedOpencodeDirectory(directory: string): string {
  try {
    const canonical = realpathSync.native(resolve(directory))
    if (!statSync(canonical).isDirectory()) {
      throw new Error('not a directory')
    }
    return canonical
  } catch {
    throw new Error('managed opencode worktree directory could not be resolved')
  }
}

async function waitForNextPermissionOrMessage(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  handledPermissionIds: Set<string>
  messagePromise: OpencodeRuntimeSession['messagePromise']
  pollMs: number
  sessionId: string
}): Promise<
  | { kind: 'message'; result: Awaited<OpencodeRuntimeSession['messagePromise']> }
  | { kind: 'permission'; permission: OpencodePermission }
> {
  const firstPermission = await findUnhandledPermission(input)
  if (firstPermission) {
    return { kind: 'permission', permission: firstPermission }
  }

  while (true) {
    const result = await Promise.race([
      input.messagePromise.then((messageResult) => ({ kind: 'message' as const, result: messageResult })),
      new Promise<{ kind: 'tick' }>((resolve) => setTimeout(() => resolve({ kind: 'tick' }), input.pollMs)),
    ])
    if (result.kind === 'message') {
      return result
    }

    const permission = await findUnhandledPermission(input)
    if (permission) {
      return { kind: 'permission', permission }
    }
  }
}

async function findUnhandledPermission(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  handledPermissionIds: Set<string>
  sessionId: string
}): Promise<OpencodePermission | undefined> {
  const permissions = await listOpencodePermissions({
    baseUrl: input.baseUrl,
    directory: input.directory,
    ...fetcherOption(input.fetcher),
  })
  return permissions.find(
    (candidate) => candidate.sessionID === input.sessionId && !input.handledPermissionIds.has(candidate.id),
  )
}

async function readOpencodeDiffSource(input: {
  baseUrl: string
  captureDiff: (input: { worktreePath: string }) => Promise<CapturedWorktreeDiff>
  fetcher?: Fetcher
  sessionId: string
  worktreePath: string
}): Promise<CapturedWorktreeDiff> {
  try {
    const opencodeDiff = await listOpencodeDiff({
      baseUrl: input.baseUrl,
      sessionId: input.sessionId,
      directory: input.worktreePath,
      ...fetcherOption(input.fetcher),
    })
    if (opencodeDiff.length) {
      return {
        changedPaths: opencodeDiff.map((file) => file.file),
        patch: opencodeDiff.map((file) => file.patch).join('\n'),
      }
    }
  } catch {
    // opencode 1.17.x may close the HTTP session before diff retrieval.
    // The managed worktree remains DevFlow's durable source of truth.
  }

  return input.captureDiff({ worktreePath: input.worktreePath })
}

async function waitForPermission(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  messagePromise: OpencodeRuntimeSession['messagePromise']
  pollMs: number
  sessionId: string
  timeoutMs: number
}): Promise<OpencodePermission> {
  const expiresAt = Date.now() + input.timeoutMs
  const messageSettlement = input.messagePromise.then((result) => {
    if (result.ok) {
      return { kind: 'message-completed' as const }
    }
    return { kind: 'message-error' as const, error: result.error }
  })
  while (Date.now() <= expiresAt) {
    const permissions = await listOpencodePermissions({
      baseUrl: input.baseUrl,
      directory: input.directory,
      ...fetcherOption(input.fetcher),
    })
    const permission = permissions.find((candidate) => candidate.sessionID === input.sessionId)
    if (permission) {
      return permission
    }
    const waitMs = Math.max(0, Math.min(input.pollMs, expiresAt - Date.now()))
    const next = await Promise.race([
      messageSettlement,
      new Promise<{ kind: 'tick' }>((resolve) => setTimeout(() => resolve({ kind: 'tick' }), waitMs)),
    ])
    if (next.kind === 'message-error') {
      throw next.error
    }
    if (next.kind === 'message-completed') {
      throw new CodingEnginePermissionDiscoveryError('message_completed_without_permission')
    }
  }

  throw new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out')
}

function createStartResult(
  input: CodingEngineStartInput,
  prompt: string,
  sessionId: string,
  permission: OpencodePermission,
  directory: string,
) {
  const codingRun: CodingAgentRun = {
    id: input.id,
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.project.id,
    requestedBy: input.requestedBy,
    providerId: input.providerId,
    engine: 'opencode-http',
    status: 'waiting_permission',
    managedWorkspaceId: input.workspace.id,
    branchName: input.workspace.branchName,
    userInstruction: input.userInstruction,
    prompt,
    summary: 'opencode is waiting for DevFlow permission relay.',
    changedPaths: [],
    startedAt: input.now,
    redacted: true,
  }
  const events: CodingAgentEvent[] = [
    {
      id: `coding-event-${input.id}-brief`,
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: 1,
      kind: 'brief',
      message: `DevFlow coding brief sent to opencode HTTP session ${sessionId}.`,
      timestamp: input.now,
      metadata: { sessionId },
      redacted: true,
    },
    {
      id: `coding-event-${input.id}-permission`,
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: 2,
      kind: 'permission',
      message: `opencode requested ${permission.permission} permission.`,
      timestamp: input.now,
      metadata: { requestId: permission.id },
      redacted: true,
    },
    createToolCallEvent({
      codingRun,
      permission,
      worktreePath: directory,
      projectPath: input.project.path,
      sequence: 3,
      now: input.now,
    }),
  ]
  const filePath = metadataString(permission.metadata, 'filepath') ?? metadataString(permission.metadata, 'path')
  const command = metadataString(permission.metadata, 'command')
  const safePath = filePath ? safeRelativePath(filePath, directory) : undefined
  const safeCommand = command
    ? redactToolText(command, [
        { label: 'worktree_path', value: directory },
        { label: 'project_path', value: input.project.path },
      ])
    : undefined
  const permissionRequest: CodingPermissionRequest = {
    id: permission.id,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    permission: normalizePermission(permission.permission),
    title: `opencode requested ${permission.permission} permission`,
    ...(safePath ? { filePath: safePath } : {}),
    ...(safeCommand ? { command: safeCommand.value } : {}),
    risk: 'warn',
    reasons: ['opencode requested a tool permission through the managed adapter.'],
    status: 'pending',
    requestedAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + 60_000).toISOString(),
  }

  return {
    codingRun,
    events,
    permissionRequest,
  }
}

function createContinuationResult(
  codingRun: CodingAgentRun,
  approvedRequest: CodingPermissionRequest,
  now: string,
  permission: OpencodePermission,
  sequence: number,
  worktreePath: string,
  projectPath: string,
) {
  const continuedRun: CodingAgentRun = {
    ...codingRun,
    status: 'waiting_permission',
    summary: 'opencode is waiting for another DevFlow permission relay.',
  }
  const event: CodingAgentEvent = {
    id: `coding-event-${codingRun.id}-permission-${permission.id}`,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    sequence,
    kind: 'permission',
    message: `opencode requested ${permission.permission} permission.`,
    timestamp: now,
    metadata: { requestId: permission.id },
    redacted: true,
  }

  return {
    codingRun: continuedRun,
    events: [
      createToolResultEvent({
        codingRun,
        request: approvedRequest,
        now,
        sequence,
        status: 'continued',
        outputSummary: `DevFlow relay approved ${approvedRequest.permission} permission; opencode requested another permission.`,
      }),
      event,
      createToolCallEvent({
        codingRun: continuedRun,
        permission,
        worktreePath,
        projectPath,
        sequence: sequence + 2,
        now,
      }),
    ],
    permissionRequest: toCodingPermissionRequest(continuedRun, permission, now, worktreePath, projectPath),
  }
}

function toCodingPermissionRequest(
  codingRun: CodingAgentRun,
  permission: OpencodePermission,
  now: string,
  worktreePath: string,
  projectPath: string,
): CodingPermissionRequest {
  const filePath = metadataString(permission.metadata, 'filepath') ?? metadataString(permission.metadata, 'path')
  const command = metadataString(permission.metadata, 'command')
  const safePath = filePath ? safeRelativePath(filePath, worktreePath) : undefined
  const safeCommand = command
    ? redactToolText(command, [
        { label: 'worktree_path', value: worktreePath },
        { label: 'project_path', value: projectPath },
      ])
    : undefined

  return {
    id: permission.id,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    permission: normalizePermission(permission.permission),
    title: `opencode requested ${permission.permission} permission`,
    ...(safePath ? { filePath: safePath } : {}),
    ...(safeCommand ? { command: safeCommand.value } : {}),
    risk: 'warn',
    reasons: ['opencode requested a tool permission through the managed adapter.'],
    status: 'pending',
    requestedAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
  }
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function createToolCallEvent(input: {
  codingRun: CodingAgentRun
  permission: OpencodePermission
  worktreePath: string
  projectPath: string
  sequence: number
  now: string
}): CodingAgentEvent {
  const metadata = buildPermissionToolMetadata({
    permissionId: input.permission.id,
    permission: input.permission.permission,
    metadata: input.permission.metadata,
    worktreePath: input.worktreePath,
    projectPath: input.projectPath,
  })
  return {
    id: `coding-event-${input.codingRun.id}-tool-call-${input.permission.id}`,
    codingRunId: input.codingRun.id,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    sequence: input.sequence,
    kind: 'tool_call',
    message: `opencode requested ${input.permission.permission} via ${metadata.toolName}.`,
    timestamp: input.now,
    metadata,
    redacted: true,
  }
}

function createToolResultEvent(input: {
  codingRun: CodingAgentRun
  request: CodingPermissionRequest
  now: string
  sequence: number
  status: 'completed' | 'continued' | 'rejected' | 'expired'
  outputSummary: string
}): CodingAgentEvent {
  const redactedOutput = redactSecrets(input.outputSummary)
  return {
    id: `coding-event-${input.codingRun.id}-tool-result-${input.request.id}`,
    codingRunId: input.codingRun.id,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    sequence: input.sequence,
    kind: 'tool_result',
    message: `DevFlow approved opencode ${input.request.permission} permission.`,
    timestamp: input.now,
    metadata: {
      source: input.request.command || input.request.filePath ? 'opencode_metadata' : 'inferred',
      permissionRequestId: input.request.id,
      permission: input.request.permission,
      toolName: input.request.permission,
      ...(input.request.command ? { commandSummary: redactSecrets(input.request.command).value } : {}),
      ...(input.request.filePath ? { filePath: input.request.filePath } : {}),
      decision: input.status === 'expired' ? 'expired' : input.status === 'rejected' ? 'rejected' : 'approved',
      status: input.status,
      outputSummary: redactedOutput.value,
      redactionApplied: redactedOutput.redacted || Boolean(input.request.command && redactSecrets(input.request.command).redacted),
    },
    redacted: true,
  }
}

function buildPermissionToolMetadata(input: {
  permissionId: string
  permission: string
  metadata: Record<string, unknown> | undefined
  worktreePath: string
  projectPath: string
}): Record<string, unknown> {
  const skillName = metadataString(input.metadata, 'skillName') ?? metadataString(input.metadata, 'skill')
  const toolName = metadataString(input.metadata, 'tool') ?? input.permission
  const command = metadataString(input.metadata, 'command')
  const rawPath = metadataString(input.metadata, 'filepath') ?? metadataString(input.metadata, 'path')
  const safeCommand = command
    ? redactToolText(command, [
        { label: 'worktree_path', value: input.worktreePath },
        { label: 'project_path', value: input.projectPath },
      ])
    : undefined
  const safePath = rawPath ? safeRelativePath(rawPath, input.worktreePath) : undefined
  const hasMetadata = Boolean(skillName || metadataString(input.metadata, 'tool') || command || rawPath)
  const redactionApplied = Boolean(safeCommand?.redacted || (rawPath && rawPath !== safePath))
  const commandSummary = safeCommand?.value
  const inputSummary = commandSummary ? `${toolName}: ${commandSummary}` : `${input.permission} permission requested`

  return {
    source: hasMetadata ? 'opencode_metadata' : 'inferred',
    permissionRequestId: input.permissionId,
    permission: input.permission,
    toolName,
    ...(skillName ? { skillName } : {}),
    ...(commandSummary ? { commandSummary } : {}),
    ...(safePath ? { filePath: safePath } : {}),
    inputSummary,
    redactionApplied,
  }
}

function safeRelativePath(value: string, worktreePath: string): string | undefined {
  if (!isAbsolute(value)) {
    return toPortablePath(value)
  }
  if (!worktreePath) {
    return undefined
  }
  const relativePath = relative(worktreePath, value)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return undefined
  }
  return toPortablePath(relativePath)
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function redactToolText(
  value: string,
  localPaths: Array<{ label: string; value: string | undefined }>,
): { value: string; redacted: boolean } {
  const secretRedaction = redactSecrets(value)
  let output = secretRedaction.value
  let redacted = secretRedaction.redacted
  const patterns = localPaths
    .filter((item): item is { label: string; value: string } => Boolean(item.value))
    .flatMap((item) => {
      const portable = toPortablePath(item.value)
      return [
        { label: item.label, value: item.value },
        ...(portable !== item.value ? [{ label: item.label, value: portable }] : []),
      ]
    })
    .sort((left, right) => right.value.length - left.value.length)

  for (const pattern of patterns) {
    if (!output.includes(pattern.value)) {
      continue
    }
    output = output.split(pattern.value).join(`[REDACTED:${pattern.label}]`)
    redacted = true
  }

  return { value: output, redacted }
}

function normalizePermission(permission: string): CodingPermissionRequest['permission'] {
  if (
    permission === 'bash' ||
    permission === 'edit' ||
    permission === 'write' ||
    permission === 'patch' ||
    permission === 'install' ||
    permission === 'external_directory'
  ) {
    return permission
  }

  return 'bash'
}

function fetcherOption(fetcher: Fetcher | undefined): { fetcher: Fetcher } | Record<string, never> {
  return fetcher ? { fetcher } : {}
}

function findSession(
  sessions: Map<string, OpencodeRuntimeSession>,
  codingRunId: string,
): OpencodeRuntimeSession {
  const session = sessions.get(codingRunId)
  if (!session) {
    throw new Error(`opencode session not found for ${codingRunId}`)
  }

  return session
}
