import { describe, expect, it, vi } from 'vitest'
import { createProviderOperationGuard, guardProviderCalls } from './provider-operation-guard'

describe('Provider operation lifetime', () => {
  it('keeps all overlapping operations visible and releases both success and failure', async () => {
    const guard = createProviderOperationGuard()
    let release!: () => void
    const first = guard.use('provider', 'Stage run-one', () => new Promise<void>((done) => { release = done }))
    expect(guard.references('provider')).toHaveLength(1)
    await expect(guard.use('provider', 'Review run-two', async () => {
      expect(guard.references('provider')).toHaveLength(2)
      throw new Error('failed')
    })).rejects.toThrow('failed')
    expect(guard.references('provider')).toHaveLength(1)
    release()
    await first
    expect(guard.references('provider')).toEqual([])
  })

  it('prevents a new use or duplicate removal while deletion awaits persistence', async () => {
    const guard = createProviderOperationGuard()
    const call = vi.fn()
    await guard.remove('provider', async () => {
      await expect(guard.use('provider', 'Review', call)).rejects.toThrow('正在删除')
      await expect(guard.remove('provider', call)).rejects.toThrow('正在删除')
      expect(call).not.toHaveBeenCalled()
    })
    await guard.use('provider', 'Review', async () => undefined)
  })

  it('never invokes a cached model after its saved credential has been deleted', async () => {
    const request = { systemPrompt: 'fixture', userPrompt: 'fixture', maxOutputTokens: 1 }
    const completeStructuredJson = vi.fn()
    const provider = guardProviderCalls({ id: 'provider', name: 'QA', model: 'fixture', reviewKnowledge: vi.fn(), completeStructuredJson }, {
      guard: createProviderOperationGuard(), credentialExists: async () => false,
    })
    await expect(provider.completeStructuredJson!(request)).rejects.toThrow('已被删除')
    expect(completeStructuredJson).not.toHaveBeenCalled()
  })
})
