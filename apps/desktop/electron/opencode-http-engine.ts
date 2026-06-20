import {
  buildCodingBrief,
  redactSecrets,
  sanitizeCodingDiffArtifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
} from '@ai-devflow/shared'
import { isAbsolute, relative } from 'node:path'
import type { CodingEngineAdapter, CodingEngineStartInput } from './coding-engine.js'
import {
  createOpencodeSession,
  abortOpencodeSession,
  listOpencodeDiff,
  listOpencodePermissions,
  replyOpencodePermission,
  sendOpencodeMessage,
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
  captureWorktreeDiff?: (input: { worktreePath: string }) => Promise<CapturedWorktreeDiff>
}

type OpencodeRuntimeSession = {
  baseUrl: string
  directory: string
  handledPermissionIds: Set<string>
  messagePromise: Promise<
    | { ok: true }
    | { ok: false; error: unknown }
  >
  nextEventSequence: number
  sessionId: string
}

export function createOpencodeHttpCodingEngineAdapter(
  config: OpencodeHttpCodingEngineConfig,
): CodingEngineAdapter {
  const processManager = config.processManager ?? createOpencodeProcessManager()
  const sessions = new Map<string, OpencodeRuntimeSession>()

  return {
    engine: 'opencode-http',

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
      const server = await processManager.ensure({
        projectId: input.project.id,
        binaryPath: config.binaryPath,
        env: config.runtimeEnv ?? process.env,
      })
      const brief = buildCodingBrief({
        run: input.run,
        node: input.node,
        project: input.project,
        upstreamArtifacts: input.upstreamArtifacts,
        knowledgeReferences: input.knowledgeReferences,
        governanceChecks: input.governanceChecks,
        gateDecisions: input.gateDecisions,
        testEvidence: input.testEvidence,
        remediationPlan: input.remediationPlan,
        retryAttempt: input.retryAttempt,
        userInstruction: input.userInstruction,
        worktreePath: input.workspace.worktreePath,
        branchName: input.workspace.branchName,
      })
      const session = await createOpencodeSession({
        baseUrl: server.baseUrl,
        directory: input.workspace.worktreePath,
        title: `DevFlow ${input.run.title}`,
        model: { providerID: config.providerID, id: config.modelID },
        ...fetcherOption(config.fetcher),
      })
      const messagePromise = sendOpencodeMessage({
        baseUrl: server.baseUrl,
        sessionId: session.id,
        model: { providerID: config.providerID, modelID: config.modelID },
        text: `DevFlow Coding Brief\n\n${brief.prompt}`,
        ...fetcherOption(config.fetcher),
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const permission = await waitForPermission({
        baseUrl: server.baseUrl,
        messagePromise,
        pollMs: config.permissionPollMs ?? 1_000,
        sessionId: session.id,
        timeoutMs: config.permissionDiscoveryTimeoutMs ?? 60_000,
        ...fetcherOption(config.fetcher),
      })
      sessions.set(input.id, {
        baseUrl: server.baseUrl,
        directory: input.workspace.worktreePath,
        handledPermissionIds: new Set([permission.id]),
        messagePromise,
        nextEventSequence: 4,
        sessionId: session.id,
      })

      return createStartResult(input, brief.prompt, session.id, permission)
    },

    async approvePermission(input) {
      const session = findSession(sessions, input.codingRun.id)
      await replyOpencodePermission({
        baseUrl: session.baseUrl,
        requestId: input.request.id,
        directory: session.directory,
        reply: 'once',
        message: 'Approved by DevFlow.',
        ...fetcherOption(config.fetcher),
      })
      session.handledPermissionIds.add(input.request.id)
      const continuation = await waitForNextPermissionOrMessage({
        baseUrl: session.baseUrl,
        handledPermissionIds: session.handledPermissionIds,
        messagePromise: session.messagePromise,
        pollMs: config.permissionPollMs ?? 1_000,
        sessionId: session.sessionId,
        ...fetcherOption(config.fetcher),
      })
      if (continuation.kind === 'permission') {
        session.handledPermissionIds.add(continuation.permission.id)
        const eventSequence = session.nextEventSequence
        session.nextEventSequence += 3
        return createContinuationResult(
          input.codingRun,
          input.request,
          input.now,
          continuation.permission,
          eventSequence,
          session.directory,
        )
      }
      const messageResult = continuation.result
      const diffSource = await readOpencodeDiffSource({
        baseUrl: session.baseUrl,
        sessionId: session.sessionId,
        worktreePath: session.directory,
        captureDiff: config.captureWorktreeDiff ?? captureWorktreeDiff,
        ...fetcherOption(config.fetcher),
      })
      if (!messageResult.ok && diffSource.changedPaths.length === 0 && diffSource.patch.trim().length === 0) {
        throw messageResult.error
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
      sessions.delete(input.codingRun.id)

      return {
        codingRun,
        events,
        diff,
      }
    },

    async cancel(input) {
      const session = sessions.get(input.codingRun.id)
      if (!session) {
        return
      }
      await abortOpencodeSession({
        baseUrl: session.baseUrl,
        sessionId: session.sessionId,
        directory: session.directory,
        ...fetcherOption(config.fetcher),
      })
      sessions.delete(input.codingRun.id)
    },
  }
}

async function waitForNextPermissionOrMessage(input: {
  baseUrl: string
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
  fetcher?: Fetcher
  handledPermissionIds: Set<string>
  sessionId: string
}): Promise<OpencodePermission | undefined> {
  const permissions = await listOpencodePermissions({
    baseUrl: input.baseUrl,
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
  fetcher?: Fetcher
  messagePromise: OpencodeRuntimeSession['messagePromise']
  pollMs: number
  sessionId: string
  timeoutMs: number
}): Promise<OpencodePermission> {
  const expiresAt = Date.now() + input.timeoutMs
  const messageFailure = input.messagePromise.then((result) => {
    if (result.ok) {
      return new Promise<never>(() => undefined)
    }
    return { kind: 'message-error' as const, error: result.error }
  })
  while (Date.now() <= expiresAt) {
    const permissions = await listOpencodePermissions({
      baseUrl: input.baseUrl,
      ...fetcherOption(input.fetcher),
    })
    const permission = permissions.find((candidate) => candidate.sessionID === input.sessionId)
    if (permission) {
      return permission
    }
    const waitMs = Math.max(0, Math.min(input.pollMs, expiresAt - Date.now()))
    const next = await Promise.race([
      messageFailure,
      new Promise<{ kind: 'tick' }>((resolve) => setTimeout(() => resolve({ kind: 'tick' }), waitMs)),
    ])
    if (next.kind === 'message-error') {
      throw next.error
    }
  }

  throw new Error(`Timed out waiting for opencode permission request for session ${input.sessionId}`)
}

function createStartResult(
  input: CodingEngineStartInput,
  prompt: string,
  sessionId: string,
  permission: OpencodePermission,
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
      worktreePath: input.workspace.worktreePath,
      sequence: 3,
      now: input.now,
    }),
  ]
  const filePath = metadataString(permission.metadata, 'filepath') ?? metadataString(permission.metadata, 'path')
  const command = metadataString(permission.metadata, 'command')
  const safePath = filePath ? safeRelativePath(filePath, input.workspace.worktreePath) : undefined
  const permissionRequest: CodingPermissionRequest = {
    id: permission.id,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    permission: normalizePermission(permission.permission),
    title: `opencode requested ${permission.permission} permission`,
    ...(safePath ? { filePath: safePath } : {}),
    ...(command ? { command } : {}),
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
        sequence: sequence + 2,
        now,
      }),
    ],
    permissionRequest: toCodingPermissionRequest(continuedRun, permission, now, worktreePath),
  }
}

function toCodingPermissionRequest(
  codingRun: CodingAgentRun,
  permission: OpencodePermission,
  now: string,
  worktreePath: string,
): CodingPermissionRequest {
  const filePath = metadataString(permission.metadata, 'filepath') ?? metadataString(permission.metadata, 'path')
  const command = metadataString(permission.metadata, 'command')
  const safePath = filePath ? safeRelativePath(filePath, worktreePath) : undefined

  return {
    id: permission.id,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    permission: normalizePermission(permission.permission),
    title: `opencode requested ${permission.permission} permission`,
    ...(safePath ? { filePath: safePath } : {}),
    ...(command ? { command } : {}),
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
  sequence: number
  now: string
}): CodingAgentEvent {
  const metadata = buildPermissionToolMetadata({
    permissionId: input.permission.id,
    permission: input.permission.permission,
    metadata: input.permission.metadata,
    worktreePath: input.worktreePath,
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
}): Record<string, unknown> {
  const skillName = metadataString(input.metadata, 'skillName') ?? metadataString(input.metadata, 'skill')
  const toolName = metadataString(input.metadata, 'tool') ?? input.permission
  const command = metadataString(input.metadata, 'command')
  const rawPath = metadataString(input.metadata, 'filepath') ?? metadataString(input.metadata, 'path')
  const safeCommand = command ? redactSecrets(command) : undefined
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
