import { describeProviderFailure } from '@ai-devflow/shared'
import type { CodingProviderCallTrace } from './coding-engine.js'

const phaseLabels: Record<CodingProviderCallTrace['phase'], string> = {
  analysis: '分析',
  initial: '生成改动',
  repair: '修正改动',
  revision: '按清单修改',
  change_review: 'AI 自检',
}

function providerLabel(trace: Pick<CodingProviderCallTrace, 'providerId' | 'model'>): string {
  if (trace.providerId.toLowerCase() === 'deepseek') return 'DeepSeek'
  // A configured Provider ID is internal; the model name is what the user chose.
  return trace.model.trim() || '模型'
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return '耗时未知'
  return durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(durationMs % 1_000 === 0 ? 0 : 1)} 秒`
    : `${durationMs} 毫秒`
}

/**
 * The execution-record line for one model call. A failed call's line also becomes the coding
 * run summary, so it names the model and the reason in Chinese; the raw Provider ID, error code
 * and cause stay in the event's `providerCall` metadata (hardening H4).
 */
export function providerCallTraceMessage(trace: CodingProviderCallTrace): string {
  const prefix = `${providerLabel(trace)} · ${phaseLabels[trace.phase] ?? trace.phase}`
  if (trace.status === 'started') {
    return `${prefix} · 模型调用已开始。`
  }
  const duration = durationLabel(trace.durationMs)
  const billing = trace.billingState === 'confirmed'
    ? '费用已确认'
    : trace.billingState === 'not_incurred'
      ? '未产生模型费用'
      : '费用状态未知'
  if (trace.status === 'succeeded') {
    return `${prefix} · 模型调用成功（${duration}） · ${billing}。`
  }
  const retry = trace.retryable ? '可以手动重试' : '不建议直接重试'
  return `${prefix} · ${describeProviderFailure(trace)}（${duration}） · ${billing} · ${retry}。`
}
