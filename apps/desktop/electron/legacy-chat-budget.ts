import {createHash} from 'node:crypto'
import {reviewProviderCapabilities,type AgentProviderConfig,type HistoricalModelCall} from '@ai-devflow/shared'
import type {WorkbenchConversation} from './workbench-conversation-contract'

/** Upload only previously recorded financial metadata; private chat bodies never leave Desktop. */
export function legacyChatBudget(conversations:WorkbenchConversation[],providers:AgentProviderConfig[]):HistoricalModelCall[] {
  return conversations.flatMap((conversation)=>conversation.messages.flatMap((message)=>{
    if(!message.usage || message.usage.budgetAttemptIds?.length || !message.provider || message.provider.id.startsWith('fake'))return []
    const configured=providers.find((p)=>p.id===message.provider!.id && p.model===message.provider!.model)
    const billingProvider=configured?reviewProviderCapabilities(configured).billingProvider??'openai_compatible':'openai_compatible'
    const id='legacy-chat-'+createHash('sha256').update(conversation.id+'\0'+message.id).digest('hex')
    const quote={id,projectId:conversation.localProjectId,providerId:message.provider.id,model:message.provider.model,createdAt:message.createdAt,inputTokens:message.usage.inputTokens??0,maxOutputTokens:message.usage.outputTokens?Math.max(1,message.usage.outputTokens):null,billingProvider}
    return [{quote,settlement:{id,projectId:conversation.localProjectId,state:'completed' as const,usage:message.usage}}]
  }))
}
