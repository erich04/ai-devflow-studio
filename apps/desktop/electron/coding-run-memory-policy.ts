import { createHash } from 'node:crypto'
import {
  CODING_RUN_MEMORY_POLICY_ID,
  CODING_RUN_MEMORY_POLICY_KINDS,
  CODING_RUN_MEMORY_POLICY_VERSION,
  CODING_RUN_MEMORY_RETENTION_MS,
  codingRunTestCommandStatement,
  type AgentMemoryCandidate,
  type AgentMemoryPromotionAuthority,
  type LocalProject,
} from '@ai-devflow/shared'

/**
 * The bounded Coding Run Memory policy (ADR 0024 §5), shared by the learning step that
 * builds a policy authority and the local store that accepts it. Keeping both sides here
 * means the store does not trust the caller for any of these rules.
 */
export type CodingRunPolicyAuthority = Omit<AgentMemoryPromotionAuthority, 'authorityDigest'>

/** Digest over a fixed key order, so the store can recompute it from a parsed authority. */
export function codingRunPolicyAuthorityDigest(authority: CodingRunPolicyAuthority): string {
  const canonical: CodingRunPolicyAuthority = {
    stateVersion: authority.stateVersion,
    decisionId: authority.decisionId,
    candidateId: authority.candidateId,
    candidateContentDigest: authority.candidateContentDigest,
    scope: authority.scope.kind === 'team'
      ? { kind: 'team', organizationId: authority.scope.organizationId, projectId: authority.scope.projectId,
          userId: authority.scope.userId, sessionId: authority.scope.sessionId, localProjectId: authority.scope.localProjectId }
      : { kind: 'local', organizationId: null, projectId: null,
          userId: authority.scope.userId, sessionId: authority.scope.sessionId, localProjectId: authority.scope.localProjectId },
    actorKind: authority.actorKind,
    actorId: authority.actorId,
    policyId: authority.policyId,
    policyVersion: authority.policyVersion,
    visibility: authority.visibility,
    sensitivity: authority.sensitivity,
    retentionClass: authority.retentionClass,
    expiresAt: authority.expiresAt,
    decidedAt: authority.decidedAt,
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function createCodingRunPolicyAuthority(input: {
  candidate: AgentMemoryCandidate
  decisionId: string
  decidedAt: string
}): AgentMemoryPromotionAuthority {
  const unsigned: CodingRunPolicyAuthority = {
    stateVersion: 1,
    decisionId: input.decisionId,
    candidateId: input.candidate.id,
    candidateContentDigest: input.candidate.contentDigest,
    scope: { ...input.candidate.scope },
    actorKind: 'policy',
    actorId: CODING_RUN_MEMORY_POLICY_ID,
    policyId: CODING_RUN_MEMORY_POLICY_ID,
    policyVersion: CODING_RUN_MEMORY_POLICY_VERSION,
    visibility: 'user_project',
    sensitivity: 'private',
    retentionClass: 'thirty_days',
    expiresAt: new Date(Date.parse(input.decidedAt) + CODING_RUN_MEMORY_RETENTION_MS).toISOString(),
    decidedAt: input.decidedAt,
  }
  return { ...unsigned, authorityDigest: codingRunPolicyAuthorityDigest(unsigned) }
}

/**
 * Whether a policy (non-human) promotion is exactly the bounded Coding Run policy: the
 * candidate is the project's saved test command, and every authority field is the fixed
 * value this policy uses, with a digest the store recomputes.
 */
export function isAllowedCodingRunPolicyPromotion(input: {
  candidate: AgentMemoryCandidate
  authority: AgentMemoryPromotionAuthority
  project: Pick<LocalProject, 'testCommand'> | undefined
}): boolean {
  const { candidate, authority, project } = input
  if (
    authority.actorKind !== 'policy' ||
    candidate.provenance.kind !== 'coding_run' ||
    !CODING_RUN_MEMORY_POLICY_KINDS.includes(candidate.provenance.statementKind) ||
    project === undefined ||
    candidate.statement !== codingRunTestCommandStatement(project.testCommand.trim()) ||
    authority.actorId !== CODING_RUN_MEMORY_POLICY_ID ||
    authority.policyId !== CODING_RUN_MEMORY_POLICY_ID ||
    authority.policyVersion !== CODING_RUN_MEMORY_POLICY_VERSION ||
    authority.visibility !== 'user_project' ||
    authority.sensitivity !== 'private' ||
    authority.retentionClass !== 'thirty_days' ||
    authority.expiresAt !== new Date(Date.parse(authority.decidedAt) + CODING_RUN_MEMORY_RETENTION_MS).toISOString()
  ) return false
  const { authorityDigest, ...unsigned } = authority
  return authorityDigest === codingRunPolicyAuthorityDigest(unsigned)
}
