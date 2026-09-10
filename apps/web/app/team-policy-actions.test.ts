import { beforeEach, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import { createRecommendedEnforcementPreset, createWarnOnlyDefaultPolicy } from '@ai-devflow/shared'
import { DevFlowApiError, fetchAuthSession, fetchTeamOverview, saveEnforcementPolicy } from './lib/devflow-api'
import { readTeamPolicyAction, saveTeamPolicyAction } from './team-policy-actions'
import { policyRevision } from './team-policy-view'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./lib/devflow-api', async (original) => ({ ...await original<typeof import('./lib/devflow-api')>(), fetchAuthSession: vi.fn(), fetchTeamOverview: vi.fn(), saveEnforcementPolicy: vi.fn() }))
const before = createWarnOnlyDefaultPolicy({ organizationId: 'org-test' })
const draft = createRecommendedEnforcementPreset({ organizationId: 'org-test' })
const saved = { ...draft, id: before.id, version: 2 }
const input = { policy: draft, expectedRevision: policyRevision(before) }
function snapshot(policy = before, source: 'default' | 'persisted' = 'default') {
  return { enforcementPolicies: { organizationPolicy: policy, organizationPolicySource: source } } as Awaited<ReturnType<typeof fetchTeamOverview>>
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'test-session' }) } as never)
  vi.mocked(fetchAuthSession).mockResolvedValue({ user: { role: 'owner' } } as never)
  vi.mocked(fetchTeamOverview).mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot(saved, 'persisted'))
})

it('saves a new version under the existing policy identity and returns the authoritative read-back', async () => {
  vi.mocked(saveEnforcementPolicy).mockResolvedValue({ ...saved, version: 999 })
  expect(await saveTeamPolicyAction(input)).toEqual({ ok: true, policy: saved, source: 'persisted' })
  expect(saveEnforcementPolicy).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ id: before.id, version: 2, name: draft.name }) }))
})
it.each(['lead', 'member'])('rejects %s before writing', async (role) => {
  vi.mocked(fetchAuthSession).mockResolvedValue({ user: { role } } as never)
  expect(await saveTeamPolicyAction(input)).toMatchObject({ ok: false, error: expect.stringContaining('Owner') })
  expect(saveEnforcementPolicy).not.toHaveBeenCalled()
})
it('refuses a preview of a stale policy', async () => {
  vi.mocked(fetchTeamOverview).mockReset().mockResolvedValue(snapshot(saved, 'persisted'))
  expect(await saveTeamPolicyAction(input)).toMatchObject({ ok: false, refreshRequired: true })
  expect(saveEnforcementPolicy).not.toHaveBeenCalled()
})
it('retains the uncertain result when a successful write cannot be read back', async () => {
  vi.mocked(fetchTeamOverview).mockReset().mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('private detail'))
  expect(await saveTeamPolicyAction(input)).toEqual({ ok: false, refreshRequired: true, error: '保存结果暂时无法确认，请重新读取云端策略后核对。' })
  expect(saveEnforcementPolicy).toHaveBeenCalledOnce()
})
it('does not claim success when a different policy is read after saving', async () => {
  vi.mocked(fetchTeamOverview).mockReset().mockResolvedValue(snapshot())
  expect(await saveTeamPolicyAction(input)).toMatchObject({ ok: false, refreshRequired: true })
})
it('reads persisted defaults without guessing the source from the policy ID', async () => {
  vi.mocked(fetchTeamOverview).mockReset().mockResolvedValue(snapshot(before, 'persisted'))
  expect(await readTeamPolicyAction('org-test')).toMatchObject({ ok: true, source: 'persisted' })
  expect(saveEnforcementPolicy).not.toHaveBeenCalled()
})
it.each([401, 403, 400])('handles HTTP %s without exposing transport details', async (status) => {
  vi.mocked(saveEnforcementPolicy).mockRejectedValue(new DevFlowApiError('/api/enforcement/policy', status))
  expect(await saveTeamPolicyAction(input)).toMatchObject({ ok: false })
})
it('validates hard-block semantics before contacting the write API', async () => {
  const policy = { ...draft, rules: draft.rules.map((rule) => ({ ...rule, overridable: false })) }
  expect(await saveTeamPolicyAction({ ...input, policy })).toMatchObject({ ok: false })
  expect(saveEnforcementPolicy).not.toHaveBeenCalled()
})
