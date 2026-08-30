import { describe, expect, it } from 'vitest'
import { parseOpenAiCompatibleProviderUsage } from './provider-usage'

const deepSeek = {
  providerId: 'deepseek-production',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
}

describe('parseOpenAiCompatibleProviderUsage', () => {
  it.each([
    [100, 0, 100],
    [100, 40, 60],
    [100, 100, 0],
  ])('parses DeepSeek prompt cache partitions: prompt=%i hit=%i miss=%i', (prompt, hit, miss) => {
    expect(
      parseOpenAiCompatibleProviderUsage(
        {
          prompt_tokens: prompt,
          completion_tokens: 25,
          prompt_cache_hit_tokens: hit,
          prompt_cache_miss_tokens: miss,
          total_tokens: prompt + 25,
        },
        deepSeek,
      ),
    ).toEqual({
      inputTokens: prompt,
      outputTokens: 25,
      cacheReadTokens: hit,
      cacheMissTokens: miss,
      totalTokens: prompt + 25,
      cacheStatus: 'complete',
      billingProvider: 'deepseek',
    })
  })

  it('marks a missing DeepSeek cache split unknown instead of inventing zero hits', () => {
    expect(
      parseOpenAiCompatibleProviderUsage(
        { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
        deepSeek,
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cacheStatus: 'unknown',
      billingProvider: 'deepseek',
    })
  })

  it('fails closed when DeepSeek hit + miss conflicts with prompt_tokens', () => {
    expect(() =>
      parseOpenAiCompatibleProviderUsage(
        {
          prompt_tokens: 100,
          completion_tokens: 25,
          prompt_cache_hit_tokens: 40,
          prompt_cache_miss_tokens: 50,
        },
        deepSeek,
      ),
    ).toThrow('invalid_usage: DeepSeek cache hit + miss must equal prompt_tokens')
  })

  it('treats OpenAI-compatible cached_tokens as a prompt subset', () => {
    expect(
      parseOpenAiCompatibleProviderUsage(
        {
          prompt_tokens: 100,
          completion_tokens: 25,
          prompt_tokens_details: { cached_tokens: 30 },
          total_tokens: 125,
        },
        { providerId: 'openai', model: 'gpt-test' },
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 30,
      cacheMissTokens: 70,
      totalTokens: 125,
      cacheStatus: 'complete',
      billingProvider: 'openai_compatible',
    })
  })

  it('does not infer DeepSeek billing from a model name exposed by a compatible gateway', () => {
    expect(
      parseOpenAiCompatibleProviderUsage(
        {
          prompt_tokens: 100,
          completion_tokens: 25,
          cached_tokens: 30,
          total_tokens: 125,
        },
        {
          providerId: 'deepseek-via-compatible-gateway',
          model: 'deepseek-v4-flash',
          baseUrl: 'https://gateway.example.com/v1',
        },
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 30,
      cacheMissTokens: 70,
      totalTokens: 125,
      cacheStatus: 'complete',
      billingProvider: 'openai_compatible',
    })
  })

  it('rejects negative, fractional, partial, and over-counted provider usage', () => {
    expect(() =>
      parseOpenAiCompatibleProviderUsage({ prompt_tokens: -1 }, deepSeek),
    ).toThrow(/invalid_usage/)
    expect(() =>
      parseOpenAiCompatibleProviderUsage({ prompt_tokens: 1.5 }, deepSeek),
    ).toThrow(/invalid_usage/)
    expect(() =>
      parseOpenAiCompatibleProviderUsage(
        { prompt_tokens: 10, prompt_cache_hit_tokens: 2 },
        deepSeek,
      ),
    ).toThrow(/reported together/)
    expect(() =>
      parseOpenAiCompatibleProviderUsage(
        { prompt_tokens: 10, completion_tokens: 2, cached_tokens: 11 },
        { providerId: 'openai' },
      ),
    ).toThrow(/subset/)
  })
})
