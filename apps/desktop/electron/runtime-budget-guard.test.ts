import { describe, expect, it, vi } from 'vitest'
import type { CodingRuntimeBudgetGuard } from './coding-runtime'
import { createRuntimeBudgetGuard } from './runtime-budget-guard'

describe('RuntimeBudgetGuard', () => {
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
