import type { AgentProvider, AgentProviderUsage, LocalProject } from '@ai-devflow/shared'
import type { WorkbenchConversation } from './workbench-conversation-contract.js'

export type ConversationExecutor = Pick<AgentProvider, 'id' | 'model' | 'completeStructuredJson' | 'effectiveThinking'> & {
  supportsReasoning?: boolean
  close?(): Promise<void>
}

export class ConversationExecutorError extends Error {
  readonly code = 'harness_response_failed'
  constructor(message: string, readonly usage?: AgentProviderUsage) { super(message) }
}

export type OpenConversationHarness = (input: {
  project: LocalProject
  conversation: WorkbenchConversation
  providerId: string
  signal: AbortSignal
  query(name: string, args: Record<string, unknown>): Promise<unknown>
}) => Promise<ConversationExecutor>
