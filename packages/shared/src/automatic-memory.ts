import type { KnowledgeRetrievalScope } from './retrieval-memory'

/**
 * Rows of the automatic learning pipeline that ADR 0030 removed. They stay in local databases;
 * only forgetting a Memory learned through them still reads and scrubs them.
 */
export const AUTOMATIC_MEMORY_POLICY_VERSION = 'automatic-memory-v1' as const
export const AUTOMATIC_MEMORY_STATEMENT_KINDS = ['communication_preference', 'environment_fact', 'working_practice', 'verified_procedure', 'troubleshooting', 'business_rule', 'unclassified'] as const
export type AutomaticMemoryStatementKind = typeof AUTOMATIC_MEMORY_STATEMENT_KINDS[number]
export type AutomaticMemoryMaterial = {
  id: string; role: 'user' | 'assistant' | 'tool' | 'artifact'; text: string
  evidence?: { kind: 'user_statement' | 'verified_tool_result' | 'approved_artifact'; sourceId: string; sourceRevision: string }
}
export type AutomaticMemoryEvent = {
  id: string; sourceKind: 'conversation_turn' | 'coding_completion' | 'stage_completion' | 'manual_remember'
  sourceId: string; sourceRevision: string; scope: KnowledgeRetrievalScope
  outcome: 'completed' | 'failure'; materials: AutomaticMemoryMaterial[]; createdAt: string
  sourceDigest: string; generation: string; policyVersion: typeof AUTOMATIC_MEMORY_POLICY_VERSION
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
export type AutomaticMemoryDecision = {
  id: string; eventId: string; factId: string; projectId: string; statement: string
  statementKind: AutomaticMemoryStatementKind; disposition: 'auto_save' | 'rule_candidate' | 'conflict' | 'ignored'
  evidenceMaterialIds: string[]; reason: string; createdAt: string
  semanticKey?: string; conflictsWith?: { memoryId: string; revision: number; statement: string }[]
  resolution?: 'saved' | 'dismissed'; memoryId?: string; retentionDays?: number
  manual?: true; pin?: boolean
}
