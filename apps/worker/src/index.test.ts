import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@ai-devflow/shared'
import { runCostRollupJob } from './index'

describe('worker cost rollup', () => {
  it('returns an empty rollup when no real token usage source is configured', () => {
    const rollup = runCostRollupJob()

    expect(rollup.projectCost).toEqual([])
    expect(rollup.memberCost).toEqual([])
    expect(Date.parse(rollup.generatedAt)).not.toBeNaN()
  })

  it('rolls up supplied token usage without importing demo fixtures', () => {
    const usage: TokenUsage[] = [
      {
        id: 'usage-1',
        runId: 'run-1',
        nodeId: 'node-1',
        userId: 'user-1',
        projectId: 'project-1',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        costUsd: 0.02,
        timestamp: '2026-06-30T00:00:00.000Z',
      },
    ]

    expect(runCostRollupJob(usage)).toMatchObject({
      projectCost: [{ key: 'project-1', costUsd: 0.02 }],
      memberCost: [{ key: 'user-1', costUsd: 0.02 }],
    })
  })
})
