import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import { createWarnOnlyDefaultPolicy, resolveEffectivePolicy } from '@ai-devflow/shared'
import Page from './page'
import {
  evaluateGateCommandSnapshot,
  DevFlowApiError,
  fetchAuthSession,
  fetchGateCommands,
  fetchGitHubDeliveryRequests,
  fetchGitHubRepositoryBinding,
  fetchTeamOverview,
  fetchWorkRequests,
} from './lib/devflow-api'
import type { TeamOverviewResponse } from './lib/devflow-api'

vi.mock('./lib/devflow-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/devflow-api')>()
  return {
    ...actual,
    createTeamProject: vi.fn(),
    fetchAuthSession: vi.fn(),
    fetchTeamOverview: vi.fn(),
    fetchWorkRequests: vi.fn(),
    fetchGateCommands: vi.fn(),
    fetchGitHubDeliveryRequests: vi.fn(),
    fetchGitHubRepositoryBinding: vi.fn(),
    evaluateGateCommandSnapshot: vi.fn(),
    resolveDevFlowApiBaseUrl: vi.fn(() => 'http://api.local'),
    resolveDevFlowPublicApiBaseUrl: vi.fn(() => 'http://api.local'),
    runKnowledgeReview: vi.fn(),
    saveEnforcementPolicy: vi.fn(),
  }
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === 'devflow_session' ? { name: 'devflow_session', value: 'session-1' } : undefined,
    ),
  })),
}))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)
const mockedFetchAuthSession = vi.mocked(fetchAuthSession)
const mockedCookies = vi.mocked(cookies)
const mockedFetchWorkRequests = vi.mocked(fetchWorkRequests)
const mockedFetchGateCommands = vi.mocked(fetchGateCommands)
const mockedFetchGitHubDeliveries = vi.mocked(fetchGitHubDeliveryRequests)
const mockedFetchGitHubBinding = vi.mocked(fetchGitHubRepositoryBinding)
const mockedEvaluateGateCommandSnapshot = vi.mocked(evaluateGateCommandSnapshot)
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
      version: 1,
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
  agentRuntimeSummaries: [
    {
      stateVersion: 1,
      projectionVersion: 1,
      runtimeId: 'agent-runtime-team-1',
      projectId: 'p-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      runtimeVersion: 3,
      checkpointVersion: 3,
      status: 'waiting_permission',
      stopReason: null,
      counters: { steps: 2, toolCalls: 1, tokens: 120, costUsd: 0.02 },
      acceptedActionCount: 1,
      contextDigest: 'a'.repeat(64),
      capabilitySetDigest: 'b'.repeat(64),
      lastObservationDigest: 'c'.repeat(64),
      lastResultDigest: 'd'.repeat(64),
      startedAt: '2026-06-16T10:13:00.000Z',
      updatedAt: '2026-06-16T10:14:00.000Z',
      redacted: true,
    },
  ],
  agentMemorySummaries: [
    {
      stateVersion: 1,
      projectionVersion: 1,
      memoryId: 'memory-team-1',
      projectId: 'p-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      runtimeId: 'agent-runtime-team-1',
      ownerUserId: 'u-remote',
      candidateId: 'memory-candidate-team-1',
      currentRevision: 2,
      headVersion: 3,
      qualityVersion: 3,
      lifecycleStatus: 'active',
      visibility: 'project_shared',
      sensitivity: 'internal',
      retentionClass: 'until_deleted',
      provenanceDigest: 'e'.repeat(64),
      citationIds: ['knowledge-request-1', 'knowledge-request-2'],
      retrievalCount: 2,
      acceptedContextCount: 2,
      expiresAt: null,
      deletedAt: null,
      purgeStatus: null,
      purgedAt: null,
      updatedAt: '2026-06-16T10:14:30.000Z',
      redacted: true,
    },
  ],
  agentCoordinationSummaries: [
    {
      stateVersion: 1,
      projectionVersion: 1,
      coordinationId: 'coordination-team-1',
      projectId: 'p-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      coordinationVersion: 7,
      graphVersion: 1,
      status: 'terminal',
      stopReason: 'success',
      roleCounts: [
        { roleId: 'contract-reviewer', count: 1 },
        { roleId: 'test-reviewer', count: 2 },
      ],
      taskStatusCounts: {
        pending: 0, ready: 0, running: 0, succeeded: 3,
        failed: 0, cancelled: 0, blocked: 0,
      },
      failureCategoryCounts: {
        timeout: 0, budget_exhausted: 0, policy_denied: 0, tool_error: 0,
        coding_executor_error: 0, invalid_result: 0, dependency_failed: 0,
      },
      taskCount: 3,
      edgeCount: 2,
      specialistStarts: 3,
      acceptedHandoffCount: 2,
      retryCount: 0,
      stepCount: 6,
      toolCallCount: 2,
      tokenCount: 0,
      costUsd: 0,
      singleAgentQuality: 0.5,
      coordinationQuality: 0.8,
      latencyMs: 1_500,
      humanInterventionCount: 0,
      authorityViolationCount: 0,
      isolationViolationCount: 0,
      terminationViolationCount: 0,
      replayViolationCount: 0,
      redactionViolationCount: 0,
      updatedAt: '2026-06-16T10:15:00.000Z',
      isolated: true,
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
    {
      id: 'fake-coding-engine',
      name: 'Local Coding Provider',
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

beforeEach(() => {
  delete process.env['DEVFLOW_LOCAL_AUTH_ENABLED']
  mockedFetchAuthSession.mockResolvedValue({
    user: { id: 'u-session', name: 'Session User', role: 'owner' },
    authentication: { provider: 'github' },
    projectMemberships: [
      { projectId: 'p-local', userId: 'u-session', role: 'owner' },
      { projectId: 'p-remote', userId: 'u-session', role: 'owner' },
    ],
  })
  mockedFetchWorkRequests.mockResolvedValue([])
  mockedFetchGateCommands.mockResolvedValue([])
  mockedFetchGitHubBinding.mockResolvedValue(null)
  mockedFetchGitHubDeliveries.mockResolvedValue([])
  mockedEvaluateGateCommandSnapshot.mockResolvedValue({
    status: 'pass',
    blocksApproval: false,
    policyVersion: 1,
    expectedBlockerIds: [],
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('web product shell page', () => {
  it('requires an explicit project selection instead of choosing the global latest run', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(await Page({}))

    expect(screen.getAllByText('请选择项目').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('heading', { level: 1, name: 'Remote run' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Remote API/ })).toHaveAttribute(
      'href',
      '/?projectId=p-remote',
    )
    expect(screen.queryByRole('button', { name: 'Apply recommended enforcement' })).not.toBeInTheDocument()
  })

  it('does not fall back to another project when the requested run is outside the selected project', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      projects: [
        ...overview.projects,
        {
          ...overview.projects[0]!,
          id: 'p-other',
          name: 'Other Project',
          repository: 'erich/other-project',
        },
      ],
      runs: [
        ...overview.runs,
        {
          ...overview.runs[0]!,
          id: 'run-other',
          projectId: 'p-other',
          title: 'Other project run',
          request: 'Must never leak into the selected project.',
          updatedAt: '2026-06-16T11:10:00.000Z',
        },
      ],
    })

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-other' }),
      }),
    )

    expect(screen.getAllByText('Run 不属于所选项目').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Remote API').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Other project run')).not.toBeInTheDocument()
    expect(screen.queryByText('Must never leak into the selected project.')).not.toBeInTheDocument()
  })

  it('shows a distinct empty state for an unknown run identifier', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-missing' }),
      }),
    )

    expect(screen.getAllByText('所选 Run 不存在').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('heading', { level: 1, name: 'Remote run' })).not.toBeInTheDocument()
  })

  it('derives every management summary from the same selected project and run', async () => {
    const otherProject = {
      ...overview.projects[0]!,
      id: 'p-other',
      name: 'Other Project',
      repository: 'erich/other-project',
    }
    const otherRun = {
      ...overview.runs[0]!,
      id: 'run-other',
      projectId: otherProject.id,
      title: 'Other project run',
      request: 'Foreign request summary.',
      updatedAt: '2026-06-16T11:10:00.000Z',
    }
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      projects: [...overview.projects, otherProject],
      runs: [...overview.runs, otherRun],
      testEvidenceSummaries: [
        ...overview.testEvidenceSummaries,
        {
          ...overview.testEvidenceSummaries[0]!,
          id: 'evidence-other',
          runId: otherRun.id,
          projectId: otherProject.id,
          summary: 'Foreign tests must stay hidden.',
        },
      ],
      codingAgentSummaries: [
        ...overview.codingAgentSummaries,
        {
          ...overview.codingAgentSummaries[0]!,
          id: 'coding-other',
          runId: otherRun.id,
          projectId: otherProject.id,
          summary: 'Foreign coding run must stay hidden.',
        },
      ],
      agentMemorySummaries: [
        ...overview.agentMemorySummaries,
        {
          ...overview.agentMemorySummaries[0]!,
          memoryId: 'memory-other',
          projectId: otherProject.id,
          runId: otherRun.id,
          candidateId: 'memory-candidate-other',
        },
      ],
      agentReviews: [
        {
          ...overview.agentReviews[0]!,
          id: 'review-other',
          runId: otherRun.id,
          projectId: otherProject.id,
          gateAdvisory: {
            ...overview.agentReviews[0]!.gateAdvisory,
            id: 'advisory-other',
            runId: otherRun.id,
            summary: 'Foreign review must stay hidden.',
          },
        },
      ],
    })

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
      }),
    )

    expect(screen.getAllByText('Remote run').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Remote tests passed.')).toBeInTheDocument()
    expect(screen.getByText('Agent Runtime · n-build')).toBeInTheDocument()
    expect(screen.getByText('2 steps · 1 tools · v3')).toBeInTheDocument()
    expect(screen.getByText('Memory · n-build')).toBeInTheDocument()
    expect(screen.getByText(
      '2 citations · 2 accepted contexts · quality v3 · revision 2',
    )).toBeInTheDocument()
    expect(screen.queryByText('Memory · memory-other')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign request summary.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign tests must stay hidden.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign coding run must stay hidden.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign review must stay hidden.')).not.toBeInTheDocument()
    expect(screen.getByText('此 Run 尚未运行基于知识的门禁审查。')).toBeInTheDocument()
    expect(screen.getByText('Active Runs').closest('article')).toHaveTextContent('1')
    expect(screen.getByText('Evidence Items').closest('article')).toHaveTextContent('3')
  })

  it('uses Provider Name instead of the internal provider identity in Web summaries', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      agentRuntimeSummaries: [],
    })

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
      }),
    )

    expect(screen.getByText('Local Coding Provider')).toBeInTheDocument()
    expect(screen.queryByText('fake-coding-engine')).not.toBeInTheDocument()
  })

  it('offers copy-once Desktop pairing only for the explicitly selected project', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote' }),
      }),
    )

    expect(screen.getByRole('region', { name: 'Desktop pairing for Remote API' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Create desktop pairing code' })).toHaveLength(1)
    expect(screen.getAllByText('请选择 Run').length).toBeGreaterThanOrEqual(1)
  })

  it('loads and renders Work Requests only for the explicitly selected project', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)
    mockedFetchWorkRequests.mockResolvedValueOnce([{
      id: 'wr-remote',
      organizationId: 'org-demo',
      projectId: 'p-remote',
      title: 'Prepare remote rollout',
      request: 'Keep the rollout reversible.',
      version: 1,
      status: 'open',
      createdByUserId: 'u-remote',
      claim: null,
      expiresAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }])

    render(await Page({
      searchParams: Promise.resolve({ projectId: 'p-remote' }),
    }))

    expect(screen.getByRole('region', { name: 'Work Requests' })).toBeInTheDocument()
    expect(screen.getByText('Prepare remote rollout')).toBeInTheDocument()
    expect(mockedFetchWorkRequests).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('loads and renders safe GitHub Delivery management for the selected project', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)
    mockedFetchGitHubBinding.mockResolvedValueOnce({
      stateVersion: 1,
      id: 'binding-remote',
      version: 3,
      organizationId: 'org-demo',
      teamProjectId: 'p-remote',
      installationId: '12345',
      repositoryId: '98765',
      repository: 'erich/remote-api',
      defaultBranch: 'main',
      status: 'active',
      validatedAt: '2026-08-11T14:00:00.000Z',
      updatedAt: '2026-08-11T14:00:00.000Z',
      redacted: true,
    })
    mockedFetchGitHubDeliveries.mockResolvedValueOnce([{
      id: 'delivery-remote',
      stateVersion: 2,
      intentRevision: 1,
      projectId: 'p-remote',
      runId: 'run-remote',
      runVersion: 7,
      nodeId: 'pr-remote',
      repositoryBindingId: 'binding-remote',
      repositoryBindingVersion: 3,
      deliverySeriesKey: `github-delivery:${'9'.repeat(64)}`,
      deliveryAttempt: 1,
      repositoryId: '98765',
      repository: 'erich/remote-api',
      status: 'approval_required',
      outcomeCode: null,
      expectedRunVersion: 7,
      baseBranch: 'main',
      headBranch: 'devflow/run-remote-pr-remote',
      baseCommitSha: 'a'.repeat(40),
      expectedCommitSha: 'b'.repeat(40),
      intentDigest: 'c'.repeat(64),
      diffDigest: 'd'.repeat(64),
      testEvidenceId: 'evidence-remote-v1',
      testEvidenceDigest: 'e'.repeat(64),
      packageDigest: 'f'.repeat(64),
      changedPaths: ['src/remote.ts'],
      prTitle: 'Deliver the exact remote change',
      expiresAt: '2026-08-12T14:00:00.000Z',
      updatedAt: '2026-08-11T14:01:00.000Z',
    }])

    render(await Page({
      searchParams: Promise.resolve({ projectId: 'p-remote' }),
    }))

    expect(screen.getByRole('region', { name: 'GitHub Delivery' })).toBeInTheDocument()
    expect(screen.getByText('Remote API · p-remote')).toBeInTheDocument()
    expect(screen.getByText('Deliver the exact remote change')).toBeInTheDocument()
    expect(screen.getByText('b'.repeat(40))).toBeInTheDocument()
    expect(screen.getByText('e'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('c'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('d'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('src/remote.ts')).toBeInTheDocument()
    expect(mockedFetchGitHubBinding).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
    expect(mockedFetchGitHubDeliveries).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('renders team overview data loaded from the API client', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
      }),
    )

    expect(screen.getAllByText('Remote API').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('erich/remote-api').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.getAllByText('Remote run').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Ship from API data.')).toBeInTheDocument()
    expect(screen.getAllByText('Evidence Chain').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Human Gate').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('旧壳备份')).toBeInTheDocument()
    expect(screen.getAllByText('Architecture Gate').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Lead review')).toBeInTheDocument()
    expect(screen.getByText('Remote tests passed.')).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(screen.getByText('Agent Runtime · n-build')).toBeInTheDocument()
    expect(screen.getByText('2 steps · 1 tools · v3')).toBeInTheDocument()
    expect(screen.getByText('Memory · n-build')).toBeInTheDocument()
    expect(screen.getByText(
      '2 citations · 2 accepted contexts · quality v3 · revision 2',
    )).toBeInTheDocument()
    expect(screen.getByText('project_shared · internal · until_deleted')).toBeInTheDocument()
    expect(screen.getByText('Multi-Agent Coordination')).toBeInTheDocument()
    expect(screen.getByText('Coordination · n-build')).toBeInTheDocument()
    expect(screen.getByText('3 tasks · 2 handoffs · 1500 ms · 0 interventions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start coordination|cancel coordination|resume coordination|retry coordination/iu })).not.toBeInTheDocument()
    expect(screen.getByText('No blocking knowledge gaps found.')).toBeInTheDocument()
    expect(screen.getByText('Session User · GitHub')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /备份壳/ })).toHaveAttribute('href', '/legacy-shell')
    expect(screen.getByText(/1 blocking · 2 warnings/)).toBeInTheDocument()
    expect(screen.getByText(/1 retries · 1 overrides/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Apply recommended enforcement/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /运行门禁审查/ })).toBeInTheDocument()
    expect(screen.getByText('Budget Used')).toBeInTheDocument()
    expect(screen.getByText('Runtime Budget')).toBeInTheDocument()
    expect(screen.getByText('$0.123 / $0.20')).toBeInTheDocument()
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('loads an authoritative Gate Command snapshot only for the current paused Gate', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      runs: [
        {
          ...overview.runs[0]!,
          status: 'paused_at_gate',
          version: 7,
          currentNodeId: 'run-remote:n-build',
          nodes: [
            {
              ...overview.runs[0]!.nodes[0]!,
              id: 'run-remote:n-build',
              status: 'running',
            },
          ],
        },
      ],
    })

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
      }),
    )

    expect(mockedFetchGateCommands).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
    expect(mockedEvaluateGateCommandSnapshot).toHaveBeenCalledWith({
      projectId: 'p-remote',
      runId: 'run-remote',
      nodeId: 'n-build',
      cookieHeader: 'devflow_session=session-1',
    })

    fireEvent.change(screen.getByRole('textbox', { name: 'Gate Command reason' }), {
      target: { value: 'Evidence reviewed.' },
    })
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeEnabled()
  })

  it('never exposes a historical Gate when the current node is not a Gate', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      runs: [
        {
          ...overview.runs[0]!,
          status: 'building',
          currentNodeId: 'n-current-task',
          nodes: [
            {
              ...overview.runs[0]!.nodes[0]!,
              id: 'n-historical-gate',
              status: 'completed',
            },
            {
              id: 'n-current-task',
              stage: 'build',
              title: 'Current implementation',
              subtitle: 'Coding',
              kind: 'task',
              status: 'running',
              ownerId: 'u-remote',
              requiredRole: 'member',
              retryCount: 0,
              artifactIds: [],
            },
          ],
        },
      ],
    })

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
      }),
    )

    expect(screen.getByRole('heading', { level: 2, name: '暂无待审 Gate' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Gate Command reason' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeDisabled()
    expect(mockedEvaluateGateCommandSnapshot).not.toHaveBeenCalled()
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
      agentRuntimeSummaries: [],
      agentMemorySummaries: [],
      agentCoordinationSummaries: [],
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

    render(await Page({}))

    expect(screen.getByText('等待第一条真实工作请求')).toBeInTheDocument()
    expect(screen.getByText('没有真实 Run')).toBeInTheDocument()
    expect(
      screen.getByText('连接 Desktop 或 API 创建工作请求后，这里会显示从澄清、设计、编码、测试到 PR 的证据链。'),
    ).toBeInTheDocument()
  })

  it('offers the normal GitHub sign-in route when an unauthenticated overview request fails', async () => {
    mockedCookies.mockResolvedValueOnce({ get: vi.fn(() => undefined) } as never)
    mockedFetchTeamOverview.mockRejectedValue(
      new DevFlowApiError('/api/team/overview', 401),
    )

    render(await Page({}))

    expect(screen.getByText('需要登录')).toBeInTheDocument()
    expect(screen.getByText('请先建立浏览器身份，再进入团队工作台。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute(
      'href',
      'http://api.local/api/auth/github/start',
    )
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({})
    expect(screen.queryByRole('button', { name: '使用本地开发身份' })).not.toBeInTheDocument()
  })

  it('offers an empty direct POST form when local development auth is enabled', async () => {
    process.env['DEVFLOW_LOCAL_AUTH_ENABLED'] = 'true'
    mockedCookies.mockResolvedValueOnce({ get: vi.fn(() => undefined) } as never)
    mockedFetchTeamOverview.mockRejectedValue(
      new DevFlowApiError('/api/team/overview', 401),
    )

    render(await Page({}))

    const button = screen.getByRole('button', { name: '使用本地开发身份' })
    const form = button.closest('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', 'http://api.local/api/auth/local/start')
    expect(form?.querySelectorAll('input')).toHaveLength(0)
  })
})
