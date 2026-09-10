import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeBudgetPolicy } from '@ai-devflow/shared'
import { useProjectRuntimeBudget } from './useProjectRuntimeBudget'

const policy: RuntimeBudgetPolicy = {
  projectId: 'team-a', enabled: true, monthlyLimitUsd: 1, warningThresholdUsd: 0.5,
  currency: 'USD', updatedAt: '2026-09-07T00:00:00.000Z',
}

function setup() {
  return {
    getCodingRuntimeBudgetPolicy: vi.fn<() => Promise<RuntimeBudgetPolicy | null>>().mockResolvedValue(policy),
    saveCodingRuntimeBudgetPolicy: vi.fn<() => Promise<RuntimeBudgetPolicy>>().mockResolvedValue({ ...policy, monthlyLimitUsd: 2 }),
  }
}

describe('project runtime budget', () => {
  it('loads and saves project policy independently of any Coding Run, retaining confirmed values on failure', async () => {
    const desktopApi = setup()
    const { result } = renderHook(() => useProjectRuntimeBudget({ desktopApi, projectId: 'local-a', bindingKey: 'token-a' }))
    await waitFor(() => expect(result.current.label).toContain('$1.00'))
    await act(async () => { await result.current.save({ enabled: true, monthlyLimitUsd: 2, warningThresholdUsd: 0.5 }) })
    expect(result.current.label).toContain('$2.00')
    desktopApi.saveCodingRuntimeBudgetPolicy.mockRejectedValueOnce(new Error('Team unavailable'))
    await act(async () => {
      await expect(result.current.save({ enabled: true, monthlyLimitUsd: 3, warningThresholdUsd: 0.5 })).rejects.toThrow('Team unavailable')
    })
    expect(result.current.policy?.monthlyLimitUsd).toBe(2)
  })

  it('distinguishes missing policy, disabled policy, and failed reads and permits recovery', async () => {
    const desktopApi = setup()
    desktopApi.getCodingRuntimeBudgetPolicy.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useProjectRuntimeBudget({ desktopApi, projectId: 'local-a', bindingKey: 'token-a' }))
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.error).toBe('offline')
    desktopApi.getCodingRuntimeBudgetPolicy.mockResolvedValueOnce(null)
    await act(async () => { await result.current.refresh() })
    expect(result.current.label).toBe('未配置')
    desktopApi.getCodingRuntimeBudgetPolicy.mockResolvedValueOnce({ ...policy, enabled: false })
    await act(async () => { await result.current.refresh() })
    expect(result.current.label).toBe('已禁用')
  })

  it('clears project state on rebinding and ignores a previous binding response', async () => {
    const desktopApi = setup()
    let resolveOld!: (value: RuntimeBudgetPolicy) => void
    desktopApi.getCodingRuntimeBudgetPolicy.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const { result, rerender } = renderHook(({ bindingKey }) => useProjectRuntimeBudget({ desktopApi, projectId: 'local-a', bindingKey }), {
      initialProps: { bindingKey: 'token-a' },
    })
    desktopApi.getCodingRuntimeBudgetPolicy.mockResolvedValueOnce(null)
    rerender({ bindingKey: 'token-b' })
    expect(result.current.policy).toBeNull()
    await waitFor(() => expect(result.current.label).toBe('未配置'))
    await act(async () => { resolveOld(policy) })
    expect(result.current.policy).toBeNull()
    rerender({ bindingKey: '' })
    expect(result.current.label).toBe('未配对')
  })

  it('does not let an older read overwrite a successful save', async () => {
    const desktopApi = setup()
    let resolveRead!: (value: RuntimeBudgetPolicy) => void
    desktopApi.getCodingRuntimeBudgetPolicy.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve }))
    const { result } = renderHook(() => useProjectRuntimeBudget({ desktopApi, projectId: 'local-a', bindingKey: 'token-a' }))
    await act(async () => { await result.current.save({ enabled: true, monthlyLimitUsd: 2, warningThresholdUsd: 0.5 }) })
    await act(async () => { resolveRead(policy) })
    expect(result.current.policy?.monthlyLimitUsd).toBe(2)
  })
})
