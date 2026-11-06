import { measurePromptSections, type AgentProvider, type NativeConversationRequest } from '@ai-devflow/shared'

/** Both conversation domains measure the same wire serializer used by the provider. */
export function nativeRequestBudget(provider: Pick<AgentProvider, 'id' | 'model' | 'resolveRequestPolicy' | 'serializeNativeRequest'>, request: NativeConversationRequest) {
  const policy = provider.resolveRequestPolicy?.(request)
  const serialized = provider.serializeNativeRequest?.(request) ?? JSON.stringify({ messages: [{ role: 'system', content: request.systemPrompt }, ...request.messages], tools: request.tools })
  return measurePromptSections([{ id: 'native-request', kind: 'current', content: serialized, required: true }], {
    provider: provider.id, model: provider.model, maxBytes: policy?.maxInputBytes ?? 4 * 1024 * 1024, maxChars: policy?.maxInputBytes ?? 4 * 1024 * 1024,
    maxTokens: Math.max(1, (policy?.contextTokens ?? 128000) - (request.maxOutputTokens ?? policy?.maxOutputTokens ?? 8192) - 8000),
  })
}
