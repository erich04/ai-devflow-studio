import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { fetchTeamOverview } from './lib/devflow-api'
import type { TeamOverviewResponse } from './lib/devflow-api'

vi.mock('./lib/devflow-api', () => ({
  fetchTeamOverview: vi.fn(),
  runKnowledgeReview: vi.fn(),
}))

const mockedFetchTeamOverview = vi.mocked(fetchTeamOverview)

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
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('web manager console page', () => {
  it('renders team overview data loaded from the API client', async () => {
    mockedFetchTeamOverview.mockResolvedValue(overview)

    render(await Page())

    expect(screen.getByText('Remote API')).toBeInTheDocument()
    expect(screen.getByText('erich/remote-api')).toBeInTheDocument()
    expect(screen.getByText('Remote Lead')).toBeInTheDocument()
    expect(screen.getByText('RL')).toBeInTheDocument()
    expect(screen.getByText('Remote run')).toBeInTheDocument()
    expect(screen.getByText('Remote tests passed.')).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(screen.getByText('Knowledge review completed.')).toBeInTheDocument()
    expect(screen.getByText('No blocking knowledge gaps found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run backend review/ })).toBeInTheDocument()
    expect(screen.getAllByText('$0.123')).toHaveLength(2)
    expect(mockedFetchTeamOverview).toHaveBeenCalled()
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
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      agentProviders: [],
    })

    render(await Page())

    expect(screen.getByText('还没有团队项目')).toBeInTheDocument()
    expect(screen.getByText('等待 API 同步团队项目后显示交付健康。')).toBeInTheDocument()
  })

  it('renders an error state when the API cannot be reached', async () => {
    mockedFetchTeamOverview.mockRejectedValue(new Error('network down'))

    render(await Page())

    expect(screen.getByText('团队数据暂时不可用')).toBeInTheDocument()
    expect(screen.getByText('network down')).toBeInTheDocument()
  })
})
