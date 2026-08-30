import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { saveRuntimeBudgetPolicy } from '../lib/devflow-api'
import { saveRuntimeBudgetPolicyAction } from './runtime-budget-actions'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

vi.mock('../lib/devflow-api', () => ({
  createRuntimeBudgetApproval: vi.fn(),
  saveRuntimeBudgetPolicy: vi.fn(),
}))

const mockedCookies = vi.mocked(cookies)
const mockedSaveRuntimeBudgetPolicy = vi.mocked(saveRuntimeBudgetPolicy)
const mockedRevalidatePath = vi.mocked(revalidatePath)

beforeEach(() => {
  vi.clearAllMocks()
  mockedCookies.mockResolvedValue({
    get: vi.fn(() => ({ value: 'session-token' })),
  } as never)
})

describe('saveRuntimeBudgetPolicyAction', () => {
  it('returns the saved API policy and revalidates the current Team page', async () => {
    const policy = {
      projectId: 'project-1',
      enabled: true,
      monthlyLimitUsd: 0.25,
      warningThresholdUsd: 0.15,
      currency: 'USD' as const,
      updatedAt: '2026-08-30T12:34:56.000Z',
    }
    mockedSaveRuntimeBudgetPolicy.mockResolvedValue(policy)
    const formData = new FormData()
    formData.set('projectId', 'project-1')
    formData.set('enabled', 'on')
    formData.set('monthlyLimitUsd', '0.25')
    formData.set('warningThresholdUsd', '0.15')

    await expect(saveRuntimeBudgetPolicyAction(formData)).resolves.toEqual({
      ok: true,
      policy,
    })
    expect(mockedSaveRuntimeBudgetPolicy).toHaveBeenCalledWith({
      projectId: 'project-1',
      enabled: true,
      monthlyLimitUsd: 0.25,
      warningThresholdUsd: 0.15,
      cookieHeader: 'devflow_session=session-token',
    })
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/legacy-shell')
  })

  it('reports a save failure without revalidating stale data as successful', async () => {
    mockedSaveRuntimeBudgetPolicy.mockRejectedValue(
      new Error('DevFlow API /api/runtime/budget-policy failed with 503'),
    )
    const formData = new FormData()
    formData.set('projectId', 'project-1')
    formData.set('monthlyLimitUsd', '0.25')
    formData.set('warningThresholdUsd', '0.15')

    await expect(saveRuntimeBudgetPolicyAction(formData)).resolves.toEqual({
      ok: false,
      error: 'DevFlow API /api/runtime/budget-policy failed with 503',
    })
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('does not turn intentionally empty budget fields into zero-dollar policy values', async () => {
    const formData = new FormData()
    formData.set('projectId', 'project-1')
    formData.set('monthlyLimitUsd', '')
    formData.set('warningThresholdUsd', '')

    await expect(saveRuntimeBudgetPolicyAction(formData)).resolves.toEqual({
      ok: false,
      error: '请填写有效的预算策略。',
    })
    expect(mockedSaveRuntimeBudgetPolicy).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})
