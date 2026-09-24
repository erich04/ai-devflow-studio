const randomUUID = () => globalThis.crypto.randomUUID()
import { AgentProviderRequestError, reviewProviderCapabilities, type AgentProvider } from './agent-review'
import type {AgentProviderUsage} from './domain'
import type {ModelCallQuote,ModelCallSettlement,ModelCallAdmission} from './model-call-budget'

export type ModelCallGovernance = {
  reserve(input:ModelCallQuote):Promise<ModelCallAdmission>
  settle(input:ModelCallSettlement):Promise<void>
  persist(input:ModelCallSettlement):Promise<void>
  pending(projectId:string):Promise<ModelCallSettlement[]>
}
const activeAttempts=new Set<string>()
export type CallResult = {usage?:AgentProviderUsage}
/** One admission for each actual request, including tool rounds, validation and retries. */
export async function governedModelCall<T extends CallResult>(input:{
  governance:ModelCallGovernance; projectId:string; provider:Pick<AgentProvider,'id'|'model'|'billingProvider'|'defaultReviewOutputTokens'>
  prompt:string; maxOutputTokens?:number; signal?:AbortSignal; action:()=>Promise<T>; approvalId?:string
}):Promise<T> {
  const {governance:g,provider:p}=input
  input.signal?.throwIfAborted()
  // Reconciliation contains financial metadata only. A failed upload blocks a new charge.
  for (const settlement of await g.pending(input.projectId)) if (!activeAttempts.has(settlement.id)) await g.settle(settlement)
  input.signal?.throwIfAborted()
  const id=`model-call-${randomUUID()}`
  const quote:ModelCallQuote={id,projectId:input.projectId,providerId:p.id,model:p.model,createdAt:new Date().toISOString(),
    inputTokens:new TextEncoder().encode(input.prompt).length+1024,maxOutputTokens:input.maxOutputTokens??p.defaultReviewOutputTokens??null,
    billingProvider:p.billingProvider??'openai_compatible',...(input.approvalId?{approvalId:input.approvalId}:{})}
  const admission=await g.reserve(quote)
  if (!admission.accepted || admission.decision.blocksRun) {
    const error=new AgentProviderRequestError({code:'unknown_provider_failure',sanitizedCause:'budget_not_ready',deliveryState:'not_sent',billingState:'not_incurred',retryable:false})
    error.message=`尚未调用模型：${admission.decision.reason}`
    throw error
  }
  let settlement:ModelCallSettlement={id,projectId:input.projectId,state:'failed'}
  activeAttempts.add(id)
  try { await g.persist(settlement) } catch (error) {
    activeAttempts.delete(id)
    // Nothing has been dispatched. Release the reservation even if local persistence failed.
    await g.settle({ ...settlement, state: 'not_sent' }).catch(() => undefined)
    throw new AgentProviderRequestError({ code: 'unknown_provider_failure',
      sanitizedCause: 'accounting_unavailable', deliveryState: 'not_sent',
      billingState: 'not_incurred', retryable: true, usage: { budgetAttemptIds: [id] }, cause: error })
  } // Crash recovery stays unknown once dispatch begins.
  let sent=false
  try {
    input.signal?.throwIfAborted()
    sent=true
    const result=await input.action()
    settlement={...settlement,state:'completed',...(result.usage?{usage:result.usage}:{})}
    return {...result,usage:{...result.usage,budgetAttemptIds:[id]}}
  } catch(error) {
    const e=error instanceof AgentProviderRequestError ? error : null
    settlement={...settlement,state:!sent || e?.billingState==='not_incurred'?'not_sent':input.signal?.aborted?'cancelled':'failed',...(e?.usage?{usage:e.usage}:{})}
    if (e) throw new AgentProviderRequestError({...e,usage:{...e.usage,budgetAttemptIds:[id]},cause:e})
    throw new AgentProviderRequestError({
      code: input.signal?.aborted ? 'cancelled_by_user' : 'unknown_provider_failure',
      sanitizedCause: input.signal?.aborted ? 'cancelled_by_user' : 'provider_dispatch_failed',
      deliveryState: sent ? 'possibly_delivered' : 'not_sent',
      billingState: sent ? 'unknown' : 'not_incurred', retryable: !input.signal?.aborted,
      usage: { budgetAttemptIds: [id] }, cause: error,
    })
  } finally {
    try { await g.persist(settlement); await g.settle(settlement) }
    catch (error) {
      throw new AgentProviderRequestError({ code: 'unknown_provider_failure',
        sanitizedCause: 'settlement_sync_failed', deliveryState: sent ? 'possibly_delivered' : 'not_sent',
        billingState: settlement.usage ? 'confirmed' : sent ? 'unknown' : 'not_incurred', retryable: true,
        usage: { ...settlement.usage, budgetAttemptIds: [id] }, cause: error })
    } finally { activeAttempts.delete(id) }
  }
}
export function governAgentProvider(provider:AgentProvider,projectId:string,governance:ModelCallGovernance, approvalId?:string):AgentProvider {
  const base={provider,projectId,governance,...(approvalId?{approvalId}:{})}
  return {...provider,
    reviewKnowledge:(input)=>governedModelCall({...base,prompt:input.prompt,...(provider.reviewOutputLimit?{maxOutputTokens:provider.reviewOutputLimit}:{}),...(input.signal?{signal:input.signal}:{}),action:()=>provider.reviewKnowledge(input)}),
    ...(provider.generateWorkflowArtifact?{generateWorkflowArtifact:(input:Parameters<NonNullable<AgentProvider['generateWorkflowArtifact']>>[0])=>governedModelCall({...base,prompt:input.prompt,...(input.signal?{signal:input.signal}:{}),action:()=>provider.generateWorkflowArtifact!(input)})}:{}),
    ...(provider.completeStructuredJson?{completeStructuredJson:(input:Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0])=>governedModelCall({...base,prompt:input.systemPrompt+'\n'+input.userPrompt,...(input.maxOutputTokens?{maxOutputTokens:input.maxOutputTokens}:{}),...(input.signal?{signal:input.signal}:{}),action:()=>provider.completeStructuredJson!(input)})}:{})}
}
export function modelCallMetadata(binding:{providerId:string;modelId:string;baseUrl:string}) {
  return {id:binding.providerId,model:binding.modelId,...reviewProviderCapabilities({id:binding.providerId,model:binding.modelId,baseUrl:binding.baseUrl})}
}
