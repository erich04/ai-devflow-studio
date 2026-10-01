import { describe, expect, it } from 'vitest'
import type { CodingProviderCallTrace } from './coding-engine.js'
import { providerCallTraceMessage } from './provider-call-trace-message.js'

function trace(overrides: Partial<CodingProviderCallTrace> = {}): CodingProviderCallTrace {
  return {
    stateVersion: 1,
    requestId: 'request-1',
    codingRunId: 'coding-run-1',
    phase: 'analysis',
    attempt: 1,
    providerId: 'provider-7f3a',
    model: 'deepseek-flash',
    status: 'failed',
    startedAt: '2026-09-30T00:00:00.000Z',
    completedAt: '2026-09-30T00:00:12.000Z',
    durationMs: 12_000,
    timeoutMs: 60_000,
    promptChars: 10,
    promptBytes: 10,
    promptDigest: 'digest',
    manifestPathCount: 0,
    excerptCount: 0,
    maxOutputTokens: 2_048,
    deliveryState: 'response_received',
    billingState: 'confirmed',
    retryable: false,
    redacted: true,
    ...overrides,
  }
}

describe('providerCallTraceMessage', () => {
  it('names the model and the reason instead of the Provider ID and error code (#200)', () => {
    const message = providerCallTraceMessage(trace({ errorCode: 'invalid_model_output', sanitizedCause: 'output_length' }))
    expect(message).toBe('deepseek-flash · 分析 · 模型输出达到上限，回答未完成（12 秒） · 费用已确认 · 不建议直接重试。')
    expect(message).not.toMatch(/provider-7f3a|invalid_model_output|output_length|analysis/u)
  })
  it('falls back from an unknown cause to the error code and keeps the HTTP status', () => {
    expect(providerCallTraceMessage(trace({
      phase: 'repair', errorCode: 'http_5xx', sanitizedCause: 'upstream_unavailable', httpStatus: 503,
      billingState: 'not_incurred', retryable: true, durationMs: 900,
    }))).toBe('deepseek-flash · 修正改动 · 模型服务出错，HTTP 503（900 毫秒） · 未产生模型费用 · 可以手动重试。')
    const { durationMs: _durationMs, ...unknownFailure } = trace({ billingState: 'unknown' })
    expect(providerCallTraceMessage(unknownFailure))
      .toBe('deepseek-flash · 分析 · 模型调用失败，原因未知（耗时未知） · 费用状态未知 · 不建议直接重试。')
  })
  it('keeps the DeepSeek name for the built-in Provider and words start and success in Chinese', () => {
    expect(providerCallTraceMessage(trace({ providerId: 'deepseek', phase: 'initial', status: 'started' })))
      .toBe('DeepSeek · 生成改动 · 模型调用已开始。')
    expect(providerCallTraceMessage(trace({ status: 'succeeded', durationMs: 1_500 })))
      .toBe('deepseek-flash · 分析 · 模型调用成功（1.5 秒） · 费用已确认。')
  })
})
