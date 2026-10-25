// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCodingRunMemoryCandidate, createLearningEventMemoryCandidate, createWorkflowRunFromRequest,
  type AgentMemoryCandidate, type AgentMemoryPromotionAuthority, type AutomaticMemoryEvent,
  type AutomaticMemoryFact, type LocalProject, type DesktopPairingCredential, type KnowledgeRetrievalScope,
} from '@ai-devflow/shared'
import { createLocalStore, getLocalStoreRevision, type LocalStore } from './local-store'
import * as persistence from './local-store-persistence'
import { schemaMigrations } from './local-store-schema'
import { classifyMemoryLearningFact } from './automatic-memory-policy'
import { automaticMemoryDigest } from './automatic-memory-store'
import { buildConversationLearningEvent, buildManualMemoryEvent } from './automatic-memory-capture'
import { codingRunPolicyAuthorityDigest } from './coding-run-memory-policy'
import { resolveAgentMemoryLifecycleAuthority } from './agent-memory-authority'
import { createAgentMemoryHumanActions } from './agent-memory-human-actions'
import { hindsightPairingBinding } from './hindsight-store'
import type { WorkbenchConversation } from './workbench-conversation-contract'

const now = '2026-10-22T12:00:00.000Z'
const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function databasePath() { const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-auto-memory-store-')); directories.push(directory); return path.join(directory, 'data.sqlite') }
const project: LocalProject = { id: 'automatic-memory-project', name: 'fixture', path: '/tmp/automatic-memory-project', packageManager: 'pnpm', detectedTestCommand: 'pnpm test', testCommand: 'pnpm test', createdAt: now, updatedAt: now }
const workflow = (creatorId: string, id: string) => createWorkflowRunFromRequest({ runId: id, title: 'Fixture', request: 'Test memory isolation', projectId: project.id, creatorId, branchName: `devflow/${id}`, now }).run
async function configured() {
  const dbPath = await databasePath()
  const store = await createLocalStore({ dbPath }); await store.upsertProject(project)
  const principal = await store.resolveLocalProjectMemoryPrincipal(project.id)
  if (principal.status !== 'resolved') throw new Error('fixture principal missing')
  const hindsight = await store.configureHindsight({ projectId: project.id, ownerUserId: principal.userId,
    projectPath: project.path, knowledgeRoot: 'docs/knowledge', rootGeneration: 'fixture-root', endpoint: 'http://127.0.0.1:8888',
    encryptedApiKey: null, enabled: true, includeMemories: true, selectedPaths: [], modelDigest: 'fixture-model',
    model: { version: 'fixture-v1', dimensions: [{ key: 'sem_kind', type: 'text' }] } })
  const config = await store.configureAutomaticMemory({ projectId: project.id, ownerUserId: principal.userId,
    enabled: true, hindsightGeneration: hindsight.generation, maxRetainsPerDay: 10 })
  return { store, principal, config, dbPath }
}
async function extracted(store: LocalStore, userId: string, texts = ['请用中文回答。'], scopeOverride?: KnowledgeRetrievalScope, factTexts = [texts.at(-1)!]) {
  const scope = scopeOverride ?? { kind: 'local' as const, organizationId: null, projectId: null, userId, sessionId: 'chat-source', localProjectId: project.id }
  const conversation: WorkbenchConversation = { id: `conversation-${createHash('sha256').update(texts.join()).digest('hex').slice(0, 10)}`,
    localProjectId: project.id, version: 1, title: 'Fixture', isOpen: true, inputDraft: '', status: 'idle',
    messages: [...texts.map((text, i) => ({ id: `user-${i}`, role: 'user' as const, text, createdAt: now })),
      { id: 'reply', role: 'assistant', text: '好的。', createdAt: now }], createdAt: now, updatedAt: now }
  await store.saveWorkbenchConversation(conversation, 0)
  const source = buildConversationLearningEvent(conversation, { status: 'running', messages: conversation.messages.slice(0, -1) }, scope)!
  const event = (await store.enqueueMemoryLearningEvent(source))!
  const claim = (await store.claimMemoryLearningJob(now))!
  const facts: AutomaticMemoryFact[] = factTexts.map((text, index) => ({ id: `fact-${event.id}-${index}`, eventId: event.id, remoteFactId: `remote-${index}`, documentId: claim.job.documentId,
    text, factType: 'experience', sourceDigest: event.sourceDigest, contentDigest: automaticMemoryDigest(text), extractedAt: now }))
  await store.recordMemoryLearningExtraction(claim.job.id, claim.leaseToken, facts)
  const decisions = facts.map(fact => classifyMemoryLearningFact(event, fact, [], now))
  await store.recordMemoryLearningDecisions(claim.job.id, claim.leaseToken, decisions)
  const fact = facts[0]!, decision = decisions[0]!
  const candidate = await createLearningEventMemoryCandidate({ id: `candidate-${event.id}`, statement: decision.statement, scope,
    provenance: { kind: 'learning_event', eventId: event.id, sourceDigest: event.sourceDigest, factId: fact.id, statementKind: decision.statementKind }, createdAt: now })
  return { event, fact, decision, candidate, claim, facts, decisions }
}
async function manualDecision(store: LocalStore, event: AutomaticMemoryEvent, statement: string, pin = false) {
  const source = await buildManualMemoryEvent(store, { projectId: project.id, conversationId: event.sourceId, messageId: event.materials[0]!.id })
  return store.recordManualMemoryLearningEvent(source, statement, pin)
}
function authority(candidate: AgentMemoryCandidate, decisionId: string): AgentMemoryPromotionAuthority {
  const unsigned = { stateVersion: 1 as const, decisionId, candidateId: candidate.id, candidateContentDigest: candidate.contentDigest,
    scope: candidate.scope, actorKind: 'policy' as const, actorId: 'automatic-memory-v1', policyId: 'automatic-memory-v1', policyVersion: 1,
    visibility: 'user_project' as const, sensitivity: 'private' as const, retentionClass: 'thirty_days' as const,
    expiresAt: '2026-11-21T12:00:00.000Z', decidedAt: now }
  return { ...unsigned, authorityDigest: codingRunPolicyAuthorityDigest(unsigned) }
}
async function promote(store: LocalStore, candidate: AgentMemoryCandidate, decisionId: string, memoryId = 'memory-auto') {
  expect(await store.saveAgentMemoryCandidate(candidate)).toMatchObject({ committed: true })
  const authorized = await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId, authority: authority(candidate, decisionId) })
  if (!authorized.authorized) throw new Error(`fixture promotion failed: ${authorized.reason}`)
  expect(await store.commitAgentMemoryPromotion({ revision: authorized.revision }, authorized.capability)).toMatchObject({ committed: true })
  return authorized.revision
}

describe('automatic memory identity, persisted evidence and source policy', () => {
  it('commits a complete learning decision with one disk publication and replays its stable identity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-22T13:00:00.000Z')
    const { store, principal } = await configured()
    const { decision } = await extracted(store, principal.userId)
    const before = getLocalStoreRevision(store)!
    const write = vi.spyOn(persistence, 'persistDatabaseSnapshot')
    const result = await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'automatic' })
    expect(result.status).toBe('saved'); expect(write).toHaveBeenCalledTimes(1)
    expect(getLocalStoreRevision(store)).toBe(before + 1)
    expect((await store.getMemoryLearningDecision(decision.id))?.memoryId).toBe(result.memoryId)
    vi.setSystemTime('2026-10-22T14:00:00.000Z')
    expect(await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'automatic' })).toEqual(result)
    expect(await store.listAgentMemoryHeads(project.id)).toHaveLength(1)
    store.close()
  })
  it('rolls back candidate, promotion and policy refresh on a late composite failure without publishing an intermediate database', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-22T13:00:00.000Z')
    const { store, principal, dbPath } = await configured()
    const { decision } = await extracted(store, principal.userId)
    const before = await readFile(dbPath)
    const write = vi.spyOn(persistence, 'persistDatabaseSnapshot')
    vi.spyOn(store, 'resolveMemoryLearningDecision').mockRejectedValueOnce(new Error('injected after promotion'))
    await expect(store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'automatic' })).rejects.toThrow('injected after promotion')
    expect(write).not.toHaveBeenCalled()
    expect(await readFile(dbPath)).toEqual(before)
    expect(await store.listAgentMemoryHeads(project.id)).toEqual([])
    expect(await store.listAgentMemoryCandidates(project.id)).toEqual([])
    expect((await store.getMemoryLearningDecision(decision.id))?.resolution).toBeUndefined()
    store.close()
    const reopened = await createLocalStore({ dbPath }); expect(await reopened.listAgentMemoryHeads(project.id)).toEqual([]); reopened.close()
  })
  it('turns an extraction that became conflicting into a persistent exception before replacing it with explicit approval', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-22T13:00:00.000Z')
    const { store, principal } = await configured()
    const first = await extracted(store, principal.userId)
    const second = await extracted(store, principal.userId, ['请用英文回答。'])
    expect(second.decision.disposition).toBe('auto_save')
    const firstSave = await store.commitMemoryLearningDecision({ decisionId: first.decision.id, mode: 'automatic' })
    expect(await store.commitMemoryLearningDecision({ decisionId: second.decision.id, mode: 'automatic' })).toEqual({ status: 'pending' })
    expect(await store.getMemoryLearningDecision(second.decision.id)).toMatchObject({ disposition: 'conflict', conflictsWith: [{ memoryId: firstSave.memoryId, revision: 1 }] })
    expect((await store.listAgentMemoryHeads(project.id)).filter(head => head.status === 'active')).toHaveLength(1)
    vi.setSystemTime('2026-10-22T13:00:01.000Z')
    const replacement = await store.commitMemoryLearningDecision({ decisionId: second.decision.id, mode: 'manual', targetMemoryId: firstSave.memoryId!, expectedRevision: 1 })
    expect(replacement.status).toBe('saved')
    expect((await store.getAgentMemoryHead(firstSave.memoryId!))?.status).toBe('expired')
    expect((await store.getAgentMemoryHead(replacement.memoryId!))?.status).toBe('active')
    expect((await store.getMemoryLearningEvent(first.event.id))?.revoked).toBe(false)
    expect((await store.getMemoryLearningEvent(second.event.id))?.revoked).toBe(false)
    expect(await store.commitMemoryLearningDecision({ decisionId: first.decision.id, mode: 'automatic' })).toEqual({ status: 'ignored' })
    store.close()
  })
  it('honors explicit duplicate pinning without adding a head or renewing ordinary duplicate saves', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-22T13:00:00.000Z')
    const { store, principal, config } = await configured()
    const source = await extracted(store, principal.userId)
    const saved = await store.commitMemoryLearningDecision({ decisionId: source.decision.id, mode: 'automatic' })
    const original = (await store.listAgentMemoryRevisions(saved.memoryId!))[0]!
    vi.setSystemTime('2026-10-23T13:00:00.000Z')
    const ordinary = await manualDecision(store, source.event, original.statement)
    expect(await store.commitMemoryLearningDecision({ decisionId: ordinary.id, mode: 'manual' })).toEqual(saved)
    expect(await store.listAgentMemoryRevisions(saved.memoryId!)).toHaveLength(1)
    expect((await store.listAgentMemoryRevisions(saved.memoryId!))[0]?.expiresAt).toBe(original.expiresAt)
    const pinned = await manualDecision(store, source.event, original.statement, true)
    expect(await store.commitMemoryLearningDecision({ decisionId: pinned.id, mode: 'manual' })).toEqual(saved)
    expect(await store.listAgentMemoryHeads(project.id)).toHaveLength(1)
    const revisions = await store.listAgentMemoryRevisions(saved.memoryId!)
    expect(revisions.find(item => item.revision === 2)).toMatchObject({ retentionClass: 'until_deleted', expiresAt: null })
    await store.configureAutomaticMemory({ ...config, enabled: false })
    expect(await store.commitMemoryLearningDecision({ decisionId: pinned.id, mode: 'manual' })).toEqual(saved)
    store.close()
  })
  it('queues known manual conflicts and preserves a separate pinned fact from the replaced source', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-22T13:00:00.000Z')
    const { store, principal } = await configured()
    const first = await extracted(store, principal.userId, ['请用中文回答。项目使用 Node.js 24。'], undefined,
      ['请用中文回答。', '项目使用 Node.js 24。'])
    const language = await store.commitMemoryLearningDecision({ decisionId: first.decisions[0]!.id, mode: 'automatic' })
    const environment = await store.commitMemoryLearningDecision({ decisionId: first.decisions[1]!.id, mode: 'automatic' })
    await store.commitMemoryLearningDecision({ decisionId: first.decisions[1]!.id, mode: 'manual', pin: true })
    const request = await manualDecision(store, first.event, '请用英文回答。')
    expect(await store.commitMemoryLearningDecision({ decisionId: request.id, mode: 'manual' })).toEqual({ status: 'pending' })
    expect(await store.getMemoryLearningDecision(request.id)).toMatchObject({ manual: true, disposition: 'conflict',
      statementKind: 'communication_preference', conflictsWith: [{ memoryId: language.memoryId, revision: 1 }] })
    expect((await store.listAgentMemoryHeads(project.id)).filter(item => item.status === 'active')).toHaveLength(2)
    await expect(store.commitMemoryLearningDecision({ decisionId: request.id, mode: 'manual', targetMemoryId: language.memoryId!, expectedRevision: 99 })).rejects.toThrow('current conflicting memory')
    const english = await store.commitMemoryLearningDecision({ decisionId: request.id, mode: 'manual', targetMemoryId: language.memoryId!, expectedRevision: 1 })
    expect(english.status).toBe('saved')
    expect((await store.getAgentMemoryHead(language.memoryId!))?.status).toBe('expired')
    expect((await store.getMemoryLearningEvent(first.event.id))?.revoked).toBe(false)
    const nodeHead = (await store.getAgentMemoryHead(environment.memoryId!))!
    expect(nodeHead.status).toBe('active')
    expect((await store.listAgentMemoryRevisions(environment.memoryId!)).find(item => item.revision === nodeHead.currentRevision))
      .toMatchObject({ statement: '项目使用 Node.js 24', retentionClass: 'until_deleted', expiresAt: null })
    expect(await store.getAgentMemoryTombstone(language.memoryId!)).toBeNull()
    store.close()
  })
  it('generates one durable no-Run identity and permits lifecycle access without a Run', async () => {
    const { store, principal, dbPath } = await configured()
    expect(principal.basis).toBe('generated')
    expect(await resolveAgentMemoryLifecycleAuthority(store, { localProjectId: project.id })).toMatchObject({ ok: true, authority: { scope: { userId: principal.userId } } })
    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.resolveLocalProjectMemoryPrincipal(project.id)).toEqual(principal)
    reopened.close()
  })
  it('adopts only a unique legacy Run creator and stops on ambiguous ownership', async () => {
    const store = await createLocalStore({ dbPath: await databasePath() }); await store.upsertProject(project)
    await store.saveRun(workflow('alice', 'run-alice'))
    expect(await store.resolveLocalProjectMemoryPrincipal(project.id)).toEqual({ status: 'resolved', userId: 'alice', basis: 'existing_run_creator' })
    await store.saveRun(workflow('bob', 'run-bob'))
    expect(await store.resolveLocalProjectMemoryPrincipal(project.id)).toEqual({ status: 'ambiguous' })
    expect(await resolveAgentMemoryLifecycleAuthority(store, { localProjectId: project.id })).toEqual({ ok: false, reason: 'invalid_authority' })
    store.close()
  })
  it('requires immutable fact/decision evidence, blocks forged scope, and saves ordinary experience without a human promotion', async () => {
    const { store, principal, dbPath } = await configured()
    const { candidate, decision } = await extracted(store, principal.userId)
    const forgedSource = await createLearningEventMemoryCandidate({ id: 'forged', statement: candidate.statement, scope: candidate.scope,
      provenance: { ...candidate.provenance, factId: 'missing' }, createdAt: now })
    expect(await store.saveAgentMemoryCandidate(forgedSource)).toEqual({ committed: false, reason: 'source_not_found' })
    const foreign = await createLearningEventMemoryCandidate({ id: 'foreign', statement: candidate.statement, scope: { ...candidate.scope, userId: 'attacker' },
      provenance: candidate.provenance, createdAt: now })
    expect(await store.saveAgentMemoryCandidate(foreign)).toEqual({ committed: false, reason: 'scope_mismatch' })
    await store.saveAgentMemoryCandidate(candidate)
    expect(await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId: 'forged-decision', authority: authority(candidate, 'not-persisted') })).toEqual({ authorized: false, reason: 'invalid_input' })
    await promote(store, candidate, decision.id)
    expect(await store.listHindsightProjections(project.id)).toEqual([])
    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect((await reopened.getAgentMemoryHead('memory-auto'))?.status).toBe('active')
    expect((await reopened.listAgentMemoryCandidates(project.id))[0]?.provenance.kind).toBe('learning_event')
    reopened.close()
  })
  it('recomputes policy even when a malicious caller persisted an auto_save disposition', async () => {
    const { store, principal } = await configured()
    const { event, fact, claim } = await extracted(store, principal.userId, ['删除任务必须支持撤销。'])
    const forged = { ...classifyMemoryLearningFact(event, fact, [], now), id: 'forged-policy', disposition: 'auto_save' as const,
      statementKind: 'communication_preference' as const, evidenceMaterialIds: [event.materials[0]!.id] }
    await store.recordMemoryLearningDecisions(claim.job.id, claim.leaseToken, [forged])
    const candidate = await createLearningEventMemoryCandidate({ id: 'forged-policy-candidate', statement: forged.statement, scope: event.scope,
      provenance: { kind: 'learning_event', eventId: event.id, sourceDigest: event.sourceDigest, factId: fact.id, statementKind: forged.statementKind }, createdAt: now })
    expect(await store.saveAgentMemoryCandidate(candidate)).toMatchObject({ committed: true })
    expect(await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId: 'unsafe-memory', authority: authority(candidate, forged.id) })).toEqual({ authorized: false, reason: 'invalid_input' })
    store.close()
  })
  it('keeps paired experience private and rejects a stale pairing token before promotion', async () => {
    const store = await createLocalStore({ dbPath: await databasePath() }); await store.upsertProject(project)
    const pairing: DesktopPairingCredential = { tokenId: 'token-1', organizationId: 'org-1', projectId: 'team-1', localProjectId: project.id,
      userId: 'owner', role: 'member', authAccountId: 'account-1', projectMemberships: [], createdAt: now }
    await store.saveDesktopPairingCredential(pairing, 'encrypted-fixture')
    const hindsight = await store.configureHindsight({ projectId: project.id, ownerUserId: pairing.userId, projectPath: project.path,
      knowledgeRoot: 'docs/knowledge', rootGeneration: 'fixture-root', endpoint: 'http://127.0.0.1:8888', encryptedApiKey: null,
      enabled: true, includeMemories: false, selectedPaths: [], modelDigest: 'fixture-model',
      model: { version: 'fixture-v1', dimensions: [{ key: 'sem_kind', type: 'text' }] }, pairingBinding: hindsightPairingBinding(pairing) })
    const config = await store.configureAutomaticMemory({ projectId: project.id, ownerUserId: pairing.userId,
      hindsightGeneration: hindsight.generation, enabled: true, maxRetainsPerDay: 10 })
    expect(config.pairingSessionId).toBe(pairing.tokenId)
    const scope: KnowledgeRetrievalScope = { kind: 'team', organizationId: pairing.organizationId, projectId: pairing.projectId,
      userId: pairing.userId, sessionId: pairing.tokenId, localProjectId: project.id }
    const { candidate, decision } = await extracted(store, pairing.userId, undefined, scope)
    await promote(store, candidate, decision.id)
    expect((await store.listRemoteSyncOperations()).filter(item => item.kind === 'agent-memory-summary')).toEqual([])
    expect(await store.listHindsightProjections(project.id)).toEqual([])
    await store.saveDesktopPairingCredential({ ...pairing, tokenId: 'token-2' }, 'encrypted-fixture-2')
    expect(await store.saveAgentMemoryCandidate(candidate)).toMatchObject({ committed: false })
    store.close()
  })
  it('allows an explicit local manual save without Hindsight or automatic consent and never grants it policy authority', async () => {
    const store = await createLocalStore({ dbPath: await databasePath() }); await store.upsertProject(project)
    const conversation: WorkbenchConversation = { id: 'manual-conversation', localProjectId: project.id, version: 1, title: 'Manual',
      isOpen: true, inputDraft: '', status: 'idle', createdAt: now, updatedAt: now,
      messages: [{ id: 'manual-message', role: 'user', text: '排查序列化问题时，先核对日期字段。', createdAt: now }] }
    await store.saveWorkbenchConversation(conversation, 0)
    const source = await buildManualMemoryEvent(store, { projectId: project.id, conversationId: conversation.id, messageId: 'manual-message' })
    const decision = await store.recordManualMemoryLearningEvent(source, source.materials[0]!.text, true)
    const event = (await store.getMemoryLearningEvent(decision.eventId))!
    const candidate = await createLearningEventMemoryCandidate({ id: 'manual-candidate', statement: decision.statement, scope: event.scope,
      provenance: { kind: 'learning_event', eventId: event.id, sourceDigest: event.sourceDigest, factId: decision.factId, statementKind: decision.statementKind }, createdAt: event.createdAt })
    expect(await store.saveAgentMemoryCandidate(candidate)).toMatchObject({ committed: true })
    const unsigned = { ...authority(candidate, decision.id), decidedAt: event.createdAt, expiresAt: new Date(Date.parse(event.createdAt) + 30 * 86_400_000).toISOString() }
    const forgedAuthority = { ...unsigned, authorityDigest: codingRunPolicyAuthorityDigest(unsigned) }
    expect(await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId: 'manual-policy-forged', authority: forgedAuthority })).toMatchObject({ authorized: false })
    const actions = createAgentMemoryHumanActions({ store, clock: () => new Date(Date.parse(event.createdAt) + 1000).toISOString() })
    const saved = await actions.promote({ localProjectId: project.id, candidateId: candidate.id,
      expectedContentDigest: candidate.contentDigest, expectedProvenanceDigest: candidate.provenanceDigest })
    expect(saved.retentionClass).toBe('until_deleted')
    expect(await store.listMemoryLearningJobs(project.id)).toEqual([])
    expect(await store.getHindsightConfiguration(project.id)).toBeNull()
    store.close()
  })
  it('rechecks consent at commit when automatic learning is disabled', async () => {
    const { store, principal, config } = await configured()
    const { candidate, decision } = await extracted(store, principal.userId)
    await store.saveAgentMemoryCandidate(candidate)
    const authorized = await store.authorizeAgentMemoryPromotion({ candidateId: candidate.id, memoryId: 'not-committed', authority: authority(candidate, decision.id) })
    expect(authorized.authorized).toBe(true)
    await store.configureAutomaticMemory({ ...config, enabled: false })
    if (authorized.authorized) expect(await store.commitAgentMemoryPromotion({ revision: authorized.revision }, authorized.capability)).toEqual({ committed: false, reason: 'source_stale' })
    expect(await store.getAgentMemoryHead('not-committed')).toBeNull()
    store.close()
  })
  it('preserves committed memory on opt-out and records a non-replaying dismissal for an unpromoted candidate', async () => {
    const { store, principal, config, dbPath } = await configured()
    const { candidate, decision } = await extracted(store, principal.userId)
    await promote(store, candidate, decision.id)
    const other = await extracted(store, principal.userId, ['本项目使用 Node.js 24。'])
    expect(await store.saveAgentMemoryCandidate(other.candidate)).toMatchObject({ committed: true })
    expect(await store.dismissAgentMemoryCandidate({ candidateId: other.candidate.id, actorId: principal.userId,
      expectedContentDigest: other.candidate.contentDigest, expectedProvenanceDigest: other.candidate.provenanceDigest,
      dismissedAt: '2026-10-22T12:00:01.000Z' })).toMatchObject({ dismissed: true, dismissal: { provenanceKind: 'learning_event' } })
    expect(await store.saveAgentMemoryCandidate(other.candidate)).toEqual({ committed: false, reason: 'dismissed' })
    await store.configureAutomaticMemory({ ...config, enabled: false })
    expect((await store.getAgentMemoryHead('memory-auto'))?.status).toBe('active')
    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect((await reopened.getAgentMemoryHead('memory-auto'))?.status).toBe('active')
    reopened.close()
  })
  it('forgets the remote event after deleting its formal memory and blocks the same source from replay', async () => {
    const { store, principal } = await configured()
    const { candidate, decision, event } = await extracted(store, principal.userId)
    const revision = await promote(store, candidate, decision.id)
    const head = (await store.getAgentMemoryHead(revision.id))!
    const actions = createAgentMemoryHumanActions({ store, clock: () => '2026-10-22T12:00:01.000Z' })
    await actions.delete({ localProjectId: project.id, memoryId: revision.id, expectedRevision: revision.revision,
      expectedHeadVersion: head.version, expectedContentDigest: revision.contentDigest, expectedProvenanceDigest: revision.provenanceDigest })
    expect((await store.getMemoryLearningEvent(event.id))?.revoked).toBe(true)
    expect((await store.listMemoryLearningJobs(project.id))[0]).toMatchObject({ revoked: true, payload: '', status: 'cleanup_pending' })
    expect((await store.getMemoryLearningFact(event.id, decision.factId))?.text).toBe('')
    expect(await store.getMemoryLearningDecision(decision.id)).toMatchObject({ statement: '', resolution: 'dismissed' })
    expect(await store.saveAgentMemoryCandidate(candidate)).toEqual({ committed: false, reason: 'source_not_found' })
    store.close()
  })
  it('migrates schema 39 without rewriting historical source rows or foreign keys', async () => {
    const dbPath = await databasePath()
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), file) })
    const retained = new SQL.Database()
    const hooks = { migrateWorkflowRunsIntoRelationalTables: () => undefined, afterMigrations: () => undefined }
    for (const migration of schemaMigrations.filter(item => item.version <= 39)) migration.migrate(retained, hooks)
    retained.run("insert into schema_meta(key,value) values('schema_version','39') on conflict(key) do update set value='39'")
    expect(retained.exec("select sql from sqlite_master where name='agent_memory_candidates'")[0]!.values[0]![0]).not.toContain('learning_event')
    const legacy = await createCodingRunMemoryCandidate({ id: 'legacy-coding-candidate', statement: 'Verified test command: pnpm test.',
      scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: project.id, userId: 'legacy-owner', sessionId: 'legacy-session' },
      provenance: { kind: 'coding_run', runId: 'legacy-run', nodeId: 'legacy-node', codingRunId: 'legacy-coding',
        testEvidenceId: 'legacy-test', diffArtifactId: 'legacy-diff', statementKind: 'test_command' }, createdAt: now })
    retained.run('insert into local_projects(id,json,created_at,updated_at) values(?,?,?,?)', [project.id, JSON.stringify(project), now, now])
    retained.run(`insert into agent_memory_candidates (
      id, scope_kind, local_project_id, organization_id, team_project_id, user_id, session_id, provenance_kind,
      runtime_id, action_id, checkpoint_version, observation_sequence, result_digest, coding_run_id,
      statement, content_digest, provenance_digest, status, state_version, json, created_at
    ) values(?, 'local', ?, null, null, ?, ?, 'coding_run', null, null, null, null, null, ?, ?, ?, ?, 'candidate', 1, ?, ?)`,
    [legacy.id, project.id, legacy.scope.userId, legacy.scope.sessionId, 'legacy-coding', legacy.statement,
      legacy.contentDigest, legacy.provenanceDigest, JSON.stringify(legacy), now])
    retained.run(`insert into agent_memory_candidate_dismissals values(?, 'local', ?, null, null, ?, ?, 'coding_run', ?, ?, ?, ?)`,
      [legacy.id, project.id, legacy.scope.userId, legacy.scope.sessionId, legacy.contentDigest, legacy.provenanceDigest, legacy.scope.userId, now])
    await writeFile(dbPath, Buffer.from(retained.export())); retained.close()
    const migrated = await createLocalStore({ dbPath }); expect(await migrated.getSchemaVersion()).toBe(40); migrated.close()
    const checked = new SQL.Database(await readFile(dbPath))
    expect(checked.exec('pragma foreign_key_check')).toEqual([])
    const parents = checked.exec('pragma foreign_key_list(agent_memory_revisions)')[0]!.values.map(row => row[2])
    expect(parents).toContain('agent_memory_candidates'); expect(parents).not.toContain('agent_memory_candidates_v39')
    expect(checked.exec('select json from agent_memory_candidates where id=?', [legacy.id])[0]!.values[0]![0]).toBe(JSON.stringify(legacy))
    expect(checked.exec('select provenance_kind, content_digest from agent_memory_candidate_dismissals where candidate_id=?', [legacy.id])[0]!.values)
      .toEqual([['coding_run', legacy.contentDigest]])
    checked.close()
  })
})
