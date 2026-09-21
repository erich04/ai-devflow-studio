import { describe, expect, it, vi } from 'vitest'
import { AgentProviderRequestError, createOpenAiCompatibleAgentProvider, type AgentProvider } from '@ai-devflow/shared'
import { createAgentProviderNativeCodingV2DecisionProvider } from './native-coding-executor-v2.js'

describe('Agent Provider Native Coding v2 boundary', () => {
  it.each([{ mode: 'disabled' as const }, { mode: 'enabled' as const, effort: 'low' as const }])('inherits saved $mode thinking in actual Native requests and trace metadata', async (thinking) => {
    let body: Record<string, unknown> = {}
    const provider = createOpenAiCompatibleAgentProvider({ model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture', thinking,
      fetcher: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) },
    })
    const native = createAgentProviderNativeCodingV2DecisionProvider(provider)
    await native.complete({ phase: 'analysis', systemPrompt: 'JSON', userPrompt: 'fixture', maxOutputTokens: 500 })
    expect(body.thinking).toEqual({ type: thinking.mode })
    expect(body.reasoning_effort).toBe(thinking.mode === 'enabled' ? 'low' : undefined)
    expect(native.effectiveThinking?.mode).toBe(thinking.mode)
  })
  it('rejects an oversized prompt before invoking the provider', async () => {
    const completeStructuredJson = vi.fn()
    const decisionProvider = createAgentProviderNativeCodingV2DecisionProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-v4-flash',
      billingProvider: 'deepseek',
      completeStructuredJson,
    } as unknown as AgentProvider)
    expect(decisionProvider.billingProvider).toBe('deepseek')

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
      completeStructuredJson: vi.fn(async () => ({
        value: { stateVersion: 2 },
        usage,
        responseMetadata: {
          httpStatus: 200,
          responseId: 'response-invalid-usage',
          systemFingerprint: 'fingerprint-invalid-usage',
        },
      })),
    } as unknown as AgentProvider)

    const failure = await decisionProvider.complete({
      phase: 'analysis',
      systemPrompt: 'Return JSON.',
      userPrompt: '{}',
      maxOutputTokens: 1_024,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentProviderRequestError)
    expect(failure).toMatchObject({
      code: 'invalid_usage',
      deliveryState: 'response_received',
      billingState: 'unknown',
      retryable: false,
      sanitizedCause: 'provider_usage_missing_or_invalid',
      responseMetadata: {
        httpStatus: 200,
        responseId: 'response-invalid-usage',
        systemFingerprint: 'fingerprint-invalid-usage',
      },
    })
  })

  it('normalizes exact provider token usage into a metered result', async () => {
    const decisionProvider = createAgentProviderNativeCodingV2DecisionProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-v4-flash',
      targetHost: 'api.deepseek.com',
      requestTimeoutMs: 30_000,
      completeStructuredJson: vi.fn(async () => ({
        value: { stateVersion: 2 },
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 10,
          cacheMissTokens: 110,
          cacheStatus: 'complete',
          billingProvider: 'deepseek',
        },
        responseMetadata: {
          httpStatus: 200,
          responseId: 'response-safe-1',
          systemFingerprint: 'fingerprint-safe-1',
        },
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
        cacheMissTokens: 110,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
      responseMetadata: {
        httpStatus: 200,
        responseId: 'response-safe-1',
        systemFingerprint: 'fingerprint-safe-1',
      },
    })
    expect(decisionProvider).toMatchObject({
      targetHost: 'api.deepseek.com',
      timeoutMs: 30_000,
    })
  })
})
