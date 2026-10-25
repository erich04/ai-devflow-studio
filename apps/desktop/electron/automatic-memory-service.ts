import type {
  AutomaticMemoryConfiguration, AutomaticMemoryDecision, AutomaticMemoryEvent, AutomaticMemoryFact,
} from '@ai-devflow/shared'
import type { HindsightClient } from './hindsight-client'
import { automaticMemoryDigest, type MemoryLearningClaim, type MemoryLearningSettlement } from './automatic-memory-store'

import { classifyMemoryLearningFact, type AutomaticMemoryExistingMemory } from './automatic-memory-policy'
export { classifyMemoryLearningFact } from './automatic-memory-policy'
export type { AutomaticMemoryExistingMemory } from './automatic-memory-policy'
export type AutomaticMemoryServiceStore = {
  getAutomaticMemoryConfiguration(projectId: string): Promise<AutomaticMemoryConfiguration | null>
  getMemoryLearningEvent(eventId: string): Promise<AutomaticMemoryEvent | null>
  claimMemoryLearningJob(now: string): Promise<MemoryLearningClaim | null>
  settleMemoryLearningJob(id: string, leaseToken: string, result: MemoryLearningSettlement, now: string, error?: string): Promise<void>
  listMemoryLearningFacts(eventId: string): Promise<AutomaticMemoryFact[]>
  listMemoryLearningDecisions(projectId?: string): Promise<AutomaticMemoryDecision[]>
  recordMemoryLearningExtraction(id: string, leaseToken: string, facts: AutomaticMemoryFact[]): Promise<boolean>
  recordMemoryLearningDecisions(id: string, leaseToken: string, decisions: AutomaticMemoryDecision[]): Promise<boolean>
  revokeMemoryLearningEvent(eventId: string, reason: string): Promise<void>
  recoverMemoryLearningJobs(): Promise<void>
}
export type AutomaticMemoryServiceDependencies = {
  store: AutomaticMemoryServiceStore
  client(configuration: AutomaticMemoryConfiguration): Promise<HindsightClient>
  /** Rereads durable sources and current host identity; also checks original Hindsight consent binding. */
  isSourceCurrent(event: AutomaticMemoryEvent, configuration: AutomaticMemoryConfiguration): Promise<boolean>
  existingMemories(event: AutomaticMemoryEvent): Promise<AutomaticMemoryExistingMemory[]>
  /** Must atomically revalidate source/generation, apply stored policy, and idempotently create formal revisions. */
  commit(event: AutomaticMemoryEvent, decisions: AutomaticMemoryDecision[]): Promise<void>
  now?: () => string
}
/** Host-owned worker. The staging bank is deliberately absent from every recall interface. */
export class AutomaticMemoryService {
  private running: Promise<number> | null = null
  private stopping = false
  private readonly configuredBanks = new Set<string>()
  constructor(private readonly deps: AutomaticMemoryServiceDependencies) {}
  private now(): string { return this.deps.now?.() ?? new Date().toISOString() }
  async recover(): Promise<void> { await this.deps.store.recoverMemoryLearningJobs() }
  async shutdown(): Promise<void> { this.stopping = true; await this.running }
  process(limit = 8): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) return Promise.reject(new Error('Invalid memory work limit'))
    if (this.stopping) return Promise.resolve(0)
    if (this.running) return this.running
    this.running = this.run(limit).finally(() => { this.running = null })
    return this.running
  }
  private async current(claim: MemoryLearningClaim): Promise<AutomaticMemoryEvent | null> {
    const config = await this.deps.store.getAutomaticMemoryConfiguration(claim.job.projectId)
    const event = await this.deps.store.getMemoryLearningEvent(claim.job.eventId)
    if (!config?.enabled || config.generation !== claim.job.generation || !event || event.revoked ||
        event.scope.userId !== config.ownerUserId || !(await this.deps.isSourceCurrent(event, config))) return null
    return event
  }
  private async run(limit: number): Promise<number> {
    let processed = 0
    for (; processed < limit; processed++) {
      if (this.stopping) break
      const claim = await this.deps.store.claimMemoryLearningJob(this.now())
      if (!claim) break
      try { await this.processClaim(claim) }
      catch (error) {
        // Never persist raw network/model errors or source contents.
        await this.deps.store.settleMemoryLearningJob(claim.job.id, claim.leaseToken, 'unknown', this.now(),
          error instanceof Error && error.message.startsWith('Hindsight ') ? error.message : 'automatic_memory_processing_failed')
      }
    }
    return processed
  }
  private async processClaim(claim: MemoryLearningClaim): Promise<void> {
    const { job, leaseToken, config } = claim
    const settle = (result: MemoryLearningSettlement, error?: string) => this.deps.store.settleMemoryLearningJob(job.id, leaseToken, result, this.now(), error)
    let event = job.revoked ? null : await this.current(claim)
    if (!job.revoked && !event) await this.deps.store.revokeMemoryLearningEvent(job.eventId, 'source_or_consent_changed')
    const client = await this.deps.client(config)
    if (job.revoked || !event) {
      if (!job.retainAttempts) { await settle('cleaned'); return }
      const operation = await client.operation(job.bankId, job.operationId)
      // Unknown/cancelled work may still complete later. Clear current document, then keep reconciling.
      await client.deleteDocument(job.bankId, job.documentId)
      await settle(['completed', 'failed'].includes(operation) ? 'cleaned' : 'unknown')
      return
    }
    if (claim.canSubmit) {
      if (!this.configuredBanks.has(job.bankId)) {
        await client.configureBank(job.bankId, [], 'concise')
        this.configuredBanks.add(job.bankId)
      }
      event = await this.current(claim)
      if (!event) { await this.deps.store.revokeMemoryLearningEvent(job.eventId, 'source_or_consent_changed'); await settle('unknown'); return }
      await client.retain(job.bankId, { documentId: job.documentId, operationId: job.operationId, content: job.payload, metadata: job.metadata })
      await settle('pending')
      return
    }
    let facts = await this.deps.store.listMemoryLearningFacts(job.eventId)
    if (job.status !== 'extracted' && facts.length === 0) {
      const operation = await client.operation(job.bankId, job.operationId)
      if (operation !== 'completed') { await settle(operation === 'not_found' ? 'retry' : ['pending', 'processing'].includes(operation) ? 'pending' : 'unknown'); return }
      const document = await client.getDocument(job.bankId, job.documentId)
      if (document.originalText !== job.payload || automaticMemoryDigest(document.originalText) !== job.payloadDigest ||
          Object.entries(job.metadata).some(([key, value]) => document.metadata[key] !== value)) throw new Error('Memory document provenance mismatch')
      const extracted = await client.listDocumentFacts(job.bankId, job.documentId, document.memoryUnitCount)
      // Offset pagination has no snapshot token. Re-read the document watermark and total before importing.
      const after = await client.getDocument(job.bankId, job.documentId)
      if (after.updatedAt !== document.updatedAt || after.contentHash !== document.contentHash ||
          after.memoryUnitCount !== extracted.length || after.originalText !== document.originalText ||
          extracted.some((fact) => Object.entries(job.metadata).some(([key, value]) => fact.metadata[key] !== value))) {
        throw new Error('Memory extraction changed or lost provenance')
      }
      event = await this.current(claim)
      if (!event) { await this.deps.store.revokeMemoryLearningEvent(job.eventId, 'source_or_consent_changed'); await settle('unknown'); return }
      facts = extracted.map((fact) => ({ id: `fact-${automaticMemoryDigest(`${event!.id}:${fact.id}`).slice(7)}`,
        eventId: event!.id, remoteFactId: fact.id, documentId: job.documentId, text: fact.text, factType: fact.factType,
        sourceDigest: event!.sourceDigest, contentDigest: automaticMemoryDigest(fact.text), extractedAt: this.now() }))
      if (!(await this.deps.store.recordMemoryLearningExtraction(job.id, leaseToken, facts))) { await settle('unknown'); return }
    }
    event = await this.current(claim)
    if (!event) { await this.deps.store.revokeMemoryLearningEvent(job.eventId, 'source_or_consent_changed'); await settle('unknown'); return }
    const saved = (await this.deps.store.listMemoryLearningDecisions(job.projectId)).filter((decision) => decision.eventId === job.eventId)
    const existing = await this.deps.existingMemories(event)
    const decisions = saved.length ? saved : facts.map((fact) => classifyMemoryLearningFact(event!, fact, existing, this.now()))
    if (!saved.length) {
      const seenStatements = new Set<string>()
      for (const decision of decisions) {
        if (decision.disposition !== 'auto_save' && decision.disposition !== 'rule_candidate') continue
        const sourceKey = decision.disposition === 'rule_candidate' ? decision.evidenceMaterialIds.join(':') : ''
        const statementKey = decision.disposition === 'rule_candidate'
          ? decision.statement.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '') : decision.statement.normalize('NFKC').trim()
        const key = `${decision.disposition}:${sourceKey}:${decision.semanticKey}:${statementKey}`
        if (seenStatements.has(key)) { decision.disposition = 'ignored'; decision.reason = 'duplicate_in_event' }
        else seenStatements.add(key)
      }
    }
    if (!(await this.deps.store.recordMemoryLearningDecisions(job.id, leaseToken, decisions))) { await settle('unknown'); return }
    if (!(await this.current(claim))) { await this.deps.store.revokeMemoryLearningEvent(job.eventId, 'source_or_consent_changed'); await settle('unknown'); return }
    await this.deps.commit(event, decisions)
    const finalDecisions = (await this.deps.store.listMemoryLearningDecisions(job.projectId)).filter((decision) => decision.eventId === job.eventId)
    await settle(finalDecisions.some((decision) => !decision.resolution && (decision.disposition === 'rule_candidate' || decision.disposition === 'conflict'))
      ? 'needs_confirmation' : finalDecisions.some((decision) => !decision.resolution && decision.disposition === 'auto_save') ? 'extracted'
        : finalDecisions.some((decision) => decision.resolution === 'saved') ? 'committed' : 'skipped')
  }
}
