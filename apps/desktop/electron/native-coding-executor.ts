import { createHash, randomUUID } from 'node:crypto'
import {
  acceptAgentActionResult,
  cancelAgentRuntime,
  createAgentRuntime,
  parseCodingExecutorDescriptor,
  parseCodingExecutorRequest,
  parseCodingExecutorTurn,
  redactLocalAbsolutePaths,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
  sanitizeCodingDiffArtifact,
  selectCodingExecutor,
  validateNativeToolValue,
  estimateOpenAiCompatibleUsageCost,
  type AgentProvider,
  type AgentRuntimeState,
  type AgentRuntimeTransition,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionRequest,
  type NativeToolDefinition,
  type TestEvidence,
} from '@ai-devflow/shared'
import type { CodingExecutor } from './coding-executor.js'
import type { CodingEngineStartInput } from './coding-engine.js'
import type { LocalStore } from './local-store.js'
import {
  createNativeToolRegistry,
  digestNativeToolValue,
  type NativeToolRegistry,
} from './native-tool-registry.js'
import { createAcceptedNativeToolRegistrations } from './native-tools.js'
import { captureWorktreeDiff } from './coding-runner.js'
import type { LocalTestCommandInput, LocalTestCommandResult } from './test-runner.js'

const RUNTIME_PREFIX = 'agent-runtime-coding-'
const READ_TOOL_ID = 'repo.read_text'
const WRITE_TOOL_ID = 'workspace.write_text'
const TEST_TOOL_ID = 'workspace.run_saved_test'
const PERMISSION_WINDOW_MS = 60_000
const MAX_NATIVE_CODING_EDIT_PREVIEW_CHARS = 1_999

export type NativeCodingDecision = {
  stateVersion: 1
  read: { path: string; maxBytes: number }
  edit: { path: string; content: string }
  summary: string
}

type NativeCodingReadPlan = Pick<NativeCodingDecision, 'stateVersion' | 'read' | 'summary'>
type NativeCodingEditPlan = Pick<NativeCodingDecision, 'stateVersion' | 'edit' | 'summary'>

type NativeCodingObservation =
  | {
      kind: 'repository_read'
      path: string
      content: string
      truncated: boolean
    }
  | {
      kind: 'test_failure'
      path: string
      content: string
      testSummary: string
    }

export type NativeCodingDecisionProvider = {
  id: string
  version: number
  modelId?: string
  billing: 'no_cost' | 'metered'
  decide(input: {
    requestId: string
    objectiveDigest: string
    contextDigest: string
    brief: string
    phase: 'plan' | 'edit' | 'repair'
    attempt: 1 | 2 | 3
    testStatus: null | 'failed'
    observation: NativeCodingObservation | null
    maxOutputTokens: number
  }): Promise<unknown>
}

export type CreateNativeCodingExecutorInput = {
  store: LocalStore
  decisionProvider: NativeCodingDecisionProvider
  clock?: () => string
  createId?: (prefix: string) => string
  nativeToolRegistry?: NativeToolRegistry
  runSavedTest?: (input: LocalTestCommandInput) => Promise<LocalTestCommandResult>
}

export function createDeterministicNativeCodingDecisionProvider(): NativeCodingDecisionProvider {
  return {
    id: 'native-decision-deterministic',
    version: 1,
    modelId: 'deterministic',
    billing: 'no_cost',
    async decide(input) {
      if (input.phase === 'plan') {
        return {
          stateVersion: 1,
          read: { path: 'package.json', maxBytes: 16 * 1_024 },
          summary: 'Inspect the bounded package manifest before choosing one edit.',
        }
      }
      return {
        stateVersion: 1,
        edit: {
          path: 'devflow-native-change.txt',
          content: 'DevFlow deterministic Native Coding repair.\n',
        },
        summary: 'Apply one deterministic bounded Native Coding repair.',
      }
    },
  }
}

export function createAgentProviderNativeCodingDecisionProvider(
  provider: AgentProvider,
): NativeCodingDecisionProvider {
  if (!provider.completeStructuredJson) {
    throw new Error('Configured Agent Provider does not support bounded structured JSON decisions')
  }
  const id = `native-decision-${provider.id}`
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id)) {
    throw new Error('Configured Native Coding Agent Provider id is invalid')
  }
  return {
    id,
    version: 1,
    modelId: provider.model,
    billing: 'metered',
    async decide(input) {
      const planning = input.phase === 'plan'
      const completed = await provider.completeStructuredJson!({
        systemPrompt: planning
          ? [
              'Return only one exact JSON object with keys stateVersion, read, summary.',
              'stateVersion must be 1. read must contain one repo-relative path and maxBytes.',
              'Do not use absolute paths, .git, .devflow, node_modules, commands, credentials, or Markdown.',
            ].join(' ')
          : [
              'Return only one exact JSON object with keys stateVersion, edit, summary.',
              'stateVersion must be 1. edit must contain one repo-relative path and UTF-8 content under 1999 characters.',
              'Base the edit only on the supplied bounded observation and brief.',
              'Do not use absolute paths, .git, .devflow, node_modules, commands, credentials, or Markdown.',
            ].join(' '),
        userPrompt: JSON.stringify({
          requestId: input.requestId,
          objectiveDigest: input.objectiveDigest,
          contextDigest: input.contextDigest,
          brief: input.brief,
          phase: input.phase,
          attempt: input.attempt,
          testStatus: input.testStatus,
          observation: input.observation,
        }),
        maxOutputTokens: input.maxOutputTokens,
      })
      const usage = completed.usage
      if (
        !usage ||
        !Number.isSafeInteger(usage.inputTokens) ||
        !Number.isSafeInteger(usage.outputTokens) ||
        (usage.cacheReadTokens !== undefined && !Number.isSafeInteger(usage.cacheReadTokens)) ||
        Number(usage.inputTokens) < 0 ||
        Number(usage.outputTokens) < 0 ||
        Number(usage.cacheReadTokens ?? 0) < 0
      ) {
        throw new Error('Configured Native Coding Agent Provider did not return exact token usage')
      }
      const inputTokens = Number(usage.inputTokens)
      const outputTokens = Number(usage.outputTokens)
      const cacheReadTokens = usage.cacheReadTokens ?? 0
      return {
        decision: completed.value,
        usage: {
          tokens: inputTokens + outputTokens,
          costUsd: estimateOpenAiCompatibleUsageCost({ inputTokens, outputTokens }),
        },
      }
    },
  }
}

type PendingDecision = {
  decision: NativeCodingDecision
  decisionDigest: string
  editDigest: string
  permissionRequestId?: string
}

type PlannedDecision = PendingDecision & { tokens: number; costUsd: number }
type PlannedRead = {
  plan: NativeCodingReadPlan
  planDigest: string
  tokens: number
  costUsd: number
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('Native Coding Executor clock is invalid')
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    value.trim() === value &&
    value !== '.' &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    value.split('/').every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        segment !== '.git' &&
        segment !== '.devflow' &&
        segment !== 'node_modules',
    )
  )
}

function definition(
  registry: NativeToolRegistry,
  id: string,
): NativeToolDefinition {
  const matches = registry.listDefinitions().filter((candidate) => candidate.id === id)
  if (matches.length !== 1) throw new Error(`Native Coding Tool is unavailable: ${id}`)
  return matches[0]!
}

function parseReadPlan(
  value: unknown,
  registry: NativeToolRegistry,
): NativeCodingReadPlan {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ['stateVersion', 'read', 'summary']) ||
    value.stateVersion !== 1 ||
    !isPlainRecord(value.read) ||
    !exactKeys(value.read, ['path', 'maxBytes']) ||
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000 ||
    typeof value.read.maxBytes !== 'number' ||
    !isCanonicalRelativePath(value.read.path)
  ) {
    throw new Error('Native Coding read plan is invalid')
  }
  const read = { path: value.read.path, maxBytes: value.read.maxBytes }
  const readDefinition = definition(registry, READ_TOOL_ID)
  if (!validateNativeToolValue(readDefinition.inputSchema, read)) {
    throw new Error('Native Coding read plan does not satisfy the accepted Tool schema')
  }
  const safeSummary = redactSensitiveText(value.summary)
  if (safeSummary.redacted) {
    throw new Error('Native Coding read plan contains sensitive data')
  }
  return { stateVersion: 1, read, summary: value.summary }
}

function parseEditPlan(value: unknown, registry: NativeToolRegistry): NativeCodingEditPlan {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ['stateVersion', 'edit', 'summary']) ||
    value.stateVersion !== 1 ||
    !isPlainRecord(value.edit) ||
    !exactKeys(value.edit, ['path', 'content']) ||
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000 ||
    typeof value.edit.content !== 'string' ||
    value.edit.content.length > MAX_NATIVE_CODING_EDIT_PREVIEW_CHARS ||
    !isCanonicalRelativePath(value.edit.path)
  ) {
    throw new Error('Native Coding edit plan is invalid')
  }
  const edit = { path: value.edit.path, content: value.edit.content }
  const editDefinition = definition(registry, WRITE_TOOL_ID)
  if (!validateNativeToolValue(editDefinition.inputSchema, edit)) {
    throw new Error('Native Coding edit plan does not satisfy the accepted Tool schema')
  }
  const safeContent = redactSensitiveText(edit.content)
  const safeSummary = redactSensitiveText(value.summary)
  if (safeContent.redacted || safeSummary.redacted) {
    throw new Error('Native Coding edit plan contains sensitive data')
  }
  return { stateVersion: 1, edit, summary: value.summary }
}

function providerValue(value: unknown): {
  decision: unknown
  tokens: number
  costUsd: number
} {
  if (isPlainRecord(value) && exactKeys(value, ['decision', 'usage'])) {
    if (
      !isPlainRecord(value.usage) ||
      !exactKeys(value.usage, ['tokens', 'costUsd']) ||
      !Number.isSafeInteger(value.usage.tokens) ||
      Number(value.usage.tokens) < 0 ||
      typeof value.usage.costUsd !== 'number' ||
      !Number.isFinite(value.usage.costUsd) ||
      value.usage.costUsd < 0
    ) {
      throw new Error('Native Coding decision usage is invalid')
    }
    return {
      decision: value.decision,
      tokens: Number(value.usage.tokens),
      costUsd: value.usage.costUsd,
    }
  }
  return { decision: value, tokens: 0, costUsd: 0 }
}

function parsePlannedRead(value: unknown, registry: NativeToolRegistry): PlannedRead {
  const result = providerValue(value)
  const plan = parseReadPlan(result.decision, registry)
  return { plan, planDigest: digestNativeToolValue(plan), tokens: result.tokens, costUsd: result.costUsd }
}

function parsePlannedEdit(
  value: unknown,
  registry: NativeToolRegistry,
  read: NativeCodingDecision['read'],
): PlannedDecision {
  const result = providerValue(value)
  const editPlan = parseEditPlan(result.decision, registry)
  const decision: NativeCodingDecision = {
    stateVersion: 1,
    read,
    edit: editPlan.edit,
    summary: editPlan.summary,
  }
  return {
    decision,
    decisionDigest: digestNativeToolValue(decision),
    editDigest: digestNativeToolValue(decision.edit),
    tokens: result.tokens,
    costUsd: result.costUsd,
  }
}

function repositoryObservation(
  value: unknown,
  expectedPath: string,
): Extract<NativeCodingObservation, { kind: 'repository_read' }> {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ['path', 'content', 'truncated']) ||
    value.path !== expectedPath ||
    typeof value.content !== 'string' ||
    typeof value.truncated !== 'boolean'
  ) {
    throw new Error('Native Coding repository observation is invalid')
  }
  return {
    kind: 'repository_read',
    path: value.path,
    content: redactLocalAbsolutePaths(redactSensitiveText(value.content).value).value,
    truncated: value.truncated,
  }
}

function assertRuntimeContext(
  request: ReturnType<typeof parseCodingExecutorRequest>,
  context: CodingEngineStartInput,
  descriptorId: string,
  descriptorVersion: number,
  providerId: string,
): void {
  const node = context.run.nodes.find((candidate) => candidate.id === context.node.id)
  if (
    request.executor.id !== descriptorId ||
    request.executor.version !== descriptorVersion ||
    request.expectedCheckpointVersion !== 0 ||
    context.id !== request.id ||
    context.providerId !== providerId ||
    context.requestedBy !== request.scope.userId ||
    context.project.id !== request.scope.localProjectId ||
    context.run.id !== request.authority.runId ||
    context.run.projectId !== context.project.id ||
    context.run.version !== request.authority.runVersion ||
    context.run.currentNodeId !== request.authority.nodeId ||
    context.node.id !== request.authority.nodeId ||
    !node ||
    node.status !== 'running' ||
    (node.kind !== 'task' && node.kind !== 'agent') ||
    context.workspace.id !== request.scope.managedWorkspaceId ||
    context.workspace.codingRunId !== request.id ||
    context.workspace.projectId !== context.project.id ||
    context.workspace.sourcePath !== context.project.path ||
    context.workspace.cleanupStatus !== 'active' ||
    context.now !== request.requestedAt
  ) {
    throw new Error('Native Coding authority is stale')
  }
}

function runtimeScope(request: ReturnType<typeof parseCodingExecutorRequest>) {
  return request.scope.organizationId === null
    ? {
        kind: 'local' as const,
        organizationId: null,
        projectId: null,
        userId: request.scope.userId,
        sessionId: request.scope.sessionId,
        localProjectId: request.scope.localProjectId,
      }
    : {
        kind: 'team' as const,
        organizationId: request.scope.organizationId,
        projectId: request.scope.projectId!,
        userId: request.scope.userId,
        sessionId: request.scope.sessionId,
        localProjectId: request.scope.localProjectId,
      }
}

function permissionExpiry(requestedAt: string, deadline: string): string {
  const timestamp = Math.min(Date.parse(requestedAt) + PERMISSION_WINDOW_MS, Date.parse(deadline))
  if (timestamp <= Date.parse(requestedAt)) {
    throw new Error('Native Coding permission deadline has elapsed')
  }
  return new Date(timestamp).toISOString()
}

function safeInstruction(value: string): string {
  return redactSensitiveText(value).value
}

function instructionDigest(value: string): string {
  return sha256(value.trim())
}

function recoverPendingDecisionFromPermission(
  request: CodingPermissionRequest,
  registry: NativeToolRegistry,
): PendingDecision {
  const filePath = request.filePath
  const diffPreview = request.diffPreview
  if (
    request.permission !== 'edit' ||
    typeof filePath !== 'string' ||
    typeof diffPreview !== 'string' ||
    !diffPreview.startsWith('+') ||
    diffPreview.length < 2 ||
    diffPreview.length > MAX_NATIVE_CODING_EDIT_PREVIEW_CHARS + 1
  ) {
    throw new Error('Native Coding durable edit permission is invalid')
  }
  const edit = { path: filePath, content: diffPreview.slice(1) }
  const writeDefinition = definition(registry, WRITE_TOOL_ID)
  if (
    !isCanonicalRelativePath(edit.path) ||
    !validateNativeToolValue(writeDefinition.inputSchema, edit) ||
    redactSensitiveText(edit.content).redacted
  ) {
    throw new Error('Native Coding durable edit permission is invalid')
  }
  const decision: NativeCodingDecision = {
    stateVersion: 1,
    read: { path: edit.path, maxBytes: 1 },
    edit,
    summary: 'Recover the exact approved Native Coding edit from local durable state.',
  }
  return {
    decision,
    decisionDigest: digestNativeToolValue(decision),
    editDigest: digestNativeToolValue(edit),
    permissionRequestId: request.id,
  }
}

function nativeCodingAttempt(runtime: AgentRuntimeState): 1 | 2 {
  return runtime.activeAction?.id.endsWith('-2') ||
    runtime.acceptedActionIds.some((actionId) =>
      actionId.endsWith('-repair-plan-1') || actionId.endsWith('-edit-2') || actionId.endsWith('-test-2'),
    )
    ? 2
    : 1
}

export function createNativeCodingExecutor(input: CreateNativeCodingExecutorInput): CodingExecutor {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? ((prefix) => `${prefix}-${randomUUID()}`)
  const registryInstanceId = randomUUID()
  let nativeToolSequence = 0
  const registry = input.nativeToolRegistry ?? createNativeToolRegistry({
    tools: createAcceptedNativeToolRegistrations({
      resolveLocalProject: async (localProjectId) =>
        (await input.store.listProjects()).find((project) => project.id === localProjectId) ?? null,
      resolveManagedWorkspace: async (workspaceId) =>
        (await input.store.listManagedCodingWorkspaces()).find(
          (workspace) => workspace.id === workspaceId,
        ) ?? null,
      ...(input.runSavedTest ? { runSavedTest: input.runSavedTest } : {}),
    }),
    clock,
    createId: () =>
      `native-coding-tool-${registryInstanceId}-${String(++nativeToolSequence).padStart(6, '0')}`,
    persistence: {
      reserveGrant: async (grant) => {
        const result = await input.store.reserveAgentRuntimeCapabilityGrant(grant)
        return { reserved: result.reserved }
      },
      beginExecution: async (execution) => {
        const result = await input.store.beginAgentRuntimeToolExecution(execution)
        return { consumed: result.consumed }
      },
      appendAudit: (audit) => input.store.appendAgentRuntimeToolAudit(audit),
    },
  })
  const descriptor = parseCodingExecutorDescriptor({
    stateVersion: 1,
    id: 'coding-executor-native',
    version: 1,
    kind: 'native',
    availability: { status: 'available', reasonCode: null },
    capabilities: [
      'cancellation',
      'checkpoint_continuation',
      'structured_diff',
      'workspace_edit',
      'workspace_read',
    ],
  })
  const pendingDecisions = new Map<string, PendingDecision>()

  async function commit(
    expectedRuntime: AgentRuntimeState | null,
    transition: AgentRuntimeTransition,
  ): Promise<AgentRuntimeState> {
    const result = await input.store.commitAgentRuntimeTransition({ expectedRuntime, transition })
    if (result.committed) return result.runtime
    if (result.reason === 'runtime_exists' || result.reason === 'stale_checkpoint') {
      const current = await input.store.getAgentRuntime(transition.runtime.id)
      if (current) return current
    }
    throw new Error(`Native Coding Agent Runtime commit failed: ${result.reason}`)
  }

  async function requestAction(
    runtime: AgentRuntimeState,
    action: Parameters<typeof requestAgentAction>[0]['action'],
  ): Promise<AgentRuntimeState> {
    return commit(runtime, requestAgentAction({
      runtime,
      expectedCheckpointVersion: runtime.checkpointVersion,
      action,
      now: canonicalNow(clock),
    }))
  }

  async function resume(runtime: AgentRuntimeState): Promise<AgentRuntimeState> {
    return commit(runtime, resumeAgentRuntime({
      runtime,
      expectedCheckpointVersion: runtime.checkpointVersion,
      authority: runtime.authority,
      contextDigest: runtime.contextDigest,
      capabilitySetDigest: runtime.capabilitySetDigest,
      now: canonicalNow(clock),
    }))
  }

  return {
    descriptor,
    engine: 'fake',
    billing: input.decisionProvider.billing,
    providerId: input.decisionProvider.id,
    ...(input.decisionProvider.modelId ? { modelId: input.decisionProvider.modelId } : {}),
    async ensure({ project }) {
      if (!project.id || !project.path) throw new Error('Native Coding project is invalid')
      return { projectId: project.id, engine: 'fake', status: 'ready' }
    },
    async start(startInput) {
      const request = parseCodingExecutorRequest(startInput.request)
      selectCodingExecutor({
        descriptors: [descriptor],
        executorId: request.executor.id,
        executorVersion: request.executor.version,
        requiredCapabilities: request.requiredCapabilities,
      })
      assertRuntimeContext(
        request,
        startInput.runtimeContext,
        descriptor.id,
        descriptor.version,
        input.decisionProvider.id,
      )
      if (
        safeInstruction(startInput.runtimeContext.userInstruction) !==
          startInput.runtimeContext.userInstruction ||
        safeInstruction(startInput.runtimeContext.brief.prompt) !==
          startInput.runtimeContext.brief.prompt ||
        request.objectiveDigest !== instructionDigest(startInput.runtimeContext.userInstruction) ||
        request.contextDigest !== sha256(startInput.runtimeContext.brief.prompt)
      ) {
        throw new Error('Native Coding request digest authority is stale')
      }
      const runtimeId = `${RUNTIME_PREFIX}${request.id}`
      let runtime = await commit(null, createAgentRuntime({
        stateVersion: 1,
        id: runtimeId,
        scope: runtimeScope(request),
        authority: { ...request.authority },
        contextDigest: request.contextDigest,
        capabilitySetDigest: registry.capabilitySetDigest(),
        bounds: {
          maxSteps: 8,
          maxWallTimeMs: Date.parse(request.deadline) - Date.parse(request.requestedAt),
          maxToolCalls: 8,
          maxToolResultBytes: 256 * 1_024,
          maxTrajectoryMetadataBytes: 64 * 1_024,
          maxCheckpointBytes: 512 * 1_024,
          maxTokens: Math.max(1, request.budget.maxTokens),
          maxCostUsd: Math.max(Number.EPSILON, request.budget.maxCostUsd),
        },
        requestedAt: request.requestedAt,
        deadline: request.deadline,
      }))
      if (runtime.status !== 'checkpointed' || runtime.counters.steps !== 0) {
        throw new Error('Native Coding request has already started')
      }

      runtime = await resume(runtime)
      const planActionId = `${runtime.id}-plan-1`
      const planRequestDigest = digestNativeToolValue({
        providerId: input.decisionProvider.id,
        providerVersion: input.decisionProvider.version,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
      })
      runtime = await requestAction(runtime, {
        id: planActionId,
        kind: 'coding_executor',
        capabilityId: input.decisionProvider.id,
        capabilityVersion: input.decisionProvider.version,
        requestDigest: planRequestDigest,
        requiresPermission: false,
      })
      const plannedRead = parsePlannedRead(await input.decisionProvider.decide({
        requestId: request.id,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeInstruction(startInput.runtimeContext.brief.prompt),
        phase: 'plan',
        attempt: 1,
        testStatus: null,
        observation: null,
        maxOutputTokens: Math.max(1, Math.min(1_024, request.budget.maxTokens)),
      }), registry)
      runtime = await commit(runtime, acceptAgentActionResult({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        actionId: planActionId,
        requestDigest: planRequestDigest,
        result: {
          outcome: 'success',
          resultDigest: plannedRead.planDigest,
          resultBytes: Buffer.byteLength(JSON.stringify(plannedRead.plan), 'utf8'),
          tokens: plannedRead.tokens,
          costUsd: plannedRead.costUsd,
          evaluation: 'continue',
          evaluationSummary: 'The bounded Native Coding plan satisfies the accepted Tool schemas.',
        },
        now: canonicalNow(clock),
      }))

      runtime = await resume(runtime)
      const readDefinition = definition(registry, READ_TOOL_ID)
      const readActionId = `${runtime.id}-read-1`
      const readDigest = digestNativeToolValue(plannedRead.plan.read)
      runtime = await requestAction(runtime, {
        id: readActionId,
        kind: 'tool',
        capabilityId: readDefinition.id,
        capabilityVersion: readDefinition.version,
        requestDigest: readDigest,
        requiresPermission: false,
      })
      const readDecisionAt = canonicalNow(clock)
      const readGrant = await registry.issueGrant({
        runtime,
        toolId: readDefinition.id,
        toolVersion: readDefinition.version,
        permission: {
          decision: 'approved',
          permissionClass: readDefinition.permissionClass,
          decidedAt: readDecisionAt,
          expiresAt: runtime.deadline,
        },
        resourceScope: {
          kind: 'local_project',
          localProjectId: request.scope.localProjectId,
        },
        callLimit: 1,
      })
      const readResult = await registry.execute({
        grant: readGrant,
        runtime,
        actionId: readActionId,
        input: plannedRead.plan.read,
      })
      const observation = repositoryObservation(readResult.value, plannedRead.plan.read.path)
      runtime = await commit(runtime, acceptAgentActionResult({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        actionId: readActionId,
        requestDigest: readDigest,
        result: {
          outcome: 'success',
          resultDigest: readResult.resultDigest,
          resultBytes: readResult.resultBytes,
          tokens: 0,
          costUsd: 0,
          evaluation: 'continue',
          evaluationSummary: 'The bounded repository observation is available for one edit decision.',
        },
        now: canonicalNow(clock),
      }))
      runtime = await resume(runtime)
      const editPlanActionId = `${runtime.id}-edit-plan-1`
      const editPlanRequestDigest = digestNativeToolValue({
        providerId: input.decisionProvider.id,
        providerVersion: input.decisionProvider.version,
        contextDigest: request.contextDigest,
        observationDigest: digestNativeToolValue(observation),
      })
      runtime = await requestAction(runtime, {
        id: editPlanActionId,
        kind: 'coding_executor',
        capabilityId: input.decisionProvider.id,
        capabilityVersion: input.decisionProvider.version,
        requestDigest: editPlanRequestDigest,
        requiresPermission: false,
      })
      const pending = parsePlannedEdit(await input.decisionProvider.decide({
        requestId: request.id,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeInstruction(startInput.runtimeContext.brief.prompt),
        phase: 'edit',
        attempt: 2,
        testStatus: null,
        observation,
        maxOutputTokens: Math.max(
          1,
          Math.min(1_024, runtime.bounds.maxTokens - runtime.counters.tokens),
        ),
      }), registry, plannedRead.plan.read)
      pendingDecisions.set(request.id, pending)
      runtime = await commit(runtime, acceptAgentActionResult({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        actionId: editPlanActionId,
        requestDigest: editPlanRequestDigest,
        result: {
          outcome: 'success',
          resultDigest: pending.decisionDigest,
          resultBytes: Buffer.byteLength(JSON.stringify(pending.decision), 'utf8'),
          tokens: pending.tokens,
          costUsd: pending.costUsd,
          evaluation: 'continue',
          evaluationSummary: 'The bounded edit decision is bound to the repository observation.',
        },
        now: canonicalNow(clock),
      }))
      runtime = await resume(runtime)
      const writeDefinition = definition(registry, WRITE_TOOL_ID)
      const editActionId = `${runtime.id}-edit-1`
      runtime = await requestAction(runtime, {
        id: editActionId,
        kind: 'tool',
        capabilityId: writeDefinition.id,
        capabilityVersion: writeDefinition.version,
        requestDigest: pending.editDigest,
        requiresPermission: true,
      })
      if (runtime.status !== 'waiting_permission') {
        throw new Error('Native Coding runtime did not stop at the edit permission boundary')
      }

      const permissionRequestedAt = runtime.updatedAt
      const permissionId = createId('coding-permission')
      pendingDecisions.set(request.id, { ...pending, permissionRequestId: permissionId })
      const permissionRequest: CodingPermissionRequest = {
        id: permissionId,
        codingRunId: request.id,
        runId: request.authority.runId,
        nodeId: request.authority.nodeId,
        permission: 'edit',
        title: 'Apply the bounded Native Coding edit',
        filePath: pending.decision.edit.path,
        diffPreview: `+${pending.decision.edit.content}`,
        risk: 'warn',
        reasons: ['Native Coding must receive one-time approval before writing the managed workspace.'],
        status: 'pending',
        requestedAt: permissionRequestedAt,
        expiresAt: permissionExpiry(permissionRequestedAt, request.deadline),
      }
      const codingRun: CodingAgentRun = {
        id: request.id,
        runId: request.authority.runId,
        nodeId: request.authority.nodeId,
        projectId: request.scope.localProjectId,
        requestedBy: request.scope.userId,
        providerId: input.decisionProvider.id,
        engine: 'fake',
        status: 'waiting_permission',
        managedWorkspaceId: request.scope.managedWorkspaceId,
        branchName: startInput.runtimeContext.workspace.branchName,
        userInstruction: safeInstruction(startInput.runtimeContext.userInstruction),
        prompt: safeInstruction(startInput.runtimeContext.brief.prompt),
        summary: 'Waiting for approval to apply one bounded Native Coding edit.',
        changedPaths: [],
        startedAt: request.requestedAt,
        redacted: true,
      }
      const events: CodingAgentEvent[] = [
        {
          id: createId('coding-event-brief'),
          codingRunId: request.id,
          runId: request.authority.runId,
          nodeId: request.authority.nodeId,
          sequence: 1,
          kind: 'brief',
          message: 'Native Coding accepted one bounded brief under the current Run authority.',
          timestamp: request.requestedAt,
          redacted: true,
        },
        {
          id: createId('coding-event-read-request'),
          codingRunId: request.id,
          runId: request.authority.runId,
          nodeId: request.authority.nodeId,
          sequence: 2,
          kind: 'tool_call',
          message: 'Native Coding requested one bounded repository observation.',
          timestamp: readDecisionAt,
          metadata: { toolId: READ_TOOL_ID },
          redacted: true,
        },
        {
          id: createId('coding-event-read-result'),
          codingRunId: request.id,
          runId: request.authority.runId,
          nodeId: request.authority.nodeId,
          sequence: 3,
          kind: 'tool_result',
          message: 'The bounded repository observation completed successfully.',
          timestamp: runtime.updatedAt,
          metadata: { toolId: READ_TOOL_ID, status: 'succeeded' },
          redacted: true,
        },
        {
          id: createId('coding-event-edit-permission'),
          codingRunId: request.id,
          runId: request.authority.runId,
          nodeId: request.authority.nodeId,
          sequence: 4,
          kind: 'permission',
          message: 'Native Coding requested one-time managed-workspace edit permission.',
          timestamp: permissionRequestedAt,
          metadata: { requestId: permissionId },
          redacted: true,
        },
      ]
      const turn = parseCodingExecutorTurn({
        stateVersion: 1,
        requestId: request.id,
        status: 'waiting_permission',
        checkpointVersion: runtime.checkpointVersion,
        events: [
          {
            stateVersion: 1,
            requestId: request.id,
            sequence: 1,
            checkpointVersion: 0,
            type: 'started',
            createdAt: request.requestedAt,
            metadata: { executorId: descriptor.id, executorVersion: descriptor.version },
          },
          {
            stateVersion: 1,
            requestId: request.id,
            sequence: 2,
            checkpointVersion: runtime.checkpointVersion - 2,
            type: 'observation',
            createdAt: readDecisionAt,
            metadata: { code: 'repository_observed', status: 'succeeded' },
          },
          {
            stateVersion: 1,
            requestId: request.id,
            sequence: 3,
            checkpointVersion: runtime.checkpointVersion,
            type: 'tool_request',
            createdAt: permissionRequestedAt,
            metadata: {
              toolRequestId: editActionId,
              toolId: WRITE_TOOL_ID,
              capability: 'workspace_edit',
            },
          },
          {
            stateVersion: 1,
            requestId: request.id,
            sequence: 4,
            checkpointVersion: runtime.checkpointVersion,
            type: 'permission_request',
            createdAt: permissionRequestedAt,
            metadata: { permissionRequestId: permissionId, capability: 'workspace_edit' },
          },
        ],
        permissionRequest: {
          stateVersion: 1,
          requestId: request.id,
          id: permissionId,
          capability: 'workspace_edit',
          requestDigest: pending.editDigest,
          requestedAt: permissionRequestedAt,
          expiresAt: permissionRequest.expiresAt,
        },
      }, {
        expectedRequestId: request.id,
        previousCheckpointVersion: 0,
        previousSequence: 0,
        settledPermissionRequestIds: [],
      })
      if (turn.status !== 'waiting_permission') {
        throw new Error('Native Coding start did not produce a permission turn')
      }
      return { kind: 'waiting_permission', codingRun, events, permissionRequest, turn }
    },
    async continuePermission(continuationInput) {
      const context = continuationInput.runtimeContext
      const runtimeId = `${RUNTIME_PREFIX}${continuationInput.requestId}`
      let runtime = await input.store.getAgentRuntime(runtimeId)
      let audits = runtime ? await input.store.listAgentRuntimeToolAudits(runtime.id) : []
      let pending = pendingDecisions.get(continuationInput.requestId)
      if (
        !pending &&
        runtime &&
        (runtime.status !== 'terminal' || runtime.stopReason === 'success')
      ) {
        const attempt = nativeCodingAttempt(runtime)
        const recovered = recoverPendingDecisionFromPermission(context.request, registry)
        const durableWriteDigest =
          runtime.activeAction?.capabilityId === WRITE_TOOL_ID
            ? runtime.activeAction.requestDigest
            : audits.find(
                (audit) =>
                  audit.actionId === `${runtime!.id}-edit-${attempt}` &&
                  audit.status === 'succeeded',
              )?.inputDigest
        if (
          recovered.editDigest !== durableWriteDigest ||
          recovered.decision.edit.path !== context.request.filePath
        ) {
          throw new Error('Native Coding recovered decision does not match the durable edit')
        }
        pending = recovered
        pendingDecisions.set(continuationInput.requestId, pending)
      }
      const [storedRun, storedProjects, storedWorkspaces] = await Promise.all([
        runtime ? input.store.getRun(runtime.authority.runId) : Promise.resolve(null),
        input.store.listProjects(),
        input.store.listManagedCodingWorkspaces(),
      ])
      const storedProject = storedProjects.find((project) => project.id === context.project.id)
      const storedWorkspace = storedWorkspaces.find(
        (workspace) => workspace.id === context.workspace.id,
      )
      const decisionAt = context.now
      const decisionTimestamp = Date.parse(decisionAt)
      if (
        !pending ||
        !pending.permissionRequestId ||
        !runtime ||
        (runtime.status === 'terminal' && runtime.stopReason !== 'success') ||
        (runtime.status === 'waiting_permission' &&
          (runtime.activeAction?.capabilityId !== WRITE_TOOL_ID ||
            runtime.activeAction.requestDigest !== pending.editDigest ||
            runtime.checkpointVersion !== continuationInput.previousCheckpointVersion)) ||
        continuationInput.previousSequence < 1 ||
        !continuationInput.settledPermissionRequestIds.includes(pending.permissionRequestId) ||
        context.request.id !== pending.permissionRequestId ||
        context.request.codingRunId !== continuationInput.requestId ||
        context.request.status !== 'approved' ||
        context.request.filePath !== pending.decision.edit.path ||
        !Number.isFinite(decisionTimestamp) ||
        new Date(decisionTimestamp).toISOString() !== decisionAt ||
        decisionAt < context.request.requestedAt ||
        decisionAt >= context.request.expiresAt ||
        context.codingRun.id !== continuationInput.requestId ||
        context.codingRun.status !== 'waiting_permission' ||
        context.codingRun.managedWorkspaceId !== context.workspace.id ||
        context.codingRun.runId !== runtime.authority.runId ||
        context.codingRun.nodeId !== runtime.authority.nodeId ||
        context.codingRun.projectId !== runtime.scope.localProjectId ||
        context.codingRun.requestedBy !== runtime.scope.userId ||
        !storedRun ||
        storedRun.version !== runtime.authority.runVersion ||
        storedRun.currentNodeId !== runtime.authority.nodeId ||
        !storedProject ||
        storedProject.path !== context.project.path ||
        storedProject.testCommand !== context.project.testCommand ||
        !storedWorkspace ||
        storedWorkspace.projectId !== storedProject.id ||
        storedWorkspace.codingRunId !== continuationInput.requestId ||
        storedWorkspace.sourcePath !== storedProject.path ||
        storedWorkspace.worktreePath !== context.workspace.worktreePath ||
        storedWorkspace.cleanupStatus !== 'active'
      ) {
        throw new Error('Native Coding permission continuation is stale')
      }

      if (runtime.status === 'waiting_permission') {
        runtime = await commit(runtime, recordAgentPermissionDecision({
          runtime,
          expectedCheckpointVersion: runtime.checkpointVersion,
          actionId: runtime.activeAction!.id,
          requestDigest: pending.editDigest,
          decision: 'approved_once',
          now: decisionAt,
        }))
      }

      const attempt = nativeCodingAttempt(runtime)
      const writeActionId = `${runtime.id}-edit-${attempt}`
      if (
        runtime.status === 'waiting_action' &&
        runtime.activeAction?.capabilityId === WRITE_TOOL_ID
      ) {
        const writeDefinition = definition(registry, WRITE_TOOL_ID)
        const writeGrant = await registry.issueGrant({
          runtime,
          toolId: writeDefinition.id,
          toolVersion: writeDefinition.version,
          permission: {
            decision: 'approved',
            permissionClass: writeDefinition.permissionClass,
            decidedAt: decisionAt,
            expiresAt: runtime.deadline,
          },
          resourceScope: {
            kind: 'managed_workspace',
            localProjectId: runtime.scope.localProjectId,
            workspaceId: context.workspace.id,
          },
          callLimit: 1,
        })
        const writeResult = await registry.execute({
          grant: writeGrant,
          runtime,
          actionId: writeActionId,
          input: pending.decision.edit,
        })
        runtime = await commit(runtime, acceptAgentActionResult({
          runtime,
          expectedCheckpointVersion: runtime.checkpointVersion,
          actionId: writeActionId,
          requestDigest: pending.editDigest,
          result: {
            outcome: 'success',
            resultDigest: writeResult.resultDigest,
            resultBytes: writeResult.resultBytes,
            tokens: 0,
            costUsd: 0,
            evaluation: 'continue',
            evaluationSummary: 'The approved managed-workspace edit completed within its exact scope.',
          },
          now: canonicalNow(clock),
        }))
      }

      if (
        runtime.status === 'checkpointed' &&
        runtime.acceptedActionIds.includes(writeActionId)
      ) {
        runtime = await resume(runtime)
      }
      const testActionId = `${runtime.id}-test-${attempt}`
      const testInput = {}
      const testDigest = digestNativeToolValue(testInput)
      const testDefinition = definition(registry, TEST_TOOL_ID)
      if (runtime.status === 'running') {
        runtime = await requestAction(runtime, {
          id: testActionId,
          kind: 'tool',
          capabilityId: testDefinition.id,
          capabilityVersion: testDefinition.version,
          requestDigest: testDigest,
          requiresPermission: false,
        })
      }
      let testDecisionAt = canonicalNow(clock)
      let testValue: {
        status: 'passed' | 'failed' | 'timed_out'
        exitCode: number
        durationMs: number
        summary: string
        redacted: boolean
      } | undefined
      let completedAt: string
      if (
        runtime.status === 'waiting_action' &&
        runtime.activeAction?.capabilityId === TEST_TOOL_ID
      ) {
        audits = await input.store.listAgentRuntimeToolAudits(runtime.id)
        if (audits.some((audit) => audit.actionId === testActionId)) {
          throw new Error('Native Coding saved-test result is ambiguous after interruption')
        }
        const testGrant = await registry.issueGrant({
          runtime,
          toolId: testDefinition.id,
          toolVersion: testDefinition.version,
          permission: {
            decision: 'approved',
            permissionClass: testDefinition.permissionClass,
            decidedAt: testDecisionAt,
            expiresAt: runtime.deadline,
          },
          resourceScope: {
            kind: 'managed_workspace',
            localProjectId: runtime.scope.localProjectId,
            workspaceId: context.workspace.id,
          },
          callLimit: 1,
        })
        const testResult = await registry.execute({
          grant: testGrant,
          runtime,
          actionId: testActionId,
          input: testInput,
        })
        testValue = testResult.value as typeof testValue
        completedAt = canonicalNow(clock)
        const repairAvailable = testValue!.status !== 'passed' && attempt === 1
        runtime = await commit(runtime, acceptAgentActionResult({
          runtime,
          expectedCheckpointVersion: runtime.checkpointVersion,
          actionId: testActionId,
          requestDigest: testDigest,
          result: {
            outcome: testValue!.status === 'passed' ? 'success' : 'failure',
            resultDigest: testResult.resultDigest,
            resultBytes: testResult.resultBytes,
            tokens: 0,
            costUsd: 0,
            evaluation:
              testValue!.status === 'passed'
                ? 'success'
                : repairAvailable
                  ? 'continue'
                  : 'failure',
            evaluationSummary:
              testValue!.status === 'passed'
                ? 'The saved recognized test command passed in the managed workspace.'
                : 'The saved recognized test command did not pass in the managed workspace.',
          },
          now: completedAt,
        }))
        if (repairAvailable) {
          runtime = await resume(runtime)
          const repairActionId = `${runtime.id}-repair-plan-1`
          const repairRequestDigest = digestNativeToolValue({
            providerId: input.decisionProvider.id,
            providerVersion: input.decisionProvider.version,
            contextDigest: runtime.contextDigest,
            phase: 'repair',
            attempt: 2,
            testStatus: 'failed',
          })
          runtime = await requestAction(runtime, {
            id: repairActionId,
            kind: 'coding_executor',
            capabilityId: input.decisionProvider.id,
            capabilityVersion: input.decisionProvider.version,
            requestDigest: repairRequestDigest,
            requiresPermission: false,
          })
          const repairObservation: NativeCodingObservation = {
            kind: 'test_failure',
            path: pending.decision.edit.path,
            content: pending.decision.edit.content,
            testSummary: redactSensitiveText(testValue!.summary).value,
          }
          const repair = parsePlannedEdit(await input.decisionProvider.decide({
            requestId: continuationInput.requestId,
            objectiveDigest: instructionDigest(context.codingRun.userInstruction),
            contextDigest: runtime.contextDigest,
            brief: context.codingRun.prompt,
            phase: 'repair',
            attempt: 3,
            testStatus: 'failed',
            observation: repairObservation,
            maxOutputTokens: Math.max(
              1,
              Math.min(1_024, runtime.bounds.maxTokens - runtime.counters.tokens),
            ),
          }), registry, pending.decision.read)
          runtime = await commit(runtime, acceptAgentActionResult({
            runtime,
            expectedCheckpointVersion: runtime.checkpointVersion,
            actionId: repairActionId,
            requestDigest: repairRequestDigest,
            result: {
              outcome: 'success',
              resultDigest: repair.decisionDigest,
              resultBytes: Buffer.byteLength(JSON.stringify(repair.decision), 'utf8'),
              tokens: repair.tokens,
              costUsd: repair.costUsd,
              evaluation: 'continue',
              evaluationSummary: 'One bounded repair plan satisfies the accepted Tool schemas.',
            },
            now: canonicalNow(clock),
          }))
          runtime = await resume(runtime)
          const repairWriteDefinition = definition(registry, WRITE_TOOL_ID)
          const repairEditActionId = `${runtime.id}-edit-2`
          runtime = await requestAction(runtime, {
            id: repairEditActionId,
            kind: 'tool',
            capabilityId: repairWriteDefinition.id,
            capabilityVersion: repairWriteDefinition.version,
            requestDigest: repair.editDigest,
            requiresPermission: true,
          })
          if (runtime.status !== 'waiting_permission') {
            throw new Error('Native Coding repair did not stop at the edit permission boundary')
          }
          const repairRequestedAt = runtime.updatedAt
          const repairPermissionId = createId('coding-permission')
          const repairPermissionRequest: CodingPermissionRequest = {
            id: repairPermissionId,
            codingRunId: continuationInput.requestId,
            runId: runtime.authority.runId,
            nodeId: runtime.authority.nodeId,
            permission: 'edit',
            title: 'Apply the bounded Native Coding repair',
            filePath: repair.decision.edit.path,
            diffPreview: `+${repair.decision.edit.content}`,
            risk: 'warn',
            reasons: ['The saved test failed and one bounded repair edit requires fresh approval.'],
            status: 'pending',
            requestedAt: repairRequestedAt,
            expiresAt: permissionExpiry(repairRequestedAt, runtime.deadline),
          }
          pendingDecisions.set(continuationInput.requestId, {
            ...repair,
            permissionRequestId: repairPermissionId,
          })
          const repairCodingRun: CodingAgentRun = {
            ...context.codingRun,
            status: 'waiting_permission',
            summary: 'The saved test failed; waiting for approval of one bounded repair edit.',
            changedPaths: [],
            redacted: true,
          }
          const repairEvents: CodingAgentEvent[] = [
            {
              id: createId('coding-event-test-result'),
              codingRunId: repairCodingRun.id,
              runId: repairCodingRun.runId,
              nodeId: repairCodingRun.nodeId,
              sequence: 5,
              kind: 'test',
              message: 'The saved recognized worktree test failed and one repair was planned.',
              timestamp: completedAt,
              metadata: { status: 'failed', repairAttempt: 1 },
              redacted: true,
            },
            {
              id: createId('coding-event-edit-permission'),
              codingRunId: repairCodingRun.id,
              runId: repairCodingRun.runId,
              nodeId: repairCodingRun.nodeId,
              sequence: 6,
              kind: 'permission',
              message: 'Native Coding requested fresh approval for one bounded repair edit.',
              timestamp: repairRequestedAt,
              metadata: { requestId: repairPermissionId, repairAttempt: 1 },
              redacted: true,
            },
          ]
          const repairTurn = parseCodingExecutorTurn({
            stateVersion: 1,
            requestId: continuationInput.requestId,
            status: 'waiting_permission',
            checkpointVersion: runtime.checkpointVersion,
            events: [
              {
                stateVersion: 1,
                requestId: continuationInput.requestId,
                sequence: continuationInput.previousSequence + 1,
                checkpointVersion: continuationInput.previousCheckpointVersion + 1,
                type: 'permission_decision',
                createdAt: decisionAt,
                metadata: { permissionRequestId: context.request.id, decision: 'approved' },
              },
              {
                stateVersion: 1,
                requestId: continuationInput.requestId,
                sequence: continuationInput.previousSequence + 2,
                checkpointVersion: runtime.checkpointVersion,
                type: 'permission_request',
                createdAt: repairRequestedAt,
                metadata: { permissionRequestId: repairPermissionId, capability: 'workspace_edit' },
              },
            ],
            permissionRequest: {
              stateVersion: 1,
              requestId: continuationInput.requestId,
              id: repairPermissionId,
              capability: 'workspace_edit',
              requestDigest: repair.editDigest,
              requestedAt: repairRequestedAt,
              expiresAt: repairPermissionRequest.expiresAt,
            },
          }, {
            expectedRequestId: continuationInput.requestId,
            previousCheckpointVersion: continuationInput.previousCheckpointVersion,
            previousSequence: continuationInput.previousSequence,
            settledPermissionRequestIds: continuationInput.settledPermissionRequestIds,
          })
          if (repairTurn.status !== 'waiting_permission') {
            throw new Error('Native Coding repair did not produce a permission turn')
          }
          return {
            kind: 'waiting_permission',
            codingRun: repairCodingRun,
            events: repairEvents,
            permissionRequest: repairPermissionRequest,
            turn: repairTurn,
          }
        }
      } else {
        completedAt = canonicalNow(clock)
      }
      if (runtime.status !== 'terminal' || runtime.stopReason !== 'success') {
        pendingDecisions.delete(continuationInput.requestId)
        throw new Error('Native Coding saved tests did not pass')
      }
      if (!testValue) {
        audits = await input.store.listAgentRuntimeToolAudits(runtime.id)
        const recoveredTestAudit = audits.find(
          (audit) => audit.actionId === testActionId && audit.status === 'succeeded',
        )
        if (!recoveredTestAudit || !runtime.acceptedActionIds.includes(testActionId)) {
          throw new Error('Native Coding completed test evidence is unavailable')
        }
        testDecisionAt = recoveredTestAudit.createdAt
        completedAt = runtime.updatedAt
        testValue = {
          status: 'passed',
          exitCode: 0,
          durationMs: 0,
          summary: 'Recovered a passed saved test from the exact durable Native Tool result.',
          redacted: true,
        }
      }

      const captured = await captureWorktreeDiff({ worktreePath: storedWorkspace.worktreePath })
      const diff = sanitizeCodingDiffArtifact({
        id: `coding-diff-${continuationInput.requestId}`,
        runId: runtime.authority.runId,
        nodeId: runtime.authority.nodeId,
        projectId: runtime.scope.localProjectId,
        changedPaths: captured.changedPaths,
        patch: captured.patch,
        sourceDigest: sha256(captured.patch),
        createdAt: completedAt,
      })
      if (
        diff.truncated ||
        diff.changedPaths.length !== 1 ||
        diff.changedPaths[0] !== pending.decision.edit.path
      ) {
        pendingDecisions.delete(continuationInput.requestId)
        throw new Error('Native Coding did not produce one delivery-safe diff')
      }
      const testEvidence: TestEvidence = redactTestEvidenceForStorage({
        id: `coding-test-${continuationInput.requestId}`,
        runId: runtime.authority.runId,
        nodeId: runtime.authority.nodeId,
        projectId: runtime.scope.localProjectId,
        command: storedProject.testCommand,
        cwd: storedWorkspace.worktreePath,
        status: testValue.status,
        exitCode: testValue.exitCode < 0 ? null : testValue.exitCode,
        durationMs: testValue.durationMs,
        stdout: '',
        stderr: '',
        summary: testValue.summary,
        redacted: true,
        createdAt: completedAt,
      })
      const codingRun: CodingAgentRun = {
        ...context.codingRun,
        status: 'completed',
        summary: 'Native Coding completed one approved edit and the saved worktree test passed.',
        changedPaths: diff.changedPaths,
        completedAt,
        diffArtifactId: diff.id,
        testEvidenceId: testEvidence.id,
        redacted: true,
      }
      const events: CodingAgentEvent[] = [
        {
          id: createId('coding-event-permission-decision'),
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 5,
          kind: 'permission',
          message: 'One-time managed-workspace edit permission was approved.',
          timestamp: decisionAt,
          metadata: { requestId: context.request.id, decision: 'approved' },
          redacted: true,
        },
        {
          id: createId('coding-event-edit-result'),
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 6,
          kind: 'tool_result',
          message: 'The approved managed-workspace edit completed.',
          timestamp: decisionAt,
          metadata: { toolId: WRITE_TOOL_ID, status: 'succeeded' },
          redacted: true,
        },
        {
          id: createId('coding-event-test-request'),
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 7,
          kind: 'tool_call',
          message: 'Native Coding invoked the saved recognized test command.',
          timestamp: testDecisionAt,
          metadata: { toolId: TEST_TOOL_ID },
          redacted: true,
        },
        {
          id: createId('coding-event-test-result'),
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 8,
          kind: 'test',
          message: 'The saved recognized worktree test passed.',
          timestamp: completedAt,
          metadata: { evidenceId: testEvidence.id, status: testEvidence.status },
          redacted: true,
        },
        {
          id: createId('coding-event-diff'),
          codingRunId: codingRun.id,
          runId: codingRun.runId,
          nodeId: codingRun.nodeId,
          sequence: 9,
          kind: 'diff',
          message: 'Native Coding captured one redacted structured worktree diff.',
          timestamp: completedAt,
          metadata: { diffArtifactId: diff.id },
          redacted: true,
        },
      ]
      const turn = parseCodingExecutorTurn({
        stateVersion: 1,
        requestId: continuationInput.requestId,
        status: 'terminal',
        checkpointVersion: runtime.checkpointVersion,
        events: [
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 1,
            checkpointVersion: continuationInput.previousCheckpointVersion + 1,
            type: 'permission_decision',
            createdAt: decisionAt,
            metadata: { permissionRequestId: context.request.id, decision: 'approved' },
          },
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 2,
            checkpointVersion: continuationInput.previousCheckpointVersion + 2,
            type: 'tool_result',
            createdAt: decisionAt,
            metadata: {
              toolRequestId: writeActionId,
              status: 'succeeded',
              evidenceId: null,
            },
          },
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 3,
            checkpointVersion: runtime.checkpointVersion - 1,
            type: 'tool_request',
            createdAt: testDecisionAt,
            metadata: {
              toolRequestId: testActionId,
              toolId: TEST_TOOL_ID,
              capability: 'approved_command',
            },
          },
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 4,
            checkpointVersion: runtime.checkpointVersion,
            type: 'tool_result',
            createdAt: completedAt,
            metadata: {
              toolRequestId: testActionId,
              status: 'succeeded',
              evidenceId: testEvidence.id,
            },
          },
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 5,
            checkpointVersion: runtime.checkpointVersion,
            type: 'evidence',
            createdAt: completedAt,
            metadata: {
              diffArtifactId: diff.id,
              testEvidenceId: testEvidence.id,
              testEvidenceCount: 1,
            },
          },
          {
            stateVersion: 1,
            requestId: continuationInput.requestId,
            sequence: continuationInput.previousSequence + 6,
            checkpointVersion: runtime.checkpointVersion,
            type: 'terminal',
            createdAt: completedAt,
            metadata: { stopReason: 'success' },
          },
        ],
        terminalResult: {
          stateVersion: 1,
          requestId: continuationInput.requestId,
          stopReason: 'success',
          executor: { id: descriptor.id, version: descriptor.version, kind: descriptor.kind },
          finalCheckpointVersion: runtime.checkpointVersion,
          changedPaths: diff.changedPaths,
          diffArtifactId: diff.id,
          testEvidenceIds: [testEvidence.id],
          usage: { tokens: runtime.counters.tokens, costUsd: runtime.counters.costUsd },
          cleanup: { status: 'not_required', reasonCode: 'workspace_retained_for_delivery' },
          completedAt,
        },
      }, {
        expectedRequestId: continuationInput.requestId,
        previousCheckpointVersion: continuationInput.previousCheckpointVersion,
        previousSequence: continuationInput.previousSequence,
        settledPermissionRequestIds: continuationInput.settledPermissionRequestIds,
      })
      if (turn.status !== 'terminal') throw new Error('Native Coding completion is not terminal')
      pendingDecisions.delete(continuationInput.requestId)
      return {
        kind: 'engine_completed',
        codingRun,
        events,
        diff,
        testEvidence,
        turn,
      }
    },
    async cancel({ codingRun }) {
      const runtimeId = `${RUNTIME_PREFIX}${codingRun.id}`
      registry.cancelRuntime(runtimeId)
      const runtime = await input.store.getAgentRuntime(runtimeId)
      if (!runtime || runtime.status === 'terminal') return
      await commit(runtime, cancelAgentRuntime({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        now: canonicalNow(clock),
      }))
      pendingDecisions.delete(codingRun.id)
    },
  }
}
