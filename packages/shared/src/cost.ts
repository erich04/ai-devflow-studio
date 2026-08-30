import type {
  BudgetGuardDecision,
  CodingAgentEngine,
  CodingRuntimeCostSummary,
  CodingRuntimeCostEstimate,
  AgentProviderUsage,
  RuntimeProviderCallSettlement,
  RuntimeProviderRequestPhase,
  RuntimePricingSnapshot,
  RuntimeBudgetApproval,
  RuntimeBudgetPolicy,
  TokenUsage,
} from './domain'

export type TokenUsageRollup = {
  key: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
  unknownCostCount?: number
}

export function rollupTokenUsage(
  usage: TokenUsage[],
  dimension: 'runId' | 'nodeId' | 'userId' | 'projectId',
): TokenUsageRollup[] {
  const map = new Map<string, TokenUsageRollup>()

  for (const row of usage) {
    const key = row[dimension]
    const existing =
      map.get(key) ??
      ({
        key,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      } satisfies TokenUsageRollup)

    existing.inputTokens += row.inputTokens
    existing.outputTokens += row.outputTokens
    existing.cacheReadTokens += row.cacheReadTokens
    // Cache reads are a subset of input/prompt tokens, not additional tokens.
    existing.totalTokens += row.inputTokens + row.outputTokens
    existing.costUsd += row.costUsd
    map.set(key, existing)
  }

  return Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd)
}

export function annotateUnknownRuntimeCosts(
  rollups: TokenUsageRollup[],
  summaries: CodingRuntimeCostSummary[],
  dimension: 'projectId' | 'userId',
): TokenUsageRollup[] {
  const byKey = new Map(rollups.map((rollup) => [rollup.key, { ...rollup }]))
  for (const summary of summaries) {
    if (runtimeCostSummaryToTokenUsage(summary) !== null) continue
    const key = summary[dimension]
    const rollup = byKey.get(key) ?? {
      key,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    rollup.unknownCostCount = (rollup.unknownCostCount ?? 0) + 1
    byKey.set(key, rollup)
  }
  return [...byKey.values()].sort((left, right) => right.costUsd - left.costUsd)
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value)
}

const ESTIMATED_CHARS_PER_TOKEN = 4
const DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K = {
  input: 0.00015,
  output: 0.0006,
}

export const DEEPSEEK_PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing/'
export const DEEPSEEK_PRICING_SOURCE_VERSION = 'deepseek-pricing-snapshot-2026-08-30'
export const DEEPSEEK_PRICING_EFFECTIVE_AT = '2026-08-16T16:00:00.000Z'

type DeepSeekModelPrice = {
  offPeak: { hit: number; miss: number; output: number }
  peak: { hit: number; miss: number; output: number }
}

const DEEPSEEK_PRICES_PER_MILLION: Readonly<Record<string, DeepSeekModelPrice>> = {
  'deepseek-v4-flash': {
    offPeak: { hit: 0.007, miss: 0.22, output: 0.66 },
    peak: { hit: 0.014, miss: 0.44, output: 1.32 },
  },
  'deepseek-v4-pro': {
    offPeak: { hit: 0.022, miss: 0.66, output: 1.98 },
    peak: { hit: 0.044, miss: 1.32, output: 3.96 },
  },
  'deepseek-v4-flash-vision-exp': {
    offPeak: { hit: 0.007, miss: 0.22, output: 0.66 },
    peak: { hit: 0.014, miss: 0.44, output: 1.32 },
  },
}

export function isDeepSeekPeakTime(timestamp: string): boolean {
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error('Invalid DeepSeek pricing timestamp')
  }
  const day = parsed.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = parsed.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

export function resolveDeepSeekPricingSnapshot(input: {
  providerId: string
  model: string
  timestamp: string
  worstCase?: boolean
}): RuntimePricingSnapshot | null {
  const price = DEEPSEEK_PRICES_PER_MILLION[input.model.toLowerCase()]
  if (!price || Date.parse(input.timestamp) < Date.parse(DEEPSEEK_PRICING_EFFECTIVE_AT)) {
    return null
  }
  const tier = input.worstCase || isDeepSeekPeakTime(input.timestamp) ? 'peak' : 'off_peak'
  const selected = tier === 'peak' ? price.peak : price.offPeak
  return {
    providerId: input.providerId,
    model: input.model,
    tier,
    effectiveAt: DEEPSEEK_PRICING_EFFECTIVE_AT,
    source: DEEPSEEK_PRICING_SOURCE,
    sourceVersion: DEEPSEEK_PRICING_SOURCE_VERSION,
    currency: 'USD',
    unit: 'per_1m_tokens',
    cacheHitInputUsdPerMillion: selected.hit,
    cacheMissInputUsdPerMillion: selected.miss,
    outputUsdPerMillion: selected.output,
  }
}

export function settleCodingRuntimeCost(input: {
  providerId: string
  model: string
  usage: AgentProviderUsage
  runId: string
  nodeId: string
  projectId: string
  userId: string
  timestamp: string
}): CodingRuntimeCostSummary {
  const inputTokens = requireUsageInteger(input.usage.inputTokens, 'inputTokens')
  const outputTokens = requireUsageInteger(input.usage.outputTokens, 'outputTokens')
  const totalTokens = inputTokens + outputTokens
  const completeCache =
    input.usage.cacheStatus === 'complete' &&
    Number.isSafeInteger(input.usage.cacheReadTokens) &&
    Number.isSafeInteger(input.usage.cacheMissTokens)
  const cacheReadTokens = completeCache ? Number(input.usage.cacheReadTokens) : null
  const cacheMissTokens = completeCache ? Number(input.usage.cacheMissTokens) : null
  if (
    completeCache &&
    (cacheReadTokens! < 0 || cacheMissTokens! < 0 || cacheReadTokens! + cacheMissTokens! !== inputTokens)
  ) {
    throw new Error('invalid_usage: cache hit + miss must equal inputTokens')
  }
  if (input.usage.totalTokens !== undefined && input.usage.totalTokens !== totalTokens) {
    throw new Error('invalid_usage: totalTokens must equal inputTokens + outputTokens')
  }

  // A model name alone is not a billing authority: compatible gateways may expose the same
  // model under a different tariff. The response parser derives this provider family from the
  // configured provider/base URL and the provider's own usage schema.
  const pricingSnapshot = input.usage.billingProvider === 'deepseek'
    ? resolveDeepSeekPricingSnapshot(input)
    : null
  const canSettle = completeCache && pricingSnapshot !== null
  const breakdown = canSettle
    ? {
        cacheHitInputUsd: roundRuntimeCost(
          (cacheReadTokens! / 1_000_000) * pricingSnapshot.cacheHitInputUsdPerMillion,
        ),
        cacheMissInputUsd: roundRuntimeCost(
          (cacheMissTokens! / 1_000_000) * pricingSnapshot.cacheMissInputUsdPerMillion,
        ),
        outputUsd: roundRuntimeCost(
          (outputTokens / 1_000_000) * pricingSnapshot.outputUsdPerMillion,
        ),
        totalUsd: 0,
      }
    : null
  if (breakdown) {
    breakdown.totalUsd = roundRuntimeCost(
      breakdown.cacheHitInputUsd + breakdown.cacheMissInputUsd + breakdown.outputUsd,
    )
  }

  return {
    id: `coding-runtime-cost-${input.runId}-${input.nodeId}`,
    runId: input.runId,
    nodeId: input.nodeId,
    userId: input.userId,
    projectId: input.projectId,
    provider: resolveRuntimeProvider(input.providerId),
    providerId: input.providerId,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheMissTokens,
    totalTokens,
    cacheHitRate: completeCache && inputTokens > 0 ? cacheReadTokens! / inputTokens : null,
    usageStatus: completeCache ? 'complete' : 'incomplete',
    costStatus: canSettle ? 'settled' : 'unknown',
    phase: 'provider_settlement',
    costUsd: breakdown?.totalUsd ?? null,
    pricingSnapshot,
    breakdown,
    timestamp: input.timestamp,
    source: 'provider_reported',
    redacted: true,
  }
}

export function aggregateCodingRuntimeCostSettlements(
  calls: ReadonlyArray<{
    requestPhase: RuntimeProviderRequestPhase
    settlement: CodingRuntimeCostSummary
  }>,
): CodingRuntimeCostSummary {
  if (calls.length < 1 || calls.length > 32) {
    throw new Error('invalid_usage: provider call settlement count is out of bounds')
  }
  const first = calls[0]!.settlement
  for (const { settlement } of calls) {
    if (
      settlement.runId !== first.runId ||
      settlement.nodeId !== first.nodeId ||
      settlement.userId !== first.userId ||
      settlement.projectId !== first.projectId ||
      settlement.provider !== first.provider ||
      settlement.providerId !== first.providerId ||
      settlement.model !== first.model ||
      settlement.phase !== 'provider_settlement' ||
      settlement.source !== 'provider_reported'
    ) {
      throw new Error('invalid_usage: provider call settlements must share one runtime scope')
    }
  }

  const inputTokens = calls.reduce((sum, call) => sum + call.settlement.inputTokens, 0)
  const outputTokens = calls.reduce((sum, call) => sum + call.settlement.outputTokens, 0)
  const completeUsage = calls.every(
    ({ settlement }) =>
      settlement.usageStatus === 'complete' &&
      settlement.cacheReadTokens !== null &&
      settlement.cacheMissTokens !== null,
  )
  const cacheReadTokens = completeUsage
    ? calls.reduce((sum, call) => sum + call.settlement.cacheReadTokens!, 0)
    : null
  const cacheMissTokens = completeUsage
    ? calls.reduce((sum, call) => sum + call.settlement.cacheMissTokens!, 0)
    : null
  const settled = calls.every(
    ({ settlement }) =>
      settlement.costStatus === 'settled' &&
      settlement.costUsd !== null &&
      settlement.breakdown !== null &&
      settlement.pricingSnapshot !== null,
  )
  const breakdown = settled
    ? {
        cacheHitInputUsd: roundRuntimeCost(calls.reduce(
          (sum, call) => sum + call.settlement.breakdown!.cacheHitInputUsd,
          0,
        )),
        cacheMissInputUsd: roundRuntimeCost(calls.reduce(
          (sum, call) => sum + call.settlement.breakdown!.cacheMissInputUsd,
          0,
        )),
        outputUsd: roundRuntimeCost(calls.reduce(
          (sum, call) => sum + call.settlement.breakdown!.outputUsd,
          0,
        )),
        totalUsd: roundRuntimeCost(calls.reduce(
          (sum, call) => sum + call.settlement.breakdown!.totalUsd,
          0,
        )),
      }
    : null
  const snapshots = calls.map(({ settlement }) => settlement.pricingSnapshot)
  const pricingSnapshot = settled && snapshots.every(
    (snapshot) => samePricingSnapshot(snapshot, snapshots[0]!),
  )
    ? snapshots[0]!
    : null
  const providerCallSettlements: RuntimeProviderCallSettlement[] = calls.map(
    ({ requestPhase, settlement }) => ({
      requestPhase,
      providerId: settlement.providerId,
      model: settlement.model,
      inputTokens: settlement.inputTokens,
      outputTokens: settlement.outputTokens,
      cacheReadTokens: settlement.cacheReadTokens,
      cacheMissTokens: settlement.cacheMissTokens ?? null,
      totalTokens: settlement.totalTokens ?? settlement.inputTokens + settlement.outputTokens,
      cacheHitRate: settlement.cacheHitRate ?? null,
      usageStatus: settlement.usageStatus ?? 'legacy_unknown',
      costStatus: settlement.costStatus ?? 'legacy_unverified',
      costUsd: settlement.costUsd,
      pricingSnapshot: settlement.pricingSnapshot ?? null,
      breakdown: settlement.breakdown ?? null,
      timestamp: settlement.timestamp,
      source: settlement.source,
      redacted: true,
    }),
  )

  return {
    id: `coding-runtime-cost-${first.runId}-${first.nodeId}`,
    runId: first.runId,
    nodeId: first.nodeId,
    userId: first.userId,
    projectId: first.projectId,
    provider: first.provider,
    providerId: first.providerId,
    model: first.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheMissTokens,
    totalTokens: inputTokens + outputTokens,
    cacheHitRate: completeUsage && inputTokens > 0 ? cacheReadTokens! / inputTokens : null,
    usageStatus: completeUsage ? 'complete' : 'incomplete',
    costStatus: settled ? 'settled' : 'unknown',
    phase: 'provider_settlement',
    costUsd: breakdown?.totalUsd ?? null,
    pricingSnapshot,
    breakdown,
    providerCallSettlements,
    timestamp: calls[calls.length - 1]!.settlement.timestamp,
    source: 'provider_reported',
    redacted: true,
  }
}

export function estimateOpenAiCompatibleUsageCost(input: {
  inputTokens: number
  outputTokens: number
}): number {
  if (
    !Number.isSafeInteger(input.inputTokens) ||
    input.inputTokens < 0 ||
    !Number.isSafeInteger(input.outputTokens) ||
    input.outputTokens < 0
  ) {
    throw new Error('Invalid OpenAI-compatible token usage')
  }
  return roundCost(
    (input.inputTokens / 1000) * DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K.input +
      (input.outputTokens / 1000) * DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K.output,
  )
}

export type EstimateCodingRuntimeCostInput = {
  engine: CodingAgentEngine
  providerId: string
  model: string
  billingProvider?: AgentProviderUsage['billingProvider']
  prompt: string
  outputText?: string
  runId: string
  nodeId: string
  projectId: string
  userId: string
  timestamp: string
  noCost?: boolean
  maxOutputTokens?: number
  providerCallLimit?: number
}

export function estimateCodingRuntimeCost(input: EstimateCodingRuntimeCostInput): CodingRuntimeCostEstimate {
  if (input.noCost !== false && input.engine === 'fake') {
    return {
      id: `coding-runtime-cost-${input.runId}-${input.nodeId}`,
      runId: input.runId,
      nodeId: input.nodeId,
      userId: input.userId,
      projectId: input.projectId,
      provider: 'local',
      providerId: input.providerId,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0,
      cacheHitRate: null,
      usageStatus: 'estimated',
      costStatus: 'estimated',
      phase: 'preflight_estimate',
      costUsd: 0,
      pricingSnapshot: null,
      breakdown: {
        cacheHitInputUsd: 0,
        cacheMissInputUsd: 0,
        outputUsd: 0,
        totalUsd: 0,
      },
      timestamp: input.timestamp,
      source: 'estimated',
      redacted: true,
    }
  }

  const providerCallLimit = input.providerCallLimit ?? 1
  if (!Number.isSafeInteger(providerCallLimit) || providerCallLimit < 1 || providerCallLimit > 32) {
    throw new Error('Invalid coding runtime provider call limit')
  }
  if (
    input.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 0 ||
      input.maxOutputTokens > 1_000_000)
  ) {
    throw new Error('Invalid coding runtime output token bound')
  }
  const inputTokens = estimateTokens(input.prompt) * providerCallLimit
  const outputTokens =
    (input.maxOutputTokens ?? estimateTokens(input.outputText ?? '')) * providerCallLimit
  const deepSeekPricing = input.billingProvider === 'deepseek'
    ? resolveDeepSeekPricingSnapshot({
        providerId: input.providerId,
        model: input.model,
        timestamp: input.timestamp,
        worstCase: true,
      })
    : null
  const costUsd = deepSeekPricing
    ? roundRuntimeCost(
        (inputTokens / 1_000_000) * deepSeekPricing.cacheMissInputUsdPerMillion +
          (outputTokens / 1_000_000) * deepSeekPricing.outputUsdPerMillion,
      )
    : estimateOpenAiCompatibleUsageCost({ inputTokens, outputTokens })
  const pricingSnapshot = deepSeekPricing ?? {
    providerId: input.providerId,
    model: input.model,
    tier: 'legacy_estimate' as const,
    effectiveAt: input.timestamp,
    source: 'internal://legacy-openai-compatible-preflight-estimate',
    sourceVersion: 'legacy-openai-compatible-preflight-v1',
    currency: 'USD' as const,
    unit: 'per_1m_tokens' as const,
    cacheHitInputUsdPerMillion: DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K.input * 1_000,
    cacheMissInputUsdPerMillion: DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K.input * 1_000,
    outputUsdPerMillion: DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K.output * 1_000,
  }
  const breakdown = {
    cacheHitInputUsd: 0,
    cacheMissInputUsd: roundRuntimeCost(
      (inputTokens / 1_000_000) * pricingSnapshot.cacheMissInputUsdPerMillion,
    ),
    outputUsd: roundRuntimeCost(
      (outputTokens / 1_000_000) * pricingSnapshot.outputUsdPerMillion,
    ),
    totalUsd: costUsd,
  }

  return {
    id: `coding-runtime-cost-${input.runId}-${input.nodeId}`,
    runId: input.runId,
    nodeId: input.nodeId,
    userId: input.userId,
    projectId: input.projectId,
    provider: resolveRuntimeProvider(input.providerId),
    providerId: input.providerId,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheMissTokens: inputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheHitRate: inputTokens > 0 ? 0 : null,
    usageStatus: 'estimated',
    costStatus: 'estimated',
    phase: 'preflight_estimate',
    costUsd,
    pricingSnapshot,
    breakdown,
    timestamp: input.timestamp,
    source: 'estimated',
    redacted: true,
  }
}

export type EvaluateRuntimeBudgetGuardInput = {
  projectId: string
  providerId: string
  policy?: RuntimeBudgetPolicy | null
  currentSpendUsd: number
  projectedCostUsd: number
  requestedBy: string
  approval?: RuntimeBudgetApproval | null
  now: string
}

const BUDGET_GUARD_STATUSES = new Set<BudgetGuardDecision['status']>([
  'allowed',
  'warning',
  'requires_lead_approval',
  'approved_over_budget',
  'disabled',
  'unavailable',
])

export function parseBudgetGuardDecision(value: unknown): BudgetGuardDecision {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid runtime budget decision')
  }

  const decision = value as Record<string, unknown>
  const status = decision['status']
  const blocksRun = decision['blocksRun']
  const currentSpendUsd = decision['currentSpendUsd']
  const projectedCostUsd = decision['projectedCostUsd']
  const reason = decision['reason']

  if (
    typeof status !== 'string' ||
    !BUDGET_GUARD_STATUSES.has(status as BudgetGuardDecision['status']) ||
    typeof blocksRun !== 'boolean' ||
    !isNonNegativeFiniteNumber(currentSpendUsd) ||
    !isNonNegativeFiniteNumber(projectedCostUsd) ||
    typeof reason !== 'string' ||
    !reason.trim()
  ) {
    throw new Error('Invalid runtime budget decision')
  }

  const limitUsd = decision['limitUsd']
  const approvalRequiredRole = decision['approvalRequiredRole']
  const approvalId = decision['approvalId']
  const expectedBlocksRun =
    status === 'requires_lead_approval' || status === 'unavailable'
  if (
    blocksRun !== expectedBlocksRun ||
    (limitUsd !== undefined && !isNonNegativeFiniteNumber(limitUsd)) ||
    (approvalRequiredRole !== undefined && approvalRequiredRole !== 'lead') ||
    (status === 'requires_lead_approval' && approvalRequiredRole !== 'lead') ||
    (status !== 'requires_lead_approval' && approvalRequiredRole !== undefined) ||
    (status === 'approved_over_budget' &&
      (typeof approvalId !== 'string' || !approvalId.trim())) ||
    (status !== 'approved_over_budget' && approvalId !== undefined) ||
    (approvalId !== undefined && (typeof approvalId !== 'string' || !approvalId.trim()))
  ) {
    throw new Error('Invalid runtime budget decision')
  }

  return {
    status: status as BudgetGuardDecision['status'],
    blocksRun,
    currentSpendUsd,
    projectedCostUsd,
    ...(limitUsd !== undefined ? { limitUsd } : {}),
    ...(approvalRequiredRole !== undefined ? { approvalRequiredRole } : {}),
    ...(approvalId !== undefined ? { approvalId } : {}),
    reason,
  }
}

export function evaluateRuntimeBudgetGuard(
  input: EvaluateRuntimeBudgetGuardInput,
): BudgetGuardDecision {
  if (!input.policy || input.policy.projectId !== input.projectId) {
    return {
      status: 'unavailable',
      blocksRun: true,
      currentSpendUsd: input.currentSpendUsd,
      projectedCostUsd: input.projectedCostUsd,
      reason: 'Runtime budget policy is unavailable for this project.',
    }
  }

  if (!input.policy.enabled) {
    return {
      status: 'disabled',
      blocksRun: false,
      currentSpendUsd: input.currentSpendUsd,
      projectedCostUsd: input.projectedCostUsd,
      reason: 'Runtime budget guard is disabled for this project.',
    }
  }

  const nextSpend = input.currentSpendUsd + input.projectedCostUsd
  if (nextSpend <= input.policy.warningThresholdUsd) {
    return {
      status: 'allowed',
      blocksRun: false,
      currentSpendUsd: input.currentSpendUsd,
      projectedCostUsd: input.projectedCostUsd,
      limitUsd: input.policy.monthlyLimitUsd,
      reason: 'Projected runtime cost is within the project budget threshold.',
    }
  }

  if (nextSpend <= input.policy.monthlyLimitUsd) {
    return {
      status: 'warning',
      blocksRun: false,
      currentSpendUsd: input.currentSpendUsd,
      projectedCostUsd: input.projectedCostUsd,
      limitUsd: input.policy.monthlyLimitUsd,
      reason: 'Projected runtime cost is above the warning threshold but within the project budget.',
    }
  }

  if (isValidRuntimeBudgetApproval(input.approval, input)) {
    return {
      status: 'approved_over_budget',
      blocksRun: false,
      currentSpendUsd: input.currentSpendUsd,
      projectedCostUsd: input.projectedCostUsd,
      limitUsd: input.policy.monthlyLimitUsd,
      approvalId: input.approval!.id,
      reason: 'Lead approval allows this runtime run to continue beyond the project budget.',
    }
  }

  return {
    status: 'requires_lead_approval',
    blocksRun: true,
    currentSpendUsd: input.currentSpendUsd,
    projectedCostUsd: input.projectedCostUsd,
    limitUsd: input.policy.monthlyLimitUsd,
    approvalRequiredRole: 'lead',
    reason: 'Project runtime budget would be exceeded; lead approval is required before calling the real provider.',
  }
}

export function runtimeCostSummaryToTokenUsage(summary: CodingRuntimeCostSummary): TokenUsage | null {
  if (
    summary.costUsd === null ||
    summary.cacheReadTokens === null ||
    summary.phase !== 'provider_settlement' ||
    summary.usageStatus !== 'complete' ||
    summary.costStatus !== 'settled'
  ) {
    return null
  }
  return {
    id: summary.id ?? `coding-runtime-cost-${summary.runId}-${summary.nodeId}`,
    runId: summary.runId,
    nodeId: summary.nodeId,
    userId: summary.userId,
    projectId: summary.projectId,
    provider: summary.provider,
    model: summary.model,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheReadTokens: summary.cacheReadTokens,
    costUsd: summary.costUsd,
    timestamp: summary.timestamp,
  }
}

function requireUsageInteger(value: number | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`invalid_usage: ${field} must be a non-negative integer`)
  }
  return Number(value)
}

function samePricingSnapshot(
  left: RuntimePricingSnapshot | null | undefined,
  right: RuntimePricingSnapshot | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.providerId === right.providerId &&
      left.model === right.model &&
      left.tier === right.tier &&
      left.effectiveAt === right.effectiveAt &&
      left.source === right.source &&
      left.sourceVersion === right.sourceVersion &&
      left.currency === right.currency &&
      left.unit === right.unit &&
      left.cacheHitInputUsdPerMillion === right.cacheHitInputUsdPerMillion &&
      left.cacheMissInputUsdPerMillion === right.cacheMissInputUsdPerMillion &&
      left.outputUsdPerMillion === right.outputUsdPerMillion,
  )
}

function estimateTokens(value: string): number {
  const length = value.trim().length
  if (length === 0) {
    return 0
  }
  return Math.max(1, Math.ceil(length / ESTIMATED_CHARS_PER_TOKEN))
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
}

function roundRuntimeCost(value: number): number {
  return Number(value.toFixed(9))
}

function resolveRuntimeProvider(providerId: string): TokenUsage['provider'] {
  const normalized = providerId.toLowerCase()
  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'anthropic'
  }
  if (normalized.includes('dashscope') || normalized.includes('qwen')) {
    return 'dashscope'
  }
  if (normalized.includes('local') || normalized === 'fake' || normalized === 'fake-coding-engine') {
    return 'local'
  }
  return 'openai'
}

function isValidRuntimeBudgetApproval(
  approval: RuntimeBudgetApproval | null | undefined,
  input: EvaluateRuntimeBudgetGuardInput,
): approval is RuntimeBudgetApproval {
  return Boolean(
    approval &&
      approval.status === 'approved' &&
      (approval.role === 'owner' || approval.role === 'lead') &&
      approval.projectId === input.projectId &&
      approval.providerId === input.providerId &&
      approval.requestedBy === input.requestedBy &&
      Date.parse(approval.expiresAt) > Date.parse(input.now) &&
      approval.maxAdditionalCostUsd >= input.projectedCostUsd,
  )
}
