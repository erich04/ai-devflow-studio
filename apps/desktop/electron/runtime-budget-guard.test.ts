import { describe, expect, it, vi } from 'vitest'
import type { CodingRuntimeBudgetGuard } from './coding-runtime'
import {
  createKnowledgeReviewRuntimeBudgetGuard,
  createRuntimeBudgetGuard,
} from './runtime-budget-guard'

describe('RuntimeBudgetGuard', () => {
  it('turns an unavailable Knowledge Review budget service into a generic blocking decision', async () => {
    const evaluateRuntimeBudget = vi.fn(async () => {
      throw new Error('malformed response exposed Authorization: Bearer private-token')
    })
    const guard = createKnowledgeReviewRuntimeBudgetGuard({ evaluateRuntimeBudget })

    const decision = await guard({
      projectId: 'local-project-1',
      providerId: 'team-openai',
      requestedBy: 'user-1',
      projectedCostUsd: 0.02,
      approvalId: 'approval-knowledge-1',
    })

    expect(evaluateRuntimeBudget).toHaveBeenCalledWith({
      projectId: 'local-project-1',
      providerId: 'team-openai',
      projectedCostUsd: 0.02,
      approvalId: 'approval-knowledge-1',
    })
    expect(decision).toEqual({
      status: 'unavailable',
      blocksRun: true,
      currentSpendUsd: 0,
      projectedCostUsd: 0.02,
      reason: 'Runtime budget decision is unavailable. Pair the project and restore the authenticated Team API connection before retrying.',
    })
    expect(JSON.stringify(decision)).not.toContain('private-token')
  })

  it('still evaluates a real engine remotely when its rounded estimate is zero', async () => {
    const authoritativeDecision = {
      status: 'allowed' as const,
      blocksRun: false,
      currentSpendUsd: 0,
      projectedCostUsd: 0,
      limitUsd: 1,
      reason: 'Authoritative policy allows the real provider call.',
    }
    const evaluateRuntimeBudget = vi.fn(async () => authoritativeDecision)
    const guard = createRuntimeBudgetGuard({ evaluateRuntimeBudget })
    const input = paidRuntimeInput()

    const decision = await guard({
      ...input,
      estimatedCost: { ...input.estimatedCost, costUsd: 0 },
    })

    expect(evaluateRuntimeBudget).toHaveBeenCalledWith({
      projectId: 'local-project-1',
      providerId: 'double',
      projectedCostUsd: 0,
    })
    expect(decision).toEqual(authoritativeDecision)
  })

  it('does not let a metered native provider inherit the deterministic fake-engine bypass', async () => {
    const authoritativeDecision = {
      status: 'allowed' as const,
      blocksRun: false,
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
      limitUsd: 1,
      reason: 'Authoritative policy allows the bounded native provider call.',
    }
    const evaluateRuntimeBudget = vi.fn(async () => authoritativeDecision)
    const guard = createRuntimeBudgetGuard({ evaluateRuntimeBudget })

    await expect(guard({ ...paidRuntimeInput(), engine: 'fake' })).resolves.toEqual(
      authoritativeDecision,
    )
    expect(evaluateRuntimeBudget).toHaveBeenCalledOnce()
  })

  it('blocks paid runtime when the authoritative team budget decision is unavailable', async () => {
    const evaluateRuntimeBudget = vi.fn(async () => {
      throw new Error('remote response included private infrastructure details')
    })
    const guard = createRuntimeBudgetGuard({ evaluateRuntimeBudget })

    const decision = await guard(paidRuntimeInput())

    expect(evaluateRuntimeBudget).toHaveBeenCalledWith({
      projectId: 'local-project-1',
      providerId: 'double',
      projectedCostUsd: 0.01,
    })
    expect(decision).toEqual({
      status: 'unavailable',
      blocksRun: true,
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
      reason: 'Runtime budget decision is unavailable. Pair the project and restore the authenticated Team API connection before retrying.',
    })
    expect(decision.reason).not.toContain('private infrastructure')
  })
})

function paidRuntimeInput(): Parameters<CodingRuntimeBudgetGuard>[0] {
  return {
    codingRunId: 'coding-run-1',
    engine: 'opencode-http',
    metered: true,
    providerId: 'double',
    model: 'ark-code-latest',
    project: {
      id: 'local-project-1',
      name: 'Fixture project',
      path: '/workspace/fixture',
      packageManager: 'pnpm',
      detectedTestCommand: 'pnpm test',
      testCommand: 'pnpm test',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    run: {
      id: 'run-1',
      version: 1,
      title: 'Fixture run',
      request: 'Exercise the paid budget guard.',
      projectId: 'local-project-1',
      creatorId: 'user-1',
      status: 'building',
      currentNodeId: 'node-build',
      branchName: 'ai/fixture',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      nodes: [
        {
          id: 'node-build',
          stage: 'build',
          title: 'Build',
          subtitle: 'Implement the change.',
          kind: 'task',
          status: 'running',
          ownerId: 'user-1',
          retryCount: 0,
          artifactIds: [],
        },
      ],
      edges: [],
    },
    node: {
      id: 'node-build',
      stage: 'build',
      title: 'Build',
      subtitle: 'Implement the change.',
      kind: 'task',
      status: 'running',
      ownerId: 'user-1',
      retryCount: 0,
      artifactIds: [],
    },
    requestedBy: 'user-1',
    estimatedCost: {
      id: 'cost-1',
      runId: 'run-1',
      nodeId: 'node-build',
      userId: 'user-1',
      projectId: 'local-project-1',
      provider: 'openai',
      providerId: 'double',
      model: 'ark-code-latest',
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.01,
      timestamp: '2026-07-31T00:00:00.000Z',
      source: 'estimated',
      redacted: true,
    },
  }
}
