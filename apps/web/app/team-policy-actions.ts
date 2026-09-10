'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type { OrganizationEnforcementPolicy } from '@ai-devflow/shared'
import { DevFlowApiError, fetchAuthSession, fetchTeamOverview, saveEnforcementPolicy } from './lib/devflow-api'
import { policyContent, policyRevision, policyValidationError } from './team-policy-view'

export type TeamPolicyResult =
  | { ok: true; policy: OrganizationEnforcementPolicy; source: 'default' | 'persisted' | undefined }
  | { ok: false; error: string; refreshRequired?: boolean }

function failure(error: unknown, writeAttempted: boolean): TeamPolicyResult {
  if (error instanceof DevFlowApiError) {
    if (error.status === 401) return { ok: false, error: '登录已过期，请重新登录。' }
    if (error.status === 403) return { ok: false, error: '只有组织 Owner 可以保存 Team Policy。' }
    if (error.status === 409) return { ok: false, refreshRequired: true, error: '云端策略已更新，请重新读取并预览变更。' }
    if (error.status === 400) return { ok: false, error: '策略未通过服务端校验，请检查规则后重试。' }
  }
  return { ok: false, refreshRequired: true, error: writeAttempted ? '保存结果暂时无法确认，请重新读取云端策略后核对。' : '暂时无法读取云端策略，请重试。' }
}

export async function readTeamPolicyAction(organizationId: string): Promise<TeamPolicyResult> {
  try {
    const cookie = (await cookies()).get('devflow_session')?.value
    if (!cookie) return { ok: false, error: '请先登录。' }
    const state = (await fetchTeamOverview({ cookieHeader: `devflow_session=${cookie}` })).enforcementPolicies
    if (state.organizationPolicy.organizationId !== organizationId) return { ok: false, error: '当前组织已改变，请重新打开设置。' }
    return { ok: true, policy: state.organizationPolicy, source: state.organizationPolicySource }
  } catch (error) { return failure(error, false) }
}

export async function saveTeamPolicyAction(input: { policy: OrganizationEnforcementPolicy; expectedRevision: string }): Promise<TeamPolicyResult> {
  let writeAttempted = false
  try {
    const cookie = (await cookies()).get('devflow_session')?.value
    if (!cookie) return { ok: false, error: '请先登录。' }
    const auth = { cookieHeader: `devflow_session=${cookie}` }
    if ((await fetchAuthSession(auth)).user.role !== 'owner') return { ok: false, error: '只有组织 Owner 可以保存 Team Policy。' }
    const before = (await fetchTeamOverview(auth)).enforcementPolicies
    if (before.organizationPolicy.organizationId !== input.policy.organizationId || policyRevision(before.organizationPolicy) !== input.expectedRevision) {
      return { ok: false, refreshRequired: true, error: '云端策略已更新，请重新读取并预览变更。' }
    }
    const validation = policyValidationError(input.policy)
    if (validation) return { ok: false, error: validation }
    const updatedAt = new Date().toISOString()
    const policy = { ...input.policy, id: before.organizationPolicy.id, version: before.organizationPolicy.version + 1, updatedAt,
      rules: input.policy.rules.map((rule) => ({ ...rule, updatedAt })) }
    writeAttempted = true
    await saveEnforcementPolicy({ ...auth, policy, expectedPolicy: { id: before.organizationPolicy.id, version: before.organizationPolicy.version, updatedAt: before.organizationPolicy.updatedAt } })
    revalidatePath('/')
    const after = (await fetchTeamOverview(auth)).enforcementPolicies
    if (after.organizationPolicy.organizationId !== policy.organizationId || policyContent(after.organizationPolicy) !== policyContent(policy)) {
      return { ok: false, refreshRequired: true, error: '云端当前策略与提交内容不同，请重新读取后核对。' }
    }
    return { ok: true, policy: after.organizationPolicy, source: after.organizationPolicySource }
  } catch (error) { return failure(error, writeAttempted) }
}
