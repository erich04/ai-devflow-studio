import { fireEvent, render, screen, within } from '@testing-library/react'
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)
const mockedFetchAuthSession = vi.mocked(fetchAuthSession)
const mockedCookies = vi.mocked(cookies)
const mockedFetchWorkRequests = vi.mocked(fetchWorkRequests)
const mockedFetchGateCommands = vi.mocked(fetchGateCommands)
const mockedFetchGitHubDeliveries = vi.mocked(fetchGitHubDeliveryRequests)
const mockedFetchGitHubBinding = vi.mocked(fetchGitHubRepositoryBinding)
const mockedEvaluateGateCommandSnapshot = vi.mocked(evaluateGateCommandSnapshot)
const organizationPolicy = createWarnOnlyDefaultPolicy({ organizationId: 'org-demo' })

it('keeps project creation in Studio and removes normal legacy navigation', async () => {
  mockedFetchTeamOverview.mockResolvedValue({ ...overview, projects: [], runs: [] })
  mockedFetchAuthSession.mockResolvedValue({ user: { id: 'owner', name: 'Owner', role: 'owner' }, authentication: { provider: 'github' }, projectMemberships: [] })
  const { container } = render(await Page({}))
  expect(container.querySelector('a[href^="/legacy-shell"]')).toBeNull()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  fireEvent.click(screen.getByRole('button', { name: '创建团队项目' }))
  expect(screen.getByRole('dialog', { name: '创建团队项目' })).toBeInTheDocument()
})

it('shows all policy rules in settings and gives members read-only access', async () => {
  mockedFetchTeamOverview.mockResolvedValue(overview)
  mockedFetchAuthSession.mockResolvedValue({ user: { id: 'member', name: 'Member', role: 'member' }, authentication: { provider: 'github' }, projectMemberships: [] })
  render(await Page({ searchParams: Promise.resolve({ view: 'settings', section: 'policy' }) }))
  expect(screen.getByRole('heading', { name: '团队策略' })).toBeInTheDocument()
  expect(screen.getByRole('table', { name: '团队策略规则' }).querySelectorAll('tbody tr')).toHaveLength(10)
  expect(screen.queryByRole('button', { name: '预览变更' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '创建团队项目' })).not.toBeInTheDocument()
})

it('provides team-wide members, cost and recent runs under the same navigation', async () => {
  mockedFetchTeamOverview.mockResolvedValue(overview)
  render(await Page({ searchParams: Promise.resolve({ view: 'team', projectId: 'p-remote' }) }))
  expect(screen.getByRole('heading', { level: 1, name: '团队' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '我的待办', exact: true })).toHaveAttribute('href', '/?projectId=p-remote')
  expect(screen.getByRole('link', { name: '团队', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { name: '团队成员' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '项目费用' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Remote run' })).toHaveAttribute('href', '/?projectId=p-remote&runId=run-remote')
})

it('shows the authoritative policy and one actionable policy control in the task', async () => {
  mockedFetchTeamOverview.mockResolvedValue(overview)
  const { container } = render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }) }))
  const policy = container.querySelector('#policy')!
  expect(policy.textContent).toContain(organizationPolicy.name)
  expect(policy.querySelector('a[href="#policy"]')).toBeNull()
  expect(screen.getByRole('link', { name: /策略设置/ })).toHaveAttribute('href', '/?projectId=p-remote&view=settings&section=policy')
})

// Hardening H2: the whole synced step list drives progress; old placeholder titles read in Chinese.
it('shows progress and Chinese step names from the synced step list', async () => {
  const base = overview.runs[0]!.nodes[0]!
  const step = (id: string, stage: typeof base.stage, kind: typeof base.kind, status: typeof base.status, title: string) =>
    ({ ...base, id: `run-remote:${id}`, stage, kind, status, title, subtitle: 'Canonical current node from DevFlow Electron.' })
  mockedFetchTeamOverview.mockResolvedValue({
    ...overview,
    runs: [{
      ...overview.runs[0]!,
      status: 'designing',
      currentNodeId: 'run-remote:n-design',
      nodes: [
        step('n-clarify', 'clarify', 'agent', 'success', '需求澄清'),
        step('n-clarify-gate', 'clarify', 'gate', 'success', '需求确认 Gate'),
        step('n-design', 'design', 'agent', 'running', 'Synced design node'),
        step('n-build', 'build', 'task', 'pending', 'Implement locally'),
      ],
    }],
  })
  render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }) }))
  const steps = screen.getByRole('region', { name: '进度与材料' })
  expect(steps).toHaveTextContent('50%')
  for (const title of ['需求澄清', '需求确认 Gate', '方案设计', '开发实现']) {
    expect(within(steps).getByRole('heading', { name: title, level: 3 })).toBeInTheDocument()
  }
  expect(steps).not.toHaveTextContent('Synced design node')
  expect(steps).not.toHaveTextContent('Implement locally')
  expect(steps).not.toHaveTextContent('Canonical current node')
  expect(steps).toHaveTextContent('步骤状态由桌面端同步。')
})

// Plan S5, Q1: four entries; legacy links keep resolving.
it('uses the four Web entries and treats the old workbench view as the task list', async () => {
  mockedFetchTeamOverview.mockResolvedValue(overview)
  render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', view: 'workbench' }) }))
  const navigation = screen.getByRole('navigation', { name: '主导航' })
  expect([...navigation.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['我的待办', '项目任务', '团队', '设置'])
  expect(screen.getByRole('link', { name: '项目任务', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { level: 1, name: '项目任务' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Remote run/ })).toHaveAttribute('href', '/?projectId=p-remote&runId=run-remote')
  // Page anchors are no longer primary navigation.
  expect(screen.queryByRole('link', { name: 'Human Gate' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Evidence Chain' })).not.toBeInTheDocument()
})

it('offers the saved system, light, and dark theme preference', async () => {
  mockedFetchTeamOverview.mockResolvedValue(overview)
  render(await Page({}))
  expect(screen.getByRole('combobox', { name: '颜色主题' })).toHaveValue('system')
})

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

/** The overview run paused at its design Gate, stored with the Team `${runId}:` node prefix. */
function pausedDesignRun(): TeamOverviewResponse['runs'][number] {
  return {
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
  }
}

/** The desktop-uploaded subject for that Gate and version (plan S5, Q8). */
function designSubject(): NonNullable<TeamOverviewResponse['runs'][number]['gateReviewSubject']> {
  return {
    version: 1,
    runId: 'run-remote',
    runVersion: 7,
    nodeId: 'n-build',
    stage: 'design',
    sanitizerVersion: 'sensitive-text-v1',
    requestDigest: 'a'.repeat(64),
    artifacts: [{ id: 'artifact-design', nodeId: 'n-design', kind: 'design', updatedAt: '2026-06-16T10:05:00.000Z', contentDigest: 'b'.repeat(64) }],
  }
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
  it('links budget configuration to the selected second project even before a Run exists', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      projects: [...overview.projects, { ...overview.projects[0]!, id: 'p-new', name: 'New Project' }],
    })
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-new' }) }))
    expect(screen.getByRole('link', { name: '设置', exact: true })).toHaveAttribute(
      'href', '/?projectId=p-new&view=settings',
    )
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-new', view: 'settings' }) }))
    expect(screen.getByRole('heading', { name: '项目预算 · New Project' })).toBeInTheDocument()
  })

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

    expect(screen.getAllByText('任务不属于所选项目').length).toBeGreaterThanOrEqual(1)
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

    expect(screen.getAllByText('所选任务不存在或无权访问').length).toBeGreaterThanOrEqual(1)
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
    expect(screen.getByText('Agent 执行 · n-build')).toBeInTheDocument()
    expect(screen.getByText('2 步 · 1 次工具调用 · v3')).toBeInTheDocument()
    expect(screen.getByText('记忆 · n-build')).toBeInTheDocument()
    expect(screen.getByText(
      '2 个引用 · 2 条已采纳上下文 · 质量 v3 · 修订 2',
    )).toBeInTheDocument()
    expect(screen.queryByText('记忆 · memory-other')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign request summary.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign tests must stay hidden.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign coding run must stay hidden.')).not.toBeInTheDocument()
    expect(screen.queryByText('Foreign review must stay hidden.')).not.toBeInTheDocument()
    // The run is building, so nothing is waiting for approval even though a Gate node is blocked.
    expect(screen.getByRole('heading', { name: '当前没有待审批的步骤' })).toBeInTheDocument()
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

  it('offers copy-once Desktop pairing only in settings for the explicitly selected project', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    const todo = render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote' }) }))
    expect(screen.queryByRole('button', { name: '生成桌面配对码' })).not.toBeInTheDocument()
    todo.unmount()

    render(
      await Page({
        searchParams: Promise.resolve({ projectId: 'p-remote', view: 'settings', section: 'desktop' }),
      }),
    )

    expect(screen.getByRole('heading', { name: '桌面连接 · Remote API' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '生成桌面配对码' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: '桌面连接' })).toHaveAttribute('aria-current', 'page')
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
      searchParams: Promise.resolve({ projectId: 'p-remote', view: 'tasks' }),
    }))

    expect(screen.getByRole('region', { name: '团队请求' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '团队请求' })).toBeInTheDocument()
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
      searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }),
    }))

    const approvals = screen.getByRole('region', { name: '交付审批' })
    expect(within(approvals).getByText('Deliver the exact remote change')).toBeInTheDocument()
    expect(within(approvals).getByText(`${'b'.repeat(12)}…`)).toBeInTheDocument()
    // Full identifiers stay reachable in the technical details.
    for (const value of ['b'.repeat(40), 'e'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), 'f'.repeat(64)]) {
      expect(within(approvals).getAllByText(value)[0]!.closest('details')).not.toBeNull()
    }
    expect(within(approvals).getByText('src/remote.ts')).toBeInTheDocument()
    expect(within(approvals).getByRole('button', { name: '批准交付' })).toBeInTheDocument()
    // Repository binding management is not on the task page.
    expect(screen.queryByRole('form', { name: '仓库绑定设置' })).not.toBeInTheDocument()
    expect(mockedFetchGitHubBinding).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
    expect(mockedFetchGitHubDeliveries).toHaveBeenCalledWith({
      projectId: 'p-remote',
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('keeps the repository binding in settings, editable only by an Owner', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)
    mockedFetchGitHubBinding.mockResolvedValue({
      stateVersion: 1, id: 'binding-remote', version: 3, organizationId: 'org-demo', teamProjectId: 'p-remote',
      installationId: '12345', repositoryId: '98765', repository: 'erich/remote-api', defaultBranch: 'main',
      status: 'active', validatedAt: '2026-08-11T14:00:00.000Z', updatedAt: '2026-08-11T14:00:00.000Z', redacted: true,
    })
    const owner = render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', view: 'settings', section: 'github' }) }))
    expect(screen.getByRole('region', { name: 'GitHub 仓库绑定' })).toHaveTextContent('默认分支 main · 绑定版本 v3')
    expect(screen.getByRole('form', { name: '仓库绑定设置' })).toBeInTheDocument()
    expect(mockedFetchGitHubDeliveries).not.toHaveBeenCalled()
    owner.unmount()

    mockedFetchAuthSession.mockResolvedValue({
      user: { id: 'u-remote', name: 'Remote Lead', role: 'lead' },
      authentication: { provider: 'github' },
      projectMemberships: [{ projectId: 'p-remote', userId: 'u-remote', role: 'lead' }],
    })
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', view: 'settings', section: 'github' }) }))
    expect(screen.queryByRole('form', { name: '仓库绑定设置' })).not.toBeInTheDocument()
    expect(screen.getByText('只有 Owner 可以修改或撤销仓库绑定。')).toBeInTheDocument()
  })

  // Plan S5, Q2: 我的待办 lists each decision once, says how fresh the data is, and never
  // presents missing data as an empty list.
  it('lists the delivery awaiting approval and a paused Gate in 我的待办', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      runs: [{ ...pausedDesignRun(), gateReviewSubject: designSubject() }],
    })
    mockedFetchGitHubDeliveries.mockResolvedValueOnce([{
      id: 'delivery-remote', stateVersion: 2, intentRevision: 1, projectId: 'p-remote', runId: 'run-remote',
      runVersion: 7, nodeId: 'pr-remote', repositoryBindingId: 'binding-remote', repositoryBindingVersion: 3,
      deliverySeriesKey: `github-delivery:${'9'.repeat(64)}`, deliveryAttempt: 1, repositoryId: '98765',
      repository: 'erich/remote-api', status: 'approval_required', outcomeCode: null, expectedRunVersion: 7,
      baseBranch: 'main', headBranch: 'devflow/run-remote-pr-remote', baseCommitSha: 'a'.repeat(40),
      expectedCommitSha: 'b'.repeat(40), intentDigest: 'c'.repeat(64), diffDigest: 'd'.repeat(64),
      testEvidenceId: 'evidence-remote-v1', testEvidenceDigest: 'e'.repeat(64), packageDigest: 'f'.repeat(64),
      changedPaths: ['src/remote.ts'], prTitle: 'Deliver the exact remote change',
      expiresAt: '2026-08-12T14:00:00.000Z', updatedAt: '2026-08-11T14:01:00.000Z',
    }])

    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote' }) }))

    expect(screen.getByRole('heading', { level: 1, name: '我的待办' })).toBeInTheDocument()
    expect(screen.getByText(/团队数据读取于 .* UTC/)).toBeInTheDocument()
    const mine = screen.getByRole('region', { name: '需要你处理' })
    expect(within(mine).getByRole('article', { name: '方案评审 · Remote run' })).toHaveTextContent('方案 · 记录于 2026-06-16 10:05 UTC')
    expect(within(mine).getByRole('article', { name: '交付审批 · Remote run' })).toHaveTextContent('请求 v2 · 提交 bbbbbbbbbbbb…')
    expect(within(mine).getByRole('link', { name: '查看 Remote run 的方案评审' })).toHaveAttribute('href', '/?projectId=p-remote&runId=run-remote#human-gate')
    expect(within(mine).getByRole('link', { name: '查看 Remote run 的交付审批' })).toHaveAttribute('href', '/?projectId=p-remote&runId=run-remote#github-delivery')
    expect(mockedFetchWorkRequests).not.toHaveBeenCalled()
    expect(mockedFetchGitHubBinding).not.toHaveBeenCalled()
  })

  it('says the todo list is incomplete when deliveries could not be read', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)
    mockedFetchGitHubDeliveries.mockRejectedValueOnce(new Error('unavailable'))
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote' }) }))
    expect(screen.getByRole('note')).toHaveTextContent('交付请求暂时无法读取，列表可能不完整。')
    expect(screen.queryByText('当前项目没有需要你处理的审批。')).not.toBeInTheDocument()
    expect(screen.getByText(/列表不完整，见上方说明/)).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { level: 1, name: 'Remote run' })).toBeInTheDocument()
    expect(screen.getByText('Ship from API data.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '进度与材料' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '审批' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '团队', exact: true })).toBeInTheDocument()
    expect(screen.getAllByText('Architecture Gate').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Lead review')).toBeInTheDocument()
    expect(screen.getByText('桌面端最近一次上传：2026-06-16 10:10 UTC')).toBeInTheDocument()
    expect(screen.getByText('Remote tests passed.')).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(screen.getByText('Agent 执行 · n-build')).toBeInTheDocument()
    expect(screen.getByText('记忆 · n-build')).toBeInTheDocument()
    expect(screen.getByText('project_shared · internal · until_deleted')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '多 Agent 协作' })).toBeInTheDocument()
    expect(screen.getByText('协作 · n-build')).toBeInTheDocument()
    expect(screen.getByText('3 个任务 · 2 次交接 · 1500 ms · 0 次人工介入')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start coordination|cancel coordination|resume coordination|retry coordination/iu })).not.toBeInTheDocument()
    expect(screen.getByText('Session User · GitHub')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /备份壳/ })).not.toBeInTheDocument()
    expect(screen.getByText(/1 项阻断 · 2 条警告/)).toBeInTheDocument()
    expect(screen.getByText(/1 次重试 · 1 次例外批准/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /策略设置/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '项目预算' })).toBeInTheDocument()
    expect(screen.getByText('$0.123 / $0.20')).toBeInTheDocument()
    // Management forms are not on the task's first screen.
    expect(screen.queryByRole('button', { name: '生成桌面配对码' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '仓库绑定设置' })).not.toBeInTheDocument()
    expect(mockedFetchTeamOverview).toHaveBeenCalledWith({
      cookieHeader: 'devflow_session=session-1',
    })
  })

  it('loads an authoritative Gate Command snapshot only for the current paused Gate', async () => {
    mockedFetchTeamOverview.mockResolvedValue({
      ...overview,
      runs: [{ ...pausedDesignRun(), gateReviewSubject: designSubject() }],
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

    const approval = screen.getByRole('region', { name: '审批' })
    expect(approval).toHaveTextContent('方案 · 记录于 2026-06-16 10:05 UTC')
    expect(approval).toHaveTextContent('Lead 及以上')
    fireEvent.change(screen.getByRole('textbox', { name: '审批说明' }), {
      target: { value: 'Evidence reviewed.' },
    })
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeEnabled()
  })

  // Plan S5, Q4/Q8: a design approval is bound to the uploaded material version.
  it('keeps design approval unavailable until the material version is synced, rejection stays', async () => {
    mockedFetchTeamOverview.mockResolvedValue({ ...overview, runs: [pausedDesignRun()] })
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }) }))
    const approval = screen.getByRole('region', { name: '审批' })
    expect(approval).toHaveTextContent('所审材料的版本尚未从桌面端同步')
    fireEvent.change(screen.getByRole('textbox', { name: '审批说明' }), { target: { value: 'Reviewed.' } })
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeEnabled()
  })

  it('shows a project member who has to approve, without dead buttons', async () => {
    mockedFetchTeamOverview.mockResolvedValue({ ...overview, runs: [{ ...pausedDesignRun(), gateReviewSubject: designSubject() }] })
    mockedFetchAuthSession.mockResolvedValue({
      user: { id: 'u-member', name: 'Member', role: 'member' },
      authentication: { provider: 'github' },
      projectMemberships: [{ projectId: 'p-remote', userId: 'u-member', role: 'member' }],
    })
    render(await Page({ searchParams: Promise.resolve({ projectId: 'p-remote', runId: 'run-remote' }) }))
    const approval = screen.getByRole('region', { name: '审批' })
    expect(within(approval).getByText('等待负责人审批（需要 Lead 及以上）。')).toBeInTheDocument()
    expect(within(approval).queryByRole('button', { name: '批准并继续' })).not.toBeInTheDocument()
    expect(within(approval).queryByRole('button', { name: '驳回' })).not.toBeInTheDocument()
    expect(within(approval).getByText('成员')).toBeInTheDocument()
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

    expect(screen.getByRole('heading', { level: 2, name: '当前没有待审批的步骤' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '审批说明' })).not.toBeInTheDocument()
    // No dead buttons when nothing waits for a decision.
    expect(screen.queryByRole('button', { name: '批准并继续' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument()
    expect(screen.getByText(/实际进度：Current implementation/)).toBeInTheDocument()
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

    expect(screen.getByText('还没有团队项目')).toBeInTheDocument()
    expect(screen.getByText('由组织 Owner 创建团队项目后，这里会显示待办与任务。')).toBeInTheDocument()
  })

  it('offers the normal GitHub sign-in route when an unauthenticated overview request fails', async () => {
    mockedCookies.mockResolvedValueOnce({ get: vi.fn(() => undefined) } as never)
    mockedFetchTeamOverview.mockRejectedValue(
      new DevFlowApiError('/api/team/overview', 401),
    )

    render(await Page({}))

    expect(screen.getByText('需要登录')).toBeInTheDocument()
    expect(screen.getByText('请先建立浏览器身份，再进入团队工作台。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '使用 GitHub 登录' })).toHaveAttribute(
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
