import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createRecommendedEnforcementPreset, createWarnOnlyDefaultPolicy } from '@ai-devflow/shared'
import { DevFlowApiError, fetchTeamOverview, saveEnforcementPolicy } from './lib/devflow-api'
import { updateEnforcementPolicyAction } from './enforcement-policy-actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./lib/devflow-api', async (original) => ({
  ...await original<typeof import('./lib/devflow-api')>(),
  fetchTeamOverview: vi.fn(), saveEnforcementPolicy: vi.fn(),
}))
const before = createWarnOnlyDefaultPolicy({ organizationId: 'org-test' })
const saved = createRecommendedEnforcementPreset({ organizationId: 'org-test', updatedAt: '2026-09-10T12:00:00Z' })
function snapshot(policy = before) {
  return { enforcementPolicies: { organizationPolicy: policy } } as Awaited<ReturnType<typeof fetchTeamOverview>>
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'test-session' }) } as never)
  vi.mocked(fetchTeamOverview).mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot(saved))
})

describe('recommended policy feedback', () => {
  it('returns the read-back snapshot, not the write response, and refreshes both shells', async () => {
    vi.mocked(saveEnforcementPolicy).mockResolvedValue({ ...saved, version: 99 })
    expect(await updateEnforcementPolicyAction('org-test', 'apply')).toEqual({ ok: true, policy: saved })
    expect(fetchTeamOverview).toHaveBeenCalledTimes(2)
    expect(saveEnforcementPolicy).toHaveBeenCalledWith(expect.objectContaining({ cookieHeader: 'devflow_session=test-session' }))
    expect(revalidatePath).toHaveBeenCalledWith('/')
    expect(revalidatePath).toHaveBeenCalledWith('/legacy-shell')
  })

  it('does not write an already applied preset or a read-only retry', async () => {
    vi.mocked(fetchTeamOverview).mockReset().mockResolvedValue(snapshot(saved))
    expect((await updateEnforcementPolicyAction('org-test', 'apply')).ok).toBe(true)
    expect((await updateEnforcementPolicyAction('org-test', 'refresh')).ok).toBe(true)
    expect(saveEnforcementPolicy).not.toHaveBeenCalled()
  })

  it('does not call a custom blocking policy the recommended preset', async () => {
    const custom = { ...saved, rules: saved.rules.map((rule, index) => index === 0 ? { ...rule, overridable: false } : rule) }
    vi.mocked(fetchTeamOverview).mockReset().mockResolvedValueOnce(snapshot(custom)).mockResolvedValue(snapshot(saved))
    expect((await updateEnforcementPolicyAction('org-test', 'apply')).ok).toBe(true)
    expect(saveEnforcementPolicy).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('shows an actionable HTTP %s error without claiming success', async (status) => {
    vi.mocked(saveEnforcementPolicy).mockRejectedValue(new DevFlowApiError('/api/enforcement/policy', status))
    expect(await updateEnforcementPolicyAction('org-test', 'apply')).toMatchObject({
      ok: false, error: expect.stringContaining(status === 403 ? 'Owner' : '登录已过期'),
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('requires a read-only retry when saving may have succeeded but read-back failed', async () => {
    vi.mocked(fetchTeamOverview).mockReset().mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('private transport details'))
    expect(await updateEnforcementPolicyAction('org-test', 'apply')).toEqual({
      ok: false, refreshRequired: true, error: '保存结果暂时无法确认，请重新读取云端策略，避免重复应用。',
    })
    expect(saveEnforcementPolicy).toHaveBeenCalledTimes(1)
  })

  it('does not claim success if the read-back policy was changed concurrently', async () => {
    vi.mocked(fetchTeamOverview).mockReset().mockResolvedValue(snapshot())
    expect(await updateEnforcementPolicyAction('org-test', 'apply')).toMatchObject({ ok: false, refreshRequired: true })
  })

  it('rejects a different organization before writing', async () => {
    expect((await updateEnforcementPolicyAction('org-other', 'apply')).ok).toBe(false)
    expect(saveEnforcementPolicy).not.toHaveBeenCalled()
  })
})
