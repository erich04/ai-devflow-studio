import {
  redactSecrets,
  sanitizeCodingDiffArtifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
} from '@ai-devflow/shared'
import { realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  getOpencodeSessionStatus,
  listOpencodeDiff,
  listOpencodeMessages,
  listOpencodePermissions,
  replyOpencodePermission,
  sendOpencodeMessage,
  OpencodeMessageResponseError,
  type Fetcher,
  type OpencodePermission,
  type OpencodeMessage,
  type OpencodePermissionRule,
} from './opencode-http-adapter.js'
import { captureWorktreeDiff, type CapturedWorktreeDiff } from './coding-runner.js'
import { createOpencodeProcessManager, type ManagedOpencodeServer } from './opencode-process.js'
import { classifyOpenCodePermission } from './opencode-permission-policy.js'
import {
  assertOpenCodeGitBoundary,
  captureOpenCodeGitBoundary,
  validateAuthoritativeOpenCodeDiff,
  type OpenCodeGitBoundarySnapshot,
} from './opencode-result-validation.js'

export type OpencodeHttpProcessManager = {
  ensure(input: {
    projectId: string
    binaryPath: string
    env: NodeJS.ProcessEnv
    configurationFingerprint?: string
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
  configurationFingerprint?: string
  requireExecutionAuthorization?: boolean
  permissionPollMs?: number
  permissionDiscoveryTimeoutMs?: number
  maxToolTurns?: number
  maxWallClockMs?: number
  nowMs?: () => number
  permissionRules?: OpencodePermissionRule[]
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
  deadlineAtMs: number
  handledPermissionIds: Set<string>
  gitBoundary?: OpenCodeGitBoundarySnapshot
  messagePromise: OpencodeMessagePromise
  nextEventSequence: number
  observedToolCallKeys: Set<string>
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
  const authorizedRunIds = new Set<string>()
  const nowMs = config.nowMs ?? Date.now
  const maxToolTurns = positiveInteger(config.maxToolTurns, 24)
  const maxWallClockMs = positiveInteger(config.maxWallClockMs, 15 * 60_000)
  const processConfigurationFingerprint = config.configurationFingerprint ?? createHash('sha256')
    .update(JSON.stringify({
      providerID: config.providerID,
      modelID: config.modelID,
      apiKeyEnvName: config.apiKeyEnvName ?? '',
      requireExecutionAuthorization: config.requireExecutionAuthorization ?? false,
      permissionRules: config.permissionRules ?? createDefaultOpencodePermissionRules(),
      maxToolTurns,
      maxWallClockMs,
    }))
    .digest('hex')

  function remainingSessionMs(session: OpencodeRuntimeSession): number {
    const remaining = session.deadlineAtMs - nowMs()
    if (remaining <= 0) {
      throw new Error('opencode_wall_clock_limit_exceeded')
    }
    return remaining
  }

  function permissionWaitTimeout(session: OpencodeRuntimeSession): number {
    return Math.min(config.permissionDiscoveryTimeoutMs ?? 60_000, remainingSessionMs(session))
  }

  function assertToolTurnLimit(session: OpencodeRuntimeSession): void {
    remainingSessionMs(session)
    if (session.observedToolCallKeys.size > maxToolTurns) {
      throw new Error('opencode_tool_turn_limit_exceeded')
    }
  }

  function registerPermissionToolTurn(
    session: OpencodeRuntimeSession,
    permission: OpencodePermission,
  ): void {
    const toolKey = permission.tool
      ? `${permission.tool.messageID}:${permission.tool.callID}`
      : `permission:${permission.id}`
    session.observedToolCallKeys.add(toolKey)
    assertToolTurnLimit(session)
  }

  async function refreshObservedToolTurns(
    session: OpencodeRuntimeSession,
    signal?: AbortSignal,
  ): Promise<void> {
    const messages = await listOpencodeMessages({
      baseUrl: session.baseUrl,
      sessionId: session.sessionId,
      directory: session.directory,
      ...fetcherOption(config.fetcher),
      ...(signal ? { signal } : {}),
    })
    registerObservedToolTurns(session, messages)
    assertToolTurnLimit(session)
  }

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
        cleanupTimeoutMs: config.startupCleanupTimeoutMs ?? 5_000,
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

  async function finishSession(input: {
    session: OpencodeRuntimeSession
    codingRun: CodingAgentRun
    projectId: string
    now: string
    messageResult: Awaited<OpencodeMessagePromise>
    approvedRequest?: CodingPermissionRequest
  }) {
    remainingSessionMs(input.session)
    if (!input.messageResult.ok && input.messageResult.error instanceof OpencodeMessageResponseError) {
      throw input.messageResult.error
    }
    await refreshObservedToolTurns(input.session)
    if (input.session.gitBoundary) {
      await assertOpenCodeGitBoundary({
        sourcePath: input.session.projectPath,
        worktreePath: input.session.directory,
        snapshot: input.session.gitBoundary,
      })
    }
    const diffSource = await readOpencodeDiffSource({
      baseUrl: input.session.baseUrl,
      sessionId: input.session.sessionId,
      worktreePath: input.session.directory,
      captureDiff: config.captureWorktreeDiff ?? captureWorktreeDiff,
      ...fetcherOption(config.fetcher),
    })
    remainingSessionMs(input.session)
    if (!input.messageResult.ok) {
      const hasNoCapturedDiff =
        diffSource.changedPaths.length === 0 && diffSource.patch.trim().length === 0
      if (hasNoCapturedDiff) throw input.messageResult.error
    }
    const diff = sanitizeCodingDiffArtifact({
      id: `coding-diff-${input.codingRun.id}`,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      projectId: input.projectId,
      changedPaths: diffSource.changedPaths,
      patch: diffSource.patch,
      sourceDigest: createHash('sha256').update(diffSource.patch, 'utf8').digest('hex'),
      createdAt: input.now,
    })
    const codingRun: CodingAgentRun = {
      ...input.codingRun,
      status: 'completed',
      summary: 'opencode completed the managed coding run and DevFlow captured the authoritative Git diff.',
      changedPaths: diff.changedPaths,
      completedAt: input.now,
      diffArtifactId: diff.id,
      redacted: true,
    }
    const sequence = input.session.nextEventSequence
    const events: CodingAgentEvent[] = [
      ...(input.approvedRequest
        ? [createToolResultEvent({
            codingRun: input.codingRun,
            request: input.approvedRequest,
            now: input.now,
            sequence,
            status: 'completed',
            outputSummary: `DevFlow relay approved ${input.approvedRequest.permission} permission; opencode completed after the tool action.`,
          })]
        : [{
            id: `coding-event-${input.codingRun.id}-brief`,
            codingRunId: input.codingRun.id,
            runId: input.codingRun.runId,
            nodeId: input.codingRun.nodeId,
            sequence,
            kind: 'brief' as const,
            message: `DevFlow coding brief sent to opencode HTTP session ${input.session.sessionId}.`,
            timestamp: input.now,
            redacted: true,
          }]),
      {
        id: `coding-event-${input.codingRun.id}-diff`,
        codingRunId: codingRun.id,
        runId: codingRun.runId,
        nodeId: codingRun.nodeId,
        sequence: sequence + 1,
        kind: 'diff',
        message: 'opencode completed and DevFlow captured the managed-worktree Git diff.',
        timestamp: input.now,
        metadata: {
          diffArtifactId: diff.id,
          diffSource: 'managed_worktree_git',
          opencodeDiffStatus: diffSource.opencodeDiffStatus,
        },
        redacted: true,
      },
    ]
    const cleanupPromise = input.session.cleanupPromise
    if (cleanupPromise) await failForSessionCleanup(cleanupPromise)
    if (sessions.get(input.codingRun.id) !== input.session) {
      throw new Error('opencode session ownership changed while assembling the terminal result')
    }
    sessions.delete(input.codingRun.id)
    return { codingRun, events, diff }
  }

  const adapter: CodingEngineAdapter = {
    engine: 'opencode-http',
    providerId: config.providerID,
    modelId: config.modelID,

    async ensure(input) {
      if (!config.requireExecutionAuthorization) {
        await processManager.ensure({
          projectId: input.project.id,
          binaryPath: config.binaryPath,
          env: config.runtimeEnv ?? process.env,
          configurationFingerprint: processConfigurationFingerprint,
        })
      }
      return {
        projectId: input.project.id,
        engine: 'opencode-http',
        status: 'ready',
      }
    },

    async start(input) {
      if (config.requireExecutionAuthorization && !authorizedRunIds.delete(input.id)) {
        return createExecutionAuthorizationResult(input)
      }
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
        const gitBoundary = input.workspace.baseCommitSha
          ? await captureOpenCodeGitBoundary({
              sourcePath: input.project.path,
              worktreePath: directory,
              baseCommitSha: input.workspace.baseCommitSha,
              branchName: input.workspace.branchName,
            })
          : undefined
        const server = await processManager.ensure({
          projectId: input.project.id,
          binaryPath: config.binaryPath,
          env: config.runtimeEnv ?? process.env,
          configurationFingerprint: processConfigurationFingerprint,
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
          ...(config.permissionRules ? { permissionRules: config.permissionRules } : {}),
          ...fetcherOption(config.fetcher),
        })
        runtimeSession = {
          baseUrl: server.baseUrl,
          deadlineAtMs: nowMs() + maxWallClockMs,
          directory,
          ...(gitBoundary ? { gitBoundary } : {}),
          handledPermissionIds: new Set(),
          messagePromise: Promise.resolve({ ok: true as const }),
          nextEventSequence: 1,
          observedToolCallKeys: new Set(),
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
          assertManagedOpencodeSession(
            session,
            directory,
            resolveManagedDirectory,
            config.permissionRules ?? createDefaultOpencodePermissionRules(),
          )
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
          const firstOutcome = config.requireExecutionAuthorization
            ? await waitForNextPermissionOrMessage({
                baseUrl: server.baseUrl,
                directory,
                handledPermissionIds: runtimeSession.handledPermissionIds,
                messagePromise,
                observeToolTurns: (signal) => refreshObservedToolTurns(runtimeSession!, signal),
                pollMs: config.permissionPollMs ?? 1_000,
                sessionId: session.id,
                timeoutMs: permissionWaitTimeout(runtimeSession),
                ...fetcherOption(config.fetcher),
              })
            : undefined
          if (firstOutcome?.kind === 'message') {
            return await finishSession({
              session: runtimeSession,
              codingRun: createRunningOpencodeRun(input),
              projectId: input.project.id,
              now: input.now,
              messageResult: firstOutcome.result,
            })
          }
          const permission = firstOutcome?.kind === 'permission'
            ? firstOutcome.permission
            : await waitForPermission({
                baseUrl: server.baseUrl,
                directory,
                messagePromise,
                observeToolTurns: (signal) => refreshObservedToolTurns(runtimeSession!, signal),
                pollMs: config.permissionPollMs ?? 1_000,
                sessionId: session.id,
                timeoutMs: permissionWaitTimeout(runtimeSession),
                ...fetcherOption(config.fetcher),
              })
          const result = createStartResult(input, brief.prompt, session.id, permission, directory)
          registerPermissionToolTurn(runtimeSession, permission)
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
      if (input.request.origin === 'execution_authorization') {
        if (!input.authorizedStart || input.authorizedStart.id !== input.codingRun.id) {
          throw new Error('OpenCode Execution Authorization cannot resume without its persisted run context')
        }
        authorizedRunIds.add(input.codingRun.id)
        try {
          return await adapter.start(input.authorizedStart)
        } catch (error) {
          authorizedRunIds.delete(input.codingRun.id)
          throw error
        }
      }
      const session = findSession(sessions, input.codingRun.id)
      try {
        remainingSessionMs(session)
      } catch (error) {
        try {
          await cleanupRegisteredSession(input.codingRun.id, session, 'continuation')
        } catch (cleanupError) {
          throw new CodingEngineContinuationCleanupError([error, cleanupError])
        }
        throw error
      }
      const policyDecision = classifyOpenCodePermission(input.request)
      if (policyDecision.status === 'denied') {
        const policyError = new Error(
          `OpenCode permission denied by DevFlow policy (${policyDecision.code}): ${policyDecision.reason}`,
        )
        try {
          await cleanupRegisteredSession(input.codingRun.id, session, 'continuation')
        } catch (cleanupError) {
          throw new CodingEngineContinuationCleanupError([policyError, cleanupError])
        }
        throw policyError
      }
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
          observeToolTurns: (signal) => refreshObservedToolTurns(session, signal),
          pollMs: config.permissionPollMs ?? 1_000,
          sessionId: session.sessionId,
          timeoutMs: permissionWaitTimeout(session),
          ...fetcherOption(config.fetcher),
        })
        if (continuation.kind === 'permission') {
          registerPermissionToolTurn(session, continuation.permission)
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
        return await finishSession({
          session,
          codingRun: input.codingRun,
          projectId: input.project.id,
          now: input.now,
          messageResult,
          approvedRequest: input.request,
        })
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
      authorizedRunIds.delete(input.codingRun.id)
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
  return adapter
}

function createExecutionAuthorizationResult(input: CodingEngineStartInput) {
  const expiresAt = new Date(Date.parse(input.now) + 5 * 60_000).toISOString()
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
    prompt: input.brief.prompt,
    summary: 'OpenCode is waiting for Execution Authorization in the disposable managed worktree.',
    changedPaths: [],
    startedAt: input.now,
    redacted: true,
  }
  const permissionRequest: CodingPermissionRequest = {
    id: `execution-authorization-${input.id}`,
    codingRunId: input.id,
    runId: input.run.id,
    nodeId: input.node.id,
    origin: 'execution_authorization',
    permission: 'write',
    title: '授权 OpenCode 在隔离工作区执行',
    risk: 'warn',
    reasons: [
      '仅允许 OpenCode 在本次 disposable managed worktree 中读取、搜索和修改文件。',
      '此授权不接受最终修改，也不允许 commit、push、发布、合并、fetch 或修改原始 checkout。',
      'Shell、安装、网络和范围扩大仍需单独审批或会被拒绝。',
      'OpenCode/Provider 的 token 与美元费用不可核对时会显示为 opaque/unknown，不会伪装成 $0。',
    ],
    status: 'pending',
    requestedAt: input.now,
    expiresAt,
  }
  return {
    codingRun,
    events: [
      {
        id: `coding-event-${input.id}-execution-authorization`,
        codingRunId: input.id,
        runId: input.run.id,
        nodeId: input.node.id,
        sequence: 1,
        kind: 'permission' as const,
        message: 'OpenCode requires Execution Authorization before its process or Provider is started.',
        timestamp: input.now,
        metadata: {
          requestId: permissionRequest.id,
          origin: permissionRequest.origin,
          managedWorkspaceId: input.workspace.id,
        },
        redacted: true,
      },
    ],
    permissionRequest,
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function registerObservedToolTurns(
  session: OpencodeRuntimeSession,
  messages: OpencodeMessage[],
): void {
  if (!Array.isArray(messages)) {
    throw new Error('opencode_tool_history_invalid')
  }
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.info) || !Array.isArray(message.parts)) {
      throw new Error('opencode_tool_history_invalid')
    }
    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== 'tool') continue
      if (
        typeof part.messageID !== 'string' ||
        !part.messageID.trim() ||
        typeof part.callID !== 'string' ||
        !part.callID.trim()
      ) {
        throw new Error('opencode_tool_history_invalid')
      }
      session.observedToolCallKeys.add(`${part.messageID}:${part.callID}`)
    }
  }
}

function createRunningOpencodeRun(input: CodingEngineStartInput): CodingAgentRun {
  return {
    id: input.id,
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.project.id,
    requestedBy: input.requestedBy,
    providerId: input.providerId,
    engine: 'opencode-http',
    status: 'running',
    managedWorkspaceId: input.workspace.id,
    branchName: input.workspace.branchName,
    userInstruction: input.userInstruction,
    prompt: input.brief.prompt,
    summary: 'OpenCode is executing inside the authorized managed worktree.',
    changedPaths: [],
    startedAt: input.now,
    redacted: true,
  }
}

async function cleanupOpencodeSession(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  messagePromise?: OpencodeMessagePromise
  phase: 'startup' | 'continuation' | 'cancellation'
  sessionId: string
  cleanupTimeoutMs: number
}): Promise<void> {
  const expiresAt = Date.now() + input.cleanupTimeoutMs
  const aborted = await runBeforeCleanupDeadline({
    expiresAt,
    phase: input.phase,
    operation: (signal) => abortOpencodeSession({
      baseUrl: input.baseUrl,
      sessionId: input.sessionId,
      directory: input.directory,
      ...fetcherOption(input.fetcher),
      signal,
    }),
  })
  if (aborted !== true) {
    throw new Error('opencode session abort was not acknowledged')
  }

  await rejectSessionPermissions({ ...input, expiresAt })
  if (input.messagePromise) {
    await waitForSessionMessageCleanup(input.messagePromise, expiresAt, input.phase)
    await rejectSessionPermissions({ ...input, expiresAt })
  }

  const remainingPermissions = await runBeforeCleanupDeadline({
    expiresAt,
    phase: input.phase,
    operation: (signal) => listOpencodePermissions({
      baseUrl: input.baseUrl,
      directory: input.directory,
      ...fetcherOption(input.fetcher),
      signal,
    }),
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
  expiresAt: number
  phase: 'startup' | 'continuation' | 'cancellation'
}): Promise<void> {
  const permissions = await runBeforeCleanupDeadline({
    expiresAt: input.expiresAt,
    phase: input.phase,
    operation: (signal) => listOpencodePermissions({
      baseUrl: input.baseUrl,
      directory: input.directory,
      ...fetcherOption(input.fetcher),
      signal,
    }),
  })
  for (const permission of permissions.filter((candidate) => candidate.sessionID === input.sessionId)) {
    const rejected = await runBeforeCleanupDeadline({
      expiresAt: input.expiresAt,
      phase: input.phase,
      operation: (signal) => replyOpencodePermission({
        baseUrl: input.baseUrl,
        requestId: permission.id,
        directory: input.directory,
        reply: 'reject',
        message: 'Rejected during DevFlow session cleanup.',
        ...fetcherOption(input.fetcher),
        signal,
      }),
    })
    if (rejected !== true) {
      throw new Error('opencode session permission rejection was not acknowledged')
    }
  }
}

async function waitForSessionMessageCleanup(
  messagePromise: OpencodeMessagePromise,
  expiresAt: number,
  phase: 'startup' | 'continuation' | 'cancellation',
): Promise<void> {
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) {
    throw new Error(`opencode ${phase} cleanup timed out`)
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`opencode ${phase} cleanup timed out`))
    }, remaining)
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

async function runBeforeCleanupDeadline<T>(input: {
  expiresAt: number
  operation: (signal: AbortSignal) => Promise<T>
  phase: 'startup' | 'continuation' | 'cancellation'
}): Promise<T> {
  const remaining = input.expiresAt - Date.now()
  if (remaining <= 0) {
    throw new Error(`opencode ${input.phase} cleanup timed out`)
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`opencode ${input.phase} cleanup timed out`))
    }, remaining)
  })
  try {
    return await Promise.race([input.operation(controller.signal), deadline])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    controller.abort()
  }
}

function assertManagedOpencodeSession(
  session: Awaited<ReturnType<typeof createOpencodeSession>>,
  directory: string,
  resolveManagedDirectory: (directory: string) => string,
  expectedRules: OpencodePermissionRule[],
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
  observeToolTurns: (signal: AbortSignal) => Promise<void>
  pollMs: number
  sessionId: string
  timeoutMs: number
}): Promise<
  | { kind: 'message'; result: Awaited<OpencodeRuntimeSession['messagePromise']> }
  | { kind: 'permission'; permission: OpencodePermission }
> {
  const expiresAt = Date.now() + input.timeoutMs
  let settledMessage: Awaited<OpencodeRuntimeSession['messagePromise']> | undefined
  void input.messagePromise.then((result) => {
    settledMessage = result
  })

  while (Date.now() <= expiresAt) {
    await runBeforePermissionDeadline({
      expiresAt,
      operation: input.observeToolTurns,
    })
    const firstPermission = await runBeforePermissionDeadline({
      expiresAt,
      operation: (signal) => findUnhandledPermission({ ...input, signal }),
    })
    await Promise.race([
      input.messagePromise.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ])
    if (settledMessage) {
      return { kind: 'message', result: settledMessage }
    }
    if (firstPermission) {
      await runBeforePermissionDeadline({
        expiresAt,
        operation: input.observeToolTurns,
      })
      return { kind: 'permission', permission: firstPermission }
    }

    const status = await runBeforePermissionDeadline({
      expiresAt,
      operation: (signal) => getOpencodeSessionStatus({
        baseUrl: input.baseUrl,
        directory: input.directory,
        sessionId: input.sessionId,
        ...fetcherOption(input.fetcher),
        signal,
      }),
    })
    await Promise.race([
      input.messagePromise.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ])
    if (settledMessage) {
      return { kind: 'message', result: settledMessage }
    }
    if (status?.type === 'retry') {
      throw new CodingEnginePermissionDiscoveryError('provider_retry_observed')
    }

    const waitMs = Math.max(0, Math.min(input.pollMs, expiresAt - Date.now()))
    const result = await Promise.race([
      input.messagePromise.then((messageResult) => ({ kind: 'message' as const, result: messageResult })),
      new Promise<{ kind: 'tick' }>((resolve) => setTimeout(() => resolve({ kind: 'tick' }), waitMs)),
    ])
    if (result.kind === 'message') {
      return result
    }
  }

  throw new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out')
}

async function findUnhandledPermission(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  handledPermissionIds: Set<string>
  sessionId: string
  signal?: AbortSignal
}): Promise<OpencodePermission | undefined> {
  const permissions = await listOpencodePermissions({
    baseUrl: input.baseUrl,
    directory: input.directory,
    ...fetcherOption(input.fetcher),
    ...(input.signal ? { signal: input.signal } : {}),
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
}): Promise<CapturedWorktreeDiff & {
  opencodeDiffStatus: 'matched' | 'mismatch' | 'unavailable'
}> {
  const authoritative = await validateAuthoritativeOpenCodeDiff({
    worktreePath: input.worktreePath,
    canonicalWorktreePath: input.worktreePath,
    diff: await input.captureDiff({ worktreePath: input.worktreePath }),
  })
  try {
    const opencodeDiff = await listOpencodeDiff({
      baseUrl: input.baseUrl,
      sessionId: input.sessionId,
      directory: input.worktreePath,
      ...fetcherOption(input.fetcher),
    })
    const reportedPaths = [...new Set(opencodeDiff.map((file) => file.file))]
      .sort((left, right) => left.localeCompare(right))
    const reportedPatch = opencodeDiff.map((file) => file.patch).join('\n')
    const matched =
      reportedPaths.length === authoritative.changedPaths.length &&
      reportedPaths.every((changedPath, index) => changedPath === authoritative.changedPaths[index]) &&
      reportedPatch === authoritative.patch
    return {
      ...authoritative,
      opencodeDiffStatus: matched ? 'matched' : 'mismatch',
    }
  } catch {
    // opencode 1.17.x may close the HTTP session before diff retrieval.
    // The managed worktree remains DevFlow's durable source of truth.
    return { ...authoritative, opencodeDiffStatus: 'unavailable' }
  }
}

async function waitForPermission(input: {
  baseUrl: string
  directory: string
  fetcher?: Fetcher
  messagePromise: OpencodeRuntimeSession['messagePromise']
  observeToolTurns: (signal: AbortSignal) => Promise<void>
  pollMs: number
  sessionId: string
  timeoutMs: number
}): Promise<OpencodePermission> {
  const expiresAt = Date.now() + input.timeoutMs
  let settledMessage:
    | { kind: 'message-completed' }
    | { kind: 'message-error'; error: unknown }
    | undefined
  const messageSettlement = input.messagePromise.then((result) => {
    const settlement = result.ok
      ? { kind: 'message-completed' as const }
      : { kind: 'message-error' as const, error: result.error }
    settledMessage = settlement
    return settlement
  })
  while (Date.now() <= expiresAt) {
    await runBeforePermissionDeadline({
      expiresAt,
      operation: input.observeToolTurns,
    })
    const permissions = await runBeforePermissionDeadline({
      expiresAt,
      operation: (signal) => listOpencodePermissions({
        baseUrl: input.baseUrl,
        directory: input.directory,
        ...fetcherOption(input.fetcher),
        signal,
      }),
    })
    await Promise.resolve()
    throwIfMessageSettled(settledMessage)
    const permission = permissions.find((candidate) => candidate.sessionID === input.sessionId)
    if (permission) {
      await runBeforePermissionDeadline({
        expiresAt,
        operation: input.observeToolTurns,
      })
      return permission
    }

    const status = await runBeforePermissionDeadline({
      expiresAt,
      operation: (signal) => getOpencodeSessionStatus({
        baseUrl: input.baseUrl,
        directory: input.directory,
        sessionId: input.sessionId,
        ...fetcherOption(input.fetcher),
        signal,
      }),
    })
    await Promise.resolve()
    throwIfMessageSettled(settledMessage)
    if (status?.type === 'retry') {
      throw new CodingEnginePermissionDiscoveryError('provider_retry_observed')
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

function throwIfMessageSettled(
  settlement:
    | { kind: 'message-completed' }
    | { kind: 'message-error'; error: unknown }
    | undefined,
): void {
  if (!settlement) {
    return
  }
  if (settlement.kind === 'message-error') {
    throw settlement.error
  }
  throw new CodingEnginePermissionDiscoveryError('message_completed_without_permission')
}

async function runBeforePermissionDeadline<T>(input: {
  expiresAt: number
  operation: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const remaining = input.expiresAt - Date.now()
  if (remaining <= 0) {
    throw new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out')
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new CodingEnginePermissionDiscoveryError('permission_discovery_timed_out'))
    }, remaining)
  })
  try {
    return await Promise.race([input.operation(controller.signal), deadline])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    controller.abort()
  }
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
