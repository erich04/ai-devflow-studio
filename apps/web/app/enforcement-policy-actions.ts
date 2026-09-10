'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createRecommendedEnforcementPreset, type OrganizationEnforcementPolicy } from '@ai-devflow/shared'
import { DevFlowApiError, fetchTeamOverview, saveEnforcementPolicy } from './lib/devflow-api'
import { isRecommendedPolicy } from './enforcement-policy-view'

export type EnforcementPolicyResult =
  | { ok: true; policy: OrganizationEnforcementPolicy }
  | { ok: false; error: string; refreshRequired?: boolean }

export async function updateEnforcementPolicyAction(
  organizationId: string,
  operation: 'apply' | 'refresh',
): Promise<EnforcementPolicyResult> {
  if (!organizationId.trim() || !['apply', 'refresh'].includes(operation)) {
    return { ok: false, error: '策略请求无效，请重新打开当前项目。' }
  }
  let writeAttempted = false
  try {
    const sessionCookie = (await cookies()).get('devflow_session')?.value
    if (!sessionCookie) return { ok: false, error: '请先登录，再应用组织策略。' }
    const auth = { cookieHeader: `devflow_session=${sessionCookie}` }
    const before = (await fetchTeamOverview(auth)).enforcementPolicies.organizationPolicy
    if (before.organizationId !== organizationId) {
      return { ok: false, error: '当前组织已改变，请重新打开当前项目。' }
    }
    if (operation === 'apply' && !isRecommendedPolicy(before)) {
      writeAttempted = true
      await saveEnforcementPolicy({
        ...auth,
        policy: createRecommendedEnforcementPreset({ organizationId, updatedAt: new Date().toISOString() }),
      })
    }
    // Both shells receive the same authoritative snapshot, including other policy consumers.
    revalidatePath('/')
    revalidatePath('/legacy-shell')
    const policy = writeAttempted
      ? (await fetchTeamOverview(auth)).enforcementPolicies.organizationPolicy
      : before
    if (policy.organizationId !== organizationId) throw new Error('Policy organization changed')
    if (operation === 'apply' && !isRecommendedPolicy(policy)) {
      return { ok: false, refreshRequired: true, error: '云端当前策略与推荐策略不同，可能已被其他成员更新。请重新读取后核对。' }
    }
    return { ok: true, policy }
  } catch (error) {
    if (error instanceof DevFlowApiError && error.status === 403) {
      return { ok: false, error: '只有组织 Owner 可以应用推荐策略。' }
    }
    if (error instanceof DevFlowApiError && error.status === 401) {
      return { ok: false, error: '登录已过期，请重新登录后重试。' }
    }
    return {
      ok: false,
      refreshRequired: true,
      error: writeAttempted
        ? '保存结果暂时无法确认，请重新读取云端策略，避免重复应用。'
        : '暂时无法读取云端策略，请重试。',
    }
  }
}
