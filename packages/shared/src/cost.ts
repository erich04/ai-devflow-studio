import type { TokenUsage } from './domain'

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
