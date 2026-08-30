import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  estimateOpenAiCompatibleUsageCost,
  parseCodingExecutorDescriptor,
  parseCodingExecutorRequest,
  parseCodingExecutorTurn,
  redactLocalAbsolutePaths,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  sanitizeCodingDiffArtifact,
  selectCodingExecutor,
  type AgentProvider,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingChangeSet,
  type CodingPermissionRequest,
  type CodingRuntimeCostSummary,
  type TestEvidence,
} from '@ai-devflow/shared'
import type { CodingEngineStartInput } from './coding-engine.js'
import type { CodingExecutor } from './coding-executor.js'
import {
  applyCodingChangeSetAtomically,
  prepareCodingChangeSet,
  readCodingChangeSetExecutionPhase,
  readCodingWorkspaceTextFile,
  verifyCodingChangeSetDigest,
  writeCodingChangeSetExecutionPhase,
} from './coding-change-set.js'
import { captureWorktreeDiff } from './coding-runner.js'
import type { LocalStore } from './local-store.js'
import { runLocalTestCommand, type LocalTestCommandInput, type LocalTestCommandResult } from './test-runner.js'

const MAX_MANIFEST_PATHS = 256
const MAX_MANIFEST_DEPTH = 6
const MAX_MANIFEST_BYTES = 12 * 1_024
const MAX_EXCERPTS = 8
const MAX_EXCERPT_BYTES = 32 * 1_024
const MAX_EXCERPT_TOTAL_BYTES = 128 * 1_024
const MAX_PROMPT_CHARS = 30_000
const MAX_OUTPUT_TOKENS = 4_096
const PERMISSION_WINDOW_MS = 15 * 60_000
const TEST_TIMEOUT_MS = 120_000

type ProviderUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number
}

type NativeV2ModelResult = {
  value: Record<string, unknown>
  usage: ProviderUsage
}

export type NativeCodingV2DecisionProvider = {
  id: string
  version: 2
  modelId: string
  billing: 'metered'
  complete(input: {
    phase: 'analysis' | 'initial' | 'repair'
    systemPrompt: string
    userPrompt: string
    maxOutputTokens: number
  }): Promise<NativeV2ModelResult>
}

type SearchPlan = {
  stateVersion: 2
  files: string[]
  searches: Array<{ query: string; path?: string }>
  summary: string
}

type ChangeProposal = {
  stateVersion: 2
  changes: Array<{
    path: string
    replacements: Array<{ oldText: string; newText: string }>
  }>
  summary: string
}

type Excerpt = { path: string; content: string; reason: 'selected' | 'search' }

export type CreateNativeCodingExecutorV2Input = {
  store: LocalStore
  decisionProvider: NativeCodingV2DecisionProvider
  configVersion: number
  clock?: () => string
  createId?: (prefix: string) => string
  runSavedTest?: (input: LocalTestCommandInput) => Promise<LocalTestCommandResult>
  testTimeoutMs?: number
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    value === value.trim() &&
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

function canonicalNow(clock: () => string): string {
  const value = clock()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Native Coding v2 clock is invalid')
  }
  return value
}

function safeText(value: string): string {
  return redactLocalAbsolutePaths(redactSensitiveText(value).value).value
}

function permissionExpiry(requestedAt: string, deadline: string): string {
  const timestamp = Math.min(Date.parse(requestedAt) + PERMISSION_WINDOW_MS, Date.parse(deadline))
  if (timestamp <= Date.parse(requestedAt)) {
    throw new Error('Native Coding v2 permission deadline has elapsed')
  }
  return new Date(timestamp).toISOString()
}

function mergeUsage(...values: Array<ProviderUsage | undefined>): ProviderUsage {
  return values.reduce<ProviderUsage>(
    (total, value) => ({
      inputTokens: total.inputTokens + (value?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (value?.outputTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (value?.cacheReadTokens ?? 0),
      costUsd: Number((total.costUsd + (value?.costUsd ?? 0)).toFixed(6)),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  )
}

function costSummary(input: {
  codingRun: Pick<CodingAgentRun, 'runId' | 'nodeId' | 'requestedBy' | 'projectId'>
  providerId: string
  model: string
  usage: ProviderUsage
  timestamp: string
}): CodingRuntimeCostSummary {
  const normalized = input.providerId.toLowerCase()
  const provider = normalized.includes('anthropic') || normalized.includes('claude')
    ? 'anthropic'
    : normalized.includes('dashscope') || normalized.includes('qwen')
      ? 'dashscope'
      : 'openai'
  return {
    id: `coding-runtime-cost-${input.codingRun.runId}-${input.codingRun.nodeId}`,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    userId: input.codingRun.requestedBy,
    projectId: input.codingRun.projectId,
    provider,
    providerId: input.providerId,
    model: input.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    costUsd: input.usage.costUsd,
    timestamp: input.timestamp,
    source: 'provider_reported',
    redacted: true,
  }
}

function usageFromRun(run: CodingAgentRun): ProviderUsage {
  const usage = run.runtimeCostSummary
  return usage?.source === 'provider_reported'
    ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costUsd: usage.costUsd,
      }
    : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
}

function boundedPrompt(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX_PROMPT_CHARS) {
    throw new Error('Native Coding v2 final model prompt exceeds 30,000 characters')
  }
  return serialized
}

function parseSearchPlan(value: unknown, manifest: readonly string[]): SearchPlan {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['stateVersion', 'files', 'searches', 'summary']) ||
    value.stateVersion !== 2 ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.searches) ||
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000 ||
    value.files.length > MAX_EXCERPTS ||
    value.searches.length > MAX_EXCERPTS ||
    value.files.some((entry) => !isCanonicalRelativePath(entry) || !manifest.includes(entry)) ||
    new Set(value.files).size !== value.files.length
  ) {
    throw new Error('Native Coding v2 repository analysis plan is invalid')
  }
  const searches = value.searches.map((entry) => {
    if (
      !isPlainRecord(entry) ||
      !(
        hasExactKeys(entry, ['query']) ||
        hasExactKeys(entry, ['query', 'path'])
      ) ||
      typeof entry.query !== 'string' ||
      entry.query.length < 1 ||
      entry.query.length > 200 ||
      /[\r\n\u0000]/u.test(entry.query) ||
      (entry.path !== undefined &&
        (!isCanonicalRelativePath(entry.path) || !manifest.includes(entry.path)))
    ) {
      throw new Error('Native Coding v2 bounded search request is invalid')
    }
    return entry.path === undefined
      ? { query: entry.query }
      : { query: entry.query, path: entry.path }
  })
  return {
    stateVersion: 2,
    files: [...value.files] as string[],
    searches,
    summary: safeText(value.summary),
  }
}

function parseChangeProposal(value: unknown, allowedPaths: ReadonlySet<string>): ChangeProposal {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['stateVersion', 'changes', 'summary']) ||
    value.stateVersion !== 2 ||
    !Array.isArray(value.changes) ||
    value.changes.length < 1 ||
    value.changes.length > 6 ||
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000
  ) {
    throw new Error('Native Coding v2 Change Set proposal is invalid')
  }
  let replacements = 0
  const changes = value.changes.map((entry) => {
    if (
      !isPlainRecord(entry) ||
      !hasExactKeys(entry, ['path', 'replacements']) ||
      !isCanonicalRelativePath(entry.path) ||
      !allowedPaths.has(entry.path) ||
      !Array.isArray(entry.replacements) ||
      entry.replacements.length < 1
    ) {
      throw new Error('Native Coding v2 Change Set path is invalid')
    }
    const parsed = entry.replacements.map((replacement) => {
      if (
        !isPlainRecord(replacement) ||
        !hasExactKeys(replacement, ['oldText', 'newText']) ||
        typeof replacement.oldText !== 'string' ||
        typeof replacement.newText !== 'string' ||
        replacement.oldText.length < 1 ||
        replacement.oldText === replacement.newText
      ) {
        throw new Error('Native Coding v2 exact replacement is invalid')
      }
      replacements += 1
      return { oldText: replacement.oldText, newText: replacement.newText }
    })
    return { path: entry.path, replacements: parsed }
  })
  if (replacements > 12 || new Set(changes.map((change) => change.path)).size !== changes.length) {
    throw new Error('Native Coding v2 Change Set bounds are invalid')
  }
  return { stateVersion: 2, changes, summary: safeText(value.summary) }
}

async function buildRepositoryManifest(worktreePath: string): Promise<string[]> {
  const paths: string[] = []
  async function visit(relativeDirectory: string, depth: number): Promise<void> {
    if (depth > MAX_MANIFEST_DEPTH || paths.length >= MAX_MANIFEST_PATHS) return
    const absoluteDirectory = path.join(worktreePath, relativeDirectory)
    const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (paths.length >= MAX_MANIFEST_PATHS) break
      if (['.git', '.devflow', 'node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      if (!isCanonicalRelativePath(relativePath) || entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(relativePath, depth + 1)
      } else if (entry.isFile()) {
        const candidate = [...paths, relativePath]
        if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_MANIFEST_BYTES) return
        paths.push(relativePath)
      }
    }
  }
  await visit('', 1)
  return paths
}

function excerptAround(content: string, query?: string): string {
  const maxChars = MAX_EXCERPT_BYTES
  if (!query) return content.slice(0, maxChars)
  const index = content.indexOf(query)
  if (index < 0) return ''
  const start = Math.max(0, index - Math.floor(maxChars / 2))
  return content.slice(start, start + maxChars)
}

async function collectExcerpts(input: {
  worktreePath: string
  manifest: string[]
  plan: SearchPlan
}): Promise<Excerpt[]> {
  const excerpts: Excerpt[] = []
  const seen = new Set<string>()
  let totalBytes = 0
  async function add(filePath: string, reason: Excerpt['reason'], query?: string): Promise<boolean> {
    if (excerpts.length >= MAX_EXCERPTS || seen.has(filePath)) return false
    let content: string
    try {
      content = await readCodingWorkspaceTextFile(input.worktreePath, filePath)
    } catch {
      return false
    }
    const excerpt = safeText(excerptAround(content, query))
    if (!excerpt) return false
    const remaining = MAX_EXCERPT_TOTAL_BYTES - totalBytes
    if (remaining <= 0) return false
    const bounded = Buffer.from(excerpt, 'utf8').subarray(0, Math.min(MAX_EXCERPT_BYTES, remaining)).toString('utf8')
    excerpts.push({ path: filePath, content: bounded, reason })
    seen.add(filePath)
    totalBytes += Buffer.byteLength(bounded, 'utf8')
    return true
  }
  for (const filePath of input.plan.files) await add(filePath, 'selected')
  for (const search of input.plan.searches) {
    const candidates = search.path ? [search.path] : input.manifest
    for (const filePath of candidates) {
      let content: string
      try {
        content = await readCodingWorkspaceTextFile(input.worktreePath, filePath)
      } catch {
        continue
      }
      if (content.includes(search.query) && await add(filePath, 'search', search.query)) break
    }
  }
  if (excerpts.length < 1) throw new Error('Native Coding v2 analysis did not select readable code')
  return excerpts
}

function fitChangePrompt(input: Record<string, unknown> & { excerpts: Excerpt[] }): string {
  const excerpts = input.excerpts.map((excerpt) => ({ ...excerpt }))
  while (excerpts.length > 0) {
    const serialized = JSON.stringify({ ...input, excerpts })
    if (serialized.length <= MAX_PROMPT_CHARS) return serialized
    const longest = excerpts.reduce((current, excerpt) =>
      excerpt.content.length > current.content.length ? excerpt : current,
    )
    if (longest.content.length > 512) {
      longest.content = longest.content.slice(0, Math.max(512, longest.content.length - 2_048))
    } else {
      excerpts.pop()
    }
  }
  throw new Error('Native Coding v2 could not fit repository evidence in the 30,000 character prompt')
}

function assertStartAuthority(
  request: ReturnType<typeof parseCodingExecutorRequest>,
  context: CodingEngineStartInput,
  descriptor: CodingExecutor['descriptor'],
  providerId: string,
): void {
  if (
    request.executor.id !== descriptor.id ||
    request.executor.version !== descriptor.version ||
    context.id !== request.id ||
    context.providerId !== providerId ||
    context.project.id !== request.scope.localProjectId ||
    context.workspace.id !== request.scope.managedWorkspaceId ||
    context.workspace.codingRunId !== request.id ||
    context.workspace.cleanupStatus !== 'active' ||
    context.run.id !== request.authority.runId ||
    context.node.id !== request.authority.nodeId ||
    context.now !== request.requestedAt ||
    request.objectiveDigest !== sha256(context.userInstruction.trim()) ||
    request.contextDigest !== sha256(context.brief.prompt)
  ) {
    throw new Error('Native Coding v2 authority is stale')
  }
}

function permissionForChangeSet(input: {
  id: string
  changeSet: CodingChangeSet
  runId: string
  nodeId: string
  requestedAt: string
  phase: CodingChangeSet['phase']
}): CodingPermissionRequest {
  return {
    id: input.id,
    codingRunId: input.changeSet.codingRunId,
    runId: input.runId,
    nodeId: input.nodeId,
    origin: 'coding_executor',
    permission: 'patch',
    title: input.phase === 'initial' ? 'Apply the proposed Coding Change Set' : 'Apply the proposed repair Change Set',
    changeSetId: input.changeSet.id,
    changeSetDigest: input.changeSet.changeSetDigest,
    risk: 'warn',
    reasons: [
      `Review all ${input.changeSet.changes.length} changed file(s) and the exact Change Set digest.`,
      'Approved changes are applied only inside the managed worktree.',
    ],
    status: 'pending',
    requestedAt: input.requestedAt,
    expiresAt: input.changeSet.expiresAt,
  }
}

function waitingTurn(input: {
  requestId: string
  descriptor: CodingExecutor['descriptor']
  permission: CodingPermissionRequest
  previousCheckpointVersion: number
  previousSequence: number
  settledPermissionRequestIds: string[]
  startedAt?: string
  includeDecisionId?: string
}) {
  const checkpointVersion = input.previousCheckpointVersion + 1
  let sequence = input.previousSequence
  const events = [
    ...(sequence === 0
      ? [{
          stateVersion: 1 as const,
          requestId: input.requestId,
          sequence: ++sequence,
          checkpointVersion: 0,
          type: 'started' as const,
          createdAt: input.startedAt ?? input.permission.requestedAt,
          metadata: { executorId: input.descriptor.id, executorVersion: input.descriptor.version },
        }]
      : []),
    ...(input.includeDecisionId
      ? [{
          stateVersion: 1 as const,
          requestId: input.requestId,
          sequence: ++sequence,
          checkpointVersion,
          type: 'permission_decision' as const,
          createdAt: input.permission.requestedAt,
          metadata: { permissionRequestId: input.includeDecisionId, decision: 'approved' },
        }]
      : []),
    {
      stateVersion: 1 as const,
      requestId: input.requestId,
      sequence: ++sequence,
      checkpointVersion,
      type: 'permission_request' as const,
      createdAt: input.permission.requestedAt,
      metadata: { permissionRequestId: input.permission.id, capability: 'workspace_edit' },
    },
  ]
  return parseCodingExecutorTurn({
    stateVersion: 1,
    requestId: input.requestId,
    status: 'waiting_permission',
    checkpointVersion,
    events,
    permissionRequest: {
      stateVersion: 1,
      requestId: input.requestId,
      id: input.permission.id,
      capability: 'workspace_edit',
      requestDigest: input.permission.changeSetDigest!,
      requestedAt: input.permission.requestedAt,
      expiresAt: input.permission.expiresAt,
    },
  }, {
    expectedRequestId: input.requestId,
    previousCheckpointVersion: input.previousCheckpointVersion,
    previousSequence: input.previousSequence,
    settledPermissionRequestIds: input.settledPermissionRequestIds,
  })
}

export function createAgentProviderNativeCodingV2DecisionProvider(
  provider: AgentProvider,
): NativeCodingV2DecisionProvider {
  if (!provider.completeStructuredJson) {
    throw new Error('Configured Coding Provider does not support structured JSON')
  }
  return {
    id: provider.id,
    version: 2,
    modelId: provider.model,
    billing: 'metered',
    async complete(input) {
      if (input.userPrompt.length > MAX_PROMPT_CHARS) {
        throw new Error('Native Coding v2 provider prompt exceeds the hard limit')
      }
      const completed = await provider.completeStructuredJson!({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
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
        throw new Error('Configured Coding Provider did not return exact integer token usage')
      }
      const inputTokens = Number(usage.inputTokens)
      const outputTokens = Number(usage.outputTokens)
      const cacheReadTokens = Number(usage.cacheReadTokens ?? 0)
      return {
        value: completed.value,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          costUsd: estimateOpenAiCompatibleUsageCost({ inputTokens, outputTokens }),
        },
      }
    },
  }
}

export function createNativeCodingExecutorV2(input: CreateNativeCodingExecutorV2Input): CodingExecutor {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? ((prefix) => `${prefix}-${randomUUID()}`)
  const runSavedTest = input.runSavedTest ?? runLocalTestCommand
  const descriptor = parseCodingExecutorDescriptor({
    stateVersion: 1,
    id: 'coding-executor-native',
    version: 2,
    kind: 'native',
    availability: { status: 'available', reasonCode: null },
    capabilities: [
      'cancellation',
      'checkpoint_continuation',
      'structured_diff',
      'structured_test_evidence',
      'workspace_edit',
      'workspace_read',
    ],
  })

  async function findChangeSetForPermission(
    codingRun: CodingAgentRun,
    permission: CodingPermissionRequest,
  ): Promise<CodingChangeSet> {
    if (!permission.changeSetId || !permission.changeSetDigest) {
      throw new Error('Native Coding v2 permission is not bound to a Change Set')
    }
    const changeSet = await input.store.getCodingChangeSet(permission.changeSetId)
    if (
      !changeSet ||
      changeSet.codingRunId !== codingRun.id ||
      changeSet.projectId !== codingRun.projectId ||
      changeSet.workspaceId !== codingRun.managedWorkspaceId ||
      changeSet.providerId !== input.decisionProvider.id ||
      changeSet.configVersion !== input.configVersion ||
      changeSet.changeSetDigest !== permission.changeSetDigest ||
      codingRun.changeSetId !== changeSet.id
    ) {
      throw new Error('Native Coding v2 Change Set authority is stale')
    }
    verifyCodingChangeSetDigest(changeSet)
    return changeSet
  }

  async function runTests(context: {
    codingRun: CodingAgentRun
    project: CodingEngineStartInput['project']
    workspace: CodingEngineStartInput['workspace']
    createdAt: string
  }): Promise<{ result: LocalTestCommandResult; evidence: TestEvidence }> {
    const result = await runSavedTest({
      command: context.project.testCommand,
      cwd: context.workspace.worktreePath,
      timeoutMs: input.testTimeoutMs ?? TEST_TIMEOUT_MS,
    })
    return {
      result,
      evidence: redactTestEvidenceForStorage({
        id: createId('coding-test'),
        runId: context.codingRun.runId,
        nodeId: context.codingRun.nodeId,
        projectId: context.codingRun.projectId,
        command: context.project.testCommand,
        cwd: context.workspace.worktreePath,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        summary: result.summary,
        redacted: result.redacted,
        createdAt: context.createdAt,
      }),
    }
  }

  return {
    descriptor,
    engine: 'native',
    providerId: input.decisionProvider.id,
    modelId: input.decisionProvider.modelId,
    billing: 'metered',
    async ensure({ project }) {
      if (!project.id || !project.path || !project.testCommand.trim()) {
        throw new Error('Native Coding v2 requires a project and saved test command')
      }
      return { projectId: project.id, engine: 'native', status: 'ready' }
    },
    async start(startInput) {
      const request = parseCodingExecutorRequest(startInput.request)
      selectCodingExecutor({
        descriptors: [descriptor],
        executorId: request.executor.id,
        executorVersion: request.executor.version,
        requiredCapabilities: request.requiredCapabilities,
      })
      assertStartAuthority(
        request,
        startInput.runtimeContext,
        descriptor,
        input.decisionProvider.id,
      )
      const context = startInput.runtimeContext
      const manifest = await buildRepositoryManifest(context.workspace.worktreePath)
      if (manifest.length < 1) throw new Error('Native Coding v2 repository manifest is empty')
      const analysisPrompt = boundedPrompt({
        stateVersion: 2,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeText(context.brief.prompt).slice(0, 12_000),
        repositoryManifest: manifest,
        limits: { maxFiles: 8, maxSearches: 8, literalSearchOnly: true },
      })
      const analysis = await input.decisionProvider.complete({
        phase: 'analysis',
        systemPrompt: [
          'Return only JSON with exact keys stateVersion, files, searches, summary.',
          'stateVersion is 2. Select only paths from repositoryManifest.',
          'searches contain literal query and optional path. Do not propose edits yet.',
        ].join(' '),
        userPrompt: analysisPrompt,
        maxOutputTokens: Math.min(2_048, MAX_OUTPUT_TOKENS),
      })
      const plan = parseSearchPlan(analysis.value, manifest)
      const excerpts = await collectExcerpts({
        worktreePath: context.workspace.worktreePath,
        manifest,
        plan,
      })
      const initialPrompt = fitChangePrompt({
        stateVersion: 2,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeText(context.brief.prompt).slice(0, 10_000),
        analysisSummary: plan.summary,
        excerpts,
        limits: { existingUtf8Files: true, maxFiles: 6, maxReplacements: 12 },
      })
      const initialResult = await input.decisionProvider.complete({
        phase: 'initial',
        systemPrompt: [
          'Return only JSON with exact keys stateVersion, changes, summary.',
          'stateVersion is 2. Each change has exact keys path and replacements.',
          'Each replacement has exact oldText and newText. oldText must occur exactly once.',
          'Use only supplied excerpt paths. Do not create, delete, rename, or edit binary files.',
        ].join(' '),
        userPrompt: initialPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      const proposal = parseChangeProposal(
        initialResult.value,
        new Set(excerpts.map((excerpt) => excerpt.path)),
      )
      const requestedAt = canonicalNow(clock)
      const expiresAt = permissionExpiry(requestedAt, request.deadline)
      const changeSet = await prepareCodingChangeSet({
        id: createId('coding-change-set'),
        codingRunId: request.id,
        projectId: context.project.id,
        workspaceId: context.workspace.id,
        worktreePath: context.workspace.worktreePath,
        phase: 'initial',
        configVersion: input.configVersion,
        providerId: input.decisionProvider.id,
        createdAt: requestedAt,
        expiresAt,
        proposal: proposal.changes,
      })
      await input.store.saveCodingChangeSet(changeSet)
      const permissionRequest = permissionForChangeSet({
        id: createId('coding-permission'),
        changeSet,
        runId: context.run.id,
        nodeId: context.node.id,
        requestedAt,
        phase: 'initial',
      })
      const usage = mergeUsage(analysis.usage, initialResult.usage)
      const codingRun: CodingAgentRun = {
        id: request.id,
        runId: context.run.id,
        nodeId: context.node.id,
        projectId: context.project.id,
        requestedBy: context.requestedBy,
        providerId: input.decisionProvider.id,
        engine: 'native',
        configVersion: input.configVersion,
        changeSetId: changeSet.id,
        status: 'waiting_permission',
        managedWorkspaceId: context.workspace.id,
        branchName: context.workspace.branchName,
        userInstruction: safeText(context.userInstruction),
        prompt: safeText(context.brief.prompt),
        summary: `Waiting for approval of ${changeSet.changes.length} file(s) in the exact Native Coding v2 Change Set.`,
        changedPaths: [],
        startedAt: request.requestedAt,
        runtimeCostSummary: costSummary({
          codingRun: {
            runId: context.run.id,
            nodeId: context.node.id,
            requestedBy: context.requestedBy,
            projectId: context.project.id,
          },
          providerId: input.decisionProvider.id,
          model: input.decisionProvider.modelId,
          usage,
          timestamp: requestedAt,
        }),
        redacted: true,
      }
      const events: CodingAgentEvent[] = [
        {
          id: createId('coding-event'), codingRunId: request.id, runId: context.run.id,
          nodeId: context.node.id, sequence: 1, kind: 'brief',
          message: 'Native Coding v2 built a bounded repository manifest and selected code evidence.',
          timestamp: request.requestedAt, metadata: { manifestPaths: manifest.length, excerpts: excerpts.length }, redacted: true,
        },
        {
          id: createId('coding-event'), codingRunId: request.id, runId: context.run.id,
          nodeId: context.node.id, sequence: 2, kind: 'permission',
          message: `Native Coding v2 proposed ${changeSet.changes.length} file(s) for exact approval.`,
          timestamp: requestedAt,
          metadata: { requestId: permissionRequest.id, changeSetId: changeSet.id, changeSetDigest: changeSet.changeSetDigest },
          redacted: true,
        },
      ]
      const turn = waitingTurn({
        requestId: request.id,
        descriptor,
        permission: permissionRequest,
        previousCheckpointVersion: 0,
        previousSequence: 0,
        settledPermissionRequestIds: [],
        startedAt: request.requestedAt,
      })
      if (turn.status !== 'waiting_permission') throw new Error('Native Coding v2 did not stop for approval')
      return { kind: 'waiting_permission', codingRun, events, permissionRequest, turn }
    },
    async continuePermission(continuationInput) {
      const context = continuationInput.runtimeContext
      const { codingRun, request, workspace, project } = context
      if (
        request.status !== 'approved' ||
        codingRun.id !== continuationInput.requestId ||
        codingRun.status !== 'waiting_permission' ||
        codingRun.providerId !== input.decisionProvider.id ||
        codingRun.configVersion !== input.configVersion ||
        codingRun.managedWorkspaceId !== workspace.id ||
        workspace.codingRunId !== codingRun.id ||
        workspace.projectId !== project.id ||
        workspace.cleanupStatus !== 'active'
      ) {
        throw new Error('Native Coding v2 permission continuation is stale')
      }
      const changeSet = await findChangeSetForPermission(codingRun, request)
      await applyCodingChangeSetAtomically({ changeSet, worktreePath: workspace.worktreePath, now: context.now })
      const recoveredPhase = await readCodingChangeSetExecutionPhase({
        changeSet,
        worktreePath: workspace.worktreePath,
      })
      if (recoveredPhase) {
        throw new Error(`Interrupted Native Coding v2 ${recoveredPhase} phase requires an explicit retry`)
      }
      const testedAt = canonicalNow(clock)
      await writeCodingChangeSetExecutionPhase({
        changeSet,
        worktreePath: workspace.worktreePath,
        phase: 'testing',
        updatedAt: testedAt,
      })
      const tested = await runTests({ codingRun, project, workspace, createdAt: testedAt })
      if (tested.result.status !== 'passed' && changeSet.phase === 'initial') {
        await writeCodingChangeSetExecutionPhase({
          changeSet,
          worktreePath: workspace.worktreePath,
          phase: 'repair_planning',
          updatedAt: canonicalNow(clock),
        })
        const initialPaths = new Set(changeSet.changes.map((change) => change.path))
        const excerpts = await Promise.all(changeSet.changes.map(async (change) => ({
          path: change.path,
          content: safeText((await readCodingWorkspaceTextFile(workspace.worktreePath, change.path)).slice(0, MAX_EXCERPT_BYTES)),
          reason: 'selected' as const,
        })))
        const repairPrompt = fitChangePrompt({
          stateVersion: 2,
          brief: safeText(codingRun.prompt).slice(0, 8_000),
          testFailure: {
            summary: safeText(tested.result.summary),
            stdout: safeText(tested.result.stdout).slice(-4_000),
            stderr: safeText(tested.result.stderr).slice(-4_000),
          },
          excerpts,
          limits: { existingPreviouslyChangedFilesOnly: true, maxFiles: 6, maxReplacements: 12 },
        })
        const repairResult = await input.decisionProvider.complete({
          phase: 'repair',
          systemPrompt: [
            'Return only JSON with exact keys stateVersion, changes, summary.',
            'stateVersion is 2. Repair only supplied files using exact oldText/newText replacements.',
            'Do not create, delete, rename, or touch any path outside the initial Change Set.',
          ].join(' '),
          userPrompt: repairPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
        const repairProposal = parseChangeProposal(repairResult.value, initialPaths)
        const requestedAt = canonicalNow(clock)
        // The initial permission was already capped by the executor request deadline.
        // A repair approval may use the remaining window, but must never extend it.
        const expiresAt = permissionExpiry(requestedAt, request.expiresAt)
        const repairChangeSet = await prepareCodingChangeSet({
          id: createId('coding-change-set'),
          codingRunId: codingRun.id,
          projectId: project.id,
          workspaceId: workspace.id,
          worktreePath: workspace.worktreePath,
          phase: 'repair',
          configVersion: input.configVersion,
          providerId: input.decisionProvider.id,
          createdAt: requestedAt,
          expiresAt,
          proposal: repairProposal.changes,
        })
        await input.store.saveCodingChangeSet(repairChangeSet)
        await input.store.saveTestEvidence(tested.evidence)
        const permissionRequest = permissionForChangeSet({
          id: createId('coding-permission'), changeSet: repairChangeSet,
          runId: codingRun.runId, nodeId: codingRun.nodeId, requestedAt, phase: 'repair',
        })
        const usage = mergeUsage(usageFromRun(codingRun), repairResult.usage)
        const repairRun: CodingAgentRun = {
          ...codingRun,
          changeSetId: repairChangeSet.id,
          status: 'waiting_permission',
          summary: 'The saved test failed; waiting for approval of the exact repair Change Set.',
          runtimeCostSummary: costSummary({
            codingRun,
            providerId: input.decisionProvider.id,
            model: input.decisionProvider.modelId,
            usage,
            timestamp: requestedAt,
          }),
        }
        const events: CodingAgentEvent[] = [
          {
            id: createId('coding-event'), codingRunId: codingRun.id, runId: codingRun.runId,
            nodeId: codingRun.nodeId, sequence: 1, kind: 'test',
            message: 'The saved worktree test failed; Native Coding v2 generated one bounded repair proposal.',
            timestamp: testedAt, metadata: { status: tested.result.status, evidenceId: tested.evidence.id }, redacted: true,
          },
          {
            id: createId('coding-event'), codingRunId: codingRun.id, runId: codingRun.runId,
            nodeId: codingRun.nodeId, sequence: 2, kind: 'permission',
            message: 'Native Coding v2 requested fresh approval for the repair Change Set.',
            timestamp: requestedAt,
            metadata: { requestId: permissionRequest.id, changeSetId: repairChangeSet.id, changeSetDigest: repairChangeSet.changeSetDigest },
            redacted: true,
          },
        ]
        const turn = waitingTurn({
          requestId: codingRun.id,
          descriptor,
          permission: permissionRequest,
          previousCheckpointVersion: continuationInput.previousCheckpointVersion,
          previousSequence: continuationInput.previousSequence,
          settledPermissionRequestIds: continuationInput.settledPermissionRequestIds,
          includeDecisionId: request.id,
        })
        if (turn.status !== 'waiting_permission') throw new Error('Native Coding v2 repair did not stop for approval')
        await writeCodingChangeSetExecutionPhase({
          changeSet,
          worktreePath: workspace.worktreePath,
          phase: 'repair_waiting',
          updatedAt: requestedAt,
        })
        return { kind: 'waiting_permission', codingRun: repairRun, events, permissionRequest, turn }
      }
      if (tested.result.status !== 'passed') {
        await input.store.saveTestEvidence(tested.evidence)
        throw new Error('Native Coding v2 saved tests failed after the approved repair')
      }
      const completedAt = canonicalNow(clock)
      const captured = await captureWorktreeDiff({ worktreePath: workspace.worktreePath })
      const allChangeSets = await input.store.listCodingChangeSets(codingRun.id)
      const approvedPaths = new Set(allChangeSets.flatMap((candidate) => candidate.changes.map((change) => change.path)))
      if (
        captured.changedPaths.length < 1 ||
        captured.changedPaths.length > 6 ||
        captured.changedPaths.some((changedPath) => !approvedPaths.has(changedPath))
      ) {
        throw new Error('Native Coding v2 worktree diff exceeds the approved Change Sets')
      }
      const diff = sanitizeCodingDiffArtifact({
        id: createId('coding-diff'),
        runId: codingRun.runId,
        nodeId: codingRun.nodeId,
        projectId: codingRun.projectId,
        changedPaths: captured.changedPaths,
        patch: captured.patch,
        sourceDigest: sha256(captured.patch),
        createdAt: completedAt,
      })
      if (diff.truncated) throw new Error('Native Coding v2 delivery diff exceeded the safe limit')
      const finalRun: CodingAgentRun = {
        ...codingRun,
        status: 'completed',
        summary: `Native Coding v2 applied ${captured.changedPaths.length} approved file change(s) and the saved test passed.`,
        changedPaths: captured.changedPaths,
        completedAt,
        diffArtifactId: diff.id,
        testEvidenceId: tested.evidence.id,
        redacted: true,
      }
      const events: CodingAgentEvent[] = [
        {
          id: createId('coding-event'), codingRunId: codingRun.id, runId: codingRun.runId,
          nodeId: codingRun.nodeId, sequence: 1, kind: 'tool_result',
          message: 'The exact approved Change Set was applied atomically in the managed worktree.',
          timestamp: context.now, metadata: { changeSetId: changeSet.id, status: 'succeeded' }, redacted: true,
        },
        {
          id: createId('coding-event'), codingRunId: codingRun.id, runId: codingRun.runId,
          nodeId: codingRun.nodeId, sequence: 2, kind: 'test',
          message: 'The saved recognized worktree test passed.',
          timestamp: testedAt, metadata: { evidenceId: tested.evidence.id, status: 'passed' }, redacted: true,
        },
        {
          id: createId('coding-event'), codingRunId: codingRun.id, runId: codingRun.runId,
          nodeId: codingRun.nodeId, sequence: 3, kind: 'diff',
          message: 'Native Coding v2 captured the delivery diff.',
          timestamp: completedAt, metadata: { diffArtifactId: diff.id }, redacted: true,
        },
      ]
      const checkpointVersion = continuationInput.previousCheckpointVersion + 1
      const turn = parseCodingExecutorTurn({
        stateVersion: 1,
        requestId: codingRun.id,
        status: 'terminal',
        checkpointVersion,
        events: [
          {
            stateVersion: 1, requestId: codingRun.id,
            sequence: continuationInput.previousSequence + 1, checkpointVersion,
            type: 'permission_decision', createdAt: context.now,
            metadata: { permissionRequestId: request.id, decision: 'approved' },
          },
          {
            stateVersion: 1, requestId: codingRun.id,
            sequence: continuationInput.previousSequence + 2, checkpointVersion,
            type: 'evidence', createdAt: completedAt,
            metadata: { diffArtifactId: diff.id, testEvidenceId: tested.evidence.id, testEvidenceCount: 1 },
          },
          {
            stateVersion: 1, requestId: codingRun.id,
            sequence: continuationInput.previousSequence + 3, checkpointVersion,
            type: 'terminal', createdAt: completedAt, metadata: { stopReason: 'success' },
          },
        ],
        terminalResult: {
          stateVersion: 1,
          requestId: codingRun.id,
          stopReason: 'success',
          executor: { id: descriptor.id, version: descriptor.version, kind: descriptor.kind },
          finalCheckpointVersion: checkpointVersion,
          changedPaths: [...diff.changedPaths].sort(),
          diffArtifactId: diff.id,
          testEvidenceIds: [tested.evidence.id],
          usage: {
            tokens: usageFromRun(finalRun).inputTokens + usageFromRun(finalRun).outputTokens + usageFromRun(finalRun).cacheReadTokens,
            costUsd: usageFromRun(finalRun).costUsd,
          },
          cleanup: { status: 'not_required', reasonCode: 'workspace_retained_for_delivery' },
          completedAt,
        },
      }, {
        expectedRequestId: codingRun.id,
        previousCheckpointVersion: continuationInput.previousCheckpointVersion,
        previousSequence: continuationInput.previousSequence,
        settledPermissionRequestIds: continuationInput.settledPermissionRequestIds,
      })
      if (turn.status !== 'terminal') throw new Error('Native Coding v2 completion is not terminal')
      return { kind: 'engine_completed', codingRun: finalRun, events, diff, testEvidence: tested.evidence, turn }
    },
    async cancel() {
      return undefined
    },
  }
}
