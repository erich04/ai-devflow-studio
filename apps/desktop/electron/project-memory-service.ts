import {
  PROJECT_KNOWLEDGE_PAGE_REFRESH_SECONDS, PROJECT_KNOWLEDGE_PAGES, PROJECT_MEMORY_MISSIONS, PROJECT_MEMORY_POLICY_VERSION,
  type ProjectKnowledgePageId, type ProjectMemoryConfiguration,
} from '@ai-devflow/shared'
import { HindsightError, type HindsightClient, type HindsightMentalModelDefinition } from './hindsight-client'
import type { ProjectMemoryClaim, ProjectMemorySettlement } from './project-memory-store'

export const knowledgePageModelId = (id: ProjectKnowledgePageId) => `devflow-${id}`
/** Rewritten after consolidation, at most hourly, editing only what changed; never reading other pages. */
export const KNOWLEDGE_PAGE_MODELS: readonly HindsightMentalModelDefinition[] = PROJECT_KNOWLEDGE_PAGES.map((page) => ({
  id: knowledgePageModelId(page.id), name: page.title, sourceQuery: page.query, maxTokens: 1_500,
  trigger: { mode: 'delta', refresh_after_consolidation: true, min_refresh_interval_seconds: PROJECT_KNOWLEDGE_PAGE_REFRESH_SECONDS,
    exclude_mental_models: true, budget: 'low' },
}))
/** Empties every knowledge page of a bank, without a model call, so none shows memory that was just removed. */
export async function clearKnowledgePages(client: HindsightClient, bankId: string): Promise<void> {
  for (const page of KNOWLEDGE_PAGE_MODELS) await client.clearMentalModel(bankId, page.id)
}

export type ProjectMemoryServiceStore = {
  listProjectMemoryConfigurations(): Promise<ProjectMemoryConfiguration[]>
  completeProjectMemoryBankDeletion(projectId: string, bankId: string): Promise<void>
  claimProjectMemoryDocument(now: string, options?: { submit?: boolean }): Promise<ProjectMemoryClaim | null>
  settleProjectMemoryDocument(id: string, leaseToken: string, result: ProjectMemorySettlement, now: string, error?: string): Promise<void>
  recoverProjectMemoryDocuments(): Promise<void>
}
export type ProjectMemoryServiceDependencies = {
  store: ProjectMemoryServiceStore
  client(configuration: ProjectMemoryConfiguration): Promise<HindsightClient>
  /**
   * False while Hindsight's model calls cannot reach DevFlow's relay: a retain sent now would
   * fail extraction and spend an attempt. Polls and deletions continue.
   */
  canSubmit?: () => boolean
  now?: () => string
}

/**
 * Background worker that sends captured documents to the project's Hindsight bank. Hindsight
 * extracts and consolidates them itself; nothing comes back for review (ADR 0030).
 */
export class ProjectMemoryService {
  private running: Promise<number> | null = null
  private stopping = false
  private readonly configuredBanks = new Set<string>()
  private readonly pagedBanks = new Set<string>()
  constructor(private readonly deps: ProjectMemoryServiceDependencies) {}
  private now(): string { return this.deps.now?.() ?? new Date().toISOString() }
  async recover(): Promise<void> { await this.deps.store.recoverProjectMemoryDocuments() }
  async shutdown(): Promise<void> { this.stopping = true; await this.running }
  process(limit = 4): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) return Promise.reject(new Error('Invalid memory work limit'))
    if (this.stopping) return Promise.resolve(0)
    if (this.running) return this.running
    this.running = this.run(limit).finally(() => { this.running = null })
    return this.running
  }
  /** Banks of cleared generations. Until deleted they are never recalled; deletion is retried each cycle. */
  private async deletePendingBanks(): Promise<void> {
    for (const config of await this.deps.store.listProjectMemoryConfigurations()) {
      for (const bankId of config.pendingBankDeletions ?? []) {
        if (this.stopping) return
        try {
          await (await this.deps.client(config)).deleteBank(bankId)
          await this.deps.store.completeProjectMemoryBankDeletion(config.projectId, bankId)
        } catch { /* Hindsight unavailable: try again on the next cycle. */ }
      }
    }
  }
  private async configure(client: HindsightClient, bankId: string): Promise<void> {
    if (this.configuredBanks.has(bankId)) return
    await client.configureMemoryBank(bankId, PROJECT_MEMORY_MISSIONS)
    this.configuredBanks.add(bankId)
  }
  /**
   * Every enabled bank gets DevFlow's knowledge pages, checked once per app run. Creating a page in
   * a bank that already has memories writes it at once (a model call), so this waits for the relay.
   */
  private async ensurePages(): Promise<void> {
    if (!(this.deps.canSubmit?.() ?? true)) return
    for (const config of await this.deps.store.listProjectMemoryConfigurations()) {
      if (this.stopping) return
      if (!config.enabled || this.pagedBanks.has(config.bankId)) continue
      try {
        const client = await this.deps.client(config)
        await this.configure(client, config.bankId)
        for (const page of KNOWLEDGE_PAGE_MODELS) await client.ensureMentalModel(config.bankId, page)
        this.pagedBanks.add(config.bankId)
      } catch { /* Hindsight unavailable: try again on the next cycle. */ }
    }
  }
  private async run(limit: number): Promise<number> {
    await this.deletePendingBanks()
    await this.ensurePages()
    let processed = 0
    for (; processed < limit && !this.stopping; processed++) {
      const claim = await this.deps.store.claimProjectMemoryDocument(this.now(), { submit: this.deps.canSubmit?.() ?? true })
      if (!claim) break
      try { await this.handle(claim) }
      catch (error) {
        // Never store raw transport errors or document text.
        await this.deps.store.settleProjectMemoryDocument(claim.document.id, claim.leaseToken, 'unknown', this.now(),
          error instanceof HindsightError ? error.message : 'project_memory_processing_failed')
      }
    }
    return processed
  }
  private async handle(claim: ProjectMemoryClaim): Promise<void> {
    const { document, config, leaseToken } = claim
    const settle = (result: ProjectMemorySettlement, error?: string) =>
      this.deps.store.settleProjectMemoryDocument(document.id, leaseToken, result, this.now(), error)
    const client = await this.deps.client(config)
    if (claim.action === 'delete') {
      // A retain still running could recreate the document after this delete; keep polling until it ends.
      const operation = document.attempts > 0 ? await client.operation(document.bankId, document.operationId) : 'not_found'
      await client.deleteDocument(document.bankId, document.documentId)
      const deleted = ['completed', 'failed', 'cancelled', 'not_found'].includes(operation)
      // A page rewritten before the document was gone may still contain it; empty the pages once more.
      if (deleted && document.attempts > 0) await clearKnowledgePages(client, document.bankId)
      await settle(deleted ? 'deleted' : 'unknown')
      return
    }
    if (claim.action === 'submit') {
      try {
        await this.configure(client, document.bankId)
        await client.retainDocument(document.bankId, {
          documentId: document.documentId, operationId: document.operationId, content: document.payload,
          context: document.context, timestamp: document.occurredAt, tags: document.tags,
          metadata: { df_document: document.id, df_source_kind: document.sourceKind, df_source_id: document.sourceId,
            df_digest: document.contentDigest, df_policy: PROJECT_MEMORY_POLICY_VERSION },
        })
      } catch (error) {
        // A rejected request was not accepted: count it, so a permanent rejection ends in `failed`.
        // A timeout or transport failure may have been received; it is polled, not resent.
        if (error instanceof HindsightError && error.code === 'http' && error.status !== undefined && error.status < 500) {
          await settle('retry', `hindsight_http_${error.status}`); return
        }
        throw error
      }
      await settle('pending')
      return
    }
    const operation = await client.operation(document.bankId, document.operationId)
    await settle(operation === 'completed' ? 'retained' : operation === 'pending' || operation === 'processing' ? 'pending'
      : operation === 'not_found' ? 'resend' : 'retry', operation === 'failed' || operation === 'cancelled' ? `hindsight_operation_${operation}` : undefined)
  }
}
