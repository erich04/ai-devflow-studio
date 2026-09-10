import { describe, expect, it } from 'vitest'
import { createLocalStageAgentUsage, parseStageAgentUsage } from './stage-agent-usage'
import { formatCostRollup, resolveDeepSeekPricingSnapshot, rollupTokenUsage } from './cost'

const request = { id: 'usage-1', runId: 'run-1', nodeId: 'clarify', projectId: 'project-1', userId: 'user-1',
  providerId: 'deepseek', model: 'deepseek-v4-flash', timestamp: '2026-09-10T16:00:00.000Z',
  usage: { inputTokens: 15268, outputTokens: 1444, cacheReadTokens: 12416 } }

describe('Stage Agent usage accounting', () => {
  it('estimates trusted official DeepSeek usage at a saved peak rate and counts cached input once', () => {
    const usage = createLocalStageAgentUsage({ ...request, billingProvider: 'deepseek' })
    expect(usage).toMatchObject({ costStatus: 'estimated', source: 'provider_reported', usageStatus: 'complete',
      pricingSnapshot: { sourceVersion: 'deepseek-pricing-snapshot-2026-09-10', tier: 'peak' } })
    expect(usage.costUsd).toBeCloseTo((12416 * 0.006 + 2852 * 0.3 + 1444 * 1.2) / 1000000, 9)
    expect(rollupTokenUsage([usage], 'runId')[0]).toMatchObject({ totalTokens: 16712, estimatedCostCount: 1 })
    expect(formatCostRollup(rollupTokenUsage([usage], 'runId'))).toContain('预计')
  })
  it('keeps identical model names on unverified gateways unpriced', () => {
    const usage = createLocalStageAgentUsage(request)
    expect(usage.costUsd).toBeNull()
    const rollup = rollupTokenUsage([usage], 'runId')
    expect(rollup[0]).toMatchObject({ totalTokens: 16712, unknownCostCount: 1 })
    expect(formatCostRollup(rollup)).toBe('1 项金额待确认')
  })
  it('marks missing and partial telemetry without estimating unseen calls from prompt length', () => {
    expect(createLocalStageAgentUsage({ ...request, usage: null })).toMatchObject({ source: 'unknown', usageStatus: 'unknown', costUsd: null })
    expect(createLocalStageAgentUsage({ ...request, billingProvider: 'deepseek', usage: { ...request.usage, missingUsageCount: 1 } }))
      .toMatchObject({ inputTokens: 15268, usageStatus: 'partial', costUsd: null })
    expect(createLocalStageAgentUsage({ ...request, usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } }))
      .toMatchObject({ source: 'unknown', costUsd: null })
  })
  it('keeps historical pricing, refuses the uncertain release interval, and handles the announced Pro routing boundary', () => {
    const resolve = (model: string, timestamp: string) => resolveDeepSeekPricingSnapshot({ providerId: 'deepseek', model, timestamp, worstCase: true })
    expect(resolve('deepseek-v4-flash', '2026-09-07T16:00:00.000Z')?.cacheMissInputUsdPerMillion).toBe(0.44)
    expect(resolve('deepseek-v4-flash', '2026-09-10T10:00:00.000Z')).toBeNull()
    for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      expect(resolve(model, request.timestamp)?.cacheMissInputUsdPerMillion).toBe(0.3)
    }
    expect(resolve('deepseek-v4-pro', '2026-09-14T03:59:59.999Z')?.cacheMissInputUsdPerMillion).toBe(1.32)
    expect(resolve('deepseek-v4-pro', '2026-09-14T04:00:00.000Z')?.cacheMissInputUsdPerMillion).toBe(0.3)
  })
  it('bounds the cloud projection and rejects conflicting scope and invalid accounting', () => {
    const usage = createLocalStageAgentUsage(request)
    expect(parseStageAgentUsage([{ ...usage, apiKey: 'must-not-leave' }], request.runId, request.projectId)[0]).not.toHaveProperty('apiKey')
    const priced = createLocalStageAgentUsage({ ...request, billingProvider: 'deepseek' })
    expect(parseStageAgentUsage([priced], request.runId, request.projectId)).toEqual([priced])
    expect(() => parseStageAgentUsage([{ ...priced, pricingSnapshot: { ...priced.pricingSnapshot, outputUsdPerMillion: 0 } }], request.runId, request.projectId))
      .toThrow('Invalid stage Agent pricing snapshot')
    for (const rows of [[usage, usage], [{ ...usage, runId: 'other' }], [{ ...usage, costUsd: -1 }], [{ ...usage, costUsd: 0, usageStatus: 'unknown' }]]) {
      expect(() => parseStageAgentUsage(rows, request.runId, request.projectId)).toThrow('Invalid stage Agent usage')
    }
  })
})
