import type { AgentProviderUsage } from './domain'

export type OpenAiCompatibleUsageContext = {
  providerId?: string
  model?: string
  baseUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`invalid_usage: ${field} must be a non-negative integer`)
  }
  return Number(value)
}

export function isDeepSeekUsageContext(context: OpenAiCompatibleUsageContext): boolean {
  if (context.baseUrl) {
    try {
      return new URL(context.baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
    } catch {
      return false
    }
  }
  return (context.providerId?.toLowerCase() ?? '').includes('deepseek')
}

/**
 * Normalize provider usage without retaining the prompt, response, or credential.
 * DeepSeek reports cache hit/miss as a partition of prompt_tokens. OpenAI-compatible
 * cached_tokens is likewise a subset of prompt_tokens, never an additional token pool.
 */
export function parseOpenAiCompatibleProviderUsage(
  value: unknown,
  context: OpenAiCompatibleUsageContext = {},
): AgentProviderUsage | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    throw new Error('invalid_usage: usage must be an object')
  }

  const inputTokens = optionalNonNegativeInteger(value['prompt_tokens'], 'prompt_tokens')
  const outputTokens = optionalNonNegativeInteger(value['completion_tokens'], 'completion_tokens')
  const totalTokens = optionalNonNegativeInteger(value['total_tokens'], 'total_tokens')
  const deepSeekHit = optionalNonNegativeInteger(
    value['prompt_cache_hit_tokens'],
    'prompt_cache_hit_tokens',
  )
  const deepSeekMiss = optionalNonNegativeInteger(
    value['prompt_cache_miss_tokens'],
    'prompt_cache_miss_tokens',
  )
  const promptDetails = isRecord(value['prompt_tokens_details'])
    ? value['prompt_tokens_details']
    : undefined
  const genericCached = optionalNonNegativeInteger(
    value['cached_tokens'] ?? promptDetails?.['cached_tokens'],
    'cached_tokens',
  )

  if (
    totalTokens !== undefined &&
    inputTokens !== undefined &&
    outputTokens !== undefined &&
    totalTokens !== inputTokens + outputTokens
  ) {
    throw new Error('invalid_usage: total_tokens must equal prompt_tokens + completion_tokens')
  }

  const deepSeek = isDeepSeekUsageContext(context)
  if (deepSeek || deepSeekHit !== undefined || deepSeekMiss !== undefined) {
    if ((deepSeekHit === undefined) !== (deepSeekMiss === undefined)) {
      throw new Error('invalid_usage: DeepSeek cache hit and miss fields must be reported together')
    }
    if (deepSeekHit !== undefined && deepSeekMiss !== undefined) {
      if (inputTokens === undefined) {
        throw new Error('invalid_usage: DeepSeek cache split requires prompt_tokens')
      }
      if (deepSeekHit + deepSeekMiss !== inputTokens) {
        throw new Error(
          'invalid_usage: DeepSeek cache hit + miss must equal prompt_tokens',
        )
      }
      return {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        cacheReadTokens: deepSeekHit,
        cacheMissTokens: deepSeekMiss,
        ...(totalTokens !== undefined ? { totalTokens } : {}),
        cacheStatus: 'complete',
        billingProvider: deepSeek ? 'deepseek' : 'openai_compatible',
      }
    }
    return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
      cacheStatus: 'unknown',
      billingProvider: deepSeek ? 'deepseek' : 'openai_compatible',
    }
  }

  if (genericCached !== undefined) {
    if (inputTokens === undefined || genericCached > inputTokens) {
      throw new Error('invalid_usage: cached_tokens must be a subset of prompt_tokens')
    }
    return {
      inputTokens,
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      cacheReadTokens: genericCached,
      cacheMissTokens: inputTokens - genericCached,
      ...(totalTokens !== undefined ? { totalTokens } : {}),
      cacheStatus: 'complete',
      billingProvider: 'openai_compatible',
    }
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    cacheStatus: 'unknown',
    billingProvider: 'openai_compatible',
  }
}
