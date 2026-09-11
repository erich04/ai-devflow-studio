import { describe, expect, it } from 'vitest'
import { createLocalStageAgentUsage } from '@ai-devflow/shared'
import { buildRunUsageSummary } from './run-usage-summary'

describe('Run usage display', () => {
  it('distinguishes empty history from reported consumption with unknown cost and excludes other Runs', () => {
    const row = createLocalStageAgentUsage({ id: 'usage', runId: 'run', nodeId: 'clarify', projectId: 'project', userId: 'user',
      providerId: 'gateway', model: 'model', timestamp: '2026-09-10T16:00:00.000Z',
      usage: { inputTokens: 15268, outputTokens: 1444, cacheReadTokens: 12416 } })
    expect(buildRunUsageSummary('run', [row, { ...row, id: 'other', runId: 'other' }], [], []))
      .toMatchObject({ tokenLabel: '16,712', costLabel: '1 项金额待确认', unknownCostCount: 1 })
    expect(buildRunUsageSummary('run', [], [], []).costLabel).toBe('暂无用量记录')
  })
  it('does not treat a historical unaccounted OpenCode trace as a free run', () => {
    const summary = buildRunUsageSummary('run', [], [], [{ id: 'trace', runId: 'run', nodeId: 'clarify', reviewId: 'stage-agent-failure-old',
      runtime: 'electron', createdAt: '2026-09-10T10:00:00.000Z', steps: [{ id: 'step', kind: 'provider_call', label: 'Run local-agent', summary: 'Failed', timestamp: '2026-09-10T10:00:00.000Z' }] }])
    expect(summary).toMatchObject({ costLabel: '1 项金额待确认', tokenLabel: '0 + 1 项用量不完整' })
  })
})
