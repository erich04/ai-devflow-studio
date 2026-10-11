import { validModelBudgetContinuation } from './model-budget-continuation'
import { modelExecutionRollout, type ModelBudgetContinuation } from '@ai-devflow/shared'
import { verifiedModelCallBound, evaluateRuntimeBudgetGuard, projectedModelCallCost, settledModelCallCost, parseModelCallSettlement, isFinalModelCallSettlement, type ModelCallAttempt, type ModelCallQuote, type ModelCallSettlement, type ModelCallAdmission } from '@ai-devflow/shared'
import type { TeamRepository, TeamRepositorySyncContext } from './team-repository'

export async function admitModelCall(repo: Pick<TeamRepository,'getTeamOverview'|'getRuntimeBudgetPolicy'|'listRuntimeBudgetApprovals'>, requestedQuote: ModelCallQuote, context: TeamRepositorySyncContext, read: () => Promise<ModelCallAttempt | null>, write: (value: ModelCallAttempt) => Promise<void>, attempts: ModelCallAttempt[] = [], continuations: ModelBudgetContinuation[] = []): Promise<ModelCallAdmission> {
  // Admission belongs to the server's current billing period, never a client clock.
  const quote = { ...requestedQuote, createdAt: new Date().toISOString() }
  const duplicate=await read()
  if (duplicate) throw new Error('这次模型调用已登记，不能重复发送；请核对调用记录。')
  const [overview,policy,approvals]=await Promise.all([repo.getTeamOverview(context),repo.getRuntimeBudgetPolicy(quote.projectId,context),repo.listRuntimeBudgetApprovals({projectId:quote.projectId},context)])
  if (!overview.projects.some((project)=>project.id===quote.projectId)) throw new Error('Team project scope mismatch')
  const verifiedBound = verifiedModelCallBound(quote)
  const cost=verifiedBound?.costUsd ?? projectedModelCallCost(quote)
  const spend=(overview.budgetProjectCost ?? overview.projectCost).find((row)=>row.key===quote.projectId)
  const approval=approvals.find((row)=>row.id===quote.approvalId)
  const effectiveCosts = new Map(overview.modelCostRecovery?.find(row => row.projectId === quote.projectId)?.records
    .filter(row => row.sourceKind === 'model_call').map(row => [row.sourceId, row.costUsd]))
  const used=attempts.filter((row)=>row.approvalId===quote.approvalId && row.projectId===quote.projectId && row.userId===context.userId).reduce((sum,row)=>sum+(effectiveCosts.has(row.id) ? effectiveCosts.get(row.id) ?? Infinity : row.state==='reserved'?row.projectedCostUsd??Infinity:row.costUsd??Infinity),0)
  const remainingApproval=approval ? {...approval,maxAdditionalCostUsd:Math.max(0,approval.maxAdditionalCostUsd-used)} : null
  const decision=evaluateRuntimeBudgetGuard({projectId:quote.projectId,providerId:quote.providerId,policy,currentSpendUsd:spend?.costUsd??0,projectedCostUsd:cost??0,projectedCostKnown:cost!==null,requestedBy:context.userId,now:new Date().toISOString(),approval:remainingApproval})
  const pendingEnabled = modelExecutionRollout().pendingBudget
  const pendingCosts = overview.modelCostRecovery?.find(row => row.projectId === quote.projectId)?.records ?? []
  if (!pendingEnabled && policy?.enabled && (quote.continuationId || pendingCosts.some(row => row.affectsCurrentBudget && !row.isReservation && row.costUsd === null))) {
    return { accepted: false, decision: { ...decision, status: 'unavailable', blocksRun: true, reason: '费用待核对时继续执行已由部署配置暂停；请同步已有用量或核对费用。' } }
  }
  const continuation = continuations.find(card => card.id === quote.continuationId)
  const authorized = validModelBudgetContinuation(continuation, quote, context, policy, overview.modelCostRecovery?.find(row => row.projectId === quote.projectId)?.records ?? [], attempts, quote.createdAt, cost)
  if (quote.continuationId && !authorized) return { accepted: false, decision: { ...decision, status: 'requires_lead_approval', blocksRun: true, reason: '继续授权已失效或额度已用完，请重新查看确认卡。' } }
  if (!authorized && policy?.enabled && (spend?.unknownCostCount??0)>0) return {accepted:false,decision:{...decision,status:'unavailable',blocksRun:true,...(pendingEnabled ? { continuationEligible:true } : {}),reason:pendingEnabled ? '历史费用待确认，请查看当前操作的继续授权；原记录保持未知。' : '费用待核对时继续执行已由部署配置暂停；请同步已有用量或核对费用。'}}
  if (!authorized && decision.blocksRun) return {accepted:false,decision:{...decision,...(pendingEnabled && decision.status === 'requires_lead_approval' ? { continuationEligible:true } : {})}}
  await write({...quote,userId:context.userId,state:'reserved',projectedCostUsd:cost,costUsd:null,...(verifiedBound ? { verifiedBound } : {})})
  const { approvalRequiredRole: _requiredRole, ...continuedDecision } = decision
  return {accepted:true,decision: authorized ? { ...continuedDecision, status: 'approved_over_budget', approvalId: continuation!.id, blocksRun: false, reason: '按本次操作的已确认额度继续；历史费用仍待核对。' } : decision}
}
export async function finishModelCall(requestedSettlement: ModelCallSettlement, context: TeamRepositorySyncContext, read:()=>Promise<ModelCallAttempt|null>, write:(value:ModelCallAttempt)=>Promise<void>):Promise<void> {
  const settlement = parseModelCallSettlement(requestedSettlement)
  const previous=await read()
  if (!previous || previous.projectId!==settlement.projectId || previous.userId!==context.userId) throw new Error('Model call accounting scope mismatch')
  const { pendingSettlement: _pending, pendingSettlementFinal: _final, ...record } = previous
  const next={...record,remoteEnded: settlement.state === 'completed' || settlement.state === 'not_sent' || settlement.usage?.usageCompleteness === 'final',state:settlement.state,costUsd:settledModelCallCost(previous,settlement),...(settlement.usage?{usage:settlement.usage}:{})}
  if (previous.state!=='reserved') {
    const canonical=(value:unknown):string=>JSON.stringify(value && typeof value==='object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,v && typeof v==='object'?JSON.parse(canonical(v)):v])) : value)
    if (canonical(previous)!==canonical(next)) throw new Error('Model call settlement is immutable')
    return
  }
  await write(next)
}

/** Persist a received result before final settlement; no request/response bodies. */
export async function queueModelCallSettlement(
  input: ModelCallSettlement, context: TeamRepositorySyncContext,
  read: () => Promise<ModelCallAttempt | null>, write: (value: ModelCallAttempt) => Promise<void>,
  isFinal?: boolean,
): Promise<void> {
  const previous = await read()
  if (!previous || previous.projectId !== input.projectId || previous.userId !== context.userId) throw new Error('Model call accounting scope mismatch')
  // The reservation itself protects a crash before/while dispatching. Do not
  // publish its provisional unknown marker as a final result to other workers.
  if (isFinal === false) {
    if (input.usage && previous.state === 'reserved' && !previous.pendingSettlementFinal) {
      const observation = parseModelCallSettlement(input).usage!
      await write({ ...previous, usageObservation: { ...observation, usageCompleteness: 'partial' } })
    }
    return
  }
  if (isFinal !== true && input.state === 'failed' && !input.usage) return
  const settlement = parseModelCallSettlement(input)
  if (previous.state !== 'reserved') {
    await finishModelCall(settlement, context, async () => previous, async () => {})
    return
  }
  if (isFinalModelCallSettlement(previous.pendingSettlement, previous.pendingSettlementFinal) && JSON.stringify(parseModelCallSettlement(previous.pendingSettlement)) !== JSON.stringify(settlement)) throw new Error('Model call settlement is immutable')
  await write({ ...previous, pendingSettlement: settlement, pendingSettlementFinal: true })
}
