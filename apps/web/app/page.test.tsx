import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWarnOnlyDefaultPolicy, resolveEffectivePolicy } from '@ai-devflow/shared'
import Page from './page'
import { fetchTeamOverview } from './lib/devflow-api'
import type { TeamOverviewResponse } from './lib/devflow-api'

vi.mock('./lib/devflow-api', () => ({
  createTeamProject: vi.fn(),
  fetchTeamOverview: vi.fn(),
  resolveDevFlowApiBaseUrl: vi.fn(() => 'http://api.local'),
  resolveDevFlowPublicApiBaseUrl: vi.fn(() => 'http://api.local'),
  runKnowledgeReview: vi.fn(),
  saveEnforcementPolicy: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === 'devflow_session' ? { name: 'devflow_session', value: 'session-1' } : undefined,
    ),
  })),
}))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)
const organizationPolicy = createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' })

const overview: TeamOverviewResponse = {
  projects: [
    {
      id: 'p-remote',
      name: 'Remote API',
      repository: 'erich/remote-api',
      defaultBranch: 'main',
      health: 'on_track',
      knowledgeBasePath: 'docs/remote',
      testCommand: 'pnpm test',
    },
  ],
  members: [
    {
      id: 'u-remote',
      name: 'Remote Lead',
      role: 'lead',
      avatarInitials: 'RL',
      focus: 'Delivery',
    },
  ],
  runs: [
    {
      id: 'run-remote',
      title: 'Remote run',
      request: 'Ship from API data.',
      projectId: 'p-remote',
      creatorId: 'u-remote',
      status: 'building',
      currentNodeId: 'n-build',
      branchName: 'ai/remote-run',
      createdAt: '2026-06-16T10:00:00.000Z',
      updatedAt: '2026-06-16T10:10:00.000Z',
      nodes: [
        {
          id: 'n-build',
          stage: 'design',
          title: 'Architecture Gate',
          subtitle: 'Lead review',
          kind: 'gate',
          status: 'blocked',
          ownerId: 'u-remote',
          requiredRole: 'lead',
          retryCount: 0,
          artifactIds: [],
        },
      ],
      edges: [],
    },
  ],
  projectCost: [
    {
      key: 'p-remote',
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 100,
      totalTokens: 1500,
      costUsd: 0.123,
    },
  ],
  memberCost: [],
  totalCost: '$0.123',
  testEvidenceSummaries: [
    {
      id: 'evidence-remote',
      runId: 'run-remote',
      nodeId: 'n-test',
      projectId: 'p-remote',
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
      durationMs: 1200,
      summary: 'Remote tests passed.',
      redacted: true,
      createdAt: '2026-06-16T10:12:00.000Z',
    },
  ],
  codingAgentSummaries: [
    {
      id: 'coding-run-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      projectId: 'p-remote',
      requestedBy: 'u-remote',
      providerId: 'fake-coding-engine',
      engine: 'fake',
      status: 'completed',
      branchName: 'devflow/run-remote-n-build-coding-run-remote',
      summary: 'Coding Agent completed with redacted changed paths.',
      changedPaths: ['src/remote.ts'],
      startedAt: '2026-06-16T10:13:00.000Z',
      completedAt: '2026-06-16T10:14:00.000Z',
      redacted: true,
    },
  ],
  policyAwareDeliverySummaries: [
    {
      projectId: 'p-remote',
      warningCount: 2,
      blockedCount: 1,
      overrideCount: 1,
      remediationPlanCount: 1,
      retryAttemptCount: 1,
      remainingEvidenceGapCount: 1,
      redacted: true,
      updatedAt: '2026-06-18T10:08:00.000Z',
    },
  ],
  agentReviews: [
    {
      id: 'agent-review-remote',
      requestId: 'request-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      projectId: 'p-remote',
      runtime: 'api',
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Knowledge review completed.',
      summary: 'Reviewed remote gate evidence.',
      risks: [],
      missingEvidence: [],
      suggestedTests: ['Run remote smoke tests.'],
      knowledgeReferences: [],
      policyFindings: [],
      confidence: 0.8,
      gateAdvisory: {
        id: 'gate-advisory-remote',
        runId: 'run-remote',
        nodeId: 'n-build',
        level: 'info',
        blocksApproval: false,
        summary: 'No blocking knowledge gaps found.',
        missingEvidence: [],
        riskCount: 0,
        createdAt: '2026-06-16T10:14:00.000Z',
      },
      createdAt: '2026-06-16T10:14:00.000Z',
    },
  ],
  agentTraces: [],
  agentTokenUsage: [
    {
      id: 'agent-token-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      userId: 'u-remote',
      projectId: 'p-remote',
      provider: 'local',
      model: 'fake',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      costUsd: 0,
      timestamp: '2026-06-16T10:14:00.000Z',
      source: 'estimated',
    },
  ],
  agentProviders: [
    {
      id: 'fake-knowledge-review',
      name: 'Deterministic Fake Provider',
      kind: 'fake',
      model: 'fake',
      enabled: true,
      updatedAt: '1970-01-01T00:00:00.000Z',
    },
  ],
  enforcementPolicies: {
    organizationPolicy,
    projectOverrides: [],
    effectivePolicies: [resolveEffectivePolicy(organizationPolicy, null)],
    gateOverrides: [],
  },
  runtimeBudgetPolicies: [
    {
      projectId: 'p-remote',
      enabled: true,
      monthlyLimitUsd: 0.2,
      warningThresholdUsd: 0.1,
      currency: 'USD',
      updatedAt: '2026-06-21T00:00:00.000Z',
    },
  ],
  runtimeBudgetApprovals: [
    {
      id: 'runtime-budget-approval-p-remote-1',
      projectId: 'p-remote',
      requestedBy: 'u-remote',
      approvedBy: 'u-lead',
      role: 'lead',
      providerId: 'double',
      maxAdditionalCostUsd: 0.25,
      reason: 'Release smoke with real provider.',
      status: 'approved',
      createdAt: '2026-06-21T00:00:00.000Z',
      expiresAt: '2026-06-22T00:00:00.000Z',
    },
  ],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('web product shell page', () => {
  it('renders team overview data loaded from the API client', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(await Page())

    expect(screen.getAllByText('Remote API').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('erich/remote-api')).toBeInTheDocument()
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.getByText('Remote run')).toBeInTheDocument()
    expect(screen.getByText('Ship from API data.')).toBeInTheDocument()
    expect(screen.getAllByText('Evidence Chain').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Human Gate').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('旧壳备份')).toBeInTheDocument()
    expect(screen.getAllByText('Architecture Gate').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Lead review')).toBeInTheDocument()
    expect(screen.getByText('Remote tests passed.')).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(screen.getByText('Coding Agent completed with redacted changed paths.')).toBeInTheDocument()
    expect(screen.getByText('No blocking knowledge gaps found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute(
      'href',
      'http://api.local/api/auth/github/start',
    )
    expect(screen.getByRole('link', { name: /备份壳/ })).toHaveAttribute('href', '/legacy-shell')
    expect(screen.getByText(/1 blocking · 2 warnings/)).toBeInTheDocument()
    expect(screen.getByText(/1 retries · 1 overrides/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Apply recommended enforcement/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /触发后端审查/ })).toBeInTheDocument()
    expect(screen.getByText('Budget Used')).toBeInTheDocument()
    expect(screen.getByText('Runtime Budget')).toBeInTheDocument()
    expect(screen.getByText('$0.123 / $0.20')).toBeInTheDocument()
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('renders an empty state when the API has no team projects yet', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      projects: [],
      members: [],
      runs: [],
      projectCost: [],
      memberCost: [],
      totalCost: '$0.000',
      testEvidenceSummaries: [],
      codingAgentSummaries: [],
      policyAwareDeliverySummaries: [],
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      agentProviders: [],
      enforcementPolicies: {
        organizationPolicy,
        projectOverrides: [],
        effectivePolicies: [],
        gateOverrides: [],
      },
      runtimeBudgetPolicies: [],
      runtimeBudgetApprovals: [],
    })

    render(await Page())

    expect(screen.getByText('等待第一条真实工作请求')).toBeInTheDocument()
    expect(screen.getByText('没有真实 Run')).toBeInTheDocument()
    expect(
      screen.getByText('连接 Desktop 或 API 创建工作请求后，这里会显示从澄清、设计、编码、测试到 PR 的证据链。'),
    ).toBeInTheDocument()
  })

  it('renders an error state when the API cannot be reached', async () => {
    mockedFetchTeamOverview.mockRejectedValue(new Error('network down'))

    render(await Page())

    expect(screen.getByText('团队数据暂时不可用')).toBeInTheDocument()
    expect(screen.getByText('network down')).toBeInTheDocument()
  })
})
