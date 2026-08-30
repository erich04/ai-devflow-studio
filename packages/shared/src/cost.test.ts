import { describe, expect, it } from 'vitest'
import {
  DEEPSEEK_PRICING_EFFECTIVE_AT,
  aggregateCodingRuntimeCostSettlements,
  annotateUnknownRuntimeCosts,
  estimateCodingRuntimeCost,
  evaluateRuntimeBudgetGuard,
  parseBudgetGuardDecision,
  runtimeCostSummaryToTokenUsage,
  isDeepSeekPeakTime,
  resolveDeepSeekPricingSnapshot,
  settleCodingRuntimeCost,
} from './cost'
import type { RuntimeBudgetApproval, RuntimeBudgetPolicy } from './domain'

describe('estimateCodingRuntimeCost', () => {
  it('reserves the exact bounded call and output envelope for a metered native repair loop', () => {
    const oneCall = estimateCodingRuntimeCost({
      engine: 'fake',
      noCost: false,
      providerId: 'team-openai',
      model: 'gpt-native-coding',
      prompt: '12345678',
      maxOutputTokens: 1_024,
      providerCallLimit: 3,
      runId: 'run-native-metered',
      nodeId: 'node-native-metered',
      projectId: 'project-native-metered',
      userId: 'user-native-metered',
      timestamp: '2026-08-12T23:00:00.000Z',
    })
    expect(oneCall).toMatchObject({
      inputTokens: 6,
      outputTokens: 3_072,
      provider: 'openai',
      source: 'estimated',
    })
    expect(oneCall.costUsd).toBeGreaterThan(0)
  })

  it('keeps the deterministic fake coding engine cost-free', () => {
    const summary = estimateCodingRuntimeCost({
      engine: 'fake',
      providerId: 'fake-coding-engine',
      model: 'fake',
      prompt: 'large prompt that should not matter for fake verification',
      outputText: 'fake output',
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-06-20T00:00:00.000Z',
    })

    expect(summary).toMatchObject({
      provider: 'local',
      providerId: 'fake-coding-engine',
      model: 'fake',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      source: 'estimated',
      redacted: true,
    })
  })

  it('estimates OpenAI-compatible coding runtime cost without storing raw prompt text', () => {
    const summary = estimateCodingRuntimeCost({
      engine: 'opencode-http',
      providerId: 'double',
      model: 'ark-code-latest',
      prompt: 'Implement the retry plan using the policy context.',
      outputText: 'Updated files and tests.',
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-06-20T00:00:00.000Z',
    })

    expect(summary.provider).toBe('openai')
    expect(summary.inputTokens).toBeGreaterThan(0)
    expect(summary.outputTokens).toBeGreaterThan(0)
    expect(summary.costUsd).toBeGreaterThan(0)
    expect(JSON.stringify(summary)).not.toContain('Implement the retry plan')
  })

  it('does not treat a real engine as free because its provider id contains fake', () => {
    const summary = estimateCodingRuntimeCost({
      engine: 'opencode-http',
      providerId: 'notfake-paid-provider',
      model: 'paid-model',
      prompt: 'This real provider call must pass the authoritative budget service.',
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-07-31T00:00:00.000Z',
    })

    expect(summary.costUsd).toBeGreaterThan(0)
  })
})

describe('parseBudgetGuardDecision', () => {
  it('returns only the whitelisted budget decision fields', () => {
    const decision = parseBudgetGuardDecision({
      status: 'allowed',
      blocksRun: false,
      currentSpendUsd: 0.1,
      projectedCostUsd: 0.01,
      limitUsd: 1,
      reason: 'Within budget.',
      internalDebugToken: 'must-not-cross-the-boundary',
    })

    expect(decision).toEqual({
      status: 'allowed',
      blocksRun: false,
      currentSpendUsd: 0.1,
      projectedCostUsd: 0.01,
      limitUsd: 1,
      reason: 'Within budget.',
    })
    expect('internalDebugToken' in decision).toBe(false)
  })

  it.each([
    {
      label: 'a lead-approval decision without the required role',
      value: {
        status: 'requires_lead_approval',
        blocksRun: true,
        currentSpendUsd: 1,
        projectedCostUsd: 0.1,
        reason: 'Approval required.',
      },
    },
    {
      label: 'an allowed decision carrying unrelated approval metadata',
      value: {
        status: 'allowed',
        blocksRun: false,
        currentSpendUsd: 0,
        projectedCostUsd: 0.1,
        approvalId: 'approval-from-another-decision',
        reason: 'Within budget.',
      },
    },
  ])('rejects $label', ({ value }) => {
    expect(() => parseBudgetGuardDecision(value)).toThrow('Invalid runtime budget decision')
  })
})

describe('evaluateRuntimeBudgetGuard', () => {
  const policy: RuntimeBudgetPolicy = {
    projectId: 'project-1',
    enabled: true,
    monthlyLimitUsd: 1,
    warningThresholdUsd: 0.75,
    currency: 'USD',
    updatedAt: '2026-06-20T00:00:00.000Z',
  }

  it('blocks paid runtime when the project budget policy is unavailable', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy: null,
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'unavailable',
      blocksRun: true,
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
    })
  })

  it('allows runtime when a project lead explicitly saved a disabled budget policy', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy: { ...policy, enabled: false },
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'disabled',
      blocksRun: false,
    })
  })

  it('does not apply a disabled budget policy from a different project', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy: { ...policy, projectId: 'project-2', enabled: false },
      currentSpendUsd: 0,
      projectedCostUsd: 0.01,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'unavailable',
      blocksRun: true,
    })
  })

  it('allows runs below the warning threshold', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy,
      currentSpendUsd: 0.4,
      projectedCostUsd: 0.1,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'allowed',
      blocksRun: false,
      currentSpendUsd: 0.4,
      projectedCostUsd: 0.1,
    })
  })

  it('warns when spend enters the project threshold but remains below the hard limit', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy,
      currentSpendUsd: 0.7,
      projectedCostUsd: 0.1,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision.status).toBe('warning')
    expect(decision.blocksRun).toBe(false)
  })

  it('requires a lead approval before continuing beyond the project limit', () => {
    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'double',
      policy,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      requestedBy: 'user-1',
      now: '2026-06-20T00:00:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'requires_lead_approval',
      blocksRun: true,
      approvalRequiredRole: 'lead',
    })
  })

  it.each(['owner', 'lead'] as const)(
    'accepts a non-expired %s approval that covers the projected additional cost',
    (role) => {
      const approval: RuntimeBudgetApproval = {
        id: 'budget-approval-1',
        projectId: 'project-1',
        requestedBy: 'user-1',
        approvedBy: `${role}-1`,
        role,
        providerId: 'double',
        maxAdditionalCostUsd: 0.25,
        reason: 'Release smoke is approved.',
        status: 'approved',
        createdAt: '2026-06-20T00:00:00.000Z',
        expiresAt: '2026-06-20T01:00:00.000Z',
      }

      const decision = evaluateRuntimeBudgetGuard({
        projectId: 'project-1',
        providerId: 'double',
        policy,
        currentSpendUsd: 0.95,
        projectedCostUsd: 0.2,
        requestedBy: 'user-1',
        approval,
        now: '2026-06-20T00:30:00.000Z',
      })

      expect(decision).toMatchObject({
        status: 'approved_over_budget',
        blocksRun: false,
        approvalId: 'budget-approval-1',
      })
    },
  )

  it('rejects a lead approval issued for a different project', () => {
    const approval: RuntimeBudgetApproval = {
      id: 'budget-approval-1',
      projectId: 'project-1',
      requestedBy: 'user-1',
      approvedBy: 'lead-1',
      role: 'lead',
      providerId: 'double',
      maxAdditionalCostUsd: 0.25,
      reason: 'Release smoke is approved.',
      status: 'approved',
      createdAt: '2026-06-20T00:00:00.000Z',
      expiresAt: '2026-06-20T01:00:00.000Z',
    }

    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-2',
      providerId: 'double',
      policy: { ...policy, projectId: 'project-2' },
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      requestedBy: 'user-1',
      approval,
      now: '2026-06-20T00:30:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'requires_lead_approval',
      blocksRun: true,
    })
  })

  it('rejects a lead approval issued for a different provider', () => {
    const approval: RuntimeBudgetApproval = {
      id: 'budget-approval-1',
      projectId: 'project-1',
      requestedBy: 'user-1',
      approvedBy: 'lead-1',
      role: 'lead',
      providerId: 'double',
      maxAdditionalCostUsd: 0.25,
      reason: 'Release smoke is approved.',
      status: 'approved',
      createdAt: '2026-06-20T00:00:00.000Z',
      expiresAt: '2026-06-20T01:00:00.000Z',
    }

    const decision = evaluateRuntimeBudgetGuard({
      projectId: 'project-1',
      providerId: 'another-provider',
      policy,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      requestedBy: 'user-1',
      approval,
      now: '2026-06-20T00:30:00.000Z',
    })

    expect(decision).toMatchObject({
      status: 'requires_lead_approval',
      blocksRun: true,
    })
  })
})

describe('runtimeCostSummaryToTokenUsage', () => {
  it('converts a redacted coding cost summary into token usage for rollups', () => {
    const usage = runtimeCostSummaryToTokenUsage({
      id: 'coding-runtime-cost-run-1-node-1',
      provider: 'openai',
      providerId: 'double',
      model: 'ark-code-latest',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheMissTokens: 100,
      usageStatus: 'complete',
      costStatus: 'settled',
      phase: 'provider_settlement',
      costUsd: 0.012,
      source: 'provider_reported',
      redacted: true,
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-06-20T00:00:00.000Z',
    })

    expect(usage).toMatchObject({
      id: 'coding-runtime-cost-run-1-node-1',
      provider: 'openai',
      model: 'ark-code-latest',
      costUsd: 0.012,
    })
  })

  it('does not roll preflight estimates or legacy unverified costs into actual spend', () => {
    const base = {
      id: 'coding-runtime-cost-run-1-node-1',
      provider: 'openai' as const,
      providerId: 'double',
      model: 'ark-code-latest',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      costUsd: 0.012,
      source: 'estimated' as const,
      redacted: true as const,
      runId: 'run-1',
      nodeId: 'node-1',
      projectId: 'project-1',
      userId: 'user-1',
      timestamp: '2026-06-20T00:00:00.000Z',
    }
    const preflight = {
      ...base,
      usageStatus: 'estimated',
      costStatus: 'estimated',
      phase: 'preflight_estimate',
    } as const
    expect(runtimeCostSummaryToTokenUsage(preflight)).toBeNull()
    expect(annotateUnknownRuntimeCosts([], [preflight], 'projectId')).toEqual([])
    expect(runtimeCostSummaryToTokenUsage({
      ...base,
      cacheReadTokens: null,
      usageStatus: 'legacy_unknown',
      costStatus: 'legacy_unverified',
    })).toBeNull()
  })
})

describe('DeepSeek runtime settlement', () => {
  const scope = {
    providerId: 'deepseek-production',
    model: 'deepseek-v4-flash',
    runId: 'run-deepseek',
    nodeId: 'node-build',
    projectId: 'project-1',
    userId: 'user-1',
  }

  it.each([
    ['2026-08-31T00:59:59.999Z', false],
    ['2026-08-31T01:00:00.000Z', true],
    ['2026-08-31T03:59:59.999Z', true],
    ['2026-08-31T04:00:00.000Z', false],
    ['2026-08-31T06:00:00.000Z', true],
    ['2026-08-31T09:59:59.999Z', true],
    ['2026-08-31T10:00:00.000Z', false],
    ['2026-08-30T02:00:00.000Z', false],
    ['2026-08-29T07:00:00.000Z', false],
  ])('selects official weekday peak boundaries for %s', (timestamp, expected) => {
    expect(isDeepSeekPeakTime(timestamp)).toBe(expected)
  })

  it('uses an all-miss peak envelope for preflight even during off-peak hours', () => {
    const estimate = estimateCodingRuntimeCost({
      engine: 'native',
      providerId: scope.providerId,
      model: scope.model,
      billingProvider: 'deepseek',
      prompt: '1234',
      maxOutputTokens: 100,
      providerCallLimit: 1,
      runId: scope.runId,
      nodeId: scope.nodeId,
      projectId: scope.projectId,
      userId: scope.userId,
      timestamp: '2026-08-31T00:30:00.000Z',
    })
    expect(estimate).toMatchObject({
      phase: 'preflight_estimate',
      usageStatus: 'estimated',
      costStatus: 'estimated',
      cacheReadTokens: 0,
      cacheMissTokens: 1,
      pricingSnapshot: { tier: 'peak' },
    })
    expect(estimate.costUsd).toBe(0.00013244)
  })

  it('does not use the DeepSeek preflight catalog for a compatible gateway exposing that model', () => {
    const estimate = estimateCodingRuntimeCost({
      engine: 'native',
      providerId: 'compatible-gateway',
      model: scope.model,
      billingProvider: 'openai_compatible',
      prompt: '1234',
      maxOutputTokens: 100,
      providerCallLimit: 1,
      runId: scope.runId,
      nodeId: scope.nodeId,
      projectId: scope.projectId,
      userId: scope.userId,
      timestamp: '2026-08-31T01:00:00.000Z',
    })

    expect(estimate.pricingSnapshot).toMatchObject({ tier: 'legacy_estimate' })
    expect(estimate.pricingSnapshot?.source).toContain('legacy-openai-compatible')
  })

  it('settles full miss, mixed cache, and full hit without double counting prompt tokens', () => {
    const fullMiss = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T00:30:00.000Z',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheMissTokens: 1_000_000,
        totalTokens: 2_000_000,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
    expect(fullMiss).toMatchObject({
      totalTokens: 2_000_000,
      cacheHitRate: 0,
      usageStatus: 'complete',
      costStatus: 'settled',
      costUsd: 0.88,
      breakdown: {
        cacheHitInputUsd: 0,
        cacheMissInputUsd: 0.22,
        outputUsd: 0.66,
        totalUsd: 0.88,
      },
      pricingSnapshot: { tier: 'off_peak' },
    })

    const mixed = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T00:30:00.000Z',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 400_000,
        cacheMissTokens: 600_000,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
    expect(mixed).toMatchObject({
      totalTokens: 1_100_000,
      cacheHitRate: 0.4,
      costUsd: 0.2008,
      breakdown: {
        cacheHitInputUsd: 0.0028,
        cacheMissInputUsd: 0.132,
        outputUsd: 0.066,
        totalUsd: 0.2008,
      },
    })

    const fullHit = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T01:00:00.000Z',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheMissTokens: 0,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
    expect(fullHit).toMatchObject({
      totalTokens: 1_000_000,
      cacheHitRate: 1,
      costUsd: 0.014,
      pricingSnapshot: { tier: 'peak' },
    })
  })

  it('does not apply DeepSeek prices to the same model name reported by another billing provider', () => {
    const result = settleCodingRuntimeCost({
      ...scope,
      providerId: 'compatible-gateway',
      timestamp: '2026-08-31T01:00:00.000Z',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheMissTokens: 80,
        cacheStatus: 'complete',
        billingProvider: 'openai_compatible',
      },
    })

    expect(result).toMatchObject({
      usageStatus: 'complete',
      costStatus: 'unknown',
      costUsd: null,
      pricingSnapshot: null,
      breakdown: null,
    })
  })

  it('keeps missing cache split and unknown model cost explicitly unknown', () => {
    const missingSplit = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T01:00:00.000Z',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheStatus: 'unknown',
        billingProvider: 'deepseek',
      },
    })
    expect(missingSplit).toMatchObject({
      cacheReadTokens: null,
      cacheMissTokens: null,
      usageStatus: 'incomplete',
      costStatus: 'unknown',
      costUsd: null,
      breakdown: null,
    })
    expect(runtimeCostSummaryToTokenUsage(missingSplit)).toBeNull()

    const unknownModel = settleCodingRuntimeCost({
      ...scope,
      model: 'deepseek-future-model',
      timestamp: '2026-08-31T01:00:00.000Z',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheMissTokens: 80,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
    expect(unknownModel).toMatchObject({
      usageStatus: 'complete',
      costStatus: 'unknown',
      costUsd: null,
      pricingSnapshot: null,
    })
    expect(
      annotateUnknownRuntimeCosts([], [missingSplit, unknownModel], 'projectId'),
    ).toEqual([
      {
        key: 'project-1',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        unknownCostCount: 2,
      },
    ])
  })

  it('does not apply the catalog before its official 2026-08-16 16:00 UTC effective boundary', () => {
    expect(
      resolveDeepSeekPricingSnapshot({
        providerId: scope.providerId,
        model: scope.model,
        timestamp: '2026-08-16T15:59:59.999Z',
      }),
    ).toBeNull()
    expect(Date.parse(DEEPSEEK_PRICING_EFFECTIVE_AT)).toBe(
      Date.parse('2026-08-16T16:00:00.000Z'),
    )
    expect(
      resolveDeepSeekPricingSnapshot({
        providerId: scope.providerId,
        model: scope.model,
        timestamp: '2026-08-16T16:00:00.000Z',
      }),
    ).not.toBeNull()
  })

  it('keeps each provider call on its request-time price instead of repricing the aggregate', () => {
    const peak = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T09:59:59.999Z',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheMissTokens: 1_000_000,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })
    const offPeak = settleCodingRuntimeCost({
      ...scope,
      timestamp: '2026-08-31T10:00:00.000Z',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheMissTokens: 1_000_000,
        cacheStatus: 'complete',
        billingProvider: 'deepseek',
      },
    })

    const aggregate = aggregateCodingRuntimeCostSettlements([
      { requestPhase: 'analysis', settlement: peak },
      { requestPhase: 'initial', settlement: offPeak },
    ])

    expect(aggregate).toMatchObject({
      inputTokens: 2_000_000,
      cacheMissTokens: 2_000_000,
      costStatus: 'settled',
      costUsd: 0.66,
      pricingSnapshot: null,
      breakdown: { cacheMissInputUsd: 0.66, totalUsd: 0.66 },
    })
    expect(aggregate.providerCallSettlements).toMatchObject([
      { requestPhase: 'analysis', timestamp: peak.timestamp, costUsd: 0.44, pricingSnapshot: { tier: 'peak' } },
      { requestPhase: 'initial', timestamp: offPeak.timestamp, costUsd: 0.22, pricingSnapshot: { tier: 'off_peak' } },
    ])
  })
})
