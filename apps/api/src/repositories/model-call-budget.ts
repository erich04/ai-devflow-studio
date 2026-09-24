import { evaluateRuntimeBudgetGuard, projectedModelCallCost, settledModelCallCost, parseModelCallSettlement, type ModelCallAttempt, type ModelCallQuote, type ModelCallSettlement, type ModelCallAdmission } from '@ai-devflow/shared'
import type { TeamRepository, TeamRepositorySyncContext } from './team-repository'

export async function admitModelCall(repo: Pick<TeamRepository,'getTeamOverview'|'getRuntimeBudgetPolicy'|'listRuntimeBudgetApprovals'>, requestedQuote: ModelCallQuote, context: TeamRepositorySyncContext, read: () => Promise<ModelCallAttempt | null>, write: (value: ModelCallAttempt) => Promise<void>, attempts: ModelCallAttempt[] = []): Promise<ModelCallAdmission> {
  // Admission belongs to the server's current billing period, never a client clock.
  const quote = { ...requestedQuote, createdAt: new Date().toISOString() }
  const duplicate=await read()
  if (duplicate) throw new Error('这次模型调用已登记，不能重复发送；请核对调用记录。')
  const [overview,policy,approvals]=await Promise.all([repo.getTeamOverview(context),repo.getRuntimeBudgetPolicy(quote.projectId,context),repo.listRuntimeBudgetApprovals({projectId:quote.projectId},context)])
  if (!overview.projects.some((project)=>project.id===quote.projectId)) throw new Error('Team project scope mismatch')
  const cost=projectedModelCallCost(quote)
  const spend=(overview.budgetProjectCost ?? overview.projectCost).find((row)=>row.key===quote.projectId)
  const approval=approvals.find((row)=>row.id===quote.approvalId)
  const used=attempts.filter((row)=>row.approvalId===quote.approvalId && row.projectId===quote.projectId && row.userId===context.userId).reduce((sum,row)=>sum+(row.state==='reserved'?row.projectedCostUsd??Infinity:row.costUsd??Infinity),0)
  const remainingApproval=approval ? {...approval,maxAdditionalCostUsd:Math.max(0,approval.maxAdditionalCostUsd-used)} : null
  const decision=evaluateRuntimeBudgetGuard({projectId:quote.projectId,providerId:quote.providerId,policy,currentSpendUsd:spend?.costUsd??0,projectedCostUsd:cost??0,projectedCostKnown:cost!==null,requestedBy:context.userId,now:new Date().toISOString(),approval:remainingApproval})
  if (policy?.enabled && (spend?.unknownCostCount??0)>0) return {accepted:false,decision:{...decision,status:'unavailable',blocksRun:true,reason:'有模型调用的实际费用尚未确认，请核对用量后再继续；不会将未知费用按零处理。'}}
  if (decision.blocksRun) return {accepted:false,decision}
  await write({...quote,userId:context.userId,state:'reserved',projectedCostUsd:cost,costUsd:null})
  return {accepted:true,decision}
}
export async function finishModelCall(requestedSettlement: ModelCallSettlement, context: TeamRepositorySyncContext, read:()=>Promise<ModelCallAttempt|null>, write:(value:ModelCallAttempt)=>Promise<void>):Promise<void> {
  const settlement = parseModelCallSettlement(requestedSettlement)
  const previous=await read()
  if (!previous || previous.projectId!==settlement.projectId || previous.userId!==context.userId) throw new Error('Model call accounting scope mismatch')
  const { pendingSettlement: _pending, ...record } = previous
  const next={...record,state:settlement.state,costUsd:settledModelCallCost(previous,settlement),...(settlement.usage?{usage:settlement.usage}:{})}
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
): Promise<void> {
  const previous = await read()
  if (!previous || previous.projectId !== input.projectId || previous.userId !== context.userId) throw new Error('Model call accounting scope mismatch')
  // The reservation itself protects a crash before/while dispatching. Do not
  // publish its provisional unknown marker as a final result to other workers.
  if (input.state === 'failed' && !input.usage) return
  const settlement = parseModelCallSettlement(input)
  if (previous.state !== 'reserved') {
    await finishModelCall(settlement, context, async () => previous, async () => {})
    return
  }
  if (previous.pendingSettlement && JSON.stringify(parseModelCallSettlement(previous.pendingSettlement)) !== JSON.stringify(settlement)) throw new Error('Model call settlement is immutable')
  await write({ ...previous, pendingSettlement: settlement })
}
