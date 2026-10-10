import { resolveProviderThinking, supportsProviderThinking, type ProviderThinkingConfiguration, type EffectiveProviderThinking } from './provider-thinking'
import { modelExecutionRollout } from './model-execution-rollout'

export type ModelRequestPurpose = 'conversation' | 'proposal' | 'review' | 'workflow' | 'native-tool'
/** Storage/parser capacities, not token estimates. Character and UTF-8 byte units stay separate. */
export const MODEL_CONTENT_BYTES = 8 * 1024 * 1024
export const MODEL_ENVELOPE_BYTES = 64 * 1024 * 1024
export const MODEL_INPUT_BYTES = 4 * 1024 * 1024
export type ResolvedRequestPolicy = {
  version: 1
  maxOutputTokens: number
  outputTokenCap: number
  contextTokens: number
  maxInputBytes: number
  contentBytes: number
  reasoningBytes: number
  envelopeBytes: number
  thinking: EffectiveProviderThinking
  stream: boolean
  capability: 'deepseek-2026-10-10' | 'compatible-unverified'
}
/** One resolution is used for wire parameters, admission and diagnostics. UI subscriptions are absent. */
export function resolveRequestPolicy(input: {
  model: string; baseUrl?: string; thinking?: ProviderThinkingConfiguration | undefined
  effectiveThinking?: EffectiveProviderThinking; maxOutputTokens?: number | undefined; purpose?: ModelRequestPurpose | undefined
}): ResolvedRequestPolicy {
  const known = supportsProviderThinking(input)
  const thinking = input.effectiveThinking ?? resolveProviderThinking(input)
  const outputTokenCap = known ? 393216 : 1_000_000
  const defaultOutput = known && thinking.mode === 'enabled' ? thinking.effort === 'max' ? 131072 : 65536 : 8192
  const requestedOutput = input.maxOutputTokens ?? defaultOutput
  if (!Number.isSafeInteger(requestedOutput) || requestedOutput < 1 || requestedOutput > outputTokenCap) throw new Error('Agent provider structured request is invalid: output token allowance')
  const activeCap = modelExecutionRollout().longContent ? outputTokenCap : 8192
  const maxOutputTokens = Math.min(requestedOutput, activeCap)
  return { version: 1, maxOutputTokens, outputTokenCap: activeCap, contextTokens: known ? 1_048_576 : 128_000,
    maxInputBytes: MODEL_INPUT_BYTES, contentBytes: MODEL_CONTENT_BYTES, reasoningBytes: MODEL_CONTENT_BYTES,
    envelopeBytes: MODEL_ENVELOPE_BYTES, thinking, stream: known, capability: known ? 'deepseek-2026-10-10' : 'compatible-unverified' }
}

/** Only published model capabilities justify automatic growth; each new request is re-admitted. */
export function expandedOutputAllowance(policy: ResolvedRequestPolicy): number | undefined {
  if (!modelExecutionRollout().longContent || policy.capability === 'compatible-unverified') return undefined
  const next = Math.min(policy.outputTokenCap, policy.maxOutputTokens * 2)
  return next > policy.maxOutputTokens ? next : undefined
}
