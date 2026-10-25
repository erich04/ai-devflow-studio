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
  inputReceipt?: import('./conversation-critical-context').CriticalContextReceipt
  publishedArtifactId?: string
  requestedByMessageId?: string
  /** Native candidates exist before their independent semantic check completes. */
  review?: {
    status: 'pending' | 'running' | 'passed' | 'needs_revision' | 'unavailable' | 'stale'
    findings?: Array<{ criterionId: string; status: 'covered' | 'missing' | 'contradiction'; reason: string }>
    error?: string
    checkedAt?: string
    humanAcknowledgedAt?: string
  }
}
export type ConversationFailure = { phase: string; code: string; httpStatus?: number; reason?: string } & Partial<import('@ai-devflow/shared').AgentProviderResponseMetadata>
export type ConversationCheckpoint = {
  version: 1
  turnId: string
  step: number
  cycle: number
  recoveries: number
  group: string
  providerId: string
  maxOutputTokens?: number
  nativeMessages?: import('@ai-devflow/shared').NativeToolMessage[]
  nativePendingCalls?: import('@ai-devflow/shared').NativeToolCall[] | undefined
  observations: unknown[]
  citations: ConversationCitation[]
  requirementRunIds: string[]
  criticalProposalInput?: import('./conversation-critical-context').CriticalContext | undefined
  pendingProposal?: Record<string, unknown> | undefined
  nativeReviewMessageId?: string | undefined
}
/** Local audit of the host request, not proof of a model adopting a Memory or of harness internals. */
export type ConversationMemoryReceipt = {
  version: 1
  callId: string
  executor: 'direct-provider' | 'opencode' | 'native-tools'
  boundary: 'host_request'
  state: 'prepared' | 'dispatch_started' | 'response_received' | 'not_sent' | 'delivery_unknown'
  /** SHA-256 of JSON.stringify({ systemPrompt, userPrompt }) as dispatched by the host. */
  promptDigest: string
  memories: Array<{ id: string; revision: number; headVersion: number; contentDigest: string }>
  omittedMemoryCount: number
  observedAt: string
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
  toolRequestId?: string
  question?: { prompt: string; options: string[]; purpose?: 'clarification' | 'save_proposal'; answeredAt?: string; resolvedBy?: 'proposal_saved' }
  draft?: ConversationDraft
  usage?: AgentProviderUsage
  /** Bounded, non-content diagnostic for this call, including a recovered failure. */
  failure?: ConversationFailure
  /** Recorded on the existing per-call notice, including failed and retried calls. */
  memoryReceipt?: ConversationMemoryReceipt
  attempt?: { turnId: string; step: number; cycle: number; recovery: number; group: string; startedAt: string; durationMs?: number; status: 'running' | 'completed' | 'failed' }
  provider?: { id: string; model: string; executor?: 'direct-provider' | 'opencode' | 'native-tools'; effectiveThinking?: import('@ai-devflow/shared').EffectiveProviderThinking }
  contentLengths?: Partial<Record<'text' | 'draft' | 'reasoning', number>>
  responseMetadata?: import('@ai-devflow/shared').AgentProviderResponseMetadata
  /** Provider-returned reasoning, local to this conversation; never shared workflow context. */
  reasoning?: { text: string; status: 'streaming' | 'completed' | 'interrupted'; effort?: 'low' | 'high' | 'max' }
}
export type WorkbenchConversation = {
  id: string
  localProjectId: string
  /** Immutable per conversation. Legacy records use direct-provider. */
  executor?: 'direct-provider' | 'opencode' | 'native-tools'
  version: number
  title: string
  isOpen: boolean
  inputDraft: string
  /** Archived legacy note; never added to prompts or editable through commands. */
  memory?: string
  status: 'idle' | 'running' | 'awaiting_answer' | 'failed' | 'cancelled' | 'interrupted' | 'paused'
  checkpoint?: ConversationCheckpoint | undefined
  /** Main-only provider protocol. Never project raw protocol/hidden reasoning to IPC or team data. */
  nativeTranscript?: Array<{ turnId: string; message: import('@ai-devflow/shared').NativeToolMessage }>
  nativeProtocolVersion?: 2
  /** New Direct Provider sessions bind a protocol once, after the first model is selected. */
  nativeProtocolSelection?: 'pending' | 'selected'
  nativeContextStart?: number
  messages: ConversationMessage[]
  /** Main-owned local facts and derived context; absent on legacy conversations. */
  toolEvents?: import('./conversation-context.js').ConversationToolEvent[]
  compactions?: import('./conversation-context.js').ConversationCompaction[]
  createdAt: string
  updatedAt: string
  error?: string
  failure?: ConversationFailure
  contextReceipt?: { includedMessages: number; omittedMessages: number; limited?: boolean; observedAt: string; boundaryId?: string; budget?: import('@ai-devflow/shared').PromptBudgetReceipt; memory?: ConversationMemoryReceipt }
}
export type ConversationCommand = { projectId: string } & (
  | { type: 'list' }
  | { type: 'create'; title?: string; inputDraft?: string; executor?: 'direct-provider' | 'opencode' | 'native-tools' }
  | { type: 'update'; conversationId: string; title?: string; isOpen?: boolean; inputDraft?: string }
  | { type: 'send'; conversationId: string; text: string; providerId: string; answerToMessageId?: string }
  | { type: 'retry'; conversationId: string; providerId: string }
  | { type: 'read_content'; conversationId: string; messageId: string; field: 'text' | 'draft' | 'reasoning'; offset: number }
  | { type: 'cancel'; conversationId: string }
  | { type: 'publish'; conversationId: string; messageId: string; acknowledgeUnverified?: boolean }
  | { type: 'retry_review'; conversationId: string; messageId: string; providerId: string }
)
export type ConversationResponse = {
  nativeConversationsEnabled?: boolean
  nativeReadOnlyPilotEnabled?: boolean
  contentPage?: { text: string; offset: number; nextOffset: number | null; total: number }
  conversations: WorkbenchConversation[]
  conversationId?: string
  error?: string
  failure?: ConversationFailure
}
export type WorkbenchConversationApi = (command: ConversationCommand) => Promise<ConversationResponse>

const limits = { projectId: 240, conversationId: 240, messageId: 240, answerToMessageId: 240, providerId: 240, title: 100, text: 12000, inputDraft: 12000 }
export function parseConversationCommand(value: unknown): ConversationCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的会话请求。')
  const record = value as Record<string, unknown>
  const fields: Record<string, string[]> = {
    list: [], create: ['title', 'inputDraft', 'executor'], update: ['conversationId', 'title', 'isOpen', 'inputDraft'],
    send: ['conversationId', 'text', 'providerId', 'answerToMessageId'], retry: ['conversationId', 'providerId'],
    read_content: ['conversationId', 'messageId', 'field', 'offset'],
    cancel: ['conversationId'], publish: ['conversationId', 'messageId', 'acknowledgeUnverified'], retry_review: ['conversationId', 'messageId', 'providerId'],
  }
  const type = typeof record.type === 'string' ? record.type : ''
  const allowed = Object.hasOwn(fields, type) ? fields[type]! : undefined
  if (!allowed || Object.keys(record).some((key) => !['type', 'projectId', ...allowed].includes(key))) throw new Error('无效的会话操作。')
  for (const [key, limit] of Object.entries(limits)) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || (record[key] as string).length > limit || (record[key] as string).includes('\0'))) throw new Error('会话输入过长或格式不正确。')
  }
  if (type === 'read_content' && (!['text', 'draft', 'reasoning'].includes(String(record.field)) || !Number.isSafeInteger(record.offset) || Number(record.offset) < 0 || typeof record.messageId !== 'string')) throw new Error('无效的正文分页请求。')
  if (record.isOpen !== undefined && typeof record.isOpen !== 'boolean') throw new Error('无效的 Tab 状态。')
  if (record.acknowledgeUnverified !== undefined && typeof record.acknowledgeUnverified !== 'boolean') throw new Error('无效的提案确认。')
  if (record.executor !== undefined && record.executor !== 'direct-provider' && record.executor !== 'opencode' && record.executor !== 'native-tools') throw new Error('不支持这个会话执行方式。')
  const required = ['projectId', ...(['list', 'create'].includes(type) ? [] : ['conversationId']), ...(['send', 'retry', 'retry_review'].includes(type) ? ['providerId'] : []), ...(type === 'send' ? ['text'] : []), ...(['publish', 'retry_review'].includes(type) ? ['messageId'] : [])]
  if (required.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())) throw new Error('会话请求缺少必要信息。')
  if (record.title !== undefined && !(record.title as string).trim()) throw new Error('请输入会话名称。')
  return record as ConversationCommand
}
