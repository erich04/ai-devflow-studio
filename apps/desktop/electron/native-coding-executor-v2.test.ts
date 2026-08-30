import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '@ai-devflow/shared'
import { createAgentProviderNativeCodingV2DecisionProvider } from './native-coding-executor-v2.js'

describe('Agent Provider Native Coding v2 boundary', () => {
  it('rejects an oversized prompt before invoking the provider', async () => {
    const completeStructuredJson = vi.fn()
    const decisionProvider = createAgentProviderNativeCodingV2DecisionProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-v4-flash',
      completeStructuredJson,
    } as unknown as AgentProvider)

    await expect(decisionProvider.complete({
      phase: 'initial',
      systemPrompt: 'Return JSON.',
      userPrompt: 'x'.repeat(30_001),
      maxOutputTokens: 4_096,
    })).rejects.toThrow('prompt exceeds the hard limit')
    expect(completeStructuredJson).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'missing usage', usage: undefined },
    { label: 'fractional usage', usage: { inputTokens: 1.5, outputTokens: 2 } },
    { label: 'negative usage', usage: { inputTokens: 1, outputTokens: -1 } },
  ])('rejects provider output with $label', async ({ usage }) => {
    const decisionProvider = createAgentProviderNativeCodingV2DecisionProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-v4-flash',
      completeStructuredJson: vi.fn(async () => ({ value: { stateVersion: 2 }, usage })),
    } as unknown as AgentProvider)

    await expect(decisionProvider.complete({
      phase: 'analysis',
      systemPrompt: 'Return JSON.',
      userPrompt: '{}',
      maxOutputTokens: 1_024,
    })).rejects.toThrow('exact integer token usage')
  })

  it('normalizes exact provider token usage into a metered result', async () => {
    const decisionProvider = createAgentProviderNativeCodingV2DecisionProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-v4-flash',
      completeStructuredJson: vi.fn(async () => ({
        value: { stateVersion: 2 },
        usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 10 },
      })),
    } as unknown as AgentProvider)

    await expect(decisionProvider.complete({
      phase: 'analysis',
      systemPrompt: 'Return JSON.',
      userPrompt: '{}',
      maxOutputTokens: 1_024,
    })).resolves.toMatchObject({
      value: { stateVersion: 2 },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 10,
      },
    })
  })
})
