import { createHash } from 'node:crypto'
import { agentMemoryScopesMatch, createLearningEventMemoryCandidate, findDuplicateMemory, type AgentMemoryPromotionAuthority, type DurableAgentMemoryRevision } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import { isMemoryLearningSourceCurrent, resolveProjectMemoryScope } from './automatic-memory-capture'
import { listActiveAgentMemoryRevisions } from './agent-memory-authority'
import { verifiedMemoryTestCommand } from './verified-memory-command'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions'
import { classifyManualMemoryDecision, classifyMemoryLearningFact } from './automatic-memory-policy'
import { codingRunPolicyAuthorityDigest } from './coding-run-memory-policy'

export type CommitMemoryLearningDecisionInput = {
  decisionId: string; mode: 'automatic' | 'manual'
  targetMemoryId?: string; expectedRevision?: number; pin?: boolean
}
export type CommitMemoryLearningDecisionResult = { memoryId?: string; status: 'saved' | 'ignored' | 'pending' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function pinExistingMemory(store: LocalStore, memory: DurableAgentMemoryRevision): Promise<void> {
  if (memory.retentionClass === 'until_deleted') return
  const head = await store.getAgentMemoryHead(memory.id)
  if (!head || head.currentRevision !== memory.revision || head.status !== 'active') throw new Error('Memory changed before pinning')
  const clock = () => new Date(Math.max(Date.now(), Date.parse(memory.createdAt) + 1)).toISOString()
  await createAgentMemoryHumanActions({ store, clock }).revise({ localProjectId: memory.scope.localProjectId,
    memoryId: memory.id, expectedRevision: memory.revision, expectedHeadVersion: head.version,
    expectedContentDigest: memory.contentDigest, expectedProvenanceDigest: memory.provenanceDigest,
    statement: memory.statement, pin: true })
}

/** Called only inside LocalStore's serialized durable mutation. No network work belongs here. */
export async function applyMemoryLearningDecision(store: LocalStore, input: CommitMemoryLearningDecisionInput): Promise<CommitMemoryLearningDecisionResult> {
  if (!input || !['automatic', 'manual'].includes(input.mode) || typeof input.decisionId !== 'string' ||
      (input.pin !== undefined && typeof input.pin !== 'boolean')) throw new Error('Invalid memory decision request')
  let decision = await store.getMemoryLearningDecision(input.decisionId)
  if (!decision) throw new Error('Memory decision not found')
  const event = await store.getMemoryLearningEvent(decision.eventId)
  const scope = event && await resolveProjectMemoryScope(store, event.scope.localProjectId, event.scope.sessionId)
  if (!event || !scope || !agentMemoryScopesMatch(scope, event.scope, 'exact')) throw new Error('Memory decision scope changed')
  if (decision.resolution === 'dismissed') return { status: 'ignored' }
  const now = new Date().toISOString()
  if (decision.resolution === 'saved') {
    if (!decision.memoryId) throw new Error('Saved memory decision is incomplete')
    const [head, revisions, tombstone] = await Promise.all([store.getAgentMemoryHead(decision.memoryId),
      store.listAgentMemoryRevisions(decision.memoryId), store.getAgentMemoryTombstone(decision.memoryId)])
    const revision = revisions.find(item => item.revision === head?.currentRevision)
    // Replaying an acknowledged save must never resurrect deleted or expired memory.
    const current = head?.status === 'active' && revision?.status === 'active' && !tombstone &&
      agentMemoryScopesMatch(head.scope, event.scope, 'user_project') && (!revision.expiresAt || revision.expiresAt > now)
    if (!current || !revision) return { status: 'ignored' }
    if (input.mode === 'manual' && (input.pin ?? decision.pin)) await pinExistingMemory(store, revision)
    return { status: 'saved', memoryId: decision.memoryId }
  }
  if (decision.disposition === 'rule_candidate') return { status: 'pending' }
  if (decision.disposition === 'ignored') {
    await store.resolveMemoryLearningDecision(decision.id, 'dismissed')
    return { status: 'ignored' }
  }
  if (input.mode === 'automatic' && decision.manual) return { status: 'pending' }
  const fact = await store.getMemoryLearningFact(decision.eventId, decision.factId)
  if (!fact || event.revoked || !(await isMemoryLearningSourceCurrent(store, event))) throw new Error('Memory source is no longer current')
  const active = await listActiveAgentMemoryRevisions(store, event.scope, now)
  const decisions = await store.listMemoryLearningDecisions(decision.projectId)
  const candidates = new Map((await store.listAgentMemoryCandidates(decision.projectId)).map(candidate => [candidate.id, candidate]))
  const existing = active.map(memory => {
    const semanticKey = decisions.find(item => item.memoryId === memory.id && item.statement === memory.statement)?.semanticKey
    const verifiedCommand = verifiedMemoryTestCommand(memory, candidates.get(memory.sourceCandidateId))
    return { memoryId: memory.id, revision: memory.revision, statement: memory.statement, ...(semanticKey ? { semanticKey } : {}),
      ...(verifiedCommand ? { semanticKey: 'practice.test_command', semanticValue: verifiedCommand } : {}) }
  })
  const checked = decision.manual ? classifyManualMemoryDecision(decision, existing)
    : classifyMemoryLearningFact(event, fact, existing, decision.createdAt)
  // Extraction and commit can be separated by another save. Explicit manual
  // requests also recheck known semantic slots before replacing an experience.
  if (!(await store.refreshMemoryLearningDecision(checked))) throw new Error('Memory decision changed')
  decision = checked
  if (decision.disposition === 'rule_candidate') return { status: 'pending' }
  const duplicate = findDuplicateMemory(decision.statement, active, item => item.statement)
  if (duplicate?.kind === 'exact') {
    if (input.mode === 'manual' && (input.pin ?? decision.pin)) await pinExistingMemory(store, duplicate.item)
    await store.resolveMemoryLearningDecision(decision.id, 'saved', duplicate.item.id)
    return { status: 'saved', memoryId: duplicate.item.id }
  }
  if (!decision.manual && decision.disposition === 'ignored') {
    await store.resolveMemoryLearningDecision(decision.id, 'dismissed')
    return { status: 'ignored' }
  }
  if (input.mode === 'automatic' && decision.disposition !== 'auto_save') return { status: 'pending' }
  const conflicts = decision.conflictsWith ?? []
  let replacement: typeof active[number] | undefined
  if (decision.disposition === 'conflict' || conflicts.length) {
    if (input.mode !== 'manual') return { status: 'pending' }
    if (input.targetMemoryId === undefined && input.expectedRevision === undefined) return { status: 'pending' }
    if (conflicts.length !== 1 || input.targetMemoryId !== conflicts[0]!.memoryId ||
        input.expectedRevision !== conflicts[0]!.revision) throw new Error('Confirm the current conflicting memory before replacing it')
    replacement = active.find(memory => memory.id === input.targetMemoryId && memory.revision === input.expectedRevision)
    if (!replacement) throw new Error('Conflicting memory changed; refresh before confirming')
    const origin = (await store.listAgentMemoryCandidates(decision.projectId)).find(candidate => candidate.id === replacement!.sourceCandidateId)
    if (origin?.provenance.kind === 'learning_event' && origin.provenance.eventId === event.id) throw new Error('Conflicting facts from the same source require correction')
  }
  const candidate = await createLearningEventMemoryCandidate({ id: `candidate-${digest(decision.id)}`,
    statement: decision.statement, scope: event.scope,
    provenance: { kind: 'learning_event', eventId: event.id, sourceDigest: event.sourceDigest, factId: fact.id, statementKind: decision.statementKind },
    createdAt: fact.extractedAt })
  const saved = await store.saveAgentMemoryCandidate(candidate)
  if (!saved.committed) throw new Error(`Memory candidate rejected: ${saved.reason}`)
  const pin = input.mode === 'manual' && (input.pin ?? decision.pin ?? false)
  const unsigned: Omit<AgentMemoryPromotionAuthority, 'authorityDigest'> = {
    stateVersion: 1, decisionId: decision.id, candidateId: candidate.id, candidateContentDigest: candidate.contentDigest,
    scope: candidate.scope, actorKind: input.mode === 'automatic' ? 'policy' : 'human',
    actorId: input.mode === 'automatic' ? 'automatic-memory-v1' : event.scope.userId,
    policyId: input.mode === 'automatic' ? 'automatic-memory-v1' : 'desktop-human-memory-promotion', policyVersion: 1,
    visibility: 'user_project', sensitivity: 'private', retentionClass: pin ? 'until_deleted' : 'thirty_days',
    expiresAt: pin ? null : new Date(Date.parse(now) + 30 * 86_400_000).toISOString(), decidedAt: now,
  }
  const memoryId = `memory-${digest(decision.id)}`
  const authorization = await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId,
    authority: { ...unsigned, authorityDigest: codingRunPolicyAuthorityDigest(unsigned) } })
  if (!authorization.authorized) throw new Error('Memory promotion rejected')
  const committed = await store.commitAgentMemoryPromotion({ revision: authorization.revision }, authorization.capability)
  if (!committed.committed) throw new Error('Memory promotion became stale')
  if (replacement) {
    await store.retireMemoryLearningConflict({ decisionId: decision.id, replacementMemoryId: memoryId,
      targetMemoryId: replacement.id, expectedRevision: replacement.revision })
  }
  await store.resolveMemoryLearningDecision(decision.id, 'saved', memoryId)
  return { status: 'saved', memoryId }
}
