import {
  buildCodingBrief,
  sanitizeCodingDiffArtifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
} from '@ai-devflow/shared'
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
  messagePromise: Promise<
    | { ok: true }
    | { ok: false; error: unknown }
  >
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
      sessions.set(input.id, {
        baseUrl: server.baseUrl,
        directory: input.workspace.worktreePath,
        messagePromise,
        sessionId: session.id,
      })
      const permission = await waitForPermission({
        baseUrl: server.baseUrl,
        pollMs: config.permissionPollMs ?? 1_000,
        sessionId: session.id,
        timeoutMs: config.permissionDiscoveryTimeoutMs ?? 60_000,
        ...fetcherOption(config.fetcher),
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
      const messageResult = await session.messagePromise
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
        {
          id: `coding-event-${input.codingRun.id}-diff`,
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 3,
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
  pollMs: number
  sessionId: string
  timeoutMs: number
}): Promise<OpencodePermission> {
  const expiresAt = Date.now() + input.timeoutMs
  while (Date.now() <= expiresAt) {
    const permissions = await listOpencodePermissions({
      baseUrl: input.baseUrl,
      ...fetcherOption(input.fetcher),
    })
    const permission = permissions.find((candidate) => candidate.sessionID === input.sessionId)
    if (permission) {
      return permission
    }
    await new Promise((resolve) => setTimeout(resolve, input.pollMs))
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
  ]
  const filePath = metadataString(permission.metadata, 'filepath') ?? metadataString(permission.metadata, 'path')
  const command = metadataString(permission.metadata, 'command')
  const permissionRequest: CodingPermissionRequest = {
    id: permission.id,
    codingRunId: codingRun.id,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    permission: normalizePermission(permission.permission),
    title: `opencode requested ${permission.permission} permission`,
    ...(filePath ? { filePath } : {}),
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

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
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
