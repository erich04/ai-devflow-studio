import type {
  BudgetGuardDecision,
  CodingAgentEngine,
  CodingRuntimeCostSummary,
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
    existing.totalTokens += row.inputTokens + row.outputTokens + row.cacheReadTokens
    existing.costUsd += row.costUsd
    map.set(key, existing)
  }

  return Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd)
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

export type EstimateCodingRuntimeCostInput = {
  engine: CodingAgentEngine
  providerId: string
  model: string
  prompt: string
  outputText?: string
  runId: string
  nodeId: string
  projectId: string
  userId: string
  timestamp: string
}

export function estimateCodingRuntimeCost(input: EstimateCodingRuntimeCostInput): CodingRuntimeCostSummary {
  if (input.engine === 'fake' || input.providerId.includes('fake')) {
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
      costUsd: 0,
      timestamp: input.timestamp,
      source: 'estimated',
      redacted: true,
    }
  }

  const inputTokens = estimateTokens(input.prompt)
  const outputTokens = estimateTokens(input.outputText ?? '')
  const price = DEFAULT_OPENAI_COMPATIBLE_PRICE_PER_1K
  const costUsd = roundCost(
    (inputTokens / 1000) * price.input +
      (outputTokens / 1000) * price.output,
  )

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
    costUsd,
    timestamp: input.timestamp,
    source: 'estimated',
    redacted: true,
  }
}

export type EvaluateRuntimeBudgetGuardInput = {
  policy?: RuntimeBudgetPolicy | null
  currentSpendUsd: number
  projectedCostUsd: number
  requestedBy: string
  approval?: RuntimeBudgetApproval | null
  now: string
}

export function evaluateRuntimeBudgetGuard(
  input: EvaluateRuntimeBudgetGuardInput,
): BudgetGuardDecision {
  if (!input.policy || !input.policy.enabled) {
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

export function runtimeCostSummaryToTokenUsage(summary: CodingRuntimeCostSummary): TokenUsage {
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

function estimateTokens(value: string): number {
  const length = value.trim().length
  if (length === 0) {
    return 0
  }
  return Math.max(1, Math.ceil(length / ESTIMATED_CHARS_PER_TOKEN))
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
}

function resolveRuntimeProvider(providerId: string): TokenUsage['provider'] {
  const normalized = providerId.toLowerCase()
  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'anthropic'
  }
  if (normalized.includes('dashscope') || normalized.includes('qwen')) {
    return 'dashscope'
  }
  if (normalized.includes('local') || normalized.includes('fake')) {
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
      approval.role === 'lead' &&
      approval.requestedBy === input.requestedBy &&
      Date.parse(approval.expiresAt) > Date.parse(input.now) &&
      approval.maxAdditionalCostUsd >= input.projectedCostUsd,
  )
}
