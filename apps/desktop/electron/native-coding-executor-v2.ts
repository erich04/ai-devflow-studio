import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  aggregateCodingRuntimeCostSettlements,
  AgentProviderRequestError,
  parseCodingExecutorDescriptor,
  parseCodingExecutorRequest,
  parseCodingExecutorTurn,
  DEEPSEEK_PRICING_SOURCE,
  redactLocalAbsolutePaths,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  sanitizeCodingDiffArtifact,
  selectCodingExecutor,
  settleCodingRuntimeCost,
  type AgentProvider,
  type AgentProviderResponseMetadata,
  type AgentProviderUsage,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingChangeSet,
  type CodingPermissionRequest,
  type CodingRuntimeCostSummary,
  type RuntimeProviderCallSettlement,
  type TestEvidence,
} from '@ai-devflow/shared'
import type {
  CodingEngineStartInput,
  CodingProviderCallReporter,
  CodingProviderCallTrace,
} from './coding-engine.js'
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
  cacheReadTokens?: number
  cacheMissTokens?: number
  totalTokens?: number
  cacheStatus?: 'complete' | 'unknown'
  billingProvider?: 'deepseek' | 'openai_compatible'
}

type NativeV2ModelResult = {
  value: Record<string, unknown>
  usage: ProviderUsage
  responseMetadata?: AgentProviderResponseMetadata
}

export type NativeCodingV2DecisionProvider = {
  id: string
  version: 2
  modelId: string
  billing: 'metered'
  billingProvider?: ProviderUsage['billingProvider']
  targetHost?: string
  timeoutMs?: number
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

function hasRequiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key))
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

function costSummary(input: {
  codingRun: Pick<CodingAgentRun, 'runId' | 'nodeId' | 'requestedBy' | 'projectId'>
  providerId: string
  model: string
  usage: ProviderUsage
  timestamp: string
}): CodingRuntimeCostSummary {
  return settleCodingRuntimeCost({
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    userId: input.codingRun.requestedBy,
    projectId: input.codingRun.projectId,
    providerId: input.providerId,
    model: input.model,
    usage: input.usage,
    timestamp: input.timestamp,
  })
}

function providerCallSettlementToSummary(
  codingRun: CodingAgentRun,
  settlement: RuntimeProviderCallSettlement,
): CodingRuntimeCostSummary {
  return {
    id: `coding-runtime-cost-${codingRun.runId}-${codingRun.nodeId}`,
    runId: codingRun.runId,
    nodeId: codingRun.nodeId,
    userId: codingRun.requestedBy,
    projectId: codingRun.projectId,
    provider: codingRun.runtimeCostSummary?.provider ?? 'openai',
    providerId: settlement.providerId,
    model: settlement.model,
    inputTokens: settlement.inputTokens,
    outputTokens: settlement.outputTokens,
    cacheReadTokens: settlement.cacheReadTokens,
    cacheMissTokens: settlement.cacheMissTokens,
    totalTokens: settlement.totalTokens,
    cacheHitRate: settlement.cacheHitRate,
    usageStatus: settlement.usageStatus,
    costStatus: settlement.costStatus,
    phase: 'provider_settlement',
    costUsd: settlement.costUsd,
    pricingSnapshot: settlement.pricingSnapshot,
    breakdown: settlement.breakdown,
    timestamp: settlement.timestamp,
    source: settlement.source,
    redacted: true,
  }
}

function previousProviderCallSettlements(codingRun: CodingAgentRun) {
  const summary = codingRun.runtimeCostSummary
  if (!summary || summary.source !== 'provider_reported') return []
  if (summary.providerCallSettlements?.length) {
    return summary.providerCallSettlements.map((settlement) => ({
      requestPhase: settlement.requestPhase,
      settlement: providerCallSettlementToSummary(codingRun, settlement),
    }))
  }
  // Active rows written before per-call settlement cannot be decomposed. Preserve their saved
  // price as one legacy initial call so a later repair is appended without repricing history.
  return [{ requestPhase: 'initial' as const, settlement: summary }]
}

function usageFromRun(run: CodingAgentRun): ProviderUsage {
  const usage = run.runtimeCostSummary
  return usage?.source === 'provider_reported'
    ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
        cacheStatus: usage.usageStatus === 'complete' ? 'complete' : 'unknown',
        ...(usage.cacheReadTokens !== null ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(typeof usage.cacheMissTokens === 'number'
          ? { cacheMissTokens: usage.cacheMissTokens }
          : {}),
        ...(usage.pricingSnapshot?.source === DEEPSEEK_PRICING_SOURCE
          ? { billingProvider: 'deepseek' as const }
          : {}),
      }
    : { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheStatus: 'unknown' }
}

function runtimeCostTrace(summary: CodingRuntimeCostSummary): Record<string, unknown> {
  return {
    phase: summary.phase ?? 'provider_settlement',
    usageStatus: summary.usageStatus ?? 'legacy_unknown',
    costStatus: summary.costStatus ?? 'legacy_unverified',
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheReadTokens: summary.cacheReadTokens,
    cacheMissTokens: summary.cacheMissTokens ?? null,
    totalTokens: summary.totalTokens ?? summary.inputTokens + summary.outputTokens,
    cacheHitRate: summary.cacheHitRate ?? null,
    costUsd: summary.costUsd,
    pricingTier: summary.pricingSnapshot?.tier ?? null,
    pricingSourceVersion: summary.pricingSnapshot?.sourceVersion ?? null,
    unitPrices: summary.pricingSnapshot
      ? {
          cacheHitInputUsdPerMillion: summary.pricingSnapshot.cacheHitInputUsdPerMillion,
          cacheMissInputUsdPerMillion: summary.pricingSnapshot.cacheMissInputUsdPerMillion,
          outputUsdPerMillion: summary.pricingSnapshot.outputUsdPerMillion,
        }
      : null,
    breakdown: summary.breakdown ?? null,
    providerCallSettlements: summary.providerCallSettlements ?? null,
  }
}

function boundedPrompt(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX_PROMPT_CHARS) {
    throw new Error('Native Coding v2 final model prompt exceeds 30,000 characters')
  }
  return serialized
}

function parseSearchPlan(value: unknown, manifest: readonly string[]): SearchPlan {
  if (!isPlainRecord(value)) throw new Error('Native Coding v2 analysis is not an object')
  if (!hasExactKeys(value, ['stateVersion', 'files', 'searches', 'summary'])) {
    throw new Error('Native Coding v2 analysis keys are invalid')
  }
  if (value.stateVersion !== 2) throw new Error('Native Coding v2 analysis version is invalid')
  if (!Array.isArray(value.files)) throw new Error('Native Coding v2 analysis files are invalid')
  if (!Array.isArray(value.searches)) throw new Error('Native Coding v2 analysis searches are invalid')
  if (
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000
  ) {
    throw new Error('Native Coding v2 analysis summary is invalid')
  }
  if (value.files.length > MAX_EXCERPTS) throw new Error('Native Coding v2 analysis has too many files')
  if (value.searches.length > MAX_EXCERPTS) throw new Error('Native Coding v2 analysis has too many searches')
  if (value.files.some((entry) => !isCanonicalRelativePath(entry))) {
    throw new Error('Native Coding v2 analysis path is invalid')
  }
  if (value.files.some((entry) => !manifest.includes(entry))) {
    throw new Error('Native Coding v2 analysis path is not in manifest')
  }
  if (new Set(value.files).size !== value.files.length) {
    throw new Error('Native Coding v2 analysis has duplicate paths')
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

function parseChangeProposal(
  value: unknown,
  allowedPaths: ReadonlySet<string>,
  allowUnrepairable = false,
): ChangeProposal {
  if (!isPlainRecord(value)) {
    throw new Error('Native Coding v2 Change Set proposal is not an object')
  }
  if (!hasRequiredKeys(value, ['stateVersion', 'changes', 'summary'])) {
    throw new Error('Native Coding v2 Change Set proposal keys are invalid')
  }
  if (value.stateVersion !== 2) {
    throw new Error('Native Coding v2 Change Set proposal version is invalid')
  }
  if (!Array.isArray(value.changes)) {
    throw new Error('Native Coding v2 Change Set proposal changes are invalid')
  }
  if (value.changes.length < 1 && !allowUnrepairable) {
    throw new Error('Native Coding v2 Change Set proposal is empty')
  }
  if (value.changes.length > 6) {
    throw new Error('Native Coding v2 Change Set proposal has too many files')
  }
  if (
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 1_000
  ) {
    throw new Error('Native Coding v2 Change Set proposal summary is invalid')
  }
  if (allowUnrepairable && value.changes.length === 0) {
    return { stateVersion: 2, changes: [], summary: safeText(value.summary) }
  }
  let replacements = 0
  const changes = value.changes.flatMap((entry) => {
    if (
      !isPlainRecord(entry) ||
      !hasExactKeys(entry, ['path', 'replacements']) ||
      !isCanonicalRelativePath(entry.path) ||
      !Array.isArray(entry.replacements) ||
      entry.replacements.length < 1
    ) {
      throw new Error('Native Coding v2 Change Set path is invalid')
    }
    if (!allowedPaths.has(entry.path)) {
      throw new Error('Native Coding v2 Change Set path is not in context')
    }
    const parsed = entry.replacements.flatMap((replacement) => {
      if (!isPlainRecord(replacement)) {
        throw new Error('Native Coding v2 exact replacement is not an object')
      }
      if (!hasExactKeys(replacement, ['oldText', 'newText'])) {
        throw new Error('Native Coding v2 exact replacement keys are invalid')
      }
      if (typeof replacement.oldText !== 'string' || replacement.oldText.length < 1) {
        throw new Error('Native Coding v2 exact replacement oldText is invalid')
      }
      if (typeof replacement.newText !== 'string') {
        throw new Error('Native Coding v2 exact replacement newText is invalid')
      }
      if (replacement.oldText === replacement.newText) {
        return []
      }
      replacements += 1
      return [{ oldText: replacement.oldText, newText: replacement.newText }]
    })
    return parsed.length > 0 ? [{ path: entry.path, replacements: parsed }] : []
  })
  if (changes.length < 1) {
    throw new Error('Native Coding v2 Change Set proposal has no effective replacements')
  }
  if (replacements > 12) throw new Error('Native Coding v2 Change Set has too many replacements')
  if (new Set(changes.map((change) => change.path)).size !== changes.length) throw new Error('Native Coding v2 Change Set has duplicate paths')
  return { stateVersion: 2, changes, summary: safeText(value.summary) }
}

function modelValidationCause(error: unknown): string {
  // Only static parser classifications cross into persisted diagnostics. Never
  // include the rejected model's values, code, paths, or arbitrary error text.
  const causes: Record<string, string> = {
    'Native Coding v2 analysis is not an object': 'analysis_not_object',
    'Native Coding v2 analysis keys are invalid': 'analysis_keys_invalid',
    'Native Coding v2 analysis version is invalid': 'analysis_version_invalid',
    'Native Coding v2 analysis files are invalid': 'analysis_files_not_array',
    'Native Coding v2 analysis searches are invalid': 'analysis_searches_not_array',
    'Native Coding v2 analysis summary is invalid': 'analysis_summary_invalid',
    'Native Coding v2 analysis has too many files': 'analysis_too_many_files',
    'Native Coding v2 analysis has too many searches': 'analysis_too_many_searches',
    'Native Coding v2 analysis path is invalid': 'analysis_path_invalid',
    'Native Coding v2 analysis path is not in manifest': 'analysis_path_not_in_manifest',
    'Native Coding v2 analysis has duplicate paths': 'analysis_duplicate_paths',
    'Native Coding v2 bounded search request is invalid': 'search_request_invalid',
    'Native Coding v2 Change Set proposal is not an object': 'proposal_not_object',
    'Native Coding v2 Change Set proposal keys are invalid': 'proposal_keys_invalid',
    'Native Coding v2 Change Set proposal version is invalid': 'proposal_version_invalid',
    'Native Coding v2 Change Set proposal changes are invalid': 'changes_not_array',
    'Native Coding v2 Change Set proposal is empty': 'changes_empty',
    'Native Coding v2 Change Set proposal has too many files': 'too_many_files',
    'Native Coding v2 Change Set proposal summary is invalid': 'summary_invalid',
    'Native Coding v2 Change Set path is invalid': 'change_shape_or_path_invalid',
    'Native Coding v2 Change Set path is not in context': 'path_not_in_context',
    'Native Coding v2 exact replacement is not an object': 'replacement_not_object',
    'Native Coding v2 exact replacement keys are invalid': 'replacement_keys_invalid',
    'Native Coding v2 exact replacement oldText is invalid': 'old_text_invalid',
    'Native Coding v2 exact replacement newText is invalid': 'new_text_invalid',
    'Native Coding v2 Change Set proposal has no effective replacements': 'no_effective_replacements',
    'Native Coding v2 Change Set has too many replacements': 'too_many_replacements',
    'Native Coding v2 Change Set has duplicate paths': 'duplicate_paths',
  }
  return `native_v2_${error instanceof Error ? causes[error.message] ?? 'output_validation_failed' : 'output_validation_failed'}`
}

export function createNativeCodingV2RepairSystemPrompt(
  allowedPaths: readonly string[],
): string {
  return [
    'Return one JSON object only, without Markdown or prose.',
    'Use exactly this shape: {"stateVersion":2,"changes":[{"path":"one/exact/allowed/path","replacements":[{"oldText":"exact existing text","newText":"replacement text"}]}],"summary":"bounded repair"}.',
    'The top-level keys are exactly stateVersion, changes, summary. Do not add extra keys.',
    'stateVersion must be the number 2. Each change has exactly path and replacements. Each replacement has exactly oldText and newText.',
    'A safe repair contains between 1 and 6 file entries. If the failure cannot be repaired within the allowed paths while preserving the original request, return an empty changes array and explain why in summary.',
    'Do not undo correct requested behavior to address missing dependencies, unavailable tools, or other environment failures.',
    `Every path must exactly equal one entry in this allowed path list: ${JSON.stringify(allowedPaths)}. Do not use any other path.`,
    'If a TypeScript error appears in a file outside the allowed list, fix the public contract from an allowed file instead of editing the outside file.',
    'Respect ownership boundaries named in the brief. Do not move server-, runtime-, or agent-owned fields into a provider/model result unless the brief explicitly assigns them there.',
    'Generate each value exactly once at its named owning boundary. Transport layers must pass owned results through instead of duplicating business data.',
    'oldText must be a non-empty string. newText must be a string. oldText and newText must not be identical. Do not include unchanged or placeholder replacements.',
    'oldText must be copied verbatim from the supplied excerpt for that same path and occur exactly once.',
    'Repair only supplied files. Do not create, delete, rename, or touch any path outside the initial Change Set.',
  ].join(' ')
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
    ...(provider.billingProvider ? { billingProvider: provider.billingProvider } : {}),
    ...(provider.targetHost ? { targetHost: provider.targetHost } : {}),
    ...(provider.requestTimeoutMs ? { timeoutMs: provider.requestTimeoutMs } : {}),
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
        (usage.cacheMissTokens !== undefined && !Number.isSafeInteger(usage.cacheMissTokens)) ||
        (usage.totalTokens !== undefined && !Number.isSafeInteger(usage.totalTokens)) ||
        Number(usage.inputTokens) < 0 ||
        Number(usage.outputTokens) < 0 ||
        Number(usage.cacheReadTokens ?? 0) < 0 ||
        Number(usage.cacheMissTokens ?? 0) < 0 ||
        Number(usage.totalTokens ?? 0) < 0
      ) {
        throw invalidProviderUsageError(
          completed.responseMetadata,
          'provider_usage_missing_or_invalid',
        )
      }
      const inputTokens = Number(usage.inputTokens)
      const outputTokens = Number(usage.outputTokens)
      const cacheStatus = usage.cacheStatus ?? 'unknown'
      if (
        cacheStatus === 'complete' &&
        (usage.cacheReadTokens === undefined ||
          usage.cacheMissTokens === undefined ||
          usage.cacheReadTokens + usage.cacheMissTokens !== inputTokens)
      ) {
        throw invalidProviderUsageError(
          completed.responseMetadata,
          'provider_cache_usage_inconsistent',
        )
      }
      if (
        usage.totalTokens !== undefined &&
        usage.totalTokens !== inputTokens + outputTokens
      ) {
        throw invalidProviderUsageError(
          completed.responseMetadata,
          'provider_total_usage_inconsistent',
        )
      }
      return {
        value: completed.value,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
          cacheStatus,
          ...(usage.cacheReadTokens !== undefined
            ? { cacheReadTokens: usage.cacheReadTokens }
            : {}),
          ...(usage.cacheMissTokens !== undefined
            ? { cacheMissTokens: usage.cacheMissTokens }
            : {}),
          ...(usage.billingProvider !== undefined
            ? { billingProvider: usage.billingProvider }
            : {}),
        },
        ...(completed.responseMetadata
          ? { responseMetadata: completed.responseMetadata }
          : {}),
      }
    },
  }
}

function invalidProviderUsageError(
  responseMetadata: AgentProviderResponseMetadata | undefined,
  sanitizedCause: string,
): AgentProviderRequestError {
  return new AgentProviderRequestError({
    code: 'invalid_usage',
    deliveryState: 'response_received',
    billingState: 'unknown',
    retryable: false,
    ...(responseMetadata ? { httpStatus: responseMetadata.httpStatus } : {}),
    ...(responseMetadata ? { responseMetadata } : {}),
    sanitizedCause,
  })
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

  async function runProviderCall<T>(call: {
    codingRunId: string
    assertContextCurrent?: (() => Promise<void>) | undefined
    reportProviderCall?: CodingProviderCallReporter
    phase: CodingProviderCallTrace['phase']
    systemPrompt: string
    userPrompt: string
    maxOutputTokens: number
    manifestPathCount: number
    excerptCount: number
    parse: (value: Record<string, unknown>) => T
  }): Promise<{ value: T; usage: ProviderUsage; requestedAt: string }> {
    await call.assertContextCurrent?.()
    const requestId = createId('provider-call')
    const requestedAt = canonicalNow(clock)
    const timeoutMs = input.decisionProvider.timeoutMs ?? 30_000
    const targetHost = safeProviderTraceLabel(input.decisionProvider.targetHost, 255)
    const baseTrace = {
      stateVersion: 1 as const,
      requestId,
      codingRunId: call.codingRunId,
      phase: call.phase,
      attempt: 1,
      providerId: input.decisionProvider.id,
      model: input.decisionProvider.modelId,
      ...(targetHost
        ? { targetHost }
        : {}),
      startedAt: requestedAt,
      timeoutMs,
      promptChars: call.systemPrompt.length + call.userPrompt.length,
      promptBytes:
        Buffer.byteLength(call.systemPrompt, 'utf8') +
        Buffer.byteLength(call.userPrompt, 'utf8'),
      promptDigest: sha256(JSON.stringify([call.systemPrompt, call.userPrompt])),
      manifestPathCount: call.manifestPathCount,
      excerptCount: call.excerptCount,
      maxOutputTokens: call.maxOutputTokens,
      redacted: true as const,
    }
    await call.reportProviderCall?.({
      ...baseTrace,
      status: 'started',
      deliveryState: 'not_sent',
      billingState: 'not_incurred',
      retryable: false,
    })

    let completed: NativeV2ModelResult | undefined
    let result: { value: T; usage: ProviderUsage; requestedAt: string }
    try {
      completed = await input.decisionProvider.complete({
        phase: call.phase,
        systemPrompt: call.systemPrompt,
        userPrompt: call.userPrompt,
        maxOutputTokens: call.maxOutputTokens,
      })
      let value: T
      try {
        value = call.parse(completed.value)
      } catch (error) {
        throw new AgentProviderRequestError({
          code: 'invalid_model_output',
          deliveryState: 'response_received',
          billingState: 'confirmed',
          retryable: false,
          ...(completed.responseMetadata
            ? { httpStatus: completed.responseMetadata.httpStatus }
            : {}),
          sanitizedCause: modelValidationCause(error),
          cause: error,
        })
      }
      const completedAt = canonicalNow(clock)
      await call.reportProviderCall?.({
        ...baseTrace,
        status: 'succeeded',
        completedAt,
        durationMs: elapsedMs(requestedAt, completedAt),
        deliveryState: 'response_received',
        billingState: 'confirmed',
        retryable: false,
        ...(completed.responseMetadata
          ? providerResponseTrace(completed.responseMetadata)
          : {}),
        usage: providerUsageTrace(completed.usage),
      })
      result = { value, usage: completed.usage, requestedAt }
    } catch (error) {
      const failure = error instanceof AgentProviderRequestError
        ? error
        : new AgentProviderRequestError({
            code: 'unknown_provider_failure',
            deliveryState: completed ? 'response_received' : 'possibly_delivered',
            billingState: completed ? 'confirmed' : 'unknown',
            retryable: !completed,
            sanitizedCause: 'unclassified_provider_failure',
            cause: error,
          })
      const completedAt = canonicalNow(clock)
      await call.reportProviderCall?.({
        ...baseTrace,
        status: 'failed',
        completedAt,
        durationMs: elapsedMs(requestedAt, completedAt),
        deliveryState: failure.deliveryState,
        billingState: failure.billingState,
        retryable: failure.retryable,
        ...(failure.httpStatus !== null ? { httpStatus: failure.httpStatus } : {}),
        ...(completed?.responseMetadata
          ? providerResponseTrace(completed.responseMetadata)
          : failure.responseMetadata
            ? providerResponseTrace(failure.responseMetadata)
            : {}),
        ...(completed ? { usage: providerUsageTrace(completed.usage) }
          : failure.usage ? { usage: providerUsageTrace(failure.usage) } : {}),
        errorCode: failure.code,
        sanitizedCause: failure.sanitizedCause,
      })
      throw failure
    }
    // The Provider has already completed and incurred usage. A local Memory or
    // workflow change must stop execution without misreporting a Provider error.
    await call.assertContextCurrent?.()
    return result
  }

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
    ...(input.decisionProvider.billingProvider
      ? { billingProvider: input.decisionProvider.billingProvider }
      : {}),
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
      await context.assertContextCurrent?.()
      const manifest = await buildRepositoryManifest(context.workspace.worktreePath)
      if (manifest.length < 1) throw new Error('Native Coding v2 repository manifest is empty')
      const analysisPrompt = boundedPrompt({
        stateVersion: 2,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeText(context.brief.prompt),
        repositoryManifest: manifest,
        limits: { maxFiles: 8, maxSearches: 8, literalSearchOnly: true },
      })
      const analysisSystemPrompt = [
        'Return one JSON object only, without Markdown or prose.',
        'Use exactly this shape: {"stateVersion":2,"files":["path/from/repositoryManifest"],"searches":[{"query":"literal text","path":"path/from/repositoryManifest"}],"summary":"bounded repository analysis"}.',
        'The top-level keys are exactly stateVersion, files, searches, summary. Do not add extra keys.',
        'stateVersion must be the number 2. Every files item and optional searches.path must exactly equal one file path from repositoryManifest; do not use directories or globs.',
        'Each searches item has only query and optional path. searches may be empty. Do not propose edits yet.',
        'Hard limits: select at most 8 unique file paths and at most 8 searches. Each literal query is 1–200 characters. summary is a non-empty string of at most 1000 characters.',
      ].join(' ')
      const analysis = await runProviderCall({
        assertContextCurrent: context.assertContextCurrent,
        codingRunId: request.id,
        ...(context.reportProviderCall
          ? { reportProviderCall: context.reportProviderCall }
          : {}),
        phase: 'analysis',
        systemPrompt: analysisSystemPrompt,
        userPrompt: analysisPrompt,
        maxOutputTokens: Math.min(2_048, MAX_OUTPUT_TOKENS),
        manifestPathCount: manifest.length,
        excerptCount: 0,
        parse: (value) => parseSearchPlan(value, manifest),
      })
      const plan = analysis.value
      await context.assertContextCurrent?.()
      const excerpts = await collectExcerpts({
        worktreePath: context.workspace.worktreePath,
        manifest,
        plan,
      })
      const initialPrompt = fitChangePrompt({
        stateVersion: 2,
        objectiveDigest: request.objectiveDigest,
        contextDigest: request.contextDigest,
        brief: safeText(context.brief.prompt),
        analysisSummary: plan.summary,
        excerpts,
        allowedPaths: excerpts.map((excerpt) => excerpt.path),
        limits: { existingUtf8Files: true, maxFiles: 6, maxReplacements: 12 },
      })
      const initialSystemPrompt = [
        'Return one JSON object only, without Markdown or prose.',
        'Use exactly this shape: {"stateVersion":2,"changes":[{"path":"supplied/excerpt/path","replacements":[{"oldText":"exact existing text","newText":"replacement text"}]}],"summary":"bounded implementation"}.',
        'The top-level keys are exactly stateVersion, changes, summary. Do not add extra keys.',
        'stateVersion must be the number 2. Each change has exactly path and replacements. Each replacement has exactly oldText and newText.',
        'oldText must be a non-empty string. newText must be a string. oldText and newText must not be identical. Do not include unchanged or placeholder replacements.',
        'oldText must be copied verbatim from a supplied excerpt and occur exactly once.',
        'Respect ownership boundaries named in the brief. Do not move server-, runtime-, or agent-owned fields into a provider/model result unless the brief explicitly assigns them there.',
        'Generate each value exactly once at its named owning boundary. Transport layers must pass owned results through instead of duplicating business data.',
        'Use only supplied excerpt paths. Do not create, delete, rename, or edit binary files.',
        'Hard limits: change at most 6 unique file paths with at most 12 replacements in total across all files. Include each path only once. summary is a non-empty string of at most 1000 characters.',
        'Plan the smallest complete implementation within those limits, including required tests and documentation. Reuse existing structure and styling; avoid unrelated refactoring or optional cosmetic edits. Check these counts before returning JSON.',
      ].join(' ')
      const initialResult = await runProviderCall({
        assertContextCurrent: context.assertContextCurrent,
        codingRunId: request.id,
        ...(context.reportProviderCall
          ? { reportProviderCall: context.reportProviderCall }
          : {}),
        phase: 'initial',
        systemPrompt: initialSystemPrompt,
        userPrompt: initialPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        manifestPathCount: manifest.length,
        excerptCount: excerpts.length,
        parse: (value) => parseChangeProposal(
          value,
          new Set(excerpts.map((excerpt) => excerpt.path)),
        ),
      })
      const proposal = initialResult.value
      await context.assertContextCurrent?.()
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
      const costScope = {
        runId: context.run.id,
        nodeId: context.node.id,
        requestedBy: context.requestedBy,
        projectId: context.project.id,
      }
      const settledCost = aggregateCodingRuntimeCostSettlements([
        {
          requestPhase: 'analysis',
          settlement: costSummary({
            codingRun: costScope,
            providerId: input.decisionProvider.id,
            model: input.decisionProvider.modelId,
            usage: analysis.usage,
            timestamp: analysis.requestedAt,
          }),
        },
        {
          requestPhase: 'initial',
          settlement: costSummary({
            codingRun: costScope,
            providerId: input.decisionProvider.id,
            model: input.decisionProvider.modelId,
            usage: initialResult.usage,
            timestamp: initialResult.requestedAt,
          }),
        },
      ])
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
        runtimeCostSummary: settledCost,
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
          metadata: {
            requestId: permissionRequest.id,
            changeSetId: changeSet.id,
            changeSetDigest: changeSet.changeSetDigest,
            runtimeCost: runtimeCostTrace(settledCost),
          },
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
      await context.assertContextCurrent?.()
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
      await context.reportPhase?.({
        status: 'applying',
        summary: 'Applying the exact approved Native Coding v2 Change Set atomically.',
        timestamp: context.now,
      })
      await context.assertContextCurrent?.()
      await applyCodingChangeSetAtomically({ changeSet, worktreePath: workspace.worktreePath, now: context.now })
      const recoveredPhase = await readCodingChangeSetExecutionPhase({
        changeSet,
        worktreePath: workspace.worktreePath,
      })
      if (recoveredPhase) {
        throw new Error(`Interrupted Native Coding v2 ${recoveredPhase} phase requires an explicit retry`)
      }
      const testedAt = canonicalNow(clock)
      await context.reportPhase?.({
        status: 'testing',
        summary: 'The exact approved Change Set was applied; running the saved worktree test.',
        timestamp: testedAt,
      })
      await writeCodingChangeSetExecutionPhase({
        changeSet,
        worktreePath: workspace.worktreePath,
        phase: 'testing',
        updatedAt: testedAt,
      })
      await context.assertContextCurrent?.()
      const tested = await runTests({ codingRun, project, workspace, createdAt: testedAt })
      if (tested.result.status !== 'passed' && changeSet.phase === 'initial') {
        // Preserve the actual failure even if repair planning fails or cannot propose a safe edit.
        await input.store.saveTestEvidence(tested.evidence)
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
          brief: safeText(codingRun.prompt),
          testFailure: {
            summary: safeText(tested.result.summary),
            stdout: safeText(tested.result.stdout).slice(-4_000),
            stderr: safeText(tested.result.stderr).slice(-4_000),
          },
          excerpts,
          allowedPaths: [...initialPaths],
          limits: { existingPreviouslyChangedFilesOnly: true, maxFiles: 6, maxReplacements: 12 },
        })
        const repairSystemPrompt = createNativeCodingV2RepairSystemPrompt([...initialPaths])
        const repairResult = await runProviderCall({
          assertContextCurrent: context.assertContextCurrent,
          codingRunId: codingRun.id,
          ...(context.reportProviderCall
            ? { reportProviderCall: context.reportProviderCall }
            : {}),
          phase: 'repair',
          systemPrompt: repairSystemPrompt,
          userPrompt: repairPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          manifestPathCount: 0,
          excerptCount: excerpts.length,
          parse: (value) => parseChangeProposal(value, initialPaths, true),
        })
        const repairProposal = repairResult.value
        if (repairProposal.changes.length === 0) {
          throw new Error(`Native Coding v2 has no safe repair: ${repairProposal.summary}`)
        }
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
        const permissionRequest = permissionForChangeSet({
          id: createId('coding-permission'), changeSet: repairChangeSet,
          runId: codingRun.runId, nodeId: codingRun.nodeId, requestedAt, phase: 'repair',
        })
        const settledCost = aggregateCodingRuntimeCostSettlements([
          ...previousProviderCallSettlements(codingRun),
          {
            requestPhase: 'repair',
            settlement: costSummary({
              codingRun,
              providerId: input.decisionProvider.id,
              model: input.decisionProvider.modelId,
              usage: repairResult.usage,
              timestamp: repairResult.requestedAt,
            }),
          },
        ])
        const repairRun: CodingAgentRun = {
          ...codingRun,
          changeSetId: repairChangeSet.id,
          status: 'waiting_permission',
          summary: 'The saved test failed; waiting for approval of the exact repair Change Set.',
          runtimeCostSummary: settledCost,
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
            metadata: {
              requestId: permissionRequest.id,
              changeSetId: repairChangeSet.id,
              changeSetDigest: repairChangeSet.changeSetDigest,
              runtimeCost: runtimeCostTrace(settledCost),
            },
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
            tokens: usageFromRun(finalRun).inputTokens + usageFromRun(finalRun).outputTokens,
            // The canonical cost summary carries unknown as null. The v1 executor
            // terminal counter is numeric-only and is not a billing settlement.
            costUsd: finalRun.runtimeCostSummary?.costUsd ?? 0,
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

function elapsedMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
}

function providerResponseTrace(
  metadata: AgentProviderResponseMetadata,
): Pick<CodingProviderCallTrace, 'httpStatus' | 'providerResponseId' | 'systemFingerprint'> {
  const providerResponseId = safeProviderTraceLabel(metadata.responseId, 128)
  const systemFingerprint = safeProviderTraceLabel(metadata.systemFingerprint, 128)
  return {
    httpStatus: metadata.httpStatus,
    ...(providerResponseId ? { providerResponseId } : {}),
    ...(systemFingerprint
      ? { systemFingerprint }
      : {}),
  }
}

function safeProviderTraceLabel(value: string | undefined, maxLength: number): string | undefined {
  return value && value.length <= maxLength && /^[A-Za-z0-9._:[\]-]+$/u.test(value)
    ? value
    : undefined
}

function providerUsageTrace(usage: AgentProviderUsage): NonNullable<CodingProviderCallTrace['usage']> {
  const totalTokens = usage.totalTokens ?? (
    usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined
  )
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cacheReadTokens !== undefined
      ? { cacheReadTokens: usage.cacheReadTokens }
      : {}),
    ...(usage.cacheMissTokens !== undefined
      ? { cacheMissTokens: usage.cacheMissTokens }
      : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    cacheStatus: usage.cacheStatus ?? 'unknown',
    ...(usage.billingProvider ? { billingProvider: usage.billingProvider } : {}),
  }
}
