import type { AgentProviderUsage } from './domain'
import { resolveDeepSeekPricingSnapshot } from './cost'
/** A local estimate from complete recent answers; never a bill or authorization. */
export function estimateConversationQuestionCost(input: { messages: readonly { role: string; usage?: AgentProviderUsage; provider?: { id: string } }[]; providerId: string; model: string; now: string }): number | null {
  const price = resolveDeepSeekPricingSnapshot({ providerId: input.providerId, model: input.model, timestamp: input.now, worstCase: false })
  if (!price) return null
  const samples = input.messages.filter(m => m.role === 'assistant' && m.provider?.id === input.providerId && m.usage?.usageCompleteness === 'final' && m.usage.billingProvider === 'deepseek' && !m.usage.missingUsageCount && [m.usage.inputTokens, m.usage.outputTokens].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)).slice(-5).map(m => {
    const u = m.usage!, validCache = Number.isSafeInteger(u.cacheReadTokens) && Number.isSafeInteger(u.cacheMissTokens) && u.cacheReadTokens! >= 0 && u.cacheMissTokens! >= 0 && u.cacheReadTokens! + u.cacheMissTokens! === u.inputTokens
    return ((validCache ? u.cacheReadTokens! * price.cacheHitInputUsdPerMillion + u.cacheMissTokens! * price.cacheMissInputUsdPerMillion : u.inputTokens! * price.cacheMissInputUsdPerMillion) + u.outputTokens! * price.outputUsdPerMillion) / 1_000_000
  }).sort((a, b) => a - b)
  if (!samples.length) return null
  const middle = Math.floor(samples.length / 2)
  return samples.length % 2 ? samples[middle]! : (samples[middle - 1]! + samples[middle]!) / 2
}
