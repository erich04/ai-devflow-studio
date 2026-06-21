import { describe, expect, it } from 'vitest'
import {
  estimateCodingRuntimeCost,
  evaluateRuntimeBudgetGuard,
  runtimeCostSummaryToTokenUsage,
} from './cost'
import type { RuntimeBudgetApproval, RuntimeBudgetPolicy } from './domain'

describe('estimateCodingRuntimeCost', () => {
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

  it('allows runs below the warning threshold', () => {
    const decision = evaluateRuntimeBudgetGuard({
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

  it('accepts a non-expired lead approval that covers the projected additional cost', () => {
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
      costUsd: 0.012,
      source: 'estimated',
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
})
