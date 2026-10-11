const randomUUID = () => globalThis.crypto.randomUUID()
import { AgentProviderRequestError, reviewProviderCapabilities, type AgentProvider } from './agent-review'
import type { AgentProviderUsage } from './domain'
import type { ModelCallQuote, ModelCallSettlement, ModelCallAdmission } from './model-call-budget'

export type ModelCallGovernance = {
  reserve(input: ModelCallQuote, signal?: AbortSignal): Promise<ModelCallAdmission>
  settle(input: ModelCallSettlement): Promise<void>
  persist(input: ModelCallSettlement, metadata?: { final: boolean }): Promise<void>
  pending(projectId: string): Promise<ModelCallSettlement[]>
}
const activeAttempts = new Set<string>()
export type CallResult = { usage?: AgentProviderUsage }
/** One admission per actual request. A failed accounting upload cannot discard valid model output. */
export async function governedModelCall<T extends CallResult>(input: {
  governance: ModelCallGovernance; projectId: string
  provider: Pick<AgentProvider, 'id' | 'model' | 'billingProvider' | 'defaultReviewOutputTokens'>
  prompt: string; maxOutputTokens?: number; signal?: AbortSignal; approvalId?: string
  boundBasis?: ModelCallQuote['boundBasis']
  operation?: ModelCallQuote['operation']
  action: (observe: (usage: AgentProviderUsage) => Promise<void>) => Promise<T>
}): Promise<T> {
  const { governance: g, provider: p } = input
  input.signal?.throwIfAborted()
  for (const settlement of await g.pending(input.projectId)) if (!activeAttempts.has(settlement.id)) {
    try { await g.settle(settlement) } catch { /* Keep the durable result; atomic admission still counts its reservation. */ }
  }
  input.signal?.throwIfAborted()
  const id = `model-call-${randomUUID()}`
  const quote: ModelCallQuote = { id, projectId: input.projectId, providerId: p.id, model: p.model, createdAt: new Date().toISOString(),
    inputTokens: input.boundBasis === 'deepseek-context-v1' ? 1_048_576 : Math.ceil(new TextEncoder().encode(input.prompt).length / 4) + 1024, maxOutputTokens: input.maxOutputTokens ?? p.defaultReviewOutputTokens ?? null,
    ...(input.boundBasis ? { boundBasis: input.boundBasis } : {}), ...(input.operation ? { operation: input.operation } : {}),
    billingProvider: p.billingProvider ?? 'openai_compatible', ...(input.approvalId ? { approvalId: input.approvalId } : {}) }
  const admission = await g.reserve(quote, input.signal)
  if (!admission.accepted || admission.decision.blocksRun) {
    const error = new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'budget_not_ready', deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false })
    error.message = `尚未调用模型：${admission.decision.reason}`
    throw error
  }
  let settlement: ModelCallSettlement = { id, projectId: input.projectId, state: 'failed' }
  activeAttempts.add(id)
  try { await g.persist(settlement, { final: false }) } catch (cause) {
    activeAttempts.delete(id)
    await g.settle({ ...settlement, state: 'not_sent' }).catch(() => undefined)
    throw new AgentProviderRequestError({ code: 'unknown_provider_failure', sanitizedCause: 'accounting_unavailable',
      deliveryState: 'not_sent', billingState: 'not_incurred', retryable: false, usage: { budgetAttemptIds: [id] }, cause })
  }
  let sent = false
  let result: T | undefined
  let failure: AgentProviderRequestError | undefined
  let observation: AgentProviderUsage | undefined
  try {
    input.signal?.throwIfAborted(); sent = true
    result = await input.action(async usage => {
      observation = usage // Cumulative snapshot replaces the prior snapshot; never add it twice.
      await g.persist({ ...settlement, usage }, { final: false }).catch(() => undefined) // Preserve later/final usage even if a checkpoint write fails.
    })
    settlement = { ...settlement, state: 'completed', ...(result.usage ? { usage: result.usage } : {}) }
  } catch (error) {
    const e = error instanceof AgentProviderRequestError ? error : null
    const usage = e?.usage ?? observation
    settlement = { ...settlement, state: !sent || e?.billingState === 'not_incurred' ? 'not_sent' : input.signal?.aborted ? 'cancelled' : 'failed', ...(usage ? { usage } : {}) }
    failure = e ? new AgentProviderRequestError({ ...e, usage: { ...usage, budgetAttemptIds: [id] }, cause: e })
      : new AgentProviderRequestError({ code: input.signal?.aborted ? 'cancelled_by_user' : 'unknown_provider_failure',
        sanitizedCause: input.signal?.aborted ? 'cancelled_by_user' : 'provider_dispatch_failed', deliveryState: sent ? 'possibly_delivered' : 'not_sent',
        billingState: sent ? 'unknown' : 'not_incurred', retryable: !input.signal?.aborted, usage: { ...usage, budgetAttemptIds: [id] }, cause: error })
  }
  let pending = false
  try { await g.persist(settlement, { final: true }); await g.settle(settlement) }
  catch { pending = true } // Durable dispatch/usage remains available for reconciliation; no model replay.
  finally { activeAttempts.delete(id) }
  if (failure) throw new AgentProviderRequestError({ ...failure, usage: { ...failure.usage, ...(pending ? { settlementStatus: 'pending' as const } : {}) }, cause: failure })
  return { ...result!, usage: { ...result?.usage, budgetAttemptIds: [id], ...(pending ? { settlementStatus: 'pending' as const } : {}) } }
}
export function governAgentProvider(provider: AgentProvider, projectId: string, governance: ModelCallGovernance, approvalId?: string): AgentProvider {
  const operations = new Map<string, Promise<NonNullable<ModelCallQuote['operation']>>>()
  const operationFor = (prompt: string, purpose: string, key = 'current') => {
    const scope = key === 'current' ? `${purpose}:${key}` : key
    let operation = operations.get(scope)
    if (!operation) {
      operation = globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt)).then(digest => ({ id: `operation-${randomUUID()}`, version: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), purpose }))
      operations.set(scope, operation)
    }
    return operation
  }
  const boundBasis = provider.resolveRequestPolicy?.({}).capability === 'deepseek-2026-10-10' ? 'deepseek-context-v1' as const : undefined
  const base = { ...(boundBasis ? { boundBasis } : {}), provider, projectId, governance, ...(approvalId ? { approvalId } : {}) }
  return { ...provider,
    reviewKnowledge: async input => governedModelCall({ ...base, operation: await operationFor(input.prompt, 'review'), prompt: input.prompt, maxOutputTokens: provider.resolveRequestPolicy?.({ purpose: 'review', maxOutputTokens: input.maxOutputTokens ?? provider.reviewOutputLimit }).maxOutputTokens ?? input.maxOutputTokens ?? provider.reviewOutputLimit ?? provider.defaultReviewOutputTokens ?? 8192,
      ...(input.signal ? { signal: input.signal } : {}), action: observe => provider.reviewKnowledge({ ...input, onUsage: async usage => { await observe(usage); await input.onUsage?.(usage) } }) }),
    ...(provider.generateWorkflowArtifact ? { generateWorkflowArtifact: async (input: Parameters<NonNullable<AgentProvider['generateWorkflowArtifact']>>[0]) => governedModelCall({ ...base, operation: await operationFor(input.prompt, 'workflow'), prompt: input.prompt,
      maxOutputTokens: provider.resolveRequestPolicy?.({ purpose: 'workflow' }).maxOutputTokens ?? provider.defaultReviewOutputTokens ?? 8192,
      ...(input.signal ? { signal: input.signal } : {}), action: observe => provider.generateWorkflowArtifact!({ ...input, onUsage: async usage => { await observe(usage); await input.onUsage?.(usage) } }) }) } : {}),
    ...(provider.completeStructuredJson ? { completeStructuredJson: async (input: Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0]) => {
      provider.validateStructuredRequest?.(input)
      const maxOutputTokens = provider.resolveRequestPolicy?.(input).maxOutputTokens ?? input.maxOutputTokens ?? provider.defaultReviewOutputTokens ?? 8192
      return governedModelCall({ ...base, operation: await operationFor(input.systemPrompt + '\n' + input.userPrompt, input.purpose ?? 'native-tool', input.operationKey ?? (input.purpose ? 'current' : randomUUID())), prompt: input.systemPrompt + '\n' + input.userPrompt + (input.nativeTools ? JSON.stringify(input.nativeTools) : ''), maxOutputTokens,
        ...(input.signal ? { signal: input.signal } : {}), action: observe => provider.completeStructuredJson!({ ...input, maxOutputTokens,
          onUsage: async usage => { await observe(usage); await input.onUsage?.(usage) } }) })
    } } : {}),
  }
}
export function modelCallMetadata(binding: { providerId: string; modelId: string; baseUrl: string }) {
  return { id: binding.providerId, model: binding.modelId, ...reviewProviderCapabilities({ id: binding.providerId, model: binding.modelId, baseUrl: binding.baseUrl }) }
}
