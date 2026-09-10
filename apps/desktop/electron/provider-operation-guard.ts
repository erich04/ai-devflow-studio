import type { AgentProvider, ProviderRemovalReference } from '@ai-devflow/shared'

/** Process-local execution leases cover Stage/Review calls without durable running rows. */
export function createProviderOperationGuard() {
  const active = new Map<string, Map<symbol, ProviderRemovalReference>>()
  const deleting = new Set<string>()
  return {
    references(providerId: string): ProviderRemovalReference[] {
      return [...(active.get(providerId)?.values() ?? [])]
    },
    async use<T>(providerId: string | undefined, id: string, operation: () => Promise<T>): Promise<T> {
      if (!providerId) return operation()
      if (deleting.has(providerId)) throw new Error('该 Provider 正在删除，请稍后重新选择。')
      const lease = Symbol(id)
      const entries = active.get(providerId) ?? new Map<symbol, ProviderRemovalReference>()
      entries.set(lease, { kind: 'active_request', id, remediation: '等待当前 Provider 操作结束后重试。' })
      active.set(providerId, entries)
      try { return await operation() } finally {
        entries.delete(lease)
        if (entries.size === 0) active.delete(providerId)
      }
    },
    async remove<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
      if (deleting.has(providerId)) throw new Error('该 Provider 正在删除，请稍后重试。')
      deleting.add(providerId)
      try { return await operation() } finally { deleting.delete(providerId) }
    },
  }
}

export function guardProviderCalls(provider: AgentProvider, input: {
  guard: ReturnType<typeof createProviderOperationGuard>
  credentialExists: () => Promise<boolean>
}): AgentProvider {
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    return input.guard.use(provider.id, 'Provider model call', async () => {
      if (!await input.credentialExists()) throw new Error('Provider 已被删除，请重新选择。')
      return operation()
    })
  }
  return {
    ...provider,
    reviewKnowledge: (request) => call(() => provider.reviewKnowledge(request)),
    ...(provider.generateWorkflowArtifact ? {
      generateWorkflowArtifact: (request: Parameters<NonNullable<AgentProvider['generateWorkflowArtifact']>>[0]) =>
        call(() => provider.generateWorkflowArtifact!(request)),
    } : {}),
    ...(provider.completeStructuredJson ? {
      completeStructuredJson: (request: Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0]) =>
        call(() => provider.completeStructuredJson!(request)),
    } : {}),
  }
}
