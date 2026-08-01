import { describe, expect, it, vi } from 'vitest'
import {
  createFakeAgentProvider,
  type AgentEvent,
  type AgentProvider,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type LocalExecutionState,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { artifacts, knowledgeChunks, knowledgeDocuments, runs } from '@ai-devflow/shared/fixtures'
import {
  createKnowledgeReviewRuntime,
  type KnowledgeReviewRuntimeStore,
} from './knowledge-review-runtime'

describe('KnowledgeReviewRuntime', () => {
  it('fails closed for a paid provider when no budget guard is configured', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const resolveProvider = vi.fn()
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
      })),
      resolveProvider,
      now: () => '2026-07-31T11:59:00.000Z',
      createRequestId: () => 'review-request-no-guard',
    })

    await expect(runtime.run(reviewInput('team-openai'))).rejects.toThrow(
      /Knowledge Review blocked before provider call/i,
    )

    expect(resolveProvider).not.toHaveBeenCalled()
    expect(store.events).toEqual([
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('unavailable') }),
    ])
    expect(store.savedArtifacts).toEqual([])
    expect(store.reviews).toEqual([])
    expect(store.traces).toEqual([])
    expect(store.tokenUsage).toEqual([])
  })

  it('persists one redacted local error and never resolves the paid provider when budget blocks', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const resolveProvider = vi.fn(async (): Promise<AgentProvider> => {
      throw new Error('provider resolution must happen after budget authorization')
    })
    const budgetGuard = vi.fn(async () => {
      expect(resolveProvider).not.toHaveBeenCalled()
      return {
        status: 'unavailable' as const,
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.01,
        reason: 'Budget service failed with OPENAI_API_KEY=sk-private-key.',
      }
    })
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
      })),
      resolveProvider,
      budgetGuard,
      now: () => '2026-07-31T12:00:00.000Z',
      createRequestId: () => 'review-request-budget-blocked',
    })

    await expect(runtime.run({
      runId: fixtureRun.id,
      nodeId: fixtureRun.currentNodeId,
      projectId: fixtureRun.projectId,
      requestedBy: 'u-ling',
      runtime: 'electron',
      providerId: 'team-openai',
      runtimeBudgetApprovalId: 'approval-knowledge-1',
    })).rejects.toThrow(/Knowledge Review blocked before provider call.*restore the authenticated Team connection/i)

    expect(budgetGuard).toHaveBeenCalledWith(expect.objectContaining({
      projectId: fixtureRun.projectId,
      providerId: 'team-openai',
      requestedBy: 'u-ling',
      projectedCostUsd: expect.any(Number),
      approvalId: 'approval-knowledge-1',
    }))
    expect(resolveProvider).not.toHaveBeenCalled()
    expect(store.events).toEqual([
      expect.objectContaining({
        runId: fixtureRun.id,
        nodeId: fixtureRun.currentNodeId,
        sequence: 1,
        kind: 'error',
        message: expect.stringContaining('[REDACTED'),
      }),
    ])
    expect(JSON.stringify(store.events)).not.toContain('sk-private-key')
    expect(store.savedArtifacts).toEqual([])
    expect(store.reviews).toEqual([])
    expect(store.traces).toEqual([])
    expect(store.tokenUsage).toEqual([])
  })

  it('persists the completed fake Review bundle without directly uploading a summary', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const reviewKnowledge = vi.spyOn(provider, 'reviewKnowledge')
    const budgetGuard = vi.fn()
    const legacyDirectUpload = vi.fn()
    const runtimeDependencies = {
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: 'fake-knowledge-review',
        name: 'Deterministic Fake Provider',
        model: 'fake',
      })),
      resolveProvider: vi.fn(async () => provider),
      budgetGuard,
      uploadAgentReviewSummary: legacyDirectUpload,
      now: () => '2026-07-31T12:01:00.000Z',
      createRequestId: () => 'review-request-fake',
    }
    const runtime = createKnowledgeReviewRuntime(runtimeDependencies)

    const result = await runtime.run(reviewInput('fake-knowledge-review'))

    expect(budgetGuard).not.toHaveBeenCalled()
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(result.review.providerId).toBe('fake-knowledge-review')
    expect(store.savedArtifacts).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.events).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.reviews).toHaveLength(1)
    expect(store.traces).toHaveLength(1)
    expect(store.tokenUsage).toHaveLength(1)
    expect(legacyDirectUpload).not.toHaveBeenCalled()
  })

  it('records Electron as the trusted runtime instead of renderer-supplied provenance', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const provider = createFakeAgentProvider()
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => ({
        id: provider.id,
        name: provider.name,
        model: provider.model,
      })),
      resolveProvider: vi.fn(async () => provider),
      now: () => '2026-07-31T12:01:30.000Z',
      createRequestId: () => 'review-request-trusted-runtime',
    })

    const result = await runtime.run({ ...reviewInput(provider.id), runtime: 'api' })

    expect(result.review.runtime).toBe('electron')
  })

  it('resolves and calls a paid provider exactly once only after the budget guard allows it', async () => {
    const store = new MemoryKnowledgeReviewStore()
    const order: string[] = []
    const reviewKnowledge = vi.fn(async () => {
      order.push('provider-call')
      return {
        model: 'gpt-4.1-mini',
        conclusion: 'ready',
        summary: 'Budget-authorized Knowledge Review.',
        risks: [],
        missingEvidence: [],
        suggestedTests: ['Run focused tests.'],
        confidence: 0.91,
      }
    })
    const resolveProvider = vi.fn(async (): Promise<AgentProvider> => {
      order.push('resolve-secret')
      return {
        id: 'team-openai',
        name: 'Team OpenAI',
        model: 'gpt-4.1-mini',
        reviewKnowledge,
      }
    })
    const budgetGuard = vi.fn(async () => {
      order.push('budget')
      expect(resolveProvider).not.toHaveBeenCalled()
      return {
        status: 'allowed' as const,
        blocksRun: false,
        currentSpendUsd: 1,
        projectedCostUsd: 0.01,
        limitUsd: 20,
        reason: 'Within budget.',
      }
    })
    const runtime = createKnowledgeReviewRuntime({
      store,
      knowledgeDocuments,
      knowledgeChunks,
      resolveProviderMetadata: vi.fn(async () => {
        order.push('metadata')
        return {
          id: 'team-openai',
          name: 'Team OpenAI',
          model: 'gpt-4.1-mini',
        }
      }),
      resolveProvider,
      budgetGuard,
      now: () => '2026-07-31T12:02:00.000Z',
      createRequestId: () => 'review-request-paid',
    })

    const result = await runtime.run(reviewInput('team-openai'))

    expect(order).toEqual(['metadata', 'budget', 'resolve-secret', 'provider-call'])
    expect(resolveProvider).toHaveBeenCalledTimes(1)
    expect(reviewKnowledge).toHaveBeenCalledTimes(1)
    expect(result.review.summary).toBe('Budget-authorized Knowledge Review.')
    expect(store.savedArtifacts).toEqual([expect.objectContaining({ kind: 'agent_review' })])
    expect(store.reviews).toHaveLength(1)
    expect(store.traces).toHaveLength(1)
    expect(store.tokenUsage).toHaveLength(1)
  })
})

const fixtureRun = structuredClone(runs[0]!)

function reviewInput(providerId: string) {
  return {
    runId: fixtureRun.id,
    nodeId: fixtureRun.currentNodeId,
    projectId: fixtureRun.projectId,
    requestedBy: 'u-ling',
    runtime: 'electron' as const,
    providerId,
  }
}

class MemoryKnowledgeReviewStore implements KnowledgeReviewRuntimeStore {
  readonly events: AgentEvent[] = []
  readonly savedArtifacts: Artifact[] = []
  readonly reviews: AgentReviewResult[] = []
  readonly traces: AgentTrace[] = []
  readonly tokenUsage: AgentTokenUsage[] = []

  async listRuns(): Promise<WorkflowRun[]> {
    return [fixtureRun]
  }

  async listArtifacts(runId?: string): Promise<Artifact[]> {
    return artifacts.filter((artifact) => !runId || artifact.runId === runId)
  }

  async listTestEvidence(): Promise<TestEvidence[]> {
    return []
  }

  async listEvents(runId?: string): Promise<AgentEvent[]> {
    return this.events.filter((event) => !runId || event.runId === runId)
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.savedArtifacts.push(artifact)
  }

  async saveEvent(event: AgentEvent): Promise<void> {
    this.events.push(event)
  }

  async saveAgentReview(review: AgentReviewResult): Promise<void> {
    this.reviews.push(review)
  }

  async saveAgentTrace(trace: AgentTrace): Promise<void> {
    this.traces.push(trace)
  }

  async saveAgentTokenUsage(usage: AgentTokenUsage): Promise<void> {
    this.tokenUsage.push(usage)
  }

  async loadState(): Promise<LocalExecutionState> {
    return {} as LocalExecutionState
  }
}
