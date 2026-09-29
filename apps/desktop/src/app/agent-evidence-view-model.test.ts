import { describe, expect, it } from 'vitest'
import {
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionRequest,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import { buildAgentEvidenceGroups, buildProviderSettingsView, type AgentEvidenceInput } from './agent-evidence-view-model'

const provider: AgentProviderConfig = {
  id: 'doubao-review',
  name: 'doubao-review',
  kind: 'openai-compatible',
  model: 'ark-code-latest',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  enabled: true,
  maskedCredential: 'e8...test',
  updatedAt: '2026-06-17T00:00:00.000Z',
}

function runWithCurrentNode(nodeId: string): WorkflowRun {
  const run = fixtureRuns[0]!
  return { ...run, currentNodeId: nodeId }
}

function baseInput(overrides: Partial<AgentEvidenceInput> = {}): AgentEvidenceInput {
  return {
    providers: [provider],
    selectedReviews: [],
    latestTrace: undefined,
    latestUsage: undefined,
    retryAttempts: [],
    latestCodingRun: undefined,
    codingEvents: [],
    pendingCodingPermission: undefined,
    permissionRequests: [],
    diff: undefined,
    bootstrapEvidence: undefined,
    testEvidence: undefined,
    ...overrides,
  }
}

it('keeps an explicitly empty Provider selection even when other saved providers remain', () => {
  const view = buildProviderSettingsView({ providers: [provider], selectedProviderId: '' })
  expect(view.selectedProvider).toBeUndefined()
  expect(view.summary).toBe('尚未选择 Agent Provider')
})

function review(run: WorkflowRun): AgentReviewResult {
  return {
    id: 'review-1',
    requestId: 'request-1',
    runId: run.id,
    nodeId: 'n-design-gate',
    projectId: run.projectId,
    runtime: 'electron',
    providerId: provider.id,
    model: provider.model,
    conclusion: 'warning-only',
    summary: 'Build redacted context before approval.',
    risks: ['Missing test evidence.'],
    missingEvidence: ['Attach passing test evidence.'],
    suggestedTests: ['pnpm test'],
    knowledgeReferences: [],
    policyFindings: [],
    confidence: 0.82,
    gateAdvisory: {
      id: 'advisory-1',
      runId: run.id,
      nodeId: 'n-design-gate',
      level: 'warn',
      blocksApproval: false,
      summary: 'Review found warning-only gaps.',
      missingEvidence: ['Attach passing test evidence.'],
      riskCount: 1,
      createdAt: '2026-06-17T00:00:00.000Z',
    },
    createdAt: '2026-06-17T00:00:00.000Z',
  }
}

function trace(run: WorkflowRun): AgentTrace {
  return {
    id: 'trace-1',
    runId: run.id,
    nodeId: 'n-design-gate',
    reviewId: 'review-1',
    runtime: 'electron',
    createdAt: '2026-06-17T00:00:01.000Z',
    steps: [
      {
        id: 'trace-step-1',
        kind: 'context',
        label: 'Build redacted context',
        summary: 'Collected current Run and node context.',
        timestamp: '2026-06-17T00:00:01.000Z',
      },
    ],
  }
}


describe('agent evidence groups', () => {
  it('groups review, coding, permission, diff, test evidence, and cost outputs', () => {
    const run = runWithCurrentNode('n-build')
    const latestReview = review(run)
    const latestTrace = trace(run)
    const latestUsage: AgentTokenUsage = {
      id: 'usage-1',
      runId: run.id,
      nodeId: 'n-design-gate',
      userId: 'u-wang',
      projectId: run.projectId,
      provider: 'local',
      model: 'fake',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      costUsd: 0,
      timestamp: '2026-06-17T00:00:00.000Z',
      source: 'estimated',
    }
    const codingRun: CodingAgentRun = {
      id: 'coding-run-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      requestedBy: 'u-wang',
      providerId: 'fake',
      engine: 'fake',
      status: 'completed',
      managedWorkspaceId: 'workspace-1',
      branchName: 'devflow/build',
      userInstruction: 'Implement change.',
      prompt: 'redacted',
      summary: 'Coding Agent completed.',
      changedPaths: ['src/change.ts'],
      startedAt: '2026-06-17T00:00:00.000Z',
      completedAt: '2026-06-17T00:03:00.000Z',
      runtimeCostSummary: {
        id: 'coding-cost-1',
        runId: run.id,
        nodeId: 'n-build',
        userId: 'u-wang',
        projectId: run.projectId,
        provider: 'openai',
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheMissTokens: 60,
        totalTokens: 120,
        cacheHitRate: 0.4,
        usageStatus: 'complete',
        costStatus: 'settled',
        phase: 'provider_settlement',
        costUsd: 0.00002668,
        pricingSnapshot: {
          providerId: 'deepseek',
          model: 'deepseek-v4-flash',
          tier: 'off_peak',
          effectiveAt: '2026-06-17T00:00:00.000Z',
          source: 'https://pricing.example.test',
          sourceVersion: 'pricing-v1',
          currency: 'USD',
          unit: 'per_1m_tokens',
          cacheHitInputUsdPerMillion: 0.007,
          cacheMissInputUsdPerMillion: 0.22,
          outputUsdPerMillion: 0.66,
        },
        breakdown: {
          cacheHitInputUsd: 0.00000028,
          cacheMissInputUsd: 0.0000132,
          outputUsd: 0.0000132,
          totalUsd: 0.00002668,
        },
        timestamp: '2026-06-17T00:01:00.000Z',
        source: 'provider_reported',
        redacted: true,
      },
      redacted: true,
    }
    const permission: CodingPermissionRequest = {
      id: 'permission-1',
      codingRunId: codingRun.id,
      runId: run.id,
      nodeId: 'n-build',
      permission: 'edit',
      title: 'Apply managed diff',
      risk: 'safe',
      reasons: ['Approved write.'],
      status: 'approved',
      requestedAt: '2026-06-17T00:01:00.000Z',
      expiresAt: '2026-06-17T00:02:00.000Z',
    }
    const codingEvents: CodingAgentEvent[] = [
      {
        id: 'coding-event-1',
        codingRunId: codingRun.id,
        runId: run.id,
        nodeId: 'n-build',
        sequence: 1,
        kind: 'tool_call',
        message: 'Called bash.',
        timestamp: '2026-06-17T00:01:00.000Z',
        metadata: {
          source: 'opencode_metadata',
          toolName: 'bash',
          skillName: 'shell-runner',
          inputSummary: 'bash: pnpm test',
          redactionApplied: true,
        },
        redacted: true,
      },
      {
        id: 'coding-event-cost',
        codingRunId: codingRun.id,
        runId: run.id,
        nodeId: 'n-build',
        sequence: 2,
        kind: 'permission',
        message: 'Provider settlement archived.',
        timestamp: '2026-06-17T00:01:01.000Z',
        metadata: {
          runtimeCost: {
            usageStatus: 'complete',
            costStatus: 'settled',
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 40,
            cacheMissTokens: 60,
            totalTokens: 120,
            cacheHitRate: 0.4,
            costUsd: 0.00002668,
            pricingTier: 'off_peak',
            unitPrices: {
              cacheHitInputUsdPerMillion: 0.007,
              cacheMissInputUsdPerMillion: 0.22,
              outputUsdPerMillion: 0.66,
            },
            breakdown: {
              cacheHitInputUsd: 0.00000028,
              cacheMissInputUsd: 0.0000132,
              outputUsd: 0.0000132,
              totalUsd: 0.00002668,
            },
            providerCallSettlements: [{
              requestPhase: 'analysis',
              inputTokens: 40,
              outputTokens: 5,
              cacheReadTokens: 10,
              cacheMissTokens: 30,
              totalTokens: 45,
              cacheHitRate: 0.25,
              costUsd: 0.00001,
              pricingSnapshot: {
                cacheHitInputUsdPerMillion: 0.007,
                cacheMissInputUsdPerMillion: 0.22,
                outputUsdPerMillion: 0.66,
              },
              breakdown: {
                cacheHitInputUsd: 0.00000007,
                cacheMissInputUsd: 0.0000066,
                outputUsd: 0.0000033,
                totalUsd: 0.00000997,
              },
            }],
          },
        },
        redacted: true,
      },
      {
        id: 'coding-event-provider-failure',
        codingRunId: codingRun.id,
        runId: run.id,
        nodeId: 'n-build',
        sequence: 3,
        kind: 'error',
        message: 'DeepSeek · initial · provider_timeout（30 秒） · 费用状态未知 · 可以手动重试。',
        timestamp: '2026-06-17T00:01:31.000Z',
        metadata: {
          providerCall: {
            stateVersion: 1,
            requestId: 'provider-call-1',
            codingRunId: codingRun.id,
            phase: 'initial',
            attempt: 1,
            providerId: 'deepseek',
            model: 'deepseek-v4-flash',
            targetHost: 'api.deepseek.com',
            status: 'failed',
            startedAt: '2026-06-17T00:01:01.000Z',
            completedAt: '2026-06-17T00:01:31.000Z',
            durationMs: 30_000,
            timeoutMs: 30_000,
            promptChars: 12_000,
            promptBytes: 12_400,
            promptDigest: 'a'.repeat(64),
            manifestPathCount: 24,
            excerptCount: 6,
            maxOutputTokens: 4_096,
            deliveryState: 'possibly_delivered',
            billingState: 'unknown',
            retryable: true,
            errorCode: 'provider_timeout',
            sanitizedCause: 'request_deadline_exceeded',
            redacted: true,
          },
        },
        redacted: true,
      },
    ]
    const diff: CodingDiffArtifact = {
      id: 'diff-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      changedPaths: ['src/change.ts'],
      patch: '+changed',
      truncated: false,
      redacted: true,
      sanitizerVersion: 2,
      sanitizedAt: '2026-06-17T00:02:00.000Z',
      secretReplacementCount: 2,
      createdAt: '2026-06-17T00:02:00.000Z',
    }
    const testEvidence: TestEvidence = {
      id: 'test-evidence-1',
      runId: run.id,
      nodeId: 'n-build',
      projectId: run.projectId,
      command: 'pnpm test',
      cwd: '/tmp/redacted',
      status: 'passed',
      exitCode: 0,
      durationMs: 1000,
      stdout: 'passed',
      stderr: '',
      summary: 'Test evidence passed.',
      redacted: true,
      createdAt: '2026-06-17T00:03:00.000Z',
    }

    const evidenceGroups = buildAgentEvidenceGroups(baseInput({
      selectedReviews: [latestReview],
      latestTrace,
      latestUsage,
      latestCodingRun: codingRun,
      codingEvents,
      permissionRequests: [permission],
      diff,
      testEvidence,
    }))

    expect(evidenceGroups.map((group) => group.id)).toEqual([
      'review-trace',
      'review-history',
      'permission',
      'provider-call',
      'tool-skill',
      'coding-trace',
      'diff',
      'test-evidence',
      'cost',
    ])
    expect(evidenceGroups.find((group) => group.id === 'diff')?.items[0]?.eyebrow).toBe(
      '2 secret replacements',
    )
    const costGroup = evidenceGroups.find((group) => group.id === 'cost')!
    expect(costGroup.summary).toContain('Actual provider settlement')
    expect(costGroup.items[0]?.body).toContain('40 cache hit · 60 cache miss · 20 output')
    expect(costGroup.items[0]?.meta).toEqual(expect.arrayContaining([
      'hit $0.007 / 1M · miss $0.22 / 1M · output $0.66 / 1M',
      'hit $0.00000028 · miss $0.0000132 · output $0.0000132 · total $0.00002668',
    ]))
    const costTrace = evidenceGroups.find((group) => group.id === 'coding-trace')
      ?.items.find((item) => item.id === 'coding-event-cost')
    expect(costTrace?.body).toContain('40 hit · 60 miss · 20 output')
    expect(costTrace?.meta).toContain('total $0.00002668')
    expect(costTrace?.meta).toContain('analysis · 40 input · 10 hit · 30 miss · 5 output · 45 total · hit rate 25.0%')
    expect(costTrace?.meta).toContain('analysis rates · hit $0.007 / 1M · miss $0.22 / 1M · output $0.66 / 1M')
    expect(costTrace?.meta).toContain('analysis cost · hit $0.00000007 · miss $0.0000066 · output $0.0000033 · total $0.00000997')
    const providerCall = evidenceGroups.find((group) => group.id === 'provider-call')
      ?.items[0]
    expect(providerCall).toMatchObject({
      eyebrow: 'initial · failed',
      title: 'deepseek · deepseek-v4-flash',
      body: 'DeepSeek · initial · provider_timeout（30 秒） · 费用状态未知 · 可以手动重试。',
    })
    expect(providerCall?.meta).toEqual(expect.arrayContaining([
      'duration 30000ms · timeout 30000ms',
      'provider_timeout · request_deadline_exceeded',
      'delivery possibly_delivered · billing unknown',
      'manual retry available',
      '24 manifest paths · 6 excerpts',
      '12000 chars · 12400 bytes · max output 4096',
      'api.deepseek.com',
    ]))
  })
})
