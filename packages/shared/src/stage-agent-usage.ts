import { resolveDeepSeekPricingSnapshot } from './cost'
import { redactSensitiveText } from './redaction'
import type { AgentProviderUsage, AgentTokenUsage } from './domain'

/** Executor telemetry is usage evidence; the model's answer and OpenCode's price table are not billing authority. */
export function createLocalStageAgentUsage(input: {
  id: string; runId: string; nodeId: string; userId: string; projectId: string
  providerId: string; model: string; timestamp: string
  billingProvider?: 'deepseek'
  usage: AgentProviderUsage | null
}): AgentTokenUsage {
  const valid = input.usage && [input.usage.inputTokens, input.usage.outputTokens].every((value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  ) && Number.isSafeInteger(Number(input.usage.inputTokens) + Number(input.usage.outputTokens))
  const inputTokens = valid ? input.usage!.inputTokens! : 0
  const outputTokens = valid ? input.usage!.outputTokens! : 0
  const cache = input.usage?.cacheReadTokens
  const validCache = typeof cache === 'number' && Number.isSafeInteger(cache) && cache >= 0 && cache <= inputTokens
  const cacheReadTokens = valid && validCache ? cache : 0
  const usageStatus = !valid ? 'unknown' : input.usage?.missingUsageCount ? 'partial' : 'complete'
  // A single Agent session can cross a pricing tier. Persist a conservative peak-rate estimate,
  // never label the aggregated OpenCode session as an exact provider settlement.
  const pricing = input.billingProvider === 'deepseek' && usageStatus === 'complete' && validCache
    ? resolveDeepSeekPricingSnapshot({ providerId: input.providerId, model: input.model, timestamp: input.timestamp, worstCase: true })
    : null
  const costUsd = pricing ? Number(((cacheReadTokens * pricing.cacheHitInputUsdPerMillion +
    (inputTokens - cacheReadTokens) * pricing.cacheMissInputUsdPerMillion +
    outputTokens * pricing.outputUsdPerMillion) / 1_000_000).toFixed(9)) : null
  return {
    id: input.id, runId: input.runId, nodeId: input.nodeId, userId: input.userId, projectId: input.projectId,
    provider: 'openai', providerId: redactSensitiveText(input.providerId).value.slice(0, 256),
    model: redactSensitiveText(input.model).value.slice(0, 256), executorKind: 'local-agent',
    inputTokens, outputTokens, cacheReadTokens, costUsd,
    source: valid ? 'provider_reported' : 'unknown', usageStatus,
    costStatus: costUsd === null ? 'unknown' : 'estimated',
    ...(pricing ? { pricingSnapshot: pricing } : {}), timestamp: input.timestamp,
  }
}


export function parseStageAgentUsage(value: unknown, runId: string, projectId: string): AgentTokenUsage[] {
  if (!Array.isArray(value) || value.length > 4096) throw new Error('Invalid stage Agent usage list')
  const ids = new Set<string>()
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid stage Agent usage')
    const row = entry as Record<string, unknown>
    const textFields = ['id', 'runId', 'nodeId', 'userId', 'projectId', 'model', 'timestamp'] as const
    if (textFields.some((key) => typeof row[key] !== 'string' || !row[key].length || row[key].length > 512) ||
      row.runId !== runId || row.projectId !== projectId || ids.has(String(row.id)) ||
      !['direct-provider', 'local-agent'].includes(String(row.executorKind)) ||
      !['openai', 'anthropic', 'dashscope', 'local'].includes(String(row.provider)) ||
      !['provider_reported', 'estimated', 'unknown'].includes(String(row.source)) ||
      (row.usageStatus !== undefined && !['complete', 'partial', 'unknown'].includes(String(row.usageStatus))) ||
      (row.costStatus !== undefined && !['estimated', 'unknown'].includes(String(row.costStatus))) ||
      [row.inputTokens, row.outputTokens, row.cacheReadTokens].some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) ||
      Number(row.cacheReadTokens) > Number(row.inputTokens) ||
      !Number.isSafeInteger(Number(row.inputTokens) + Number(row.outputTokens)) ||
      (row.costUsd !== null && (typeof row.costUsd !== 'number' || !Number.isFinite(row.costUsd) || row.costUsd < 0)) ||
      ((row.source === 'unknown' || row.usageStatus === 'unknown' || row.usageStatus === 'partial' || row.costStatus === 'unknown') && row.costUsd !== null) ||
      (row.costStatus === 'estimated' && row.costUsd === null) || !Number.isFinite(Date.parse(String(row.timestamp)))) {
      throw new Error('Invalid stage Agent usage')
    }
    ids.add(String(row.id))
    // Only an explicit accounting projection leaves Desktop. Prompts, credentials, local paths and
    // arbitrary executor metadata are not part of this contract.
    const usage: AgentTokenUsage = {
      id: String(row.id), runId, nodeId: String(row.nodeId), userId: String(row.userId), projectId,
      provider: row.provider as AgentTokenUsage['provider'], model: redactSensitiveText(String(row.model)).value,
      inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), cacheReadTokens: Number(row.cacheReadTokens),
      costUsd: row.costUsd === null ? null : Number(row.costUsd), timestamp: String(row.timestamp),
      source: row.source as AgentTokenUsage['source'], executorKind: row.executorKind as NonNullable<AgentTokenUsage['executorKind']>,
      ...(typeof row.providerId === 'string' ? { providerId: redactSensitiveText(row.providerId).value.slice(0, 256) } : {}),
      ...(row.usageStatus ? { usageStatus: row.usageStatus as NonNullable<AgentTokenUsage['usageStatus']> } : {}),
      ...(row.costStatus ? { costStatus: row.costStatus as NonNullable<AgentTokenUsage['costStatus']> } : {}),
    }
    if (row.pricingSnapshot !== undefined) {
      const snapshot = resolveDeepSeekPricingSnapshot({ providerId: typeof (row.pricingSnapshot as Record<string, unknown> | null)?.providerId === 'string' ? String((row.pricingSnapshot as Record<string, unknown>).providerId) : 'deepseek', model: usage.model,
        timestamp: usage.timestamp, worstCase: true })
      if (!snapshot || !row.pricingSnapshot || typeof row.pricingSnapshot !== 'object' ||
        Object.entries(snapshot).some(([key, value]) => (row.pricingSnapshot as Record<string, unknown>)[key] !== value)) {
        throw new Error('Invalid stage Agent pricing snapshot')
      }
      usage.pricingSnapshot = snapshot
    }
    return usage
  })
}
