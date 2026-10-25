import type { AgentProvider, AgentProviderUsage, LocalProject } from '@ai-devflow/shared'
import type { WorkbenchConversation } from './workbench-conversation-contract.js'

export type ConversationExecutor = Pick<AgentProvider, 'id' | 'model' | 'completeStructuredJson' | 'completeNativeConversation' | 'serializeNativeRequest' | 'effectiveThinking' | 'resolveRequestPolicy' | 'supportsNativeTools'> & {
  supportsReasoning?: boolean
  close?(): Promise<void>
}

export class ConversationExecutorError extends Error {
  readonly code = 'harness_response_failed'
  constructor(message: string, readonly usage?: AgentProviderUsage) { super(message) }
}

/** Remaining host allowance for one owned harness run, not a new independent budget. */
export type ConversationInvestigationBudget = { maxSteps: number; maxToolCalls: number }

export type OpenConversationHarness = (input: {
  project: LocalProject
  conversation: WorkbenchConversation
  providerId: string
  signal: AbortSignal
  investigationBudget?: ConversationInvestigationBudget
  query(name: string, args: Record<string, unknown>): Promise<unknown>
}) => Promise<ConversationExecutor>
