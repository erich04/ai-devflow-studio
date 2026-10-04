'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { parseModelCostReconciliation, type ModelCostReconciliationInput, type ModelCostRecoveryOverview } from '@ai-devflow/shared'
import { DevFlowApiError, modelCostRecoveryRequest } from './lib/devflow-api'
import type { ModelCostRecoveryResult } from './ModelCostRecoveryPanel'

async function options() {
  const cookie = (await cookies()).get('devflow_session')?.value
  return cookie ? { cookieHeader: `devflow_session=${cookie}` } : {}
}
function failure(error: unknown): ModelCostRecoveryResult {
  const status = error instanceof DevFlowApiError ? error.status : undefined
  return { ok: false, error: status === 409 ? '费用记录已更新，请刷新后重新核对。' : status === 403 ? '当前身份没有这个项目的费用操作权限。'
    : status === 401 ? '登录已过期，请重新登录。' : status === 400 ? '核对未通过校验。请检查金额、完整用量、执行状态及非敏感依据；运行中的调用不能结清。'
      : '费用操作未完成，已保留原记录，请重试。' }
}
export async function readModelCostRecoveryAction(projectId: string): Promise<ModelCostRecoveryResult> {
  try { return { ok: true, overview: await modelCostRecoveryRequest<ModelCostRecoveryOverview>(`/api/runtime/model-costs?projectId=${encodeURIComponent(projectId)}`, await options()) } }
  catch (error) { return failure(error) }
}
export async function retryModelCostSettlementsAction(projectId: string): Promise<ModelCostRecoveryResult> {
  try {
    await modelCostRecoveryRequest('/api/runtime/model-costs/retry', await options(), { projectId })
    revalidatePath('/')
    return readModelCostRecoveryAction(projectId)
  } catch (error) { return failure(error) }
}
export async function reconcileModelCostAction(input: ModelCostReconciliationInput): Promise<ModelCostRecoveryResult> {
  let command: ModelCostReconciliationInput
  try { command = parseModelCostReconciliation(input) }
  catch { return { ok: false, error: '请填写有效金额或完整用量，以及执行状态、核对原因和非敏感依据。' } }
  try {
    await modelCostRecoveryRequest('/api/runtime/model-costs/reconcile', await options(), command)
    revalidatePath('/')
    return readModelCostRecoveryAction(command.projectId)
  } catch (error) { return failure(error) }
}
