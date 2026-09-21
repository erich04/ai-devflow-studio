import type { AgentProviderUsage } from '@ai-devflow/shared'

// Local-only records. Never add these to LocalExecutionState or team projections.
export type ConversationTarget = { runId: string; nodeId: string }
export type ConversationAction = ConversationTarget & {
  label: string
  section: '状态' | '产物' | '测试证据' | '轨迹' | 'Gate影响' | 'Gate条件' | '引用来源' | 'Remediation' | 'Handoff' | 'Final Gate'
}
export type ConversationCitation = {
  id: string
  label: string
  excerpt: string
  observedAt: string
}
export type ConversationDraft = ConversationTarget & {
  title: string
  content: string
  publishedArtifactId?: string
}
export type ConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'notice'
  text: string
  /** Missing on legacy messages; unsupported formats retain their complete text. */
  format?: 'markdown' | 'plain_text' | 'unsupported'
  createdAt: string
  actions?: ConversationAction[]
  citations?: ConversationCitation[]
  question?: { prompt: string; options: string[]; purpose?: 'clarification' | 'save_proposal'; answeredAt?: string; resolvedBy?: 'proposal_saved' }
  draft?: ConversationDraft
  usage?: AgentProviderUsage
  provider?: { id: string; model: string; effectiveThinking?: import('@ai-devflow/shared').EffectiveProviderThinking }
  /** Provider-returned reasoning, local to this conversation; never shared workflow context. */
  reasoning?: { text: string; status: 'streaming' | 'completed' | 'interrupted'; effort: 'low' | 'high' | 'max' }
}
export type WorkbenchConversation = {
  id: string
  localProjectId: string
  version: number
  title: string
  isOpen: boolean
  inputDraft: string
  /** Archived legacy note; never added to prompts or editable through commands. */
  memory?: string
  status: 'idle' | 'running' | 'awaiting_answer' | 'failed' | 'cancelled' | 'interrupted'
  messages: ConversationMessage[]
  createdAt: string
  updatedAt: string
  error?: string
  failure?: { phase: string; code: string; httpStatus?: number }
  contextReceipt?: { includedMessages: number; omittedMessages: number; limited?: boolean; observedAt: string }
}
export type ConversationCommand = { projectId: string } & (
  | { type: 'list' }
  | { type: 'create'; title?: string; inputDraft?: string }
  | { type: 'update'; conversationId: string; title?: string; isOpen?: boolean; inputDraft?: string }
  | { type: 'send'; conversationId: string; text: string; providerId: string; answerToMessageId?: string }
  | { type: 'retry'; conversationId: string; providerId: string }
  | { type: 'cancel'; conversationId: string }
  | { type: 'publish'; conversationId: string; messageId: string }
)
export type ConversationResponse = {
  conversations: WorkbenchConversation[]
  conversationId?: string
  error?: string
  failure?: { phase: string; code: string; httpStatus?: number }
}
export type WorkbenchConversationApi = (command: ConversationCommand) => Promise<ConversationResponse>

const limits = { projectId: 240, conversationId: 240, messageId: 240, answerToMessageId: 240, providerId: 240, title: 100, text: 12000, inputDraft: 12000 }
export function parseConversationCommand(value: unknown): ConversationCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的会话请求。')
  const record = value as Record<string, unknown>
  const fields: Record<string, string[]> = {
    list: [], create: ['title', 'inputDraft'], update: ['conversationId', 'title', 'isOpen', 'inputDraft'],
    send: ['conversationId', 'text', 'providerId', 'answerToMessageId'], retry: ['conversationId', 'providerId'],
    cancel: ['conversationId'], publish: ['conversationId', 'messageId'],
  }
  const type = typeof record.type === 'string' ? record.type : ''
  const allowed = Object.hasOwn(fields, type) ? fields[type]! : undefined
  if (!allowed || Object.keys(record).some((key) => !['type', 'projectId', ...allowed].includes(key))) throw new Error('无效的会话操作。')
  for (const [key, limit] of Object.entries(limits)) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || (record[key] as string).length > limit || (record[key] as string).includes('\0'))) throw new Error('会话输入过长或格式不正确。')
  }
  if (record.isOpen !== undefined && typeof record.isOpen !== 'boolean') throw new Error('无效的 Tab 状态。')
  const required = ['projectId', ...(['list', 'create'].includes(type) ? [] : ['conversationId']), ...(['send', 'retry'].includes(type) ? ['providerId'] : []), ...(type === 'send' ? ['text'] : []), ...(type === 'publish' ? ['messageId'] : [])]
  if (required.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())) throw new Error('会话请求缺少必要信息。')
  if (record.title !== undefined && !(record.title as string).trim()) throw new Error('请输入会话名称。')
  return record as ConversationCommand
}
