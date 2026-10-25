import type { KnowledgeRetrievalScope } from './retrieval-memory'

export const AUTOMATIC_MEMORY_POLICY_VERSION = 'automatic-memory-v1' as const
export const AUTOMATIC_MEMORY_MAX_EVENT_BYTES = 24 * 1024
export const AUTOMATIC_MEMORY_MAX_FACTS = 128
export const AUTOMATIC_MEMORY_STATEMENT_KINDS = ['communication_preference', 'environment_fact', 'working_practice', 'verified_procedure', 'troubleshooting', 'business_rule', 'unclassified'] as const
export type AutomaticMemoryStatementKind = typeof AUTOMATIC_MEMORY_STATEMENT_KINDS[number]
export type AutomaticMemoryConfigurationInput = {
  projectId: string; ownerUserId: string; enabled: boolean; hindsightGeneration: string
  /** A durable invocation cap, not a monetary billing guarantee. */
  maxRetainsPerDay: number
  pairingSessionId?: string
}
export type AutomaticMemoryConfiguration = AutomaticMemoryConfigurationInput & {
  generation: string; bankId: string; createdAt: string
}
export type AutomaticMemoryMaterial = {
  id: string; role: 'user' | 'assistant' | 'tool' | 'artifact'; text: string
  /** Assigned by the host after rereading its durable source, never by a model. */
  evidence?: { kind: 'user_statement' | 'verified_tool_result' | 'approved_artifact'; sourceId: string; sourceRevision: string }
}
export type AutomaticMemoryEventInput = {
  sourceKind: 'conversation_turn' | 'coding_completion' | 'stage_completion' | 'manual_remember'
  sourceId: string; sourceRevision: string; scope: KnowledgeRetrievalScope
  outcome: 'completed' | 'failure'; materials: AutomaticMemoryMaterial[]; createdAt: string
}
export type AutomaticMemoryEvent = AutomaticMemoryEventInput & {
  id: string; sourceDigest: string; generation: string; policyVersion: typeof AUTOMATIC_MEMORY_POLICY_VERSION
  revoked: boolean
  manualRequest?: { statement: string; pin: boolean }
}
export type AutomaticMemoryJobStatus = 'queued' | 'submitted' | 'remote_processing' | 'extracted' | 'committed' |
  'needs_confirmation' | 'skipped' | 'retryable_failure' | 'cleanup_pending' | 'cleaned' | 'revoked'
export type AutomaticMemoryJob = {
  id: string; eventId: string; projectId: string; generation: string; bankId: string; documentId: string; operationId: string
  payload: string; payloadDigest: string; metadata: Record<string, string>; status: AutomaticMemoryJobStatus
  retainAttempts: number; submittedAt?: string; revoked: boolean; nextAttemptAt: string
  leaseToken?: string; leaseUntil?: string; lastError?: string; createdAt: string
}
export type AutomaticMemoryFact = {
  id: string; eventId: string; remoteFactId: string; documentId: string; text: string
  factType: 'world' | 'experience'; sourceDigest: string; contentDigest: string; extractedAt: string
}
export type AutomaticMemoryDisposition = 'auto_save' | 'rule_candidate' | 'conflict' | 'ignored'
export type AutomaticMemoryDecision = {
  id: string; eventId: string; factId: string; projectId: string; statement: string
  statementKind: AutomaticMemoryStatementKind; disposition: AutomaticMemoryDisposition
  evidenceMaterialIds: string[]; reason: string; createdAt: string
  /** Stable, narrow semantic slot, e.g. communication.language; never a scope. */
  semanticKey?: string; conflictsWith?: { memoryId: string; revision: number; statement: string }[]
  resolution?: 'saved' | 'dismissed'; memoryId?: string; retentionDays?: number
  manual?: true; pin?: boolean
}
export type AutomaticMemoryStatus = {
  projectId: string
  configuration: AutomaticMemoryConfiguration | null; endpoint: string | null
  jobs: Pick<AutomaticMemoryJob, 'id' | 'eventId' | 'status' | 'createdAt' | 'lastError'>[]
  decisions: AutomaticMemoryDecision[]
  unavailableReason?: string
}
export type ConfigureAutomaticMemoryInput = {
  projectId: string; enabled: boolean; maxRetainsPerDay: number
  /** Separate consent for new conversation/stage sources, not inherited from knowledge projection. */
  consent: boolean
}
export type ResolveAutomaticMemoryDecisionInput = {
  projectId: string; decisionId: string; action: 'approve' | 'ignore'
  /** Required when replacing a conflicting Memory; Main validates the displayed revision. */
  targetMemoryId?: string; expectedRevision?: number
}
export type RememberConversationMemoryInput = {
  projectId: string; conversationId: string; messageId: string; statement?: string; pin?: boolean
}
