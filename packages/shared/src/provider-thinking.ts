export type ProviderThinkingConfiguration = {
  mode: 'default' | 'enabled' | 'disabled'
  effort?: 'low' | 'high' | 'max'
}

export type UpdateProviderThinkingInput = {
  providerId: string
  expectedUpdatedAt: string
  thinking: ProviderThinkingConfiguration
}

export type EffectiveProviderThinking = {
  mode: 'enabled' | 'disabled' | 'provider_default'
  effort?: 'low' | 'high' | 'max'
  source: 'provider_configuration' | 'application_default' | 'provider_default'
}

const supportedModels = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'])

export function supportsProviderThinking(input: { baseUrl?: string | undefined; model: string }): boolean {
  try {
    const url = new URL(input.baseUrl ?? '')
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
      && ['', '/', '/v1', '/v1/'].includes(url.pathname)
      && supportedModels.has(input.model)
  } catch { return false }
}

export function parseProviderThinking(value: unknown): ProviderThinkingConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('思考模式配置无效。')
  if (Object.keys(value).some((key) => key !== 'mode' && key !== 'effort')) throw new Error('思考模式配置无效。')
  const { mode, effort } = value as Record<string, unknown>
  if (mode !== 'default' && mode !== 'enabled' && mode !== 'disabled') throw new Error('思考模式配置无效。')
  if (effort !== undefined && (mode !== 'enabled' || typeof effort !== 'string' || !['low', 'high', 'max'].includes(effort))) throw new Error('推理强度配置无效。')
  return { mode, ...(mode === 'enabled' ? { effort: (effort ?? 'low') as 'low' | 'high' | 'max' } : {}) }
}

/** One policy for every built-in caller. Display subscriptions never change it. */
export function resolveProviderThinking(input: { baseUrl?: string | undefined; model: string; thinking?: ProviderThinkingConfiguration | undefined }): EffectiveProviderThinking {
  const setting = input.thinking === undefined ? { mode: 'default' as const } : parseProviderThinking(input.thinking)
  if (!supportsProviderThinking(input)) {
    if (setting.mode !== 'default') throw new Error('此 Provider／模型尚不支持可配置的思考参数，请使用模型默认值。')
    return { mode: 'provider_default', source: 'provider_default' }
  }
  if (setting.mode === 'default') return { mode: 'enabled', effort: 'low', source: 'application_default' }
  return { mode: setting.mode, ...(setting.mode === 'enabled' ? { effort: setting.effort ?? 'low' } : {}), source: 'provider_configuration' }
}

export function providerThinkingRequestFields(effective: EffectiveProviderThinking): Record<string, unknown> {
  if (effective.mode === 'provider_default') return {}
  return { thinking: { type: effective.mode }, ...(effective.mode === 'enabled' ? { reasoning_effort: effective.effort } : {}) }
}

export function describeProviderThinking(effective: EffectiveProviderThinking): string {
  if (effective.mode === 'provider_default') return '模型默认（不发送思考扩展参数）'
  if (effective.mode === 'disabled') return '思考关闭'
  return `思考开启 · ${effective.effort}${effective.source === 'application_default' ? '（应用默认）' : ''}`
}
