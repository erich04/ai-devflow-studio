'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import type { RuntimeBudgetPolicy } from '@ai-devflow/shared'
import {
  createRuntimeBudgetApproval,
  saveRuntimeBudgetPolicy,
} from './lib/devflow-api'

export type RuntimeBudgetPolicySaveResult =
  | { ok: true; policy: RuntimeBudgetPolicy }
  | { ok: false; error: string }

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

/**
 * The API client reports failures as English transport text (“DevFlow API … failed with 403”).
 * Only its HTTP status is used here, so the page shows Chinese feedback without the endpoint.
 */
function saveFailureMessage(error: unknown): string {
  const status = error instanceof Error ? /failed with (\d{3})$/u.exec(error.message)?.[1] : undefined
  if (status === '401') return '登录已过期，请重新登录后再保存预算规则。'
  if (status === '403') return '当前身份没有修改这个项目预算规则的权限。'
  if (status === '400') return '预算规则未通过服务端校验，请检查金额后重试。'
  return '预算规则保存失败，请重试。'
}

export async function saveRuntimeBudgetPolicyAction(
  formData: FormData,
): Promise<RuntimeBudgetPolicySaveResult> {
  const projectId = String(formData.get('projectId') ?? '').trim()
  const monthlyLimitValue = String(formData.get('monthlyLimitUsd') ?? '').trim()
  const warningThresholdValue = String(formData.get('warningThresholdUsd') ?? '').trim()
  const monthlyLimitUsd = monthlyLimitValue ? Number(monthlyLimitValue) : Number.NaN
  const warningThresholdUsd = warningThresholdValue ? Number(warningThresholdValue) : Number.NaN
  const enabled = formData.get('enabled') === 'on'

  if (!projectId || !Number.isFinite(monthlyLimitUsd) || !Number.isFinite(warningThresholdUsd)) {
    return { ok: false, error: '请填写有效的预算规则。' }
  }

  try {
    const cookieHeader = await getDevFlowCookieHeader()
    const policy = await saveRuntimeBudgetPolicy({
      projectId,
      enabled,
      monthlyLimitUsd,
      warningThresholdUsd,
      ...(cookieHeader ? { cookieHeader } : {}),
    })
    revalidatePath('/')
    return { ok: true, policy }
  } catch (error) {
    return { ok: false, error: saveFailureMessage(error) }
  }
}

export async function createRuntimeBudgetApprovalAction(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '').trim()
  const requestedBy = String(formData.get('requestedBy') ?? '').trim()
  const providerId = String(formData.get('providerId') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()
  const maxAdditionalCostUsd = Number(formData.get('maxAdditionalCostUsd') ?? 0)
  const expiresAt =
    String(formData.get('expiresAt') ?? '').trim() ||
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  if (!projectId || !requestedBy || !providerId || !reason || !Number.isFinite(maxAdditionalCostUsd)) {
    return
  }

  const cookieHeader = await getDevFlowCookieHeader()
  await createRuntimeBudgetApproval({
    projectId,
    requestedBy,
    providerId,
    maxAdditionalCostUsd,
    reason,
    expiresAt,
    ...(cookieHeader ? { cookieHeader } : {}),
  })
}
