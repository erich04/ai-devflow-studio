import { agentMemoryScopesMatch, type AgentMemoryCandidate, type DurableAgentMemoryRevision } from '@ai-devflow/shared'

/** Deduplication only: callers supply currently active, scoped, non-tombstoned
 * revisions. Never use a text template alone as evidence for saving new Memory.
 */
export function verifiedMemoryTestCommand(revision: Pick<DurableAgentMemoryRevision,
  'status' | 'sourceCandidateId' | 'statement' | 'contentDigest' | 'provenanceDigest' | 'scope'>,
candidate: AgentMemoryCandidate | undefined): string | null {
  if (revision.status !== 'active' || !candidate || candidate.id !== revision.sourceCandidateId ||
      candidate.statement !== revision.statement || candidate.contentDigest !== revision.contentDigest ||
      candidate.provenanceDigest !== revision.provenanceDigest || !agentMemoryScopesMatch(candidate.scope, revision.scope, 'exact')) return null
  const provenance = candidate.provenance
  const command = provenance.kind === 'coding_run' && provenance.statementKind === 'test_command'
    ? /^Verified test command for this project: ((?:corepack )?(?:pnpm|npm|yarn|bun) (?:run )?[A-Za-z0-9:_-]+)\.$/u.exec(revision.statement)?.[1]
    : provenance.kind === 'learning_event' && provenance.statementKind === 'verified_procedure'
      ? /^已验证的项目命令：((?:corepack )?(?:pnpm|npm|yarn|bun) (?:run )?[A-Za-z0-9:_-]+)$/u.exec(revision.statement)?.[1] : undefined
  return command ?? null
}
