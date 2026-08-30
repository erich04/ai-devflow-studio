'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import type { RuntimeBudgetPolicy } from '@ai-devflow/shared'
import {
  createRuntimeBudgetApproval,
  saveRuntimeBudgetPolicy,
} from '../lib/devflow-api'

export type RuntimeBudgetPolicySaveResult =
  | { ok: true; policy: RuntimeBudgetPolicy }
  | { ok: false; error: string }

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
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
    return { ok: false, error: '请填写有效的预算策略。' }
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
    revalidatePath('/legacy-shell')
    return { ok: true, policy }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '预算策略保存失败，请重试。',
    }
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
